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

test('un recurso ausente se reporta en recursosFaltantes sin duplicarse', () => {
  const marcado = '<img data-recurso="logo" /><p>x</p><img data-recurso="logo" />';
  const r = renderizar(marcado, estudio, []);
  assert.ok(!r.html.includes('src='), 'la imagen no debe tener src');
  assert.deepStrictEqual(r.recursosFaltantes, ['logo']);
  assert.deepStrictEqual(r.vacios, []);
});

test('múltiples recursos ausentes se reportan sin duplicarse', () => {
  const marcado = '<img data-recurso="logo" /><img data-recurso="ico" /><img data-recurso="logo" />';
  const r = renderizar(marcado, estudio, []);
  assert.ok(r.recursosFaltantes.includes('logo'));
  assert.ok(r.recursosFaltantes.includes('ico'));
  assert.strictEqual(r.recursosFaltantes.length, 2);
});

test('un id de recurso con caracteres especiales de expresión regular no tumba el render', () => {
  const recursos = [{ id: 'logo[abc]', dataUrl: 'data:image/png;base64,DATA' }];
  const marcado = '<img data-recurso="logo[abc]" />';
  const r = renderizar(marcado, estudio, recursos);
  assert.ok(r.html.includes('src="data:image/png;base64,DATA"'));
});

test('un dataUrl con caracteres de reemplazo especial no se corrompe', () => {
  const recursos = [{ id: 'img', dataUrl: 'data:image/png;base64,$&$1' }];
  const marcado = '<img data-recurso="img" />';
  const r = renderizar(marcado, estudio, recursos);
  assert.ok(r.html.includes('src="data:image/png;base64,$&$1"'));
});

test('un valor de campo con < se escapa a &lt;', () => {
  const est = { ent: '<script>alert("xss")</script>', nit: '800123456-7', anio: 2025 };
  const r = renderizar('<p><span data-campo="ent">OLD</span></p>', est);
  assert.ok(r.html.includes('&lt;script&gt;'));
  assert.ok(!r.html.includes('<script>'));
});

test('un valor de campo con & se escapa a &amp;', () => {
  const est = { ent: 'ACME & CO', nit: '800123456-7', anio: 2025 };
  const r = renderizar('<p><span data-campo="ent">OLD</span></p>', est);
  assert.ok(r.html.includes('&amp;'));
  assert.ok(!r.html.includes(' & '));
});

test('un valor de campo con " se escapa a &quot;', () => {
  const est = { ent: 'Empresa "Premium"', nit: '800123456-7', anio: 2025 };
  const r = renderizar('<p><span data-campo="ent">OLD</span></p>', est);
  assert.ok(r.html.includes('&quot;'));
  assert.ok(!r.html.includes('"Premium"'));
});

test('la envoltura del resaltado no se escapa, solo el valor', () => {
  const estudio = { ent: 'SAFE & CO', nit: '800123456-7', anio: 2025 };
  const r = renderizar('<p><span data-campo="ent">OLD</span></p>', estudio);
  /* Antes esto comprobaba `style=`, porque el resaltado iba en un `style=` inline. Ahora
     va por clase y lo pinta sólo el CSS del previo: el inline se colaba en el .doc y cada
     valor sustituido salía más negrita y con aire a los lados. Lo que el test fija sigue
     siendo lo mismo —la envoltura llega como HTML y el valor llega escapado—, no la
     forma concreta del estilo. */
  assert.ok(r.html.includes('<span class="pt-valor">'),
    'la envoltura debe llegar como HTML, sin escapar');
  assert.ok(!r.html.includes('style='), 'el resaltado no debe llevar estilo inline');
  assert.ok(r.html.includes('&amp;'), 'el ampersand del valor debe estar escapado');
});
