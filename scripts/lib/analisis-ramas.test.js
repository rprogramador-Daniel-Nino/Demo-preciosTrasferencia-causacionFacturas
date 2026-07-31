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

const { interseccion, ordenarPorSolapamiento } = require('./analisis-ramas');

test('interseccion conserva el orden del primer arreglo', () => {
  assert.deepStrictEqual(interseccion(['c', 'a', 'b'], ['b', 'c']), ['c', 'b']);
});

test('interseccion no repite', () => {
  assert.deepStrictEqual(interseccion(['a', 'a'], ['a']), ['a']);
});

test('interseccion sin coincidencias devuelve vacío', () => {
  assert.deepStrictEqual(interseccion(['a'], ['b']), []);
});

test('ordenarPorSolapamiento pone primero lo que menos choca', () => {
  const entrada = [
    { rama: 'origin/c', solapamiento: ['x'], bloques_en_conflicto_potencial: ['A', 'B'] },
    { rama: 'origin/a', solapamiento: [], bloques_en_conflicto_potencial: [] },
    { rama: 'origin/b', solapamiento: ['x'], bloques_en_conflicto_potencial: ['A'] },
  ];
  assert.deepStrictEqual(
    ordenarPorSolapamiento(entrada).map((c) => c.rama),
    ['origin/a', 'origin/b', 'origin/c']
  );
});

test('ordenarPorSolapamiento no muta la entrada', () => {
  const entrada = [
    { rama: 'origin/b', solapamiento: ['x'], bloques_en_conflicto_potencial: ['A'] },
    { rama: 'origin/a', solapamiento: [], bloques_en_conflicto_potencial: [] },
  ];
  ordenarPorSolapamiento(entrada);
  assert.strictEqual(entrada[0].rama, 'origin/b');
});

test('extraerAnclas reconoce MÓDULO con dos puntos', () => {
  const src = '    // MÓDULO: AUTO-GUARDADO, AUTO-EXPORTACIÓN Y AUTO-LIMPIEZA';
  assert.deepStrictEqual(extraerAnclas(src), [
    { linea: 1, etiqueta: 'MÓDULO: AUTO-GUARDADO, AUTO-EXPORTACIÓN Y AUTO-LIMPIEZA' },
  ]);
});

test('extraerAnclas reconoce banners con borde de guiones', () => {
  const src = '    /* ─── OCR de una página con Claude ─── */';
  assert.deepStrictEqual(extraerAnclas(src), [
    { linea: 1, etiqueta: 'OCR de una página con Claude' },
  ]);
});

test('extraerAnclas reconoce banners en comentario HTML', () => {
  const src = '  <!-- ══════ ACTIVIDAD DE LA EMPRESA ══════ -->';
  assert.deepStrictEqual(extraerAnclas(src), [
    { linea: 1, etiqueta: 'ACTIVIDAD DE LA EMPRESA' },
  ]);
});

test('extraerAnclas toma el título de un banner multilínea', () => {
  const src = [
    '  <script>/* ==========================',
    'MÓDULO OCR REAL + ENRUTADOR',
    'No toca el motor PT.',
  ].join('\n');
  assert.deepStrictEqual(extraerAnclas(src), [
    { linea: 2, etiqueta: 'MÓDULO OCR REAL + ENRUTADOR' },
  ]);
});

test('el título multilínea no se toma de una línea que es solo borde', () => {
  const src = [
    '    /* ═══════════════════',
    '       ═══════════════════',
    '       TÍTULO REAL',
  ].join('\n');
  assert.deepStrictEqual(extraerAnclas(src), [{ linea: 3, etiqueta: 'TÍTULO REAL' }]);
});

test('una función tras un banner sin título conserva el formato estable', () => {
  const src = ['/* ====', '', '', 'function calcularRango(datos) {'].join('\n');
  assert.deepStrictEqual(extraerAnclas(src), [
    { linea: 4, etiqueta: 'función calcularRango()' },
  ]);
});

test('un window.X tras un banner sin título conserva el formato estable', () => {
  const src = ['/* ====', 'window.MOTOR = {'].join('\n');
  assert.deepStrictEqual(extraerAnclas(src), [{ linea: 2, etiqueta: 'window.MOTOR' }]);
});

/* ── orden de integración: main es una rama más, no un contador ── */
const { ordenIntegracion } = require('./analisis-ramas');

const ramaCon = (nombre, faltan, integrable = true) => ({
  rama: nombre,
  integrable,
  commits_que_me_faltan: Array.from({ length: faltan }, (_, i) => ({ sha: 'a' + i })),
});

test('ordenIntegracion pone main primero, antes de los compañeros', () => {
  const orden = ordenIntegracion(ramaCon('origin/main', 2), [
    ramaCon('origin/juandev', 3),
    ramaCon('origin/otro', 1),
  ]);
  assert.deepStrictEqual(orden, ['origin/main', 'origin/juandev', 'origin/otro']);
});

test('ordenIntegracion conserva el orden de compañeros que ya venía dado', () => {
  // ordenarPorSolapamiento los deja de menor a mayor roce; aquí no se reordena.
  const orden = ordenIntegracion(null, [ramaCon('origin/z', 1), ramaCon('origin/a', 1)]);
  assert.deepStrictEqual(orden, ['origin/z', 'origin/a']);
});

test('ordenIntegracion excluye main si no trae nada nuevo', () => {
  const orden = ordenIntegracion(ramaCon('origin/main', 0), [ramaCon('origin/juandev', 2)]);
  assert.deepStrictEqual(orden, ['origin/juandev']);
});

test('ordenIntegracion incluye main aunque no haya ramas de compañeros', () => {
  assert.deepStrictEqual(ordenIntegracion(ramaCon('origin/main', 4), []), ['origin/main']);
});

test('ordenIntegracion excluye lo no integrable aunque tenga commits', () => {
  const orden = ordenIntegracion(ramaCon('origin/main', 2, false), [
    ramaCon('origin/x', 5, false),
  ]);
  assert.deepStrictEqual(orden, []);
});

test('ordenIntegracion tolera principal nulo y compañeros ausentes', () => {
  assert.deepStrictEqual(ordenIntegracion(null, null), []);
  assert.deepStrictEqual(ordenIntegracion(undefined, undefined), []);
});

test('ordenIntegracion no cuenta una rama sin el campo integrable', () => {
  // Defensivo: un objeto de una versión anterior del script no debe colarse.
  const viejo = { rama: 'origin/viejo', commits_que_me_faltan: [{ sha: 'a' }] };
  assert.deepStrictEqual(ordenIntegracion(null, [viejo]), []);
});
