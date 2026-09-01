import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
  ).toString();
}

/* Una página rasterizada. Lo comparten `convertPdfToImages` —que rasteriza el documento
   completo para el ANEXO A— y `rasterizarPaginas` —que rasteriza solo las páginas escaneadas
   para transcribirlas.

   La escala 1.5 viene de la versión original y no se toca: subirla mejoraría el OCR pero
   engordaría también las imágenes del ANEXO A, que viven en IndexedDB con su propio límite.

   EL FORMATO SÍ CAMBIA SEGÚN EL DESTINO. El ANEXO A adjunta las páginas al informe y se queda
   en PNG, que es lo que ya publicaba. La transcripción viaja en el cuerpo de una petición HTTP
   con dos topes duros —32 MiB de cuerpo en Cloud Run y 50 s de corte en el proxy de Gemini—, y
   un escaneo en PNG a esta escala pesa de 1 a 3 MB por página: veinticinco de esas, en base64,
   no caben ni de lejos. En JPEG al 82 % la misma página pesa una fracción y el texto impreso
   se lee igual — la pérdida de JPEG se nota en degradados, no en tinta negra sobre papel. */
async function renderizarPagina(page, escala = 1.5, formato = 'image/png', calidad = 0.82) {
  const viewport = page.getViewport({ scale: escala });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  /* JPEG no tiene canal alfa: sin fondo, el canvas transparente se revela como negro y la
     página sale en negativo. */
  if (formato === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL(formato, calidad);
}

/** Abre el PDF con las mismas opciones en los dos caminos de rasterizado. */
async function abrirPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  return pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    isOffscreenCanvasSupported: false
  }).promise;
}

/**
 * Convierte un archivo PDF o Imagen a un array de DataURLs de imágenes (PNG/JPEG)
 */
export async function convertPdfToImages(file) {
  if (!file) return [];

  // Si es un archivo de imagen directo
  if (file.type && file.type.startsWith('image/')) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve([e.target.result]);
      reader.readAsDataURL(file);
    });
  }

  // Si es un PDF
  try {
    const pdfDoc = await abrirPdf(file);
    const images = [];

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      images.push(await renderizarPagina(page));
    }

    return images;
  } catch (err) {
    console.error("Error al convertir PDF a imágenes:", err);
    return [];
  }
}

/**
 * Rasteriza SOLO las páginas pedidas, en el orden pedido.
 *
 * Para el respaldo por OCR: en Inoxpa hay 24 páginas sin capa de texto de 29, y en Aluminios y
 * Vidrios 5 de 50. Rasterizar el documento entero para transcribir esas pocas gastaría CPU y
 * —sobre todo— mandaría al modelo un documento largo del que se salta páginas.
 *
 * Los números son en base 1, como los devuelve `paginasSinTextoUtilizable`. Las páginas fuera
 * de rango se omiten en silencio en lugar de fallar: el llamador degrada a «sin respaldo», que
 * es el comportamiento de hoy, y una página de menos no justifica perder las demás.
 *
 * Sale en JPEG y no en PNG porque el destino es el cuerpo de una petición HTTP con tope; ver
 * `renderizarPagina`. El ANEXO A sigue en PNG.
 */
export async function rasterizarPaginas(file, numerosPagina) {
  if (!file || !Array.isArray(numerosPagina) || numerosPagina.length === 0) return [];
  if (file.type && file.type.startsWith('image/')) return [];

  try {
    const pdfDoc = await abrirPdf(file);
    const imagenes = [];
    for (const numero of numerosPagina) {
      if (!Number.isInteger(numero) || numero < 1 || numero > pdfDoc.numPages) continue;
      const page = await pdfDoc.getPage(numero);
      imagenes.push(await renderizarPagina(page, 1.5, 'image/jpeg'));
    }
    return imagenes;
  } catch (err) {
    console.error('Error al rasterizar las páginas pedidas:', err);
    return [];
  }
}

/**
 * Rasteriza un PDF a imágenes, reintentando si falla o devuelve un arreglo vacío.
 *
 * Es trabajo local de CPU (canvas/pdf.js), no una llamada de red: por eso la espera
 * entre intentos es fija y corta, sin el backoff exponencial que sí tiene sentido para
 * errores HTTP transitorios (ver `postGeminiWithRetry` en `eeffParser.js`). No relanza:
 * el llamador siempre recibe un arreglo, posiblemente vacío, y decide el aviso.
 */
export async function rasterizarConReintento(file, { intentos = 3, esperaMs = 1000, rasterizar = convertPdfToImages } = {}) {
  let ultimoError;
  for (let i = 1; i <= intentos; i++) {
    try {
      const imagenes = await rasterizar(file);
      if (imagenes && imagenes.length) return imagenes;
      ultimoError = new Error('el rasterizado devolvió un arreglo vacío');
    } catch (err) {
      ultimoError = err;
    }
    if (i < intentos) await new Promise((r) => setTimeout(r, esperaMs));
  }
  console.error('[rasterizarConReintento] agotados los intentos:', ultimoError);
  return [];
}

/**
 * Recorta un arreglo de páginas rasterizadas al rango (1-indexado) de una empresa dentro
 * de un PDF de lote que trae varias. Si el rango no viene, es inválido, o se sale del
 * total de páginas, se degrada devolviendo el arreglo completo con `delimitada: false` —
 * nunca se descarta la imagen por un rango sospechoso.
 */
export function recortarPorPagina(imagenes, paginaInicio, paginaFin) {
  const total = imagenes.length;
  const inicioValido = Number.isInteger(paginaInicio) && paginaInicio >= 1;
  const finValido = inicioValido && Number.isInteger(paginaFin) && paginaFin >= paginaInicio && paginaFin <= total;
  if (!inicioValido || !finValido) {
    return { imagenes, delimitada: false };
  }
  return { imagenes: imagenes.slice(paginaInicio - 1, paginaFin), delimitada: true };
}
