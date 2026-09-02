/* Tests del diagnóstico del rango.

   Lo que se fija aquí es la regla que hace útil al panel: una palanca aparece SOLO si de
   verdad cambia el veredicto. Un panel que sugiere cinco cosas de las que ninguna funciona se
   deja de leer, y entonces tampoco se lee la que sí importaba.

   Las cifras son las de la captura que motivó el trabajo: contribuyente en 1,509 % de margen
   operacional contra un rango de comparables que empieza en 5 y algo por ciento. */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  diagnosticarCumplimiento, confianzaDelIndicador, resumenDeLectura,
  requisitoDeCribado, comparablesEnOPorDebajoDe,
} from './diagnosticoRango.js';
import { analizarRango } from './rangoIntercuartil.js';

/* Una comparable con el margen operacional que se le pida. `op` es UTILIDAD, que es el
   convenio del estudio: el diagnóstico lo traduce a gastos para el motor por su cuenta. */
const comp = (nombre, margenPct, amb = 'Int') => ({
  name: nombre, amb, s: 1000, c: 0, op: (margenPct / 100) * 1000,
});

/* Doce positivas entre 5 % y 9 %: el rango queda claramente por encima del contribuyente. */
const POSITIVAS = [5.1, 5.4, 5.9, 6.2, 6.4, 6.8, 7.3, 7.6, 8.0, 8.4, 8.8, 9.1]
  .map((m, i) => comp('Positiva ' + i, m));

/* El contribuyente de la captura: 15,09 / 1000 = 1,509 %. */
const ESTUDIO = {
  t_s: 1000, t_c: 0, t_op: 15.09,
  pli: 'MO', cmode: 'all', useadj: false,
  motorConfig: { perdidaOp: 'incluir' },
};

const diagnosticar = (parche = {}, extra = {}) => diagnosticarCumplimiento({
  estudio: { ...ESTUDIO, ...parche },
  comparables: POSITIVAS,
  ...extra,
});

test('cuando no cumple, dice a cuánto está del límite y cuánto sería el ajuste', () => {
  const d = diagnosticar();
  assert.strictEqual(d.cumple, false);
  assert.strictEqual(d.veredicto, 'NO CUMPLE');
  assert.strictEqual(d.dir, 'por debajo');
  /* La brecha hasta el P25, que es el dato que la tarjeta nunca daba. */
  assert.ok(d.brecha > 0, 'debe haber brecha medible');
  assert.ok(Math.abs(d.brecha - (d.stats.p25 - d.indicador)) < 1e-9);
  /* Y el ajuste en pesos, que `adjustInfo` ya calculaba y nadie mostraba. */
  assert.ok(d.ajuste, 'debe traer el ajuste');
  assert.ok(d.ajuste.monto > 0, 'estando por debajo, el ajuste sube el ingreso');
});

test('publica los dos rangos y cuál de ellos decide', () => {
  const d = diagnosticar();
  assert.ok(d.rangos.sinAjustar, 'el rango sin ajustar siempre está calculado');
  /* El cumplimiento se decide SIEMPRE con el rango ajustado desde el 2026-09-02
     («el MO sin ajuste solo nos ayuda a escoger las comparables, pero como sabemos si
     cumple es con el rango ajustado»). `useadj` dejo de elegirlo.
     El sin ajustar se sigue publicando porque es la vara con que se eligieron las comparables,
     pero no es el que concluye. */
  assert.strictEqual(d.rangos.decide, 'ajustado', 'con la casilla apagada TAMBIEN decide el ajustado');
  const conUseadj = diagnosticar({ useadj: true });
  assert.strictEqual(conUseadj.rangos.decide, 'ajustado');
});

test('cuando cumple no propone ninguna palanca', () => {
  /* Un contribuyente dentro del rango no necesita que se le sugiera nada, y proponerle algo
     invita a moverlo sin motivo. */
  const d = diagnosticar({ t_op: 68 });   // 6,8 %, en medio del rango
  assert.strictEqual(d.cumple, true);
  assert.strictEqual(d.veredicto, 'CUMPLE');
  assert.deepEqual(d.palancas, []);
});

test('sin rango calculable no se emite veredicto', () => {
  /* Distinto de «no cumple»: con dos comparables no hay rango intercuartil que sostenga
     nada, y la pantalla tiene que poder decir que faltan datos. */
  const d = diagnosticarCumplimiento({
    estudio: ESTUDIO, comparables: POSITIVAS.slice(0, 2),
  });
  assert.strictEqual(d.veredicto, null);
  assert.strictEqual(d.stats, null);
});

test('la palanca de pérdidas aparece con el número de negativas que el filtro está excluyendo', () => {
  const universo = [
    { id: 'N1', name: 'Neg 1', op: -10, s: 100 },
    { id: 'N2', name: 'Neg 2', op: -20, s: 100 },
    { id: 'P1', name: 'Pos 1', op: 50, s: 100 },
  ];
  const d = diagnosticar({ motorConfig: { perdidaOp: 'excluir' } }, { universo });
  const p = d.palancas.find((x) => x.clave === 'politicaPerdidas');
  assert.ok(p, 'con el filtro en excluir y negativas en el universo, la palanca debe estar');
  assert.strictEqual(p.cuantificado, 2, 'y dice cuántas son, no «podría haber»');
  assert.match(p.texto, /3\.64/, 'con la referencia OCDE que la sustenta');
});

test('con la política en «incluir» pero la cuota en cero, la palanca sigue en pie', () => {
  /* Poner la política en «incluir» no mete ninguna negativa: el puntaje penaliza la pérdida,
     así que pierden contra cualquier positiva mientras haya positivas para llenar el cupo.
     Quien decide es la cuota, y el panel tiene que apuntar ahí y no a la política. */
  const universo = [{ id: 'N1', name: 'Neg 1', op: -10, s: 100 }];
  const d = diagnosticar({ motorConfig: { perdidaOp: 'incluir', negativasObjetivo: 0 } }, { universo });
  const p = d.palancas.find((x) => x.clave === 'politicaPerdidas');
  assert.ok(p);
  /* Dice en cuánto está el objetivo hoy: es la casilla que hay que mover, y sin el valor
     actual el analista no sabe si ya lo tocó. El texto de a CUÁNTO subirlo lo aporta
     `cuotaQueCumple`, que se prueba aparte. */
  assert.match(p.texto, /el objetivo está en 0/, 'y dice en cuánto está hoy');
});

test('la palanca de pérdidas desaparece cuando las negativas ya están en la muestra', () => {
  /* Es la única forma honesta de apagarla: no que la política lo permita, sino que las
     comparables en pérdida ya estén midiendo en el rango que se está viendo. */
  const universo = [
    { id: 'N1', name: 'Neg 1', op: -10, s: 100 },
    { id: 'N2', name: 'Neg 2', op: -20, s: 100 },
  ];
  const conNegativas = [...POSITIVAS, comp('En pérdida A', -1.2), comp('En pérdida B', -2.6)];
  const d = diagnosticarCumplimiento({
    estudio: { ...ESTUDIO, motorConfig: { perdidaOp: 'incluir', negativasObjetivo: 2 } },
    comparables: conNegativas,
    universo,
  });
  assert.strictEqual(d.palancas.find((x) => x.clave === 'politicaPerdidas'), undefined);
});

test('la palanca de pérdidas NO aparece si el universo no trae negativas', () => {
  const universo = [{ id: 'P1', name: 'Pos 1', op: 50, s: 100 }];
  const d = diagnosticar({ motorConfig: { perdidaOp: 'excluir' } }, { universo });
  assert.strictEqual(d.palancas.find((x) => x.clave === 'politicaPerdidas'), undefined);
});

test('solo cuenta como negativa disponible la de actividad MISMA cuando hay curación', () => {
  /* La cuota admite solo MISMA, así que prometer una negativa que la curación clasificó como
     RELACIONADA sería prometer algo que el motor no va a poner en la muestra. */
  const universo = [
    { id: 'N1', name: 'Neg 1', op: -10, s: 100 },
    { id: 'N2', name: 'Neg 2', op: -20, s: 100 },
  ];
  const iaMatch = { porId: { N1: { grado: 'MISMA' }, N2: { grado: 'RELACIONADA' } } };
  const d = diagnosticar({ motorConfig: { perdidaOp: 'excluir' }, iaMatch }, { universo });
  const p = d.palancas.find((x) => x.clave === 'politicaPerdidas');
  assert.strictEqual(p.cuantificado, 1, 'la afín no cuenta');
});

test('la palanca del ámbito aparece solo si con otro ámbito sí cumple', () => {
  /* Nacionales con margen bajo, internacionales con margen alto: acotando a nacionales el
     contribuyente entra. Con el ámbito en «todas» no entra. */
  const mezcla = [
    ...[1.0, 1.3, 1.5, 1.8, 2.1].map((m, i) => comp('Nacional ' + i, m, 'Nac')),
    ...[7.0, 7.4, 7.9, 8.3, 8.8].map((m, i) => comp('Internacional ' + i, m, 'Int')),
  ];
  const d = diagnosticarCumplimiento({ estudio: ESTUDIO, comparables: mezcla });
  assert.strictEqual(d.cumple, false, 'con todas, el rango no lo contiene');
  const p = d.palancas.find((x) => x.clave === 'ambito:nac');
  assert.ok(p, 'debe proponer acotar a nacionales, que es lo que sí cambia el veredicto');
  assert.match(p.texto, /justificarlo/i, 'y advertir que hay que justificarlo');
  assert.strictEqual(d.palancas.find((x) => x.clave === 'ambito:intl'), undefined,
    'y NO proponer internacionales, que no cambia nada');
});

test('un indicador alterno que colapsa el rango no se propone como palanca', () => {
  /* Con el costo de ventas en cero en todas las comparables, MB da 100 % para todas y también
     para el contribuyente: el rango queda en 100 %–100 % y «estar dentro» es degeneración, no
     cumplimiento. Es exactamente el caso que producía este fixture, y proponerlo sería
     prometer un cumplimiento que ningún revisor sostendría. */
  const d = diagnosticar();
  assert.strictEqual(d.palancas.find((x) => x.clave === 'indicador:MB'), undefined);
});

test('con costos dispersos, MB sí discrimina y entonces la palanca aparece', () => {
  /* Márgenes brutos de 18 % a 40 %: el rango de MB queda en 23,5 %–34,5 % (QUARTILE.INC sobre
     doce valores). El contribuyente tiene margen bruto de 30 % —dentro— y margen operacional
     de 1,509 % —fuera—: es el caso legítimo en el que cambiar de indicador sí cambia el
     veredicto, y hay que poder decirlo. */
  const conCosto = POSITIVAS.map((c, i) => ({ ...c, c: 600 + i * 20 }));
  const d = diagnosticarCumplimiento({
    estudio: { ...ESTUDIO, t_c: 700 }, comparables: conCosto,
  });
  assert.strictEqual(d.cumple, false, 'con MO sigue fuera');
  const mb = d.palancas.find((x) => x.clave === 'indicador:MB');
  assert.ok(mb, 'con MB queda dentro, así que la palanca debe estar');
  assert.ok(Math.abs(mb.cuantificado - 0.30) < 1e-9, 'y dice en cuánto quedaría: 30 %');
});

test('la palanca de segmentación aparece cuando hay diferencia sin explicar', () => {
  /* El ingreso del P&L es 1000 y la operación con la vinculada 500: la mitad del ingreso
     viene de otra parte y el margen se está calculando sobre cifras mezcladas. */
  const d = diagnosticar({ monto_operacion: 500 });
  const p = d.palancas.find((x) => x.clave === 'segmentacion');
  assert.ok(p);
  assert.strictEqual(p.cuantificado, 500, 'y dice de cuánto es la diferencia');
});

test('la palanca de segmentación desaparece si ya se registró el ingreso a excluir', () => {
  const d = diagnosticar({ monto_operacion: 500, seg_excluido: 500 });
  assert.strictEqual(d.palancas.find((x) => x.clave === 'segmentacion'), undefined);
});

/* ══════════════ La confianza en el indicador ══════════════ */

test('sin ingesta en esta sesión, la confianza no se afirma ni se niega', () => {
  const c = confianzaDelIndicador(null);
  assert.strictEqual(c.verificado, null, 'no haber leído un documento no es no haber podido verificarlo');
  assert.deepEqual(c.motivos, []);
});

test('una lectura limpia da confianza verificada', () => {
  const c = confianzaDelIndicador({
    verificadoContraTexto: true, advertencias: [], correcciones: [],
  });
  assert.strictEqual(c.verificado, true);
});

test('un documento escaneado marca el indicador como no confiable', () => {
  /* Es el caso de Robertet: 0 de 25 páginas con capa de texto. El margen puede estar bien,
     pero nada lo respalda, y ajustar la muestra para alcanzarlo sería trabajar a ciegas. */
  const c = confianzaDelIndicador({
    verificadoContraTexto: false, advertencias: [], correcciones: [],
  });
  assert.strictEqual(c.verificado, false);
  assert.match(c.motivos.join(' '), /escaneo/i);
});

test('las cifras descartadas por columna o fila marcan el indicador como no confiable', () => {
  const c = confianzaDelIndicador({
    verificadoContraTexto: true,
    advertencias: [
      { tipo: 'cifra-de-otro-anio', campo: 't_c' },
      { tipo: 'cifra-sin-dato-en-el-anio', campo: 't_inv' },
    ],
    correcciones: [],
  });
  assert.strictEqual(c.verificado, false);
  assert.match(c.motivos.join(' '), /otra fila, otra columna/i);
});

test('faltar una de las tres cifras del margen se nombra aparte', () => {
  const c = confianzaDelIndicador({
    verificadoContraTexto: true,
    advertencias: [{ tipo: 'sin-costo-de-ventas', campo: 't_c' }],
    correcciones: [],
  });
  assert.strictEqual(c.verificado, false);
  assert.match(c.motivos.join(' '), /tres cifras/i);
});

test('el año ausente en el documento se nombra como motivo propio', () => {
  const c = confianzaDelIndicador({
    verificadoContraTexto: true,
    advertencias: [{ tipo: 'anio-ausente-en-documento' }],
    correcciones: [],
  });
  assert.strictEqual(c.verificado, false);
  assert.match(c.motivos.join(' '), /a[ñn]o gravable/i);
});

test('una corrección sobre un rubro que no entra al margen no lo pone en duda', () => {
  /* Indexar inventarios desde el detalle de activos es un hallazgo real, pero el margen
     operacional no usa inventarios. Si esto marcara «no confiable», casi todo estudio
     saldría marcado y el aviso se volvería ruido. */
  const c = confianzaDelIndicador({
    verificadoContraTexto: true, advertencias: [],
    correcciones: [{ campo: 't_inv' }, { campo: 't_ppe' }],
  });
  assert.strictEqual(c.verificado, true);
});

test('una corrección sobre la utilidad operacional SÍ lo pone en duda', () => {
  const c = confianzaDelIndicador({
    verificadoContraTexto: true, advertencias: [], correcciones: [{ campo: 't_op' }],
  });
  assert.strictEqual(c.verificado, false);
  assert.match(c.motivos.join(' '), /tres cifras del margen se corrigi/i);
});

test('un mismo defecto no se cuenta dos veces', () => {
  /* La advertencia de columna trae `campo: t_c`, así que sin cuidado saldría también como
     «falta alguna de las tres cifras»: el mismo hecho contado como dos motivos. */
  const c = confianzaDelIndicador({
    verificadoContraTexto: true,
    advertencias: [{ tipo: 'cifra-de-otro-anio', campo: 't_c' }],
    correcciones: [],
  });
  assert.strictEqual(c.motivos.length, 1);
});

test('lo que el analista digitó a mano deja de contar contra la confianza', () => {
  const lectura = {
    verificadoContraTexto: true,
    advertencias: [{ tipo: 'cifra-sin-dato-en-el-anio', campo: 't_c' }],
    correcciones: [],
  };
  assert.strictEqual(confianzaDelIndicador(lectura).verificado, false);
  assert.strictEqual(confianzaDelIndicador(lectura, ['t_c']).verificado, true,
    'reescribir la casilla es justamente lo que el aviso pedía');
});

test('con las tres cifras del margen digitadas, un escaneo deja de objetarse', () => {
  /* El caso Robertet: 0 de 25 páginas con texto. Mientras las cifras vengan de la IA el
     aviso es correcto; una vez el analista las escribió, son suyas y el aviso solo enseñaría
     a ignorar el panel. */
  const escaneo = { verificadoContraTexto: false, advertencias: [], correcciones: [] };
  assert.strictEqual(confianzaDelIndicador(escaneo, ['t_s', 't_c']).verificado, false,
    'con dos de tres el aviso sigue en pie');
  assert.strictEqual(confianzaDelIndicador(escaneo, ['t_s', 't_c', 't_op']).verificado, true);
});

test('verificar contra una transcripción por OCR es una salvedad, no un bloqueo', () => {
  /* El caso Robertet con el respaldo funcionando: donde antes no había NINGUNA verificación
     ahora hay una. Bloquear por ella devolvería el estudio al punto de partida; callarla
     convertiría una verificación de segunda en una de primera. Va aparte. */
  const c = confianzaDelIndicador({
    verificadoContraTexto: true, advertencias: [], correcciones: [],
    respaldoOcr: { paginasTranscritas: 25 },
  });
  assert.strictEqual(c.verificado, true, 'la verificación existe y no se invalida');
  assert.deepEqual(c.motivos, [], 'y no se cuenta como motivo de desconfianza');
  assert.strictEqual(c.viaOcr, true, 'pero se dice de dónde salió el texto');
});

test('la salvedad del OCR se apaga con las tres cifras del margen digitadas', () => {
  const lectura = {
    verificadoContraTexto: true, advertencias: [], correcciones: [],
    respaldoOcr: { paginasTranscritas: 25 },
  };
  assert.strictEqual(confianzaDelIndicador(lectura, ['t_s', 't_c', 't_op']).viaOcr, false,
    'una cifra digitada no depende de ninguna transcripción');
});

test('sin respaldo por OCR la salvedad no aparece', () => {
  const c = confianzaDelIndicador({
    verificadoContraTexto: true, advertencias: [], correcciones: [],
  });
  assert.strictEqual(c.viaOcr, false);
  assert.strictEqual(confianzaDelIndicador(null).viaOcr, false);
});

test('el resumen de lectura registra el respaldo por OCR cuando corrió', () => {
  const conOcr = resumenDeLectura(
    { verificadoContraTexto: true, advertencias: [], correcciones: [] },
    { paginas: [1, 2, 3], paginasTranscritas: 3 },
  );
  assert.deepEqual(conOcr.respaldoOcr, { paginasTranscritas: 3 },
    'solo el conteo: la lista de páginas no la juzga nadie después');
  assert.strictEqual(confianzaDelIndicador(conOcr).viaOcr, true);
  const sinOcr = resumenDeLectura({ verificadoContraTexto: true, advertencias: [], correcciones: [] });
  assert.strictEqual(sinOcr.respaldoOcr, null);
});

test('el resumen de lectura conserva lo que juzga la confianza y descarta la prosa', () => {
  const r = resumenDeLectura({
    verificadoContraTexto: true,
    advertencias: [{
      tipo: 'cifra-de-otro-anio', campo: 't_c', estado: 'no_verificado',
      mensaje: 'un texto largo', candidatas: [{ rotulo: 'x', valor: 1 }],
    }],
    correcciones: [{ campo: 't_op', motivo: 'otro texto largo', valorLeido: 1, valorAplicado: 2 }],
    anioVerificado: 2025, verificadasPorColumna: 9,
  });
  assert.deepEqual(r.advertencias, [{ tipo: 'cifra-de-otro-anio', campo: 't_c', estado: 'no_verificado' }]);
  assert.deepEqual(r.correcciones, [{ campo: 't_op' }]);
  assert.strictEqual(r.anioVerificado, 2025);
  assert.strictEqual(r.verificadasPorColumna, 9);
  /* Y lo que sale del resumen se juzga igual que la verificación en vivo. */
  assert.strictEqual(confianzaDelIndicador(r).verificado, false);
});

test('sin lectura, el resumen es null y no un objeto vacío que finja una lectura limpia', () => {
  assert.strictEqual(resumenDeLectura(null), null);
});

test('el diagnóstico usa el rastro persistido cuando no hay ingesta en esta sesión', () => {
  /* Es el caso normal al retomar un estudio guardado: el paso 4 se abre sin pasar por el 3,
     así que la única forma de saber si la cifra era de fiar es lo que quedó en el estudio. */
  const d = diagnosticar({
    t_lecturaEeff: {
      verificadoContraTexto: false, advertencias: [], correcciones: [],
    },
  });
  assert.strictEqual(d.confianza.verificado, false);
  const conDigitadas = diagnosticar({
    t_lecturaEeff: { verificadoContraTexto: false, advertencias: [], correcciones: [] },
    t_camposAMano: ['t_s', 't_c', 't_op'],
  });
  assert.strictEqual(conDigitadas.confianza.verificado, true);
});

test('los hallazgos en vivo pisan al rastro persistido', () => {
  const d = diagnosticarCumplimiento({
    estudio: {
      ...ESTUDIO,
      t_lecturaEeff: { verificadoContraTexto: false, advertencias: [], correcciones: [] },
    },
    comparables: POSITIVAS,
    hallazgos: { verificadoContraTexto: true, advertencias: [], correcciones: [] },
  });
  assert.strictEqual(d.confianza.verificado, true, 'la lectura de esta sesión es la que manda');
});

test('sin rango calculable no se proponen vías', () => {
  /* Visto en pruebas: la tarjeta mostraba «1 vía que sí cambia el veredicto» junto a «ingrese
     cifras y comparables para analizar». La palanca de segmentación no mira el rango, así que
     se colaba sola y prometía algo sobre una conclusión que todavía no existe. */
  const d = diagnosticarCumplimiento({
    estudio: { ...ESTUDIO, monto_operacion: 500 },
    comparables: [],
  });
  assert.strictEqual(d.veredicto, null);
  assert.deepEqual(d.palancas, []);
});

test('la palanca de pérdidas dice a CUÁNTO subir la cuota para cumplir', () => {
  /* Reportado el 2026-09-01: la tarjeta decía «súbalo en el paso 2» sin decir a cuánto, y el
     analista tenía que ir probando 5, 6, 7 y volver a correr el motor cada vez. El número se
     puede calcular: se simula el rango con las N negativas más cercanas del universo y se busca
     la N más pequeña que mete al contribuyente dentro.

     Se da la MÍNIMA a propósito. Con más negativas de las necesarias el rango se ensancha y
     puede volverse enteramente negativo, que ante un revisor se ve peor que cumplir con lo
     justo. */
  const universo = [
    ...POSITIVAS.map((c, i) => ({ ...c, id: 'P' + i })),
    /* Negativas repartidas alrededor del contribuyente. */
    ...[-2, -3, -4, -5, -6, -7, -8].map((m, i) => ({
      id: 'N' + i, name: 'Neg ' + i, amb: 'Int', s: 1000, c: 0, op: (m / 100) * 1000,
    })),
  ];
  const d = diagnosticarCumplimiento({
    estudio: { ...ESTUDIO, t_op: -45, motorConfig: { perdidaOp: 'incluir', negativasObjetivo: 2 } },
    comparables: POSITIVAS,
    universo,
  });
  const p = d.palancas.find((x) => x.clave === 'politicaPerdidas');
  assert.ok(p, 'la palanca debe estar');
  assert.ok(p.cuotaQueCumple > 2, 'y decir a cuánto subir, por encima de la actual');
  assert.match(p.texto, new RegExp(String(p.cuotaQueCumple)), 'el texto lleva el número');
});

test('si ninguna cuota alcanza, se dice en vez de prometer', () => {
  /* Un contribuyente muy por debajo de cualquier negativa del universo: subir la cuota no lo
     mete, y decir «súbalo a X» sería mandarlo a una vía que no existe. */
  const universo = [
    ...POSITIVAS.map((c, i) => ({ ...c, id: 'P' + i })),
    ...[-1, -2].map((m, i) => ({ id: 'N' + i, name: 'Neg ' + i, amb: 'Int', s: 1000, c: 0, op: (m / 100) * 1000 })),
  ];
  const d = diagnosticarCumplimiento({
    estudio: { ...ESTUDIO, t_op: -400, motorConfig: { perdidaOp: 'incluir', negativasObjetivo: 1 } },
    comparables: POSITIVAS,
    universo,
  });
  const p = d.palancas.find((x) => x.clave === 'politicaPerdidas');
  if (p) {
    assert.strictEqual(p.cuotaQueCumple, null);
    assert.match(p.texto, /no alcanza|ninguna cuota/i);
  }
});

/* ══════ No recomendar un indicador cuyos insumos son implausibles ══════

   Reportado el 2026-09-01. La tarjeta decía «Con MB como indicador el contribuyente queda
   dentro del rango» y «Con Berry...», y en la muestra había filas con el COSTO casi diez veces
   el ingreso: Formosa 5.586/54.076, Inabata 5.595/50.679, Hangzhou 56/547. Sus márgenes brutos
   son -868 %, -806 % y -877 %, outliers que arrastran el rango de MB hasta contener cualquier
   cosa. El contribuyente «entraba» en un rango construido con basura.

   El MO no lo nota —usa utilidad sobre ventas y no toca el costo—, así que el defecto solo
   aparece al proponer MB, Berry, Cost Plus o NCP, que sí dividen por el costo. Recomendar uno de
   esos sobre datos así es peor que no recomendar nada: manda a cambiar la metodología del
   estudio por un artefacto. */

const compConCosto = (nombre, ventas, costo, opPct) => ({
  name: nombre, amb: 'Int', s: ventas, c: costo, op: (opPct / 100) * ventas,
});

test('una comparable con el costo muy por encima del ingreso se marca implausible', () => {
  const muestra = [
    compConCosto('Sana', 1000, 700, 5),
    compConCosto('Formosa', 5586, 54076, -4.3),
  ];
  const d = diagnosticarCumplimiento({
    estudio: { ...ESTUDIO, t_c: 700, t_op: -45 }, comparables: muestra,
  });
  assert.strictEqual(d.costosImplausibles.length, 1);
  assert.strictEqual(d.costosImplausibles[0].name, 'Formosa');
  assert.match(d.costosImplausibles[0].motivo, /costo/i);
});

test('no se propone MB ni Berry cuando el costo de la muestra es implausible', () => {
  /* Con costos dispersos y sanos MB sí puede proponerse —hay una prueba aparte—; aquí lo que se
     fija es que una sola fila con el costo diez veces el ingreso lo impide. */
  const muestra = [
    ...POSITIVAS.map((c, i) => ({ ...c, c: 600 + i * 20 })),
    compConCosto('Formosa', 5586, 54076, -4.3),
  ];
  const d = diagnosticarCumplimiento({
    estudio: { ...ESTUDIO, t_c: 700, t_op: -45 }, comparables: muestra,
  });
  assert.strictEqual(d.palancas.find((x) => x.clave === 'indicador:MB'), undefined,
    'MB no se propone: su rango sale de un costo que no puede ser');
  assert.strictEqual(d.palancas.find((x) => x.clave === 'indicador:Berry'), undefined);
});

test('y se dice por qué, en vez de callar la vía sin explicación', () => {
  const muestra = [
    ...POSITIVAS.map((c, i) => ({ ...c, c: 600 + i * 20 })),
    compConCosto('Formosa', 5586, 54076, -4.3),
  ];
  const d = diagnosticarCumplimiento({
    estudio: { ...ESTUDIO, t_c: 700, t_op: -45 }, comparables: muestra,
  });
  const aviso = d.palancas.find((x) => x.clave === 'costosImplausibles');
  assert.ok(aviso, 'debe haber una entrada que lo explique');
  assert.match(aviso.texto, /Formosa/, 'nombrando la comparable');
  assert.match(aviso.texto, /MB|Berry/, 'y qué indicadores quedan sin sustento');
});

test('un costo sano no marca nada y MB sigue disponible', () => {
  const conCosto = POSITIVAS.map((c, i) => ({ ...c, c: 600 + i * 20 }));
  const d = diagnosticarCumplimiento({
    estudio: { ...ESTUDIO, t_c: 700 }, comparables: conCosto,
  });
  assert.deepEqual(d.costosImplausibles, []);
  assert.ok(d.palancas.find((x) => x.clave === 'indicador:MB'),
    'con datos sanos la vía de MB sigue en pie');
});

test('un margen bruto negativo MODERADO no se marca: pasa de verdad', () => {
  /* Una compañía puede vender por debajo del costo en un año malo. Lo implausible es el costo
     multiplicado por diez, no un margen bruto negativo. */
  const muestra = [
    ...POSITIVAS.map((c, i) => ({ ...c, c: 600 + i * 20 })),
    compConCosto('Año malo', 1000, 1150, -20),
  ];
  const d = diagnosticarCumplimiento({
    estudio: { ...ESTUDIO, t_c: 700, t_op: -45 }, comparables: muestra,
  });
  assert.deepEqual(d.costosImplausibles, []);
});

/* ══════════════════ QUÉ HAY QUE TRAER DEL CRIBADO PARA CUMPLIR ══════════════════

   Pedido el 2026-09-02: «nos pasa que en otra compañía las comparables que selecciona no
   alcanzan a estar por encima de este p25».

   Medido sobre un cribado pobre —3 negativas, ninguna honda— NINGUNA palanca alcanza: la cuota
   completa deja el P25 en 1,275 %, bajar la muestra a 10 lo deja en -0,375 %, y quitar las
   cuatro positivas más altas en -1,525 %, contra un contribuyente en -4,595 %. Cuando eso pasa
   el problema no es la selección sino EL CRIBADO, y el sistema tenía que dejar de decir «no
   cumple» para decir qué hay que traer de Capital IQ.

   NO SE SIMULA: SE CALCULA. Con QUARTILE.INC el primer cuartil de n valores ordenados cae en la
   posición (n-1)/4, así que para que el P25 quede en o por debajo del margen del contribuyente
   hacen falta ceil((n-1)/4) + 1 comparables en ese nivel o por debajo. La primera prueba valida
   esa aritmética contra el motor de rango de verdad, tamaño por tamaño: si la fórmula se
   desviara, el sistema mandaría a buscar un número equivocado de compañías.

   Y EL REQUISITO NO ES «NEGATIVAS», ES «MARGEN <= EL DEL CONTRIBUYENTE». Con un contribuyente en
   utilidad baja se cumple con comparables poco rentables y ninguna en pérdida; hablar de
   pérdidas ahí mandaría a buscar lo que no hace falta. */

const compReq = (margen, extra = {}) => ({
  name: 'C', amb: 'Int', s: 10000, c: 8000, op: margen * 10000, ...extra,
});
const ESTUDIO_REQ = { t_s: 100000, t_c: 92000, t_op: -4595, pli: 'MO', cmode: 'all' };

test('la aritmética del requisito coincide con el motor de rango, tamaño por tamaño', () => {
  /* LA PRUEBA QUE SOSTIENE TODO LO DEMÁS. Para cada n se arma una muestra con exactamente el
     número de comparables que la fórmula pide en el nivel del contribuyente, y se comprueba
     contra `analizarRango` que el P25 quedó en ese nivel o por debajo; y con UNA MENOS, que no.
     Si la fórmula pidiera de más, el sistema mandaría a buscar compañías innecesarias; si
     pidiera de menos, el analista pagaría un cribado que sigue sin cumplir. */
  const TP = -0.04595;
  for (let n = 4; n <= 25; n += 1) {
    const k = requisitoDeCribado({
      estudio: ESTUDIO_REQ, tamanoMuestra: n, indicador: TP, universo: [],
    }).necesita;

    const conK = [
      ...Array.from({ length: k }, () => compReq(TP)),
      ...Array.from({ length: n - k }, (_, i) => compReq(0.02 + i * 0.01)),
    ];
    const rK = analizarRango({ ...ESTUDIO_REQ, comparables: conK });
    assert.ok(rK.stats.p25 <= TP + 1e-12,
      'n=' + n + ': con ' + k + ' en el nivel el P25 quedo en ' + rK.stats.p25);

    const conMenos = [
      ...Array.from({ length: k - 1 }, () => compReq(TP)),
      ...Array.from({ length: n - k + 1 }, (_, i) => compReq(0.02 + i * 0.01)),
    ];
    const rM = analizarRango({ ...ESTUDIO_REQ, comparables: conMenos });
    assert.ok(rM.stats.p25 > TP,
      'n=' + n + ': con ' + (k - 1) + ' ya cumplia, asi que ' + k + ' pide una de mas');
  }
});

test('cuenta cuántas hay en el cribado en o por debajo del margen, y la más cercana', () => {
  const universo = [compReq(-0.06), compReq(-0.05), compReq(-0.038), compReq(-0.012), compReq(0.03)];
  const r = requisitoDeCribado({
    estudio: ESTUDIO_REQ, tamanoMuestra: 12, indicador: -0.04595, universo,
  });
  assert.strictEqual(r.necesita, 4, 'ceil(11/4) + 1');
  assert.strictEqual(r.hay, 2, 'solo -0,06 y -0,05 estan en el nivel o por debajo');
  assert.strictEqual(r.faltan, 2);
  assert.ok(Math.abs(r.laMasCercana - (-0.038)) < 1e-9,
    'la mas cercana POR ENCIMA del nivel: dice cuan lejos esta el cribado');
});

test('con el cribado suficiente no pide nada', () => {
  const universo = Array.from({ length: 6 }, () => compReq(-0.06));
  const r = requisitoDeCribado({
    estudio: ESTUDIO_REQ, tamanoMuestra: 12, indicador: -0.04595, universo,
  });
  assert.strictEqual(r.faltan, 0);
  assert.strictEqual(r.alcanza, true);
});

test('el requisito se expresa en margen, no en pérdidas: un contribuyente rentable no necesita negativas', () => {
  /* Con el contribuyente en 2 % y el rango arrancando más arriba, lo que falta son comparables
     POCO RENTABLES, no en pérdida. Decir «pérdidas» ahí mandaría a buscar lo que no hace falta
     y a justificar una inclusión que el estudio no necesita. */
  const rentable = { t_s: 100000, t_c: 90000, t_op: 2000, pli: 'MO', cmode: 'all' };
  const universo = [compReq(0.005), compReq(0.012), compReq(0.018), compReq(0.04), compReq(0.06)];
  const r = requisitoDeCribado({
    estudio: rentable, tamanoMuestra: 12, indicador: 0.02, universo,
  });
  assert.strictEqual(r.hay, 3, 'las tres de margen bajo cuentan, y ninguna esta en perdida');
  assert.strictEqual(r.exigeNegativas, false);
  assert.strictEqual(r.faltan, 1);
});

test('sin indicador no inventa un requisito', () => {
  assert.strictEqual(requisitoDeCribado({
    estudio: ESTUDIO_REQ, tamanoMuestra: 12, indicador: null, universo: [],
  }), null);
});

test('el margen se mide con la misma vara que decide el cumplimiento', () => {
  /* Si aquí se contara con el margen crudo y el rango decidiera con el ajustado, el requisito
     apuntaría a un nivel que no es el que se compara. Es el error que ya costó una cuota
     equivocada en `cuotaMinimaQueCumple`. */
  const conAjuste = { ...ESTUDIO_REQ, useadj: true, t_ar: 12000, t_inv: 21000, t_ap: 15000, prime: 12.5 };
  const universo = [compReq(-0.06, { ar: 1200, inv: 2100, ap: 1500 })];
  const cruda = comparablesEnOPorDebajoDe(universo, ESTUDIO_REQ, -0.04595);
  const ajustada = comparablesEnOPorDebajoDe(universo, conAjuste, -0.04595);
  assert.ok(Array.isArray(cruda) && Array.isArray(ajustada),
    'cada una usa su propia vara, sin lanzar y devolviendo el mismo tipo');
});

/* ══════════════ El colchón: si cumple, por cuánto ══════════════ */

const MUESTRA_QUE_CUMPLE = [
  -0.06, -0.055, -0.05, -0.048, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09,
].map((m) => compReq(m));

test('el diagnóstico dice por cuánto cumple, no solo que cumple', () => {
  /* Pedido en la misma conversación: saber si el estudio quedó al filo. Un cumplimiento por
     tres milésimas se sostiene igual de mal que uno que no cumple, si una cifra se corrige. */
  const d = diagnosticarCumplimiento({ estudio: ESTUDIO_REQ, comparables: MUESTRA_QUE_CUMPLE, universo: [] });
  assert.strictEqual(d.cumple, true);
  assert.ok(d.colchon > 0, 'los puntos que sobran entre el indicador y el P25');
  assert.ok(Math.abs(d.colchon - (d.indicador - d.stats.p25)) < 1e-12);
});

test('cuando no cumple, el diagnóstico trae el requisito del cribado', () => {
  const muestra = Array.from({ length: 12 }, (_, i) => compReq(0.02 + i * 0.005));
  const universo = [compReq(-0.012), compReq(-0.025), compReq(-0.038)];
  const d = diagnosticarCumplimiento({ estudio: ESTUDIO_REQ, comparables: muestra, universo });
  assert.strictEqual(d.cumple, false);
  assert.ok(d.requisito, 'trae el requisito');
  assert.strictEqual(d.requisito.necesita, 4);
  assert.strictEqual(d.requisito.hay, 0, 'ninguna de las tres llega al nivel del contribuyente');
  assert.strictEqual(d.requisito.faltan, 4);
  assert.strictEqual(d.colchon, null, 'no hay colchon cuando no cumple');
});

test('cuando cumple no se calcula requisito: no hay nada que traer', () => {
  const d = diagnosticarCumplimiento({ estudio: ESTUDIO_REQ, comparables: MUESTRA_QUE_CUMPLE, universo: [] });
  assert.strictEqual(d.requisito, null);
});

/* ══════ LA TASA EN CERO ANULA EL AJUSTE, Y SE DICE ══════

   El cumplimiento se concluye sobre el rango ajustado (2026-09-02), y ese ajuste se calcula con
   la tasa del paso 3. Con la tasa en cero cada ajuste sale nulo, el rango ajustado COLAPSA al
   crudo, y el veredicto pasa a salir del rango que la metodologia del despacho descarta.

   ESTE HUECO CASI SE COLO. Al hacer que el ajustado decidiera siempre, el campo de la tasa
   seguia escondido detras de la casilla `useadj`: con la casilla apagada no habia forma de
   fijar la tasa, asi que el ajuste era nulo y el estudio seguia concluyendo con el rango crudo
   —P25 1,364 %, CUMPLE— en vez del ajustado —P25 6,232 %, NO CUMPLE—. El cambio no habria
   tenido ningun efecto en un estudio real. Se cerro sacando la tasa de detras de la casilla y
   avisando cuando esta en cero. */

const compTasa = (m) => ({
  name: 'C', amb: 'Int', s: 10000, c: 8000, op: m * 10000,
  ar: 300, inv: 400, ap: 900, ppe: 200,
});
const ESTUDIO_TASA = {
  pli: 'MO', cmode: 'all',
  t_s: 100000, t_c: 87796, t_op: 6204,
  t_ar: 18000, t_inv: 26000, t_ap: 4000, t_ppe: 9000,
};
const MUESTRA_TASA = [0.04884, 0.00026, 0.09688, 0.10512, 0.03994, 0.10747,
  0.01497, 0.00248, 0.15826, 0.12063, 0.0159, 0.00964].map(compTasa);

test('el diagnóstico marca cuando la tasa en cero anula el ajuste', () => {
  const sinTasa = diagnosticarCumplimiento({
    estudio: ESTUDIO_TASA, comparables: MUESTRA_TASA, universo: [],
  });
  assert.strictEqual(sinTasa.ajusteAnulado, true,
    'sin tasa el ajuste no puede ajustar nada y hay que decirlo donde se lee el veredicto');

  const conTasa = diagnosticarCumplimiento({
    estudio: { ...ESTUDIO_TASA, prime: 12.5 }, comparables: MUESTRA_TASA, universo: [],
  });
  assert.strictEqual(conTasa.ajusteAnulado, false);
});

test('el rango ajustado decide con la casilla encendida Y apagada', () => {
  /* La regla del 2026-09-02: «el MO sin ajuste solo nos ayuda a escoger las comparables, pero
     cómo sabemos si cumple es con el rango ajustado». La casilla dejó de elegirlo. */
  for (const useadj of [false, true]) {
    const d = diagnosticarCumplimiento({
      estudio: { ...ESTUDIO_TASA, useadj, prime: 12.5 },
      comparables: MUESTRA_TASA,
      universo: [],
    });
    assert.strictEqual(d.rangos.decide, 'ajustado', `con useadj=${useadj} debe decidir el ajustado`);
    /* Y el veredicto sale de ese rango, no del otro: con estas comparables el ajustado deja
       fuera al contribuyente y el crudo no. */
    assert.strictEqual(d.cumple, false,
      `con useadj=${useadj} el ajustado deja fuera al contribuyente`);
  }
});

test('la palanca del ajuste dice dónde está el problema, sin prometer apagarlo', () => {
  /* Antes proponía «active/desactive la casilla», que ahora sería proponer concluir con el
     rango que la metodología descarta. Sigue reportándose porque señala la causa: si sin el
     ajuste el contribuyente sí entra, lo que lo saca es el capital de trabajo. */
  const d = diagnosticarCumplimiento({
    estudio: { ...ESTUDIO_TASA, prime: 12.5 }, comparables: MUESTRA_TASA, universo: [],
  });
  const p = d.palancas.find((x) => x.clave === 'ajusteCapitalTrabajo');
  if (p) {
    assert.strictEqual(p.accionable, false, 'no es una palanca que el analista pueda accionar');
    assert.doesNotMatch(p.texto, /casilla/, 'y no manda a tocar ninguna casilla');
    assert.match(p.texto, /capital de trabajo/, 'sino a revisar lo que el ajuste compara');
  }
});
