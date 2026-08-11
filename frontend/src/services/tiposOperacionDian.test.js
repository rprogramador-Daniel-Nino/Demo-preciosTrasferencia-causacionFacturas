import { test } from 'node:test';
import assert from 'node:assert';
import { TIPOS_OPERACION_DIAN, codigoDeTipoOperacion } from './tiposOperacionDian.js';

test('el catálogo trae los 63 tipos de operación', () => {
  /* Los que lista el propio Excel de operaciones en «Tipos de Operacion según DIAN»:
     ingreso 1-29, egreso 30-58, otras operaciones 59-60 e información adicional 61-63. */
  assert.strictEqual(TIPOS_OPERACION_DIAN.length, 63);
  const codigos = TIPOS_OPERACION_DIAN.map((t) => t.cod);
  assert.deepStrictEqual(codigos, Array.from({ length: 63 }, (_, i) => i + 1));
});

test('«Otros servicios» es el 07 en ingreso y el 36 en egreso', () => {
  /* El mismo nombre existe en las dos columnas del catálogo, así que el código no se
     puede resolver sin saber si la operación es de ingreso o de egreso. El informe de
     referencia declara «Otros servicios (07)». */
  assert.strictEqual(codigoDeTipoOperacion('Otros servicios', false), '07');
  assert.strictEqual(codigoDeTipoOperacion('Otros servicios', true), '36');
});

test('el código se devuelve a dos dígitos', () => {
  /* La plantilla escribe «(07)», no «(7)». */
  assert.strictEqual(codigoDeTipoOperacion('Servicios administrativos', false), '04');
  assert.strictEqual(codigoDeTipoOperacion('Regalías', false), '26');
});

test('el nombre se reconoce sin tildes y sin importar las mayúsculas', () => {
  /* Quien diligencia el Excel escribe a mano. */
  assert.strictEqual(codigoDeTipoOperacion('REGALIAS', false), '26');
  assert.strictEqual(codigoDeTipoOperacion('  asistencia tecnica  ', false), '05');
});

test('un texto libre que no está en el catálogo no resuelve a ningún código', () => {
  /* El caso real: el Excel de 2025 trae «VENTA SERVICIOS», que no es ninguno de los 63
     nombres oficiales. Inventar un código aquí es lo que ponía «(07)» en un informe que
     se radica ante la DIAN. */
  assert.strictEqual(codigoDeTipoOperacion('VENTA SERVICIOS', false), null);
  assert.strictEqual(codigoDeTipoOperacion('', false), null);
  assert.strictEqual(codigoDeTipoOperacion(null, false), null);
});
