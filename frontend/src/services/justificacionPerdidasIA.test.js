/* Pruebas del asistente de justificación de pérdidas.

   Sin red: `post` va inyectado. Lo que se fija aquí es sobre todo lo que el módulo NO debe hacer,
   porque su salida se radica ante la DIAN: no redactar sin el análisis de causa, no inventar
   cifras, y no romper nada cuando el modelo no responde. */

import { test } from 'node:test';
import assert from 'node:assert';
import { promptJustificacion, redactarJustificacionPerdidas } from './justificacionPerdidasIA.js';

const HECHOS = {
  causa: 'Contracción de la demanda de llantas de reposición y alza del costo del caucho importado.',
  entidad: 'LLANTAS EMOTION S.A.S.',
  anio: 2025,
  actividad: 'importación y comercialización de llantas',
  metodo: 'MO',
  indicador: -0.04595,
  enLaMuestra: 4,
  deLaMuestra: 12,
  disponibles: 37,
  margenes: [-0.0459, -0.0428, -0.0502, -0.0510],
  criterio: 'cercania-al-contribuyente',
};

const respuestaCon = (texto) => ({ data: { content: [{ text: texto }] } });
const PARRAFO = 'La muestra incluye cuatro comparables con pérdida operativa, de un total de doce.';

/* ══════════════ El prompt ══════════════ */

test('el prompt lleva la causa que escribió el analista, literal', () => {
  const p = promptJustificacion(HECHOS);
  assert.match(p, /Contracción de la demanda de llantas/);
  assert.match(p, /según el analista/i);
});

test('prohíbe inventar causas y cifras', () => {
  /* Es la regla que hace usable el módulo: un párrafo bien escrito que afirme un hecho que nadie
     verificó es peor que un campo vacío, porque el documento se radica. */
  const p = promptJustificacion(HECHOS);
  assert.match(p, /NO inventes causas/);
  assert.match(p, /cifras/);
  assert.match(p, /única causa admisible/i);
});

test('lleva las cifras ya calculadas, no le pide deducirlas', () => {
  const p = promptJustificacion(HECHOS);
  assert.match(p, /4 de 12/, 'las de la muestra');
  assert.match(p, /37/, 'las disponibles en el universo');
  assert.match(p, /-4,595 %/, 'el margen de la parte examinada, formateado');
  assert.match(p, /LLANTAS EMOTION S\.A\.S\./);
  assert.match(p, /2025/);
});

test('cita el fundamento normativo exacto', () => {
  const p = promptJustificacion(HECHOS);
  assert.match(p, /3\.64/);
  assert.match(p, /3\.65/);
  assert.match(p, /260-4/);
});

test('prohíbe afirmar que el estudio cumple', () => {
  /* Eso lo determina el rango, no la justificación. Un párrafo que lo afirme sería una
     conclusión metida donde va un sustento. */
  const p = promptJustificacion(HECHOS);
  assert.match(p, /NO afirmes que la parte examinada cumple/);
});

test('nombra el criterio de selección cuando fue por cercanía', () => {
  const p = promptJustificacion(HECHOS);
  assert.match(p, /perfil de rentabilidad más cercano/);
  const sinCriterio = promptJustificacion({ ...HECHOS, criterio: 'puntaje' });
  assert.doesNotMatch(sinCriterio, /perfil de rentabilidad más cercano/);
});

test('tolera hechos incompletos sin producir «undefined» en el prompt', () => {
  const p = promptJustificacion({ causa: 'Alza de insumos.' });
  assert.doesNotMatch(p, /undefined|null|NaN/);
  assert.match(p, /Alza de insumos\./);
});

/* ══════════════ La llamada ══════════════ */

test('sin causa escrita NO se llama al modelo', () => {
  /* La regla dura. El análisis de causa es lo que exigen las Guías y es lo único que la IA no
     puede saber: sin él no hay justificación que redactar. */
  let llamado = false;
  const io = { post: async () => { llamado = true; return respuestaCon(PARRAFO); } };
  return Promise.all(['', '   ', undefined, null].map(async (causa) => {
    const r = await redactarJustificacionPerdidas({ ...HECHOS, causa }, io);
    assert.strictEqual(r, null);
  })).then(() => assert.strictEqual(llamado, false, 'no se gasta la llamada'));
});

test('con causa, redacta y devuelve el párrafo', async () => {
  let payload = null;
  const r = await redactarJustificacionPerdidas(HECHOS, {
    post: async (_url, p) => { payload = p; return respuestaCon(PARRAFO); },
  });
  assert.strictEqual(r, PARRAFO);
  assert.strictEqual(payload.model, 'claude-sonnet-5',
    'Sonnet y no Haiku: son 150 palabras una vez por estudio, y es texto que se radica');
});

test('va a /api/claude, que ya cae a Gemini del lado del servidor', async () => {
  let url = null;
  await redactarJustificacionPerdidas(HECHOS, {
    post: async (u) => { url = u; return respuestaCon(PARRAFO); },
  });
  assert.strictEqual(url, '/api/claude');
});

test('limpia comillas, vallas de markdown y encabezados que el modelo agregue', async () => {
  const casos = [
    ['```\n' + PARRAFO + '\n```', PARRAFO],
    ['"' + PARRAFO + '"', PARRAFO],
    ['Justificación: ' + PARRAFO, PARRAFO],
    ['“' + PARRAFO + '”', PARRAFO],
  ];
  for (const [crudo, esperado] of casos) {
    const r = await redactarJustificacionPerdidas(HECHOS, { post: async () => respuestaCon(crudo) });
    assert.strictEqual(r, esperado, 'con entrada ' + JSON.stringify(crudo.slice(0, 20)));
  }
});

test('un 429 se reintenta', async () => {
  let intentos = 0;
  const r = await redactarJustificacionPerdidas(HECHOS, {
    post: async () => {
      intentos += 1;
      if (intentos < 2) { const e = new Error('429'); e.response = { status: 429 }; throw e; }
      return respuestaCon(PARRAFO);
    },
    pausaMs: 1,
  });
  assert.strictEqual(intentos, 2);
  assert.strictEqual(r, PARRAFO);
});

test('un fallo que no es 429 no se reintenta y devuelve null', async () => {
  let intentos = 0;
  const r = await redactarJustificacionPerdidas(HECHOS, {
    post: async () => { intentos += 1; const e = new Error('400'); e.response = { status: 400 }; throw e; },
    pausaMs: 1,
  });
  assert.strictEqual(intentos, 1, 'un 400 es un defecto de contrato: repetirlo solo gasta cuota');
  assert.strictEqual(r, null);
});

test('NUNCA lanza: el campo sigue editable a mano si la IA no responde', async () => {
  /* Es asistencia, no un requisito del flujo. */
  const r = await redactarJustificacionPerdidas(HECHOS, {
    post: async () => { throw new Error('sin red'); }, pausaMs: 1,
  });
  assert.strictEqual(r, null);
});

test('una respuesta vacía devuelve null, no una cadena vacía', async () => {
  for (const data of [{ content: [] }, { content: [{ text: '   ' }] }, {}]) {
    const r = await redactarJustificacionPerdidas(HECHOS, { post: async () => ({ data }) });
    assert.strictEqual(r, null);
  }
});
