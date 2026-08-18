import { test } from 'node:test';
import assert from 'node:assert';
import { EEFF_PROMPT, EEFF_COMPARABLE_PROMPT, EEFF_COMPARABLES_LOTE_PROMPT } from './eeffParser.js';

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

test('ambos prompts exigen null (nunca 0) como convención general para cualquier rubro ausente', () => {
  // Regla general explícita: cualquier rubro no encontrado en el documento -> null, nunca 0.
  assert.match(EEFF_COMPARABLE_PROMPT, /nunca\s+0/i);
  assert.match(EEFF_COMPARABLES_LOTE_PROMPT, /nunca\s+en\s+0|nunca\s+0/i);

  // El "ponlo en 0" que antes exceptuaba solo a los dos campos opcionales ya no debe existir.
  assert.doesNotMatch(EEFF_COMPARABLES_LOTE_PROMPT, /ponlo en 0/i);

  // Las plantillas JSON de ejemplo ya no deben usar 0 como placeholder para rubros numéricos
  // (deben usar null, igual que los dos campos que ya eran opcionales).
  assert.doesNotMatch(EEFF_COMPARABLE_PROMPT, /"ingresos_operacionales":\s*0/);
  assert.doesNotMatch(EEFF_COMPARABLES_LOTE_PROMPT, /"ingresos_operacionales":\s*0/);
});

test('el prompt de lote pide pagina_inicio y pagina_fin por empresa, sobre el PDF completo', () => {
  assert.ok(EEFF_COMPARABLES_LOTE_PROMPT.includes('pagina_inicio'), 'falta "pagina_inicio"');
  assert.ok(EEFF_COMPARABLES_LOTE_PROMPT.includes('pagina_fin'), 'falta "pagina_fin"');
  assert.match(
    EEFF_COMPARABLES_LOTE_PROMPT,
    /pagina_inicio[\s\S]{0,400}null|null[\s\S]{0,400}pagina_inicio/i,
    'debe decir que se devuelve null si no se puede determinar con certeza',
  );
});

/* ══════ La IA no debe convertir la escala por su cuenta ══════ */

test('los tres prompts prohíben a la IA convertir la cifra aunque el documento declare la unidad', () => {
  [EEFF_PROMPT, EEFF_COMPARABLE_PROMPT, EEFF_COMPARABLES_LOTE_PROMPT].forEach((prompt) => {
    assert.match(prompt, /nunca.{0,20}multipliques.{0,20}ni.{0,20}conviert/i, 'falta prohibir la conversión');
    assert.match(prompt, /28,81[\s\S]{0,80}millones[\s\S]{0,40}28\.81[\s\S]{0,40}(no|NO)[\s\S]{0,20}28810000/,
      'falta el ejemplo concreto que fija qué significa "tal cual"');
  });
});

test('la regla de escala aplica sin excepción, aunque el documento rotule la columna en miles o millones', () => {
  [EEFF_PROMPT, EEFF_COMPARABLE_PROMPT, EEFF_COMPARABLES_LOTE_PROMPT].forEach((prompt) => {
    assert.match(prompt, /obligatoria.{0,10}y sin excepci[oó]n/i);
  });
});
