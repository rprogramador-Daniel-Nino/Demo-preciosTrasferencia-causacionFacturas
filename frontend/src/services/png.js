/* PNG mínimo y sin dependencias: codificar, y leer las dimensiones de lo ya
   codificado. La codificación solo cubre lo que hace falta para guardar una imagen
   extraída de un PDF como data URL: color RGB de 8 bits, sin filtro por fila. */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* PNG exige un byte de filtro al inicio de cada fila. Se usa 0 (sin filtro):
   comprime algo peor, pero evita toda la maquinaria de predictores. */
export function aFilasPNG(rgb, ancho, alto) {
  const filas = new Uint8Array((ancho * 3 + 1) * alto);
  for (let y = 0; y < alto; y++) {
    const destino = y * (ancho * 3 + 1);
    filas[destino] = 0;
    filas.set(rgb.subarray(y * ancho * 3, (y + 1) * ancho * 3), destino + 1);
  }
  return filas;
}

function trozo(tipo, datos) {
  const salida = new Uint8Array(12 + datos.length);
  const vista = new DataView(salida.buffer);
  vista.setUint32(0, datos.length);
  for (let i = 0; i < 4; i++) salida[4 + i] = tipo.charCodeAt(i);
  salida.set(datos, 8);
  vista.setUint32(8 + datos.length, crc32(salida.subarray(4, 8 + datos.length)));
  return salida;
}

/* CompressionStream('deflate') produce deflate con envoltura zlib, que es
   exactamente lo que espera el trozo IDAT. Está disponible tanto en el
   navegador como en Node 25, así que el mismo código sirve para los tests. */
export async function codificarPNG(rgb, ancho, alto) {
  const filas = aFilasPNG(rgb, ancho, alto);
  const comprimido = new Uint8Array(
    await new Response(
      new Blob([filas]).stream().pipeThrough(new CompressionStream('deflate'))
    ).arrayBuffer()
  );

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, ancho);
  v.setUint32(4, alto);
  ihdr[8] = 8;  /* bits por canal */
  ihdr[9] = 2;  /* tipo de color: RGB */

  const partes = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', comprimido),
    trozo('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(partes.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of partes) { png.set(p, o); o += p.length; }
  return png;
}

/* btoa en el navegador, Buffer en Node: el mismo módulo sirve en ambos. */
export function aBase64(bytes) {
  if (typeof btoa === 'function') {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  return Buffer.from(bytes).toString('base64');
}

/** El inverso de `aBase64`. Los saltos de línea de un base64 envuelto se ignoran. */
export function deBase64(base64) {
  const limpio = String(base64 || '').replace(/\s+/g, '');
  if (!limpio) return new Uint8Array(0);
  if (typeof atob === 'function') {
    const bruto = atob(limpio);
    const bytes = new Uint8Array(bruto.length);
    for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(limpio, 'base64'));
}

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* Los marcadores de inicio de trama de JPEG, los únicos que llevan las dimensiones.
   Del mismo rango 0xC0-0xCF quedan fuera 0xC4 (tabla de Huffman), 0xC8 (extensión JPG)
   y 0xCC (definición de codificación aritmética): son segmentos con otro contenido. */
const SOF_JPEG = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

/**
 * El tamaño real en píxeles de una imagen ya codificada, sin decodificarla.
 *
 * Existe para poder insertar una imagen en el .docx con SU proporción en vez de
 * suponerle la de una hoja: ver `insertarImagenesAnexoB` en `docxRelleno.js`, donde el
 * alto se calculaba con la proporción de un A4 y por eso el estado financiero de cada
 * comparable ocupaba una página entera.
 *
 * PNG se lee de su `IHDR`, que el formato obliga a poner de primero. JPEG hace falta
 * porque `convertPdfToImages` deja pasar tal cual las imágenes que no son PDF, sin
 * recodificarlas.
 *
 * @param {Uint8Array} bytes
 * @returns {{ancho:number, alto:number}|null} `null` si no es PNG ni JPEG, o si está
 *          truncada — el llamador decide con qué degradar.
 */
export function dimensionesDeImagen(bytes) {
  const b = bytes;
  if (!b || typeof b.length !== 'number') return null;

  if (b.length >= 24 && FIRMA_PNG.every((v, i) => b[i] === v)
    && b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52) {
    const ancho = u32(b, 16);
    const alto = u32(b, 20);
    return ancho > 0 && alto > 0 ? { ancho, alto } : null;
  }

  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    /* Recorrido de segmentos: cada uno empieza en 0xFF, y salvo los de relleno y los
       que no llevan carga trae su longitud en los dos bytes siguientes. */
    let i = 2;
    while (i + 1 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marca = b[i + 1];
      if (marca === 0xff) { i++; continue; }
      if (marca === 0xd8 || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) { i += 2; continue; }
      if (marca === 0xd9 || marca === 0xda) return null;  /* fin de imagen o de cabeceras */
      const largo = u16(b, i + 2);
      if (largo < 2) return null;
      if (SOF_JPEG.has(marca)) {
        if (i + 9 > b.length) return null;
        const alto = u16(b, i + 5);
        const ancho = u16(b, i + 7);
        return ancho > 0 && alto > 0 ? { ancho, alto } : null;
      }
      i += 2 + largo;
    }
  }

  return null;
}
