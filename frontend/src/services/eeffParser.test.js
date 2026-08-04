import { test } from 'node:test';
import assert from 'node:assert';
import { EEFF_COMPARABLE_PROMPT, EEFF_COMPARABLES_LOTE_PROMPT } from './eeffParser.js';

const CAMPOS_NUEVOS_ANEXO_B = [
  'propiedad_planta_equipo',
  'efectivo_y_equivalentes',
  'gastos_investigacion_desarrollo',
  'gastos_publicidad',
];

test('el prompt de una sola comparable pide los campos nuevos del Anexo B', () => {
  CAMPOS_NUEVOS_ANEXO_B.forEach((campo) => {
    assert.ok(EEFF_COMPARABLE_PROMPT.includes(campo), `falta "${campo}" en EEFF_COMPARABLE_PROMPT`);
  });
});

test('el prompt de lote de comparables pide los campos nuevos del Anexo B', () => {
  CAMPOS_NUEVOS_ANEXO_B.forEach((campo) => {
    assert.ok(EEFF_COMPARABLES_LOTE_PROMPT.includes(campo), `falta "${campo}" en EEFF_COMPARABLES_LOTE_PROMPT`);
  });
});

test('los campos opcionales de gasto piden explícitamente null si no se desglosan', () => {
  assert.match(EEFF_COMPARABLE_PROMPT, /gastos_investigacion_desarrollo[\s\S]{0,200}null/i);
  assert.match(EEFF_COMPARABLE_PROMPT, /gastos_publicidad[\s\S]{0,200}null|null[\s\S]{0,200}gastos_publicidad/i);
});
