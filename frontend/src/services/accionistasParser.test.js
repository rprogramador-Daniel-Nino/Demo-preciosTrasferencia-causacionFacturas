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

test('parseAccionistasWithGeminiOCR reintenta con Vision OCR si el texto nativo no trae accionistas (tabla incrustada como imagen)', async () => {
  const axios = (await import('axios')).default;
  const originalPost = axios.post;

  const payloadsRecibidos = [];

  axios.post = async (url, payload) => {
    payloadsRecibidos.push(payload);
    if (payloadsRecibidos.length === 1) {
      return {
        data: {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  empresa: "FERRELUGUE S.A.S",
                  capital_pagado: null,
                  total_acciones: null,
                  accionistas: []
                })
              }]
            }
          }]
        }
      };
    }
    return {
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                empresa: "FERRELUGUE S.A.S",
                capital_pagado: 3000000000,
                total_acciones: 3000000,
                accionistas: [
                  {
                    nombre: "LUIS WILLIAM GUEVARA ACHURY",
                    pais: "COLOMBIA",
                    acciones: 2100000,
                    valor_capital: 2100000000,
                    participacion_pct: 70
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
      name: 'Composicion Accionaria Ferrelugue SAS 2025.pdf',
      arrayBuffer: async () => {
        return readFileSync('Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/EEFF Comparables/1 QUBICGAMES S.A..pdf');
      }
    };

    const result = await (await import('./accionistasParser.js')).parseAccionistasWithGeminiOCR(mockFile);

    assert.strictEqual(payloadsRecibidos.length, 2, 'debe reintentar con Vision OCR tras el texto nativo vacío');
    assert.ok(!payloadsRecibidos[0].contents[0].parts[0].inline_data, 'primer intento: texto nativo, sin inline_data');
    assert.ok(payloadsRecibidos[1].contents[0].parts[0].inline_data, 'segundo intento: Vision OCR con inline_data');
    assert.strictEqual(result.accionistas.length, 1);
    assert.strictEqual(result.accionistas[0].nombre, 'LUIS WILLIAM GUEVARA ACHURY');
  } finally {
    axios.post = originalPost;
  }
});

test('parseAccionistasWithGeminiOCR no reintenta si el texto nativo ya trae accionistas', async () => {
  const axios = (await import('axios')).default;
  const originalPost = axios.post;

  let llamadas = 0;

  axios.post = async () => {
    llamadas++;
    return {
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                empresa: "END GAME INTERACTIVE COLOMBIA SAS",
                capital_pagado: 10000000,
                total_acciones: 10000,
                accionistas: [{ nombre: "ACCIONISTA MAYORITARIO", pais: "COLOMBIA", acciones: 9000, valor_capital: 9000000, participacion_pct: 90 }]
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

    await (await import('./accionistasParser.js')).parseAccionistasWithGeminiOCR(mockFile);

    assert.strictEqual(llamadas, 1, 'no debe llamar a Vision OCR si el texto nativo ya trajo accionistas');
  } finally {
    axios.post = originalPost;
  }
});

test('parseAccionistasWithGeminiOCR devuelve vacío sin error si ni el texto nativo ni Vision OCR encuentran accionistas', async () => {
  const axios = (await import('axios')).default;
  const originalPost = axios.post;

  let llamadas = 0;

  axios.post = async () => {
    llamadas++;
    return {
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({ empresa: "FERRELUGUE S.A.S", capital_pagado: null, total_acciones: null, accionistas: [] })
            }]
          }
        }]
      }
    };
  };

  try {
    const mockFile = {
      name: 'Composicion Accionaria Ferrelugue SAS 2025.pdf',
      arrayBuffer: async () => {
        return readFileSync('Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/EEFF Comparables/1 QUBICGAMES S.A..pdf');
      }
    };

    const result = await (await import('./accionistasParser.js')).parseAccionistasWithGeminiOCR(mockFile);

    assert.strictEqual(llamadas, 2, 'debe haber intentado texto nativo y Vision OCR');
    assert.strictEqual(result.accionistas.length, 0);
    assert.strictEqual(result.error, undefined);
  } finally {
    axios.post = originalPost;
  }
});

test('parseAccionistasFromDocument (PDF) reintenta con Vision OCR si el texto nativo no trae accionistas', async () => {
  const axios = (await import('axios')).default;
  const originalPost = axios.post;

  const payloadsRecibidos = [];

  axios.post = async (url, payload) => {
    payloadsRecibidos.push(payload);
    if (payloadsRecibidos.length === 1) {
      return {
        data: {
          candidates: [{ content: { parts: [{ text: JSON.stringify({ capital_pagado: null, total_acciones: null, accionistas: [] }) }] } }]
        }
      };
    }
    return {
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                capital_pagado: 3000000000,
                total_acciones: 3000000,
                accionistas: [{ nombre: "LUIS WILLIAM GUEVARA ACHURY", pais: "COLOMBIA", acciones: 2100000, valor_capital: 2100000000, participacion_pct: 70 }]
              })
            }]
          }
        }]
      }
    };
  };

  try {
    const mockFile = {
      name: 'Composicion Accionaria Ferrelugue SAS 2025.pdf',
      arrayBuffer: async () => {
        return readFileSync('Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/EEFF Comparables/1 QUBICGAMES S.A..pdf');
      }
    };

    const result = await (await import('./accionistasParser.js')).parseAccionistasFromDocument(mockFile);

    assert.strictEqual(payloadsRecibidos.length, 2, 'debe reintentar con Vision OCR tras el texto nativo vacío');
    assert.ok(payloadsRecibidos[1].contents[0].parts[0].inline_data, 'segundo intento: Vision OCR con inline_data');
    assert.strictEqual(result.accionistas.length, 1);
    assert.strictEqual(result.accionistas[0].nombre, 'LUIS WILLIAM GUEVARA ACHURY');
    assert.strictEqual(result.error, undefined);
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

