import { test } from 'node:test';
import assert from 'node:assert';
import { hojasMemoriaRangoOptimo, TERMINOS_HOLDING_HOJA } from './memoriaCalculoRangoOptimo.js';
import { enriquecerUniverso } from './comparablesEngine.js';
import { TERMINOS_HOLDING } from './filtrosComparablesPatch.js';

/* La hoja «Selección comparables» y la «Matriz de rechazo» son el respaldo que se
   entrega ante la DIAN: si sus conteos no cuadran con el universo, el informe no se
   puede radicar. Estos tests fijan esa aritmética.

   No se recalculan las fórmulas —eso lo hace Excel—, se verifica que las fórmulas
   emitidas apunten a los rangos y a las claves de motivo correctas, que es donde
   están los errores que no se ven hasta abrir el archivo. */

const ESTUDIO = {
  t_s: 1000, t_c: 600, t_op: 200, t_ar: 100, t_inv: 50, t_ap: 80, t_ppe: 300, prime: 12,
  comparables: [
    { name: 'Buena SA', s: 500, c: 300, op: 100, ar: 50, inv: 20, ap: 40, ppe: 100 },
  ],
};

/** Localiza la fila cuya primera celda empieza por el texto dado. */
function fila(celdas, prefijo) {
  return celdas.find((f) => f && f[0] && String(f[0].v || '').startsWith(prefijo));
}

/** El universo de prueba: una por cada motivo, más una válida seleccionada. */
function universoDePrueba() {
  return [
    { name: 'Controlada SA', holderPct: 80, motivoClave: 'controlada' },
    { name: 'Alpha Group', motivoClave: 'holding', sospechaHolding: 'revisar' },
    { name: 'Negativa SA', motivoClave: 'saldoNegativo' },
    { name: 'Perdida SA', op: -5, motivoClave: 'perdidaOperativa' },
    { name: 'Sin Desc SA', motivoClave: 'sinDescripcion' },
    { name: 'Otra Act SA', motivoClave: 'actividadDistinta' },
    { name: 'Empresario SA', motivoClave: 'rigorFuncional', perfilFuncional: 'EMPRESARIO' },
    { name: 'Buena SA', s: 500, c: 300, op: 100, motivoClave: '', perfilFuncional: 'SERVICIO', seleccionada: true },
    { name: 'Reserva SA', s: 400, op: 60, motivoClave: '', perfilFuncional: 'SERVICIO' },
  ];
}

const seleccionDePrueba = () => ({ criterios: [], candidatas: universoDePrueba() });

test('sin selección no se anteponen las hojas de trazabilidad', () => {
  const hojas = hojasMemoriaRangoOptimo(ESTUDIO, null);
  const nombres = hojas.map((h) => h.nombre);
  assert.ok(!nombres.includes('Selección comparables'));
  assert.ok(!nombres.includes('Matriz de rechazo'));
  assert.ok(nombres.includes('Datos'), 'las hojas de cálculo sí se generan');
});

test('con selección se anteponen Selección comparables y Matriz de rechazo, en ese orden', () => {
  const hojas = hojasMemoriaRangoOptimo(ESTUDIO, seleccionDePrueba());
  assert.strictEqual(hojas[0].nombre, 'Selección comparables');
  assert.strictEqual(hojas[1].nombre, 'Matriz de rechazo');
});

test('el embudo cuenta los siete motivos sobre la columna que escribe el motor', () => {
  /* Las claves tienen que ser LAS MISMAS que emite scoreCandidates: si alguien
     renombra un motivo en el motor y no aquí, la fila cuenta cero en silencio. */
  const [sel] = hojasMemoriaRangoOptimo(ESTUDIO, seleccionDePrueba());
  const MOTIVOS = ['controlada', 'holding', 'saldoNegativo', 'perdidaOperativa',
    'sinDescripcion', 'actividadDistinta', 'rigorFuncional'];
  const formulas = sel.celdas.flatMap((f) => (f || []).map((c) => (c && c.f) || '')).join(' | ');
  MOTIVOS.forEach((m) => {
    assert.ok(formulas.includes(`"${m}"`), `el embudo no cuenta el motivo ${m}`);
  });
});

test('las válidas se restan de TODAS las exclusiones, no de algunas', () => {
  /* Si la resta omitiera una fila, el embudo dejaría de cuadrar en cuanto la
     curación por IA descartara a alguien. Se comparan contra las filas «(−)» que
     el propio embudo emite, y no contra un número fijo: son seis desde que los dos
     motivos de perfil se presentan juntos, y un siete quemado aquí obligaría a
     tocar el test cada vez que cambie la presentación. */
  const [sel] = hojasMemoriaRangoOptimo(ESTUDIO, seleccionDePrueba());
  const exclusiones = sel.celdas.filter((f) => f && f[0] && String(f[0].v || '').startsWith('(−)')).length;
  const f = fila(sel.celdas, '= Válidas');
  assert.ok(f, 'existe la fila de válidas');
  const restas = (f[1].f.match(/-/g) || []).length;
  assert.strictEqual(restas, exclusiones, `hay ${exclusiones} exclusiones y se restan ${restas}`);
});

test('todos los motivos del motor quedan contados, aunque se presenten en menos filas', () => {
  /* La presentación agrupa; la aritmética no puede perder ninguno. Un motivo que el
     motor escriba y la hoja no cuente descuadra la suma de control: fue exactamente
     lo que pasó con el descarte de holding por descripción. */
  const [sel] = hojasMemoriaRangoOptimo(ESTUDIO, seleccionDePrueba());
  /* Fórmulas de las filas «(−)» del embudo, que son las que restan del universo. */
  const formulas = sel.celdas
    .filter((f) => f && f[0] && String(f[0].v || '').startsWith('(−)'))
    .map((f) => f[1].f)
    .join(' ');
  ['controlada', 'holding', 'saldoNegativo', 'perdidaOperativa',
    'sinDescripcion', 'actividadDistinta', 'rigorFuncional',
  ].forEach((m) => assert.match(formulas, new RegExp(`COUNTIF\\(N\\d+:N\\d+,"${m}"\\)`), `falta contar ${m}`));
});

test('«Diferencias funcionales» recoge los motivos cualitativos y las que no entraron a la muestra', () => {
  /* Todo lo que supera los cuatro filtros objetivos y no integra la muestra cuenta
     como rechazado por comparabilidad funcional, lleve motivo escrito o no. */
  const [sel] = hojasMemoriaRangoOptimo(ESTUDIO, seleccionDePrueba());
  const f = fila(sel.celdas, '(−) Diferencias funcionales');
  assert.ok(f, 'existe la fila unificada');
  ['sinDescripcion', 'actividadDistinta', 'rigorFuncional'].forEach((m) =>
    assert.match(f[1].f, new RegExp(`COUNTIF\\(N\\d+:N\\d+,"${m}"\\)`), `falta ${m}`));
  /* El término que recoge a las que pasaron todo y no se seleccionaron. */
  assert.match(f[1].f, /COUNTIFS\(N\d+:N\d+,"",Q\d+:Q\d+,"<>Sí"\)/);
  assert.match(String(f[2].v), /No comparable con la parte examinada \(Art\. 260-4\)/);
  /* Y dejan de tener fila propia. */
  assert.ok(!fila(sel.celdas, '(−) Actividad distinta'));
  assert.ok(!fila(sel.celdas, '(−) Sin descripción'));
});

test('válida es solo la que integra la muestra', () => {
  /* El estado ya no depende de si hay motivo escrito: una compañía que superó todos
     los criterios pero no entró al rango queda rechazada por diferencias
     funcionales, que es como el informe la sustenta. */
  const [sel] = hojasMemoriaRangoOptimo(ESTUDIO, seleccionDePrueba());
  const filaCand = sel.celdas[sel.celdas.length - 1];
  assert.match(filaCand[15].f, /IF\(Q\d+="Sí","Válida","Rechazada"\)/);
  assert.match(filaCand[17].f, /"Comparable de la muestra"/);
  assert.match(filaCand[17].f, /"Diferencias funcionales"/);
});

test('la suma de control compara rechazadas + válidas contra el universo', () => {
  const [sel] = hojasMemoriaRangoOptimo(ESTUDIO, seleccionDePrueba());
  const check = fila(sel.celdas, '¿CUADRA?');
  assert.ok(check, 'existe la fila de cuadre');
  assert.ok(/^IF\(B\d+=B\d+,"SÍ ✓"/.test(check[1].f), 'compara dos celdas, no un valor quemado');
});

test('la base de datos trae una fila por candidata y el autofiltro las cubre', () => {
  const cand = universoDePrueba();
  const [sel] = hojasMemoriaRangoOptimo(ESTUDIO, { criterios: [], candidatas: cand });
  const encabezado = sel.celdas.findIndex((f) => f && f[0] && f[0].v === '#');
  assert.ok(encabezado >= 0, 'hay encabezado de la base');
  const filasDatos = sel.celdas.length - (encabezado + 1);
  assert.strictEqual(filasDatos, cand.length, 'una fila por candidata, sin sobrantes');

  const [, ultima] = /:R(\d+)$/.exec(sel.autofiltro) || [];
  assert.strictEqual(Number(ultima), sel.celdas.length, 'el autofiltro llega hasta la última fila');
  assert.strictEqual(sel.cols.length, 18, 'una anchura por columna A..R');
});

test('la nota legal de Capital IQ no cuenta como compañía', () => {
  /* «*Denotes proprietary information.» viene en la columna del nombre y desnivelaba
     el universo de la hoja frente al del motor, que ya la descarta al importar. */
  const cand = [
    { name: 'Buena SA', motivoClave: '', seleccionada: true },
    { name: '*Denotes proprietary information.' },
    { name: 'Capital IQ, a division of…' },
  ];
  const [sel] = hojasMemoriaRangoOptimo(ESTUDIO, { criterios: [], candidatas: cand });
  const nombres = sel.celdas.filter((f) => f && f[1] && typeof f[1].v === 'string').map((f) => f[1].v);
  assert.ok(!nombres.some((n) => n.startsWith('*')), 'la nota legal no entra a la base');
  assert.ok(!nombres.some((n) => n.startsWith('Capital IQ')), 'el pie de página tampoco');
});

test('acepta los dos juegos de nombres de campo (s/c y rev/cogs)', () => {
  const conRepo = hojasMemoriaRangoOptimo(ESTUDIO, {
    criterios: [], candidatas: [{ name: 'A', s: 500, c: 300, op: 100, holderPct: 40 }],
  })[0];
  const conPaquete = hojasMemoriaRangoOptimo(ESTUDIO, {
    criterios: [], candidatas: [{ name: 'A', rev: 500, cogs: 300, op: 100, maxpct: 40 }],
  })[0];
  const cifras = (h) => h.celdas[h.celdas.length - 1].slice(5, 9).map((c) => c.v);
  assert.deepStrictEqual(cifras(conRepo), cifras(conPaquete), 'las dos formas dan la misma fila');
});

test('el umbral de control viaja a las fórmulas y a los rótulos', () => {
  const [sel] = hojasMemoriaRangoOptimo(ESTUDIO, {
    criterios: [], candidatas: universoDePrueba(), umbralControl: 30,
  });
  const texto = JSON.stringify(sel.celdas);
  /* Mayor o IGUAL: con el umbral justo también hay control. */
  assert.ok(texto.includes('>=30'), 'la fórmula de la columna Controlada usa el umbral dado');
  assert.ok(texto.includes('30 %'), 'y el rótulo del embudo lo dice');
});

test('Controlada, Holding y Pérdida se marcan por separado, cada una con su fórmula', () => {
  /* Una compañía puede ser las tres cosas a la vez. La precedencia solo decide qué
     motivo queda escrito en la columna N; estas tres casillas son hechos
     independientes y ninguna depende de las otras. */
  const [sel] = hojasMemoriaRangoOptimo(ESTUDIO, {
    criterios: [],
    candidatas: [{ name: 'Mega Grupo Holding', holderPct: 80, op: -5, motivoClave: 'controlada' }],
  });
  const filaCand = sel.celdas[sel.celdas.length - 1];
  assert.match(filaCand[10].f, /IF\(N\(I\d+\)>=50/, 'K Controlada, sobre el % del mayor accionista');
  assert.match(filaCand[11].f, /SEARCH\("holding"/, 'L Holding, sobre la razón social');
  assert.match(filaCand[11].f, /SEARCH\("grupo"/, 'y con todo el vocabulario, no solo un término');
  assert.match(filaCand[12].f, /IF\(N\(G\d+\)<0/, 'M Pérdida, sobre la utilidad operacional');
});

test('el segundo cuadre compara las dos formas de contar la muestra', () => {
  /* Las válidas del embudo salen de restar las exclusiones al universo; la muestra
     sale de contar «¿Seleccionada?». Si difieren, alguna fila quedó seleccionada
     llevando motivo de rechazo, o un motivo del motor dejó de contarse. */
  const [sel] = hojasMemoriaRangoOptimo(ESTUDIO, seleccionDePrueba());
  const filaExacta = (etq) => sel.celdas.find((f) => f && f[0] && f[0].v === etq);
  const check = filaExacta('¿Coincide con las válidas del embudo?');
  assert.ok(check, 'existe la fila de cuadre');
  assert.match(check[1].f, /"NO ✗ \("&/, 'informa los dos números cuando no cuadra');
});

test('el vocabulario de holding de la hoja es el mismo que aplica el motor', () => {
  /* La hoja traduce el criterio a fórmula de Excel, así que la lista está escrita
     dos veces. Si divergen, el libro dice que una compañía es holding y el motor no
     la descartó —o al revés—, que es la contradicción más difícil de sostener ante
     la DIAN: la hoja se estaría desmintiendo a sí misma. */
  assert.deepStrictEqual(
    [...TERMINOS_HOLDING_HOJA].sort(),
    [...TERMINOS_HOLDING].sort(),
    'sincronizar TERMINOS_HOLDING_HOJA con TERMINOS_HOLDING de filtrosComparablesPatch.js'
  );
});

test('la columna Holding solo mira el nombre, nunca el SIC ni la descripción', () => {
  const [sel] = hojasMemoriaRangoOptimo(ESTUDIO, {
    criterios: [],
    candidatas: [{ name: 'Gamma Operating Corp', sic: '6719 Offices of Holding Companies', desc: 'Subsidiary of Global Holding Group' }],
  });
  const filaCand = sel.celdas[sel.celdas.length - 1];
  /* La fórmula referencia B —la columna Compañía— y ninguna otra. */
  const refs = filaCand[11].f.match(/,([A-R]\d+)\)/g) || [];
  assert.ok(refs.length > 0, 'la fórmula debería referenciar alguna celda');
  refs.forEach((ref) => assert.match(ref, /,B\d+\)/, `referencia inesperada: ${ref}`));
});

test('la matriz de rechazo cuadra contra el universo real, no contra un número fijo', () => {
  const [, mtz] = hojasMemoriaRangoOptimo(ESTUDIO, seleccionDePrueba());
  const check = fila(mtz.celdas, '¿CUADRA?');
  assert.ok(check, 'existe la fila de cuadre de la matriz');
  assert.ok(/^IF\(D\d+=D\d+,/.test(check[3].f), 'compara dos celdas calculadas');
  const universo = fila(mtz.celdas, 'UNIVERSO real');
  assert.ok(universo[3].f.includes("'Selección comparables'!B"),
    'el universo se cuenta sobre la hoja de selección');
});

test('la matriz suma los subtotales por categoría sin doble conteo', () => {
  const [, mtz] = hojasMemoriaRangoOptimo(ESTUDIO, seleccionDePrueba());
  const total = fila(mtz.celdas, 'TOTAL RECHAZADAS');
  assert.ok(/^SUM\(D\d+:D\d+\)$/.test(total[3].f),
    'el total suma el rango de motivos una sola vez, no los subtotales');
  ['filtro', 'ia', 'rigor'].forEach((cat) => {
    assert.ok(fila(mtz.celdas, 'SUBTOTAL ' + cat), `falta el subtotal de ${cat}`);
  });
});

test('el universo enriquecido por el motor alimenta el embudo de la hoja', () => {
  /* La cadena completa: lo que el motor decidió llega a las fórmulas de la hoja.
     Es el fallo que este contrato previene — un universo crudo deja la columna de
     motivo vacía y el embudo cuenta cero en todo. */
  const universo = [
    { name: 'Alpha Group', nameKey: 'ALPHA GROUP' },
    { name: 'Buena SA', nameKey: 'BUENA SA', s: 500, op: 100 },
  ];
  const candidatas = enriquecerUniverso(universo, [{ name: 'Buena SA', nameKey: 'BUENA SA', perfilFuncional: 'SERVICIO' }], {
    rechazadas: [{ name: 'Alpha Group', nameKey: 'ALPHA GROUP', motivoClave: 'holding', perfilFuncional: 'INDEFINIDO' }],
  });
  const [sel] = hojasMemoriaRangoOptimo(ESTUDIO, { criterios: [], candidatas });

  const filas = sel.celdas.slice(-2);
  assert.strictEqual(filas[0][13].v, 'holding', 'el motivo del motor llega a la columna N');
  /* La columna Holding es una fórmula sobre el nombre —«Alpha Group» contiene
     «group»—, no una marca volcada desde el motor: la hoja muestra el criterio. */
  assert.match(filas[0][11].f, /SEARCH\("group"/, 'y la columna Holding aplica el criterio');
  assert.strictEqual(filas[1][13].v, '', 'la seleccionada no trae motivo');
  assert.strictEqual(filas[1][16].v, 'Sí', 'y sí queda marcada como seleccionada');
});

/* ─────────────────────────────────────────────────────────────────────────────
   Las hojas de cálculo: la tasa y las fórmulas de ajuste.

   Nada de esto estaba cubierto, y es donde vivían los errores que llegaron al
   consultor: una fórmula que Excel no podía leer y un ajuste que salía en cero.
   ───────────────────────────────────────────────────────────────────────────── */

/* Con los doce rubros del ESF más los tres del estado de resultados, la parte
   examinada ocupa A4:B18, la tasa cae en la 19 y, con 3 comparables, el bloque de
   comparables ocupa las filas 24, 25 y 26 (encabezado en la 23). Las pruebas de
   abajo no fijan estos números a mano: los derivan de la propia hoja, con el mismo
   criterio que la prueba de caracterización de más adelante, para no volver a
   mentir la próxima vez que `RUBROS_EXAMINADA` cambie de tamaño. */
const ESTUDIO3 = {
  ...ESTUDIO,
  prime: 7.37,
  comparables: [
    { name: 'A SA', s: 500, c: 300, op: 100, ar: 50, inv: 20, ap: 40, ppe: 100 },
    { name: 'B SA', s: 800, c: 500, op: 150, ar: 90, inv: 10, ap: 60, ppe: 40 },
    { name: 'C SA', s: 300, c: 100, op: 120, ar: 30, inv: 5, ap: 20, ppe: 10 },
  ],
};

/** Todas las celdas del libro que llevan fórmula, con su hoja y su posición. */
function formulas(hojas) {
  const out = [];
  hojas.forEach((h) => (h.celdas || []).forEach((fila, r) => (fila || []).forEach((c, col) => {
    if (c && c.f) out.push({ hoja: h.nombre, fila: r + 1, col, f: String(c.f) });
  })));
  return out;
}

test('ninguna fórmula se emite con el «=» delante', () => {
  /* SheetJS escribe el campo `f` tal cual dentro de <f>…</f>, y ahí la fórmula va
     SIN el signo igual. Con él, Excel no puede parsear la expresión: abre el libro
     en modo reparación y se lleva por delante la celda. Pasó exactamente eso con la
     columna «Tasa», que es de donde las cinco hojas de método leen el Prime Rate:
     el libro llegaba al consultor sin ningún ajuste aplicado. */
  const conTodo = hojasMemoriaRangoOptimo(ESTUDIO3, seleccionDePrueba());
  const malas = formulas(conTodo).filter((c) => c.f.startsWith('='));
  assert.deepStrictEqual(malas, [], 'fórmulas con «=» inicial: ' + JSON.stringify(malas.slice(0, 3)));
});

test('la tasa se escribe una sola vez, en su propia fila, y en porcentaje', () => {
  const datos = hojasMemoriaRangoOptimo(ESTUDIO3, null).find((h) => h.nombre === 'Datos');
  const filaTasaIdx = datos.celdas.findIndex(
    (f) => f && f[0] && f[0].v === 'Tasa de interés de referencia (Prime Rate)');
  assert.ok(filaTasaIdx >= 0, 'existe la fila de la tasa');
  const celda = datos.celdas[filaTasaIdx][1];
  assert.strictEqual(celda.v, 0.0737, 'prime llega en porcentaje y se divide entre 100 aquí');
  assert.strictEqual(celda.z, '0.00%');
});

test('las tres comparables toman la tasa de esa única celda, no una propia', () => {
  /* La plantilla de Capital IQ traía la tasa del país de cada comparable escrita
     como valor fijo: tres tasas distintas en la misma columna, y dos comparables
     con 0 %, es decir, sin ajuste alguno. */
  const datos = hojasMemoriaRangoOptimo(ESTUDIO3, null).find((h) => h.nombre === 'Datos');
  const filaTasa = datos.celdas.findIndex(
    (f) => f && f[0] && f[0].v === 'Tasa de interés de referencia (Prime Rate)') + 1;
  const filaHdrComp = datos.celdas.findIndex((f) => f && f[0] && f[0].v === 'Compañía');
  for (let i = 0; i < 3; i++) {
    const tasa = datos.celdas[filaHdrComp + 1 + i][8];
    assert.strictEqual(tasa.f, `$B$${filaTasa}`, `la comparable ${i + 1} debería referenciar la celda única`);
    assert.strictEqual(tasa.v, undefined, 'y no traer un valor propio quemado');
  }
});

test('la hoja Datos documenta de dónde sale la tasa y a quién se aplica', () => {
  const datos = hojasMemoriaRangoOptimo(ESTUDIO3, null).find((h) => h.nombre === 'Datos');
  /* El bloque de trazabilidad de la tasa vive en las columnas L–N (índices 11 y 12),
     anotado siempre en las filas 3ª a 7ª de la hoja (índices 2 a 6): esas filas son
     fijas y no se mueven al ampliar RUBROS_EXAMINADA, porque el bloque no forma
     parte de la lista de rubros. */
  const etiquetas = [2, 3, 4, 5, 6].map((r) => datos.celdas[r][11] && datos.celdas[r][11].v);
  assert.ok(etiquetas[0].startsWith('PARÁMETRO'), 'el bloque arranca con su título');
  assert.deepStrictEqual(etiquetas.slice(1), ['Tasa aplicada', 'Fuente', 'Aplicación', 'Convención']);
  assert.match(datos.celdas[4][12].v, /RIFSPBLPNA/, 'la fuente cita la serie, no solo el número');
  const filaTasa = datos.celdas.findIndex(
    (f) => f && f[0] && f[0].v === 'Tasa de interés de referencia (Prime Rate)') + 1;
  assert.strictEqual(datos.celdas[3][12].f, `$B$${filaTasa}`,
    'el bloque refleja la celda editable, no la duplica');
});

test('el texto de «Aplicación» cita la dirección completa de la tasa, no una a medias', () => {
  /* Regresión: un literal de plantilla reciclaba `celdaTasa` (p.ej. "B19", sin el
     primer "$") dentro de un texto que ya traía un "$" antes de la interpolación. En
     JS eso NO produce dos signos de dólar seguidos: el primero queda literal y el
     segundo es el que abre `${...}`, así que salía «=$B19» en vez de «=$B$19». La
     fórmula real (fila «Tasa aplicada») estaba bien; lo que mentía era el texto que la
     describe para quien audita el libro. */
  const datos = hojasMemoriaRangoOptimo(ESTUDIO3, null).find((h) => h.nombre === 'Datos');
  const direccionTasa = `=${datos.celdas[3][12].f}`; // p.ej. '=$B$19', a partir de la fórmula real
  const aplicacion = datos.celdas[5][12].v;
  assert.ok(aplicacion.includes(direccionTasa),
    `«Aplicación» debería citar la dirección completa ${direccionTasa}: ${aplicacion}`);
});

test('el ajuste de PP&E escala por la base, igual que las otras tres partidas', () => {
  /* Sin el factor de base, la columna Q salía dividida por el monto de las ventas y
     los escenarios «+PP&E» y «PP&E» reproducían a los que no llevan PP&E. Las filas
     se derivan de la propia hoja Datos, no de un número fijo: son las que mueve
     ampliar RUBROS_EXAMINADA. */
  const hojas = hojasMemoriaRangoOptimo(ESTUDIO3, null);
  const datos = hojas.find((h) => h.nombre === 'Datos');
  const filaDe = (etiqueta) => datos.celdas.findIndex((f) => f && f[0] && f[0].v === etiqueta) + 1;
  const fPpe = filaDe('Propiedades, planta y equipo');
  const fVentas = filaDe('Ventas netas');
  const fCosto = filaDe('Costo de ventas');
  const fGastos = filaDe('Gastos operativos');

  const mo = hojas.find((h) => h.nombre === 'MO');
  assert.strictEqual(mo.celdas[2][16].f, `((H3/M3)-(Datos!$B$${fPpe}/Datos!$B$${fVentas}))*(M3*I3)`);
  const ncp = hojas.find((h) => h.nombre === 'NCP');
  assert.strictEqual(ncp.celdas[2][16].f,
    `((H3/((C3-G3)+D3))-(Datos!$B$${fPpe}/(Datos!$B$${fCosto}+Datos!$B$${fGastos})))*(M3*I3)`,
    'NCP toma el ratio sobre el denominador depurado pero escala con la base del método');
});

test('los sabores que no ajustan CxC no dividen sobre la venta ajustada', () => {
  const hojas = hojasMemoriaRangoOptimo(ESTUDIO3, null);
  const mo = hojas.find((h) => h.nombre === 'MO');
  // columnas S..Y = índices 18..24; U=20 (CxP), V=21 (Inv), Y=24 (PP&E)
  assert.strictEqual(mo.celdas[2][20].f, '(J3+O3)/M3');
  assert.strictEqual(mo.celdas[2][21].f, '(J3-P3)/M3');
  assert.strictEqual(mo.celdas[2][24].f, '(J3-Q3)/M3');
  // los que sí ajustan CxC siguen usando R, la venta ajustada
  assert.strictEqual(mo.celdas[2][19].f, '(J3-N3)/R3', 'solo CxC');
  assert.strictEqual(mo.celdas[2][22].f, '(J3-N3+O3-P3)/R3', 'el escenario que reporta el informe');

  /* En NCP y Cost Plus la columna R es el denominador depurado (COGS−CxP), que no
     tiene nada que ver con el ajuste de CxC: ahí se mantiene en los siete sabores. */
  const ncp = hojas.find((h) => h.nombre === 'NCP');
  assert.strictEqual(ncp.celdas[2][20].f, '(J3+O3)/R3');
});

test('el libro trae una hoja de diagnóstico con las comprobaciones sobre los datos', () => {
  const hojas = hojasMemoriaRangoOptimo(ESTUDIO3, null);
  const dg = hojas.find((h) => h.nombre === 'Diagnóstico de datos');
  assert.ok(dg, 'debería existir la hoja de diagnóstico');
  const texto = JSON.stringify(dg.celdas);
  assert.match(texto, /SUMPRODUCT/, 'los conteos son fórmulas, no valores calculados en JS');
  /* El rango de comparables se deriva de la hoja Datos —la tabla de comparables es
     lo último que se escribe ahí— y no de un número fijo: son las filas que ampliar
     RUBROS_EXAMINADA corre hacia abajo. */
  const datos = hojas.find((h) => h.nombre === 'Datos');
  const filaHdrComp = datos.celdas.findIndex((f) => f && f[0] && f[0].v === 'Compañía') + 1;
  const filaComp0 = filaHdrComp + 1;
  const filaCompN = datos.celdas.length;
  assert.match(texto, new RegExp(`Datos!\\$C\\$${filaComp0}:\\$C\\$${filaCompN}`),
    'y apuntan al rango real de comparables');
  /* Una fila por comparable en la sección de PP&E, referida a la hoja MO para no
     reimplementar el ajuste una segunda vez. */
  assert.match(texto, /MO!Q3/);
  assert.match(texto, /MO!Q5/);
});

test('sin comparables no se arma la hoja de diagnóstico', () => {
  const hojas = hojasMemoriaRangoOptimo({ ...ESTUDIO, comparables: [] }, null);
  assert.ok(!hojas.some((h) => h.nombre === 'Diagnóstico de datos'));
});

test('el emisor descuenta el segmento excluido, no el llamador', () => {
  /* MemoriaRangoModal.jsx:93 llama aquí directo. Si el descuento viviera en
     motorExcelExport, el libro del modal saldría con las ventas sin descontar y el del
     motor con ellas descontadas: dos libros distintos para el mismo estudio. */
  const datos = hojasMemoriaRangoOptimo(
    { ...ESTUDIO, t_s: 1000, seg_excluido: 120 }, null,
  ).find((h) => h.nombre === 'Datos');
  const ventas = datos.celdas.find((f) => f && f[0] && f[0].v === 'Ventas netas');
  assert.strictEqual(ventas[1].v, 880);
});

test('la hoja Datos trae el ESF completo con el A.V. como fórmula viva', () => {
  const estudio = {
    ...ESTUDIO,
    t_cash: 10, t_inv_assoc: 20, t_tax: 30, t_act_curr: 200,
    t_intang: 40, t_dif: 50, t_act_nocurr: 400, t_act_tot: 600,
  };
  const datos = hojasMemoriaRangoOptimo(estudio, null).find((h) => h.nombre === 'Datos');
  const fila = (etiqueta) => datos.celdas.find((f) => f && f[0] && f[0].v === etiqueta);

  /* Los doce rubros que la ingesta sabe leer, con las etiquetas literales de
     RUBROS_ESF (docxRelleno.js): quien audita el libro contra el ANEXO A tiene que
     poder mapear cada fila por su texto exacto. */
  ['Efectivo y equivalentes de efectivo', 'Inversiones asociadas',
    'Cuentas por cobrar comerciales y otras cuentas por cobrar', 'Inventarios',
    'Activos por impuestos corrientes', 'Total, Activo corriente',
    'Propiedades, planta y equipo', 'Intangibles',
    'Diferidos', 'Total, Activos no corrientes', 'Total, Activos',
    'Cuentas por pagar comerciales'].forEach((r) => {
    assert.ok(fila(r), `falta el rubro «${r}» en la hoja Datos`);
  });

  /* El A.V. es fórmula sobre el total de activos, no un número ya cocinado. */
  const filaTot = datos.celdas.findIndex((f) => f && f[0] && f[0].v === 'Total, Activos') + 1;
  const av = fila('Efectivo y equivalentes de efectivo')[2];
  assert.ok(av && av.f, 'el A.V. se emite como fórmula');
  assert.ok(av.f.includes(`$B$${filaTot}`),
    `el A.V. divide sobre el total de activos: ${av.f}`);

  /* El total de activos no lleva A.V. en esta hoja: un 100 % por definición no
     informa nada, aunque filasEsfAnexoA sí lo calcula y lo publica en el ANEXO A. */
  assert.strictEqual(fila('Total, Activos')[2], undefined);

  /* Las cuentas por pagar tampoco: un pasivo sobre el total de activos no significa
     nada, y esta sí es la misma exclusión que aplica filasEsfAnexoA en
     docxRelleno.js (las publica con SIN_DATO, fuera del `map` de RUBROS_ESF). */
  assert.strictEqual(fila('Cuentas por pagar comerciales')[2], undefined);
});

test('el A.V. no revienta en #DIV/0! cuando el total de activos llega en cero', () => {
  /* Guarda equivalente a la de `verticalSobreActivos` en docxRelleno.js (ahí
     devuelve «—» sin total). Aquí la celda debe quedar en blanco, no en error, y
     esto cubre también un subtotal y el último rubro con A.V. de la lista, que es
     donde un off-by-one en filaDeRubro pasaría desapercibido. */
  const estudio = { ...ESTUDIO, t_act_tot: 0, t_act_nocurr: 400, t_ap: 80 };
  const datos = hojasMemoriaRangoOptimo(estudio, null).find((h) => h.nombre === 'Datos');
  const fila = (etiqueta) => datos.celdas.find((f) => f && f[0] && f[0].v === etiqueta);
  const filaTot = datos.celdas.findIndex((f) => f && f[0] && f[0].v === 'Total, Activos') + 1;

  [fila('Efectivo y equivalentes de efectivo'), fila('Total, Activos no corrientes')]
    .forEach((f) => {
      assert.ok(f[2] && f[2].f, 'sigue siendo fórmula');
      assert.ok(f[2].f.startsWith(`IF($B$${filaTot}=0,"",`), `guarda contra división por cero: ${f[2].f}`);
    });
});

test('las referencias del contribuyente apuntan al rubro, no a una fila fija', () => {
  /* Esta prueba pasa antes y después del refactor: es la red que impide que ampliar
     la hoja Datos deje las hojas de método apuntando al rubro equivocado, que es un
     fallo que no revienta —da un número creíble y falso—. */
  const hojas = hojasMemoriaRangoOptimo(ESTUDIO, null);
  const datos = hojas.find((h) => h.nombre === 'Datos');
  const mo = hojas.find((h) => h.nombre === 'MO');

  const filaDe = (etiqueta) => datos.celdas.findIndex(
    (f) => f && f[0] && f[0].v === etiqueta) + 1;

  /* Fila 3 de la hoja MO = primera comparable; índice 13 = columna N = Aj.CxC. */
  const ajCxC = mo.celdas[2][13].f;
  const ajInv = mo.celdas[2][15].f;
  const ajPpe = mo.celdas[2][16].f;

  assert.ok(ajCxC.includes(`Datos!$B$${filaDe('Cuentas por cobrar comerciales y otras cuentas por cobrar')}`),
    `Aj.CxC apunta al rubro de CxC: ${ajCxC}`);
  assert.ok(ajInv.includes(`Datos!$B$${filaDe('Inventarios')}`),
    `Aj.Inv apunta al rubro de inventarios: ${ajInv}`);
  assert.ok(ajPpe.includes(`Datos!$B$${filaDe('Propiedades, planta y equipo')}`),
    `Aj.PP&E apunta al rubro de PP&E: ${ajPpe}`);

  /* La columna Tasa de cada comparable apunta a la fila de la tasa. */
  const filaTasa = filaDe('Tasa de interés de referencia (Prime Rate)');
  const primeraComp = datos.celdas.findIndex((f) => f && f[0] && f[0].v === 'Buena SA');
  assert.strictEqual(datos.celdas[primeraComp][8].f, `$B$${filaTasa}`);
});
