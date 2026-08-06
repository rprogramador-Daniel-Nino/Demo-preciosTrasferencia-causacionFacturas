import { test } from 'node:test';
import assert from 'node:assert';
import { rasterizarConReintento, recortarPorPagina } from './pdfRenderer.js';

test('recortarPorPagina recorta el rango 1-indexado', () => {
  const imagenes = ['p1', 'p2', 'p3', 'p4'];
  assert.deepStrictEqual(
    recortarPorPagina(imagenes, 2, 3),
    { imagenes: ['p2', 'p3'], delimitada: true },
  );
});

test('recortarPorPagina cae a las imágenes completas si el rango es null', () => {
  const imagenes = ['p1', 'p2'];
  assert.deepStrictEqual(
    recortarPorPagina(imagenes, null, null),
    { imagenes, delimitada: false },
  );
});

test('recortarPorPagina cae a las imágenes completas si el inicio es mayor que el fin', () => {
  const imagenes = ['p1', 'p2', 'p3'];
  assert.deepStrictEqual(
    recortarPorPagina(imagenes, 3, 1),
    { imagenes, delimitada: false },
  );
});

test('recortarPorPagina cae a las imágenes completas si el fin excede el total de páginas', () => {
  const imagenes = ['p1', 'p2'];
  assert.deepStrictEqual(
    recortarPorPagina(imagenes, 1, 5),
    { imagenes, delimitada: false },
  );
});

test('rasterizarConReintento devuelve las imágenes al primer intento', async () => {
  const falso = async () => ['pagina1'];
  const imagenes = await rasterizarConReintento({ name: 'a.pdf' }, { rasterizar: falso });
  assert.deepStrictEqual(imagenes, ['pagina1']);
});

test('rasterizarConReintento reintenta tras un fallo transitorio y luego tiene éxito', async () => {
  let llamadas = 0;
  const falso = async () => {
    llamadas++;
    if (llamadas < 2) throw new Error('fallo transitorio');
    return ['pagina1'];
  };
  const imagenes = await rasterizarConReintento({ name: 'a.pdf' }, { esperaMs: 0, rasterizar: falso });
  assert.deepStrictEqual(imagenes, ['pagina1']);
  assert.strictEqual(llamadas, 2);
});

test('rasterizarConReintento reintenta si el rasterizador devuelve un arreglo vacío', async () => {
  let llamadas = 0;
  const falso = async () => {
    llamadas++;
    return llamadas < 2 ? [] : ['pagina1'];
  };
  const imagenes = await rasterizarConReintento({ name: 'a.pdf' }, { esperaMs: 0, rasterizar: falso });
  assert.deepStrictEqual(imagenes, ['pagina1']);
});

test('rasterizarConReintento agota los intentos y devuelve un arreglo vacío sin relanzar', async () => {
  const falso = async () => { throw new Error('siempre falla'); };
  const imagenes = await rasterizarConReintento({ name: 'a.pdf' }, { intentos: 2, esperaMs: 0, rasterizar: falso });
  assert.deepStrictEqual(imagenes, []);
});
