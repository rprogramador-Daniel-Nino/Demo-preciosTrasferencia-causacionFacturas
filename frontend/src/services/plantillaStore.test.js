import { test } from 'node:test';
import assert from 'node:assert';
import { hashPlantilla } from './plantillaStore.js';

test('el hash no colisiona con el de cero bytes', async () => {
  /* Regresión: si se hashea un buffer ya desprendido por pdf.js, digest no
     falla, hashea cero bytes, y todos los PDF comparten identificador. */
  const vacio = await hashPlantilla(new Uint8Array(0));
  const conDatos = await hashPlantilla(new Uint8Array([1, 2, 3, 4, 5]));
  assert.notStrictEqual(conDatos, vacio, 'el hash de datos reales igualó al de cero bytes');
});

test('el hash identifica la plantilla por contenido, no por nombre', async () => {
  const a = await hashPlantilla(new Uint8Array([1, 2, 3]));
  const b = await hashPlantilla(new Uint8Array([1, 2, 3]));
  const c = await hashPlantilla(new Uint8Array([1, 2, 4]));
  assert.strictEqual(a, b, 'mismo contenido debe dar el mismo hash');
  assert.notStrictEqual(a, c, 'contenido distinto debe dar hash distinto');
  assert.match(a, /^[0-9a-f]{16}$/, 'formato del hash');
});
