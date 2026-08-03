import { test } from 'node:test';
import assert from 'node:assert';
import { renderizar } from './plantillaRenderer.js';

const estudio = { ent: 'ACME COLOMBIA S.A.S', nit: '800123456-7', anio: 2025 };

test('sustituye el campo por su valor', () => {
  const r = renderizar('<p><span data-campo="ent">END GAME S.A.S</span></p>', estudio);
  assert.ok(r.html.includes('ACME COLOMBIA S.A.S'));
  assert.ok(!r.html.includes('END GAME'), 'sobrevivió el valor del cliente anterior');
  assert.deepStrictEqual(r.vacios, []);
});

test('un campo repetido se sustituye en todas sus apariciones', () => {
  const marcado = '<p><span data-campo="anio">2024</span> y <span data-campo="anio">2024</span></p>';
  const r = renderizar(marcado, estudio);
  assert.strictEqual((r.html.match(/2025/g) || []).length, 2);
  assert.ok(!r.html.includes('2024'));
});

/* El informe se radica ante la DIAN: una cifra del año anterior presentada como
   la del año en curso es peor que un hueco evidente. */
test('un campo sin dato deja marcador visible y se reporta, nunca el valor viejo', () => {
  const r = renderizar('<p><span data-campo="ciiu">6201</span></p>', estudio);
  assert.ok(!r.html.includes('6201'), 'no debe conservarse el valor de la referencia');
  assert.ok(r.html.includes('—'), 'debe quedar un marcador visible');
  assert.deepStrictEqual(r.vacios, ['ciiu']);
});

test('resuelve las imágenes contra el catálogo de recursos', () => {
  const recursos = [{ id: 'img_p0_1', dataUrl: 'data:image/png;base64,AAA' }];
  const r = renderizar('<p><img data-recurso="img_p0_1" /></p>', estudio, recursos);
  assert.ok(r.html.includes('src="data:image/png;base64,AAA"'));
});

test('una imagen repetida se resuelve en todas sus apariciones', () => {
  const recursos = [{ id: 'logo', dataUrl: 'data:image/png;base64,BBB' }];
  const marcado = '<img data-recurso="logo" /><p>x</p><img data-recurso="logo" />';
  const r = renderizar(marcado, estudio, recursos);
  assert.strictEqual((r.html.match(/base64,BBB/g) || []).length, 2);
});

test('el HTML sin marcas sale igual que entró', () => {
  const html = '<p>Texto fijo del informe</p>';
  assert.strictEqual(renderizar(html, estudio).html, html);
});
