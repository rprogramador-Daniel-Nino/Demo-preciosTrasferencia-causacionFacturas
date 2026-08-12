'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
   redaccionConFallback.js — Pide una redacción a Claude y, si no puede atender,
   la pide a Gemini.

   POR QUÉ EXISTE. El fallback vivía solo en el proxy `/api/claude`, que es por donde
   pasa el navegador. Pero las dos funciones que redactan el análisis de mercado y el
   del sector llaman a `api.anthropic.com` DIRECTAMENTE —no pasan por el proxy—, así que
   se quedaban sin fallback: el 2026-08-11, con el tope de uso de la cuenta alcanzado,
   su etapa de redacción fallaba y con ella la corrida completa. El cron mensual perdía
   el mes y cualquier actividad nueva se quedaba sin análisis de sector.

   QUÉ HACE Y QUÉ NO. Decide con `debeCaerAGemini`, la misma condición que el proxy: se
   cae solo cuando Anthropic no puede atender algo que sí está bien pedido —sin saldo,
   con el tope de gasto alcanzado, con el límite de peticiones o sobrecargado—. Un 400
   por petición mal formada o un 401 por key inválida fallarían igual en Gemini y taparlo
   enmascara un defecto propio.

   SI GEMINI TAMPOCO PUEDE, se lanza el error ORIGINAL de Anthropic: es el que explica
   por qué se llegó hasta aquí, y sustituirlo por un fallo de Gemini manda a depurar al
   proveedor equivocado.

   LA TRADUCCIÓN LA HACE `fallbackGemini.js`, que sigue siendo lógica pura y compartida
   con `server.js`. Este módulo es la parte que toca la red, y por eso vive aparte: así
   `fallbackGemini.js` se puede seguir probando sin simular fetch.
   ───────────────────────────────────────────────────────────────────────────── */

const {
  debeCaerAGemini, aPeticionGemini, aRespuestaAnthropic, PROVEEDOR_GEMINI,
} = require('./fallbackGemini');

const URL_ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const URL_GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

/** El texto de una respuesta con forma de Anthropic. */
function textoDeRespuesta(cuerpo) {
  const bloques = (cuerpo && cuerpo.content) || [];
  return bloques.map((b) => (b && b.text) || '').join('');
}

/**
 * Pide una redacción a Claude, con Gemini de respaldo.
 *
 * @param {object} opciones
 * @param {string} opciones.prompt          el prompt de redacción.
 * @param {string} opciones.claudeApiKey
 * @param {string} opciones.geminiApiKey    sin ella no hay respaldo y se propaga el error.
 * @param {string} opciones.modeloClaude
 * @param {string} opciones.modeloGemini
 * @param {number} [opciones.maxTokens]     4096 por defecto, como los dos llamadores.
 * @param {number} [opciones.corteMs]       corte de la llamada de respaldo.
 * @param {Function} [opciones.fetchImpl]   para poder probar sin red.
 * @returns {Promise<{texto:string, proveedor:string}>}
 * @throws {Error} si Claude no pudo y Gemini tampoco: con el mensaje de Anthropic.
 */
async function redactarConFallback({
  prompt, claudeApiKey, geminiApiKey, modeloClaude, modeloGemini,
  maxTokens = 4096, corteMs = 120000, fetchImpl,
}) {
  const pedir = fetchImpl || fetch;
  const cuerpo = {
    model: modeloClaude,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };

  const respuesta = await pedir(URL_ANTHROPIC, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(cuerpo),
  });
  const datos = await respuesta.json();

  if (respuesta.ok && datos && Array.isArray(datos.content) && datos.content.length) {
    return { texto: textoDeRespuesta(datos), proveedor: 'anthropic' };
  }

  /* Mensaje del error de Anthropic, para explicar el fallo con lo que él dijo. */
  const detalle = () => {
    const e = (datos && datos.error) || {};
    return e.message || (datos && datos.message) || JSON.stringify(datos).slice(0, 500);
  };

  if (!debeCaerAGemini(respuesta.status, datos)) {
    throw new Error('Claude no devolvió una respuesta usable: ' + detalle());
  }
  if (!geminiApiKey) {
    throw new Error('Claude no pudo atender (' + detalle() + ') y no hay GEMINI_API_KEY para el respaldo.');
  }

  console.warn(`[fallback] Claude no pudo atender (HTTP ${respuesta.status}); redacta ${modeloGemini}.`);

  let traducida = null;
  try {
    const upstream = await pedir(
      `${URL_GEMINI}/${modeloGemini}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
        body: JSON.stringify(aPeticionGemini(cuerpo)),
        signal: AbortSignal.timeout(corteMs),
      }
    );
    const datosGemini = await upstream.json();
    traducida = upstream.ok ? aRespuestaAnthropic(datosGemini, modeloGemini) : null;
    if (!traducida) console.error('El respaldo con Gemini tampoco devolvió texto:', datosGemini);
  } catch (err) {
    console.error('Error llamando a Gemini como respaldo de Claude:', err);
  }

  if (!traducida) {
    throw new Error('Claude no pudo atender (' + detalle() + ') y el respaldo con Gemini tampoco redactó.');
  }
  return { texto: textoDeRespuesta(traducida), proveedor: PROVEEDOR_GEMINI };
}

module.exports = { redactarConFallback, textoDeRespuesta, URL_ANTHROPIC, URL_GEMINI };
