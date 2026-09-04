const { test } = require('node:test');
const assert = require('node:assert');
const { origenPermitido, peticionDeOrigenPermitido } = require('./origenesPermitidos');

test('acepta el origen exacto de producción y de pruebas', () => {
  assert.strictEqual(origenPermitido('https://precios-trasnferencia.web.app'), true);
  assert.strictEqual(origenPermitido('https://precios-trasnferencia-pruebas.web.app'), true);
});

test('acepta un Referer con ruta detrás del origen', () => {
  assert.strictEqual(origenPermitido('https://precios-trasnferencia.web.app/gestor-reportes/'), true);
});

test('rechaza un dominio ajeno, vacío o parecido pero distinto', () => {
  assert.strictEqual(origenPermitido('https://evil.example.com'), false);
  assert.strictEqual(origenPermitido(''), false);
  assert.strictEqual(origenPermitido(undefined), false);
  /* No basta con que empiece parecido: sin la barra, "precios-trasnferencia.web.app.evil.com"
     no debe colarse como si fuera el dominio real. */
  assert.strictEqual(origenPermitido('https://precios-trasnferencia.web.app.evil.com'), false);
});

test('peticionDeOrigenPermitido acepta si Origin o Referer son válidos', () => {
  const conOrigin = { get: (h) => (h === 'origin' ? 'https://precios-trasnferencia.web.app' : '') };
  const conReferer = { get: (h) => (h === 'referer' ? 'https://precios-trasnferencia-pruebas.web.app/' : '') };
  const sinNinguno = { get: () => '' };
  assert.strictEqual(peticionDeOrigenPermitido(conOrigin), true);
  assert.strictEqual(peticionDeOrigenPermitido(conReferer), true);
  assert.strictEqual(peticionDeOrigenPermitido(sinNinguno), false);
});
