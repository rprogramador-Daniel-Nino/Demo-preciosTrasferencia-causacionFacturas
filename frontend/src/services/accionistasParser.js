import axios from 'axios';

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

async function postGeminiWithRetry(payload, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post('/api/gemini', payload);
      return response;
    } catch (err) {
      const is429 = err.response && err.response.status === 429;
      if (is429 && attempt < maxRetries) {
        const delayMs = attempt * 3000;
        console.warn(`[Gemini OCR Accionistas] HTTP 429. Reintentando en ${delayMs / 1000}s... (Intento ${attempt}/${maxRetries})`);
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
          const cleanJsonStr = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          const parsed = JSON.parse(cleanJsonStr);
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
