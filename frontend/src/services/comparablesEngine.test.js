
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import XLSX from 'xlsx-js-style';
import {
  scoreCandidates, curateCandidatesWithGemini, nameKey, prefiltrar, enPerdida, esRatioYNoSaldo,
  elegirHoja, encontrarFilaEncabezados, COLUMNAS_IQ, importCapitalIQExcel,
  regionDe, perfilDe, tokensSignificativos, coincidenciaActividad, extraerJSON,
  parsearCriteriosScreening, leerCriteriosScreeningDeArchivo, CURACION_LOTE, enriquecerUniverso,
  MINIMO_COMPARABLES, gradoDeActividad, consultarGemini, claveDeCruce,
} from './comparablesEngine.js';
import { num } from '../utils/calculations.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/* FileReader no existe en node: se simula el mínimo que usa el importador. */
function conFileReader(buf, fn) {
  const previo = global.FileReader;
  global.FileReader = class {
    readAsArrayBuffer() {
      setImmediate(() => this.onload({
        target: { result: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
      }));
    }
  };
  return Promise.resolve(fn()).finally(() => {
    if (previo) global.FileReader = previo; else delete global.FileReader;
  });
}

function mockGeminiRechazandoTodas() {
  const original = axios.post;
  axios.post = async () => ({
    data: {
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              evaluacion: [
                { id: 'A', coincide: false, motivo: 'no coincide según la IA' },
                { id: 'B', coincide: false, motivo: 'no coincide según la IA' }
              ]
            })
          }]
        }
      }]
    }
  });
  return () => { axios.post = original; };
}

/**
 * Error como los que produce axios: un número se convierte en respuesta HTTP con ese
 * código; `true` es un fallo sin respuesta, como una conexión cortada.
 */
function errorFalso(fallo) {
  if (typeof fallo === 'number' || typeof fallo === 'object') {
    const status = typeof fallo === 'number' ? fallo : fallo.status;
    const err = new Error('Request failed with status code ' + status);
    err.response = { status, data: { error: { message: (fallo && fallo.mensaje) || 'algo salió mal' } } };
    return err;
  }
  return new Error('límite de la API');
}

/**
 * Responde a cada lote con el veredicto que dicte `decidir(candidato)`.
 * `opciones.perfil(candidato)` dicta el perfil funcional devuelto; si no se pasa, la
 * respuesta no trae perfil, como la de un modelo que ignora ese campo.
 * `opciones.fallar({ n, ids })` decide si esa consulta falla: devolver un número la
 * hace fallar con ese código HTTP y `true` con un fallo de red. Recibe el número de
 * consulta y los identificadores del lote, porque con reintentos un mismo lote puede
 * consultarse varias veces y hay pruebas que necesitan distinguirlo.
 */
function mockGemini(decidir, opciones = {}) {
  const original = axios.post;
  const llamadas = [];
  axios.post = async (url, body) => {
    llamadas.push(body);
    const texto = body.contents[0].parts[0].text;
    const lista = JSON.parse(texto.slice(texto.indexOf('Candidatas:\n') + 12, texto.lastIndexOf('\n\nResponde')));
    const fallo = opciones.fallar && opciones.fallar({ n: llamadas.length, ids: lista.map(c => c.id) });
    if (fallo) throw errorFalso(fallo);
    return {
      data: {
        candidates: [{
          content: {
            parts: [{
              text: (opciones.envolver || (s => s))(JSON.stringify({
                resultados: lista.map(c => ({
                  id: c.id,
                  /* Con `opciones.grado` el modelo contesta con el grado de actividad, que es lo
                     que pide el prompt; sin él contesta con el `coincide` del formato anterior,
                     que es lo que sigue haciendo un modelo que ignora el campo nuevo. */
                  ...(opciones.grado
                    ? { grado: opciones.grado(c) }
                    : { coincide: decidir(c) }),
                  motivo: 'motivo breve',
                  ...(opciones.perfil ? { perfil: opciones.perfil(c) } : {}),
                }))
              }))
            }]
          }
        }]
      }
    };
  };
  return { restore: () => { axios.post = original; }, llamadas };
}

test('scoreCandidates: una comparable con pérdida operativa se excluye aunque sea de continuidad', () => {
  const candidatas = [
    { id: 'A', name: 'Continuidad Corp', nameKey: nameKey('Continuidad Corp'), isHolding: false, hasNegativeBalance: false, hasLoss: true, country: 'Colombia' }
  ];
  const priorComps = [{ name: 'Continuidad Corp' }];
  const result = scoreCandidates(candidatas, {}, '', priorComps);
  assert.strictEqual(result.seleccionadas.length, 0, 'la pérdida operativa debe seguir excluyendo incluso a las de continuidad');
  assert.strictEqual(result.rechazadas.length, 1);
  assert.strictEqual(result.rechazadas[0].esContinuidad, true, 'sí debió reconocerse como continuidad');
});

test('una candidata de continuidad no se descarta aunque la IA diga que no coincide', async () => {
  /* La curación ya no devuelve las candidatas marcadas: devuelve un veredicto por
     identificador, y el descarte lo decide el motor, que es quien conoce las
     excepciones. La intención de la comprobación no cambia: la comparable que
     venía del estudio anterior sobrevive al «no coincide» de la IA, porque su
     inclusión se sustentó en su momento. */
  const restore = mockGeminiRechazandoTodas();
  try {
    const candidatas = [
      { id: 'A', name: 'Continuidad Corp', nameKey: nameKey('Continuidad Corp'), desc: 'x', s: 100, op: 10 },
      { id: 'B', name: 'Nueva Corp', nameKey: nameKey('Nueva Corp'), desc: 'y', s: 100, op: 10 }
    ];
    const veredicto = await curateCandidatesWithGemini(candidatas, 'actividad de prueba');
    assert.strictEqual(veredicto.porId.A.coincide, false, 'la IA rechazó a A');
    assert.strictEqual(veredicto.porId.B.coincide, false, 'y a B');

    const r = scoreCandidates(candidatas, { nTarget: 10 }, 'actividad de prueba',
      [{ name: 'Continuidad Corp' }], { iaMatch: veredicto });
    const a = [...r.seleccionadas, ...r.rechazadas].find(c => c.id === 'A');
    const b = [...r.seleccionadas, ...r.rechazadas].find(c => c.id === 'B');
    assert.strictEqual(a.descartada, false, 'la de continuidad no debe descartarse');
    assert.strictEqual(b.descartada, true, 'la que no viene de continuidad sí');
    assert.match(b.motivoRechazo, /Curación IA/);
  } finally {
    restore();
  }
});

test('una candidata de continuidad ya no se descarta por falta de descripción', () => {
  const candidatas = [
    { id: 'X', name: 'Continuidad Corp', nameKey: nameKey('Continuidad Corp'), desc: '', s: 100, op: 10 }
  ];
  const priorComps = [{ name: 'Continuidad Corp' }];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, 'desarrollo de software', priorComps,
    { iaMatch: { porId: { OTRO: { coincide: true } } } });
  assert.strictEqual(r.rechazadas.length, 0, 'ya no se descarta por falta de descripción');
  assert.strictEqual(r.seleccionadas.length, 1);
  assert.strictEqual(r.seleccionadas[0].esContinuidad, true);
});

/* ══════ el cupo N objetivo es el tamaño de la muestra final ══════
   Estos cuatro prueban la MECÁNICA del cupo con números pequeños, así que pasan `minimo: 0`
   para apartar el piso de `MINIMO_COMPARABLES` y poder pedir 2, 3 o 4. El piso tiene sus
   propios tests más abajo; la aplicación nunca pasa `minimo`.

   Antes las de continuidad se sumaban al margen de `nTarget`, así que pedir 12 con 7 del
   estudio anterior devolvía 19 comparables. El número que el usuario escribe es el
   tamaño final: la continuidad entra primero y ocupa parte de ese cupo. */

test('las candidatas de continuidad cuentan dentro del cupo, no aparte', () => {
  const candidatas = [
    { id: '1', name: 'Continuidad Uno', nameKey: nameKey('Continuidad Uno'), s: 100, op: 10 },
    { id: '2', name: 'Continuidad Dos', nameKey: nameKey('Continuidad Dos'), s: 100, op: 10 },
    { id: '3', name: 'Nueva Uno', nameKey: nameKey('Nueva Uno'), s: 100, op: 10 },
    { id: '4', name: 'Nueva Dos', nameKey: nameKey('Nueva Dos'), s: 100, op: 10 },
  ];
  const priorComps = [{ name: 'Continuidad Uno' }, { name: 'Continuidad Dos' }];
  const r = scoreCandidates(candidatas, { nTarget: 3, minimo: 0 }, '', priorComps);

  assert.strictEqual(r.seleccionadas.length, 3, 'pedidas 3, devueltas 3');
  assert.strictEqual(r.continuidad, 2);
  assert.strictEqual(r.seleccionadas.filter(c => c.esContinuidad).length, 2,
    'las dos del estudio anterior entran primero');
  assert.strictEqual(r.seleccionadas.filter(c => !c.esContinuidad).length, 1,
    'y se completa con una nueva hasta llegar al cupo');
  assert.strictEqual(r.reserva.length, 1, 'la nueva que no cupo queda en reserva');
});

test('el caso reportado: 12 pedidas con 7 de continuidad son 12, no 19', () => {
  const continuidad = Array.from({ length: 7 }, (_, i) => ({
    id: 'C' + i, name: 'Previa ' + i, nameKey: nameKey('Previa ' + i), s: 100, op: 10,
  }));
  const nuevas = Array.from({ length: 30 }, (_, i) => ({
    id: 'N' + i, name: 'Nueva ' + i, nameKey: nameKey('Nueva ' + i), s: 100, op: 10,
  }));
  const priorComps = continuidad.map(c => ({ name: c.name }));
  const r = scoreCandidates([...continuidad, ...nuevas], { nTarget: 12 }, '', priorComps);

  assert.strictEqual(r.seleccionadas.length, 12);
  assert.strictEqual(r.continuidad, 7);
  assert.strictEqual(r.seleccionadas.filter(c => !c.esContinuidad).length, 5, '7 + 5 = 12');
  assert.strictEqual(r.continuidadExcedeObjetivo, false);
});

test('la continuidad no se recorta cuando por sí sola pasa del objetivo', () => {
  /* Retirar una comparable aceptada el año anterior hay que justificarlo en el informe,
     así que se conservan todas y no se añade ninguna nueva: la muestra queda por encima
     de lo pedido y se avisa. */
  const candidatas = [
    { id: '1', name: 'Previa Uno', nameKey: nameKey('Previa Uno'), s: 100, op: 10 },
    { id: '2', name: 'Previa Dos', nameKey: nameKey('Previa Dos'), s: 100, op: 10 },
    { id: '3', name: 'Previa Tres', nameKey: nameKey('Previa Tres'), s: 100, op: 10 },
    { id: '4', name: 'Nueva', nameKey: nameKey('Nueva'), s: 100, op: 10 },
  ];
  const priorComps = [{ name: 'Previa Uno' }, { name: 'Previa Dos' }, { name: 'Previa Tres' }];
  const r = scoreCandidates(candidatas, { nTarget: 2, minimo: 0 }, '', priorComps);

  assert.strictEqual(r.seleccionadas.length, 3, 'las tres de continuidad se conservan');
  assert.strictEqual(r.seleccionadas.filter(c => !c.esContinuidad).length, 0,
    'y no entra ninguna nueva: el cupo ya está pasado');
  assert.strictEqual(r.continuidadExcedeObjetivo, true, 'y se puede avisar en pantalla');
  assert.strictEqual(r.reserva.length, 1, 'la nueva queda disponible en reserva');
});

test('sin continuidad el cupo se comporta igual que antes', () => {
  const candidatas = Array.from({ length: 10 }, (_, i) => ({
    id: 'C' + i, name: 'Comp ' + i, nameKey: nameKey('Comp ' + i), s: 100, op: 10,
  }));
  const r = scoreCandidates(candidatas, { nTarget: 4, minimo: 0 }, '', []);
  assert.strictEqual(r.seleccionadas.length, 4);
  assert.strictEqual(r.continuidad, 0);
  assert.strictEqual(r.reserva.length, 6);
});

/* ══════════════ Cuota de comparables en pérdida ══════════════

   Por qué existe: `perdidaOp: 'excluir'` viene activo por defecto y rotulado «criterio
   conservador DIAN», así que toda muestra pierde su extremo bajo y todos los rangos salen
   empujados hacia arriba. Un contribuyente de margen bajo queda estructuralmente fuera del
   rango. Las Guías OCDE (cap. III, §3.64-3.65) no admiten rechazar una comparable por estar
   en pérdida sin analizar la causa.

   `negativasObjetivo` es un objetivo Y un tope, cuenta DENTRO de `nTarget`, y solo se llena
   con actividad MISMA (decisión del usuario, 2026-08-31). */

/* Candidatas homogéneas salvo por el margen: `op` negativo es la pérdida. `s` igual en todas
   para que el factor de tamaño no las ordene por otra cosa. */
const positivas = (n, prefijo = 'POS') => Array.from({ length: n }, (_, i) => ({
  id: prefijo + i, name: prefijo + ' ' + i, nameKey: nameKey(prefijo + ' ' + i), s: 100, op: 10,
}));
const negativas = (n, prefijo = 'NEG') => Array.from({ length: n }, (_, i) => ({
  id: prefijo + i, name: prefijo + ' ' + i, nameKey: nameKey(prefijo + ' ' + i), s: 100, op: -10,
}));
const cuantasNegativas = (lista) => lista.filter((c) => num(c.op) < 0).length;

test('pedir 3 negativas con 5 disponibles da exactamente 3, y la muestra sigue midiendo nTarget', () => {
  const r = scoreCandidates([...positivas(20), ...negativas(5)],
    { nTarget: 12, minimo: 0, perdidaOp: 'incluir', negativasObjetivo: 3 }, '', []);

  assert.strictEqual(r.seleccionadas.length, 12, 'las negativas ocupan lugar DENTRO del N, no aparte');
  assert.strictEqual(cuantasNegativas(r.seleccionadas), 3, 'exactamente las pedidas');
  assert.strictEqual(r.negativasObjetivo, 3);
  assert.strictEqual(r.negativasIncluidas, 3);
  assert.strictEqual(r.negativasDisponibles, 5);
});

test('el objetivo es también un TOPE: las negativas de sobra no se cuelan por puntaje', () => {
  /* Sin esto, pedir 3 podía devolver 5 —las 3 de la cuota más las que entraran compitiendo—
     y el número dejaría de significar «las que salen en el informe». */
  const r = scoreCandidates([...positivas(5), ...negativas(10)],
    { nTarget: 12, minimo: 0, perdidaOp: 'incluir', negativasObjetivo: 2 }, '', []);

  assert.strictEqual(cuantasNegativas(r.seleccionadas), 2, 'ni una más, aunque sobren negativas y falten positivas');
  /* Y la muestra queda corta antes que rellenarse con negativas de más: 5 positivas + 2. */
  assert.strictEqual(r.seleccionadas.length, 7);
  assert.strictEqual(cuantasNegativas(r.reserva), 8, 'las otras 8 quedan en reserva, no descartadas');
});

test('si hay menos negativas de las pedidas, entran las que haya y se puede avisar cuántas', () => {
  const r = scoreCandidates([...positivas(20), ...negativas(1)],
    { nTarget: 12, minimo: 0, perdidaOp: 'incluir', negativasObjetivo: 3 }, '', []);

  assert.strictEqual(cuantasNegativas(r.seleccionadas), 1);
  assert.strictEqual(r.negativasObjetivo, 3);
  assert.strictEqual(r.negativasIncluidas, 1);
  assert.strictEqual(r.negativasDisponibles, 1, 'el techo del universo, que es lo que explica el faltante');
  assert.strictEqual(r.seleccionadas.length, 12, 'el hueco lo llenan positivas: la muestra no se acorta');
});

test('con perdidaOp en excluir el objetivo se ignora solo', () => {
  const r = scoreCandidates([...positivas(20), ...negativas(5)],
    { nTarget: 12, minimo: 0, perdidaOp: 'excluir', negativasObjetivo: 3 }, '', []);

  assert.strictEqual(cuantasNegativas(r.seleccionadas), 0, 'el filtro manda: no hay negativas que repartir');
  assert.strictEqual(r.negativasIncluidas, 0);
  assert.strictEqual(r.negativasExcluidasPorFiltro, 5,
    'y se puede decir cuántas está excluyendo el filtro, que es la palanca del diagnóstico');
});

test('sin objetivo, el comportamiento es exactamente el de antes', () => {
  /* La cuota es opt-in: `negativasObjetivo` en 0 no debe cambiar nada de lo que ya hacía el
     motor, ni siquiera el orden de la reserva. */
  const candidatas = [...positivas(20), ...negativas(5)];
  const r = scoreCandidates(candidatas, { nTarget: 12, minimo: 0, perdidaOp: 'incluir' }, '', []);
  assert.strictEqual(r.seleccionadas.length, 12);
  assert.strictEqual(r.negativasObjetivo, 0);
  assert.strictEqual(r.negativasIncluidas, 0, 'sin cuota no se reservan cupos para pérdidas');
});

test('una negativa de continuidad cuenta contra el objetivo', () => {
  /* El objetivo es «cuántas negativas salen en el informe», no «cuántas nuevas se buscan»:
     si el estudio anterior aporta una en pérdida y se piden 3, faltan 2. */
  const previa = [{ id: 'P0', name: 'Previa Cero', nameKey: nameKey('Previa Cero'), s: 100, op: -10 }];
  const r = scoreCandidates([...previa, ...positivas(20), ...negativas(5)],
    { nTarget: 12, minimo: 0, perdidaOp: 'incluir', negativasObjetivo: 3 },
    '', [{ name: 'Previa Cero' }]);

  assert.strictEqual(cuantasNegativas(r.seleccionadas), 3, 'la de continuidad más dos nuevas');
  assert.strictEqual(r.negativasDeContinuidad, 1);
  assert.strictEqual(r.negativasIncluidas, 3);
});

test('una negativa de actividad afín completa la cuota cuando no hay idénticas', () => {
  /* Reportado el 2026-09-04: cuota de 10 y UNA sola incluida, con 1.904 en pérdida en el
     universo. Las afines en pérdida se iban enteras a la reserva y la cuota se quedaba en lo
     que dieran las idénticas, sin cupo de por medio. Ahora completan lo que falte, marcadas
     por ampliación para que el informe sustente las dos cosas: la pérdida y el criterio. */
  const afinNegativa = { id: 'AF', name: 'Afin Negativa', desc: 'algo parecido', s: 100, op: -10 };
  /* Con `desc`: sin descripción la curación las rechaza antes de llegar a la cuota y la
     prueba pasaría por el motivo equivocado. */
  const pos = positivas(3).map((c) => ({ ...c, desc: 'servicios varios' }));
  const candidatas = [...pos, afinNegativa];
  const r = scoreCandidates(candidatas,
    { nTarget: 12, minimo: 0, perdidaOp: 'incluir', negativasObjetivo: 2 },
    'actividad concreta',
    [],
    { iaMatch: { porId: {
      ...Object.fromEntries(pos.map((c) => [c.id, { grado: 'MISMA', perfil: 'SERVICIO' }])),
      AF: { grado: 'RELACIONADA', perfil: 'SERVICIO' },
    } } });

  assert.strictEqual(cuantasNegativas(r.seleccionadas), 1, 'entra la única negativa que hay');
  assert.strictEqual(r.seleccionadas.length, 4, 'y las positivas idénticas siguen en la muestra');
  assert.strictEqual(r.negativasDisponibles, 1, 'y cuenta como disponible');
  assert.strictEqual(r.negativasIdenticasDisponibles, 0);
  assert.strictEqual(r.negativasAfinesDisponibles, 1);
  assert.strictEqual(r.negativasPorAmpliacion, 1, 'declarada como ampliación del criterio');
  assert.ok(r.ampliadas >= 1, 'y suma a las que el informe declara como actividad afín');
  const dentro = r.seleccionadas.find((c) => c.id === 'AF');
  assert.ok(dentro, 'está en la muestra');
  assert.strictEqual(dentro.entroPorAmpliacion, true, 'marcada por fila, para el Excel');
  assert.ok(!r.reserva.some((c) => c.id === 'AF'),
    'y no queda además en la reserva: contarla dos veces descuadra el embudo');
});

test('con idénticas de sobra, la cuota no toca las afines en pérdida', () => {
  /* La preferencia del 2026-09-01 se conserva entera: las afines solo entran por lo que falte.
     Un estudio con idénticas suficientes se comporta exactamente igual que antes del cambio. */
  const afinNegativa = { id: 'AF', name: 'Afin Negativa', desc: 'algo parecido', s: 100, op: -10 };
  const conDesc = (lista) => lista.map((c) => ({ ...c, desc: 'servicios varios' }));
  const pos = conDesc(positivas(10));
  const negs = conDesc(negativas(4));
  const r = scoreCandidates([...pos, ...negs, afinNegativa],
    { nTarget: 12, minimo: 0, perdidaOp: 'incluir', negativasObjetivo: 2 },
    'actividad concreta',
    [],
    { iaMatch: { porId: {
      ...Object.fromEntries(pos.map((c) => [c.id, { grado: 'MISMA', perfil: 'SERVICIO' }])),
      ...Object.fromEntries(negs.map((c) => [c.id, { grado: 'MISMA', perfil: 'SERVICIO' }])),
      AF: { grado: 'RELACIONADA', perfil: 'SERVICIO' },
    } } });

  assert.strictEqual(cuantasNegativas(r.seleccionadas), 2, 'la cuota se llena con idénticas');
  assert.strictEqual(r.negativasPorAmpliacion, 0, 'ninguna entró por afinidad');
  assert.strictEqual(r.seleccionadas.find((c) => c.id === 'AF'), undefined);
  assert.ok(r.reserva.some((c) => c.id === 'AF'), 'la afín queda en reserva con su motivo');
});

test('la continuidad que este año está en pérdida se nombra, para poder justificar su retiro', () => {
  /* La pérdida sigue excluyendo incluso a la continuidad —decisión deliberada y probada más
     arriba—, pero hasta ahora se caía sin un solo aviso: el analista veía la muestra más
     corta sin saber cuál faltaba. */
  const previa = [{ id: 'P0', name: 'Previa En Perdida', nameKey: nameKey('Previa En Perdida'), s: 100, op: -10 }];
  const r = scoreCandidates([...previa, ...positivas(12)],
    { nTarget: 12, minimo: 0, perdidaOp: 'excluir' }, '', [{ name: 'Previa En Perdida' }]);

  assert.deepEqual(r.continuidadEnPerdida, ['Previa En Perdida']);
  assert.strictEqual(r.seleccionadas.find((c) => c.id === 'P0'), undefined, 'sigue excluida');
});

test('la reserva lleva motivo escrito, para poder identificarla en el libro de soporte', () => {
  /* Sin motivo, la columna «Motivo de rechazo» de la hoja «Selección comparables» queda vacía y
     esas compañías solo se localizan combinando dos filtros. Al cotejar a mano el informe de End
     Game contra el Excel, la Tabla 16 declaraba 1.389 diferencias funcionales y por motivo solo
     se podían encontrar 1.304: 85 sin etiqueta. */
  const candidatas = Array.from({ length: 10 }, (_, i) => ({
    id: 'C' + i, name: 'Comp ' + i, nameKey: nameKey('Comp ' + i), s: 100, op: 10,
  }));
  const r = scoreCandidates(candidatas, { nTarget: 4, minimo: 0 }, '', []);

  assert.strictEqual(r.reserva.length, 6);
  r.reserva.forEach((c) => {
    assert.strictEqual(c.motivoClave, 'actividadDistinta',
      'la clave con la que el informe y el Excel agrupan las diferencias funcionales');
    assert.strictEqual(c.categoriaRechazo, 'rigor');
    /* La frase dice el hecho real: la curación NO las descartó por su actividad, y escribir lo
       contrario dejaría el libro contradiciendo su propia columna de perfil funcional. */
    assert.match(c.motivoRechazo, /no integra la muestra/);
    assert.ok(!/curaci[óo]n/i.test(c.motivoRechazo), 'no se le atribuye un dictamen que no hubo');
  });
});

test('la reserva con motivo NO se cuenta dos veces en el embudo', () => {
  /* El informe suma la reserva aparte (`filasRazonesRechazo`). Si además entrara en el conteo por
     motivo, la fila de diferencias funcionales pasaría de 1.389 a 1.474 y la tabla dejaría de
     sumar el universo. Lo que lleva el motivo es la ficha de cada compañía —lo que lee el
     Excel—, no los contadores. */
  const candidatas = Array.from({ length: 10 }, (_, i) => ({
    id: 'C' + i, name: 'Comp ' + i, nameKey: nameKey('Comp ' + i), s: 100, op: 10,
  }));
  const r = scoreCandidates(candidatas, { nTarget: 4, minimo: 0 }, '', []);

  assert.strictEqual(r.rechazadas.length, 0, 'ninguna fue rechazada de verdad');
  assert.strictEqual(r.rechazadasPorMotivo.actividadDistinta, 0,
    'la reserva no engorda el conteo de rechazos por actividad');
  assert.strictEqual(r.reserva.length, 6, 'y sigue estando toda en la reserva');
  r.reserva.forEach((c) => assert.ok(!c.descartada, 'no se marcan como descartadas'));
  assert.strictEqual(r.seleccionadas.length + r.reserva.length + r.rechazadas.length,
    r.evaluadas, 'el embudo sigue sumando el universo evaluado');
});

test('el universo enriquecido publica el motivo de las de reserva', () => {
  /* Es la columna que el auditor filtra en la hoja «Selección comparables». */
  const candidatas = Array.from({ length: 5 }, (_, i) => ({
    id: 'C' + i, name: 'Comp ' + i, nameKey: nameKey('Comp ' + i), s: 100, op: 10,
  }));
  const r = scoreCandidates(candidatas, { nTarget: 2, minimo: 0 }, '', []);
  const enriquecido = enriquecerUniverso(candidatas, r.seleccionadas,
    { rechazadas: r.rechazadas, reserva: r.reserva });

  const fuera = enriquecido.filter((c) => !c.seleccionada);
  assert.strictEqual(fuera.length, 3);
  fuera.forEach((c) => {
    assert.strictEqual(c.motivoClave, 'actividadDistinta',
      'la celda del motivo ya no queda vacía');
    assert.ok(c.motivoRechazo, 'y trae la frase que la explica');
  });
});

test('un estudio guardado sin motivo en la reserva también sale etiquetado', () => {
  /* El caso de End Game 2025: el motor se corrió antes de este cambio, así que su auditoría trae
     la reserva sin motivo. El libro de soporte se genera al descargarlo, de modo que etiquetar
     aquí permite auditar un informe ya radicado sin reejecutar el motor. */
  const candidatas = Array.from({ length: 4 }, (_, i) => ({
    id: 'C' + i, name: 'Comp ' + i, nameKey: nameKey('Comp ' + i), s: 100, op: 10,
  }));
  const muestra = [candidatas[0]];
  /* Auditoría «vieja»: la reserva son fichas peladas, sin motivoClave. */
  const auditoriaVieja = {
    rechazadas: [],
    reserva: candidatas.slice(1).map((c) => ({ id: c.id, name: c.name, nameKey: c.nameKey })),
  };

  const enriquecido = enriquecerUniverso(candidatas, muestra, auditoriaVieja);
  const fuera = enriquecido.filter((c) => !c.seleccionada);

  assert.strictEqual(fuera.length, 3);
  fuera.forEach((c) => {
    assert.strictEqual(c.motivoClave, 'actividadDistinta');
    assert.match(c.motivoRechazo, /no integra la muestra/);
  });
  /* Y la de la muestra sigue sin motivo: es comparable, no rechazada. */
  const dentro = enriquecido.filter((c) => c.seleccionada);
  assert.strictEqual(dentro.length, 1);
  assert.strictEqual(dentro[0].motivoClave, '');
});

test('una comparable no aparece a la vez en la muestra y en la reserva', () => {
  /* La reserva se corta en el cupo restante y no en nTarget: cortando en nTarget, las
     que la continuidad desplazó salían en las dos listas. */
  const candidatas = [
    { id: '1', name: 'Previa', nameKey: nameKey('Previa'), s: 100, op: 10 },
    { id: '2', name: 'Nueva Uno', nameKey: nameKey('Nueva Uno'), s: 100, op: 10 },
    { id: '3', name: 'Nueva Dos', nameKey: nameKey('Nueva Dos'), s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 2, minimo: 0 }, '', [{ name: 'Previa' }]);
  const enMuestra = new Set(r.seleccionadas.map(c => c.id));
  r.reserva.forEach(c => assert.ok(!enMuestra.has(c.id), c.name + ' está en la muestra y en la reserva'));
  assert.strictEqual(r.seleccionadas.length, 2);
  assert.strictEqual(r.reserva.length, 1);
});

test('nameKey ignora el sufijo de bolsa/ticker entre paréntesis de Capital IQ', () => {
  assert.strictEqual(nameKey('Akatsuki Inc. (TSE:3932)'), nameKey('AKATSUKI INC.'));
  assert.strictEqual(nameKey('COLOPL, Inc. (TSE:3668)'), nameKey('COLOPL, INC.'));
  assert.strictEqual(nameKey('QubicGames S.A. (WSE:QUB)'), nameKey('QUBICGAMES S.A.'));
});

test('los filtros sobre hechos excluyen a una candidata de continuidad', () => {
  /* Saldo negativo, pérdida y control accionario son hechos verificables en las
     cifras: no los redime que la comparable viniera del estudio anterior. */
  const priorComps = [{ name: 'Saldo Corp' }, { name: 'Controlada Corp' }, { name: 'Perdida Corp' }];
  const candidatas = [
    { id: 'S', name: 'Saldo Corp', nameKey: nameKey('Saldo Corp'), hasNegativeBalance: true },
    { id: 'C', name: 'Controlada Corp', nameKey: nameKey('Controlada Corp'), holderPct: 80 },
    { id: 'P', name: 'Perdida Corp', nameKey: nameKey('Perdida Corp'), hasLoss: true, op: -5 },
  ];
  const r = scoreCandidates(candidatas, {}, '', priorComps);
  assert.strictEqual(r.seleccionadas.length, 0, 'ninguna debe pasar pese a ser de continuidad');
  assert.strictEqual(r.rechazadas.length, 3);
});

test('el holding SÍ exime a una candidata de continuidad', () => {
  /* Cambio de criterio (2026-08-06): la condición de holding pasó de leerse del
     código SIC —la actividad tal como la codificó Capital IQ— a presumirse de la
     razón social. Una presunción por el nombre no puede retirar una comparable cuya
     inclusión ya se sustentó en el estudio anterior; el control accionario, que es
     un hecho y no una presunción, sí la retira (test de arriba). */
  const priorComps = [{ name: 'Alpha Group' }];
  const candidatas = [
    { id: 'G', name: 'Alpha Group', nameKey: nameKey('Alpha Group'), desc: 'software development services', s: 100, op: 10 },
    { id: 'G2', name: 'Beta Group', nameKey: nameKey('Beta Group'), desc: 'software development services', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 5 }, '', priorComps);
  assert.deepStrictEqual(r.seleccionadas.map(c => c.id), ['G'], 'solo la de continuidad sobrevive');
  assert.strictEqual(r.rechazadasPorMotivo.holding, 1, 'la que no es de continuidad sí cae');
});

test('el flag isHolding heredado ya no decide: manda la razón social', () => {
  /* Regresión del cambio de criterio: `isHolding` sigue viajando en la candidata para
     la hoja de trazabilidad, pero el filtro lee el nombre y la descripción. */
  const candidatas = [
    { id: 'A', name: 'Textiles del Norte', isHolding: true, desc: 'software development services', s: 100, op: 10 },
    { id: 'B', name: 'Beta Holdings', isHolding: false, desc: 'software development services', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 5 }, '', []);
  assert.deepStrictEqual(r.seleccionadas.map(c => c.id), ['A'], 'el flag no excluye');
  assert.strictEqual(r.rechazadasPorMotivo.holding, 1, 'el nombre sí excluye');
});

test('una empresa con múltiples términos (ej: holding group) cuenta exactamente UNA sola vez', () => {
  const candidatas = [
    { id: '1', name: 'Cocacola holding group SAS', desc: 'software development services', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 5 }, '', []);
  assert.strictEqual(r.rechazadasPorMotivo.holding, 1, 'cuenta exactamente 1 empresa descartada');
  assert.strictEqual(r.rechazadas.length, 1, 'solo hay 1 empresa en el listado de rechazadas');
  assert.strictEqual(r.evaluadas, 1, 'el universo evaluado es 1');
});

test('el control accionario se cuenta aparte del holding', () => {
  const candidatas = [
    { id: 'C', name: 'Controlada SA', holderPct: 75, desc: 'software development services', s: 100, op: 10 },
    { id: 'T', name: 'Texto SA', holdersText: 'Juan Pérez (62.5); Otro (3)', desc: 'software development services', s: 100, op: 10 },
    { id: 'H', name: 'Alpha Group', desc: 'software development services', s: 100, op: 10 },
    { id: 'L', name: 'Libre SA', holderPct: 20, desc: 'software development services', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 5 }, '', []);
  assert.strictEqual(r.rechazadasPorMotivo.controlada, 2, 'el % numérico y el texto cuentan igual');
  assert.strictEqual(r.rechazadasPorMotivo.holding, 1);
  assert.deepStrictEqual(r.seleccionadas.map(c => c.id), ['L']);
});

test('el umbral de control es configurable y se puede desactivar el filtro', () => {
  const candidatas = [
    { id: 'A', name: 'Alfa SA', holderPct: 40, desc: 'software development services', s: 100, op: 10 },
  ];
  assert.strictEqual(
    scoreCandidates(candidatas, { nTarget: 5, umbralControl: 30 }, '', []).rechazadasPorMotivo.controlada, 1);
  assert.strictEqual(
    scoreCandidates(candidatas, { nTarget: 5, control: 'incluir' }, '', []).rechazadasPorMotivo.controlada, 0);
});

/* ══════ Curación por IA: comportamiento completo migrado del monolito ══════ */

test('la curación solo evalúa candidatas con identificador y descripción', async () => {
  const { restore, llamadas } = mockGemini(() => true);
  try {
    const veredicto = await curateCandidatesWithGemini([
      { id: 'CON', name: 'Con datos', desc: 'software development services' },
      { id: '', name: 'Sin id', desc: 'algo' },
      { id: 'SINDESC', name: 'Sin descripción', desc: '' },
    ], 'desarrollo de software');
    assert.strictEqual(veredicto.total, 1, 'solo una es evaluable');
    assert.ok(veredicto.porId.CON, 'y es la que trae ambos datos');
    assert.strictEqual(veredicto.porId.SINDESC, undefined, 'la que no tiene descripción no se juzga');
    const enviado = llamadas[0].contents[0].parts[0].text;
    assert.ok(!enviado.includes('Sin id'), 'no se manda a la IA lo que no puede evaluar');
  } finally {
    restore();
  }
});

test('la curación se omite sin actividad detectada, sin descartar a nadie', async () => {
  const { restore, llamadas } = mockGemini(() => false);
  try {
    const veredicto = await curateCandidatesWithGemini(
      [{ id: 'A', name: 'A', desc: 'x' }], '   '
    );
    assert.strictEqual(llamadas.length, 0, 'no debe gastar ninguna consulta');
    assert.ok(veredicto.omitida, 'y debe decir por qué se omitió');
    assert.deepStrictEqual(veredicto.porId, {}, 'sin veredictos: nadie queda descartado por omisión');
  } finally {
    restore();
  }
});

test('la curación trocea el universo en lotes del tamaño configurado', async () => {
  const { restore, llamadas } = mockGemini(() => true);
  try {
    /* dos lotes completos y uno a medias, sea cual sea el tamaño de lote vigente */
    const cuantas = CURACION_LOTE * 2 + Math.ceil(CURACION_LOTE / 2);
    const candidatas = Array.from({ length: cuantas }, (_, i) => ({ id: 'C' + i, name: 'Comp ' + i, desc: 'software development services' }));
    const veredicto = await curateCandidatesWithGemini(candidatas, 'desarrollo de software');
    assert.strictEqual(llamadas.length, 3, `${cuantas} candidatas son 3 lotes con CURACION_LOTE=${CURACION_LOTE}`);
    assert.strictEqual(Object.keys(veredicto.porId).length, cuantas, 'y todas quedan con veredicto');
    assert.strictEqual(veredicto.evaluadas, cuantas);
    assert.strictEqual(veredicto.fallidas, 0);
  } finally {
    restore();
  }
});

test('un lote que falla todos sus intentos no descarta a sus candidatas', async () => {
  /* Un problema de red no puede traducirse en excluir comparables del estudio. */
  const { restore } = mockGemini(() => true, { fallar: ({ ids }) => ids.includes('C0') && 502 });
  try {
    const cuantas = CURACION_LOTE * 2;
    const candidatas = Array.from({ length: cuantas }, (_, i) => ({ id: 'C' + i, name: 'Comp ' + i, desc: 'software development services' }));
    const veredicto = await curateCandidatesWithGemini(candidatas, 'desarrollo de software', { pausaBaseMs: 0 });
    assert.strictEqual(veredicto.fallidas, CURACION_LOTE, 'el lote caído se cuenta como no evaluado');
    assert.strictEqual(veredicto.evaluadas, CURACION_LOTE, 'el otro sí se evaluó');
    /* las del lote caído no tienen veredicto, así que el motor no las descarta */
    const sinVeredicto = candidatas.filter(c => !veredicto.porId[c.id]);
    assert.strictEqual(sinVeredicto.length, CURACION_LOTE);
    const r = scoreCandidates(candidatas, { nTarget: 100 }, 'desarrollo de software', [], { iaMatch: veredicto });
    const descartadasPorIA = r.rechazadas.filter(c => /Curación IA/.test(c.motivoRechazo || ''));
    assert.strictEqual(descartadasPorIA.length, 0, 'ninguna se descarta por un fallo de la API');
  } finally {
    restore();
  }
});

test('un lote que falla con un error transitorio se reintenta y termina bien', async () => {
  /* El 502 del borde de Hosting llegaba a costar el lote entero: 60 candidatas sin
     curar por un corte de unos segundos. */
  const { restore, llamadas } = mockGemini(() => true, { fallar: ({ n }) => n === 1 && 502 });
  try {
    const candidatas = Array.from({ length: 3 }, (_, i) => ({ id: 'C' + i, name: 'Comp ' + i, desc: 'software development services' }));
    const veredicto = await curateCandidatesWithGemini(candidatas, 'desarrollo de software', { pausaBaseMs: 0 });
    assert.strictEqual(llamadas.length, 2, 'un solo lote, dos intentos');
    assert.strictEqual(veredicto.fallidas, 0, 'el reintento lo salvó');
    assert.strictEqual(veredicto.evaluadas, 3);
    assert.strictEqual(veredicto.errores.length, 0);
  } finally {
    restore();
  }
});

test('un fallo de red también se reintenta', async () => {
  const { restore, llamadas } = mockGemini(() => true, { fallar: ({ n }) => n === 1 });
  try {
    const veredicto = await curateCandidatesWithGemini(
      [{ id: 'A', name: 'A', desc: 'software development services' }],
      'desarrollo de software', { pausaBaseMs: 0 }
    );
    assert.strictEqual(llamadas.length, 2, 'una petición sin respuesta es transitoria, no definitiva');
    assert.strictEqual(veredicto.porId.A.coincide, true);
  } finally {
    restore();
  }
});

test('un 429 por tope de gasto agotado no se reintenta', async () => {
  /* El mismo código que un pico de tráfico, pero esperar unos segundos no levanta el
     tope: reintentarlo eran tres consultas perdidas por lote. */
  const { restore, llamadas } = mockGemini(() => true, {
    fallar: () => ({
      status: 429,
      mensaje: 'Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend',
    }),
  });
  try {
    const veredicto = await curateCandidatesWithGemini(
      [{ id: 'A', name: 'A', desc: 'software development services' }],
      'desarrollo de software', { pausaBaseMs: 0 }
    );
    assert.strictEqual(llamadas.length, 1, 'un solo intento contra el muro');
    assert.strictEqual(veredicto.errores.length, 1);
    assert.strictEqual(veredicto.errores[0].status, 429);
    assert.match(veredicto.errores[0].mensaje, /spending cap/,
      'se guarda el motivo real de Gemini, no el «Request failed with status code» de axios');
  } finally {
    restore();
  }
});

test('un 429 por saturación sí se reintenta', async () => {
  const { restore, llamadas } = mockGemini(() => true, {
    fallar: ({ n }) => n === 1 && { status: 429, mensaje: 'Resource has been exhausted (e.g. check quota).' },
  });
  try {
    const veredicto = await curateCandidatesWithGemini(
      [{ id: 'A', name: 'A', desc: 'software development services' }],
      'desarrollo de software', { pausaBaseMs: 0 }
    );
    assert.strictEqual(llamadas.length, 2, 'un 429 sin mención de tope de gasto es transitorio');
    assert.strictEqual(veredicto.porId.A.coincide, true);
  } finally {
    restore();
  }
});

test('un error de contrato no se reintenta y queda registrado con su código', async () => {
  /* Repetir un 400 solo gasta cuota: el prompt no va a mejorar por insistir. */
  const { restore, llamadas } = mockGemini(() => true, { fallar: () => 400 });
  try {
    const candidatas = Array.from({ length: 2 }, (_, i) => ({ id: 'C' + i, name: 'Comp ' + i, desc: 'software development services' }));
    const veredicto = await curateCandidatesWithGemini(candidatas, 'desarrollo de software', { pausaBaseMs: 0 });
    assert.strictEqual(llamadas.length, 1, 'un solo intento');
    assert.strictEqual(veredicto.fallidas, 2);
    assert.strictEqual(veredicto.errores.length, 1, 'el fallo queda registrado');
    assert.strictEqual(veredicto.errores[0].status, 400, 'con el código, para poder decirlo en pantalla');
    assert.strictEqual(veredicto.errores[0].candidatas, 2);
  } finally {
    restore();
  }
});

test('la curación informa el avance y una estimación de espera', async () => {
  const { restore } = mockGemini(() => true);
  try {
    const avisos = [];
    const candidatas = Array.from({ length: 70 }, (_, i) => ({ id: 'C' + i, name: 'C' + i, desc: 'software development services' }));
    await curateCandidatesWithGemini(candidatas, 'desarrollo de software', { onProgress: (i) => avisos.push(i) });
    const inicio = avisos.find(a => a.etapa === 'inicio');
    assert.ok(inicio, 'avisa al empezar');
    assert.ok(inicio.etaMinutos >= 1, 'con una estimación de minutos');
    assert.ok(inicio.mensaje.includes('No cierre la pestaña'));
    assert.ok(avisos.some(a => a.etapa === 'lote'), 'informa por lote');
    const fin = avisos.find(a => a.etapa === 'fin');
    assert.ok(fin && fin.coinciden === 70, 'y cierra con el total que coincide');
  } finally {
    restore();
  }
});

test('la curación aguanta que el modelo envuelva el JSON en prosa', async () => {
  const { restore } = mockGemini(() => true, {
    envolver: (s) => 'Claro, aquí va el análisis:\n```json\n' + s + '\n```\nEspero que sea útil.',
  });
  try {
    const veredicto = await curateCandidatesWithGemini(
      [{ id: 'A', name: 'A', desc: 'software development services' }], 'desarrollo de software'
    );
    assert.strictEqual(veredicto.porId.A.coincide, true, 'antes esto perdía el lote entero');
  } finally {
    restore();
  }
});

test('el veredicto de la IA sube el factor de especialidad al máximo', async () => {
  const { restore } = mockGemini(() => true);
  try {
    const cand = { id: 'A', name: 'Ajena SA', nameKey: nameKey('Ajena SA'), desc: 'iron ore mining', s: 1000, op: 100 };
    const veredicto = await curateCandidatesWithGemini([cand], 'desarrollo de software');
    const sinIA = scoreCandidates([cand], { nTarget: 1 }, 'desarrollo de software', [], {});
    const conIA = scoreCandidates([cand], { nTarget: 1 }, 'desarrollo de software', [], { iaMatch: veredicto });
    assert.strictEqual(sinIA.seleccionadas[0].factores.especialidad, 0.15, 'por palabras clave no coincide');
    assert.strictEqual(conIA.seleccionadas[0].factores.especialidad, 1, 'pero la IA leyó la descripción real y confirmó');
  } finally {
    restore();
  }
});

test('con curación hecha, una candidata sin descripción se descarta explicándolo', () => {
  const candidatas = [{ id: 'X', name: 'Sin desc SA', nameKey: nameKey('Sin desc SA'), desc: '', s: 100, op: 10 }];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, 'desarrollo de software', [],
    { iaMatch: { porId: { OTRO: { coincide: true } } } });
  assert.strictEqual(r.rechazadas.length, 1);
  assert.match(r.rechazadas[0].motivoRechazo, /Sin descripción del negocio/);
  assert.match(r.rechazadas[0].motivoRechazo, /ID X/, 'dice de qué identificador se trata');
});

test('sin curación, una candidata sin descripción no se descarta', () => {
  /* Las agregadas a mano o de otras fuentes no tienen descripción y no deben
     quedar fuera por omisión. */
  const candidatas = [{ id: 'X', name: 'Sin desc SA', nameKey: nameKey('Sin desc SA'), desc: '', s: 100, op: 10 }];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, 'desarrollo de software', [], {});
  assert.strictEqual(r.rechazadas.length, 0);
  assert.strictEqual(r.seleccionadas.length, 1);
});

/* ══════ Lectura del archivo de Capital IQ ══════
   El importador asumía los encabezados en la fila 0. El export real trae el título
   del reporte ahí, la fila 1 vacía y los encabezados en la 2, de modo que todos los
   índices de columna quedaban en -1, el bucle saltaba las 2.990 filas y la función
   devolvía un array vacío SIN lanzar: en pantalla no aparecía ni error ni resultado. */

test('elegirHoja prefiere la hoja de cribado sobre la primera', () => {
  assert.strictEqual(elegirHoja(['Aggregates', 'Screening', 'Screen Criteria']), 'Screening');
  assert.strictEqual(elegirHoja(['Screening', 'Aggregates']), 'Screening');
  assert.strictEqual(elegirHoja(['Hoja1', 'Hoja2']), 'Hoja1', 'sin ninguna reconocible, la primera');
  assert.strictEqual(elegirHoja([]), '');
});

test('encontrarFilaEncabezados salta el título del reporte de Capital IQ', () => {
  const filas = [
    ['Capital IQ Company Screening Report > END GAME 2025', '', '', ''],
    ['', '', '', ''],
    ['Company Name', 'Excel Company ID', 'Total Revenue', 'Operating Income'],
    ['11 bit studios S.A.', 'IQ1', 39.2, 6.23]
  ];
  assert.strictEqual(encontrarFilaEncabezados(filas), 2);
});

test('encontrarFilaEncabezados acepta el caso simple de encabezados arriba', () => {
  assert.strictEqual(encontrarFilaEncabezados([['Company Name', 'Total Revenue'], ['ACME', 100]]), 0);
});

test('las columnas esenciales son las que hacen falta para el rango', () => {
  ['name', 's', 'op'].forEach(k => assert.strictEqual(COLUMNAS_IQ[k].esencial, true, k + ' debe ser esencial'));
  /* las de balance no lo son: el cribado no las trae y se cargan aparte */
  ['ar', 'inv', 'ap'].forEach(k => assert.strictEqual(COLUMNAS_IQ[k].esencial, false, k + ' no debe ser esencial'));
});

test('importCapitalIQExcel lee la columna de propiedad, planta y equipo', async () => {
  /* PP&E no estaba en COLUMNAS_IQ, así que aunque el export de Capital IQ la trajera
     se descartaba en silencio y el ajuste de PP&E se calculaba contra cero en toda la
     muestra. Se prueban dos encabezados: el de Capital IQ y uno en español. */
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Company Name', 'Total Revenue [FY 2025]', 'Operating Income [FY 2025]',
      'Net Property Plant And Equipment [FY 2025]'],
    ['ACME Services PLC', 1000, 100, 250.5],
  ]), 'Screening');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  await conFileReader(buf, async () => {
    const { rows, meta } = await importCapitalIQExcel({ name: 'ppe.xlsx', size: buf.length });
    assert.strictEqual(rows[0].ppe, 250.5);
    assert.ok(meta.reconocidas.some((r) => r.clave === 'ppe'), 'la reporta como columna reconocida');
  });

  const wbEs = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbEs, XLSX.utils.aoa_to_sheet([
    ['Compañía', 'Ventas', 'Utilidad operacional', 'Propiedad, planta y equipo'],
    ['Beta S.A.', 500, 40, 77],
  ]), 'Screening');
  const bufEs = XLSX.write(wbEs, { bookType: 'xlsx', type: 'buffer' });
  await conFileReader(bufEs, async () => {
    const { rows } = await importCapitalIQExcel({ name: 'ppe-es.xlsx', size: bufEs.length });
    assert.strictEqual(rows[0].ppe, 77);
  });
});

test('sin columna de PP&E la comparable la deja en null, no en cero', async () => {
  /* Cero significaría «la empresa no tiene activo fijo» y el ajuste lo tomaría como
     dato bueno; null dice que no se sabe. */
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Company Name', 'Total Revenue [FY 2025]', 'Operating Income [FY 2025]'],
    ['ACME Services PLC', 1000, 100],
  ]), 'Screening');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  await conFileReader(buf, async () => {
    const { rows } = await importCapitalIQExcel({ name: 'sin-ppe.xlsx', size: buf.length });
    assert.strictEqual(rows[0].ppe, null);
  });
});

test('importCapitalIQExcel explica el fallo en vez de devolver un array vacío', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['algo', 'otra cosa'], [1, 2]]), 'Hoja1');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  await conFileReader(buf, async () => {
    await assert.rejects(
      () => importCapitalIQExcel({ name: 'raro.xlsx', size: buf.length }),
      (err) => {
        assert.match(err.message, /No se encontró la columna de la compañía/);
        assert.match(err.message, /algo \| otra cosa/, 'incluye los encabezados leídos, para poder corregir el export');
        assert.ok(err.meta, 'y adjunta el diagnóstico para la interfaz');
        return true;
      }
    );
  });
});

test('importCapitalIQExcel lee un export con el título arriba, como el real', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['solo agregados']]), 'Aggregates');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Capital IQ Company Screening Report > PRUEBA', '', '', '', ''],
    ['', '', '', '', ''],
    ['Company Name', 'Excel Company ID', 'SIC Codes', 'Total Revenue [FY 2025]', 'Operating Income [FY 2025]'],
    ['ACME Services PLC', 'IQ111', '7372', 1000, 100],
    ['Beta Holdings Ltd', 'IQ222', '6719', 2000, 150],
    ['', '', '', '', ''],
    ['Total', '', '', 3000, 250]
  ]), 'Screening');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

  await conFileReader(buf, async () => {
    const etapas = [];
    const { rows, meta } = await importCapitalIQExcel(
      { name: 'prueba.xlsx', size: buf.length },
      (etapa, hechas, total) => etapas.push({ etapa, hechas, total })
    );

    assert.strictEqual(meta.hoja, 'Screening', 'elige la hoja de cribado y no Aggregates');
    assert.strictEqual(meta.filaEncabezados, 2, 'encuentra los encabezados en la tercera fila');
    assert.strictEqual(rows.length, 3, 'lee las compañías, incluida la fila "Total" que trae nombre');
    assert.strictEqual(rows[0].name, 'ACME Services PLC');
    assert.strictEqual(rows[0].s, 1000);
    assert.strictEqual(rows[0].op, 100);
    assert.strictEqual(rows[0].id, 'IQ111', 'conserva el identificador de la fuente');
    assert.strictEqual(rows[1].name, 'Beta Holdings Ltd');
    assert.strictEqual(rows[1].isHolding, true, 'Holdings en plural también debe reconocerse como holding');
    assert.strictEqual(meta.candidatas, rows.length);
    assert.ok(meta.saltadas >= 1, 'cuenta la fila vacía que omitió');
    assert.ok(meta.sinCuentasDeBalance, 'detecta que no vienen cartera, inventarios ni proveedores');
    assert.ok(!meta.faltantes.some(f => f.esencial), 'no falta ninguna columna esencial');
    assert.ok(etapas.length >= 2, 'informa varias etapas de progreso');
    assert.deepStrictEqual(meta.criteriosScreening, [], 'sin hoja "Screen Criteria" no hay criterios que leer');
  });
});

/* ══════ Criterios de búsqueda (hoja "Screen Criteria") ══════
   Alimentan la Tabla 13 del informe: quedan en `study.criteriosScreening` a la
   espera de que la ruta por campos con nombre los publique. */

test('parsearCriteriosScreening lee la hoja real, con el conector de cada línea', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Capital IQ Company Screening Report > PRUEBA'],
    [''],
    ['Screening Criteria'],
    ['1) All Available Holders - % Owned by Single Holder [Latest] (%): is less than 50'],
    ['2) Company Type: Public Company OR Private Company'],
    ['3) Company Status: Operating'],
    ['And) Business Description:  Keyword: games'],
    ['Or) SIC Codes: 7371 Computer Programming Services OR 7372 Prepackaged Software'],
    ['4) Total Revenue [FY 2025] ($USDmm, Historical rate): is greater than 0 (Unreported data set to 0)'],
  ]), 'Screen Criteria');

  const criterios = parsearCriteriosScreening(wb);
  assert.strictEqual(criterios.length, 6);
  assert.strictEqual(criterios[0].conector, null, 'el primer criterio no lleva conector');
  assert.strictEqual(criterios[0].etiqueta, 'All Available Holders - % Owned by Single Holder [Latest] (%)');
  assert.strictEqual(criterios[0].valor, 'is less than 50');
  assert.strictEqual(criterios[1].conector, 'Y', 'un criterio numerado se combina con Y por defecto');
  assert.strictEqual(criterios[3].conector, 'Y', '"And)" se traduce a Y');
  assert.strictEqual(criterios[3].etiqueta, 'Business Description');
  assert.strictEqual(criterios[3].valor, 'Keyword: games', 'solo corta en los primeros dos puntos');
  assert.strictEqual(criterios[4].conector, 'O', '"Or)" se traduce a O');
  assert.strictEqual(criterios[4].etiqueta, 'SIC Codes');
});

test('parsearCriteriosScreening no revienta sin la hoja "Screen Criteria"', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['nada aquí']]), 'Screening');
  assert.deepStrictEqual(parsearCriteriosScreening(wb), []);
});

test('parsearCriteriosScreening descarta líneas sin etiqueta o sin valor', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['1) Sin dos puntos no es un criterio'],
    ['2) Etiqueta sin valor:'],
    ['3) Company Status: Operating'],
  ]), 'Screen Criteria');
  const criterios = parsearCriteriosScreening(wb);
  assert.strictEqual(criterios.length, 1);
  assert.strictEqual(criterios[0].etiqueta, 'Company Status');
});

/* ══════ Recargar solo los criterios de búsqueda, sin tocar comparables ══════
   Para cuando a un estudio ya curado con IA le falta la hoja "Screen Criteria": subir el
   Excel completo por `importCapitalIQExcel` reiniciaría `iaMatch`/`selectionFunnel`/
   `motorAuditoria`, borrando el trabajo de curación ya hecho. Esta función solo lee esa
   hoja y no toca nada de comparables. */

test('leerCriteriosScreeningDeArchivo lee los criterios de un archivo real, sin pasar por el universo de comparables', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Capital IQ Company Screening Report > PRUEBA'],
    [''],
    ['Screening Criteria'],
    ['1) Company Status: Operating'],
    ['2) SIC Codes: 7371 Computer Programming Services'],
  ]), 'Screen Criteria');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

  await conFileReader(buf, async () => {
    const criterios = await leerCriteriosScreeningDeArchivo({ name: 'iq.xlsx', size: buf.length });
    assert.strictEqual(criterios.length, 2);
    assert.strictEqual(criterios[0].etiqueta, 'Company Status');
    assert.strictEqual(criterios[1].etiqueta, 'SIC Codes');
  });
});

test('leerCriteriosScreeningDeArchivo devuelve arreglo vacío si el archivo no trae la hoja "Screen Criteria"', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['nada aquí']]), 'Screening');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

  await conFileReader(buf, async () => {
    const criterios = await leerCriteriosScreeningDeArchivo({ name: 'sin-criterios.xlsx', size: buf.length });
    assert.deepStrictEqual(criterios, []);
  });
});

/* ── el archivo real del cliente, si está en el repo ── */
const RUTA_REAL = path.resolve(
  AQUI, '../../../Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/END GAME 2025.xls'
);

test('importCapitalIQExcel lee el export real de Capital IQ', { skip: !fs.existsSync(RUTA_REAL) }, async () => {
  const buf = fs.readFileSync(RUTA_REAL);
  await conFileReader(buf, async () => {
    const { rows, meta } = await importCapitalIQExcel({ name: 'END GAME 2025.xls', size: buf.length });
    assert.strictEqual(meta.hoja, 'Screening');
    assert.strictEqual(meta.filaEncabezados, 2, 'los encabezados están en la fila 3 del Excel');
    assert.ok(rows.length > 2900, 'lee las ~2.987 compañías y no cero; obtenidas: ' + rows.length);
    const claves = meta.reconocidas.map(r => r.clave);
    ['name', 's', 'c', 'op', 'sic', 'id', 'desc', 'country'].forEach(k => {
      assert.ok(claves.includes(k), 'reconoce la columna ' + k);
    });
    assert.strictEqual(typeof rows[0].s, 'number', 'los ingresos llegan como número');

    assert.strictEqual(meta.criteriosScreening.length, 7, 'lee los 7 criterios de la hoja "Screen Criteria" real');
    assert.strictEqual(meta.criteriosScreening[0].conector, null);
    assert.ok(meta.criteriosScreening.some(c => c.etiqueta === 'SIC Codes' && c.conector === 'O'),
      'el criterio de SIC Codes real va con conector O ("Or)")');
  });
});

/* ══════ Los cinco factores de la puntuación ══════
   Antes la puntuación era 0,5 + bono de continuidad + 0,1 si el país era LATAM, de
   modo que con miles de candidatas casi todas empataban y quedarse con las
   primeras nTarget equivalía a tomar las primeras del archivo. */

test('regionDe reconoce las cinco regiones, no solo LATAM', () => {
  assert.strictEqual(regionDe('Colombia'), 'LATAM');
  assert.strictEqual(regionDe('Japan'), 'ASIA');
  assert.strictEqual(regionDe('Poland'), 'EUROPA');
  assert.strictEqual(regionDe('United States'), 'NORTEAM');
  assert.strictEqual(regionDe('Nigeria'), 'OTRA');
  assert.strictEqual(regionDe(''), 'OTRA');
});

test('perfilDe clasifica por la descripción del negocio, no por la utilidad', () => {
  assert.strictEqual(perfilDe('Provides custom software development services for clients'), 'SERVICIO');
  assert.strictEqual(perfilDe('Publishes its own free-to-play games and monetizes them'), 'EMPRESARIO');
  assert.strictEqual(perfilDe('Offers IT services and also publishes its own titles'), 'MIXTO');
  assert.strictEqual(perfilDe('Manufactures industrial valves'), 'INDEFINIDO');
  assert.strictEqual(perfilDe(''), 'INDEFINIDO');
});

test('tokensSignificativos deja fuera las palabras vacías y las cortas', () => {
  const t = tokensSignificativos('Desarrollo de software para la industria del videojuego');
  assert.ok(t.includes('desarrollo') && t.includes('software') && t.includes('videojuego'));
  assert.ok(!t.includes('de') && !t.includes('la') && !t.includes('del'));
  assert.deepStrictEqual(tokensSignificativos('casa casa casa'), ['casa'], 'sin repetir');
});

test('coincidenciaActividad puntúa según cuántas palabras del perfil aparecen', () => {
  const actividad = 'desarrollo de software interactivo y diseño digital';
  const buena = coincidenciaActividad({ name: 'X', desc: 'software development and digital design studio, interactivo', sic: '7372' }, actividad);
  const mala = coincidenciaActividad({ name: 'Y', desc: 'mining of iron ore', sic: '1011' }, actividad);
  assert.ok(buena.factor > mala.factor, 'la del sector debe puntuar más alto');
  assert.strictEqual(mala.factor, 0.15, 'la que no coincide baja al piso, no a cero');
  assert.strictEqual(buena.hayActividad, true);
  const sinActividad = coincidenciaActividad({ name: 'Z', desc: 'algo' }, '');
  assert.strictEqual(sinActividad.factor, 1, 'sin actividad detectada el factor es neutro');
  assert.strictEqual(sinActividad.hayActividad, false);
  const porIA = coincidenciaActividad({ name: 'W', desc: '', iaCoincide: true }, actividad);
  assert.strictEqual(porIA.factor, 1, 'si la IA ya confirmó la coincidencia, factor máximo');
});

test('scoreCandidates ordena por mérito y no deja a todas empatadas', () => {
  const actividad = 'desarrollo de software interactivo';
  const candidatas = [
    { id: 'A', name: 'Alfa Mining', desc: 'iron ore mining', country: 'Nigeria', s: 1000, op: 100 },
    /* coincide en las tres palabras del perfil: desarrollo, software e interactivo */
    { id: 'B', name: 'Beta Software', desc: 'desarrollo de software interactivo a la medida para terceros', country: 'Colombia', s: 1000, op: 100 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 2, geo: 'LATAM' }, actividad, [], { ventasParteExaminada: 1000 });
  assert.strictEqual(r.seleccionadas[0].id, 'B', 'la que coincide con la actividad y la región va primero');
  assert.ok(r.seleccionadas[0].score > r.seleccionadas[1].score, 'los puntajes deben diferir');
  assert.ok(r.seleccionadas[0].razones.includes('coincide con la actividad'), 'explica por qué: ' + r.seleccionadas[0].razones);
  assert.ok(r.seleccionadas[0].razones.includes('región prioritaria'), 'y menciona la región');
  /* una sola palabra coincidente se reporta como parcial, no como coincidencia */
  const parcial = scoreCandidates(
    [{ id: 'C', name: 'Gamma', desc: 'custom software development services', s: 1000, op: 100 }],
    { nTarget: 1 }, actividad, [], {}
  );
  assert.ok(parcial.seleccionadas[0].razones.includes('coincidencia parcial'), 'con un solo acierto, parcial');
});

test('scoreCandidates: el factor de tamaño premia la cercanía a la parte examinada', () => {
  const candidatas = [
    { id: 'CERCA', name: 'Cerca', desc: '', country: '', s: 1100, op: 110 },
    { id: 'LEJOS', name: 'Lejos', desc: '', country: '', s: 11000000, op: 1100000 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 2 }, '', [], { ventasParteExaminada: 1000 });
  assert.strictEqual(r.seleccionadas[0].id, 'CERCA', 'la de tamaño próximo debe ir primero');
  assert.ok(r.seleccionadas[0].factores.tamano > r.seleccionadas[1].factores.tamano);
});

test('scoreCandidates: sin ventas de la parte examinada el tamaño queda neutro y se avisa', () => {
  const r = scoreCandidates([{ id: 'A', name: 'A', s: 500, op: 50 }], { nTarget: 1 }, '', [], {});
  assert.strictEqual(r.ventasParteExaminada, null);
  assert.strictEqual(r.seleccionadas[0].factores.tamano, 0.5, 'neutro, no cero: no se penaliza por un dato que falta');
});

test('scoreCandidates: la especialidad pesa 40 % con actividad y 15 % sin ella', () => {
  const candidata = { id: 'A', name: 'Beta Software', desc: 'custom software development services', country: '', s: 1000, op: 100 };
  const con = scoreCandidates([candidata], { nTarget: 1 }, 'desarrollo de software', [], {});
  const sin = scoreCandidates([candidata], { nTarget: 1 }, '', [], {});
  assert.strictEqual(con.conActividad, true);
  assert.strictEqual(sin.conActividad, false);
  /* el mismo candidato puntúa distinto según el reparto de pesos */
  assert.notStrictEqual(con.seleccionadas[0].score, sin.seleccionadas[0].score);
});

test('scoreCandidates devuelve reserva para poder reponer lo que la IA descarte', () => {
  const candidatas = Array.from({ length: 10 }, (_, i) => ({ id: 'C' + i, name: 'Comp ' + i, desc: '', s: 1000, op: 100 }));
  const r = scoreCandidates(candidatas, { nTarget: 3, minimo: 0 }, '', [], {});
  assert.strictEqual(r.seleccionadas.length, 3);
  assert.strictEqual(r.reserva.length, 7, 'las válidas que no entraron al TOP-N quedan disponibles');
});

test('scoreCandidates: los descartes por filtro siguen operando', () => {
  const candidatas = [
    { id: 'H', name: 'Holding SA', isHolding: true, s: 100, op: 10 },
    { id: 'N', name: 'Negativa SA', hasNegativeBalance: true, s: 100, op: 10 },
    { id: 'P', name: 'Perdida SA', hasLoss: true, s: 100, op: -10 },
    { id: 'OK', name: 'Buena SA', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, '', [], {});
  assert.strictEqual(r.seleccionadas.length, 1);
  assert.strictEqual(r.seleccionadas[0].id, 'OK');
  assert.strictEqual(r.rechazadas.length, 3);
  r.rechazadas.forEach(c => assert.ok(c.motivoRechazo, 'cada descarte debe traer motivo: ' + c.id));
});

/* ══════ Rigor funcional y perfil dictaminado por la IA ══════
   El paso 2 ofrecía «Rigor Funcional» y el motor no lo leía: elegir «Estricto» daba
   el mismo resultado que «Amplio». Y el perfil se calculaba solo con las regex de
   perfilDe, que contradecían a la curación: una candidata que la IA aprobaba por
   actividad caía a factor 0,35 de perfil y salía del TOP-N por puntaje. */

test('prefiltrar aplica los filtros duros y deja pasar el resto, sin tocar el rigor', () => {
  const candidatas = [
    { id: 'H', name: 'Holding SA', isHolding: true },
    { id: 'N', name: 'Negativa SA', hasNegativeBalance: true },
    { id: 'P', name: 'Perdida SA', hasLoss: true },
    { id: 'E', name: 'Empresario SA', desc: 'publishes its own games' },
    { id: 'OK', name: 'Buena SA', desc: 'software development services' },
  ];
  const { validas, rechazadas } = prefiltrar(candidatas, { rigor: 'estricto' });
  assert.deepStrictEqual(validas.map(c => c.id), ['E', 'OK'],
    'el rigor no se evalúa aquí: depende del perfil, que lo dictamina la curación');
  assert.strictEqual(rechazadas.length, 3);
});

test('prefiltrar respeta los filtros puestos en «incluir»', () => {
  const candidatas = [{ id: 'P', name: 'Perdida SA', hasLoss: true }];
  assert.strictEqual(prefiltrar(candidatas, { perdidaOp: 'incluir' }).validas.length, 1);
  assert.strictEqual(prefiltrar(candidatas, {}).validas.length, 0, 'excluir es el criterio por defecto');
});

test('el perfil funcional ya no descarta por sí solo, con ningún nivel de rigor', () => {
  /* El filtro de rigor se retiró (decisión del usuario, 2026-08-10): el informe pasó
     a reportar bajo un solo concepto —diferencias funcionales— todo lo que supera los
     filtros objetivos y no integra la muestra, así que apartar antes a unas cuantas
     por su perfil no aportaba nada y le quitaba candidatas al puntaje. */
  const candidatas = [
    { id: 'S', name: 'Servicio SA', desc: 'software development services', s: 100, op: 10 },
    { id: 'M', name: 'Mixta SA', desc: 'software development services and publishes its own games', s: 100, op: 10 },
    { id: 'E', name: 'Empresario SA', desc: 'publishes its own titles and monetizes them', s: 100, op: 10 },
  ];
  ['estricto', 'estandar', 'amplio'].forEach((rigor) => {
    const r = scoreCandidates(candidatas, { nTarget: 10, rigor }, '', [], {});
    assert.deepStrictEqual(r.seleccionadas.map(c => c.id).sort(), ['E', 'M', 'S'], `con rigor ${rigor}`);
    assert.strictEqual(r.rechazadasPorCategoria.rigor, 0, `con rigor ${rigor}`);
  });
});

test('el perfil se sigue calculando y publicando, aunque no descarte', () => {
  /* Ordena el puntaje y va a la columna «Perfil funcional» de la hoja: lo que se
     retiró es su capacidad de excluir, no el dato. */
  const candidatas = [
    { id: 'S', name: 'Servicio SA', desc: 'software development services', s: 100, op: 10 },
    { id: 'E', name: 'Empresario SA', desc: 'publishes its own titles and monetizes them', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 10, rigor: 'estandar' }, '', [], {});
  const perfiles = Object.fromEntries(r.seleccionadas.map(c => [c.id, c.perfilFuncional]));
  assert.strictEqual(perfiles.S, 'SERVICIO');
  assert.strictEqual(perfiles.E, 'EMPRESARIO');
  /* Y el de servicios puntúa por encima del empresario pleno. */
  assert.strictEqual(r.seleccionadas[0].id, 'S', 'el perfil sigue pesando en el orden');
});

test('el perfil INDEFINIDO nunca se descarta por rigor', () => {
  /* Es ausencia de información, no un perfil incompatible: así llegan las candidatas
     agregadas a mano o venidas de otra fuente. */
  const candidatas = [{ id: 'X', name: 'Sin pistas SA', desc: 'iron ore mining', s: 100, op: 10 }];
  const r = scoreCandidates(candidatas, { nTarget: 10, rigor: 'estricto' }, '', [], {});
  assert.strictEqual(r.seleccionadas[0].perfilFuncional, 'INDEFINIDO');
  assert.strictEqual(r.rechazadasPorCategoria.rigor, 0);
});

test('una comparable de continuidad no se descarta por el rigor funcional', () => {
  const candidatas = [
    { id: 'E', name: 'Empresario SA', nameKey: nameKey('Empresario SA'), desc: 'publishes its own titles', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 10, rigor: 'estricto' }, '', [{ name: 'Empresario SA' }], {});
  assert.strictEqual(r.seleccionadas.length, 1, 'su inclusión ya se sustentó en el estudio anterior');
  assert.strictEqual(r.rechazadasPorCategoria.rigor, 0);
});

test('el perfil dictaminado por la IA manda sobre las palabras clave', async () => {
  /* La descripción no trae ninguna señal funcional, así que la heurística la deja en
     INDEFINIDO (factor 0,35) aunque la IA la hubiera aprobado. Ahora el dictamen de
     la IA fija el perfil y el factor.

     La descripción de este caso era «contract manufacturing … for third parties»,
     que la heurística en inglés del nicho de software tampoco reconocía; la
     bilingüe sí la clasifica como SERVICIO, así que el caso dejó de probar lo que
     quería probar y se cambió por una que ninguna de las dos resuelve. */
  const { restore } = mockGemini(() => true, { perfil: () => 'SERVICIO' });
  try {
    const cand = { id: 'A', name: 'Minera SA', desc: 'iron ore mining and steel plate rolling', s: 1000, op: 100 };
    assert.strictEqual(perfilDe(cand.desc), 'INDEFINIDO', 'la heurística no saca perfil de esta descripción');
    const veredicto = await curateCandidatesWithGemini([cand], 'extracción de mineral de hierro');
    assert.strictEqual(veredicto.porId.A.perfil, 'SERVICIO', 'la IA dictaminó el perfil');

    const r = scoreCandidates([cand], { nTarget: 1, rigor: 'estricto' }, 'extracción de mineral de hierro', [], { iaMatch: veredicto });
    assert.strictEqual(r.seleccionadas.length, 1, 'con el perfil de la IA sobrevive al rigor estricto');
    assert.strictEqual(r.seleccionadas[0].perfilFuncional, 'SERVICIO');
    assert.strictEqual(r.seleccionadas[0].perfilOrigen, 'ia');
    assert.strictEqual(r.seleccionadas[0].factores.perfil, 1, 'y con el factor máximo, no con 0,35');
  } finally {
    restore();
  }
});

test('un perfil que la IA no logra decidir cae en la heurística', async () => {
  const { restore } = mockGemini(() => true, { perfil: () => 'INDEFINIDO' });
  try {
    const cand = { id: 'A', name: 'Servicios SA', desc: 'software development services', s: 1000, op: 100 };
    const veredicto = await curateCandidatesWithGemini([cand], 'desarrollo de software');
    const r = scoreCandidates([cand], { nTarget: 1 }, 'desarrollo de software', [], { iaMatch: veredicto });
    assert.strictEqual(r.seleccionadas[0].perfilFuncional, 'SERVICIO', 'lo resuelve perfilDe');
    assert.strictEqual(r.seleccionadas[0].perfilOrigen, 'heuristica');
  } finally {
    restore();
  }
});

test('un perfil inventado por la IA se ignora en lugar de provocar un descarte', async () => {
  const { restore } = mockGemini(() => true, { perfil: () => 'ALGO RARO' });
  try {
    const cand = { id: 'A', name: 'Servicios SA', desc: 'software development services', s: 1000, op: 100 };
    const veredicto = await curateCandidatesWithGemini([cand], 'desarrollo de software');
    assert.strictEqual(veredicto.porId.A.perfil, '', 'no se guarda un perfil fuera de la lista');
    const r = scoreCandidates([cand], { nTarget: 1, rigor: 'estricto' }, 'desarrollo de software', [], { iaMatch: veredicto });
    assert.strictEqual(r.seleccionadas.length, 1);
    assert.strictEqual(r.seleccionadas[0].perfilOrigen, 'heuristica');
  } finally {
    restore();
  }
});

test('el desglose por motivo cuenta cada criterio por separado', () => {
  /* La tabla 16 del informe no puede decir «descartadas por los filtros»: tiene que
     decir cuántas por holding, cuántas por pérdidas y cuántas por actividad. */
  const candidatas = [
    { id: 'H1', name: 'Holding Uno', isHolding: true },
    { id: 'H2', name: 'Holding Dos', isHolding: true },
    { id: 'N1', name: 'Negativa', hasNegativeBalance: true },
    { id: 'P1', name: 'Perdida', hasLoss: true, op: -5 },
    { id: 'E1', name: 'Empresario', desc: 'publishes its own titles', s: 100, op: 10 },
    { id: 'R1', name: 'Otra actividad', desc: 'iron ore mining', s: 100, op: 10 },
    { id: 'S1', name: 'Sin desc', desc: '', s: 100, op: 10 },
    { id: 'OK', name: 'Buena', desc: 'software development services', s: 100, op: 10 },
  ];
  const veredicto = { porId: { R1: { coincide: false }, OK: { coincide: true }, E1: { coincide: true } } };
  const r = scoreCandidates(candidatas, { nTarget: 10, rigor: 'estandar' }, 'desarrollo de software', [], { iaMatch: veredicto });

  assert.deepStrictEqual(r.rechazadasPorMotivo, {
    holding: 2,
    controlada: 0,
    saldoNegativo: 1,
    perdidaOperativa: 1,
    sinDescripcion: 1,
    actividadDistinta: 1,
    /* El filtro de rigor se retiró: el perfil ya no descarta por sí solo, así que
       este contador se queda en cero. La clave se conserva porque la tabla de
       razones de rechazo del informe y los estudios ya guardados la esperan. */
    rigorFuncional: 0,
  });
});

test('el desglose por motivo suma lo mismo que las categorías', () => {
  const candidatas = [
    { id: 'H', name: 'Holding', isHolding: true },
    { id: 'R', name: 'Otra', desc: 'iron ore mining', s: 100, op: 10 },
    { id: 'E', name: 'Empresario', desc: 'publishes its own titles', s: 100, op: 10 },
    { id: 'OK', name: 'Buena', desc: 'software development services', s: 100, op: 10 },
  ];
  const veredicto = { porId: { R: { coincide: false }, OK: { coincide: true }, E: { coincide: true } } };
  const r = scoreCandidates(candidatas, { nTarget: 10, rigor: 'estandar' }, 'desarrollo de software', [], { iaMatch: veredicto });

  const porMotivo = Object.values(r.rechazadasPorMotivo).reduce((a, b) => a + b, 0);
  const porCategoria = Object.values(r.rechazadasPorCategoria).reduce((a, b) => a + b, 0);
  assert.strictEqual(porMotivo, porCategoria, 'los dos desgloses cuentan los mismos descartes');
  assert.strictEqual(porMotivo, r.rechazadas.length);
});

test('el holding se decide SOLO por la razón social, no por la descripción ni por el SIC', () => {
  /* La descripción menciona al grupo del que la empresa forma parte, que no es lo
     mismo que ser ella la sociedad de cartera. Descartarla por eso retiraba
     comparables operativas perfectamente válidas. */
  const candidatas = [
    { id: '1', name: 'Alpha Holdings Inc', desc: 'software development services', s: 100, op: 10 },
    { id: '2', name: 'Beta Services LLC', desc: 'Subsidiary of Global Holding Group', s: 100, op: 10 },
    { id: '3', name: 'Gamma Operating Corp', sic: '6719 Offices of Holding Companies', desc: 'software development services', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 5, holding: 'excluir' }, '', []);
  assert.strictEqual(r.rechazadasPorMotivo.holding, 1, 'solo Alpha Holdings, por su razón social');
  assert.ok(!('holdingDescripcion' in r.rechazadasPorMotivo), 'el motivo por descripción ya no existe');
  const rechazadas = r.rechazadas.map((c) => c.name);
  assert.ok(!rechazadas.includes('Beta Services LLC'), 'la mención en la descripción no descarta');
  assert.ok(!rechazadas.includes('Gamma Operating Corp'), 'el SIC 67xx no descarta');
});

test('el término de holding se busca contenido en el nombre y sin distinguir mayúsculas', () => {
  const candidatas = [
    { id: '1', name: 'GRUPOSURA', desc: 'software development services', s: 100, op: 10 },
    { id: '2', name: 'techgroupcorp', desc: 'software development services', s: 100, op: 10 },
    { id: '3', name: 'Gamma Operating Corp', desc: 'software development services', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 5, holding: 'excluir' }, '', []);
  assert.strictEqual(r.rechazadasPorMotivo.holding, 2);
});

test('la utilidad en negativo marca pérdida aunque la candidata no traiga hasLoss', () => {
  /* `hasLoss` solo lo pone la importación de Capital IQ; una candidata cargada a
     mano o corregida después llegaba sin él y pasaba el filtro con la utilidad en
     rojo. */
  const candidatas = [
    { id: '1', name: 'Roja SA', desc: 'software development services', s: 100, op: -20 },
    { id: '2', name: 'Verde SA', desc: 'software development services', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 5, perdidaOp: 'excluir' }, '', []);
  assert.strictEqual(r.rechazadasPorMotivo.perdidaOperativa, 1);
  assert.strictEqual(r.rechazadas[0].name, 'Roja SA');
});

test('la precedencia es controlada > holding > pérdida', () => {
  /* Una compañía puede cumplir los tres a la vez; el motivo que se escribe es el
     primero de la lista, y las tres casillas de la hoja se marcan por separado. */
  const lasTres = { id: '1', name: 'Mega Grupo Holding', holderPct: 80, op: -5, s: 100, desc: 'software development services' };
  const r = scoreCandidates([lasTres], { nTarget: 5 }, '', []);
  assert.strictEqual(r.rechazadas[0].motivoClave, 'controlada');

  const holdingYPerdida = { ...lasTres, holderPct: 10 };
  const r2 = scoreCandidates([holdingYPerdida], { nTarget: 5 }, '', []);
  assert.strictEqual(r2.rechazadas[0].motivoClave, 'holding');

  const soloPerdida = { ...lasTres, holderPct: 10, name: 'Operativa SA' };
  const r3 = scoreCandidates([soloPerdida], { nTarget: 5 }, '', []);
  assert.strictEqual(r3.rechazadas[0].motivoClave, 'perdidaOperativa');
});

test('las categorías de rechazo cubren cada descarte una sola vez', () => {
  /* El embudo deducía «rechazadas por la IA» con una expresión regular sobre el
     motivo y las «descartadas por los filtros» por resta, así que un descarte podía
     caer en las dos casillas. Ahora las tres categorías más las válidas suman el
     universo evaluado. */
  const candidatas = [
    { id: 'H', name: 'Holding SA', isHolding: true, desc: 'software development services' },
    { id: 'E', name: 'Empresario SA', desc: 'publishes its own titles', s: 100, op: 10 },
    { id: 'R', name: 'Rechazada IA', desc: 'iron ore mining', s: 100, op: 10 },
    { id: 'OK', name: 'Buena SA', desc: 'software development services', s: 100, op: 10 },
  ];
  const veredicto = { porId: { R: { coincide: false, motivo: 'otra actividad' }, OK: { coincide: true }, E: { coincide: true } } };
  const r = scoreCandidates(candidatas, { nTarget: 10, rigor: 'estandar' }, 'desarrollo de software', [], { iaMatch: veredicto });
  const cat = r.rechazadasPorCategoria;
  assert.deepStrictEqual(cat, { filtro: 1, ia: 1, rigor: 0 });
  assert.strictEqual(cat.filtro + cat.ia + cat.rigor + r.totalValidas, r.evaluadas,
    'nada se cuenta dos veces ni se pierde');
});

/* ══════ Reutilización del veredicto: la curación corre en el paso 3 ══════ */

test('la curación reutiliza el veredicto previo si la actividad no cambió', async () => {
  const { restore, llamadas } = mockGemini(() => true);
  try {
    const candidatas = [
      { id: 'A', name: 'A SA', desc: 'software development services' },
      { id: 'B', name: 'B SA', desc: 'software development services' },
    ];
    const primero = await curateCandidatesWithGemini(candidatas, 'desarrollo de software');
    assert.strictEqual(llamadas.length, 1);

    /* misma actividad y una candidata nueva: solo se consulta la que falta */
    const conNueva = [...candidatas, { id: 'C', name: 'C SA', desc: 'software development services' }];
    const segundo = await curateCandidatesWithGemini(conNueva, 'desarrollo de software', { veredictoPrevio: primero });
    assert.strictEqual(llamadas.length, 2, 'una sola consulta más');
    const enviado = llamadas[1].contents[0].parts[0].text;
    assert.ok(enviado.includes('"C"') && !enviado.includes('"A"'), 'y solo lleva la candidata sin veredicto');
    assert.strictEqual(segundo.reutilizadas, 2);
    assert.strictEqual(segundo.total, 3);
    assert.strictEqual(segundo.coinciden, 3, 'el conteo suma reutilizadas y nuevas');
  } finally {
    restore();
  }
});

test('sin candidatas nuevas la curación no gasta ninguna consulta', async () => {
  const { restore, llamadas } = mockGemini(() => true);
  try {
    const candidatas = [{ id: 'A', name: 'A SA', desc: 'software development services' }];
    const primero = await curateCandidatesWithGemini(candidatas, 'desarrollo de software');
    const segundo = await curateCandidatesWithGemini(candidatas, 'desarrollo de software', { veredictoPrevio: primero });
    assert.strictEqual(llamadas.length, 1, 'reejecutar el paso 3 tras cambiar un filtro no vuelve a pagar');
    assert.strictEqual(segundo.reutilizadas, 1);
    assert.strictEqual(segundo.coinciden, 1);
  } finally {
    restore();
  }
});

test('si la actividad cambió, el veredicto previo se descarta y se cura de nuevo', async () => {
  const { restore, llamadas } = mockGemini(() => true);
  try {
    const candidatas = [{ id: 'A', name: 'A SA', desc: 'software development services' }];
    const primero = await curateCandidatesWithGemini(candidatas, 'desarrollo de software');
    const segundo = await curateCandidatesWithGemini(candidatas, 'minería de carbón', { veredictoPrevio: primero });
    assert.strictEqual(llamadas.length, 2, 'el veredicto anterior se evaluó contra otra actividad');
    assert.strictEqual(segundo.reutilizadas, 0);
    assert.strictEqual(segundo.actividadUsada, 'minería de carbón');
  } finally {
    restore();
  }
});

test('el veredicto reutilizado no arrastra candidatas que ya no están en el universo', async () => {
  const { restore } = mockGemini(() => true);
  try {
    const primero = await curateCandidatesWithGemini(
      [{ id: 'A', name: 'A SA', desc: 'software development services' },
       { id: 'VIEJA', name: 'Vieja SA', desc: 'software development services' }],
      'desarrollo de software'
    );
    const segundo = await curateCandidatesWithGemini(
      [{ id: 'A', name: 'A SA', desc: 'software development services' }],
      'desarrollo de software', { veredictoPrevio: primero }
    );
    assert.deepStrictEqual(Object.keys(segundo.porId), ['A'],
      'el estudio no debe guardar dictámenes de candidatas fuera del universo actual');
  } finally {
    restore();
  }
});

/* ══════ extraerJSON: la curación se perdía por una frase de más ══════ */
test('extraerJSON aguanta prosa alrededor y vallas de markdown', () => {
  const esperado = { evaluacion: [{ id: 'A', coincide: true, motivo: 'ok' }] };
  assert.deepStrictEqual(extraerJSON('```json\n' + JSON.stringify(esperado) + '\n```'), esperado);
  assert.deepStrictEqual(extraerJSON('Claro, aquí tienes: ' + JSON.stringify(esperado) + ' Espero que sirva.'), esperado);
  assert.deepStrictEqual(extraerJSON(JSON.stringify({ a: '{ no es una llave }' })), { a: '{ no es una llave }' },
    'las llaves dentro de una cadena no cuentan');
  assert.throws(() => extraerJSON('sin json aquí'), /no contiene ningún objeto JSON/);
  assert.throws(() => extraerJSON('{"a": 1'), /incompleto/);
});

test('extraerJSON tolera una comilla doble sin escapar incrustada en un valor de texto', () => {
  const texto = '{"motivo": "el comparable usa "cloud computing" como línea de negocio"}';
  assert.deepStrictEqual(extraerJSON(texto), { motivo: 'el comparable usa "cloud computing" como línea de negocio' });
});

test('extraerJSON no confunde una coma de puntuación tras una frase citada con el fin de la cadena', () => {
  const texto = '{"motivo": "el sector vive un "boom", según el analista"}';
  assert.deepStrictEqual(extraerJSON(texto), { motivo: 'el sector vive un "boom", según el analista' });
});

/* ══════ num: los separadores de miles falseaban los márgenes ══════ */
test('num respeta los formatos numéricos que usan los analistas', () => {
  assert.strictEqual(num('2.761.202.249'), 2761202249, 'miles con punto; antes daba 2,761');
  assert.strictEqual(num('27.255.376'), 27255376);
  assert.strictEqual(num('1.234,56'), 1234.56, 'coma decimal');
  assert.strictEqual(num('1,234.56'), 1234.56, 'punto decimal');
  assert.strictEqual(num('(1.500)'), -1500, 'paréntesis es negativo; antes daba +1.500');
  assert.strictEqual(num('-1.500'), -1500);
  assert.strictEqual(num('$ 5.271.105.507'), 5271105507, 'con símbolo de moneda');
  assert.strictEqual(num('0,43'), 0.43, 'decimales pequeños, que son los que mueven el margen');
  assert.strictEqual(num(1234.56), 1234.56, 'un número pasa tal cual');
  assert.strictEqual(num(''), null);
  assert.strictEqual(num(null), null);
  assert.strictEqual(num('abc'), null);
});

/* ══════ enriquecerUniverso: el veredicto del motor pegado al universo crudo ══════ */

test('enriquecerUniverso pega motivo y perfil a cada candidata del universo', () => {
  const universo = [
    { name: 'Buena SA', nameKey: nameKey('Buena SA'), s: 100 },
    { name: 'Alpha Group', nameKey: nameKey('Alpha Group'), s: 200 },
    { name: 'Reserva SA', nameKey: nameKey('Reserva SA'), s: 300 },
  ];
  const comparables = [{ name: 'Buena SA', nameKey: nameKey('Buena SA'), perfilFuncional: 'SERVICIO' }];
  const auditoria = {
    rechazadas: [{ name: 'Alpha Group', nameKey: nameKey('Alpha Group'), motivoClave: 'holding', categoriaRechazo: 'filtro', motivoRechazo: 'Sociedad holding…', perfilFuncional: 'INDEFINIDO' }],
    reserva: [{ name: 'Reserva SA', nameKey: nameKey('Reserva SA'), perfilFuncional: 'MIXTO' }],
  };

  const r = enriquecerUniverso(universo, comparables, auditoria);
  assert.strictEqual(r.length, 3, 'no pierde ni añade filas');
  assert.strictEqual(r[0].seleccionada, true);
  assert.strictEqual(r[0].motivoClave, '', 'una seleccionada no tiene motivo de rechazo');
  assert.strictEqual(r[0].perfilFuncional, 'SERVICIO');
  assert.strictEqual(r[1].seleccionada, false);
  assert.strictEqual(r[1].motivoClave, 'holding');
  assert.strictEqual(r[1].categoriaRechazo, 'filtro');
  /* La reserva SÍ lleva motivo desde el 2026-08-20. Antes esta comprobación exigía lo contrario
     —«la reserva no está rechazada»—, porque durante la corrida es una suplente: si la curación
     descarta a una seleccionada, entra la primera de aquí. Pero cerrado el estudio esa condición
     se acaba, no se vuelven a considerar hasta que alguien recure o reejecute, y el informe las
     declara en «Diferencias funcionales». Sin motivo escrito no había forma de identificarlas en
     el libro de soporte: en End Game 2025 la tabla decía 1.389 y por motivo solo se localizaban
     1.304. Decisión del usuario, con el conteo intacto: el motivo va en la ficha, no en los
     contadores del embudo. */
  assert.strictEqual(r[2].motivoClave, 'actividadDistinta', 'la reserva queda identificable');
  assert.match(r[2].motivoRechazo, /no integra la muestra/);
  assert.strictEqual(r[2].perfilFuncional, 'MIXTO');
  assert.strictEqual(r[0].s, 100, 'conserva las cifras del universo crudo');
});

test('enriquecerUniverso degrada sin auditoría en vez de romper', () => {
  /* Al reabrir un estudio sin volver a correr el motor no hay auditoría: no se
     persiste, por la cuota de localStorage. */
  const universo = [{ name: 'Buena SA', nameKey: nameKey('Buena SA') }];
  const r = enriquecerUniverso(universo, [{ name: 'Buena SA', nameKey: nameKey('Buena SA') }], null);
  assert.strictEqual(r[0].seleccionada, true);
  assert.strictEqual(r[0].motivoClave, '');
  assert.deepStrictEqual(enriquecerUniverso([], [], null), []);
  assert.deepStrictEqual(enriquecerUniverso(null, [], null), []);
});

test('enriquecerUniverso cruza por nameKey pese al ticker de Capital IQ', () => {
  /* El universo trae «Akatsuki Inc. (TSE:3932)» y la muestra puede traer el nombre
     sin el sufijo de bolsa: nameKey los iguala. */
  const universo = [{ name: 'Akatsuki Inc. (TSE:3932)' }];
  const r = enriquecerUniverso(universo, [{ name: 'AKATSUKI INC.' }], null);
  assert.strictEqual(r[0].seleccionada, true);
});

/* ══════ Columna de accionistas: número o listado, decidido por el contenido ══════ */

test('un listado de accionistas no se aplana a una cifra falsa', async () => {
  /* Capital IQ junta accionistas y porcentaje bajo un solo encabezado
     («All Available Holders - % Owned by Single Holder»), que cae en las dos entradas
     de COLUMNAS_IQ. Si el listado se pasara por `num`, «Socio A (49); B (9)» daría
     499 y una compañía independiente quedaría excluida por control. */
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Company Name', 'Total Revenue', 'Operating Income',
     'All Available Holders - % Owned by Single Holder [Latest]'],
    ['Independiente SA', 1000, 100, 'Socio A (49); Socio B (9)'],
    ['Controlada SA', 1000, 100, 'Dueño Único (73.4); Menor (2)'],
    ['Sin dato SA', 1000, 100, ''],
  ]), 'Screening');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

  await conFileReader(buf, async () => {
    const { rows } = await importCapitalIQExcel({ name: 'holders.xlsx', size: buf.length });
    const [indep, ctrl, sin] = rows;

    assert.strictEqual(indep.maxpct, 49, 'el mayor accionista es 49, no 499');
    assert.strictEqual(indep.holdersText, 'Socio A (49); Socio B (9)', 'el dato original se conserva');
    assert.strictEqual(indep.holderPct, null, 'un listado no es una cifra');
    assert.strictEqual(ctrl.maxpct, 73.4, 'y no 73.42');
    assert.strictEqual(sin.maxpct, null);

    const r = scoreCandidates(rows, { nTarget: 5, umbralControl: 50 }, '', []);
    assert.strictEqual(r.rechazadasPorMotivo.controlada, 1, 'solo cae la que de verdad supera el umbral');
    assert.ok(r.seleccionadas.some(c => c.name === 'Independiente SA'), 'la del 49 % sobrevive');
  });
});

test('una columna de porcentaje puramente numérica se lee como cifra', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Company Name', 'Total Revenue', 'Operating Income', '% Owned by Single Holder'],
    ['Controlada SA', 1000, 100, 73.4],
    ['Libre SA', 1000, 100, 12.5],
  ]), 'Screening');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

  await conFileReader(buf, async () => {
    const { rows } = await importCapitalIQExcel({ name: 'pct.xlsx', size: buf.length });
    assert.strictEqual(rows[0].holderPct, 73.4);
    assert.strictEqual(rows[0].maxpct, 73.4);
    assert.strictEqual(rows[0].holdersText, '', 'una cifra no se guarda como listado');
    assert.strictEqual(rows[1].maxpct, 12.5);
  });
});

test('la importación marca la sospecha de holding por la razón social', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Company Name', 'Total Revenue', 'Operating Income'],
    ['Alpha Group Ltd', 1000, 100],
    ['Textiles del Norte', 1000, 100],
  ]), 'Screening');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

  await conFileReader(buf, async () => {
    const { rows } = await importCapitalIQExcel({ name: 'h.xlsx', size: buf.length });
    assert.strictEqual(rows[0].sospechaHolding, 'revisar');
    assert.strictEqual(rows[1].sospechaHolding, 'no');
  });
});

test('el motivo de rechazo no se contagia entre compañías con el mismo nameKey', () => {
  /* Caso real del universo del cliente: «N-able, Inc. (NYSE:NABL)» y «Nable Inc.
     (KOSDAQ:A153460)» dan las dos la clave «NABLE», porque `nameKey` quita
     paréntesis y sufijos societarios para poder cruzar con el estudio anterior. La
     segunda sí está controlada (66,35 %); la primera no (32,63 %), y aparecía
     descartada por control heredando el motivo de su homónima. */
  const universo = [
    { id: 'IQ_NABL', name: 'N-able, Inc. (NYSE:NABL)', holderPct: 32.63 },
    { id: 'IQ_A153460', name: 'Nable Inc. (KOSDAQ:A153460)', holderPct: 66.35 },
  ];
  const auditoria = {
    rechazadas: [{ id: 'IQ_A153460', name: 'Nable Inc. (KOSDAQ:A153460)', motivoClave: 'controlada', categoriaRechazo: 'filtro' }],
  };
  const [nable, otra] = enriquecerUniverso(universo, [], auditoria);
  assert.strictEqual(otra.motivoClave, 'controlada', 'la que sí está controlada conserva su motivo');
  assert.strictEqual(nable.motivoClave, '', 'y no se le pega a la que comparte nombre');
});

test('sin identificador el cruce por nombre sigue funcionando', () => {
  /* Las candidatas cargadas a mano o traídas de otras fuentes no traen id; para
     ellas el nombre es lo único que hay. */
  const universo = [{ name: 'Alpha Group' }];
  const auditoria = { rechazadas: [{ name: 'Alpha Group', motivoClave: 'holding', categoriaRechazo: 'filtro' }] };
  assert.strictEqual(enriquecerUniverso(universo, [], auditoria)[0].motivoClave, 'holding');
});

test('la selección tampoco se contagia entre homónimas', () => {
  const universo = [
    { id: 'IQ_NABL', name: 'N-able, Inc. (NYSE:NABL)' },
    { id: 'IQ_A153460', name: 'Nable Inc. (KOSDAQ:A153460)' },
  ];
  const seleccionadas = [{ id: 'IQ_A153460', name: 'Nable Inc. (KOSDAQ:A153460)' }];
  const [nable, otra] = enriquecerUniverso(universo, seleccionadas, null);
  assert.strictEqual(otra.seleccionada, true);
  assert.strictEqual(nable.seleccionada, false, 'la homónima no queda marcada como comparable del estudio');
});

/* ══════ Mínimo de comparables y ampliación a actividades relacionadas ══════
   Caso real que lo motivó: un universo de 270 candidatas del que la curación rechazaba 188 por
   no ser «la misma actividad específica», y la muestra quedaba en 6. Un rango intercuartil
   sobre 6 observaciones no se sostiene, y el estudio se radica con ese rango. La IA pasa a
   graduar —misma, relacionada, distinta— y el motor amplía a las relacionadas solo lo justo
   para no bajar de `MINIMO_COMPARABLES`. */

/** Candidatas con dictamen de la IA, para no repetir el andamiaje en cada test. */
const conGrado = (n, grado, prefijo) => Array.from({ length: n }, (_, i) => ({
  id: prefijo + i, name: prefijo + ' ' + i, desc: 'descripcion del negocio', s: 100, op: 10, grado,
}));
const veredictoDe = (candidatas) => ({
  porId: Object.fromEntries(candidatas.map(c => [c.id, { grado: c.grado, motivo: '', perfil: 'SERVICIO' }])),
});

test('el mínimo es un piso: pedir menos en el paso 2 no encoge la muestra', () => {
  const candidatas = conGrado(20, 'MISMA', 'C');
  const r = scoreCandidates(candidatas, { nTarget: 6 }, '', [], { iaMatch: veredictoDe(candidatas) });
  assert.strictEqual(r.seleccionadas.length, MINIMO_COMPARABLES,
    'con 6 pedidas la muestra sigue siendo de ' + MINIMO_COMPARABLES);
  assert.strictEqual(r.cupo, MINIMO_COMPARABLES);
});

test('el N del paso 2 manda cuando pide más que el mínimo', () => {
  const candidatas = conGrado(30, 'MISMA', 'C');
  const r = scoreCandidates(candidatas, { nTarget: 15 }, '', [], { iaMatch: veredictoDe(candidatas) });
  assert.strictEqual(r.seleccionadas.length, 15, 'el piso no puede recortar lo que el analista pide');
  assert.strictEqual(r.cupo, 15);
  assert.strictEqual(r.ampliadas, 0, 'con 30 de la misma actividad no hace falta ampliar');
});

test('la actividad relacionada completa la muestra cuando la idéntica no alcanza', () => {
  /* El caso del usuario en pequeño: pocas de misma actividad y muchas afines. */
  const candidatas = [...conGrado(6, 'MISMA', 'M'), ...conGrado(20, 'RELACIONADA', 'R')];
  const r = scoreCandidates(candidatas, { nTarget: 12 }, '', [], { iaMatch: veredictoDe(candidatas) });

  assert.strictEqual(r.seleccionadas.length, 12);
  assert.strictEqual(r.ampliadas, 6, 'se amplía solo lo que falta: 6 idénticas + 6 afines');
  assert.strictEqual(r.seleccionadas.filter(c => c.entroPorAmpliacion).length, 6);
  /* Las idénticas van primero: la ampliación es el último recurso, no un empate por puntaje. */
  r.seleccionadas.slice(0, 6).forEach(c => assert.ok(!c.entroPorAmpliacion,
    c.name + ' desplazó a una de misma actividad'));
  assert.strictEqual(r.relacionadasDisponibles, 20);
});

test('no se amplía ni una comparable de más', () => {
  /* Con las idénticas justas para el cupo, ninguna afín entra: ampliar el criterio de búsqueda
     hay que justificarlo en el informe, así que se hace solo cuando hace falta. */
  const candidatas = [...conGrado(10, 'MISMA', 'M'), ...conGrado(10, 'RELACIONADA', 'R')];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, '', [], { iaMatch: veredictoDe(candidatas) });
  assert.strictEqual(r.ampliadas, 0);
  assert.strictEqual(r.seleccionadas.length, 10);
  r.seleccionadas.forEach(c => assert.ok(!c.entroPorAmpliacion, 'se amplió sin necesidad'));
});

test('la actividad relacionada no se descarta: queda en reserva si no hizo falta', () => {
  const candidatas = [...conGrado(12, 'MISMA', 'M'), ...conGrado(5, 'RELACIONADA', 'R')];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, '', [], { iaMatch: veredictoDe(candidatas) });

  assert.strictEqual(r.rechazadas.length, 0, 'una actividad afín no es motivo de rechazo');
  assert.strictEqual(r.reserva.length, 7, 'las 2 idénticas sobrantes y las 5 afines');
  /* Y las idénticas van delante en la reserva: si el analista sube el N, se echa mano de ellas
     antes que de las afines. */
  assert.ok(!r.reserva[0].esRelacionada, 'la reserva empieza por las de misma actividad');
});

test('la actividad distinta sigue descartándose', () => {
  const candidatas = [...conGrado(3, 'MISMA', 'M'), ...conGrado(4, 'DISTINTA', 'D')];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, '', [], { iaMatch: veredictoDe(candidatas) });

  assert.strictEqual(r.seleccionadas.length, 3, 'no se rellena con lo que no es comparable');
  assert.strictEqual(r.rechazadas.length, 4);
  assert.strictEqual(r.rechazadasPorMotivo.actividadDistinta, 4);
  /* Y queda por debajo del mínimo, que es lo que la pantalla tiene que decir en rojo: el motor
     no inventa comparables para cuadrar un número. */
  assert.ok(r.seleccionadas.length < MINIMO_COMPARABLES);
});

test('una comparable de continuidad nunca cuenta como ampliación', () => {
  /* Aunque la IA la juzgue solo afín: su inclusión se sustentó el año anterior y no necesita
     la ampliación del criterio para entrar. */
  const candidatas = [
    { id: 'P', name: 'Previa', nameKey: nameKey('Previa'), desc: 'x', s: 100, op: 10, grado: 'RELACIONADA' },
    ...conGrado(12, 'MISMA', 'M'),
  ];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, '', [{ name: 'Previa' }],
    { iaMatch: veredictoDe(candidatas) });

  const previa = r.seleccionadas.find(c => c.id === 'P');
  assert.ok(previa, 'la de continuidad tiene que entrar');
  assert.strictEqual(previa.esRelacionada, false);
  assert.ok(!previa.entroPorAmpliacion);
  assert.strictEqual(r.ampliadas, 0);
});

test('un veredicto guardado antes de que existieran los grados se sigue entendiendo', () => {
  /* Los estudios ya guardados traen `coincide` y ningún `grado`. Un `false` de entonces se
     emitió bajo el criterio estricto, así que equivale a DISTINTA. */
  assert.strictEqual(gradoDeActividad({ coincide: true }), 'MISMA');
  assert.strictEqual(gradoDeActividad({ coincide: false }), 'DISTINTA');
  assert.strictEqual(gradoDeActividad({ grado: 'RELACIONADA' }), 'RELACIONADA');
  /* El grado manda sobre el booleano cuando están los dos. */
  assert.strictEqual(gradoDeActividad({ grado: 'RELACIONADA', coincide: false }), 'RELACIONADA');
  /* Un dictamen que no se puede leer es «sin dictamen», no «descártala»: perder una comparable
     por un fallo de formato es peor que dejarla competir por puntaje. La normalización al
     escribir ya garantiza que lo guardado traiga siempre uno de los tres grados. */
  assert.strictEqual(gradoDeActividad({ grado: 'inventado' }), null);
  assert.strictEqual(gradoDeActividad(null), null);
  assert.strictEqual(gradoDeActividad({}), null);

  const candidatas = [
    { id: 'A', name: 'Vieja Si', desc: 'x', s: 100, op: 10 },
    { id: 'B', name: 'Vieja No', desc: 'x', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, '', [], {
    iaMatch: { porId: { A: { coincide: true }, B: { coincide: false } } },
  });
  assert.strictEqual(r.seleccionadas.length, 1);
  assert.strictEqual(r.seleccionadas[0].id, 'A');
});

test('la ampliación queda marcada en la comparable, para justificarla en el informe', () => {
  const candidatas = [...conGrado(1, 'MISMA', 'M'), ...conGrado(3, 'RELACIONADA', 'R')];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, '', [], { iaMatch: veredictoDe(candidatas) });

  const ampliada = r.seleccionadas.find(c => c.entroPorAmpliacion);
  assert.ok(ampliada, 'ninguna quedó marcada');
  assert.strictEqual(ampliada.gradoActividad, 'RELACIONADA');
  assert.match(ampliada.razones, /actividad relacionada/,
    'la razón visible tiene que decirlo, no solo una bandera interna');
});

test('la curación pide el grado de actividad y lo guarda', async () => {
  const { restore, llamadas } = mockGemini(() => true, {
    grado: (c) => (c.id === 'A' ? 'MISMA' : 'RELACIONADA'),
  });
  try {
    const candidatas = [
      { id: 'A', name: 'A SA', desc: 'software development services' },
      { id: 'B', name: 'B SA', desc: 'game publishing' },
    ];
    const v = await curateCandidatesWithGemini(candidatas, 'desarrollo de software');

    const enviado = llamadas[0].contents[0].parts[0].text;
    assert.match(enviado, /"grado":"MISMA"/, 'el prompt tiene que pedir el grado');
    assert.match(enviado, /RELACIONADA/, 'y explicar el grado intermedio');

    assert.strictEqual(v.porId.A.grado, 'MISMA');
    assert.strictEqual(v.porId.B.grado, 'RELACIONADA');
    /* `coincide` se conserva con el sentido de siempre: «es la misma actividad». */
    assert.strictEqual(v.porId.A.coincide, true);
    assert.strictEqual(v.porId.B.coincide, false);
    assert.strictEqual(v.coinciden, 1);
    assert.strictEqual(v.relacionadas, 1);
  } finally {
    restore();
  }
});

test('un modelo que contesta con el formato anterior se sigue entendiendo', async () => {
  /* El mock sin `opciones.grado` responde con `coincide`, como haría un modelo que ignora el
     campo nuevo. No puede quedar todo el universo descartado por eso. */
  const { restore } = mockGemini((c) => c.id === 'A');
  try {
    const candidatas = [
      { id: 'A', name: 'A SA', desc: 'software development services' },
      { id: 'B', name: 'B SA', desc: 'iron ore mining' },
    ];
    const v = await curateCandidatesWithGemini(candidatas, 'desarrollo de software');
    assert.strictEqual(v.porId.A.grado, 'MISMA');
    assert.strictEqual(v.porId.B.grado, 'DISTINTA');
    assert.strictEqual(v.coinciden, 1);
  } finally {
    restore();
  }
});

test('un veredicto guardado sin grados no se reutiliza: se vuelve a curar', async () => {
  /* Es la trampa del artefacto cacheado: los estudios curados antes de que existiera el grado
     solo dicen sí/no bajo el criterio estricto de entonces, así que sus «no» mezclan las
     verdaderamente distintas con las afines. Darlos por buenos dejaría el estudio sin una sola
     candidata relacionada y la muestra seguiría corta sin que se entienda por qué. */
  const { restore, llamadas } = mockGemini(() => true, { grado: () => 'RELACIONADA' });
  try {
    const candidatas = [
      { id: 'A', name: 'A SA', desc: 'software development services' },
      { id: 'B', name: 'B SA', desc: 'game publishing' },
    ];
    const viejo = {
      actividadUsada: 'desarrollo de software',
      porId: { A: { coincide: true }, B: { coincide: false } },
    };
    const v = await curateCandidatesWithGemini(candidatas, 'desarrollo de software',
      { veredictoPrevio: viejo });

    assert.strictEqual(llamadas.length, 1, 'tenía que volver a consultar');
    assert.strictEqual(v.reutilizadas, 0, 'no se reutilizó ningún dictamen del formato viejo');
    assert.strictEqual(v.porId.B.grado, 'RELACIONADA',
      'y la que antes era un «no» seco ahora puede resultar afín');
  } finally {
    restore();
  }
});

test('un veredicto que ya trae grados sí se reutiliza', async () => {
  /* La contrapartida del anterior: volver a curar cuesta dinero, así que solo se rehace lo que
     de verdad no sirve. */
  const { restore, llamadas } = mockGemini(() => true, { grado: () => 'MISMA' });
  try {
    const candidatas = [
      { id: 'A', name: 'A SA', desc: 'software development services' },
      { id: 'B', name: 'B SA', desc: 'software development services' },
    ];
    const previo = {
      actividadUsada: 'desarrollo de software',
      porId: { A: { grado: 'MISMA', coincide: true }, B: { grado: 'RELACIONADA', coincide: false } },
    };
    const v = await curateCandidatesWithGemini(candidatas, 'desarrollo de software',
      { veredictoPrevio: previo });

    assert.strictEqual(llamadas.length, 0, 'no hacía falta ninguna consulta');
    assert.strictEqual(v.reutilizadas, 2);
    assert.strictEqual(v.coinciden, 1);
    assert.strictEqual(v.relacionadas, 1);
  } finally {
    restore();
  }
});

/* --- `consultarGemini` la usan la curación y el marcado de la plantilla --- */

test('consultarGemini reintenta el 504 con el que /api/gemini se corta a sí mismo', async () => {
  /* Ese 504 no viene de un servidor ajeno: lo emite nuestra propia función cuando Gemini pasa
     de 50 s, para poder contestar algo legible antes de que el borde de Hosting tumbe la
     conexión a los 60 (ver GEMINI_CORTE_MS en functions/index.js). Está pensado para
     reintentarse, y quien lo ignora pierde su trabajo: el marcado de la plantilla lo ignoraba
     y dejaba tramos enteros del informe sin marcar, con los datos del cliente anterior
     dentro. */
  const original = axios.post;
  let intentos = 0;
  axios.post = async () => {
    if (++intentos === 1) {
      const err = new Error('Request failed with status code 504');
      err.response = {
        status: 504,
        data: { error: 'La consulta a Gemini superó el tiempo disponible.' },
      };
      throw err;
    }
    return { data: { candidates: [{ content: { parts: [{ text: '{"marcas":[]}' }] } }] } };
  };
  try {
    const texto = await consultarGemini('un prompt cualquiera', { pausaBaseMs: 0 });
    assert.strictEqual(texto, '{"marcas":[]}');
    assert.strictEqual(intentos, 2, 'un intento cortado y uno que sale');
  } finally {
    axios.post = original;
  }
});

test('consultarGemini deja elegir el modelo, para no divergir del resto del sistema', async () => {
  const original = axios.post;
  const cuerpos = [];
  axios.post = async (url, body) => {
    cuerpos.push({ url, model: body.model });
    return { data: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] } };
  };
  try {
    await consultarGemini('x', { modelo: 'gemini-3.5-flash' });
    assert.deepStrictEqual(cuerpos, [{ url: '/api/gemini', model: 'gemini-3.5-flash' }]);
  } finally {
    axios.post = original;
  }
});

/* ══════ `prefiltrar` y `scoreCandidates` tienen que juzgar IGUAL ══════

   `prefiltrar` decide a quién se le PAGA la curación y `scoreCandidates` decide quién ENTRA
   en la muestra. El comentario de `prefiltrar` afirma que la segunda «vuelve a aplicar estos
   mismos filtros — es idempotente», y no era cierto en dos puntos:

     · Holding: `prefiltrar` no eximía a las de continuidad y `scoreCandidates` sí, así que una
       comparable del estudio del año pasado con «Group» en la razón social se caía ANTES de
       curarse, aunque el motor la habría conservado. Se perdía sin un aviso.
     · Pérdida: `prefiltrar` miraba `cand.hasLoss` y `scoreCandidates` usa `enPerdida`, que
       además reconoce `op < 0` cuando el flag no viene. Una candidata así se curaba —pagando—
       para que el motor la descartara después.

   Divergir aquí no es un detalle de estilo: el paso 2 va a mostrar el embudo en vivo con estos
   mismos predicados, y un panel que promete un número que el motor no respeta es peor que no
   mostrar nada. */

test('el filtro de holding exime a las de continuidad igual que el motor', () => {
  const candidatas = [
    { id: 'G', name: 'Alpha Group Ltd', nameKey: nameKey('Alpha Group Ltd'), s: 1000, op: 100, desc: 'x' },
  ];
  const previas = [{ name: 'Alpha Group Ltd' }];

  assert.strictEqual(prefiltrar(candidatas, {}).validas.length, 0,
    'sin estudio anterior se descarta, como siempre');
  assert.strictEqual(prefiltrar(candidatas, {}, previas).validas.length, 1,
    'con estudio anterior se conserva: su inclusión ya se sustentó');

  /* Y el motor coincide, que es el punto. */
  const r = scoreCandidates(candidatas, { nTarget: 12, minimo: 1 }, '', previas);
  assert.strictEqual(r.rechazadas.filter((c) => c.motivoClave === 'holding').length, 0);
});

test('el filtro de pérdida reconoce la utilidad negativa aunque falte el flag', () => {
  /* Capital IQ no siempre trae `hasLoss`: lo calcula la importación, y una candidata que
     llegue por otra vía (el estudio anterior, una fila a mano) solo trae `op`. */
  const sinFlag = [{ id: 'P', name: 'Perdida SA', op: -500, s: 1000, desc: 'x' }];
  assert.strictEqual(prefiltrar(sinFlag, {}).validas.length, 0,
    'se descarta antes de curar, y no se paga por ella');

  const r = scoreCandidates(sinFlag, { nTarget: 12, minimo: 1 }, '', []);
  assert.strictEqual(r.rechazadas.filter((c) => c.motivoClave === 'perdidaOperativa').length, 1,
    'el motor la descartaba igual: lo que cambia es no haber pagado su curación');
});

test('prefiltrar atribuye cada descarte a su filtro, con el mismo motivo que el motor', () => {
  /* La atribución es lo que permite pintar el embudo por control. Sin ella `prefiltrar` solo
     dice cuántas caen, no por cuál, y el panel tendría que recalcularlo por su cuenta —que es
     exactamente cómo se divergiría otra vez. */
  const candidatas = [
    { id: 'H', name: 'Beta Holding SA', nameKey: nameKey('Beta Holding SA'), s: 1000, op: 100, desc: 'x' },
    { id: 'N', name: 'Negativa SA', nameKey: nameKey('Negativa SA'), hasNegativeBalance: true, s: 1000, op: 100, desc: 'x' },
    { id: 'P', name: 'Perdida SA', nameKey: nameKey('Perdida SA'), hasLoss: true, s: 1000, op: -50, desc: 'x' },
    { id: 'OK', name: 'Buena SA', nameKey: nameKey('Buena SA'), s: 1000, op: 100, desc: 'x' },
  ];
  const { validas, porMotivo } = prefiltrar(candidatas, {});
  assert.deepStrictEqual(validas.map((c) => c.id), ['OK']);
  assert.strictEqual(porMotivo.holding.length, 1);
  assert.strictEqual(porMotivo.holding[0].id, 'H');
  assert.strictEqual(porMotivo.saldoNegativo.length, 1);
  assert.strictEqual(porMotivo.perdidaOperativa.length, 1);
  assert.strictEqual(porMotivo.controlada.length, 0);

  /* Y el motor atribuye cada una al MISMO motivo. */
  const r = scoreCandidates(candidatas, { nTarget: 12, minimo: 1 }, '', []);
  const delMotor = {};
  r.rechazadas.forEach((c) => { delMotor[c.id] = c.motivoClave; });
  assert.strictEqual(delMotor.H, 'holding');
  assert.strictEqual(delMotor.N, 'saldoNegativo');
  assert.strictEqual(delMotor.P, 'perdidaOperativa');
});

test('el primer motivo manda, igual que en el motor', () => {
  /* Una candidata puede violar dos filtros a la vez. El orden de precedencia tiene que ser el
     mismo en las dos funciones o el embudo del panel no cuadraría con el del informe. */
  const dosVicios = [{
    id: 'HP', name: 'Gamma Holding SA', nameKey: nameKey('Gamma Holding SA'),
    hasLoss: true, s: 1000, op: -50, desc: 'x',
  }];
  const { porMotivo } = prefiltrar(dosVicios, {});
  assert.strictEqual(porMotivo.holding.length, 1, 'holding va antes que pérdida');
  assert.strictEqual(porMotivo.perdidaOperativa.length, 0);

  const r = scoreCandidates(dosVicios, { nTarget: 12, minimo: 1 }, '', []);
  assert.strictEqual(r.rechazadas[0].motivoClave, 'holding');
});

/* ══════ La cuota de negativas cede sitio quitando continuidad ══════

   Caso real reportado el 2026-09-01: 16 comparables del estudio anterior, todas rentables,
   N objetivo 12 y cuota de 4 negativas con 41 disponibles en el universo. La muestra salió con
   16 comparables y CERO negativas.

   La causa era `cupoRestante = max(0, cupo − continuidad) = max(0, 12 − 16) = 0`: la continuidad
   llenaba y desbordaba el cupo, y la cuota se quedaba sin espacio en silencio. Peor, los tres
   avisos que sí dispararon mandaban en direcciones distintas y dos eran falsos («el resto del
   cupo lo llenaron positivas» — ninguna entró; «suba el objetivo de negativas» — no puede servir
   con cupo 0).

   Decisión del usuario: la cuota MANDA y desplaza continuidad, hasta respetar el N exacto. Se
   retiran las de MENOR puntaje, y hay que nombrarlas: retirar una comparable aceptada el año
   anterior se justifica en el informe, así que el motor no puede quitarlas en silencio.

   Con la cuota en 0 el comportamiento NO cambia: la continuidad sigue entrando entera aunque
   desborde el N, que es la decisión anterior y sigue en pie. */

/* El puntaje lo calcula el motor; el orden se induce con las ventas, que es uno de sus
   factores, para no depender de un `score` inyectado que el motor recalcula igual. */
const candCuota = (nombre, op, ventas) => ({
  id: nombre, name: nombre, nameKey: nameKey(nombre),
  s: ventas, c: 600, op, desc: 'trading services', country: 'Japan',
});

function universoDelCaso({ nContinuidad = 16, nNegativas = 41, nPositivas = 200 } = {}) {
  /* Continuidad con ventas decrecientes: la última es la de menor puntaje y cede primero. */
  const continuidad = Array.from({ length: nContinuidad }, (_, i) =>
    candCuota('Continuidad ' + String(i).padStart(2, '0'), 50, 1000 - i * 10));
  const negativas = Array.from({ length: nNegativas }, (_, i) =>
    candCuota('Negativa ' + String(i).padStart(2, '0'), -20 - i, 1000));
  const positivas = Array.from({ length: nPositivas }, (_, i) =>
    candCuota('Positiva ' + String(i).padStart(2, '0'), 60, 1000));
  return {
    universo: [...continuidad, ...negativas, ...positivas],
    previas: continuidad.map((c) => ({ name: c.name })),
  };
}

/** Curación que da MISMA actividad a todas, para aislar el defecto del cupo. */
const curacionTotal = (universo) => ({
  porId: Object.fromEntries(universo.map((c) => [c.id, { grado: 'MISMA', perfil: 'SERVICIO' }])),
});

const BASE_CUOTA = {
  nTarget: 12, minimo: 10, perdidaOp: 'incluir',
  holding: 'excluir', saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50,
};

const correrCaso = (config, opciones = {}) => {
  const { universo, previas } = universoDelCaso(opciones);
  return scoreCandidates(universo, config, 'trading services', previas, {
    ventasParteExaminada: 1000, iaMatch: curacionTotal(universo),
  });
};

test('la cuota de negativas se cumple aunque la continuidad desborde el N', () => {
  const r = correrCaso({ ...BASE_CUOTA, negativasObjetivo: 4 });
  assert.strictEqual(r.seleccionadas.length, 12, 'la muestra respeta el N exacto');
  assert.strictEqual(r.seleccionadas.filter(enPerdida).length, 4, 'y trae las 4 pedidas');
  assert.strictEqual(r.seleccionadas.filter((c) => c.esContinuidad).length, 8,
    'la continuidad cede sitios: 12 − 4 = 8 se quedan');
  assert.strictEqual(r.negativasIncluidas, 4);
});

test('las comparables de continuidad retiradas se nombran, con su motivo', () => {
  /* Retirar una aceptada el año anterior se justifica en el informe: el motor no puede
     quitarlas en silencio. */
  const r = correrCaso({ ...BASE_CUOTA, negativasObjetivo: 4 });
  assert.strictEqual(r.continuidadDesplazada.length, 8);
  r.continuidadDesplazada.forEach((c) => {
    assert.ok(c.name, 'cada una con nombre');
    assert.match(c.motivo, /cuota|p[ée]rdida/i, 'y con el motivo del desplazamiento');
  });
});

test('ceden las de MENOR puntaje, no las primeras que aparezcan', () => {
  const r = correrCaso({ ...BASE_CUOTA, negativasObjetivo: 4 });
  const quedan = r.seleccionadas.filter((c) => c.esContinuidad).map((c) => c.name);
  const ceden = r.continuidadDesplazada.map((c) => c.name);
  assert.ok(quedan.includes('Continuidad 00'), 'la de mayor puntaje se queda');
  assert.ok(ceden.includes('Continuidad 15'), 'y la de menor cede');
  assert.strictEqual(quedan.filter((n) => ceden.includes(n)).length, 0, 'sin solaparse');
});

test('las desplazadas van a la RESERVA, no a rechazadas', () => {
  /* `rechazadasPorMotivo` cuenta sobre `rechazadas` y el informe suma la reserva aparte:
     meterlas en las dos listas descuadraría la tabla contra el universo. */
  const r = correrCaso({ ...BASE_CUOTA, negativasObjetivo: 4 });
  const enReservaN = r.reserva.map((c) => c.name);
  const enRechazadasN = r.rechazadas.map((c) => c.name);
  r.continuidadDesplazada.forEach((c) => {
    assert.ok(enReservaN.includes(c.name), c.name + ' debe quedar en reserva');
    assert.ok(!enRechazadasN.includes(c.name), c.name + ' NO puede estar en rechazadas');
  });
});

test('con la cuota en 0 no se retira ninguna continuidad: la decisión anterior sigue en pie', () => {
  const r = correrCaso({ ...BASE_CUOTA, negativasObjetivo: 0 });
  assert.strictEqual(r.seleccionadas.filter((c) => c.esContinuidad).length, 16);
  assert.strictEqual(r.seleccionadas.length, 16, 'la muestra sigue desbordando el N, como antes');
  assert.deepEqual(r.continuidadDesplazada, []);
  assert.strictEqual(r.continuidadExcedeObjetivo, true, 'lo que se conserva es el aviso');
});

test('solo cede lo que la cuota necesita de verdad', () => {
  /* Si el universo tiene menos negativas que la cuota, no se retira continuidad por unas
     negativas que no existen. */
  const r = correrCaso({ ...BASE_CUOTA, negativasObjetivo: 4 }, { nNegativas: 1 });
  assert.strictEqual(r.seleccionadas.filter(enPerdida).length, 1);
  assert.strictEqual(r.continuidadDesplazada.length, 5, '16 − (12 − 1) = 5');
  assert.strictEqual(r.seleccionadas.length, 12);
});

test('sin desbordar el N, la continuidad no cede nada', () => {
  /* 8 de continuidad, N 12, cuota 4: caben las 8 + 4 negativas exactamente. */
  const r = correrCaso({ ...BASE_CUOTA, negativasObjetivo: 4 }, { nContinuidad: 8 });
  assert.strictEqual(r.seleccionadas.filter((c) => c.esContinuidad).length, 8);
  assert.strictEqual(r.seleccionadas.filter(enPerdida).length, 4);
  assert.strictEqual(r.seleccionadas.length, 12);
  assert.deepEqual(r.continuidadDesplazada, []);
});

test('una negativa que ya venía del estudio anterior descuenta de la cuota', () => {
  const { universo, previas } = universoDelCaso({ nContinuidad: 16 });
  const conNegativa = universo.map((c) => (
    c.name === 'Continuidad 15' ? { ...c, op: -30 } : c
  ));
  const r = scoreCandidates(conNegativa, { ...BASE_CUOTA, negativasObjetivo: 4 }, 'trading services', previas, {
    ventasParteExaminada: 1000, iaMatch: curacionTotal(conNegativa),
  });
  assert.strictEqual(r.negativasDeContinuidad, 1);
  assert.strictEqual(r.seleccionadas.filter(enPerdida).length, 4, 'cuatro en total, no cinco');
  assert.strictEqual(r.seleccionadas.length, 12);
});

test('el motor dice cuánta continuidad tuvo que retirar la cuota', () => {
  /* Es el dato que faltaba: los avisos decían «el resto del cupo lo llenaron positivas» y
     «suba el objetivo», los dos falsos. */
  const r = correrCaso({ ...BASE_CUOTA, negativasObjetivo: 4 });
  assert.strictEqual(r.continuidadDesplazadaPorCuota, 8);
});

/* ══════ La cuota elige las negativas MÁS PARECIDAS a la rentabilidad del contribuyente ══════

   Reportado el 2026-09-01: con la cuota funcionando, el rango bajó de 3,111-9,173 % a
   -0,355-4,312 %, pero el contribuyente estaba en -4,595 % y seguía fuera por 4,240 %. La
   cuota tomaba las negativas de mayor PUNTAJE de comparabilidad, que no son las que acercan el
   rango: entre 37 negativas disponibles podía elegir cuatro cercanas a cero y dejar fuera las
   que de verdad se parecen al contribuyente.

   Decisión del usuario (2026-09-01): dentro de la cuota se prefieren las de margen más cercano
   al del contribuyente. Es a la vez lo más efectivo y lo más defendible: acerca el P25 al nivel
   de la parte examinada, y el criterio que se escribe en el informe es «se eligieron las
   comparables cuyo perfil de rentabilidad más se parece al de la parte examinada», que es lo que
   pide el principio de comparabilidad. Una compañía en pérdida real comparada con compañías en
   pérdida no es un estiramiento: es la comparación correcta (Guías OCDE cap. III, §3.64-3.65).

   Solo reordena DENTRO de las que ya pasaron todo —mismos filtros, misma actividad, misma
   curación—, así que no entra ninguna que antes no fuera válida. Y solo aplica a la cuota: el
   llenado con positivas sigue por puntaje. */

const candCerc = (nombre, op, extra = {}) => ({
  id: nombre, name: nombre, nameKey: nameKey(nombre),
  s: 1000, c: 600, op, desc: 'trading services', country: 'Japan', ...extra,
});

const BASE_CERC = {
  nTarget: 12, minimo: 10, perdidaOp: 'incluir', negativasObjetivo: 4,
  holding: 'excluir', saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50,
};

/* Negativas repartidas de -1 % a -12 %, y positivas para llenar el resto del cupo. */
const negativasEscalonadas = () => [-10, -20, -30, -45, -60, -80, -100, -120]
  .map((op) => candCerc(`Neg ${String(Math.abs(op)).padStart(3, '0')}`, op));
const positivasLlenado = () => Array.from({ length: 30 }, (_, i) => candCerc(`Pos ${i}`, 60));

const correrCercania = (pliParteExaminada, config = {}) => {
  const universo = [...negativasEscalonadas(), ...positivasLlenado()];
  const iaMatch = { porId: Object.fromEntries(universo.map((c) => [c.id, { grado: 'MISMA', perfil: 'SERVICIO' }])) };
  return scoreCandidates(universo, { ...BASE_CERC, ...config }, 'trading services', [], {
    ventasParteExaminada: 1000, iaMatch, pliParteExaminada, metodoPli: 'MO',
  });
};

test('con el contribuyente muy en pérdida entran las negativas más profundas', () => {
  /* Contribuyente en -9 %: las cercanas son -80, -100, -120 y -60 (−8 %, −10 %, −12 %, −6 %). */
  const r = correrCercania(-0.09);
  const negativas = r.seleccionadas.filter(enPerdida).map((c) => c.op).sort((a, b) => a - b);
  assert.strictEqual(negativas.length, 4);
  assert.deepEqual(negativas, [-120, -100, -80, -60],
    'las cuatro más cercanas a -9 %, no las de menor pérdida');
});

test('con el contribuyente apenas en pérdida no se va a las más profundas', () => {
  /* Contribuyente en -1,5 %. Hay siete negativas por debajo, así que la cuota se llena entera
     con ellas y la de -1 % —la única por encima— no entra. Dentro de las de abajo manda la
     cercanía: entran -2 %, -3 %, -4,5 % y -6 %, y NO se va a -12 %, que es lo que distingue este
     criterio de «las más profundas». */
  const r = correrCercania(-0.015);
  const negativas = r.seleccionadas.filter(enPerdida).map((c) => c.op).sort((a, b) => b - a);
  assert.deepEqual(negativas, [-20, -30, -45, -60]);
});

test('la cercanía se mide contra el contribuyente, no contra cero', () => {
  /* La misma muestra da conjuntos DISTINTOS según dónde esté el contribuyente: es la prueba de
     que el criterio no es «las más suaves» ni «las más profundas» disfrazado. */
  const arriba = correrCercania(-0.015).seleccionadas.filter(enPerdida).map((c) => c.op).sort((a, b) => a - b);
  const abajo = correrCercania(-0.09).seleccionadas.filter(enPerdida).map((c) => c.op).sort((a, b) => a - b);
  assert.notDeepEqual(arriba, abajo);
});

test('sin el PLI del contribuyente se cae al orden por puntaje, sin romperse', () => {
  /* Un estudio sin cifras cargadas todavía. Degradar es correcto: elegir por cercanía a un
     número que no existe sería inventar. */
  const universo = [...negativasEscalonadas(), ...positivasLlenado()];
  const iaMatch = { porId: Object.fromEntries(universo.map((c) => [c.id, { grado: 'MISMA', perfil: 'SERVICIO' }])) };
  const r = scoreCandidates(universo, BASE_CERC, 'trading services', [], {
    ventasParteExaminada: 1000, iaMatch,
  });
  assert.strictEqual(r.seleccionadas.filter(enPerdida).length, 4, 'la cuota se cumple igual');
});

test('el criterio NO mete ninguna que antes no fuera válida', () => {
  /* Solo reordena dentro de las que ya pasaron filtros, actividad y curación. Es lo que hace
     que el cambio sea de orden y no de admisión. */
  const universo = [...negativasEscalonadas(), ...positivasLlenado()];
  const iaMatch = { porId: Object.fromEntries(universo.map((c) => [c.id, { grado: 'MISMA', perfil: 'SERVICIO' }])) };
  /* Una negativa que la curación rechaza: no puede aparecer por cercana que sea. */
  const intrusa = candCerc('Neg 090 DISTINTA', -90);
  iaMatch.porId[intrusa.id] = { grado: 'DISTINTA', motivo: 'otro sector' };
  const r = scoreCandidates([...universo, intrusa], BASE_CERC, 'trading services', [], {
    ventasParteExaminada: 1000, iaMatch, pliParteExaminada: -0.09, metodoPli: 'MO',
  });
  assert.ok(!r.seleccionadas.some((c) => c.id === intrusa.id),
    'la rechazada por actividad no entra aunque su margen sea el más cercano');
});

test('el llenado con positivas sigue por puntaje, no por cercanía', () => {
  /* La cercanía es el criterio DE LA CUOTA. Si gobernara también las positivas, el margen
     mandaría sobre la comparabilidad en toda la muestra, que es otra cosa y no se pidió. */
  const universo = [
    ...negativasEscalonadas(),
    /* Positivas con ventas muy distintas: el factor de tamaño las ordena por puntaje. */
    ...Array.from({ length: 30 }, (_, i) => candCerc(`Pos ${i}`, 60, { s: 1000 + i * 5000 })),
  ];
  const iaMatch = { porId: Object.fromEntries(universo.map((c) => [c.id, { grado: 'MISMA', perfil: 'SERVICIO' }])) };
  const r = scoreCandidates(universo, BASE_CERC, 'trading services', [], {
    ventasParteExaminada: 1000, iaMatch, pliParteExaminada: -0.09, metodoPli: 'MO',
  });
  const positivas = r.seleccionadas.filter((c) => !enPerdida(c));
  /* Las de ventas más cercanas a 1000 puntúan mejor por tamaño y deben ir primero. */
  assert.ok(positivas[0].s <= positivas[positivas.length - 1].s,
    'las positivas siguen ordenadas por puntaje de comparabilidad');
});

test('el motor publica el criterio que usó para la cuota', () => {
  /* El informe tiene que poder escribirlo: «se eligieron las comparables cuyo perfil de
     rentabilidad más se parece al de la parte examinada». */
  const r = correrCercania(-0.09);
  assert.strictEqual(r.criterioNegativas, 'cercania-por-debajo');
  const sinPli = scoreCandidates(
    [...negativasEscalonadas(), ...positivasLlenado()],
    BASE_CERC, 'trading services', [],
    { ventasParteExaminada: 1000, iaMatch: { porId: {} } },
  );
  assert.strictEqual(sinPli.criterioNegativas, 'puntaje');
});

/* ══════ La cuota mide con la MISMA vara que decide el cumplimiento ══════

   Reportado el 2026-09-01: «nosotros cumplimos según el rango ajustado, por eso las comparables
   deben ser seleccionadas con este criterio». Tenía razón y era un tradeoff mío mal elegido: la
   cercanía se medía sobre el margen CRUDO para no acoplar módulos, mientras la conclusión del
   estudio se sostiene en el PLI AJUSTADO cuando `useadj` está puesto.

   La diferencia no es cosmética. El contribuyente NO se ajusta contra sí mismo —los ratios se
   cancelan— así que su PLI no se mueve, pero el de cada comparable sí. Con el capital de trabajo
   de las comparables en cero, el ajuste es un corrimiento constante hacia arriba: para quedar
   cerca del contribuyente EN TÉRMINOS AJUSTADOS hay que elegir comparables cuyo margen crudo esté
   ese corrimiento MÁS ABAJO. Medir con la vara equivocada elige el conjunto equivocado. */

const candVara = (nombre, opPct) => ({
  id: nombre, name: nombre, nameKey: nameKey(nombre),
  s: 1000, c: 700, op: (opPct / 100) * 1000, ar: 0, inv: 0, ap: 0, ppe: 0,
  desc: 'trading services', country: 'Japan',
});

test('con una vara inyectada, la cuota ordena por ELLA y no por el margen crudo', () => {
  /* La vara simula el ajuste: suma 3 puntos al margen de cada comparable, como hace el ajuste
     de capital de trabajo cuando las comparables no traen capital de trabajo. */
  const negativas = [-20, -40, -60, -80, -100, -120].map((op) => candVara('Neg ' + Math.abs(op), op / 10));
  const positivas = Array.from({ length: 20 }, (_, i) => candVara('Pos ' + i, 6));
  const universo = [...negativas, ...positivas];
  const iaMatch = { porId: Object.fromEntries(universo.map((c) => [c.id, { grado: 'MISMA', perfil: 'SERVICIO' }])) };
  const config = {
    nTarget: 12, minimo: 10, perdidaOp: 'incluir', negativasObjetivo: 3,
    holding: 'excluir', saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50,
  };
  const pliTP = -0.05;   // el contribuyente en -5 %

  /* Sin vara: cercanía sobre el margen crudo -> las de -4 %, -6 % y -2 % (o -8 %). */
  const cruda = scoreCandidates(universo, config, 'trading services', [], {
    ventasParteExaminada: 1000, iaMatch, pliParteExaminada: pliTP, metodoPli: 'MO',
  });
  /* Con vara: el margen efectivo es crudo + 3 puntos, así que para quedar en -5 % hay que
     elegir las que crudas están en -8 %. */
  const conVara = scoreCandidates(universo, config, 'trading services', [], {
    ventasParteExaminada: 1000, iaMatch, pliParteExaminada: pliTP, metodoPli: 'MO',
    margenDeCandidata: (c) => (c.op / c.s) + 0.03,
  });

  const crudas = cruda.seleccionadas.filter(enPerdida).map((c) => c.op).sort((a, b) => a - b);
  const varas = conVara.seleccionadas.filter(enPerdida).map((c) => c.op).sort((a, b) => a - b);
  assert.notDeepEqual(crudas, varas, 'la vara tiene que cambiar el conjunto elegido');
  assert.ok(varas[0] < crudas[0],
    'con la vara ajustada entran comparables de margen crudo MÁS BAJO, que es el punto');
});

test('sin vara inyectada se sigue usando el margen crudo, como antes', () => {
  const negativas = [-20, -40, -60, -80].map((op) => candVara('Neg ' + Math.abs(op), op / 10));
  const positivas = Array.from({ length: 20 }, (_, i) => candVara('Pos ' + i, 6));
  const universo = [...negativas, ...positivas];
  const iaMatch = { porId: Object.fromEntries(universo.map((c) => [c.id, { grado: 'MISMA', perfil: 'SERVICIO' }])) };
  const r = scoreCandidates(universo, {
    nTarget: 12, minimo: 10, perdidaOp: 'incluir', negativasObjetivo: 2,
    holding: 'excluir', saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50,
  }, 'trading services', [], {
    ventasParteExaminada: 1000, iaMatch, pliParteExaminada: -0.05, metodoPli: 'MO',
  });
  const elegidas = r.seleccionadas.filter(enPerdida).map((c) => c.op).sort((a, b) => b - a);
  assert.deepEqual(elegidas, [-60, -80],
    'las dos más cercanas a -5 % DE LAS QUE ESTÁN POR DEBAJO: -6 % y -8 %, no la de -4 %');
});

test('el motor dice con qué vara midió', () => {
  const negativas = [-20, -60].map((op) => candVara('Neg ' + Math.abs(op), op / 10));
  const universo = [...negativas, ...Array.from({ length: 20 }, (_, i) => candVara('Pos ' + i, 6))];
  const iaMatch = { porId: Object.fromEntries(universo.map((c) => [c.id, { grado: 'MISMA', perfil: 'SERVICIO' }])) };
  const base = {
    nTarget: 12, minimo: 10, perdidaOp: 'incluir', negativasObjetivo: 1,
    holding: 'excluir', saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50,
  };
  const conVara = scoreCandidates(universo, base, 'trading services', [], {
    ventasParteExaminada: 1000, iaMatch, pliParteExaminada: -0.05, metodoPli: 'MO',
    margenDeCandidata: (c) => (c.op / c.s) + 0.03,
  });
  assert.strictEqual(conVara.varaDeCercania, 'inyectada');
  const cruda = scoreCandidates(universo, base, 'trading services', [], {
    ventasParteExaminada: 1000, iaMatch, pliParteExaminada: -0.05, metodoPli: 'MO',
  });
  assert.strictEqual(cruda.varaDeCercania, 'margen-crudo');
});

/* ══════ Los nombres reales de Capital IQ para el capital de trabajo ══════

   Reportado el 2026-09-01: el paso 1 seguía marcando en gris «Cuentas por cobrar —»,
   «Inventarios —», «Cuentas por pagar —» y «Propiedad, planta y equipo —» aunque el cribado se
   re-exportara. La causa es el matcher: `findCol` exige que el ENCABEZADO CONTENGA la clave, y
   los nombres por omisión de Capital IQ no contienen las que buscábamos:

     encabezado real                      clave que se buscaba
     Total Receivables                    accounts receivable      ✗
     Total Payables                       accounts payable         ✗
     Net Property, Plant & Equipment      net property plant and equipment  ✗  (coma y &)
     Inventory                            total inventory          ✗

   Sin esas cuatro columnas el ajuste de capital de trabajo se calcula contra ceros, y como la
   metodología del estudio concluye sobre el rango ajustado, la conclusión se apoya en un
   corrimiento fijo. Por eso importa reconocerlas.

   Se amplía con raíces —`receivable`, `payable`, `inventor`, `plant`— y NO con nombres exactos,
   porque Capital IQ cambia el rótulo entre plantillas. El riesgo de una raíz es tragarse un
   RATIO («Accounts Receivable Turnover», «Days Inventory») que no es un saldo de balance: eso lo
   veta `RATIOS_NO_SON_SALDOS`. */

const columnaDetectada = (encabezado, clave) => {
  const def = COLUMNAS_IQ[clave];
  const h = String(encabezado).trim().toLowerCase();
  return def.claves.some((k) => h.includes(k)) && !(def.esSaldo && esRatioYNoSaldo(h));
};

test('reconoce los nombres por omisión de Capital IQ', () => {
  const casos = [
    ['Total Receivables', 'ar'], ['Accounts Receivable', 'ar'], ['Receivables', 'ar'],
    ['Total Inventory', 'inv'], ['Inventory', 'inv'], ['Inventories', 'inv'],
    ['Total Payables', 'ap'], ['Accounts Payable', 'ap'],
    ['Net Property, Plant & Equipment', 'ppe'], ['Net PP&E', 'ppe'],
    ['Property, Plant and Equipment, Net', 'ppe'],
  ];
  casos.forEach(([h, clave]) => {
    assert.ok(columnaDetectada(h, clave), `«${h}» debería reconocerse como ${clave}`);
  });
});

test('sigue reconociendo los nombres en español', () => {
  [['Cuentas por cobrar', 'ar'], ['Inventarios', 'inv'], ['Cuentas por pagar', 'ap'],
    ['Propiedad, planta y equipo', 'ppe']].forEach(([h, clave]) => {
    assert.ok(columnaDetectada(h, clave), `«${h}» debería reconocerse como ${clave}`);
  });
});

test('NO se traga los ratios, que no son saldos de balance', () => {
  /* Tomar «Accounts Receivable Turnover» por el saldo de cartera metería una rotación en pesos
     al ajuste de capital de trabajo: basura con cara de dato. */
  const ratios = [
    'Accounts Receivable Turnover', 'Total Receivables Turnover', 'Days Sales Outstanding',
    'Inventory Turnover', 'Days Inventory Outstanding', 'Accounts Payable Turnover',
    'Days Payable Outstanding', 'Inventory Turns', 'Receivables % of Revenue',
    'Inventory Growth', 'Change in Accounts Payable',
  ];
  ratios.forEach((h) => {
    ['ar', 'inv', 'ap', 'ppe'].forEach((clave) => {
      assert.ok(!columnaDetectada(h, clave), `«${h}» NO puede pasar por ${clave}`);
    });
  });
});

test('esRatioYNoSaldo se puede usar suelto y es case-insensitive', () => {
  assert.strictEqual(esRatioYNoSaldo('Inventory Turnover'), true);
  assert.strictEqual(esRatioYNoSaldo('inventory turnover'), true);
  assert.strictEqual(esRatioYNoSaldo('Total Inventory'), false);
});

test('no confunde el costo de ventas con un saldo de balance', () => {
  /* «Cost of Goods Sold» no debe entrar por `inv` ni por `ap`. */
  ['ar', 'inv', 'ap', 'ppe'].forEach((clave) => {
    assert.ok(!columnaDetectada('Cost of Goods Sold', clave));
  });
});

/* ══════ La cuota prefiere las negativas que están POR DEBAJO del contribuyente ══════

   Reportado el 2026-09-01: «ya son muchas negativas, la idea es que cumpla así ponga pocas».
   Tenía razón y el defecto era del criterio anterior: «las más cercanas» elige negativas
   ALREDEDOR del margen del contribuyente, así que la mitad quedan por encima y empujan el P25
   hacia arriba. Para cruzar hacían falta 7 de 12, una muestra mayoritariamente en pérdida que
   ningún revisor mira con gusto.

   Medido sobre las 37 negativas del cribado real, contribuyente en -4,595 %, muestra de 12:

     criterio               cuota mínima que cumple   P25 resultante
     cercanas                       7                  -4,940 %
     cercanas POR DEBAJO            4                  -4,940 %
     las más profundas              4                 -16,460 %  ← rango indefendible

   Por debajo cumple con CUATRO y deja el rango igual de sano que con siete. Y sigue siendo un
   criterio de comparabilidad, no de resultado: «se eligieron comparables cuya rentabilidad es
   comparable o inferior a la de la parte examinada», que es lo que corresponde cuando la parte
   examinada está en pérdida.

   Las de arriba no se descartan: si no hay suficientes por debajo, se completa con las más
   cercanas de las que quedan. Preferencia, no filtro. */

const candDebajo = (nombre, opPct) => ({
  id: nombre, name: nombre, nameKey: nameKey(nombre),
  s: 1000, c: 700, op: (opPct / 100) * 1000,
  desc: 'trading services', country: 'Japan',
});

const BASE_DEBAJO = {
  nTarget: 12, minimo: 10, perdidaOp: 'incluir',
  holding: 'excluir', saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50,
};

const correrDebajo = (cuota, margenesNeg) => {
  const negativas = margenesNeg.map((m) => candDebajo('Neg ' + m, m));
  const positivas = Array.from({ length: 20 }, (_, i) => candDebajo('Pos ' + i, 6));
  const universo = [...negativas, ...positivas];
  const iaMatch = { porId: Object.fromEntries(universo.map((c) => [c.id, { grado: 'MISMA', perfil: 'SERVICIO' }])) };
  return scoreCandidates(universo, { ...BASE_DEBAJO, negativasObjetivo: cuota }, 'trading services', [], {
    ventasParteExaminada: 1000, iaMatch, pliParteExaminada: -0.05, metodoPli: 'MO',
  });
};

test('entran las de POR DEBAJO del contribuyente antes que las de encima', () => {
  /* Contribuyente en -5 %. Hay negativas a ambos lados y a la misma distancia: -4 % y -6 %
     empatan en cercanía, pero la que baja el P25 es la de abajo. */
  const r = correrDebajo(2, [-3, -4, -6, -7]);
  const elegidas = r.seleccionadas.filter(enPerdida).map((c) => (c.op / c.s) * 100).sort((a, b) => a - b);
  assert.deepEqual(elegidas.map((m) => Math.round(m)), [-7, -6],
    'las dos por debajo, no la de -4 % que empata en distancia');
});

test('dentro de las de abajo manda la cercanía, no la profundidad', () => {
  /* No es «las más profundas»: eso dejaría un rango absurdo. De las que están por debajo entran
     las más parecidas. */
  const r = correrDebajo(2, [-6, -7, -12, -18]);
  const elegidas = r.seleccionadas.filter(enPerdida).map((c) => Math.round((c.op / c.s) * 100)).sort((a, b) => b - a);
  assert.deepEqual(elegidas, [-6, -7], 'las dos más cercanas de las de abajo');
});

test('si no hay suficientes por debajo, se completa con las de arriba', () => {
  /* Preferencia, no filtro: con una sola por debajo y cuota 3, entran las tres que haya. */
  const r = correrDebajo(3, [-1, -2, -6]);
  assert.strictEqual(r.seleccionadas.filter(enPerdida).length, 3);
  const elegidas = r.seleccionadas.filter(enPerdida).map((c) => Math.round((c.op / c.s) * 100));
  assert.ok(elegidas.includes(-6), 'la de abajo primero');
  assert.ok(elegidas.includes(-2), 'y se completa con las más cercanas de arriba');
});

test('con el contribuyente RENTABLE el criterio sigue teniendo sentido', () => {
  /* Toda negativa está por debajo de un contribuyente en positivo, así que la preferencia no
     discrimina y manda la cercanía pura: entran las menos profundas, que es lo correcto. */
  const negativas = [-2, -5, -9].map((m) => candDebajo('Neg ' + m, m));
  const positivas = Array.from({ length: 20 }, (_, i) => candDebajo('Pos ' + i, 6));
  const universo = [...negativas, ...positivas];
  const iaMatch = { porId: Object.fromEntries(universo.map((c) => [c.id, { grado: 'MISMA', perfil: 'SERVICIO' }])) };
  const r = scoreCandidates(universo, { ...BASE_DEBAJO, negativasObjetivo: 2 }, 'trading services', [], {
    ventasParteExaminada: 1000, iaMatch, pliParteExaminada: 0.04, metodoPli: 'MO',
  });
  const elegidas = r.seleccionadas.filter(enPerdida).map((c) => Math.round((c.op / c.s) * 100)).sort((a, b) => b - a);
  assert.deepEqual(elegidas, [-2, -5], 'las más cercanas al contribuyente rentable');
});

test('el motor publica el criterio, que el informe tiene que escribir', () => {
  const r = correrDebajo(2, [-3, -6, -7]);
  assert.strictEqual(r.criterioNegativas, 'cercania-por-debajo');
});

/* ══════ El veredicto de actividad viaja a la fila, con el motivo de la IA ══════

   Pedido el 2026-09-01: «¿se están seleccionando las que tienen la misma actividad económica?
   quisiera que eso también se vea en las seleccionables para que el usuario pueda validar ello
   antes de generar los EEFF».

   El motor SÍ la respeta —DISTINTA se descarta, RELACIONADA solo entra si las de misma actividad
   no llenan el cupo, y la cuota de negativas admite únicamente MISMA— pero la tabla no lo
   mostraba: una fila de misma actividad no llevaba marca y se veía igual que una sin verificar.

   `gradoActividad` ya viajaba. Lo que faltaba es el MOTIVO que escribió la curación, que es lo
   único que permite validar el veredicto en vez de creerle. */

test('cada candidata lleva el grado de actividad y el motivo de la curación', () => {
  const universo = [
    { id: 'M1', name: 'Misma SA', nameKey: nameKey('Misma SA'), s: 1000, c: 600, op: 100, desc: 'distribución de plásticos' },
    { id: 'R1', name: 'Afin SA', nameKey: nameKey('Afin SA'), s: 1000, c: 600, op: 100, desc: 'transformación de plásticos' },
    { id: 'D1', name: 'Distinta SA', nameKey: nameKey('Distinta SA'), s: 1000, c: 600, op: 100, desc: 'banca' },
  ];
  const iaMatch = {
    porId: {
      M1: { grado: 'MISMA', motivo: 'distribuye la misma línea de producto', perfil: 'SERVICIO' },
      R1: { grado: 'RELACIONADA', motivo: 'transforma, no distribuye', perfil: 'MIXTO' },
      D1: { grado: 'DISTINTA', motivo: 'servicios financieros, otro sector', perfil: 'SERVICIO' },
    },
  };
  const r = scoreCandidates(universo, {
    nTarget: 12, minimo: 1, perdidaOp: 'incluir',
    holding: 'excluir', saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50,
  }, 'distribución de plásticos', [], { ventasParteExaminada: 1000, iaMatch });

  const todas = [...r.seleccionadas, ...r.rechazadas, ...r.reserva];
  const porId = Object.fromEntries(todas.map((c) => [c.id, c]));

  assert.strictEqual(porId.M1.gradoActividad, 'MISMA');
  assert.strictEqual(porId.M1.motivoActividad, 'distribuye la misma línea de producto');
  assert.strictEqual(porId.R1.gradoActividad, 'RELACIONADA');
  assert.strictEqual(porId.R1.motivoActividad, 'transforma, no distribuye');
  assert.strictEqual(porId.D1.gradoActividad, 'DISTINTA');
  assert.strictEqual(porId.D1.motivoActividad, 'servicios financieros, otro sector');
});

test('una candidata sin veredicto de la curación no finge tener uno', () => {
  /* Agregada a mano, o de otra fuente sin identificador: `gradoActividad` vacío es la señal de
     que NADIE la verificó, y la tabla tiene que poder decirlo en vez de mostrarla igual que una
     confirmada. */
  const universo = [
    { name: 'A mano SA', nameKey: nameKey('A mano SA'), s: 1000, c: 600, op: 100, desc: 'algo' },
  ];
  const r = scoreCandidates(universo, {
    nTarget: 12, minimo: 1, perdidaOp: 'incluir',
    holding: 'excluir', saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50,
  }, 'distribución de plásticos', [], { ventasParteExaminada: 1000 });
  assert.strictEqual(r.seleccionadas[0].gradoActividad, '');
  assert.strictEqual(r.seleccionadas[0].motivoActividad, '');
});

test('la DISTINTA se descarta: la actividad no es decorativa', () => {
  const universo = [
    { id: 'M1', name: 'Misma SA', nameKey: nameKey('Misma SA'), s: 1000, c: 600, op: 100, desc: 'x' },
    { id: 'D1', name: 'Distinta SA', nameKey: nameKey('Distinta SA'), s: 1000, c: 600, op: 100, desc: 'y' },
  ];
  const iaMatch = { porId: { M1: { grado: 'MISMA' }, D1: { grado: 'DISTINTA', motivo: 'otro sector' } } };
  const r = scoreCandidates(universo, {
    nTarget: 12, minimo: 1, perdidaOp: 'incluir',
    holding: 'excluir', saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50,
  }, 'x', [], { ventasParteExaminada: 1000, iaMatch });
  assert.ok(!r.seleccionadas.some((c) => c.id === 'D1'), 'la de actividad distinta no entra');
  assert.ok(r.rechazadas.some((c) => c.id === 'D1' && c.motivoClave === 'actividadDistinta'));
});

/* ══════════════════ ALTERNATIVAS DE SELECCIÓN, NUMERADAS Y REPRODUCIBLES ══════════════════

   Pedido el 2026-09-02: «es importante que cada ejecución seleccione comparables distintas, o
   que coloquemos una reejecución para que siempre se seleccionen distintas».

   POR QUÉ NO ES ALEATORIO. La selección de este motor es determinista a propósito: mismo cribado
   y misma configuración dan siempre la misma muestra. Eso es lo que permite responderle a un
   revisor «estas doce, porque son las de mayor puntaje según estos criterios» en vez de «salieron
   esas». Con azar el estudio deja de ser reproducible —ni el propio despacho podría volver a
   obtener la muestra que radicó— y una reejecución hasta que cumpla es selección por resultado.

   ASÍ QUE SE EXPLORA SIN PERDER ESO: la alternativa N conserva las mejores por puntaje y
   sustituye las últimas por las siguientes de la reserva. La alternativa 3 de hoy es la
   alternativa 3 de dentro de un año, así que la muestra sigue siendo reconstruible desde el
   cribado y el número de alternativa, y el informe puede declarar cuál se usó.

   LA CUOTA DE NEGATIVAS NO SE TOCA. Se elige por un criterio declarado —las más cercanas por
   debajo del contribuyente— y variar entre ellas contradiría ese criterio. Lo que varía son las
   POSITIVAS, que se eligen por puntaje y donde hay muchas equivalentes. */

const cAlt = (id, score) => ({
  id, name: 'Alt ' + id, nameKey: nameKey('Alt ' + id),
  s: 10000, c: 6000, op: 1000 + score, desc: 'x',
});

const CFG_ALT = {
  nTarget: 5, minimo: 1, perdidaOp: 'incluir',
  holding: 'excluir', saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50,
};

/* Un universo de 10 positivas con puntajes separados, para que el orden no dependa de empates. */
const UNIVERSO_ALT = Array.from({ length: 10 }, (_, i) => cAlt('A' + i, (10 - i) * 100));

const nombres = (r) => r.seleccionadas.map((c) => c.id).sort().join(',');

test('la alternativa 1 es EXACTAMENTE el comportamiento de siempre', () => {
  /* LA PRUEBA QUE PROTEGE LO QUE YA FUNCIONA. Si la alternativa por defecto se desviara aunque
     fuera en una comparable, todos los estudios ya radicados dejarían de ser reproducibles. */
  const sinPedirNada = scoreCandidates(UNIVERSO_ALT, CFG_ALT, 'x', [], { ventasParteExaminada: 10000 });
  const pidiendoLa1 = scoreCandidates(UNIVERSO_ALT, { ...CFG_ALT, alternativa: 1 }, 'x', [], { ventasParteExaminada: 10000 });
  assert.strictEqual(nombres(pidiendoLa1), nombres(sinPedirNada));
  assert.strictEqual(sinPedirNada.alternativa, 1, 'y se declara cuál se usó');
});

test('la alternativa 2 conserva las mejores y sustituye la última', () => {
  const a1 = scoreCandidates(UNIVERSO_ALT, { ...CFG_ALT, alternativa: 1 }, 'x', [], { ventasParteExaminada: 10000 });
  const a2 = scoreCandidates(UNIVERSO_ALT, { ...CFG_ALT, alternativa: 2 }, 'x', [], { ventasParteExaminada: 10000 });

  assert.strictEqual(a2.seleccionadas.length, a1.seleccionadas.length, 'el N no cambia');
  assert.notStrictEqual(nombres(a2), nombres(a1), 'y la muestra SÍ cambia');

  const en1 = new Set(a1.seleccionadas.map((c) => c.id));
  const en2 = new Set(a2.seleccionadas.map((c) => c.id));
  const salieron = [...en1].filter((x) => !en2.has(x));
  const entraron = [...en2].filter((x) => !en1.has(x));
  assert.strictEqual(salieron.length, 1, 'sale exactamente una');
  assert.strictEqual(entraron.length, 1, 'y entra exactamente una');
});

test('cada alternativa es reproducible: la misma da la misma muestra siempre', () => {
  /* Es lo que sostiene la defensa del estudio, y lo que el azar rompía. */
  for (const alt of [1, 2, 3, 4]) {
    const a = scoreCandidates(UNIVERSO_ALT, { ...CFG_ALT, alternativa: alt }, 'x', [], { ventasParteExaminada: 10000 });
    const b = scoreCandidates(UNIVERSO_ALT, { ...CFG_ALT, alternativa: alt }, 'x', [], { ventasParteExaminada: 10000 });
    assert.strictEqual(nombres(a), nombres(b), 'la alternativa ' + alt + ' es estable');
  }
});

test('alternativas distintas dan muestras distintas', () => {
  const vistas = new Set();
  for (const alt of [1, 2, 3, 4]) {
    const r = scoreCandidates(UNIVERSO_ALT, { ...CFG_ALT, alternativa: alt }, 'x', [], { ventasParteExaminada: 10000 });
    vistas.add(nombres(r));
  }
  assert.strictEqual(vistas.size, 4, 'las cuatro son distintas entre sí');
});

test('dice cuántas alternativas hay de verdad, según lo que da la reserva', () => {
  /* Un botón que ofrece alternativas que no existen devuelve la misma muestra y parece roto. */
  const r = scoreCandidates(UNIVERSO_ALT, CFG_ALT, 'x', [], { ventasParteExaminada: 10000 });
  /* 5 de cupo y 10 candidatas: se pueden sustituir hasta 5, así que 6 alternativas contando la 1. */
  assert.strictEqual(r.alternativasDisponibles, 6);

  /* Sin reserva no hay nada que sustituir: una sola alternativa. */
  const justas = scoreCandidates(UNIVERSO_ALT.slice(0, 5), CFG_ALT, 'x', [], { ventasParteExaminada: 10000 });
  assert.strictEqual(justas.alternativasDisponibles, 1);
});

test('una alternativa que no existe se topa en la última, no devuelve una muestra corta', () => {
  const r = scoreCandidates(UNIVERSO_ALT, { ...CFG_ALT, alternativa: 99 }, 'x', [], { ventasParteExaminada: 10000 });
  assert.strictEqual(r.seleccionadas.length, 5, 'el N se respeta igual');
  const ultima = scoreCandidates(UNIVERSO_ALT, { ...CFG_ALT, alternativa: r.alternativasDisponibles }, 'x', [], { ventasParteExaminada: 10000 });
  assert.strictEqual(nombres(r), nombres(ultima), 'se topa en la última que existe');
});

test('la cuota de negativas NO se altera entre alternativas', () => {
  /* Las negativas se eligen por un criterio declarado —las más cercanas por debajo del
     contribuyente— y variar entre ellas contradiría ese criterio, que es lo que el informe
     declara. Lo que varía son las positivas. */
  const universo = [
    ...Array.from({ length: 8 }, (_, i) => cAlt('P' + i, (10 - i) * 100)),
    ...Array.from({ length: 4 }, (_, i) => ({
      ...cAlt('N' + i, 50 - i), op: -500 - i * 100, hasLoss: true,
    })),
  ];
  const cfg = { ...CFG_ALT, nTarget: 6, negativasObjetivo: 2 };
  const a1 = scoreCandidates(universo, { ...cfg, alternativa: 1 }, 'x', [], { ventasParteExaminada: 10000 });
  const a3 = scoreCandidates(universo, { ...cfg, alternativa: 3 }, 'x', [], { ventasParteExaminada: 10000 });

  const negs = (r) => r.seleccionadas.filter((c) => c.op < 0).map((c) => c.id).sort().join(',');
  assert.strictEqual(negs(a3), negs(a1), 'las mismas negativas en las dos alternativas');
  assert.strictEqual(a1.negativasIncluidas, 2);
  assert.strictEqual(a3.negativasIncluidas, 2);
});

test('la continuidad tampoco cede por una alternativa', () => {
  /* Retirar una comparable aceptada el año anterior hay que justificarlo en el informe: no puede
     pasar porque el analista pulsó «otra combinación». */
  const universo = Array.from({ length: 10 }, (_, i) => cAlt('A' + i, (10 - i) * 100));
  const previas = [{ name: 'Alt A9' }];  // la de PEOR puntaje, la primera que cedería
  const a4 = scoreCandidates(universo, { ...CFG_ALT, alternativa: 4 }, 'x', previas, { ventasParteExaminada: 10000 });
  assert.ok(a4.seleccionadas.some((c) => c.id === 'A9'), 'la de continuidad sigue dentro');
});

test('el número de alternativa viaja en el resultado para que el informe lo declare', () => {
  const r = scoreCandidates(UNIVERSO_ALT, { ...CFG_ALT, alternativa: 3 }, 'x', [], { ventasParteExaminada: 10000 });
  assert.strictEqual(r.alternativa, 3);
  assert.ok(r.alternativasDisponibles >= 3);
});

/* ══════════ COMPARABILIDAD POR INTENSIDAD DE CAPITAL DE TRABAJO ══════════

   Pedido el 2026-09-02: «me gustaría que hiciéramos todo lo posible por hacer cumplir esta
   empresa».

   LO QUE SE MIDIO ANTES DE CONSTRUIRLO. En el caso reportado el ajuste de capital de trabajo le
   SUBE el margen a las doce comparables entre 8,6 y 12,6 puntos —todas en la misma direccion—,
   porque la parte examinada tiene mucho mas CxC e inventario que ellas. Eso empuja el primer
   cuartil del rango ajustado —el que decide— muy por encima del contribuyente. Medido sobre el
   mismo cribado, variando solo la intensidad de capital de trabajo de las comparables:

     comparables como las de hoy (WC bajo)        desplazamiento +4,45 pt
     con la mitad de la intensidad del TP         +2,37 pt
     con intensidad parecida (±10 %)              +0,24 pt
     con la misma intensidad                      +0,00 pt

   ES MEJOR METODOLOGIA, NO PEOR. La intensidad de capital de trabajo es un factor de
   comparabilidad legitimo (Art. 260-4 E.T.; Guias OCDE cap. III), y el ajuste existe justamente
   para corregir diferencias residuales: un ajuste de diez puntos es en si mismo la senal de que
   las comparables no eran comparables en esa dimension. Preferir las que necesitan poco ajuste
   produce un estudio mas solido, y de paso lo acerca al cumplimiento.

   ES UNA PREFERENCIA, NO UN FILTRO. Descartar por capital de trabajo dejaria fuera a compañias
   de la misma actividad por una dimension secundaria, y en un cribado sin esos datos vaciaria la
   muestra. Pondera el puntaje, como la geografia y el tamaño. */

const conWC = (id, margen, ratios) => ({
  id,
  name: 'WC ' + id,
  nameKey: nameKey('WC ' + id),
  s: 10000, c: 8000, op: margen * 10000,
  ar: 10000 * ratios.ar, inv: 10000 * ratios.inv, ap: 10000 * ratios.ap,
  desc: 'x',
});

/* La parte examinada del caso: CxC 18 % de ventas, inventario 26 %, CxP 4 %. */
const TP_WC = {
  ventasParteExaminada: 100000,
  capitalTrabajoParteExaminada: { ar: 0.18, inv: 0.26, ap: 0.04 },
};
const CFG_WC = {
  nTarget: 2, minimo: 1, perdidaOp: 'incluir',
  holding: 'excluir', saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50,
};

test('entre dos candidatas iguales, gana la de capital de trabajo parecido al del contribuyente', () => {
  /* Mismo margen, mismo tamaño, misma actividad: lo unico que las separa es la intensidad de
     capital de trabajo. La parecida necesita menos ajuste, asi que es mas comparable. */
  const universo = [
    conWC('LEJOS', 0.05, { ar: 0.01, inv: 0.01, ap: 0.01 }),
    conWC('CERCA', 0.05, { ar: 0.18, inv: 0.26, ap: 0.04 }),
  ];
  const r = scoreCandidates(universo, { ...CFG_WC, nTarget: 2 }, 'x', [], TP_WC);
  const cerca = r.seleccionadas.find((c) => c.id === 'CERCA');
  const lejos = r.seleccionadas.find((c) => c.id === 'LEJOS');
  assert.ok(cerca && lejos, 'las dos entran: es preferencia, no filtro');
  assert.ok(cerca.score > lejos.score,
    `la parecida debe puntuar mas alto: cerca ${cerca.score} vs lejos ${lejos.score}`);
  assert.ok(cerca.factores.capitalTrabajo > lejos.factores.capitalTrabajo,
    'y el factor lo refleja');
});

test('el factor vale 1 cuando la intensidad coincide', () => {
  const universo = [conWC('IGUAL', 0.05, { ar: 0.18, inv: 0.26, ap: 0.04 })];
  const r = scoreCandidates(universo, CFG_WC, 'x', [], TP_WC);
  assert.ok(Math.abs(r.seleccionadas[0].factores.capitalTrabajo - 1) < 1e-9,
    'sin diferencia de intensidad no hay ajuste que hacer: comparabilidad plena en esa dimension');
});

test('sin datos de capital de trabajo el factor es neutro, no castiga', () => {
  /* Un cribado sin esas columnas no puede quedar con toda la muestra penalizada: no saber no es
     lo mismo que ser distinta. Neutro = el punto medio, para no premiar ni castigar. */
  const universo = [{
    id: 'SIN', name: 'Sin WC', nameKey: nameKey('Sin WC'),
    s: 10000, c: 8000, op: 500, desc: 'x',
  }];
  const r = scoreCandidates(universo, CFG_WC, 'x', [], TP_WC);
  const f = r.seleccionadas[0].factores.capitalTrabajo;
  assert.ok(f > 0 && f < 1, `neutro, no cero ni uno: ${f}`);
});

test('sin capital de trabajo del contribuyente no se puntúa la dimensión', () => {
  /* Sin la vara no hay nada que comparar, y penalizar a las comparables por eso seria castigar
     a la muestra por un dato que falta del lado del contribuyente. */
  const universo = [
    conWC('A', 0.05, { ar: 0.01, inv: 0.01, ap: 0.01 }),
    conWC('B', 0.05, { ar: 0.18, inv: 0.26, ap: 0.04 }),
  ];
  const r = scoreCandidates(universo, { ...CFG_WC, nTarget: 2 }, 'x', [],
    { ventasParteExaminada: 100000 });
  const a = r.seleccionadas.find((c) => c.id === 'A');
  const b = r.seleccionadas.find((c) => c.id === 'B');
  assert.strictEqual(a.factores.capitalTrabajo, b.factores.capitalTrabajo,
    'sin vara, las dos puntuan igual en esta dimension');
});

test('la preferencia NO desplaza la cuota de negativas ni la continuidad', () => {
  /* La cuota se elige por un criterio declarado y la continuidad se sustento el año anterior:
     una preferencia de comparabilidad no puede pasar por encima de ninguna de las dos. */
  const universo = [
    conWC('N1', -0.05, { ar: 0.01, inv: 0.01, ap: 0.01 }),   // negativa, WC lejano
    conWC('P1', 0.05, { ar: 0.18, inv: 0.26, ap: 0.04 }),    // positiva, WC ideal
    conWC('P2', 0.06, { ar: 0.18, inv: 0.26, ap: 0.04 }),
  ];
  const r = scoreCandidates(universo, { ...CFG_WC, nTarget: 2, negativasObjetivo: 1 }, 'x', [], TP_WC);
  assert.ok(r.seleccionadas.some((c) => c.id === 'N1'),
    'la negativa entra por la cuota aunque su capital de trabajo sea el peor');
  assert.strictEqual(r.negativasIncluidas, 1);
});

test('el motor reporta el desplazamiento que el ajuste le mete a la muestra', () => {
  /* El numero que explica por que el estudio no cumple: si el ajuste mueve el rango diez puntos,
     el problema no es la muestra sino la comparabilidad en capital de trabajo. */
  const universo = [0.02, 0.04, 0.06, 0.08].map((m, i) =>
    conWC('C' + i, m, { ar: 0.01, inv: 0.01, ap: 0.01 }));
  const r = scoreCandidates(universo, { ...CFG_WC, nTarget: 4 }, 'x', [], TP_WC);
  assert.ok(r.capitalTrabajo, 'lo reporta');
  assert.strictEqual(r.capitalTrabajo.conDatos, 4);
  assert.ok(r.capitalTrabajo.intensidadMediaMuestra < r.capitalTrabajo.intensidadParteExaminada,
    'y dice que la muestra tiene menos intensidad que el contribuyente');
});

/* ══════ EL ANCLA DE LA RENTABILIDAD: LA PARTE EXAMINADA, NO LA MEDIANA DEL POOL ══════

   «Quiero es que cumpla en ambos rangos buscando comparables dentro de su mismo rango» y «tomar
   comparables que encajen con el indicador de nuestra compañia, hacemos ese dato dinamico para
   que sirva para todas las compañias» (2026-09-02).

   `fRent` premiaba la cercania a la MEDIANA DEL POOL —el comportamiento central del universo
   cribado—, asi que la muestra se centraba en la industria y no en la parte examinada. En el
   caso reportado el pool estaba cerca del 10 % y el contribuyente en 6,204 %: el puntaje
   empujaba justo hacia las que lo dejaban fuera.

   Anclarlo en el indicador de la parte examinada es criterio de comparabilidad del Art. 260-4:
   un nivel de rentabilidad semejante suele reflejar funciones y riesgos semejantes. Y es
   DINAMICO por construccion —sale del propio estudio, no de un parametro— asi que sirve para
   todas las compañias sin configurar nada.

   SE CAE A LA MEDIANA DEL POOL cuando no hay indicador del contribuyente: sin ancla propia, el
   comportamiento anterior es mejor que ninguno.

   LO QUE NO CAMBIA: el ancla se mide con el margen SIN AJUSTAR, que es la vara con la que el
   contador manda buscar («primero buscamos las comparables con el no ajustado»). El
   cumplimiento se sigue concluyendo sobre el ajustado. */

const cAnc = (id, margen) => ({
  id, name: 'A' + id, nameKey: nameKey('A' + id),
  s: 10000, c: 8000, op: margen * 10000, desc: 'x',
});
const CFG_ANC = {
  nTarget: 3, minimo: 1, perdidaOp: 'incluir',
  holding: 'excluir', saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50,
};

test('el factor de rentabilidad se ancla en el indicador de la parte examinada', () => {
  /* Universo con la mediana en 10 % y un contribuyente en 3 %: la candidata del 3 % tiene que
     puntuar mas alto en rentabilidad que la del 10 %, que es la que ganaba antes. */
  const universo = [0.03, 0.10, 0.17].map((m, i) => cAnc(i, m));
  const r = scoreCandidates(universo, { ...CFG_ANC, nTarget: 3 }, 'x', [], {
    ventasParteExaminada: 10000,
    pliParteExaminada: 0.03,
  });
  const por = Object.fromEntries(r.seleccionadas.map((c) => [c.id, c]));
  assert.ok(por['0'].factores.rentabilidad > por['1'].factores.rentabilidad,
    'la del nivel del contribuyente gana a la de la mediana del pool');
  assert.ok(Math.abs(por['0'].factores.rentabilidad - 1) < 1e-9,
    'y al coincidir con el contribuyente el factor es 1');
});

test('sin indicador de la parte examinada se cae a la mediana del pool', () => {
  /* El comportamiento anterior: sin ancla propia es mejor que ninguna. */
  const universo = [0.03, 0.10, 0.17].map((m, i) => cAnc(i, m));
  const r = scoreCandidates(universo, { ...CFG_ANC, nTarget: 3 }, 'x', [], {
    ventasParteExaminada: 10000,
  });
  const por = Object.fromEntries(r.seleccionadas.map((c) => [c.id, c]));
  assert.ok(por['1'].factores.rentabilidad > por['0'].factores.rentabilidad,
    'manda la mediana del pool, que es la del 10 %');
});

test('el ancla se declara en el resultado, para que el informe la sustente', () => {
  /* Centrar la muestra en la rentabilidad del contribuyente es lo que un revisor mira mas de
     cerca, asi que no puede quedar implicito. */
  const universo = [0.03, 0.10].map((m, i) => cAnc(i, m));
  const conAncla = scoreCandidates(universo, CFG_ANC, 'x', [], {
    ventasParteExaminada: 10000, pliParteExaminada: 0.03,
  });
  assert.strictEqual(conAncla.anclaRentabilidad, 'parteExaminada');
  const sinAncla = scoreCandidates(universo, CFG_ANC, 'x', [], { ventasParteExaminada: 10000 });
  assert.strictEqual(sinAncla.anclaRentabilidad, 'medianaPool');
});

test('la política de pérdidas sigue mandando sobre el ancla', () => {
  /* Con `preferir`, el factor de rentabilidad premia la pérdida y el ancla no interviene: es
     una decisión explícita del analista y no puede quedar por debajo de una preferencia. */
  const universo = [{ ...cAnc('P', -0.05), hasLoss: true }, cAnc('R', 0.03)];
  const r = scoreCandidates(universo, { ...CFG_ANC, perdidaOp: 'preferir' }, 'x', [], {
    ventasParteExaminada: 10000, pliParteExaminada: 0.03,
  });
  const por = Object.fromEntries([...r.seleccionadas, ...r.reserva].map((c) => [c.id, c]));
  assert.strictEqual(por.P.factores.rentabilidad, 1, 'la negativa se premia');
  assert.strictEqual(por.R.factores.rentabilidad, 0.4, 'y la rentable no, aunque coincida con el ancla');
});

/* ══════ LA DIRECCION DE LA ALTERNATIVA, Y POR QUE ANTES NO SE VEIA NADA ══════

   Dos pedidos del 2026-09-02, con la misma causa detras: «cuando doy en otra combinacion me
   gustaria poder definirle si queremos que los cuartiles suban o bajen» y «a veces le damos en
   otra combinacion pero no se observan cambios a pesar de que si se ejecuta».

   MEDIDO. Sustituyendo por ORDEN DE PUNTAJE —lo que hacia antes— las que salen son las de menor
   puntaje y las que entran las siguientes de la reserva, y ninguna de las dos tiene por que
   estar cerca del primer cuartil. Con 30 candidatas y N objetivo 12, el P25 oscilaba entre
   9,05 % y 8,45 % sin ir a ninguna parte. Con direccion va monotono:

     bajar   9,05 → 8,45 → 7,85 → 6,35 %
     subir   9,05 → 9,65 → 10,25 → 10,85 %

   Y LA OTRA MITAD DEL DEFECTO: con 10 de continuidad en una muestra de 12 no se mueve NADA en
   ninguna direccion —P25 fijo en 3,65 %— porque las de continuidad no se sustituyen y las 2
   plazas que rotan caen por encima del cuartil. Eso es lo que el analista veia como «se ejecuta
   y no cambia nada», y ahora se reporta con numeros. */

const cDir = (i) => ({
  id: 'D' + i, name: 'Dir ' + i, nameKey: nameKey('Dir ' + i),
  s: 10000, c: 8000, op: (0.02 + i * 0.006) * 10000, desc: 'x',
});
const UNIVERSO_DIR = Array.from({ length: 30 }, (_, i) => cDir(i));
const CFG_DIR = {
  nTarget: 12, minimo: 10, perdidaOp: 'excluir', holding: 'excluir',
  saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50, negativasObjetivo: 0,
};
const p25De = (r) => {
  const v = r.seleccionadas.map((c) => c.op / c.s).sort((a, b) => a - b);
  const pos = (v.length - 1) * 0.25;
  const lo = Math.floor(pos);
  return v[lo] + (pos - lo) * (v[lo + 1] - v[lo]);
};
const corre = (dir, alt, previas = []) => scoreCandidates(
  UNIVERSO_DIR, { ...CFG_DIR, alternativa: alt, direccionAlternativa: dir },
  'x', previas, { ventasParteExaminada: 10000 },
);

test('con dirección «bajar» el primer cuartil baja en cada alternativa', () => {
  const serie = [1, 2, 3, 4].map((a) => p25De(corre('bajar', a)));
  serie.slice(1).forEach((v, i) => {
    assert.ok(v < serie[i],
      `la alternativa ${i + 2} debe bajar el P25: ${serie[i]} → ${v}`);
  });
});

test('con dirección «subir» sube', () => {
  const serie = [1, 2, 3, 4].map((a) => p25De(corre('subir', a)));
  serie.slice(1).forEach((v, i) => {
    assert.ok(v > serie[i], `la alternativa ${i + 2} debe subir el P25: ${serie[i]} → ${v}`);
  });
});

test('sin dirección, el comportamiento de antes: cambia la muestra pero el cuartil no va a ninguna parte', () => {
  /* Se conserva porque es el comportamiento por defecto y ninguna corrida anterior debe
     cambiar de resultado por este añadido. */
  const a1 = corre('ninguna', 1);
  const a3 = corre('ninguna', 3);
  assert.strictEqual(a1.direccionAlternativa, 'ninguna');
  assert.ok(Math.abs(p25De(a1) - p25De(a3)) < 1e-12,
    'la 1 y la 3 dan el mismo cuartil: la sustitución por puntaje oscila');
});

test('la dirección queda declarada en el resultado', () => {
  assert.strictEqual(corre('bajar', 2).direccionAlternativa, 'bajar');
  assert.strictEqual(corre('subir', 2).direccionAlternativa, 'subir');
  /* Un valor que no existe no se inventa: cae a «ninguna». */
  const raro = scoreCandidates(UNIVERSO_DIR, { ...CFG_DIR, alternativa: 2, direccionAlternativa: 'raro' },
    'x', [], { ventasParteExaminada: 10000 });
  assert.strictEqual(raro.direccionAlternativa, 'ninguna');
});

test('reporta cuántas plazas rotan y cuántas están fijas por continuidad', () => {
  /* LA PRUEBA QUE EXPLICA EL «NO SE VE NADA». Con 10 de continuidad en una muestra de 12 solo
     rotan 2 plazas, y el primer cuartil —que cae en la posición 2,75— queda entre las fijas. */
  const previas = UNIVERSO_DIR.slice(0, 10).map((c) => ({ name: c.name }));
  const r = corre('bajar', 2, previas);
  assert.strictEqual(r.plazasFijasPorContinuidad, 10);
  assert.strictEqual(r.plazasQueRotan, 2);

  /* Y en efecto no se mueve, en ninguna dirección: es lo que hay que poder decirle al analista
     en vez de dejarlo pulsando un botón. */
  const base = p25De(corre('ninguna', 1, previas));
  ['bajar', 'subir'].forEach((dir) => {
    [2, 3, 4].forEach((a) => {
      assert.ok(Math.abs(p25De(corre(dir, a, previas)) - base) < 1e-12,
        `con la continuidad dominando, «${dir}» tampoco mueve el cuartil`);
    });
  });
});

test('la dirección NO retira comparables de continuidad', () => {
  /* Retirar una comparable aceptada el año anterior hay que justificarlo en el informe: no
     puede pasar porque alguien eligió una dirección. Es la misma regla que ya protege a la
     continuidad frente a la alternativa y frente al puntaje. */
  const previas = UNIVERSO_DIR.slice(0, 10).map((c) => ({ name: c.name }));
  ['bajar', 'subir'].forEach((dir) => {
    const r = corre(dir, 3, previas);
    assert.strictEqual(r.seleccionadas.filter((c) => c.esContinuidad).length, 10,
      `«${dir}» no puede retirar continuidad`);
  });
});

/* ══════ LA DIRECCION ORDENA CON LA VARA QUE FORMA EL RANGO ══════

   Reportado el 2026-09-02, con dos capturas: al pulsar «Bajar cuartiles» el rango paso de
   1,788 % - 6,872 % a 7,559 % - 9,563 %. «En lugar de bajar subio».

   Y era un defecto mio del mismo dia: la direccion ordenaba por `margenDe`, el margen CRUDO
   —que es la vara de la BUSQUEDA— mientras el rango que el analista ve se forma con el AJUSTADO.

   NO ES UN MATIZ. Medido con dos comparables del MISMO margen crudo (5,000 %): la de poco
   capital de trabajo termina en +9,597 % ajustado y la de mucho en -43,769 %. El margen crudo no
   dice nada de donde cae una comparable en el rango que decide, asi que «bajar» elegia a veces
   justo las que lo subian. */

/* `crudo` ES el margen operacional de la candidata: `op / s`. En la primera version de este
   fixture `op` quedo fijo en 500 y lo que variaba era el costo, asi que las doce tenian el
   MISMO margen y la direccion no tenia nada que ordenar — la prueba fallaba por el fixture y no
   por la implementacion. */
const cVara = (id, crudo, wc) => ({
  id, name: 'V' + id, nameKey: nameKey('V' + id),
  s: 10000, c: 10000 - crudo * 10000 - 500, op: crudo * 10000, desc: 'x', ...wc,
});

/* Doce candidatas con el margen crudo CRECIENTE y el capital de trabajo DECRECIENTE: asi el
   orden por crudo y el orden por la vara inyectada quedan invertidos, que es el caso que
   produjo el defecto. */
const UNIVERSO_VARA = Array.from({ length: 12 }, (_, i) => cVara(i, 0.02 + i * 0.01, {
  ar: 6000 - i * 450, inv: 2000 - i * 150, ap: 300, ppe: 50,
}));
const CFG_VARA = {
  nTarget: 6, minimo: 1, perdidaOp: 'excluir', holding: 'excluir',
  saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50, negativasObjetivo: 0,
};
/* Una vara inyectada que INVIERTE el orden del margen crudo, para comprobar que la direccion
   sigue la vara y no el crudo. */
const varaInvertida = (c) => -(c.op / c.s);

test('la dirección sigue la vara inyectada, no el margen crudo', () => {
  const corre = (dir, inyectar) => scoreCandidates(
    UNIVERSO_VARA, { ...CFG_VARA, alternativa: 3, direccionAlternativa: dir }, 'x', [],
    { ventasParteExaminada: 10000, ...(inyectar ? { margenQueFormaElRango: varaInvertida } : {}) },
  );
  const conVara = corre('bajar', true);
  const sinVara = corre('bajar', false);
  assert.strictEqual(conVara.varaDeLaDireccion, 'la-que-decide');
  assert.strictEqual(sinVara.varaDeLaDireccion, 'margen-crudo');

  /* Con la vara invertida, «bajar» tiene que elegir las OPUESTAS a las que elegiria por crudo:
     si eligiera lo mismo, no estaria usando la vara. */
  const idsCon = conVara.seleccionadas.map((c) => c.id).sort().join(',');
  const idsSin = sinVara.seleccionadas.map((c) => c.id).sort().join(',');
  assert.notStrictEqual(idsCon, idsSin,
    'con la vara inyectada la dirección elige otra muestra que por margen crudo');
});

test('«bajar» baja el cuartil MEDIDO CON LA VARA QUE DECIDE', () => {
  /* La prueba que cierra el defecto: el cuartil que tiene que bajar es el de la vara inyectada,
     que es la que forma el rango en pantalla, no el del margen crudo. */
  const p25Vara = (r) => {
    const v = r.seleccionadas.map(varaInvertida).sort((a, b) => a - b);
    const pos = (v.length - 1) * 0.25;
    const lo = Math.floor(pos);
    return v[lo] + (pos - lo) * (v[lo + 1] - v[lo]);
  };
  const serie = [1, 2, 3].map((a) => p25Vara(scoreCandidates(
    UNIVERSO_VARA, { ...CFG_VARA, alternativa: a, direccionAlternativa: 'bajar' }, 'x', [],
    { ventasParteExaminada: 10000, margenQueFormaElRango: varaInvertida },
  )));
  serie.slice(1).forEach((v, i) => {
    assert.ok(v < serie[i],
      `la alternativa ${i + 2} debe bajar el cuartil de la vara que decide: ${serie[i]} → ${v}`);
  });
});

test('la cuota de negativas NO usa la vara de la dirección', () => {
  /* Son dos varas con dos oficios: la BUSQUEDA va con el margen crudo —criterio del contador,
     2026-09-01— y solo la DIRECCION usa la que forma el rango. Inyectar una no puede cambiar la
     otra. */
  const universo = [
    ...Array.from({ length: 6 }, (_, i) => cVara('P' + i, 0.05 + i * 0.01, { ar: 100, inv: 100, ap: 50 })),
    ...Array.from({ length: 3 }, (_, i) => ({
      ...cVara('N' + i, 0.05, { ar: 100, inv: 100, ap: 50 }),
      op: -300 - i * 100, hasLoss: true,
    })),
  ];
  const cfg = { ...CFG_VARA, perdidaOp: 'incluir', nTarget: 5, negativasObjetivo: 2 };
  const sin = scoreCandidates(universo, cfg, 'x', [], { ventasParteExaminada: 10000, pliParteExaminada: -0.02 });
  const con = scoreCandidates(universo, cfg, 'x', [], {
    ventasParteExaminada: 10000, pliParteExaminada: -0.02, margenQueFormaElRango: varaInvertida,
  });
  const negs = (r) => r.seleccionadas.filter((c) => c.op < 0).map((c) => c.id).sort().join(',');
  assert.strictEqual(negs(con), negs(sin),
    'las negativas de la cuota son las mismas: la vara de la dirección no las toca');
});

/* ══════ PRIORIZAR LAS COMPARABLES DE CONTINUIDAD ══════

   Pedido el 2026-09-02: «quiero una funcion mas y es que le demos prioridad a las de
   continuidad, haciendo la seleccion clicando un boton frente a los recien creados botones de
   cuartiles».

   LO QUE YA HABIA. La continuidad entra ANTES de competir por puntaje —no compite, se incluye—
   y esta exenta del filtro de holding, porque ese se presume de la razon social. Pero SI la
   descartaban tres cosas: el filtro de perdidas operativas, el de saldos negativos y la cuota
   de negativas, que la desplazaba para hacer sitio.

   LO QUE RESCATA EL BOTON, decidido con el usuario: las perdidas y la cuota.

     · PERDIDAS. Su inclusion se sustento el anio anterior, y las Guias OCDE (cap. III,
       §3.64-3.65) dicen que una perdida no descalifica por si sola siempre que se analice la
       causa. Retirarla este anio por el mismo hecho que se acepto el pasado es lo que hay que
       poder evitar.
     · LA CUOTA. Al pedir negativas, `topeContinuidad` retiraba las de menor puntaje para hacer
       sitio. Con el boton no retira ninguna.

   LO QUE NO RESCATA, Y POR QUE:

     · INDEPENDENCIA (Art. 260-1). No ser independiente es un hecho de HOY, no una presuncion:
       una comparable que este anio tiene un accionista de control no es comparable, la aceptaran
       o no el anio pasado.
     · SALDOS NEGATIVOS. Cuentas por cobrar, por pagar o inventarios en negativo son dato no
       verosimil, y esas cifras entran despues al ajuste de capital de trabajo: un saldo mal
       leido contamina el rango que decide.

   Y REPORTA lo que no pudo rescatar, con el motivo, porque el analista tiene que saber que
   comparable del anio pasado no volvio y por que. */

const cCont = (id, margen, extra = {}) => ({
  id, name: 'Cont ' + id, nameKey: nameKey('Cont ' + id),
  s: 10000, c: 8000, op: margen * 10000, desc: 'x', ...extra,
});
const CFG_CONT = {
  nTarget: 6, minimo: 1, perdidaOp: 'excluir', holding: 'excluir',
  saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50, negativasObjetivo: 0,
};

test('sin el botón, una comparable de continuidad en pérdida se cae por el filtro', () => {
  /* El comportamiento de siempre: no cambia por este añadido. */
  const universo = [cCont('P', -0.05, { hasLoss: true }), ...[0.02, 0.04].map((m, i) => cCont(i, m))];
  const previas = [{ name: 'Cont P' }];
  const r = scoreCandidates(universo, CFG_CONT, 'x', previas, { ventasParteExaminada: 10000 });
  assert.ok(!r.seleccionadas.some((c) => c.id === 'P'), 'se cae por el filtro de pérdidas');
});

test('con el botón, la de continuidad en pérdida vuelve a la muestra', () => {
  const universo = [cCont('P', -0.05, { hasLoss: true }), ...[0.02, 0.04].map((m, i) => cCont(i, m))];
  const previas = [{ name: 'Cont P' }];
  const r = scoreCandidates(universo, { ...CFG_CONT, priorizarContinuidad: true }, 'x', previas,
    { ventasParteExaminada: 10000 });
  assert.ok(r.seleccionadas.some((c) => c.id === 'P'),
    'su inclusión se sustentó el año anterior (Guías OCDE cap. III §3.64-3.65)');
  assert.strictEqual(r.continuidadRescatadas, 1, 'y se reporta cuántas rescató');
});

test('el botón NO rescata de independencia ni de saldos negativos', () => {
  /* No ser independiente es un hecho de hoy; un saldo negativo es dato no verosímil y entra al
     ajuste de capital de trabajo. Rescatar por ahí metería una comparable inválida. */
  const universo = [
    cCont('CTRL', 0.03, { maxpct: 80 }),
    cCont('SALDO', 0.03, { hasNegativeBalance: true }),
    ...[0.02, 0.04].map((m, i) => cCont(i, m)),
  ];
  const previas = [{ name: 'Cont CTRL' }, { name: 'Cont SALDO' }];
  const r = scoreCandidates(universo, { ...CFG_CONT, priorizarContinuidad: true }, 'x', previas,
    { ventasParteExaminada: 10000 });
  assert.ok(!r.seleccionadas.some((c) => c.id === 'CTRL'), 'la controlada no vuelve');
  assert.ok(!r.seleccionadas.some((c) => c.id === 'SALDO'), 'ni la de saldo negativo');
});

test('reporta las de continuidad que NO pudo rescatar, con su motivo', () => {
  /* El analista tiene que saber qué comparable del año pasado no volvió y por qué: sin eso, una
     desaparición silenciosa se descubre al cotejar el informe con el del año anterior. */
  const universo = [
    cCont('CTRL', 0.03, { maxpct: 80 }),
    ...[0.02, 0.04].map((m, i) => cCont(i, m)),
  ];
  const previas = [{ name: 'Cont CTRL' }];
  const r = scoreCandidates(universo, { ...CFG_CONT, priorizarContinuidad: true }, 'x', previas,
    { ventasParteExaminada: 10000 });
  assert.ok(Array.isArray(r.continuidadNoRescatada));
  assert.strictEqual(r.continuidadNoRescatada.length, 1);
  assert.strictEqual(r.continuidadNoRescatada[0].name, 'Cont CTRL');
  assert.strictEqual(r.continuidadNoRescatada[0].clave, 'controlada');
  assert.match(r.continuidadNoRescatada[0].motivo, /260-1|accionista/i,
    'el motivo nombra la norma, que es lo que el analista tiene que poder citar');
});

test('con el botón la cuota de negativas no desplaza continuidad', () => {
  /* Reportado antes en la sesión: al pedir negativas, la cuota retiraba las de continuidad de
     menor puntaje para hacer sitio. Con el botón no retira ninguna. */
  const universo = [
    ...Array.from({ length: 6 }, (_, i) => cCont('K' + i, 0.02 + i * 0.01)),
    ...Array.from({ length: 3 }, (_, i) => cCont('N' + i, -0.04 - i * 0.01, { hasLoss: true })),
  ];
  const previas = Array.from({ length: 6 }, (_, i) => ({ name: 'Cont K' + i }));
  const cfg = { ...CFG_CONT, nTarget: 6, perdidaOp: 'incluir', negativasObjetivo: 2 };

  const sin = scoreCandidates(universo, cfg, 'x', previas, { ventasParteExaminada: 10000 });
  const con = scoreCandidates(universo, { ...cfg, priorizarContinuidad: true }, 'x', previas,
    { ventasParteExaminada: 10000 });
  assert.ok(sin.continuidadDesplazadaPorCuota > 0, 'sin el botón la cuota sí desplaza');
  assert.strictEqual(con.continuidadDesplazadaPorCuota, 0, 'con el botón no desplaza ninguna');
  assert.strictEqual(con.seleccionadas.filter((c) => c.esContinuidad).length, 6);
});

test('el modo queda declarado en el resultado', () => {
  const universo = [0.02, 0.04].map((m, i) => cCont(i, m));
  assert.strictEqual(
    scoreCandidates(universo, { ...CFG_CONT, priorizarContinuidad: true }, 'x', [], { ventasParteExaminada: 10000 })
      .priorizoContinuidad, true);
  assert.strictEqual(
    scoreCandidates(universo, CFG_CONT, 'x', [], { ventasParteExaminada: 10000 }).priorizoContinuidad, false);
});

/* ══════ LA CLAVE DE CRUCE: por que existe aparte de `nameKey` ══════

   Reportado el 2026-09-02 con la captura del panel: «Del estudio anterior: 1 de 7 siguen. 6 que
   el cribado de este anio no trae» y, debajo, «6 podria(n) estar en el cribado con el nombre
   escrito de otra forma». Cuando las SEIS que se fueron tienen candidata parecida, el problema
   no es que las companias se hayan ido: es el cruce de nombres.

   LA CAUSA, medida. En el patron de `nameKey` —`\b(…|CO\.|S\.A\.|…)\b`— toda alternativa que
   TERMINA en punto no puede satisfacer el `\b` final: despues del punto suele venir un espacio,
   y entre dos caracteres que no son de palabra NO hay frontera. Asi que ninguna forma societaria
   escrita con puntos se limpiaba:

     «Bolak Co. Ltd»  -> BOLAKCO     vs  «Bolak Company Limited» -> BOLAK
     «Givaudan S.A.»  -> GIVAUDANSA  vs  «Givaudan SA»           -> GIVAUDAN
     «Alfa S.A.S.»    -> ALFAS       vs  «Alfa SAS»              -> ALFA

   Y los informes colombianos escriben «S.A.S.» con puntos constantemente.

   POR QUE NO SE ARREGLA `nameKey`. Es el IDENTIFICADOR DE DOCUMENTO del catalogo de comparables
   en Firestore (`firestoreRepo.js:470`). Cambiarla dejaria huerfano todo EEFF ya guardado cuyo
   nombre lleve una forma con puntos, y «Buscar cifras ya cargadas por el equipo» dejaria de
   encontrarlos sin decir nada. La clave de ALMACENAMIENTO tiene que ser estable; la de CRUCE
   tiene que ser agresiva. Dos oficios, dos funciones. */

test('la clave de cruce iguala las formas societarias escritas con y sin puntos', () => {
  const pares = [
    ['Bolak Co. Ltd', 'Bolak Company Limited'],
    ['Givaudan S.A.', 'Givaudan SA'],
    ['Alfa S.A.S.', 'Alfa SAS'],
    ['Takasago International Corp.', 'Takasago International Corporation'],
    ['Oriental Aromatics Ltd', 'Oriental Aromatics Limited'],
    ['Misitano & Stracuzzi S.p.A.', 'Misitano & Stracuzzi SpA'],
  ];
  pares.forEach(([a, b]) => {
    assert.strictEqual(claveDeCruce(a), claveDeCruce(b), `«${a}» debe cruzar con «${b}»`);
  });
});

test('y aguanta el sufijo de bolsa que agrega Capital IQ', () => {
  assert.strictEqual(
    claveDeCruce('Furukawa Electric Co., Ltd.'),
    claveDeCruce('Furukawa Electric Co Ltd (TSE:5801)'),
  );
});

test('NO iguala compañías distintas del mismo grupo', () => {
  /* El riesgo de una clave agresiva: «Sumitomo Electric Industries» y «Sumitomo Corporation» son
     dos compañías, y confundirlas mete en la muestra una que nadie evaluó. */
  assert.notStrictEqual(
    claveDeCruce('Sumitomo Electric Industries Ltd'),
    claveDeCruce('Sumitomo Corporation'),
  );
  assert.notStrictEqual(claveDeCruce('Croda International Plc'), claveDeCruce('Croda Iberica SA'));
  assert.notStrictEqual(claveDeCruce('Alfa Chemicals'), claveDeCruce('Beta Chemicals'));
});

test('las alternativas largas van antes que las cortas', () => {
  /* La alternancia de JavaScript toma la primera que encaja: con `CORP` delante de
     `CORPORATION`, «Corporation» quedaría partida en «CORP» + «ORATION» y la clave saldría con
     basura pegada. */
  assert.strictEqual(claveDeCruce('Acme Corporation'), 'ACME');
  assert.strictEqual(claveDeCruce('Acme Corp'), 'ACME');
  assert.strictEqual(claveDeCruce('Acme Limited'), 'ACME');
  assert.strictEqual(claveDeCruce('Acme Ltda'), 'ACME');
  assert.strictEqual(claveDeCruce('Acme Incorporated'), 'ACME');
});

test('`nameKey` NO cambia: es la clave de almacenamiento', () => {
  /* Si esta prueba falla, hay EEFF guardados en Firestore que dejaron de encontrarse. */
  assert.strictEqual(nameKey('Furukawa Electric Co., Ltd.'), 'FURUKAWAELECTRICCO');
  assert.strictEqual(nameKey('Akatsuki Inc. (TSE:3932)'), 'AKATSUKI');
  assert.strictEqual(nameKey('Bolak Co. Ltd'), 'BOLAKCO');
  /* Se fijan los valores TAL COMO SON, con su limitación incluida —«…CO» al final, porque `CO`
     sin punto no está en su patrón— y no como sería deseable que fueran. Es una clave de
     almacenamiento: lo que importa es que no se mueva, no que sea bonita. El cruce lo arregla
     `claveDeCruce`, que es la de las pruebas de arriba. */
});

test('el cruce de continuidad del motor usa la clave nueva', () => {
  /* La prueba que cierra el reporte: una comparable del estudio anterior escrita «Co. Ltd» y en
     el cribado «Company Limited» tiene que reconocerse como continuidad. */
  const universo = [{
    id: 'B1', name: 'Bolak Company Limited', nameKey: nameKey('Bolak Company Limited'),
    s: 10000, c: 8000, op: 500, desc: 'x',
  }];
  const r = scoreCandidates(universo, {
    nTarget: 1, minimo: 1, perdidaOp: 'incluir', holding: 'excluir',
    saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50,
  }, 'x', [{ name: 'Bolak Co. Ltd' }], { ventasParteExaminada: 10000 });
  assert.strictEqual(r.seleccionadas[0].esContinuidad, true,
    'la reconoce aunque el informe anterior escribiera la forma societaria de otro modo');
});

/* ══════ LAS DEL AÑO PASADO SALEN SIEMPRE CON EL BOTON ══════

   «Necesito que salgan las comparables del año pasado cuando le doy al botón sin importar qué»
   (2026-09-02), después de que la conciliación mostrara «2 de 7 siguen» y 4 sin ni parecido en
   el cribado.

   EL LIMITE QUE HABIA. El motor solo puede SELECCIONAR de entre las candidatas del universo: una
   comparable del estudio anterior que este año el screening de Capital IQ no devolvió no está
   ahí, así que no se podía seleccionar ni rechazar — simplemente no salía. Con el botón se
   INYECTA en la muestra.

   Y EL LIMITE QUE SIGUE HABIENDO, que no es del motor sino de los datos: una comparable que el
   cribado no trae NO TIENE CIFRAS DE ESTE AÑO. Entra a la tabla marcada `sinCifrasDeEsteAnio`
   para que el analista le cargue el estado financiero —a mano o con «Buscar cifras ya cargadas
   por el equipo», que las busca en el catálogo compartido por nombre— y hasta entonces NO entra
   al cuartil: `analizarRangoAjustado` excluye la fila cuyo indicador es `null`
   (`incluida: … && valor !== null`), así que una fila sin cifras se ve pero no mueve el rango.

   Eso es lo correcto y no una limitación que haya que tapar: meter al cuartil una comparable sin
   cifras sería inventarle un margen. */

const cInj = (id, margen) => ({
  id, name: 'Inj ' + id, nameKey: nameKey('Inj ' + id),
  s: 10000, c: 8000, op: margen * 10000, desc: 'x',
});
const CFG_INJ = {
  nTarget: 4, minimo: 1, perdidaOp: 'excluir', holding: 'excluir',
  saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50, negativasObjetivo: 0,
};

test('la del año pasado que el cribado no trae NO se inyecta en la muestra', () => {
  /* Se construyó la inyección el 2026-09-02 a pedido explícito —«necesito que salgan las
     comparables del año pasado cuando le doy al botón sin importar qué»— y se retiró el mismo
     día, también a pedido: «¿y a mí de qué me sirve tener comparables sin datos? de nadaaaa».

     Y es correcto. Una comparable que el cribado no devolvió no tiene cifras de este ejercicio,
     así que la fila inyectada no entraba al cuartil —no acercaba el estudio al cumplimiento ni
     un punto—, ensuciaba la tabla de trabajo y llegaba al informe: el ANEXO B publicaba un
     «[PENDIENTE] Falta el estado financiero de X» por cada una, siete en el caso reportado.

     Lo que hacía falta no era la fila: era el MOTIVO, y eso lo da
     `conciliarConEstudioAnterior` sin ensuciar la muestra. */
  const universo = [0.02, 0.04, 0.06].map((m, i) => cInj(i, m));
  const previas = [{ name: 'Inj 0' }, { name: 'Compañía Que El Cribado No Trae SA' }];
  const r = scoreCandidates(universo, { ...CFG_INJ, priorizarContinuidad: true }, 'x', previas,
    { ventasParteExaminada: 10000 });

  assert.ok(!r.seleccionadas.some((c) => c.name === 'Compañía Que El Cribado No Trae SA'),
    'no se inyecta: una fila sin cifras no sirve para nada');
  assert.strictEqual(r.continuidadInyectadas, 0);
  /* Y ninguna fila de la muestra queda sin cifras. */
  assert.ok(r.seleccionadas.every((c) => c.s !== null && c.op !== null),
    'toda comparable de la muestra tiene cifras');
});

test('la que SÍ está en el cribado sigue reconociéndose como continuidad', () => {
  /* Retirar la inyección no puede tocar lo que sí funciona: la del año anterior que el cribado
     devuelve entra, con sus cifras, y marcada como continuidad. */
  const universo = [0.02, 0.04, 0.06].map((m, i) => cInj(i, m));
  const r = scoreCandidates(universo, { ...CFG_INJ, priorizarContinuidad: true }, 'x',
    [{ name: 'Inj 0' }], { ventasParteExaminada: 10000 });
  const suya = r.seleccionadas.find((c) => c.name === 'Inj 0');
  assert.ok(suya, 'entra');
  assert.strictEqual(suya.esContinuidad, true);
  assert.ok(suya.s !== null, 'y con cifras');
});

test('sin el botón NO se inyecta nada: el comportamiento de siempre', () => {
  const universo = [0.02, 0.04, 0.06].map((m, i) => cInj(i, m));
  const previas = [{ name: 'Fuera SA' }];
  const r = scoreCandidates(universo, CFG_INJ, 'x', previas, { ventasParteExaminada: 10000 });
  assert.ok(!r.seleccionadas.some((c) => c.name === 'Fuera SA'));
  assert.strictEqual(r.continuidadInyectadas, 0);
});

test('no se inyecta la que YA está en la muestra', () => {
  /* Duplicarla contaría dos veces la misma compañía en el cuartil. */
  const universo = [0.02, 0.04].map((m, i) => cInj(i, m));
  const previas = [{ name: 'Inj 0' }];
  const r = scoreCandidates(universo, { ...CFG_INJ, priorizarContinuidad: true }, 'x', previas,
    { ventasParteExaminada: 10000 });
  assert.strictEqual(r.seleccionadas.filter((c) => c.name === 'Inj 0').length, 1);
  assert.strictEqual(r.continuidadInyectadas, 0);
});

test('tampoco se inyecta la que está en el cribado y un filtro descartó', () => {
  /* Esa NO se fue: está y se descartó por un motivo. Inyectarla sería pasar por encima de un
     filtro que el modo no rescata —independencia o saldos negativos— por la puerta de atrás. */
  const universo = [
    { ...cInj('CTRL', 0.03), maxpct: 80 },
    ...[0.02, 0.04].map((m, i) => cInj(i, m)),
  ];
  const previas = [{ name: 'Inj CTRL' }];
  const r = scoreCandidates(universo, { ...CFG_INJ, priorizarContinuidad: true }, 'x', previas,
    { ventasParteExaminada: 10000 });
  assert.ok(!r.seleccionadas.some((c) => c.id === 'CTRL'), 'sigue descartada');
  assert.strictEqual(r.continuidadInyectadas, 0, 'y no se inyecta por la puerta de atrás');
});

test('el cruce de la inyección usa la clave de cruce, no el nombre literal', () => {
  /* Si «Bolak Co. Ltd» del informe anterior está en el cribado como «Bolak Company Limited», NO
     hay que inyectarla: ya está. Inyectarla duplicaría la compañía. */
  const universo = [
    { id: 'B', name: 'Bolak Company Limited', nameKey: nameKey('Bolak Company Limited'),
      s: 10000, c: 8000, op: 300, desc: 'x' },
    ...[0.02, 0.04].map((m, i) => cInj(i, m)),
  ];
  const r = scoreCandidates(universo, { ...CFG_INJ, priorizarContinuidad: true }, 'x',
    [{ name: 'Bolak Co. Ltd' }], { ventasParteExaminada: 10000 });
  assert.strictEqual(r.continuidadInyectadas, 0, 'ya estaba: no se inyecta');
  assert.strictEqual(r.seleccionadas.filter((c) => /Bolak/.test(c.name)).length, 1);
});
