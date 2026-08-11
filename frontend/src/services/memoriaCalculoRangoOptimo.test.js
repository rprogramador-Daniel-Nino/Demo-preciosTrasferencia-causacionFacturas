import { test } from 'node:test';
import assert from 'node:assert';
import { hojasMemoriaRangoOptimo, TERMINOS_HOLDING_HOJA } from './memoriaCalculoRangoOptimo.js';
import { analizarRangoAjustado } from './ajusteRangoCapitalTrabajo.js';
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

test('el cuartil del libro se calcula sobre el universo filtrado, no sobre todas las filas', () => {
  const estudio = {
    ...ESTUDIO, cmode: 'nac',
    comparables: [
      { name: 'Nacional A', amb: 'Nac', s: 500, c: 300, op: 100, ar: 50, inv: 20, ap: 40, ppe: 100 },
      { name: 'Internacional X', amb: 'Int', s: 900, c: 100, op: 100, ar: 10, inv: 5, ap: 5, ppe: 10 },
    ],
  };
  const mo = hojasMemoriaRangoOptimo(estudio, null).find((h) => h.nombre === 'MO');
  const filaCon = (etq) => mo.celdas.find((f) => f && f[17] && f[17].v === etq);

  /* Índice 26 = columna AA, la primera de la serie filtrada (índices 0-25 son A-Z:
     ver el relleno de `filaEstadistica`). Los índices 25 (Z) y 26 (AA) de más abajo
     usan el mismo criterio; este es el que faltaba actualizar. */
  const p25 = filaCon('P25 (cuartil inferior)')[26].f;
  assert.ok(!/QUARTILE\(S\d+:S\d+/.test(p25),
    `el cuartil no puede leer la columna S en bruto: ${p25}`);
  assert.ok(/AA\d+:AA\d+/.test(p25),
    `el cuartil lee la serie filtrada: ${p25}`);

  /* La guarda de muestra mínima, la misma que aplica el motor en :312. */
  assert.ok(p25.includes('COUNT('), `falta la guarda de muestra mínima: ${p25}`);
  assert.ok(p25.includes('<3'), `la guarda tiene que ser de tres observaciones: ${p25}`);

  /* La columna Z resuelve el ámbito leyendo el de la comparable y el de la muestra. */
  const z = mo.celdas[2][25].f;
  assert.ok(z && z.includes('Datos!'), `la columna Z lee el ámbito de Datos: ${z}`);

  /* La serie del rango vacía la fila que no entra. */
  const aa = mo.celdas[2][26].f;
  assert.ok(aa.includes('Z3') && aa.includes('S3'),
    `la serie del rango depende del ámbito y del valor: ${aa}`);
});

/* ─────────────────────────────────────────────────────────────────────────────
   El valor en caché de cada celda derivada.

   Hasta agosto de 2026 el libro no traía ni un número: todas sus celdas derivadas
   eran fórmula sin valor, así que cualquier lector que no recalcule —un visor, un
   convertidor a PDF, la propia librería al releerlo— veía el archivo vacío. Peor: la
   matemática del libro y la del informe eran dos implementaciones distintas de lo
   mismo y nada cotejaba que coincidieran.

   Estas pruebas fijan las dos cosas a la vez: que la celda trae valor Y que ese valor
   es EL DEL MOTOR —el mismo `analizarRangoAjustado` que alimenta las tablas del
   .docx—, no un número parecido calculado aparte.
   ───────────────────────────────────────────────────────────────────────────── */

/* Cuatro comparables: tres nacionales y una internacional de margen extremo, con el
   ámbito en 'all' —que no excluye a nadie— para que cada prueba lo fije según lo que
   quiera medir. La de ámbito trabaja sobre una copia con `cmode: 'nac'`, que es donde
   el filtro cambia el resultado de forma observable.

   «Nacional A» tiene, a propósito, los mismos ratios de CxC y de CxP que el
   contribuyente: en esa fila los dos ajustes son exactamente cero, y eso es lo que hace
   que la comprobación del orden de las columnas tenga que comparar vectores completos y
   no una sola celda. */
const ESTUDIO_4 = {
  t_s: 1000, t_c: 600, t_op: 200, t_ar: 100, t_inv: 50, t_ap: 80, t_ppe: 300,
  prime: 7.37, cmode: 'all', seg_excluido: 0,
  comparables: [
    { name: 'Nacional A', amb: 'Nac', s: 500, c: 300, op: 100, ar: 50, inv: 20, ap: 40, ppe: 100 },
    { name: 'Nacional B', amb: 'Nac', s: 800, c: 500, op: 180, ar: 70, inv: 30, ap: 50, ppe: 120 },
    { name: 'Nacional C', amb: 'Nac', s: 600, c: 350, op: 150, ar: 60, inv: 25, ap: 45, ppe: 110 },
    { name: 'Internacional X', amb: 'Int', s: 900, c: 100, op: 100, ar: 10, inv: 5, ap: 5, ppe: 10 },
  ],
};

/* Los siete sabores en el orden que fija `AJUSTES` dentro del módulo, que ES el orden
   de las columnas S–Y de las hojas de método y el de las filas de la hoja Resumen.
   Se escribe aquí a propósito: reordenar `AJUSTES` cruzaría los valores en caché con
   las fórmulas y el libro saldría con cifras creíbles en el sitio errado sin que nada
   reventara. Este literal es lo único que lo delata. */
const SABORES = ['ninguno', 'aar', 'aap', 'inv', 'aar_aap_inv', 'aar_aap_inv_ppe', 'ppe'];

const hojaDe = (estudio, nombre) => hojasMemoriaRangoOptimo(estudio, null)
  .find((h) => h.nombre === nombre);
/* La etiqueta de las filas de estadística va en la columna R (índice 17). En las filas
   de comparable esa columna es el denominador ajustado, que no lleva valor, así que
   nunca colisiona con una etiqueta. */
const filaEtq = (hoja, etq) => hoja.celdas.find((f) => f && f[17] && f[17].v === etq);

test('las celdas derivadas del libro traen el valor calculado junto a la fórmula', () => {
  const mo = hojasMemoriaRangoOptimo(ESTUDIO_4, null).find((h) => h.nombre === 'MO');
  const filaCon = (etq) => mo.celdas.find((f) => f && f[17] && f[17].v === etq);

  /* Indicador por comparable: fila 3, columna S (índice 18). */
  const sinAjuste = mo.celdas[2][18];
  assert.ok(sinAjuste.f, 'sigue siendo fórmula: el libro tiene que poder recalcularse');
  assert.strictEqual(typeof sinAjuste.v, 'number',
    'y trae el valor, para que no salga vacío en un lector que no recalcule');

  /* Estadística. */
  const p25 = filaCon('P25 (cuartil inferior)')[26];
  assert.ok(p25.f && typeof p25.v === 'number', 'el P25 trae fórmula y valor');

  /* Y el valor es el del motor, no otro. */
  const esperado = analizarRangoAjustado(ESTUDIO_4, 'MO', 'ninguno');
  assert.strictEqual(p25.v, esperado.stats.p25);
  assert.strictEqual(mo.celdas[2][18].v, esperado.filas[0].valor);

  /* Conclusión: fórmula de texto con su valor. */
  const concl = filaCon('Conclusión')[26];
  assert.ok(concl.f, 'la conclusión sigue siendo fórmula');
  assert.strictEqual(concl.v, esperado.cumple);
});

test('sin muestra suficiente el libro no publica estadística ni conclusión', () => {
  const dos = { ...ESTUDIO_4, comparables: ESTUDIO_4.comparables.slice(0, 2) };
  const mo = hojasMemoriaRangoOptimo(dos, null).find((h) => h.nombre === 'MO');
  const filaCon = (etq) => mo.celdas.find((f) => f && f[17] && f[17].v === etq);
  /* El P25 es una celda NUMÉRICA: sin rango sale sin valor, no con la cadena vacía.
     Verificado contra xlsx-js-style: `{t:'n', f, v:''}` emite `<v></v>`, que en una
     celda numérica es XML inválido y manda el libro a modo reparación. Sin `v` la
     celda queda `<c><f>…</f></c>` y Excel resuelve la guarda a "" al abrir. */
  const p25 = filaCon('P25 (cuartil inferior)')[26];
  assert.ok(p25.f, 'la fórmula con guarda sigue ahí');
  assert.strictEqual(p25.v, undefined);
  /* La conclusión sí es celda de TEXTO, y ahí la cadena vacía es un valor legítimo. */
  assert.strictEqual(filaCon('Conclusión')[26].v, '');
});

test('cada columna S–Y trae el valor del sabor que le corresponde, en el orden de AJUSTES', () => {
  const mo = hojaDe(ESTUDIO_4, 'MO');
  SABORES.forEach((sabor, k) => {
    const esperado = analizarRangoAjustado(ESTUDIO_4, 'MO', sabor);
    ESTUDIO_4.comparables.forEach((_, i) => {
      const celda = mo.celdas[2 + i][18 + k];
      assert.ok(celda.f, `columna ${18 + k} (${sabor}): sigue siendo fórmula`);
      assert.strictEqual(celda.v, esperado.filas[i].valor,
        `columna ${18 + k}, comparable ${i}, sabor ${sabor}`);
    });
  });
  /* Y las siete columnas son distintas ENTRE SÍ, columna completa contra columna
     completa: si dos coincidieran, intercambiarlas pasaría inadvertido y la
     comprobación de arriba no valdría nada. Se comparan los vectores y no la primera
     celda porque «Nacional A» tiene, a propósito, los mismos ratios de CxC y de CxP que
     el contribuyente, así que en esa fila «sin ajuste», «CxC» y «CxP» dan el mismo
     número —el ajuste es exactamente cero— y no distinguirían nada. */
  const porColumna = SABORES.map((_, k) => JSON.stringify(
    ESTUDIO_4.comparables.map((_c, i) => mo.celdas[2 + i][18 + k].v)));
  assert.strictEqual(new Set(porColumna).size, 7,
    `las siete columnas S–Y deberían ser distintas entre sí:\n${porColumna.join('\n')}`);
});

test('la estadística del libro es la del motor, sabor por sabor', () => {
  const mo = hojaDe(ESTUDIO_4, 'MO');
  const ESTADISTICOS = [
    ['Mínimo', 'min'], ['P25 (cuartil inferior)', 'p25'], ['Mediana (P50)', 'med'],
    ['P75 (cuartil superior)', 'p75'], ['Máximo', 'max'],
  ];
  SABORES.forEach((sabor, k) => {
    const esperado = analizarRangoAjustado(ESTUDIO_4, 'MO', sabor);
    ESTADISTICOS.forEach(([etq, clave]) => {
      const celda = filaEtq(mo, etq)[26 + k];
      assert.ok(celda.f, `${etq} / ${sabor}: sigue siendo fórmula`);
      assert.strictEqual(celda.v, esperado.stats[clave], `${etq} / ${sabor}`);
    });
    /* El indicador del contribuyente y la conclusión, del mismo sabor. */
    assert.strictEqual(filaEtq(mo, 'Indicador del contribuyente')[26 + k].v, esperado.sujeto,
      `Indicador del contribuyente / ${sabor}`);
    assert.strictEqual(filaEtq(mo, 'Conclusión')[26 + k].v, esperado.cumple,
      `Conclusión / ${sabor}`);
  });
});

test('el indicador del contribuyente sale del motor también en Cost Plus y NCP', () => {
  /* `pliOf` solo conoce MO, MB y Berry; el motor sabe construir los cinco. Por esta vía
     las hojas de Cost Plus y NCP también publican el indicador del contribuyente. */
  ['MO', 'MB', 'Berry', 'CostPlus', 'NCP'].forEach((hoja) => {
    const h = hojaDe(ESTUDIO_4, hoja);
    const celda = filaEtq(h, 'Indicador del contribuyente')[26];
    const esperado = analizarRangoAjustado(ESTUDIO_4, hoja, 'ninguno');
    assert.ok(celda.f, `${hoja}: sigue siendo fórmula`);
    assert.strictEqual(typeof celda.v, 'number', `${hoja}: trae valor`);
    assert.strictEqual(celda.v, esperado.sujeto, `${hoja}: el valor es el del motor`);
  });
});

test('la columna de ámbito y la serie filtrada traen el criterio ya resuelto', () => {
  const estudio = { ...ESTUDIO_4, cmode: 'nac' };
  const mo = hojaDe(estudio, 'MO');
  const esperado = analizarRangoAjustado(estudio, 'MO', 'ninguno');
  /* Índice 25 = Z (entra por ámbito), 26 = AA (serie del sabor «sin ajuste»). Las tres
     primeras comparables son nacionales; la cuarta —fila de índice 5—, internacional. */
  assert.strictEqual(mo.celdas[2][25].v, 'Sí');
  assert.strictEqual(mo.celdas[5][25].v, 'No', 'la internacional no entra con cmode nac');
  assert.strictEqual(mo.celdas[2][26].v, esperado.filas[0].valor);
  /* La fila excluida va SIN valor: ni cero —fingiría una observación que no existe y
     hundiría el rango— ni cadena vacía, que en una celda numérica es XML inválido. */
  assert.strictEqual(mo.celdas[5][26].v, undefined);
  assert.ok(mo.celdas[5][26].f, 'pero conserva la fórmula, que Excel resuelve a ""');
  /* Su indicador SÍ se publica en S: las tablas del informe listan también las
     comparables fuera de ámbito con su margen; lo que no puede es cuartilarlas. */
  assert.strictEqual(mo.celdas[5][18].v, esperado.filas[3].valor);
});

test('las columnas A–I traen el literal que el emisor ya tiene, sin dejar de ser referencia', () => {
  const mo = hojaDe(ESTUDIO_4, 'MO');
  const c0 = ESTUDIO_4.comparables[0];
  const f = mo.celdas[2];
  assert.strictEqual(f[0].v, 'Nacional A');
  assert.deepStrictEqual(f.slice(1, 8).map((c) => c.v),
    [c0.s, c0.c, c0.op, c0.ar, c0.inv, c0.ap, c0.ppe],
    'B–H en el orden de la tabla de Datos: ventas, costo, gastos, CxC, inv, CxP, PP&E');
  assert.strictEqual(f[8].v, ESTUDIO_4.prime / 100,
    'la tasa viaja en porcentaje y el emisor la divide entre 100');
  f.slice(0, 9).forEach((c, k) => assert.ok(c.f && c.f.startsWith('Datos!'),
    `la columna ${k} sigue siendo referencia a la hoja Datos`));
});

test('los intermedios del ajuste (J–R) siguen sin valor: los deriva Excel', () => {
  /* Calcularlos aquí sería una segunda implementación de la matemática que este plan
     retira, que es justo el defecto que viene a matar. El motor no los expone
     todavía; mientras no lo haga, Excel los deriva al abrir el archivo. */
  const mo = hojaDe(ESTUDIO_4, 'MO');
  for (let col = 9; col <= 17; col++) {
    assert.ok(mo.celdas[2][col].f, `la columna ${col} es fórmula`);
    assert.strictEqual(mo.celdas[2][col].v, undefined,
      `la columna ${col} no debe traer valor en caché todavía`);
  }
});

/* Índice de columna a partir de sus letras: A→0, Z→25, AA→26, AG→32. Se usa para
   resolver a mano la referencia que emite el Resumen y llegar a la celda que apunta. */
const colAIndice = (letras) => [...letras].reduce(
  (acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

test('cada celda del Resumen trae el mismo valor que la celda de método que referencia', () => {
  /* No se comparan dos números calculados por separado —eso podría coincidir por
     casualidad—: se lee la fórmula del Resumen, se resuelve a qué celda de qué hoja
     apunta, y se comprueba que el valor en caché de las dos es el mismo. Así un cruce de
     columnas o el intercambio de `med` con `p75` sale a la luz, porque el Resumen
     publicaría un número que su propia referencia desmiente. */
  const hojas = hojasMemoriaRangoOptimo(ESTUDIO_4, null);
  const resumen = hojas.find((h) => h.nombre === 'Resumen');
  const porNombre = Object.fromEntries(hojas.map((h) => [h.nombre, h]));

  let comparadas = 0;
  let conValor = 0;
  resumen.celdas.forEach((f, r) => {
    (f || []).forEach((celda, col) => {
      if (!celda || !celda.f) return;
      const m = /^([A-Za-z&]+)!([A-Z]+)(\d+)$/.exec(celda.f);
      assert.ok(m, `la celda ${r + 1}:${col} del Resumen debería ser una referencia simple: ${celda.f}`);
      const [, hoja, letras, fila] = m;
      const destino = porNombre[hoja];
      assert.ok(destino, `el Resumen referencia una hoja que no existe: ${hoja}`);
      const apuntada = (destino.celdas[Number(fila) - 1] || [])[colAIndice(letras)];
      assert.ok(apuntada, `${celda.f} apunta a una celda vacía de la hoja ${hoja}`);
      assert.strictEqual(celda.v, apuntada.v,
        `${celda.f}: el Resumen dice ${celda.v} y la hoja ${hoja} dice ${apuntada.v}`);
      comparadas++;
      if (celda.v !== undefined) conValor++;
    });
  });
  /* Cinco métodos × siete sabores × siete columnas de valor. Sin este piso, una hoja
     Resumen vacía —o un `find` que no encontrara nada— haría pasar la prueba sin
     comparar nada. */
  assert.strictEqual(comparadas, 5 * 7 * 7, `debería comparar 245 celdas, comparó ${comparadas}`);
  assert.strictEqual(conValor, comparadas, 'y todas tienen que traer valor con este fixture');
});

test('el Resumen no cruza la mediana con el P75 ni el mínimo con el máximo', () => {
  /* La prueba de arriba lo detectaría, pero solo si los cinco estadísticos son números
     distintos: con dos iguales, intercambiarlos no se notaría en ninguna de las dos.
     Esto fija que el fixture de verdad los distingue, para todos los sabores de MO. */
  const resumen = hojaDe(ESTUDIO_4, 'Resumen');
  const filasMO = resumen.celdas.filter((f) => f && f[0] && f[0].v === 'Margen Operacional');
  assert.strictEqual(filasMO.length, 7, 'una fila por sabor');
  filasMO.forEach((f, k) => {
    /* Columnas 3..7 = Mínimo, P25, Mediana, P75, Máximo. */
    const stats = f.slice(3, 8).map((c) => c.v);
    assert.strictEqual(new Set(stats).size, 5,
      `los cinco estadísticos del sabor ${SABORES[k]} deberían ser distintos: ${stats.join(', ')}`);
    /* Y en el orden que anuncia el encabezado, que es el mismo del motor. */
    const esperado = analizarRangoAjustado(ESTUDIO_4, 'MO', SABORES[k]).stats;
    assert.deepStrictEqual(stats,
      [esperado.min, esperado.p25, esperado.med, esperado.p75, esperado.max],
      `orden de los estadísticos del sabor ${SABORES[k]}`);
    /* Monótonos, que es lo que un cruce rompería de forma visible. */
    assert.ok(stats[0] <= stats[1] && stats[1] <= stats[2] && stats[2] <= stats[3]
      && stats[3] <= stats[4], `los estadísticos no van en orden: ${stats.join(', ')}`);
  });
});

test('sin muestra suficiente el Resumen deja el hueco, igual que la hoja de método', () => {
  const dos = { ...ESTUDIO_4, comparables: ESTUDIO_4.comparables.slice(0, 2) };
  const resumen = hojaDe(dos, 'Resumen');
  const filaMO = resumen.celdas.find((f) => f && f[0] && f[0].v === 'Margen Operacional');
  /* Los cinco estadísticos, sin valor: son celdas numéricas y `<v></v>` sería inválido. */
  filaMO.slice(3, 8).forEach((c, i) => {
    assert.ok(c.f, `la referencia ${i} sigue ahí`);
    assert.strictEqual(c.v, undefined);
  });
  /* El indicador del contribuyente sí existe sin rango, y la conclusión queda en ''. */
  assert.strictEqual(typeof filaMO[2].v, 'number');
  assert.strictEqual(filaMO[8].v, '');
});

test('la hoja Resumen lee la estadística de AA-AG, no de S-Y, tras el traslado de Task 5', () => {
  /* Las filas de estadística de las hojas de método dejaron en blanco S–Y: si el
     Resumen sigue apuntando ahí, la hoja que un lector abre primero sale siempre
     vacía aunque la hoja de método sí traiga el rango. */
  const [resumen] = hojasMemoriaRangoOptimo(ESTUDIO, null);
  assert.strictEqual(resumen.nombre, 'Resumen');
  const filaMO = resumen.celdas.find((f) => f && f[0] && f[0].v === 'Margen Operacional');
  assert.ok(filaMO, 'existe al menos una fila de MO en el Resumen');
  ['Contribuyente', 'Mínimo', 'P25', 'Mediana', 'P75', 'Máximo'].forEach((_, i) => {
    const celda = filaMO[2 + i];
    assert.match(celda.f, /![A-Z]{2}\d+$/, `la referencia de ${celda.f} debería usar una columna AA-AG`);
    assert.ok(!/![S-Y]\d+$/.test(celda.f), `no puede seguir leyendo S-Y: ${celda.f}`);
  });
});
