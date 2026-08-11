import { test } from 'node:test';
import assert from 'node:assert';
import {
  conceptoDeOperacion, filasOperacionesDeIngreso, filasOperacionAnalizar,
} from './tablasOperaciones.js';

/* ── conceptoDeOperacion ── */

test('el código entre paréntesis del propio estudio manda sobre el catálogo', () => {
  /* Si el Excel traía la columna «Cod» diligenciada, el tipo llega ya con su código y esa
     es la declaración del contribuyente: no se re-deriva. */
  assert.deepStrictEqual(
    conceptoDeOperacion({ vinc_tipo: 'Otros servicios (07)' }),
    { desc: 'Otros servicios', cod: '07' }
  );
});

test('sin código explícito se resuelve por el nombre del catálogo DIAN', () => {
  assert.deepStrictEqual(
    conceptoDeOperacion({ vinc_tipo: 'Otros servicios' }),
    { desc: 'Otros servicios', cod: '07' }
  );
});

test('el mismo nombre resuelve a otro código cuando la operación es de egreso', () => {
  assert.deepStrictEqual(
    conceptoDeOperacion({ vinc_tipo: 'Otros servicios', egreso: true }),
    { desc: 'Otros servicios', cod: '36' }
  );
});

test('un tipo en texto libre queda sin código en vez de inventarse uno', () => {
  /* El caso real del Excel 2025: «VENTA SERVICIOS», columna «Cod» vacía y ningún nombre
     del catálogo que empate. Antes `extraerCodigoYDesc` devolvía '07' fijo y el informe
     declaraba ante la DIAN un código que nadie escribió. */
  assert.deepStrictEqual(
    conceptoDeOperacion({ vinc_tipo: 'VENTA SERVICIOS' }),
    { desc: 'VENTA SERVICIOS', cod: null }
  );
});

test('sin tipo de operación no hay descripción ni código', () => {
  assert.deepStrictEqual(conceptoDeOperacion({}), { desc: null, cod: null });
});

/* ── Tabla 1. Operaciones de Ingreso ── */

const ESTUDIO = {
  vinc_tipo: 'VENTA SERVICIOS',
  vinc: 'END GAME INTERACTIVE INC',
  pais_vinc: 'ESTADOS UNIDOS',
  monto_operacion: 3433542684,
};

test('la tabla de operaciones publica los datos ingeridos', () => {
  const t = filasOperacionesDeIngreso(ESTUDIO);
  assert.strictEqual(t.nombre, 'Operaciones de Ingreso');
  assert.deepStrictEqual(t.encabezados, [
    'Concepto de Operaciones a analizar', 'Nombre vinculado', 'País vinculado',
    'Monto de la Operación analizar',
  ]);
  assert.deepStrictEqual(t.filas, [[
    'VENTA SERVICIOS', 'END GAME INTERACTIVE INC', 'ESTADOS UNIDOS', '3.433.542.684',
  ]]);
});

test('un estudio de egreso cambia el nombre de la tabla', () => {
  assert.strictEqual(filasOperacionesDeIngreso({ ...ESTUDIO, egreso: true }).nombre,
    'Operaciones de Egreso');
});

test('las celdas sin dato salen como hueco y nunca heredan', () => {
  /* La plantilla es el informe del año anterior: cualquier celda que no se escriba se
     radica con el dato del cliente anterior. */
  const t = filasOperacionesDeIngreso({});
  assert.deepStrictEqual(t.filas, [['—', '—', '—', '—']]);
});

test('el monto se lee también de `monto` cuando `monto_operacion` no está', () => {
  /* La ingesta escribe los dos, pero un estudio viejo puede traer solo uno. */
  const t = filasOperacionesDeIngreso({ monto: 1140574 });
  assert.strictEqual(t.filas[0][3], '1.140.574');
});

/* ── Tabla 2. Operación analizar ── */

test('la operación a analizar declara el tipo con su código', () => {
  const t = filasOperacionAnalizar({ vinc_tipo: 'Otros servicios (07)' });
  assert.strictEqual(t.nombre, 'Operación analizar');
  assert.deepStrictEqual(t.encabezados, ['No. Operaciones de análisis', 'Descripción']);
  assert.deepStrictEqual(t.filas, [['Ingreso (07)', 'Otros servicios']]);
});

test('sin código resoluble la operación a analizar deja el hueco a la vista', () => {
  assert.deepStrictEqual(
    filasOperacionAnalizar({ vinc_tipo: 'VENTA SERVICIOS' }).filas,
    [['Ingreso (—)', 'VENTA SERVICIOS']]
  );
});

test('un estudio de egreso declara Egreso y el código de egreso', () => {
  assert.deepStrictEqual(
    filasOperacionAnalizar({ vinc_tipo: 'Otros servicios', egreso: true }).filas,
    [['Egreso (36)', 'Otros servicios']]
  );
});

test('las dos tablas citan la misma fuente', () => {
  const fuente = 'Información suministrada por la Administración de la Compañía.';
  assert.strictEqual(filasOperacionesDeIngreso(ESTUDIO).fuente, fuente);
  assert.strictEqual(filasOperacionAnalizar(ESTUDIO).fuente, fuente);
});
