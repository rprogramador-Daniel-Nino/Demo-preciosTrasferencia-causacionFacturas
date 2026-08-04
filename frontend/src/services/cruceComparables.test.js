import { test } from 'node:test';
import assert from 'node:assert';
import {
  cruzar,
  esCruceFirme,
  motivoCruce,
  motivoRechazoEnFila,
  parecido,
  repartir,
  tokensNombre,
  UMBRAL_TOKENS,
  cobertura,
} from './cruceComparables.js';

const COMPARABLES = [
  { name: 'GLOBANT S.A.', id: 'IQ4295856' },
  { name: 'ENDAVA PLC', id: 'IQ253546' },
  { name: 'EPAM SYSTEMS INC', id: 'IQ32307058' },
];

/* ─── Tokens y parecido ─── */

test('las palabras que no distinguen una empresa no cuentan', () => {
  assert.ok(!tokensNombre('HOLDING GROUP COLOMBIA').length,
    'HOLDING, GROUP y COLOMBIA no deberían contar como palabras distintivas');
  assert.ok(tokensNombre('GLOBANT S.A.').includes('GLOBANT'));
});

test('dos holdings sin relación no se parecen', () => {
  assert.strictEqual(parecido('HOLDING GROUP COLOMBIA', 'COLOMBIA HOLDING SERVICES'), 0);
});

test('la misma empresa escrita distinto se parece por encima del umbral', () => {
  assert.ok(parecido('EPAM SYSTEMS INC', 'EPAM SYSTEMS') >= UMBRAL_TOKENS);
});

/* ─── Cascada de cruce ─── */

test('cruza por identificador de la fuente cuando está', () => {
  const c = cruzar({ nombre: 'nombre ilegible', identificador_fuente: 'iq253546' }, 'x.pdf', COMPARABLES);
  assert.strictEqual(c.modo, 'id');
  assert.strictEqual(c.comparable.name, 'ENDAVA PLC');
  assert.ok(esCruceFirme(c), 'un cruce por identificador es firme');
});

test('cruza por razón social aunque cambie el sufijo societario', () => {
  const c = cruzar({ nombre: 'Globant SAS' }, 'archivo-cualquiera.pdf', COMPARABLES);
  assert.strictEqual(c.modo, 'nombre');
  assert.strictEqual(c.comparable.name, 'GLOBANT S.A.');
  assert.ok(esCruceFirme(c));
});

test('cruza por el nombre del archivo cuando el documento no trae razón social', () => {
  const c = cruzar({ nombre: '' }, 'ENDAVA PLC.pdf', COMPARABLES);
  assert.strictEqual(c.modo, 'archivo');
  assert.strictEqual(c.comparable.name, 'ENDAVA PLC');
  assert.ok(!esCruceFirme(c), 'el nombre del archivo no es prueba suficiente: debe quedar por confirmar');
});

test('cruza por solapamiento de palabras y queda por confirmar', () => {
  const c = cruzar({ nombre: 'EPAM SYSTEMS DELAWARE HOLDINGS' }, 'x.pdf', COMPARABLES);
  assert.strictEqual(c.modo, 'tokens');
  assert.strictEqual(c.comparable.name, 'EPAM SYSTEMS INC');
  assert.ok(!esCruceFirme(c), 'un cruce por palabras debe quedar por confirmar');
});

test('una empresa ajena no cruza, y se informa la candidata más cercana', () => {
  const c = cruzar({ nombre: 'BANCOLOMBIA S.A.' }, 'bancolombia.pdf', COMPARABLES);
  assert.strictEqual(c.indice, -1);
  assert.strictEqual(c.modo, 'sin-cruce');
  const motivo = motivoCruce(c, { nombre: 'BANCOLOMBIA S.A.' }, 'bancolombia.pdf');
  assert.ok(motivo.includes('BANCOLOMBIA'), 'el motivo debe decir qué empresa se leyó');
  assert.ok(/no está entre las comparables|no se parece a ninguna/.test(motivo),
    'el motivo debe explicar que no está entre las comparables');
});

test('el motivo de un cruce dudoso trae el porcentaje y pide confirmación', () => {
  const c = cruzar({ nombre: 'EPAM SYSTEMS DELAWARE HOLDINGS' }, 'x.pdf', COMPARABLES);
  const motivo = motivoCruce(c, { nombre: 'EPAM SYSTEMS DELAWARE HOLDINGS' }, 'x.pdf');
  assert.ok(/%/.test(motivo), 'falta el porcentaje de coincidencia');
  assert.ok(/confírmalo/i.test(motivo), 'no pide confirmar un cruce que no es firme');
});

/* ─── Rechazo al cargar en una fila concreta ─── */

test('el motivo de rechazo en fila nombra las dos empresas y no culpa al usuario', () => {
  const motivo = motivoRechazoEnFila({ nombre: 'BANCOLOMBIA S.A.' }, COMPARABLES[0], 'banco.pdf');
  assert.ok(motivo.includes('BANCOLOMBIA'), 'falta la empresa del documento');
  assert.ok(motivo.includes('GLOBANT'), 'falta la comparable de destino');
  assert.ok(/No se aplicaron las cifras/.test(motivo), 'no queda claro que no se aplicó nada');
  assert.ok(/carga masiva/.test(motivo), 'no ofrece la salida al usuario');
});

/* ─── Reparto de un lote ─── */

test('reparte cada empresa a su fila y rechaza las ajenas con motivo', () => {
  const entradas = [
    { datos: { nombre: 'GLOBANT S.A.' }, archivo: 'lote.pdf', verificacion: { esValido: true, hallazgos: [] } },
    { datos: { nombre: 'BANCOLOMBIA S.A.' }, archivo: 'lote.pdf', verificacion: { esValido: true, hallazgos: [] } },
    { datos: { nombre: 'ENDAVA PLC' }, archivo: 'lote.pdf', verificacion: { esValido: true, hallazgos: [] } },
  ];
  const { aplicadas, rechazadas } = repartir(entradas, COMPARABLES);

  assert.strictEqual(aplicadas.length, 2, 'debieron aplicarse Globant y Endava');
  assert.strictEqual(rechazadas.length, 1, 'debió rechazarse Bancolombia');
  assert.ok(rechazadas[0].motivo.includes('BANCOLOMBIA'), 'el rechazo no dice de qué empresa era el documento');

  const destinos = aplicadas.map((a) => COMPARABLES[a.indice].name).sort();
  assert.deepStrictEqual(destinos, ['ENDAVA PLC', 'GLOBANT S.A.']);
});

test('ninguna fila recibe dos documentos: gana el cruce más firme', () => {
  /* El dudoso se procesa después del firme aunque venga primero en la lista. Sin
     el orden por confianza, el primero en llegar se queda la fila y el bueno
     acabaría rechazado. */
  const entradas = [
    { datos: { nombre: 'EPAM SYSTEMS DELAWARE HOLDINGS' }, archivo: 'dudoso.pdf', verificacion: { esValido: true, hallazgos: [] } },
    { datos: { nombre: 'EPAM SYSTEMS INC', identificador_fuente: 'IQ32307058' }, archivo: 'firme.pdf', verificacion: { esValido: true, hallazgos: [] } },
  ];
  const { aplicadas, rechazadas } = repartir(entradas, COMPARABLES);

  assert.strictEqual(aplicadas.length, 1, 'solo uno debía entrar en la fila de EPAM');
  assert.strictEqual(aplicadas[0].archivo, 'firme.pdf', 'entró el dudoso en lugar del que trae identificador');
  assert.strictEqual(rechazadas.length, 1);
  assert.ok(/ya se aplicó/.test(rechazadas[0].motivo), 'el motivo no explica que la fila ya estaba ocupada');
});

test('un lote sin ninguna coincidencia no aplica nada y lo explica todo', () => {
  const entradas = [
    { datos: { nombre: 'ECOPETROL S.A.' }, archivo: 'a.pdf', verificacion: { esValido: true, hallazgos: [] } },
    { datos: { nombre: 'AVIANCA HOLDINGS' }, archivo: 'b.pdf', verificacion: { esValido: true, hallazgos: [] } },
  ];
  const { aplicadas, rechazadas } = repartir(entradas, COMPARABLES);
  assert.strictEqual(aplicadas.length, 0);
  assert.strictEqual(rechazadas.length, 2);
  rechazadas.forEach((r) => assert.ok(r.motivo && r.motivo.length > 20, 'todo rechazo necesita su motivo'));
});

test('sin comparables cargadas no se aplica nada, en vez de fallar', () => {
  const { aplicadas, rechazadas } = repartir(
    [{ datos: { nombre: 'GLOBANT S.A.' }, archivo: 'x.pdf', verificacion: { esValido: true, hallazgos: [] } }],
    []
  );
  assert.strictEqual(aplicadas.length, 0);
  assert.strictEqual(rechazadas.length, 1);
});

/* ══════ ruido en el nombre del archivo y ticker de Capital IQ ══════
   Caso real: se cargaron 19 estados financieros y solo 10 se asociaron. Los archivos se
   llaman «10 HYBRID TECHNOLOGIES CO. LTD. Estado de resultados 2025 Ventas netas.pdf» y
   las razones sociales traen el sufijo de bolsa, «Hybrid Technologies Co., Ltd.
   (TSE:4260)». Contar ESTADO, RESULTADOS, VENTAS, NETAS, KOSDAQ y el código del ticker
   como parte del nombre hundía el parecido de 1,00 a 0,33, por debajo del umbral. */

test('tokensNombre descarta el ruido de un titulo de estado financiero', () => {
  assert.deepStrictEqual(
    tokensNombre('17 AERIA INC. Estado de resultados 2025 Ventas netas'),
    ['AERIA'],
    'solo queda la razón social'
  );
});

test('tokensNombre descarta el sufijo de bolsa de Capital IQ', () => {
  assert.deepStrictEqual(tokensNombre('Neptune Company (KOSDAQ:A217270)'), ['NEPTUNE']);
  assert.deepStrictEqual(tokensNombre('Aeria Inc. (TSE:3758)'), ['AERIA']);
});

test('un documento titulado como estado financiero cruza con su comparable', () => {
  const filas = [
    { id: '1', name: 'Aeria Inc. (TSE:3758)' },
    { id: '2', name: 'KAYAC Inc. (TSE:3904)' },
  ];
  /* Caso peor: el OCR no devolvió razón social ni identificador, solo hay nombre de
     archivo. Es lo habitual en un estado de resultados que empieza por la tabla. */
  const c = cruzar({ nombre: '', identificador_fuente: '' },
    '17 AERIA INC. Estado de resultados 2025 Ventas net.pdf', filas);
  assert.strictEqual(c.indice, 0);
  assert.strictEqual(c.comparable.name, 'Aeria Inc. (TSE:3758)');
});

test('los diecinueve documentos reales se reparten cada uno a su fila', () => {
  const archivos = [
    '1 QUBICGAMES S.A..pdf',
    '10 HYBRID TECHNOLOGIES CO. LTD. Estado de resultad.pdf',
    '11 STRING METAVERSE LIMITED Estado de resultados 2.pdf',
    '12 EXTREME CO.LTD. Estado de resultados 2025 Venta.pdf',
    '13 ZHEJIANG DAILY DIGITAL CULTURE GROUP CO.LTD Est.pdf',
    '14 BEIJING ULTRAPOWER SOFTWARE CO. LTD. Estado de .pdf',
    '15 KIDS STAR INC. Estado de resultados 2025 Ventas.pdf',
    '16 T3 ENTERTAINMENT INC. Estado de resultados 2025.pdf',
    '17 AERIA INC. Estado de resultados 2025 Ventas net.pdf',
    '18 KAYAC INC. Estado de resultados 2025 Ventas net.pdf',
    '19 GLOBAL MOFY AI LIMITED Estado de resultados 202.pdf',
    '2 YOOZOO INTERACTIVE CO. LTD..pdf',
    '3 NEPTUNE COMPANY.pdf',
    '4 WEMADE PLAY CO. LTD..pdf',
    '5 TOSE CO. LTD..pdf',
    '6 AKATSUKI INC..pdf',
    '7 FUN YOURS TECHNOLOGY CO.LTD..pdf',
    '8 SILICON STUDIO CORPORATION.pdf',
    '9 APPIRITS INC..pdf',
  ];
  const filas = [
    'QubicGames S.A. (WSE:QUB)', 'Hybrid Technologies Co., Ltd. (TSE:4260)',
    'String Metaverse Limited (BSE:539542)', 'Extreme Co., Ltd. (TSE:6033)',
    'Zhejiang Daily Digital Culture Group Co., Ltd. (SHSE:600633)',
    'Beijing Ultrapower Software Co., Ltd. (SZSE:300002)', 'Kids Star Inc. (TSE:248A)',
    'T3 Entertainment Inc. (KOSDAQ:A204610)', 'Aeria Inc. (TSE:3758)', 'KAYAC Inc. (TSE:3904)',
    'Global Mofy AI Limited (NasdaqCM:GMM)', 'Yoozoo Interactive Co., Ltd. (SHSE:002174)',
    'Neptune Company (KOSDAQ:A217270)', 'Wemade Play Co., Ltd. (KOSDAQ:A123420)',
    'TOSE CO., LTD. (TSE:4728)', 'Akatsuki Inc. (TSE:3932)',
    'Fun Yours Technology Co., Ltd. (GTSM:6150)', 'Silicon Studio Corporation (TSE:3907)',
    'Appirits Inc. (TSE:7075)',
  ].map((name, i) => ({ id: String(i), name }));

  const entradas = archivos.map((archivo) => ({
    archivo, datos: { nombre: '', identificador_fuente: '' }, verificacion: { esValido: true, hallazgos: [] },
  }));
  const { aplicadas, rechazadas } = repartir(entradas, filas);

  assert.strictEqual(rechazadas.length, 0, 'antes 7 se quedaban sin cruzar');
  assert.strictEqual(aplicadas.length, 19);
  assert.strictEqual(new Set(aplicadas.map((a) => a.indice)).size, 19,
    'cada documento a una fila distinta');
});

test('con dos comparables igual de cubiertas no se aplica a ninguna', () => {
  /* Aplicar las cifras a la equivocada las mete en el rango intercuartil sin que nadie
     lo note, así que ante la duda se rechaza y se explica. */
  const filas = [
    { id: '1', name: 'Neptune Company (KOSDAQ:A217270)' },
    { id: '2', name: 'Neptune (TSE:9999)' },
  ];
  const c = cruzar({ nombre: '', identificador_fuente: '' },
    'Neptune Estado de resultados 2025.pdf', filas);
  assert.strictEqual(c.indice, -1);
  assert.strictEqual(c.modo, 'ambiguo');
  assert.match(motivoCruce(c, { nombre: '' }, 'Neptune Estado de resultados 2025.pdf'),
    /encaja igual de bien con 2 comparables/);
});

test('cobertura mide cuanto de la razon social aparece en el documento', () => {
  assert.strictEqual(cobertura('Aeria Inc.', 'AERIA INC. Estado de resultados 2025'), 1,
    'la razón social aparece completa, aunque el archivo traiga mucho más texto');
  assert.strictEqual(cobertura('Hybrid Technologies Co., Ltd.', 'OTRA EMPRESA Estado de resultados'), 0);
  assert.strictEqual(cobertura('', 'cualquier cosa'), 0, 'sin razón social no hay nada que cubrir');
});
