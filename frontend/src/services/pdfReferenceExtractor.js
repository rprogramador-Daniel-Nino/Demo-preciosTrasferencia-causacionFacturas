/* Lectura del PDF que se sube como referencia (el informe del año anterior).
   Devuelve el HTML de su estructura y el catálogo de imágenes clasificadas.
   No conoce el dominio de precios de transferencia ni persiste nada. */

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fraccionDePagina, detectarPaginasDeAnexo } from './clasificadorImagenes.js';
import { codificarPNG, aBase64 } from './png.js';

/* En Node la librería desactiva el worker y autoconfigura esta ruta, por eso
   los tests pasan sin tocar nada. En el navegador no: getDocument construye el
   worker de forma síncrona y lanza si workerSrc no está puesto. Se resuelve con
   la URL del propio módulo para que Vite lo empaquete. */
if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
  ).href;
}

/* pdf.js resuelve los objetos de imagen mientras renderiza la página. Sin
   renderizar —caso de los tests, que corren sin canvas— `objs.get` puede no
   llamar nunca a su callback. Sin este límite la extracción se cuelga entera
   por una sola imagen. */
const TIEMPO_LIMITE_IMAGEN = 5000;

const MAPA_ETIQUETAS = {
  H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', H5: 'h5', H6: 'h6',
  P: 'p', L: 'ul', LI: 'li', Table: 'table', TR: 'tr', TD: 'td', TH: 'th',
};

const escapar = (s) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Composición de matrices de transformación, en el mismo orden que usa pdf.js:
   CTM_nuevo = CTM_viejo x M. */
function componer(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

function conTiempoLimite(promesa, ms) {
  return Promise.race([promesa, new Promise((res) => setTimeout(() => res(null), ms))]);
}

export async function extraerReferencia(datos) {
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: datos }).promise;
  } catch (e) {
    throw new Error('no se pudo leer el PDF: ' + e.message);
  }

  /* --- Primera pasada: estructura y censo de dibujos --- */
  const bloques = [];
  const dibujos = [];
  let etiquetado = false;

  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const vista = pagina.getViewport({ scale: 1 });
    const dimPagina = { ancho: vista.width, alto: vista.height };

    const arbol = await pagina.getStructTree().catch(() => null);
    const texto = await pagina.getTextContent();
    if (arbol) {
      etiquetado = true;
      bloques.push({ pagina: n, html: aHTML(arbol, texto) });
    } else {
      bloques.push({ pagina: n, html: '<p>' + escapar(texto.items.map((i) => i.str).join(' ')) + '</p>' });
    }

    /* La matriz acumulada es la única forma de saber a qué tamaño se dibuja
       una imagen: los argumentos de paintImageXObject traen los píxeles
       intrínsecos, no el tamaño renderizado. */
    const ops = await pagina.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const pila = [];
    let orden = 0;

    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k];
      const args = ops.argsArray[k];
      if (fn === pdfjs.OPS.save) {
        pila.push(ctm.slice());
      } else if (fn === pdfjs.OPS.restore) {
        ctm = pila.pop() || [1, 0, 0, 1, 0, 0];
      } else if (fn === pdfjs.OPS.transform) {
        ctm = componer(ctm, args.length === 1 ? args[0] : args);
      } else if (fn === pdfjs.OPS.paintImageXObject) {
        const render = { ancho: Math.hypot(ctm[0], ctm[1]), alto: Math.hypot(ctm[2], ctm[3]) };
        dibujos.push({
          pagina: n,
          orden: ++orden,
          clave: args[0],
          fraccion: fraccionDePagina(render, dimPagina),
        });
      }
    }
  }

  /* --- Decisión: qué páginas son anexo --- */
  const paginasDeAnexo = detectarPaginasDeAnexo(dibujos);

  /* --- Segunda pasada: decodificar solo lo que se conserva, una vez por clave --- */
  const imagenes = [];
  const huecos = [];
  const marcasPorPagina = new Map();
  const yaDecodificada = new Map();

  for (const d of dibujos) {
    const marcas = marcasPorPagina.get(d.pagina) || [];
    marcasPorPagina.set(d.pagina, marcas);

    if (paginasDeAnexo.has(d.pagina)) {
      /* Un hueco por página, no por dibujo: el logo de encabezado también cae
         dentro de una página de anexo y no debe generar su propio hueco. */
      if (!huecos.some((h) => h.pagina === d.pagina)) {
        const id = 'hueco_' + d.pagina;
        huecos.push({ id, pagina: d.pagina });
        marcas.push('<div data-hueco="anexo_eeff" data-id="' + id + '"></div>');
      }
      continue;
    }

    /* Deduplicación por clave: hay 126 dibujos pero solo unas 20 imágenes
       distintas, y decodificar por dibujo multiplicaba el trabajo por seis. */
    if (!yaDecodificada.has(d.clave)) {
      const pagina = await doc.getPage(d.pagina);
      yaDecodificada.set(d.clave, await aDataUrl(pagina, d.clave));
    }
    const dataUrl = yaDecodificada.get(d.clave);
    if (!dataUrl) continue;

    const id = 'img_' + d.pagina + '_' + d.orden;
    imagenes.push({ id, dataUrl, pagina: d.pagina, orden: d.orden });
    marcas.push('<img data-recurso="' + id + '" src="' + dataUrl + '" />');
  }

  const html = bloques
    .map((b) => b.html + (marcasPorPagina.get(b.pagina) || []).join('\n'))
    .join('\n');

  return { html, imagenes, huecos, paginas: doc.numPages, etiquetado };
}

/* Convierte el objeto de imagen de pdf.js en un data URL PNG. pdf.js entrega
   las muestras ya decodificadas; el número de canales varía según el espacio
   de color del original, así que se normaliza a RGB antes de empaquetar. */
async function aDataUrl(pagina, clave) {
  try {
    const obj = await conTiempoLimite(
      new Promise((res) => pagina.objs.get(clave, res)),
      TIEMPO_LIMITE_IMAGEN
    );
    if (!obj || !obj.width || !obj.height || !obj.data) return null;

    const { width, height, data } = obj;
    const canales = data.length / (width * height);
    if (canales < 1) return null;

    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      const o = i * canales;
      rgb[i * 3] = data[o];
      rgb[i * 3 + 1] = data[o + (canales > 1 ? 1 : 0)];
      rgb[i * 3 + 2] = data[o + (canales > 2 ? 2 : 0)];
    }
    return 'data:image/png;base64,' + aBase64(await codificarPNG(rgb, width, height));
  } catch (e) {
    return null;
  }
}

/* Recorre el árbol de estructura y emite HTML con la jerarquía del documento. */
function aHTML(nodo, texto) {
  if (!nodo) return '';
  if (nodo.type === 'content') {
    const item = texto.items.find((i) => i.id === nodo.id);
    return item ? escapar(item.str) : '';
  }
  const hijos = (nodo.children || []).map((h) => aHTML(h, texto)).join('');
  const etiqueta = MAPA_ETIQUETAS[nodo.role];
  return etiqueta ? '<' + etiqueta + '>' + hijos + '</' + etiqueta + '>' : hijos;
}
