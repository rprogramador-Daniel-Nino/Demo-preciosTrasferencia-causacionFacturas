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
import { filasComparablesInforme, filasRazonesRechazo } from './exactTemplateMapper.js';
import { pctf } from '../utils/calculations.js';
import { nameKey } from './comparablesEngine.js';
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

  return { comparables, razonesRechazo };
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
export function actualizarTablasMacroOoxml(xml, datosMacro, year) {
  let out = xml;

  const y1 = year - 1, y2 = year, y3 = year + 1;
  const wrap = (v) => String(v == null ? '—' : v);

  // 1. PIB Mundial
  {
    const { valores: S, fuente } = resolverSerie(datosMacro, 'pib_mundial');
    const rx = /<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?PIB Mundial(?:(?!<\/w:p>)[\s\S])*?<\/w:p>\s*(?:<w:p(?:\s[^>]*)?\/>\s*)*<w:tbl>[\s\S]*?<\/w:tbl>/i;
    if (rx.test(out)) {
      const tabla = generarTablaOoxml(
        'Crecimiento del PIB Mundial (' + y1 + '-' + y3 + ')',
        ['Año', 'Crecimiento Mundial (%)'],
        [
          [String(y1), wrap(valorODisponible(S, y1, 'el crecimiento del PIB mundial'))],
          [String(y2), wrap(valorODisponible(S, y2, 'el crecimiento del PIB mundial'))],
          [String(y3) + ' (Proyección)', wrap(valorODisponible(S, y3, 'la proyección de crecimiento del PIB mundial'))],
        ],
        fuente
      );
      out = out.replace(rx, () => tabla);
    }
  }

  // 2. PIB Colombia
  {
    const { valores: S, fuente } = resolverSerie(datosMacro, 'pib_colombia');
    const rx = /<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?PIB en Colombia(?:(?!<\/w:p>)[\s\S])*?<\/w:p>\s*(?:<w:p(?:\s[^>]*)?\/>\s*)*<w:tbl>[\s\S]*?<\/w:tbl>/i;
    if (rx.test(out)) {
      const tabla = generarTablaOoxml(
        'Crecimiento del PIB en Colombia (' + y1 + '-' + y3 + ')',
        ['Año', 'Crecimiento del PIB (%)'],
        [
          [String(y1), wrap(valorODisponible(S, y1, 'el crecimiento del PIB de Colombia'))],
          [String(y2), wrap(valorODisponible(S, y2, 'el crecimiento del PIB de Colombia'))],
          [String(y3) + ' (Proyección OCDE)', wrap(valorODisponible(S, y3, 'la proyección de crecimiento del PIB de Colombia'))],
        ],
        fuente
      );
      out = out.replace(rx, () => tabla);
    }
  }

  // 3. Inflación Global
  {
    const { valores: S, fuente } = resolverSerie(datosMacro, 'inflacion_global');
    const rx = /<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?Inflación Global(?:(?!<\/w:p>)[\s\S])*?<\/w:p>\s*(?:<w:p(?:\s[^>]*)?\/>\s*)*<w:tbl>[\s\S]*?<\/w:tbl>/i;
    if (rx.test(out)) {
      const tabla = generarTablaOoxml(
        'Tasas de Inflación Global (' + y1 + '-' + y3 + ')',
        ['Año', 'Tasa de Inflación (%)'],
        [
          [String(y1), wrap(valorODisponible(S, y1, 'la inflación global'))],
          [String(y2), wrap(valorODisponible(S, y2, 'la inflación global'))],
          [String(y3) + ' (Proyección)', wrap(valorODisponible(S, y3, 'la proyección de inflación global'))],
        ],
        fuente
      );
      out = out.replace(rx, () => tabla);
    }
  }

  // 4. PIB por Región
  {
    const { valores: porAnio, fuente } = resolverSerie(datosMacro, 'crecimiento_por_region');
    const rx = /<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?por Región\/País(?:(?!<\/w:p>)[\s\S])*?<\/w:p>\s*(?:<w:p(?:\s[^>]*)?\/>\s*)*<w:tbl>[\s\S]*?<\/w:tbl>/i;
    if (rx.test(out)) {
      const porRegion = porAnio[year];
      const titulo = 'Proyecciones de Crecimiento del PIB por Región/País (' + year + ')';
      let filas = [];
      if (!porRegion || !porRegion.length) {
        const regiones = ['Mundial', 'Estados Unidos', 'China', 'América Latina', 'Colombia (OCDE)'];
        filas = regiones.map((r) => [r, wrap(marcadorPendiente(year, 'la proyección de crecimiento de ' + r))]);
      } else {
        filas = porRegion.map(({ region, valor }) => [region, wrap(valor)]);
      }
      const tabla = generarTablaOoxml(titulo, ['Región/País', 'Crecimiento Proyectado (%)'], filas, fuente);
      out = out.replace(rx, () => tabla);
    }
  }

  // 5. Inflación Colombia
  {
    const { valores: S, fuente } = resolverSerie(datosMacro, 'inflacion_colombia');
    const rx = /<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?Inflación en Colombia(?:(?!<\/w:p>)[\s\S])*?<\/w:p>\s*(?:<w:p(?:\s[^>]*)?\/>\s*)*<w:tbl>[\s\S]*?<\/w:tbl>/i;
    if (rx.test(out)) {
      const tabla = generarTablaOoxml(
        'Inflación en Colombia (' + year + ' vs. Meta ' + y3 + ')',
        ['Indicador', 'Valor (%)'],
        [
          ['Inflación ' + year, wrap(valorODisponible(S, year, 'la inflación de Colombia'))],
          ['Meta Inflación ' + y3, wrap(DATOS_MACRO.meta_inflacion_banrep)],
        ],
        fuente
      );
      out = out.replace(rx, () => tabla);
    }
  }

  // 6. Tasa de Intervención
  {
    const { valores: S, fuente } = resolverSerie(datosMacro, 'tasa_intervencion');
    const rx = /<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?Intervención del Banco(?:(?!<\/w:p>)[\s\S])*?<\/w:p>\s*(?:<w:p(?:\s[^>]*)?\/>\s*)*<w:tbl>[\s\S]*?<\/w:tbl>/i;
    if (rx.test(out)) {
      const filas = [y1, y2].map((y) => {
        const obs = S[y];
        return obs
          ? [obs.etiqueta, wrap(obs.valor)]
          : ['Diciembre ' + y, wrap(marcadorPendiente(y, 'la tasa de intervención del Banco de la República'))];
      });
      const tabla = generarTablaOoxml(
        'Tasa de Intervención del Banco de la República (' + filas[0][0] + ' - ' + filas[1][0] + ')',
        ['Fecha', 'Tasa de Intervención (%)'],
        filas,
        fuente
      );
      out = out.replace(rx, () => tabla);
    }
  }

  // 7. TRM Promedio
  {
    const { valores: S, fuente } = resolverSerie(datosMacro, 'trm_promedio');
    const rx = /<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?Tasa Representativa del Mercado(?:(?!<\/w:p>)[\s\S])*?<\/w:p>\s*(?:<w:p(?:\s[^>]*)?\/>\s*)*<w:tbl>[\s\S]*?<\/w:tbl>/i;
    if (rx.test(out)) {
      const tabla = generarTablaOoxml(
        'Tasa Representativa del Mercado (TRM) Promedio (' + y1 + '-' + y2 + ')',
        ['Año', 'TRM Promedio ($)'],
        [
          [String(y1), wrap(valorODisponible(S, y1, 'la TRM promedio'))],
          [String(y2), wrap(valorODisponible(S, y2, 'la TRM promedio'))],
        ],
        fuente
      );
      out = out.replace(rx, () => tabla);
    }
  }

  // 8. Tasa de Desempleo
  {
    const { valores: S, fuente } = resolverSerie(datosMacro, 'desempleo_colombia');
    const rx = /<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?Desempleo en Colombia(?:(?!<\/w:p>)[\s\S])*?<\/w:p>\s*(?:<w:p(?:\s[^>]*)?\/>\s*)*<w:tbl>[\s\S]*?<\/w:tbl>/i;
    if (rx.test(out)) {
      const tabla = generarTablaOoxml(
        'Tasa de Desempleo en Colombia (' + year + ' vs. Proyección ' + y3 + ')',
        ['Indicador', 'Valor (%)'],
        [
          ['Desempleo ' + year, wrap(valorODisponible(S, year, 'la tasa de desempleo'))],
          ['Desempleo Proyectado ' + y3, wrap(valorODisponible(S, y3, 'la proyección de desempleo'))],
        ],
        fuente
      );
      out = out.replace(rx, () => tabla);
    }
  }

  return out;
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
 * @returns {{zip:PizZip, camposVacios:string[]}} el zip listo para generar, y qué
 *          campos salieron sin dato, para poder avisarlo antes de radicar.
 */
export function renderizarDocx(binario, estudio, opciones = {}) {
  const { datosMacro, colecciones = {}, delimitadores } = opciones;
  const camposVacios = new Set();

  const zip = new PizZip(binario);
  
  // Actualizar tablas macro antes de procesar marcas con docxtemplater
  let xml = zip.file(RUTA_DOC).asText();
  const year = Number(estudio && estudio.anio) || 2025;
  xml = actualizarTablasMacroOoxml(xml, datosMacro, year);
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
        const v = valorDeCampo(estudio, tag);
        if (v === null || v === undefined || v === '') { camposVacios.add(tag); return null; }
        return v;
      },
    }),
    nullGetter: () => SIN_DATO,
  });

  doc.render(colecciones);
  return { zip: doc.getZip(), camposVacios: [...camposVacios] };
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
     Es el mismo enfoque que ya usa `reemplazarAnexoB` en exactTemplateMapper. */
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
 * @returns {{salida:*, camposVacios:string[], imagenesInsertadas:number}}
 */
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

        // Guardar imagen en el zip
        zip.file(`word/media/${nombreImg}`, desde.base64, { base64: true });

        // Asegurar Content_Type
        if (!new RegExp(`Extension="${ext}"`).test(ct)) {
          ct = ct.replace('</Types>',
            `<Default Extension="${ext}" ContentType="image/${ext}"/></Types>`);
        }

        // Agregar relación
        const idRel = `rId${rId++}`;
        rels = rels.replace('</Relationships>',
          `<Relationship Id="${idRel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"`
          + ` Target="media/${nombreImg}"/></Relationships>`);

        // Generar párrafo de dibujo con proporción A4 estándar
        const anchoCm = ANCHO_UTIL_CM;
        const altoCm = (anchoCm * 297) / 210;
        nuevoXmlB += '\n' + parrafoConImagen({
          rId: idRel, id: idDibujo++, nombre: nombreImg,
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
 * @returns {{salida:*, camposVacios:string[], imagenesInsertadas:number}}
 */
export function rellenarDocx({
  binario, estudio, datosMacro, colecciones, imagenesAnexo, delimitadores, tipoSalida = 'blob',
}) {
  const { zip, camposVacios } = renderizarDocx(binario, estudio, { datosMacro, colecciones, delimitadores });
  const { insertadas } = insertarImagenes(zip, imagenesAnexo);
  const { insertadas: insertadasB } = insertarImagenesAnexoB(zip, estudio);
  return {
    salida: zip.generate({
      type: tipoSalida,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    camposVacios,
    imagenesInsertadas: insertadas + insertadasB,
  };
}
