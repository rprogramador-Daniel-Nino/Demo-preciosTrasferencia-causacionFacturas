// functions/analisisSectorActualizar.js
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const {
  normalizarActividad,
  claveActividad,
  necesitaResumenActividad,
  recortarActividad,
  construirPromptResumenActividad,
  parsearRespuestaResumenActividad,
  construirPromptBusquedaSector,
  parsearRespuestaBusquedaSector,
  filtrarConfiables,
  construirPromptRedaccionSector,
  parsearRespuestaRedaccionSector,
  armarEntradaAnio,
} = require('./analisisSectorPrompts');

if (!getApps().length) initializeApp();

const GEMINI_MODEL = 'gemini-3-flash-preview';
const CLAUDE_MODEL = 'claude-sonnet-5';

/** La `actividad` que llega del estudio a veces es la descripción completa del
 *  objeto social (varios cientos de caracteres, con la matriz, los activos y
 *  los riesgos), no una etiqueta corta de sector. Buscarla tal cual con
 *  `google_search` no da grounding —ver el comentario junto a
 *  LARGO_ACTIVIDAD_CORTA en analisisSectorPrompts.js—, así que primero se
 *  reduce a una frase de sector con un llamado liviano a Gemini (sin
 *  herramienta de búsqueda). Si ese llamado falla, se recorta sin IA: sigue
 *  siendo mejor una frase corta imperfecta que la descripción completa. */
async function resumirActividad(geminiApiKey, actividad) {
  if (!necesitaResumenActividad(actividad)) return actividad;
  try {
    const prompt = construirPromptResumenActividad(actividad);
    const respuesta = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    const data = await respuesta.json();
    const candidato = data && data.candidates && data.candidates[0];
    if (!respuesta.ok || !candidato) {
      throw new Error('Gemini no devolvió una respuesta usable: ' + JSON.stringify(data).slice(0, 500));
    }
    const texto = (candidato.content.parts || []).map((p) => p.text || '').join('');
    return parsearRespuestaResumenActividad(texto);
  } catch (err) {
    console.error('No se pudo resumir la actividad con IA, se recorta sin IA:', err.message);
    return recortarActividad(actividad);
  }
}

async function buscarDatosSector(geminiApiKey, actividad, year) {
  const prompt = construirPromptBusquedaSector(actividad, year);
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
  return parsearRespuestaBusquedaSector(texto, groundingChunks);
}

async function redactarSector(claudeApiKey, datosConfiables, actividad, year) {
  const prompt = construirPromptRedaccionSector(datosConfiables, actividad, year);
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
  return parsearRespuestaRedaccionSector(texto);
}

/** Corrida completa para una actividad y un año: busca, redacta y guarda bajo
 *  `analisisSector/{clave}.porAnio.{year}`, con `merge: true` para no pisar
 *  otros años ya guardados para la misma actividad. Si Gemini o Claude
 *  fallan, la excepción se propaga sin escribir nada. */
async function actualizarAnalisisSector({ geminiApiKey, claudeApiKey, actividad, year }) {
  const actividadNormalizada = normalizarActividad(actividad);
  if (!actividadNormalizada) {
    throw new Error('La actividad está vacía: no hay nada que buscar ni bajo qué clave guardarlo.');
  }
  const clave = claveActividad(actividadNormalizada);

  const actividadBusqueda = await resumirActividad(geminiApiKey, actividad);
  const datos = await buscarDatosSector(geminiApiKey, actividadBusqueda, year);
  const datosConfiables = filtrarConfiables(datos);
  const hayAlgunDato =
    datosConfiables.datosClaveTabla.length ||
    datosConfiables.datosComportamiento.length ||
    datosConfiables.datosComercioExterior.length ||
    datosConfiables.datosProyeccion.length;
  if (!hayAlgunDato) {
    throw new Error('Ningún dato del sector trajo confirmación de búsqueda esta corrida.');
  }

  const narrativa = await redactarSector(claudeApiKey, datosConfiables, actividad, year);

  const ahora = Timestamp.now();
  const entrada = armarEntradaAnio({ datosVerificados: datosConfiables, narrativa, ahora });

  const db = getFirestore();
  await db.doc(`analisisSector/${clave}`).set({
    actividadOriginal: actividad,
    actividadNormalizada,
    porAnio: { [String(year)]: entrada },
  }, { merge: true });

  return { clave, entrada };
}

module.exports = { actualizarAnalisisSector };
