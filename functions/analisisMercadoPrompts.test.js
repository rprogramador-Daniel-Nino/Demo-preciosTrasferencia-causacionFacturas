const { test } = require('node:test');
const assert = require('node:assert');
const {
  SERIES_MACRO,
  extraerJSON,
  construirPromptBusqueda,
  parsearRespuestaBusqueda,
  construirPromptRedaccion,
  parsearRespuestaRedaccion,
  armarDocumentoFirestore,
} = require('./analisisMercadoPrompts');

test('extraerJSON encuentra el objeto aunque venga envuelto en prosa y marcas markdown', () => {
  const texto = 'Aquí está el resultado:\n```json\n{"a": 1, "b": {"c": "x}y"}}\n```\nListo.';
  const obj = extraerJSON(texto);
  assert.deepStrictEqual(obj, { a: 1, b: { c: 'x}y' } });
});

test('extraerJSON lanza si no hay ninguna llave de apertura', () => {
  assert.throws(() => extraerJSON('sin json aquí'), /no contiene un objeto JSON/);
});

test('construirPromptBusqueda pide las 8 series y la ventana de 4 años', () => {
  const prompt = construirPromptBusqueda(2026);
  SERIES_MACRO.forEach((s) => assert.ok(prompt.includes(s.clave), 'falta la serie ' + s.clave));
  ['2024', '2025', '2026', '2027'].forEach((a) => assert.ok(prompt.includes(a), 'falta el año ' + a));
});

test('parsearRespuestaBusqueda solo confía en una fuenteUrl si aparece en los grounding chunks', () => {
  const texto = JSON.stringify({
    pib_mundial: { valores: { '2026': '3.2' }, fuente: 'FMI', fuenteUrl: 'https://fmi.example/weo' },
    inflacion_colombia: { valores: { '2026': '3.8' }, fuente: 'DANE', fuenteUrl: 'https://dane.example/inventada' },
  });
  const chunks = [{ web: { uri: 'https://fmi.example/weo', title: 'WEO' } }];
  const series = parsearRespuestaBusqueda(texto, chunks);

  assert.strictEqual(series.pib_mundial.confiable, true);
  assert.strictEqual(series.pib_mundial.fuenteUrl, 'https://fmi.example/weo');
  assert.strictEqual(series.inflacion_colombia.confiable, false);
  assert.strictEqual(series.inflacion_colombia.fuenteUrl, null);
});

test('parsearRespuestaBusqueda ignora claves que no están en SERIES_MACRO', () => {
  const texto = JSON.stringify({ serie_inventada: { valores: { '2026': '1' }, fuente: 'x', fuenteUrl: 'https://x' } });
  const series = parsearRespuestaBusqueda(texto, []);
  assert.deepStrictEqual(series, {});
});

test('parsearRespuestaBusqueda descarta una serie sin "valores"', () => {
  const texto = JSON.stringify({ pib_mundial: { fuente: 'FMI', fuenteUrl: 'https://fmi.example' } });
  const series = parsearRespuestaBusqueda(texto, []);
  assert.deepStrictEqual(series, {});
});

test('construirPromptRedaccion solo incluye las series verificadas, con su fuente', () => {
  const series = { pib_mundial: { valores: { '2026': '3.2' }, fuente: 'FMI', fuenteUrl: 'https://fmi.example' } };
  const prompt = construirPromptRedaccion(series, 2026);
  assert.ok(prompt.includes('pib_mundial'));
  assert.ok(prompt.includes('FMI'));
  assert.ok(prompt.includes('https://fmi.example'));
  assert.ok(prompt.includes('"mundial"') && prompt.includes('"colombia"'));
});

test('parsearRespuestaRedaccion exige mundial y colombia como texto', () => {
  const ok = parsearRespuestaRedaccion('{"mundial": "<p>A</p>", "colombia": "<p>B</p>"}');
  assert.deepStrictEqual(ok, { mundial: '<p>A</p>', colombia: '<p>B</p>' });
  assert.throws(() => parsearRespuestaRedaccion('{"mundial": "<p>A</p>"}'), /mundial.*colombia/);
});

test('armarDocumentoFirestore rechaza guardar sin series o sin narrativa', () => {
  assert.throws(() => armarDocumentoFirestore({ series: {}, narrativa: { mundial: 'x', colombia: 'y' }, ahora: new Date() }), /ninguna serie/);
  assert.throws(() => armarDocumentoFirestore({ series: { pib_mundial: {} }, narrativa: null, ahora: new Date() }), /narrativa/);
});

test('armarDocumentoFirestore adjunta la fecha de consulta a cada serie', () => {
  const ahora = new Date('2026-08-01T06:00:00Z');
  const doc = armarDocumentoFirestore({
    series: { pib_mundial: { valores: { '2026': '3.2' }, fuente: 'FMI', fuenteUrl: 'https://fmi.example', confiable: true } },
    narrativa: { mundial: '<p>A</p>', colombia: '<p>B</p>' },
    ahora,
  });
  assert.strictEqual(doc.series.pib_mundial.fechaConsulta, ahora);
  assert.strictEqual(doc.narrativa.mundial, '<p>A</p>');
  assert.strictEqual(doc.actualizadoEn, ahora);
});
