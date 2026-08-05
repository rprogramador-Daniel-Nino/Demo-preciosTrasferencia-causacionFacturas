import axios from 'axios';

/* claude-3-5-haiku-20241022 está retirado desde el 19-02-2026 y responde 404, así que
   la redacción de descripciones fallaba en toda comparable. */
const MODELO_REDACCION = 'claude-haiku-4-5-20251001';

/* Traduce y redacta en español la descripción de negocio cruda de Capital IQ (normalmente
   en inglés) en un párrafo estilo Anexo B: qué hace la compañía, marcas/productos si el
   texto los trae, año de constitución y sede si aparecen. Nunca inventa lo que no está en
   el texto crudo. */
function promptRedaccion(nombre, descCruda) {
  return `Eres redactor de un Informe Local de Precios de Transferencia en Colombia.
Traduce y redacta en español, en un solo párrafo de entre 80 y 120 palabras, la descripción de
actividad económica de la siguiente compañía comparable, a partir de su descripción de negocio
cruda (normalmente en inglés, tomada de Capital IQ). Menciona qué hace la compañía, sus
productos o marcas relevantes si el texto los trae, y su año de constitución y sede si
aparecen. No inventes datos que no estén en el texto crudo. Devuelve SOLO el párrafo, sin
encabezados ni comillas.

Compañía: ${nombre}
Descripción cruda: ${descCruda}`;
}

function textoDeRespuesta(data) {
  const bloques = (data && data.content) || [];
  return bloques.map((b) => b.text || '').join('').trim();
}

/* Mismo patrón de reintento en 429 que postGeminiWithRetry de eeffParser.js. */
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

/* Nunca lanza: un fallo de IA en una comparable no debe tumbar el lote de las demás. */
export async function redactarDescripcionActividad(nombre, descCruda) {
  const cruda = String(descCruda || '').trim();
  if (!cruda) return null;
  try {
    const response = await postClaudeWithRetry({
      model: MODELO_REDACCION,
      max_tokens: 500,
      messages: [{ role: 'user', content: promptRedaccion(nombre, cruda) }],
    });
    const texto = textoDeRespuesta(response.data);
    return texto || null;
  } catch (err) {
    console.error('[descripcionComparables] no se pudo redactar la descripción de ' + nombre, err);
    return null;
  }
}

/* Tope de concurrencia para no disparar N llamadas a Claude a la vez cuando N es el número
   de comparables seleccionadas. */
async function conConcurrencia(items, trabajo, limite) {
  const resultados = new Array(items.length);
  let siguiente = 0;
  async function corredor() {
    while (siguiente < items.length) {
      const mio = siguiente++;
      resultados[mio] = await trabajo(items[mio], mio);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, corredor));
  return resultados;
}

export async function redactarDescripcionesEnLote(items, concurrencia = 4) {
  return conConcurrencia(
    items || [],
    (item) => redactarDescripcionActividad(item.nombre, item.descCruda),
    concurrencia
  );
}
