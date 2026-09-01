/* Tests del libro de soporte del Motor de Comparables.

   Este módulo es solo un adaptador —traduce el payload que arma MotorComparables al
   estudio que espera `hojasMemoriaRangoOptimo`— y precisamente por eso no tenía
   tests: parecía que no había nada que probar. Ahí se coló que la tasa llegara
   dividida entre 100 dos veces, con lo que el libro salía con un Prime Rate de
   0,0737 % y ningún comparable recibía ajuste. Estos tests cubren el trayecto
   completo, del payload a la celda. */

import { test } from 'node:test';
import assert from 'node:assert';
import XLSX from 'xlsx-js-style';
import { construirLibroSoporte, construirPayloadSoporte } from './motorExcelExport.js';

/** Fila 1-based de la hoja cuya columna A empieza por `etiqueta`, para no fijar a
    mano un número que se mueve cada vez que `RUBROS_EXAMINADA` cambia de tamaño. */
function filaEnHoja(hoja, etiqueta) {
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true });
  return filas.findIndex((f) => f && f[0] === etiqueta) + 1;
}

/* Payload con la misma forma que arma `handleExportarExcel` en MotorComparables.jsx.
   Ojo con `T.op`: ahí es la utilidad operacional, no los gastos — el adaptador la
   convierte antes de pasarla al generador. */
const PAYLOAD = {
  estudio: {
    entidad: 'Ejemplo SAS', anio: 2025, pli: 'MO', useAdj: true,
    /* El componente publica las dos: `interestRate` ya dividida, para su propio
       cálculo en pantalla, y `prime` tal como la escribió el usuario. */
    interestRate: 0.0737,
    prime: '7.37',
  },
  examinada: {
    T: { s: 1000, c: 600, op: 200, ar: 100, inv: 50, ap: 80, ppe: 300 },
  },
  comparables: [
    { name: 'A SA', s: 500, c: 300, op: 100, ar: 50, inv: 20, ap: 40, ppe: 100 },
    { name: 'B SA', s: 800, c: 500, op: 150, ar: 90, inv: 10, ap: 60, ppe: 40 },
    { name: 'C SA', s: 300, c: 100, op: 120, ar: 30, inv: 5, ap: 20, ppe: 10 },
  ],
};

test('la tasa llega al libro sin dividirse dos veces', () => {
  /* 7,37 % tiene que aterrizar en su celda como 0,0737. Si alguien vuelve a leer
     `interestRate` en el adaptador, aquí sale 0,000737 y el test lo dice. */
  const wb = construirLibroSoporte(PAYLOAD);
  const fila = filaEnHoja(wb.Sheets.Datos, 'Tasa de interés de referencia (Prime Rate)');
  const celda = wb.Sheets.Datos[`B${fila}`];
  assert.ok(celda, 'la celda de la tasa debería existir');
  assert.ok(Math.abs(celda.v - 0.0737) < 1e-12, `Datos!B${fila} = ${celda.v}, esperado 0.0737`);
});

test('un estudio sin tasa no inventa una', () => {
  const sinTasa = { ...PAYLOAD, estudio: { ...PAYLOAD.estudio, prime: undefined } };
  const wb = construirLibroSoporte(sinTasa);
  const fila = filaEnHoja(wb.Sheets.Datos, 'Tasa de interés de referencia (Prime Rate)');
  assert.strictEqual(wb.Sheets.Datos[`B${fila}`].v, 0);
});

test('las comparables toman la tasa de la celda única', () => {
  const wb = construirLibroSoporte(PAYLOAD);
  const filaTasa = filaEnHoja(wb.Sheets.Datos, 'Tasa de interés de referencia (Prime Rate)');
  const filaHdrComp = filaEnHoja(wb.Sheets.Datos, 'Compañía');
  for (let i = 0; i < 3; i++) {
    const ref = `I${filaHdrComp + 1 + i}`;
    assert.strictEqual(wb.Sheets.Datos[ref].f, `$B$${filaTasa}`, `${ref} debería referenciar la celda única`);
  }
});

test('el libro trae las hojas de cálculo y la de diagnóstico', () => {
  const wb = construirLibroSoporte(PAYLOAD);
  ['Resumen', 'Diagnóstico de datos', 'Datos', 'MO', 'MB', 'Berry', 'CostPlus', 'NCP']
    .forEach((h) => assert.ok(wb.SheetNames.includes(h), `falta la hoja ${h}`));
});

test('el .xlsx escrito no lleva ninguna fórmula que Excel rechace', () => {
  /* La prueba de fuego del bug de la columna «Tasa»: no basta con mirar el objeto
     de celda, hay que ver el XML que acaba dentro del archivo. Una fórmula con «=»
     delante sale como <f>=…</f>, Excel no la puede parsear y abre el libro en
     modo reparación descartando la celda. */
  const wb = construirLibroSoporte(PAYLOAD);
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  const releido = XLSX.read(bytes, { type: 'buffer', bookFiles: true });

  const hojasXml = Object.keys(releido.files || {}).filter((n) => /xl\/worksheets\/.*\.xml$/.test(n));
  assert.ok(hojasXml.length > 0, 'el libro escrito debería traer hojas');
  hojasXml.forEach((nombre) => {
    const xml = Buffer.from(releido.files[nombre].content).toString('utf8');
    assert.ok(!xml.includes('<f>='), `${nombre} contiene una fórmula con «=» inicial`);
  });
});

test('la propiedad, planta y equipo llega al libro, no en cero', () => {
  /* `T.ppe` no existía en el payload que arma el componente, y el adaptador lo busca
     ahí primero: el libro salía con PP&E en cero para la parte examinada aunque el
     estudio la tuviera cargada, y el ajuste de PP&E se calculaba contra nada. */
  const wb = construirLibroSoporte(PAYLOAD);
  const fila = filaEnHoja(wb.Sheets.Datos, 'Propiedades, planta y equipo');
  assert.strictEqual(wb.Sheets.Datos[`B${fila}`].v, 300, 'PP&E de la parte examinada');
});

test('el PP&E de cada comparable viaja a su fila', () => {
  const wb = construirLibroSoporte(PAYLOAD);
  const filaHdrComp = filaEnHoja(wb.Sheets.Datos, 'Compañía');
  assert.deepStrictEqual(
    [1, 2, 3].map((i) => wb.Sheets.Datos[`H${filaHdrComp + i}`].v),
    [100, 40, 10],
  );
});

test('los gastos operativos se derivan de la utilidad antes de llegar al generador', () => {
  /* `T.op` entra como utilidad operacional (200) y el generador espera gastos:
     1000 − 600 − 200 = 200 en este caso, que coincide por casualidad numérica, así
     que se comprueba con un juego donde no coinciden. */
  const otro = {
    ...PAYLOAD,
    examinada: { T: { s: 1000, c: 600, op: 150, ar: 100, inv: 50, ap: 80, ppe: 300 } },
  };
  const wb = construirLibroSoporte(otro);
  /* La magnitud es lo que esta prueba vigila —que el generador reciba GASTOS y no la
     utilidad—; el signo es el convenio de egreso de la hoja (2026-08-21). */
  assert.strictEqual(wb.Sheets.Datos.B6.v, -250, 'gastos = ventas − costo − utilidad operacional');
});

test('el libro recibe el ámbito, el segmento excluido y el amb de cada comparable', () => {
  /* Sin estos tres campos el libro calcula su rango sobre las 16 filas y sobre unas
     ventas sin descontar, mientras el informe filtra por ámbito y descuenta: dos
     rangos distintos para el mismo estudio, y el libro se radica como su soporte. */
  const wb = construirLibroSoporte({
    estudio: {
      t_s: 1000, t_c: 600, t_op: 200, t_ar: 100, t_inv: 50, t_ap: 80, t_ppe: 300,
      prime: 7.37, cmode: 'nac', seg_excluido: 120,
    },
    comparables: [
      { name: 'Nacional A', amb: 'Nac', s: 500, c: 300, op: 380 },
      { name: 'Internacional X', amb: 'Int', s: 900, c: 100, op: 700 },
    ],
  });

  const datos = XLSX.utils.sheet_to_json(wb.Sheets.Datos, { header: 1, raw: true });
  /* B4 son las ventas de la parte examinada: 1000 − 120 de segmento excluido. */
  const filaVentas = datos.find((f) => f && f[0] === 'Ventas netas');
  assert.strictEqual(filaVentas[1], 880, 'las ventas del libro descuentan seg_excluido');

  const filaAmbito = datos.find((f) => f && f[0] === 'Ámbito de la muestra');
  assert.ok(filaAmbito, 'el libro declara el ámbito de la muestra');
  assert.strictEqual(filaAmbito[1], 'nac');

  /* La columna J de cada comparable lleva su ámbito. */
  const hdr = datos.find((f) => f && f[0] === 'Compañía');
  assert.strictEqual(hdr[9], 'Ámbito');
  const filaNac = datos.find((f) => f && f[0] === 'Nacional A');
  assert.strictEqual(filaNac[9], 'Nac');
  const filaInt = datos.find((f) => f && f[0] === 'Internacional X');
  assert.strictEqual(filaInt[9], 'Int');
});

/* Los ocho rubros del ESF que la Task 4 añadió a RUBROS_EXAMINADA no llegaban por esta
   ruta: `estudioBase` no los traía, así que `valorDeRubro` los leía en 0 en TODA
   exportación del Motor de Comparables y el A.V. dividía sobre un total de activos
   también en cero —#DIV/0! en las diez celdas—. Estos dos tests cubren el trayecto
   completo del payload a la celda, igual que el resto del archivo. */

/* ESTUDIO en la forma que de verdad tiene en la aplicación: los quince `t_*` sobre el
   objeto del estudio. La versión anterior de esta prueba pasaba `examinada.T.cash`,
   `T.act_tot` y compañía —una forma que `MotorComparables.jsx` no producía nunca—, así
   que estaba verde sobre una ruta inexistente mientras la real publicaba los ocho rubros
   del ESF en cero. Ahora el payload se arma con `construirPayloadSoporte`, que es
   exactamente lo que llama el componente. */
const ESTUDIO_REAL = {
  ent: 'Ejemplo SAS', anio: 2025, pli: 'MO', prime: '7.37', cmode: 'all',
  t_s: 1000, t_c: 600, t_op: 200, t_ar: 100, t_inv: 50, t_ap: 80, t_ppe: 300,
  t_cash: 10, t_inv_assoc: 20, t_tax: 30, t_act_curr: 200,
  t_intang: 40, t_dif: 50, t_act_nocurr: 400, t_act_tot: 600,
};

const EXTRAS_REALES = {
  pli: 'MO',
  useAdj: true,
  interestRate: 0.0737,
  cmode: 'all',
  examinada: { T: { s: 1000, c: 600, op: 200, ar: 100, inv: 50, ap: 80, ppe: 300 } },
  comparables: [
    { name: 'A SA', s: 500, c: 300, op: 100, ar: 50, inv: 20, ap: 40, ppe: 100 },
    { name: 'B SA', s: 800, c: 500, op: 150, ar: 90, inv: 10, ap: 60, ppe: 40 },
    { name: 'C SA', s: 300, c: 100, op: 120, ar: 30, inv: 5, ap: 20, ppe: 10 },
  ],
};

test('construirLibroSoporte escribe los doce rubros del ESF y el A.V. como fórmula', () => {
  const wb = construirLibroSoporte(construirPayloadSoporte(ESTUDIO_REAL, EXTRAS_REALES));
  const hoja = wb.Sheets.Datos;
  const filaTot = filaEnHoja(hoja, 'Total, Activos');
  assert.ok(filaTot > 0, 'existe la fila de Total, Activos');
  assert.strictEqual(hoja[`B${filaTot}`].v, 600, 'el total de activos llega, no en cero');

  /* Los diez rubros de balance con A.V.: incluye el primero y el último de la lista
     —Efectivo y Total, Activos no corrientes—, que es donde un off-by-one en
     filaDeRubro pasaría desapercibido, y los dos subtotales intermedios. */
  [
    ['Efectivo y equivalentes de efectivo', 10],
    ['Inversiones asociadas', 20],
    ['Cuentas por cobrar comerciales y otras cuentas por cobrar', 100],
    ['Inventarios', 50],
    ['Activos por impuestos corrientes', 30],
    ['Total, Activo corriente', 200],
    ['Propiedades, planta y equipo', 300],
    ['Intangibles', 40],
    ['Diferidos', 50],
    ['Total, Activos no corrientes', 400],
  ].forEach(([etiqueta, valor]) => {
    const fila = filaEnHoja(hoja, etiqueta);
    assert.ok(fila > 0, `falta el rubro «${etiqueta}» en la hoja Datos`);
    assert.strictEqual(hoja[`B${fila}`].v, valor, `${etiqueta} llega con su valor, no en cero`);
    const av = hoja[`C${fila}`];
    assert.ok(av && av.f, `${etiqueta} debería llevar el A.V. como fórmula`);
    assert.ok(av.f.includes(`$B$${filaTot}`), `${etiqueta}: el A.V. divide sobre el total de activos: ${av.f}`);
  });
});

test('con t_act_tot ausente, el A.V. queda en blanco y no en #DIV/0!', () => {
  const sinTotal = { ...ESTUDIO_REAL, t_act_tot: undefined, t_act_nocurr: undefined };
  const wb = construirLibroSoporte(construirPayloadSoporte(sinTotal, EXTRAS_REALES));
  const hoja = wb.Sheets.Datos;
  const filaTot = filaEnHoja(hoja, 'Total, Activos');
  const filaCash = filaEnHoja(hoja, 'Efectivo y equivalentes de efectivo');
  const filaNocurr = filaEnHoja(hoja, 'Total, Activos no corrientes');

  assert.strictEqual(hoja[`B${filaTot}`].v, 0, 'sin dato, el total de activos llega en cero');
  [filaCash, filaNocurr].forEach((fila) => {
    const av = hoja[`C${fila}`];
    assert.ok(av && av.f, 'sigue siendo fórmula, no un valor quemado');
    assert.ok(av.f.startsWith(`IF($B$${filaTot}=0,"",`), `la guarda evita el #DIV/0!: ${av.f}`);
    assert.strictEqual(av.v, undefined, 'sin un valor cacheado que finja un resultado');
  });
});

/* ══════ La ruta real del componente ══════
   Estas dos pruebas afirman lo que la anterior daba por sabido sin comprobarlo: que el
   payload que arma el componente lleva de verdad los quince rubros y el ámbito. */

test('construirPayloadSoporte lleva los quince rubros del estudio, no una selección a mano', () => {
  const payload = construirPayloadSoporte(ESTUDIO_REAL, EXTRAS_REALES);
  [
    't_s', 't_c', 't_op', 't_cash', 't_inv_assoc', 't_ar', 't_inv', 't_tax',
    't_act_curr', 't_ppe', 't_intang', 't_dif', 't_act_nocurr', 't_act_tot', 't_ap',
  ].forEach((clave) => assert.strictEqual(
    payload.estudio[clave], ESTUDIO_REAL[clave],
    `el payload debería llevar ${clave}; sin él la hoja Datos lo publica en cero`));
});

test('el ámbito del tablero viaja al libro, aunque el estudio guardado diga otra cosa', () => {
  /* `cmode` vive en el estado del tablero y se sincroniza al estudio después; si el
     payload lo tomara solo del estudio, el libro cuartilaría sobre otro universo que el
     que el analista está viendo en pantalla. */
  const payload = construirPayloadSoporte(
    { ...ESTUDIO_REAL, cmode: 'all' }, { ...EXTRAS_REALES, cmode: 'nac' });
  assert.strictEqual(payload.estudio.cmode, 'nac');
  const wb = construirLibroSoporte(payload);
  const filas = XLSX.utils.sheet_to_json(wb.Sheets.Datos, { header: 1, raw: true });
  const filaAmbito = filas.find((f) => f && f[0] === 'Ámbito de la muestra');
  assert.strictEqual(filaAmbito[1], 'nac');
});

test('el segmento excluido se descuenta una sola vez por la ruta del componente', () => {
  /* `T.s` viene con el segmento ya descontado y el emisor lo descuenta otra vez: si el
     adaptador prefiriera `T` sobre el estudio en bruto, el libro publicaría 760 en vez de
     880 y el informe seguiría en 880. */
  const payload = construirPayloadSoporte(
    { ...ESTUDIO_REAL, seg_excluido: 120 },
    { ...EXTRAS_REALES, examinada: { T: { ...EXTRAS_REALES.examinada.T, s: 880, op: 80 } } });
  const wb = construirLibroSoporte(payload);
  const filas = XLSX.utils.sheet_to_json(wb.Sheets.Datos, { header: 1, raw: true });
  const filaVentas = filas.find((f) => f && f[0] === 'Ventas netas');
  assert.strictEqual(filaVentas[1], 880, 'ventas = 1000 − 120, descontado una vez');
});

test('las correcciones de la ingesta llegan al libro también por la ruta del Motor', () => {
  /* El modal de memoria recibe el estudio entero y las traía; esta ruta armaba el payload
     campo a campo y las dejaba fuera, así que el mismo estudio producía dos libros: uno
     que declaraba la cifra corregida y otro que la publicaba sin decir de dónde salió. */
  const correcciones = [{
    campo: 't_op', etiqueta: 'Utilidad operacional',
    valorLeido: -2986236031, valorAplicado: -1095055781,
    rotuloLeido: 'RESULTADO DE ACTIVIDADES DE LA OPERACIÓN',
    motivo: 'No cuadra con el resto del estado.',
  }];
  const payload = construirPayloadSoporte(
    { ...ESTUDIO_REAL, t_correcciones: correcciones }, EXTRAS_REALES);
  assert.deepStrictEqual(payload.estudio.t_correcciones, correcciones);

  const wb = construirLibroSoporte(payload);
  const diag = wb.Sheets['Diagnóstico de datos'];
  assert.ok(diag, 'el libro trae la hoja de diagnóstico');
  const filas = XLSX.utils.sheet_to_json(diag, { header: 1, raw: true });
  assert.ok(filas.some((f) => f && String(f[0] || '').includes('CIFRAS CORREGIDAS')),
    'con su sección de cifras corregidas');
  const fila = filas.find((f) => f && f[0] === 'Utilidad operacional');
  assert.ok(fila, 'y la fila de la corrección');
  assert.strictEqual(fila[1], -2986236031);
  assert.strictEqual(fila[2], -1095055781);
});

/* ══════════ La categoría «rigor» se llama igual en todo el libro ══════════

   El filtro de rigor funcional se retiró del motor el 2026-08-10 y su selector salió del paso 2
   el 2026-09-01. La CATEGORÍA `rigor` sigue muy viva, pero significa otra cosa: todo lo que
   supera los cuatro filtros objetivos, pasa la curación y simplemente no integra la muestra.
   Ante la DIAN eso son «diferencias funcionales» (Art. 260-4), y así lo llaman ya la Tabla 16
   del informe y la hoja del embudo de este mismo libro.

   La hoja «Candidatas rechazadas» seguía llamándola «Rigor funcional», de modo que el mismo
   archivo se contradecía entre dos hojas y nombraba un control que ya no existe. Quien audite el
   libro contra el informe no puede encontrar «Rigor funcional» en ninguna parte de la norma. */

test('la hoja de rechazadas llama «Diferencias funcionales» a lo que el embudo llama igual', () => {
  const libro = construirLibroSoporte({
    ...PAYLOAD,
    auditoria: {
      rechazadas: [
        { name: 'Alfa SA', id: '1', categoriaRechazo: 'rigor', motivoRechazo: 'No integra la muestra' },
        { name: 'Beta SA', id: '2', categoriaRechazo: 'filtro', motivoRechazo: 'Holding' },
        { name: 'Gamma SA', id: '3', categoriaRechazo: 'ia', motivoRechazo: 'Actividad distinta' },
      ],
    },
  });
  assert.ok(libro.SheetNames.includes('Candidatas rechazadas'), 'la hoja debe existir');
  const filas = XLSX.utils.sheet_to_json(libro.Sheets['Candidatas rechazadas'], { header: 1, raw: true });
  const porNombre = Object.fromEntries(filas.slice(1).map((f) => [f[0], f[4]]));

  assert.strictEqual(porNombre['Alfa SA'], 'Diferencias funcionales (Art. 260-4)');
  assert.strictEqual(porNombre['Beta SA'], 'Filtro (holding/saldo negativo/pérdida)',
    'las otras dos categorías no cambian');
  assert.strictEqual(porNombre['Gamma SA'], 'Curación IA');
});

test('ninguna hoja del libro nombra el rigor funcional retirado', () => {
  /* Una etiqueta que nombra un control inexistente manda al auditor a buscar un criterio que no
     puede encontrar ni en el informe ni en la norma. */
  const libro = construirLibroSoporte({
    ...PAYLOAD,
    auditoria: {
      rechazadas: [{ name: 'Alfa SA', id: '1', categoriaRechazo: 'rigor', motivoRechazo: 'x' }],
    },
  });
  assert.ok(libro.SheetNames.includes('Candidatas rechazadas'), 'la hoja debe existir');
  libro.SheetNames.forEach((nombre) => {
    const texto = XLSX.utils.sheet_to_csv(libro.Sheets[nombre]);
    assert.doesNotMatch(texto, /Rigor funcional/i, `la hoja «${nombre}» todavía lo nombra`);
  });
});
