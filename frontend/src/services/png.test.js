import { test } from 'node:test';
import assert from 'node:assert';
import { crc32, aFilasPNG, codificarPNG, aBase64 } from './png.js';

/* 0xAE426082 es el CRC del trozo IEND, constante conocida de la
   especificación PNG: sirve de vector de prueba independiente. */
test('crc32 coincide con la constante conocida de IEND', () => {
  assert.strictEqual(crc32(new Uint8Array([0x49, 0x45, 0x4e, 0x44])), 0xae426082);
});

test('aFilasPNG antepone el byte de filtro a cada fila', () => {
  const filas = aFilasPNG(new Uint8Array([1, 2, 3, 4, 5, 6]), 2, 1);
  assert.deepStrictEqual(Array.from(filas), [0, 1, 2, 3, 4, 5, 6]);
});

test('aFilasPNG separa correctamente varias filas', () => {
  const filas = aFilasPNG(new Uint8Array([1, 1, 1, 2, 2, 2]), 1, 2);
  assert.deepStrictEqual(Array.from(filas), [0, 1, 1, 1, 0, 2, 2, 2]);
});

test('codificarPNG produce un archivo con la firma correcta', async () => {
  const rgb = new Uint8Array(4 * 4 * 3).fill(200);
  const png = await codificarPNG(rgb, 4, 4);
  assert.deepStrictEqual(Array.from(png.slice(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(png.length > 40, 'el PNG salió demasiado corto');
});

test('aBase64 codifica sin depender del entorno', () => {
  assert.strictEqual(aBase64(new Uint8Array([104, 111, 108, 97])), 'aG9sYQ==');
});
