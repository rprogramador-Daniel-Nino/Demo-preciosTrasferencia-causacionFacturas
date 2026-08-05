import { readFileSync, writeFileSync } from 'node:fs';
import { extraerReferencia } from './src/services/pdfReferenceExtractor.js';
import { aDocxBuffer } from './src/services/docxWriter.js';
import PizZip from 'pizzip';

const RUTA_PDF = '../Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf';

const ref = await extraerReferencia(new Uint8Array(readFileSync(RUTA_PDF)));
console.log('HTML length:', ref.html.length, 'imagenes:', ref.imagenes.length);

// 1. Analizar celdas de tabla sin font-size inline vs con
const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
let total = 0, conFontSize = 0, sinFontSizeConTexto = 0;
let ejemplosSin = [];
let m;
while ((m = tdRegex.exec(ref.html))) {
  const contenido = m[1];
  const textoPlano = contenido.replace(/<[^>]+>/g, '').trim();
  if (!textoPlano) continue;
  total++;
  if (/font-size:/.test(contenido)) conFontSize++;
  else {
    sinFontSizeConTexto++;
    if (ejemplosSin.length < 10) ejemplosSin.push(textoPlano.slice(0, 60));
  }
}
console.log('Celdas con texto:', total, 'con font-size inline:', conFontSize, 'SIN font-size inline:', sinFontSizeConTexto);
console.log('Ejemplos sin font-size:', ejemplosSin);

// 2. Base del documento
const baseMatch = /data-estilo-base="([^"|]+)\|(\d+)"/.exec(ref.html);
console.log('Base:', baseMatch && baseMatch[1], baseMatch && baseMatch[2]);

// 3. Generar .docx real y revisar tamaños de fuente que aparecen en tablas vs runs sin size explicito
const buffer = await aDocxBuffer({ html: ref.html, recursos: ref.imagenes, anexo: [] });
writeFileSync('_tmp_informe.docx', buffer);
console.log('DOCX escrito, tamaño:', buffer.length);

const zip = new PizZip(buffer);
const doc = zip.file('word/document.xml').asText();

// Contar tablas y celdas (tc) en el doc.xml
const tbls = (doc.match(/<w:tbl>/g) || []).length;
const tcs = (doc.match(/<w:tc>/g) || []).length;
console.log('Tablas en .docx:', tbls, 'celdas:', tcs);

// Saltos + secciones
const saltos = (doc.match(/<w:br w:type="page"\/>/g) || []).length;
const secciones = (doc.match(/<w:sectPr/g) || []).length;
console.log('Saltos:', saltos, 'Secciones:', secciones, 'Total (deberia ser 112):', saltos + secciones);

// Tamaños de fuente distintos usados (adicionales a estilo default) en runs
const sizes = [...doc.matchAll(/<w:sz w:val="(\d+)"\/>/g)].map(x => Number(x[1]));
const conteoSizes = {};
for (const s of sizes) conteoSizes[s] = (conteoSizes[s]||0)+1;
console.log('Tamaños (medios puntos) usados en runs y su conteo:', conteoSizes);
