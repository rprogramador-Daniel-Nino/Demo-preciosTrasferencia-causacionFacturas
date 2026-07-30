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

// Banner de una línea: /* ===== ETIQUETA ===== */ — al menos 3 signos por lado.
const RE_BANNER = /\/\*\s*[=═]{3,}\s*(.+?)\s*[=═]{3,}\s*\*\//;
const RE_PARCHE = /PARCHE PT\s*[—–-]\s*Bloque\b/;
const RE_MODULO = /^\s*(?:\/\*+|\/\/+|\*+)?\s*(MÓDULO\s+\S.*?)\s*$/;
const RE_FUNCION = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const RE_WINDOW = /^\s*window\.([A-Za-z_$][\w$]*)\s*=/;

/* Convierte el contenido de index.html en anclas {linea, etiqueta}, ordenadas
   por línea ascendente. Las etiquetas son estables entre versiones del archivo;
   los números de línea no lo son, y por eso el solapamiento se calcula siempre
   sobre etiquetas. */
function extraerAnclas(contenido) {
  const lineas = String(contenido).split(/\r?\n/);
  const anclas = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    let etiqueta = null;

    const banner = linea.match(RE_BANNER);
    if (banner) {
      etiqueta = _normalizar(banner[1]);
    } else if (RE_PARCHE.test(linea)) {
      etiqueta = _normalizar(linea);
    } else if (RE_MODULO.test(linea) && /^\s*(?:\/\*+|\/\/+|\*+)/.test(linea)) {
      etiqueta = _normalizar(linea);
    } else {
      const fn = linea.match(RE_FUNCION);
      const win = linea.match(RE_WINDOW);
      if (fn) etiqueta = 'función ' + fn[1] + '()';
      else if (win) etiqueta = 'window.' + win[1];
    }

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

module.exports = { extraerAnclas, parsearHunks, etiquetasDeHunks, SIN_BLOQUE };
