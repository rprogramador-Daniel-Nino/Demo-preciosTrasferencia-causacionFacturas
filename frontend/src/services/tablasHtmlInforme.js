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

import {
  filasComparablesInforme, filasMuestraComparables, filasRangoIntercuartil,
  filasRazonesRechazo, tablasMacroInforme,
} from './tablasInforme.js';
import { claveTitulo, numeroDeTabla } from './docxRelleno.js';

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
  return localizarTablasHtml(html, nombres)[0] || null;
}

/**
 * TODAS las tablas cuyo rótulo coincide, en orden de documento.
 *
 * Hace falta porque la plantilla trae el rango intercuartil más de una vez con el mismo
 * nombre —la versión horizontal de los resultados y la vertical del análisis— y hay que
 * poder quedarse con la que corresponde. Cada resultado trae `columnas` y `filasDatos`
 * para distinguirlas por su forma, que es lo único que las separa cuando el número del
 * rótulo no es de fiar.
 *
 * @returns {Array<{inicio:number, fin:number, titulo:string, columnas:number,
 *          filasDatos:number, embebido:boolean}>}
 */
export function localizarTablasHtml(html, nombres) {
  const texto = String(html || '');
  const claves = (Array.isArray(nombres) ? nombres : [nombres]).map(claveTitulo).filter(Boolean);
  if (!claves.length) return [];

  const encontradas = [];
  const vistas = new Set();

  const anotar = (inicio, fin, titulo, embebido, rotulo) => {
    if (vistas.has(inicio)) return;
    vistas.add(inicio);
    const filas = filasDe(texto.slice(inicio, fin));
    encontradas.push({
      inicio, fin, titulo, embebido,
      /* Dónde está el párrafo del rótulo, para poder reescribirlo. Las tablas macro lo
         necesitan: su título lleva los años («Crecimiento del PIB Mundial (2023-2025)») y
         dejarlo como venía publica el rango de años del informe anterior. `null` cuando el
         rótulo vive dentro de la propia tabla. */
      rotulo: rotulo || null,
      columnas: filas.length ? celdasDe(filas[0].xml).length : 0,
      filasDatos: Math.max(0, filas.length - 1),
    });
  };

  /* ── Rótulo en el párrafo anterior ── */
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
    anotar(inicio, fin, textoPlanoHtml(b[2]), false, {
      inicio: b.index, fin: b.index + b[0].length, xml: b[0], etiqueta: b[1],
    });
  }

  /* ── Rótulo DENTRO de la primera fila ── Así trae la plantilla la «Tabla 20. Tabla de
     rangos» del final. Aquí se exige que la clave de la celda sea EXACTAMENTE el nombre:
     por inclusión, la tabla de definiciones del método —cuya primera fila dice «Margen
     operacional de utilidad o rentabilidad operacional»— se haría pasar por la de
     márgenes, y sustituirla borraría las definiciones. */
  const rxTabla = /<table(?:\s[^>]*)?>/gi;
  let t;
  while ((t = rxTabla.exec(texto)) !== null) {
    const fin = finDeTabla(texto, t.index);
    if (fin < 0) break;
    rxTabla.lastIndex = fin;
    const filas = filasDe(texto.slice(t.index, fin));
    if (!filas.length) continue;
    for (const celda of celdasDe(filas[0].xml)) {
      const clave = claveTitulo(textoPlanoHtml(celda.contenido));
      if (clave && claves.includes(clave)) {
        anotar(t.index, fin, textoPlanoHtml(celda.contenido), true);
        break;
      }
    }
  }

  return encontradas.sort((x, y) => x.inicio - y.inicio);
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

/**
 * Reescribe el texto de una celda concreta, conservando su envoltura.
 *
 * Se usa para el encabezado de la versión horizontal del rango, cuya primera celda es el
 * NOMBRE DEL CONTRIBUYENTE: en la plantilla de END GAME dice «END GAME», y dejarlo ahí
 * publica el nombre del cliente anterior en el informe de otro. El resto del encabezado no
 * se toca — «RANGE MO NO AJUSTADO» es redacción de la plantilla y sobrescribirla con la
 * nuestra es lo contrario de lo que esta ruta existe para conservar.
 *
 * @param {string} tablaHtml
 * @param {number} fila     índice de la fila (0 es la primera).
 * @param {number} columna  índice de la celda dentro de esa fila.
 * @param {string} texto
 */
export function reescribirCeldaHtml(tablaHtml, fila, columna, texto) {
  const tabla = String(tablaHtml || '');
  const filas = filasDe(tabla);
  if (!filas[fila]) return tabla;

  const filaXml = filas[fila].xml;
  const celdas = celdasDe(filaXml);
  if (!celdas[columna]) return tabla;

  /* Se localiza la celda por su posición dentro de la fila y se sustituye solo su
     contenido, para no tocar los atributos ni las demás celdas. */
  let vistas = 0;
  const filaNueva = filaXml.replace(/<(td|th)((?:\s[^>]*)?)>([\s\S]*?)<\/\1\s*>/gi,
    (todo, etiqueta, atributos, contenido) => {
      if (vistas++ !== columna) return todo;
      const { abre, cierra } = envolturaDe(contenido);
      return '<' + etiqueta + atributos + '>' + abre + escaparHtml(texto) + cierra
        + '</' + etiqueta + '>';
    });

  return tabla.slice(0, filas[fila].inicio) + filaNueva + tabla.slice(filas[fila].fin);
}

/**
 * Reescribe el texto del párrafo del rótulo, conservando su formato y su número.
 *
 * Solo se usa en las tablas macro, y por una razón concreta: su título lleva el rango de
 * años («Crecimiento del PIB Mundial (2023-2025)»), que es un dato del informe y no una
 * preferencia de redacción. Dejarlo como venía publica los años del informe del que salió
 * la plantilla. En las tablas del motor el rótulo no se toca, porque ahí el título no
 * contiene datos.
 *
 * El prefijo «Tabla N.» de la plantilla se conserva: si el cliente renumeró, imponer
 * nuestra numeración descuadraría su índice y las referencias del texto.
 */
export function reescribirRotuloHtml(rotuloXml, titulo) {
  const xml = String(rotuloXml || '');
  const m = /^(<(p|h[1-6])(?:\s[^>]*)?>)([\s\S]*)(<\/\2\s*>)$/i.exec(xml);
  if (!m) return xml;

  const numero = numeroDeTabla(textoPlanoHtml(m[3]));
  const texto = numero != null ? 'Tabla ' + numero + '. ' + titulo : titulo;
  const { abre, cierra } = envolturaDe(m[3]);
  return m[1] + abre + escaparHtml(texto) + cierra + m[4];
}

/** Nombres con los que las tablas del motor se rotulan en las plantillas. */
export const TABLA_MARGENES = 'Margen Operacional Compañías Comparables';
export const TABLA_MUESTRA = 'Muestra Compañías comparables';
export const TABLA_RANGO = 'Rango Intercuartil';
export const TABLA_RANGOS_CONCLUSION = 'Tabla de rangos';
export const TABLA_RAZONES = 'Razones de rechazo';

/**
 * Regenera en el HTML las tablas del motor de comparables.
 *
 * Las cuatro que dependen de la muestra: razones de rechazo, muestra de comparables,
 * márgenes y rango intercuartil. Las ocho de tendencias de la economía NO están: no
 * salen del motor sino de las series macro, y su generador es otro.
 *
 * Cada tabla se sustituye por separado y de ATRÁS HACIA ADELANTE dentro de su grupo,
 * porque reescribir una mueve los offsets de todo lo que va después.
 *
 * @param {string} html      la plantilla marcada.
 * @param {object} estudio   el estudio con sus comparables y su embudo.
 * @param {string[]} [avisos]  se anota el nombre de las tablas que la plantilla no trae.
 *        Sin este aviso el fallo es mudo y la tabla se radica con los datos del informe
 *        del que salió la plantilla.
 * @returns {string} el HTML con las tablas regeneradas.
 */
export function actualizarTablasMotorHtml(html, estudio, avisos) {
  let salida = String(html || '');
  const study = estudio || {};
  const anotar = (nombre) => { if (Array.isArray(avisos)) avisos.push(nombre); };

  /* Sustituye una tabla localizada por su nombre. Devuelve si se pudo. */
  const sustituir = (nombre, filas, opciones) => {
    if (!filas || !filas.length) { anotar(nombre); return false; }
    const bloque = localizarTablaHtml(salida, nombre);
    if (!bloque) { anotar(nombre); return false; }
    const tabla = salida.slice(bloque.inicio, bloque.fin);
    salida = salida.slice(0, bloque.inicio) + reescribirFilasHtml(tabla, filas, opciones)
      + salida.slice(bloque.fin);
    return true;
  };

  /* ── Razones de rechazo ── El total del universo cierra la tabla, como en la ruta
     .docx: es lo que permite comprobar de un vistazo que la columna suma. */
  const { filas: razones } = filasRazonesRechazo(study.embudoSeleccion);
  const filasRazones = (razones || []).map((f) => [f.etiqueta, f.letra, String(f.cuantas)]);
  if (filasRazones.length) {
    filasRazones.push([
      'TOTAL, UNIVERSO', '',
      study.embudoSeleccion ? String(study.embudoSeleccion.evaluadas) : '—',
    ]);
  }
  sustituir(TABLA_RAZONES, filasRazones);

  /* ── Muestra de comparables ── */
  sustituir(TABLA_MUESTRA, filasMuestraComparables(study)
    .map((f) => [String(f.numero), f.nombre, f.ambito]));

  /* ── Márgenes de las comparables ── */
  const comparables = filasComparablesInforme(study);
  sustituir(TABLA_MARGENES, comparables
    .map((f) => [f.nombre, pct(f.noAjustado), pct(f.ajustado)]));

  /* ── Rango intercuartil ── La plantilla lo trae hasta tres veces y con dos formas: la
     horizontal de los resultados (una fila de datos: el indicador del contribuyente y
     tres percentiles) y la vertical del análisis, que además se repite al final rotulada
     «Tabla de rangos» y con el rótulo dentro de su primera fila. Las tres tienen que
     quedar con los mismos percentiles: antes se elegía una y la otra se radicaba con los
     del informe anterior.

     Se distinguen por su FORMA y no por el número del rótulo, que se renumera: la
     vertical tiene tres columnas, la horizontal cuatro. */
  const rango = filasRangoIntercuartil(study);
  const filasVertical = rango.filas.map((f) => [f.etiqueta, pct(f.noAjustado), pct(f.ajustado)]);
  const p = (etq) => {
    const f = rango.filas.find((x) => x.etiqueta === etq);
    return f ? pct(f.ajustado) : '—';
  };
  const filaHorizontal = [[pct(rango.tPLI), p('Percentil 25'), p('Mediana'), p('Percentil 75')]];

  /* De atrás hacia adelante: cada sustitución mueve lo que va después. */
  const ocurrencias = [
    ...localizarTablasHtml(salida, TABLA_RANGO),
    ...localizarTablasHtml(salida, TABLA_RANGOS_CONCLUSION),
  ].sort((a, b) => b.inicio - a.inicio);

  if (!ocurrencias.length) anotar(TABLA_RANGO);
  const nombreContribuyente = rango.filas[rango.filas.length - 1].etiqueta;
  let verticalesHechas = 0;
  for (const oc of ocurrencias) {
    const esHorizontal = oc.columnas >= 4;
    const filas = esHorizontal ? filaHorizontal : filasVertical;
    /* La que trae el rótulo embebido lo lleva en su primera fila, así que ahí el
       encabezado son las DOS primeras: el rótulo y los nombres de columna. */
    const opciones = { filasEncabezado: oc.embebido ? 2 : 1 };
    let tabla = reescribirFilasHtml(salida.slice(oc.inicio, oc.fin), filas, opciones);
    /* En la horizontal la primera celda del encabezado es el nombre del contribuyente. Sin
       esto el informe sale con el nombre del cliente del que se tomó la plantilla. */
    if (esHorizontal) tabla = reescribirCeldaHtml(tabla, 0, 0, nombreContribuyente);
    salida = salida.slice(0, oc.inicio) + tabla + salida.slice(oc.fin);
    if (!esHorizontal) verticalesHechas++;
  }
  /* Si solo se encontró la horizontal, el rango del análisis se queda con los datos de la
     plantilla y hay que decirlo. */
  if (ocurrencias.length && !verticalesHechas) anotar(TABLA_RANGO);

  return salida;
}

/**
 * Regenera en el HTML las ocho tablas de tendencias de la economía.
 *
 * Salen de `tablasMacroInforme`, el mismo descriptor que emite la ruta .docx, así que las
 * dos publican las mismas series y las mismas fuentes.
 *
 * A diferencia de las del motor, aquí SÍ se reescribe el rótulo: su título lleva el rango
 * de años, que es un dato. Se procesan de atrás hacia adelante porque cada sustitución
 * mueve los offsets de lo que va después.
 *
 * @param {string} html
 * @param {object} datosMacro  el análisis de mercado del estudio, o null para las series
 *        de respaldo.
 * @param {number} year  año gravable.
 * @param {string[]} [avisos]  se anotan las que la plantilla no trae.
 * @returns {string}
 */
export function actualizarTablasMacroHtml(html, datosMacro, year, avisos) {
  let salida = String(html || '');

  /* Cada tabla se localiza sobre la salida ya modificada, de una en una, en vez de calcular
     todas las posiciones de golpe: los nombres son distintos entre sí, así que reescribir
     una no cambia dónde está la siguiente, pero sus offsets sí se desplazan. */
  tablasMacroInforme(datosMacro, year).forEach((t) => {
    const bloque = localizarTablaHtml(salida, t.nombre);
    if (!bloque) {
      if (Array.isArray(avisos)) avisos.push(t.nombre);
      return;
    }
    const tabla = reescribirFilasHtml(salida.slice(bloque.inicio, bloque.fin), t.filas);
    salida = salida.slice(0, bloque.inicio) + tabla + salida.slice(bloque.fin);

    /* El rótulo va después de la tabla en el orden de escritura porque está ANTES en el
       documento: reescribirlo primero movería el bloque que acabamos de localizar. */
    if (bloque.rotulo) {
      const nuevo = reescribirRotuloHtml(bloque.rotulo.xml, t.titulo);
      salida = salida.slice(0, bloque.rotulo.inicio) + nuevo + salida.slice(bloque.rotulo.fin);
    }
  });

  return salida;
}

/* Mismo formato que la ruta .docx: dos decimales y el signo de porcentaje. Un hueco
   visible —y no un cero— cuando la comparable no tiene margen calculable. */
function pct(v) {
  return (v === null || v === undefined || !Number.isFinite(Number(v)))
    ? '—'
    : (Number(v) * 100).toFixed(2) + '%';
}
