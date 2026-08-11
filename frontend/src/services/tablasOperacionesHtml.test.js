import { test } from 'node:test';
import assert from 'node:assert';
import { actualizarTablasOperacionesHtml } from './tablasOperacionesHtml.js';

/* Forma REAL que `pdfReferenceExtractor` produce para estas dos tablas, tomada del HTML
   extraído de `Archivos Prueba/estudio pasado.pdf`: el rótulo es un `<p><strong>` aparte,
   la fila de encabezados usa `<th>`, y la fila de datos abre con `<th>` y sigue con `<td>`. */
const TABLA_1 =
  '<p><strong> Tabla 1. Operaciones de Ingreso</strong></p>' +
  '<table>' +
  '<tr><th><p></p><p><strong> Concepto de Operaciones a analizar</strong></p></th>' +
  '<th><p><strong> Nombre vinculado</strong></p></th>' +
  '<th><p><strong> País vinculado</strong></p></th>' +
  '<th><p><strong> Monto de la Operación analizar</strong></p></th></tr>' +
  '<tr><th><p> Otros servicios (07)</p></th><td><p> END GAME INTERACTIVE INC</p></td>' +
  '<td><p> ESTADOS UNIDOS</p></td><td><p> 3.435.357.400</p></td></tr>' +
  '</table>';

const TABLA_2 =
  '<p><strong> Tabla 2. Operación analizar</strong></p>' +
  '<table>' +
  '<tr><th><p><strong> No. Operaciones de análisis</strong></p></th>' +
  '<th><p><strong> Descripción</strong></p></th></tr>' +
  '<tr><th><p> Ingreso (07)</p></th><td><p> Otros servicios</p></td></tr>' +
  '</table>';

const INFORME = '<h1><strong> RESUMEN EJECUTIVO</strong></h1>' + TABLA_1 +
  '<p> Las anteriores operaciones fueron realizadas con intercompañías.</p>' + TABLA_2;

const ESTUDIO = {
  vinc_tipo: 'VENTA SERVICIOS',
  vinc: 'ACME INTERACTIVE LLC',
  pais_vinc: 'MÉXICO',
  monto_operacion: 3433542684,
};

const sinEtiquetas = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('la Tabla 1 se llena con los datos del estudio y no con los de la plantilla', () => {
  /* Este es el fallo que motivó el módulo: el informe se radicaba con el concepto, el
     vinculado, el país y el monto de END GAME 2024. */
  const texto = sinEtiquetas(actualizarTablasOperacionesHtml(INFORME, ESTUDIO));
  assert.match(texto, /VENTA SERVICIOS/);
  assert.match(texto, /ACME INTERACTIVE LLC/);
  assert.match(texto, /MÉXICO/);
  assert.match(texto, /3\.433\.542\.684/);
  assert.ok(!texto.includes('END GAME INTERACTIVE INC'), 'sobrevivió el vinculado anterior');
  assert.ok(!texto.includes('3.435.357.400'), 'sobrevivió el monto anterior');
});

test('la Tabla 2 se llena con la operación del estudio', () => {
  const texto = sinEtiquetas(actualizarTablasOperacionesHtml(INFORME, ESTUDIO));
  assert.match(texto, /Ingreso \(—\)/, 'sin código resoluble el hueco tiene que verse');
  assert.ok(!texto.includes('Ingreso (07)'), 'sobrevivió el código anterior');
});

test('se conserva la fila de encabezados que traía la plantilla', () => {
  /* Es el formato del cliente. Regenerarla la despintaría. */
  const salida = actualizarTablasOperacionesHtml(INFORME, ESTUDIO);
  assert.match(salida, /<th><p><\/p><p><strong> Concepto de Operaciones a analizar<\/strong><\/p><\/th>/);
  assert.match(salida, /<th><p><strong> Descripción<\/strong><\/p><\/th>/);
});

test('el rótulo de la tabla no se toca', () => {
  const salida = actualizarTablasOperacionesHtml(INFORME, ESTUDIO);
  assert.match(salida, /<p><strong> Tabla 1\. Operaciones de Ingreso<\/strong><\/p>/);
  assert.match(salida, /<p><strong> Tabla 2\. Operación analizar<\/strong><\/p>/);
});

test('las filas emitidas llevan la forma td/th que docxWriter sabe convertir', () => {
  /* `docxWriter.js` recoge los hijos `td`/`th` de cada `tr` y descarta lo demás, y cada
     celda tiene que traer su `<p>`: un texto suelto en la celda no se emite. La etiqueta,
     los atributos y la envoltura salen de la fila molde de la plantilla —lo hace
     `reescribirFilasHtml`—, así que la primera celda sigue siendo `<th>` porque así la
     trae el informe del cliente. */
  const salida = actualizarTablasOperacionesHtml(INFORME, ESTUDIO);
  assert.match(
    salida,
    /<tr><th><p>VENTA SERVICIOS<\/p><\/th><td><p>ACME INTERACTIVE LLC<\/p><\/td><td><p>MÉXICO<\/p><\/td><td><p>3\.433\.542\.684<\/p><\/td><\/tr>/
  );
});

test('se conserva el énfasis con el que la plantilla escribe la celda', () => {
  /* La razón de ser de esta ruta es conservar la presentación del informe del cliente. Si
     su fila de datos va en negrita, la nueva también: el valor cambia, el formato no. */
  const html =
    '<p><strong> Tabla 2. Operación analizar</strong></p>' +
    '<table><tr><th><p><strong> No. Operaciones de análisis</strong></p></th>' +
    '<th><p><strong> Descripción</strong></p></th></tr>' +
    '<tr><th><p><strong> Ingreso (07)</strong></p></th>' +
    '<td><p><strong> Otros servicios</strong></p></td></tr></table>';
  const salida = actualizarTablasOperacionesHtml(html, ESTUDIO);
  assert.match(
    salida,
    /<tr><th><p><strong>Ingreso \(—\)<\/strong><\/p><\/th><td><p><strong>VENTA SERVICIOS<\/strong><\/p><\/td><\/tr>/
  );
});

test('el texto entre las dos tablas sobrevive intacto', () => {
  const salida = actualizarTablasOperacionesHtml(INFORME, ESTUDIO);
  assert.match(salida, /<p> Las anteriores operaciones fueron realizadas con intercompañías\.<\/p>/);
});

test('una tabla que la plantilla no trae se reporta en los avisos', () => {
  /* Sin el aviso la tabla se queda con los datos del informe de referencia y nadie se
     entera: es el mismo contrato que `sustituidorDeTablas` de la ruta OOXML. */
  const avisos = [];
  const salida = actualizarTablasOperacionesHtml('<p> Un informe sin esas tablas.</p>', ESTUDIO, avisos);
  assert.deepStrictEqual(avisos, ['Operaciones de Ingreso', 'Operación analizar']);
  assert.strictEqual(salida, '<p> Un informe sin esas tablas.</p>', 'el documento no debe cambiar');
});

test('una plantilla de egreso se reconoce por el rótulo de su tabla', () => {
  const html =
    '<p><strong> Tabla 1. Operaciones de Egreso</strong></p>' +
    '<table><tr><th><p><strong> Concepto</strong></p></th></tr>' +
    '<tr><th><p> Otros servicios (36)</p></th></tr></table>';
  const avisos = [];
  const salida = actualizarTablasOperacionesHtml(html, { ...ESTUDIO, egreso: true }, avisos);
  assert.ok(!avisos.includes('Operaciones de Ingreso'), 'la tabla de egreso sí estaba');
  assert.match(sinEtiquetas(salida), /VENTA SERVICIOS/);
});

test('el número del rótulo desempata entre dos tablas homónimas', () => {
  /* La plantilla nombra «Operaciones de Ingreso» también como encabezado de la sección y
     en el índice. Solo la que lleva «Tabla 1.» y una tabla detrás es la que se sustituye. */
  const html =
    '<h3><strong> 1. Operaciones de Ingreso</strong></h3>' +
    '<p><strong> Tabla 1. Operaciones de Ingreso</strong></p>' +
    '<table><tr><th><p><strong> Concepto</strong></p></th></tr>' +
    '<tr><th><p> Otros servicios (07)</p></th></tr></table>';
  const salida = actualizarTablasOperacionesHtml(html, ESTUDIO);
  assert.match(salida, /<h3><strong> 1\. Operaciones de Ingreso<\/strong><\/h3>/, 'el encabezado de sección no se toca');
  assert.match(sinEtiquetas(salida), /VENTA SERVICIOS/);
});

test('un estudio sin datos deja huecos visibles y no los datos de la plantilla', () => {
  const texto = sinEtiquetas(actualizarTablasOperacionesHtml(INFORME, {}));
  assert.ok(!texto.includes('END GAME INTERACTIVE INC'), 'sobrevivió el vinculado anterior');
  assert.ok(!texto.includes('3.435.357.400'), 'sobrevivió el monto anterior');
  assert.match(texto, /—/);
});
