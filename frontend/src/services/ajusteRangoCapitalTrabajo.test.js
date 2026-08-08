/* Tests del ajuste de capital de trabajo sobre el rango.

   La red de seguridad de este módulo son los datos reales del estudio END GAME
   2025: sus 16 comparables, sus cifras y los cuartiles que el consultor validó a
   mano en el Excel. Si un refactor mueve cualquier fórmula, estos números —que
   salen de la hoja de cálculo, no de este código— lo delatan. */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  analizarRangoAjustado, indicadorAjustado, cuartilInterpolado, TIPOS_AJUSTE,
} from './ajusteRangoCapitalTrabajo.js';

/* Contribuyente y comparables de END GAME 2025, en el formato del sistema.
   Las cifras están en la unidad de cada hoja del Excel; como los indicadores son
   adimensionales, la escala no afecta los márgenes. `tasaEfectiva` es la E6 del
   modelo: la tasa del período escalada por los años promediados. */
const SUJETO = {
  t_s: 5271105507, t_c: 2761202249, t_op: 2215647488,
  t_ar: 578289605, t_inv: 0, t_ap: 27255376, t_ppe: 114783610,
  prime: 7.33,
};

const COMP = [
  { name: 'Tose Co., Ltd.', s: 6636, c: 4844, op: 1102, ar: 2150, inv: 29.5, ap: 186, ppe: 1302.5, tasaEfectiva: 0.0153233 },
  { name: 'QubicGames S.A.', s: 28.80778, c: 0.14831, op: 28.23438, ar: 6.1302, inv: 0.206575, ap: 6.06381, ppe: 0.520745, tasaEfectiva: 0.0733 },
  { name: 'YOOZOO Interactive Co., Ltd.', s: 1401.71149, c: 855.18715, op: 501.18521, ar: 651.804605, inv: 0, ap: 237.847125, ppe: 526.96492, tasaEfectiva: 0.0733 },
  { name: 'Neptune Company', s: 122530.71508, c: 91.556, op: 119946.84013, ar: 20428.697, inv: 70.167725, ap: 0, ppe: 5326.153245, tasaEfectiva: 0.0290325 },
  { name: 'Akatsuki Inc.', s: 25856, c: 11827, op: 6584, ar: 4937.5, inv: 0, ap: 961.5, ppe: 548.5, tasaEfectiva: 0.0153233 },
  { name: 'Fun Yours Technology Co.,Ltd.', s: 496.183, c: 9.947, op: 398.847, ar: 130.098, inv: 0, ap: 82.3385, ppe: 59.4965, tasaEfectiva: 0.0733 },
  { name: 'Wemade Play Co., Ltd.', s: 125264.82735, c: 44.867, op: 114476.2936, ar: 10410.618, inv: 0, ap: 0, ppe: 8756.567005, tasaEfectiva: 0.0290325 },
  { name: 'Global Mofy AI Limited', s: 55.94128, c: 33.43082, op: 19.50664, ar: 1.41748, inv: 7.97132, ap: 1.495275, ppe: 0.503875, tasaEfectiva: 0.0733 },
  { name: 'Globant S.A.', s: 2454.877, c: 1595.586, op: 614.269, ar: 652.952, inv: 0, ap: 44.667, ppe: 257.756, tasaEfectiva: 0.0733 },
  { name: 'Happinet Corporation', s: 439052, c: 386422, op: 37421, ar: 47876.5, inv: 8424.5, ap: 48484, ppe: 5400.5, tasaEfectiva: 0.0153233 },
  { name: 'Oriental Pearl Group Co.,Ltd.', s: 7489.44272, c: 5450.53314, op: 1687.31501, ar: 2990.584105, inv: 2343.21665, ap: 2492.40988, ppe: 9349.603225, tasaEfectiva: 0.0733 },
  { name: 'Aeria Inc.', s: 16472, c: 10388, op: 5418, ar: 1642.5, inv: 5534.5, ap: 553.5, ppe: 2609.5, tasaEfectiva: 0.0153233 },
  { name: 'Nazara Technologies Limited', s: 18289.7, c: 4574.5, op: 13472.8, ar: 5018.45, inv: 29.75, ap: 4618.05, ppe: 1342.7, tasaEfectiva: 0.0733 },
  { name: 'Mynet Inc.', s: 7478, c: 4123, op: 2980, ar: 1118.5, inv: 0, ap: 218, ppe: 17, tasaEfectiva: 0.0153233 },
  { name: 'KAYAC Inc.', s: 20094, c: 9180, op: 9843, ar: 3793, inv: 142.5, ap: 697.5, ppe: 1798, tasaEfectiva: 0.0153233 },
  { name: 'Tohokushinsha Film Corporation', s: 47691, c: 34811, op: 9932, ar: 9801, inv: 4681, ap: 7354.5, ppe: 10649.5, tasaEfectiva: 0.0153233 },
];

const estudio = { ...SUJETO, comparables: COMP };

/* Cuartiles del Excel por método y sabor de ajuste. Redondeados a 5 decimales,
   así que se comparan con tolerancia acorde. */
const EXCEL = {
  MO: {
    ninguno: [0.03407, 0.05172, 0.08928],
    aar: [0.02491, 0.04786, 0.08809],
    aap: [0.04222, 0.05523, 0.08939],
    inv: [0.02347, 0.04664, 0.08943],
    aar_aap_inv: [0.02097, 0.04943, 0.08805],
    aar_aap_inv_ppe: [0.02097, 0.04943, 0.08805],
    ppe: [0.03426, 0.05184, 0.08943],
  },
  Berry: {
    ninguno: [1.09300, 1.13991, 1.32233],
    aar: [1.08198, 1.11904, 1.26966],
    aap: [1.10786, 1.14419, 1.36066],
    inv: [1.07986, 1.11589, 1.29419],
    aar_aap_inv: [1.05124, 1.11341, 1.28389],
    aar_aap_inv_ppe: [1.05120, 1.11341, 1.28387],
    ppe: [1.09297, 1.13996, 1.32232],
  },
  NCP: {
    ninguno: [0.03527, 0.05455, 0.09808],
    aar: [0.03485, 0.05205, 0.09682],
    aap: [0.04813, 0.06032, 0.11236],
    inv: [0.02026, 0.05058, 0.09865],
    aar_aap_inv: [0.02558, 0.05375, 0.09680],
    aar_aap_inv_ppe: [0.02557, 0.05375, 0.09680],
    ppe: [0.04052, 0.05843, 0.09865],
  },
  MB: {
    ninguno: [0.33059, 0.42552, 0.80740],
    aar_aap_inv: [0.32501, 0.42284, 0.82071],
    aar_aap_inv_ppe: [0.32501, 0.42285, 0.82071],
  },
  CostPlus: {
    ninguno: [0.49743, 0.74354, 14.46931],
    aar: [0.31665, 0.63445, 0.95892],
    aap: [0.33125, 0.66457, 1.00588],
    inv: [0.32659, 0.57867, 0.98530],
    aar_aap_inv: [0.31955, 0.58889, 0.96257],
    aar_aap_inv_ppe: [0.31954, 0.58885, 0.96249],
    ppe: [0.32747, 0.65391, 0.98556],
  },
};

const TOL = 0.0015;

for (const [metodo, sabores] of Object.entries(EXCEL)) {
  for (const [ajuste, [p25, med, p75]] of Object.entries(sabores)) {
    test(`${metodo} · ${TIPOS_AJUSTE[ajuste]} reproduce el rango del Excel`, () => {
      const r = analizarRangoAjustado(estudio, metodo, ajuste);
      assert.ok(r.stats, 'debería haber rango con 16 comparables');
      /* Tolerancia relativa para valores grandes (Berry ~1,3; Cost Plus hasta 14),
         absoluta para los márgenes chicos. */
      const tol = (v) => Math.max(TOL, Math.abs(v) * 1e-3);
      assert.ok(Math.abs(r.stats.p25 - p25) < tol(p25), `P25 sim=${r.stats.p25} excel=${p25}`);
      assert.ok(Math.abs(r.stats.med - med) < tol(med), `Mediana sim=${r.stats.med} excel=${med}`);
      assert.ok(Math.abs(r.stats.p75 - p75) < tol(p75), `P75 sim=${r.stats.p75} excel=${p75}`);
    });
  }
}

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
  const v = indicadorAjustado(COMP[0], suj, 'Berry', 'ninguno', 0.0153233);
  assert.ok(Math.abs(v - ((6636 - 4844) / 1102)) < 1e-9, `Berry=${v}`);
});

test('Cost Plus sin ajuste es utilidad bruta sobre COGS', () => {
  /* Tose: (6636 − 4844) / 4844 = 0,36994… */
  const suj = { s: SUJETO.t_s, c: SUJETO.t_c, op: SUJETO.t_op, ar: SUJETO.t_ar, inv: SUJETO.t_inv, ap: SUJETO.t_ap, ppe: SUJETO.t_ppe };
  const v = indicadorAjustado(COMP[0], suj, 'CostPlus', 'ninguno', 0.0153233);
  assert.ok(Math.abs(v - ((6636 - 4844) / 4844)) < 1e-9, `CostPlus=${v}`);
});

test('el ajuste de inventario de NCP usa el denominador depurado (E110)', () => {
  /* Oriental Pearl es la comparable donde el denominador depurado más se aparta
     del simple; su NCP ajustado por inventario en el Excel es 0,018875. */
  const op = COMP.find((c) => c.name.startsWith('Oriental Pearl'));
  const suj = { s: SUJETO.t_s, c: SUJETO.t_c, op: SUJETO.t_op, ar: SUJETO.t_ar, inv: SUJETO.t_inv, ap: SUJETO.t_ap, ppe: SUJETO.t_ppe };
  const v = indicadorAjustado(op, suj, 'NCP', 'inv', op.tasaEfectiva);
  assert.ok(Math.abs(v - 0.018875259035334043) < 1e-6, `NCP inv Oriental=${v}`);
});
