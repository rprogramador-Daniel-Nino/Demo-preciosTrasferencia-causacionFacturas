const { test } = require('node:test');
const assert = require('node:assert');
const { crearLimitadorPorIp, ipDeLaPeticion } = require('./limitadorTasa');

test('permite hasta el tope y rechaza la siguiente dentro de la misma ventana', () => {
  let t = 0;
  const limitador = crearLimitadorPorIp({ maxPorMinuto: 3, ahora: () => t });
  assert.strictEqual(limitador.permitir('1.2.3.4'), true);
  assert.strictEqual(limitador.permitir('1.2.3.4'), true);
  assert.strictEqual(limitador.permitir('1.2.3.4'), true);
  assert.strictEqual(limitador.permitir('1.2.3.4'), false);
});

test('cada IP tiene su propio cupo', () => {
  let t = 0;
  const limitador = crearLimitadorPorIp({ maxPorMinuto: 1, ahora: () => t });
  assert.strictEqual(limitador.permitir('1.2.3.4'), true);
  assert.strictEqual(limitador.permitir('5.6.7.8'), true);
  assert.strictEqual(limitador.permitir('1.2.3.4'), false);
});

test('la ventana deslizante libera cupo con el tiempo', () => {
  let t = 0;
  const limitador = crearLimitadorPorIp({ maxPorMinuto: 1, ventanaMs: 60_000, ahora: () => t });
  assert.strictEqual(limitador.permitir('1.2.3.4'), true);
  assert.strictEqual(limitador.permitir('1.2.3.4'), false);
  t += 60_001;
  assert.strictEqual(limitador.permitir('1.2.3.4'), true);
});

test('ipDeLaPeticion prefiere X-Forwarded-For (la IP real detrás del proxy)', () => {
  const req = { get: (h) => (h === 'x-forwarded-for' ? '9.9.9.9, 10.0.0.1' : ''), ip: '10.0.0.1' };
  assert.strictEqual(ipDeLaPeticion(req), '9.9.9.9');
});

test('ipDeLaPeticion cae a req.ip sin X-Forwarded-For', () => {
  const req = { get: () => '', ip: '10.0.0.1' };
  assert.strictEqual(ipDeLaPeticion(req), '10.0.0.1');
});
