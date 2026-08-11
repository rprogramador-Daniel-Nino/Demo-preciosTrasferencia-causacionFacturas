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

/** Fila 1-based de la hoja cuya columna A empieza por `etiqueta`, para no fijar a
    mano un número que se mueve cada vez que `RUBROS_EXAMINADA` cambia de tamaño. */
function filaEnHoja(hoja, etiqueta) {
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true });
  return filas.findIndex((f) => f && f[0] === etiqueta) + 1;
}

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
  /* 7,37 % tiene que aterrizar en su celda como 0,0737. Si alguien vuelve a leer
     `interestRate` en el adaptador, aquí sale 0,000737 y el test lo dice. */
  const wb = construirLibroSoporte(PAYLOAD);
  const fila = filaEnHoja(wb.Sheets.Datos, 'Tasa de interés de referencia (Prime Rate)');
  const celda = wb.Sheets.Datos[`B${fila}`];
  assert.ok(celda, 'la celda de la tasa debería existir');
  assert.ok(Math.abs(celda.v - 0.0737) < 1e-12, `Datos!B${fila} = ${celda.v}, esperado 0.0737`);
});

test('un estudio sin tasa no inventa una', () => {
  const sinTasa = { ...PAYLOAD, estudio: { ...PAYLOAD.estudio, prime: undefined } };
  const wb = construirLibroSoporte(sinTasa);
  const fila = filaEnHoja(wb.Sheets.Datos, 'Tasa de interés de referencia (Prime Rate)');
  assert.strictEqual(wb.Sheets.Datos[`B${fila}`].v, 0);
});

test('las comparables toman la tasa de la celda única', () => {
  const wb = construirLibroSoporte(PAYLOAD);
  const filaTasa = filaEnHoja(wb.Sheets.Datos, 'Tasa de interés de referencia (Prime Rate)');
  const filaHdrComp = filaEnHoja(wb.Sheets.Datos, 'Compañía');
  for (let i = 0; i < 3; i++) {
    const ref = `I${filaHdrComp + 1 + i}`;
    assert.strictEqual(wb.Sheets.Datos[ref].f, `$B$${filaTasa}`, `${ref} debería referenciar la celda única`);
  }
});

test('el libro trae las hojas de cálculo y la de diagnóstico', () => {
  const wb = construirLibroSoporte(PAYLOAD);
  ['Resumen', 'Diagnóstico de datos', 'Datos', 'MO', 'MB', 'Berry', 'CostPlus', 'NCP']
    .forEach((h) => assert.ok(wb.SheetNames.includes(h), `falta la hoja ${h}`));
});

test('el .xlsx escrito no lleva ninguna fórmula que Excel rechace', () => {
  /* La prueba de fuego del bug de la columna «Tasa»: no basta con mirar el objeto
     de celda, hay que ver el XML que acaba dentro del archivo. Una fórmula con «=»
     delante sale como <f>=…</f>, Excel no la puede parsear y abre el libro en
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
  const fila = filaEnHoja(wb.Sheets.Datos, 'Propiedad, planta y equipo');
  assert.strictEqual(wb.Sheets.Datos[`B${fila}`].v, 300, 'PP&E de la parte examinada');
});

test('el PP&E de cada comparable viaja a su fila', () => {
  const wb = construirLibroSoporte(PAYLOAD);
  const filaHdrComp = filaEnHoja(wb.Sheets.Datos, 'Compañía');
  assert.deepStrictEqual(
    [1, 2, 3].map((i) => wb.Sheets.Datos[`H${filaHdrComp + i}`].v),
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

test('el libro recibe el ámbito, el segmento excluido y el amb de cada comparable', () => {
  /* Sin estos tres campos el libro calcula su rango sobre las 16 filas y sobre unas
     ventas sin descontar, mientras el informe filtra por ámbito y descuenta: dos
     rangos distintos para el mismo estudio, y el libro se radica como su soporte. */
  const wb = construirLibroSoporte({
    estudio: {
      t_s: 1000, t_c: 600, t_op: 200, t_ar: 100, t_inv: 50, t_ap: 80, t_ppe: 300,
      prime: 7.37, cmode: 'nac', seg_excluido: 120,
    },
    comparables: [
      { name: 'Nacional A', amb: 'Nac', s: 500, c: 300, op: 380 },
      { name: 'Internacional X', amb: 'Int', s: 900, c: 100, op: 700 },
    ],
  });

  const datos = XLSX.utils.sheet_to_json(wb.Sheets.Datos, { header: 1, raw: true });
  /* B4 son las ventas de la parte examinada: 1000 − 120 de segmento excluido. */
  const filaVentas = datos.find((f) => f && f[0] === 'Ventas netas');
  assert.strictEqual(filaVentas[1], 880, 'las ventas del libro descuentan seg_excluido');

  const filaAmbito = datos.find((f) => f && f[0] === 'Ámbito de la muestra');
  assert.ok(filaAmbito, 'el libro declara el ámbito de la muestra');
  assert.strictEqual(filaAmbito[1], 'nac');

  /* La columna J de cada comparable lleva su ámbito. */
  const hdr = datos.find((f) => f && f[0] === 'Compañía');
  assert.strictEqual(hdr[9], 'Ámbito');
  const filaNac = datos.find((f) => f && f[0] === 'Nacional A');
  assert.strictEqual(filaNac[9], 'Nac');
  const filaInt = datos.find((f) => f && f[0] === 'Internacional X');
  assert.strictEqual(filaInt[9], 'Int');
});
