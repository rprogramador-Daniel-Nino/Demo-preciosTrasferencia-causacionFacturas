/* Codificación PNG mínima y sin dependencias. Solo cubre lo que hace falta
   para guardar una imagen extraída de un PDF como data URL: color RGB de
   8 bits, sin filtro por fila. */

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
