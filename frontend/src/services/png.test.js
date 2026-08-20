import { test } from 'node:test';
import assert from 'node:assert';
import { crc32, aFilasPNG, codificarPNG, aBase64, deBase64, dimensionesDeImagen } from './png.js';

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

test('deBase64 es el inverso de aBase64', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
  assert.deepStrictEqual(Array.from(deBase64(aBase64(bytes))), Array.from(bytes));
});

test('deBase64 ignora los saltos de línea de un base64 envuelto', () => {
  assert.deepStrictEqual(Array.from(deBase64('aG9s\nYQ==')), [104, 111, 108, 97]);
});

test('deBase64 devuelve un arreglo vacío ante entrada vacía o nula', () => {
  assert.strictEqual(deBase64('').length, 0);
  assert.strictEqual(deBase64(null).length, 0);
});

test('dimensionesDeImagen lee el IHDR de un PNG recién codificado', async () => {
  const png = await codificarPNG(new Uint8Array(7 * 3 * 3).fill(200), 7, 3);
  assert.deepStrictEqual(dimensionesDeImagen(png), { ancho: 7, alto: 3 });
});

test('dimensionesDeImagen lee anchos de más de un byte', async () => {
  const png = await codificarPNG(new Uint8Array(300 * 2 * 3).fill(0), 300, 2);
  assert.deepStrictEqual(dimensionesDeImagen(png), { ancho: 300, alto: 2 });
});

/* Un JPEG mínimo: firma, un APP0 que hay que saltarse por su longitud, y el SOF0 con
   las dimensiones. Se arma a mano porque `codificarPNG` no produce JPEG y no hay
   dependencia en el proyecto que lo haga. */
function jpegMinimo(ancho, alto, { marca = 0xc0 } = {}) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x41, 0x42,
    0xff, marca, 0x00, 0x11, 0x08,
    (alto >> 8) & 0xff, alto & 0xff,
    (ancho >> 8) & 0xff, ancho & 0xff,
    0x03,
  ]);
}

test('dimensionesDeImagen lee el SOF0 de un JPEG saltándose el APP0', () => {
  assert.deepStrictEqual(dimensionesDeImagen(jpegMinimo(1240, 1754)), { ancho: 1240, alto: 1754 });
});

test('dimensionesDeImagen reconoce el SOF2 de un JPEG progresivo', () => {
  assert.deepStrictEqual(dimensionesDeImagen(jpegMinimo(40, 20, { marca: 0xc2 })), { ancho: 40, alto: 20 });
});

/* 0xC4 cae en el mismo rango que los SOF pero es la tabla de Huffman: tomarlo por uno
   devolvería como dimensiones dos bytes cualesquiera de la tabla. */
test('dimensionesDeImagen no confunde la tabla de Huffman con un SOF', () => {
  assert.strictEqual(dimensionesDeImagen(jpegMinimo(40, 20, { marca: 0xc4 })), null);
});

test('dimensionesDeImagen devuelve null ante lo que no es PNG ni JPEG', () => {
  assert.strictEqual(dimensionesDeImagen(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), null);
  assert.strictEqual(dimensionesDeImagen(new Uint8Array(0)), null);
  assert.strictEqual(dimensionesDeImagen(null), null);
});

test('dimensionesDeImagen devuelve null ante un PNG truncado antes del IHDR', async () => {
  const png = await codificarPNG(new Uint8Array(4 * 4 * 3).fill(0), 4, 4);
  assert.strictEqual(dimensionesDeImagen(png.slice(0, 20)), null);
});
