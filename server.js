// server.js — Servidor local para "Sistema Precios de Transferencia"
// Sirve el HTML y actúa como proxy seguro hacia la API de Anthropic.
// La API key NUNCA se expone al navegador: vive solo en el servidor (.env).

require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL_DEFAULT = 'gemini-3-flash-preview';

if (!API_KEY) {
  console.error('\n⚠️  Falta ANTHROPIC_API_KEY en el archivo .env — el proxy no va a funcionar.\n');
}
if (!GEMINI_API_KEY) {
  console.error('\n⚠️  Falta GEMINI_API_KEY en el archivo .env — la lectura de archivos con Gemini no va a funcionar.\n');
}

// 12 MB: la lectura de estados financieros de comparables escaneados manda
// varias páginas rasterizadas en base64 en un solo cuerpo, y 2 MB las rechazaba
// con 413. Firebase Functions admite 32 MB, así que no hay que tocar functions/.
app.use(express.json({ limit: '12mb' }));

// Sirve el HTML y cualquier asset estático desde public/ (misma carpeta que despliega Firebase Hosting)
app.use(express.static(path.join(__dirname, 'public')));

// Servir los archivos estáticos de la aplicación React (public/gestor-reportes)
app.use('/gestor-reportes/assets', express.static(path.join(__dirname, 'public/gestor-reportes/assets')));
app.use('/assets', express.static(path.join(__dirname, 'public/gestor-reportes/assets')));

// Ruta explícita para el HTML antiguo
app.get('/index', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Ruta de la aplicación React (Gestor de Reportes)
app.get('/gestor-reportes-inicio', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/gestor-reportes/index.html'));
});

// Cualquier ruta que empiece con /gestor-reportes sirve la app de React (para soportar React Router)
app.get('/gestor-reportes*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/gestor-reportes/index.html'));
});

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

// Proxy hacia la API de Gemini. El frontend llama a /api/gemini para lectura/OCR
// de documentos (más económico que Claude para esta tarea), nunca directo a
// generativelanguage.googleapis.com — así la key queda oculta.
app.post('/api/gemini', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Servidor sin GEMINI_API_KEY configurada.' });
  }
  try {
    const { model, ...body } = req.body || {};
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model || GEMINI_MODEL_DEFAULT}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
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
});

// Proxy para extracción de RUT con visión/documentos, vía Gemini (lectura de
// archivos: más económico que Claude para esta tarea).
const handlerExtraerRut = async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Servidor sin GEMINI_API_KEY configurada.' });
  }
  try {
    const { archivo_base64, tipo } = req.body;
    if (!archivo_base64) {
      return res.status(400).json({ error: 'Falta archivo_base64.' });
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
          'x-goog-api-key': GEMINI_API_KEY,
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
      return res.json(parsed);
    }
    res.status(upstream.status).json({ error: 'No se pudo extraer el RUT', raw: data });
  } catch (err) {
    console.error('Error extrayendo RUT:', err);
    res.status(502).json({ error: 'Error procesando RUT con Gemini API', detail: err.message });
  }
};

app.post('/api/extraer-rut', handlerExtraerRut);
app.post('/extraer-rut', handlerExtraerRut);

// Proxy para extracción del Certificado de Existencia y Representación Legal
// (Cámara de Comercio), vía Gemini Vision — mismo patrón que el RUT.
const handlerExtraerCamara = async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Servidor sin GEMINI_API_KEY configurada.' });
  }
  try {
    const { archivo_base64, tipo } = req.body;
    if (!archivo_base64) {
      return res.status(400).json({ error: 'Falta archivo_base64.' });
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
          'x-goog-api-key': GEMINI_API_KEY,
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
      return res.json(parsed);
    }
    res.status(upstream.status).json({ error: 'No se pudo extraer la Cámara de Comercio', raw: data });
  } catch (err) {
    console.error('Error extrayendo Cámara de Comercio:', err);
    res.status(502).json({ error: 'Error procesando Cámara de Comercio con Gemini API', detail: err.message });
  }
};

app.post('/api/extraer-camara', handlerExtraerCamara);
app.post('/extraer-camara', handlerExtraerCamara);

// Estado del servidor local, para el panel de diagnóstico ("Probar conector").
// Nunca devuelve la clave real, solo si está configurada.
app.get('/api/estado', (req, res) => {
  res.json({
    ok: true,
    clave: API_KEY ? 'configurada' : 'no configurada',
    claveGemini: GEMINI_API_KEY ? 'configurada' : 'no configurada',
  });
});


app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Sistema PT corriendo en:`);
  console.log(`   Local:     http://localhost:${PORT}`);
  console.log(`   En tu red: http://<TU-IP-LOCAL>:${PORT}  (usa ipconfig / ifconfig para verla)\n`);
});
