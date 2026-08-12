import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluarRadicacion } from './semaforoRadicacion.js';

const DIAGNOSTICO_LIMPIO = {
  seriesFaltantes: [], narrativaCubierta: true, sectorNarrativaCubierta: true,
  razonesRechazoCubiertas: true, razonesRechazoDescuadradas: false,
  comparablesCubiertas: true, comparablesSinCifras: 0, sectorialCubierto: true,
};

test('evaluarRadicacion bloquea si hay fugas del informe de referencia', () => {
  const veredicto = evaluarRadicacion({
    diagnostico: DIAGNOSTICO_LIMPIO,
    fugasReferencia: [{
      campo: 'vinc', cuenta: 69,
      texto: 'El dato del informe de referencia "END GAME INTERACTIVE" (vinc) sobrevive 69 vez(ces) en el documento generado, sin marcar. Debía ser "ACME INC": esas apariciones se van a radicar con el dato del contribuyente anterior.',
    }],
    avisosTablas: [],
    camposVacios: [],
  });
  assert.equal(veredicto.listo, false);
  assert.match(veredicto.bloqueantes.join(' '), /END GAME INTERACTIVE.*69/);
});

test('evaluarRadicacion queda listo si no hay bloqueantes, aunque haya advertencias', () => {
  const veredicto = evaluarRadicacion({
    diagnostico: { ...DIAGNOSTICO_LIMPIO, seriesFaltantes: ['la TRM promedio'] },
    fugasReferencia: [],
    avisosTablas: [],
    camposVacios: [],
  });
  assert.equal(veredicto.listo, true);
  assert.ok(veredicto.advertencias.length >= 1);
  assert.equal(veredicto.bloqueantes.length, 0);
});

test('evaluarRadicacion bloquea si las tablas de comparables no están cubiertas', () => {
  const veredicto = evaluarRadicacion({
    diagnostico: { ...DIAGNOSTICO_LIMPIO, comparablesCubiertas: false },
    fugasReferencia: [],
    avisosTablas: [],
    camposVacios: [],
  });
  assert.equal(veredicto.listo, false);
  assert.match(veredicto.bloqueantes.join(' '), /comparables/i);
});

test('evaluarRadicacion bloquea si la tabla de razones de rechazo no está cubierta', () => {
  const veredicto = evaluarRadicacion({
    diagnostico: { ...DIAGNOSTICO_LIMPIO, razonesRechazoCubiertas: false },
    fugasReferencia: [],
    avisosTablas: [],
    camposVacios: [],
  });
  assert.equal(veredicto.listo, false);
  assert.match(veredicto.bloqueantes.join(' '), /razones de rechazo/i);
});

test('evaluarRadicacion reporta como advertencias las tablas y campos que no se encontraron', () => {
  const veredicto = evaluarRadicacion({
    diagnostico: DIAGNOSTICO_LIMPIO,
    fugasReferencia: [],
    avisosTablas: ['PIB Mundial'],
    camposVacios: ['nit'],
  });
  assert.equal(veredicto.listo, true);
  assert.match(veredicto.advertencias.join(' '), /PIB Mundial/);
  assert.match(veredicto.advertencias.join(' '), /nit/);
});

test('evaluarRadicacion sin argumentos no lanza, y bloquea por conservador: sin diagnóstico no se puede confirmar cobertura', () => {
  const veredicto = evaluarRadicacion();
  assert.equal(veredicto.listo, false);
  assert.ok(veredicto.bloqueantes.length > 0);
});
