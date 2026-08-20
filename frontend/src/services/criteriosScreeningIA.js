import axios from 'axios';
import { extraerJSON } from './comparablesEngine.js';
import { residuoDeCriterios } from './criteriosScreeningEs.js';

/* ══════════════ Respaldo de IA para los criterios de búsqueda ══════════════

   `criteriosScreeningEs.js` traduce con diccionario todo el vocabulario cerrado de
   Capital IQ. Lo que no reconoce —una etiqueta de campo nueva, un título SIC que no está
   en el catálogo sembrado— queda marcado como residuo y se resuelve aquí, con UNA llamada
   a Claude Haiku por tabla, cacheada en el estudio como `etiquetaEs` / `valorEs`.

   Es enriquecimiento, nunca requisito: el render es puro y sincrónico, así que si esta
   llamada no ocurre —sin red, sin saldo, estudio viejo— el informe sale con lo que cubre
   el diccionario y el resto en inglés. Nada se rompe y nada se bloquea.

   Mismo modelo, mismo reintento en 429 y misma regla de «nunca lanza» que
   `descripcionComparables.js`, que es el otro sitio donde se traduce texto de Capital IQ. */

const MODELO_TRADUCCION = 'claude-haiku-4-5-20251001';

function promptTraduccion(pendientes) {
  const lista = pendientes
    .map(({ indice, criterio }) => `${indice}\t${criterio.etiqueta}\t${criterio.valor}`)
    .join('\n');
  return `Eres traductor técnico de un Informe Local de Precios de Transferencia en Colombia.

Traduce al español los siguientes criterios de búsqueda de comparables, tomados de la hoja
"Screen Criteria" de un reporte de Capital IQ. Cada línea trae, separados por tabulación:
índice, etiqueta del campo y valor del criterio.

Reglas:
- NO alteres ningún número: códigos SIC, umbrales, años y porcentajes deben salir idénticos.
- Los términos de búsqueda literales (lo que sigue a "Keyword:") NO se traducen: son la
  cadena exacta que se escribió en Capital IQ.
- Traduce los títulos de industria de los códigos SIC con su nombre en español, conservando
  el código delante.
- Usa registro técnico-formal, como en un informe que se radica ante la DIAN.
- Los conectores OR y AND se escriben O e Y.

Devuelve SOLO un objeto JSON con esta forma, sin texto alrededor:
{"traducciones":[{"indice":0,"etiqueta":"...","valor":"..."}]}

Criterios:
${lista}`;
}

function textoDeRespuesta(data) {
  const bloques = (data && data.content) || [];
  return bloques.map((b) => b.text || '').join('').trim();
}

/* Mismo patrón de reintento en 429 que postClaudeWithRetry de descripcionComparables.js. */
async function postClaudeWithRetry(payload, maxRetries = 3) {
  for (let intento = 1; intento <= maxRetries; intento++) {
    try {
      return await axios.post('/api/claude', payload);
    } catch (err) {
      const es429 = err.response && err.response.status === 429;
      if (es429 && intento < maxRetries) {
        await new Promise((r) => setTimeout(r, intento * 3000));
      } else {
        throw err;
      }
    }
  }
}

/** Secuencia de números del criterio, para comprobar que la IA no cambió ninguno. */
function huellaNumerica(etiqueta, valor) {
  return (String(etiqueta || '') + ' ' + String(valor || '')).match(/\d+/g)?.join(',') || '';
}

/**
 * Añade `etiquetaEs` / `valorEs` a los criterios que el diccionario no pudo cubrir.
 *
 * Nunca lanza y nunca muta la entrada: ante cualquier fallo —red, saldo, respuesta sin
 * JSON, números alterados— devuelve los criterios tal como llegaron.
 *
 * @param {Array} criterios  `study.criteriosScreening`
 * @returns {Promise<Array>} lista nueva con las traducciones aceptadas
 */
export async function traducirCriteriosScreening(criterios) {
  const lista = (criterios || []).slice();
  const residuo = residuoDeCriterios(lista);
  if (!residuo.length) return lista;

  const pendientes = residuo.map(({ indice }) => ({ indice, criterio: lista[indice] }));

  let traducciones;
  try {
    const response = await postClaudeWithRetry({
      model: MODELO_TRADUCCION,
      max_tokens: 2000,
      messages: [{ role: 'user', content: promptTraduccion(pendientes) }],
    });
    /* `extraerJSON` y no `JSON.parse`: el modelo envuelve el objeto en prosa o en cercas
       de markdown con frecuencia (ver CLAUDE.md). */
    const objeto = extraerJSON(textoDeRespuesta(response.data));
    traducciones = Array.isArray(objeto && objeto.traducciones) ? objeto.traducciones : null;
  } catch (err) {
    console.error('[criteriosScreeningIA] no se pudieron traducir los criterios de búsqueda', err);
    return lista;
  }
  if (!traducciones) return lista;

  const porIndice = new Map(pendientes.map((p) => [p.indice, p.criterio]));
  const salida = lista.slice();
  traducciones.forEach((t) => {
    const indice = Number(t && t.indice);
    const criterio = porIndice.get(indice);
    if (!criterio) return;
    const etiquetaEs = String((t && t.etiqueta) || '').trim();
    const valorEs = String((t && t.valor) || '').trim();
    if (!etiquetaEs && !valorEs) return;
    /* El par se acepta o se descarta completo: aceptar medio dejaría la etiqueta y el
       valor de un mismo criterio describiendo cosas distintas. */
    if (huellaNumerica(etiquetaEs, valorEs) !== huellaNumerica(criterio.etiqueta, criterio.valor)) {
      console.warn('[criteriosScreeningIA] traducción descartada: los números no coinciden con el criterio '
        + indice + ' («' + criterio.etiqueta + '»)');
      return;
    }
    salida[indice] = { ...criterio, etiquetaEs, valorEs };
  });
  return salida;
}
