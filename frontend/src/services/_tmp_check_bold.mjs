import { readFileSync } from 'node:fs';
import { extraerReferencia } from './pdfReferenceExtractor.js';

const RUTA_PDF = 'Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf';
const ref = await extraerReferencia(new Uint8Array(readFileSync(RUTA_PDF)));
const strong = (ref.html.match(/<strong>/g) || []).length;
const b = (ref.html.match(/<b>/g) || []).length;
console.log('strong:', strong, 'b:', b, 'total:', strong + b);
