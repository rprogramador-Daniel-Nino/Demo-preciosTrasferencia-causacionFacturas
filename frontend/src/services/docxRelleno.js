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
import {
  filasOperacionesDeIngreso, filasOperacionAnalizar, filasTransaccionesIntercompania,
  filasMetodoAplicable, filasCompaniasVinculadas, filasCriteriosVinculacion,
} from './tablasOperaciones.js';
/* `verticalSobreActivos` se reexporta al final: vivía aquí y hay quien la importa de
   este módulo. Su definición se mudó con la Tabla 10, que es quien la usa. */
import {
  filasComposicionAccionaria, filasActivos, verticalSobreActivos,
} from './tablasContribuyente.js';

export { verticalSobreActivos };
import {
  filasComparablesInforme, filasRazonesRechazo, filasMuestraComparables,
  filasRangoIntercuartil, tablasMacroInforme, ETIQUETAS_RANGO, AMBITO,
} from './tablasInforme.js';
/* El ANEXO C se arma con los mismos grupos, letras y conteos que la ruta HTML: una sola
   definición de la matriz para las dos salidas del informe. */
import {
  gruposDelAnexoC, filasResumenAnexoC, tituloDeGrupoAnexoC, NOMBRE_ANEXO_C,
} from './anexoCHtml.js';
import { pctf, fmt, num } from '../utils/calculations.js';
import { nameKey } from './comparablesEngine.js';
/* La frase que comenta el rango se resuelve con la MISMA función que la ruta de plantilla PDF:
   así el informe dice lo mismo venga la plantilla base de un .docx o de un PDF. */
import { actualizarProsaRango, PARRAFO_OOXML } from './prosaRangoInforme.js';

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

/** Mismo texto y misma referencia normativa que `marcadorPendiente` de
 *  `analisisMercado.js` — no se importa de ahí para no acoplar la ruta .docx a la
 *  ruta HTML por un solo texto; si cambia la redacción legal, cambia en los dos sitios
 *  a propósito. */
function marcadorApartadoPendiente(tema, year) {
  return '[Actualizar con el análisis del panorama de la economía ' + tema + ' del año gravable ' +
    year + ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]';
}

/** Línea "FUENTE: <fuente>, <url>" para un párrafo de narrativa con tema propio —
 *  misma convención que ya usa el resumen que se le pasa a Claude en
 *  `construirPromptRedaccion` (`functions/analisisMercadoPrompts.js`). Vacío si no hay
 *  URL: no se cita una fuente que no vino de una búsqueda real (`conclusiones`, que es
 *  síntesis y no cita una serie nueva, no lleva esta línea). */
function parrafoFuenteOoxml(fuente, fuenteUrl) {
  if (!fuenteUrl) return '';
  const texto = 'FUENTE: ' + (fuente ? fuente + ', ' : '') + fuenteUrl;
  return `<w:p><w:pPr><w:pStyle w:val="Normal"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:b/></w:rPr><w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r></w:p>`;
}

/** Marcador para un hueco intermedio de III.A/III.B con tema propio (inflación
 *  mundial, política monetaria, TRM, etc.) sin narrativa lista para ESE tema —
 *  distinto de `marcadorApartadoPendiente`, que es solo para los dos apartados
 *  líderes ("mundial"/"colombiana") y usa otra redacción legal ya fijada. */
function marcadorTemaMacroPendiente(tema, year) {
  return '[Actualizar con datos verificados sobre ' + tema + ' para el año gravable ' + year +
    ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]';
}

/**
 * Reemplaza la PROSA (no las tablas) de III.A y III.B, localizándola por su encabezado,
 * para que deje de depender de que el marcado con IA la haya marcado como
 * `ia.economia_mundial`/`ia.economia_colombia` (`plantillaVocabulario.js`).
 *
 * Las tablas de cada apartado quedan intactas aquí — las sigue actualizando
 * `actualizarTablasMacroOoxml` después, por su propio encabezado.
 *
 * @param {string} xml
 * @param {object|null} datosMacro  el documento `analisisMercado/actual` de Firestore.
 * @param {number} year
 * @param {string[]} [avisos]  nombres de apartado que no se pudieron localizar o que
 *        quedaron con el marcador de pendiente por falta de narrativa.
 * @returns {string}
 */
/** Marcador genérico para un hueco intermedio (entre dos tablas) que tenía prosa
 *  sustancial del informe de referencia y no hay una narrativa específica de ese
 *  tema para reemplazarla — a diferencia del hueco líder de cada apartado, que sí
 *  tiene la narrativa completa de Firestore. */
function marcadorContenidoRetirado() {
  return '[Este párrafo del informe de referencia se retiró porque describía cifras y ' +
    'hechos de otro contribuyente. Redáctelo con información propia de este año antes ' +
    'de radicar.]';
}

/** Longitud de texto plano a partir de la cual un hueco intermedio se considera
 *  "con prosa real" y se reemplaza. Los huecos vacíos de la plantilla —un
 *  subtítulo sin narrativa antes de la tabla— quedan bajo este umbral y no se
 *  tocan: no hay nada del cliente de referencia que retirar ahí. */
const UMBRAL_HUECO_CON_PROSA = 50;

/** Contenido para un hueco intermedio: el marcador SOLO si había prosa sustancial
 *  que retirar; si el hueco ya estaba vacío o casi vacío, no se toca. */
function contenidoHuecoIntermedio(textoHueco) {
  if (textoHueco.trim().length < UMBRAL_HUECO_CON_PROSA) {
    console.log('[docxRelleno] hueco corto (' + textoHueco.trim().length + ' car.), se deja como está: '
      + JSON.stringify(textoHueco.trim().slice(0, 40)));
    return null;
  }
  return `<w:p><w:r><w:t xml:space="preserve">${escaparXml(marcadorContenidoRetirado())}</w:t></w:r></w:p>`;
}

export function actualizarApartadosMacroOoxml(xml, datosMacro, year, avisos) {
  const doc = sustituidorDeTablas(xml, null);

  const tituloMundial = 'Análisis del Panorama de la Economía Mundial';
  const tituloColombia = 'Análisis del panorama de la economía colombiana';
  const narrativa = (datosMacro && datosMacro.narrativa) || {};
  const series = (datosMacro && datosMacro.series) || {};
  console.log('[docxRelleno] actualizarApartadosMacroOoxml: año ' + year
    + ', narrativa mundial: ' + (narrativa.mundial ? 'sí' : 'no (marcador)')
    + ', narrativa colombia: ' + (narrativa.colombia ? 'sí' : 'no (marcador)'));

  const primerHueco = (narrativaHtml, tema) => () => (
    narrativaHtml
      ? parrafosOoxmlDesdeHtml(narrativaHtml)
      : `<w:p><w:r><w:t xml:space="preserve">${escaparXml(marcadorApartadoPendiente(tema, year))}</w:t></w:r></w:p>`
  );

  /** Hueco intermedio con tema propio: párrafo + FUENTE si hay narrativa para ese
   *  tema; marcador específico (no el genérico) si no, y solo si había prosa
   *  sustancial que retirar — mismo umbral que ya aplicaba `contenidoHuecoIntermedio`
   *  a esta misma posición, para no fabricar un marcador donde el hueco ya venía
   *  vacío (p. ej. "INFLACIÓN MUNDIAL" como subtítulo corto sin desarrollo debajo).
   *  `serieClave` es la clave en `datosMacro.series` cuya `fuente`/`fuenteUrl`
   *  acompaña al párrafo — `null` para "conclusiones", que sintetiza y no cita una
   *  serie nueva. */
  const temaHueco = (narrativaHtml, tema, serieClave) => (textoHueco) => {
    if (narrativaHtml) {
      const serie = serieClave ? series[serieClave] : null;
      const fuente = serie ? parrafoFuenteOoxml(serie.fuente, serie.fuenteUrl) : '';
      return parrafosOoxmlDesdeHtml(narrativaHtml) + fuente;
    }
    if (textoHueco.trim().length < UMBRAL_HUECO_CON_PROSA) return null;
    return `<w:p><w:r><w:t xml:space="preserve">${escaparXml(marcadorTemaMacroPendiente(tema, year))}</w:t></w:r></w:p>`;
  };

  reemplazarPorHitos(
    doc,
    [tituloMundial, 'PIB Mundial', 'Inflación Global', 'por Región/País', tituloColombia],
    [
      primerHueco(narrativa.mundial, 'mundial'),
      temaHueco(narrativa.inflacionMundial, 'la inflación mundial', 'inflacion_global'),
      temaHueco(narrativa.proyeccionMundial, 'la proyección de crecimiento mundial', 'crecimiento_por_region'),
    ],
    avisos,
    tituloMundial
  );

  reemplazarPorHitos(
    doc,
    [
      tituloColombia, 'PIB en Colombia', 'Inflación en Colombia', 'Intervención del Banco',
      'Tasa Representativa del Mercado', 'Desempleo en Colombia', 'Análisis del Sector',
    ],
    [
      primerHueco(narrativa.colombia, 'colombiana'),
      temaHueco(narrativa.inflacionColombia, 'la inflación en Colombia', 'inflacion_colombia'),
      temaHueco(narrativa.politicaMonetaria, 'la política monetaria', 'tasa_intervencion'),
      temaHueco(narrativa.tasaCambio, 'la tasa de cambio (TRM)', 'trm_promedio'),
      temaHueco(narrativa.mercadoLaboral, 'el mercado laboral en Colombia', 'desempleo_colombia'),
      temaHueco(narrativa.conclusiones, 'las conclusiones del panorama económico', null),
    ],
    avisos,
    tituloColombia
  );

  if (!narrativa.mundial && Array.isArray(avisos)) avisos.push('narrativa de ' + tituloMundial);
  if (!narrativa.colombia && Array.isArray(avisos)) avisos.push('narrativa de ' + tituloColombia);

  return doc.xml;
}

/** Mismo texto que `marcadorApartadoPendiente`, pero para un tema puntual de III.C
 *  en vez de todo el apartado de III.A/III.B. */
function marcadorTemaSectorPendiente(tema, year) {
  return '[Actualizar con el análisis del ' + tema + ' del sector para el año gravable ' +
    year + ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]';
}

/** Fila de la tabla "Datos Clave del Sector", en la forma que espera `generarTablaOoxml`. */
function filasDatosClaveSector(datosClaveTabla) {
  return (datosClaveTabla || []).map((f) => [
    String(f.indicador || ''),
    f.valorAnterior ? String(f.valorAnterior) : '—',
    String(f.valorActual || ''),
  ]);
}

/**
 * Reemplaza los cuatro bloques de prosa de III.C (Comportamiento, Importaciones y
 * exportaciones, Proyección, Conclusiones y Perspectivas) y la tabla "Datos Clave del
 * Sector", localizándolos por sus encabezados — mismo mecanismo de
 * `actualizarApartadosMacroOoxml`, aplicado a III.C, que hoy no se toca en absoluto:
 * depende enteramente del marcado con IA, y esta plantilla no lo trajo marcado.
 *
 * @param {string} xml
 * @param {object|null} analisisSector  el documento `analisisSector/{claveActividad}`.
 * @param {object} estudio
 * @param {number} year
 * @param {string[]} [avisos]
 * @returns {string}
 */
export function actualizarApartadoSectorialOoxml(xml, analisisSector, estudio, year, avisos) {
  const entrada = analisisSector && analisisSector.porAnio && analisisSector.porAnio[String(year)];
  console.log('[docxRelleno] actualizarApartadoSectorialOoxml: año ' + year
    + ', corrida de sector para este año: ' + (entrada ? 'sí (' + (entrada.tituloSector || 'sin título') + ')' : 'no (marcador)'));
  const doc = sustituidorDeTablas(xml, null);

  const titulos = [
    'Análisis del Sector',
    'Comportamiento del Sector',
    'Datos Clave del Sector',
    'Importaciones y exportaciones del sector',
    '¿Qué se proyecta para el sector',
    'Conclusiones y Perspectivas',
    'ANÁLISIS ECONÓMICO',
  ];

  const bloque = (narrativaHtml, tema) => () => (
    narrativaHtml
      ? parrafosOoxmlDesdeHtml(narrativaHtml)
      : `<w:p><w:r><w:t xml:space="preserve">${escaparXml(marcadorTemaSectorPendiente(tema, year))}</w:t></w:r></w:p>`
  );

  /** Igual que `bloque`, pero cuando NO hay narrativa lista, el marcador de pendiente
   *  solo se fabrica si el hueco traía prosa sustancial que retirar — el hueco de
   *  entrada de III.C (antes de "Comportamiento del Sector") puede venir vacío en
   *  plantillas cuyo encabezado de sección no trae párrafo introductorio propio, y sin
   *  este resguardo se le fabricaría un marcador donde hoy no hay nada. El umbral NO
   *  aplica cuando SÍ hay narrativa: insertar contenido real y verificado no es
   *  "fabricar", así que se inserta siempre que esté disponible, sin importar cuánto
   *  medía el hueco viejo (mismo criterio asimétrico que `temaHueco`). */
  const bloqueConUmbral = (narrativaHtml, tema) => (textoHueco) => {
    if (!narrativaHtml && textoHueco.trim().length < UMBRAL_HUECO_CON_PROSA) return null;
    return bloque(narrativaHtml, tema)();
  };

  reemplazarPorHitos(
    doc,
    titulos,
    [
      bloqueConUmbral(entrada && entrada.narrativa.introduccion, 'contexto introductorio'),
      bloque(entrada && entrada.narrativa.comportamiento, 'comportamiento del sector'),
      () => null,
      bloque(entrada && entrada.narrativa.comercioExterior, 'comercio exterior del sector'),
      bloque(entrada && entrada.narrativa.proyeccion, 'proyección del sector'),
      bloque(entrada && entrada.narrativa.conclusiones, 'conclusiones del sector'),
    ],
    avisos,
    'Análisis del Sector'
  );

  if (entrada && entrada.datosClaveTabla && entrada.datosClaveTabla.length) {
    const encontrada = doc.reemplazar('Datos Clave del Sector', () => generarTablaOoxml(
      'Datos Clave del Sector de la Industria ' + (entrada.tituloSector || '') + ' en Colombia (' +
        (year - 1) + ' vs. ' + year + ')',
      ['Indicador Clave', String(year - 1), String(year)],
      filasDatosClaveSector(entrada.datosClaveTabla),
      null
    ));
    console.log('[docxRelleno] tabla "Datos Clave del Sector": '
      + (encontrada ? 'regenerada con ' + entrada.datosClaveTabla.length + ' fila(s)' : 'NO se encontró en la plantilla'));
  } else {
    console.log('[docxRelleno] tabla "Datos Clave del Sector": sin datos de la corrida de este año, se deja como está');
    if (Array.isArray(avisos)) avisos.push('tabla de Datos Clave del Sector');
  }

  return doc.xml;
}

/** Reemplaza quirúrgicamente las ocho tablas de tendencias económicas en el OOXML del documento. */
export function actualizarTablasMacroOoxml(xml, datosMacro, year, avisos) {
  const doc = sustituidorDeTablas(xml, avisos);

  /* Qué tabla es cada una y con qué contenido lo describe `tablasMacroInforme`, que es de
     donde las toma también la ruta de plantilla PDF. Antes la definición de las ocho vivía
     aquí, y llevarlas a la otra ruta habría significado copiarlas con sus series y sus
     fuentes: dos definiciones de la misma tabla que se separan en la primera corrección.

     Estas ocho no llevan «Tabla N.» en la plantilla, así que la numeración nunca fue su
     problema; lo que sí las alcanzaba es el otro defecto del patrón anterior: el título
     tenía que estar contiguo en el XML, y Word lo parte en varios runs. Por eso pasan por
     el mismo localizador, que compara sobre el texto ya reconstruido. */
  tablasMacroInforme(datosMacro, year).forEach((t) => {
    doc.reemplazar(t.nombre, () => generarTablaOoxml(t.titulo, t.cabeceras, t.filas, t.fuente));
  });

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
  for (; ;) {
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
    for (; ;) {
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

/* Si justo después de `cursor` viene una tabla —saltando párrafos vacíos, marcas de
   libro y avisos del corrector, igual que `localizarBloqueTabla`—, el índice donde
   termina esa tabla; si no, -1. */
function finDeTablaInmediata(texto, cursor) {
  let c = cursor;
  for (; ;) {
    const resto = texto.slice(c);
    const hueco = /^\s*(?:<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?<\/w:p>|<w:bookmarkStart[^>]*\/?>|<w:bookmarkEnd[^>]*\/?>|<w:proofErr[^>]*\/?>)/.exec(resto);
    if (!hueco) break;
    if (textoPlanoOoxml(hueco[0]).trim()) break;
    c += hueco[0].length;
  }
  const tras = /^\s*<w:tbl(?:\s[^>]*)?>/.exec(texto.slice(c));
  if (!tras) return -1;
  const inicioTabla = c + tras[0].indexOf('<w:tbl');
  return finDeTabla(texto, inicioTabla);
}

/**
 * Delimita un bloque de párrafos entre un encabezado de inicio y el primero de una
 * lista de encabezados de fin — pensado para reemplazar la PROSA de un apartado sin
 * tocar las tablas que le siguen (esas ya las localiza `localizarBloqueTabla`).
 *
 * `inicio` cae en el propio párrafo de `tituloInicio` (se conserva su encabezado en el
 * reemplazo) y `fin` justo antes del párrafo de fin encontrado, que queda intacto.
 *
 * @param {string} xml
 * @param {string} tituloInicio
 * @param {string[]} titulosFin
 * @returns {{inicio:number, fin:number}|null}
 */
export function localizarBloqueProsa(xml, tituloInicio, titulosFin) {
  const texto = String(xml || '');
  const claveInicio = claveTitulo(tituloInicio);
  const clavesFin = (titulosFin || []).map(claveTitulo).filter(Boolean);
  if (!claveInicio || !clavesFin.length) return null;

  const rxParrafo = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let p;
  let inicio = null;
  while ((p = rxParrafo.exec(texto)) !== null) {
    /* La Tabla de Contenido repite el mismo texto de cada encabezado en un párrafo con
       un campo PAGEREF, antes de que aparezca el encabezado real del cuerpo. Sin este
       filtro, `inicio` caía en la entrada del TOC —que nunca lleva la prosa del
       apartado— y todo lo que hay entre el TOC y la primera tabla (el índice entero)
       se tomaba como si fuera la prosa a reemplazar. */
    if (p[0].includes('PAGEREF')) continue;
    const clave = claveTitulo(textoPlanoOoxml(p[0]));
    if (inicio === null) {
      if (clave.includes(claveInicio)) inicio = p.index;
      continue;
    }
    if (clavesFin.some((c) => clave.includes(c))) {
      return { inicio, fin: p.index };
    }
  }
  return null;
}

/**
 * Los `titulos`, en el orden en que deben aparecer en el documento, con dónde empieza
 * y dónde termina el párrafo de cada uno. Sirve para delimitar TODOS los huecos entre
 * un encabezado y el siguiente en un solo recorrido — `localizarBloqueProsa` resuelve
 * un único hueco; esta es su generalización a una cadena de encabezados.
 *
 * Se exige que aparezcan en ESE orden: en cuanto se encuentra el título `i`, la
 * búsqueda del título `i+1` empieza después de él, nunca antes ni desde el principio
 * del documento — así una tabla que se llame igual que un encabezado posterior no se
 * confunde con él.
 *
 * @param {string} xml
 * @param {string[]} titulos
 * @returns {Array<{inicio:number, finPropio:number}|null>}
 */
export function localizarHitos(xml, titulos) {
  const texto = String(xml || '');
  const claves = (titulos || []).map(claveTitulo);
  const resultado = new Array(claves.length).fill(null);
  if (!claves.length) return resultado;

  const rxParrafo = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let objetivo = 0;
  let m;
  while (objetivo < claves.length && (m = rxParrafo.exec(texto)) !== null) {
    if (m[0].includes('PAGEREF')) continue;
    const textoParrafo = textoPlanoOoxml(m[0]);
    /* Un párrafo de prosa puede mencionar de pasada el nombre de un hito posterior
       -"la inflación global ha venido descendiendo..."- y un includes() sobre
       texto largo lo confundiría con el título real. Los títulos de esta lista
       (encabezados de apartado, nombres de tabla) siempre son cortos; se descarta
       cualquier candidato que no lo sea y se sigue buscando uno más adelante. */
    if (textoParrafo.length > 160) continue;
    const clave = claveTitulo(textoParrafo);
    if (clave.includes(claves[objetivo])) {
      /* Si el hito es el título de una tabla —caso normal para los nombres de
         `tablasMacroInforme`—, el hueco siguiente empieza DESPUÉS de la tabla entera,
         no justo tras el título: si no, la tabla completa (y su "FUENTE:") cae dentro
         del hueco que se reemplaza, y `actualizarTablasMacroOoxml` deja de encontrar
         el título para regenerarla en el siguiente paso. */
      let finPropio = m.index + m[0].length;
      const finTabla = finDeTablaInmediata(texto, finPropio);
      if (finTabla >= 0) finPropio = finTabla;
      resultado[objetivo] = { inicio: m.index, finPropio };
      objetivo += 1;
    }
  }
  return resultado;
}

/**
 * Reemplaza, uno por uno, los huecos entre una lista ordenada de encabezados. Cada
 * hueco es el texto entre el final del párrafo de un hito y el inicio del párrafo del
 * siguiente — el propio encabezado nunca se toca.
 *
 * @param {{aplicar:(f:(s:string)=>string)=>void}} doc  un `sustituidorDeTablas`.
 * @param {string[]} titulos
 * @param {Array<(textoHueco:string)=>(string|null)>} contenidos  longitud
 *        `titulos.length - 1`; recibe el texto plano ya existente en ese hueco (para
 *        decidir si hace falta tocarlo) y devuelve el OOXML nuevo, o `null` para
 *        dejarlo como está.
 * @param {string[]} [avisos]
 * @param {string} [nombreParaAvisos]
 */
export function reemplazarPorHitos(doc, titulos, contenidos, avisos, nombreParaAvisos) {
  doc.aplicar((actual) => {
    const hitos = localizarHitos(actual, titulos);
    console.log('[docxRelleno] ' + (nombreParaAvisos || '') + ': hitos encontrados '
      + hitos.filter(Boolean).length + '/' + titulos.length + ' (' + titulos.join(' → ') + ')');
    let salida = actual;
    for (let i = contenidos.length - 1; i >= 0; i -= 1) {
      const hitoActual = hitos[i];
      const hitoSiguiente = hitos[i + 1];
      if (!hitoActual || !hitoSiguiente) {
        const aviso = (nombreParaAvisos || '') + ': no se encontró "' + titulos[i] + '" o "' + titulos[i + 1] + '"';
        console.warn('[docxRelleno] ' + aviso);
        if (Array.isArray(avisos)) avisos.push(aviso);
        continue;
      }
      const textoHueco = textoPlanoOoxml(salida.slice(hitoActual.finPropio, hitoSiguiente.inicio));
      const nuevo = contenidos[i](textoHueco);
      if (nuevo === null) {
        console.log('[docxRelleno] hueco "' + titulos[i] + '" → "' + titulos[i + 1] + '": sin tocar');
        continue;
      }
      console.log('[docxRelleno] hueco "' + titulos[i] + '" → "' + titulos[i + 1] + '": reemplazado ('
        + textoHueco.length + ' caracteres viejos → ' + nuevo.length + ' nuevos)');
      salida = salida.slice(0, hitoActual.finPropio) + nuevo + salida.slice(hitoSiguiente.inicio);
    }
    return salida;
  });
}

/** Texto de un fragmento de HTML de narrativa (sin sus etiquetas), con las entidades
 *  básicas deshechas — misma lista que `escaparXml` invierte, porque este texto vuelve
 *  a pasar por `escaparXml` al escribirse en el run. */
function textoPlanoDeNarrativa(fragmento) {
  return String(fragmento || '')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * La narrativa de III.A/III.B que redacta Claude (HTML simple: `<p>`, `<strong>`, `<a>`)
 * convertida a párrafos OOXML, para insertarla en el `.docx` sin depender del marcado.
 *
 * Solo entiende `<strong>` (negrita) y `<a>` (se aplana a su texto): es lo único que el
 * prompt de redacción produce (`functions/analisisMercadoPrompts.js`, "Cada apartado en
 * HTML, como una serie de párrafos <p>...</p>, sin encabezados ni tablas").
 *
 * @param {string} html
 * @returns {string} OOXML, una cadena vacía si `html` no trae ningún `<p>`.
 */
export function parrafosOoxmlDesdeHtml(html) {
  const bloques = String(html || '').match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
  return bloques.map((bloque) => {
    const interior = bloque.replace(/^<p\b[^>]*>/i, '').replace(/<\/p>\s*$/i, '');
    const runs = [];
    const rx = /<strong>([\s\S]*?)<\/strong>|([^<]+(?:<a\b[^>]*>[\s\S]*?<\/a>[^<]*)*)/gi;
    let m;
    while ((m = rx.exec(interior)) !== null) {
      if (m[1] !== undefined) {
        const texto = textoPlanoDeNarrativa(m[1]);
        if (texto) runs.push(`<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r>`);
      } else if (m[2] !== undefined) {
        const texto = textoPlanoDeNarrativa(m[2]);
        if (texto) runs.push(`<w:r><w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r>`);
      }
    }
    return `<w:p>${runs.join('')}</w:p>`;
  }).join('');
}

/* Un `<w:t>` que es SOLO una cifra: «2.05%», «-3.001%», «1,780 %». Es lo que Word deja
   cuando la plantilla escribe un número entre paréntesis dentro de una frase, y es lo que
   permite cambiarlo sin tocar una letra del resto. */
const RX_SOLO_CIFRA = /^\s*\(?\s*-?[\d]+(?:[.,][\d]+)?\s*%\s*\)?\s*$/;

/**
 * Actualiza las cifras del párrafo que describe una tabla, conservando su redacción.
 *
 * Las tablas del informe se rehacen con los datos del estudio, pero el párrafo que las
 * comenta seguía siendo el de la plantilla: la tabla decía que el rango va de 1,780 % a
 * 8,800 % y la frase debajo hablaba de -3,001 % y 6,418 %, cifras del informe del año
 * anterior. En un documento que se radica, esa contradicción la ve quien lo revise.
 *
 * Se sustituyen SOLO los números y en el orden en que los espera `cifras`, dejando intactas
 * la redacción, la puntuación y el formato: cada valor vive en su propio `<w:t>`, así que
 * cambiarlo no toca los runs vecinos.
 *
 * Si el párrafo no trae exactamente tantas cifras como se esperan, no se toca nada y se
 * anota el aviso. Es deliberado: una frase con más números de los previstos —o con ellos en
 * otro orden— se corrompería en silencio, y publicar una cifra en el sitio equivocado es
 * peor que dejar la de la plantilla, que al menos se nota que no cuadra con la tabla.
 *
 * @param {string} xml
 * @param {string|string[]} nombres  nombre de la tabla, como lo busca `localizarBloqueTabla`.
 * @param {string[]} cifras  los valores ya formateados, en el orden en que aparecen.
 * @param {string[]} [avisos]
 * @returns {string} el XML, con la prosa actualizada donde se pudo.
 */
export function actualizarProsaTrasTabla(xml, nombres, cifras, avisos) {
  let salida = String(xml || '');
  const esperadas = (cifras || []).filter((c) => c !== null && c !== undefined);
  if (esperadas.length !== (cifras || []).length || !esperadas.length) return salida;

  /* Todas las apariciones de la tabla: el rango intercuartil sale dos veces en el informe
     —en el resumen y en el desarrollo— y las dos llevan su propia frase debajo. */
  for (let ocurrencia = 0; ocurrencia < 6; ocurrencia += 1) {
    const bloque = localizarBloqueTabla(salida, nombres, { ocurrencia });
    if (!bloque) break;
    /* `localizarBloqueTabla` devuelve la última cuando se le piden más de las que hay, así
       que sin esto la misma tabla se procesaría en bucle. */
    if (ocurrencia > 0) {
      const previo = localizarBloqueTabla(salida, nombres, { ocurrencia: ocurrencia - 1 });
      if (previo && previo.inicio === bloque.inicio) break;
    }

    /* Entre la tabla y su descripción hay más párrafos: la línea de la fuente que emite
       `generarTablaOoxml` («Información suministrada por…»), y los vacíos de la plantilla.
       Quedarse con el primero que tenga texto tomaba la fuente por descripción, no
       encontraba las cifras y se iba sin tocar nada ni avisar. Así que se examinan unos
       cuantos y se elige el primero que traiga EXACTAMENTE las cifras que se esperan. */
    const rxParrafo = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
    rxParrafo.lastIndex = bloque.fin;
    let parrafo = null;
    let conCifra = [];
    let vistosConCifras = 0;
    for (let m = rxParrafo.exec(salida), n = 0; m && n < 6; m = rxParrafo.exec(salida), n += 1) {
      const trozos = [...m[0].matchAll(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g)];
      const cifras = trozos.filter((t) => RX_SOLO_CIFRA.test(t[2]));
      if (cifras.length) vistosConCifras += 1;
      if (cifras.length === esperadas.length) { parrafo = m; conCifra = cifras; break; }
      /* Una tabla nueva antes de encontrarla: la descripción de ESTA no está. */
      if (/<w:tbl[ >]/.test(salida.slice(rxParrafo.lastIndex, rxParrafo.lastIndex + 40))) break;
    }
    if (!parrafo) {
      if (Array.isArray(avisos) && vistosConCifras) {
        avisos.push(`la descripción de «${bloque.titulo || nombres}» no trae las `
          + `${esperadas.length} cifras que se esperaban, así que se dejó como estaba`);
      }
      continue;
    }

    /* De atrás hacia adelante: cada sustitución mueve los índices de lo que va después. */
    let nuevo = parrafo[0];
    for (let i = conCifra.length - 1; i >= 0; i -= 1) {
      const t = conCifra[i];
      /* Se conservan los paréntesis que la plantilla ponga dentro del propio `<w:t>`. */
      const abre = /^\s*\(/.test(t[2]) ? '(' : '';
      const cierra = /\)\s*$/.test(t[2]) ? ')' : '';
      nuevo = nuevo.slice(0, t.index) + t[1] + escaparXml(abre + esperadas[i] + cierra) + t[3]
        + nuevo.slice(t.index + t[0].length);
    }
    salida = salida.slice(0, parrafo.index) + nuevo + salida.slice(parrafo.index + parrafo[0].length);
  }

  return salida;
}

/* El año que la conclusión del rango menciona junto a las cifras del estudio: «…del margen
   operacional ajustado durante el 2024». Venía de la plantilla, así que el informe se
   radicaba con el año del contribuyente anterior al lado de cifras del actual.

   Se ancla en las palabras que rodean al año y NO en la posición respecto a la tabla: ese
   párrafo está a un salto de página de ella —carácter 501.297 en el informe del cliente— y la
   frase viaja completa dentro de un mismo `<w:t>`, así que cambiar el año ahí no toca los
   runs vecinos ni el formato.

   Solo ese año. Los demás del documento se quedan como están: los encabezados del ANEXO B
   son los estados financieros disponibles de las comparables, del año anterior, y las
   fuentes citadas llevan su propia fecha. */
const RX_ANIO_CONCLUSION = /(ajustado\s+durante\s+el\s+)(20\d{2})/g;

export function actualizarAnioConclusionRango(xml, anioGravable, avisos) {
  const gravable = Number(anioGravable);
  if (!Number.isInteger(gravable) || gravable < 2000 || gravable > 2100) {
    if (Array.isArray(avisos)) {
      avisos.push('no se pudo leer el año gravable ("' + String(anioGravable) + '"), así que el '
        + 'año de la conclusión del rango se queda como lo trajo la plantilla');
    }
    return String(xml || '');
  }

  let cambiados = 0;
  const salida = String(xml || '').replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g, (todo, abre, contenido, cierra) => {
    const hecho = contenido.replace(RX_ANIO_CONCLUSION, (coincidencia, antes, anio) => {
      if (Number(anio) === gravable) return coincidencia;
      cambiados += 1;
      return antes + gravable;
    });
    return hecho === contenido ? todo : abre + hecho + cierra;
  });

  if (!cambiados && Array.isArray(avisos)) {
    avisos.push('no se encontró el año en la conclusión del rango («…ajustado durante el AÑO»): '
      + 'si tu plantilla lo redacta de otro modo, revísalo a mano antes de radicar');
  }
  return salida;
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
    /* Para lo que no es sustituir una tabla entera —la prosa que la describe, por ejemplo—.
       Existe porque `out` es privado y solo había getter: un `xml = transformar(xml)` en el
       generador modificaba una variable local que nadie volvía a leer, ya que al final se
       devuelve `doc.xml`. El cambio se descartaba en silencio, sin fallar ni avisar. */
    aplicar(transformar) {
      out = transformar(out);
    },
    get xml() { return out; },
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

  /* Las filas del rango y su cálculo viven en `tablasInforme.js`, que es de donde las toma
     también la ruta de plantilla PDF (`tablasHtmlInforme.js`). Antes se calculaban aquí, y
     al añadir esa segunda ruta el cálculo habría quedado duplicado: dos sitios donde
     computar los percentiles del mismo estudio es la forma de acabar publicando dos rangos
     distintos, que es lo que ya pasó cuando había dos implementaciones del cuartil. */
  const rango = filasRangoIntercuartil(estudio);
  const tPLI = rango.tPLI;

  /* La versión horizontal del rango (bloque 5) publica solo los percentiles ajustados. */
  const ajustadoDe = (etiqueta) => {
    const f = rango.filas.find((x) => x.etiqueta === etiqueta);
    return f ? f.ajustado : null;
  };
  const p25Ajustado = ajustadoDe(ETIQUETAS_RANGO.p25);
  const medAjustado = ajustadoDe(ETIQUETAS_RANGO.med);
  const p75Ajustado = ajustadoDe(ETIQUETAS_RANGO.p75);

  const pStr = (v) => (v === null || v === undefined ? '—' : pctf(v));

  /* Las Tablas 1 y 2 dicen lo mismo aquí y en la ruta de plantilla PDF, así que sus filas
     salen de `tablasOperaciones.js` y no se arman dos veces. Ahí vive también el motivo por
     el que el código de operación puede ser «—»: el que había antes en este archivo lo
     inventaba, devolvía '07' —el de END GAME 2024— para cualquier tipo sin paréntesis. */
  /* `titulo` cuando lo trae y `nombre` si no: hay tablas cuyo rótulo es más largo que el
     nombre con el que se localizan —«Método de Precios de Transferencia Aplicable» frente a
     «Método de Precios de Transferencia»— o que llevan el año gravable dentro. */
  const emitir = (b, t) => generarTablaOoxml(
    tituloDe(b, t.titulo || t.nombre), t.encabezados, t.filas, t.fuente
  );

  // 1. Operaciones de Ingreso/Egreso
  reemplazar(
    ['Operaciones de Ingreso', 'Operaciones de Egreso'],
    (b) => emitir(b, filasOperacionesDeIngreso(estudio)),
    { numeros: [1] }
  );

  // 2. Operación analizar
  reemplazar(
    'Operación analizar',
    (b) => emitir(b, filasOperacionAnalizar(estudio)),
    { numeros: [2] }
  );

  /* 3. Transacciones Inter compañía. La plantilla la trae dos veces —una en la
     descripción del vinculado y otra en el análisis— con la misma cabecera y números
     que cambian según el informe (3 y 12 en la del cliente). Se sustituyen las dos
     por ocurrencia, sin depender de esos números. */
  {
    const t3 = filasTransaccionesIntercompania(estudio);
    const tablaTx = (b) => generarTablaOoxml(
      tituloDe(b, t3.nombre), t3.encabezados, t3.filas, escaparXml(t3.fuente)
    );
    /* De atrás hacia adelante: sustituir la primera desplaza los índices de la
       segunda, y el localizador trabaja sobre posiciones del XML. */
    reemplazar('Transacciones Inter compañía', tablaTx, { ocurrencia: 1 });
    reemplazar('Transacciones Inter compañía', tablaTx, { ocurrencia: 0 });
  }

  // 4. Método de Precios de Transferencia Aplicable
  reemplazar(
    'Método de Precios de Transferencia',
    (b) => emitir(b, filasMetodoAplicable(estudio)),
    { numeros: [4] }
  );

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
  reemplazar(
    'Composición accionaria',
    (b) => emitir(b, filasComposicionAccionaria(estudio)),
    { numeros: [6] }
  );

  // 7. Compañías vinculadas al cierre del año gravable
  reemplazar(
    'Compañías vinculadas',
    (b) => emitir(b, filasCompaniasVinculadas(estudio)),
    { numeros: [8] }
  );

  // 8. Criterios de vinculación económica
  reemplazar(
    'Criterios de vinculación',
    (b) => emitir(b, filasCriteriosVinculacion(estudio)),
    { numeros: [9] }
  );

  // 9. Tabla 10. Activos a 31 de diciembre del año gravable
  reemplazar(
    'Activos a 31 de diciembre',
    (b) => emitir(b, filasActivos(estudio)),
    { numeros: [10] }
  );

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
    const filas17 = filasMuestraComparables(estudio).map((f) => [
      String(f.numero), f.nombre, f.ambito,
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
    const filas18_20 = rango.filas.map((f) => [
      wrap(f.etiqueta), pStr(f.noAjustado), pStr(f.ajustado),
    ]);
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

  /* La frase que comenta el rango, debajo de la tabla, y el año que menciona.

     Primero por las palabras que introducen cada cifra (`prosaRangoInforme.js`), que es la
     misma función que atiende la ruta de plantilla PDF: así las dos rutas producen la misma
     frase, sea la plantilla base un .docx o un PDF, y el orden en que la redacción liste los
     cuartiles deja de importar.

     Y sólo si eso no reconoció nada, por POSICIÓN, que es lo que se hacía: la primera cifra es
     el percentil 25, la segunda el 75 y la tercera la mediana, el orden de la redacción de la
     plantilla de este cliente («…se ubica entre el percentil 25 (X) y (Y) percentil 75, la
     mediana con (Z)»). Se conserva como respaldo porque cubre redacciones donde la cifra no va
     detrás de su rótulo, y porque es la que está probada contra el .docx real. */
  const antesDeProsa = doc.xml;
  doc.aplicar((x) => actualizarProsaRango(x, estudio, avisos, { rxParrafo: PARRAFO_OOXML }));
  if (doc.xml === antesDeProsa) {
    doc.aplicar((x) => actualizarProsaTrasTabla(
      x, 'Rango Intercuartil',
      [pStr(p25Ajustado), pStr(p75Ajustado), pStr(medAjustado)],
      avisos,
    ));
    doc.aplicar((x) => actualizarAnioConclusionRango(x, year, avisos));
  }

  /* 13. Margen Operacional Compañías Comparables.

     Se localiza por el nombre COMPLETO, no por «Margen Operacional» a secas. La clave corta
     casa por inclusión con la prosa del propio informe: en la plantilla de End Game, el
     párrafo «Para el análisis del método TU se consideró que el indicador financiero de
     rentabilidad más apropiado es el Margen Operacional…» va seguido de la tabla de
     definiciones del método, y está 79 000 caracteres ANTES del rótulo verdadero. Mientras la
     plantilla numere la tabla como la 19 el desempate de `numeros` lo tapa; en cuanto un
     cliente la renumera, `numeros` no filtra nada, gana el primer candidato por posición y el
     generador sustituye la tabla de definiciones mientras la de márgenes se queda con las
     cifras del informe anterior —el fallo que se reportó el 2026-08-11—.

     El nombre de la tabla es lo único estable: el prefijo se renumera al reordenar el informe,
     y hay plantillas que lo rotulan sin número. Por eso se busca solo por el nombre. */
  {
    const generarTabla19 = (b) => {
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
    };
    /* Sin `numeros`: el prefijo «Tabla N.» cambia de una plantilla a otra —y hay plantillas que
       rotulan la tabla sin número—, así que el número no es criterio de nada. El nombre
       completo, en cambio, es único en el documento: se buscó sobre el word/document.xml de End
       Game y de los trece párrafos que mencionan «margen operacional» solo uno tiene esa clave.

       Tampoco se cae al nombre corto cuando no aparece. Con la clave corta el único candidato
       que queda es la prosa, y sustituir ahí destruye la tabla de definiciones del método sin
       tocar la de márgenes: dos tablas mal en vez de una. Si el rótulo no está, `reemplazar`
       anota la tabla en los avisos y el panel lo dice antes de radicar, que es lo que este
       mecanismo existe para hacer. */
    reemplazar('Margen Operacional Compañías Comparables', generarTabla19);
  }

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
  xml = actualizarApartadosMacroOoxml(xml, datosMacro, year, avisosTablas);
  xml = actualizarApartadoSectorialOoxml(xml, analisisSector, estudio, year, avisosTablas);
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

/* Cabeceras del ANEXO C, tal como las trae la plantilla. Las del resumen son las MISMAS
   que las de la Tabla 16 —el anexo es el respaldo nominal de esa tabla— y las del listado
   son las que la plantilla escribe encima de cada grupo de compañías. */
const CAB_RESUMEN_ANEXO_C = ['FILTRO APLICADO INTERNACIONALES', 'FILTROS APLICADO', 'N° POR FILTRO'];
const CAB_LISTADO_ANEXO_C = ['Nº', 'NOMBRE DE LA COMPAÑÍA', 'FILTRO'];

/**
 * Reescribe el ANEXO C —matriz de rechazo— con el universo del estudio.
 *
 * La ruta .docx no lo llenaba: el anexo salía tal cual de la plantilla, así que un informe
 * de 2025 se radicaba con la matriz del año anterior —sus conteos, sus letras y sus
 * compañías—, contradiciendo a la Tabla 16 que sí se rellena unas páginas antes. La ruta
 * HTML sí lo hacía (`anexoCHtml.js`), de modo que el mismo estudio salía distinto según
 * por dónde se generara.
 *
 * Los grupos, sus letras y los conteos se le piden a `anexoCHtml.js`, que es de donde los
 * toma también la otra ruta: aquí solo se los pasa a OOXML.
 *
 * Sin matriz en el estudio NO se toca nada. Vaciar el anexo por falta de datos sería peor
 * que dejarlo: el documento perdería el respaldo sin que nadie lo note, mientras que la
 * matriz vieja al menos se ve. Se devuelve el aviso para que el generador lo publique.
 *
 * @param {PizZip} zip
 * @param {object} estudio
 * @returns {{reescrito:boolean, grupos:number, aviso:string|null}}
 */
export function insertarAnexoC(zip, estudio) {
  const study = estudio || {};
  const grupos = gruposDelAnexoC(study);
  if (!grupos.length) {
    return {
      reescrito: false,
      grupos: 0,
      aviso: NOMBRE_ANEXO_C + ': el estudio no trae la matriz del universo evaluado, así que el '
        + 'anexo se deja como estaba. Abre el paso 3 del motor de comparables con el cribado de '
        + 'Capital IQ cargado para que se calcule.',
    };
  }

  const xml = zip.file(RUTA_DOC).asText();

  /* La ÚLTIMA aparición, no la primera: «ANEXO C» sale también en la tabla de contenidos,
     que va al principio del documento. Cortar ahí se llevaría por delante el informe
     entero. */
  const rx = /<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?ANEXO\s+C(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/gi;
  let inicio = -1;
  for (let m = rx.exec(xml); m; m = rx.exec(xml)) inicio = m.index;
  if (inicio < 0) {
    return { reescrito: false, grupos: 0, aviso: NOMBRE_ANEXO_C };
  }

  /* El anexo cierra el documento, pero `<w:sectPr>` —el tamaño de página y los márgenes del
     cuerpo— vive al final y hay que conservarlo: sin él Word abre el archivo con la
     configuración por defecto y la maquetación del informe se pierde. */
  const sect = xml.indexOf('<w:sectPr', inicio);
  const fin = sect >= 0 ? sect : xml.lastIndexOf('</w:body>');

  const universo = Number(study.matrizRechazo && study.matrizRechazo.universo) || 0;

  let nuevo = '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:keepNext/></w:pPr>'
    + `<w:r><w:rPr><w:b/></w:rPr><w:t>${escaparXml(NOMBRE_ANEXO_C)}</w:t></w:r></w:p>`;
  nuevo += '\n' + generarTablaOoxml('', CAB_RESUMEN_ANEXO_C, filasResumenAnexoC(grupos, universo));
  grupos.forEach((g) => {
    const filas = g.companias.map((nombre, i) => [String(i + 1), nombre, g.letra]);
    nuevo += '\n' + generarTablaOoxml(tituloDeGrupoAnexoC(g), CAB_LISTADO_ANEXO_C, filas);
  });

  zip.file(RUTA_DOC, xml.slice(0, inicio) + nuevo + xml.slice(fin));
  return { reescrito: true, grupos: grupos.length, aviso: null };
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
  /* TODAS las comparables de la muestra, tengan o no estado financiero cargado. El filtro
     por `eeffArchivo` dejaba fuera del anexo a las que faltaban, y el anexo se radicaba con
     los bloques del contribuyente anterior en su lugar. Las que no traen documento salen con
     su descripción y un párrafo que dice qué falta: un hueco señalado se completa, unas
     cifras del año pasado se radican sin que nadie lo note. */
  const comparables = ((estudio && estudio.comparables) || []).filter((c) => c && c.name);
  if (!comparables.length) return { insertadas: 0 };

  let xml = zip.file(RUTA_DOC).asText();

  /* La sección del ANEXO B en el CUERPO, que es la ÚLTIMA aparición y no la primera: el
     título sale también en la tabla de contenidos, al principio del documento. Con la
     primera, `inicioB` y `finB` caían los dos dentro del índice —a 300 caracteres uno del
     otro— y este relleno escribía las descripciones y los estados financieros ahí,
     destruyendo la entrada del índice y dejando el ANEXO B de verdad con lo que trajera la
     plantilla: el del año anterior. Se veía como si el anexo no se generara. */
  const rxB = /<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?ANEXO B(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/gi;
  const rxC = /<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?ANEXO C(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/gi;

  let inicioB = -1;
  for (let m = rxB.exec(xml); m; m = rxB.exec(xml)) inicioB = m.index;
  if (inicioB < 0) return { insertadas: 0 };

  /* Y el corte, en la primera mención del ANEXO C que venga DESPUÉS del cuerpo del B:
     las del índice quedan detrás y tomarlas dejaría `finB` por delante de `inicioB`. */
  let finB = xml.length;
  for (let m = rxC.exec(xml); m; m = rxC.exec(xml)) {
    if (m.index > inicioB) { finB = m.index; break; }
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
      /* En rojo y con el nombre: es un hueco que hay que ver antes de radicar, no una nota
         al pie. Sustituye a lo que había antes en su lugar —el bloque de esta comparable en
         el informe del contribuyente anterior—. */
      nuevoXmlB += `\n<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:color w:val="991B1B"/><w:b/></w:rPr>`
        + `<w:t>${escaparXml('[PENDIENTE] Falta el estado financiero de ' + c.name
          + '. Cárgalo en el paso 4 del motor de comparables y vuelve a generar el informe.')}</w:t></w:r></w:p>`;
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

  /* Después del ANEXO B: aquel delimita su sección buscando dónde empieza el ANEXO C, así
     que reescribir el C antes le movería el corte. Su aviso viaja con los de las tablas
     —es el mismo canal que ya publica el generador— para que un anexo sin rehacer no pase
     inadvertido. */
  const anexoC = insertarAnexoC(zip, estudio);
  if (anexoC.aviso) avisosTablas.push(anexoC.aviso);

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
