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
