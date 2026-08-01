import { test } from 'node:test';
import assert from 'node:assert';
import { aplicarMarcas } from './plantillaMarcador.js';

test('marca un fragmento que existe y deja el resto intacto', () => {
  const html = '<p>La sociedad ACME COLOMBIA S.A.S declara</p>';
  const r = aplicarMarcas(html, [{ fragmento: 'ACME COLOMBIA S.A.S', campo: 'ent', ocurrencia: 1 }]);
  assert.strictEqual(r.aplicadas, 1);
  assert.strictEqual(
    r.html,
    '<p>La sociedad <span data-campo="ent">ACME COLOMBIA S.A.S</span> declara</p>'
  );
});

test('descarta el fragmento que no existe y dice por qué', () => {
  const html = '<p>La sociedad ACME declara</p>';
  const r = aplicarMarcas(html, [{ fragmento: 'NO ESTÁ', campo: 'ent', ocurrencia: 1 }]);
  assert.strictEqual(r.aplicadas, 0);
  assert.strictEqual(r.html, html, 'el documento no debe cambiar');
  assert.strictEqual(r.descartadas.length, 1);
  assert.match(r.descartadas[0].motivo, /no aparece/i);
});

test('descarta el campo que no está en el vocabulario', () => {
  const html = '<p>Carrera 7</p>';
  const r = aplicarMarcas(html, [{ fragmento: 'Carrera 7', campo: 'direccion', ocurrencia: 1 }]);
  assert.strictEqual(r.aplicadas, 0);
  assert.match(r.descartadas[0].motivo, /vocabulario/i);
});

/* El fragmento debe buscarse solo en el texto visible. Si se buscara sobre el
   HTML crudo, un fragmento que coincida con el valor de un atributo rompería
   la etiqueta y el documento dejaría de ser válido. */
test('no marca dentro de una etiqueta ni de un atributo', () => {
  const html = '<p title="ent">ent aparece aquí</p>';
  const r = aplicarMarcas(html, [{ fragmento: 'ent', campo: 'ent', ocurrencia: 1 }]);
  assert.ok(r.html.includes('title="ent"'), 'el atributo no debe tocarse');
  assert.ok(r.html.includes('<span data-campo="ent">ent</span> aparece'), 'debe marcar el texto');
});

test('la ocurrencia elige cuál de las repeticiones se marca', () => {
  const html = '<p>2024 y 2024</p>';
  const r = aplicarMarcas(html, [{ fragmento: '2024', campo: 'anio', ocurrencia: 2 }]);
  assert.strictEqual(r.html, '<p>2024 y <span data-campo="anio">2024</span></p>');
});

test('una ocurrencia que no existe se descarta en vez de marcar otra', () => {
  const html = '<p>2024</p>';
  const r = aplicarMarcas(html, [{ fragmento: '2024', campo: 'anio', ocurrencia: 3 }]);
  assert.strictEqual(r.aplicadas, 0);
  assert.strictEqual(r.html, html);
});

test('marcas sobre el mismo texto no se pisan entre sí', () => {
  const html = '<p>ACME S.A.S con NIT 800123456-7</p>';
  const r = aplicarMarcas(html, [
    { fragmento: 'ACME S.A.S', campo: 'ent', ocurrencia: 1 },
    { fragmento: '800123456-7', campo: 'nit', ocurrencia: 1 },
  ]);
  assert.strictEqual(r.aplicadas, 2);
  assert.ok(r.html.includes('<span data-campo="ent">ACME S.A.S</span>'));
  assert.ok(r.html.includes('<span data-campo="nit">800123456-7</span>'));
});

test('solapamiento: contenedora primero, contenida después se rechaza', () => {
  const html = '<p>ACME COLOMBIA S.A.S</p>';
  const r = aplicarMarcas(html, [
    { fragmento: 'ACME COLOMBIA S.A.S', campo: 'ent', ocurrencia: 1 },
    { fragmento: 'COLOMBIA', campo: 'nit', ocurrencia: 1 },
  ]);
  assert.strictEqual(r.aplicadas, 1, 'solo la primera marca debe aplicarse');
  assert.strictEqual(r.descartadas.length, 1);
  assert.match(r.descartadas[0].motivo, /solapa/i);
  assert.ok(r.html.includes('<span data-campo="ent">ACME COLOMBIA S.A.S</span>'));
});

test('solapamiento: contenida primero, contenedora después se rechaza', () => {
  const html = '<p>ACME COLOMBIA S.A.S</p>';
  const r = aplicarMarcas(html, [
    { fragmento: 'COLOMBIA', campo: 'nit', ocurrencia: 1 },
    { fragmento: 'ACME COLOMBIA S.A.S', campo: 'ent', ocurrencia: 1 },
  ]);
  assert.strictEqual(r.aplicadas, 1, 'solo la primera marca debe aplicarse');
  assert.strictEqual(r.descartadas.length, 1);
  assert.match(r.descartadas[0].motivo, /solapa/i);
  assert.ok(r.html.includes('<span data-campo="nit">COLOMBIA</span>'));
});

test('solapamiento parcial: dos fragmentos que comparten parte se rechazan', () => {
  const html = '<p>ACME COLOMBIA S.A.S</p>';
  const r = aplicarMarcas(html, [
    { fragmento: 'ACME COLOMBIA', campo: 'ent', ocurrencia: 1 },
    { fragmento: 'COLOMBIA S.A.S', campo: 'nit', ocurrencia: 1 },
  ]);
  assert.strictEqual(r.aplicadas, 1);
  assert.strictEqual(r.descartadas.length, 1);
  assert.match(r.descartadas[0].motivo, /solapa/i);
});

test('caso realista: cifra menor dentro de mayor se rechaza', () => {
  const html = '<p>Total 1.234.567</p>';
  const r = aplicarMarcas(html, [
    { fragmento: '1.234.567', campo: 'eeff.t_act_tot', ocurrencia: 1 },
    { fragmento: '234.567', campo: 'eeff.t_inv', ocurrencia: 1 },
  ]);
  assert.strictEqual(r.aplicadas, 1);
  assert.strictEqual(r.descartadas.length, 1);
  assert.match(r.descartadas[0].motivo, /solapa/i);
});

test('remover los spans recupera el documento original', () => {
  const original = '<p>ACME COLOMBIA S.A.S</p>';
  const r = aplicarMarcas(original, [
    { fragmento: 'ACME COLOMBIA S.A.S', campo: 'ent', ocurrencia: 1 },
  ]);
  const sinSpans = r.html.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
  assert.strictEqual(sinSpans, original);
});

test('remover los spans con múltiples marcas recupera el original', () => {
  const original = '<p>ACME S.A.S con NIT 800123456-7</p>';
  const r = aplicarMarcas(original, [
    { fragmento: 'ACME S.A.S', campo: 'ent', ocurrencia: 1 },
    { fragmento: '800123456-7', campo: 'nit', ocurrencia: 1 },
  ]);
  const sinSpans = r.html.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
  assert.strictEqual(sinSpans, original);
});
