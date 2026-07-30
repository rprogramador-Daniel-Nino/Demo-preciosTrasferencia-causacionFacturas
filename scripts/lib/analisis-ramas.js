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

module.exports = { extraerAnclas };
