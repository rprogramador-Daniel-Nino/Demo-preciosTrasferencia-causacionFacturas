import { test } from 'node:test';
import assert from 'node:assert';
import { actualizarTablasOperacionesHtml } from './tablasOperacionesHtml.js';
import { borrarTablaHtml, localizarTablaHtml } from './tablasHtmlInforme.js';

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

test('una plantilla sin estas tablas no se altera en absoluto', () => {
  /* Sin el aviso la tabla se queda con los datos del informe de referencia y nadie se
     entera: es el mismo contrato que `sustituidorDeTablas` de la ruta OOXML. La lista
     completa de nombres la comprueba el test del final. */
  const avisos = [];
  const salida = actualizarTablasOperacionesHtml('<p> Un informe sin esas tablas.</p>', ESTUDIO, avisos);
  assert.ok(avisos.includes('Operaciones de Ingreso'), 'la Tabla 1 tiene que avisarse');
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

/* ── Las cuatro tablas restantes del vinculado y del contribuyente ── */

const ESTUDIO_COMPLETO = {
  ...ESTUDIO, anio: 2025, ent: 'ACME COLOMBIA S.A.S', vinc_id: '444444001',
  accionistas: [{ nombre: 'ACME HOLDINGS LLC', pais: 'ESTADOS UNIDOS', acciones: 1000, valor_capital: 10000, participacion_pct: 100 }],
  t_cash: 500, t_act_tot: 1000,
};

test('la ficha del vinculado se sustituye en TODAS sus ocurrencias', () => {
  /* La plantilla la trae dos veces —rotulada «Tabla 3.» y «Tabla 12.»—, y las dos publican
     la misma ficha. Sustituir solo la primera deja la segunda con el vinculado anterior. */
  const ficha = (n) =>
    '<p><strong> Tabla ' + n + '.Transacciones Inter compañía</strong></p>' +
    '<table><tr><th><p><strong> Compañía vinculada</strong></p></th></tr>' +
    '<tr><th><p><strong> Razón social</strong></p></th><td><p> END GAME INTERACTIVE INC</p></td></tr></table>';
  const html = ficha(3) + '<p> Texto intermedio.</p>' + ficha(12);
  const salida = actualizarTablasOperacionesHtml(html, ESTUDIO_COMPLETO);
  assert.ok(!salida.includes('END GAME INTERACTIVE INC'), 'sobrevivió el vinculado anterior');
  assert.strictEqual((salida.match(/Razón social/g) || []).length, 2, 'las dos fichas siguen ahí');
  assert.strictEqual(
    (salida.match(/ACME INTERACTIVE LLC/g) || []).length, 2,
    'el vinculado del estudio tiene que quedar en las dos fichas'
  );
  assert.match(salida, /<p> Texto intermedio\.<\/p>/, 'el texto entre las dos sobrevive');
});

test('el rótulo con el año se reescribe con el año gravable del estudio', () => {
  /* La plantilla rotula «Activos a 31 de diciembre de 2024». El año es un dato, no
     redacción: dejarlo publica el encabezado del año anterior. El número de la plantilla
     se conserva, porque renumerar descuadra su índice. */
  const html =
    '<p><strong> Tabla 10. Activos a 31 de diciembre de 2024</strong></p>' +
    '<table><tr><th><p><strong> Cifras</strong></p></th><th><p><strong> 2024</strong></p></th>' +
    '<th><p><strong> A.V. 2024</strong></p></th></tr>' +
    '<tr><th><p> Efectivo y equivalentes de efectivo</p></th><td><p> 1</p></td><td><p> 1%</p></td></tr></table>';
  const salida = actualizarTablasOperacionesHtml(html, ESTUDIO_COMPLETO);
  assert.match(salida, /Tabla 10\. Activos a 31 de diciembre de 2025/);
  assert.ok(!salida.includes('de 2024'), 'sobrevivió el año de la plantilla');
});

test('el método aplicable se localiza por su nombre corto y se rotula con el largo', () => {
  const html =
    '<p><strong> Tabla 4.Método de Precios de Transferencia Aplicable</strong></p>' +
    '<table><tr><th><p><strong> Código</strong></p></th><th><p><strong> Descripción</strong></p></th>' +
    '<th><p><strong> Método</strong></p></th><th><p><strong> Indicador</strong></p></th></tr>' +
    '<tr><th><p> 07</p></th><td><p> Otros servicios</p></td><td><p> TU</p></td><td><p> MO</p></td></tr></table>';
  const salida = actualizarTablasOperacionesHtml(html, ESTUDIO_COMPLETO);
  assert.match(salida, /<td><p>VENTA SERVICIOS<\/p><\/td>/);
  assert.ok(!salida.includes('<p> Otros servicios</p>'), 'sobrevivió la descripción anterior');
});

test('la composición accionaria y los criterios de vinculación también se regeneran', () => {
  const html =
    '<p><strong> Tabla 6. Composición accionaria</strong></p>' +
    '<table><tr><th><p><strong> Accionista</strong></p></th><th><p><strong> País</strong></p></th>' +
    '<th><p><strong> Acciones</strong></p></th><th><p><strong> Capital</strong></p></th>' +
    '<th><p><strong> %</strong></p></th></tr>' +
    '<tr><th><p> VIEJO ACCIONISTA</p></th><td><p> JAPÓN</p></td><td><p> 1</p></td><td><p> 1</p></td><td><p> 1%</p></td></tr></table>' +
    '<p><strong> Tabla 9. Criterios de vinculación económica</strong></p>' +
    '<table><tr><th><p><strong> Vinculada</strong></p></th><th><p><strong> País</strong></p></th>' +
    '<th><p><strong> Criterio</strong></p></th><th><p><strong> Detalle</strong></p></th></tr>' +
    '<tr><th><p> END GAME INTERACTIVE INC</p></th><td><p> ESTADOS UNIDOS</p></td><td><p> x</p></td><td><p> y</p></td></tr></table>';
  const salida = actualizarTablasOperacionesHtml(html, ESTUDIO_COMPLETO);
  assert.ok(!salida.includes('VIEJO ACCIONISTA'), 'sobrevivió el accionista de la plantilla');
  assert.match(salida, /ACME HOLDINGS LLC/);
  assert.match(salida, /Vinculación Directa/);
});

test('las tablas ausentes se nombran todas en los avisos', () => {
  const avisos = [];
  actualizarTablasOperacionesHtml('<p> Un informe pelado.</p>', ESTUDIO_COMPLETO, avisos);
  assert.deepStrictEqual(avisos, [
    'Operaciones de Ingreso', 'Operación analizar', 'Transacciones Inter compañía',
    'Método de Precios de Transferencia', 'Composición accionaria',
    'Compañías vinculadas', 'Criterios de vinculación', 'Activos a 31 de diciembre',
  ]);
});

/* ── Tablas que ningún motor sabe regenerar ── */

test('la tabla de competencia se avisa porque publica los competidores del cliente anterior', () => {
  /* Ningún motor la regenera: el estudio no tiene dónde guardar los competidores. Lo que no
     se puede arreglar hay que decirlo — hasta ahora fallaba en silencio, y los competidores
     de END GAME viajaban al informe de cualquier otro cliente. */
  const html =
    '<p><strong> Tabla 7. Competencia nacional e internacional al 31 de diciembre de 2024</strong></p>' +
    '<table><tr><th><p><strong> NACIONALES</strong></p></th><th><p><strong> INTERNACIONALES</strong></p></th></tr>' +
    '<tr><th><p> Teravision</p></th><td><p> Supercell</p></td></tr></table>';
  const avisos = [];
  const salida = actualizarTablasOperacionesHtml(html, ESTUDIO_COMPLETO, avisos);
  assert.strictEqual(salida, html, 'no se puede regenerar, así que no se toca');
  assert.ok(
    avisos.some((a) => a.includes('Competencia nacional e internacional')),
    'tiene que nombrarse en los avisos'
  );
});

test('no se avisa de la tabla de competencia si la plantilla no la trae', () => {
  /* Un aviso falso acusa de incompleta a una plantilla que está bien, y así se enseña a la
     gente a no leer el banner. */
  const avisos = [];
  actualizarTablasOperacionesHtml('<p> Sin esa tabla.</p>', ESTUDIO_COMPLETO, avisos);
  assert.ok(
    !avisos.some((a) => a.includes('Competencia')),
    'no debe avisar de una tabla que la plantilla no tiene'
  );
});

test('la tabla de fuentes de información no se avisa: no arrastra datos del cliente', () => {
  /* Sus entradas son instituciones —FMI, Banco de la República, ANDI, DANE— idénticas en
     todos los informes de la firma. Avisar de ella sería ruido. */
  const html =
    '<p><strong> Tabla 11. Fuentes de Información</strong></p>' +
    '<table><tr><th><p><strong> Fondo Monetario Internacional</strong></p></th></tr>' +
    '<tr><th><p> Banco de la República</p></th></tr></table>';
  const avisos = [];
  actualizarTablasOperacionesHtml(html, ESTUDIO_COMPLETO, avisos);
  assert.ok(!avisos.some((a) => a.includes('Fuentes de Información')), 'no debe avisarse');
});

/* ══════ el año del encabezado de la tabla de activos ══════ */

/* Forma REAL de la Tabla 10 en el HTML extraído del PDF: el encabezado rotula sus dos columnas
   con el año gravable, y la plantilla trae el del informe anterior con separador de miles. */
const TABLA_ACTIVOS =
  '<p><strong> Tabla 10. Activos a 31 de diciembre de 2024</strong></p>' +
  '<table>' +
  '<tr><th><p><strong> Cifras Expresadas en pesos colombianos</strong></p></th>' +
  '<th><p><strong> 2.024</strong></p></th>' +
  '<th><p><strong> A.V. 2024</strong></p></th></tr>' +
  '<tr><th><p> Efectivo y equivalentes de efectivo</p></th>' +
  '<td><p> 87.957.645</p></td><td><p> 4.42%</p></td></tr>' +
  '</table>';

test('el año del encabezado de los activos pasa al del estudio', () => {
  /* La ruta .docx ya lo hacía —`generarTablaOoxml` recibe los `encabezados` del descriptor, que
     los construye con el año—, pero la de PDF reescribía solo las filas de datos y conservaba el
     encabezado tal cual: el informe de 2025 publicaba las cifras nuevas bajo «2.024» y
     «A.V. 2024». Se reportó sobre el documento generado. */
  const salida = actualizarTablasOperacionesHtml(TABLA_ACTIVOS, { ...ESTUDIO_COMPLETO, anio: 2025 }, []);
  const texto = salida.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

  assert.ok(/2\.025/.test(texto), 'la columna del año sigue en 2024: ' + texto);
  assert.ok(/A\.V\. 2025/.test(texto), 'la columna del A.V. sigue en 2024: ' + texto);
  assert.ok(!/2\.024|A\.V\. 2024/.test(texto), 'sobrevive el año de la plantilla: ' + texto);
});

test('se conserva el separador de miles que traía la plantilla', () => {
  /* La plantilla escribe «2.024» con punto. Emitir «2025» en esa celda y «A.V. 2025» en la de al
     lado se lee como un descuido, así que el separador se respeta tal como venía. */
  const salida = actualizarTablasOperacionesHtml(TABLA_ACTIVOS, { ...ESTUDIO_COMPLETO, anio: 2025 }, []);
  const texto = salida.replace(/<[^>]*>/g, ' ');
  assert.ok(texto.includes('2.025'), 'perdió el punto de miles de la columna del año');
  assert.ok(texto.includes('A.V. 2025'), 'el A.V. no lleva el año sin separador, y debía');
});

test('la redacción del encabezado no se toca, solo el año', () => {
  /* «Cifras Expresadas en pesos colombianos» es texto del cliente. Reescribir el encabezado
     entero con el nuestro sería lo contrario de lo que esta ruta existe para conservar. */
  const salida = actualizarTablasOperacionesHtml(TABLA_ACTIVOS, { ...ESTUDIO_COMPLETO, anio: 2025 }, []);
  assert.ok(salida.includes('Cifras Expresadas en pesos colombianos'),
    'se pisó la redacción del cliente');
  /* Y el `<strong>` de la celda sigue ahí: el énfasis de la plantilla es parte del formato. */
  assert.match(salida, /<th><p><strong>[^<]*2\.025<\/strong><\/p><\/th>/,
    'se perdió el markup del encabezado');
});

test('el año de una fila de DATOS no se confunde con el del encabezado', () => {
  /* En las filas de datos las cifras las pone `reescribirFilasHtml`; ahí un número que se parezca
     a un año no es un rótulo. La sustitución se limita a la primera fila. */
  const conAnioEnDatos = TABLA_ACTIVOS.replace(
    '<td><p> 87.957.645</p></td>', '<td><p> 2.024</p></td>');
  const salida = actualizarTablasOperacionesHtml(
    conAnioEnDatos, { ...ESTUDIO_COMPLETO, anio: 2025, t_cash: 2024 }, []);
  /* La fila de datos se reescribió con la cifra del estudio, no con un año sustituido. */
  const filas = salida.split('<tr>');
  assert.ok(filas.length >= 3, 'la tabla perdió filas');
  assert.ok(/2\.025/.test(filas[1]), 'el encabezado no se actualizó');
});

test('las demás tablas no tocan su encabezado', () => {
  /* La bandera va por tabla: la de activos es la única cuyo encabezado lleva un dato. En la
     Tabla 1 los encabezados son conceptos y deben quedarse como los redactó el cliente. */
  const salida = actualizarTablasOperacionesHtml(TABLA_1, { ...ESTUDIO_COMPLETO, anio: 2025 }, []);
  assert.ok(salida.includes('Concepto de Operaciones a analizar'), 'se tocó un encabezado ajeno');
  assert.ok(salida.includes('Monto de la Operación analizar'), 'se tocó un encabezado ajeno');
});

/* ════════ Operación adicional Transacciones Intercompañía (sección 4 del formato) ════════ */

/* La tabla tal como la trae la plantilla, con los datos del informe de referencia. */
const TABLA_ADICIONAL =
  '<p><strong> Tabla 13. Operación adicional Transacciones Intercompañía</strong></p>' +
  '<table>' +
  '<tr><th><p><strong> Compañía vinculada</strong></p></th>' +
  '<th><p><strong> Identificación fiscal</strong></p></th>' +
  '<th><p><strong> País - Residencia fiscal</strong></p></th>' +
  '<th><p><strong> Tipo de operación</strong></p></th>' +
  '<th><p><strong> Monto en pesos</strong></p></th></tr>' +
  '<tr><th><p> END GAME INTERACTIVE INC</p></th><td><p> 444444001</p></td>' +
  '<td><p> ESTADOS UNIDOS</p></td><td><p> Préstamos (61)</p></td>' +
  '<td><p> 9.999.999.999</p></td></tr>' +
  '</table>';

const INFORME_CON_ADICIONAL = INFORME + TABLA_ADICIONAL;

const ADICIONAL = {
  filas: [
    { vinculado: 'MONTACHEM INTERNATIONAL INC', nit: '760575817', pais: 'EEUU',
      tipo: 'Préstamos con vinculados (61)', monto: 1800000000 },
    { vinculado: 'MONTACHEM INTERNATIONAL INC', nit: '760575817', pais: 'EEUU',
      tipo: 'Reintegros o reembolsos (62)', monto: 900000000 },
  ],
  monto: 2700000000,
};

test('la operación adicional que supera el umbral se publica en su tabla', () => {
  const texto = sinEtiquetas(actualizarTablasOperacionesHtml(
    INFORME_CON_ADICIONAL, { ...ESTUDIO, operacionAdicional: ADICIONAL }));

  assert.match(texto, /MONTACHEM INTERNATIONAL INC/);
  assert.match(texto, /1\.800\.000\.000/);
  assert.match(texto, /900\.000\.000/);
  assert.ok(!texto.includes('9.999.999.999'),
    'sobrevive el monto del informe de referencia: ' + texto);
});

test('sin superar el umbral, la tabla de la plantilla se elimina en vez de quedarse como estaba', () => {
  /* Antes de esta tarea, si el formato no traía la sección o no superaba el valor, el
     informe salía exactamente como salía antes de que esto existiera: la tabla de la
     plantilla —el informe del año anterior— se quedaba con SUS datos. Esa afirmación es la
     que esta tarea corrige: la plantilla es el informe de otro año y dejarla quieta la
     publica como si fuera de este contribuyente. El umbral de 2025 son los 45.000 UVT
     (2.240.955.000): este monto queda justo debajo. */
  const casi = { filas: ADICIONAL.filas, monto: 2200000000 };
  const salida = actualizarTablasOperacionesHtml(
    INFORME_CON_ADICIONAL, { ...ESTUDIO, anio: 2025, operacionAdicional: casi });
  assert.ok(!salida.includes('9.999.999.999'), 'sobrevivió el monto que no correspondía');
  assert.ok(!salida.includes('Operación adicional'), 'sobrevivió el rótulo de la tabla');
  assert.ok(!salida.includes('MONTACHEM'), 'se publicó una operación que no supera el umbral');
});

test('sin sección de información adicional, la tabla también se elimina', () => {
  /* Antes de esta tarea la tabla tampoco se tocaba. Corregido por el mismo motivo que el
     caso de arriba: sin sección 4 en el formato, la plantilla no tiene nada propio que
     publicar y su tabla es la del informe anterior. */
  const salida = actualizarTablasOperacionesHtml(INFORME_CON_ADICIONAL, ESTUDIO);
  assert.ok(!salida.includes('9.999.999.999'), 'sobrevivió la tabla sin tener datos');
  assert.ok(!salida.includes('Operación adicional'), 'sobrevivió el rótulo de la tabla');
});

test('justo en el umbral no se publica: tiene que superarlo', () => {
  /* Exactamente en el umbral de 45.000 UVT de 2025: la norma habla de operaciones que lo
     SUPEREN, así que este monto no se declara — y, corregido en esta tarea, la tabla de la
     plantilla se elimina en vez de quedarse con las cifras del informe anterior. */
  const justo = { filas: ADICIONAL.filas, monto: 2240955000 };
  const salida = actualizarTablasOperacionesHtml(
    INFORME_CON_ADICIONAL, { ...ESTUDIO, anio: 2025, operacionAdicional: justo });
  assert.ok(!salida.includes('9.999.999.999'), 'se publicó estando justo en el umbral');
});

test('la operación adicional no se confunde con la Tabla 3 de transacciones', () => {
  /* Las dos tablas se llaman parecido y la de transacciones se sustituye por ocurrencia. Si
     el localizador las confundiera, la ficha del vinculado acabaría en la tabla de la
     operación adicional o al revés, y las dos declaran cosas distintas ante la DIAN. */
  const TABLA_3 =
    '<p><strong> Tabla 3. Transacciones Inter compañía</strong></p>' +
    '<table><tr><th><p><strong> Compañía vinculada</strong></p></th><th><p></p></th></tr>' +
    '<tr><th><p> Razón social</p></th><td><p> END GAME INTERACTIVE INC</p></td></tr>' +
    '</table>';
  const salida = actualizarTablasOperacionesHtml(
    INFORME + TABLA_3 + TABLA_ADICIONAL, { ...ESTUDIO, operacionAdicional: ADICIONAL });

  const iTx = salida.indexOf('Transacciones Inter compañía');
  const iAd = salida.indexOf('Operación adicional');
  assert.ok(iTx > -1 && iAd > iTx, 'se perdió alguno de los dos rótulos');
  /* La ficha del vinculado publica el vinculado del estudio; la adicional, sus operaciones. */
  assert.match(salida.slice(iTx, iAd), /ACME INTERACTIVE LLC/);
  assert.match(salida.slice(iAd), /1\.800\.000\.000/);
});

test('si la plantilla trae la tabla en ficha vertical, se respeta su forma', () => {
  const FICHA =
    '<p><strong> Tabla 13. Operación adicional Transacciones Intercompañía</strong></p>' +
    '<table><tr><th><p><strong> Compañía vinculada</strong></p></th><th><p></p></th></tr>' +
    '<tr><th><p> Razón social</p></th><td><p> END GAME INTERACTIVE INC</p></td></tr>' +
    '</table>';
  const salida = actualizarTablasOperacionesHtml(
    INFORME + FICHA, { ...ESTUDIO, operacionAdicional: ADICIONAL });
  const texto = sinEtiquetas(salida);

  assert.match(texto, /Razón social MONTACHEM INTERNATIONAL INC/);
  /* En ficha se publica el TOTAL, porque una fila de etiqueta y valor no admite dos montos. */
  assert.match(texto, /2\.700\.000\.000/);
});

test('si el formato trae la operación pero la plantilla no tiene la tabla, se avisa', () => {
  const avisos = [];
  actualizarTablasOperacionesHtml(INFORME, { ...ESTUDIO, operacionAdicional: ADICIONAL }, avisos);
  assert.ok(avisos.some((a) => /Operación adicional/.test(a)),
    'no avisó de la tabla ausente: ' + JSON.stringify(avisos));
});

test('sin datos que publicar no se avisa de la tabla ausente', () => {
  /* Un aviso por una tabla que no existe y que además no tocaría acusa de incompleta a una
     plantilla que está bien. */
  const avisos = [];
  actualizarTablasOperacionesHtml(INFORME, ESTUDIO, avisos);
  assert.ok(!avisos.some((a) => /Operación adicional/.test(a)),
    'avisó de una tabla que no hacía falta: ' + JSON.stringify(avisos));
});

/* ════════ Multiempresa: el rótulo de la tabla adicional cambia con cada firma ════════ */

const tablaAdicionalConRotulo = (rotulo) =>
  '<p><strong> ' + rotulo + '</strong></p>' +
  '<table>' +
  '<tr><th><p><strong> Compañía vinculada</strong></p></th>' +
  '<th><p><strong> Identificación fiscal</strong></p></th>' +
  '<th><p><strong> País</strong></p></th>' +
  '<th><p><strong> Tipo de operación</strong></p></th>' +
  '<th><p><strong> Monto en pesos</strong></p></th></tr>' +
  '<tr><th><p> END GAME INTERACTIVE INC</p></th><td><p> 444444001</p></td>' +
  '<td><p> ESTADOS UNIDOS</p></td><td><p> Préstamos (61)</p></td>' +
  '<td><p> 9.999.999.999</p></td></tr>' +
  '</table>';

const ROTULOS_ADICIONAL = [
  'Tabla 13. Operación adicional Transacciones Intercompañía',
  'Tabla 20. Operación adicional Transacciones Inter compañía',
  'Tabla 5. Operaciones adicionales Transacciones Intercompañía',
  'Tabla 9. Información adicional Transacciones Intercompañía',
  'Tabla 4. Operación adicional',
];

for (const rotulo of ROTULOS_ADICIONAL) {
  test('la tabla adicional se encuentra rotulada «' + rotulo + '»', () => {
    /* El número del rótulo se ignora a propósito: se renumera al reordenar el informe y hay
       plantillas que no lo traen. Lo que se busca es el nombre. */
    const salida = actualizarTablasOperacionesHtml(
      tablaAdicionalConRotulo(rotulo), { ...ESTUDIO, operacionAdicional: ADICIONAL }, []);
    assert.ok(salida.includes('MONTACHEM INTERNATIONAL INC'),
      'no se encontró la tabla con ese rótulo: ' + salida);
    assert.ok(!salida.includes('9.999.999.999'), 'sobrevive la cifra del informe anterior');
  });
}

test('la ficha del vinculado no se escribe sobre la tabla de operación adicional', () => {
  /* «Operación adicional Transacciones Inter compañía» CONTIENE «Transacciones Inter
     compañía», y el localizador casa por inclusión: sin el veto, la Tabla 3 reclamaría las
     dos y la ficha del vinculado acabaría encima de la otra. Las dos declaran cosas distintas
     ante la DIAN, así que confundirlas no se nota al revisar pero es un dato falso. */
  const TABLA_3 =
    '<p><strong> Tabla 3. Transacciones Inter compañía</strong></p>' +
    '<table><tr><th><p><strong> Compañía vinculada</strong></p></th><th><p></p></th></tr>' +
    '<tr><th><p> Razón social</p></th><td><p> END GAME INTERACTIVE INC</p></td></tr>' +
    '</table>';
  const juntas = TABLA_3
    + tablaAdicionalConRotulo('Tabla 20. Operación adicional Transacciones Inter compañía');
  const salida = actualizarTablasOperacionesHtml(
    juntas, { ...ESTUDIO, operacionAdicional: ADICIONAL }, []);

  const iTx = salida.indexOf('Transacciones Inter compañía');
  const iAd = salida.indexOf('Operación adicional');
  assert.ok(iTx > -1 && iAd > iTx, 'se perdió alguno de los dos rótulos');
  assert.match(salida.slice(iTx, iAd), /ACME INTERACTIVE LLC/,
    'la ficha del vinculado no se rellenó');
  assert.match(salida.slice(iAd), /MONTACHEM INTERNATIONAL INC/,
    'la tabla adicional se quedó sin sus datos');
});

/* ── La tabla de operación adicional se va cuando no hay nada que declarar ──── */

/* Plantilla = informe del año anterior, con SU tabla de operación adicional llena. Es el
   caso que importa: mientras el borrado no existía, estas dos cifras viajaban al informe
   de cualquier cliente. */
const PLANTILLA_CON_ADICIONAL =
  '<p> Prosa anterior a la tabla.</p>' +
  '<p><strong> Tabla 4. Operación adicional Transacciones Intercompañía</strong></p>' +
  '<table>' +
  '<tr><th><p><strong> Compañía vinculada</strong></p></th>' +
  '<th><p><strong> Monto en pesos</strong></p></th></tr>' +
  '<tr><td><p> CLIENTE ANTERIOR S.A.</p></td><td><p> 9.999.999.999</p></td></tr>' +
  '</table>' +
  '<p><strong>FUENTE: Información de CLIENTE ANTERIOR S.A.</strong></p>' +
  '<p> Prosa posterior a la tabla.</p>';

test('sin sección 4 en el formato, la tabla de la plantilla se elimina', () => {
  const avisos = [];
  const salida = actualizarTablasOperacionesHtml(PLANTILLA_CON_ADICIONAL, { anio: 2025, ent: 'ACME' }, avisos);

  assert.ok(!salida.includes('CLIENTE ANTERIOR'), 'sobrevivió el vinculado del informe anterior');
  assert.ok(!salida.includes('9.999.999.999'), 'sobrevivió el monto del informe anterior');
  assert.ok(!salida.includes('Operación adicional'), 'sobrevivió el rótulo');
  assert.ok(!salida.includes('FUENTE: Información de CLIENTE ANTERIOR'), 'quedó la fuente huérfana');
  /* Y lo de alrededor intacto: se borra la tabla, no el informe. */
  assert.match(salida, /Prosa anterior a la tabla/);
  assert.match(salida, /Prosa posterior a la tabla/);
  assert.ok(!avisos.some((a) => a.toLowerCase().includes('adicional')),
    'un borrado deliberado no es «no se encontró en la plantilla»');
});

test('con sección 4 por debajo del umbral, la tabla también se elimina', () => {
  const estudio = {
    anio: 2025, ent: 'ACME',
    operacionAdicional: {
      monto: 500000000,
      filas: [{ vinculado: 'BETA GMBH', nit: '900222', pais: 'ALEMANIA',
        tipo: 'Préstamos con vinculados (61)', monto: 500000000 }],
    },
  };
  const salida = actualizarTablasOperacionesHtml(PLANTILLA_CON_ADICIONAL, estudio, []);

  assert.ok(!salida.includes('CLIENTE ANTERIOR'));
  assert.ok(!salida.includes('Operación adicional'));
  /* Y tampoco se cuela la operación que no llegó al umbral. */
  assert.ok(!salida.includes('BETA GMBH'), 'se publicó una operación que no supera el umbral');
});

test('sobre el umbral la tabla se publica, no se borra', () => {
  /* La regresión que este cambio podría causar: borrar de más. */
  const estudio = {
    anio: 2025, ent: 'ACME',
    operacionAdicional: {
      monto: 14516485850,
      filas: [{ vinculado: 'MONTACHEM INTERNATIONAL INC', nit: '760575817', pais: 'EEUU',
        tipo: 'Reintegros o reembolsos de gastos con vinculados (62)', monto: 14516485850 }],
    },
  };
  const salida = actualizarTablasOperacionesHtml(PLANTILLA_CON_ADICIONAL, estudio, []);

  assert.match(salida, /Operación adicional/, 'se borró una tabla que sí había que publicar');
  assert.match(salida, /MONTACHEM INTERNATIONAL INC/);
  /* El monto es el dato que esta prueba vigila: la línea FUENTE que sigue a la tabla no la
     toca esta ruta al publicar (comportamiento previo a esta tarea, fuera de su alcance:
     el `if` de `tieneOperacionAdicional` no se modifica), así que no se comprueba «CLIENTE
     ANTERIOR» contra el documento completo. */
  assert.ok(!salida.includes('9.999.999.999'), 'sobrevivió el monto del informe anterior');
});

test('plantilla sin la tabla y sin nada que declarar: no se toca ni se avisa', () => {
  const avisos = [];
  const sinTabla = '<p> Un informe sin tabla de operación adicional.</p>';
  const salida = actualizarTablasOperacionesHtml(sinTabla, { anio: 2025, ent: 'ACME' }, avisos);

  assert.strictEqual(salida, sinTabla, 'no había nada que borrar');
  assert.ok(!avisos.some((a) => a.toLowerCase().includes('adicional')));
});

test('borrarTablaHtml no se lleva un párrafo que no sea la fuente', () => {
  const html =
    '<p><strong> Tabla 4. Operación adicional Transacciones Intercompañía</strong></p>' +
    '<table><tr><th><p> BORRAR</p></th></tr></table>' +
    '<p> Las anteriores operaciones fueron realizadas con intercompañías.</p>';

  const bloque = localizarTablaHtml(html, 'Operación adicional Transacciones Intercompañía');
  const salida = borrarTablaHtml(html, bloque);

  assert.ok(!salida.includes('BORRAR'));
  assert.match(salida, /Las anteriores operaciones/, 'se llevó prosa del informe');
});
