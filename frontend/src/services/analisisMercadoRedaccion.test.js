import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  necesitaRedaccion, construirPromptRedaccionMacro, parsearRespuestaRedaccionMacro,
} from './analisisMercadoRedaccion.js';

test('necesitaRedaccion es true si no hay cache para este estudio', () => {
  assert.equal(necesitaRedaccion({ actualizadoEn: { toMillis: () => 1000 } }, null), true);
});

test('necesitaRedaccion es false si el cache es de la misma corrida de series o mas nueva', () => {
  const cache = { seriesActualizadoEnMs: 1000, narrativa: { mundial: '<p>x</p>', colombia: '<p>y</p>' } };
  assert.equal(necesitaRedaccion({ actualizadoEn: { toMillis: () => 1000 } }, cache), false);
});

test('necesitaRedaccion es true si el cache es de una corrida de series mas vieja', () => {
  const cache = { seriesActualizadoEnMs: 1000, narrativa: { mundial: '<p>x</p>', colombia: '<p>y</p>' } };
  assert.equal(necesitaRedaccion({ actualizadoEn: { toMillis: () => 2000 } }, cache), true);
});

test('necesitaRedaccion es false si no hay analisisMercado todavia (nada que redactar)', () => {
  assert.equal(necesitaRedaccion(null, null), false);
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
