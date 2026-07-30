'use strict';

/* Análisis de ramas: funciones puras, sin git y sin disco.
   Todo lo que toca el sistema vive en scripts/revisar-ramas.js. */

/* Deja una etiqueta legible: quita marcas de comentario, runs de = o ═ en los
   extremos, y colapsa espacios. */
function _normalizar(texto) {
  return String(texto)
    .replace(/^\s*\/\*+/, '')
    .replace(/\*+\/\s*$/, '')
    .replace(/^\s*(?:\/\/+|\*+)/, '')
    .replace(/^[\s=═─-]+/, '')
    .replace(/[\s=═─-]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* Banner de una línea. Bordes admitidos: =, ═, ─ y guion, al menos 3 por lado. */
const RE_BANNER = /\/\*\s*[=═─-]{3,}\s*(.+?)\s*[=═─-]{3,}\s*\*\//;
/* Mismo banner dentro de comentario HTML, usado en el marcado fuera de <script>. */
const RE_BANNER_HTML = /<!--\s*[=═─-]{3,}\s*(.+?)\s*[=═─-]{3,}\s*-->/;
/* Apertura de banner multilínea: el borde llega al final de la línea y el
   título viene en la siguiente, sin marcador de comentario propio. */
const RE_BANNER_ABRE = /\/\*\s*[=═─-]{3,}\s*$/;
const RE_PARCHE = /PARCHE PT\s*[—–-]\s*Bloque\b/;
/* Admite tanto "MÓDULO X" como "MÓDULO: X". */
const RE_MODULO = /^\s*(?:\/\*+|\/\/+|\*+)?\s*(MÓDULO[\s:]+\S.*?)\s*$/;
const RE_FUNCION = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const RE_WINDOW = /^\s*window\.([A-Za-z_$][\w$]*)\s*=/;
/* Una línea que es solo borde o cierre no puede ser el título de un banner. */
const RE_SOLO_BORDE = /^[\s=═─*\/-]*$/;

/* Convierte el contenido de index.html en anclas {linea, etiqueta}, ordenadas
   por línea ascendente. Las etiquetas son estables entre versiones del archivo;
   los números de línea no lo son, y por eso el solapamiento se calcula siempre
   sobre etiquetas. */
function extraerAnclas(contenido) {
  const lineas = String(contenido).split(/\r?\n/);
  const anclas = [];
  let esperandoTitulo = false;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    let etiqueta = null;

    const banner = linea.match(RE_BANNER) || linea.match(RE_BANNER_HTML);
    if (banner) {
      etiqueta = _normalizar(banner[1]);
    } else if (RE_PARCHE.test(linea)) {
      etiqueta = _normalizar(linea);
    } else if (RE_MODULO.test(linea) && /^\s*(?:\/\*+|\/\/+|\*+)/.test(linea)) {
      etiqueta = _normalizar(linea);
    } else if (esperandoTitulo && !RE_SOLO_BORDE.test(linea)) {
      etiqueta = _normalizar(linea);
    } else {
      const fn = linea.match(RE_FUNCION);
      const win = linea.match(RE_WINDOW);
      if (fn) etiqueta = 'función ' + fn[1] + '()';
      else if (win) etiqueta = 'window.' + win[1];
    }

    /* El flag se consume en la primera línea con contenido, haya dado etiqueta
       o no, para no arrastrarlo por todo el cuerpo del comentario. */
    if (esperandoTitulo && !RE_SOLO_BORDE.test(linea)) esperandoTitulo = false;
    if (RE_BANNER_ABRE.test(linea)) esperandoTitulo = true;

    if (etiqueta) anclas.push({ linea: i + 1, etiqueta });
  }

  return anclas;
}

// Cabecera de hunk: @@ -viejo,n +nuevo,m @@ — los conteos son opcionales.
// Interesa solo el lado nuevo, porque las anclas se calculan sobre la punta.
const RE_HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

const SIN_BLOQUE = '(antes del primer bloque)';

// Extrae los rangos de líneas modificadas, en la numeración del lado nuevo.
function parsearHunks(textoDiff) {
  const hunks = [];
  for (const linea of String(textoDiff).split(/\r?\n/)) {
    const m = linea.match(RE_HUNK);
    if (!m) continue;
    const inicio = parseInt(m[1], 10);
    // Sin conteo explícito el hunk es de una línea. Con conteo 0 el hunk es un
    // borrado puro: no hay líneas nuevas, pero el cambio ocurre en ese punto.
    const cantidad = m[2] === undefined ? 1 : parseInt(m[2], 10);
    const fin = cantidad === 0 ? inicio : inicio + cantidad - 1;
    hunks.push({ inicio, fin });
  }
  return hunks;
}

// Atribuye cada hunk a los bloques que toca: el ancla vigente donde empieza,
// más todas las que caigan dentro del rango.
function etiquetasDeHunks(hunks, anclas) {
  const ordenadas = [...anclas].sort((a, b) => a.linea - b.linea);
  const vistas = new Set();

  for (const hunk of hunks) {
    let vigente = null;
    for (const ancla of ordenadas) {
      if (ancla.linea <= hunk.inicio) vigente = ancla.etiqueta;
      else if (ancla.linea <= hunk.fin) vistas.add(ancla.etiqueta);
    }
    vistas.add(vigente === null ? SIN_BLOQUE : vigente);
  }

  // Se devuelve en orden de aparición en el archivo, no de descubrimiento.
  const orden = [SIN_BLOQUE, ...ordenadas.map((a) => a.etiqueta)];
  return orden.filter((e, i) => vistas.has(e) && orden.indexOf(e) === i);
}

/* Elementos de `a` presentes en `b`, sin repetir y en el orden de `a`. */
function interseccion(a, b) {
  const enB = new Set(b);
  const vistos = new Set();
  return a.filter((x) => {
    if (!enB.has(x) || vistos.has(x)) return false;
    vistos.add(x);
    return true;
  });
}

/* Ordena de menor a mayor roce con el trabajo propio. La skill integra en este
   orden para que, si algo revienta, ya esté integrado lo más simple. */
function ordenarPorSolapamiento(companeros) {
  return [...companeros].sort((x, y) => {
    const bx = (x.bloques_en_conflicto_potencial || []).length;
    const by = (y.bloques_en_conflicto_potencial || []).length;
    if (bx !== by) return bx - by;
    return (x.solapamiento || []).length - (y.solapamiento || []).length;
  });
}

module.exports = {
  extraerAnclas,
  parsearHunks,
  etiquetasDeHunks,
  interseccion,
  ordenarPorSolapamiento,
  SIN_BLOQUE,
};
