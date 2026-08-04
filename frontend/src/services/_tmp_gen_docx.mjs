import { readFileSync, writeFileSync } from 'node:fs';
import { extraerReferencia } from './pdfReferenceExtractor.js';
import { aDocxBuffer } from './docxWriter.js';

const RUTA_PDF = 'Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf';
const ref = await extraerReferencia(new Uint8Array(readFileSync(RUTA_PDF)));
const buf = await aDocxBuffer({ html: ref.html, recursos: ref.imagenes, anexo: [] });
const out = 'C:/Users/JUAN-M~1/AppData/Local/Temp/claude/D--G-Juan-Mendez-Documents-Desarrollo-Demo-preciosTrasferencia-causacionFacturas/92edc68e-d657-419e-a0d4-b9c9d933fddf/scratchpad/informe.docx';
writeFileSync(out, buf);
console.log('escrito, bytes=', buf.length);
console.log('paginas=', ref.paginas, 'imagenes=', ref.imagenes.length, 'huecos=', ref.huecos.length);
