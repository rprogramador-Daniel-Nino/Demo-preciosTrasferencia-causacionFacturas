import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { mensajeErrorGemini } from './accionistasParser.js';

test('mensajeErrorGemini reporta el status HTTP cuando el error viene de axios', () => {
  assert.strictEqual(
    mensajeErrorGemini({ response: { status: 429 } }),
    'el servicio de IA respondió con error 429'
  );
});

test('mensajeErrorGemini usa el mensaje del error si no hay status HTTP', () => {
  assert.strictEqual(mensajeErrorGemini(new Error('Network Error')), 'Network Error');
});

test('mensajeErrorGemini tiene un mensaje genérico si el error no trae nada útil', () => {
  assert.strictEqual(mensajeErrorGemini({}), 'fallo de red o del servicio de IA');
  assert.strictEqual(mensajeErrorGemini(undefined), 'fallo de red o del servicio de IA');
});

/* ══════ Pruebas de Integración (Mocking API) ══════ */

test('parseAccionistasWithGeminiOCR integra la extracción nativa con Gemini (modelo texto) para PDFs digitales', async () => {
  const axios = (await import('axios')).default;
  const originalPost = axios.post;

  let apiPayloadRecibido = null;

  // Mock de la llamada API
  axios.post = async (url, payload) => {
    apiPayloadRecibido = payload;
    return {
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                empresa: "END GAME INTERACTIVE COLOMBIA SAS",
                capital_pagado: 10000000,
                total_acciones: 10000,
                accionistas: [
                  {
                    nombre: "ACCIONISTA MAYORITARIO",
                    pais: "COLOMBIA",
                    acciones: 9000,
                    valor_capital: 9000000,
                    participacion_pct: 90
                  }
                ]
              })
            }]
          }
        }]
      }
    };
  };

  try {
    const mockFile = {
      name: 'EEFF Comparables 2025.pdf',
      arrayBuffer: async () => {
        return readFileSync('Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/EEFF Comparables/1 QUBICGAMES S.A..pdf');
      }
    };

    const result = await (await import('./accionistasParser.js')).parseAccionistasWithGeminiOCR(mockFile);

    assert.ok(result, 'Debe devolver un resultado');
    assert.strictEqual(result.empresa, 'END GAME INTERACTIVE COLOMBIA SAS');
    assert.strictEqual(result.accionistas[0].nombre, 'ACCIONISTA MAYORITARIO');

    // Verificar que se haya llamado al modelo de TEXTO de Gemini
    assert.ok(apiPayloadRecibido, 'Debe haber enviado un payload a la API');
    assert.ok(!apiPayloadRecibido.contents[0].parts[0].inline_data, 'No debe enviar datos inline/base64 ya que usó la extracción nativa');

  } finally {
    axios.post = originalPost;
  }
});

test('parseAccionistasWithGeminiOCR cae correctamente a Vision OCR si es una imagen', async () => {
  const axios = (await import('axios')).default;
  const originalPost = axios.post;

  let apiPayloadRecibido = null;

  // Mock de la llamada API
  axios.post = async (url, payload) => {
    apiPayloadRecibido = payload;
    return {
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                empresa: "END GAME INTERACTIVE COLOMBIA SAS",
                capital_pagado: 10000000,
                total_acciones: 10000,
                accionistas: []
              })
            }]
          }
        }]
      }
    };
  };

  try {
    const mockFile = {
      name: 'certificado.png',
      type: 'image/png',
      arrayBuffer: async () => Buffer.from('bytes falsos de imagen')
    };

    const result = await (await import('./accionistasParser.js')).parseAccionistasWithGeminiOCR(mockFile);

    assert.ok(result, 'Debe devolver un resultado');
    assert.strictEqual(result.empresa, 'END GAME INTERACTIVE COLOMBIA SAS');

    // Verificar que se haya llamado a Vision OCR con datos base64 inline
    assert.ok(apiPayloadRecibido, 'Debe haber enviado un payload a la API');
    assert.ok(apiPayloadRecibido.contents[0].parts[0].inline_data, 'Debe enviar inline_data (base64) para Vision OCR');
    assert.strictEqual(apiPayloadRecibido.contents[0].parts[0].inline_data.mime_type, 'image/png');

  } finally {
    axios.post = originalPost;
  }
});

test('parseAccionistasFromDocument integra la extracción nativa con Gemini (modelo texto) para PDFs digitales', async () => {
  const axios = (await import('axios')).default;
  const originalPost = axios.post;

  let apiPayloadRecibido = null;

  // Mock de la llamada API
  axios.post = async (url, payload) => {
    apiPayloadRecibido = payload;
    return {
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                capital_pagado: 50000000,
                total_acciones: 50000,
                accionistas: [
                  {
                    nombre: "Socio Fundador",
                    pais: "COLOMBIA",
                    acciones: 45000,
                    valor_capital: 45000000,
                    participacion_pct: 90
                  }
                ]
              })
            }]
          }
        }]
      }
    };
  };

  try {
    const mockFile = {
      name: 'Composicion Accionaria.pdf',
      arrayBuffer: async () => {
        return readFileSync('Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/EEFF Comparables/1 QUBICGAMES S.A..pdf');
      }
    };

    const result = await (await import('./accionistasParser.js')).parseAccionistasFromDocument(mockFile);

    assert.ok(result, 'Debe devolver un resultado');
    assert.strictEqual(result.capital_pagado, 50000000);
    assert.strictEqual(result.total_acciones, 50000);
    assert.strictEqual(result.accionistas[0].nombre, 'Socio Fundador');

    // Verificar que se haya llamado al modelo de TEXTO de Gemini
    assert.ok(apiPayloadRecibido, 'Debe haber enviado un payload a la API');
    assert.ok(!apiPayloadRecibido.contents[0].parts[0].inline_data, 'No debe enviar datos inline/base64 ya que usó la extracción nativa');

  } finally {
    axios.post = originalPost;
  }
});

