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
  filasRazonesRechazo, filasCriteriosScreening, tablasMacroInforme,
} from './tablasInforme.js';
import { claveTitulo, numeroDeTabla, prefijoDeEncabezado } from './docxRelleno.js';
import { pctf } from '../utils/calculations.js';
/* Misma resolución fuente+fecha que ya usan las tablas macro (`tablasMacroInforme` en
   `tablasInforme.js`, que llama a esta función): así el párrafo de narrativa y la tabla
   de la misma serie que va justo debajo citan la fuente en el mismo formato, con la
   misma fecha de consulta. Sin riesgo de import circular: `analisisMercado.js` no
   importa de este módulo ni de `docxRelleno.js`. */
import {
  resolverSerie, filasDatosClaveSector, cabecerasDatosClaveSector, tituloDatosClaveSector,
  fuenteDatosClaveSector, titulosSectorial,
} from './analisisMercado.js';

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
export function localizarTablaHtml(html, nombres, opciones = {}) {
  return localizarTablasHtml(html, nombres, opciones)[0] || null;
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
export function localizarTablasHtml(html, nombres, opciones = {}) {
  const texto = String(html || '');
  const claves = (Array.isArray(nombres) ? nombres : [nombres]).map(claveTitulo).filter(Boolean);
  if (!claves.length) return [];
  /* Nombres que DESCARTAN una tabla. Mismo motivo y misma función que en la ruta .docx: el
     rótulo casa por inclusión y hay tablas cuyo nombre contiene el de otra. */
  const excluidos = (Array.isArray(opciones.excluir) ? opciones.excluir : [opciones.excluir])
    .map(claveTitulo).filter(Boolean);

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

  return encontradas
    .filter((t) => {
      if (!excluidos.length) return true;
      const clave = claveTitulo(t.titulo);
      return !clave || !excluidos.some((e) => clave.includes(e));
    })
    .sort((x, y) => x.inicio - y.inicio);
}

/* El primer elemento que sigue a un bloque, para poder mirar si es su línea de fuente.
   Regex local y no compartida: las de este módulo llevan `g` y arrastran `lastIndex`. */
const RX_ELEMENTO_SIGUIENTE = /^\s*<p(?:\s[^>]*)?>[\s\S]*?<\/p\s*>/i;

/**
 * El elemento «FUENTE: …» que sigue a `desde`, si lo hay.
 *
 * Reconocer esa línea es la misma pregunta en `borrarTablaHtml` (para llevársela junto con
 * la tabla), `reescribirFuenteHtml` (para reescribir solo su texto) e `insertarTablaHtml`
 * (para insertar después de ella y no encima): el primer elemento tras el bloque, y solo
 * cuenta si su texto empieza por «FUENTE:». Repetirla una tercera vez —al llegar
 * `insertarTablaHtml` — es la señal de que ya es una noción del módulo, no un detalle de
 * cada función, así que se extrae aquí.
 *
 * @param {string} html
 * @param {number} desde
 * @returns {{xml:string, inicio:number, fin:number}|null}
 */
function elementoFuenteSiguiente(html, desde) {
  let cursor = desde;
  for (;;) {
    const resto = html.slice(cursor);
    const hueco = /^\s*(?:<p(?:\s[^>]*)?>([\s\S]*?)<\/p\s*>|<br\s*\/?>)/i.exec(resto);
    if (!hueco) break;
    if (textoPlanoHtml(hueco[0])) break;
    cursor += hueco[0].length;
  }

  const siguiente = RX_ELEMENTO_SIGUIENTE.exec(html.slice(cursor));
  if (!siguiente || !/^\s*fuentes?\s*:/i.test(textoPlanoHtml(siguiente[0]))) return null;
  return { xml: siguiente[0], inicio: cursor, fin: cursor + siguiente[0].length };
}

/**
 * Quita del informe una tabla completa: su rótulo, la tabla y la línea de fuente que la
 * sigue.
 *
 * La fuente hay que llevársela a mano porque no está dentro del bloque que devuelve
 * `localizarTablasHtml` —el bloque acaba en `</table>`—. Al sustituir da igual, porque la
 * tabla nueva emite la suya; al borrar, una fuente huérfana queda bajo la tabla siguiente y
 * le atribuye un origen que no es el suyo.
 *
 * @param {string} html
 * @param {{inicio:number, fin:number, rotulo:{inicio:number, fin:number}|null}} bloque
 * @returns {string}
 */
export function borrarTablaHtml(html, bloque) {
  const texto = String(html || '');
  if (!bloque) return texto;

  let fin = bloque.fin;
  const fuente = elementoFuenteSiguiente(texto, fin);
  if (fuente) fin = fuente.fin;

  /* El rótulo va ANTES que la tabla, así que se recorta el tramo entero en un solo corte:
     borrar primero el rótulo desplazaría los offsets sobre los que se calculó el bloque.
     `rotulo` es null cuando el título vive dentro de la propia tabla, y entonces ya está
     dentro del tramo. */
  const desde = (bloque.rotulo && bloque.rotulo.inicio < bloque.inicio)
    ? bloque.rotulo.inicio
    : bloque.inicio;
  return texto.slice(0, desde) + texto.slice(fin);
}

/** El rótulo genérico cuando no hay ancla de la que copiar la envoltura —párrafo llano,
 *  negrita—. Es el mismo respaldo que usa `clonarRotuloHtml` cuando el rótulo del ancla no
 *  tiene la forma esperada e `insertarTablaHtml` cuando el ancla no trae rótulo separado, así
 *  que se extrae en vez de repetir el literal dos veces. */
function rotuloGenericoHtml(titulo) {
  return '<p><strong>' + escaparTextoHtml(titulo) + '</strong></p>';
}

/* El núcleo que comparten `reescribirRotuloHtml` y `clonarRotuloHtml`: partir el rótulo en
   apertura/contenido/cierre y reproducir su envoltura de énfasis alrededor de un texto nuevo.
   `calcularTexto` recibe el contenido VIEJO (para que `reescribirRotuloHtml` pueda mirar su
   número antes de decidir el texto) y devuelve el texto final. `null` si `rotuloXml` no tiene
   la forma `<p>`/`<h1..h6>` esperada, para que cada llamador decida su propio respaldo. */
function conTextoDeRotuloHtml(rotuloXml, calcularTexto) {
  const xml = String(rotuloXml || '');
  const m = /^(<(p|h[1-6])(?:\s[^>]*)?>)([\s\S]*)(<\/\2\s*>)$/i.exec(xml);
  if (!m) return null;
  const texto = calcularTexto(m[3]);
  const { abre, cierra } = envolturaDe(m[3]);
  return m[1] + abre + escaparHtml(texto) + cierra + m[4];
}

/**
 * Clona el rótulo del ancla con un texto YA COMPUESTO por quien llama.
 *
 * A diferencia de `reescribirRotuloHtml` —que conserva el número que el propio rótulo
 * traía, porque su caso de uso es sustituir esa misma tabla sin renumerarla—, aquí el
 * número final es DISTINTO: es el del ancla + 1. Si se reutilizara `reescribirRotuloHtml`
 * pasándole un `titulo` que ya incluye «Tabla N+1.», volvería a anteponerle el número
 * viejo del ancla («Tabla 3. Tabla 4. …»), duplicándolo. Por eso este clon no vuelve a
 * mirar el número: se limita a reproducir la envoltura del rótulo del ancla —negrita,
 * `<span style>`, la etiqueta `<p>` o `<h1>`…`<h6>`— con el texto que ya llegó compuesto.
 */
function clonarRotuloHtml(rotuloXml, titulo) {
  const resultado = conTextoDeRotuloHtml(rotuloXml, () => titulo);
  return resultado != null ? resultado : rotuloGenericoHtml(titulo);
}

/**
 * Inserta una tabla en el informe, después del bloque que sirve de ancla.
 *
 * El ancla se localiza por NOMBRE y nunca por número: la numeración cambia de un informe a
 * otro —la ficha del vinculado viene como «Tabla 3» o como «Tabla 12» en la misma
 * plantilla— y el resto del módulo ya trabaja así.
 *
 * La tabla insertada es un CLON del marcado del ancla con el rótulo y las filas reescritos,
 * no marcado fabricado aquí. Es la premisa de este módulo: lo que se conserva es el
 * maquetado del cliente, y una tabla inventada saldría con otra pinta en medio de su
 * informe. Exige que el ancla tenga la misma forma que la tabla nueva —las dos son fichas
 * de dos columnas—, que es el caso para el que existe esta función.
 *
 * Va después de la línea `FUENTE:` del ancla cuando la trae: colarse entre la tabla y su
 * fuente se la atribuiría a la tabla nueva.
 *
 * NO inserta —devuelve `html` sin tocar— cuando el clon de la tabla sale IDÉNTICO al ancla:
 * eso pasa cuando el ancla no tiene ninguna fila de CUERPO que `reescribirFilasHtml` pueda
 * reemplazar (por ejemplo, una sola fila, que esta ruta trata siempre como encabezado). En
 * ese caso lo que se insertaría bajo el rótulo de la tabla nueva serían los datos del ancla
 * —de OTRA tabla—, una fuga silenciosa. Quien llama tiene que revisar si el html cambió
 * (`resultado !== html`) para saber si la inserción ocurrió.
 *
 * @param {string} html
 * @param {{inicio:number, fin:number, rotulo:{inicio:number,fin:number,xml:string}|null}} ancla
 * @param {{nombre:string, filas:string[][]}} tabla  lo que va en la tabla nueva.
 * @param {string} titulo  el rótulo ya compuesto, con su número si corresponde.
 * @returns {string}
 */
export function insertarTablaHtml(html, ancla, tabla, titulo) {
  const texto = String(html || '');
  if (!ancla || !tabla) return texto;

  const tablaAncla = texto.slice(ancla.inicio, ancla.fin);
  const tablaClon = reescribirFilasHtml(tablaAncla, tabla.filas);
  if (tablaClon === tablaAncla) return texto;

  /* Dónde acaba el ancla, contando su línea de fuente. */
  let fin = ancla.fin;
  const fuente = elementoFuenteSiguiente(texto, fin);
  if (fuente) fin = fuente.fin;

  /* El clon: el rótulo del ancla con el texto nuevo, y su tabla ya reescrita arriba. */
  const rotuloClon = ancla.rotulo
    ? clonarRotuloHtml(ancla.rotulo.xml, titulo)
    : rotuloGenericoHtml(titulo);

  return texto.slice(0, fin) + rotuloClon + tablaClon + texto.slice(fin);
}

/** Las `<tr>` de una tabla, con sus posiciones. Sirve igual con `<thead>`/`<tbody>`. */
export function filasDe(tablaHtml) {
  return [...String(tablaHtml || '').matchAll(/<tr(?:\s[^>]*)?>[\s\S]*?<\/tr\s*>/gi)]
    .map((m) => ({ xml: m[0], inicio: m.index, fin: m.index + m[0].length }));
}

/** Las celdas de una fila: su etiqueta, sus atributos y su contenido. */
export function celdasDe(filaHtml) {
  return [...String(filaHtml || '').matchAll(/<(td|th)((?:\s[^>]*)?)>([\s\S]*?)<\/\1\s*>/gi)]
    .map((m) => ({ etiqueta: m[1], atributos: m[2] || '', contenido: m[3] }));
}

/** Escapa texto para insertarlo en el HTML de la plantilla. */
export function escaparTextoHtml(texto) {
  return escaparHtml(texto);
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
 *
 * El `<span data-campo>` es la excepción: se DESENVUELVE pero no se reproduce. No es
 * presentación, es una marca del vocabulario, y `plantillaRenderer` rellena toda marca que
 * encuentre. Reproducir la del molde —la primera fila de datos de la plantilla— le ponía a
 * las diez filas de la Tabla 10 la marca del efectivo, así que el informe publicaba el
 * efectivo repetido en los diez rubros del activo, con el vertical correcto al lado.
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
    const atributos = m[2] || '';
    const esMarca = m[1].toLowerCase() === 'span' && /\sdata-campo\s*=/i.test(atributos);
    if (!esMarca) abre.push('<' + m[1] + atributos + '>');
    resto = resto.slice(m[0].length).replace(cierre, '');
  }
  return {
    abre: abre.join(''),
    cierra: abre.map((a) => '</' + /^<(\w+)/.exec(a)[1] + '>').reverse().join(''),
  };
}

/**
 * Sube a mayúsculas el texto visible de un fragmento de HTML.
 *
 * Requisito del usuario (2026-08-19) para la tabla de márgenes, la de la muestra y el ANEXO C
 * entero. La tabla de RAZONES DE RECHAZO queda fuera a propósito, y por eso esto se aplica
 * tabla por tabla y nunca sobre una zona del documento: una excepción que depende de dónde cae
 * el límite de una zona es una excepción que se pierde sola.
 *
 * Sube el TEXTO, no el marcado. Los nombres de etiqueta y los atributos se quedan como están
 * —un `style="font-size:9pt"` en mayúsculas dejaría de aplicar—, y las entidades con nombre
 * también: `&nbsp;` en mayúsculas es `&NBSP;`, que no es una entidad, y Word la imprimiría en
 * crudo en medio del informe. Las letras acentuadas llegan como UTF-8 y `toUpperCase` las
 * resuelve sin ayuda.
 *
 * @param {string} fragmento
 * @returns {string}
 */
export function mayusculasEnTablaHtml(fragmento) {
  /* Una entidad que es una LETRA acentuada sí tiene forma en mayúscula, y es otra entidad:
     `&oacute;` → `&Oacute;`. Sin esto la celda publicaba «INFORMACIóN», una minúscula en medio
     de un texto en mayúsculas. La lista de sufijos es la de los diacríticos de HTML 4; se
     comprueba el sufijo y no solo la forma para no tocar `&nbsp;`, `&amp;` ni `&ndash;`, que
     no tienen variante mayúscula y se romperían. */
  const RX_LETRA_ACENTUADA = /^&([a-z])(acute|grave|circ|uml|tilde|cedil|ring|slash|lig|caron);$/;
  const subirEntidad = (entidad) => entidad.replace(RX_LETRA_ACENTUADA,
    (todo, letra, diacritico) => '&' + letra.toUpperCase() + diacritico + ';');

  /* El separador va capturado, así que las posiciones impares del array son las entidades. */
  const subir = (texto) => texto
    .split(/(&(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#[xX][0-9a-fA-F]+);)/)
    .map((trozo, i) => (i % 2 ? subirEntidad(trozo) : trozo.toUpperCase()))
    .join('');
  return String(fragmento || '').replace(/>([^<]+)</g, (todo, texto) => '>' + subir(texto) + '<');
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
 * Reescribe el texto de la línea «FUENTE: …» que sigue a un bloque, conservando su marcado.
 *
 * Esta ruta no emite líneas de fuente: conserva las de la plantilla y cambia el dato, igual
 * que hace con las filas. Borrarla dejaría la tabla sin fuente, e inventarla donde el cliente
 * no la puso cambiaría la maqueta de su informe.
 *
 * @param {string} html
 * @param {number} desde  el offset donde acaba el bloque de la tabla.
 * @param {string} fuente el texto nuevo, sin el prefijo «FUENTE: ».
 * @returns {string} el html con la línea reescrita, o igual si no había ninguna.
 */
export function reescribirFuenteHtml(html, desde, fuente) {
  const texto = String(html || '');
  if (!fuente) return texto;

  const elemento = elementoFuenteSiguiente(texto, desde);
  if (!elemento) return texto;

  const m = /^(<(p|h[1-6])(?:\s[^>]*)?>)([\s\S]*)(<\/\2\s*>)$/i.exec(elemento.xml);
  if (!m) return texto;

  const plano = textoPlanoHtml(m[3]);
  const coincidenciaPrefijo = /^\s*(fuente\s*s?\s*:)/i.exec(plano);
  if (!coincidenciaPrefijo) return texto;

  const prefijoOriginal = coincidenciaPrefijo[1];
  const nuevoTextoContenido = prefijoOriginal + ' ' + fuente;

  let { abre, cierra } = envolturaDe(m[3]);
  if (!abre && !cierra) {
    const tagAlPrincipio = /^\s*<(strong|b|em|i|span|u)((?:\s[^>]*)?)>/i.exec(m[3]);
    if (tagAlPrincipio) {
      abre = '<' + tagAlPrincipio[1] + (tagAlPrincipio[2] || '') + '>';
      cierra = '</' + tagAlPrincipio[1] + '>';
    }
  }

  const reescrito = m[1] + abre + escaparTextoHtml(nuevoTextoContenido) + cierra + m[4];

  return texto.slice(0, elemento.inicio) + reescrito + texto.slice(elemento.fin);
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
export const TABLA_CRITERIOS = 'Códigos SIC utilizados';

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

  /* Sustituye una tabla localizada por su nombre. Devuelve si se pudo.
     `opciones.mayusculas` sube la tabla entera —encabezado de la plantilla incluido— después de
     reescribir las filas. Va DESPUÉS y sobre la tabla ya armada para que suban por igual las
     filas nuevas y el encabezado que viene del cliente; del encabezado se cambia la caja y no
     las palabras, así que su redacción se conserva. */
  const sustituir = (nombre, filas, opciones) => {
    if (!filas || !filas.length) { anotar(nombre); return false; }
    const bloque = localizarTablaHtml(salida, nombre);
    if (!bloque) { anotar(nombre); return false; }
    const tabla = salida.slice(bloque.inicio, bloque.fin);
    let nueva = reescribirFilasHtml(tabla, filas, opciones);
    if (opciones && opciones.mayusculas) nueva = mayusculasEnTablaHtml(nueva);
    salida = salida.slice(0, bloque.inicio) + nueva + salida.slice(bloque.fin);

    if (opciones && opciones.fuente) {
      const finBloque = finDeTabla(salida, bloque.inicio);
      if (finBloque > bloque.inicio) {
        salida = reescribirFuenteHtml(salida, finBloque, opciones.fuente);
      }
    }
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
  const dbFuente = study.database_source || 'ONESOURCE (Thomson Reuters) Publicado en septiembre de 2025';
  const fuenteRazones = `Información Base Datos ${dbFuente}.`;
  sustituir(TABLA_RAZONES, filasRazones, { fuente: fuenteRazones });

  /* ── Criterios de búsqueda ── La plantilla trae «Códigos SIC utilizados» tres veces
     (Tablas 13, 14 y 15) correspondientes a las bases de datos de Ryan LLC, Capital IQ
     y Refinitiv. En este momento, el sistema utiliza únicamente Capital IQ (Tabla 14)
     como fuente de datos de la búsqueda.

     Por solicitud del usuario (2026-08-12), eliminamos las Tablas 13 y 15 para evitar
     la duplicación de tablas redundantes y la atribución falsa de fuentes que no se
     utilizaron, conservando únicamente la Tabla 14 (Capital IQ) reescrita con los
     criterios del estudio. */
  const criterios = filasCriteriosScreening(study);
  if (!criterios.length) {
    anotar(TABLA_CRITERIOS);
  } else {
    const bloques = localizarTablasHtml(salida, TABLA_CRITERIOS);
    if (!bloques.length) {
      anotar(TABLA_CRITERIOS);
    } else {
      /* De atrás hacia adelante para no alterar los offsets al eliminar o modificar */
      for (const bloque of [...bloques].reverse()) {
        const num = numeroDeTabla(bloque.titulo);
        const idxOriginal = bloques.indexOf(bloque);

        // Determinamos si es la Tabla 13 o 15 para borrarla. Si no tiene número pero hay 3,
        // borramos la primera (índice 0, correspondiente a la 13) y la tercera (índice 2, a la 15).
        const esParaEliminar = num === 13 || num === 15 || (num !== 14 && bloques.length === 3 && (idxOriginal === 0 || idxOriginal === 2));

        if (esParaEliminar) {
          // Eliminamos la tabla entera incluyendo el párrafo de su rótulo si existe
          const inicioEliminar = bloque.rotulo ? bloque.rotulo.inicio : bloque.inicio;
          /* Y su línea de fuente, si la trae: no está dentro del bloque —acaba en
             `</table>`— y dejarla quedaría huérfana bajo la Tabla 14 que sí se conserva,
             atribuyéndole el origen (Ryan LLC, Refinitiv) de una tabla que ya no está. */
          const fuente = elementoFuenteSiguiente(salida, bloque.fin);
          const finEliminar = fuente ? fuente.fin : bloque.fin;
          salida = salida.slice(0, inicioEliminar) + salida.slice(finEliminar);
        } else {
          // Conservamos la Tabla 14 (Capital IQ) y la reescribimos con los criterios reales
          salida = salida.slice(0, bloque.inicio)
            + reescribirFilasHtml(salida.slice(bloque.inicio, bloque.fin), criterios)
            + salida.slice(bloque.fin);
        }
      }
    }
  }

  /* ── Muestra de comparables ── */
  const dbFuenteMuestra = study.database_source || 'ONESOURCE (Thomson Reuters)';
  const fuenteMuestra = `Información Base Datos ${dbFuenteMuestra}`;
  sustituir(TABLA_MUESTRA, filasMuestraComparables(study)
    .map((f) => [String(f.numero), f.nombre, f.ambito]), { mayusculas: true, fuente: fuenteMuestra });

  /* ── Márgenes de las comparables ── */
  const dbFuenteMargenes = study.database_source || 'ONESOURCE (Thomson Reuters-Refinitiv Fundamentals)';
  const year = Number(study.anio) || 2025;
  const fuenteMargenes = `Información Base Datos ${dbFuenteMargenes} Fecha de consulta: septiembre de ${year}.`;
  const comparables = filasComparablesInforme(study);
  sustituir(TABLA_MARGENES, comparables
    .map((f) => [f.nombre, pct(f.noAjustado), pct(f.ajustado)]), { mayusculas: true, fuente: fuenteMargenes });

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

    /* Solo la horizontal cita fuente propia, igual que en la ruta .docx (`docxRelleno.js`,
       Rango Intercuartil, `numeros: [5]`): «Información suministrada por la Administración
       de la Compañía.». La vertical no emite ninguna en ninguna de las dos rutas, así que su
       línea —si la trae la plantilla— no se toca. */
    if (esHorizontal) {
      const finBloque = finDeTabla(salida, oc.inicio);
      if (finBloque > oc.inicio) {
        salida = reescribirFuenteHtml(
          salida, finBloque, 'Información suministrada por la Administración de la Compañía.');
      }
    }
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

    if (t.fuente) {
      const finBloque = finDeTabla(salida, bloque.inicio);
      if (finBloque > bloque.inicio) {
        salida = reescribirFuenteHtml(salida, finBloque, t.fuente);
      }
    }

    /* El rótulo va después de la tabla en el orden de escritura porque está ANTES en el
       documento: reescribirlo primero movería el bloque que acabamos de localizar. */
    if (bloque.rotulo) {
      const nuevo = reescribirRotuloHtml(bloque.rotulo.xml, t.titulo);
      salida = salida.slice(0, bloque.rotulo.inicio) + nuevo + salida.slice(bloque.rotulo.fin);
    }
  });

  return salida;
}

/** Una entrada de la Tabla de Contenido termina en puntos de relleno y el número de
 *  página («... 13»). El extractor mapea la TOC a los mismos bloques `<p>` que el
 *  cuerpo (comentario de `RX_BLOQUE` arriba: "el extractor mapea P, TOCI y Note a
 *  `<p>`"), así que una entrada de TOC con el mismo texto del encabezado es
 *  indistinguible por etiqueta — se descarta por forma.
 *
 *  Exige el punteado: un número final SIN puntos de relleno no basta, porque muchos
 *  encabezados legítimos de esta sección terminan en un año («...en 2024 y
 *  Comparación con 2023», «Datos Clave... (2023 vs. 2024)») y un `\d{1,4}$` sin más
 *  los tomaría por entradas de TOC, descartándolos de la búsqueda del hito real. */
function pareceEntradaDeToc(textoPlano) {
  return /\.{2,}\s*\d{1,4}\s*$/.test(textoPlano.trim());
}

function marcadorApartadoPendienteHtml(tema, year) {
  return '<p>[Actualizar con el análisis del panorama de la economía ' + tema + ' del año gravable ' +
    year + ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]</p>';
}

/** Línea "FUENTE: <fuente>" para un párrafo de narrativa con tema propio, a partir del
 *  texto YA formateado por `resolverSerie` (analisisMercado.js) — equivalente HTML de
 *  `parrafoFuenteOoxml` (docxRelleno.js). Mismo texto, con paréntesis alrededor de la
 *  URL y fecha de consulta incluidos, que la tabla de esa misma serie imprime justo
 *  debajo (`tablasMacroInforme` en `tablasInforme.js`, que también llama a
 *  `resolverSerie`). Vacío si `fuenteTexto` viene vacío. */
function parrafoFuenteHtml(fuenteTexto) {
  if (!fuenteTexto) return '';
  const texto = 'FUENTE: ' + fuenteTexto;
  return '<p><strong>' + escaparHtml(texto) + '</strong></p>';
}

/** Marcador para un hueco intermedio de III.A/III.B con tema propio (inflación
 *  mundial, política monetaria, TRM, etc.) sin narrativa lista para ESE tema —
 *  equivalente HTML de `marcadorTemaMacroPendiente` (docxRelleno.js). */
function marcadorTemaMacroPendienteHtml(tema, year) {
  return '[Actualizar con datos verificados sobre ' + tema + ' para el año gravable ' + year +
    ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]';
}

/**
 * Reemplaza la PROSA de III.A y III.B en la ruta HTML/PDF, localizándola por su
 * encabezado — equivalente de `actualizarApartadosMacroOoxml` (`docxRelleno.js`) para
 * esta ruta. No hace falta un conversor: la narrativa de Firestore ya llega en HTML.
 *
 * @param {string} html
 * @param {object|null} datosMacro
 * @param {number} year
 * @param {string[]} [avisos]
 * @returns {string}
 */
/** Si justo después de `cursor` viene una `<table>` —saltando espacios—, el índice
 *  donde termina; si no, -1. Análogo a `finDeTablaInmediata` de `docxRelleno.js`: sin
 *  esto, una tabla que cae dentro de un hueco intermedio se borraría junto con la
 *  prosa que la rodea. */
function finDeTablaInmediataHtml(html, cursor) {
  const tras = /^\s*<table(?:\s[^>]*)?>/i.exec(html.slice(cursor));
  if (!tras) return -1;
  const inicioTabla = cursor + tras[0].indexOf('<table');
  return finDeTabla(html, inicioTabla);
}

/**
 * Igual que `localizarHitos` de `docxRelleno.js`, pero sobre el HTML de la ruta de
 * plantilla PDF. Descarta candidatos de más de 160 caracteres: un párrafo de prosa
 * puede mencionar de pasada el nombre de un hito posterior (p. ej. "la inflación
 * global ha venido descendiendo..." contiene "inflación global") y un `.includes()`
 * sobre texto largo lo confundiría con el título real, que siempre es corto.
 *
 * @param {string} html
 * @param {string[]} titulos
 * @returns {Array<{inicio:number, finPropio:number}|null>}
 */
export function localizarHitosHtml(html, titulos) {
  const texto = String(html || '');
  /* Cada posición admite un título único o un arreglo de sinónimos: el mismo tema puede
     traer redacciones distintas según qué consultor escribió el documento de referencia de
     ese cliente ("Desempleo en Colombia" / "Tasa de Desempleo" / "Mercado Laboral en
     Colombia" son el mismo apartado universal, no contenido específico del contribuyente).
     Mismo mecanismo que `localizarHitos` de `docxRelleno.js`. */
  const claves = (titulos || []).map((t) => (Array.isArray(t) ? t.map(claveTitulo) : [claveTitulo(t)]));
  const resultado = new Array(claves.length).fill(null);
  if (!claves.length) return resultado;

  /* Candidatos: cada bloque con pinta de título, en orden de aparición, recogidos de
     una sola pasada. Antes se buscaba el título `objetivo` avanzando un único cursor
     por el documento: si ese título no aparecía —o aparecía con otra redacción, como
     en un informe de referencia más viejo que el título que se busca—, el cursor se
     quedaba clavado ahí y NINGUNO de los títulos siguientes llegaba siquiera a
     probarse, aunque sí existieran más adelante. Es lo mismo que le pasa a
     `localizarHitos` de `docxRelleno.js`, y se arregla igual: con los candidatos ya
     listados, un título que falta se salta sin mover el cursor de los que le siguen. */
  const candidatos = [];
  RX_BLOQUE.lastIndex = 0;
  let m;
  while ((m = RX_BLOQUE.exec(texto)) !== null) {
    const plano = textoPlanoHtml(m[2]);
    if (pareceEntradaDeToc(plano) || plano.length > 160) continue;
    candidatos.push({ inicio: m.index, fin: m.index + m[0].length, clave: claveTitulo(plano) });
  }

  let desde = 0;
  for (let objetivo = 0; objetivo < claves.length; objetivo += 1) {
    let k = desde;
    while (k < candidatos.length && !claves[objetivo].some((c) => candidatos[k].clave.includes(c))) k += 1;
    if (k >= candidatos.length) continue;
    let finPropio = candidatos[k].fin;
    const finTabla = finDeTablaInmediataHtml(texto, finPropio);
    if (finTabla >= 0) finPropio = finTabla;
    resultado[objetivo] = { inicio: candidatos[k].inicio, finPropio };
    desde = k + 1;
  }
  return resultado;
}

/** Igual que `reemplazarPorHitos` de `docxRelleno.js`, pero devuelve el HTML nuevo en
 *  vez de operar sobre un `sustituidorDeTablas` (esta ruta no tiene ese envoltorio). */
/** Nombre legible de una posición de `titulos`: el título tal cual, o el primero de sus
 *  sinónimos si trae varios — mismo criterio que `docxRelleno.js`. */
const etiquetaTituloHtml = (t) => (Array.isArray(t) ? t[0] : t);

export function reemplazarHuecosHtml(html, titulos, contenidos, avisos, nombreParaAvisos) {
  let salida = String(html || '');
  const hitos = localizarHitosHtml(salida, titulos);
  const etiquetas = titulos.map(etiquetaTituloHtml);
  console.log('[tablasHtmlInforme] ' + (nombreParaAvisos || '') + ': hitos encontrados '
    + hitos.filter(Boolean).length + '/' + titulos.length + ' (' + etiquetas.join(' → ') + ')');

  /* UN aviso por rótulo ausente, no uno por par consecutivo. Mismo criterio y mismo
     texto que `reemplazarPorHitos` en `docxRelleno.js`, donde está la explicación. */
  titulos.forEach((titulo, i) => {
    if (hitos[i]) return;
    const aviso = (nombreParaAvisos || '') + ': no se encontró el rótulo «' + titulo
      + '», así que los apartados que delimita se quedan como están en la plantilla';
    console.warn('[tablasHtmlInforme] ' + aviso);
    if (!Array.isArray(avisos)) return;
    /* Un rótulo cierra una cadena y abre la siguiente, así que sin esto se avisaría dos
       veces del mismo. Ver la nota de `reemplazarPorHitos` en `docxRelleno.js`. */
    if (avisos.some((a) => a.includes('«' + titulo + '»'))) return;
    avisos.push(aviso);
  });

  /* Respaldo para cuando un hueco no se puede localizar porque su propio título —o el
     siguiente— no aparece en el documento de referencia bajo NINGUNA redacción (no es
     que esté mal escrito: la sección nunca existió ahí, típico de una referencia más
     vieja que la sección que se quiere insertar). El último título de la lista es
     siempre un límite —el encabezado de la sección o tabla que viene después, sin
     generador propio en `contenidos`—, así que si se encuentra sirve de sitio de
     respaldo: mejor un párrafo al final de esta sección que perder en silencio un
     contenido que sí se generó. Se ajusta con cada edición que caiga antes de él, en el
     mismo recorrido de atrás hacia adelante, para no apuntar a un índice viejo. */
  /* Si NI SIQUIERA el límite final aparece, no hay con qué distinguir "esta sección
     nunca existió aquí" (una plantilla completamente ajena a esta cadena de títulos,
     como la mayoría de los documentos de prueba) de "sí existe, solo falta un título
     intermedio": en el primer caso, insertar al final del documento sería un despropósito
     — meter párrafos de sector en una plantilla que no tiene ninguna sección de
     Tendencias de la Economía. Por eso el respaldo solo se activa cuando el límite final
     SÍ se encontró: ahí sí se sabe que esta sección existe en algún punto del documento. */
  const ultimoHito = hitos[hitos.length - 1];
  let cursorRespaldo = ultimoHito ? ultimoHito.inicio : null;

  for (let i = contenidos.length - 1; i >= 0; i -= 1) {
    const hitoActual = hitos[i];
    const hitoSiguiente = hitos[i + 1];
    if (!hitoActual || !hitoSiguiente) {
      /* El aviso de que este hueco no se pudo delimitar ya se emitió arriba, nombrando el
         rótulo ausente que lo causa. Aquí solo queda el respaldo. */
      /* Sin el límite final tampoco hay dónde poner un respaldo: seguir con el
         comportamiento de siempre (avisar y no tocar nada). */
      if (cursorRespaldo !== null) {
        /* Se prueba igual, como si el hueco viejo viniera vacío: los generadores que sí
           tienen contenido real (narrativa ya redactada) lo devuelven sin importar el
           texto viejo; los que solo fabrican un marcador de "pendiente" cuando había
           prosa sustancial que retirar no fabrican nada de la nada, así que aquí no
           inventan un marcador que antes no existía. */
        const nuevo = contenidos[i]('');
        if (nuevo !== null) {
          console.log('[tablasHtmlInforme] hueco "' + etiquetas[i] + '" → "' + etiquetas[i + 1] +
            '": sin ancla, insertado de respaldo al final de la sección');
          if (Array.isArray(avisos)) {
            avisos.push(
              (nombreParaAvisos || '') + ': "' + etiquetas[i] + '" no está en la plantilla, así que ' +
              'su contenido se insertó al final de esta sección en vez de en su lugar propio — ' +
              'revisa el orden antes de radicar'
            );
          }
          salida = salida.slice(0, cursorRespaldo) + nuevo + salida.slice(cursorRespaldo);
        }
      }
      continue;
    }
    const textoHueco = textoPlanoHtml(salida.slice(hitoActual.finPropio, hitoSiguiente.inicio));
    const nuevo = contenidos[i](textoHueco);
    if (nuevo === null) {
      console.log('[tablasHtmlInforme] hueco "' + etiquetas[i] + '" → "' + etiquetas[i + 1] + '": sin tocar');
      continue;
    }
    console.log('[tablasHtmlInforme] hueco "' + etiquetas[i] + '" → "' + etiquetas[i + 1] + '": reemplazado');
    if (cursorRespaldo !== null && hitoActual.finPropio <= cursorRespaldo) {
      cursorRespaldo += nuevo.length - (hitoSiguiente.inicio - hitoActual.finPropio);
    }
    salida = salida.slice(0, hitoActual.finPropio) + nuevo + salida.slice(hitoSiguiente.inicio);
  }
  return salida;
}

/** Marcador genérico para un hueco intermedio con prosa sustancial que no tiene una
 *  narrativa específica de reemplazo — mismo criterio y mismo umbral que
 *  `contenidoHuecoIntermedio` de `docxRelleno.js`. */
const UMBRAL_HUECO_CON_PROSA_HTML = 50;
function contenidoHuecoIntermedioHtml(textoHueco) {
  if (textoHueco.trim().length < UMBRAL_HUECO_CON_PROSA_HTML) return null;
  return '<p>[Este párrafo del informe de referencia se retiró porque describía cifras y ' +
    'hechos de otro contribuyente. Redáctelo con información propia de este año antes ' +
    'de radicar.]</p>';
}

/**
 * Generaliza `actualizarApartadosMacroHtml` a TODOS los huecos de III.A/III.B, no
 * solo el primero — equivalente HTML de la versión final de
 * `actualizarApartadosMacroOoxml` en `docxRelleno.js`. Sustituye a la función de
 * arriba: mismo nombre, mismo contrato, cuerpo reescrito.
 */
export function actualizarApartadosMacroHtml(html, datosMacro, year, avisos) {
  const tituloMundial = 'Análisis del Panorama de la Economía Mundial';
  const tituloColombia = 'Análisis del panorama de la economía colombiana';
  const narrativa = (datosMacro && datosMacro.narrativa) || {};
  console.log('[tablasHtmlInforme] actualizarApartadosMacroHtml: año ' + year
    + ', narrativa mundial: ' + (narrativa.mundial ? 'sí' : 'no (marcador)')
    + ', narrativa colombia: ' + (narrativa.colombia ? 'sí' : 'no (marcador)'));

  const primerHueco = (narrativaHtml, tema) => () => (narrativaHtml || marcadorApartadoPendienteHtml(tema, year));

  /** Hueco intermedio con tema propio: párrafo + FUENTE si hay narrativa para ese
   *  tema; marcador específico (no el genérico) si no, y solo si había prosa
   *  sustancial que retirar — el umbral SOLO gatea la rama sin narrativa: cuando sí
   *  hay narrativa lista se inserta siempre, sin importar cuánto medía el hueco
   *  viejo (mismo criterio asimétrico que `temaHueco` en docxRelleno.js).
   *  `serieClave` resuelve la fuente/fecha del párrafo vía `resolverSerie` — `null`
   *  para "conclusiones", que sintetiza y no cita una serie nueva. Si
   *  `datosMacro.series[serieClave]` no trae `valores` (o falta del todo),
   *  `resolverSerie` cae al respaldo local igual que hace la tabla de esa misma serie:
   *  preferible citar una fuente conocida y estática a no citar ninguna, y mantiene
   *  párrafo y tabla en el mismo formato en cualquier escenario. */
  const temaHueco = (narrativaHtml, tema, serieClave) => (textoHueco) => {
    if (narrativaHtml) {
      const fuenteTexto = serieClave ? resolverSerie(datosMacro, serieClave).fuente : '';
      return narrativaHtml + parrafoFuenteHtml(fuenteTexto);
    }
    if (textoHueco.trim().length < UMBRAL_HUECO_CON_PROSA_HTML) return null;
    return '<p>' + escaparHtml(marcadorTemaMacroPendienteHtml(tema, year)) + '</p>';
  };

  let salida = reemplazarHuecosHtml(
    html,
    [tituloMundial, 'PIB Mundial', 'Inflación Global', 'por Región/País', tituloColombia],
    [
      primerHueco(narrativa.mundial, 'mundial'),
      temaHueco(narrativa.inflacionMundial, 'la inflación mundial', 'inflacion_global'),
      temaHueco(narrativa.proyeccionMundial, 'la proyección de crecimiento mundial', 'crecimiento_por_region'),
    ],
    avisos, tituloMundial
  );
  salida = reemplazarHuecosHtml(
    salida,
    [
      tituloColombia, 'PIB en Colombia', 'Inflación en Colombia', 'Intervención del Banco',
      'Tasa Representativa del Mercado',
      ['Desempleo en Colombia', 'Tasa de Desempleo', 'Mercado Laboral en Colombia'],
      'Análisis del Sector',
    ],
    [
      primerHueco(narrativa.colombia, 'colombiana'),
      temaHueco(narrativa.inflacionColombia, 'la inflación en Colombia', 'inflacion_colombia'),
      temaHueco(narrativa.politicaMonetaria, 'la política monetaria', 'tasa_intervencion'),
      temaHueco(narrativa.tasaCambio, 'la tasa de cambio (TRM)', 'trm_promedio'),
      temaHueco(narrativa.mercadoLaboral, 'el mercado laboral en Colombia', 'desempleo_colombia'),
      temaHueco(narrativa.conclusiones, 'las conclusiones del panorama económico', null),
    ],
    avisos, tituloColombia
  );

  if (!narrativa.mundial && Array.isArray(avisos)) avisos.push('narrativa de ' + tituloMundial);
  if (!narrativa.colombia && Array.isArray(avisos)) avisos.push('narrativa de ' + tituloColombia);

  return salida;
}

/**
 * Escribe los encabezados de III.C con la industria y los años del estudio — equivalente
 * HTML de `reescribirEncabezadosOoxml` (`docxRelleno.js`), y por el mismo motivo:
 * `reemplazarHuecosHtml` solo toca el hueco ENTRE encabezados, así que estos se quedaban
 * con los del informe de referencia.
 *
 * De atrás hacia adelante, porque cada reescritura mueve los índices de lo que va después.
 * La numeración del cliente («C. ») se conserva, igual que `reescribirRotuloHtml` conserva
 * el «Tabla N.».
 *
 * @param {Array<{inicio:number}|null>} hitos  de `localizarHitosHtml`.
 * @param {Array<string|null>} titulos  uno por hito; `null` deja ese encabezado como está.
 */
function reescribirEncabezadosHtml(html, hitos, titulos) {
  let salida = String(html || '');
  for (let i = titulos.length - 1; i >= 0; i -= 1) {
    const hito = hitos[i];
    if (!hito || !titulos[i]) continue;
    const m = /^<(p|h[1-6])(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/i.exec(salida.slice(hito.inicio));
    if (!m) continue;
    const nuevo = reescribirRotuloHtml(
      m[0], prefijoDeEncabezado(textoPlanoHtml(m[0])) + titulos[i]);
    if (nuevo === m[0]) continue;
    salida = salida.slice(0, hito.inicio) + nuevo + salida.slice(hito.inicio + m[0].length);
  }
  return salida;
}

/**
 * Regenera la tabla «Datos Clave del Sector» sobre la de la plantilla.
 *
 * Mismo trabajo que hace la ruta .docx dentro de `actualizarApartadoSectorialOoxml`, pero
 * conservando el markup del cliente en vez de emitir una tabla nueva — la razón de ser de
 * esta ruta, igual que en `actualizarTablasMacroHtml`, del que copia el orden: primero la
 * tabla, después el rótulo, porque el rótulo está ANTES en el documento y reescribirlo
 * primero movería los offsets del bloque recién localizado.
 *
 * Se tocan también las celdas de años del encabezado: la plantilla las trae con los del
 * informe de referencia («2023 | 2024»), y publicar las cifras del año en curso bajo esos
 * dos títulos de columna es peor que no tocarlas.
 */
function regenerarTablaDatosClave(html, entrada, year, avisos) {
  const anotar = (motivo) => {
    console.warn('[tablasHtmlInforme] tabla "Datos Clave del Sector": ' + motivo);
    if (Array.isArray(avisos)) avisos.push('tabla de Datos Clave del Sector (' + motivo + ')');
  };

  const filas = filasDatosClaveSector(entrada && entrada.datosClaveTabla);
  if (!filas.length) {
    /* Sin datos verificados NO se fabrica una tabla: se deja la de la plantilla y se
       avisa, que es lo mismo que decide la ruta .docx. Inventar filas aquí es justo lo
       que el filtro de grounding de `analisisSectorPrompts.js` existe para impedir. */
    anotar('la corrida de este año no trajo datos verificados, se deja como está');
    return html;
  }

  const bloque = localizarTablaHtml(html, 'Datos Clave del Sector');
  if (!bloque) {
    anotar('no se encontró en la plantilla');
    return html;
  }

  const original = html.slice(bloque.inicio, bloque.fin);
  let tabla = reescribirFilasHtml(original, filas);
  if (tabla === original) {
    /* `reescribirFilasHtml` necesita al menos una fila de datos que clonar como molde.
       Sin ella devuelve la tabla intacta, y callarlo dejaría las cifras del informe de
       referencia en el documento sin que nada lo delate. */
    anotar('no tiene una fila de datos que sirva de molde, sus cifras son las de la plantilla');
    return html;
  }

  /* Solo si el encabezado tiene la forma que esta tabla supone (indicador + dos años).
     Con otra forma, reescribir por posición pondría un año donde va otra cosa. */
  const cabeceras = cabecerasDatosClaveSector(year);
  const filasTabla = filasDe(tabla);
  if (filasTabla.length && celdasDe(filasTabla[0].xml).length === cabeceras.length) {
    for (let i = cabeceras.length - 1; i >= 1; i -= 1) {
      tabla = reescribirCeldaHtml(tabla, 0, i, cabeceras[i]);
    }
  }

  let salida = html.slice(0, bloque.inicio) + tabla + html.slice(bloque.fin);
  if (bloque.rotulo) {
    const nuevo = reescribirRotuloHtml(
      bloque.rotulo.xml, tituloDatosClaveSector(entrada.tituloSector, year));
    salida = salida.slice(0, bloque.rotulo.inicio) + nuevo + salida.slice(bloque.rotulo.fin);
  }
  console.log('[tablasHtmlInforme] tabla "Datos Clave del Sector": regenerada con '
    + filas.length + ' fila(s)');
  return salida;
}

/** Ruta HTML/PDF de `actualizarApartadoSectorialOoxml` (`docxRelleno.js`): el hueco de
 *  entrada más los cuatro bloques de prosa de III.C localizados por encabezado, más la
 *  tabla "Datos Clave del Sector", que se regenera después de los huecos (su propio hueco
 *  queda en `() => null` para no tocar lo que haya entre la tabla y el encabezado
 *  siguiente). */
export function actualizarApartadoSectorialHtml(html, analisisSector, estudio, year, avisos) {
  const entrada = analisisSector && analisisSector.porAnio && analisisSector.porAnio[String(year)];
  console.log('[tablasHtmlInforme] actualizarApartadoSectorialHtml: año ' + year
    + ', corrida de sector para este año: ' + (entrada ? 'sí (' + (entrada.tituloSector || 'sin título') + ')' : 'no (marcador)'));

  const marcador = (tema) => '<p>[Actualizar con el análisis del ' + tema + ' del sector para el año gravable ' +
    year + ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]</p>';
  const bloque = (narrativaHtml, tema) => () => (narrativaHtml || marcador(tema));

  /** Igual que `bloque`, pero cuando NO hay narrativa lista, el marcador de pendiente
   *  solo se fabrica si el hueco traía prosa sustancial que retirar — el hueco de
   *  entrada de III.C (antes de "Comportamiento del Sector") puede venir vacío en
   *  plantillas cuyo encabezado de sección no trae párrafo introductorio propio, y sin
   *  este resguardo se le fabricaría un marcador donde hoy no hay nada. El umbral NO
   *  aplica cuando SÍ hay narrativa: insertar contenido real y verificado no es
   *  "fabricar", así que se inserta siempre que esté disponible, sin importar cuánto
   *  medía el hueco viejo (mismo criterio asimétrico que `temaHueco`, y que
   *  `bloqueConUmbral` en docxRelleno.js). */
  const bloqueConUmbral = (narrativaHtml, tema) => (textoHueco) => {
    if (!narrativaHtml && textoHueco.trim().length < UMBRAL_HUECO_CON_PROSA_HTML) return null;
    return bloque(narrativaHtml, tema)();
  };

  const titulos = [
    'Análisis del Sector', 'Comportamiento del Sector', 'Datos Clave del Sector',
    'Importaciones y exportaciones del sector', '¿Qué se proyecta para el sector', 'Conclusiones y Perspectivas',
    'ANÁLISIS ECONÓMICO',
  ];

  let salida = reemplazarHuecosHtml(
    html,
    titulos,
    [
      bloqueConUmbral(entrada && entrada.narrativa.introduccion, 'contexto introductorio'),
      bloque(entrada && entrada.narrativa.comportamiento, 'comportamiento del sector'),
      /* El hueco que va entre la tabla de datos clave y el encabezado siguiente: en la
         plantilla lo ocupan las notas al pie de ESA tabla, que son las fuentes de las
         cifras del informe de referencia. Se sustituyen por las de la corrida de este año
         —`regenerarTablaDatosClave` reescribe las filas justo después— y solo si la
         corrida dejó alguna: sin fuente real se deja la nota como estaba, porque borrarla
         dejaría la tabla sin la fuente que exige el numeral 4 del artículo 1.2.2.2.1.5 del
         Decreto 1625 de 2016. */
      () => parrafoFuenteHtml(fuenteDatosClaveSector(entrada)) || null,
      bloque(entrada && entrada.narrativa.comercioExterior, 'comercio exterior del sector'),
      bloque(entrada && entrada.narrativa.proyeccion, 'proyección del sector'),
      bloque(entrada && entrada.narrativa.conclusiones, 'conclusiones del sector'),
    ],
    avisos, 'Análisis del Sector'
  );

  if (!entrada && Array.isArray(avisos)) avisos.push('narrativa del Análisis del Sector');

  /* Los encabezados van después de la prosa y se relocalizan sobre la salida ya modificada.
     "Datos Clave del Sector" queda fuera —su rótulo lo reescribe `regenerarTablaDatosClave`
     junto con la tabla— y "Conclusiones y Perspectivas" también, porque no lleva industria
     ni años. */
  if (entrada) {
    const t = titulosSectorial(entrada.tituloSector, year);
    salida = reescribirEncabezadosHtml(
      salida,
      localizarHitosHtml(salida, titulos),
      [t.apartado, t.comportamiento, null, t.comercioExterior, t.proyeccion, null, null]
    );
  }

  return regenerarTablaDatosClave(salida, entrada, year, avisos);
}

/* Mismo formato que la ruta .docx, y por el mismo formateador: `pctf`. Un hueco visible —y no
   un cero— cuando la comparable no tiene margen calculable. */
function pct(v) {
  return (v === null || v === undefined || !Number.isFinite(Number(v)))
    ? '—'
    : pctf(Number(v));
}

