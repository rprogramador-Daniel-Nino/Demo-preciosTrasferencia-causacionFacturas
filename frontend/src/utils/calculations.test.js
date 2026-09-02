import { test } from 'node:test';
import assert from 'node:assert';
import {
  montoOperacion, num, fmt, pctf, egreso, pliOf, ratios, adjustInfo, cumpleElRango,
} from './calculations.js';
import { analizarRango } from '../services/rangoIntercuartil.js';

/* ══════ montoOperacion ══════
   El monto de las operaciones con vinculados se guarda en más de un campo y cada
   pantalla leía uno distinto: la ingesta escribe `monto` y `monto_operacion`, y la
   tarjeta de resumen leía `t_s`, que en ese paso ya no se llena. El resultado era un
   «COP $ 0» al lado de un mensaje de éxito que sí traía la cifra. */

test('montoOperacion prefiere monto_operacion, que es lo que escribe la ingesta', () => {
  assert.strictEqual(montoOperacion({ monto_operacion: 3460027008 }), 3460027008);
});

test('montoOperacion cae en monto cuando no hay monto_operacion', () => {
  assert.strictEqual(montoOperacion({ monto: 50000000 }), 50000000);
});

test('montoOperacion usa t_s solo como ultimo recurso', () => {
  /* Para estudios anteriores a la separación de campos, donde el monto de operaciones
     era lo único que se guardaba en t_s. */
  assert.strictEqual(montoOperacion({ t_s: 123456 }), 123456);
  assert.strictEqual(montoOperacion({ monto_operacion: 999, t_s: 123456 }), 999,
    'si hay monto de operaciones, los ingresos de la compañía no mandan');
});

test('montoOperacion devuelve null cuando no hay ningun dato', () => {
  assert.strictEqual(montoOperacion({}), null);
  assert.strictEqual(montoOperacion(null), null);
  assert.strictEqual(montoOperacion(undefined), null);
});

test('montoOperacion no confunde el cero con un monto', () => {
  /* Un 0 en monto_operacion es lo que deja una lectura fallida del Excel; si otro campo
     sí trae cifra, esa es la buena. */
  assert.strictEqual(montoOperacion({ monto_operacion: 0, monto: 7000 }), 7000);
  assert.strictEqual(montoOperacion({ monto_operacion: 0, monto: 0, t_s: 0 }), null);
});

test('montoOperacion entiende los montos con separadores del Excel', () => {
  assert.strictEqual(montoOperacion({ monto_operacion: '3.460.027.008' }), 3460027008);
});

/* ══════ num y fmt: el par que usa toda la aplicación ══════ */

test('fmt marca la ausencia de dato en lugar de inventar un cero', () => {
  assert.strictEqual(fmt(null), '—');
  assert.strictEqual(fmt(undefined), '—');
  assert.strictEqual(fmt(0), '0');
});

test('num distingue el cero de la ausencia', () => {
  assert.strictEqual(num(''), null);
  assert.strictEqual(num(null), null);
  assert.strictEqual(num(0), 0);
});

/* ══════ pctf ══════
   Tres decimales y separador de es-CO. La convención no es nueva: `index.html` ya formateaba
   con toLocaleString('es-CO') y tres decimales, mientras este `pctf` daba dos decimales con
   punto. El mismo estudio publicaba «4,985%» por la ruta del monolito y «4.98%» por la del
   gestor para la misma cifra. */

test('pctf imprime tres decimales con coma y espacio antes del signo', () => {
  assert.strictEqual(pctf(0.04985), '4,985 %');
});

test('pctf conserva los tres decimales cuando el valor no los necesita', () => {
  // `minimumFractionDigits` es lo que lo garantiza; un toFixed mal puesto daría «5 %».
  assert.strictEqual(pctf(0.05), '5,000 %');
  assert.strictEqual(pctf(1), '100,000 %');
});

test('pctf distingue dos cifras que con dos decimales se imprimían iguales', () => {
  // La razón de ser del cambio: los márgenes se mueven en centésimas de punto.
  assert.notStrictEqual(pctf(0.04985), pctf(0.04984));
});

test('pctf devuelve el hueco visible sin dato, incluido NaN', () => {
  // NaN es la guarda que el monolito ya tenía y a esta versión le faltaba: devolvía «NaN%».
  assert.strictEqual(pctf(null), '—');
  assert.strictEqual(pctf(undefined), '—');
  assert.strictEqual(pctf(NaN), '—');
});

test('pctf formatea los negativos con su signo y los tres decimales', () => {
  assert.strictEqual(pctf(-0.0432), '-4,320 %');
});

/* ══════ egreso: el signo del documento contra el convenio del cálculo ══════
   Los estados financieros imprimen los egresos con signo negativo o entre paréntesis, y
   la lectura conserva ese signo a propósito para que el libro y el ANEXO A se lean igual
   que el documento radicado. Pero la utilidad bruta es `ventas − costo`: con el costo en
   negativo, sumaba. Con las cifras de Montachem 2025 (ventas 23.741.367.744, costo
   −21.850.187.494) la utilidad bruta salía 45.591.555.238 en vez de 1.891.180.250 y el
   margen bruto 192 % en vez de 7,966 %. */

const MONTACHEM = { s: 23741367744, c: -21850187494, op: 2986236031 };

test('egreso devuelve la magnitud de la cifra, venga con signo, entre paréntesis o sin nada', () => {
  assert.strictEqual(egreso(-21850187494), 21850187494);
  assert.strictEqual(egreso('(21.850.187.494)'), 21850187494);
  assert.strictEqual(egreso('-21.850.187.494'), 21850187494);
  assert.strictEqual(egreso(21850187494), 21850187494);
});

test('egreso distingue la ausencia de cifra del cero, igual que num', () => {
  assert.strictEqual(egreso(null), null);
  assert.strictEqual(egreso(undefined), null);
  assert.strictEqual(egreso(''), null);
  assert.strictEqual(egreso(0), 0);
});

test('el margen bruto es el mismo con el costo en negativo que en positivo', () => {
  const conSigno = pliOf(MONTACHEM, 'MB');
  const enPositivo = pliOf({ ...MONTACHEM, c: 21850187494 }, 'MB');
  assert.strictEqual(conSigno, enPositivo);
  /* Y es el que se despeja del propio documento: 1.891.180.250 / 23.741.367.744. */
  assert.ok(Math.abs(conSigno - 1891180250 / 23741367744) < 1e-12,
    `el margen bruto debería ser 7,966 %, dio ${pctf(conSigno)}`);
});

test('el índice de Berry es el mismo con el costo en negativo que en positivo', () => {
  const conSigno = pliOf(MONTACHEM, 'Berry');
  const enPositivo = pliOf({ ...MONTACHEM, c: 21850187494 }, 'Berry');
  assert.strictEqual(conSigno, enPositivo);
});

test('el margen operacional no se toca: una pérdida operativa sigue siendo negativa', () => {
  /* La utilidad operacional NO pasa por `egreso`. Volverla positiva convertiría un
     estudio en pérdidas en uno rentable, que es el error contrario y peor. */
  assert.ok(pliOf({ s: 23741367744, c: -21850187494, op: -1095055781 }, 'MO') < 0);
});

test('sin utilidad operacional el margen operacional es null, no cero', () => {
  /* `null / s` da 0 en JavaScript por coerción numérica, y `pctf(0)` imprime «0,000 %» —
     un margen falso, indistinguible en pantalla de una compañía que de verdad ganó cero.
     Antes de este cambio, un `t_op` faltante producía exactamente ese «0,000 %». */
  assert.strictEqual(pliOf({ s: 23741367744, c: -21850187494, op: null }, 'MO'), null);
});

test('el ratio de cuentas por pagar sobre costo no se invierte por el signo del documento', () => {
  const conSigno = ratios({ ...MONTACHEM, ar: 6032337879, inv: 4734795891, ap: 658293893 });
  const enPositivo = ratios({
    ...MONTACHEM, c: 21850187494, ar: 6032337879, inv: 4734795891, ap: 658293893,
  });
  assert.deepStrictEqual(conSigno, enPositivo);
  assert.ok(conSigno.apC > 0, 'un pasivo sobre un costo, los dos positivos, da un ratio positivo');
});

/* ══════════ EL CRITERIO DE CUMPLIMIENTO: POR ENCIMA DEL PRIMER CUARTIL ══════════

   Decisión del despacho, con su contador, el 2026-09-02: «el modo de decidir que está
   cumpliendo es que esté por encima del p25».

   Antes se exigía estar DENTRO del rango (P25 <= PLI <= P75), así que un contribuyente por
   encima del tercer cuartil salía como «NO CUMPLE (por encima)».

   POR QUÉ EL CAMBIO ES COHERENTE CON LO QUE EL SISTEMA YA CALCULABA. El ajuste de precios de
   transferencia solo procede cuando el contribuyente declaró MENOS utilidad de la que
   corresponde: por encima del rango no hay nada que cobrarle. Y `adjustInfo` ya lo trataba así
   —con el indicador sobre la mediana, `raw` sale negativo y el ajuste se marca improcedente con
   monto cero—, de modo que el sistema ya concluía que no había ajuste que declarar mientras la
   etiqueta decía lo contrario. Lo que cambia es la etiqueta, no la economía.

   NO SE PIERDE LA SEÑAL. Estar muy por encima del P75 sigue siendo informativo —puede indicar
   que el método o la parte examinada no son los adecuados— y se reporta en `sobreP75`, como
   observación y no como incumplimiento. */

test('cumple cuando está por encima del primer cuartil, aunque supere el tercero', () => {
  const st = { p25: 0.05, med: 0.10, p75: 0.15 };
  assert.strictEqual(cumpleElRango(st, 0.05), true, 'justo en el P25 cumple');
  assert.strictEqual(cumpleElRango(st, 0.10), true, 'en la mediana');
  assert.strictEqual(cumpleElRango(st, 0.15), true, 'justo en el P75');
  assert.strictEqual(cumpleElRango(st, 0.30), true,
    'MUY por encima del P75 CUMPLE: no hay ajuste que declarar a favor del fisco');
});

test('no cumple solo por debajo del primer cuartil', () => {
  const st = { p25: 0.05, med: 0.10, p75: 0.15 };
  assert.strictEqual(cumpleElRango(st, 0.049), false);
  assert.strictEqual(cumpleElRango(st, -0.20), false);
});

test('sin rango o sin indicador no se afirma cumplimiento', () => {
  assert.strictEqual(cumpleElRango(null, 0.10), false);
  assert.strictEqual(cumpleElRango({ p25: 0.05, p75: 0.15 }, null), false);
  assert.strictEqual(cumpleElRango({ p25: 0.05, p75: 0.15 }, undefined), false);
});

test('adjustInfo no declara ajuste cuando está por encima del rango', () => {
  /* Es lo que ya hacía por la vía de «improcedente»; ahora lo dice también en el veredicto. */
  const T = { s: 1000, c: 800, op: 300 };
  const st = { p25: 0.05, med: 0.10, p75: 0.15 };
  const r = adjustInfo(T, 0.30, st, 1000, 1, null);
  assert.strictEqual(r.within, true, 'cumple');
  assert.strictEqual(r.capped, 0, 'y no hay ajuste que declarar');
  assert.strictEqual(r.sobreP75, true, 'pero se dice que quedó sobre el tercer cuartil');
});

test('adjustInfo sigue calculando el ajuste cuando está por debajo', () => {
  /* La otra mitad: el cambio no puede tocar el caso que SÍ genera ajuste, que es el que se
     declara ante la DIAN. */
  const T = { s: 1000, c: 800, op: 10 };
  const st = { p25: 0.05, med: 0.10, p75: 0.15 };
  const r = adjustInfo(T, 0.01, st, 1000, 1, null);
  assert.strictEqual(r.within, false);
  assert.ok(r.raw > 0, 'el ajuste lleva el indicador a la mediana');
  assert.ok(Math.abs(r.raw - (0.10 - 0.01) * 1000) < 1e-9, 'y es (mediana − indicador) × base');
  assert.strictEqual(r.sobreP75, false);
});

test('el veredicto que publica el informe usa la misma regla', () => {
  /* `plantillaVocabulario.js` toma `rango.cumple` de `analizarRango`, que lo deriva de
     `adj.within`: si la regla no fuera la misma, el documento radicado diría una cosa y la
     pantalla otra. */
  const comparables = [0.02, 0.04, 0.06, 0.08, 0.10, 0.12].map((m, i) => ({
    name: 'C' + i, amb: 'Int', s: 1000, c: 800, op: m * 1000,
  }));
  /* Contribuyente MUY rentable: 40 % de MO, por encima de todas. */
  const arriba = analizarRango({ pli: 'MO', cmode: 'all', t_s: 1000, t_c: 600, t_op: 400, comparables });
  assert.ok(arriba.tPLI > arriba.stats.p75, 'está sobre el tercer cuartil');
  assert.strictEqual(arriba.cumple, 'CUMPLE', 'y el informe dice CUMPLE');

  /* Y por debajo sigue diciendo NO CUMPLE. */
  const abajo = analizarRango({ pli: 'MO', cmode: 'all', t_s: 1000, t_c: 995, t_op: 5, comparables });
  assert.ok(abajo.tPLI < abajo.stats.p25);
  assert.strictEqual(abajo.cumple, 'NO CUMPLE');
});
