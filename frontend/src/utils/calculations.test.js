import { test } from 'node:test';
import assert from 'node:assert';
import { montoOperacion, num, fmt, pctf } from './calculations.js';

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
