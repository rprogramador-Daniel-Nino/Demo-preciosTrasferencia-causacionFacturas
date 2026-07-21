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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Sistema PT corriendo en:`);
  console.log(`   Local:     http://localhost:${PORT}`);
  console.log(`   En tu red: http://<TU-IP-LOCAL>:${PORT}  (usa ipconfig / ifconfig para verla)\n`);
});
