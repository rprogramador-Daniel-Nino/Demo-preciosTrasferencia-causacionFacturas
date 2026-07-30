const { test } = require('node:test');
const assert = require('node:assert');
const { extraerAnclas } = require('./analisis-ramas');

test('extraerAnclas reconoce banners de una línea', () => {
  const src = [
    'let x = 1;',
    '    /* ================= STATE ================= */',
    'let y = 2;',
  ].join('\n');
  assert.deepStrictEqual(extraerAnclas(src), [{ linea: 2, etiqueta: 'STATE' }]);
});

test('extraerAnclas reconoce bloques PARCHE PT y conserva su título', () => {
  const src = [
    'a',
    '       PARCHE PT — Bloque 9:  MÁRGENES ATÍPICOS · COMPARABLES LOCALES ·',
    'b',
  ].join('\n');
  const anclas = extraerAnclas(src);
  assert.strictEqual(anclas.length, 1);
  assert.strictEqual(anclas[0].linea, 2);
  assert.match(anclas[0].etiqueta, /^PARCHE PT — Bloque 9: MÁRGENES ATÍPICOS/);
});

test('extraerAnclas reconoce MÓDULO en comentario', () => {
  const src = '// MÓDULO V3.5 — PERSISTENCIA IndexedDB + BASE AÑO ANTERIOR';
  assert.deepStrictEqual(extraerAnclas(src), [
    { linea: 1, etiqueta: 'MÓDULO V3.5 — PERSISTENCIA IndexedDB + BASE AÑO ANTERIOR' },
  ]);
});

test('extraerAnclas usa function/window como respaldo', () => {
  const src = [
    '    function moRows() {',
    '      return 1;',
    '    }',
    '    window.ORQ_OCR = {',
  ].join('\n');
  assert.deepStrictEqual(extraerAnclas(src), [
    { linea: 1, etiqueta: 'función moRows()' },
    { linea: 4, etiqueta: 'window.ORQ_OCR' },
  ]);
});

test('extraerAnclas prioriza el banner sobre el respaldo en la misma línea', () => {
  const src = '/* ===== ALGO ===== */ function noImporta() {';
  assert.deepStrictEqual(extraerAnclas(src), [{ linea: 1, etiqueta: 'ALGO' }]);
});

test('extraerAnclas maneja CRLF', () => {
  const src = 'a\r\n/* ==== UNO ==== */\r\nb';
  assert.deepStrictEqual(extraerAnclas(src), [{ linea: 2, etiqueta: 'UNO' }]);
});

test('extraerAnclas devuelve lista vacía si no hay anclas', () => {
  assert.deepStrictEqual(extraerAnclas('let a = 1;\nlet b = 2;'), []);
});
