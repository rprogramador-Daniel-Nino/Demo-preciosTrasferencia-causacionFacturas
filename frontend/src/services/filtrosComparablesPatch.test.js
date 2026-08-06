import test from 'node:test';
import assert from 'node:assert/strict';
import {
  esHolding, holdingSospecha, tieneSemanticaHolding, tieneSemanticaHoldingDesc,
  maxParticipacion, participacionMaxima, esControlada, esVinculadaOControlada,
  esSicHolding, sicPrincipal, sicsTodos,
} from './filtrosComparablesPatch.js';

/* ── Clasificación de holding SOLO SEMÁNTICA (nombre/descripción, ES/EN) ── */
test('nombre con "Holdings" (EN) → revisar', () => {
  assert.equal(holdingSospecha({ name: '360 Ludashi Holdings Limited', sic: '7372 Software' }), 'revisar');
});
test('nombre con "Grupo" (ES) → revisar', () => {
  assert.equal(holdingSospecha({ name: 'Grupo Empresarial Antioqueño', sic: '2000 Food' }), 'revisar');
});
test('nombre con "Group" (EN) → revisar', () => {
  assert.equal(holdingSospecha({ name: 'Alpha Group', sic: '7372 Software' }), 'revisar');
});
test('nombre con "Sociedad de cartera" (ES) → revisar', () => {
  assert.equal(holdingSospecha({ name: 'Sociedad de Cartera del Norte S.A.', sic: '6719 Holding' }), 'revisar');
});
test('nombre con "HoldCo" (EN) → revisar', () => {
  assert.equal(holdingSospecha({ name: 'CID HoldCo, Inc.', sic: '6799 Investors' }), 'revisar');
});

/* ── El SIC NO clasifica: sin semántica en el nombre → "no" aunque el SIC sea 67xx ── */
test('SIC 67xx pero nombre operativo neutro → "no" (el SIC no clasifica)', () => {
  assert.equal(holdingSospecha({ name: 'Acroud AB', sic: '6719 Offices of Holding Companies' }), 'no');
  assert.equal(holdingSospecha({ name: '360 Security Technology Inc.', sic: '6719 Holding; 7372 Software' }), 'no');
});
test('SIC operativo y nombre neutro → "no"', () => {
  assert.equal(holdingSospecha({ name: 'Tose Co., Ltd.', sic: '7372 Software' }), 'no');
});

/* ── esHolding refleja la señal semántica ── */
test('esHolding: true solo si hay semántica de holding/grupo', () => {
  assert.equal(esHolding({ name: 'ABC Holdings', sic: '7372 SW' }), true);
  assert.equal(esHolding({ name: 'Grupo XYZ', sic: '2000 Food' }), true);
  assert.equal(esHolding({ name: 'Acroud AB', sic: '6719 Holding' }), false); // SIC no cuenta
  assert.equal(esHolding({ name: 'Tose Co', sic: '7372 SW' }), false);
});

/* ── Agnóstico y bilingüe: mismo comportamiento en cualquier sector ── */
test('multisector ES/EN: la semántica clasifica igual sin importar el sector', () => {
  assert.equal(esHolding({ name: 'Constructora Grupo Andino', sic: '1531 Builders' }), true);
  assert.equal(esHolding({ name: 'Food Holdings Inc', sic: '2000 Food' }), true);
  assert.equal(esHolding({ name: 'Textiles del Norte', sic: '2200 Textile' }), false);
  assert.equal(esHolding({ name: 'Banco Nacional', sic: '6021 Banks' }), false);
});

/* ── tieneSemanticaHolding directo ── */
test('tieneSemanticaHolding reconoce términos ES/EN inequívocos', () => {
  assert.equal(tieneSemanticaHolding({ name: 'X Holding' }), true);
  assert.equal(tieneSemanticaHolding({ name: 'X Holdings' }), true);
  assert.equal(tieneSemanticaHolding({ name: 'X Grupo' }), true);
  assert.equal(tieneSemanticaHolding({ name: 'X Grupos' }), true);
  assert.equal(tieneSemanticaHolding({ name: 'X Group' }), true);
  assert.equal(tieneSemanticaHolding({ name: 'X Groups' }), true);
  assert.equal(tieneSemanticaHolding({ name: 'X Sociedad de Cartera' }), true);
  assert.equal(tieneSemanticaHolding({ name: 'X Manufacturing' }), false);
});
test('evalúa ÚNICAMENTE la razón social (nombre) y ignora menciones en la descripción', () => {
  assert.equal(tieneSemanticaHolding({ name: 'Acme Services LLC', desc: 'Subsidiary of Global Holding Group' }), false);
  assert.equal(tieneSemanticaHolding({ name: 'Software Solutions Inc', desc: 'Part of the Technology Grupo' }), false);
});
test('tieneSemanticaHoldingDesc detecta holding en descripción si NO está en la razón social', () => {
  assert.equal(tieneSemanticaHoldingDesc({ name: 'Acme Services LLC', desc: 'Subsidiary of Global Holding Group' }), true);
  assert.equal(tieneSemanticaHoldingDesc({ name: 'Alpha Holdings', desc: 'Subsidiary of Global Holding Group' }), false, 'si la razón social ya lo trae, la desc retorna false');
});
test('términos AMBIGUOS no marcan (investment/ventures/invest)', () => {
  // el usuario reportó falsos positivos: nombres que no dicen holding/grupo
  assert.equal(tieneSemanticaHolding({ name: 'Cultural Investment Co' }), false);
  assert.equal(tieneSemanticaHolding({ name: 'Supreme Ventures Limited' }), false);
  assert.equal(tieneSemanticaHolding({ name: 'MGT Capital Investments' }), false);
});

/* ── Control / independencia (Art. 260-1) — sin cambios ── */
test('maxParticipacion extrae el mayor %', () => {
  assert.equal(maxParticipacion('Alain Wilmouth (51.03); Michel (3.90)'), 51.03);
  assert.equal(maxParticipacion(''), null);
});
test('controlada > umbral → excluir; <= umbral → conservar', () => {
  assert.equal(esControlada({ holders: 'X (51.03)' }), true);
  assert.equal(esControlada({ holders: 'X (47.10); Y (5)' }), false);
  assert.equal(esControlada({ holders: '' }), false);
});
test('umbral de control configurable', () => {
  assert.equal(esControlada({ holders: 'X (47.10)' }, { umbral: 25 }), true);
});

/* Capital IQ puede traer el porcentaje ya numérico («% Owned by Single Holder»)
   en vez del texto de accionistas: las dos formas deben decidir igual. */
test('esControlada acepta el holderPct numérico de Capital IQ', () => {
  assert.equal(esControlada({ holderPct: 51.03 }), true);
  assert.equal(esControlada({ holderPct: 47.1 }), false);
  assert.equal(esControlada({ maxpct: 80 }), true);
  assert.equal(esControlada({}), false, 'sin dato de accionistas no se excluye');
});
test('participacionMaxima prefiere el número y cae al texto', () => {
  assert.equal(participacionMaxima({ maxpct: 60, holders: 'X (10)' }), 60);
  assert.equal(participacionMaxima({ holderPct: 33.3 }), 33.3);
  assert.equal(participacionMaxima({ holders: 'X (44.5); Y (2)' }), 44.5);
  assert.equal(participacionMaxima({}), null);
  assert.equal(participacionMaxima(null), null);
});
test('un holderPct de 0 es un dato, no una ausencia', () => {
  assert.equal(participacionMaxima({ holderPct: 0 }), 0);
  assert.equal(esControlada({ holderPct: 0 }), false);
});

/* ── Criterio unificado (para quien no distingue los dos motivos) ── */
test('esVinculadaOControlada cubre holding semántico y control', () => {
  assert.equal(esVinculadaOControlada({ name: 'ABC Group' }), true);
  assert.equal(esVinculadaOControlada({ name: 'Textiles SA', holderPct: 70 }), true);
  assert.equal(esVinculadaOControlada({ name: 'Textiles SA', holderPct: 20 }), false);
});

/* ── Utilidades de SIC: ya no clasifican holding, pero siguen leyendo los códigos ── */
test('las utilidades de SIC siguen funcionando', () => {
  assert.equal(esSicHolding('6719'), true);
  assert.equal(esSicHolding('7372'), false);
  assert.equal(sicPrincipal('6719 Offices; 7372 Software'), '6719');
  assert.deepEqual(sicsTodos('6719 A; 7372 B; 1531 C'), ['6719', '7372', '1531']);
});
test('el SIC 67xx por sí solo NO clasifica holding', () => {
  // regresión: era el criterio anterior y ahora no debe influir
  assert.equal(esHolding({ name: 'Acroud AB', sic: '6719 Offices of Holding Companies' }), false);
});
