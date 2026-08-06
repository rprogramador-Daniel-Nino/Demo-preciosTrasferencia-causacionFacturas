/* Tests del normalizador de EEFF: verifica que corrige los dos bugs de mapeo
   (op ← gastos, no utilidad; ppe presente) con datos reales de los PDF. */

import { test } from 'node:test';
import assert from 'node:assert';
import { gastosOperativosDe, camposComparable, camposContribuyente } from './eeffParserNormalizador.js';

/* Lectura real del PDF de Tose. */
const tose = {
  ingresos_operacionales: 6636, costo_ventas: 4844, utilidad_bruta: 1792,
  gastos_operacionales: 1102, utilidad_operacional: 690,
  cuentas_por_cobrar: 2508, inventarios: 7, cuentas_por_pagar: 189,
  propiedad_planta_equipo: 1395,
};

test('op toma los gastos operativos leídos, no la utilidad', () => {
  const c = camposComparable(tose);
  assert.strictEqual(c.op, 1102, 'op debe ser gastos operativos (1102), no utilidad (690)');
});

test('op se deriva por identidad cuando falta el desglose', () => {
  /* Sin gastos_operacionales, pero con utilidad bruta y operacional:
     op = UB − UOp = 1792 − 690 = 1102. */
  const sinGastos = { ...tose, gastos_operacionales: null };
  const r = gastosOperativosDe(sinGastos);
  assert.strictEqual(r.valor, 1102);
  assert.match(r.fuente, /derivado/);
});

test('op cae a null si no hay forma de obtenerlo (no se inventa)', () => {
  const r = gastosOperativosDe({ ingresos_operacionales: 100 });
  assert.strictEqual(r.valor, null);
  assert.strictEqual(r.fuente, 'no disponible');
});

test('ppe se traslada al comparable (antes se perdía)', () => {
  const c = camposComparable(tose);
  assert.strictEqual(c.ppe, 1395);
});

test('el contribuyente mapea t_op a gastos, no a utilidad', () => {
  /* END GAME: gastos 2.215.647.488, utilidad 294.255.770. */
  const endgame = {
    ingresos_operacionales: 5271105507, costo_ventas: 2761202249,
    utilidad_bruta: 2509903258, utilidad_operacional: 294255770,
    gastos_operacionales: 2215647488, propiedad_planta_equipo: 114783610,
  };
  const t = camposContribuyente(endgame);
  assert.strictEqual(t.t_op, 2215647488, 't_op debe ser gastos operativos');
  /* Con esto, OM = (s−c−t_op)/s = 294.255.770 / 5.271.105.507 = 5,58%. */
  const om = (t.t_s - t.t_c - t.t_op) / t.t_s;
  assert.ok(Math.abs(om - 0.0558242990221368) < 1e-9, `OM contribuyente=${om}`);
});

test('el margen operacional de Tose sale correcto tras normalizar', () => {
  const c = camposComparable(tose);
  const om = (c.s - c.c - c.op) / c.s;
  assert.ok(Math.abs(om - 0.10397830018083183) < 1e-6, `OM Tose=${om}`);
});
