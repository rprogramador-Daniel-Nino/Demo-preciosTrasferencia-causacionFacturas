const { test } = require('node:test');
const assert = require('node:assert');
const { esUrlBloqueada, URLS_BLOQUEADAS } = require('./urlsBloqueadas.js');

test('functions: esUrlBloqueada devuelve true para URLs confirmadas rotas en la lista negra', () => {
  const urlDePrueba = 'https://www.banrep.gov.co/es/estadisticas/tasa-intervencion-politica-monetaria';
  assert.strictEqual(esUrlBloqueada(urlDePrueba), true);
  assert.ok(URLS_BLOQUEADAS.has(urlDePrueba));
});

test('functions: esUrlBloqueada devuelve false para URLs normales no bloqueadas', () => {
  assert.strictEqual(esUrlBloqueada('https://www.google.com'), false);
  assert.strictEqual(esUrlBloqueada('https://www.banrep.gov.co'), false);
});

test('functions: esUrlBloqueada maneja valores nulos, vacíos o indefinidos de forma segura sin fallar', () => {
  assert.strictEqual(esUrlBloqueada(null), false);
  assert.strictEqual(esUrlBloqueada(undefined), false);
  assert.strictEqual(esUrlBloqueada(''), false);
});
