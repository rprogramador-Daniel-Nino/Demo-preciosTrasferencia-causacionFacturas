import { test } from 'node:test';
import assert from 'node:assert';
import {
  verticalSobreActivos, filasComposicionAccionaria, filasActivos,
} from './tablasContribuyente.js';

/* ── verticalSobreActivos ── */

test('el análisis vertical es el rubro sobre el total de activos', () => {
  const av = verticalSobreActivos({ t_act_tot: 2000 });
  assert.strictEqual(av(500), '25.00%');
});

test('sin total de activos el vertical queda en hueco y no en cero', () => {
  /* Un «0.00%» afirma que el rubro no pesa nada; el hueco dice que no se pudo calcular. */
  assert.strictEqual(verticalSobreActivos({})(500), '—');
  assert.strictEqual(verticalSobreActivos({ t_act_tot: 0 })(500), '—');
});

/* ── Tabla 6. Composición accionaria ── */

const ACCIONISTAS = [
  { nombre: 'END GAME INTERACTIVE INC', pais: 'ESTADOS UNIDOS', acciones: 900, valor_capital: 9000, participacion_pct: 90 },
  { nombre: 'JUAN PÉREZ', pais: 'COLOMBIA', acciones: 100, valor_capital: 1000, participacion_pct: 10 },
];

test('la composición accionaria lista cada accionista y cierra con el total', () => {
  const t = filasComposicionAccionaria({ accionistas: ACCIONISTAS });
  assert.strictEqual(t.nombre, 'Composición accionaria');
  assert.deepStrictEqual(t.filas, [
    ['END GAME INTERACTIVE INC', 'ESTADOS UNIDOS', '900', '9.000', '90%'],
    ['JUAN PÉREZ', 'COLOMBIA', '100', '1.000', '10%'],
    ['Total', '', '1.000', '10.000', '100%'],
  ]);
});

test('sin accionistas queda solo la fila de total, con huecos a la vista', () => {
  /* Es lo que delata que falta cargar el certificado de composición accionaria. Dejar las
     filas de la plantilla publicaría los accionistas del cliente anterior. */
  assert.deepStrictEqual(
    filasComposicionAccionaria({}).filas,
    [['Total', '', '—', '—', '100%']]
  );
});

test('un accionista sin cifras no inventa ceros', () => {
  assert.deepStrictEqual(
    filasComposicionAccionaria({ accionistas: [{ nombre: 'ACME' }] }).filas[0],
    ['ACME', '—', '—', '—', '—']
  );
});

/* ── Tabla 10. Activos ── */

const EEFF = {
  anio: 2025,
  t_cash: 12417756, t_inv_assoc: 0, t_ar: 1998031210, t_tax: 1000000,
  t_act_curr: 2011448966, t_ppe: 168030721, t_intang: 0, t_dif: 0,
  t_act_nocurr: 168030721, t_act_tot: 2179479687,
};

test('los activos llevan el año gravable en el título y en las columnas', () => {
  /* La plantilla de referencia rotula «Activos a 31 de diciembre de 2024»: si el rótulo no
     se reescribe, el informe de 2025 publica el encabezado del año anterior. */
  const t = filasActivos(EEFF);
  assert.strictEqual(t.nombre, 'Activos a 31 de diciembre');
  assert.strictEqual(t.titulo, 'Activos a 31 de diciembre de 2025');
  assert.deepStrictEqual(t.encabezados, [
    'Cifras Expresadas en pesos colombianos', '2025', 'A.V. 2025',
  ]);
  assert.strictEqual(t.fuente, 'Estados financieros de la Compañía a 31 de diciembre de 2025.');
});

test('los activos publican los diez rubros con su análisis vertical', () => {
  const t = filasActivos(EEFF);
  assert.strictEqual(t.filas.length, 10);
  assert.deepStrictEqual(t.filas[0], ['Efectivo y equivalentes de efectivo', '12.417.756', '0.57%']);
  assert.deepStrictEqual(t.filas[9], ['Total, Activos', '2.179.479.687', '100.00%']);
});

test('un rubro sin dato sale como hueco en el valor y en el vertical', () => {
  const t = filasActivos({ anio: 2025, t_act_tot: 1000 });
  assert.deepStrictEqual(t.filas[0], ['Efectivo y equivalentes de efectivo', '—', '—']);
});

test('un rubro en cero sale como hueco y no como «0»', () => {
  /* Criterio que ya seguía la ruta .docx: en un balance, un rubro en cero y un rubro que
     nadie cargó se leen igual de mal si se publica «0». */
  const t = filasActivos({ ...EEFF, t_intang: 0 });
  const intangibles = t.filas.find((f) => f[0] === 'Intangibles');
  assert.deepStrictEqual(intangibles, ['Intangibles', '—', '0.00%']);
});
