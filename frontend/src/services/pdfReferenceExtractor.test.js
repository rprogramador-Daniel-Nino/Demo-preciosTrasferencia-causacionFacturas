import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { extraerReferencia } from './pdfReferenceExtractor.js';

const RUTA = 'Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf';

/* Una sola extracción compartida: procesar 112 páginas dos veces duplicaría el
   tiempo del test sin aportar nada. */
let cache = null;
const extraer = async () => {
  if (!cache) cache = await extraerReferencia(new Uint8Array(readFileSync(RUTA)));
  return cache;
};

test('lee la estructura del PDF de referencia real', async () => {
  const r = await extraer();
  assert.strictEqual(r.paginas, 112, 'número de páginas');
  assert.strictEqual(r.etiquetado, true, 'el PDF de referencia está etiquetado');
  assert.ok(r.html.length > 1000, 'el HTML salió vacío');
});

test('detecta el anexo escaneado y no lo guarda como recurso', async () => {
  const r = await extraer();
  /* Las páginas 44 a 58 del PDF real son el anexo de estados financieros
     firmado: quince páginas seguidas con una imagen dominante al 52 %. */
  const paginasConHueco = [...new Set(r.huecos.map((h) => h.pagina))].sort((a, b) => a - b);
  assert.deepStrictEqual(
    paginasConHueco,
    [44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58],
    'las páginas de anexo detectadas no son las esperadas'
  );
});

test('conserva los recursos reutilizables sin colar escaneos', async () => {
  const r = await extraer();
  /* Sólo 5 imágenes únicas quedan fuera del anexo en este documento: los dos
     logos, el banner y un par de gráficos. Si salen muchas más, la detección
     del anexo está fallando. */
  assert.ok(r.imagenes.length <= 8, 'se colaron escaneos como recursos: ' + r.imagenes.length);
  assert.ok(
    r.imagenes.every((i) => typeof i.dataUrl === 'string' && i.dataUrl.startsWith('data:image/')),
    'alguna dataUrl mal formada'
  );
  /* No se exige un número mínimo: fuera del navegador pdf.js deja sin resolver
     las imágenes que no se renderizan, así que la cuenta exacta varía. Que los
     logos aparezcan de verdad se verifica a mano en la Task 6. */
});

test('un buffer que no es PDF falla con un mensaje claro', async () => {
  await assert.rejects(
    () => extraerReferencia(new Uint8Array([1, 2, 3, 4])),
    /no se pudo leer el PDF/i
  );
});
