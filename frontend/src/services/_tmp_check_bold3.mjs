import { readFileSync } from 'node:fs';
import { extraerReferencia } from './pdfReferenceExtractor.js';
import { htmlAArbol } from './htmlAArbol.js';

const RUTA_PDF = 'Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf';
const ref = await extraerReferencia(new Uint8Array(readFileSync(RUTA_PDF)));
const html = ref.html;
const strongs = [...html.matchAll(/<strong>([\s\S]*?)<\/strong>/g)];
let vacioTotal = 0;
for (const m of strongs) {
  const contenido = m[1].replace(/<[^>]*>/g, '');
  if (contenido.length === 0) vacioTotal++;
}
console.log('strongs con CERO texto (ni espacio)', vacioTotal, 'de', strongs.length);

// Ahora contemos cuantos <strong> caen dentro de una entrada de indice (deteccion aproximada:
// el bloque de texto del parrafo que lo contiene matchea el regex de indice del writer)
const RX_ENTRADA_INDICE = /^(.*?\S)\s+\.+\s*(\d+)\s*$/;
const parrafos = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
let strongsEnIndice = 0, entradasIndice = 0;
for (const p of parrafos) {
  const textoPlano = p[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g,' ').trim();
  if (RX_ENTRADA_INDICE.test(textoPlano)) {
    entradasIndice++;
    strongsEnIndice += (p[1].match(/<strong>/g) || []).length;
  }
}
console.log('entradas de indice detectadas', entradasIndice, 'strongs dentro de ellas', strongsEnIndice);
