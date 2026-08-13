import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  necesitaRedaccion, guardarNarrativaMacroCache, leerNarrativaMacroCache,
  construirPromptRedaccionMacro, parsearRespuestaRedaccionMacro,
} from './analisisMercadoRedaccion.js';

/* localStorage no existe en node:test — se simula con un Map, suficiente para
   getItem/setItem/removeItem, que es todo lo que este módulo usa. */
function fakeLocalStorage() {
  const datos = new Map();
  return {
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => datos.set(k, String(v)),
    removeItem: (k) => datos.delete(k),
  };
}

test('necesitaRedaccion es true si no hay caché para este estudio', () => {
  globalThis.localStorage = fakeLocalStorage();
  assert.equal(necesitaRedaccion('estudio_1', { actualizadoEn: { toMillis: () => 1000 } }), true);
});

test('necesitaRedaccion es false si el caché es de la misma corrida de series o más nueva', () => {
  globalThis.localStorage = fakeLocalStorage();
  guardarNarrativaMacroCache('estudio_1', 1000, { mundial: '<p>x</p>', colombia: '<p>y</p>' });
  assert.equal(necesitaRedaccion('estudio_1', { actualizadoEn: { toMillis: () => 1000 } }), false);
});

test('necesitaRedaccion es true si el caché es de una corrida de series más vieja', () => {
  globalThis.localStorage = fakeLocalStorage();
  guardarNarrativaMacroCache('estudio_1', 1000, { mundial: '<p>x</p>', colombia: '<p>y</p>' });
  assert.equal(necesitaRedaccion('estudio_1', { actualizadoEn: { toMillis: () => 2000 } }), true);
});

test('necesitaRedaccion es false si no hay analisisMercado todavia (nada que redactar)', () => {
  globalThis.localStorage = fakeLocalStorage();
  assert.equal(necesitaRedaccion('estudio_1', null), false);
});

test('leerNarrativaMacroCache devuelve null si nunca se guardó nada para ese estudio', () => {
  globalThis.localStorage = fakeLocalStorage();
  assert.equal(leerNarrativaMacroCache('estudio_nuevo'), null);
});

test('guardarNarrativaMacroCache y leerNarrativaMacroCache son simetricos, por estudioId', () => {
  globalThis.localStorage = fakeLocalStorage();
  guardarNarrativaMacroCache('estudio_A', 1234, { mundial: '<p>a</p>', colombia: '<p>b</p>' });
  guardarNarrativaMacroCache('estudio_B', 5678, { mundial: '<p>c</p>', colombia: '<p>d</p>' });
  const a = leerNarrativaMacroCache('estudio_A');
  assert.equal(a.seriesActualizadoEnMs, 1234);
  assert.equal(a.narrativa.mundial, '<p>a</p>');
  const b = leerNarrativaMacroCache('estudio_B');
  assert.equal(b.seriesActualizadoEnMs, 5678);
  assert.equal(b.narrativa.mundial, '<p>c</p>');
});

test('construirPromptRedaccionMacro pide los 9 apartados y solo las series recibidas', () => {
  const prompt = construirPromptRedaccionMacro(
    { pib_mundial: { valores: { 2025: '3.2' }, fuente: 'FMI', fuenteUrl: 'https://fmi.org' } },
    2025
  );
  ['mundial', 'colombia', 'inflacionMundial', 'proyeccionMundial', 'inflacionColombia',
    'politicaMonetaria', 'tasaCambio', 'mercadoLaboral', 'conclusiones', 'fuentesCitadas']
    .forEach((campo) => assert.ok(prompt.includes(campo), 'falta el campo ' + campo));
  assert.ok(prompt.includes('pib_mundial'));
});

test('parsearRespuestaRedaccionMacro exige mundial/colombia y admite temas parciales', () => {
  const texto = JSON.stringify({
    mundial: '<p>La economía mundial mostró un crecimiento moderado en el período.</p>',
    colombia: '<p>La economía colombiana registró una recuperación en el período.</p>',
    politicaMonetaria: '<p>La tasa de intervención se mantuvo estable en el período.</p>',
  });
  const r = parsearRespuestaRedaccionMacro(texto);
  assert.ok(r.mundial.includes('mundial'));
  assert.ok(r.politicaMonetaria.includes('tasa de intervención'));
  assert.equal('tasaCambio' in r, false);
});

test('parsearRespuestaRedaccionMacro lanza si falta mundial o colombia', () => {
  assert.throws(() => parsearRespuestaRedaccionMacro(JSON.stringify({ colombia: '<p>x</p>' })));
});
