
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import XLSX from 'xlsx-js-style';
import {
  scoreCandidates, curateCandidatesWithGemini, nameKey, prefiltrar, enPerdida,
  elegirHoja, encontrarFilaEncabezados, COLUMNAS_IQ, importCapitalIQExcel,
  regionDe, perfilDe, tokensSignificativos, coincidenciaActividad, extraerJSON,
  parsearCriteriosScreening, leerCriteriosScreeningDeArchivo, CURACION_LOTE, enriquecerUniverso,
  MINIMO_COMPARABLES, gradoDeActividad, consultarGemini,
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

test('una negativa de actividad afín no entra a la cuota', () => {
  /* Solo MISMA: una comparable en pérdida ya obliga a explicar por qué se incluye, y
     sumarle que su actividad solo es afín es pedir dos justificaciones a la vez. */
  const afinNegativa = { id: 'AF', name: 'Afin Negativa', desc: 'algo parecido', s: 100, op: -10 };
  const candidatas = [...positivas(3), afinNegativa];
  const r = scoreCandidates(candidatas,
    { nTarget: 12, minimo: 0, perdidaOp: 'incluir', negativasObjetivo: 2 },
    'actividad concreta',
    [],
    { iaMatch: { porId: {
      ...Object.fromEntries(positivas(3).map((c) => [c.id, { grado: 'MISMA', perfil: 'SERVICIO' }])),
      AF: { grado: 'RELACIONADA', perfil: 'SERVICIO' },
    } } });

  assert.strictEqual(cuantasNegativas(r.seleccionadas), 0, 'la afín negativa no llena la cuota');
  assert.strictEqual(r.negativasDisponibles, 0, 'ni cuenta como disponible');
  assert.ok(r.reserva.some((c) => c.id === 'AF'), 'queda en reserva con su motivo');
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

test('con el contribuyente apenas en pérdida entran las negativas más suaves', () => {
  /* Contribuyente en -1,5 %: las cercanas son -10, -20, -30 y -45. El criterio es cercanía,
     no profundidad — y por eso no ensancha el rango más de lo necesario. */
  const r = correrCercania(-0.015);
  const negativas = r.seleccionadas.filter(enPerdida).map((c) => c.op).sort((a, b) => b - a);
  assert.deepEqual(negativas, [-10, -20, -30, -45]);
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
  assert.strictEqual(r.criterioNegativas, 'cercania-al-contribuyente');
  const sinPli = scoreCandidates(
    [...negativasEscalonadas(), ...positivasLlenado()],
    BASE_CERC, 'trading services', [],
    { ventasParteExaminada: 1000, iaMatch: { porId: {} } },
  );
  assert.strictEqual(sinPli.criterioNegativas, 'puntaje');
});
