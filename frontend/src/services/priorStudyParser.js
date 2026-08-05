import axios from 'axios';
import mammoth from 'mammoth';
import { extraerJSON } from './comparablesEngine.js';

/* Se piden más datos por comparable que solo el nombre: estas empresas alimentan el
   catálogo histórico compartido, y una lista de nombres sueltos sirve para reconocer
   continuidad y para nada más. Con país, actividad, indicador y margen el catálogo
   puede sustentar por qué se aceptó cada una y cruzarse con el motor.

   Todos los campos salvo el nombre son opcionales a propósito: un informe puede no
   traer el margen o la tabla puede estar incompleta, y es mejor un registro con el
   nombre solo que inventar cifras. */
const PRIOR_STUDY_PROMPT = `Eres un auditor senior de precios de transferencia en Colombia.
Lee este informe / estudio de precios de transferencia del año anterior y extrae la información requerida.

Devuelve ÚNICAMENTE un JSON estricto sin marcas markdown con esta estructura:
{
  "actividad_especifica": "Descripción detallada y completa de la actividad económica real, funciones (compras, logística, ventas, marketing), activos empleados y riesgos asumidos, así como la caracterización de los productos o servicios transaccionados de la compañía examinada.",
  "anio_gravable": 2024,
  "comparables": [
    {
      "name": "Nombre de la empresa comparable, tal como aparece en el informe",
      "pais": "País de domicilio de la comparable, si el informe lo indica; si no, cadena vacía",
      "actividad": "Descripción de la actividad o negocio de esa comparable según el informe; cadena vacía si no aparece",
      "pli": "Indicador de rentabilidad con el que se evaluó (por ejemplo: Margen Operacional, Margen Neto de Costos y Gastos, Berry); cadena vacía si no aparece",
      "margen": 0.0
    }
  ]
}

Reglas para los campos de las comparables:
- "name" es obligatorio. Si no puedes leer la razón social, omite esa comparable entera.
- "anio_gravable" es el año gravable que analiza el informe, como número. Si no lo encuentras, omite el campo.
- "margen" es el margen o indicador de rentabilidad de esa comparable como número decimal
  (por ejemplo 0.0725 para 7,25 %, o 7.25 si el informe lo expresa en porcentaje). Si el
  informe no lo trae para esa empresa, usa null. No lo estimes ni lo calcules.
- No inventes ningún valor: lo que no esté en el documento va como cadena vacía o null.`;

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
    } catch (e) { }
  }

  // Si hay texto plano disponible (DOCX, TXT, JSON), enviamos el texto directamente
  if (fileText && fileText.length > 50) {
    const payloadText = PRIOR_STUDY_PROMPT + `\n\nCONTENIDO DEL ESTUDIO ANTERIOR:\n` + fileText.slice(0, 45000);
    const payload = {
      model: 'gemini-3.5-flash',
      contents: [{ parts: [{ text: payloadText }] }]
    };

    const response = await postGeminiWithRetry(payload);
    const text = response.data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

    if (text) {
      /* Llaves balanceadas en lugar de quitar las vallas y hacer JSON.parse: con el
         prompt ampliado la respuesta es más larga y basta una frase de cortesía
         después del objeto para perder el informe entero. */
      const parsed = extraerJSON(text);
      return {
        actividad_especifica: parsed.actividad_especifica || '',
        anio_gravable: parsed.anio_gravable || null,
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
          model: 'gemini-3.5-flash',
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
          const parsed = extraerJSON(text);
          resolve({
            actividad_especifica: parsed.actividad_especifica || '',
            anio_gravable: parsed.anio_gravable || null,
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
