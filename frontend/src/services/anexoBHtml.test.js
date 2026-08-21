import { test } from 'node:test';
import assert from 'node:assert';
import {
  localizarAnexoB, bloquesAnexoB, generarBloqueAnexoB, actualizarAnexoBHtml,
  formatearCifra, NOMBRE_ANEXO_B, RUBROS_RESULTADOS, RUBROS_BALANCE,
} from './anexoBHtml.js';
import { textoPlanoHtml } from './tablasHtmlInforme.js';

/* Bloque tal como lo emite el extractor desde la plantilla de END GAME: `<thead>`/`<tbody>`,
   la razón social en `<strong>`, cifras con coma de miles y el año del informe anterior. */
const bloque = (nombre, desc, resultados, balance) => '<table>'
  + '<thead><tr><th><p><strong>NOMBRE DE LA COMPAÑÍA COMPARABLE</strong></p></th>'
  + '<th><p><strong>DESCRIPCIÓN ACTIVIDAD</strong></p></th></tr></thead>'
  + `<tbody><tr><td><p><strong>${nombre}</strong></p></td><td><p>${desc}</p></td></tr></tbody></table>`
  + '<p></p>'
  + '<table><thead><tr><th><p><strong>Descripción</strong></p></th><th><p><strong>2024</strong></p></th></tr></thead>'
  + '<tbody>' + resultados.map(([a, b]) => `<tr><td><p>${a}</p></td><td><p>${b}</p></td></tr>`).join('')
  + '</tbody></table>'
  + '<p></p>'
  + '<table><thead><tr><th><p><strong>Descripción</strong></p></th><th><p><strong>2024</strong></p></th></tr></thead>'
  + '<tbody>' + balance.map(([a, b]) => `<tr><td><p>${a}</p></td><td><p>${b}</p></td></tr>`).join('')
  + '</tbody></table>';

const RESULTADOS_AKATSUKI = [
  ['Ventas netas', '23,652,000,000'],
  ['Costo de los bienes vendidos', '9,954,000,000'],
  ['Beneficio bruto', '13,698,000,000'],
  ['Gastos operativos', '9,782,000,000'],
  ['Utilidad de operación', '3,916,000,000'],
];
const BALANCE_AKATSUKI = [
  ['Activos totales promedio', '53,337,500,000'],
  ['Promedio de cuentas por pagar netas', '975,500,000'],
  ['Promedio de cuentas por cobrar netas', '4,252,000,000'],
  ['EPP neto promedio', '468,500,000'],
  ['Inventario neto promedio', '626,000,000'],
  ['Efectivo promedio y equivalentes de efectivo', '29,670,500,000'],
];

const PLANTILLA = '<h1>ANEXO A. Estados financieros</h1><p>algo</p>'
  + '<p>ANEXO B. Descripciones de comparables y Estados Financieros 55</p>'  // entrada del índice
  + '<h1>ANEXO B. Descripciones de comparables y Estados Financieros</h1>'
  + bloque('AKATSUKI INC.', 'Akatsuki se dedica al juego.', RESULTADOS_AKATSUKI, BALANCE_AKATSUKI)
  + bloque('COLOPL, INC.', 'Colopl desarrolla juegos.', RESULTADOS_AKATSUKI, BALANCE_AKATSUKI)
  + bloque('IGG INC', 'IGG publica juegos.', RESULTADOS_AKATSUKI, BALANCE_AKATSUKI)
  + '<h1>ANEXO C. Matriz de Rechazo</h1><p>fin</p>';

const eeff = (extra = {}) => ({
  ingresos_operacionales: 5000000, costo_ventas: 3500000, utilidad_bruta: 1500000,
  gastos_operacionales: 600000, utilidad_operacional: 900000,
  total_activos: 8000000, cuentas_por_pagar: 300000, cuentas_por_cobrar: 400000,
  propiedad_planta_equipo: 180000, inventarios: 250000, efectivo_y_equivalentes: 1200000,
  gastos_investigacion_desarrollo: null, gastos_publicidad: null,
  ...extra,
});

const ESTUDIO = {
  anio: 2026,
  comparables: [
    { name: 'ZETA COMPARABLE LTD', descActividad: 'Zeta desarrolla software.', eeffDatos: eeff() },
    { name: 'OMEGA COMPARABLE PLC', descActividad: 'Omega presta servicios.', eeffDatos: eeff({ gastos_publicidad: 45000 }) },
  ],
};

/* ══════ Localización ══════ */

test('el anexo se localiza por su encabezado y no por la entrada del índice', () => {
  /* El índice repite «ANEXO B. …55» con el número de página pegado. Sin descartarlo, la
     búsqueda se queda en la tabla de contenido y el anexo de verdad no se toca. */
  const z = localizarAnexoB(PLANTILLA);
  assert.ok(z, 'debe encontrarlo');
  const zona = PLANTILLA.slice(z.inicio, z.fin);
  assert.ok(zona.includes('AKATSUKI'), 'la zona tiene que contener los bloques');
  assert.ok(!zona.includes('ANEXO C'), 'y cerrar antes del anexo siguiente');
  assert.ok(!/55/.test(z.titulo), 'el título no es la entrada del índice');
});

test('sin encabezado de ANEXO B no se localiza nada', () => {
  assert.strictEqual(localizarAnexoB('<p>Un informe sin anexos</p>'), null);
});

test('el anexo cierra en el final del documento si no hay ANEXO C', () => {
  const html = '<h1>ANEXO B. Descripciones</h1>'
    + bloque('A', 'd', RESULTADOS_AKATSUKI, BALANCE_AKATSUKI);
  const z = localizarAnexoB(html);
  assert.strictEqual(z.fin, html.length);
});

test('el anexo se localiza por su nombre aunque la plantilla lo numere de otro modo', () => {
  /* La numeración es de cada informe: el de MC Internacional lleva sus anexos A, C, D, E, F
     —sin B— y ahí las descripciones de comparables son el ANEXO C. Buscando la letra, este
     anexo no se rellenaba y el informe se radicaba con las comparables del cliente anterior. */
  const html = '<h1>ANEXO A. Estados Financieros</h1><p>eeff</p>'
    + '<h1>ANEXO C. Descripciones de comparables y Estados Financieros</h1>'
    + bloque('AKATSUKI INC.', 'Akatsuki se dedica al juego.', RESULTADOS_AKATSUKI, BALANCE_AKATSUKI)
    + '<h1>ANEXO D. Matriz de Rechazo</h1><p>matriz</p>';

  const z = localizarAnexoB(html);
  assert.ok(z, 'tiene que encontrarlo');
  assert.strictEqual(z.letra, 'C', 'y saber con qué letra lo llama esta plantilla');
  const zona = html.slice(z.inicio, z.fin);
  assert.ok(zona.includes('AKATSUKI'), 'la zona son sus bloques');
  assert.ok(!zona.includes('ANEXO D'), 'y cierra antes de la matriz de rechazo');
  assert.ok(!zona.includes('eeff'), 'sin tocar el anexo de estados financieros');
});

test('el anexo de comparables no se confunde con el de estados financieros', () => {
  /* Los dos títulos dicen «Estados Financieros». Si el genérico ganara, las descripciones se
     escribirían sobre el anexo del contribuyente. */
  const html = '<h1>ANEXO A. Estados Financieros</h1><p>eeff del contribuyente</p>'
    + '<h1>ANEXO C. Descripciones de comparables y Estados Financieros</h1><p>fichas</p>';
  const z = localizarAnexoB(html);
  assert.strictEqual(z.letra, 'C');
  assert.ok(!html.slice(z.inicio, z.fin).includes('eeff del contribuyente'));
});

/* ══════ Bloques ══════ */

test('cada bloque agrupa la tabla del nombre con sus dos tablas de cifras', () => {
  const z = localizarAnexoB(PLANTILLA);
  const bloques = bloquesAnexoB(PLANTILLA.slice(z.inicio, z.fin));
  assert.strictEqual(bloques.length, 3, 'la plantilla trae tres comparables');
  bloques.forEach((b) => assert.strictEqual(b.tablas.length, 3, 'tres tablas por bloque'));
});

/* ══════ Generación ══════ */

test('el bloque generado lleva el nombre y la descripción de la comparable', () => {
  const z = localizarAnexoB(PLANTILLA);
  const zona = PLANTILLA.slice(z.inicio, z.fin);
  const molde = bloquesAnexoB(zona)[0];
  const html = generarBloqueAnexoB(molde, zona.slice(molde.inicio, molde.fin), ESTUDIO.comparables[0], 2026);

  assert.match(html, /<td><p><strong>ZETA COMPARABLE LTD<\/strong><\/p><\/td>/,
    'la razón social conserva la negrita del molde');
  assert.match(html, /Zeta desarrolla software/);
  assert.ok(!html.includes('AKATSUKI'), 'no queda nada de la comparable de la plantilla');
  assert.ok(!html.includes('23,652,000,000'), 'ni sus cifras');
});

test('las cifras se escriben con el separador de miles de la plantilla', () => {
  /* El anexo original viene con el formato de la base de datos. Cambiarlo a «5.000.000»
     sería un cambio visible que nadie pidió. */
  const z = localizarAnexoB(PLANTILLA);
  const zona = PLANTILLA.slice(z.inicio, z.fin);
  const molde = bloquesAnexoB(zona)[0];
  const html = generarBloqueAnexoB(molde, zona.slice(molde.inicio, molde.fin), ESTUDIO.comparables[0], 2026);
  assert.match(html, /5,000,000/, 'coma de miles, como el molde');
  assert.ok(!html.includes('5.000.000'));
});

test('el año del encabezado pasa a ser el del estudio', () => {
  const z = localizarAnexoB(PLANTILLA);
  const zona = PLANTILLA.slice(z.inicio, z.fin);
  const molde = bloquesAnexoB(zona)[0];
  const html = generarBloqueAnexoB(molde, zona.slice(molde.inicio, molde.fin), ESTUDIO.comparables[0], 2026);
  assert.strictEqual((html.match(/<strong>2026<\/strong>/g) || []).length, 2,
    'en las dos tablas de cifras');
  assert.ok(!html.includes('<strong>2024</strong>'));
});

test('solo se emiten los rubros que la comparable reporta', () => {
  /* Es lo que hace la plantilla original: unas comparables traen I+D y publicidad y otras
     no. Emitir la fila con un cero afirmaría un dato que no se tiene. */
  const z = localizarAnexoB(PLANTILLA);
  const zona = PLANTILLA.slice(z.inicio, z.fin);
  const molde = bloquesAnexoB(zona)[0];

  const sinExtras = generarBloqueAnexoB(molde, zona.slice(molde.inicio, molde.fin), ESTUDIO.comparables[0], 2026);
  assert.ok(!/publicidad/i.test(sinExtras), 'sin publicidad no aparece la fila');
  assert.ok(!/investigaci/i.test(sinExtras), 'ni la de I+D');

  const conPublicidad = generarBloqueAnexoB(molde, zona.slice(molde.inicio, molde.fin), ESTUDIO.comparables[1], 2026);
  assert.match(conPublicidad, /Gastos de publicidad/, 'quien la reporta sí la lleva');
  assert.match(conPublicidad, /45,000/);
});

test('un rubro ausente del balance no deja la fila con un cero', () => {
  const z = localizarAnexoB(PLANTILLA);
  const zona = PLANTILLA.slice(z.inicio, z.fin);
  const molde = bloquesAnexoB(zona)[0];
  const sinInventario = { name: 'X SA', eeffDatos: eeff({ inventarios: null }) };
  const html = generarBloqueAnexoB(molde, zona.slice(molde.inicio, molde.fin), sinInventario, 2026);
  assert.ok(!/Inventario neto promedio/.test(html), 'la fila no se emite');
  assert.match(html, /Activos totales promedio/, 'las demás sí');
});

test('sin descripción redactada se dice, en vez de dejar el párrafo de otra empresa', () => {
  const z = localizarAnexoB(PLANTILLA);
  const zona = PLANTILLA.slice(z.inicio, z.fin);
  const molde = bloquesAnexoB(zona)[0];
  const html = generarBloqueAnexoB(molde, zona.slice(molde.inicio, molde.fin),
    { name: 'X SA', eeffDatos: eeff() }, 2026);
  assert.match(html, /Descripción de actividad no disponible/);
  assert.ok(!html.includes('Akatsuki se dedica'));
});

/* ══════ Integración ══════ */

test('el anexo queda con un bloque por comparable de la muestra', () => {
  /* La plantilla trae tres y el estudio tiene dos: hay que retirar un bloque entero, que es
     lo que el marcado por campos no podía hacer. */
  const avisos = [];
  const salida = actualizarAnexoBHtml(PLANTILLA, ESTUDIO, avisos);

  const z = localizarAnexoB(salida);
  const bloques = bloquesAnexoB(salida.slice(z.inicio, z.fin));
  assert.strictEqual(bloques.length, 2, 'dos comparables, dos bloques');
  assert.deepStrictEqual(avisos, []);

  const texto = textoPlanoHtml(salida.slice(z.inicio, z.fin));
  assert.match(texto, /ZETA COMPARABLE LTD/);
  assert.match(texto, /OMEGA COMPARABLE PLC/);
  assert.ok(!/AKATSUKI|COLOPL|IGG/.test(texto), 'ninguna de la plantilla sobrevive');
  assert.match(salida, /ANEXO C\. Matriz de Rechazo/, 'lo que sigue al anexo queda intacto');
  assert.match(salida, /ANEXO A\. Estados financieros/, 'y lo que va antes también');
});

test('una comparable sin estado financiero sale con las cifras en blanco, no cancela el anexo', () => {
  /* Antes era todo o nada: una sola comparable sin cifras y el anexo se dejaba como estaba,
     es decir con las comparables y los estados financieros del contribuyente ANTERIOR. Eso
     no es quedarse corto, es radicar datos de otro cliente, y encima con aspecto de estar
     completo. La regla ahora es que del informe de referencia no sobreviva nada: salen todas
     las comparables del estudio, y las que no traen cifras van en blanco con el aviso
     nombrándolas.

     Ojo con el motivo por el que se eligió «todo o nada» en su día —no mezclar bloques del
     estudio con bloques del informe anterior—: ya no aplica, porque se emiten TODOS los
     bloques del estudio y ninguno del anterior. */
  const avisos = [];
  const estudio = {
    ...ESTUDIO,
    comparables: [ESTUDIO.comparables[0], { name: 'SIN EEFF SA' }],
  };
  const salida = actualizarAnexoBHtml(PLANTILLA, estudio, avisos);

  assert.notStrictEqual(salida, PLANTILLA, 'el anexo tiene que rehacerse');
  assert.ok(salida.includes('SIN EEFF SA'), 'la comparable sin cifras aparece igual');
  assert.ok(salida.includes(ESTUDIO.comparables[0].name), 'y la que sí las trae');
  ['AKATSUKI INC.', 'COLOPL, INC.', 'IGG INC'].forEach((viejo) =>
    assert.ok(!salida.includes(viejo), `la comparable ${viejo} del informe anterior tiene que irse`));
  assert.ok(!salida.includes('23,652,000,000'), 'ni sus cifras');

  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0], /SIN EEFF SA/, 'el aviso nombra la comparable');
  assert.match(avisos[0], /paso 4/, 'y dice qué hacer');
  assert.match(avisos[0], /en blanco/, 'y que salió en blanco, no que se omitió el anexo');
});

test('sin comparables en el estudio se avisa y no se vacía el anexo', () => {
  const avisos = [];
  const salida = actualizarAnexoBHtml(PLANTILLA, { anio: 2026, comparables: [] }, avisos);
  assert.strictEqual(salida, PLANTILLA);
  assert.ok(avisos.includes(NOMBRE_ANEXO_B));
});

test('sin la sección en la plantilla se avisa', () => {
  const avisos = [];
  const html = '<p>Un informe sin ANEXO B</p>';
  assert.strictEqual(actualizarAnexoBHtml(html, ESTUDIO, avisos), html);
  assert.ok(avisos.includes(NOMBRE_ANEXO_B));
});

test('un anexo sin bloque completo del que copiar se deja como está', () => {
  /* Sin las tres tablas no hay molde, y emitir tablas propias cambiaría el formato. */
  const html = '<h1>ANEXO B. Descripciones</h1>'
    + '<table><thead><tr><th><p>NOMBRE DE LA COMPAÑÍA COMPARABLE</p></th><th><p>DESCRIPCIÓN</p></th></tr></thead>'
    + '<tbody><tr><td><p>A</p></td><td><p>d</p></td></tr></tbody></table>';
  const avisos = [];
  assert.strictEqual(actualizarAnexoBHtml(html, ESTUDIO, avisos), html);
  assert.ok(avisos.includes(NOMBRE_ANEXO_B));
});

/* ══════ Formato de cifras ══════ */

test('formatearCifra respeta el separador y marca el hueco', () => {
  /* Dos decimales siempre, como los imprime la ficha de la macro que el analista revisa al
     lado del anexo. Antes salía lo que trajera el número —«862,6» con un decimal, «1.470»
     con ninguno—, así que dos filas de la misma tabla llevaban formatos distintos. */
  assert.strictEqual(formatearCifra(23652000000, ','), '23,652,000,000.00');
  assert.strictEqual(formatearCifra(23652000000, '.'), '23.652.000.000,00');
  assert.strictEqual(formatearCifra(-4500, ','), '-4,500.00');
  assert.strictEqual(formatearCifra(null, ','), '—');
  assert.strictEqual(formatearCifra('', ','), '—');
  assert.strictEqual(formatearCifra('no es número', ','), '—');
  assert.strictEqual(formatearCifra(1234.6, ','), '1,234.60', 'el decimal se completa a dos');
  assert.strictEqual(formatearCifra(1234.6, '.'), '1.234,60', 'con separador de punto el decimal usa coma');
  /* Sin separador detectado en la plantilla se cae al del informe. Antes esta rama emitía
     «1.234.6»: miles con punto y decimal con punto, ilegible. */
  assert.strictEqual(formatearCifra(1234.6, null), '1.234,60');
});

test('los rubros cubren las dos tablas del anexo', () => {
  assert.strictEqual(RUBROS_RESULTADOS.length, 7, '5 fijos + I+D + publicidad');
  assert.strictEqual(RUBROS_BALANCE.length, 8, '6 + otras inversiones + total de pasivos');
  /* Cada rubro reconoce su propia etiqueta: si un patrón dejara de casar, la fila saldría
     con la etiqueta por defecto y nadie lo notaría. */
  [...RUBROS_RESULTADOS, ...RUBROS_BALANCE].forEach((r) => {
    assert.ok(r.patron.test(r.etiqueta), `el patrón de ${r.campo} no reconoce su etiqueta`);
  });
  /* Y no reconoce la de otro: dos patrones que casen la misma etiqueta de la plantilla
     harían que dos filas distintas se rotularan igual. */
  [RUBROS_RESULTADOS, RUBROS_BALANCE].forEach((tabla) => {
    tabla.forEach((r) => {
      const otros = tabla.filter((o) => o !== r && r.patron.test(o.etiqueta));
      assert.deepStrictEqual(otros.map((o) => o.campo), [],
        `el patrón de ${r.campo} también casa la etiqueta de ${otros.map((o) => o.campo)}`);
    });
  });
});

test('el balance del Anexo B va en el orden en que la ficha lo imprime', () => {
  /* La ficha de la macro imprime efectivo, otras inversiones, cuentas por cobrar,
     inventarios, propiedad planta y equipo, total de activos, total de pasivos y cuentas
     por pagar. Es el documento que se revisa al lado del anexo: con las filas cruzadas hay
     que buscar cada rubro en vez de leer las dos en paralelo. Esta ruta —la de plantilla—
     se había quedado con el orden viejo cuando se corrigió la de OOXML. */
  assert.deepStrictEqual(RUBROS_BALANCE.map((r) => r.campo), [
    'efectivo_y_equivalentes',
    'otras_inversiones',
    'cuentas_por_cobrar',
    'inventarios',
    'propiedad_planta_equipo',
    'total_activos',
    'total_pasivos',
    'cuentas_por_pagar',
  ]);
});
