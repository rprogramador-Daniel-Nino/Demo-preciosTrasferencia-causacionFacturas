import axios from 'axios';
import { extraerJSON } from './comparablesEngine.js';
import { esUrlBloqueada } from './urlsBloqueadas.js';

const MODELO_REDACCION = 'claude-haiku-4-5-20251001';

/** Campos de tema "mejor si están, no bloqueantes" — mismo contrato que
 *  functions/analisisMercadoPrompts.js:CAMPOS_TEMA_OPCIONALES. Duplicado a propósito:
 *  frontend/src/ y functions/ no comparten código (ver CLAUDE.md). */
const CAMPOS_TEMA_OPCIONALES = [
  'inflacionMundial', 'proyeccionMundial', 'inflacionColombia', 'politicaMonetaria',
  'tasaCambio', 'mercadoLaboral', 'conclusiones',
];

const MIN_LARGO_APARTADO = 20;

/** Mismo prompt de 9 apartados que ya usa el batch mensual
 *  (functions/analisisMercadoPrompts.js:construirPromptRedaccion) — se porta aquí
 *  en vez de importarlo porque functions/ es CommonJS y no comparte código con
 *  frontend/src/ (ver CLAUDE.md). Si cambia la redacción legal o los apartados
 *  allá, cambiar aquí también a propósito. */
export function construirPromptRedaccionMacro(series, anioActual) {
  const resumen = Object.keys(series).map((clave) => {
    const s = series[clave];
    return '- ' + clave + ': ' + JSON.stringify(s.valores) + ' (fuente: ' + s.fuente + (s.fuenteUrl ? ', ' + s.fuenteUrl : '') + ')';
  }).join('\n');

  return (
    'Eres economista y redactas la Sección III ("TENDENCIAS DE LA ECONOMÍA") de un informe local de ' +
    'precios de transferencia para Colombia, año gravable ' + anioActual + '. Tienes ÚNICAMENTE estos ' +
    'datos ya verificados, con su fuente:\n\n' + resumen + '\n\n' +
    'Redacta lo siguiente, en español, tono técnico-formal. Los apartados 1 y 2 son extensos (mínimo ' +
    '3 párrafos); los apartados 3 a 9 son un solo párrafo corto y específico cada uno — no repitas en ' +
    'ellos lo que ya dijiste en 1 o 2, cada uno cubre SOLO su propio tema:\n' +
    '1. "mundial": Análisis del Panorama de la Economía Mundial — crecimiento del PIB mundial y su ' +
    'tendencia general (sin entrar en inflación ni proyecciones por región, eso va en 3 y 4).\n' +
    '2. "colombia": Análisis del panorama de la economía colombiana — PIB de Colombia y su efecto ' +
    'general sobre empresas que operan en el país (sin entrar en inflación, política monetaria, TRM, ' +
    'desempleo ni conclusiones, eso va en 5 a 9).\n' +
    '3. "inflacionMundial": un párrafo sobre la inflación global y su tendencia.\n' +
    '4. "proyeccionMundial": un párrafo sobre las proyecciones de crecimiento del PIB por región/país.\n' +
    '5. "inflacionColombia": un párrafo sobre la inflación de Colombia (IPC/DANE).\n' +
    '6. "politicaMonetaria": un párrafo sobre la tasa de intervención del Banco de la República y su ' +
    'evolución reciente.\n' +
    '7. "tasaCambio": un párrafo sobre la TRM promedio y su evolución.\n' +
    '8. "mercadoLaboral": un párrafo sobre la tasa de desempleo de Colombia.\n' +
    '9. "conclusiones": un párrafo que cierre el panorama económico de III.A/III.B, sintetizando el ' +
    'efecto conjunto de estas variables sobre empresas que operan en Colombia — no repitas cifras, ' +
    'esto es síntesis, no una fuente nueva.\n' +
    '10. "fuentesCitadas": la lista de las fuentes que efectivamente usaste para redactar cualquiera de ' +
    'los apartados de arriba, cada una con su título y su URL.\n\n' +
    'Reglas estrictas:\n' +
    '- NO menciones ninguna cifra que no esté en los datos de arriba. Si te falta un dato para algo que ' +
    'quieras afirmar, no lo afirmes.\n' +
    '- Si no tienes datos verificados para alguno de los apartados 3 a 8, omite esa clave del JSON por ' +
    'completo — no inventes el párrafo ni lo dejes vacío.\n' +
    '- Cada apartado en HTML, como uno o más párrafos <p>...</p>, sin encabezados ni tablas.\n' +
    '- En "fuentesCitadas" no inventes ninguna fuente ni ninguna URL: usa únicamente las que aparecen ' +
    'en los datos de arriba. Si una serie no trae URL, omítela de la lista.\n' +
    '- Responde ÚNICAMENTE con un objeto JSON (sin marcas markdown) con esta forma exacta:\n' +
    '{ "mundial": "<p>...</p><p>...</p>", "colombia": "<p>...</p><p>...</p>", ' +
    '"inflacionMundial": "<p>...</p>", "proyeccionMundial": "<p>...</p>", ' +
    '"inflacionColombia": "<p>...</p>", "politicaMonetaria": "<p>...</p>", ' +
    '"tasaCambio": "<p>...</p>", "mercadoLaboral": "<p>...</p>", "conclusiones": "<p>...</p>", ' +
    '"fuentesCitadas": [{"titulo":"...","url":"..."}] }'
  );
}

/** Mismo criterio que functions/analisisMercadoPrompts.js:parsearRespuestaRedaccion —
 *  "mundial"/"colombia" obligatorios, los 7 temas "mejor si están". */
export function parsearRespuestaRedaccionMacro(texto) {
  const bruto = extraerJSON(texto);
  if (typeof bruto.mundial !== 'string' || typeof bruto.colombia !== 'string') {
    throw new Error('La redacción no trajo "mundial" y "colombia" como texto.');
  }
  if (bruto.mundial.trim().length < MIN_LARGO_APARTADO || bruto.colombia.trim().length < MIN_LARGO_APARTADO) {
    throw new Error('La redacción trajo "mundial" o "colombia" vacío o demasiado corto para ser un apartado.');
  }
  const fuentesCitadas = Array.isArray(bruto.fuentesCitadas)
    ? bruto.fuentesCitadas.filter(
        (f) => f && typeof f.titulo === 'string' && typeof f.url === 'string' && f.titulo && f.url
          && !esUrlBloqueada(f.url)
      ).map((f) => ({ titulo: f.titulo, url: f.url }))
    : [];

  const resultado = { mundial: bruto.mundial, colombia: bruto.colombia, fuentesCitadas };
  CAMPOS_TEMA_OPCIONALES.forEach((campo) => {
    if (typeof bruto[campo] === 'string' && bruto[campo].trim().length >= MIN_LARGO_APARTADO) {
      resultado[campo] = bruto[campo];
    }
  });
  return resultado;
}

/** true si hace falta redactar en vivo: hay series de `analisisMercado` (si no hay
 *  ni siquiera eso, nada que redactar, el batch mensual tampoco ha corrido nunca) y
 *  o no hay caché para este estudio, o el caché es de una corrida de series más
 *  vieja que la vigente. `cache` es lo que devolvió `leerNarrativaMacroEstudio`
 *  (firestoreRepo.js) — esta función es pura, no toca Firestore. */
export function necesitaRedaccion(analisisMercado, cache) {
  if (!analisisMercado || !analisisMercado.actualizadoEn) return false;
  if (!cache) return true;
  const vigente = analisisMercado.actualizadoEn.toMillis
    ? analisisMercado.actualizadoEn.toMillis()
    : Number(analisisMercado.actualizadoEn);
  return cache.seriesActualizadoEnMs < vigente;
}

/* Mismo patrón de reintento en 429 que descripcionComparables.js:postClaudeWithRetry. */
async function postClaudeConReintento(payload, maxIntentos = 3) {
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      return await axios.post('/api/claude', payload);
    } catch (err) {
      const es429 = err.response && err.response.status === 429;
      if (es429 && intento < maxIntentos) {
        await new Promise((r) => setTimeout(r, intento * 3000));
      } else {
        throw err;
      }
    }
  }
}

/** Redacta los 9 apartados en vivo a partir de series YA verificadas (no busca
 *  nada nuevo). Nunca lanza: cualquier fallo (red, 4xx/5xx tras reintentar,
 *  respuesta sin JSON válido, "mundial"/"colombia" ausentes) devuelve `null` — el
 *  llamador cae a los marcadores específicos de tema, igual que si no hubiera
 *  narrativa. `/api/claude` ya cae a Gemini del lado del servidor si Anthropic no
 *  puede atender (functions/fallbackGemini.js) — no hay nada que replicar aquí
 *  para ese caso. */
export async function redactarNarrativaMacroEnVivo(series, anioActual) {
  try {
    const respuesta = await postClaudeConReintento({
      model: MODELO_REDACCION,
      max_tokens: 4000,
      messages: [{ role: 'user', content: construirPromptRedaccionMacro(series, anioActual) }],
    });
    const bloques = (respuesta.data && respuesta.data.content) || [];
    const texto = bloques.map((b) => b.text || '').join('');
    return parsearRespuestaRedaccionMacro(texto);
  } catch {
    return null;
  }
}
