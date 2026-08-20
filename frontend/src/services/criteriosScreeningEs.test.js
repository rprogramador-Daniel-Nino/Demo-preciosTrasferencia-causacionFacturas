import { test } from 'node:test';
import assert from 'node:assert';
import {
  traducirCriterio, traducirCriterios, residuoDeCriterios,
  ETIQUETAS_IQ, TITULOS_SIC,
} from './criteriosScreeningEs.js';

/* ══════ El caso de oro: los siete criterios reales de END GAME 2025 ══════

   Transcritos de la hoja «Screen Criteria» de
   Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/END GAME 2025.xls,
   tal como los deja `parsearCriteriosScreening` (comparablesEngine.js:51). Es el texto
   que hoy se radica ante la DIAN en inglés. */

const REALES = [
  { conector: null, etiqueta: 'All Available Holders - % Owned by Single Holder [Latest] (%)', valor: 'is less than 50' },
  { conector: 'Y', etiqueta: 'Company Type', valor: 'Public Company OR Private Company' },
  { conector: 'Y', etiqueta: 'Company Status', valor: 'Operating' },
  { conector: 'Y', etiqueta: 'Business Description', valor: 'Keyword: games' },
  { conector: 'O', etiqueta: 'SIC Codes', valor: '7371 Computer Programming Services OR 7372 Prepackaged Software' },
  { conector: 'Y', etiqueta: 'Total Revenue [FY 2025] ($USDmm, Historical rate)', valor: 'is greater than 0 (Unreported data set to 0)' },
  { conector: 'Y', etiqueta: 'Cost Of Goods Sold [FY 2025] ($USDmm, Historical rate)', valor: 'is greater than 0 (Unreported data set to 0)' },
];

test('la corrida real de Capital IQ sale completa en español', () => {
  const traducidos = traducirCriterios(REALES).map((c) => [c.etiqueta, c.valor]);
  assert.deepStrictEqual(traducidos, [
    ['Accionistas conocidos — % en manos de un solo accionista [último dato] (%)', 'es menor que 50'],
    ['Tipo de compañía', 'Compañía pública O compañía privada'],
    ['Estado de la compañía', 'En operación'],
    ['Descripción del negocio', 'Palabra clave: games'],
    ['Códigos SIC', '7371 Servicios de programación de computadores O 7372 Software preempaquetado'],
    ['Ingresos totales [año fiscal 2025] (millones de USD, tasa histórica)',
      'es mayor que 0 (los datos no reportados se toman como 0)'],
    ['Costo de ventas [año fiscal 2025] (millones de USD, tasa histórica)',
      'es mayor que 0 (los datos no reportados se toman como 0)'],
  ]);
});

test('la corrida real no deja residuo: el diccionario la cubre sin ayuda de la IA', () => {
  assert.deepStrictEqual(residuoDeCriterios(REALES), []);
});

test('el conector pasa intacto: lo intercala quien arma las filas', () => {
  const t = traducirCriterios(REALES);
  assert.strictEqual(t[0].conector, null);
  assert.strictEqual(t[4].conector, 'O');
});

/* ══════ Códigos SIC ══════ */

test('un valor de SIC traduce cada título y NO toca ningún número', () => {
  const { etiqueta, valor, residuo } = traducirCriterio({
    etiqueta: 'SIC Codes', valor: '7371 Computer Programming Services OR 7372 Prepackaged Software',
  });
  assert.strictEqual(etiqueta, 'Códigos SIC');
  assert.strictEqual(valor, '7371 Servicios de programación de computadores O 7372 Software preempaquetado');
  assert.deepStrictEqual(residuo, []);
  /* La comprobación que de verdad importa: los dígitos son los mismos. Un código SIC
     alterado manda al informe una industria que nadie cribó. */
  assert.deepStrictEqual(valor.match(/\d+/g), ['7371', '7372']);
});

test('un código SIC fuera del catálogo conserva su título en inglés y se reporta como residuo', () => {
  const { valor, residuo } = traducirCriterio({
    etiqueta: 'SIC Codes', valor: '7371 Computer Programming Services OR 2011 Meat Packing Plants',
  });
  assert.ok(!TITULOS_SIC['2011'], 'el catálogo arranca sembrado solo con la familia 737x');
  assert.strictEqual(valor, '7371 Servicios de programación de computadores O 2011 Meat Packing Plants');
  assert.deepStrictEqual(residuo, ['Meat Packing Plants'],
    'el residuo nombra el título sin catalogar para que la IA lo resuelva');
});

test('el conector AND dentro de un valor de SIC pasa a Y', () => {
  assert.strictEqual(
    traducirCriterio({ etiqueta: 'SIC Codes', valor: '7371 Computer Programming Services AND 7372 Prepackaged Software' }).valor,
    '7371 Servicios de programación de computadores Y 7372 Software preempaquetado'
  );
});

/* ══════ Etiquetas con sufijos de periodo y unidad ══════ */

test('los sufijos de periodo y unidad se traducen y el año se conserva', () => {
  assert.strictEqual(
    traducirCriterio({ etiqueta: 'Total Revenue [FY 2024] ($USDmm, Historical rate)', valor: '' }).etiqueta,
    'Ingresos totales [año fiscal 2024] (millones de USD, tasa histórica)'
  );
  assert.strictEqual(
    traducirCriterio({ etiqueta: 'Operating Income [LTM] ($USD)', valor: '' }).etiqueta,
    'Utilidad operacional [últimos 12 meses] (USD)'
  );
  assert.strictEqual(
    traducirCriterio({ etiqueta: 'Total Assets [CY 2023] (%)', valor: '' }).etiqueta,
    'Activos totales [año calendario 2023] (%)'
  );
});

test('una etiqueta desconocida queda intacta y se reporta como residuo', () => {
  const { etiqueta, residuo } = traducirCriterio({ etiqueta: 'Implied Enterprise Value', valor: 'Operating' });
  assert.strictEqual(etiqueta, 'Implied Enterprise Value');
  assert.deepStrictEqual(residuo, ['Implied Enterprise Value']);
});

/* ══════ Valores ══════ */

test('la palabra clave buscada NO se traduce: es la cadena literal que se usó en Capital IQ', () => {
  const { valor, residuo } = traducirCriterio({ etiqueta: 'Business Description', valor: 'Keyword: games' });
  assert.strictEqual(valor, 'Palabra clave: games');
  assert.deepStrictEqual(residuo, [], 'el término buscado no es texto por traducir');
});

test('los operadores de comparación se traducen con su cola', () => {
  const casos = [
    ['is greater than 1000', 'es mayor que 1000'],
    ['is less than or equal to 50', 'es menor o igual que 50'],
    ['is between 7371 and 7375', 'está entre 7371 y 7375'],
    ['is equal to 0', 'es igual a 0'],
    ['contains software', 'contiene software'],
  ];
  for (const [ingles, espanol] of casos) {
    assert.strictEqual(traducirCriterio({ etiqueta: 'Total Revenue', valor: ingles }).valor, espanol, ingles);
  }
});

test('los valores enumerados se encadenan en minúscula tras el primero', () => {
  assert.strictEqual(
    traducirCriterio({ etiqueta: 'Company Status', valor: 'Operating OR Operating Subsidiary' }).valor,
    'En operación O subsidiaria en operación'
  );
});

test('un valor sin letras pasa tal cual y no es residuo', () => {
  const { valor, residuo } = traducirCriterio({ etiqueta: 'Company Type', valor: '50' });
  assert.strictEqual(valor, '50');
  assert.deepStrictEqual(residuo, []);
});

/* ══════ Idempotencia ══════
   Los estudios ya guardados y los tests de `tablasInforme.test.js` traen criterios en
   español. El traductor corre en cada render, así que no puede estropearlos ni pedir IA. */

test('los criterios ya en español entran y salen iguales, sin residuo', () => {
  const enEspanol = [
    { conector: null, etiqueta: 'Código SIC primario', valor: 'Entre 7371 y 7375' },
    { conector: 'Y', etiqueta: 'Nivel de propiedad', valor: 'Menos del 50%' },
    { conector: 'O', etiqueta: 'Palabra clave', valor: 'Contiene juegos' },
    { conector: 'Y', etiqueta: 'Información compañía', valor: 'Incluya solo comparables con un sitio web' },
  ];
  assert.deepStrictEqual(
    traducirCriterios(enEspanol).map((c) => [c.etiqueta, c.valor]),
    enEspanol.map((c) => [c.etiqueta, c.valor])
  );
  assert.deepStrictEqual(residuoDeCriterios(enEspanol), [],
    'texto ya en español no puede disparar una llamada a la IA');
});

test('traducir dos veces da lo mismo que traducir una', () => {
  const unaVez = traducirCriterios(REALES);
  const dosVeces = traducirCriterios(unaVez);
  assert.deepStrictEqual(
    dosVeces.map((c) => [c.etiqueta, c.valor]),
    unaVez.map((c) => [c.etiqueta, c.valor])
  );
});

/* ══════ Traducción cacheada por la IA ══════ */

test('etiquetaEs y valorEs cacheados ganan sobre el diccionario', () => {
  const { etiqueta, valor, residuo } = traducirCriterio({
    etiqueta: 'Implied Enterprise Value', valor: 'is greater than 100',
    etiquetaEs: 'Valor implícito de la empresa', valorEs: 'es mayor que 100',
  });
  assert.strictEqual(etiqueta, 'Valor implícito de la empresa');
  assert.strictEqual(valor, 'es mayor que 100');
  assert.deepStrictEqual(residuo, [], 'lo cacheado ya no tiene nada pendiente');
});

test('un solo campo cacheado deja el otro en manos del diccionario', () => {
  const { etiqueta, valor } = traducirCriterio({
    etiqueta: 'Company Type', valor: 'Weird Unknown Value', valorEs: 'Valor raro desconocido',
  });
  assert.strictEqual(etiqueta, 'Tipo de compañía');
  assert.strictEqual(valor, 'Valor raro desconocido');
});

/* ══════ Bordes ══════ */

test('no revienta con entradas vacías o nulas', () => {
  assert.deepStrictEqual(traducirCriterios(null), []);
  assert.deepStrictEqual(traducirCriterios([null, undefined]), []);
  const t = traducirCriterio({});
  assert.strictEqual(t.etiqueta, '');
  assert.strictEqual(t.valor, '');
  assert.deepStrictEqual(t.residuo, []);
  assert.deepStrictEqual(residuoDeCriterios(null), []);
});

test('residuoDeCriterios devuelve el índice de cada criterio pendiente', () => {
  const r = residuoDeCriterios([
    { etiqueta: 'Company Type', valor: 'Public Company' },
    { etiqueta: 'Implied Enterprise Value', valor: 'is greater than 1' },
  ]);
  assert.deepStrictEqual(r, [{ indice: 1, residuo: ['Implied Enterprise Value'] }]);
});

test('el diccionario de etiquetas trae la forma española como entrada, para reconocerla', () => {
  /* Mismo criterio bilingüe que COLUMNAS_IQ (comparablesEngine.js:111): reconocer en los
     dos idiomas evita marcar como pendiente lo que ya está traducido. */
  assert.strictEqual(ETIQUETAS_IQ['tipo de compañía'], 'Tipo de compañía');
  assert.strictEqual(ETIQUETAS_IQ['company type'], 'Tipo de compañía');
});
