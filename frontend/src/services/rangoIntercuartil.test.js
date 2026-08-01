import { test } from 'node:test';
import assert from 'node:assert';
import { analizarRango } from './rangoIntercuartil.js';

const conComparables = {
  pli: 'MO', t_s: 100000, t_c: 80000, t_op: 10000,
  comparables: [
    { s: 1000, c: 800, op: 100 }, { s: 2000, c: 1600, op: 260 },
    { s: 3000, c: 2400, op: 300 }, { s: 4000, c: 3200, op: 520 },
  ],
};

test('con cuatro comparables sale el rango completo y ordenado', () => {
  const r = analizarRango(conComparables);
  assert.ok(r.stats, 'debería haber rango');
  assert.ok(r.stats.p25 <= r.stats.med && r.stats.med <= r.stats.p75, 'cuartiles desordenados');
});

test('con menos de tres comparables no hay rango', () => {
  assert.strictEqual(analizarRango({ ...conComparables, comparables: [{ s: 1, c: 1, op: 1 }] }).stats, null);
  assert.strictEqual(analizarRango({}).stats, null);
});

/* Comportamiento heredado de exactTemplateMapper.js. Se conserva exactamente:
   cambiarlo alteraría los informes que hoy salen por esa ruta. */
test('sin rango, la conclusión heredada sigue siendo CUMPLE', () => {
  assert.strictEqual(analizarRango({}).cumple, 'CUMPLE');
  assert.strictEqual(analizarRango({}).adj, null);
});

test('una comparable sin PLI calculable no rompe el resto', () => {
  const r = analizarRango({
    ...conComparables,
    comparables: [...conComparables.comparables, { s: null, c: null, op: null }],
  });
  assert.ok(r.stats, 'la comparable inservible debe descartarse, no tumbar el cálculo');
});
