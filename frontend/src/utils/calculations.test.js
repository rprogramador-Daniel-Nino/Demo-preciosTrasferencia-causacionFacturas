import { test } from 'node:test';
import assert from 'node:assert';
import { montoOperacion, num, fmt, pctf, egreso, pliOf, ratios } from './calculations.js';

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
