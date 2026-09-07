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

/* ── LA COMPARABLE SIN ACTIVIDAD ──
   Pedido el 2026-09-05, tras encontrar que el ANEXO B imprime literalmente «Descripción de
   actividad no disponible.» cuando faltan `descActividad` y `desc`, y que nada lo advertía antes
   de radicar. Es un hueco en el sustento de comparabilidad (Art. 260-4 E.T.): una comparable de
   la que el informe no dice a qué se dedica no sostiene la comparación que justifica el precio. */

test('avisa qué comparables saldrían sin actividad, y las nombra', () => {
  const r = evaluarRadicacion({
    diagnostico: {
      comparablesCubiertas: true,
      razonesRechazoCubiertas: true,
      comparablesSinActividad: ['TURPAZ INDUSTRIES LTD', 'BOLAK COMPANY LIMITED'],
    },
  });
  const aviso = r.advertencias.find((a) => /ANEXO B/.test(a));
  assert.ok(aviso, 'tiene que haber un aviso');
  assert.match(aviso, /2 comparable/);
  assert.match(aviso, /TURPAZ INDUSTRIES LTD/, 'nombrarlas es lo que permite ir a la fila');
  assert.match(aviso, /BOLAK COMPANY LIMITED/);
  assert.match(aviso, /paso 4/, 'y decir dónde se arregla');
});

test('no bloquea la radicación: es un hueco visible, no una fuga de otro contribuyente', () => {
  /* La distinción que sostiene todo este servicio. Un marcador de «falta esto» se ve y se
     completa; lo que no se radica es un dato de OTRO contribuyente con aspecto de estar bien. */
  const r = evaluarRadicacion({
    diagnostico: {
      comparablesCubiertas: true,
      razonesRechazoCubiertas: true,
      comparablesSinActividad: ['ALFA SA'],
    },
  });
  assert.deepStrictEqual(r.bloqueantes, []);
});

test('con muchas, cita las primeras y dice cuántas quedan', () => {
  /* Un aviso con veinte razones sociales seguidas no se lee, y entonces no sirve de aviso. */
  const nombres = ['A SA', 'B SA', 'C SA', 'D SA', 'E SA', 'F SA', 'G SA'];
  const r = evaluarRadicacion({
    diagnostico: { comparablesCubiertas: true, razonesRechazoCubiertas: true, comparablesSinActividad: nombres },
  });
  const aviso = r.advertencias.find((a) => /ANEXO B/.test(a));
  assert.match(aviso, /7 comparable/);
  assert.match(aviso, /y 2 más/);
  assert.ok(!/G SA/.test(aviso), 'la séptima no se enumera');
});

test('sin comparables sin actividad no hay aviso', () => {
  const r = evaluarRadicacion({
    diagnostico: { comparablesCubiertas: true, razonesRechazoCubiertas: true, comparablesSinActividad: [] },
  });
  assert.ok(!r.advertencias.some((a) => /ANEXO B/.test(a)));
  /* Y con el campo ausente tampoco: un diagnóstico viejo, guardado antes de este cambio, no
     puede hacer que el semáforo se caiga. */
  const viejo = evaluarRadicacion({
    diagnostico: { comparablesCubiertas: true, razonesRechazoCubiertas: true },
  });
  assert.ok(!viejo.advertencias.some((a) => /ANEXO B/.test(a)));
});
