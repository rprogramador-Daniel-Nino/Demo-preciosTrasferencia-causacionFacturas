const { test } = require('node:test');
const assert = require('node:assert');
const { redactarConFallback, textoDeRespuesta, URL_ANTHROPIC } = require('./redaccionConFallback');

const OPCIONES = {
  prompt: 'Redacta el análisis.',
  claudeApiKey: 'sk-claude',
  geminiApiKey: 'key-gemini',
  modeloClaude: 'claude-haiku-4-5-20251001',
  modeloGemini: 'gemini-3.5-flash',
};

/* Un fetch simulado que responde por URL y anota las llamadas. */
function fetchFalso(respuestas) {
  const llamadas = [];
  const impl = async (url, opciones) => {
    llamadas.push({ url, cuerpo: JSON.parse(opciones.body) });
    const clave = url.includes('anthropic') ? 'anthropic' : 'gemini';
    const r = respuestas[clave];
    if (typeof r === 'function') return r();
    return { ok: r.ok, status: r.status, json: async () => r.datos };
  };
  impl.llamadas = llamadas;
  return impl;
}

const RESPUESTA_CLAUDE = {
  ok: true, status: 200,
  datos: { content: [{ type: 'text', text: '{"mundial":"…","colombia":"…"}' }] },
};

/* El error exacto que devolvió producción el 2026-08-11. */
const TOPE_ALCANZADO = {
  ok: false, status: 400,
  datos: {
    type: 'error',
    error: {
      type: 'invalid_request_error',
      message: 'You have reached your specified API usage limits. You will regain access on '
        + '2026-09-01 at 00:00 UTC.',
    },
  },
};

const RESPUESTA_GEMINI = {
  ok: true, status: 200,
  datos: {
    candidates: [{ content: { parts: [{ text: '```json\n{"mundial":"g","colombia":"g"}\n```' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
  },
};

test('cuando Claude atiende, no se llama a Gemini', async () => {
  const pedir = fetchFalso({ anthropic: RESPUESTA_CLAUDE });
  const r = await redactarConFallback({ ...OPCIONES, fetchImpl: pedir });

  assert.strictEqual(r.proveedor, 'anthropic');
  assert.match(r.texto, /"mundial"/);
  assert.strictEqual(pedir.llamadas.length, 1, 'una sola llamada');
  assert.strictEqual(pedir.llamadas[0].url, URL_ANTHROPIC);
});

test('con el tope de uso alcanzado redacta Gemini', async () => {
  /* Es el caso que dejaba sin análisis de sector a cualquier actividad nueva: estas
     funciones llaman a Anthropic directo y no pasaban por el fallback del proxy. */
  const pedir = fetchFalso({ anthropic: TOPE_ALCANZADO, gemini: RESPUESTA_GEMINI });
  const r = await redactarConFallback({ ...OPCIONES, fetchImpl: pedir });

  assert.strictEqual(r.proveedor, 'gemini');
  assert.match(r.texto, /"mundial":"g"/, 'devuelve el texto de Gemini');
  assert.strictEqual(pedir.llamadas.length, 2, 'se intentó Claude y después Gemini');
  assert.ok(pedir.llamadas[1].url.includes('gemini-3.5-flash'));
});

test('el respaldo desactiva el pensamiento de Gemini', async () => {
  /* `max_tokens` cuenta solo el texto en Anthropic, pero en Gemini cuenta también el
     razonamiento: sin esto la narrativa de 4096 tokens salía cortada a media frase. La
     traducción la hace `aPeticionGemini`, y esta prueba fija que se use. */
  const pedir = fetchFalso({ anthropic: TOPE_ALCANZADO, gemini: RESPUESTA_GEMINI });
  await redactarConFallback({ ...OPCIONES, fetchImpl: pedir });

  const aGemini = pedir.llamadas[1].cuerpo;
  assert.deepStrictEqual(aGemini.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.strictEqual(aGemini.generationConfig.maxOutputTokens, 4096);
});

test('una petición mal formada NO cae a Gemini', async () => {
  /* Fallaría igual allá, y taparlo enmascara un defecto propio. */
  const pedir = fetchFalso({
    anthropic: {
      ok: false, status: 400,
      datos: { error: { type: 'invalid_request_error', message: 'max_tokens: field required' } },
    },
  });
  await assert.rejects(
    () => redactarConFallback({ ...OPCIONES, fetchImpl: pedir }),
    /max_tokens: field required/);
  assert.strictEqual(pedir.llamadas.length, 1, 'no se intenta Gemini');
});

test('una key inválida NO cae a Gemini', async () => {
  const pedir = fetchFalso({
    anthropic: { ok: false, status: 401, datos: { error: { message: 'invalid x-api-key' } } },
  });
  await assert.rejects(
    () => redactarConFallback({ ...OPCIONES, fetchImpl: pedir }),
    /invalid x-api-key/);
  assert.strictEqual(pedir.llamadas.length, 1);
});

test('el límite de peticiones y la sobrecarga sí caen a Gemini', async () => {
  for (const status of [429, 529]) {
    const pedir = fetchFalso({
      anthropic: { ok: false, status, datos: { error: { type: 'rate_limit_error' } } },
      gemini: RESPUESTA_GEMINI,
    });
    const r = await redactarConFallback({ ...OPCIONES, fetchImpl: pedir });
    assert.strictEqual(r.proveedor, 'gemini', `HTTP ${status} debe caer a Gemini`);
  }
});

test('si Gemini tampoco puede, se lanza el error ORIGINAL de Anthropic', async () => {
  /* Sustituirlo por el fallo de Gemini manda a depurar al proveedor equivocado. */
  const pedir = fetchFalso({
    anthropic: TOPE_ALCANZADO,
    gemini: { ok: false, status: 503, datos: { error: { message: 'overloaded' } } },
  });
  await assert.rejects(
    () => redactarConFallback({ ...OPCIONES, fetchImpl: pedir }),
    (err) => {
      assert.match(err.message, /usage limits/, 'explica lo que dijo Anthropic');
      assert.match(err.message, /respaldo con Gemini tampoco/);
      return true;
    });
});

test('sin GEMINI_API_KEY se propaga el error de Anthropic sin intentar el respaldo', async () => {
  const pedir = fetchFalso({ anthropic: TOPE_ALCANZADO });
  await assert.rejects(
    () => redactarConFallback({ ...OPCIONES, geminiApiKey: '', fetchImpl: pedir }),
    /no hay GEMINI_API_KEY/);
  assert.strictEqual(pedir.llamadas.length, 1);
});

test('una respuesta de Gemini bloqueada por filtros no pasa por buena', async () => {
  /* `aRespuestaAnthropic` devuelve null sin texto: un silencio no puede hacerse pasar por
     una narrativa vacía, porque el informe saldría sin la sección y nadie se enteraría. */
  const pedir = fetchFalso({
    anthropic: TOPE_ALCANZADO,
    gemini: { ok: true, status: 200, datos: { candidates: [] } },
  });
  await assert.rejects(
    () => redactarConFallback({ ...OPCIONES, fetchImpl: pedir }),
    /tampoco redactó/);
});

test('textoDeRespuesta concatena todos los bloques', () => {
  assert.strictEqual(
    textoDeRespuesta({ content: [{ text: 'uno ' }, { text: 'dos' }] }), 'uno dos');
  assert.strictEqual(textoDeRespuesta(null), '');
  assert.strictEqual(textoDeRespuesta({}), '');
});
