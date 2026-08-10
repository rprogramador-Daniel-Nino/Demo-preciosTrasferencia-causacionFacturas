import { test } from 'node:test';
import assert from 'node:assert';
import { hojasMemoriaRangoOptimo } from './memoriaCalculoRangoOptimo.js';
import { enriquecerUniverso } from './comparablesEngine.js';

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

test('las válidas se restan de las siete exclusiones, no de algunas', () => {
  /* Si la resta omitiera un motivo, el embudo dejaría de cuadrar en cuanto la
     curación por IA descartara a alguien. */
  const [sel] = hojasMemoriaRangoOptimo(ESTUDIO, seleccionDePrueba());
  const f = fila(sel.celdas, '= Válidas');
  assert.ok(f, 'existe la fila de válidas');
  const restas = (f[1].f.match(/-/g) || []).length;
  assert.strictEqual(restas, 7, `deben restarse los 7 motivos, se restan ${restas}`);
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
  assert.ok(texto.includes('>30'), 'la fórmula de la columna Controlada usa el umbral dado');
  assert.ok(texto.includes('30 %'), 'y el rótulo del embudo lo dice');
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
  assert.strictEqual(filas[0][11].v, 'Sí', 'y la columna Holding queda marcada');
  assert.strictEqual(filas[1][13].v, '', 'la seleccionada no trae motivo');
  assert.strictEqual(filas[1][16].v, 'Sí', 'y sí queda marcada como seleccionada');
});

/* ─────────────────────────────────────────────────────────────────────────────
   Las hojas de cálculo: la tasa y las fórmulas de ajuste.

   Nada de esto estaba cubierto, y es donde vivían los errores que llegaron al
   consultor: una fórmula que Excel no podía leer y un ajuste que salía en cero.
   ───────────────────────────────────────────────────────────────────────────── */

/* Con 3 comparables el bloque de la hoja Datos ocupa las filas 15, 16 y 17: la
   parte examinada va en A4:B11 y el encabezado de comparables en la 14. */
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

test('la tasa se escribe una sola vez, en Datos!B11, y en porcentaje', () => {
  const datos = hojasMemoriaRangoOptimo(ESTUDIO3, null).find((h) => h.nombre === 'Datos');
  const b11 = datos.celdas[10][1];
  assert.strictEqual(b11.v, 0.0737, 'prime llega en porcentaje y se divide entre 100 aquí');
  assert.strictEqual(b11.z, '0.00%');
  assert.strictEqual(datos.celdas[10][0].v, 'Tasa de interés de referencia (Prime Rate)');
});

test('las tres comparables toman la tasa de esa única celda, no una propia', () => {
  /* La plantilla de Capital IQ traía la tasa del país de cada comparable escrita
     como valor fijo: tres tasas distintas en la misma columna, y dos comparables
     con 0 %, es decir, sin ajuste alguno. */
  const datos = hojasMemoriaRangoOptimo(ESTUDIO3, null).find((h) => h.nombre === 'Datos');
  for (let i = 0; i < 3; i++) {
    const tasa = datos.celdas[14 + i][8];
    assert.strictEqual(tasa.f, '$B$11', `la comparable ${i + 1} debería referenciar la celda única`);
    assert.strictEqual(tasa.v, undefined, 'y no traer un valor propio quemado');
  }
});

test('la hoja Datos documenta de dónde sale la tasa y a quién se aplica', () => {
  const datos = hojasMemoriaRangoOptimo(ESTUDIO3, null).find((h) => h.nombre === 'Datos');
  const etiquetas = [2, 3, 4, 5, 6].map((r) => datos.celdas[r][10] && datos.celdas[r][10].v);
  assert.ok(etiquetas[0].startsWith('PARÁMETRO'), 'el bloque arranca con su título');
  assert.deepStrictEqual(etiquetas.slice(1), ['Tasa aplicada', 'Fuente', 'Aplicación', 'Convención']);
  assert.match(datos.celdas[4][11].v, /RIFSPBLPNA/, 'la fuente cita la serie, no solo el número');
  assert.strictEqual(datos.celdas[3][11].f, '$B$11', 'el bloque refleja la celda editable, no la duplica');
});

test('el ajuste de PP&E escala por la base, igual que las otras tres partidas', () => {
  /* Sin el factor de base, la columna Q salía dividida por el monto de las ventas y
     los escenarios «+PP&E» y «PP&E» reproducían a los que no llevan PP&E. */
  const hojas = hojasMemoriaRangoOptimo(ESTUDIO3, null);
  const mo = hojas.find((h) => h.nombre === 'MO');
  assert.strictEqual(mo.celdas[2][16].f, '((H3/M3)-(Datos!$B$10/Datos!$B$4))*(M3*I3)');
  const ncp = hojas.find((h) => h.nombre === 'NCP');
  assert.strictEqual(ncp.celdas[2][16].f,
    '((H3/((C3-G3)+D3))-(Datos!$B$10/(Datos!$B$5+Datos!$B$6)))*(M3*I3)',
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
  assert.match(texto, /Datos!\$C\$15:\$C\$17/, 'y apuntan al rango real de comparables');
  /* Una fila por comparable en la sección de PP&E, referida a la hoja MO para no
     reimplementar el ajuste una segunda vez. */
  assert.match(texto, /MO!Q3/);
  assert.match(texto, /MO!Q5/);
});

test('sin comparables no se arma la hoja de diagnóstico', () => {
  const hojas = hojasMemoriaRangoOptimo({ ...ESTUDIO, comparables: [] }, null);
  assert.ok(!hojas.some((h) => h.nombre === 'Diagnóstico de datos'));
});
