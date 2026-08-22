import { test } from 'node:test';
import assert from 'node:assert';
import { esUrlBloqueada, URLS_BLOQUEADAS } from './urlsBloqueadas.js';

test('esUrlBloqueada devuelve true para URLs confirmadas rotas en la lista negra', () => {
  const urlDePrueba = 'https://www.banrep.gov.co/es/estadisticas/tasa-intervencion-politica-monetaria';
  assert.strictEqual(esUrlBloqueada(urlDePrueba), true);
  assert.ok(URLS_BLOQUEADAS.has(urlDePrueba));
});

test('esUrlBloqueada devuelve false para URLs normales no bloqueadas', () => {
  assert.strictEqual(esUrlBloqueada('https://www.google.com'), false);
  assert.strictEqual(esUrlBloqueada('https://www.banrep.gov.co'), false);
});

test('esUrlBloqueada maneja valores nulos, vacíos o indefinidos de forma segura sin fallar', () => {
  assert.strictEqual(esUrlBloqueada(null), false);
  assert.strictEqual(esUrlBloqueada(undefined), false);
  assert.strictEqual(esUrlBloqueada(''), false);
});
