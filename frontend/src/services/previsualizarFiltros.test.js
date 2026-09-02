/* Pruebas de la previsualización de los filtros del paso 2.

   LO QUE ESTE SERVICIO VIENE A CERRAR. El paso 2 se configuraba a ciegas: fijabas cuatro
   filtros sin saber qué efecto tendrían y solo lo descubrías después de correr la curación con
   IA, que se paga por candidata. Si te equivocaste, vuelves a pagar. Y con el contribuyente en
   margen negativo y las pérdidas excluidas, el estudio NO PUEDE cumplir —toda comparable
   rentable tiene margen sobre cero, así que el primer cuartil queda siempre por encima— y nada
   en la pantalla lo decía.

   Todo lo que hay aquí es cálculo local sobre el universo ya cargado: ni una llamada a la IA.
   Los cuatro filtros duros son JavaScript puro sobre datos en memoria, y por eso se puede
   recalcular en vivo mientras el analista mueve un selector.

   LA PRUEBA QUE IMPORTA MÁS es la de coherencia con el motor: si el panel promete un número
   que `scoreCandidates` no respeta, es peor que no mostrar nada. */

import { test } from 'node:test';
import assert from 'node:assert';
import { previsualizarFiltros } from './previsualizarFiltros.js';
import {
  scoreCandidates, nameKey, MINIMO_COMPARABLES,
  CURACION_LOTE, CURACION_CONCURRENCIA,
} from './comparablesEngine.js';

/* Una candidata de Capital IQ con lo que la importación le pone. */
const cand = (id, extra = {}) => ({
  id,
  name: extra.name || `Compania ${id}`,
  nameKey: nameKey(extra.name || `Compania ${id}`),
  s: 1000, c: 600, op: 100,
  desc: 'software development services',
  country: 'Colombia',
  ...extra,
});

const universoDe = (n, extra = {}) =>
  Array.from({ length: n }, (_, i) => cand(`C${i}`, extra));

/* El contribuyente del caso que motivó esto: margen operacional negativo. */
const ESTUDIO_EN_PERDIDA = { t_s: 1000, t_c: 800, t_op: -45.95, pli: 'MO' };
const ESTUDIO_RENTABLE = { t_s: 1000, t_c: 800, t_op: 68, pli: 'MO' };

const CONFIG = {
  nTarget: 12, perdidaOp: 'excluir', holding: 'excluir',
  saldoNegativo: 'excluir', control: 'excluir', umbralControl: 50,
  negativasObjetivo: 0, geo: 'ninguna',
};

/* ══════════════ El embudo ══════════════ */

test('el embudo atribuye cada descarte a su filtro y dice cuántas quedan', () => {
  const universo = [
    ...universoDe(20),
    cand('H1', { name: 'Alpha Holding SA' }),
    cand('H2', { name: 'Beta Group Ltd' }),
    cand('N1', { hasNegativeBalance: true }),
    cand('P1', { op: -50, hasLoss: true }),
    cand('P2', { op: -80, hasLoss: true }),
  ];
  const p = previsualizarFiltros(universo, CONFIG, { estudio: ESTUDIO_RENTABLE });

  assert.strictEqual(p.universo, 25);
  const por = Object.fromEntries(p.pasos.map((x) => [x.clave, x]));
  assert.strictEqual(por.holding.saca, 2);
  assert.strictEqual(por.saldoNegativo.saca, 1);
  assert.strictEqual(por.perdidaOperativa.saca, 2);
  assert.strictEqual(por.controlada.saca, 0);
  assert.strictEqual(p.quedan, 20);
});

test('un filtro apagado no saca a nadie y se dice que está apagado', () => {
  const universo = [...universoDe(5), cand('P1', { op: -50, hasLoss: true })];
  const p = previsualizarFiltros(universo, { ...CONFIG, perdidaOp: 'incluir' }, { estudio: ESTUDIO_RENTABLE });
  const paso = p.pasos.find((x) => x.clave === 'perdidaOperativa');
  assert.strictEqual(paso.activo, false);
  assert.strictEqual(paso.saca, 0);
  assert.strictEqual(p.quedan, 6);
});

test('cada paso trae ejemplos con nombre, no solo un número', () => {
  /* Un número es abstracto; cinco razones sociales son verificables. Es el único modo de cazar
     un falso positivo del filtro de holding, que se PRESUME de la razón social. */
  const universo = [
    ...universoDe(3),
    cand('H1', { name: 'Alpha Holding SA' }),
    cand('H2', { name: 'Beta Group Ltd' }),
  ];
  const p = previsualizarFiltros(universo, CONFIG, { estudio: ESTUDIO_RENTABLE });
  const holding = p.pasos.find((x) => x.clave === 'holding');
  assert.deepEqual(holding.ejemplos, ['Alpha Holding SA', 'Beta Group Ltd']);
});

test('los ejemplos se topan: la lista es para verificar, no para leerla entera', () => {
  const universo = universoDe(30, { name: 'Zeta Holding SA' })
    .map((c, i) => ({ ...c, name: `Zeta Holding ${i}`, nameKey: nameKey(`Zeta Holding ${i}`) }));
  const p = previsualizarFiltros(universo, CONFIG, { estudio: ESTUDIO_RENTABLE });
  const holding = p.pasos.find((x) => x.clave === 'holding');
  assert.strictEqual(holding.saca, 30);
  assert.strictEqual(holding.ejemplos.length, 5, 'cinco, y el resto se cuenta');
});

test('la geografía se reporta como lo que es: no descarta', () => {
  /* «Prioridad Geográfica» parecía un filtro y solo pondera el puntaje. Decirlo aquí, junto a
     los que sí descartan, es lo que evita que el analista crea que perdió candidatas. */
  const p = previsualizarFiltros(universoDe(5), { ...CONFIG, geo: 'LATAM' }, { estudio: ESTUDIO_RENTABLE });
  assert.strictEqual(p.geografia.descarta, false);
  assert.match(p.geografia.texto, /ordena|puntaje|no descarta/i);
});

/* ══════════════ Coherencia con el motor ══════════════ */

test('lo que el embudo promete es lo que el motor respeta', () => {
  /* La prueba central. `prefiltrar` decide a quién se le PAGA la curación y `scoreCandidates`
     decide quién ENTRA: si atribuyen distinto, el panel miente. Divergían en dos puntos —la
     exención de continuidad del holding y el reconocimiento de `op < 0` sin flag—. */
  const universo = [
    ...universoDe(15),
    cand('H1', { name: 'Alpha Holding SA' }),
    cand('N1', { hasNegativeBalance: true }),
    cand('P1', { op: -50 }),                       // sin flag `hasLoss`
    cand('P2', { op: -80, hasLoss: true }),
  ];
  const p = previsualizarFiltros(universo, CONFIG, { estudio: ESTUDIO_RENTABLE });
  const r = scoreCandidates(universo, CONFIG, '', []);

  const delMotor = {};
  r.rechazadas.forEach((c) => {
    if (c.categoriaRechazo !== 'filtro') return;
    delMotor[c.motivoClave] = (delMotor[c.motivoClave] || 0) + 1;
  });
  p.pasos.forEach((paso) => {
    assert.strictEqual(paso.saca, delMotor[paso.clave] || 0,
      `el paso «${paso.clave}» promete ${paso.saca} y el motor descarta ${delMotor[paso.clave] || 0}`);
  });
});

test('una comparable de continuidad con nombre de holding no se cuenta como descartada', () => {
  /* Y no se cuenta porque el motor tampoco la descarta: su inclusión ya se sustentó el año
     anterior. Antes el panel —y `prefiltrar`— la daban por perdida. */
  const universo = [...universoDe(5), cand('G1', { name: 'Gamma Group Ltd' })];
  const previas = [{ name: 'Gamma Group Ltd' }];
  const p = previsualizarFiltros(universo, CONFIG, {
    estudio: ESTUDIO_RENTABLE, estudioAnterior: { comparables: previas },
  });
  assert.strictEqual(p.pasos.find((x) => x.clave === 'holding').saca, 0);
  assert.strictEqual(p.quedan, 6);
});

/* ══════════════ Lo que vas a pagar ══════════════ */

test('dice cuántas se van a curar, en cuántos lotes y cuánto tarda', () => {
  /* El dato que responde a «configurar a ciegas y pagar para enterarme». Sale del mismo
     cálculo del motor, no de una estimación aparte. */
  const universo = universoDe(45);
  const p = previsualizarFiltros(universo, CONFIG, { estudio: ESTUDIO_RENTABLE });
  assert.strictEqual(p.curacion.aCurar, 45);
  assert.strictEqual(p.curacion.reutilizadas, 0);
  assert.strictEqual(p.curacion.lotes, Math.ceil(45 / CURACION_LOTE));
  assert.ok(p.curacion.etaMinutos >= 1);
});

test('lo ya curado no se vuelve a pagar y se descuenta del estimado', () => {
  const universo = universoDe(45);
  const iaMatch = { porId: {} };
  universo.slice(0, 25).forEach((c) => { iaMatch.porId[c.id] = { grado: 'MISMA' }; });
  const p = previsualizarFiltros(universo, CONFIG, { estudio: ESTUDIO_RENTABLE, iaMatch });
  assert.strictEqual(p.curacion.aCurar, 20, 'solo las que faltan');
  assert.strictEqual(p.curacion.reutilizadas, 25);
});

test('solo se cura lo que trae identificador y descripción', () => {
  /* Es el criterio de `curateCandidatesWithGemini`: sin descripción no hay con qué comparar, y
     esas siguen de largo hacia la heurística sin costar nada. */
  const universo = [
    ...universoDe(10),
    cand('SD1', { desc: '' }),
    { name: 'A mano SA', nameKey: nameKey('A mano SA'), s: 1000, op: 100 },
  ];
  const p = previsualizarFiltros(universo, CONFIG, { estudio: ESTUDIO_RENTABLE });
  assert.strictEqual(p.curacion.aCurar, 10);
  assert.strictEqual(p.curacion.sinDatosParaCurar, 2);
});

test('apretar un filtro baja lo que se va a pagar', () => {
  /* Es el punto entero: el número tiene que moverse con el selector. */
  const universo = [...universoDe(20), ...universoDe(15).map((c, i) => cand(`P${i}`, { op: -50 }))];
  const conPerdidas = previsualizarFiltros(universo, { ...CONFIG, perdidaOp: 'incluir' }, { estudio: ESTUDIO_RENTABLE });
  const sinPerdidas = previsualizarFiltros(universo, CONFIG, { estudio: ESTUDIO_RENTABLE });
  assert.strictEqual(conPerdidas.curacion.aCurar, 35);
  assert.strictEqual(sinPerdidas.curacion.aCurar, 20);
});

/* ══════════════ El cupo y la reserva ══════════════ */

test('reencuadra el cupo: no manda el filtro, manda el N objetivo', () => {
  const p = previsualizarFiltros(universoDe(500), CONFIG, { estudio: ESTUDIO_RENTABLE });
  assert.strictEqual(p.quedan, 500);
  assert.strictEqual(p.entran, 12);
  assert.strictEqual(p.reserva, 488);
});

test('cuando el universo no alcanza el N objetivo, se dice', () => {
  const p = previsualizarFiltros(universoDe(8), CONFIG, { estudio: ESTUDIO_RENTABLE });
  assert.strictEqual(p.entran, 8, 'entran las que hay, no las que se piden');
  assert.strictEqual(p.reserva, 0);
  const aviso = p.avisos.find((a) => a.clave === 'universoCorto');
  assert.ok(aviso);
  assert.match(aviso.texto, new RegExp(String(MINIMO_COMPARABLES)), 'y nombra el piso del estudio');
});

test('con el universo por encima del piso pero bajo el objetivo, se avisa sin alarmar', () => {
  const p = previsualizarFiltros(universoDe(11), CONFIG, { estudio: ESTUDIO_RENTABLE });
  const aviso = p.avisos.find((a) => a.clave === 'universoCorto');
  assert.ok(aviso);
  assert.strictEqual(aviso.severidad, 'aviso', 'no es un bloqueo: 11 supera el piso de 10');
});

/* ══════════════ El incumplimiento demostrable ══════════════ */

test('contribuyente en pérdida con las pérdidas excluidas: no puede cumplir, y se demuestra', () => {
  /* No es una probabilidad: toda comparable con utilidad >= 0 tiene PLI >= 0, luego el P25
     queda siempre por encima de un contribuyente negativo. Se puede afirmar sin correr nada. */
  const universo = [...universoDe(20), ...Array.from({ length: 7 }, (_, i) => cand(`P${i}`, { op: -50 }))];
  const p = previsualizarFiltros(universo, CONFIG, { estudio: ESTUDIO_EN_PERDIDA });
  const aviso = p.avisos.find((a) => a.clave === 'imposibleCumplir');
  assert.ok(aviso, 'el aviso debe estar');
  assert.strictEqual(aviso.severidad, 'bloqueo');
  assert.match(aviso.texto, /7/, 'dice cuántas en pérdida hay en el universo');
  assert.match(aviso.texto, /Negativas objetivo/, 'y a qué control ir');
  assert.strictEqual(p.enPerdidaEnUniverso, 7);
});

test('el aviso desaparece cuando las pérdidas se admiten', () => {
  const universo = [...universoDe(20), cand('P1', { op: -50 })];
  const p = previsualizarFiltros(universo, { ...CONFIG, perdidaOp: 'incluir', negativasObjetivo: 3 }, {
    estudio: ESTUDIO_EN_PERDIDA,
  });
  assert.strictEqual(p.avisos.find((a) => a.clave === 'imposibleCumplir'), undefined);
});

test('con las pérdidas admitidas pero la cuota en cero, se avisa que no entrará ninguna', () => {
  /* El puntaje penaliza la pérdida, así que pierden contra cualquier positiva mientras haya
     positivas para llenar el cupo. Poner «incluir» y dejar la cuota en 0 no mete ninguna: es
     contraintuitivo y el panel tiene que decirlo. */
  const universo = [...universoDe(20), cand('P1', { op: -50 })];
  const p = previsualizarFiltros(universo, { ...CONFIG, perdidaOp: 'incluir', negativasObjetivo: 0 }, {
    estudio: ESTUDIO_EN_PERDIDA,
  });
  const aviso = p.avisos.find((a) => a.clave === 'cuotaEnCero');
  assert.ok(aviso);
  assert.match(aviso.texto, /Negativas objetivo/);
});

test('un contribuyente rentable no dispara el aviso de imposibilidad', () => {
  const p = previsualizarFiltros(universoDe(20), CONFIG, { estudio: ESTUDIO_RENTABLE });
  assert.strictEqual(p.avisos.find((a) => a.clave === 'imposibleCumplir'), undefined);
});

test('sin cifras del contribuyente no se afirma nada sobre cumplimiento', () => {
  /* Callar es lo correcto: sin margen no se puede demostrar ni lo uno ni lo otro. */
  const p = previsualizarFiltros(universoDe(20), CONFIG, { estudio: {} });
  assert.strictEqual(p.avisos.find((a) => a.clave === 'imposibleCumplir'), undefined);
  assert.strictEqual(p.indicador, null);
});

test('pedir negativas con el filtro que las excluye se nombra como contradicción', () => {
  const p = previsualizarFiltros(universoDe(20), { ...CONFIG, negativasObjetivo: 3 }, {
    estudio: ESTUDIO_RENTABLE,
  });
  const aviso = p.avisos.find((a) => a.clave === 'cuotaContradictoria');
  assert.ok(aviso);
});

test('admitir pérdidas sin justificación escrita se avisa', () => {
  /* Es lo que sustenta la decisión ante la DIAN; el informe la publica. */
  const universo = [...universoDe(20), cand('P1', { op: -50 })];
  const p = previsualizarFiltros(universo, {
    ...CONFIG, perdidaOp: 'incluir', negativasObjetivo: 2, justificacionPerdida: '',
  }, { estudio: ESTUDIO_EN_PERDIDA });
  assert.ok(p.avisos.find((a) => a.clave === 'sinJustificacion'));

  const conJust = previsualizarFiltros(universo, {
    ...CONFIG, perdidaOp: 'incluir', negativasObjetivo: 2,
    justificacionPerdida: 'El sector atravesó una contracción documentada en 2025.',
  }, { estudio: ESTUDIO_EN_PERDIDA });
  assert.strictEqual(conJust.avisos.find((a) => a.clave === 'sinJustificacion'), undefined);
});

test('pedir más negativas de las que hay en el universo se avisa con la cifra real', () => {
  const universo = [...universoDe(20), cand('P1', { op: -50 }), cand('P2', { op: -70 })];
  const p = previsualizarFiltros(universo, {
    ...CONFIG, perdidaOp: 'incluir', negativasObjetivo: 5, justificacionPerdida: 'x',
  }, { estudio: ESTUDIO_EN_PERDIDA });
  const aviso = p.avisos.find((a) => a.clave === 'negativasInsuficientes');
  assert.ok(aviso);
  assert.match(aviso.texto, /2/);
});

/* ══════════════ La continuidad ══════════════ */

test('nombra las comparables del año anterior que esta configuración retira', () => {
  /* Romper la serie hay que justificarlo en el informe, y hoy se caían sin que nadie lo
     dijera. El control accionario y la pérdida no perdonan la continuidad. */
  const universo = [
    ...universoDe(10),
    cand('V1', { name: 'Vieja Uno SA', op: -50 }),
    cand('V2', { name: 'Vieja Dos SA', hasNegativeBalance: true }),
    cand('V3', { name: 'Vieja Tres SA' }),
  ];
  const previas = [{ name: 'Vieja Uno SA' }, { name: 'Vieja Dos SA' }, { name: 'Vieja Tres SA' }];
  const p = previsualizarFiltros(universo, CONFIG, {
    estudio: ESTUDIO_RENTABLE, estudioAnterior: { comparables: previas },
  });
  assert.strictEqual(p.continuidad.total, 3);
  assert.strictEqual(p.continuidad.caen.length, 2);
  assert.deepEqual(p.continuidad.caen.map((c) => c.name).sort(), ['Vieja Dos SA', 'Vieja Uno SA']);
  assert.ok(p.continuidad.caen.every((c) => c.motivo), 'con el motivo de cada una');
  assert.ok(p.avisos.find((a) => a.clave === 'continuidadRota'));
});

test('sin estudio anterior no se habla de continuidad', () => {
  const p = previsualizarFiltros(universoDe(10), CONFIG, { estudio: ESTUDIO_RENTABLE });
  assert.strictEqual(p.continuidad.total, 0);
  assert.deepEqual(p.continuidad.caen, []);
  assert.strictEqual(p.avisos.find((a) => a.clave === 'continuidadRota'), undefined);
});

/* ══════════════ Degradación ══════════════ */

test('sin universo cargado no se inventa un embudo', () => {
  const p = previsualizarFiltros([], CONFIG, { estudio: ESTUDIO_RENTABLE });
  assert.strictEqual(p.universo, 0);
  assert.strictEqual(p.quedan, 0);
  assert.strictEqual(p.hayUniverso, false);
  assert.deepEqual(p.avisos, [], 'y no se avisa de nada: no hay nada que juzgar todavía');
});

test('tolera un universo nulo y una configuración vacía', () => {
  const p = previsualizarFiltros(null, {}, {});
  assert.strictEqual(p.universo, 0);
  assert.strictEqual(p.hayUniverso, false);
  assert.ok(Array.isArray(p.pasos));
});

test('el orden de los pasos es el de precedencia del motor', () => {
  const p = previsualizarFiltros(universoDe(5), CONFIG, { estudio: ESTUDIO_RENTABLE });
  assert.deepEqual(p.pasos.map((x) => x.clave),
    ['controlada', 'holding', 'saldoNegativo', 'perdidaOperativa']);
});

test('cada paso trae su etiqueta y lo que hace, para que la pantalla no lo redacte', () => {
  const p = previsualizarFiltros(universoDe(5), CONFIG, { estudio: ESTUDIO_RENTABLE });
  p.pasos.forEach((paso) => {
    assert.ok(paso.etiqueta && paso.etiqueta.length > 0, `falta etiqueta en ${paso.clave}`);
    assert.ok(paso.queHace && paso.queHace.length > 0, `falta queHace en ${paso.clave}`);
  });
});

test('el estimado de la curación usa la concurrencia real del motor', () => {
  const p = previsualizarFiltros(universoDe(CURACION_LOTE * CURACION_CONCURRENCIA), CONFIG, {
    estudio: ESTUDIO_RENTABLE,
  });
  assert.strictEqual(p.curacion.lotes, CURACION_CONCURRENCIA);
  assert.strictEqual(p.curacion.etaMinutos, 1, 'tres lotes en paralelo son una sola tanda');
});

test('si el universo no trae NINGUNA en pérdida, cambiar la política tampoco alcanza', () => {
  /* Lo destapó el cribado real de Makita: 1.632 compañías y CERO en pérdida operativa —el
     screening de Capital IQ ya las había excluido—. Con el contribuyente en −1,356 %, la
     demostración no depende del filtro sino de si la muestra PUEDE contener una negativa: si
     no hay ninguna en el universo, ninguna configuración de esta pantalla sirve, ni con las
     pérdidas admitidas. Decir «cambie la política» ahí sería mandar al analista a una vía que
     no existe. */
  const universo = universoDe(30);   // todas rentables
  const p = previsualizarFiltros(universo, { ...CONFIG, perdidaOp: 'incluir' }, {
    estudio: ESTUDIO_EN_PERDIDA,
  });
  const aviso = p.avisos.find((a) => a.clave === 'imposibleCumplir');
  assert.ok(aviso, 'el aviso debe estar aunque las pérdidas ya se admitan');
  assert.match(aviso.texto, /cribado/i, 'y apuntar al cribado del paso 1, no a la política');
  assert.doesNotMatch(aviso.texto, /Cambie «Pérdidas Operativas»/,
    'no manda a mover un selector que ya está donde debe');
});

test('con negativas disponibles y el filtro puesto, el aviso manda a la política', () => {
  const universo = [...universoDe(20), ...Array.from({ length: 6 }, (_, i) => cand(`P${i}`, { op: -50 }))];
  const p = previsualizarFiltros(universo, CONFIG, { estudio: ESTUDIO_EN_PERDIDA });
  const aviso = p.avisos.find((a) => a.clave === 'imposibleCumplir');
  assert.match(aviso.texto, /Pérdidas Operativas/);
  assert.match(aviso.texto, /6/);
});

/* ══════ El rango ajustado no significa nada sin capital de trabajo en las comparables ══════

   Medido el 2026-09-01 sobre un estudio real. Con un comparable de margen crudo -5,000 % y el
   contribuyente en -4,595 %:

     capital de trabajo del comparable   ajustado    efecto
     en cero (lo que traía el cribado)   -2,673 %    +2,33 pts  ← castigo sistemático
     parecido al del contribuyente       -5,000 %     0,00 pts  ← esto es comparabilidad
     más pesado                          -9,512 %    -4,51 pts

   Con las comparables en cero el ajuste no compara: es un corrimiento fijo calculado solo con
   el capital de trabajo del contribuyente. Y si el estudio concluye sobre el rango ajustado
   —que es la metodología— entonces la conclusión se apoya en un artefacto. Hay que decirlo. */

const candSinWC = (id) => ({
  id, name: 'Comp ' + id, s: 10000, c: 9200, op: 500, desc: 'x',
});
const candConWC = (id) => ({
  id, name: 'Comp ' + id, s: 10000, c: 9200, op: 500, desc: 'x',
  ar: 1200, inv: 2100, ap: 1500, ppe: 300,
});
const ESTUDIO_AJUSTADO = {
  t_s: 100000, t_c: 92000, t_op: -4595,
  t_ar: 12000, t_inv: 21000, t_ap: 15000, t_ppe: 3000,
  pli: 'MO', useadj: true, prime: 12.5,
};

test('sin capital de trabajo en el universo y concluyendo sobre el ajustado, se bloquea', () => {
  const universo = Array.from({ length: 40 }, (_, i) => candSinWC('C' + i));
  const p = previsualizarFiltros(universo, CONFIG, { estudio: ESTUDIO_AJUSTADO });
  assert.strictEqual(p.capitalTrabajo.conDatos, 0);
  assert.strictEqual(p.capitalTrabajo.total, 40);
  const aviso = p.avisos.find((a) => a.clave === 'ajusteSinCapitalTrabajo');
  assert.ok(aviso, 'debe avisar');
  assert.strictEqual(aviso.severidad, 'bloqueo');
  assert.match(aviso.texto, /Accounts Receivable|Cuentas por cobrar/i, 'y decir qué columnas traer');
});

test('el aviso aplica aunque la casilla de ajuste esté apagada', () => {
  /* Antes esta prueba fijaba lo contrario —«si el estudio NO concluye sobre el ajustado, el
     aviso no aplica»— y era correcto mientras `useadj` elegía el rango que concluía.

     Desde el 2026-09-02 el cumplimiento se decide SIEMPRE con el rango ajustado («el MO sin
     ajuste solo nos ayuda a escoger las comparables, pero cómo sabemos si cumple es con el
     rango ajustado»), así que el ajuste corre en todo estudio y un ajuste sin datos distorsiona
     la conclusión de todos, no solo la de los que tenían la casilla encendida. La casilla ya no
     exime del aviso. */
  const universo = Array.from({ length: 40 }, (_, i) => candSinWC('C' + i));
  const p = previsualizarFiltros(universo, CONFIG, {
    estudio: { ...ESTUDIO_AJUSTADO, useadj: false },
  });
  const aviso = p.avisos.find((a) => a.clave === 'ajusteSinCapitalTrabajo');
  assert.ok(aviso, 'el aviso aparece: el ajuste decide igual');
  assert.strictEqual(aviso.severidad, 'bloqueo',
    'y sigue siendo bloqueo: invalida la vara con la que el estudio concluye');
});

test('con capital de trabajo en el universo el aviso desaparece', () => {
  const universo = Array.from({ length: 40 }, (_, i) => candConWC('C' + i));
  const p = previsualizarFiltros(universo, CONFIG, { estudio: ESTUDIO_AJUSTADO });
  assert.strictEqual(p.capitalTrabajo.conDatos, 40);
  assert.strictEqual(p.avisos.find((a) => a.clave === 'ajusteSinCapitalTrabajo'), undefined);
});

test('con capital de trabajo en unas pocas también se avisa, y se dice cuántas', () => {
  /* Un puñado con datos no salva el ajuste: las demás siguen recibiendo el corrimiento. */
  const universo = [
    ...Array.from({ length: 36 }, (_, i) => candSinWC('S' + i)),
    ...Array.from({ length: 4 }, (_, i) => candConWC('C' + i)),
  ];
  const p = previsualizarFiltros(universo, CONFIG, { estudio: ESTUDIO_AJUSTADO });
  const aviso = p.avisos.find((a) => a.clave === 'ajusteSinCapitalTrabajo');
  assert.ok(aviso);
  assert.match(aviso.texto, /4 de 40|4 de las 40/, 'con la cifra real');
});

/* ══════════ El requisito del cribado, antes de pagar la curación ══════════

   «En otra compañía las comparables que selecciona no alcanzan a estar por encima de este P25»
   (2026-09-02). Los otros avisos dicen que el estudio no va a cumplir; este dice QUÉ TRAER para
   que cumpla, y tiene que decirlo ANTES de correr: después de la curación el remedio ya cuesta
   otra corrida. */

const conMargen = (id, margen) => cand(id, { s: 10000, c: 8000, op: margen * 10000 });

test('el paso 2 dice cuántas comparables faltan y con qué margen, antes de correr', () => {
  const universo = [
    ...Array.from({ length: 12 }, (_, i) => conMargen(`P${i}`, 0.02 + i * 0.005)),
    conMargen('N1', -0.012), conMargen('N2', -0.025), conMargen('N3', -0.038),
  ];
  const p = previsualizarFiltros(universo, { ...CONFIG, perdidaOp: 'incluir', negativasObjetivo: 3 }, {
    estudio: ESTUDIO_EN_PERDIDA,
  });
  const a = p.avisos.find((x) => x.clave === 'cribadoInsuficiente');
  assert.ok(a, 'el aviso aparece');
  assert.match(a.texto, /hacen falta 4 comparable/, 'el número exacto que pide la aritmética del cuartil');
  assert.match(a.texto, /la más cercana/, 'cuán lejos está el cribado de servir');
  assert.match(a.texto, /paso 1/, 'manda al screening, que es donde se resuelve');
  assert.match(a.texto, /en pérdida/, 'con margen negativo avisa que habrá que justificarlas');
});

test('con el cribado suficiente el aviso no aparece', () => {
  /* La regla de este servicio: un panel que avisa de todo enseña a ignorar los avisos. */
  const universo = [
    ...Array.from({ length: 12 }, (_, i) => conMargen(`P${i}`, 0.02 + i * 0.005)),
    ...Array.from({ length: 5 }, (_, i) => conMargen(`N${i}`, -0.06)),
  ];
  const p = previsualizarFiltros(universo, { ...CONFIG, perdidaOp: 'incluir', negativasObjetivo: 4 }, {
    estudio: ESTUDIO_EN_PERDIDA,
  });
  assert.strictEqual(p.avisos.find((x) => x.clave === 'cribadoInsuficiente'), undefined);
});

test('con las pérdidas excluidas manda el aviso de imposibilidad, no el del cribado', () => {
  /* Ahí el remedio es cambiar la política de esta pantalla, no ampliar el cribado: dar los dos
     avisos a la vez mandaría a gastar un screening que no hacía falta. */
  const universo = [
    ...Array.from({ length: 12 }, (_, i) => conMargen(`P${i}`, 0.02 + i * 0.005)),
    conMargen('N1', -0.06),
  ];
  const p = previsualizarFiltros(universo, { ...CONFIG, perdidaOp: 'excluir' }, {
    estudio: ESTUDIO_EN_PERDIDA,
  });
  assert.ok(p.avisos.some((x) => x.clave === 'imposibleCumplir'));
  assert.strictEqual(p.avisos.find((x) => x.clave === 'cribadoInsuficiente'), undefined);
});

test('el requisito se cuenta sobre las que PASARON los filtros, no sobre el cribado crudo', () => {
  /* Si se contara sobre el cribado completo, el panel prometería comparables que sus propios
     filtros ya descartaron, y el analista ampliaría el screening creyendo que le sobran. */
  const universo = [
    ...Array.from({ length: 12 }, (_, i) => conMargen(`P${i}`, 0.02 + i * 0.005)),
    /* Cuatro en el nivel, pero todas con saldo negativo: el filtro las saca. */
    ...Array.from({ length: 4 }, (_, i) => ({ ...conMargen(`N${i}`, -0.06), hasNegativeBalance: true })),
  ];
  const p = previsualizarFiltros(universo, { ...CONFIG, perdidaOp: 'incluir', negativasObjetivo: 4 }, {
    estudio: ESTUDIO_EN_PERDIDA,
  });
  const a = p.avisos.find((x) => x.clave === 'cribadoInsuficiente');
  assert.ok(a, 'el aviso aparece: las cuatro del nivel no sobrevivieron los filtros');
  assert.match(a.texto, /tiene 0/, 'ninguna valida esta en el nivel');
});
