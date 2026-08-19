#!/usr/bin/env node
/* Script de mantenimiento de una sola vez: localiza (y opcionalmente corrige) URLs de
 * fuente rotas dentro de las colecciones de Firestore que alimentan el análisis de
 * mercado/sector del informe (III.A/III.B/III.C). No hace ninguna llamada de red para
 * verificar las URLs -esa verificación la hace el usuario a mano-, solo busca dónde
 * viven en los documentos ya guardados.
 *
 * Uso:
 *   node scripts/gestionar-urls-rotas.js <url1> [url2 ...]
 *   node scripts/gestionar-urls-rotas.js --file lista-urls-rotas.txt
 *   node scripts/gestionar-urls-rotas.js <url1> ... --fix
 *
 * Requiere credenciales de Application Default Credentials con acceso al proyecto
 * (`gcloud auth application-default login`).
 */
'use strict';

const fs = require('fs');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'precios-trasnferencia';

function parsearArgumentos(argv) {
  const args = argv.slice(2);
  const fix = args.includes('--fix');
  const resto = args.filter((a) => a !== '--fix');
  const idxFile = resto.indexOf('--file');

  let urls;
  if (idxFile !== -1) {
    const ruta = resto[idxFile + 1];
    if (!ruta) throw new Error('--file requiere una ruta de archivo.');
    urls = fs.readFileSync(ruta, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } else {
    urls = resto;
  }

  if (!urls.length) {
    throw new Error(
      'Uso: node scripts/gestionar-urls-rotas.js <url1> [url2 ...] | --file lista.txt [--fix]'
    );
  }
  return { urls, fix };
}

/** Recorre recursivamente un documento buscando, en cualquier campo string, alguna de
 *  las URLs rotas -por igualdad exacta (caso `fuenteUrl` suelto) o como substring
 *  (caso cita bibliográfica completa: "...Recuperado de https://...")-. Genérico y no
 *  atado a nombres de campo, para no quedar corto ante variaciones de esquema. */
function buscarEnValor(valor, urls, rutaActual, hallazgos) {
  if (typeof valor === 'string') {
    for (const url of urls) {
      if (valor === url) {
        hallazgos.push({ ruta: rutaActual, url, tipo: 'exacta', texto: valor });
        return;
      }
      if (valor.includes(url)) {
        hallazgos.push({ ruta: rutaActual, url, tipo: 'substring', texto: valor });
        return;
      }
    }
    return;
  }
  if (Array.isArray(valor)) {
    valor.forEach((item, i) => buscarEnValor(item, urls, rutaActual ? `${rutaActual}[${i}]` : `[${i}]`, hallazgos));
    return;
  }
  if (valor && typeof valor === 'object') {
    if (typeof valor.toDate === 'function') return; // Firestore Timestamp: no recorrer sus internos.
    Object.keys(valor).forEach((k) => buscarEnValor(valor[k], urls, rutaActual ? `${rutaActual}.${k}` : k, hallazgos));
  }
}

/** "porAnio.2026.narrativa.fuentesCitadas[0].url" -> ['porAnio','2026','narrativa','fuentesCitadas',0,'url'] */
function analizarRuta(ruta) {
  const segmentos = [];
  ruta.split('.').forEach((parte) => {
    const m = parte.match(/^([^[]+)((?:\[\d+])*)$/);
    if (!m) { segmentos.push(parte); return; }
    segmentos.push(m[1]);
    const indices = m[2].match(/\d+/g);
    if (indices) indices.forEach((i) => segmentos.push(Number(i)));
  });
  return segmentos;
}

function esRutaDeCitacion(ruta) {
  const s = analizarRuta(ruta);
  return s[s.length - 1] === 'url' && s.length >= 3
    && s[s.length - 3] === 'fuentesCitadas' && typeof s[s.length - 2] === 'number';
}

function describirContexto(data, ruta) {
  const s = analizarRuta(ruta);
  let nodo = data;
  for (let i = 0; i < s.length - 1; i++) nodo = nodo ? nodo[s[i]] : undefined;
  if (!nodo || typeof nodo !== 'object') return '';
  const partes = [];
  for (const clave of ['indicador', 'dato', 'fuente', 'titulo']) {
    if (typeof nodo[clave] === 'string' && nodo[clave].trim()) partes.push(`${clave}: ${nodo[clave]}`);
  }
  return partes.join(', ');
}

function anularCampo(data, ruta) {
  const s = analizarRuta(ruta);
  const ultimo = s[s.length - 1];
  let nodo = data;
  for (let i = 0; i < s.length - 1; i++) nodo = nodo[s[i]];
  nodo[ultimo] = null;
  if (Object.prototype.hasOwnProperty.call(nodo, 'confiable')) nodo.confiable = false;
}

function eliminarCitasDeArreglos(data, rutasCitacion) {
  const porArreglo = new Map();
  for (const ruta of rutasCitacion) {
    const s = analizarRuta(ruta);
    const clavePadre = s.slice(0, -2).join('.');
    const indice = s[s.length - 2];
    if (!porArreglo.has(clavePadre)) porArreglo.set(clavePadre, []);
    porArreglo.get(clavePadre).push(indice);
  }
  for (const [clavePadre, indices] of porArreglo) {
    const segmentosPadre = analizarRuta(clavePadre);
    let arreglo = data;
    for (const seg of segmentosPadre) arreglo = arreglo[seg];
    indices.sort((a, b) => b - a).forEach((i) => arreglo.splice(i, 1));
  }
}

async function recolectarDocumentos(db) {
  const docs = [];

  const snapSector = await db.collection('analisisSector').get();
  snapSector.forEach((d) => docs.push({ ref: d.ref, data: d.data(), etiqueta: `analisisSector/${d.id}` }));

  const refMercadoActual = db.doc('analisisMercado/actual');
  const snapMercadoActual = await refMercadoActual.get();
  if (snapMercadoActual.exists) {
    docs.push({ ref: refMercadoActual, data: snapMercadoActual.data(), etiqueta: 'analisisMercado/actual' });
  }
  const snapHistorial = await db.collection('analisisMercado/actual/historial').get();
  snapHistorial.forEach((d) => docs.push({
    ref: d.ref, data: d.data(), etiqueta: `analisisMercado/actual/historial/${d.id}`,
  }));

  const snapNarrativa = await db.collection('narrativaMacroPorEstudio').get();
  snapNarrativa.forEach((d) => docs.push({
    ref: d.ref, data: d.data(), etiqueta: `narrativaMacroPorEstudio/${d.id}`,
  }));

  return docs;
}

async function main() {
  const { urls, fix } = parsearArgumentos(process.argv);

  initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore();

  const documentos = await recolectarDocumentos(db);
  console.log(
    `Documentos escaneados: ${documentos.length} `
    + `(analisisSector + analisisMercado/actual + historial + narrativaMacroPorEstudio)`
  );
  console.log(`URLs a buscar: ${urls.length}`);

  const urlsEncontradas = new Set();
  let totalHallazgos = 0;
  let documentosModificados = 0;

  for (const doc of documentos) {
    const hallazgos = [];
    buscarEnValor(doc.data, urls, '', hallazgos);
    if (!hallazgos.length) continue;

    totalHallazgos += hallazgos.length;
    console.log(`\n${doc.etiqueta}`);
    for (const h of hallazgos) {
      urlsEncontradas.add(h.url);
      const contexto = describirContexto(doc.data, h.ruta);
      const marca = h.tipo === 'substring' ? ' [dentro de texto más largo, no se auto-corrige]' : '';
      console.log(`  - ${h.ruta}${contexto ? '  (' + contexto + ')' : ''}${marca}`);
      if (h.tipo === 'substring') console.log(`      texto: ${h.texto}`);
    }

    if (fix) {
      const rutasExactas = hallazgos.filter((h) => h.tipo === 'exacta').map((h) => h.ruta);
      const rutasCitacion = rutasExactas.filter(esRutaDeCitacion);
      const rutasSimples = rutasExactas.filter((r) => !esRutaDeCitacion(r));

      if (rutasCitacion.length) eliminarCitasDeArreglos(doc.data, rutasCitacion);
      rutasSimples.forEach((r) => anularCampo(doc.data, r));

      if (rutasCitacion.length || rutasSimples.length) {
        await doc.ref.set(doc.data);
        documentosModificados++;
        console.log(`  -> corregido (${rutasCitacion.length + rutasSimples.length} coincidencia(s) exacta(s))`);
      }
      const pendientesManual = hallazgos.length - rutasExactas.length;
      if (pendientesManual) console.log(`  -> ${pendientesManual} coincidencia(s) requieren revisión manual (no se auto-corrigen)`);
    }
  }

  console.log(`\nTotal coincidencias: ${totalHallazgos}`);
  const noEncontradas = urls.filter((u) => !urlsEncontradas.has(u));
  if (noEncontradas.length) {
    console.log(`\nNo se encontraron en Firestore (${noEncontradas.length}) -ya corregidas, o viven en otro lugar (docx/plantilla/prompt) distinto de estas 3 colecciones-:`);
    noEncontradas.forEach((u) => console.log(`  - ${u}`));
  }
  console.log(fix
    ? `\nDocumentos corregidos: ${documentosModificados}`
    : '\nModo reporte: no se escribió nada en Firestore. Usa --fix para aplicar la limpieza a las coincidencias exactas.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { buscarEnValor, analizarRuta, esRutaDeCitacion, anularCampo, eliminarCitasDeArreglos };
