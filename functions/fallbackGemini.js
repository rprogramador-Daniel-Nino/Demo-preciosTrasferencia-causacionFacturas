'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
   fallbackGemini.js — Cuando Anthropic no puede atender, atiende Gemini.

   POR QUÉ EN EL PROXY Y NO EN EL FRONTEND. Hay catorce llamadas a `/api/claude`
   —trece en `index.html` y una en `descripcionComparables.js`—, todas con la misma
   forma: `model`, `max_tokens` y `messages`, sin `system` en la práctica, sin `tools`
   y sin streaming. Resolverlo aquí las cubre todas sin tocar ninguna, y sobre todo
   sin que catorce sitios distintos tengan que aprender a distinguir un 429 de un
   crédito agotado.

   POR QUÉ LA RESPUESTA SE DEVUELVE CON FORMA DE ANTHROPIC. Los llamadores leen
   `data.content[].text`. Devolver la forma de Gemini —`candidates[0].content.parts`—
   les daría una respuesta vacía SIN error, que es la peor forma de fallar: el informe
   sale sin la redacción y nadie se entera.

   POR QUÉ NO SE CAE SIEMPRE. Un 400 por petición mal formada o un 401 por key
   inválida fallarían igual en Gemini; caer ahí enmascara un defecto propio y deja la
   instalación funcionando a medias. Solo se cae cuando Anthropic no puede atender algo
   que sí está bien pedido: sin saldo, con el límite de peticiones alcanzado o
   sobrecargado.

   ESTE ARCHIVO VIVE EN `functions/` PORQUE ES LO QUE FIREBASE DESPLIEGA, y `server.js`
   lo requiere desde la raíz. Es lógica pura —sin red, sin secretos, sin Firebase—, así
   que las dos implementaciones de JavaScript comparten una sola definición en vez de
   divergir. La del PHP de cPanel sigue siendo un port a mano: otro lenguaje.
   ───────────────────────────────────────────────────────────────────────────── */

/** Valor que se publica para decir que la respuesta no la dio Claude. */
const PROVEEDOR_GEMINI = 'gemini';

/** Cabecera con la que el proxy declara quién atendió. */
const CABECERA_PROVEEDOR = 'X-Proveedor-IA';

/* Lo que Anthropic escribe cuando la cuenta se queda sin saldo. Se compara sobre el
   mensaje porque el `type` es el genérico `invalid_request_error`, el mismo de una
   petición mal formada: el código de estado no alcanza para distinguirlas. */
const RX_SIN_CREDITO = /credit balance|insufficient.*credit|billing/i;

/* Y lo que escribe cuando la organización alcanzó el tope de gasto que ella misma fijó en la
   consola: «You have reached your specified API usage limits. You will regain access on
   2026-09-01 at 00:00 UTC.» Llega como 400 `invalid_request_error`, igual que el crédito
   agotado, pero sin nombrar el saldo, así que el patrón de arriba lo dejaba pasar: el
   2026-08-11 la ingesta de EEFF devolvía 400 al redactar la descripción de cada comparable
   con el fallback recién desplegado e intacto. Es el mismo caso de fondo —la petición está
   bien pedida y Anthropic no la va a atender hasta una fecha—, así que se cae a Gemini igual. */
const RX_TOPE_ALCANZADO = /usage limits?|spend limits?/i;

/**
 * ¿Hay que reintentar esta respuesta de Anthropic contra Gemini?
 *
 * @param {number} status  código HTTP que devolvió Anthropic.
 * @param {object} cuerpo  su cuerpo ya parseado.
 * @returns {boolean}
 */
function debeCaerAGemini(status, cuerpo) {
  /* 429 (límite de peticiones) y 529 (sobrecargado) son transitorios y no dicen nada del
     contenido de la petición: Gemini puede atenderla tal cual. */
  if (status === 429 || status === 529) return true;

  if (status === 400 || status === 402) {
    const error = (cuerpo && cuerpo.error) || {};
    const mensaje = String(error.message || cuerpo && cuerpo.message || '');
    return RX_SIN_CREDITO.test(mensaje) || RX_TOPE_ALCANZADO.test(mensaje);
  }

  return false;
}

/** El texto de un `content` de Anthropic, que puede ser cadena o arreglo de bloques. */
function textoDeContenido(contenido) {
  if (typeof contenido === 'string') return contenido;
  if (!Array.isArray(contenido)) return '';
  return contenido
    .map((b) => (typeof b === 'string' ? b : (b && b.text) || ''))
    .join('');
}

/**
 * Traduce una petición de la API Messages de Anthropic a una de Gemini.
 *
 * El modelo no viaja en el cuerpo: en Gemini va en la URL, así que quien llama decide
 * cuál usar y este módulo no lo arrastra.
 *
 * @param {object} cuerpo  el cuerpo que venía para Anthropic.
 * @returns {object} cuerpo listo para `generateContent`.
 */
function aPeticionGemini(cuerpo) {
  const origen = cuerpo || {};

  const contents = (Array.isArray(origen.messages) ? origen.messages : []).map((m) => ({
    /* Gemini llama «model» a lo que Anthropic llama «assistant». Cualquier otro rol se
       manda como usuario: es lo único que Gemini acepta además de model. */
    role: m && m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: textoDeContenido(m && m.content) }],
  }));

  const generationConfig = {};
  if (origen.max_tokens != null) generationConfig.maxOutputTokens = origen.max_tokens;
  if (origen.temperature != null) generationConfig.temperature = origen.temperature;

  const salida = { contents };
  if (Object.keys(generationConfig).length) salida.generationConfig = generationConfig;

  const system = textoDeContenido(origen.system);
  if (system) salida.systemInstruction = { parts: [{ text: system }] };

  return salida;
}

/* Cómo llama cada uno al motivo por el que dejó de escribir. */
const STOP_REASON = {
  STOP: 'end_turn',
  MAX_TOKENS: 'max_tokens',
  SAFETY: 'stop_sequence',
  RECITATION: 'stop_sequence',
};

/**
 * Traduce la respuesta de Gemini a la forma de la API Messages de Anthropic.
 *
 * @param {object} datos   respuesta de `generateContent` ya parseada.
 * @param {string} modelo  modelo de Gemini que atendió, para que quede constancia.
 * @returns {object|null} la respuesta traducida, o `null` si Gemini no devolvió texto
 *          —un bloqueo por filtros deja `candidates` vacío—. Devolver «» en ese caso
 *          haría pasar un silencio por una respuesta.
 */
function aRespuestaAnthropic(datos, modelo) {
  const candidato = (datos && Array.isArray(datos.candidates) ? datos.candidates[0] : null) || null;
  const partes = (candidato && candidato.content && candidato.content.parts) || [];
  const texto = partes.map((p) => (p && p.text) || '').join('');
  if (!texto.trim()) return null;

  const uso = (datos && datos.usageMetadata) || {};
  return {
    id: 'msg_fallback_gemini',
    type: 'message',
    role: 'assistant',
    model: modelo,
    content: [{ type: 'text', text: texto }],
    stop_reason: STOP_REASON[candidato.finishReason] || 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: uso.promptTokenCount || 0,
      output_tokens: uso.candidatesTokenCount || 0,
    },
    /* Fuera del contrato de Anthropic a propósito: quien lo mire sabe que esto no lo
       redactó Claude. Un campo extra no molesta a ningún llamador. */
    proveedor: PROVEEDOR_GEMINI,
  };
}

module.exports = {
  PROVEEDOR_GEMINI,
  CABECERA_PROVEEDOR,
  debeCaerAGemini,
  aPeticionGemini,
  aRespuestaAnthropic,
};
