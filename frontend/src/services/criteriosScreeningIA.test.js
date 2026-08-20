import { test } from 'node:test';
import assert from 'node:assert';
import axios from 'axios';
import { traducirCriteriosScreening } from './criteriosScreeningIA.js';

/* Mismo molde que descripcionComparables.test.js:6-14: se parchea axios.post y se
   restaura en el finally. */
function mockClaude(responder) {
  const original = axios.post;
  const llamadas = [];
  axios.post = async (url, body) => {
    llamadas.push({ url, body });
    return { data: { content: [{ type: 'text', text: responder(body) }] } };
  };
  return { restore: () => { axios.post = original; }, llamadas };
}

/* Cubierto por el diccionario (criteriosScreeningEs.js), no deja residuo. */
const CUBIERTO = { conector: null, etiqueta: 'Company Type', valor: 'Public Company OR Private Company' };
/* Ni la etiqueta ni el título SIC están en los diccionarios: esto es lo que va a la IA. */
const PENDIENTE = { conector: 'Y', etiqueta: 'Implied Enterprise Value', valor: 'is greater than 100' };
const PENDIENTE_SIC = { conector: 'O', etiqueta: 'SIC Codes', valor: '2011 Meat Packing Plants' };

test('sin residuo no se llama a la IA y la lista vuelve igual', async () => {
  const mock = mockClaude(() => '{}');
  try {
    const salida = await traducirCriteriosScreening([CUBIERTO]);
    assert.strictEqual(mock.llamadas.length, 0, 'el diccionario ya lo cubría');
    assert.deepStrictEqual(salida, [CUBIERTO]);
  } finally { mock.restore(); }
});

test('una sola llamada traduce todo el residuo y solo marca los criterios pendientes', async () => {
  const mock = mockClaude(() => JSON.stringify({
    traducciones: [
      { indice: 1, etiqueta: 'Valor implícito de la empresa', valor: 'es mayor que 100' },
      { indice: 2, etiqueta: 'Códigos SIC', valor: '2011 Plantas de empaque de carne' },
    ],
  }));
  try {
    const salida = await traducirCriteriosScreening([CUBIERTO, PENDIENTE, PENDIENTE_SIC]);
    assert.strictEqual(mock.llamadas.length, 1, 'un solo viaje a la IA para toda la tabla');
    assert.strictEqual(mock.llamadas[0].url, '/api/claude');
    assert.strictEqual(mock.llamadas[0].body.model, 'claude-haiku-4-5-20251001');

    const prompt = mock.llamadas[0].body.messages[0].content;
    assert.ok(prompt.includes('Implied Enterprise Value'), 'manda la etiqueta cruda en inglés');
    assert.ok(prompt.includes('Meat Packing Plants'), 'manda el título SIC sin catalogar');
    assert.ok(!prompt.includes('Company Type'), 'no gasta tokens en lo que el diccionario ya cubre');

    assert.strictEqual(salida[0].etiquetaEs, undefined, 'el criterio cubierto no se toca');
    assert.strictEqual(salida[1].etiquetaEs, 'Valor implícito de la empresa');
    assert.strictEqual(salida[1].valorEs, 'es mayor que 100');
    assert.strictEqual(salida[2].valorEs, '2011 Plantas de empaque de carne');
    assert.strictEqual(salida[1].etiqueta, 'Implied Enterprise Value', 'el texto crudo se conserva');
  } finally { mock.restore(); }
});

test('descarta la traducción cuando los dígitos no coinciden con la entrada', async () => {
  /* Un código SIC o un umbral alterado manda al informe una industria o un filtro que
     nadie cribó: es peor que una palabra en inglés. */
  const mock = mockClaude(() => JSON.stringify({
    traducciones: [{ indice: 0, etiqueta: 'Códigos SIC', valor: '2012 Plantas de empaque de carne' }],
  }));
  try {
    const salida = await traducirCriteriosScreening([PENDIENTE_SIC]);
    assert.strictEqual(salida[0].valorEs, undefined, '2011 se volvió 2012: no se acepta');
    assert.strictEqual(salida[0].etiquetaEs, undefined, 'se descarta el par completo, no medio');
  } finally { mock.restore(); }
});

test('acepta la traducción cuando los dígitos se conservan aunque cambie el texto', async () => {
  const mock = mockClaude(() => JSON.stringify({
    traducciones: [{ indice: 0, etiqueta: 'Códigos SIC', valor: '2011 Plantas de empaque de carne' }],
  }));
  try {
    const salida = await traducirCriteriosScreening([PENDIENTE_SIC]);
    assert.strictEqual(salida[0].valorEs, '2011 Plantas de empaque de carne');
  } finally { mock.restore(); }
});

test('lee el JSON aunque venga envuelto en prosa o en cercas de markdown', async () => {
  const mock = mockClaude(() => 'Claro, aquí va:\n```json\n'
    + JSON.stringify({ traducciones: [{ indice: 0, etiqueta: 'Valor implícito de la empresa', valor: 'es mayor que 100' }] })
    + '\n```\nEspero que sirva.');
  try {
    const salida = await traducirCriteriosScreening([PENDIENTE]);
    assert.strictEqual(salida[0].etiquetaEs, 'Valor implícito de la empresa');
  } finally { mock.restore(); }
});

test('reintenta en 429', async () => {
  const original = axios.post;
  let intentos = 0;
  axios.post = async () => {
    intentos++;
    if (intentos === 1) {
      const err = new Error('rate limited');
      err.response = { status: 429 };
      throw err;
    }
    return { data: { content: [{ type: 'text', text: JSON.stringify({ traducciones: [{ indice: 0, etiqueta: 'Valor implícito de la empresa', valor: 'es mayor que 100' }] }) }] } };
  };
  try {
    const salida = await traducirCriteriosScreening([PENDIENTE]);
    assert.strictEqual(intentos, 2);
    assert.strictEqual(salida[0].etiquetaEs, 'Valor implícito de la empresa');
  } finally { axios.post = original; }
});

test('un fallo de IA devuelve los criterios sin tocar y no lanza', async () => {
  const original = axios.post;
  axios.post = async () => { throw new Error('sin red'); };
  try {
    const entrada = [CUBIERTO, PENDIENTE];
    const salida = await traducirCriteriosScreening(entrada);
    assert.deepStrictEqual(salida, entrada, 'el informe sale con lo que cubre el diccionario');
  } finally { axios.post = original; }
});

test('una respuesta sin JSON devuelve los criterios sin tocar', async () => {
  const mock = mockClaude(() => 'No puedo ayudarte con eso.');
  try {
    const salida = await traducirCriteriosScreening([PENDIENTE]);
    assert.strictEqual(salida[0].etiquetaEs, undefined);
  } finally { mock.restore(); }
});

test('no muta el array ni los objetos de entrada', async () => {
  const entrada = [{ conector: null, etiqueta: 'Implied Enterprise Value', valor: 'is greater than 100' }];
  const mock = mockClaude(() => JSON.stringify({
    traducciones: [{ indice: 0, etiqueta: 'Valor implícito de la empresa', valor: 'es mayor que 100' }],
  }));
  try {
    const salida = await traducirCriteriosScreening(entrada);
    assert.strictEqual(entrada[0].etiquetaEs, undefined, 'el objeto original queda intacto');
    assert.notStrictEqual(salida[0], entrada[0]);
  } finally { mock.restore(); }
});

test('no revienta con lista vacía o nula', async () => {
  const mock = mockClaude(() => '{}');
  try {
    assert.deepStrictEqual(await traducirCriteriosScreening(null), []);
    assert.deepStrictEqual(await traducirCriteriosScreening([]), []);
    assert.strictEqual(mock.llamadas.length, 0);
  } finally { mock.restore(); }
});
