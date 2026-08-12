import { test } from 'node:test';
import assert from 'node:assert';
import { obtenerEstudioNormalizadoParaParche } from './estudioNormalizado.js';

test('sin estudio devuelve un objeto vacío', () => {
  assert.deepStrictEqual(obtenerEstudioNormalizadoParaParche(null), {});
  assert.deepStrictEqual(obtenerEstudioNormalizadoParaParche(undefined), {});
});

test('no muta el estudio original', () => {
  /* El objeto que recibe es el que el resto de la aplicación tiene en memoria: si se
     le reescribe `t_op`, todo el que lo lea después leerá gastos donde esperaba
     utilidad. */
  const original = {
    t_s: 1000, t_c: 600, t_op: 100,
    comparables: [{ name: 'ANDINA', s: 100, c: 60, op: 10 }],
  };
  const copia = obtenerEstudioNormalizadoParaParche(original);
  assert.strictEqual(original.t_op, 100);
  assert.strictEqual(original.comparables[0].op, 10);
  assert.notStrictEqual(copia, original);
  assert.notStrictEqual(copia.comparables[0], original.comparables[0]);
});

test('traduce la utilidad operacional del contribuyente a gastos operativos', () => {
  const c = obtenerEstudioNormalizadoParaParche({ t_s: 1000, t_c: 600, t_op: 100 });
  assert.strictEqual(c.t_op, 300, 'opex = 1000 − 600 − 100');
});

test('traduce también la de cada comparable', () => {
  const c = obtenerEstudioNormalizadoParaParche({
    t_s: 1000, t_c: 600, t_op: 100,
    comparables: [{ name: 'ANDINA', s: 100, c: 60, op: 10 }],
  });
  assert.strictEqual(c.comparables[0].op, 30, 'opex = 100 − 60 − 10');
});

test('lee las cifras desde T cuando el estudio no las trae sueltas', () => {
  /* Este respaldo es la diferencia que había entre las dos copias duplicadas: la del
     modal leía solo `t_s` y con un estudio en forma de `T` producía un libro vacío. */
  const c = obtenerEstudioNormalizadoParaParche({ T: { s: 1000, c: 600, op: 100 } });
  assert.strictEqual(c.t_op, 300);
});
