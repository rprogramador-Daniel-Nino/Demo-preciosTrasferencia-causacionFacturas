import { test } from 'node:test';
import assert from 'node:assert';
import {
  matrizDeRechazo, gruposDelAnexoC, tablasAnexoC, reescribirListado,
  actualizarAnexoCHtml, NOMBRE_ANEXO_C, ETIQUETA_TOTAL,
} from './anexoCHtml.js';
import { localizarAnexo } from './anexoBHtml.js';
import { textoPlanoHtml } from './tablasHtmlInforme.js';

/* Tablas como las emite el extractor desde la plantilla de END GAME. */
const RESUMEN = '<table>'
  + '<thead><tr><th><p><strong>FILTRO APLICADO INTERNACIONALES</strong></p></th>'
  + '<th><p><strong>FILTROS APLICADO</strong></p></th><th><p><strong>N° POR FILTRO</strong></p></th></tr></thead>'
  + '<tbody>'
  + '<tr><td><p>Diferencias funcionales</p></td><td><p>A</p></td><td><p>327</p></td></tr>'
  + '<tr><td><p>Compañías Holding o consideradas grupo multinacional</p></td><td><p>C</p></td><td><p>36</p></td></tr>'
  + '<tr><td><p>TOTAL, UNIVERSO</p></td><td><p></p></td><td><p>442</p></td></tr>'
  + '</tbody></table>';

const listado = (titulo, filas) => '<table>'
  + `<tbody><tr><td><p><strong>${titulo}</strong></p></td></tr>`
  + '<tr><th><p><strong>Nº</strong></p></th><th><p><strong>NOMBRE DE LA COMPAÑÍA</strong></p></th>'
  + '<th><p><strong>FILTRO</strong></p></th></tr>'
  + filas.map(([n, c, f]) => `<tr><td><p>${n}</p></td><td><p>${c}</p></td><td><p>${f}</p></td></tr>`).join('')
  + '</tbody></table>';

const PLANTILLA = '<h1>ANEXO B. Descripciones</h1><p>algo</p>'
  + '<p>ANEXO C. Matriz de Rechazo 68</p>'  // entrada del índice
  + '<h1>ANEXO C. Matriz de Rechazo</h1>'
  + RESUMEN
  + listado('DIFERENCIAS FUNCIONALES', [['1', '11 BIT STUDIOS S.A.', 'A'], ['2', '7LEVELS S.A.', 'A']])
  + listado('COMPAÑIAS HOLDING O CONSIDERADAS GRUPO MULTINACIONAL', [['1', '2WATCH HOLDING S.R.L.', 'C']])
  + listado('COMPAÑÍAS COMPARABLES', [['1', 'AKATSUKI INC.', 'D']])
  + '<h1>ANEXO D. Metodología de los ajustes económicos</h1><p>fin</p>';

/* Universo enriquecido como lo devuelve `enriquecerUniverso`. */
const UNIVERSO = [
  { name: 'ZETA COMPARABLE LTD', seleccionada: true, motivoClave: '' },
  { name: 'OMEGA COMPARABLE PLC', seleccionada: true, motivoClave: '' },
  { name: 'HOLDING UNO SA', seleccionada: false, motivoClave: 'holding' },
  { name: 'HOLDING DOS SA', seleccionada: false, motivoClave: 'holding' },
  { name: 'CON PERDIDA SA', seleccionada: false, motivoClave: 'perdidaOperativa' },
  /* Sin motivo y sin seleccionar: reserva o válida fuera del cupo → diferencias funcionales. */
  { name: 'BETA SIN MOTIVO SA', seleccionada: false, motivoClave: '' },
  { name: 'ALFA SIN MOTIVO SA', seleccionada: false, motivoClave: '' },
];

const EMBUDO = {
  evaluadas: 7, seleccionadas: 2, reserva: 2,
  porMotivo: { holding: 2, perdidaOperativa: 1 },
};

const ESTUDIO = { embudoSeleccion: EMBUDO, matrizRechazo: matrizDeRechazo(UNIVERSO) };

/* ══════ Agrupación ══════ */

test('la matriz agrupa por motivo, y lo que no tiene motivo va a diferencias funcionales', () => {
  /* Misma regla que la hoja «Matriz de rechazo» del Excel: seleccionada → comparable; sin
     motivo → diferencias funcionales; con motivo → su grupo. Si las dos divergieran, el
     anexo y el libro de soporte dirían cosas distintas del mismo estudio. */
  const m = matrizDeRechazo(UNIVERSO);
  assert.strictEqual(m.universo, 7);
  assert.deepStrictEqual(m.porMotivo.aceptadas, ['OMEGA COMPARABLE PLC', 'ZETA COMPARABLE LTD']);
  assert.deepStrictEqual(m.porMotivo.holding, ['HOLDING DOS SA', 'HOLDING UNO SA']);
  assert.deepStrictEqual(m.porMotivo.rigorFuncional,
    ['ALFA SIN MOTIVO SA', 'BETA SIN MOTIVO SA'], 'ordenadas y en diferencias funcionales');
});

test('la matriz descarta las filas sin razón social', () => {
  const m = matrizDeRechazo([{ name: '  ', seleccionada: false }, { name: 'A SA', seleccionada: false }]);
  assert.strictEqual(m.universo, 1);
});

test('los grupos salen en el orden y con las letras del cuerpo del informe', () => {
  /* Es lo que hace que la letra de una compañía en el anexo sea la que la Tabla 16 asigna a
     su motivo. Si el anexo las numerara por su cuenta, las dos tablas se contradirían. */
  const grupos = gruposDelAnexoC(ESTUDIO);
  assert.deepStrictEqual(grupos.map((g) => g.clave),
    ['rigorFuncional', 'holding', 'perdidaOperativa', 'aceptadas']);
  assert.deepStrictEqual(grupos.map((g) => g.letra), ['A', 'B', 'C', 'D']);
  assert.strictEqual(grupos[3].companias.length, 2, 'las aceptadas cierran el anexo');
});

test('un motivo sin compañías no genera grupo', () => {
  const sinHoldings = matrizDeRechazo(UNIVERSO.filter((c) => c.motivoClave !== 'holding'));
  const grupos = gruposDelAnexoC({ embudoSeleccion: EMBUDO, matrizRechazo: sinHoldings });
  assert.ok(!grupos.some((g) => g.clave === 'holding'), 'sin tabla para un grupo vacío');
});

test('sin matriz no se inventan grupos', () => {
  assert.deepStrictEqual(gruposDelAnexoC({}), []);
  assert.deepStrictEqual(gruposDelAnexoC({ matrizRechazo: { porMotivo: {} } }), []);
});

test('un motivo que la matriz tiene y el embudo no declara se publica igual', () => {
  /* La suma de los grupos tiene que dar el universo evaluado: es lo que hace verificable la
     matriz ante quien la revise. Recorrer solo el embudo perdía compañías en silencio —lo
     comprobó la verificación contra la plantilla real, donde 1.800 candidatas sin motivo
     desaparecían porque ese embudo no declaraba su fila—. */
  const embudoIncompleto = { evaluadas: 7, seleccionadas: 2, reserva: 0, porMotivo: { holding: 2 } };
  const grupos = gruposDelAnexoC({
    embudoSeleccion: embudoIncompleto, matrizRechazo: matrizDeRechazo(UNIVERSO),
  });

  const total = grupos.reduce((a, g) => a + g.companias.length, 0);
  assert.strictEqual(total, UNIVERSO.length, 'no se pierde ninguna compañía');
  assert.ok(grupos.some((g) => g.clave === 'perdidaOperativa'),
    'el motivo que el embudo no declara aparece al final');
  assert.deepStrictEqual(grupos.map((g) => g.letra), grupos.map((_, i) => 'ABCDEF'[i]),
    'las letras siguen corridas y sin huecos');
});

test('sin embudo se publican todos los grupos de la matriz, con su etiqueta', () => {
  const grupos = gruposDelAnexoC({ matrizRechazo: matrizDeRechazo(UNIVERSO) });
  assert.strictEqual(grupos.reduce((a, g) => a + g.companias.length, 0), UNIVERSO.length);
  const holding = grupos.find((g) => g.clave === 'holding');
  assert.match(holding.etiqueta, /holding/i, 'la etiqueta sale del mapa de motivos');
});

/* ══════ Localización ══════ */

test('la zona del anexo se localiza por su encabezado, no por la entrada del índice', () => {
  const z = localizarAnexo(PLANTILLA, 'matriz');
  assert.ok(z);
  const zona = PLANTILLA.slice(z.inicio, z.fin);
  assert.ok(zona.includes('11 BIT STUDIOS'), 'la zona contiene los listados');
  assert.ok(!zona.includes('ANEXO D'), 'y cierra antes del anexo siguiente');
  assert.ok(!/68/.test(z.titulo));
});

test('las tablas del anexo se clasifican en resumen y listados', () => {
  const z = localizarAnexo(PLANTILLA, 'matriz');
  const { resumen, listados } = tablasAnexoC(PLANTILLA.slice(z.inicio, z.fin));
  assert.ok(resumen, 'el resumen se reconoce por su encabezado, que es lo único que tiene');
  assert.strictEqual(listados.length, 3);
});

/* ══════ Reescritura ══════ */

test('un listado se rellena con las compañías, numeradas y con su letra', () => {
  const z = localizarAnexo(PLANTILLA, 'matriz');
  const { listados } = tablasAnexoC(PLANTILLA.slice(z.inicio, z.fin));
  const grupo = {
    clave: 'holding', etiqueta: 'Compañías holding o de grupo (en la razón social)',
    letra: 'B', companias: ['UNO SA', 'DOS SA', 'TRES SA'],
  };
  const salida = reescribirListado(listados[0].xml, grupo);

  assert.match(salida, /<td><p>1<\/p><\/td><td><p>UNO SA<\/p><\/td><td><p>B<\/p><\/td>/);
  assert.match(salida, /<td><p>3<\/p><\/td><td><p>TRES SA<\/p><\/td>/);
  assert.ok(!salida.includes('11 BIT STUDIOS'), 'las de la plantilla se van');
  assert.match(salida, /NOMBRE DE LA COMPAÑÍA/, 'el encabezado de columnas se conserva');
  assert.match(salida, /COMPAÑÍAS HOLDING O DE GRUPO/, 'el título del grupo, en mayúsculas y sin la explicación');
});

/* ══════ Integración ══════ */

test('el anexo queda con una tabla por grupo y el resumen cuadrado', () => {
  const avisos = [];
  const salida = actualizarAnexoCHtml(PLANTILLA, ESTUDIO, avisos);
  assert.deepStrictEqual(avisos, []);

  const z = localizarAnexo(salida, 'matriz');
  const zona = salida.slice(z.inicio, z.fin);
  const { resumen, listados } = tablasAnexoC(zona);
  assert.strictEqual(listados.length, 4, 'cuatro grupos con compañías');

  const textoResumen = textoPlanoHtml(zona.slice(resumen.inicio, resumen.fin));
  assert.match(textoResumen, /TOTAL, UNIVERSO/);
  assert.match(textoResumen, /7/, 'el total es el universo evaluado');
  assert.ok(!textoResumen.includes('327'), 'y no los conteos de la plantilla');

  const texto = textoPlanoHtml(zona);
  ['ZETA COMPARABLE LTD', 'HOLDING UNO SA', 'ALFA SIN MOTIVO SA'].forEach((n) =>
    assert.ok(texto.includes(n), `falta ${n}`));
  assert.ok(!texto.includes('11 BIT STUDIOS'), 'ninguna de la plantilla sobrevive');
  assert.match(salida, /ANEXO D\. Metodolog/, 'lo que sigue queda intacto');
});

test('los conteos del resumen son el tamaño real de cada listado', () => {
  /* El resumen del anexo tiene que cuadrar con su propio detalle: si dijera 327 y el listado
     trajera 2, el anexo se contradice a sí mismo delante de quien lo revise. */
  const salida = actualizarAnexoCHtml(PLANTILLA, ESTUDIO, []);
  const z = localizarAnexo(salida, 'matriz');
  const zona = salida.slice(z.inicio, z.fin);
  const { resumen, listados } = tablasAnexoC(zona);
  const textoResumen = textoPlanoHtml(zona.slice(resumen.inicio, resumen.fin));

  gruposDelAnexoC(ESTUDIO).forEach((g, i) => {
    const filas = [...listados[i].xml.matchAll(/<tr(?:\s[^>]*)?>/g)].length - 2; // título + cabecera
    assert.strictEqual(filas, g.companias.length, `el listado ${i} trae sus compañías`);
    assert.ok(textoResumen.includes(String(g.companias.length)),
      `el resumen declara ${g.companias.length} para ${g.clave}`);
  });
});

test('sin la matriz del universo se avisa y el anexo se deja intacto', () => {
  /* Todo o nada, como el ANEXO B: un anexo con unos grupos del estudio y otros del informe
     anterior es la peor forma de fallar. */
  const avisos = [];
  const salida = actualizarAnexoCHtml(PLANTILLA, { embudoSeleccion: EMBUDO }, avisos);
  assert.strictEqual(salida, PLANTILLA);
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0], /matriz del universo evaluado/);
  assert.match(avisos[0], /paso 3/, 'dice qué hacer');
});

test('sin la sección en la plantilla se avisa', () => {
  const avisos = [];
  const html = '<p>Un informe sin ANEXO C</p>';
  assert.strictEqual(actualizarAnexoCHtml(html, ESTUDIO, avisos), html);
  assert.ok(avisos.includes(NOMBRE_ANEXO_C));
});

test('un anexo sin resumen o sin listados se deja como está', () => {
  const soloResumen = '<h1>ANEXO C. Matriz de Rechazo</h1>' + RESUMEN;
  const avisos = [];
  assert.strictEqual(actualizarAnexoCHtml(soloResumen, ESTUDIO, avisos), soloResumen);
  assert.ok(avisos.includes(NOMBRE_ANEXO_C));
});

test('la etiqueta del total es la que usa la plantilla', () => {
  assert.strictEqual(ETIQUETA_TOTAL, 'TOTAL, UNIVERSO');
});

/* ══════ Mayúsculas ══════
   Requisito del usuario (2026-08-19): el ANEXO C entero en mayúscula —la matriz de rechazo y
   los listados—, encabezados incluidos. La «Tabla 16. Razones de rechazo» del CUERPO queda
   fuera; su test vive en `tablasHtmlInforme.test.js`, que es donde se regenera. */

test('el ANEXO C se publica entero en mayúscula, encabezados incluidos', () => {
  /* Encabezados en caja mixta a propósito: los de la plantilla de END GAME ya vienen en
     mayúscula, así que con ellos el test pasaría aunque no se subiera nada. */
  const plantilla = '<h1>ANEXO C. Matriz de Rechazo</h1>'
    + RESUMEN.replace('FILTRO APLICADO INTERNACIONALES', 'Filtro aplicado internacionales')
    + listado('Diferencias funcionales', [['1', 'Viejo Nombre Sa', 'A']])
        .replace('NOMBRE DE LA COMPAÑÍA', 'Nombre de la Compañía')
    + '<h1>ANEXO D. Metodología</h1>';

  const universo = [
    { name: 'Zeta Comparable Ltd', seleccionada: true, motivoClave: '' },
    { name: 'Holding Uno Sa', seleccionada: false, motivoClave: 'holding' },
  ];
  const estudio = {
    embudoSeleccion: { evaluadas: 2, seleccionadas: 1, reserva: 0, porMotivo: { holding: 1 } },
    matrizRechazo: matrizDeRechazo(universo),
  };
  const salida = actualizarAnexoCHtml(plantilla, estudio, []);

  /* Los listados: la razón social que publica el anexo. */
  assert.match(salida, /ZETA COMPARABLE LTD/, 'la razón social no subió');
  assert.ok(!salida.includes('Zeta Comparable Ltd'));
  assert.match(salida, /HOLDING UNO SA/);
  /* El encabezado de columnas, que es de la plantilla: sube la caja, no las palabras. */
  assert.match(salida, /NOMBRE DE LA COMPAÑÍA/, 'el encabezado del listado no subió');
  assert.ok(!salida.includes('Nombre de la Compañía'));
  /* La matriz de rechazo: sus etiquetas vienen en caja mixta del cuerpo del informe. */
  assert.ok(!/Compañías holding/.test(salida), 'la etiqueta de la matriz no subió');
  assert.match(salida, /Filtro aplicado internacionales/i);
  assert.ok(!salida.includes('Filtro aplicado internacionales'),
    'el encabezado de la matriz no subió');
});
