/* Tests del ajuste de capital de trabajo sobre el rango.

   La red de seguridad de este módulo son los datos reales del estudio END GAME
   2025: sus 16 comparables, sus cifras y los cuartiles que el consultor validó a
   mano en el Excel. Si un refactor mueve cualquier fórmula, estos números lo
   delatan.

   Dos sabores de ajuste ya no salen de esa hoja, porque la hoja tenía dos errores
   que aquí se corrigieron; el comentario sobre la tabla EXCEL dice exactamente
   cuáles y qué los respalda en su lugar. */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  analizarRangoAjustado, indicadorAjustado, desgloseAjuste, cuartilInterpolado, TIPOS_AJUSTE,
} from './ajusteRangoCapitalTrabajo.js';

/* Contribuyente y comparables de END GAME 2025, en el formato del sistema.
   Las cifras están en la unidad de cada hoja del Excel; como los indicadores son
   adimensionales, la escala no afecta los márgenes.

   Los comparables ya no traen `tasaEfectiva`: esa era la tasa del país de cada
   compañía que arrastraba la plantilla de Capital IQ (1,53 % en las japonesas,
   2,90 % en las coreanas, 7,33 % en el resto). El ajuste usa una sola tasa de
   referencia para toda la muestra —`prime` del estudio—, así que el campo se
   retiró en lugar de dejarlo inerte esperando a que alguien lo reconecte. */
const SUJETO = {
  t_s: 5271105507, t_c: 2761202249, t_op: 2215647488,
  t_ar: 578289605, t_inv: 0, t_ap: 27255376, t_ppe: 114783610,
  prime: 7.33,
};

const COMP = [
  { name: 'Tose Co., Ltd.', s: 6636, c: 4844, op: 1102, ar: 2150, inv: 29.5, ap: 186, ppe: 1302.5 },
  { name: 'QubicGames S.A.', s: 28.80778, c: 0.14831, op: 28.23438, ar: 6.1302, inv: 0.206575, ap: 6.06381, ppe: 0.520745 },
  { name: 'YOOZOO Interactive Co., Ltd.', s: 1401.71149, c: 855.18715, op: 501.18521, ar: 651.804605, inv: 0, ap: 237.847125, ppe: 526.96492 },
  { name: 'Neptune Company', s: 122530.71508, c: 91.556, op: 119946.84013, ar: 20428.697, inv: 70.167725, ap: 0, ppe: 5326.153245 },
  { name: 'Akatsuki Inc.', s: 25856, c: 11827, op: 6584, ar: 4937.5, inv: 0, ap: 961.5, ppe: 548.5 },
  { name: 'Fun Yours Technology Co.,Ltd.', s: 496.183, c: 9.947, op: 398.847, ar: 130.098, inv: 0, ap: 82.3385, ppe: 59.4965 },
  { name: 'Wemade Play Co., Ltd.', s: 125264.82735, c: 44.867, op: 114476.2936, ar: 10410.618, inv: 0, ap: 0, ppe: 8756.567005 },
  { name: 'Global Mofy AI Limited', s: 55.94128, c: 33.43082, op: 19.50664, ar: 1.41748, inv: 7.97132, ap: 1.495275, ppe: 0.503875 },
  { name: 'Globant S.A.', s: 2454.877, c: 1595.586, op: 614.269, ar: 652.952, inv: 0, ap: 44.667, ppe: 257.756 },
  { name: 'Happinet Corporation', s: 439052, c: 386422, op: 37421, ar: 47876.5, inv: 8424.5, ap: 48484, ppe: 5400.5 },
  { name: 'Oriental Pearl Group Co.,Ltd.', s: 7489.44272, c: 5450.53314, op: 1687.31501, ar: 2990.584105, inv: 2343.21665, ap: 2492.40988, ppe: 9349.603225 },
  { name: 'Aeria Inc.', s: 16472, c: 10388, op: 5418, ar: 1642.5, inv: 5534.5, ap: 553.5, ppe: 2609.5 },
  { name: 'Nazara Technologies Limited', s: 18289.7, c: 4574.5, op: 13472.8, ar: 5018.45, inv: 29.75, ap: 4618.05, ppe: 1342.7 },
  { name: 'Mynet Inc.', s: 7478, c: 4123, op: 2980, ar: 1118.5, inv: 0, ap: 218, ppe: 17 },
  { name: 'KAYAC Inc.', s: 20094, c: 9180, op: 9843, ar: 3793, inv: 142.5, ap: 697.5, ppe: 1798 },
  { name: 'Tohokushinsha Film Corporation', s: 47691, c: 34811, op: 9932, ar: 9801, inv: 4681, ap: 7354.5, ppe: 10649.5 },
];

const estudio = { ...SUJETO, comparables: COMP };

/* La tasa del estudio en tanto por uno, que es la que recibe `indicadorAjustado`.
   Es la misma para las 16 comparables. */
const TASA = SUJETO.prime / 100;

/* Cuartiles por método y sabor de ajuste, redondeados a 5 decimales.

   NO todos tienen el mismo origen, y la diferencia importa a la hora de leer un
   fallo:

     · Los sabores marcados por `esCorregido` abajo cambiaron al arreglar los dos
       defectos que la plantilla arrastraba (el ajuste de PP&E sin base y la venta
       ajustada usada como denominador donde no correspondía). Sus números salen de
       este código y sirven de golden test: detectan que algo se movió, no prueban
       que el resultado sea el correcto. Quien valida esa parte es el bloque de tests
       de «cálculo independiente» del final, que rehace la fórmula del Anexo a mano.

     · Los demás siguen siendo los que el consultor validó celda por celda en
       END GAME 2025. Si uno de ESOS falla, se rompió una fórmula que estaba bien.

   Vale la pena mirar `aar_aap_inv`: es el escenario que reporta el informe y no se
   movió en ninguno de los cinco métodos, porque no toca PP&E y sí ajusta CxC. */
const EXCEL = {
  MO: {
    ninguno: [0.03407, 0.05172, 0.08928],
    aar: [0.02491, 0.04786, 0.08809],
    aap: [0.04224, 0.05524, 0.08924],
    inv: [0.02308, 0.04670, 0.08928],
    aar_aap_inv: [0.02097, 0.04943, 0.08805],
    aar_aap_inv_ppe: [0.01500, 0.04422, 0.08010],
    ppe: [0.01782, 0.04769, 0.08448],
  },
  Berry: {
    ninguno: [1.09300, 1.13991, 1.32233],
    aar: [1.08198, 1.11904, 1.26966],
    aap: [1.10786, 1.14419, 1.36066],
    inv: [1.07986, 1.11589, 1.29419],
    aar_aap_inv: [1.05124, 1.11341, 1.28389],
    aar_aap_inv_ppe: [1.02862, 1.11419, 1.24590],
    ppe: [1.02037, 1.11422, 1.25950],
  },
  NCP: {
    ninguno: [0.03527, 0.05455, 0.09808],
    aar: [0.03485, 0.05205, 0.09682],
    aap: [0.04813, 0.06032, 0.11236],
    inv: [0.02026, 0.05058, 0.09865],
    aar_aap_inv: [0.02558, 0.05375, 0.09680],
    aar_aap_inv_ppe: [0.01756, 0.04897, 0.08923],
    ppe: [0.01916, 0.05431, 0.09353],
  },
  MB: {
    ninguno: [0.33059, 0.42552, 0.80740],
    aar_aap_inv: [0.32501, 0.42284, 0.82071],
    aar_aap_inv_ppe: [0.31618, 0.42402, 0.81602],
  },
  CostPlus: {
    ninguno: [0.49743, 0.74354, 14.46931],
    aar: [0.31665, 0.63445, 0.95892],
    aap: [0.33125, 0.66457, 1.00588],
    inv: [0.32659, 0.57867, 0.98530],
    aar_aap_inv: [0.31955, 0.58889, 0.96257],
    aar_aap_inv_ppe: [0.17384, 0.54823, 0.96091],
    ppe: [0.24047, 0.57298, 0.96481],
  },
};

/* Qué sabores dejaron de coincidir con END GAME y por qué:
     - los que incluyen PP&E, en los cinco métodos, por el factor de base;
     - «solo CxP» y «solo inventario» en MO y MB, por el denominador. En Berry, NCP
       y Cost Plus el denominador nunca fue la venta ajustada, así que no cambiaron. */
const esCorregido = (metodo, ajuste) => (
  ajuste === 'ppe' || ajuste === 'aar_aap_inv_ppe'
  || ((ajuste === 'aap' || ajuste === 'inv') && (metodo === 'MO' || metodo === 'MB'))
);

const TOL = 0.0015;

for (const [metodo, sabores] of Object.entries(EXCEL)) {
  for (const [ajuste, [p25, med, p75]] of Object.entries(sabores)) {
    const origen = esCorregido(metodo, ajuste) ? 'fija el rango corregido' : 'reproduce el rango del Excel';
    test(`${metodo} · ${TIPOS_AJUSTE[ajuste]} ${origen}`, () => {
      const r = analizarRangoAjustado(estudio, metodo, ajuste);
      assert.ok(r.stats, 'debería haber rango con 16 comparables');
      /* Tolerancia relativa para valores grandes (Berry ~1,3; Cost Plus hasta 14),
         absoluta para los márgenes chicos. */
      const tol = (v) => Math.max(TOL, Math.abs(v) * 1e-3);
      assert.ok(Math.abs(r.stats.p25 - p25) < tol(p25), `P25 sim=${r.stats.p25} esperado=${p25}`);
      assert.ok(Math.abs(r.stats.med - med) < tol(med), `Mediana sim=${r.stats.med} esperado=${med}`);
      assert.ok(Math.abs(r.stats.p75 - p75) < tol(p75), `P75 sim=${r.stats.p75} esperado=${p75}`);
    });
  }
}

test('el escenario que reporta el informe (CxC+CxP+Inv) no se movió con las correcciones', () => {
  /* Los cinco valores de `aar_aap_inv` en la tabla de arriba son los mismos que
     validó el consultor en END GAME. Este test lo deja dicho explícitamente para
     que nadie los toque creyendo que también eran de regresión. */
  for (const metodo of Object.keys(EXCEL)) {
    assert.ok(!esCorregido(metodo, 'aar_aap_inv'), `${metodo}: aar_aap_inv no debería contarse como corregido`);
  }
});

test('el indicador del contribuyente coincide con el del Excel (MO)', () => {
  const r = analizarRangoAjustado(estudio, 'MO', 'ninguno');
  assert.ok(Math.abs(r.sujeto - 0.0558242990221368) < 1e-6);
});

test('el contribuyente se ajusta contra sí mismo sin moverse', () => {
  /* Sus ratios menos los suyos dan cero: el indicador ajustado del contribuyente
     debe ser el mismo con cualquier sabor de ajuste. */
  const base = analizarRangoAjustado(estudio, 'MO', 'ninguno').sujeto;
  for (const ajuste of ['aar', 'aap', 'inv', 'aar_aap_inv', 'ppe']) {
    const s = analizarRangoAjustado(estudio, 'MO', ajuste).sujeto;
    assert.ok(Math.abs(s - base) < 1e-9, `el sujeto se movió con ${ajuste}`);
  }
});

test('la conclusión de END GAME es CUMPLE en MO sin ajuste', () => {
  /* Indicador del contribuyente 0,0558 dentro de [0,0341 – 0,0893]. */
  const r = analizarRangoAjustado(estudio, 'MO', 'ninguno');
  assert.strictEqual(r.cumple, 'CUMPLE');
});

test('con menos de tres comparables no hay rango y la conclusión hereda CUMPLE', () => {
  const chico = { ...SUJETO, comparables: COMP.slice(0, 2) };
  const r = analizarRangoAjustado(chico, 'MO', 'aar');
  assert.strictEqual(r.stats, null);
  assert.strictEqual(r.cumple, 'CUMPLE');
});

test('una comparable sin cifras se descarta y no tumba el rango', () => {
  const conHueco = { ...SUJETO, comparables: [...COMP, { name: 'SIN DATOS', s: '', c: '', op: '' }] };
  const r = analizarRangoAjustado(conHueco, 'MO', 'aar');
  assert.ok(r.stats, 'la comparable inservible debe descartarse');
  assert.strictEqual(r.stats.n, 16, 'la muestra válida sigue siendo 16');
});

test('cuartilInterpolado equivale a QUARTILE.INC de Excel', () => {
  /* Serie de cuatro: en la posición 0,25·3 = 0,75 interpola entre el 1.º y el 2.º. */
  const s = [10, 20, 30, 40];
  assert.strictEqual(cuartilInterpolado(s, 0.25), 17.5);
  assert.strictEqual(cuartilInterpolado(s, 0.5), 25);
  assert.strictEqual(cuartilInterpolado(s, 0.75), 32.5);
});

test('indicadorAjustado devuelve null cuando faltan cifras de la comparable', () => {
  const nula = indicadorAjustado({ s: null, c: null, op: null }, SUJETO, 'MO', 'aar', 0.07);
  assert.strictEqual(nula, null);
});

test('Berry sin ajuste es utilidad bruta sobre gastos operativos', () => {
  /* Tose: (6636 − 4844) / 1102 = 1,62613… El contribuyente va con sus campos
     cortos (s/c/op…), como espera indicadorAjustado. */
  const suj = { s: SUJETO.t_s, c: SUJETO.t_c, op: SUJETO.t_op, ar: SUJETO.t_ar, inv: SUJETO.t_inv, ap: SUJETO.t_ap, ppe: SUJETO.t_ppe };
  const v = indicadorAjustado(COMP[0], suj, 'Berry', 'ninguno', TASA);
  assert.ok(Math.abs(v - ((6636 - 4844) / 1102)) < 1e-9, `Berry=${v}`);
});

test('Cost Plus sin ajuste es utilidad bruta sobre COGS', () => {
  /* Tose: (6636 − 4844) / 4844 = 0,36994… */
  const suj = { s: SUJETO.t_s, c: SUJETO.t_c, op: SUJETO.t_op, ar: SUJETO.t_ar, inv: SUJETO.t_inv, ap: SUJETO.t_ap, ppe: SUJETO.t_ppe };
  const v = indicadorAjustado(COMP[0], suj, 'CostPlus', 'ninguno', TASA);
  assert.ok(Math.abs(v - ((6636 - 4844) / 4844)) < 1e-9, `CostPlus=${v}`);
});

test('el ajuste de inventario de NCP usa el denominador depurado (E110)', () => {
  /* Oriental Pearl es la comparable donde el denominador depurado más se aparta
     del simple; su NCP ajustado por inventario en el Excel es 0,018875. */
  const op = COMP.find((c) => c.name.startsWith('Oriental Pearl'));
  const suj = { s: SUJETO.t_s, c: SUJETO.t_c, op: SUJETO.t_op, ar: SUJETO.t_ar, inv: SUJETO.t_inv, ap: SUJETO.t_ap, ppe: SUJETO.t_ppe };
  const v = indicadorAjustado(op, suj, 'NCP', 'inv', TASA);
  assert.ok(Math.abs(v - 0.018875259035334043) < 1e-6, `NCP inv Oriental=${v}`);
});

/* ─────────────────────────────────────────────────────────────────────────────
   Cálculo independiente de los dos arreglos.

   Los tests de arriba comparan contra una tabla; estos rehacen la fórmula del
   Anexo del Cap. III a mano, sin llamar a nada del módulo salvo la función bajo
   prueba. Son los que dicen que el resultado es correcto, no solo estable.
   ───────────────────────────────────────────────────────────────────────────── */

const SUJ_CORTO = {
  s: SUJETO.t_s, c: SUJETO.t_c, op: SUJETO.t_op,
  ar: SUJETO.t_ar, inv: SUJETO.t_inv, ap: SUJETO.t_ap, ppe: SUJETO.t_ppe,
};

test('el ajuste de PP&E escala por la base del método (MO, comparable por comparable)', () => {
  /* MO: base = ventas, numerador = utilidad operacional, y el denominador de «solo
     PP&E» son las ventas sin corregir, porque este sabor no toca las CxC. */
  for (const c of COMP) {
    const ebit = c.s - c.c - c.op;
    const ajustePPE = ((c.ppe / c.s) - (SUJETO.t_ppe / SUJETO.t_s)) * (c.s * TASA);
    const esperado = (ebit - ajustePPE) / c.s;
    const v = indicadorAjustado(c, SUJ_CORTO, 'MO', 'ppe', TASA);
    assert.ok(Math.abs(v - esperado) < 1e-12, `${c.name}: ${v} vs ${esperado}`);
  }
});

test('el ajuste de PP&E de NCP usa el denominador depurado para el ratio y la base para escalar', () => {
  /* NCP: el ratio del comparable va sobre (COGS − CxP) + opex, pero el factor de
     escala es la base del método (COGS + opex). Son dos denominadores distintos en
     la misma línea; confundirlos es fácil y no lo delata ningún cuartil. */
  const baseS = SUJETO.t_c + SUJETO.t_op;
  for (const c of COMP) {
    const baseC = c.c + c.op;
    const dep = (c.c - c.ap) + c.op;
    const ebit = c.s - c.c - c.op;
    const ajustePPE = ((c.ppe / dep) - (SUJETO.t_ppe / baseS)) * (baseC * TASA);
    const esperado = (ebit - ajustePPE) / dep;
    const v = indicadorAjustado(c, SUJ_CORTO, 'NCP', 'ppe', TASA);
    assert.ok(Math.abs(v - esperado) < 1e-12, `${c.name}: ${v} vs ${esperado}`);
  }
});

test('solo los sabores que restan el ajuste de CxC dividen sobre la venta ajustada', () => {
  /* La comprobación es indirecta a propósito: se reconstruye el numerador de cada
     sabor a partir de la diferencia contra «sin ajuste» y se verifica sobre qué
     denominador quedó dividido. Con la venta ajustada mal aplicada, «solo CxP» y
     «solo inventario» daban un número que no correspondía a su propio numerador. */
  const c = COMP.find((x) => x.name.startsWith('Happinet')); // CxC grandes: la diferencia se nota
  const ebit = c.s - c.c - c.op;
  const desc = TASA / (1 + TASA);
  const ajusteAR = ((c.ar / c.s) - (SUJETO.t_ar / SUJETO.t_s)) * (c.s * desc);
  const ajusteAP = ((c.ap / c.s) - (SUJETO.t_ap / SUJETO.t_s)) * (c.s * desc);
  const ventaAjustada = c.s - ajusteAR;

  const soloCxP = indicadorAjustado(c, SUJ_CORTO, 'MO', 'aap', TASA);
  assert.ok(Math.abs(soloCxP - (ebit + ajusteAP) / c.s) < 1e-12, 'CxP debe dividir sobre ventas');
  assert.ok(Math.abs(soloCxP - (ebit + ajusteAP) / ventaAjustada) > 1e-9, 'CxP no debe usar la venta ajustada');

  const soloCxC = indicadorAjustado(c, SUJ_CORTO, 'MO', 'aar', TASA);
  assert.ok(Math.abs(soloCxC - (ebit - ajusteAR) / ventaAjustada) < 1e-12, 'CxC sí divide sobre la venta ajustada');
});

/* ─────────────────────────────────────────────────────────────────────────────
   Lo que el módulo absorbió de sus llamadores: filtro de ámbito, segmento
   excluido y la columna «sin ajustar» de cada fila.
   ───────────────────────────────────────────────────────────────────────────── */

test('el filtro de ámbito deja fuera de la serie a las comparables que no aplican', () => {
  const conAmbito = COMP.map((c, i) => ({ ...c, amb: i < 4 ? 'Nac' : 'Int' }));
  const todas = analizarRangoAjustado({ ...SUJETO, comparables: conAmbito, cmode: 'all' }, 'MO', 'ninguno');
  const soloNac = analizarRangoAjustado({ ...SUJETO, comparables: conAmbito, cmode: 'nac' }, 'MO', 'ninguno');
  const soloInt = analizarRangoAjustado({ ...SUJETO, comparables: conAmbito, cmode: 'intl' }, 'MO', 'ninguno');

  assert.strictEqual(todas.stats.n, 16);
  assert.strictEqual(soloNac.stats.n, 4);
  assert.strictEqual(soloInt.stats.n, 12);
  /* Las filas se devuelven completas en los tres casos: esconder las excluidas
     maquillaría el tamaño de la muestra en las tablas del informe. */
  assert.strictEqual(soloNac.filas.length, 16);
  assert.strictEqual(soloNac.filas.filter((f) => f.incluida).length, 4);
});

test('el segmento excluido se descuenta solo de las ventas del contribuyente', () => {
  /* Aquí `t_op` son gastos, no utilidad: restar el segmento también de esa cifra
     —como sí hace el panel, donde `op` es utilidad— movería la utilidad dos veces. */
  const seg = 500000000;
  const conSeg = analizarRangoAjustado({ ...SUJETO, comparables: COMP, seg_excluido: seg }, 'MO', 'ninguno');
  const esperado = (SUJETO.t_s - seg - SUJETO.t_c - SUJETO.t_op) / (SUJETO.t_s - seg);
  assert.ok(Math.abs(conSeg.sujeto - esperado) < 1e-12, `sujeto=${conSeg.sujeto} esperado=${esperado}`);
});

test('cada fila trae también su indicador sin ajustar, para que la diferencia sea el ajuste', () => {
  const conAjuste = analizarRangoAjustado(estudio, 'MO', 'aar_aap_inv');
  const sinAjuste = analizarRangoAjustado(estudio, 'MO', 'ninguno');
  conAjuste.filas.forEach((f, i) => {
    assert.ok(Math.abs(f.noAjustado - sinAjuste.filas[i].valor) < 1e-12,
      `${f.nombre}: noAjustado no coincide con el rango sin ajuste`);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   El desglose del ajuste: los intermedios que el libro de soporte publica en sus
   columnas J–R y que son su rastro de auditoría.

   Lo que estas pruebas afirman no es que los intermedios sean «unos números»: es que
   RECONSTRUYEN el indicador que el motor ya publica. Si el desglose y el resultado no
   cuadran, uno de los dos está mal, y con esa aserción el desglose no puede mentirle
   al libro sin que se note aquí.
   ───────────────────────────────────────────────────────────────────────────── */

test('el desglose del ajuste expone los intermedios que el libro publica', () => {
  const contribuyente = { s: 1000, c: 600, op: 200, ar: 100, inv: 50, ap: 80, ppe: 300 };
  const comp = { s: 500, c: 300, op: 100, ar: 50, inv: 20, ap: 40, ppe: 100 };
  const d = desgloseAjuste(comp, contribuyente, 'MO', 0.0737);

  assert.strictEqual(d.ebit, 100, 'EBIT = ventas − costo − gastos');
  assert.strictEqual(d.utilBruta, 200, 'utilidad bruta = ventas − costo');
  assert.strictEqual(d.desc, 0.0737 / 1.0737, 'factor r/(1+r)');
  assert.strictEqual(d.base, 500, 'la base de MO son las ventas del comparable');

  /* Los intermedios tienen que reproducir el indicador que ya publica el motor: si el
     desglose y el resultado no cuadran, uno de los dos está mal. */
  const reconstruido = (d.ebit - d.ajusteAR + d.ajusteAP - d.ajusteINV) / d.denomAjustado;
  const delMotor = indicadorAjustado(comp, contribuyente, 'MO', 'aar_aap_inv', 0.0737);
  assert.ok(Math.abs(reconstruido - delMotor) < 1e-12,
    `el desglose reconstruye el indicador: ${reconstruido} vs ${delMotor}`);
});

/* Los tres métodos cuyo numerador es la utilidad bruta; los otros dos van con el EBIT.
   Se escribe aquí y no se importa del módulo a propósito: es lo único que distingue
   «Cost Plus divide la utilidad bruta» de «Cost Plus divide el EBIT», dos
   reconstrucciones igual de creíbles que dan indicadores distintos. */
const NUMERADOR_BRUTO = new Set(['MB', 'Berry', 'CostPlus']);

test('el desglose reconstruye el indicador en los cinco métodos, comparable por comparable', () => {
  /* La prueba de arriba solo mira MO, que es el método con el denominador más simple.
     Los otros cuatro son justamente donde `denomAjustado` deja de ser la base: la venta
     ajustada en MB, los gastos operativos en Berry y el denominador depurado en Cost
     Plus y NCP. Un desglose que publicara la base a secas pasaría MO y fallaría aquí. */
  let comprobadas = 0;
  for (const metodo of ['MO', 'MB', 'Berry', 'CostPlus', 'NCP']) {
    for (const c of COMP) {
      const d = desgloseAjuste(c, SUJ_CORTO, metodo, TASA);
      assert.ok(d, `${metodo}/${c.name}: el desglose debería existir`);
      const numBase = NUMERADOR_BRUTO.has(metodo) ? d.utilBruta : d.ebit;
      const reconstruido = (numBase - d.ajusteAR + d.ajusteAP - d.ajusteINV) / d.denomAjustado;
      const delMotor = indicadorAjustado(c, SUJ_CORTO, metodo, 'aar_aap_inv', TASA);
      /* Tolerancia relativa: Cost Plus llega a 14 y una absoluta de 1e-12 sería más
         estricta ahí que en los márgenes de MO sin que eso signifique nada. */
      assert.ok(Math.abs(reconstruido - delMotor) <= Math.abs(delMotor) * 1e-12,
        `${metodo}/${c.name}: ${reconstruido} vs ${delMotor}`);
      comprobadas++;
    }
  }
  assert.strictEqual(comprobadas, 5 * COMP.length,
    `debería reconstruir 80 indicadores, reconstruyó ${comprobadas}`);
});

test('el desglose y el indicador comparten los intermedios: no son dos aritméticas', () => {
  /* La marca de que el refactor no dejó dos copias: los cuatro ajustes que devuelve el
     desglose explican EXACTAMENTE la diferencia entre cada sabor y «sin ajuste», en los
     cinco métodos. Si `indicadorAjustado` recalculara los suyos aparte y una de las dos
     expresiones se moviera, esta cuenta dejaría de cerrar. */
  const DIFERENCIA = {
    aar: (d) => -d.ajusteAR,
    aap: (d) => d.ajusteAP,
    inv: (d) => -d.ajusteINV,
    ppe: (d) => -d.ajustePPE,
  };
  let comprobadas = 0;
  for (const metodo of ['MO', 'MB', 'Berry', 'CostPlus', 'NCP']) {
    for (const c of COMP) {
      const d = desgloseAjuste(c, SUJ_CORTO, metodo, TASA);
      const numBase = NUMERADOR_BRUTO.has(metodo) ? d.utilBruta : d.ebit;
      for (const [sabor, delta] of Object.entries(DIFERENCIA)) {
        /* Estos cuatro sabores NO restan el ajuste de CxC del numerador salvo `aar`,
           y por eso su denominador es la base sin corregir; `aar` sí divide sobre el
           denominador ajustado. Es la asimetría que el módulo documenta. */
        const denom = sabor === 'aar' ? d.denomAjustado
          : (metodo === 'NCP' || metodo === 'CostPlus') ? d.denomAjustado : d.base;
        const esperado = (numBase + delta(d)) / denom;
        const v = indicadorAjustado(c, SUJ_CORTO, metodo, sabor, TASA);
        assert.ok(Math.abs(v - esperado) <= Math.abs(esperado) * 1e-12,
          `${metodo}/${sabor}/${c.name}: ${v} vs ${esperado}`);
        comprobadas++;
      }
    }
  }
  assert.strictEqual(comprobadas, 5 * COMP.length * 4,
    `debería comprobar 320 combinaciones, comprobó ${comprobadas}`);
});

test('el desglose devuelve null exactamente donde el indicador no se puede construir', () => {
  /* Las tres puertas de salida son las mismas, porque son la misma función: sin cifras
     de la comparable, sin ventas del contribuyente y con un método que este módulo no
     sabe construir. Si divergieran, el libro publicaría intermedios de un indicador que
     el informe no publica. */
  assert.strictEqual(desgloseAjuste({ s: null, c: null, op: null }, SUJ_CORTO, 'MO', TASA), null,
    'sin cifras de la comparable');
  assert.strictEqual(desgloseAjuste(COMP[0], { s: 0 }, 'MO', TASA), null,
    'sin ventas del contribuyente');
  assert.strictEqual(desgloseAjuste(COMP[0], SUJ_CORTO, 'MCG', TASA), null,
    'con un método sin base definida aquí');
  /* Y con la base del comparable en cero: Berry sobre una comparable sin gastos
     operativos no tiene sobre qué escalar las partidas. */
  assert.strictEqual(desgloseAjuste({ ...COMP[0], op: 0 }, SUJ_CORTO, 'Berry', TASA), null,
    'con la base del comparable en cero');
});

test('un método sin base definida no se ajusta en lugar de calcularse como margen operacional', () => {
  /* MCG y ROA existen en el sistema pero no en este módulo. Antes caían al
     `|| 'ventas'` y devolvían un margen operacional con el nombre del método
     pedido, que es peor que no devolver nada. */
  const v = indicadorAjustado(COMP[0], SUJ_CORTO, 'MCG', 'aar_aap_inv', TASA);
  assert.strictEqual(v, null);
  const r = analizarRangoAjustado(estudio, 'ROA', 'ninguno');
  assert.strictEqual(r.stats, null, 'sin indicadores válidos no debería haber rango');
});
