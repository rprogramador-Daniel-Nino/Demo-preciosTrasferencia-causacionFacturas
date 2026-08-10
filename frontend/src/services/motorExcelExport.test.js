/* Tests del libro de soporte del Motor de Comparables.

   Este módulo es solo un adaptador —traduce el payload que arma MotorComparables al
   estudio que espera `hojasMemoriaRangoOptimo`— y precisamente por eso no tenía
   tests: parecía que no había nada que probar. Ahí se coló que la tasa llegara
   dividida entre 100 dos veces, con lo que el libro salía con un Prime Rate de
   0,0737 % y ningún comparable recibía ajuste. Estos tests cubren el trayecto
   completo, del payload a la celda. */

import { test } from 'node:test';
import assert from 'node:assert';
import XLSX from 'xlsx-js-style';
import { construirLibroSoporte } from './motorExcelExport.js';

/* Payload con la misma forma que arma `handleExportarExcel` en MotorComparables.jsx.
   Ojo con `T.op`: ahí es la utilidad operacional, no los gastos — el adaptador la
   convierte antes de pasarla al generador. */
const PAYLOAD = {
  estudio: {
    entidad: 'Ejemplo SAS', anio: 2025, pli: 'MO', useAdj: true,
    /* El componente publica las dos: `interestRate` ya dividida, para su propio
       cálculo en pantalla, y `prime` tal como la escribió el usuario. */
    interestRate: 0.0737,
    prime: '7.37',
  },
  examinada: {
    T: { s: 1000, c: 600, op: 200, ar: 100, inv: 50, ap: 80, ppe: 300 },
  },
  comparables: [
    { name: 'A SA', s: 500, c: 300, op: 100, ar: 50, inv: 20, ap: 40, ppe: 100 },
    { name: 'B SA', s: 800, c: 500, op: 150, ar: 90, inv: 10, ap: 60, ppe: 40 },
    { name: 'C SA', s: 300, c: 100, op: 120, ar: 30, inv: 5, ap: 20, ppe: 10 },
  ],
};

test('la tasa llega al libro sin dividirse dos veces', () => {
  /* 7,37 % tiene que aterrizar en Datos!B11 como 0,0737. Si alguien vuelve a leer
     `interestRate` en el adaptador, aquí sale 0,000737 y el test lo dice. */
  const wb = construirLibroSoporte(PAYLOAD);
  const b11 = wb.Sheets.Datos.B11;
  assert.ok(b11, 'Datos!B11 debería existir');
  assert.ok(Math.abs(b11.v - 0.0737) < 1e-12, `Datos!B11 = ${b11.v}, esperado 0.0737`);
});

test('un estudio sin tasa no inventa una', () => {
  const sinTasa = { ...PAYLOAD, estudio: { ...PAYLOAD.estudio, prime: undefined } };
  const wb = construirLibroSoporte(sinTasa);
  assert.strictEqual(wb.Sheets.Datos.B11.v, 0);
});

test('las comparables toman la tasa de la celda única', () => {
  const wb = construirLibroSoporte(PAYLOAD);
  ['I15', 'I16', 'I17'].forEach((ref) => {
    assert.strictEqual(wb.Sheets.Datos[ref].f, '$B$11', `${ref} debería referenciar B11`);
  });
});

test('el libro trae las hojas de cálculo y la de diagnóstico', () => {
  const wb = construirLibroSoporte(PAYLOAD);
  ['Resumen', 'Diagnóstico de datos', 'Datos', 'MO', 'MB', 'Berry', 'CostPlus', 'NCP']
    .forEach((h) => assert.ok(wb.SheetNames.includes(h), `falta la hoja ${h}`));
});

test('el .xlsx escrito no lleva ninguna fórmula que Excel rechace', () => {
  /* La prueba de fuego del bug de la columna «Tasa»: no basta con mirar el objeto
     de celda, hay que ver el XML que acaba dentro del archivo. Una fórmula con «=»
     delante sale como <f>=$B$11</f>, Excel no la puede parsear y abre el libro en
     modo reparación descartando la celda. */
  const wb = construirLibroSoporte(PAYLOAD);
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  const releido = XLSX.read(bytes, { type: 'buffer', bookFiles: true });

  const hojasXml = Object.keys(releido.files || {}).filter((n) => /xl\/worksheets\/.*\.xml$/.test(n));
  assert.ok(hojasXml.length > 0, 'el libro escrito debería traer hojas');
  hojasXml.forEach((nombre) => {
    const xml = Buffer.from(releido.files[nombre].content).toString('utf8');
    assert.ok(!xml.includes('<f>='), `${nombre} contiene una fórmula con «=» inicial`);
  });
});

test('la propiedad, planta y equipo llega al libro, no en cero', () => {
  /* `T.ppe` no existía en el payload que arma el componente, y el adaptador lo busca
     ahí primero: el libro salía con PP&E en cero para la parte examinada aunque el
     estudio la tuviera cargada, y el ajuste de PP&E se calculaba contra nada. */
  const wb = construirLibroSoporte(PAYLOAD);
  assert.strictEqual(wb.Sheets.Datos.B10.v, 300, 'PP&E de la parte examinada');
  assert.strictEqual(wb.Sheets.Datos.A10.v, 'Propiedad, planta y equipo');
});

test('el PP&E de cada comparable viaja a su fila', () => {
  const wb = construirLibroSoporte(PAYLOAD);
  assert.deepStrictEqual(
    ['H15', 'H16', 'H17'].map((ref) => wb.Sheets.Datos[ref].v),
    [100, 40, 10],
  );
});

test('los gastos operativos se derivan de la utilidad antes de llegar al generador', () => {
  /* `T.op` entra como utilidad operacional (200) y el generador espera gastos:
     1000 − 600 − 200 = 200 en este caso, que coincide por casualidad numérica, así
     que se comprueba con un juego donde no coinciden. */
  const otro = {
    ...PAYLOAD,
    examinada: { T: { s: 1000, c: 600, op: 150, ar: 100, inv: 50, ap: 80, ppe: 300 } },
  };
  const wb = construirLibroSoporte(otro);
  assert.strictEqual(wb.Sheets.Datos.B6.v, 250, 'gastos = ventas − costo − utilidad operacional');
});
