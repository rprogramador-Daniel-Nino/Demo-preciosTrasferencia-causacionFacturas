import axios from 'axios';
import mammoth from 'mammoth';
import { extraerJSON } from './comparablesEngine.js';
import { extraerTextoEstructuradoPdf } from './eeffParser.js';

const ACCIONISTAS_PROMPT = `Eres un contador público y auditor. Lee este certificado de composición accionaria y extrae la lista de todos los accionistas en formato JSON estricto:

{
  "empresa": "Nombre de la empresa objetivo",
  "capital_pagado": 0,
  "total_acciones": 0,
  "accionistas": [
    {
      "nombre": "Nombre del accionista o razón social",
      "pais": "País de residencia fiscal (si no figura, inferir o indicar ESTADOS UNIDOS si es matriz EE.UU)",
      "acciones": 0,
      "valor_capital": 0,
      "participacion_pct": 100
    }
  ]
}

Responde ÚNICAMENTE con el JSON estricto sin marcas markdown.`;

const PLANTILLA_ACCIONISTAS_PROMPT = `Eres un auditor senior de precios de transferencia.
Revisa este documento (informe/plantilla de precios de transferencia) y extrae la sección de composición accionaria (Tabla 6 o similar).

Devuelve ÚNICAMENTE un JSON estricto sin marcas markdown con esta estructura:
{
  "capital_pagado": 0,
  "total_acciones": 0,
  "accionistas": [
    {
      "nombre": "Nombre del accionista o razón social",
      "pais": "País de residencia fiscal",
      "acciones": 0,
      "valor_capital": 0,
      "participacion_pct": 0
    }
  ]
}

Si el documento no contiene información de composición accionaria o la tabla está vacía, devuelve "accionistas": []. No inventes datos.`;

/* `/api/gemini` se corta a sí mismo a los 50 s y devuelve un 504 pensado para
   reintentarse (ver `GEMINI_CORTE_MS` en `functions/index.js`). Retener solo el 429
   perdía ese reintento y con él la lectura entera del certificado. Mismo criterio que
   `eeffParser.js`. */
const ESTADOS_REINTENTABLES = [408, 425, 429, 500, 502, 503, 504];

/* Mensaje corto y estable para el usuario cuando la extracción FALLÓ (red, cuota, error del
   servicio) — para distinguirlo de cuando Gemini sí respondió y limpiamente no encontró
   accionistas. Sin este campo, quien llama no puede saber cuál de los dos pasó: ambos casos
   volvían como `{ accionistas: [] }` y punto. Exportado para poder probarlo sin mockear
   FileReader/mammoth/axios. */
export function mensajeErrorGemini(err) {
  const status = err && err.response && err.response.status;
  if (status) return `el servicio de IA respondió con error ${status}`;
  if (err && err.message) return err.message;
  return 'fallo de red o del servicio de IA';
}

async function postGeminiWithRetry(payload, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post('/api/gemini', payload);
      return response;
    } catch (err) {
      const status = err.response && err.response.status;
      const pasajero = status === undefined || ESTADOS_REINTENTABLES.includes(status);
      if (pasajero && attempt < maxRetries) {
        const delayMs = attempt * 3000;
        console.warn(`[Gemini OCR Accionistas] ${status ? 'HTTP ' + status : 'fallo de red'}. ` +
          `Reintentando en ${delayMs / 1000}s... (Intento ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        throw err;
      }
    }
  }
}

async function leerBase64(file) {
  if (typeof FileReader === 'undefined') {
    const arrayBuffer = await file.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = (e) => reject(e);
  });
}

function mimeDe(file) {
  if (file.type?.includes('image') || file.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
    return file.type || 'image/jpeg';
  }
  return 'application/pdf';
}

export async function parseAccionistasWithGeminiOCR(file) {
  try {
    // 1. Intentar la extracción nativa por coordenadas si es un PDF
    if (file.name && file.name.match(/\.(pdf)$/i)) {
      const textoEstructurado = await extraerTextoEstructuradoPdf(file);
      if (textoEstructurado) {
        console.log(`[accionistasParser] Extracción digital nativa exitosa para composición accionaria: ${file.name}`);
        const payload = {
          model: 'gemini-3.5-flash',
          contents: [{
            parts: [
              { text: ACCIONISTAS_PROMPT + '\n\nCONTENIDO DEL DOCUMENTO EXTRAÍDO DIRECTAMENTE DEL PDF:\n' + textoEstructurado.slice(0, 150000) }
            ]
          }]
        };

        const response = await postGeminiWithRetry(payload);
        const cand = response.data?.candidates?.[0];
        const text = cand?.content?.parts?.map(p => p.text || '').join('') || '';

        if (text) {
          return extraerJSON(text);
        }
      }
    }

    // 2. Fallback a Vision OCR (original)
    console.log(`[accionistasParser] Usando Vision OCR de respaldo para composición accionaria: ${file.name}`);
    const base64Data = await leerBase64(file);
    const mimeType = mimeDe(file);

    const payload = {
      model: 'gemini-3.5-flash',
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: base64Data } },
          { text: ACCIONISTAS_PROMPT }
        ]
      }]
    };

    const response = await postGeminiWithRetry(payload);
    const cand = response.data?.candidates?.[0];
    const text = cand?.content?.parts?.map(p => p.text || '').join('') || '';

    if (text) {
      return extraerJSON(text);
    } else {
      throw new Error("No se obtuvo respuesta en formato JSON de Gemini Vision OCR.");
    }
  } catch (err) {
    console.error("Error en parseAccionistasWithGeminiOCR:", err);
    throw err;
  }
}

/**
 * Extrae la composición accionaria de cualquier documento (DOCX, PDF, imagen),
 * típicamente usado como fallback cuando se carga la plantilla del cliente en el Generador de Informe.
 *
 * Nunca rechaza. El llamador distingue "vacío limpio" (Gemini respondió y no encontró
 * accionistas: `accionistas: []` sin `error`) de "falló" (red, cuota, servicio caído:
 * `accionistas: []` CON `error`, el mensaje de `mensajeErrorGemini`).
 */
export async function parseAccionistasFromDocument(file) {
  const isDocx = file.name && file.name.match(/\.(docx)$/i);

  if (isDocx) {
    let fileText = '';
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      fileText = result.value || '';
    } catch (e) {
      console.warn("Mammoth text extraction error al leer plantilla para accionistas:", e);
      return {
        accionistas: [], capital_pagado: null, total_acciones: null,
        error: 'no se pudo leer el contenido del Word (' + (e && e.message || 'error de mammoth') + ')',
      };
    }

    if (!(fileText && fileText.length > 50)) {
      return {
        accionistas: [], capital_pagado: null, total_acciones: null,
        error: 'el Word no trajo texto legible',
      };
    }

    const payloadText = PLANTILLA_ACCIONISTAS_PROMPT + '\n\nCONTENIDO DEL DOCUMENTO:\n' + fileText.slice(0, 150000);
    const payload = {
      model: 'gemini-3.5-flash',
      contents: [{ parts: [{ text: payloadText }] }]
    };

    try {
      const response = await postGeminiWithRetry(payload);
      const text = response.data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      if (text) {
        const parsed = extraerJSON(text);
        return {
          accionistas: Array.isArray(parsed.accionistas) ? parsed.accionistas : [],
          capital_pagado: parsed.capital_pagado || null,
          total_acciones: parsed.total_acciones || null,
        };
      }
      return {
        accionistas: [], capital_pagado: null, total_acciones: null,
        error: 'la IA no devolvió una respuesta utilizable',
      };
    } catch (err) {
      console.warn("Error extrayendo accionistas desde texto DOCX:", err);
      return {
        accionistas: [], capital_pagado: null, total_acciones: null,
        error: mensajeErrorGemini(err),
      };
    }
  }

  // Si es PDF o imagen
  try {
    // 1. Intentar la extracción nativa por coordenadas si es un PDF
    if (file.name && file.name.match(/\.(pdf)$/i)) {
      const textoEstructurado = await extraerTextoEstructuradoPdf(file);
      if (textoEstructurado) {
        console.log(`[accionistasParser] Extracción digital nativa exitosa para plantilla de accionistas: ${file.name}`);
        const payload = {
          model: 'gemini-3.5-flash',
          contents: [{
            parts: [
              { text: PLANTILLA_ACCIONISTAS_PROMPT + '\n\nCONTENIDO DEL DOCUMENTO EXTRAÍDO DIRECTAMENTE DEL PDF:\n' + textoEstructurado.slice(0, 150000) }
            ]
          }]
        };

        const response = await postGeminiWithRetry(payload);
        const cand = response.data?.candidates?.[0];
        const text = cand?.content?.parts?.map(p => p.text || '').join('') || '';

        if (text) {
          const parsed = extraerJSON(text);
          return {
            accionistas: Array.isArray(parsed.accionistas) ? parsed.accionistas : [],
            capital_pagado: parsed.capital_pagado || null,
            total_acciones: parsed.total_acciones || null,
          };
        }
      }
    }

    // 2. Fallback a Vision OCR (original)
    console.log(`[accionistasParser] Usando Vision OCR de respaldo para plantilla de accionistas: ${file.name}`);
    const base64Data = await leerBase64(file);
    const mimeType = mimeDe(file);

    const payload = {
      model: 'gemini-3.5-flash',
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: base64Data } },
          { text: PLANTILLA_ACCIONISTAS_PROMPT }
        ]
      }]
    };

    const response = await postGeminiWithRetry(payload);
    const cand = response.data?.candidates?.[0];
    const text = cand?.content?.parts?.map(p => p.text || '').join('') || '';

    if (text) {
      const parsed = extraerJSON(text);
      return {
        accionistas: Array.isArray(parsed.accionistas) ? parsed.accionistas : [],
        capital_pagado: parsed.capital_pagado || null,
        total_acciones: parsed.total_acciones || null,
      };
    } else {
      return {
        accionistas: [], capital_pagado: null, total_acciones: null,
        error: 'la IA no devolvió una respuesta utilizable',
      };
    }
  } catch (err) {
    console.warn("Error en parseAccionistasFromDocument con Gemini OCR:", err);
    return {
      accionistas: [], capital_pagado: null, total_acciones: null,
      error: mensajeErrorGemini(err),
    };
  }
}

