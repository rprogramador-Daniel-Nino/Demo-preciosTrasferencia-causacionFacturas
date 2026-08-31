/* Pruebas del diccionario compartido de vocabulario para los campos de EEFF que pueden
   desglosarse solo en una nota (costo de ventas, partes relacionadas, inventarios). Puro:
   sin Firestore — eso vive en firestoreRepo.js. */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  UMBRAL_MADUREZ, diccionarioVacio, normalizarPalabra, esMaduro, contienePalabraConocida,
  agregarPalabras,
} from './vocabularioEeff.js';

test('un diccionario vacío no tiene palabras ni madurez', () => {
  assert.deepStrictEqual(diccionarioVacio(), { palabras: [], estudiosSinPalabraNueva: 0 });
});

test('normaliza minúsculas, tildes y espacios de más', () => {
  assert.strictEqual(normalizarPalabra('  Relacionadas  '), 'relacionadas');
  assert.strictEqual(normalizarPalabra('VINCULADAS ECONÓMICAS'), 'vinculadas economicas');
});

test('normalizarPalabra de algo vacío es cadena vacía, no lanza', () => {
  assert.strictEqual(normalizarPalabra(null), '');
  assert.strictEqual(normalizarPalabra(undefined), '');
});

test('un diccionario nuevo (contador en 0) no es maduro', () => {
  assert.strictEqual(esMaduro(diccionarioVacio()), false);
});

test('un diccionario con el contador por debajo del umbral no es maduro', () => {
  assert.strictEqual(esMaduro({ palabras: ['relacionadas'], estudiosSinPalabraNueva: UMBRAL_MADUREZ - 1 }), false);
});

test('un diccionario con el contador en el umbral (o más) sí es maduro', () => {
  assert.strictEqual(esMaduro({ palabras: ['relacionadas'], estudiosSinPalabraNueva: UMBRAL_MADUREZ }), true);
  assert.strictEqual(esMaduro({ palabras: ['relacionadas'], estudiosSinPalabraNueva: UMBRAL_MADUREZ + 5 }), true);
});

test('esMaduro admite un umbral distinto, para poder probar sin esperar 20', () => {
  assert.strictEqual(esMaduro({ palabras: [], estudiosSinPalabraNueva: 2 }, 2), true);
});

test('contienePalabraConocida encuentra una palabra del diccionario en el texto, sin importar mayúsculas', () => {
  const diccionario = { palabras: ['vinculadas economicas', 'matriz'], estudiosSinPalabraNueva: 30 };
  assert.strictEqual(contienePalabraConocida('Cuentas por pagar a VINCULADAS ECONÓMICAS', diccionario), true);
});

test('contienePalabraConocida no encuentra nada si ninguna palabra aparece', () => {
  const diccionario = { palabras: ['vinculadas economicas', 'matriz'], estudiosSinPalabraNueva: 30 };
  assert.strictEqual(contienePalabraConocida('Cuentas por pagar comerciales y otras cuentas por pagar', diccionario), false);
});

test('contienePalabraConocida con texto vacío o diccionario vacío no lanza y da false', () => {
  assert.strictEqual(contienePalabraConocida('', diccionarioVacio()), false);
  assert.strictEqual(contienePalabraConocida('algo', diccionarioVacio()), false);
  assert.strictEqual(contienePalabraConocida(null, { palabras: ['x'], estudiosSinPalabraNueva: 5 }), false);
});

test('agregarPalabras con una palabra nueva la agrega y resetea el contador', () => {
  const previo = { palabras: ['matriz'], estudiosSinPalabraNueva: 15 };
  const actualizado = agregarPalabras(previo, ['Subsidiaria']);
  assert.deepStrictEqual(actualizado.palabras, ['matriz', 'subsidiaria']);
  assert.strictEqual(actualizado.estudiosSinPalabraNueva, 0);
});

test('agregarPalabras con una palabra ya conocida solo incrementa el contador', () => {
  const previo = { palabras: ['matriz'], estudiosSinPalabraNueva: 15 };
  const actualizado = agregarPalabras(previo, ['Matriz']);
  assert.deepStrictEqual(actualizado.palabras, ['matriz']);
  assert.strictEqual(actualizado.estudiosSinPalabraNueva, 16);
});

test('agregarPalabras no muta el diccionario original', () => {
  const previo = { palabras: ['matriz'], estudiosSinPalabraNueva: 15 };
  agregarPalabras(previo, ['nueva']);
  assert.deepStrictEqual(previo, { palabras: ['matriz'], estudiosSinPalabraNueva: 15 });
});

test('agregarPalabras sobre un diccionario nulo arranca de uno vacío', () => {
  const actualizado = agregarPalabras(null, ['matriz']);
  assert.deepStrictEqual(actualizado, { palabras: ['matriz'], estudiosSinPalabraNueva: 0 });
});

test('agregarPalabras con lista vacía o nula solo incrementa el contador', () => {
  const previo = { palabras: ['matriz'], estudiosSinPalabraNueva: 3 };
  assert.strictEqual(agregarPalabras(previo, []).estudiosSinPalabraNueva, 4);
  assert.strictEqual(agregarPalabras(previo, null).estudiosSinPalabraNueva, 4);
});
