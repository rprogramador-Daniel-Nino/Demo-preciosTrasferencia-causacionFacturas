const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const GEMINI_MODEL_DEFAULT = 'gemini-3-flash-preview';

// Proxy hacia la API de Anthropic. El frontend llama a /api/claude,
// nunca directo a api.anthropic.com — así la key queda oculta.
exports.claude = onRequest(
  { secrets: [ANTHROPIC_API_KEY], region: 'us-central1', cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    try {
      const apiKey = ANTHROPIC_API_KEY.value();
      if (!apiKey) {
        res.status(500).json({ error: 'ANTHROPIC_API_KEY no está configurada en Secret Manager.' });
        return;
      }

      const body = req.body || {};
      if (!body.model) {
        body.model = 'claude-haiku-4-5';
      }

      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch (err) {
      console.error('Error llamando a Anthropic:', err);
      res.status(502).json({ error: 'No se pudo contactar a la API de Claude.', detail: err.message });
    }
  }
);

// Proxy hacia la API de Gemini. El frontend llama a /api/gemini para lectura/OCR
// de documentos (más económico que Claude para esta tarea), nunca directo a
// generativelanguage.googleapis.com — así la key queda oculta.
exports.gemini = onRequest(
  { secrets: [GEMINI_API_KEY], region: 'us-central1', cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    try {
      const apiKey = GEMINI_API_KEY.value();
      if (!apiKey) {
        res.status(500).json({ error: 'GEMINI_API_KEY no está configurada en Secret Manager.' });
        return;
      }

      const { model, ...body } = req.body || {};
      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model || GEMINI_MODEL_DEFAULT}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
        }
      );

      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch (err) {
      console.error('Error llamando a Gemini:', err);
      res.status(502).json({ error: 'No se pudo contactar a la API de Gemini.', detail: err.message });
    }
  }
);

// Proxy para extracción de RUT con visión/documentos, vía Gemini (lectura de
// archivos: más económico que Claude para esta tarea).
exports.extraerRut = onRequest(
  { secrets: [GEMINI_API_KEY], region: 'us-central1', cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    try {
      const apiKey = GEMINI_API_KEY.value();
      if (!apiKey) {
        res.status(500).json({ error: 'GEMINI_API_KEY no está configurada en Secret Manager.' });
        return;
      }

      const { archivo_base64, tipo } = req.body || {};
      if (!archivo_base64) {
        res.status(400).json({ error: 'Falta archivo_base64.' });
        return;
      }

      const mimeType = (tipo || '').includes('pdf')
        ? 'application/pdf'
        : ((tipo || '').includes('png') ? 'image/png' : 'image/jpeg');

      const promptText = "Extrae la información de este RUT colombiano (DIAN) en formato JSON estricto con las siguientes llaves:\n"
        + "- nit: string con dígito de verificación (ej: '900123456-7')\n"
        + "- razon_social: string con la razón social o nombre completo\n"
        + "- municipio: string con la ciudad o municipio principal de la dirección\n"
        + "- direccion: string con la dirección física\n"
        + "- ciiu: string con el código de actividad económica principal (4 dígitos, casilla 46 o 'Código CIIU')\n"
        + "- representante_legal: string con el nombre completo del representante legal, si figura en el documento\n"
        + "- responsabilidades: array de strings con los códigos de casillas 53/54 (ej: ['05', '09', '14', '48'])\n"
        + "- confianza: número de 0 a 100\n\n"
        + "Responde ÚNICAMENTE con el objeto JSON válido sin marcas markdown.";

      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_DEFAULT}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: mimeType, data: archivo_base64 } },
                { text: promptText }
              ]
            }]
          }),
        }
      );

      const data = await upstream.json();
      const cand = data && data.candidates && data.candidates[0];
      const texto = cand && cand.content && cand.content.parts
        ? cand.content.parts.map(p => p.text || '').join('')
        : '';
      if (upstream.ok && texto) {
        const cleanJsonStr = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = JSON.parse(cleanJsonStr);
        res.json(parsed);
      } else {
        res.status(upstream.status).json({ error: 'No se pudo extraer el RUT', raw: data });
      }
    } catch (err) {
      console.error('Error extrayendo RUT:', err);
      res.status(502).json({ error: 'Error procesando RUT con Gemini API', detail: err.message });
    }
  }
);

// Proxy para extracción del Certificado de Existencia y Representación Legal
// (Cámara de Comercio), vía Gemini Vision — mismo patrón que el RUT.
exports.extraerCamara = onRequest(
  { secrets: [GEMINI_API_KEY], region: 'us-central1', cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    try {
      const apiKey = GEMINI_API_KEY.value();
      if (!apiKey) {
        res.status(500).json({ error: 'GEMINI_API_KEY no está configurada en Secret Manager.' });
        return;
      }

      const { archivo_base64, tipo } = req.body || {};
      if (!archivo_base64) {
        res.status(400).json({ error: 'Falta archivo_base64.' });
        return;
      }

      const mimeType = (tipo || '').includes('pdf')
        ? 'application/pdf'
        : ((tipo || '').includes('png') ? 'image/png' : 'image/jpeg');

      const promptText = "Extrae la información de este Certificado de Existencia y Representación Legal (Cámara de Comercio de Colombia) en formato JSON estricto con las siguientes llaves:\n"
        + "- razon_social: string con la razón social o denominación social completa\n"
        + "- nit: string con dígito de verificación (ej: '900123456-7')\n"
        + "- matricula: string con el número de matrícula mercantil, si figura\n"
        + "- fecha_constitucion: string con la fecha de constitución tal como aparece en el documento (ej: '15 de marzo de 2018')\n"
        + "- objeto_social: string con el objeto social completo, o su resumen si es muy extenso\n"
        + "- representante_legal: string con el nombre completo del representante legal o gerente\n"
        + "- confianza: número de 0 a 100\n\n"
        + "Responde ÚNICAMENTE con el objeto JSON válido sin marcas markdown.";

      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_DEFAULT}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: mimeType, data: archivo_base64 } },
                { text: promptText }
              ]
            }]
          }),
        }
      );

      const data = await upstream.json();
      const cand = data && data.candidates && data.candidates[0];
      const texto = cand && cand.content && cand.content.parts
        ? cand.content.parts.map(p => p.text || '').join('')
        : '';
      if (upstream.ok && texto) {
        const cleanJsonStr = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = JSON.parse(cleanJsonStr);
        res.json(parsed);
      } else {
        res.status(upstream.status).json({ error: 'No se pudo extraer la Cámara de Comercio', raw: data });
      }
    } catch (err) {
      console.error('Error extrayendo Cámara de Comercio:', err);
      res.status(502).json({ error: 'Error procesando Cámara de Comercio con Gemini API', detail: err.message });
    }
  }
);

