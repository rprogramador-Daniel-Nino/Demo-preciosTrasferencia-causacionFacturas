/* ─────────────────────────────────────────────────────────────────────────────
   tablasHtmlInforme.js — Regeneración de las tablas del motor en la ruta de PDF.

   POR QUÉ EXISTE. El sistema tiene dos rutas para producir el informe:

     · Plantilla .docx — se edita el OOXML del documento del cliente y las tablas las
       regenera `docxRelleno.js` (`actualizarTablasOperacionesOoxml`).
     · Plantilla PDF — el extractor la convierte a HTML, la IA marca los campos y
       `plantillaRenderer.js` sustituye marca por valor.

   En la segunda no había ningún motor de tablas: se sustituían campos sueltos, uno por
   uno. Con la plantilla de END GAME eso dejaba la «Tabla 19. Margen Operacional
   Compañías Comparables» con sus trece comparables y solo un puñado de celdas con
   cifras del estudio nuevo —las que la IA alcanzó a marcar—, mezclando dos informes en
   la misma tabla. Se reportó el 2026-08-11 sobre la vista previa.

   POR QUÉ EL MARCADO NO PODÍA RESOLVERLO. Una marca sustituye texto por texto: no
   añade ni quita filas. La muestra cambia de tamaño entre estudios —y desde este mismo
   día puede cambiar durante la ingesta, cuando una comparable se retira porque su EEFF
   no trae cifras (`eeffSuficiencia.js`)—, así que una tabla de trece filas marcadas
   celda a celda seguiría estando mal en cuanto la muestra tuviera catorce.

   POR QUÉ SE REESCRIBEN LAS FILAS Y NO LA TABLA ENTERA. La razón de ser de la ruta de
   PDF es conservar la presentación del informe del cliente. El HTML del extractor no
   lleva estilos en las celdas —son `<td>` desnudos y el aspecto lo pinta el CSS del
   previo por selector—, pero sí lleva el énfasis dentro de la celda (`<strong>` en la
   razón social, `<span style="font-size:9pt">` en la fuente). Emitir una tabla nueva
   perdería eso; en su lugar se conserva la fila de encabezado tal cual y las filas de
   datos se generan clonando el markup de una fila existente, que hace de molde.

   UNA SOLA FUENTE DE CIFRAS. Las filas salen de `filasComparablesInforme`, la misma
   función que alimenta la ruta .docx. Repetir aquí el cálculo del margen habría
   permitido que las dos rutas publicaran números distintos para el mismo estudio.
   ───────────────────────────────────────────────────────────────────────────── */

import { filasComparablesInforme } from './tablasInforme.js';
import { claveTitulo } from './docxRelleno.js';

/** Texto visible de un fragmento de HTML, con las entidades deshechas. */
export function textoPlanoHtml(fragmento) {
  return String(fragmento || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const escaparHtml = (texto) => String(texto == null ? '' : texto)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* Fin de la `<table>` que abre en `desde`, contando anidamiento. -1 si no cierra.
   Con una expresión no codiciosa una tabla dentro de una celda cerraría el bloque por
   la mitad, igual que pasaba en el localizador de OOXML antes de contar niveles. */
function finDeTabla(html, desde) {
  const rx = /<table(?:\s[^>]*)?>|<\/table\s*>/gi;
  rx.lastIndex = desde;
  let nivel = 0, m;
  while ((m = rx.exec(html)) !== null) {
    nivel += /^<\//.test(m[0]) ? -1 : 1;
    if (nivel === 0) return m.index + m[0].length;
  }
  return -1;
}

/* Bloques que pueden llevar el rótulo de una tabla. El extractor mapea P, TOCI y Note
   a `<p>` y los encabezados a `<h1>`…`<h6>`. */
const RX_BLOQUE = /<(p|h[1-6])(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;

/**
 * La tabla cuyo rótulo coincide con el nombre dado.
 *
 * Se busca por el NOMBRE de la tabla y no por el número del rótulo: el prefijo
 * «Tabla N.» se renumera al reordenar el informe y hay plantillas que no lo traen
 * —criterio del usuario, 2026-08-11, el mismo que sigue la ruta .docx—.
 *
 * @param {string} html   la plantilla marcada.
 * @param {string|string[]} nombres  nombre canónico, o varios sinónimos.
 * @returns {{inicio:number, fin:number, titulo:string}|null} `inicio` y `fin` delimitan
 *          la `<table>`; el párrafo del rótulo queda fuera, porque no hay que tocarlo.
 */
export function localizarTablaHtml(html, nombres) {
  const texto = String(html || '');
  const claves = (Array.isArray(nombres) ? nombres : [nombres]).map(claveTitulo).filter(Boolean);
  if (!claves.length) return null;

  RX_BLOQUE.lastIndex = 0;
  let b;
  while ((b = RX_BLOQUE.exec(texto)) !== null) {
    const clave = claveTitulo(textoPlanoHtml(b[2]));
    if (!clave || !claves.some((c) => clave.includes(c))) continue;

    /* Entre el rótulo y la tabla el extractor deja párrafos vacíos —la marca de párrafo
       que Word pone al exportar—. Se saltan; en cuanto aparece uno con texto, ese rótulo
       no era el de esta tabla. */
    let cursor = b.index + b[0].length;
    for (;;) {
      const resto = texto.slice(cursor);
      const hueco = /^\s*(?:<(p|h[1-6])(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>|<br\s*\/?>)/i.exec(resto);
      if (!hueco) break;
      if (textoPlanoHtml(hueco[0])) break;
      cursor += hueco[0].length;
    }

    const tras = /^\s*<table(?:\s[^>]*)?>/i.exec(texto.slice(cursor));
    if (!tras) continue;

    const inicio = cursor + tras[0].indexOf('<table');
    const fin = finDeTabla(texto, inicio);
    if (fin < 0) continue;
    return { inicio, fin, titulo: textoPlanoHtml(b[2]) };
  }
  return null;
}

/* Las `<tr>` de una tabla, con sus posiciones. */
function filasDe(tablaHtml) {
  return [...tablaHtml.matchAll(/<tr(?:\s[^>]*)?>[\s\S]*?<\/tr\s*>/gi)]
    .map((m) => ({ xml: m[0], inicio: m.index, fin: m.index + m[0].length }));
}

/* Las celdas de una fila: su etiqueta, sus atributos y su contenido. */
function celdasDe(filaHtml) {
  return [...filaHtml.matchAll(/<(td|th)((?:\s[^>]*)?)>([\s\S]*?)<\/\1\s*>/gi)]
    .map((m) => ({ etiqueta: m[1], atributos: m[2] || '', contenido: m[3] }));
}

/**
 * La envoltura de un contenido de celda, para reproducirla con otro texto.
 *
 * `<p>` va en la lista y es el caso que importa: medido sobre la plantilla de END GAME,
 * sus celdas son `<td><p>AKATSUKI INC.</p></td>` —el extractor emite el `P` de dentro de
 * la celda como párrafo, igual que mammoth—, y el CSS del previo estiliza `td p`. Emitir
 * `<td>` a secas cambiaba el interlineado y los márgenes de toda la tabla.
 *
 * Los de énfasis (`<strong>`, `<span style>`) están porque otras plantillas ponen la
 * razón social en negrita o la fuente al pie en cuerpo 9 dentro de la propia tabla.
 */
export function envolturaDe(contenido) {
  const texto = String(contenido || '');
  const abre = [];
  let resto = texto;
  for (;;) {
    const m = /^\s*<(p|div|strong|b|em|i|span|u)((?:\s[^>]*)?)>/i.exec(resto);
    if (!m) break;
    const cierre = new RegExp('</' + m[1] + '\\s*>\\s*$', 'i');
    if (!cierre.test(resto)) break;
    abre.push('<' + m[1] + (m[2] || '') + '>');
    resto = resto.slice(m[0].length).replace(cierre, '');
  }
  return {
    abre: abre.join(''),
    cierra: abre.map((a) => '</' + /^<(\w+)/.exec(a)[1] + '>').reverse().join(''),
  };
}

/**
 * Reescribe las filas de datos de una tabla conservando su encabezado y su markup.
 *
 * @param {string} tablaHtml  la `<table>` completa de la plantilla.
 * @param {Array<string[]>} filas  el contenido nuevo, una entrada por fila.
 * @param {{filasEncabezado?:number, pie?:boolean}} [opciones]
 *        `filasEncabezado`: cuántas filas iniciales se conservan (1 por defecto).
 *        `pie`: si la última fila de la plantilla es una nota de fuente que se conserva.
 * @returns {string} la tabla con sus filas nuevas.
 */
export function reescribirFilasHtml(tablaHtml, filas, opciones = {}) {
  const tabla = String(tablaHtml || '');
  const encabezados = Math.max(1, Number(opciones.filasEncabezado) || 1);
  const todas = filasDe(tabla);
  if (todas.length <= encabezados) return tabla;

  /* La última fila es la nota de fuente cuando ocupa una sola celda y el resto de la
     tabla tiene más de una: «Información Base Datos ONESOURCE…» va así en la plantilla,
     dentro de la tabla, y perderla dejaría la tabla sin la fuente que exige el informe. */
  const columnas = celdasDe(todas[encabezados - 1].xml).length;
  const ultima = todas[todas.length - 1];
  const esPie = opciones.pie !== false
    && todas.length > encabezados + 1
    && columnas > 1
    && celdasDe(ultima.xml).length === 1;

  const cuerpo = todas.slice(encabezados, esPie ? todas.length - 1 : todas.length);
  if (!cuerpo.length) return tabla;

  /* Molde: la primera fila de datos de la plantilla. De ella se copian la etiqueta y
     los atributos de cada celda, y el énfasis que envuelve su texto. */
  const molde = celdasDe(cuerpo[0].xml);
  if (!molde.length) return tabla;

  const nuevas = (filas || []).map((valores) => {
    const celdas = (valores || []).map((valor, i) => {
      const m = molde[Math.min(i, molde.length - 1)];
      const { abre, cierra } = envolturaDe(m.contenido);
      return '<' + m.etiqueta + m.atributos + '>' + abre + escaparHtml(valor) + cierra
        + '</' + m.etiqueta + '>';
    }).join('');
    return '<tr>' + celdas + '</tr>';
  }).join('');

  return tabla.slice(0, cuerpo[0].inicio) + nuevas + tabla.slice(cuerpo[cuerpo.length - 1].fin);
}

/** Nombre con el que la tabla de márgenes se rotula en las plantillas. */
export const TABLA_MARGENES = 'Margen Operacional Compañías Comparables';

/**
 * Regenera en el HTML las tablas del motor de comparables.
 *
 * Hoy solo la de márgenes, que es la que se pidió. El localizador y el reescritor son
 * genéricos, así que añadir la muestra de comparables o el rango es declarar su nombre
 * y sus filas — pero cada una necesita comprobarse contra una plantilla real antes de
 * darla por buena, así que no se añaden a ciegas.
 *
 * @param {string} html      la plantilla marcada.
 * @param {object} estudio   el estudio con sus comparables.
 * @param {string[]} [avisos]  se anota el nombre de la tabla que la plantilla no trae.
 *        Sin este aviso el fallo es mudo y la tabla se radica con los datos del informe
 *        del que salió la plantilla.
 * @returns {string} el HTML con las tablas regeneradas.
 */
export function actualizarTablasMotorHtml(html, estudio, avisos) {
  let salida = String(html || '');
  const study = estudio || {};

  const bloque = localizarTablaHtml(salida, TABLA_MARGENES);
  if (!bloque) {
    if (Array.isArray(avisos)) avisos.push(TABLA_MARGENES);
    return salida;
  }

  /* Sin comparables no se toca la tabla: dejarla en blanco es peor que dejar la de la
     plantilla, porque el aviso de arriba ya no se emitiría y nadie sabría por qué la
     tabla quedó vacía. Se avisa igual. */
  const comparables = filasComparablesInforme(study);
  if (!comparables.length) {
    if (Array.isArray(avisos)) avisos.push(TABLA_MARGENES);
    return salida;
  }

  const filas = comparables.map((f) => [f.nombre, pct(f.noAjustado), pct(f.ajustado)]);
  const tabla = salida.slice(bloque.inicio, bloque.fin);
  return salida.slice(0, bloque.inicio) + reescribirFilasHtml(tabla, filas)
    + salida.slice(bloque.fin);
}

/* Mismo formato que la ruta .docx: dos decimales y el signo de porcentaje. Un hueco
   visible —y no un cero— cuando la comparable no tiene margen calculable. */
function pct(v) {
  return (v === null || v === undefined || !Number.isFinite(Number(v)))
    ? '—'
    : (Number(v) * 100).toFixed(2) + '%';
}
