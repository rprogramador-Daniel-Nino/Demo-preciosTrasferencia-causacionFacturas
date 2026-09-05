/* ─────────────────────────────────────────────────────────────────────────────
   actividadComparables.js — la actividad de una comparable cuando su EEFF no la dice.

   POR QUÉ EXISTE. Una comparable creada desde su estado financiero nace sin descripción del
   negocio: el cribado de Capital IQ trae `desc` y un PDF de cifras no. Sin ese texto la
   redacción automática la salta —filtra por `desc` no vacío— y la fila se queda con «Actividad
   sin verificar» y un textarea que el analista llena a mano, una por una.

   El primer camino, y el que manda, es el DOCUMENTO: el prompt del lote pide la actividad de la
   nota de «Entidad reportante» / «Objeto social» / «Nature of operations», con su rótulo, y de
   ahí sale `desc` respaldada por el papel que se adjunta en el ANEXO B.

   Este servicio es el SEGUNDO camino, para lo que el documento calla — un estado de resultados
   suelto no publica ninguna nota, y así llega buena parte de lo que se busca a mano—. Pregunta
   por razón social y devuelve a qué se dedica la compañía.

   LA REGLA QUE LO HACE UTILIZABLE: si el modelo no conoce la compañía, devuelve la actividad
   VACÍA y `seguro: false`, y aquí se descarta. Un hueco lo llena el analista; una actividad
   inventada la firma su cliente y la lee la DIAN, que es a quien hay que sustentarle la
   comparabilidad (Art. 260-4 E.T.). Por eso el prompt insiste en que no adivine desde el
   nombre: «ASIA AROMA CORP» no autoriza a escribir «fabricación de aromas».

   Y POR ESO SE MARCA EL ORIGEN. Lo que sale de aquí NO tiene respaldo documental, y la tabla lo
   dice en ámbar para que el analista lo confirme. La procedencia se queda en pantalla y no viaja
   al informe: por decisión del usuario (2026-09-05), el ANEXO B publica la actividad y no de
   dónde salió.

   Servicio puro salvo la llamada, como `descripcionComparables.js`: el prompt y la lectura de la
   respuesta se prueban sin red.
   ───────────────────────────────────────────────────────────────────────────── */

import axios from 'axios';
import { extraerJSON, claveDeCruce } from './comparablesEngine.js';

/* Sonnet y no Haiku, que es el de por defecto del reparto por costo. Esto no es redacción sino
   RECUERDO de un hecho —a qué se dedica una compañía que cotiza en Bombay o en Fráncfort— y lo
   que se le pide de fondo es que sepa distinguir lo que conoce de lo que no. Un modelo peor
   calibrado en eso no falla devolviendo menos: falla devolviendo una actividad verosímil de una
   empresa que no conoce, que es justo lo que este servicio existe para no hacer. Es UNA llamada
   por lote, con todos los nombres juntos. */
const MODELO_ACTIVIDAD = 'claude-sonnet-5';

/** El prompt: todos los nombres mudos en una sola consulta. */
export function promptActividadPorRazonSocial(nombres) {
  const lista = (Array.isArray(nombres) ? nombres : [])
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  if (!lista.length) return '';

  return `Eres analista de Precios de Transferencia y estás documentando la actividad económica de un conjunto de compañías comparables para un Informe Local en Colombia.

Para CADA compañía de la lista devuelve a qué se dedica: qué produce, comercializa o presta, y en qué sector opera. Dos o tres frases, en español, en el tono de una descripción de negocio de un informe —no un texto publicitario ni una reseña histórica—.

REGLA CENTRAL, y es la que importa: responde SOLO por las compañías que de verdad conoces. Si una razón social no te resulta identificable, o dudas de estar pensando en otra empresa con nombre parecido, devuelve "actividad" en cadena vacía y "seguro": false. Esa es una respuesta CORRECTA y esperada, no un fallo.

NO DEDUZCAS la actividad de la razón social. «ASIA AROMA CORP» te dice cómo se llama, no a qué se dedica: si no conoces la compañía, el nombre no autoriza a escribir «fabricación de aromas». Una actividad inventada acaba publicada en un informe tributario como si fuera un hecho verificado, y ese es el daño que hay que evitar.

Devuelve SOLO un JSON estricto, sin texto alrededor:
{
  "companias": [
    {
      "nombre": "<la razón social EXACTA como te la di, para poder cruzarla>",
      "actividad": "<a qué se dedica, o cadena vacía si no la conoces>",
      "seguro": true
    }
  ]
}

Una entrada por cada compañía de la lista, en el mismo orden, incluidas las que no conozcas.

COMPAÑÍAS:
${lista.map((n, i) => `${i + 1}. ${n}`).join('\n')}`;
}

/**
 * Lee la respuesta y la cruza contra lo que se pidió.
 *
 * El cruce va por `claveDeCruce` y no por el nombre literal: el modelo devuelve «Symrise AG»
 * donde se le pidió «SYMRISE AG», y con una comparación estricta se perdería la respuesta que
 * sí dio. Es la misma clave con la que el resto del sistema reconoce a una compañía escrita de
 * dos formas.
 *
 * Nunca lanza: una respuesta ilegible deja el lote sin actividades, no lo tumba.
 *
 * @returns {Array<{nombre: string, actividad: string}>} solo las que volvieron con actividad
 *   y `seguro !== false`. Lo demás se descarta aquí, y no más adelante.
 */
export function leerRespuestaActividades(texto, nombres) {
  const pedidos = (Array.isArray(nombres) ? nombres : [])
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  if (!pedidos.length) return [];

  let parsed = null;
  try {
    parsed = extraerJSON(String(texto || ''));
  } catch {
    /* El modelo envolvió el JSON en prosa que ni `extraerJSON` pudo rescatar. */
    return [];
  }
  const devueltas = parsed && Array.isArray(parsed.companias) ? parsed.companias : [];
  if (!devueltas.length) return [];

  /* Indexado por clave para poder devolver el nombre TAL COMO SE PIDIÓ: es el que está en la
     fila de la tabla, y con el que el llamador la encuentra. */
  const porClave = new Map();
  devueltas.forEach((c) => {
    const clave = claveDeCruce((c && c.nombre) || '');
    if (clave && !porClave.has(clave)) porClave.set(clave, c);
  });

  const salida = [];
  pedidos.forEach((nombre) => {
    const c = porClave.get(claveDeCruce(nombre));
    if (!c) return;
    /* `seguro: false` es la forma de decir «no la conozco», y una actividad vacía dice lo
       mismo aunque el modelo se haya olvidado de la bandera. Cualquiera de las dos descarta. */
    if (c.seguro === false) return;
    const actividad = String(c.actividad || '').trim();
    if (!actividad) return;
    salida.push({ nombre, actividad });
  });
  return salida;
}

/* Mismo reintento en 429 que `descripcionComparables.js` y `eeffParser.js`. */
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

/**
 * Busca la actividad de varias compañías por su razón social. UNA sola llamada.
 *
 * Nunca lanza: quedarse sin actividades es un inconveniente —el analista las escribe— y tumbar
 * la carga de estados financieros por eso sería perder el trabajo de verdad.
 *
 * @returns {Promise<Array<{nombre: string, actividad: string}>>} vacío si no se pudo.
 */
export async function buscarActividadesPorRazonSocial(nombres) {
  const prompt = promptActividadPorRazonSocial(nombres);
  if (!prompt) return [];
  try {
    const response = await postClaudeWithRetry({
      model: MODELO_ACTIVIDAD,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });
    const bloques = (response.data && response.data.content) || [];
    return leerRespuestaActividades(bloques.map((b) => b.text || '').join(''), nombres);
  } catch (err) {
    console.error('[actividadComparables] no se pudieron buscar las actividades', err);
    return [];
  }
}
