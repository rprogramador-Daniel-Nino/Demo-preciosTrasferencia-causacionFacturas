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
