import { test } from 'node:test';
import assert from 'node:assert';
import { construirHtmlSinPlantilla } from './informeSinPlantilla.js';

/* ── Estudio vacío ── */

test('no revienta con un estudio vacío y devuelve un HTML con el título del borrador', () => {
  const html = construirHtmlSinPlantilla({}, null, null);
  assert.strictEqual(typeof html, 'string');
  assert.ok(html.includes('Borrador sin plantilla'));
});

test('tampoco revienta si estudio, análisis de mercado y de sector llegan undefined', () => {
  const html = construirHtmlSinPlantilla(undefined, undefined, undefined);
  assert.strictEqual(typeof html, 'string');
});

/* ── Contribuyente y vinculado ── */

const CONTRIBUYENTE = {
  ent: 'ACME COLOMBIA S.A.S', nit: '900123456-7', anio: 2025, ciiu: '4649',
  objeto: 'Comercialización de bienes', representante: 'JUAN PÉREZ',
  vinc: 'ACME HOLDING INC', pais_vinc: 'ESTADOS UNIDOS', vinc_tipo: 'VENTA SERVICIOS',
};

test('incluye los datos propios del contribuyente y del vinculado', () => {
  const html = construirHtmlSinPlantilla(CONTRIBUYENTE, null, null);
  assert.ok(html.includes('ACME COLOMBIA S.A.S'));
  assert.ok(html.includes('900123456-7'));
  assert.ok(html.includes('ACME HOLDING INC'));
  assert.ok(html.includes('ESTADOS UNIDOS'));
});

test('escapa el HTML de los datos del contribuyente para no romper el documento', () => {
  const html = construirHtmlSinPlantilla({ ...CONTRIBUYENTE, ent: 'A&B <Cía>' }, null, null);
  assert.ok(html.includes('A&amp;B &lt;Cía&gt;'));
  assert.ok(!html.includes('A&B <Cía>'));
});

/* ── Composición accionaria ── */

test('incluye la composición accionaria cuando el estudio trae accionistas propios', () => {
  const html = construirHtmlSinPlantilla({
    ...CONTRIBUYENTE,
    accionistas: [{ nombre: 'MATRIZ SAS', pais: 'COLOMBIA', acciones: 100, valor_capital: 1000, participacion_pct: 100 }],
  }, null, null);
  assert.ok(html.includes('Composición accionaria'));
  assert.ok(html.includes('MATRIZ SAS'));
});

test('omite la composición accionaria cuando el estudio no trae accionistas propios', () => {
  const html = construirHtmlSinPlantilla(CONTRIBUYENTE, null, null);
  assert.ok(!html.includes('Composición accionaria'));
});

/* ── Anexo de estados financieros ── */

test('un hueco de anexo por cada página de EEFF cargada', () => {
  const html = construirHtmlSinPlantilla({ ...CONTRIBUYENTE, eeffImages: ['a', 'b', 'c'] }, null, null);
  const huecos = html.match(/data-hueco="anexo_eeff"/g) || [];
  assert.strictEqual(huecos.length, 3);
});

test('sin páginas de EEFF no se emite ningún hueco de anexo', () => {
  const html = construirHtmlSinPlantilla(CONTRIBUYENTE, null, null);
  assert.ok(!html.includes('data-hueco="anexo_eeff"'));
});

/* ── Panorama económico (III.A / III.B) ── */

test('sin análisis de mercado, el panorama mundial y colombiano quedan con el marcador de pendiente', () => {
  const html = construirHtmlSinPlantilla(CONTRIBUYENTE, null, null);
  assert.ok(html.includes('panorama de la economía mundial'));
  assert.ok(html.includes('panorama de la economía colombiana'));
});

test('con narrativa ya redactada, el panorama mundial la usa en vez del marcador', () => {
  const datosMacro = { narrativa: { mundial: '<p>La economía mundial creció 3% en 2025.</p>' } };
  const html = construirHtmlSinPlantilla(CONTRIBUYENTE, datosMacro, null);
  assert.ok(html.includes('La economía mundial creció 3% en 2025.'));
});

/* ── Comparables ── */

test('incluye la muestra de comparables cuando el estudio trae comparables con cifras', () => {
  const estudio = {
    ...CONTRIBUYENTE,
    comparables: [
      { name: 'DISTRIBUIDORA ANDINA S.A.', amb: 'Nac', s: 1000, c: 800, op: 100 },
      { name: 'GULF FUEL TRADING CO', amb: 'Int', s: 2000, c: 1600, op: 260 },
    ],
  };
  const html = construirHtmlSinPlantilla(estudio, null, null);
  assert.ok(html.includes('DISTRIBUIDORA ANDINA S.A.'));
  assert.ok(html.includes('GULF FUEL TRADING CO'));
});

test('sin comparables no se emite la tabla de muestra', () => {
  const html = construirHtmlSinPlantilla(CONTRIBUYENTE, null, null);
  assert.ok(!html.includes('Muestra Compañías comparables') && !html.includes('Muestra de comparables'));
});
