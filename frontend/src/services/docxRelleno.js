/* ─────────────────────────────────────────────────────────────────────────────
   docxRelleno.js — RELLENAR la plantilla .docx del cliente conservando su formato.

   Segunda mitad de la ruta que abre `docxPlantilla.js`. Aquí se toma el .docx ya
   marcado, se sustituyen los `{campo}` por los datos del estudio y se reempaqueta.
   El documento nunca se reconstruye: se edita su propio OOXML, así que encabezado,
   pie, estilos, fuentes, colores, bordes, sombreados, márgenes, secciones y tabla
   de contenido salen exactamente como venían.

   POR QUÉ docxtemplater Y NO SUSTITUCIÓN A MANO. Word parte una misma frase en
   varios `<w:r><w:t>` por rsid, por el corrector o por un cambio de formato, así que
   un `{ent}` puede estar repartido en tres runs y un `.replace` sobre el XML no
   encuentra nada. docxtemplater une los runs antes de resolver los marcadores, y
   además trae los bucles con los que se repiten filas de tabla conservando su
   formato. Ya estaba en las dependencias del proyecto sin que nadie lo usara.

   LAS IMÁGENES VAN A MANO. El módulo de imágenes de docxtemplater es de pago, así
   que el anexo de estados financieros se inserta escribiendo el OOXML: el binario en
   `word/media/`, la relación en `document.xml.rels`, el content-type en
   `[Content_Types].xml` y un `<w:drawing>` en el cuerpo. Es la parte frágil de este
   módulo —el spec 2026-08-04-docx-real-ooxml-design.md documenta esa familia de
   trampas— y por eso va después del render y con tests de estructura.

   LO QUE ESTOS TESTS NO PUEDEN COMPROBAR: que Word abra el resultado sin quejarse.
   En esta máquina no hay con qué renderizar un .docx. Se verifica el XML emitido
   —relaciones existentes, sin identificadores repetidos, párrafos balanceados— y la
   comprobación final es manual.
   ───────────────────────────────────────────────────────────────────────────── */

import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { valorDeCampo } from './plantillaVocabulario.js';
import { filasComparablesInforme, filasRazonesRechazo } from './tablasInforme.js';
import { pctf, fmt, num, pliOf } from '../utils/calculations.js';
import { nameKey } from './comparablesEngine.js';
import { analizarRango } from './rangoIntercuartil.js';
import {
  DATOS_MACRO, FUENTES_MACRO, resolverSerie, valorODisponible, marcadorPendiente
} from './analisisMercado.js';

/** EMU (English Metric Units) por centímetro: la unidad de medida de OOXML. */
export const EMU_POR_CM = 360000;

/** Ancho útil por defecto, en cm: A4 (21) menos 2,5 de margen a cada lado. */
const ANCHO_UTIL_CM = 16;

/* Dónde va el anexo de estados financieros. Es un párrafo con este texto, que el
   marcado deja en la plantilla y aquí se sustituye por las imágenes. */
export const CENTINELA_ANEXO = '@@ANEXO_EEFF@@';

const RUTA_RELS = 'word/_rels/document.xml.rels';
const RUTA_CT = '[Content_Types].xml';
const RUTA_DOC = 'word/document.xml';

/** El valor que se escribe cuando un campo no tiene dato. */
export const SIN_DATO = '—';

const AMBITO = { Int: 'INTERNACIONAL', Nac: 'NACIONAL' };

/**
 * Los datos de las tablas que se repiten, con la forma que esperan los bucles.
 *
 * Sale de las mismas funciones que alimentan la ruta de HTML —`filasComparablesInforme`
 * y `filasRazonesRechazo`, ambas sin una línea de markup—, y no de un cálculo propio.
 * No es una preferencia de estilo: los márgenes que publica la tabla tienen que ser
 * los que sustentan el rango intercuartil que el informe declara unas páginas más
 * adelante, y para eso los dos números han de venir del mismo `analizarRango`.
 *
 * @param {object} estudio
 * @returns {{comparables:Array, razonesRechazo:Array}}
 */
export function coleccionesDelEstudio(estudio) {
  const study = estudio || {};

  const comparables = filasComparablesInforme(study).map((f, i) => ({
    n: String(i + 1),
    nombre: f.nombre,
    ambito: AMBITO[f.amb] || '',
    margen: pctf(f.noAjustado),
    margenAjustado: pctf(f.ajustado),
  }));

  const { filas } = filasRazonesRechazo(study.embudoSeleccion);
  const razonesRechazo = (filas || []).map((f) => ({
    letra: f.letra,
    criterio: f.etiqueta,
    cantidad: String(f.cuantas),
  }));

  const accionistas = (study.accionistas || []).map((a, i) => ({
    n: String(i + 1),
    nombre: a.nombre || '',
    pais: a.pais || '',
    acciones: a.acciones ? fmt(num(a.acciones)) : '',
    valorCapital: a.valor_capital ? fmt(num(a.valor_capital)) : '',
    participacion: a.participacion_pct ? String(a.participacion_pct) : '',
  }));

  return { comparables, razonesRechazo, accionistas };
}

function escaparXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Genera el XML de una tabla limpia y estilizada en OOXML. */
export function generarTablaOoxml(titulo, cabeceras, filas, fuente) {
  const colCount = cabeceras.length;
  const colWidth = Math.round(9405 / colCount); // 9405 dxa es el ancho útil aproximado

  let xml = `<w:p><w:pPr><w:keepNext/><w:outlineLvl w:val="9"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${escaparXml(titulo)}</w:t></w:r></w:p>`;
  xml += `<w:tbl>`;
  xml += `<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9405" w:type="dxa"/><w:tblBorders>`
    + `<w:top w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>`
    + `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>`
    + `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>`
    + `<w:left w:val="none"/><w:right w:val="none"/><w:insideV w:val="none"/>`
    + `</w:tblBorders></w:tblPr>`;

  // Headers
  xml += `<w:tr><w:trPr><w:tblHeader/></w:trPr>`;
  cabeceras.forEach((h) => {
    xml += `<w:tc><w:tcPr><w:tcW w:w="${colWidth}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="0E1726"/></w:tcPr>`
      + `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:color w:val="FFFFFF"/><w:b/></w:rPr>`
      + `<w:t>${escaparXml(h)}</w:t></w:r></w:p></w:tc>`;
  });
  xml += `</w:tr>`;

  // Rows
  filas.forEach((f) => {
    xml += `<w:tr>`;
    f.forEach((celda) => {
      xml += `<w:tc><w:tcPr><w:tcW w:w="${colWidth}" w:type="dxa"/></w:tcPr>`
        + `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>${escaparXml(celda)}</w:t></w:r></w:p></w:tc>`;
    });
    xml += `</w:tr>`;
  });

  xml += `</w:tbl>`;

  if (fuente) {
    xml += `<w:p><w:pPr><w:pStyle w:val="Normal"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:b/></w:rPr><w:t>FUENTE: ${escaparXml(fuente)}</w:t></w:r></w:p>`;
  }

  return xml;
}

/** Reemplaza quirúrgicamente las ocho tablas de tendencias económicas en el OOXML del documento. */
export function actualizarTablasMacroOoxml(xml, datosMacro, year, avisos) {
  const doc = sustituidorDeTablas(xml, avisos);
  const reemplazar = (...args) => doc.reemplazar(...args);

  const y1 = year - 1, y2 = year, y3 = year + 1;
  const wrap = (v) => String(v == null ? '—' : v);

  /* Estas ocho no llevan «Tabla N.» en la plantilla, así que la numeración nunca fue
     su problema; lo que sí las alcanzaba es el otro defecto del patrón anterior: el
     título tenía que estar contiguo en el XML, y Word lo parte en varios runs. Por eso
     pasan por el mismo localizador, que compara sobre el texto ya reconstruido. */

  // 1. PIB Mundial
  {
    const { valores: S, fuente } = resolverSerie(datosMacro, 'pib_mundial');
    reemplazar('PIB Mundial', () => generarTablaOoxml(
      'Crecimiento del PIB Mundial (' + y1 + '-' + y3 + ')',
      ['Año', 'Crecimiento Mundial (%)'],
      [
        [String(y1), wrap(valorODisponible(S, y1, 'el crecimiento del PIB mundial'))],
        [String(y2), wrap(valorODisponible(S, y2, 'el crecimiento del PIB mundial'))],
        [String(y3) + ' (Proyección)', wrap(valorODisponible(S, y3, 'la proyección de crecimiento del PIB mundial'))],
      ],
      fuente
    ));
  }

  // 2. PIB Colombia
  {
    const { valores: S, fuente } = resolverSerie(datosMacro, 'pib_colombia');
    reemplazar('PIB en Colombia', () => generarTablaOoxml(
      'Crecimiento del PIB en Colombia (' + y1 + '-' + y3 + ')',
      ['Año', 'Crecimiento del PIB (%)'],
      [
        [String(y1), wrap(valorODisponible(S, y1, 'el crecimiento del PIB de Colombia'))],
        [String(y2), wrap(valorODisponible(S, y2, 'el crecimiento del PIB de Colombia'))],
        [String(y3) + ' (Proyección OCDE)', wrap(valorODisponible(S, y3, 'la proyección de crecimiento del PIB de Colombia'))],
      ],
      fuente
    ));
  }

  // 3. Inflación Global
  {
    const { valores: S, fuente } = resolverSerie(datosMacro, 'inflacion_global');
    reemplazar('Inflación Global', () => generarTablaOoxml(
      'Tasas de Inflación Global (' + y1 + '-' + y3 + ')',
      ['Año', 'Tasa de Inflación (%)'],
      [
        [String(y1), wrap(valorODisponible(S, y1, 'la inflación global'))],
        [String(y2), wrap(valorODisponible(S, y2, 'la inflación global'))],
        [String(y3) + ' (Proyección)', wrap(valorODisponible(S, y3, 'la proyección de inflación global'))],
      ],
      fuente
    ));
  }

  // 4. PIB por Región
  {
    const { valores: porAnio, fuente } = resolverSerie(datosMacro, 'crecimiento_por_region');
    reemplazar('por Región/País', () => {
      const porRegion = porAnio[year];
      const titulo = 'Proyecciones de Crecimiento del PIB por Región/País (' + year + ')';
      let filas = [];
      if (!porRegion || !porRegion.length) {
        const regiones = ['Mundial', 'Estados Unidos', 'China', 'América Latina', 'Colombia (OCDE)'];
        filas = regiones.map((r) => [r, wrap(marcadorPendiente(year, 'la proyección de crecimiento de ' + r))]);
      } else {
        filas = porRegion.map(({ region, valor }) => [region, wrap(valor)]);
      }
      return generarTablaOoxml(titulo, ['Región/País', 'Crecimiento Proyectado (%)'], filas, fuente);
    });
  }

  // 5. Inflación Colombia
  {
    const { valores: S, fuente } = resolverSerie(datosMacro, 'inflacion_colombia');
    reemplazar('Inflación en Colombia', () => generarTablaOoxml(
      'Inflación en Colombia (' + year + ' vs. Meta ' + y3 + ')',
      ['Indicador', 'Valor (%)'],
      [
        ['Inflación ' + year, wrap(valorODisponible(S, year, 'la inflación de Colombia'))],
        ['Meta Inflación ' + y3, wrap(DATOS_MACRO.meta_inflacion_banrep)],
      ],
      fuente
    ));
  }

  // 6. Tasa de Intervención
  {
    const { valores: S, fuente } = resolverSerie(datosMacro, 'tasa_intervencion');
    reemplazar('Intervención del Banco', () => {
      const filas = [y1, y2].map((y) => {
        const obs = S[y];
        return obs
          ? [obs.etiqueta, wrap(obs.valor)]
          : ['Diciembre ' + y, wrap(marcadorPendiente(y, 'la tasa de intervención del Banco de la República'))];
      });
      return generarTablaOoxml(
        'Tasa de Intervención del Banco de la República (' + filas[0][0] + ' - ' + filas[1][0] + ')',
        ['Fecha', 'Tasa de Intervención (%)'],
        filas,
        fuente
      );
    });
  }

  // 7. TRM Promedio
  {
    const { valores: S, fuente } = resolverSerie(datosMacro, 'trm_promedio');
    reemplazar('Tasa Representativa del Mercado', () => generarTablaOoxml(
      'Tasa Representativa del Mercado (TRM) Promedio (' + y1 + '-' + y2 + ')',
      ['Año', 'TRM Promedio ($)'],
      [
        [String(y1), wrap(valorODisponible(S, y1, 'la TRM promedio'))],
        [String(y2), wrap(valorODisponible(S, y2, 'la TRM promedio'))],
      ],
      fuente
    ));
  }

  // 8. Tasa de Desempleo
  {
    const { valores: S, fuente } = resolverSerie(datosMacro, 'desempleo_colombia');
    reemplazar('Desempleo en Colombia', () => generarTablaOoxml(
      'Tasa de Desempleo en Colombia (' + year + ' vs. Proyección ' + y3 + ')',
      ['Indicador', 'Valor (%)'],
      [
        ['Desempleo ' + year, wrap(valorODisponible(S, year, 'la tasa de desempleo'))],
        ['Desempleo Proyectado ' + y3, wrap(valorODisponible(S, y3, 'la proyección de desempleo'))],
      ],
      fuente
    ));
  }

  return doc.xml;
}

/** Reemplaza quirúrgicamente las catorce tablas operativas en el OOXML del documento de la Fase 3. */
/* ─────────────────────────────────────────────────────────────────────────────
   Localización de tablas en la plantilla: por NOMBRE, no por número.

   La plantilla numera sus tablas, pero esa numeración no es fiable: cambia de un
   informe a otro según qué secciones lleve. Se ve en la propia plantilla —la de
   transacciones intercompañía viene como «Tabla 3» o como «Tabla 12», y el rango
   vertical como «Tabla 18» o como «Tabla 20»—, lo que obligaba a escribir dos
   patrones para la misma tabla y a no encontrarla con cualquier tercera numeración.

   Lo estable es el nombre. Este localizador:

     · lee el TEXTO VISIBLE de cada párrafo concatenando sus `<w:t>`. Word parte una
       frase en varios runs sin criterio —«Tabla 1» + «7. Muestra Com» + «pañías»— y
       un regex contra el XML crudo no la encuentra aunque el texto esté completo. Es
       el mismo motivo por el que este módulo usa docxtemplater para los marcadores;
     · normaliza el título: minúsculas, sin tildes y con los espacios colapsados, de
       modo que «Compañías», «COMPANIAS» y «compañias» cuenten igual;
     · descarta el prefijo «Tabla N.» antes de comparar, así que el número deja de
       decidir. Se puede pasar como PISTA para desambiguar dos tablas homónimas —el
       rango intercuartil aparece dos veces, horizontal y vertical—, pero si no
       coincide con ninguna, la búsqueda por nombre sigue valiendo;
     · cierra la tabla contando `<w:tbl>` anidados, en vez de parar en el primer
       `</w:tbl>`: Word permite tablas dentro de una celda y ahí el patrón anterior
       cortaba el bloque por la mitad.
   ───────────────────────────────────────────────────────────────────────────── */

/** Texto visible de un fragmento de OOXML: solo el contenido de los `<w:t>`. */
export function textoPlanoOoxml(fragmento) {
  const trozos = String(fragmento || '').match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || [];
  return trozos
    .map((t) => t.replace(/<[^>]*>/g, ''))
    .join('')
    /* Las entidades hay que deshacerlas para comparar contra texto legible; el
       espacio duro es frecuente en los títulos que el cliente maquetó a mano. */
    .replace(/&#160;|&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Clave de comparación de un título: sin «Tabla N.», sin tildes y sin puntuación. */
export function claveTitulo(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    /* El número es obligatorio para descartar el prefijo. Sin él se le arrancaba la palabra
       «Tabla» a la tabla que SE LLAMA «Tabla de rangos», y su clave quedaba en «de rangos»:
       incomparable de forma exacta y dependiente de la coincidencia por inclusión. */
    .replace(/^\s*tabla\s*n?[°º]?\s*\.?\s*\d+\s*[.:)\-–—]*\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Número que precede al título, si la plantilla lo trae. `null` si no hay. */
export function numeroDeTabla(texto) {
  const m = /^\s*tabla\s*n?[°º]?\s*\.?\s*(\d+)/i.exec(
    String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, ''));
  return m ? Number(m[1]) : null;
}

/** Fin del `<w:tbl>` que empieza en `desde`, contando anidamiento. -1 si no cierra. */
function finDeTabla(xml, desde) {
  const rx = /<w:tbl(?:\s[^>]*)?>|<\/w:tbl>/g;
  rx.lastIndex = desde;
  let nivel = 0, m;
  while ((m = rx.exec(xml)) !== null) {
    nivel += m[0] === '</w:tbl>' ? -1 : 1;
    if (nivel === 0) return m.index + m[0].length;
  }
  return -1;
}

/** Fin del `<w:tr>` que empieza en `desde`, contando anidamiento. -1 si no cierra. */
function finDeFila(xml, desde) {
  const rx = /<w:tr(?:\s[^>]*)?>|<\/w:tr>/g;
  rx.lastIndex = desde;
  let nivel = 0, m;
  while ((m = rx.exec(xml)) !== null) {
    nivel += m[0] === '</w:tr>' ? -1 : 1;
    if (nivel === 0) return m.index + m[0].length;
  }
  return -1;
}

/**
 * Tablas cuyo título no las precede, sino que es su PRIMERA FILA.
 *
 * Así trae la plantilla de referencia la «Tabla 20. Tabla de rangos» del final del informe:
 * el rótulo es una celda de la fila de arriba, no un párrafo aparte. Para el localizador
 * clásico —«párrafo de título seguido de `<w:tbl>`»— esa tabla era inalcanzable, y se
 * radicaba con los percentiles del informe anterior.
 *
 * Solo la primera fila cuenta. Si valiera cualquiera, una celda del cuerpo que mencione el
 * nombre —la matriz de rechazo lo hace— secuestraría la sustitución de la tabla completa.
 *
 * El bloque devuelto abarca la tabla entera, rótulo incluido: lo que se emite en su lugar
 * ya trae su propio párrafo de título.
 *
 * La coincidencia es EXACTA, no por inclusión como en el localizador por párrafo. Un rótulo
 * es exactamente el nombre de la tabla; una celda cualquiera, no. La plantilla trae una
 * tabla de definiciones cuya primera fila es «MO | Margen operacional de utilidad o
 * rentabilidad operacional»: por inclusión se haría pasar por la tabla de márgenes de las
 * comparables, y sustituirla borraría las definiciones del método.
 */
function candidatosPorFilaTitulo(texto, claves) {
  const encontrados = [];
  let cursor = 0;
  for (;;) {
    const inicio = texto.indexOf('<w:tbl', cursor);
    if (inicio === -1) break;
    const fin = finDeTabla(texto, inicio);
    if (fin < 0) break;
    /* Desde `fin` y no desde el interior: así las tablas anidadas no se analizan por
       separado —su rótulo, si lo tienen, es de la celda que las contiene—. */
    cursor = fin;

    const iFila = texto.indexOf('<w:tr', inicio);
    if (iFila === -1 || iFila > fin) continue;
    const finFila = finDeFila(texto, iFila);
    if (finFila < 0 || finFila > fin) continue;

    const rxParrafo = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
    const primeraFila = texto.slice(iFila, finFila);
    let p;
    while ((p = rxParrafo.exec(primeraFila)) !== null) {
      const titulo = textoPlanoOoxml(p[0]);
      const clave = claveTitulo(titulo);
      if (!clave || !claves.some((c) => clave === c)) continue;
      encontrados.push({ inicio, fin, titulo, numero: numeroDeTabla(titulo) });
      break;
    }
  }
  return encontrados;
}

/**
 * Bloque «párrafo del título + la tabla que le sigue» cuyo título coincide con
 * alguno de los nombres dados.
 *
 * @param xml       el `document.xml` completo.
 * @param nombres   nombre canónico de la tabla, o varios sinónimos.
 * @param opciones  `numeros`: números con los que desambiguar dos tablas homónimas.
 *                  `ocurrencia`: cuál tomar si quedan varias (0 = la primera).
 * @returns {{inicio:number, fin:number, titulo:string, numero:number|null}|null}
 */
export function localizarBloqueTabla(xml, nombres, opciones = {}) {
  const texto = String(xml || '');
  const claves = (Array.isArray(nombres) ? nombres : [nombres]).map(claveTitulo).filter(Boolean);
  if (!claves.length) return null;

  const candidatos = [];
  const rxParrafo = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let p;
  while ((p = rxParrafo.exec(texto)) !== null) {
    const titulo = textoPlanoOoxml(p[0]);
    const clave = claveTitulo(titulo);
    if (!clave || !claves.some((c) => clave.includes(c))) continue;

    /* Entre el título y la tabla la plantilla suele dejar párrafos vacíos. Se saltan
       los que no tienen texto; en cuanto aparece uno con contenido, el título ya no
       era el de esta tabla y se descarta. */
    let cursor = p.index + p[0].length;
    for (;;) {
      const resto = texto.slice(cursor);
      const hueco = /^\s*(?:<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?<\/w:p>|<w:bookmarkStart[^>]*\/?>|<w:bookmarkEnd[^>]*\/?>|<w:proofErr[^>]*\/?>)/.exec(resto);
      if (!hueco) break;
      if (textoPlanoOoxml(hueco[0]).trim()) break;
      cursor += hueco[0].length;
    }
    const tras = /^\s*<w:tbl(?:\s[^>]*)?>/.exec(texto.slice(cursor));
    if (!tras) continue;

    const inicioTabla = cursor + tras[0].indexOf('<w:tbl');
    const fin = finDeTabla(texto, inicioTabla);
    if (fin < 0) continue;
    candidatos.push({ inicio: p.index, fin, titulo, numero: numeroDeTabla(titulo) });
  }

  /* Las del rótulo embebido se añaden y todo se ordena por posición en el documento, que es
     sobre lo que `ocurrencia` cuenta: «la primera» tiene que ser la primera que se lee. */
  candidatos.push(...candidatosPorFilaTitulo(texto, claves));
  candidatos.sort((a, b) => a.inicio - b.inicio);

  if (!candidatos.length) return null;

  /* El número solo desempata. Si la plantilla renumeró y ninguno coincide, se sigue
     con todos los que dio el nombre en vez de no encontrar nada. */
  const numeros = Array.isArray(opciones.numeros) ? opciones.numeros : [];
  const porNumero = numeros.length ? candidatos.filter((c) => numeros.includes(c.numero)) : [];
  const finalistas = porNumero.length ? porNumero : candidatos;
  const i = Number(opciones.ocurrencia) || 0;
  return finalistas[Math.min(i, finalistas.length - 1)] || null;
}

/**
 * Sustituidor de tablas sobre un `document.xml`.
 *
 * Encapsula el XML que va mutando y el registro de las tablas que la plantilla no
 * trae, para que los dos generadores —el de macroeconomía y el de operaciones—
 * compartan el mecanismo en vez de llevar cada uno su copia.
 *
 * Anotar las ausentes es la mitad del valor: hasta ahora el fallo era mudo y la
 * tabla se quedaba con los datos del informe anterior, que es la peor forma de
 * fallar en un documento que se radica ante la DIAN.
 *
 * @param xmlInicial  el `document.xml` de partida.
 * @param avisos      (opcional) arreglo donde se anotan los nombres no encontrados.
 */
function sustituidorDeTablas(xmlInicial, avisos) {
  let out = String(xmlInicial || '');
  return {
    /** true si la tabla estaba y se sustituyó. */
    reemplazar(nombres, generar, opciones) {
      const bloque = localizarBloqueTabla(out, nombres, opciones);
      if (!bloque) {
        if (Array.isArray(avisos)) {
          avisos.push(Array.isArray(nombres) ? nombres[0] : nombres);
        }
        return false;
      }
      out = out.slice(0, bloque.inicio) + generar(bloque) + out.slice(bloque.fin);
      return true;
    },
    get xml() { return out; },
  };
}

/**
 * El análisis vertical de un rubro sobre el total de activos del estudio.
 *
 * Una sola definición para la Tabla 10 del cuerpo y para el ESF del ANEXO A: si cada una
 * llevara su cuenta, el informe publicaría dos verticales distintos para el mismo estado
 * financiero, y el que revisa no tendría forma de saber cuál vale.
 *
 * @param {object} estudio
 * @returns {(valor:*) => string} el porcentaje formateado, o «—» sin total de activos.
 */
export function verticalSobreActivos(estudio) {
  const total = num(estudio && estudio.t_act_tot);
  return (valor) => {
    const n = num(valor);
    if (n === null || !total) return '—';
    return ((n / total) * 100).toFixed(2) + '%';
  };
}

export function actualizarTablasOperacionesOoxml(xml, estudio, avisos) {
  if (!estudio) return xml;
  const doc = sustituidorDeTablas(xml, avisos);
  const reemplazar = (...args) => doc.reemplazar(...args);

  /* Título de la tabla que se emite. Conserva el número que traía la plantilla en vez
     de imponer el nuestro: si el cliente renumeró, escribir «Tabla 17» sobre lo que su
     documento llama «Tabla 15» descuadra la referencia en el índice y en el texto. */
  const tituloDe = (bloque, nombre) => (
    bloque && bloque.numero != null ? `Tabla ${bloque.numero}. ${nombre}` : nombre
  );
  const year = Number(estudio.anio) || 2025;
  const wrap = (v) => String(v == null || v === '' ? '—' : v);

  const rResult = analizarRango(estudio);
  const stats = rResult.stats || {};

  // Calcular tPLI (indicador del contribuyente unificado)
  const seg = num(estudio.seg_excluido) || 0;
  const tS = num(estudio.t_s), tOp = num(estudio.t_op);
  const T = {
    s: tS !== null ? tS - seg : null,
    c: num(estudio.t_c),
    op: tOp !== null ? tOp - seg : null,
    ar: num(estudio.t_ar), inv: num(estudio.t_inv), ap: num(estudio.t_ap),
  };
  const tPLI = pliOf(T, estudio.pli || 'MO');

  /* Estadística de las dos columnas, del mismo sitio. Aquí vivía una serie ordenada a
     mano con `cuartilInterpolado`: era el tercer cálculo del cuartil del sistema y el
     único que no aplicaba el filtro de ámbito. */
  const sinAj = rResult.statsNoAjustado || {};
  const minNoAjustado = sinAj.min !== undefined ? sinAj.min : null;
  const maxNoAjustado = sinAj.max !== undefined ? sinAj.max : null;
  const p25NoAjustado = sinAj.p25 !== undefined ? sinAj.p25 : null;
  const medNoAjustado = sinAj.med !== undefined ? sinAj.med : null;
  const p75NoAjustado = sinAj.p75 !== undefined ? sinAj.p75 : null;

  const minAjustado = stats.min !== undefined ? stats.min : null;
  const maxAjustado = stats.max !== undefined ? stats.max : null;
  const p25Ajustado = stats.p25 !== undefined ? stats.p25 : null;
  const medAjustado = stats.med !== undefined ? stats.med : null;
  const p75Ajustado = stats.p75 !== undefined ? stats.p75 : null;

  const pStr = (v) => (v === null || v === undefined ? '—' : pctf(v));

  // Helper para extraer código y descripción
  const extraerCodigoYDesc = (vinc_tipo) => {
    const s = String(vinc_tipo || '');
    const m = s.match(/^(.*?)(?:\s*\((\d+)\))?$/);
    if (!m) return { desc: s, cod: '07' };
    return { desc: m[1].trim(), cod: m[2] || '07' };
  };

  // 1. Operaciones de Ingreso/Egreso
  reemplazar(['Operaciones de Ingreso', 'Operaciones de Egreso'], (b) => {
    const opTipoTitle = estudio.egreso ? 'Egreso' : 'Ingreso';
    return generarTablaOoxml(
      tituloDe(b, `Operaciones de ${opTipoTitle}`),
      ['Concepto de Operaciones a analizar', 'Nombre vinculado', 'País vinculado', 'Monto de la Operación analizar'],
      [[
        wrap(estudio.vinc_tipo),
        wrap(estudio.vinc),
        wrap(estudio.pais_vinc),
        estudio.monto_operacion ? fmt(num(estudio.monto_operacion)) : '—'
      ]],
      'Información suministrada por la Administración de la Compañía.'
    );
  }, { numeros: [1] });

  // 2. Operación analizar
  reemplazar('Operación analizar', (b) => {
    const { desc, cod } = extraerCodigoYDesc(estudio.vinc_tipo);
    const tipoOp = estudio.egreso ? 'Egreso' : 'Ingreso';
    return generarTablaOoxml(
      tituloDe(b, 'Operación analizar'),
      ['No. Operaciones de análisis', 'Descripción'],
      [[`${tipoOp} (${cod})`, desc]],
      'Información suministrada por la Administración de la Compañía.'
    );
  }, { numeros: [2] });

  /* 3. Transacciones Inter compañía. La plantilla la trae dos veces —una en la
     descripción del vinculado y otra en el análisis— con la misma cabecera y números
     que cambian según el informe (3 y 12 en la del cliente). Se sustituyen las dos
     por ocurrencia, sin depender de esos números. */
  {
    const filas3 = [
      ['Razón social', wrap(estudio.vinc)],
      ['Identificación fiscal', wrap(estudio.vinc_id)],
      ['País - Residencia fiscal', wrap(estudio.pais_vinc)],
      ['Tipo de vinculación', wrap(estudio.tipo_vinculacion || 'Art 260-1 E-T Inciso 1')],
      [`Tipo de operaciones (${estudio.egreso ? 'Egreso' : 'Ingreso'})`, wrap(estudio.vinc_tipo)],
      ['Monto en pesos', estudio.monto_operacion ? fmt(num(estudio.monto_operacion)) : '—']
    ];
    const tablaTx = (b) => generarTablaOoxml(
      tituloDe(b, 'Transacciones Inter compañía'),
      ['Compañía vinculada', ''], filas3,
      `Información de ${escaparXml(estudio.ent || 'la Compañía')}.`
    );
    /* De atrás hacia adelante: sustituir la primera desplaza los índices de la
       segunda, y el localizador trabaja sobre posiciones del XML. */
    reemplazar('Transacciones Inter compañía', tablaTx, { ocurrencia: 1 });
    reemplazar('Transacciones Inter compañía', tablaTx, { ocurrencia: 0 });
  }

  // 4. Método de Precios de Transferencia Aplicable
  reemplazar('Método de Precios de Transferencia', (b) => {
    const { desc, cod } = extraerCodigoYDesc(estudio.vinc_tipo);
    return generarTablaOoxml(
      tituloDe(b, 'Método de Precios de Transferencia Aplicable'),
      ['Código de Operación', 'Descripción de la operación', 'Método seleccionado', 'Indicador de Rentabilidad'],
      [[cod, desc, estudio.metodo || 'TU', estudio.pli || 'MO']],
      'Información suministrada por la Administración de la Compañía.'
    );
  }, { numeros: [4] });

  /* 5. Rango Intercuartil, versión horizontal. El nombre no la distingue de la
     vertical del análisis —las dos se llaman igual—, así que la primera ocurrencia
     es la horizontal, que va antes en el documento. */
  reemplazar('Rango Intercuartil', (b) => {
    const col1 = estudio.ent ? String(estudio.ent).toUpperCase() : 'CONTRIBUYENTE';
    return generarTablaOoxml(
      tituloDe(b, 'Rango Intercuartil'),
      [col1, 'Percentil 25', 'Mediana', 'Percentil 75'],
      [[pStr(tPLI), pStr(p25Ajustado), pStr(medAjustado), pStr(p75Ajustado)]],
      'Información suministrada por la Administración de la Compañía.'
    );
  }, { numeros: [5], ocurrencia: 0 });

  // 6. Composición accionaria
  reemplazar('Composición accionaria', (b) => {
    const filas = (estudio.accionistas || []).map((a) => [
      wrap(a.nombre),
      wrap(a.pais),
      a.acciones ? fmt(num(a.acciones)) : '—',
      a.valor_capital ? fmt(num(a.valor_capital)) : '—',
      a.participacion_pct ? String(a.participacion_pct) + '%' : '—'
    ]);
    const totalAcciones = (estudio.accionistas || []).reduce((acc, a) => acc + (num(a.acciones) || 0), 0);
    const totalCapital = (estudio.accionistas || []).reduce((acc, a) => acc + (num(a.valor_capital) || 0), 0);
    filas.push([
      'Total',
      '',
      totalAcciones ? fmt(totalAcciones) : '—',
      totalCapital ? fmt(totalCapital) : '—',
      '100%'
    ]);
    return generarTablaOoxml(
      tituloDe(b, 'Composición accionaria'),
      ['Accionista', 'País', 'N° Acciones', 'Valor Capital', '% Participación'],
      filas,
      'Información suministrada por la administración de la Compañía.'
    );
  }, { numeros: [6] });

  // 7. Compañías vinculadas al cierre del año gravable
  reemplazar('Compañías vinculadas', (b) => generarTablaOoxml(
    tituloDe(b, `Compañías vinculadas al 31 de diciembre de ${year}`),
    ['Nombre Vinculada', 'No. ID Fiscal', 'País'],
    [[wrap(estudio.vinc), wrap(estudio.vinc_id), wrap(estudio.pais_vinc)]],
    'Información suministrada por la Administración de la Compañía.'
  ), { numeros: [8] });

  // 8. Criterios de vinculación económica
  reemplazar('Criterios de vinculación', (b) => generarTablaOoxml(
    tituloDe(b, 'Criterios de vinculación económica'),
    ['Nombre Vinculada', 'País', 'Criterio de vinculación', 'Detalle del Criterio de Vinculación'],
    [[wrap(estudio.vinc), wrap(estudio.pais_vinc), 'Artículo. 260-1 del Estatuto Tributario, numeral 1, literal a', 'Vinculación Directa']],
    'Información suministrada por la Administración de la Compañía.'
  ), { numeros: [9] });

  // 9. Tabla 10. Activos a 31 de diciembre de ${year}
  reemplazar('Activos a 31 de diciembre', (b) => {
    {
      const av = verticalSobreActivos(estudio);
      const filas10 = [
        ['Efectivo y equivalentes de efectivo', wrap(estudio.t_cash ? fmt(num(estudio.t_cash)) : null), av(estudio.t_cash)],
        ['Inversiones asociadas', wrap(estudio.t_inv_assoc ? fmt(num(estudio.t_inv_assoc)) : null), av(estudio.t_inv_assoc)],
        ['Cuentas por cobrar comerciales y otras cuentas por cobrar', wrap(estudio.t_ar ? fmt(num(estudio.t_ar)) : null), av(estudio.t_ar)],
        ['Activos por impuestos corrientes', wrap(estudio.t_tax ? fmt(num(estudio.t_tax)) : null), av(estudio.t_tax)],
        ['Total, Activo corriente', wrap(estudio.t_act_curr ? fmt(num(estudio.t_act_curr)) : null), av(estudio.t_act_curr)],
        ['Propiedades, planta y equipo', wrap(estudio.t_ppe ? fmt(num(estudio.t_ppe)) : null), av(estudio.t_ppe)],
        ['Intangibles', wrap(estudio.t_intang ? fmt(num(estudio.t_intang)) : null), av(estudio.t_intang)],
        ['Diferidos', wrap(estudio.t_dif ? fmt(num(estudio.t_dif)) : null), av(estudio.t_dif)],
        ['Total, Activos no corrientes', wrap(estudio.t_act_nocurr ? fmt(num(estudio.t_act_nocurr)) : null), av(estudio.t_act_nocurr)],
        ['Total, Activos', wrap(estudio.t_act_tot ? fmt(num(estudio.t_act_tot)) : null), av(estudio.t_act_tot)],
      ];
      return generarTablaOoxml(
        tituloDe(b, `Activos a 31 de diciembre de ${year}`),
        ['Cifras Expresadas en pesos colombianos', String(year), 'A.V. ' + year],
        filas10,
        `Estados financieros de la Compañía a 31 de diciembre de ${year}.`
      );
    }
  }, { numeros: [10] });

  // 10. Razones de rechazo
  reemplazar('Razones de rechazo', (b) => {
    const { filas: razonesFilas } = filasRazonesRechazo(estudio.embudoSeleccion);
    const filas16 = (razonesFilas || []).map((f) => [
      f.etiqueta,
      f.letra,
      String(f.cuantas)
    ]);
    const totalEvaluadas = estudio.embudoSeleccion ? String(estudio.embudoSeleccion.evaluadas) : '—';
    filas16.push([
      'TOTAL, UNIVERSO',
      '',
      totalEvaluadas
    ]);
    const dbFuente = estudio.database_source || 'ONESOURCE (Thomson Reuters) Publicado en septiembre de 2025';
    return generarTablaOoxml(
      tituloDe(b, 'Razones de rechazo (Filtros Cuantitativos – Filtros Cualitativos)'),
      ['FILTRO APLICADO INTERNACIONALES', 'FILTROS APLICADO', 'N° POR FILTRO'],
      filas16,
      `Información Base Datos ${dbFuente}.`
    );
  }, { numeros: [16] });

  // 11. Muestra Compañías comparables
  reemplazar('Muestra Compañías comparables', (b) => {
    const compList = filasComparablesInforme(estudio);
    const filas17 = (compList || []).map((f, idx) => [
      String(idx + 1),
      f.nombre,
      AMBITO[f.amb] || ''
    ]);
    const dbFuente = estudio.database_source || 'ONESOURCE (Thomson Reuters)';
    return generarTablaOoxml(
      tituloDe(b, 'Muestra Compañías comparables'),
      ['Número', 'Nombre de la Compañía', 'Ámbito'],
      filas17,
      `Información Base Datos ${dbFuente}`
    );
  }, { numeros: [17] });

  /* 12. Rango intercuartil en vertical. La plantilla lo trae DOS VECES —la «Tabla 18. Rango
     Intercuartil» de los resultados y la «Tabla 20. Tabla de rangos» de las conclusiones,
     esta última con el rótulo dentro de su primera fila— y las dos tienen que quedar con
     los mismos percentiles. Antes se elegía una con un if/else y la otra se radicaba con
     los datos del informe anterior.

     Qué tablas existen se decide sobre el `xml` de ENTRADA, antes de que los bloques
     anteriores hayan escrito nada: las tablas que este módulo emite llevan «RANGO
     INTERCUARTIL» en su cabecera, así que preguntar después las haría pasar por tablas de
     la plantilla y una sustitución acabaría pisando a la otra.

     De atrás hacia adelante, como en Transacciones Inter compañía. */
  {
    const filas18_20 = [
      ['Mínimo', pStr(minNoAjustado), pStr(minAjustado)],
      ['Percentil 25', pStr(p25NoAjustado), pStr(p25Ajustado)],
      ['Mediana', pStr(medNoAjustado), pStr(medAjustado)],
      ['Percentil 75', pStr(p75NoAjustado), pStr(p75Ajustado)],
      ['Máximo', pStr(maxNoAjustado), pStr(maxAjustado)],
      [wrap(estudio.ent ? String(estudio.ent).toUpperCase() : 'CONTRIBUYENTE'), pStr(tPLI), pStr(tPLI)]
    ];
    const tablaRangos = (b) => generarTablaOoxml(
      tituloDe(b, /tabla de rangos/i.test(b.titulo) ? 'Tabla de rangos' : 'Rango Intercuartil'),
      ['RANGO INTERCUARTIL', `RANGE ${estudio.pli || 'MO'} NO AJUSTADO`, `RANGE ${estudio.pli || 'MO'} AJUSTADO`],
      filas18_20
    );
    const OPC_TABLA_RANGOS = { numeros: [20] };
    /* Sin «Tabla de rangos» en la plantilla, el vertical es el segundo «Rango
       Intercuartil»: el primero ya lo consumió el bloque 5. */
    const OPC_RANGO_VERTICAL = { numeros: [18], ocurrencia: 1 };
    const traeTablaRangos = !!localizarBloqueTabla(xml, 'Tabla de rangos', OPC_TABLA_RANGOS);
    const traeRangoVertical = !!localizarBloqueTabla(xml, 'Rango Intercuartil', OPC_RANGO_VERTICAL);

    if (traeTablaRangos) reemplazar('Tabla de rangos', tablaRangos, OPC_TABLA_RANGOS);
    if (traeRangoVertical) reemplazar('Rango Intercuartil', tablaRangos, OPC_RANGO_VERTICAL);
    if (!traeTablaRangos && !traeRangoVertical && Array.isArray(avisos)) {
      avisos.push('Tabla de rangos');
    }
  }

  // 13. Margen Operacional Compañías Comparables
  reemplazar('Margen Operacional', (b) => {
    const compList = filasComparablesInforme(estudio);
    const filas19 = (compList || []).map((f) => [
      f.nombre,
      pStr(f.noAjustado),
      pStr(f.ajustado)
    ]);
    const dbFuente = estudio.database_source || 'ONESOURCE (Thomson Reuters-Refinitiv Fundamentals)';
    return generarTablaOoxml(
      tituloDe(b, 'Margen Operacional Compañías Comparables'),
      ['COMPARABLES', `${estudio.pli || 'MO'} NO AJUSTADO`, `${estudio.pli || 'MO'} AJUSTADO`],
      filas19,
      `Información Base Datos ${dbFuente} Fecha de consulta: septiembre de ${year}.`
    );
  }, { numeros: [19] });

  return doc.xml;
}

/**
 * Sustituye los marcadores del .docx por los datos del estudio.
 *
 * El `parser` delega en `valorDeCampo` (`plantillaVocabulario.js`), que ya resuelve
 * los campos con punto —`rango.p25`, `uvt.tope45k`, `accionista.nombre`— y devuelve
 * el valor ya formateado o `null`. Delegar evita construir un objeto anidado y, más
 * importante, mantiene una sola definición de qué vale cada campo: la misma que usa
 * la ruta de PDF.
 *
 * `nullGetter` escribe «—» y no un valor por defecto. Es la regla que el vocabulario
 * defiende explícitamente: el informe se radica ante la DIAN, y un hueco visible es
 * preferible a heredar la cifra del cliente anterior.
 *
 * @param {ArrayBuffer|Uint8Array|Buffer} binario  el .docx marcado.
 * @param {object} estudio
 * @param {{colecciones?:object, delimitadores?:{abrir:string,cerrar:string}}} [opciones]
 *        `colecciones` alimenta los bucles de tabla (`{#comparables}…{/comparables}`).
 * @returns {{zip:PizZip, camposVacios:string[], avisosTablas:string[]}} el zip listo para
 *          generar, qué campos salieron sin dato y qué tablas no se encontraron en la
 *          plantilla, para poder avisar de ambas cosas antes de radicar.
 */
export function renderizarDocx(binario, estudio, opciones = {}) {
  const { datosMacro, analisisSector, colecciones = {}, delimitadores } = opciones;
  const camposVacios = new Set();

  const zip = new PizZip(binario);

  /* Las tablas que la plantilla no trae se recogen aquí y se devuelven. Sin el arreglo, el
     sustituidor calcula el aviso y nadie lo lee: la tabla se queda con los datos del cliente
     anterior y el informe se radica así. */
  const avisosTablas = [];

  // Actualizar tablas macro antes de procesar marcas con docxtemplater
  let xml = zip.file(RUTA_DOC).asText();
  const year = Number(estudio && estudio.anio) || 2025;
  xml = actualizarTablasMacroOoxml(xml, datosMacro, year, avisosTablas);
  xml = actualizarTablasOperacionesOoxml(xml, estudio, avisosTablas);
  zip.file(RUTA_DOC, xml);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    ...(delimitadores ? { delimiters: { start: delimitadores.abrir, end: delimitadores.cerrar } } : {}),
    parser: (tag) => ({
      get(scope) {
        /* Dentro de un bucle manda el elemento de la colección: `{nombre}` en una
           fila de comparables es del comparable, no del estudio. */
        if (scope && Object.prototype.hasOwnProperty.call(scope, tag)) return scope[tag];
        if (Object.prototype.hasOwnProperty.call(colecciones, tag)) return colecciones[tag];
        const v = valorDeCampo(estudio, tag, { datosMacro, analisisSector });
        if (v === null || v === undefined || v === '') { camposVacios.add(tag); return null; }
        return v;
      },
    }),
    nullGetter: () => SIN_DATO,
  });

  doc.render(colecciones);
  return { zip: doc.getZip(), camposVacios: [...camposVacios], avisosTablas };
}

/** El mayor rId ya usado, para no repetir ninguno al añadir relaciones. */
function siguienteRId(rels) {
  const usados = [...String(rels).matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  return (usados.length ? Math.max(...usados) : 0) + 1;
}

/** El mayor id de `wp:docPr`, que Word exige único en todo el documento. */
function siguienteIdDibujo(xml) {
  const usados = [...String(xml).matchAll(/<wp:docPr\s+id="(\d+)"/g)].map((m) => Number(m[1]));
  return (usados.length ? Math.max(...usados) : 0) + 1;
}

/* Los tres namespaces que necesita un `<w:drawing>`. `a` y `pic` se declaran en el
   propio elemento; `wp` tiene que estar en la raíz del documento, y aunque Word
   siempre lo pone, un .docx generado por otra herramienta puede no traerlo. */
const NS_WP = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';

function asegurarNamespaceWp(xml) {
  if (/xmlns:wp=/.test(xml)) return xml;
  return xml.replace(/<w:document\b([^>]*)>/, (todo, attrs) => `<w:document${attrs} ${NS_WP}>`);
}

/** El `<w:p>` con la imagen, centrado y a tamaño dado en EMU. */
function parrafoConImagen({ rId, id, nombre, cx, cy }) {
  return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>'
    + '<wp:inline distT="0" distB="0" distL="0" distR="0">'
    + `<wp:extent cx="${cx}" cy="${cy}"/>`
    + `<wp:docPr id="${id}" name="${nombre}"/>`
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:nvPicPr><pic:cNvPr id="${id}" name="${nombre}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}

/**
 * Mete una imagen en el paquete y devuelve el `rId` con el que referirla.
 *
 * Las tres cosas que hay que tocar para que Word la abra —el binario en `word/media/`, el
 * content-type de su extensión y la relación en `document.xml.rels`— van juntas aquí porque
 * olvidar una sola de ellas produce un .docx que Word declara corrupto, y ese es el fallo
 * que el spec 2026-08-04-docx-real-ooxml-design.md documenta como el más fácil de repetir.
 *
 * @returns {{rels:string, ct:string, idRel:string}} los dos archivos ya actualizados.
 */
function registrarImagen({ zip, rels, ct, rId, nombre, base64, datos, ext }) {
  zip.file(`word/media/${nombre}`, base64 || datos, base64 ? { base64: true } : {});

  const ctNuevo = new RegExp(`Extension="${ext}"`).test(ct)
    ? ct
    : ct.replace('</Types>', `<Default Extension="${ext}" ContentType="image/${ext}"/></Types>`);

  const idRel = `rId${rId}`;
  const relsNuevo = rels.replace('</Relationships>',
    `<Relationship Id="${idRel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"`
    + ` Target="media/${nombre}"/></Relationships>`);

  return { rels: relsNuevo, ct: ctNuevo, idRel };
}

/** Separa una data URL en su tipo y sus bytes. */
export function desdeDataUrl(dataUrl) {
  const m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(String(dataUrl || '').trim());
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
  return { ext: ext === 'jpeg' ? 'jpeg' : ext, base64: m[2] };
}

/**
 * Sustituye el párrafo del centinela por una imagen por página.
 *
 * Va DESPUÉS del render: docxtemplater no debe ver el XML de los dibujos.
 *
 * @param {PizZip} zip
 * @param {Array<{dataUrl?:string, datos?:Uint8Array, ext?:string, anchoCm?:number, altoCm?:number}>} imagenes
 * @param {{centinela?:string}} [opciones]
 * @returns {{insertadas:number}}
 */
export function insertarImagenes(zip, imagenes, opciones = {}) {
  const centinela = opciones.centinela || CENTINELA_ANEXO;
  const lista = (imagenes || []).filter(Boolean);

  let xml = zip.file(RUTA_DOC).asText();
  const posicion = xml.indexOf(centinela);
  if (posicion === -1) return { insertadas: 0 };

  /* El párrafo que contiene el centinela, acotado por índice y no por una regex de
     párrafo: `<w:p>` puede venir sin atributos y las regex con lookahead fallan ahí.
     Era el mismo enfoque de `reemplazarAnexoB`, que vivía en el mapper por literales y
     se retiró con él; aquí se conserva porque el problema de las regex es el mismo. */
  const inicio = xml.lastIndexOf('<w:p', posicion);
  const cierre = xml.indexOf('</w:p>', posicion);
  if (inicio === -1 || cierre === -1) return { insertadas: 0 };
  const fin = cierre + '</w:p>'.length;

  let rels = zip.file(RUTA_RELS).asText();
  let ct = zip.file(RUTA_CT).asText();
  let rId = siguienteRId(rels);
  let idDibujo = siguienteIdDibujo(xml);
  const parrafos = [];

  lista.forEach((img, i) => {
    const desde = img.dataUrl ? desdeDataUrl(img.dataUrl) : null;
    if (!desde && !img.datos) return;
    const ext = (desde && desde.ext) || img.ext || 'png';
    const nombre = `anexo_eeff_${i + 1}.${ext}`;

    zip.file(`word/media/${nombre}`, desde ? desde.base64 : img.datos,
      desde ? { base64: true } : {});

    if (!new RegExp(`Extension="${ext}"`).test(ct)) {
      ct = ct.replace('</Types>',
        `<Default Extension="${ext}" ContentType="image/${ext}"/></Types>`);
    }

    const idRel = `rId${rId++}`;
    rels = rels.replace('</Relationships>',
      `<Relationship Id="${idRel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"`
      + ` Target="media/${nombre}"/></Relationships>`);

    const anchoCm = img.anchoCm || ANCHO_UTIL_CM;
    /* Sin alto conocido se asume la proporción de una hoja A4 vertical, que es lo
       que son las páginas escaneadas del anexo. */
    const altoCm = img.altoCm || (anchoCm * 297) / 210;
    parrafos.push(parrafoConImagen({
      rId: idRel, id: idDibujo++, nombre,
      cx: Math.round(anchoCm * EMU_POR_CM), cy: Math.round(altoCm * EMU_POR_CM),
    }));
  });

  xml = asegurarNamespaceWp(xml.slice(0, inicio) + parrafos.join('') + xml.slice(fin));
  zip.file(RUTA_DOC, xml);
  zip.file(RUTA_RELS, rels);
  zip.file(RUTA_CT, ct);
  return { insertadas: parrafos.length };
}

/**
 * El camino completo: plantilla marcada + estudio → .docx listo para descargar.
 *
 * @param {{binario:ArrayBuffer|Uint8Array|Buffer, estudio:object,
 *          colecciones?:object, imagenesAnexo?:Array, delimitadores?:object,
 *          tipoSalida?:'blob'|'nodebuffer'|'uint8array'}} args
 * @returns {{salida:*, camposVacios:string[], avisosTablas:string[], imagenesInsertadas:number}}
 */
/* ─────────────────────────────────────────────────────────────────────────────
   ANEXO A — Estados financieros del contribuyente, desde la ingesta.

   POR QUÉ NO BASTABA `insertarImagenes`. Depende del centinela `@@ANEXO_EEFF@@`, y la
   plantilla del cliente no lo trae: cero ocurrencias en el informe generado el
   2026-08-10. Las páginas que el usuario ya había cargado en la ingesta nunca entraban
   y el anexo se radicaba en blanco. El ANEXO B se ancla por su encabezado desde el
   principio; el A no tenía equivalente, y esto lo es.

   POR QUÉ TABLAS NATIVAS Y NO SOLO LAS PÁGINAS ESCANEADAS. Las cifras ya están
   parseadas: `eeffParser.js` las escribe en el estudio y de ahí salen la Tabla 10, el
   indicador de rentabilidad y el rango. Publicarlas como tabla —seleccionable, con el
   formato del informe y con el mismo A.V. que el cuerpo— es lo que hace que el anexo
   sea verificable contra el análisis en vez de una foto que nadie puede cotejar. Las
   páginas del PDF van debajo, como soporte.
   ───────────────────────────────────────────────────────────────────────────── */

/** Nombre y valor de cada rubro del ESF que la ingesta sabe leer, en orden de balance. */
const RUBROS_ESF = [
  ['Efectivo y equivalentes de efectivo', 't_cash'],
  ['Inversiones asociadas', 't_inv_assoc'],
  ['Cuentas por cobrar comerciales y otras cuentas por cobrar', 't_ar'],
  ['Inventarios', 't_inv'],
  ['Activos por impuestos corrientes', 't_tax'],
  ['Total, Activo corriente', 't_act_curr'],
  ['Propiedades, planta y equipo', 't_ppe'],
  ['Intangibles', 't_intang'],
  ['Diferidos', 't_dif'],
  ['Total, Activos no corrientes', 't_act_nocurr'],
  ['Total, Activos', 't_act_tot'],
];

/** true si el estudio trae algo del estado financiero que se pueda publicar. */
function traeCifrasEeff(estudio) {
  const claves = [...RUBROS_ESF.map(([, c]) => c), 't_ap', 't_s', 't_c', 't_op'];
  return claves.some((c) => num(estudio && estudio[c]) !== null);
}

/**
 * Filas del Estado de Situación Financiera para el ANEXO A.
 *
 * El A.V. sale de `verticalSobreActivos`, la misma función que usa la Tabla 10. Las
 * cuentas por pagar se publican porque la ingesta las lee y sostienen el ajuste de capital
 * de trabajo, pero sin vertical: un pasivo sobre el total de activos no significa nada, y
 * escribir ahí un porcentaje sería inventarlo.
 */
export function filasEsfAnexoA(estudio) {
  const av = verticalSobreActivos(estudio);
  const monto = (clave) => {
    const n = num(estudio && estudio[clave]);
    return n === null ? SIN_DATO : fmt(n);
  };

  const filas = RUBROS_ESF.map(([etiqueta, clave]) => [etiqueta, monto(clave), av(estudio[clave])]);
  filas.push(['PASIVOS', '', '']);
  filas.push(['Cuentas por pagar comerciales', monto('t_ap'), SIN_DATO]);
  return filas;
}

/**
 * Filas del Estado de Resultados Integral para el ANEXO A.
 *
 * La utilidad bruta y los gastos operativos se derivan y no se piden a la ingesta, con el
 * mismo despeje que documenta `pliOf`: `opex = ventas − costo − utilidad operacional`. Así
 * el anexo no puede contradecir al indicador de rentabilidad.
 *
 * Los costos y gastos excluidos se declaran como línea propia: son lo que sostiene el
 * margen que el informe publica, y un estado de resultados que no los nombre no cuadra con
 * el rango de unas páginas más adelante.
 */
export function filasEriAnexoA(estudio) {
  const e = estudio || {};
  const s = num(e.t_s), c = num(e.t_c), op = num(e.t_op), excluido = num(e.seg_excluido);
  const val = (n) => (n === null ? SIN_DATO : fmt(n));
  const bruta = s !== null && c !== null ? s - c : null;
  const opex = bruta !== null && op !== null ? bruta - op : null;

  const filas = [
    ['Ingresos de actividades ordinarias', val(s)],
    ['Costo de ventas', val(c)],
    ['Utilidad bruta', val(bruta)],
    ['Gastos operativos', val(opex)],
    ['Utilidad operacional', val(op)],
  ];
  if (excluido !== null && excluido !== 0) {
    filas.push(['Costos y gastos excluidos de la operación analizada', val(excluido)]);
  }
  return filas;
}

/** El párrafo del encabezado de un anexo, o null si el documento no lo trae. */
function bloqueDeAnexo(xml, letra, letraSiguiente) {
  const rx = (l) => new RegExp(
    '<w:p(?:\\s[^>]*)?>(?:(?!</w:p>)[\\s\\S])*?ANEXO\\s+' + l + '(?:(?!</w:p>)[\\s\\S])*?</w:p>', 'i');
  const inicio = rx(letra).exec(xml);
  if (!inicio) return null;
  const siguiente = letraSiguiente ? rx(letraSiguiente).exec(xml) : null;
  const fin = siguiente && siguiente.index > inicio.index ? siguiente.index : xml.length;
  return { inicio: inicio.index, fin };
}

/**
 * Llena el ANEXO A con los estados financieros del contribuyente y sus páginas de soporte.
 *
 * @param {PizZip} zip
 * @param {object} estudio
 * @param {{imagenes?:Array<{dataUrl?:string, datos?:Uint8Array, ext?:string}>}} [opciones]
 * @returns {{insertadas:number}} cuántas páginas de soporte entraron.
 */
export function insertarAnexoA(zip, estudio, opciones = {}) {
  let xml = zip.file(RUTA_DOC).asText();
  const bloque = bloqueDeAnexo(xml, 'A', 'B');
  if (!bloque) return { insertadas: 0 };

  const year = Number(estudio && estudio.anio) || 2025;
  const entidad = (estudio && estudio.ent) || 'la Compañía';

  let nuevo = '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr>'
    + `<w:t>ANEXO A. Estados financieros ${escaparXml(entidad)}</w:t></w:r></w:p>`;

  if (!traeCifrasEeff(estudio)) {
    /* Mismo aviso que el ANEXO B usa para una comparable sin estado financiero: el hueco
       tiene que verse. Lo que NO puede quedarse es el anexo del informe anterior. */
    nuevo += '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:color w:val="991B1B"/>'
      + '<w:b/></w:rPr><w:t>Pendiente: carga el PDF de estados financieros en el paso de '
      + 'ingesta de cifras para que este anexo se llene.</w:t></w:r></w:p>';
    xml = xml.slice(0, bloque.inicio) + nuevo + xml.slice(bloque.fin);
    zip.file(RUTA_DOC, xml);
    return { insertadas: 0 };
  }

  nuevo += generarTablaOoxml(
    `Estado de Situación Financiera a 31 de diciembre de ${year}`,
    ['Cifras expresadas en pesos colombianos', String(year), 'A.V. ' + year],
    filasEsfAnexoA(estudio),
    `Estados financieros de ${entidad} a 31 de diciembre de ${year}.`
  );
  nuevo += generarTablaOoxml(
    `Estado de Resultados Integral ${year}`,
    ['Cifras expresadas en pesos colombianos', String(year)],
    filasEriAnexoA(estudio),
    `Estados financieros de ${entidad} a 31 de diciembre de ${year}.`
  );

  let rels = zip.file(RUTA_RELS).asText();
  let ct = zip.file(RUTA_CT).asText();
  let rId = siguienteRId(rels);
  let idDibujo = siguienteIdDibujo(xml);
  let insertadas = 0;

  (opciones.imagenes || []).filter(Boolean).forEach((img, i) => {
    const desde = img.dataUrl ? desdeDataUrl(img.dataUrl) : null;
    if (!desde && !img.datos) return;
    const ext = (desde && desde.ext) || img.ext || 'png';
    const nombre = `anexo_a_${i + 1}.${ext}`;

    const reg = registrarImagen({
      zip, rels, ct, rId: rId++, nombre, ext,
      base64: desde ? desde.base64 : null, datos: img.datos,
    });
    rels = reg.rels;
    ct = reg.ct;

    const anchoCm = img.anchoCm || ANCHO_UTIL_CM;
    const altoCm = img.altoCm || (anchoCm * 297) / 210;
    nuevo += parrafoConImagen({
      rId: reg.idRel, id: idDibujo++, nombre,
      cx: Math.round(anchoCm * EMU_POR_CM), cy: Math.round(altoCm * EMU_POR_CM),
    });
    insertadas++;
  });

  xml = asegurarNamespaceWp(xml.slice(0, bloque.inicio) + nuevo + xml.slice(bloque.fin));
  zip.file(RUTA_DOC, xml);
  zip.file(RUTA_RELS, rels);
  zip.file(RUTA_CT, ct);
  return { insertadas };
}

/**
 * Inserta de manera dinámica el Anexo B en el OOXML de la plantilla .docx.
 * Identifica la sección de Anexo B, genera la tabla de Nombre y Descripción de comparables
 * utilizando la función nativa generarTablaOoxml, e inyecta las imágenes correspondientes
 * del EEFF de cada comparable conservando el flujo OOXML estándar.
 *
 * @param {PizZip} zip
 * @param {object} estudio
 * @returns {{insertadas:number}}
 */
export function insertarImagenesAnexoB(zip, estudio) {
  const comparables = ((estudio && estudio.comparables) || []).filter((c) => c && c.name && c.eeffArchivo);
  if (!comparables.length) return { insertadas: 0 };

  let xml = zip.file(RUTA_DOC).asText();

  // Encontrar sección ANEXO B y ANEXO C de forma insensible a mayúsculas
  const rxB = /<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?ANEXO B(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/i;
  const rxC = /<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?ANEXO C(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/i;

  const mB = rxB.exec(xml);
  if (!mB) return { insertadas: 0 };
  const inicioB = mB.index;

  const mC = rxC.exec(xml);
  let finB = xml.length;
  if (mC && mC.index > inicioB) {
    finB = mC.index;
  }

  let rels = zip.file(RUTA_RELS).asText();
  let ct = zip.file(RUTA_CT).asText();
  let rId = siguienteRId(rels);
  let idDibujo = siguienteIdDibujo(xml);

  const imagenesPorComparable = (estudio && estudio.eeffImagenesComparables) || {};
  let nuevoXmlB = `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>ANEXO B. Descripciones de comparables y Estados Financieros</w:t></w:r></w:p>`;

  let totalInsertadas = 0;

  comparables.forEach((c) => {
    const desc = c.descActividad || c.desc || 'Descripción de actividad no disponible.';
    // Generar la tabla de nombre y descripción
    const tablaXml = generarTablaOoxml(
      'Descripción de la Compañía Comparable',
      ['NOMBRE DE LA COMPAÑÍA COMPARABLE', 'DESCRIPCIÓN ACTIVIDAD'],
      [[c.name, desc]]
    );
    nuevoXmlB += '\n' + tablaXml;

    // Obtener imágenes de esta comparable
    const key = nameKey(c.name);
    const listaImg = (imagenesPorComparable[key] || []).filter(Boolean);

    if (listaImg.length > 0) {
      listaImg.forEach((imgUrl, idx) => {
        const desde = desdeDataUrl(imgUrl);
        if (!desde) return;
        const ext = desde.ext || 'png';
        const nombreImg = `anexo_b_${key}_${idx + 1}.${ext}`;

        // Binario, content-type y relación van juntos: olvidar uno corrompe el .docx.
        const reg = registrarImagen({
          zip, rels, ct, rId: rId++, nombre: nombreImg, ext, base64: desde.base64,
        });
        rels = reg.rels;
        ct = reg.ct;

        // Generar párrafo de dibujo con proporción A4 estándar
        const anchoCm = ANCHO_UTIL_CM;
        const altoCm = (anchoCm * 297) / 210;
        nuevoXmlB += '\n' + parrafoConImagen({
          rId: reg.idRel, id: idDibujo++, nombre: nombreImg,
          cx: Math.round(anchoCm * EMU_POR_CM), cy: Math.round(altoCm * EMU_POR_CM),
        });

        totalInsertadas++;
      });
    } else {
      // Párrafo de pendiente si no tiene imágenes
      nuevoXmlB += `\n<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:color w:val="991B1B"/><w:b/></w:rPr><w:t>Pendiente: vuelva a cargar el Estado Financiero de esta comparable en el Paso 4 del motor de comparables.</w:t></w:r></w:p>`;
    }
  });

  xml = asegurarNamespaceWp(xml.slice(0, inicioB) + nuevoXmlB + xml.slice(finB));
  zip.file(RUTA_DOC, xml);
  zip.file(RUTA_RELS, rels);
  zip.file(RUTA_CT, ct);

  return { insertadas: totalInsertadas };
}

/**
 * El camino completo: plantilla marcada + estudio → .docx listo para descargar.
 *
 * @param {{binario:ArrayBuffer|Uint8Array|Buffer, estudio:object,
 *          colecciones?:object, imagenesAnexo?:Array, delimitadores?:object,
 *          tipoSalida?:'blob'|'nodebuffer'|'uint8array'}} args
 * @returns {{salida:*, camposVacios:string[], avisosTablas:string[], imagenesInsertadas:number}}
 */
export function rellenarDocx({
  binario, estudio, datosMacro, analisisSector, colecciones, imagenesAnexo, delimitadores, tipoSalida = 'blob',
}) {
  const { zip, camposVacios, avisosTablas } = renderizarDocx(binario, estudio, { datosMacro, analisisSector, colecciones, delimitadores });
  const { insertadas } = insertarImagenes(zip, imagenesAnexo);
  /* El ANEXO A siempre se rearma —sus tablas salen de la ingesta—, pero las páginas del PDF
     solo van aquí si el centinela no se las llevó ya: con las dos vías activas el anexo
     saldría con el escaneo repetido. */
  const { insertadas: insertadasA } = insertarAnexoA(zip, estudio, {
    imagenes: insertadas > 0 ? [] : imagenesAnexo,
  });
  const { insertadas: insertadasB } = insertarImagenesAnexoB(zip, estudio);
  return {
    salida: zip.generate({
      type: tipoSalida,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    camposVacios,
    avisosTablas,
    imagenesInsertadas: insertadas + insertadasA + insertadasB,
  };
}
