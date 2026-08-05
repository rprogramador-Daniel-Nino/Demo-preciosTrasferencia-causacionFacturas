import { readFileSync } from 'node:fs';
import { extraerReferencia } from './src/services/pdfReferenceExtractor.js';

const RUTA_PDF = '../Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf';
const ref = await extraerReferencia(new Uint8Array(readFileSync(RUTA_PDF)));
const html = ref.html;

// Contar todos los spans con font-size, dentro y fuera de <table>
const tablas = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map(m => m[0]);
console.log('Numero de <table>...</table> bloques:', tablas.length);

let fsEnTablas = 0, fsFueraTablas = 0;
const totalFs = (html.match(/font-size:/g) || []).length;
for (const t of tablas) fsEnTablas += (t.match(/font-size:/g) || []).length;
fsFueraTablas = totalFs - fsEnTablas;
console.log('Total font-size: en todo el HTML:', totalFs);
console.log('font-size: dentro de <table>:', fsEnTablas);
console.log('font-size: fuera de <table> (parrafos, indice, notas):', fsFueraTablas);

// tamaños distintos usados
const tamanos = [...html.matchAll(/font-size:([\d.]+)pt/g)].map(m => m[1]);
const conteo = {};
for (const t of tamanos) conteo[t] = (conteo[t]||0)+1;
console.log('Distribucion de tamanos (todo el documento):', conteo);

// Cuantos de esos tamanos estan dentro de tablas
const conteoTablas = {};
for (const t of tablas) {
  const ts = [...t.matchAll(/font-size:([\d.]+)pt/g)].map(m => m[1]);
  for (const x of ts) conteoTablas[x] = (conteoTablas[x]||0)+1;
}
console.log('Distribucion de tamanos SOLO dentro de tablas:', conteoTablas);

// Celdas de tabla: contar longitud total de texto con y sin cobertura de font-size
let totalCeldas = 0, celdasSinAnotar = 0;
for (const t of tablas) {
  const celdas = [...t.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)];
  for (const c of celdas) {
    const texto = c[1].replace(/<[^>]+>/g,'').trim();
    if (!texto) continue;
    totalCeldas++;
    if (!/font-size:/.test(c[1])) celdasSinAnotar++;
  }
}
console.log('Celdas de tabla con texto:', totalCeldas, 'sin ninguna anotacion font-size:', celdasSinAnotar);
