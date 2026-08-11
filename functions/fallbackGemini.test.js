const { test } = require('node:test');
const assert = require('node:assert');
const {
  debeCaerAGemini, aPeticionGemini, aRespuestaAnthropic, PROVEEDOR_GEMINI, CABECERA_PROVEEDOR,
} = require('./fallbackGemini');

/* ── Cuándo se cae a Gemini ── */

test('el crédito agotado de Anthropic dispara el fallback', () => {
  /* La forma exacta con la que responde Anthropic cuando la cuenta se queda sin saldo. */
  const cuerpo = {
    type: 'error',
    error: {
      type: 'invalid_request_error',
      message: 'Your credit balance is too low to access the Anthropic API. Please go to '
        + 'Plans & Billing to upgrade or purchase credits.',
    },
  };
  assert.strictEqual(debeCaerAGemini(400, cuerpo), true);
  assert.strictEqual(debeCaerAGemini(402, cuerpo), true);
});

test('el tope de gasto de la cuenta dispara el fallback', () => {
  /* Copiado literal de lo que devolvió producción el 2026-08-11, cuando la ingesta de EEFF
     falló al redactar la descripción de una comparable: 400 con el type genérico y sin una
     palabra sobre el saldo, así que el patrón del crédito agotado no lo reconocía. */
  const cuerpo = {
    type: 'error',
    error: {
      type: 'invalid_request_error',
      message: 'You have reached your specified API usage limits. You will regain access on '
        + '2026-09-01 at 00:00 UTC.',
    },
  };
  assert.strictEqual(debeCaerAGemini(400, cuerpo), true);
  assert.strictEqual(debeCaerAGemini(402, cuerpo), true);
});

test('el tope de gasto se reconoce también nombrado como spend limit', () => {
  const cuerpo = {
    type: 'error',
    error: { type: 'invalid_request_error', message: 'Monthly spend limit reached.' },
  };
  assert.strictEqual(debeCaerAGemini(400, cuerpo), true);
});

test('el límite de peticiones y la sobrecarga también caen a Gemini', () => {
  assert.strictEqual(debeCaerAGemini(429, { error: { type: 'rate_limit_error' } }), true);
  assert.strictEqual(debeCaerAGemini(529, { error: { type: 'overloaded_error' } }), true);
});

test('una petición mal formada NO cae a Gemini', () => {
  /* Caer aquí enmascararía el error: la misma petición fallaría igual en Gemini, y el
     desarrollador vería un fallo del proveedor equivocado. */
  const cuerpo = {
    type: 'error',
    error: { type: 'invalid_request_error', message: 'max_tokens: field required' },
  };
  assert.strictEqual(debeCaerAGemini(400, cuerpo), false);
});

test('una key inválida NO cae a Gemini', () => {
  /* Es un error de configuración del servidor. Taparlo con el otro proveedor deja la
     instalación funcionando a medias sin que nadie arregle la causa. */
  const cuerpo = { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } };
  assert.strictEqual(debeCaerAGemini(401, cuerpo), false);
  assert.strictEqual(debeCaerAGemini(403, cuerpo), false);
});

test('una respuesta correcta no dispara nada', () => {
  assert.strictEqual(debeCaerAGemini(200, { content: [{ type: 'text', text: 'ok' }] }), false);
});

/* ── Traducción de la petición ── */

test('los mensajes de Anthropic se traducen a los contents de Gemini', () => {
  const g = aPeticionGemini({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: 'Redacta la descripción de ACME.' }],
  });
  assert.deepStrictEqual(g.contents, [
    { role: 'user', parts: [{ text: 'Redacta la descripción de ACME.' }] },
  ]);
  assert.strictEqual(g.generationConfig.maxOutputTokens, 500);
});

test('el rol assistant se traduce a model, que es como lo llama Gemini', () => {
  const g = aPeticionGemini({
    messages: [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'buenas' },
      { role: 'user', content: 'sigue' },
    ],
  });
  assert.deepStrictEqual(g.contents.map((c) => c.role), ['user', 'model', 'user']);
});

test('el contenido por bloques se aplana a texto', () => {
  /* Anthropic admite `content` como arreglo de bloques. Pasarlo tal cual dejaría a Gemini
     con un objeto donde espera texto, y la llamada se perdería entera. */
  const g = aPeticionGemini({
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: 'primera parte. ' }, { type: 'text', text: 'segunda parte.' }],
    }],
  });
  assert.deepStrictEqual(g.contents[0].parts, [{ text: 'primera parte. segunda parte.' }]);
});

test('el system de Anthropic viaja como systemInstruction', () => {
  const g = aPeticionGemini({ system: 'Eres redactor.', messages: [{ role: 'user', content: 'x' }] });
  assert.deepStrictEqual(g.systemInstruction, { parts: [{ text: 'Eres redactor.' }] });
  assert.ok(!('system' in g), 'no se cuela el campo de Anthropic');
});

test('la petición traducida no arrastra campos que Gemini no entiende', () => {
  const g = aPeticionGemini({
    model: 'claude-haiku-4-5-20251001', max_tokens: 100, temperature: 0.2,
    messages: [{ role: 'user', content: 'x' }],
  });
  assert.ok(!('model' in g), 'el modelo se elige en la URL de Gemini');
  assert.ok(!('max_tokens' in g), 'va dentro de generationConfig');
  assert.ok(!('messages' in g), 'se llaman contents');
  assert.strictEqual(g.generationConfig.temperature, 0.2);
});

test('la petición traducida desactiva el pensamiento de Gemini', () => {
  /* `max_tokens` de Anthropic cuenta solo el texto; `maxOutputTokens` de Gemini cuenta además
     el razonamiento. Con el pensamiento activo, los 500 tokens del párrafo de una comparable
     se gastaban en pensar (477 medidos en producción) y el texto salía cortado a media frase.
     Si esta aserción falla, el fallback volvió a truncar descripciones en silencio. */
  const g = aPeticionGemini({
    model: 'claude-haiku-4-5-20251001', max_tokens: 500,
    messages: [{ role: 'user', content: 'Redacta la descripción de ACME.' }],
  });
  assert.deepStrictEqual(g.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.strictEqual(g.generationConfig.maxOutputTokens, 500);
});

test('el pensamiento se desactiva incluso sin max_tokens ni temperature', () => {
  /* Anthropic exige `max_tokens`, así que este caso no llega desde los llamadores reales,
     pero el generationConfig ya no es opcional: si se omitiera aquí, Gemini razonaría. */
  const g = aPeticionGemini({ messages: [{ role: 'user', content: 'x' }] });
  assert.deepStrictEqual(g.generationConfig, { thinkingConfig: { thinkingBudget: 0 } });
});

/* ── Traducción de la respuesta ── */

test('la respuesta de Gemini sale con la forma de Anthropic', () => {
  /* Los catorce llamadores de /api/claude leen `data.content[].text`. Si el fallback
     devolviera la forma de Gemini, todos verían una respuesta vacía sin error. */
  const anthropic = aRespuestaAnthropic({
    candidates: [{
      content: { parts: [{ text: 'ACME S.A.S. desarrolla software.' }], role: 'model' },
      finishReason: 'STOP',
    }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 45 },
  }, 'gemini-3.5-flash');

  assert.strictEqual(anthropic.type, 'message');
  assert.strictEqual(anthropic.role, 'assistant');
  assert.deepStrictEqual(anthropic.content, [
    { type: 'text', text: 'ACME S.A.S. desarrolla software.' },
  ]);
  assert.strictEqual(anthropic.stop_reason, 'end_turn');
  assert.strictEqual(anthropic.usage.input_tokens, 120);
  assert.strictEqual(anthropic.usage.output_tokens, 45);
});

test('todas las partes de la respuesta se concatenan, no solo la primera', () => {
  const anthropic = aRespuestaAnthropic({
    candidates: [{ content: { parts: [{ text: 'uno ' }, { text: 'dos' }] } }],
  }, 'gemini-3.5-flash');
  assert.strictEqual(anthropic.content[0].text, 'uno dos');
});

test('el corte por longitud se traduce al stop_reason de Anthropic', () => {
  const anthropic = aRespuestaAnthropic({
    candidates: [{ content: { parts: [{ text: 'a medias' }] }, finishReason: 'MAX_TOKENS' }],
  }, 'gemini-3.5-flash');
  assert.strictEqual(anthropic.stop_reason, 'max_tokens');
});

test('la respuesta declara que la atendió Gemini y con qué modelo', () => {
  /* Un informe que se radica ante la DIAN no puede haberlo redactado otro modelo sin que
     quede constancia. */
  const anthropic = aRespuestaAnthropic({
    candidates: [{ content: { parts: [{ text: 'x' }] } }],
  }, 'gemini-3.5-flash');
  assert.strictEqual(anthropic.proveedor, PROVEEDOR_GEMINI);
  assert.strictEqual(anthropic.model, 'gemini-3.5-flash');
  assert.strictEqual(CABECERA_PROVEEDOR, 'X-Proveedor-IA');
});

test('una respuesta de Gemini sin candidatos no finge un texto', () => {
  /* Un bloqueo por filtros de seguridad devuelve `candidates` vacío. Devolver «» como si
     el modelo hubiera contestado dejaría al llamador guardando una descripción vacía. */
  assert.strictEqual(aRespuestaAnthropic({ candidates: [] }, 'gemini-3.5-flash'), null);
  assert.strictEqual(aRespuestaAnthropic({}, 'gemini-3.5-flash'), null);
  assert.strictEqual(
    aRespuestaAnthropic({ candidates: [{ content: { parts: [{ text: '  ' }] } }] }, 'x'),
    null,
  );
});
