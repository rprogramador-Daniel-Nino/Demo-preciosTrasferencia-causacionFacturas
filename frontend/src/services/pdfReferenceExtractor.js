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

/* Versión de lo que este lector produce. Se sube cuando el HTML extraído gana algo
   que las plantillas ya guardadas no tienen, para que se pueda avisar de que están
   viejas:
     1 — texto, estructura e imágenes al final de cada página
     2 — imágenes en su posición del flujo y logo una sola vez
     3 — tipografía del informe: negrita, cursiva, familias y cuerpo
     4 — cada entrada del índice y cada nota en su propio bloque
     5 — cada página del original envuelta, para que el salto caiga donde debe */
export const VERSION_EXTRACTOR = 5;

const MAPA_ETIQUETAS = {
  H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', H5: 'h5', H6: 'h6',
  P: 'p', L: 'ul', LI: 'li', Table: 'table', TR: 'tr', TD: 'td', TH: 'th',
  /* Cada entrada del índice es un bloque. Sin esto sus hijos se concatenaban con
     los de la siguiente y las ochenta y nueve entradas salían en una sola línea
     corrida: el título, los puntos y el número de página de una pegados a los de
     la otra. Es lo que hacía que el índice se viera desordenado.
     `TOC` no se mapea: envolverlo añadiría un bloque sin efecto visible. */
  TOCI: 'p',
  /* Las notas también son bloque. Si no, la nota al pie se fundía con el párrafo
     que la precede y parecía parte del texto. */
  Note: 'p',
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
  const dibujos = [];
  /* Figuras declaradas por el árbol, por página y en orden de documento. Cada una
     dejó un marcador en el HTML que se resuelve al final. */
  const figurasPorPagina = new Map();
  /* El HTML no se puede armar aquí: los runs sólo declaran la familia y el tamaño
     cuando se desvían del cuerpo del documento, y cuál es el cuerpo no se sabe
     hasta haber contado todas las páginas. Se guarda lo leído y se renderiza
     después. */
  const leidas = [];
  const censoEstilos = new Map();
  let etiquetado = false;

  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const vista = pagina.getViewport({ scale: 1 });
    const dimPagina = { ancho: vista.width, alto: vista.height };

    const arbol = await pagina.getStructTree().catch(() => null);
    /* La lista de operadores va antes de resolver las fuentes: es la que las
       registra en `commonObjs`. Pedirlas al revés no falla, devuelve vacío, y el
       documento saldría sin una negrita. También es de donde salen los dibujos,
       más abajo. */
    const ops = await pagina.getOperatorList();
    /* `includeMarkedContent` no es opcional aquí: los nodos del árbol apuntan a
       ids de contenido marcado, y sin esta opción pdf.js no los emite. Los
       items de texto nunca traen `id` —el emparejamiento por `item.id` no falla,
       simplemente no encuentra nada— y el informe salía con toda la estructura
       y ni una letra dentro. */
    const texto = await pagina.getTextContent({ includeMarkedContent: true });
    const estilos = await estilosDeFuente(pagina, texto.items);
    const porId = textoPorId(texto.items, estilos);
    contarEstilos(porId, censoEstilos);
    /* Los items marcadores no traen `str`; sin el `|| ''` se colarían literales
       "undefined" en el texto de las páginas sin etiquetar. */
    const textoPlano = texto.items
      .map((i) => (i.hasEOL ? ' ' : '') + (i.str || ''))
      .join('')
      .trim();

    if (arbol) etiquetado = true;
    leidas.push({ pagina: n, arbol, porId, textoPlano });

    /* La matriz acumulada es la única forma de saber a qué tamaño se dibuja
       una imagen: los argumentos de paintImageXObject traen los píxeles
       intrínsecos, no el tamaño renderizado. `ops` se pidió arriba, antes de
       resolver las fuentes. */
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

  /* --- El cuerpo del documento, y con él el HTML --- */
  const base = estiloDominante(censoEstilos);
  const bloques = leidas.map(({ pagina: n, arbol, porId, textoPlano }) => {
    if (arbol) {
      const figuras = [];
      const htmlStruct = aHTML(arbol, porId, figuras, n, base);
      figurasPorPagina.set(n, figuras);

      /* Respaldo por página: si el árbol no rindió texto (documento etiquetado
         pero con el contenido fuera de los ámbitos marcados) se prefiere el
         texto plano a un bloque de etiquetas vacías. No se intenta repartir ese
         texto entre las etiquetas por orden de aparición: sin los ids no hay
         forma de saber a cuál pertenece cada trozo y termina en la equivocada
         —encabezados que dicen "1" o media frase de otro párrafo—, que es peor
         que un párrafo corrido, porque parece correcto. */
      if (htmlStruct.replace(/<[^>]*>/g, '').trim()) return { pagina: n, html: htmlStruct };
      return { pagina: n, html: textoPlano ? '<p>' + escapar(textoPlano) + '</p>' : '' };
    }
    return { pagina: n, html: '<p>' + escapar(textoPlano) + '</p>' };
  });

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
  /* El logo va marcado como encabezado, no como primera imagen del cuerpo. Word
     entiende un encabezado repetido desde HTML —`mso-element:header` sobre un div
     al que apunta `@page`—, así que no hace falta OOXML para esto: quien exporta
     lo saca del cuerpo y lo declara. Se queda dentro del HTML y no en un campo
     aparte para que sobreviva al marcado y al guardado, igual que el cuerpo de
     letra. */
  const cabecera = artefactos.length
    ? '<div data-encabezado="1">' + artefactos.map((a) => a.marca).join('') + '</div>'
    : '';

  /* El cuerpo del documento viaja dentro del propio HTML. Es lo que permite que
     la exportación a Word use la tipografía del informe de referencia —Arial 12
     en este— en vez de una elegida a dedo, y sigue ahí después de marcar, guardar
     y recargar, sin necesidad de otra clave en el almacén.

     La versión va al lado por una razón concreta: las plantillas se guardan y se
     reutilizan, así que una extraída con un lector anterior sigue viva en
     IndexedDB y produce un documento sin lo que el lector nuevo sí saca —pasó con
     la tipografía—. Sin este número, el usuario no tiene forma de saber que le
     falta algo y que la solución es volver a subir el PDF. */
  const marcaEstilo =
    '<div data-extractor="' + VERSION_EXTRACTOR + '"' +
    ' data-estilo-base="' + base.familia + '|' + base.tamano + '"></div>';

  /* Cada página del original queda envuelta y numerada. Es lo que permite que la
     exportación ponga un salto donde el informe cambia de página, empezando por la
     portada: sin esto el título y el logo de la portada se fundían con el índice y
     la primera página no se parecía a la del original.

     El salto es duro y por página, así que si el contenido de una no cabe —las
     fuentes no miden exactamente igual— Word desborda a una extra; pero la
     siguiente vuelve a empezar donde debe, en vez de arrastrar el desfase hasta el
     final. Es lo máximo alcanzable sin fijar alturas, que dejaría el documento
     imposible de editar. */
  const html = marcaEstilo + cabecera + bloques
    .map((b) => '<div class="pagina" data-pagina="' + b.pagina + '">' +
                conFiguras(b.html) + '</div>')
    .join('\n');

  if (figurasSinDibujo.length) {
    console.warn('[extractor] figuras sin imagen que las resuelva:', figurasSinDibujo);
  }

  return {
    html, imagenes, huecos, paginas: doc.numPages, etiquetado,
    figurasSinDibujo: figurasSinDibujo.length,
    estiloBase: base,
  };
}

/* Lee el cuerpo que el extractor dejó anotado en el HTML. Devuelve null si no está
   —una plantilla marcada antes de este cambio, o un .docx vía mammoth—, y entonces
   quien exporta se queda con su tipografía por defecto. */
export function estiloBaseDe(html) {
  const m = /data-estilo-base="([^"|]+)\|(\d+)"/.exec(String(html || ''));
  return m ? { familia: m[1], tamano: Number(m[2]) } : null;
}

/* Con qué versión del lector se extrajo una plantilla guardada. Devuelve 1 para las
   que no traen la marca: son de antes de que existiera. */
export function versionDe(html) {
  const m = /data-extractor="(\d+)"/.exec(String(html || ''));
  return m ? Number(m[1]) : 1;
}

/* Qué le falta a una plantilla extraída con un lector anterior, en palabras que
   sirvan para decidir si vale la pena volver a subir el PDF. Vacío si está al día
   o si no viene de un PDF (un .docx vía mammoth no lleva marca y tampoco tiene por
   qué: su ruta es otra). */
export function loQueFaltaPorVersion(version) {
  const falta = [];
  if (version < 2) {
    falta.push('las imágenes quedaron amontonadas al final de cada página y el logo ' +
               'del encabezado se repite en todas');
  }
  if (version < 3) {
    falta.push('el documento sale sin la tipografía del informe: sin negritas, sin ' +
               'cursivas y con el cuerpo de letra por defecto');
  }
  if (version < 4) {
    falta.push('las entradas del índice salen corridas en una sola línea en vez de ' +
               'una por renglón');
  }
  if (version < 5) {
    falta.push('no hay saltos de página donde el informe cambia de página, así que la ' +
               'portada se funde con el índice');
  }
  return falta;
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
/* Resuelve las fuentes que usa la página a negrita, cursiva y familia.

   `styles` de getTextContent sólo devuelve `sans-serif`/`serif`, que no distingue
   una negrita de una redonda. El nombre real vive en el objeto de fuente
   (`Arial-BoldMT`, `Arial-BoldItalicMT`, `TimesNewRomanPS-ItalicMT`) junto con
   sus banderas, y se pide a `commonObjs`. Por eso el documento salía sin una sola
   negrita: la información estaba, no se leía.

   El nombre trae un prefijo de subconjunto de seis letras y un '+'
   (`VXFCPX+BritannicBold`) que hay que recortar, o Word buscaría una fuente que
   no existe. */
async function estilosDeFuente(pagina, items) {
  const estilos = new Map();
  for (const item of items) {
    if (!item.fontName || estilos.has(item.fontName)) continue;
    const f = await conTiempoLimite(
      new Promise((res) => pagina.commonObjs.get(item.fontName, res)),
      TIEMPO_LIMITE_IMAGEN
    );
    const nombre = String((f && f.name) || '').replace(/^[A-Z]{6}\+/, '');
    /* Las banderas del objeto son de fiar cuando vienen; cuando no —fuentes con
       subconjunto—, el nombre las delata. */
    const porNombre = /bold|black|heavy/i.test(nombre);
    const cursivaPorNombre = /italic|oblique/i.test(nombre);
    estilos.set(item.fontName, {
      familia: familiaDe(nombre),
      negrita: f && typeof f.bold === 'boolean' ? f.bold || porNombre : porNombre,
      cursiva: f && typeof f.italic === 'boolean' ? f.italic || cursivaPorNombre : cursivaPorNombre,
    });
  }
  return estilos;
}

/* Familia CSS a partir del nombre de la fuente del PDF. Se queda con la familia y
   descarta el sufijo de variante, porque la negrita y la cursiva ya viajan como
   tales: `Arial-BoldItalicMT` es Arial en negrita cursiva, no una familia propia. */
function familiaDe(nombre) {
  const n = nombre.replace(/[-,]?(BoldItalic|BoldOblique|Bold|Italic|Oblique|Regular|MT|PS|PSMT)/gi, '');
  if (/times|georgia|garamond|serif|book/i.test(n)) return 'Times New Roman';
  if (/courier|mono/i.test(n)) return 'Courier New';
  if (!n.trim()) return 'Arial';
  /* El nombre limpio, con un respaldo genérico detrás por si Word no la tiene. */
  return n.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

/* Censo de familia y tamaño para deducir el cuerpo del documento. El estilo
   dominante se aplica al `body` y los runs sólo declaran lo que se desvía, así que
   el HTML no acaba con un `font-family` en cada párrafo. */
function contarEstilos(porId, censo) {
  for (const runs of porId.values()) {
    for (const r of runs) {
      if (!r.texto.trim()) continue;
      const peso = r.texto.length;
      const clave = r.familia + '|' + r.tamano;
      censo.set(clave, (censo.get(clave) || 0) + peso);
    }
  }
}

function estiloDominante(censo) {
  let mejor = null;
  let max = -1;
  for (const [clave, peso] of censo) {
    if (peso > max) { max = peso; mejor = clave; }
  }
  const [familia, tamano] = (mejor || 'Arial|12').split('|');
  return { familia, tamano: Number(tamano) || 12 };
}

function textoPorId(items, estilos = new Map()) {
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
        const runs = porId.get(id) || [];
        if (!porId.has(id)) porId.set(id, runs);

        const e = estilos.get(item.fontName) || {};
        const estilo = {
          negrita: !!e.negrita,
          cursiva: !!e.cursiva,
          familia: e.familia || 'Arial',
          /* `height` es el tamaño renderizado en puntos. Se redondea porque el
             mismo cuerpo llega con decimales distintos según la transformación, y
             un run por cada 11,96 frente a 12 partiría el texto sin motivo. */
          tamano: Math.round(item.height || 0) || 12,
        };

        const ultimo = runs[runs.length - 1];
        /* Con `previo` vacío el espacio queda al principio del nodo, que es
           justo lo que lo separa del renglón anterior al concatenar hermanos. */
        const yaTermina = ultimo && ultimo.texto.endsWith(' ');
        const separador = saltoPendiente && !yaTermina ? ' ' : '';

        /* Runs contiguos con el mismo estilo se funden: el PDF corta el texto en
           cada cambio de fuente y sin fundir saldría un `<strong>` por sílaba. */
        if (ultimo && mismoEstilo(ultimo, estilo)) {
          ultimo.texto += separador + item.str;
        } else {
          runs.push({ ...estilo, texto: separador + item.str });
        }
      }
      saltoPendiente = false;
    }
    if (item.hasEOL) saltoPendiente = true;
  }
  return porId;
}

const mismoEstilo = (a, b) =>
  a.negrita === b.negrita && a.cursiva === b.cursiva &&
  a.familia === b.familia && a.tamano === b.tamano;

/* Renderiza los runs de un nodo a HTML. La negrita y la cursiva van como
   `<strong>` y `<em>`, que Word entiende como tales al abrir el documento. La
   familia y el tamaño sólo se declaran cuando se desvían del cuerpo del
   documento: si se pusieran siempre, cada párrafo cargaría su propio estilo y el
   HTML pesaría el doble sin decir nada nuevo. */
function runsAHTML(runs, base) {
  if (!runs || !runs.length) return '';
  return runs.map((r) => {
    let html = escapar(r.texto);
    if (!html) return '';
    const desvios = [];
    if (base && r.familia && r.familia !== base.familia) {
      desvios.push("font-family:'" + r.familia + "'");
    }
    /* Sólo desvíos de más de un punto. `height` es el alto real de los glifos y no
       el cuerpo de la fuente, así que un renglón sin ascendentes mide 11 donde el
       de al lado mide 12: emitir esa diferencia son mil setecientas declaraciones
       que nadie distingue a la vista y un cincuenta por ciento más de HTML. Lo que
       sí se conserva es la letra pequeña de verdad —notas y fuentes de tabla, de 8
       y 9 puntos—, que se ve. */
    if (base && r.tamano && Math.abs(r.tamano - base.tamano) > 1) {
      desvios.push('font-size:' + r.tamano + 'pt');
    }
    if (desvios.length) html = '<span style="' + desvios.join(';') + '">' + html + '</span>';
    if (r.cursiva) html = '<em>' + html + '</em>';
    if (r.negrita) html = '<strong>' + html + '</strong>';
    return html;
  }).join('');
}

/* Texto plano de un mapa de runs, para el respaldo de las páginas sin estructura. */
const textoDeRuns = (runs) => (runs || []).map((r) => r.texto).join('');

/* Recorre el árbol de estructura y emite HTML con la jerarquía del documento.

   `figuras` recoge, en orden de documento, el bbox de cada nodo `Figure`, y en su
   lugar queda un marcador. Así la imagen acaba donde el informe la puso —entre
   los párrafos que la rodean— y no amontonada al final de la página, que es lo
   que hacía que el Word generado no se pareciera al PDF de origen. */
function aHTML(nodo, porId, figuras, pagina, base) {
  if (!nodo) return '';
  if (nodo.type === 'content') return runsAHTML(porId.get(nodo.id), base);

  if (nodo.role === 'Figure') {
    const indice = figuras.length;
    figuras.push({ bbox: nodo.bbox || null, alt: nodo.alt || '' });
    return '<!--FIG:' + pagina + ':' + indice + '-->';
  }

  const hijos = (nodo.children || [])
    .map((h) => aHTML(h, porId, figuras, pagina, base))
    .join('');
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
