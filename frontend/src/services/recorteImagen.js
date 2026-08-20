/* ─────────────────────────────────────────────────────────────────────────────
   recorteImagen.js — quitarle a una página rasterizada el papel en blanco que
   rodea a su contenido.

   POR QUÉ. El estado financiero de cada comparable se incrusta en el ANEXO B como
   imagen de la página del PDF que subió el analista, y no como cifras transcritas: es
   la decisión del spec 2026-08-06, tomada para no radicar ante la DIAN un número que el
   OCR leyó distinto del documento fuente. El precio de esa decisión es que la imagen
   es la HOJA COMPLETA, con el cuadro en el tercio superior y el resto en blanco, así
   que cada comparable se llevaba una página entera del informe.

   Recortar la imagen al contenido resuelve las dos cosas a la vez: el cuadro cabe
   debajo de su tabla de descripción, y al llevarlo al ancho de la caja de texto se lee
   mejor que antes.

   CÓMO ESTÁ PARTIDO. `cajaDeContenido` decide DÓNDE cortar y es una función pura sobre
   el mapa de píxeles: es la que se prueba. `recortarDataUrl` es la envoltura que usa
   `canvas`, que solo existe en el navegador — el mismo reparto que `pdfRenderer.js`
   hace entre `recortarPorPagina` y `convertPdfToImages`.

   NUNCA PIERDE LA IMAGEN. Ante una hoja en blanco, un error de carga o cualquier
   excepción, se devuelve la data URL original intacta. Degradar al comportamiento de
   hoy —página completa— es aceptable; perder el estado financiero de una comparable en
   un informe que se radica, no.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * La caja que encierra el contenido no blanco de un mapa de píxeles RGBA.
 *
 * Reglas, y por qué cada una:
 *
 * - Un píxel cuenta como contenido si es visible (`alfa >= alfaMin`) y alguno de sus
 *   canales baja de `umbral`. El alfa importa: `convertPdfToImages` pinta sobre un
 *   canvas nuevo sin rellenarlo de blanco, así que el papel de un PDF vectorial llega
 *   TRANSPARENTE y no blanco. Tratarlo como contenido dejaría la caja en la hoja entera.
 * - Una fila o columna solo cuenta si tiene al menos `minPorLinea` píxeles de contenido.
 *   Sin ese mínimo, una mota de compresión perdida en el margen anula todo el recorte.
 * - `margenPx` de aire alrededor, para no comerse el borde de la tabla.
 *
 * @param {Uint8ClampedArray|Uint8Array} pixeles  RGBA, cuatro bytes por píxel.
 * @param {number} ancho
 * @param {number} alto
 * @param {{umbral?:number, alfaMin?:number, minPorLinea?:number, margenPx?:number,
 *          tolerancia?:number}} [opciones]
 * @returns {{x:number, y:number, ancho:number, alto:number}|null} `null` cuando no hay
 *          nada que recortar: la hoja está en blanco, o el contenido ya llena
 *          `tolerancia` de las dos dimensiones y volver a codificarla no gana nada.
 */
export function cajaDeContenido(pixeles, ancho, alto, opciones = {}) {
  const {
    umbral = 245, alfaMin = 16, minPorLinea = 2, margenPx = 10, tolerancia = 0.98,
  } = opciones;

  if (!pixeles || !Number.isInteger(ancho) || !Number.isInteger(alto)) return null;
  if (ancho <= 0 || alto <= 0 || pixeles.length < ancho * alto * 4) return null;

  const porFila = new Uint32Array(alto);
  const porColumna = new Uint32Array(ancho);
  for (let y = 0; y < alto; y++) {
    const base = y * ancho * 4;
    for (let x = 0; x < ancho; x++) {
      const i = base + x * 4;
      if (pixeles[i + 3] < alfaMin) continue;
      if (pixeles[i] >= umbral && pixeles[i + 1] >= umbral && pixeles[i + 2] >= umbral) continue;
      porFila[y]++;
      porColumna[x]++;
    }
  }

  const primera = (cuentas) => {
    for (let i = 0; i < cuentas.length; i++) if (cuentas[i] >= minPorLinea) return i;
    return -1;
  };
  const ultima = (cuentas) => {
    for (let i = cuentas.length - 1; i >= 0; i--) if (cuentas[i] >= minPorLinea) return i;
    return -1;
  };

  const arriba = primera(porFila);
  const izquierda = primera(porColumna);
  if (arriba < 0 || izquierda < 0) return null;

  const x = Math.max(0, izquierda - margenPx);
  const y = Math.max(0, arriba - margenPx);
  const derecha = Math.min(ancho - 1, ultima(porColumna) + margenPx);
  const abajo = Math.min(alto - 1, ultima(porFila) + margenPx);
  const caja = { x, y, ancho: derecha - x + 1, alto: abajo - y + 1 };

  if (caja.ancho >= ancho * tolerancia && caja.alto >= alto * tolerancia) return null;
  return caja;
}

/* Carga una data URL en un `Image`. Rechaza si el navegador no la puede decodificar. */
function cargarImagen(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('no se pudo decodificar la imagen'));
    img.src = dataUrl;
  });
}

/**
 * Recorta una página rasterizada al contenido de su cuadro.
 *
 * Es idempotente, y por construcción: lo que devuelve lleva `margenPx` de blanco por
 * cada lado, así que en una segunda pasada la caja vuelve a dar la imagen completa y
 * `cajaDeContenido` responde `null`. Por eso la migración de lo ya guardado
 * (`recorteEeff.js`) puede llamarla sin llevar cuenta de qué recortó antes.
 *
 * @param {string} dataUrl
 * @param {object} [opciones]  las de `cajaDeContenido`.
 * @returns {Promise<string>} la data URL recortada, o LA MISMA de entrada si no había
 *          nada que recortar o si algo falló. Nunca lanza y nunca devuelve vacío.
 */
export async function recortarDataUrl(dataUrl, opciones = {}) {
  const original = String(dataUrl || '');
  if (!original || typeof document === 'undefined') return original;

  try {
    const img = await cargarImagen(original);
    const ancho = img.naturalWidth || img.width;
    const alto = img.naturalHeight || img.height;
    if (!ancho || !alto) return original;

    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0);

    const caja = cajaDeContenido(ctx.getImageData(0, 0, ancho, alto).data, ancho, alto, opciones);
    if (!caja) return original;

    const destino = document.createElement('canvas');
    destino.width = caja.ancho;
    destino.height = caja.alto;
    const ctxDestino = destino.getContext('2d');
    if (!ctxDestino) return original;
    /* Fondo blanco explícito: el papel de un PDF vectorial llega transparente, y una
       imagen con transparencia dentro de un .docx se ve distinta según el visor. */
    ctxDestino.fillStyle = '#ffffff';
    ctxDestino.fillRect(0, 0, caja.ancho, caja.alto);
    ctxDestino.drawImage(lienzo, caja.x, caja.y, caja.ancho, caja.alto, 0, 0, caja.ancho, caja.alto);

    const recortada = destino.toDataURL('image/png');
    return recortada && recortada.length > 32 ? recortada : original;
  } catch (err) {
    console.error('[recorteImagen] no se pudo recortar la página; se deja completa', err);
    return original;
  }
}

/**
 * Recorta un arreglo de páginas. Las que no se puedan recortar salen tal cual, así que
 * el arreglo devuelto tiene siempre el mismo largo y el mismo orden que el de entrada.
 *
 * @param {string[]} imagenes
 * @param {object} [opciones]
 * @returns {Promise<string[]>}
 */
export function recortarPaginas(imagenes, opciones = {}) {
  const lista = Array.isArray(imagenes) ? imagenes : [];
  return Promise.all(lista.map((img) => recortarDataUrl(img, opciones)));
}
