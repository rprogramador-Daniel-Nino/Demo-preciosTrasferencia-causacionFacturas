import { test } from 'node:test';
import assert from 'node:assert';
import axios from 'axios';
import { redactarDescripcionActividad, redactarDescripcionesEnLote } from './descripcionComparables.js';

function mockClaude(responder) {
  const original = axios.post;
  const llamadas = [];
  axios.post = async (url, body) => {
    llamadas.push({ url, body });
    return { data: { content: [{ type: 'text', text: responder(body) }] } };
  };
  return { restore: () => { axios.post = original; }, llamadas };
}

test('redacta la descripción de una comparable con el texto que devuelve Claude', async () => {
  const { restore, llamadas } = mockClaude(() => 'Akatsuki Inc. se dedica al juego y cómic en Japón.');
  try {
    const texto = await redactarDescripcionActividad('AKATSUKI INC.', 'Akatsuki Inc. is engaged in game...');
    assert.strictEqual(texto, 'Akatsuki Inc. se dedica al juego y cómic en Japón.');
    assert.strictEqual(llamadas.length, 1);
    assert.strictEqual(llamadas[0].url, '/api/claude');
    assert.strictEqual(llamadas[0].body.model, 'claude-haiku-4-5');
    assert.ok(llamadas[0].body.messages[0].content.includes('AKATSUKI INC.'));
    assert.ok(llamadas[0].body.messages[0].content.includes('Akatsuki Inc. is engaged in game...'));
  } finally {
    restore();
  }
});

test('sin descripción cruda no llama a la IA y devuelve null', async () => {
  const { restore, llamadas } = mockClaude(() => 'no debería llamarse');
  try {
    const texto = await redactarDescripcionActividad('SIN DESCRIPCION', '   ');
    assert.strictEqual(texto, null);
    assert.strictEqual(llamadas.length, 0);
  } finally {
    restore();
  }
});

test('si Claude falla, devuelve null en vez de lanzar', async () => {
  const original = axios.post;
  axios.post = async () => { throw new Error('boom'); };
  try {
    const texto = await redactarDescripcionActividad('FALLA', 'raw description');
    assert.strictEqual(texto, null);
  } finally {
    axios.post = original;
  }
});

test('reintenta en 429 antes de rendirse', async () => {
  const original = axios.post;
  let intentos = 0;
  axios.post = async () => {
    intentos++;
    if (intentos < 2) {
      const err = new Error('rate limited');
      err.response = { status: 429 };
      throw err;
    }
    return { data: { content: [{ type: 'text', text: 'ok tras reintento' }] } };
  };
  try {
    const texto = await redactarDescripcionActividad('REINTENTO', 'raw');
    assert.strictEqual(texto, 'ok tras reintento');
    assert.strictEqual(intentos, 2);
  } finally {
    axios.post = original;
  }
});

test('redactarDescripcionesEnLote respeta el tope de concurrencia y alinea resultados por posición', async () => {
  let simultaneas = 0;
  let maxSimultaneas = 0;
  const original = axios.post;
  axios.post = async (url, body) => {
    simultaneas++;
    maxSimultaneas = Math.max(maxSimultaneas, simultaneas);
    await new Promise((r) => setTimeout(r, 5));
    simultaneas--;
    const nombre = body.messages[0].content.match(/Compañía: (.+)/)[1];
    return { data: { content: [{ type: 'text', text: 'desc de ' + nombre }] } };
  };
  try {
    const items = Array.from({ length: 10 }, (_, i) => ({ nombre: 'EMPRESA ' + i, descCruda: 'raw ' + i }));
    const resultados = await redactarDescripcionesEnLote(items, 3);
    assert.strictEqual(resultados.length, 10);
    resultados.forEach((r, i) => assert.strictEqual(r, 'desc de EMPRESA ' + i));
    assert.ok(maxSimultaneas <= 3, 'superó el tope de concurrencia: ' + maxSimultaneas);
  } finally {
    axios.post = original;
  }
});

test('redactarDescripcionesEnLote devuelve null en la posición de un ítem sin descripción cruda, sin afectar a los demás', async () => {
  const { restore } = mockClaude((body) => {
    const nombre = body.messages[0].content.match(/Compañía: (.+)/)[1];
    return 'desc de ' + nombre;
  });
  try {
    const items = [
      { nombre: 'CON DESCRIPCION', descCruda: 'raw' },
      { nombre: 'SIN DESCRIPCION', descCruda: '' },
    ];
    const resultados = await redactarDescripcionesEnLote(items, 2);
    assert.strictEqual(resultados[0], 'desc de CON DESCRIPCION');
    assert.strictEqual(resultados[1], null);
  } finally {
    restore();
  }
});
