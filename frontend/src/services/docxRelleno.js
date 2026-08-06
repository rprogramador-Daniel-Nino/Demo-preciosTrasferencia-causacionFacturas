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
  const { colecciones = {}, delimitadores } = opciones;
  const camposVacios = new Set();

  const zip = new PizZip(binario);
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
export function rellenarDocx({
  binario, estudio, colecciones, imagenesAnexo, delimitadores, tipoSalida = 'blob',
}) {
  const { zip, camposVacios } = renderizarDocx(binario, estudio, { colecciones, delimitadores });
  const { insertadas } = insertarImagenes(zip, imagenesAnexo);
  return {
    salida: zip.generate({
      type: tipoSalida,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    camposVacios,
    imagenesInsertadas: insertadas,
  };
}
