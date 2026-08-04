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
