import { test } from 'node:test';
import assert from 'node:assert';
import XLSX from 'xlsx-js-style';
import { parseExcelOperations } from './excelOperationsParser.js';

function workbookToFakeFile(wb) {
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { arrayBuffer: async () => buffer };
}

function workbookConHoja(nombreHoja, filas) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(filas);
  XLSX.utils.book_append_sheet(wb, ws, nombreHoja);
  return wb;
}

test('un Excel sin las hojas de operaciones esperadas no inventa los datos de End Game Interactive', async () => {
  // Hoja irrelevante: ninguna de las 4 hojas que sheetsToScan busca existe.
  const filas = [];
  for (let i = 0; i < 12; i++) filas.push(['nada aquí', '', '']);
  const wb = workbookConHoja('Hoja1', filas);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.notStrictEqual(res.vinc, 'END GAME INTERACTIVE INC', 'no debe inventar el nombre del vinculado de End Game');
  assert.notStrictEqual(res.vinc_id, '604477955', 'no debe inventar el NIT de End Game');
  assert.notStrictEqual(res.pais_vinc, 'ESTADOS UNIDOS', 'no debe inventar el país de End Game');
  assert.notStrictEqual(res.t_s, 3435357400, 'no debe inventar el monto de End Game');
});

test('con la hoja "Op. Vinculados Economicos" y datos reales, sí extrae el vinculado real', async () => {
  const filas = [];
  // Filas de relleno no vacías: aoa_to_sheet() descarta filas []  al inicio,
  // así que se necesita al menos una celda para que sheet_to_json conserve
  // la posición real de la fila de encabezados (fila 10, como en el archivo real).
  for (let i = 0; i < 9; i++) filas.push(['(portada)']);
  filas.push(['Vinculado', 'Identificación', 'País', 'Tipo de Operación', 'Monto']);
  filas.push(['ACME COLOMBIA S.A.S', '900123456', 'MEXICO', 'Compra de inventarios (01)', 50000000]);
  filas.push(['tipos de operacion catalogo']);
  const wb = workbookConHoja('Op. Vinculados Economicos', filas);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.vinc, 'ACME COLOMBIA S.A.S');
  assert.strictEqual(res.vinc_id, '900123456');
  assert.strictEqual(res.pais_vinc, 'MEXICO');
  assert.strictEqual(res.t_s, 50000000);
});

test('título de hoja con "Vinculados" y columna de NIT con "país" no desvían la lectura de la fila de encabezados real', async () => {
  const filas = [];
  filas.push(['Operaciones con Vinculados']); // título de la hoja: contiene 'vinculado' pero no es el encabezado
  for (let i = 0; i < 8; i++) filas.push(['(portada)']);
  filas.push([
    'Vinculado (razón social)',
    'Número de Identificación fiscal del país de origen', // contiene 'país', pero es la columna de NIT
    'País de origen',
    'Tipo de operación',
    'Monto operación'
  ]);
  filas.push(['ACME COLOMBIA S.A.S', '900123456', 'MEXICO', 'Compra de inventarios (01)', 50000000]);
  filas.push(['* Ver lista de tipo de operaciones según DIAN', '', '', '', 50000000]); // nota al pie, no es una fila de datos
  const wb = workbookConHoja('Op. Vinculados Economicos', filas);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.vinc, 'ACME COLOMBIA S.A.S');
  assert.strictEqual(res.pais_vinc, 'MEXICO', 'no debe leer el NIT como si fuera el país');
  assert.strictEqual(res.t_s, 50000000, 'no debe duplicar el monto con la nota al pie');
});

/* Encabezado completo del formato real, con la columna 'Cod' entre el tipo de operación
   y el formato de medios magnéticos. */
const ENCABEZADO = [
  'Vinculado (razón social)',
  'Número de Identificación fiscal del país de origen',
  'País de origen',
  'Ciudad',
  'Tipo de operación*',
  'Cod',
  '',
  'Formato',
  'Concepto',
  '',
  'Monto operación',
];

const conEncabezado = (filasDeDatos) => {
  const filas = [];
  for (let i = 0; i < 9; i++) filas.push(['(portada)']);
  filas.push(ENCABEZADO);
  filasDeDatos.forEach((f) => filas.push(f));
  return workbookConHoja('Op. Vinculados Economicos', filas);
};

/** Como `conEncabezado`, pero con el nombre de hoja a elección (para probar variantes). */
const conEncabezadoEnHoja = (nombreHoja, filasDeDatos) => {
  const filas = [];
  for (let i = 0; i < 9; i++) filas.push(['(portada)']);
  filas.push(ENCABEZADO);
  filasDeDatos.forEach((f) => filas.push(f));
  return workbookConHoja(nombreHoja, filas);
};

test('una hoja titulada distinto al literal de referencia igual se reconoce por palabra clave', async () => {
  /* Caso real de un cliente (Symtek): su hoja se llama "OPERACIONES CON VINCULADOS", no
     "Op. Vinculados Economicos". El contenido es el mismo formato DIAN, pero exigir el
     nombre exacto dejaba la hoja entera sin leer y el usuario veía "no se encontraron
     las hojas esperadas" con datos reales delante. */
  const wb = conEncabezadoEnHoja('OPERACIONES CON VINCULADOS', [
    ['TRINIDAD CEMENT LIMITED', '193174', 'Trinidad y Tobago', 'Puerto España', 'venta de bienes', '', '', '1007', '4001', '', 380899599],
  ]);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.vinc, 'TRINIDAD CEMENT LIMITED');
  assert.strictEqual(res.monto, 380899599);
});

test('una hoja de préstamos truncada a 31 caracteres ("...CON VINC") también se reconoce', async () => {
  /* El límite de 31 caracteres de Excel trunca "Operaciones Prestamos Con Vinculados" hasta
     dejar solo "VINC" del final, sin llegar a "VINCULADOS". */
  const wb = conEncabezadoEnHoja('OPERACIONES PRESTAMOS CON VINC', [
    ['ACME PRESTAMOS SAS', '900123456', 'MEXICO', '', 'INTERESES', '', '', '1007', '4001', '', 700000],
  ]);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.vinc, 'ACME PRESTAMOS SAS');
  assert.strictEqual(res.monto, 700000);
});

test('una hoja sin "vinc" ni "paraiso" en el nombre se ignora, como antes', async () => {
  const wb = conEncabezadoEnHoja('SEGMENTACION OPERACIONES', [
    ['NO DEBERIA LEERSE', '900999999', 'MEXICO', '', 'VENTA', '', '', '1007', '4001', '', 999],
  ]);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.vinc, null);
  assert.strictEqual(res.monto, null);
});

test('la columna Cod vacía en toda la hoja no descarta las operaciones', async () => {
  /* «Cod» es opcional en el formato: quien escribe el tipo de operación en texto la deja
     en blanco. Exigirla siempre descartaba la hoja entera de ese contribuyente y el monto
     salía vacío sin ninguna señal de por qué. */
  const wb = conEncabezado([
    ['VA SCALER INC', 'EIN 92-0518182', 'Estados unidos', 'Miami', 'Prestacion de servicio call center', '', '', '1007', '4001', '', 11393484600],
    ['OVADIA LAW GROUP', '454300253', 'Estados unidos', 'Miami', '', '', '', '1007', '4001', '', 967618000],
  ]);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.rows.length, 2, 'sin Cod en ninguna fila, ninguna debe descartarse');
  assert.strictEqual(res.monto, 12361102600);
  assert.strictEqual(res.vinc, 'VA SCALER INC');
  assert.strictEqual(res.vinc_tipo, 'Prestacion de servicio call center');
});

test('con la columna Cod en uso se siguen descartando los renglones auxiliares', async () => {
  /* El comportamiento que motivó el filtro: en el archivo de referencia la operación real
     lleva código y el renglón del concepto 4002 —retención, IVA— no. Mientras la columna
     esté diligenciada en alguna fila, sigue mandando. */
  const wb = conEncabezado([
    ['END GAME INTERACTIVE INC', '444444001', '249', 'BELLEVUE', 'VENTA SERVICIOS', '7', '', '1007', '4001', '', 3432402110],
    ['END GAME INTERACTIVE INC', '444444001', '249', '', '', '', '', '1007', '4002', '', 1140574],
  ]);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.rows.length, 1, 'el renglón sin código es auxiliar y no debe sumarse');
  assert.strictEqual(res.monto, 3432402110);
});

test('el filtro por Cod se decide por hoja, no por el archivo entero', async () => {
  /* Una hoja con la columna diligenciada no puede imponer su criterio a otra que la
     dejó en blanco: son formatos distintos rellenados por la misma persona. */
  const wb = XLSX.utils.book_new();
  const conCod = [];
  for (let i = 0; i < 9; i++) conCod.push(['(portada)']);
  conCod.push(ENCABEZADO);
  conCod.push(['CON CODIGO LTDA', '111', 'MEXICO', '', 'VENTA', '7', '', '1007', '4001', '', 1000]);
  conCod.push(['AUXILIAR LTDA', '111', 'MEXICO', '', '', '', '', '1007', '4002', '', 500]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(conCod), 'Op. Vinculados Economicos');

  const sinCod = [];
  for (let i = 0; i < 9; i++) sinCod.push(['(portada)']);
  sinCod.push(ENCABEZADO);
  sinCod.push(['SIN CODIGO SAS', '222', 'PANAMA', '', 'PRESTAMO', '', '', '1007', '4001', '', 2000]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sinCod), 'Op. Prestamos Vinculados Econom');

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.rows.length, 2, 'la de la hoja con Cod y la de la hoja sin Cod');
  assert.strictEqual(res.monto, 3000, '1000 de la primera hoja + 2000 de la segunda');
  assert.ok(!res.rows.some(r => r.vinculado === 'AUXILIAR LTDA'), 'el auxiliar de la hoja con Cod se descarta igual');
});

test('las operaciones de egreso siguen sin sumarse aunque no haya Cod', async () => {
  const filas = [];
  for (let i = 0; i < 9; i++) filas.push(['(portada)']);
  filas.push(ENCABEZADO);
  filas.push(['INGRESO SAS', '111', 'MEXICO', '', 'VENTA', '', '', '1007', '4001', '', 1000]);
  filas.push(['2.', 'OPERACIONES DE EGRESO']);
  filas.push(['EGRESO SAS', '222', 'PANAMA', '', 'COMPRA', '', '', '1007', '4001', '', 9999]);
  const wb = workbookConHoja('Op. Vinculados Economicos', filas);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.monto, 1000, 'el egreso pertenece a otro formato y no va en el monto');
  assert.ok(!res.rows.some(r => r.vinculado === 'EGRESO SAS'));
});

test('se cuentan las contrapartes distintas, para poder avisar de que el estudio guarda una', async () => {
  /* El estudio tiene un campo para el vinculado, no una lista: con varias contrapartes el
     informe atribuye a la primera un monto que es la suma de todas. */
  const wb = conEncabezado([
    ['VA SCALER INC', '920518182', 'Estados unidos', '', 'SERVICIOS', '', '', '1007', '4001', '', 100],
    ['OVADIA LAW GROUP', '454300253', 'Estados unidos', '', '', '', '', '1007', '4001', '', 200],
    ['ABRAHAM SALOMON OVADIA', '533545104', 'Estados unidos', '', '', '', '', '1007', '4001', '', 300],
  ]);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.contrapartes, 3);
  assert.strictEqual(res.monto, 600, 'el monto es la suma de las tres');
  assert.strictEqual(res.vinc, 'VA SCALER INC', 'y el estudio se queda con la primera');
});

test('una sola contraparte repetida en varias filas no dispara el aviso', async () => {
  const wb = conEncabezado([
    ['END GAME INTERACTIVE INC', '444444001', '249', '', 'VENTA', '', '', '1007', '4001', '', 100],
    ['END GAME INTERACTIVE INC', '444444001', '249', '', '', '', '', '1007', '4001', '', 200],
  ]);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.contrapartes, 1, 'mismo NIT en las dos filas');
});

test('la misma razón social con identificaciones distintas se detecta cruzando ingresos y egresos', async () => {
  /* Caso real del archivo del cliente: END GAME INTERACTIVE INC va con 444444001 en la
     sección de ingresos y con 444444031 en la de egresos. El estudio guarda un solo
     `vinc_id`, así que sin este aviso el informe se radica con un Tax ID que no coincide
     con el resto del archivo. */
  const filas = [];
  for (let i = 0; i < 9; i++) filas.push(['(portada)']);
  filas.push(ENCABEZADO);
  filas.push(['END GAME INTERACTIVE INC', '444444001', '249', 'BELLEVUE', 'VENTA SERVICIOS', '7', '', '1007', '4001', '', 3432402110]);
  filas.push(['END GAME INTERACTIVE INC', '444444001', '249', '', '', '', '', '1007', '4002', '', 1140574]);
  filas.push(['2.', 'OPERACIONES DE EGRESO']);
  filas.push(ENCABEZADO); // la sección de egreso repite su propia fila de encabezados
  filas.push(['END GAME INTERACTIVE INC', '444444031', '249', '', '', '', '', '1001', '5088', '', 26484324]);
  const wb = workbookConHoja('Op. Vinculados Economicos', filas);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.idsDivergentes.length, 1);
  assert.strictEqual(res.idsDivergentes[0].vinculado, 'END GAME INTERACTIVE INC');
  assert.deepStrictEqual(res.idsDivergentes[0].ids, ['444444001', '444444031']);
  assert.strictEqual(res.monto, 3432402110, 'el aviso no cambia lo que se suma');
});

test('la razón social escrita con distinta caja o espacios se agrupa igual', async () => {
  const wb = conEncabezado([
    ['End Game  Interactive Inc', '444444001', '249', '', 'VENTA', '', '', '1007', '4001', '', 100],
    ['END GAME INTERACTIVE INC', '444444031', '249', '', '', '', '', '1007', '4001', '', 200],
  ]);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.idsDivergentes.length, 1, 'es el mismo vinculado escrito de dos formas');
  assert.deepStrictEqual(res.idsDivergentes[0].ids, ['444444001', '444444031']);
});

test('los egresos descartados se cuentan y se totalizan', async () => {
  const filas = [];
  for (let i = 0; i < 9; i++) filas.push(['(portada)']);
  filas.push(ENCABEZADO);
  filas.push(['INGRESO SAS', '111', 'MEXICO', '', 'VENTA', '', '', '1007', '4001', '', 1000]);
  filas.push(['2.', 'OPERACIONES DE EGRESO']);
  filas.push(['EGRESO UNO SAS', '222', 'PANAMA', '', 'COMPRA', '', '', '1001', '5088', '', 9999]);
  filas.push(['EGRESO DOS SAS', '333', 'PANAMA', '', 'COMPRA', '', '', '1001', '5088', '', 1]);
  const wb = workbookConHoja('Op. Vinculados Economicos', filas);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.monto, 1000, 'los egresos siguen sin sumarse');
  assert.deepStrictEqual(res.egresosDescartados, { filas: 2, monto: 10000 });
});

test('la sección "3. OTRAS OPERACIONES" no se cuenta como egreso', async () => {
  /* Arrastraba el 'EGRESO' de la sección anterior e inflaría el aviso con filas que no
     son egresos. */
  const filas = [];
  for (let i = 0; i < 9; i++) filas.push(['(portada)']);
  filas.push(ENCABEZADO);
  filas.push(['INGRESO SAS', '111', 'MEXICO', '', 'VENTA', '', '', '1007', '4001', '', 1000]);
  filas.push(['2.', 'OPERACIONES DE EGRESO']);
  filas.push(['EGRESO SAS', '222', 'PANAMA', '', 'COMPRA', '', '', '1001', '5088', '', 500]);
  filas.push(['3.', 'OTRAS OPERACIONES']);
  filas.push(['OTRA COSA SAS', '333', 'PANAMA', '', 'CUENTA POR COBRAR', '', '', '', '', '', 777]);
  const wb = workbookConHoja('Op. Vinculados Economicos', filas);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.deepStrictEqual(res.egresosDescartados, { filas: 1, monto: 500 });
});

test('un archivo limpio no emite ninguna advertencia', async () => {
  const wb = conEncabezado([
    ['ACME MEXICO SA DE CV', '900123456', '484', '', 'VENTA', '', '', '1007', '4001', '', 1000],
    ['ACME MEXICO SA DE CV', '900123456', '484', '', '', '', '', '1007', '4001', '', 500],
  ]);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.contrapartes, 1);
  assert.deepStrictEqual(res.idsDivergentes, []);
  assert.deepStrictEqual(res.egresosDescartados, { filas: 0, monto: 0 });
  assert.strictEqual(res.monto, 1500);
});

test('el país en código numérico se traduce con la tabla del sistema', async () => {
  /* Antes solo se reconocía el 249 del archivo de referencia y cualquier otro
     contribuyente veía el número crudo en su informe. */
  const wb = conEncabezado([
    ['ACME MEXICO SA DE CV', '111', '484', '', 'VENTA', '', '', '1007', '4001', '', 1000],
  ]);
  const res = await parseExcelOperations(workbookToFakeFile(wb));
  assert.strictEqual(res.pais_vinc, 'MEXICO');
});

test('el 249 del formato de operaciones sigue leyéndose como Estados Unidos', async () => {
  const wb = conEncabezado([
    ['END GAME INTERACTIVE INC', '444444001', '249', '', 'VENTA', '', '', '1007', '4001', '', 1000],
  ]);
  const res = await parseExcelOperations(workbookToFakeFile(wb));
  assert.strictEqual(res.pais_vinc, 'ESTADOS UNIDOS');
});

test('el país escrito con letras se respeta tal cual', async () => {
  const wb = conEncabezado([
    ['VA SCALER INC', '111', 'Estados unidos', '', 'SERVICIOS', '', '', '1007', '4001', '', 1000],
  ]);
  const res = await parseExcelOperations(workbookToFakeFile(wb));
  assert.strictEqual(res.pais_vinc, 'Estados unidos');
});

test('un código de país desconocido no se inventa', async () => {
  /* Ver el número crudo delata que falta traducirlo; un país plausible y equivocado, no. */
  const wb = conEncabezado([
    ['RARA LTD', '111', '999', '', 'VENTA', '', '', '1007', '4001', '', 1000],
  ]);
  const res = await parseExcelOperations(workbookToFakeFile(wb));
  assert.strictEqual(res.pais_vinc, '999');
});

test('el tipo de operación en texto libre no se completa con un código inventado', async () => {
  /* El Excel de referencia de 2025 trae «VENTA SERVICIOS» con la columna «Cod» vacía. El
     parser devolvía «Otros servicios (07)» por defecto —el concepto de END GAME 2024— y ese
     código viajaba al informe de cualquier contribuyente que dejara la columna en blanco. */
  const wb = conEncabezado([
    ['END GAME INTERACTIVE INC', '444444001', '249', 'BELLEVUE', 'VENTA SERVICIOS', '', '', '1007', '4001', '', 3432402110],
  ]);
  const res = await parseExcelOperations(workbookToFakeFile(wb));
  assert.strictEqual(res.vinc_tipo, 'VENTA SERVICIOS');
});

test('la columna Cod diligenciada compone el tipo con su código a dos dígitos', async () => {
  /* Así el concepto queda como lo escribe el informe —«Otros servicios (07)»— sin añadir
     ningún campo nuevo al estudio: `conceptoDeOperacion` ya sabe leer el paréntesis. */
  const wb = conEncabezado([
    ['ACME LLC', '900123456', '249', 'MIAMI', 'Otros servicios', '7', '', '1007', '4001', '', 1000],
  ]);
  const res = await parseExcelOperations(workbookToFakeFile(wb));
  assert.strictEqual(res.vinc_tipo, 'Otros servicios (07)');
});

test('sin tipo de operación en ninguna fila el concepto queda vacío y no por defecto', async () => {
  /* Un hueco visible en la Tabla 1 se corrige; un «Otros servicios (07)» plausible y
     equivocado se radica. */
  const wb = conEncabezado([
    ['ACME LLC', '900123456', '249', 'MIAMI', '', '', '', '1007', '4001', '', 1000],
  ]);
  const res = await parseExcelOperations(workbookToFakeFile(wb));
  assert.strictEqual(res.vinc_tipo, null);
});

test('si el archivo tiene solo operaciones de egreso, se ingieren como primarias y se marca egreso true', async () => {
  const filas = [];
  for (let i = 0; i < 9; i++) filas.push(['(portada)']);
  filas.push(ENCABEZADO);
  filas.push(['2.', 'OPERACIONES DE EGRESO']);
  filas.push(['EGRESO SAS', '222', 'PANAMA', '', 'COMPRA', '31', '', '1001', '5088', '', 9999]);
  const wb = workbookConHoja('Op. Vinculados Economicos', filas);

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.egreso, true, 'se reconoce que el archivo es de egreso');
  assert.strictEqual(res.monto, 9999, 'el egreso se sumó al no haber ingresos');
  assert.strictEqual(res.vinc, 'EGRESO SAS');
  assert.strictEqual(res.vinc_tipo, 'COMPRA (31)');
  assert.deepStrictEqual(res.egresosDescartados, { filas: 0, monto: 0 }, 'los egresos no se descartan');
});
