import { readFileSync } from 'node:fs';
import { extraerReferencia } from './pdfReferenceExtractor.js';

const RUTA_PDF = 'Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf';
const ref = await extraerReferencia(new Uint8Array(readFileSync(RUTA_PDF)));
const html = ref.html;
// contar <strong> vacios o solo espacios
const strongs = [...html.matchAll(/<strong>([\s\S]*?)<\/strong>/g)];
let vacios = 0, soloEspacio = 0, anidados = 0;
for (const m of strongs) {
  const contenido = m[1];
  if (contenido === '') vacios++;
  else if (!contenido.replace(/<[^>]*>/g,'').trim()) soloEspacio++;
  if (/<strong>/.test(contenido)) anidados++;
}
console.log('total strong', strongs.length, 'vacios', vacios, 'solo espacio/etiquetas sin texto', soloEspacio, 'con strong anidado dentro', anidados);

// contar cuantos strong caen dentro de una linea que matchea el patron de indice (para ver si el indice colapsa varios en 1 run)
const RX = /^(.*?\S)\s+\.+\s*(\d+)\s*$/;
