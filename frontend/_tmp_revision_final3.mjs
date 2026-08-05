import { readFileSync } from 'node:fs';
import { extraerReferencia } from './src/services/pdfReferenceExtractor.js';

const RUTA_PDF = '../Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf';
const ref = await extraerReferencia(new Uint8Array(readFileSync(RUTA_PDF)));
const html = ref.html;

const tablas = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map(m => m[0]);
// Imprimir la tabla mas grande (mas texto), como muestra representativa
let mayor = tablas.reduce((a,b) => b.length > a.length ? b : a, '');
console.log('--- Tabla mas grande (', mayor.length, 'chars) ---');
console.log(mayor.slice(0, 2500));
console.log('--- fin muestra ---');

// Contexto: font-size fuera de tablas -- imprimir contexto de un par de ejemplos
const fueraCtx = [];
let sinTabla = html;
for (const t of tablas) sinTabla = sinTabla.replace(t, '');
const fsRegex = /.{50}font-size:[\d.]+pt.{80}/g;
let m; let c = 0;
while ((m = fsRegex.exec(sinTabla)) && c < 6) { fueraCtx.push(m[0]); c++; }
console.log('\n--- Contexto de font-size FUERA de tablas ---');
fueraCtx.forEach(x => console.log(JSON.stringify(x)));
