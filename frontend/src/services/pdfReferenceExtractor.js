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
    /* `isOffscreenCanvasSupported: false` no es una optimización, es lo que hace
       que el navegador se comporte como Node. La opción vale `!isNodeJS` por
       defecto, y cuando está activa el worker entrega las imágenes como
       `ImageBitmap` y pone `imgData.data = null` a propósito. `aDataUrl` lee los
       píxeles de `data`, así que en el navegador se descartaban todas las
       imágenes en silencio mientras en Node —donde la opción es falsa— salían
       bien: los tests en verde y el informe sin una sola imagen. Forzándola a
       falso hay un único camino, el que los tests recorren. */
    doc = await pdfjs.getDocument({ data: datos, isOffscreenCanvasSupported: false }).promise;
  } catch (e) {
    throw new Error('no se pudo leer el PDF: ' + e.message);
  }

  /* --- Primera pasada: estructura y censo de dibujos --- */
  const bloques = [];
  const dibujos = [];
  /* Figuras declaradas por el árbol, por página y en orden de documento. Cada una
     dejó un marcador en el HTML que se resuelve al final. */
  const figurasPorPagina = new Map();
  let etiquetado = false;

  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const vista = pagina.getViewport({ scale: 1 });
    const dimPagina = { ancho: vista.width, alto: vista.height };

    const arbol = await pagina.getStructTree().catch(() => null);
    /* `includeMarkedContent` no es opcional aquí: los nodos del árbol apuntan a
       ids de contenido marcado, y sin esta opción pdf.js no los emite. Los
       items de texto nunca traen `id` —el emparejamiento por `item.id` no falla,
       simplemente no encuentra nada— y el informe salía con toda la estructura
       y ni una letra dentro. */
    const texto = await pagina.getTextContent({ includeMarkedContent: true });
    const porId = textoPorId(texto.items);
    /* Los items marcadores no traen `str`; sin el `|| ''` se colarían literales
       "undefined" en el texto de las páginas sin etiquetar. */
    const textoPlano = texto.items
      .map((i) => (i.hasEOL ? ' ' : '') + (i.str || ''))
      .join('')
      .trim();

    if (arbol) {
      etiquetado = true;
      const figuras = [];
      const htmlStruct = aHTML(arbol, porId, figuras, n);
      figurasPorPagina.set(n, figuras);

      /* Respaldo por página: si el árbol no rindió texto (documento etiquetado
         pero con el contenido fuera de los ámbitos marcados) se prefiere el
         texto plano a un bloque de etiquetas vacías. No se intenta repartir ese
         texto entre las etiquetas por orden de aparición: sin los ids no hay
         forma de saber a cuál pertenece cada trozo y termina en la equivocada
         —encabezados que dicen "1" o media frase de otro párrafo—, que es peor
         que un párrafo corrido, porque parece correcto. */
      if (htmlStruct.replace(/<[^>]*>/g, '').trim()) {
        bloques.push({ pagina: n, html: htmlStruct });
      } else {
        bloques.push({ pagina: n, html: textoPlano ? '<p>' + escapar(textoPlano) + '</p>' : '' });
      }
    } else {
      bloques.push({ pagina: n, html: '<p>' + escapar(textoPlano) + '</p>' });
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
          /* Rectángulo donde se dibuja, en coordenadas de la página. Es lo que
             permite emparejarlo con la figura del árbol que lo reclama, y por
             tanto colocarlo en su sitio dentro del texto en vez de al final de
             la página. Medido contra el PDF real, el bbox de la figura y este
             rectángulo coinciden al punto. */
          rect: [ctm[4], ctm[5], ctm[4] + render.ancho, ctm[5] + render.alto],
        });
      }
    }
  }

  /* --- Decisión: qué páginas son anexo --- */
  const paginasDeAnexo = detectarPaginasDeAnexo(dibujos);

  /* --- Segunda pasada: decodificar solo lo que se conserva, una vez por clave --- */
  const imagenes = [];
  const huecos = [];
  const yaDecodificada = new Map();

  /* Qué dibujo reclama cada figura, por página. Los dibujos que no aparecen aquí
     son artefactos —el logo del encabezado, que se repite en casi cien páginas y
     no cuelga del árbol— y no se emiten dentro del texto. */
  const dibujoDeFigura = new Map();
  const reclamados = new Set();
  for (const [n, figuras] of figurasPorPagina) {
    const pares = emparejar(figuras, dibujos.filter((d) => d.pagina === n));
    pares.forEach((d, i) => {
      dibujoDeFigura.set(n + ':' + i, d);
      if (d) reclamados.add(d);
    });
  }

  /* Marca con la que se resuelve cada figura, por 'pagina:indice'. */
  const marcaDeFigura = new Map();
  const claveDeFigura = new Map();
  for (const [k, d] of dibujoDeFigura) if (d) claveDeFigura.set(d, k);

  /* Artefactos: dibujos que ninguna figura reclama. Son el logo del encabezado.
     Se conservan las claves distintas, no las cien repeticiones. */
  const artefactos = [];

  for (const d of dibujos) {
    const figura = claveDeFigura.get(d);

    if (paginasDeAnexo.has(d.pagina)) {
      /* Un hueco por página, no por dibujo: el logo de encabezado también cae
         dentro de una página de anexo y no debe generar su propio hueco. */
      if (!figura) continue;
      if (!huecos.some((h) => h.pagina === d.pagina)) {
        const id = 'hueco_' + d.pagina;
        huecos.push({ id, pagina: d.pagina });
        /* El hueco lleva texto visible dentro. Un `<div>` vacío no se ve ni en
           la vista previa ni en el Word: las 16 páginas del anexo de estados
           financieros firmados desaparecían sin dejar rastro. Que el documento
           diga qué falta es lo mínimo para que alguien lo note al revisarlo. */
        marcaDeFigura.set(
          figura,
          '<div data-hueco="anexo_eeff" data-id="' + id + '">' +
          '<p>[Falta el anexo de estados financieros firmados — corresponde a la página ' +
          d.pagina + ' del informe de referencia. Adjúntelo antes de radicar.]</p></div>'
        );
      }
      continue;
    }

    /* Deduplicación por clave: hay 126 dibujos pero solo unas 20 imágenes
       distintas, y decodificar por dibujo multiplicaba el trabajo por seis.
       El recurso también se emite una sola vez por clave: el logo del
       encabezado se dibuja en casi cien páginas, y una copia del base64 por
       dibujo hinchaba cien veces lo que se guarda. */
    if (!yaDecodificada.has(d.clave)) {
      const pagina = await doc.getPage(d.pagina);
      const url = await aDataUrl(pagina, d.clave);
      yaDecodificada.set(d.clave, url);
      if (url) imagenes.push({ id: d.clave, dataUrl: url, pagina: d.pagina, orden: d.orden });
    }
    if (!yaDecodificada.get(d.clave)) continue;

    /* La marca apunta al recurso y no lleva el base64 dentro: así el HTML que
       se guarda pesa kilobytes en vez de megabytes, y una imagen que se repite
       en noventa páginas se almacena una sola vez. Quien muestre o exporte el
       documento la resuelve contra el catálogo de recursos. */
    const marca = '<img data-recurso="' + d.clave + '" />';

    if (figura) {
      marcaDeFigura.set(figura, marca);
    } else if (!artefactos.some((a) => a.dataUrl === yaDecodificada.get(d.clave))) {
      /* Se deduplica por contenido y no por clave: pdf.js promueve a objeto
         global una imagen que se repite, así que el mismo logo llega con dos
         claves distintas —la local de la primera página y la global— y por clave
         saldría dos veces seguidas al abrir el documento. */
      artefactos.push({ clave: d.clave, marca, dataUrl: yaDecodificada.get(d.clave) });
    }
  }

  /* Cada figura se resuelve donde el árbol la declaró. Una figura sin dibujo que
     la reclame —el emparejamiento falló, o el objeto no se pudo decodificar— se
     reporta en vez de desaparecer: en esta ruta el silencio ya costó dos fallos
     invisibles que los tests en verde no delataron. */
  const figurasSinDibujo = [];
  const conFiguras = (htmlPagina) =>
    htmlPagina.replace(/<!--FIG:(\d+):(\d+)-->/g, (_, pag, idx) => {
      const k = pag + ':' + idx;
      if (marcaDeFigura.has(k)) return marcaDeFigura.get(k);
      figurasSinDibujo.push({ pagina: Number(pag), indice: Number(idx) });
      return '';
    });

  /* El logo del encabezado va una vez al principio y no en cada página. Su sitio
     propio es el encabezado del documento de Word, que necesita OOXML y es de la
     otra fase; repetirlo cien veces dentro del texto —que es lo que se hacía— era
     peor que ponerlo una vez arriba. */
  const cabecera = artefactos.map((a) => a.marca).join('');

  const html = cabecera + bloques.map((b) => conFiguras(b.html)).join('\n');

  if (figurasSinDibujo.length) {
    console.warn('[extractor] figuras sin imagen que las resuelva:', figurasSinDibujo);
  }

  return {
    html, imagenes, huecos, paginas: doc.numPages, etiquetado,
    figurasSinDibujo: figurasSinDibujo.length,
  };
}

/* Convierte el objeto de imagen de pdf.js en un data URL PNG. pdf.js entrega
   las muestras ya decodificadas; el número de canales varía según el espacio
   de color del original, así que se normaliza a RGB antes de empaquetar. */
async function aDataUrl(pagina, clave) {
  try {
    /* Las claves con prefijo `g_` son objetos globales del documento —las
       imágenes que se repiten en varias páginas, como el logo del encabezado— y
       pdf.js las guarda en `commonObjs`, no en los `objs` de la página.
       Pedírselas al almacén equivocado no lanza: el callback nunca se llama y la
       imagen se perdía tras cinco segundos de espera. */
    const almacen = clave.startsWith('g_') ? pagina.commonObjs : pagina.objs;
    const obj = await conTiempoLimite(
      new Promise((res) => almacen.get(clave, res)),
      TIEMPO_LIMITE_IMAGEN
    );
    if (!obj || !obj.width || !obj.height) return null;
    /* Una imagen que llega sin píxeles y se descarta callando es justo lo que
       dejó el informe sin ilustraciones sin que nada lo delatara. Si vuelve a
       pasar —otra versión de pdf.js, otra vía de decodificación— que al menos
       quede dicho. */
    if (!obj.data) {
      console.warn('imagen sin píxeles utilizables, se omite:', clave, Object.keys(obj).join(','));
      return null;
    }

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

/* Agrupa el texto de la página por id de contenido marcado, que es la clave con
   la que el árbol de estructura referencia su contenido.

   pdf.js no pone el id en los items de texto: emite marcadores
   `beginMarkedContentProps` / `endMarkedContent` que abren y cierran ámbitos, y
   los items de texto que caen dentro pertenecen al ámbito abierto más interno.
   Un mismo id suele abarcar varios items —una frase partida por cambios de
   fuente—, así que se concatenan en vez de quedarse con el último.

   Los ámbitos sin id son artefactos (encabezados, pies, numeración de página):
   no cuelgan del árbol y su texto se descarta, que es justo lo que se quiere
   para no repetir el pie de página dentro de cada párrafo. */
function textoPorId(items) {
  const porId = new Map();
  const pilaMarcas = [];
  /* El salto de línea vale un espacio, pero no se puede pegar a un item fijo:
     unas veces `hasEOL` viene en un item vacío que abre el renglón siguiente y
     otras en el último item del renglón que termina. Peor aún, el límite suele
     caer entre dos nodos de contenido distintos —cada renglón es su propio
     nodo—, así que ni siquiera pertenece a un solo id. Se anota como pendiente
     y se cobra en el próximo texto que llegue, venga donde venga: sin esto la
     razón social partida en dos renglones queda "COLOMBIAS.A.S", deja de
     coincidir con las reglas de sustitución y el informe nuevo sale con el
     nombre del cliente anterior. Los cortes sin `hasEOL` se unen sin nada:
     ahí el renglón sólo se partió por un cambio de fuente. */
  let saltoPendiente = false;
  for (const item of items) {
    if (item.type === 'beginMarkedContent' || item.type === 'beginMarkedContentProps') {
      pilaMarcas.push(item.id || null);
      continue;
    }
    if (item.type === 'endMarkedContent') {
      pilaMarcas.pop();
      continue;
    }
    if (item.str) {
      const id = pilaMarcas[pilaMarcas.length - 1];
      if (id) {
        const previo = porId.get(id) || '';
        /* Con `previo` vacío el espacio queda al principio del nodo, que es
           justo lo que lo separa del renglón anterior al concatenar hermanos. */
        const separa = saltoPendiente && !previo.endsWith(' ');
        porId.set(id, previo + (separa ? ' ' : '') + item.str);
      }
      saltoPendiente = false;
    }
    if (item.hasEOL) saltoPendiente = true;
  }
  return porId;
}

/* Recorre el árbol de estructura y emite HTML con la jerarquía del documento.

   `figuras` recoge, en orden de documento, el bbox de cada nodo `Figure`, y en su
   lugar queda un marcador. Así la imagen acaba donde el informe la puso —entre
   los párrafos que la rodean— y no amontonada al final de la página, que es lo
   que hacía que el Word generado no se pareciera al PDF de origen. */
function aHTML(nodo, porId, figuras, pagina) {
  if (!nodo) return '';
  if (nodo.type === 'content') return escapar(porId.get(nodo.id) || '');

  if (nodo.role === 'Figure') {
    const indice = figuras.length;
    figuras.push({ bbox: nodo.bbox || null, alt: nodo.alt || '' });
    return '<!--FIG:' + pagina + ':' + indice + '-->';
  }

  const hijos = (nodo.children || []).map((h) => aHTML(h, porId, figuras, pagina)).join('');
  const etiqueta = MAPA_ETIQUETAS[nodo.role];
  return etiqueta ? '<' + etiqueta + '>' + hijos + '</' + etiqueta + '>' : hijos;
}

/* Empareja cada figura del árbol con el dibujo cuyo rectángulo ocupa. Medido
   contra el PDF de referencia, la coincidencia es exacta; la tolerancia está por
   si otro generador redondea. Se empareja por solapamiento y no por orden porque
   en una página con logo de encabezado hay más dibujos que figuras, y el orden
   no dice cuál es cuál. */
function emparejar(figuras, dibujosDePagina, tolerancia = 2) {
  const usados = new Set();
  return figuras.map((f) => {
    if (!f.bbox) return null;
    const [x0, y0, x1, y1] = f.bbox;
    for (const d of dibujosDePagina) {
      if (usados.has(d) || !d.rect) continue;
      const [dx0, dy0, dx1, dy1] = d.rect;
      if (Math.abs(dx0 - x0) <= tolerancia && Math.abs(dy0 - y0) <= tolerancia &&
          Math.abs(dx1 - x1) <= tolerancia && Math.abs(dy1 - y1) <= tolerancia) {
        usados.add(d);
        return d;
      }
    }
    return null;
  });
}
