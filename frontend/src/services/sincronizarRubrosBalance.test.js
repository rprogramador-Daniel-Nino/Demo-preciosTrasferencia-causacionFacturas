/* Pruebas del matcher que relaciona las 6 casillas escalares de "Cifras del Estado de
   Situación Financiera" (t_cash, t_inv_assoc, t_tax, t_intang, t_dif, t_act_nocurr) con las
   filas de "Detalle de Activos" (`t_activos_detalle`) que representan el mismo concepto.
   Puro: sin React, sin red. */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  CLAVES_RUBROS_BALANCE_ADICIONALES, claveDeEtiquetaEnDetalle, indiceFilaCoincidenteUnica,
  sincronizarDetalleDesdeEscalar, sincronizarEscalarDesdeFila,
} from './sincronizarRubrosBalance.js';

test('CLAVES_RUBROS_BALANCE_ADICIONALES son las 6 claves, en un orden estable', () => {
  assert.deepStrictEqual(CLAVES_RUBROS_BALANCE_ADICIONALES, [
    't_cash', 't_inv_assoc', 't_tax', 't_intang', 't_dif', 't_act_nocurr',
  ]);
});

test('claveDeEtiquetaEnDetalle reconoce variantes reales de redacción por clave', () => {
  assert.strictEqual(claveDeEtiquetaEnDetalle('Efectivo y equivalentes de efectivo'), 't_cash');
  assert.strictEqual(claveDeEtiquetaEnDetalle('Caja y Bancos'), 't_cash');
  assert.strictEqual(claveDeEtiquetaEnDetalle('Disponible'), 't_cash');

  assert.strictEqual(claveDeEtiquetaEnDetalle('Inversiones en asociadas y negocios conjuntos'), 't_inv_assoc');
  assert.strictEqual(claveDeEtiquetaEnDetalle('Inversiones asociadas'), 't_inv_assoc');

  assert.strictEqual(claveDeEtiquetaEnDetalle('Activos por impuestos corrientes'), 't_tax');
  assert.strictEqual(claveDeEtiquetaEnDetalle('Anticipo de impuestos'), 't_tax');

  assert.strictEqual(claveDeEtiquetaEnDetalle('Activos intangibles'), 't_intang');
  assert.strictEqual(claveDeEtiquetaEnDetalle('Intangibles'), 't_intang');

  assert.strictEqual(claveDeEtiquetaEnDetalle('Cargos diferidos'), 't_dif');
  assert.strictEqual(claveDeEtiquetaEnDetalle('Gastos pagados por anticipado'), 't_dif');

  assert.strictEqual(claveDeEtiquetaEnDetalle('Total, Activos no corrientes'), 't_act_nocurr');
  assert.strictEqual(claveDeEtiquetaEnDetalle('Total Activo No Corriente'), 't_act_nocurr');
});

test('claveDeEtiquetaEnDetalle distingue impuesto corriente de impuesto diferido', () => {
  assert.strictEqual(claveDeEtiquetaEnDetalle('Activos por impuestos corrientes'), 't_tax');
  assert.strictEqual(claveDeEtiquetaEnDetalle('Impuesto diferido'), 't_dif');
  assert.strictEqual(claveDeEtiquetaEnDetalle('Activo por impuesto diferido'), 't_dif');
});

test('claveDeEtiquetaEnDetalle devuelve null para rótulos ajenos a las 6 claves', () => {
  assert.strictEqual(claveDeEtiquetaEnDetalle('Cuentas por cobrar comerciales'), null);
  assert.strictEqual(claveDeEtiquetaEnDetalle('Inventarios'), null);
  assert.strictEqual(claveDeEtiquetaEnDetalle('Propiedad, planta y equipo'), null);
  assert.strictEqual(claveDeEtiquetaEnDetalle(''), null);
  assert.strictEqual(claveDeEtiquetaEnDetalle(null), null);
});

test('indiceFilaCoincidenteUnica: -1 sin candidatas', () => {
  const detalle = [{ etiqueta: 'Inventarios', valor: 100, esSubtotal: false }];
  assert.strictEqual(indiceFilaCoincidenteUnica(detalle, 't_cash'), -1);
});

test('indiceFilaCoincidenteUnica: -1 con dos o más filas que matchean la misma clave', () => {
  const detalle = [
    { etiqueta: 'Efectivo y equivalentes de efectivo', valor: 100, esSubtotal: false },
    { etiqueta: 'Caja y Bancos', valor: 50, esSubtotal: false },
  ];
  assert.strictEqual(indiceFilaCoincidenteUnica(detalle, 't_cash'), -1);
});

test('indiceFilaCoincidenteUnica: índice correcto con una sola coincidencia', () => {
  const detalle = [
    { etiqueta: 'Inventarios', valor: 100, esSubtotal: false },
    { etiqueta: 'Intangibles', valor: 200, esSubtotal: false },
  ];
  assert.strictEqual(indiceFilaCoincidenteUnica(detalle, 't_intang'), 1);
});

test('indiceFilaCoincidenteUnica con detalle vacío o nulo no lanza', () => {
  assert.strictEqual(indiceFilaCoincidenteUnica([], 't_cash'), -1);
  assert.strictEqual(indiceFilaCoincidenteUnica(null, 't_cash'), -1);
});

const DETALLE_FIXTURE = [
  { etiqueta: 'Efectivo y equivalentes de efectivo', valor: 1000, esSubtotal: false },
  { etiqueta: 'Cuentas por cobrar comerciales', valor: 2000, esSubtotal: false },
  { etiqueta: 'Inventarios', valor: 3000, esSubtotal: false },
  { etiqueta: 'Activos por impuestos corrientes', valor: 400, esSubtotal: false },
  { etiqueta: 'Total Activo Corriente', valor: 6400, esSubtotal: true },
  { etiqueta: 'Propiedad, planta y equipo', valor: 5000, esSubtotal: false },
  { etiqueta: 'Inversiones asociadas', valor: 700, esSubtotal: false },
  { etiqueta: 'Intangibles', valor: 800, esSubtotal: false },
  { etiqueta: 'Diferidos', valor: 900, esSubtotal: false },
  { etiqueta: 'Total, Activos no corrientes', valor: 7400, esSubtotal: true },
];

test('sincronizarDetalleDesdeEscalar actualiza el valor de la única fila coincidente', () => {
  const resultado = sincronizarDetalleDesdeEscalar(DETALLE_FIXTURE, 't_cash', 9999);
  assert.strictEqual(resultado[0].valor, 9999);
  assert.strictEqual(resultado[0].etiqueta, 'Efectivo y equivalentes de efectivo');
  // El resto del arreglo no cambia.
  assert.strictEqual(resultado[1], DETALLE_FIXTURE[1]);
});

test('sincronizarDetalleDesdeEscalar sin match único devuelve el mismo arreglo (misma referencia)', () => {
  const sinCash = DETALLE_FIXTURE.filter((f) => f.etiqueta !== 'Efectivo y equivalentes de efectivo');
  assert.strictEqual(sincronizarDetalleDesdeEscalar(sinCash, 't_cash', 123), sinCash);
});

test('sincronizarDetalleDesdeEscalar nunca agrega una fila nueva', () => {
  const sinCash = DETALLE_FIXTURE.filter((f) => f.etiqueta !== 'Efectivo y equivalentes de efectivo');
  const resultado = sincronizarDetalleDesdeEscalar(sinCash, 't_cash', 123);
  assert.strictEqual(resultado.length, sinCash.length);
});

test('sincronizarEscalarDesdeFila devuelve {clave, valor} cuando la fila editada matchea sin ambigüedad', () => {
  const resultado = sincronizarEscalarDesdeFila(DETALLE_FIXTURE, 7); // "Intangibles"
  assert.deepStrictEqual(resultado, { clave: 't_intang', valor: 800 });
});

test('sincronizarEscalarDesdeFila devuelve null si la fila no matchea ninguna clave', () => {
  assert.strictEqual(sincronizarEscalarDesdeFila(DETALLE_FIXTURE, 1), null); // "Cuentas por cobrar comerciales"
});

test('sincronizarEscalarDesdeFila devuelve null si la fila matchea pero hay ambigüedad', () => {
  const conDuplicado = [
    ...DETALLE_FIXTURE,
    { etiqueta: 'Caja y Bancos', valor: 50, esSubtotal: false },
  ];
  assert.strictEqual(sincronizarEscalarDesdeFila(conDuplicado, 0), null); // "Efectivo..." ahora ambiguo
  assert.strictEqual(sincronizarEscalarDesdeFila(conDuplicado, 10), null); // "Caja y Bancos" también
});

test('sincronizarEscalarDesdeFila con índice fuera de rango o detalle vacío no lanza', () => {
  assert.strictEqual(sincronizarEscalarDesdeFila([], 0), null);
  assert.strictEqual(sincronizarEscalarDesdeFila(DETALLE_FIXTURE, 99), null);
});
