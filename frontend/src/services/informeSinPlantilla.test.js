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

/* ── Matriz de rechazo (Tabla 16 + ANEXO C) ── */

const EMBUDO = {
  evaluadas: 100, seleccionadas: 8, reserva: 12,
  porMotivo: {
    holding: 30, saldoNegativo: 5, perdidaOperativa: 15,
    sinDescripcion: 0, actividadDistinta: 25, rigorFuncional: 5,
  },
};

test('incluye la Tabla 16 de razones de rechazo cuando el estudio trae embudoSeleccion', () => {
  const html = construirHtmlSinPlantilla({ ...CONTRIBUYENTE, embudoSeleccion: EMBUDO }, null, null);
  assert.ok(html.includes('Razones de rechazo'));
  assert.ok(html.includes('TOTAL, UNIVERSO'));
  assert.ok(html.includes('100')); // el total evaluado
});

test('sin embudoSeleccion no se emite la Tabla 16', () => {
  const html = construirHtmlSinPlantilla(CONTRIBUYENTE, null, null);
  assert.ok(!html.includes('Razones de rechazo'));
});

test('incluye el detalle del ANEXO C con las compañías descartadas por cada motivo', () => {
  const html = construirHtmlSinPlantilla({
    ...CONTRIBUYENTE,
    embudoSeleccion: EMBUDO,
    matrizRechazo: { universo: 100, porMotivo: { holding: ['HOLCO SAS'], perdidaOperativa: ['PERDIDA SAS'] } },
  }, null, null);
  assert.ok(html.includes('HOLCO SAS'));
  assert.ok(html.includes('PERDIDA SAS'));
});

test('sin matrizRechazo no se emite el detalle del ANEXO C', () => {
  const html = construirHtmlSinPlantilla({ ...CONTRIBUYENTE, embudoSeleccion: EMBUDO }, null, null);
  assert.ok(!html.includes('HOLCO SAS'));
});

/* ── Anexo B: descripción de actividad económica ── */

test('incluye la descripción de actividad ya redactada en español de cada comparable', () => {
  const estudio = {
    ...CONTRIBUYENTE,
    comparables: [{ name: 'ACME COMPARABLE INC', descActividad: 'Empresa dedicada a la fabricación de acero.' }],
  };
  const html = construirHtmlSinPlantilla(estudio, null, null);
  assert.ok(html.includes('ACME COMPARABLE INC'));
  assert.ok(html.includes('Empresa dedicada a la fabricación de acero.'));
});

test('sin descActividad cae a la descripción cruda, y sin ninguna al marcador fijo', () => {
  const estudio = {
    ...CONTRIBUYENTE,
    comparables: [
      { name: 'CON CRUDA INC', desc: 'Raw business description.' },
      { name: 'SIN DESCRIPCION INC' },
    ],
  };
  const html = construirHtmlSinPlantilla(estudio, null, null);
  assert.ok(html.includes('Raw business description.'));
  assert.ok(html.includes('Descripción de actividad no disponible.'));
});

/* ── Anexo B: EEFF de las comparables ── */

test('incluye el Estado de Resultados y el Balance General de una comparable con eeffDatos', () => {
  const estudio = {
    ...CONTRIBUYENTE,
    comparables: [{
      name: 'CON CIFRAS INC',
      eeffDatos: { periodo: 2025, ingresos_operacionales: 1000, costo_ventas: 600, utilidad_operacional: 150 },
    }],
  };
  const html = construirHtmlSinPlantilla(estudio, null, null);
  assert.ok(html.includes('Estado de Resultados'));
  assert.ok(html.includes('Balance General'));
  assert.ok(html.includes('1.000,00'));
});

test('sin eeffDatos de la comparable, avisa que falta el estado financiero en vez de inventarlo', () => {
  const estudio = { ...CONTRIBUYENTE, comparables: [{ name: 'SIN EEFF INC' }] };
  const html = construirHtmlSinPlantilla(estudio, null, null);
  assert.ok(html.includes('[PENDIENTE] Falta el estado financiero de SIN EEFF INC'));
});
