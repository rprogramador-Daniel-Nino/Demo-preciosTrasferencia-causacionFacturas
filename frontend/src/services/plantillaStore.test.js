import { test } from 'node:test';
import assert from 'node:assert';
import { hashPlantilla, claveMarcado } from './plantillaStore.js';

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

/* Las tres cosas viven en el mismo almacén distinguidas solo por prefijo. Si
   dos claves colisionaran, un estudio leería la plantilla de otro. */
test('la clave del marcado no colisiona con el HTML crudo ni con el vínculo', () => {
  assert.notStrictEqual(claveMarcado('abc123'), 'abc123', 'colisiona con el HTML crudo');
  assert.notStrictEqual(claveMarcado('abc123'), 'vinculo:abc123', 'colisiona con el vínculo');
  assert.strictEqual(claveMarcado('abc123'), 'marcado:abc123');
});

test('plantillas distintas dan claves de marcado distintas', () => {
  assert.notStrictEqual(claveMarcado('abc'), claveMarcado('abd'));
});
