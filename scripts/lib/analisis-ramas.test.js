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

const { parsearHunks, etiquetasDeHunks } = require('./analisis-ramas');

test('parsearHunks lee el rango del lado nuevo', () => {
  const diff = [
    'diff --git a/index.html b/index.html',
    '@@ -10,3 +12,5 @@ contexto',
    '+linea',
    '@@ -100 +200 @@',
    '+otra',
  ].join('\n');
  assert.deepStrictEqual(parsearHunks(diff), [
    { inicio: 12, fin: 16 },
    { inicio: 200, fin: 200 },
  ]);
});

test('parsearHunks trata el borrado puro (+c,0) como un punto', () => {
  assert.deepStrictEqual(parsearHunks('@@ -5,4 +7,0 @@'), [{ inicio: 7, fin: 7 }]);
});

test('parsearHunks devuelve vacío si no hay hunks', () => {
  assert.deepStrictEqual(parsearHunks('diff --git a/x b/x\nBinary files differ\n'), []);
});

test('etiquetasDeHunks atribuye el cambio al ancla anterior más cercana', () => {
  const anclas = [
    { linea: 10, etiqueta: 'UNO' },
    { linea: 50, etiqueta: 'DOS' },
    { linea: 90, etiqueta: 'TRES' },
  ];
  assert.deepStrictEqual(etiquetasDeHunks([{ inicio: 60, fin: 62 }], anclas), ['DOS']);
});

test('etiquetasDeHunks incluye todas las anclas que el hunk abarca', () => {
  const anclas = [
    { linea: 10, etiqueta: 'UNO' },
    { linea: 50, etiqueta: 'DOS' },
    { linea: 90, etiqueta: 'TRES' },
  ];
  assert.deepStrictEqual(
    etiquetasDeHunks([{ inicio: 40, fin: 95 }], anclas),
    ['UNO', 'DOS', 'TRES']
  );
});

test('etiquetasDeHunks marca lo anterior a la primera ancla', () => {
  const anclas = [{ linea: 100, etiqueta: 'UNO' }];
  assert.deepStrictEqual(etiquetasDeHunks([{ inicio: 5, fin: 6 }], anclas), [
    '(antes del primer bloque)',
  ]);
});

test('etiquetasDeHunks no repite etiquetas', () => {
  const anclas = [{ linea: 10, etiqueta: 'UNO' }];
  assert.deepStrictEqual(
    etiquetasDeHunks([{ inicio: 20, fin: 21 }, { inicio: 30, fin: 31 }], anclas),
    ['UNO']
  );
});

test('etiquetasDeHunks devuelve vacío sin anclas ni hunks', () => {
  assert.deepStrictEqual(etiquetasDeHunks([], []), []);
});
