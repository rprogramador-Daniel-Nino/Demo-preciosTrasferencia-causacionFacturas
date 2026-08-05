import { readFileSync } from 'node:fs';
import { extraerReferencia } from './src/services/pdfReferenceExtractor.js';

const RUTA_PDF = '../Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf';
const ref = await extraerReferencia(new Uint8Array(readFileSync(RUTA_PDF)));
const html = ref.html;

const tablas = [...html.matchAll(/<table>[\s\S]*?<\/table>/g)].map(m => m[0]);
console.log('Tablas totales:', tablas.length);

// Ancho de caja de texto (cm) segun HOJA_TWIPS: 16.59 cm aprox
const CAJA_CM = 21.59 - 2 * 2.5; // 16.59
// Estimacion: Arial 12pt ancho medio de caracter ~= 0.21cm (a ojo, ~6pt=0.21cm)
const CM_POR_CARACTER_12PT = 0.21;

let tablasConRiesgo = 0;
let celdasQueEnvolverian = 0;
let celdasTotal = 0;
const ejemplos = [];

for (const t of tablas) {
  // Contar columnas maximas (primera fila con mas <td>/<th>)
  const filas = [...t.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
  let maxCols = 0;
  const filasCeldas = filas.map(f => [...f.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => c[1]));
  for (const cs of filasCeldas) maxCols = Math.max(maxCols, cs.length);
  if (maxCols < 2) continue;
  const colAnchoCm = CAJA_CM / maxCols;
  const charsPorLinea = Math.floor(colAnchoCm / CM_POR_CARACTER_12PT);

  let riesgoEnEstaTabla = false;
  for (const cs of filasCeldas) {
    for (const c of cs) {
      const texto = c.replace(/<[^>]+>/g, '').trim();
      if (!texto) continue;
      celdasTotal++;
      if (texto.length > charsPorLinea) {
        celdasQueEnvolverian++;
        riesgoEnEstaTabla = true;
        if (ejemplos.length < 8) ejemplos.push({ cols: maxCols, charsPorLinea, len: texto.length, texto: texto.slice(0,60) });
      }
    }
  }
  if (riesgoEnEstaTabla) tablasConRiesgo++;
}

console.log('Tablas con >=2 columnas y al menos una celda que probablemente envuelve a 2+ lineas:', tablasConRiesgo, 'de', tablas.length);
console.log('Celdas totales con texto:', celdasTotal, 'celdas que probablemente envuelven:', celdasQueEnvolverian,
  '(' + (100*celdasQueEnvolverian/celdasTotal).toFixed(1) + '%)');
console.log('Ejemplos:', ejemplos);
