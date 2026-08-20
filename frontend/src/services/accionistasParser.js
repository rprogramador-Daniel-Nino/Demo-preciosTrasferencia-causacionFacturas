import axios from 'axios';
import mammoth from 'mammoth';
import { extraerJSON } from './comparablesEngine.js';

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

export async function parseAccionistasWithGeminiOCR(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const base64Data = reader.result.split(',')[1];
        let mimeType = 'application/pdf';

        if (file.type.includes('image') || file.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
          mimeType = file.type || 'image/jpeg';
        } else if (file.name.match(/\.(pdf)$/i)) {
          mimeType = 'application/pdf';
        }

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
          const parsed = extraerJSON(text);
          resolve(parsed);
        } else {
          reject(new Error("No se obtuvo respuesta en formato JSON de Gemini Vision OCR."));
        }
      } catch (err) {
        console.error("Error en parseAccionistasWithGeminiOCR:", err);
        reject(err);
      }
    };
    reader.onerror = (e) => reject(e);
  });
}

/**
 * Extrae la composición accionaria de cualquier documento (DOCX, PDF, imagen),
 * típicamente usado como fallback cuando se carga la plantilla del cliente en el Generador de Informe.
 */
export async function parseAccionistasFromDocument(file) {
  const isDocx = file.name && file.name.match(/\.(docx)$/i);
  let fileText = '';

  if (isDocx) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      fileText = result.value || '';
    } catch (e) {
      console.warn("Mammoth text extraction error al leer plantilla para accionistas:", e);
    }
  }

  if (fileText && fileText.length > 50) {
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
    } catch (err) {
      console.warn("Error extrayendo accionistas desde texto DOCX:", err);
    }
    return { accionistas: [], capital_pagado: null, total_acciones: null };
  }

  // Si es PDF o imagen
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const base64Data = reader.result.split(',')[1];
        let mimeType = 'application/pdf';

        if (file.type.includes('image') || file.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
          mimeType = file.type || 'image/jpeg';
        } else if (file.name.match(/\.(pdf)$/i)) {
          mimeType = 'application/pdf';
        }

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
          resolve({
            accionistas: Array.isArray(parsed.accionistas) ? parsed.accionistas : [],
            capital_pagado: parsed.capital_pagado || null,
            total_acciones: parsed.total_acciones || null,
          });
        } else {
          resolve({ accionistas: [], capital_pagado: null, total_acciones: null });
        }
      } catch (err) {
        console.warn("Error en parseAccionistasFromDocument con Gemini OCR:", err);
        resolve({ accionistas: [], capital_pagado: null, total_acciones: null });
      }
    };
    reader.onerror = () => resolve({ accionistas: [], capital_pagado: null, total_acciones: null });
  });
}

