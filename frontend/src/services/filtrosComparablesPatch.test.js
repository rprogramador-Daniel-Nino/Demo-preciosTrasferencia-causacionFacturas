import test from 'node:test';
import assert from 'node:assert/strict';
import { esHolding, esSicHolding, sicPrincipal, sicsTodos } from './filtrosComparablesPatch.js';

/* ── Holdings puros de CUALQUIER contexto (todos los SIC en 67xx) → holding ── */
test('holding puro 6719 sin operativo → holding', () => {
  assert.equal(esHolding({ name: 'Acroud AB', sic: '6719 Offices of Holding Companies' }), true);
});
test('trust 6733 puro → holding', () => {
  assert.equal(esHolding({ name: 'Some Trust', sic: '6733 Trusts NEC; 6726 Investment Offices' }), true);
});
test('REIT 6798 puro → holding', () => {
  assert.equal(esHolding({ name: 'Realty Income Trust', sic: '6798 Real Estate Investment Trusts' }), true);
});

/* ── Operativas de MUCHOS SECTORES (agnóstico): nunca son holding ── */
test('SOFTWARE con "Holdings" en el nombre → NO holding', () => {
  assert.equal(esHolding({ name: '360 Ludashi Holdings', sic: '7372 Prepackaged Software' }), false);
});
test('CONSTRUCCIÓN con "Holdings" en el nombre → NO holding', () => {
  assert.equal(esHolding({ name: 'ABC Construcciones Holdings', sic: '1531 Operative Builders' }), false);
});
test('ALIMENTOS con estructura holding (6719 + 2000) → NO holding', () => {
  assert.equal(esHolding({ name: 'Grupo Alimentos Holding', sic: '6719 Holding; 2000 Food and Kindred Products' }), false);
});
test('MANUFACTURA (3600) → NO holding', () => {
  assert.equal(esHolding({ name: 'Industrias Metálicas S.A.', sic: '3670 Electronic Components' }), false);
});
test('BANCA (6021) → NO holding (opera en finanzas)', () => {
  assert.equal(esHolding({ name: 'Banco Nacional', sic: '6021 National Commercial Banks' }), false);
});
test('RETAIL (5411) con inversiones secundarias → NO holding', () => {
  assert.equal(esHolding({ name: 'Cadena Retail Holdings', sic: '5411 Grocery Stores; 6719 Holding' }), false);
});
test('empresa de juegos con estructura holding (6719 + 7372) → NO holding', () => {
  assert.equal(esHolding({ name: '7Road Holdings', sic: '6719 Holding; 7371 Programming; 7372 Software' }), false);
});

/* ── El nombre NUNCA excluye a una operativa (agnóstico y robusto) ── */
test('nombre dice "Inversiones" pero SIC operativo → NO holding', () => {
  assert.equal(esHolding({ name: 'Inversiones El Roble S.A.', sic: '2200 Textile Mill Products' }), false);
});

/* ── Respaldo por nombre sólo cuando NO hay SIC ── */
test('sin SIC y nombre de holding → holding (respaldo)', () => {
  assert.equal(esHolding({ name: 'Inversiones Patrimoniales S.A.', sic: '' }), true);
});
test('sin SIC y nombre operativo → NO holding', () => {
  assert.equal(esHolding({ name: 'Panadería La Espiga', sic: '' }), false);
});

/* ── Utilidades ── */
test('esSicHolding reconoce la familia 67xx', () => {
  assert.equal(esSicHolding('6719'), true);
  assert.equal(esSicHolding('6798'), true);
  assert.equal(esSicHolding('7372'), false);
  assert.equal(esSicHolding('1531'), false);
});
test('sicPrincipal y sicsTodos', () => {
  assert.equal(sicPrincipal('6719 Offices; 7372 Software'), '6719');
  assert.deepEqual(sicsTodos('6719 A; 7372 B; 1531 C'), ['6719', '7372', '1531']);
});
test('familiaHolding configurable', () => {
  // si se decide que 6798 REIT es operativo (opera inmuebles), se puede excluir de la familia
  const soloCartera = (s) => /^67(1|2|3)\d$/.test(s); // 671x,672x,673x pero no 679x
  assert.equal(esHolding({ name: 'REIT X', sic: '6798 REIT' }, { familiaHolding: soloCartera }), false);
});
