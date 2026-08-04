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

/* `filas` alimenta las tablas 17 y 19 del informe. Sale de aquí y no de un cálculo
   aparte para que la lista de márgenes publicada sea la misma que sustenta el rango. */
test('filas trae el margen de cada comparable, ajustado y sin ajustar', () => {
  const r = analizarRango({
    ...conComparables,
    comparables: [{ name: 'ACME LTDA', amb: 'Nac', s: 1000, c: 800, op: 100 }],
  });
  assert.strictEqual(r.filas.length, 1);
  assert.strictEqual(r.filas[0].nombre, 'ACME LTDA');
  assert.strictEqual(r.filas[0].amb, 'Nac');
  assert.strictEqual(r.filas[0].noAjustado, 0.1, 'MO = 100 / 1000');
  /* Sin `useadj` el ajuste no corre y el ajustado es el mismo margen. */
  assert.strictEqual(r.filas[0].ajustado, 0.1);
});

test('la comparable sin cifras aparece en filas con margen nulo', () => {
  /* No se omite: es parte de la muestra final y la tabla 17 la numera. Omitirla en la
     19 dejaría dos tablas de distinto tamaño sin nada que lo explique. */
  const r = analizarRango({ ...conComparables, comparables: [{ name: 'SIN DATOS S.A.', s: '', c: '', op: '' }] });
  assert.strictEqual(r.filas.length, 1);
  assert.strictEqual(r.filas[0].noAjustado, null);
  assert.strictEqual(r.filas[0].ajustado, null);
  assert.strictEqual(r.filas[0].amb, 'Int', 'sin ámbito declarado se asume internacional');
});

test('los cuartiles no cambiaron al extraer las filas', () => {
  /* Red de seguridad del refactor: `stats` se calculaba antes recorriendo
     `comparables` directamente y ahora se deriva de `filas`. */
  const r = analizarRango(conComparables);
  assert.deepStrictEqual(
    r.filas.map((f) => f.ajustado),
    [0.1, 0.13, 0.1, 0.13],
    'los márgenes por comparable deben salir en el orden en que están en el estudio'
  );
  /* Serie ordenada: 0,10 · 0,10 · 0,13 · 0,13. `quart` no interpola —toma el elemento
     en la posición truncada (`calculations.js:158`)—, así que la mediana es 0,10. Se
     fija el valor que da hoy, que es el punto de este test: el refactor no movió el
     rango de ningún informe ya generado. */
  assert.strictEqual(r.stats.med, 0.1);
});
