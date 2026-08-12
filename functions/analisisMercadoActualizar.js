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
  const series = parsearRespuestaBusqueda(texto, groundingChunks);

  /* Qué trajo la corrida, para poder diagnosticarla desde los logs. Sin esto, las tres
     formas de quedarse sin datos —el modelo no buscó, la respuesta se cortó y el JSON no
     se pudo extraer, o vino con claves que no son series— acababan en el mismo mensaje
     («ninguna serie confiable») y no había manera de saber cuál fue. La corrida es mensual:
     esperar a la siguiente para adivinar sale caro. */
  console.info('[analisisMercado] búsqueda: '
    + `grounding=${groundingChunks.length} `
    + `series=${Object.keys(series).length} `
    + `finishReason=${candidato.finishReason || '(sin dato)'} `
    + `largoRespuesta=${texto.length}`);
  if (!groundingChunks.length || !Object.keys(series).length) {
    console.warn('[analisisMercado] respuesta que no dio series utilizables (primeros 700): '
      + texto.slice(0, 700));
  }

  return series;
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
    /* El motivo, en el propio error: «ninguna confiable» tiene dos causas muy distintas y
       arreglarlas requiere cosas distintas. Si no se parseó ninguna serie, el problema está
       en la respuesta (se cortó, o no venía el JSON). Si se parsearon pero ninguna es
       confiable, el modelo contestó de memoria sin usar la búsqueda, y lo que hay que
       cambiar es cómo se le pide. */
    const cuantas = Object.keys(series).length;
    throw new Error(cuantas
      ? `Se parsearon ${cuantas} serie(s) pero ninguna vino de una búsqueda real: el modelo `
        + 'respondió de memoria. Se conserva la corrida anterior.'
      : 'No se pudo parsear ninguna serie de la respuesta de Gemini; ver el log de la '
        + 'respuesta cruda. Se conserva la corrida anterior.');
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
