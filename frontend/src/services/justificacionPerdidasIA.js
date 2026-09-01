/* ─────────────────────────────────────────────────────────────────────────────
   justificacionPerdidasIA.js — redacta la justificación de admitir comparables en pérdida.

   POR QUÉ EXISTE. El campo estaba y se llenaba con una línea suelta —«Las perdidas de las
   comparable se admiten»—, que es la idea sin el sustento. Ese texto se publica en el Excel de
   soporte y viaja al informe: es lo único que le explica a un revisor por qué la muestra incluye
   compañías en pérdida.

   LO QUE LA IA NO PUEDE SABER, Y NO INVENTA. Las Guías OCDE (cap. III, §3.64-3.65) no dicen «las
   pérdidas se admiten»: dicen que una pérdida no descalifica por sí sola SIEMPRE QUE se analice
   su causa. La causa —por qué el sector tuvo pérdidas en el año gravable— no está en ningún dato
   del estudio, así que se le pide al analista y el prompt prohíbe expresamente inventarla. Sin
   causa no se redacta: devolver un párrafo bien escrito que afirme un hecho que nadie verificó
   sería lo peor que este módulo podría hacer, porque el documento se radica.

   LAS CIFRAS TAMPOCO SE INVENTAN: se le pasan calculadas y el prompt le prohíbe producir otras.

   Mismo patrón que `criteriosScreeningIA.js` y `descripcionComparables.js`: una llamada, reintento
   en 429, y NUNCA lanza — si Anthropic no responde, el campo sigue siendo editable a mano como
   siempre. Es asistencia, no un requisito del flujo.
   ───────────────────────────────────────────────────────────────────────────── */

import axios from 'axios';

/* Sonnet y no Haiku: son ~150 palabras una vez por estudio, y es texto que se radica ante la
   DIAN. El reparto por costo de CLAUDE.md manda Haiku para lo masivo —traducir criterios, leer
   descripciones de cientos de comparables— y Sonnet para la redacción que sostiene el informe.
   Esto es lo segundo. */
const MODELO = 'claude-sonnet-5';
const MAX_TOKENS = 900;

/** Cuántos márgenes de comparables se citan en el prompt: bastan para sustentar el párrafo. */
const MARGENES_EN_PROMPT = 8;

const pct = (v) => (v === null || v === undefined || Number.isNaN(v))
  ? '—'
  : `${(v * 100).toLocaleString('es-CO', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} %`;

/**
 * El prompt. Se construye con los hechos ya calculados del estudio, nunca con cifras que el
 * modelo tenga que deducir.
 *
 * @param {object} hechos
 * @param {string} hechos.causa           lo que el analista escribió: por qué el sector tuvo pérdidas.
 * @param {string} [hechos.entidad]       razón social de la parte examinada.
 * @param {number} [hechos.anio]          año gravable.
 * @param {string} [hechos.actividad]     actividad detectada.
 * @param {number} [hechos.indicador]     margen de la parte examinada, en tanto por uno.
 * @param {string} [hechos.metodo]        indicador de rentabilidad (MO, MB, Berry…).
 * @param {number} [hechos.enLaMuestra]   cuántas comparables en pérdida integran la muestra.
 * @param {number} [hechos.deLaMuestra]   tamaño de la muestra.
 * @param {number} [hechos.disponibles]   cuántas había en el universo con la misma actividad.
 * @param {Array<number>} [hechos.margenes] márgenes de las que entraron, en tanto por uno.
 * @param {string} [hechos.criterio]      con qué criterio se eligieron.
 */
export function promptJustificacion(hechos = {}) {
  const h = hechos;
  const margenes = (h.margenes || [])
    .slice(0, MARGENES_EN_PROMPT)
    .map((m) => pct(m))
    .join(', ');

  const datos = [
    h.entidad ? `Parte examinada: ${h.entidad}` : null,
    h.anio ? `Año gravable: ${h.anio}` : null,
    h.actividad ? `Actividad detectada: ${h.actividad}` : null,
    h.metodo ? `Indicador de rentabilidad: ${h.metodo}` : null,
    (h.indicador !== null && h.indicador !== undefined)
      ? `Margen de la parte examinada: ${pct(h.indicador)}` : null,
    (h.enLaMuestra !== undefined)
      ? `Comparables en pérdida que integran la muestra: ${h.enLaMuestra} de ${h.deLaMuestra}` : null,
    (h.disponibles !== undefined)
      ? `Comparables en pérdida disponibles en el universo con la misma actividad: ${h.disponibles}` : null,
    margenes ? `Márgenes de las comparables en pérdida incluidas: ${margenes}` : null,
    h.criterio === 'cercania-al-contribuyente'
      ? 'Criterio de selección: se eligieron las de perfil de rentabilidad más cercano al de la parte examinada'
      : null,
  ].filter(Boolean).join('\n');

  return `Eres consultor senior de precios de transferencia en Colombia y redactas para un Informe
Local que se radica ante la DIAN.

Redacta UN SOLO PÁRRAFO de 120 a 180 palabras que justifique la inclusión de comparables con
pérdida operativa en la muestra de este estudio.

El párrafo debe hilar, en este orden y sin subtítulos ni viñetas:
1. El hecho de este estudio: que la muestra incluye comparables en pérdida, con las cifras que se
   te dan más abajo.
2. La causa de esas pérdidas, que es la que el analista consigna. Úsala tal como está: es el
   análisis de causa que exigen las Guías.
3. El fundamento: Guías OCDE sobre Precios de Transferencia, capítulo III, párrafos 3.64 y 3.65
   —una comparable en pérdida no se descarta por ese solo hecho, siempre que se analice la causa
   y esta responda a condiciones normales de mercado— y el artículo 260-4 del Estatuto Tributario
   sobre criterios de comparabilidad.
4. Por qué excluirlas sesgaría el análisis: la muestra perdería su extremo inferior, el rango se
   desplazaría al alza y la parte examinada quedaría comparada únicamente contra compañías
   rentables.

REGLAS QUE NO PUEDES ROMPER:
- NO inventes causas, hechos económicos, cifras, sectores ni fuentes. La única causa admisible es
  la que se te entrega; las únicas cifras admisibles son las de la lista de datos.
- NO afirmes que la parte examinada cumple ni que el estudio cumple: eso lo determina el rango.
- NO uses primera persona del singular ni te dirijas al lector.
- Registro técnico-formal, en español de Colombia, tiempo presente o pretérito perfecto.
- Devuelve ÚNICAMENTE el párrafo, sin comillas, sin encabezado y sin markdown.

CAUSA DE LAS PÉRDIDAS DEL SECTOR, según el analista:
${String(h.causa || '').trim()}

DATOS DEL ESTUDIO:
${datos || '(sin datos adicionales)'}`;
}

function textoDeRespuesta(data) {
  const bloques = (data && data.content) || [];
  return bloques.map((b) => b.text || '').join('').trim();
}

/* El modelo a veces envuelve en comillas o en una valla de markdown pese a la instrucción. Se
   limpia acá y no en el prompt: pedirlo dos veces no lo evita, y esto sí. */
function limpiar(texto) {
  let t = String(texto || '').trim();
  t = t.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  t = t.replace(/^["“']+/, '').replace(/["”']+$/, '').trim();
  /* Un encabezado que el modelo agregue por su cuenta. */
  t = t.replace(/^(justificaci[óo]n[^\n:]*:\s*)/i, '').trim();
  return t;
}

/* Mismo reintento en 429 que los otros servicios de redacción del repo. */
async function postConReintento(payload, { post, reintentos, pausaMs }) {
  let ultimo;
  for (let intento = 1; intento <= reintentos; intento += 1) {
    try {
      return await post('/api/claude', payload);
    } catch (err) {
      ultimo = err;
      const es429 = err && err.response && err.response.status === 429;
      if (!es429 || intento === reintentos) break;
      await new Promise((r) => setTimeout(r, intento * pausaMs));
    }
  }
  throw ultimo;
}

/**
 * Redacta la justificación, o devuelve `null` sin lanzar.
 *
 * `null` cubre tres casos y ninguno debe romper nada: no hay causa escrita, el modelo no
 * respondió, o respondió vacío. La pantalla sigue con el campo editable a mano.
 *
 * @param {object} hechos  los del estudio, ver `promptJustificacion`.
 * @param {object} [io]    inyección para las pruebas.
 * @returns {Promise<string|null>}
 */
export async function redactarJustificacionPerdidas(hechos = {}, io = {}) {
  const {
    post = axios.post, reintentos = 3, pausaMs = 3000,
  } = io;

  /* Sin causa NO se redacta. Es la regla que sostiene todo el módulo: el análisis de causa es
     lo que exigen las Guías y es lo único que la IA no puede saber. */
  if (!String(hechos.causa || '').trim()) return null;

  try {
    const respuesta = await postConReintento({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: promptJustificacion(hechos) }],
    }, { post, reintentos, pausaMs });
    const texto = limpiar(textoDeRespuesta(respuesta && respuesta.data));
    return texto || null;
  } catch (err) {
    console.warn('[justificacionPerdidasIA] no se pudo redactar la justificación:', err && err.message);
    return null;
  }
}
