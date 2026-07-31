import axios from 'axios';
import mammoth from 'mammoth';

const PRIOR_STUDY_PROMPT = `Eres un auditor senior de precios de transferencia en Colombia. 
Lee este informe / estudio de precios de transferencia del año anterior y extrae la información requerida.

Devuelve ÚNICAMENTE un JSON estricto sin marcas markdown con esta estructura:
{
  "actividad_especifica": "Descripción detallada y completa de la actividad económica real, funciones (compras, logística, ventas, marketing), activos empleados y riesgos asumidos, así como la caracterización de los productos o servicios transaccionados de la compañía examinada.",
  "comparables": [
    { "name": "Nombre de la empresa comparable" }
  ]
}`;

async function postGeminiWithRetry(payload, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post('/api/gemini', payload);
      return response;
    } catch (err) {
      const is429 = err.response && err.response.status === 429;
      if (is429 && attempt < maxRetries) {
        const delayMs = attempt * 3000;
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Lee e ingiere el estudio del año anterior usando Gemini Vision OCR
 */
export async function parsePriorStudyFile(file) {
  let fileText = '';
  const isDocx = file.name.match(/\.(docx)$/i);
  const isJson = file.name.match(/\.(json)$/i);
  const isTxt = file.name.match(/\.(txt)$/i);

  if (isDocx) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      fileText = result.value || '';
    } catch (e) {
      console.warn("Mammoth text extraction error:", e);
    }
  } else if (isJson || isTxt) {
    try {
      fileText = await file.text();
    } catch (e) {}
  }

  // Si hay texto plano disponible (DOCX, TXT, JSON), enviamos el texto directamente
  if (fileText && fileText.length > 50) {
    const payloadText = PRIOR_STUDY_PROMPT + `\n\nCONTENIDO DEL ESTUDIO ANTERIOR:\n` + fileText.slice(0, 45000);
    const payload = {
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: payloadText }] }]
    };

    const response = await postGeminiWithRetry(payload);
    const text = response.data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

    if (text) {
      const cleanJson = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleanJson);
      return {
        actividad_especifica: parsed.actividad_especifica || '',
        comparables: parsed.comparables || [],
        filename: file.name
      };
    }
  }

  // Para PDFs e imágenes: enviamos Gemini Vision OCR siempre con inline_data Base64
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const base64Data = reader.result.split(',')[1];
        let mimeType = 'application/pdf';

        if (file.type.includes('image') || file.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
          mimeType = file.type || 'image/jpeg';
        }

        const payload = {
          model: 'gemini-3-flash-preview',
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType, data: base64Data } },
              { text: PRIOR_STUDY_PROMPT }
            ]
          }]
        };

        const response = await postGeminiWithRetry(payload);
        const text = response.data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

        if (text) {
          const cleanJson = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          const parsed = JSON.parse(cleanJson);
          resolve({
            actividad_especifica: parsed.actividad_especifica || '',
            comparables: parsed.comparables || [],
            filename: file.name
          });
        } else {
          reject(new Error("No se obtuvo respuesta JSON del estudio anterior por Gemini Vision OCR."));
        }
      } catch (err) {
        console.error("Error leyendo estudio anterior con Gemini OCR:", err);
        reject(err);
      }
    };
    reader.onerror = (e) => reject(e);
  });
}
