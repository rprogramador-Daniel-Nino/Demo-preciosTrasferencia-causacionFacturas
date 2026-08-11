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
const { redactarConFallback } = require('./redaccionConFallback');

if (!getApps().length) initializeApp();

const GEMINI_MODEL = 'gemini-3.5-flash';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

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

/* Con respaldo en Gemini: esta función llama a Anthropic directamente y no pasa por
   `/api/claude`, así que hasta el 2026-08-11 se quedaba sin el fallback del proxy. Con el
   tope de uso de la cuenta alcanzado, la redacción fallaba y la corrida entera se perdía
   —y esta corre una vez al mes—. `extraerJSON` escanea llaves balanceadas, así que tolera
   igual el JSON que Gemini suele envolver en markdown. */
async function redactarNarrativa(claudeApiKey, geminiApiKey, series, anioActual) {
  const { texto } = await redactarConFallback({
    prompt: construirPromptRedaccion(series, anioActual),
    claudeApiKey, geminiApiKey,
    modeloClaude: CLAUDE_MODEL, modeloGemini: GEMINI_MODEL,
  });
  return parsearRespuestaRedaccion(texto);
}

/** Corrida completa: busca, redacta y guarda. Si Gemini o Claude fallan, la
 *  excepción se propaga sin escribir nada — se prefiere conservar el mes
 *  anterior en Firestore a guardar un documento a medias. */
async function actualizarAnalisisMercado({ geminiApiKey, claudeApiKey, anioActual }) {
  const series = await buscarCifras(geminiApiKey, anioActual);

  // Solo se redacta y se guarda sobre las series que vinieron de una búsqueda
  // real (grounding no vacío). parsearRespuestaBusqueda conserva las demás con
  // confiable:false y fuenteUrl:null en vez de descartarlas -- ese objeto no
  // puede llegar tal cual a construirPromptRedaccion, o una cifra recordada de
  // memoria terminaría en el prompt de redacción de Claude.
  const seriesConfiables = Object.fromEntries(
    Object.entries(series).filter(([, s]) => s.confiable)
  );
  if (!Object.keys(seriesConfiables).length) {
    throw new Error('Ninguna serie trajo un dato confiable esta corrida; se conserva la anterior.');
  }

  const narrativa = await redactarNarrativa(claudeApiKey, geminiApiKey, seriesConfiables, anioActual);

  const ahora = Timestamp.now();
  const documento = armarDocumentoFirestore({ series: seriesConfiables, narrativa, ahora });

  const db = getFirestore();
  const claveMes = ahora.toDate().toISOString().slice(0, 7); // "2026-08"
  await db.doc('analisisMercado/actual').set(documento);
  await db.doc(`analisisMercado/actual/historial/${claveMes}`).set(documento);

  return documento;
}

module.exports = { actualizarAnalisisMercado };
