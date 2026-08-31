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
} from './diagnosticoRango.js';

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
  assert.strictEqual(d.rangos.decide, 'sinAjustar', 'con useadj apagado decide el sin ajustar');
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
  assert.match(p.texto, /objetivo de negativas está en 0/, 'y nombra la casilla que hay que mover');
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
      { tipo: 'cifra-de-otra-fila', campo: 't_inv' },
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
    advertencias: [{ tipo: 'cifra-de-otra-fila', campo: 't_c' }],
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
