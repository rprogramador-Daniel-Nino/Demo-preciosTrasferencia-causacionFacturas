import { test } from 'node:test';
import assert from 'node:assert';
import { clave, hashPlantilla } from './plantillaStore.js';

test('la clave separa estudio y recurso sin ambigüedad', () => {
  assert.strictEqual(clave('estudio_1', 'img_2_1'), 'estudio_1:img_2_1');
});

test('dos estudios distintos nunca comparten clave', () => {
  assert.notStrictEqual(clave('a', 'x'), clave('b', 'x'));
});

test('un id con dos puntos no rompe la clave', () => {
  /* Sin escapar, clave('a:b','c') y clave('a','b:c') colisionarían. */
  assert.notStrictEqual(clave('a:b', 'c'), clave('a', 'b:c'));
});

test('el hash identifica la plantilla por contenido, no por nombre', async () => {
  const a = await hashPlantilla(new Uint8Array([1, 2, 3]));
  const b = await hashPlantilla(new Uint8Array([1, 2, 3]));
  const c = await hashPlantilla(new Uint8Array([1, 2, 4]));
  assert.strictEqual(a, b, 'mismo contenido debe dar el mismo hash');
  assert.notStrictEqual(a, c, 'contenido distinto debe dar hash distinto');
  assert.match(a, /^[0-9a-f]{16}$/, 'formato del hash');
});
