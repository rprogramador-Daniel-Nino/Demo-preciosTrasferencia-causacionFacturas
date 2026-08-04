import { readFileSync } from 'node:fs';
import { extraerReferencia } from './pdfReferenceExtractor.js';

const RUTA_PDF = 'Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf';
const ref = await extraerReferencia(new Uint8Array(readFileSync(RUTA_PDF)));
console.log('imagenes:', ref.imagenes.map(i => i.id));
console.log('cuantas veces se referencia cada id en el html:');
for (const img of ref.imagenes) {
  const count = (ref.html.match(new RegExp('data-recurso="' + img.id + '"', 'g')) || []).length;
  console.log(img.id, '->', count, 'veces');
}
const encMatch = /<div data-encabezado="1"([^>]*)>([\s\S]*?)<\/div>/.exec(ref.html);
console.log('encabezado bloque contiene recurso:', encMatch ? /data-recurso="([^"]+)"/.exec(encMatch[2])[1] : 'ninguno');
