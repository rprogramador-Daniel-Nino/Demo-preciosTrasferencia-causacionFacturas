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

/* `html.length > 1000` no distingue un informe de un esqueleto de etiquetas
   vacías: <p></p> repetido ya supera los 1000 caracteres. Estos dos tests
   miran el texto, que es lo que se perdía. */
test('el HTML lleva el texto del informe dentro de las etiquetas', async () => {
  const r = await extraer();
  const soloTexto = r.html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  assert.ok(
    soloTexto.length > 20000,
    'el HTML salió con la estructura pero sin texto: ' + soloTexto.length + ' caracteres'
  );
  assert.ok(soloTexto.includes('END GAME'), 'no aparece la razón social del informe');
  /* La razón social se repite en decenas de páginas y casi siempre parte entre
     dos renglones. Si el salto de línea no se convierte en espacio queda
     "COLOMBIAS.A.S", que ya no coincide con las reglas de sustitución del
     informe y deja el nombre del cliente anterior en el documento nuevo. */
  assert.ok(
    !soloTexto.includes('COLOMBIAS.A.S') && !soloTexto.includes('COLOMBIASAS'),
    'el salto de línea pegó las palabras: la razón social quedó sin separar'
  );
  assert.ok(soloTexto.includes('INTRODUCCIÓN'), 'no aparece el título de la primera sección');
});

test('el texto queda dentro de la etiqueta que le corresponde', async () => {
  const r = await extraer();
  /* Si el texto se asignara por orden de aparición en vez de por el id del
     contenido marcado, encajaría en las etiquetas equivocadas y ningún
     encabezado traería su propio título. */
  const encabezados = [...r.html.matchAll(/<h[1-6]>([^<]*)<\/h[1-6]>/g)].map((m) => m[1].trim());
  assert.ok(
    encabezados.some((t) => t.toUpperCase().includes('INTRODUCCIÓN')),
    'ningún encabezado contiene "INTRODUCCIÓN": ' + JSON.stringify(encabezados.slice(0, 10))
  );
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

test('las marcas del HTML apuntan al recurso y no cargan el base64', async () => {
  const r = await extraer();
  /* El logo del encabezado se dibuja en decenas de páginas. Si cada marca
     llevara su propia copia del data URL, el HTML que va a IndexedDB pesaría
     megabytes en vez de cientos de kilobytes. */
  assert.ok(!/<img[^>]*data:image/.test(r.html), 'una marca trae el base64 incrustado');
  const ids = r.imagenes.map((i) => i.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'hay recursos con id repetido');
  const marcadas = [...r.html.matchAll(/<img data-recurso="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(marcadas.length > 0, 'el HTML no trae ninguna marca de imagen');
  assert.ok(
    marcadas.every((id) => ids.includes(id)),
    'hay marcas que no corresponden a ningún recurso del catálogo'
  );
});

test('recupera las imágenes globales del documento', async () => {
  const r = await extraer();
  /* El logo del encabezado se repite en casi todas las páginas, así que pdf.js
     lo guarda como objeto global (clave con prefijo g_) en commonObjs y no en
     los objs de la página. La primera página donde aparece con esa clave es la
     6. Pedirlo al almacén equivocado no falla: se queda esperando. */
  assert.ok(
    r.imagenes.some((i) => i.pagina === 6),
    'no se recuperó la imagen global de la página 6'
  );
});

test('un buffer que no es PDF falla con un mensaje claro', async () => {
  await assert.rejects(
    () => extraerReferencia(new Uint8Array([1, 2, 3, 4])),
    /no se pudo leer el PDF/i
  );
});

/* --- Colocación de las imágenes en el flujo del texto --- */

test('las imágenes van donde el árbol las declara, no al final de la página', async () => {
  const r = await extraer();
  /* El organigrama del informe va entre su título y su línea de fuente. Antes se
     emitía detrás del bloque entero de la página, así que en el Word aparecía
     lejos del texto que lo explica. */
  const i = r.html.indexOf('Organigrama de la compañía');
  assert.ok(i > 0, 'no se encontró el título del gráfico');
  const despues = r.html.slice(i, i + 400);
  const posImg = despues.indexOf('<img data-recurso=');
  const posFuente = despues.indexOf('Fuente:');
  assert.ok(posImg > 0, 'no hay imagen tras el título del gráfico: ' + despues.slice(0, 120));
  assert.ok(
    posFuente > posImg,
    'la imagen debe ir antes de su línea de fuente, no después'
  );
});

test('no quedan marcadores de figura sin resolver', async () => {
  const r = await extraer();
  assert.ok(!r.html.includes('<!--FIG:'), 'quedó un marcador de figura sin imagen');
  assert.strictEqual(r.figurasSinDibujo, 0, 'hay figuras que ningún dibujo reclamó');
});

test('el logo del encabezado sale una vez, no en cada página', async () => {
  const r = await extraer();
  /* Se dibuja en casi cien páginas y antes se emitía una marca por dibujo: el
     documento salía con noventa y seis imágenes, casi todas el mismo logo
     repetido y fuera de sitio. */
  const marcas = (r.html.match(/<img data-recurso=/g) || []).length;
  assert.ok(marcas <= 8, 'demasiadas marcas de imagen, el logo se está repitiendo: ' + marcas);
  /* Y una sola vez cada contenido distinto: pdf.js promueve a global una imagen
     repetida, así que el mismo logo llega con dos claves y por clave saldría dos
     veces seguidas al abrir el documento. */
  const ids = [...r.html.matchAll(/<img data-recurso="([^"]+)"/g)].map((m) => m[1]);
  const urls = ids.map((id) => (r.imagenes.find((im) => im.id === id) || {}).dataUrl);
  assert.strictEqual(new Set(urls).size, urls.length, 'la misma imagen se emitió dos veces');
});

test('el hueco del anexo queda en su sitio del documento', async () => {
  const r = await extraer();
  /* El encabezado de la sección, no su entrada del índice: «ANEXO A. Estados
     financieros» aparece primero en la tabla de contenido, noventa mil
     caracteres antes, y medir desde ahí no dice nada de dónde quedó el hueco. */
  const m = /<h1>[^<]*ANEXO A\. Estados financieros[^<]*<\/h1>/.exec(r.html);
  assert.ok(m, 'no se encontró el encabezado del ANEXO A');
  const iTitulo = m.index + m[0].length;
  const iHueco = r.html.indexOf('data-hueco="anexo_eeff"');
  assert.ok(iHueco > 0, 'falta el hueco del anexo');
  assert.ok(iHueco > iTitulo, 'el hueco debe ir después del encabezado del ANEXO A');
  assert.ok(
    iHueco - iTitulo < 300,
    'el hueco quedó lejos de su encabezado: ' + (iHueco - iTitulo) + ' caracteres'
  );
});
