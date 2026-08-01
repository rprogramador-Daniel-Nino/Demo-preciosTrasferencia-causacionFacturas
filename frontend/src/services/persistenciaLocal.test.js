import { test } from 'node:test';
import assert from 'node:assert';
import { guardarJSON } from './persistenciaLocal.js';

function conLocalStorageFalso(setItemImpl, fn) {
  const previo = global.localStorage;
  const llamadas = [];
  global.localStorage = {
    setItem: (k, v) => { llamadas.push([k, v]); setItemImpl(k, v); },
  };
  try {
    return fn(llamadas);
  } finally {
    if (previo) global.localStorage = previo; else delete global.localStorage;
  }
}

test('guardarJSON escribe el valor serializado y devuelve true si localStorage no falla', () => {
  conLocalStorageFalso(() => {}, (llamadas) => {
    const ok = guardarJSON('pt:study:x', { a: 1 });
    assert.strictEqual(ok, true);
    assert.strictEqual(llamadas.length, 1);
    assert.strictEqual(llamadas[0][0], 'pt:study:x');
    assert.strictEqual(llamadas[0][1], JSON.stringify({ a: 1 }));
  });
});

test('guardarJSON no lanza y devuelve false cuando localStorage.setItem excede la cuota', () => {
  conLocalStorageFalso(() => {
    throw new DOMException('exceeded the quota', 'QuotaExceededError');
  }, () => {
    let resultado;
    assert.doesNotThrow(() => { resultado = guardarJSON('pt:study:grande', { universo: new Array(10000).fill('x') }); });
    assert.strictEqual(resultado, false);
  });
});
