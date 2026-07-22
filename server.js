// server.js — Servidor local para "Sistema Precios de Transferencia"
// Sirve el HTML y actúa como proxy seguro hacia la API de Anthropic.
// La API key NUNCA se expone al navegador: vive solo en el servidor (.env).

require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error('\n⚠️  Falta ANTHROPIC_API_KEY en el archivo .env — el proxy no va a funcionar.\n');
}

app.use(express.json({ limit: '2mb' }));

// Sirve el HTML y cualquier asset estático desde public/ (misma carpeta que despliega Firebase Hosting)
app.use(express.static(path.join(__dirname, 'public')));

// Proxy hacia la API de Anthropic. El frontend llama a /api/claude,
// nunca directo a api.anthropic.com — así la key queda oculta.
app.post('/api/claude', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'Servidor sin ANTHROPIC_API_KEY configurada.' });
  }
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('Error llamando a Anthropic:', err);
    res.status(502).json({ error: 'No se pudo contactar a la API de Claude.', detail: err.message });
  }
});

// Proxy para extracción de RUT con visión/documentos de Claude
const handlerExtraerRut = async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'Servidor sin ANTHROPIC_API_KEY configurada.' });
  }
  try {
    const { archivo_base64, tipo } = req.body;
    if (!archivo_base64) {
      return res.status(400).json({ error: 'Falta archivo_base64.' });
    }
    const isPdf = (tipo || '').includes('pdf');
    const contentBlock = isPdf ? {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: archivo_base64 }
    } : {
      type: 'image',
      source: { type: 'base64', media_type: (tipo || '').includes('png') ? 'image/png' : 'image/jpeg', data: archivo_base64 }
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
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: promptText }] }]
      }),
    });

    const data = await upstream.json();
    if (upstream.ok && data.content && data.content[0] && data.content[0].text) {
      const cleanJsonStr = data.content[0].text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleanJsonStr);
      return res.json(parsed);
    }
    res.status(upstream.status).json({ error: 'No se pudo extraer el RUT', raw: data });
  } catch (err) {
    console.error('Error extrayendo RUT:', err);
    res.status(502).json({ error: 'Error procesando RUT con Claude API', detail: err.message });
  }
};

app.post('/api/extraer-rut', handlerExtraerRut);
app.post('/extraer-rut', handlerExtraerRut);


app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Sistema PT corriendo en:`);
  console.log(`   Local:     http://localhost:${PORT}`);
  console.log(`   En tu red: http://<TU-IP-LOCAL>:${PORT}  (usa ipconfig / ifconfig para verla)\n`);
});
