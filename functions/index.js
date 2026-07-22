const {onRequest} = require('firebase-functions/v2/https');
const {defineSecret} = require('firebase-functions/params');

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

// Proxy hacia la API de Anthropic. El frontend llama a /api/claude,
// nunca directo a api.anthropic.com — así la key queda oculta.
exports.claude = onRequest(
  {secrets: [ANTHROPIC_API_KEY], region: 'us-central1', cors: true},
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({error: 'Method not allowed'});
      return;
    }
    try {
      const apiKey = ANTHROPIC_API_KEY.value();
      if (!apiKey) {
        res.status(500).json({error: 'ANTHROPIC_API_KEY no está configurada en Secret Manager.'});
        return;
      }

      const body = req.body || {};
      if (!body.model) {
        body.model = 'claude-sonnet-5';
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
      res.status(502).json({error: 'No se pudo contactar a la API de Claude.', detail: err.message});
    }
  }
);

// Proxy para extracción de RUT con visión/documentos de Claude
exports.extraerRut = onRequest(
  {secrets: [ANTHROPIC_API_KEY], region: 'us-central1', cors: true},
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({error: 'Method not allowed'});
      return;
    }
    try {
      const apiKey = ANTHROPIC_API_KEY.value();
      if (!apiKey) {
        res.status(500).json({error: 'ANTHROPIC_API_KEY no está configurada en Secret Manager.'});
        return;
      }

      const {archivo_base64, tipo} = req.body || {};
      if (!archivo_base64) {
        res.status(400).json({error: 'Falta archivo_base64.'});
        return;
      }

      const isPdf = (tipo || '').includes('pdf');
      const contentBlock = isPdf ? {
        type: 'document',
        source: {type: 'base64', media_type: 'application/pdf', data: archivo_base64}
      } : {
        type: 'image',
        source: {type: 'base64', media_type: (tipo || '').includes('png') ? 'image/png' : 'image/jpeg', data: archivo_base64}
      };

      const promptText = "Extrae la información de este RUT colombiano (DIAN) en formato JSON estricto con las siguientes llaves:\n"
        + "- nit: string con dígito de verificación (ej: '900123456-7')\n"
        + "- razon_social: string con la razón social o nombre completo\n"
        + "- municipio: string con la ciudad o municipio principal de la dirección\n"
        + "- direccion: string con la dirección física\n"
        + "- responsabilidades: array de strings con los códigos de casillas 53/54 (ej: ['05', '09', '14', '48'])\n"
        + "- confianza: número de 0 a 100\n\n"
        + "Responde ÚNICAMENTE con el objeto JSON válido sin marcas markdown.";

      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 1024,
          messages: [{role: 'user', content: [contentBlock, {type: 'text', text: promptText}]}]
        }),
      });

      const data = await upstream.json();
      if (upstream.ok && data.content && data.content[0] && data.content[0].text) {
        const cleanJsonStr = data.content[0].text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = JSON.parse(cleanJsonStr);
        res.json(parsed);
      } else {
        res.status(upstream.status).json({error: 'No se pudo extraer el RUT', raw: data});
      }
    } catch (err) {
      console.error('Error extrayendo RUT:', err);
      res.status(502).json({error: 'Error procesando RUT con Claude API', detail: err.message});
    }
  }
);

