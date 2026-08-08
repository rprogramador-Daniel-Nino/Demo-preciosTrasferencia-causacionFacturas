import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
  ).toString();
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
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(arrayBuffer),
      isOffscreenCanvasSupported: false
    });
    
    const pdfDoc = await loadingTask.promise;
    const images = [];

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/png');
      images.push(dataUrl);
    }

    return images;
  } catch (err) {
    console.error("Error al convertir PDF a imágenes:", err);
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
