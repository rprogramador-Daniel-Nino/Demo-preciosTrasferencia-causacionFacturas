import { test } from 'node:test';
import assert from 'node:assert';
import { VOCABULARIO, esCampoValido, valorDeCampo } from './plantillaVocabulario.js';

/* Estudio de un cliente que no es End Game, con los campos tal y como los
   escriben hoy DatosContribuyente.jsx e IngestaCifras.jsx. */
const estudio = {
  ent: 'ACME COLOMBIA S.A.S',
  nit: '800123456-7',
  ciiu: '6201',
  objeto: 'Desarrollo de software',
  representante: 'Ana Ruiz',
  anio: 2025,
  vinc: 'ACME INC',
  vinc_id: '999888777',
  vinc_tipo: 'Otros servicios (07)',
  pais_vinc: 'MÉXICO',
  accionistas: [{ nombre: 'ACME INC', pais: 'MÉXICO', acciones: 200000, valor_capital: 200000000 }],
  t_s: 5000000000,
  t_inv_assoc: 2000000000,
  t_intang: 9000000,
  t_dif: 50000000,
  t_act_nocurr: 300000000,
};

test('el vocabulario es cerrado y no admite nombres inventados', () => {
  assert.ok(esCampoValido('ent'), 'ent debería ser válido');
  assert.ok(esCampoValido('eeff.t_inv_assoc'), 'los campos de EEFF llevan prefijo');
  assert.ok(!esCampoValido('direccion'), 'direccion no existe en la ingesta');
  assert.ok(!esCampoValido('lo_que_sea'), 'no se aceptan campos inventados');
});

test('cada campo del vocabulario tiene etiqueta y grupo', () => {
  for (const v of VOCABULARIO) {
    assert.ok(v.campo && v.etiqueta && v.grupo, 'entrada incompleta: ' + JSON.stringify(v));
  }
});

test('el vocabulario cubre los quince campos de EEFF que captura la ingesta', () => {
  const eeff = VOCABULARIO.filter((v) => v.campo.startsWith('eeff.')).map((v) => v.campo);
  for (const c of ['t_cash', 't_ar', 't_inv', 't_tax', 't_ppe', 't_act_curr', 't_act_nocurr',
                   't_act_tot', 't_inv_assoc', 't_intang', 't_dif', 't_ap', 't_c', 't_op', 't_s']) {
    assert.ok(eeff.includes('eeff.' + c), 'falta el campo eeff.' + c);
  }
});

test('los valores salen formateados y los ausentes salen nulos', () => {
  assert.strictEqual(valorDeCampo(estudio, 'ent'), 'ACME COLOMBIA S.A.S');
  assert.strictEqual(valorDeCampo(estudio, 'nit'), '800123456-7');
  assert.strictEqual(valorDeCampo(estudio, 'anio'), '2025');
  assert.strictEqual(valorDeCampo(estudio, 'eeff.t_inv_assoc'), '2.000.000.000');
  assert.strictEqual(valorDeCampo(estudio, 'accionista.nombre'), 'ACME INC');
  assert.strictEqual(valorDeCampo(estudio, 'eeff.t_cash'), null, 'no ingresado -> null');
  assert.strictEqual(valorDeCampo({}, 'ent'), null, 'estudio vacío -> null');
});

test('un campo fuera del vocabulario nunca devuelve valor', () => {
  assert.strictEqual(valorDeCampo(estudio, 'direccion'), null);
});

/* Los topes UVT son de lo que más muta: cambian cada año gravable y hoy
   `exactTemplateMapper` los sustituye por valor literal. */
test('los topes UVT se calculan contra el año del estudio', () => {
  const de2025 = valorDeCampo({ anio: 2025 }, 'uvt.tope45k');
  const de2024 = valorDeCampo({ anio: 2024 }, 'uvt.tope45k');
  assert.ok(de2025 && de2024, 'ambos años deben resolver');
  assert.notStrictEqual(de2025, de2024, 'el tope debe cambiar con el año');
  assert.match(de2025, /^[\d.]+$/, 'debe salir formateado con separadores');
});

test('el rango intercuartil sale de las comparables y no del informe viejo', () => {
  const conComparables = {
    ...estudio,
    pli: 'MO',
    t_op: 100000, t_c: 800000,
    comparables: [
      { s: 1000, c: 800, op: 100 }, { s: 2000, c: 1600, op: 260 },
      { s: 3000, c: 2400, op: 300 }, { s: 4000, c: 3200, op: 520 },
    ],
  };
  const p25 = valorDeCampo(conComparables, 'rango.p25');
  const p75 = valorDeCampo(conComparables, 'rango.p75');
  assert.ok(p25 && p75, 'con cuatro comparables debe haber rango');
  assert.ok(['CUMPLE', 'NO CUMPLE'].includes(valorDeCampo(conComparables, 'rango.cumple')));
});

test('sin comparables suficientes el rango sale nulo, no inventado', () => {
  assert.strictEqual(valorDeCampo({ ...estudio, comparables: [] }, 'rango.p25'), null);
  assert.strictEqual(valorDeCampo(estudio, 'rango.mediana'), null);
});
