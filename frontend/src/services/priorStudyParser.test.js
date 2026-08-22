import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { parsePriorStudyFile } from './priorStudyParser.js';

/* ══════ Pruebas de Integración (Mocking API) ══════ */

test('parsePriorStudyFile integra la extracción nativa con Gemini (modelo texto) para PDFs digitales', async () => {
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
                actividad_especifica: "Desarrollo de software interactivo",
                anio_gravable: 2024,
                vinculado: {
                  razon_social: "VINCULADO LATAM",
                  identificacion: "999999",
                  pais: "COLOMBIA"
                },
                comparables: [
                  {
                    name: "QUBICGAMES S.A.",
                    pais: "COLOMBIA",
                    actividad: "Juegos",
                    pli: "Margen Operacional",
                    margen: 0.05
                  }
                ],
                capital_pagado: 5000000,
                total_acciones: 5000,
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
      name: 'Estudio Anterior 2024.pdf',
      arrayBuffer: async () => {
        return readFileSync('Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/EEFF Comparables/1 QUBICGAMES S.A..pdf');
      }
    };

    const result = await parsePriorStudyFile(mockFile);

    assert.ok(result, 'Debe devolver un resultado');
    assert.strictEqual(result.actividad_especifica, 'Desarrollo de software interactivo');
    assert.strictEqual(result.vinculado.razon_social, 'VINCULADO LATAM');
    assert.strictEqual(result.comparables[0].name, 'QUBICGAMES S.A.');

    // Verificar que se haya llamado al modelo de TEXTO de Gemini
    assert.ok(apiPayloadRecibido, 'Debe haber enviado un payload a la API');
    assert.ok(!apiPayloadRecibido.contents[0].parts[0].inline_data, 'No debe enviar datos inline/base64 ya que usó la extracción nativa');

  } finally {
    axios.post = originalPost;
  }
});

test('parsePriorStudyFile cae correctamente a Vision OCR si es una imagen', async () => {
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
                actividad_especifica: "Desarrollo de software interactivo",
                anio_gravable: 2024,
                vinculado: {
                  razon_social: "VINCULADO LATAM",
                  identificacion: "999999",
                  pais: "COLOMBIA"
                },
                comparables: [],
                capital_pagado: 5000000,
                total_acciones: 5000,
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
      name: 'estudio_anterior_escaneado.png',
      type: 'image/png',
      arrayBuffer: async () => Buffer.from('bytes falsos de imagen')
    };

    const result = await parsePriorStudyFile(mockFile);

    assert.ok(result, 'Debe devolver un resultado');
    assert.strictEqual(result.actividad_especifica, 'Desarrollo de software interactivo');

    // Verificar que se haya llamado a Vision OCR con datos base64 inline
    assert.ok(apiPayloadRecibido, 'Debe haber enviado un payload a la API');
    assert.ok(apiPayloadRecibido.contents[0].parts[0].inline_data, 'Debe enviar inline_data (base64) para Vision OCR');
    assert.strictEqual(apiPayloadRecibido.contents[0].parts[0].inline_data.mime_type, 'image/png');

  } finally {
    axios.post = originalPost;
  }
});
