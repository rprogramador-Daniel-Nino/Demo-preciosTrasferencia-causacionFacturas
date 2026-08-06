import test from 'node:test';
import assert from 'node:assert/strict';
import { perfilFuncionalBilingue, PERFILES_DETERMINADOS } from './perfilFuncionalPatch.js';

/* ── SERVICIO en inglés, varios sectores ── */
test('EN software: contract development → SERVICIO', () => {
  assert.equal(perfilFuncionalBilingue('Provides custom software development services to third-party clients on a contract basis.'), 'SERVICIO');
});
test('EN manufactura: contract manufacturer → SERVICIO', () => {
  assert.equal(perfilFuncionalBilingue('A contract manufacturer of electronic components for OEM customers.'), 'SERVICIO');
});
test('EN textil: toll manufacturing → SERVICIO', () => {
  assert.equal(perfilFuncionalBilingue('Operates as a toll manufacturer of garments on behalf of global apparel brands.'), 'SERVICIO');
});

/* ── SERVICIO en español, varios sectores ── */
test('ES maquila: fabricación por encargo → SERVICIO', () => {
  assert.equal(perfilFuncionalBilingue('La compañía realiza maquila y fabricación por encargo para terceros.'), 'SERVICIO');
});
test('ES servicios: presta servicios por cuenta de → SERVICIO', () => {
  assert.equal(perfilFuncionalBilingue('Presta servicios de ensamble por cuenta de su casa matriz.'), 'SERVICIO');
});

/* ── EMPRESARIO en inglés, varios sectores ── */
test('EN alimentos: own brands → EMPRESARIO', () => {
  assert.equal(perfilFuncionalBilingue('Develops and markets its own brands of packaged foods.'), 'EMPRESARIO');
});
test('EN retail: franchise + proprietary → EMPRESARIO', () => {
  assert.equal(perfilFuncionalBilingue('A franchisor that licenses its proprietary retail format worldwide.'), 'EMPRESARIO');
});

/* ── EMPRESARIO en español, varios sectores ── */
test('ES manufactura: marca propia → EMPRESARIO', () => {
  assert.equal(perfilFuncionalBilingue('Fabrica y comercializa productos bajo su marca propia con propiedad intelectual registrada.'), 'EMPRESARIO');
});
test('ES protección balística: diseña y comercializa marca propia → EMPRESARIO', () => {
  assert.equal(perfilFuncionalBilingue('Diseña y comercializa chalecos de protección balística bajo su marca propia.'), 'EMPRESARIO');
});

/* ── MIXTO e INDEFINIDO ── */
test('MIXTO: presta servicios y además tiene marca propia', () => {
  assert.equal(perfilFuncionalBilingue('Presta servicios de manufactura para terceros y además vende productos bajo su marca propia.'), 'MIXTO');
});
test('INDEFINIDO: descripción sin señales funcionales', () => {
  assert.equal(perfilFuncionalBilingue('A company headquartered in Bogotá.'), 'INDEFINIDO');
});
test('INDEFINIDO: descripción vacía', () => {
  assert.equal(perfilFuncionalBilingue(''), 'INDEFINIDO');
  assert.equal(perfilFuncionalBilingue(null), 'INDEFINIDO');
});

/* ── Configurable por sector/idioma sin tocar el código ── */
test('config: frase de servicio adicional propia del sector', () => {
  assert.equal(perfilFuncionalBilingue('Empresa dedicada al servicio de estampado industrial.',
    { servicioExtra: ['servicio de estampado'] }), 'SERVICIO');
});

test('PERFILES_DETERMINADOS no incluye INDEFINIDO', () => {
  assert.equal(PERFILES_DETERMINADOS.has('INDEFINIDO'), false);
  assert.equal(PERFILES_DETERMINADOS.has('SERVICIO'), true);
});
