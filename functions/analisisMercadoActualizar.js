// functions/analisisMercadoActualizar.js
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const {
  construirPromptBusqueda,
  parsearRespuestaBusqueda,
  construirPromptRedaccion,
  parsearRespuestaRedaccion,
  armarDocumentoFirestore,
} = require('./analisisMercadoPrompts');

if (!getApps().length) initializeApp();

const GEMINI_MODEL = 'gemini-3-flash-preview';
const CLAUDE_MODEL = 'claude-sonnet-5';

async function buscarCifras(geminiApiKey, anioActual) {
  const prompt = construirPromptBusqueda(anioActual);
  const respuesta = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
    }
  );
  const data = await respuesta.json();
  const candidato = data && data.candidates && data.candidates[0];
  if (!respuesta.ok || !candidato) {
    throw new Error('Gemini no devolvió una respuesta usable: ' + JSON.stringify(data).slice(0, 500));
  }
  const texto = (candidato.content.parts || []).map((p) => p.text || '').join('');
  const groundingChunks = (candidato.groundingMetadata && candidato.groundingMetadata.groundingChunks) || [];
  return parsearRespuestaBusqueda(texto, groundingChunks);
}

async function redactarNarrativa(claudeApiKey, series, anioActual) {
  const prompt = construirPromptRedaccion(series, anioActual);
  const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await respuesta.json();
  if (!respuesta.ok || !data.content || !data.content[0]) {
    throw new Error('Claude no devolvió una respuesta usable: ' + JSON.stringify(data).slice(0, 500));
  }
  const texto = data.content.map((b) => b.text || '').join('');
  return parsearRespuestaRedaccion(texto);
}

/** Corrida completa: busca, redacta y guarda. Si Gemini o Claude fallan, la
 *  excepción se propaga sin escribir nada — se prefiere conservar el mes
 *  anterior en Firestore a guardar un documento a medias. */
async function actualizarAnalisisMercado({ geminiApiKey, claudeApiKey, anioActual }) {
  const series = await buscarCifras(geminiApiKey, anioActual);

  // Solo se redacta y se guarda sobre series con fuenteUrl verificada contra el
  // grounding real de Gemini. parsearRespuestaBusqueda (Task 1) conserva las series
  // sin fuente confiable con confiable:false y fuenteUrl:null en vez de descartarlas
  // -- ese objeto no puede llegar tal cual a construirPromptRedaccion, o una cifra
  // sin fuente verificada terminaría en el prompt de redacción de Claude.
  const seriesConfiables = Object.fromEntries(
    Object.entries(series).filter(([, s]) => s.confiable)
  );
  if (!Object.keys(seriesConfiables).length) {
    throw new Error('Ninguna serie trajo un dato confiable esta corrida; se conserva la anterior.');
  }

  const narrativa = await redactarNarrativa(claudeApiKey, seriesConfiables, anioActual);

  const ahora = Timestamp.now();
  const documento = armarDocumentoFirestore({ series: seriesConfiables, narrativa, ahora });

  const db = getFirestore();
  const claveMes = ahora.toDate().toISOString().slice(0, 7); // "2026-08"
  await db.doc('analisisMercado/actual').set(documento);
  await db.doc(`analisisMercado/actual/historial/${claveMes}`).set(documento);

  return documento;
}

module.exports = { actualizarAnalisisMercado };
