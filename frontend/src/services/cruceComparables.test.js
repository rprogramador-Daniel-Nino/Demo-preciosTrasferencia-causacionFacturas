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

/* ─── Sin comparables en la tabla ─── */

test('sin comparables el cruce lo dice, en vez de culpar al documento', () => {
  /* Pasó de verdad: una carga masiva de quince estados financieros devolvió quince
     rechazos con «no se parece a ninguna de las comparables del estudio», cuando lo que
     faltaba era la muestra. El mensaje mandaba a revisar las razones sociales de los
     documentos, que estaban bien.

     LO QUE CAMBIÓ EL 2026-09-05: ese mensaje mandaba a «ejecutar la selección del paso 3», y
     eso dejó de ser lo que hay que hacer — desde el 2026-09-04 un documento que no cruza con
     ninguna fila CREA su comparable, así que con la tabla vacía no hay nada que ejecutar antes:
     la carga masiva arma la muestra sola.

     Lo que la prueba sigue fijando es lo que vino a cerrar: que el motivo señale la ausencia de
     comparables y no la razón social del documento, que está bien. */
  const cruce = cruzar({ nombre: 'APPIRITS INC' }, '9 APPIRITS INC.pdf', []);
  assert.strictEqual(cruce.indice, -1);
  assert.strictEqual(cruce.modo, 'sin-comparables');
  const motivo = motivoCruce(cruce, { nombre: 'APPIRITS INC' }, '9 APPIRITS INC.pdf');
  assert.match(motivo, /todavía no tiene comparables/);
  assert.match(motivo, /carga masiva/, 'dice qué hacer, no solo qué falló');
  assert.doesNotMatch(motivo, /paso 3/,
    'y ya no manda a un paso que dejó de hacer falta');
  assert.doesNotMatch(motivo, /no se parece/,
    'el documento no tiene nada de malo: no hay contra qué cruzarlo');
});

test('una lista ausente se trata igual que una vacía', () => {
  assert.strictEqual(cruzar({ nombre: 'APPIRITS INC' }, 'a.pdf', null).modo, 'sin-comparables');
  assert.strictEqual(cruzar({ nombre: 'APPIRITS INC' }, 'a.pdf', undefined).modo, 'sin-comparables');
});

test('sin comparables cargadas, cada documento CREA la suya', () => {
  /* Esta prueba fijaba lo contrario —«repartir sin comparables rechaza todo»— y era correcto
     mientras la muestra solo podía salir del cribado de Capital IQ.

     Desde el 2026-09-02 hay un segundo camino, pedido así: «hicimos la búsqueda de las
     comparables de manera manual y ya tenemos las comparables; si cargamos los EEFF de estas
     comparables debería agregarlos y generar los análisis con estos datos» y «al cargar un
     estado financiero lo que debe hacer es crear la comparable si esta no existe».

     Este es justo ese flujo en su forma pura: sin ninguna comparable cargada, soltar los estados
     financieros crea la muestra entera. */
  const entradas = [
    { archivo: '9 APPIRITS INC.pdf', datos: { nombre: 'APPIRITS INC' } },
    { archivo: '15 KIDS STAR INC.pdf', datos: { nombre: 'KIDS STAR INC' } },
  ];
  const { aplicadas, rechazadas, nuevas } = repartir(entradas, []);
  assert.strictEqual(aplicadas.length, 0, 'ninguna se aplica sobre una fila existente');
  assert.strictEqual(rechazadas.length, 0, 'y ninguna se rechaza');
  assert.strictEqual(nuevas.length, 2);
  assert.deepStrictEqual(nuevas.map((n) => n.nombre).sort(), ['APPIRITS INC', 'KIDS STAR INC']);
  nuevas.forEach((n) => {
    assert.strictEqual(n.crearComparable, true);
    assert.match(n.motivo, /se creó la comparable/);
    assert.strictEqual(n.firme, false, 'creada desde el documento: hay que verificarla');
  });
});

test('el documento sin razón social SÍ se rechaza: no se puede crear una fila anónima', () => {
  /* El límite del camino nuevo. Una fila con cifras y sin nombre entraría al rango sin que
     nadie sepa de quién es, que es peor que un rechazo con su motivo. */
  const { rechazadas, nuevas } = repartir(
    [{ archivo: 'sin-nombre.pdf', datos: { ingresos: 100 } }],
    [],
  );
  assert.strictEqual(nuevas.length, 0);
  assert.strictEqual(rechazadas.length, 1);
  assert.match(rechazadas[0].motivo, /tampoco trae la razón social/);
  assert.match(rechazadas[0].motivo, /sin que nadie sepa de quién es/);
});

test('con comparables, un documento ajeno sigue diciendo cuál era la más parecida', () => {
  /* La rama de siempre no cambia: el motivo útil no es «no cruzó» sino «lo más parecido
     era X, al N %». */
  const cruce = cruzar({ nombre: 'APPIRITS INC' }, 'appirits.pdf', COMPARABLES);
  assert.strictEqual(cruce.indice, -1);
  assert.strictEqual(cruce.modo, 'sin-cruce');
});

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

test('la coincidencia se multiplica por 100 una sola vez y no duplica el signo', () => {
  /* Dos errores que el enrutado a `pctf` puede introducir, y los dos dan una cadena creíble:
     dejar el `* 100` que había imprime «10.000,000 %», y dejar el « %» del literal imprime
     «100,000 % %». Un documento cargado en su propia fila coincide al 100 %. */
  const motivo = motivoRechazoEnFila({ nombre: 'GLOBANT S.A.' }, COMPARABLES[0], 'x.pdf');
  assert.ok(motivo.includes('100,000 % de coincidencia'),
    `esperaba «100,000 % de coincidencia» y salió: ${motivo}`);
  assert.ok(!motivo.includes('% %'), `el signo se duplicó: ${motivo}`);
  assert.ok(!motivo.includes('10.000'), `se multiplicó dos veces: ${motivo}`);
});

test('el umbral del cruce sale con el mismo formato que la coincidencia', () => {
  const c = cruzar({ nombre: 'BANCOLOMBIA S.A.' }, 'bancolombia.pdf', COMPARABLES);
  const motivo = motivoCruce(c, { nombre: 'BANCOLOMBIA S.A.' }, 'bancolombia.pdf');
  if (motivo.includes('que se exige')) {
    assert.match(motivo, /\d+,\d{3} % que se exige/, `el umbral no lleva tres decimales: ${motivo}`);
    assert.ok(!motivo.includes('% %'), `el signo se duplicó: ${motivo}`);
  }
});

/* ─── Reparto de un lote ─── */

test('reparte cada empresa a su fila y rechaza las ajenas con motivo', () => {
  const entradas = [
    { datos: { nombre: 'GLOBANT S.A.' }, archivo: 'lote.pdf', verificacion: { esValido: true, hallazgos: [] } },
    { datos: { nombre: 'BANCOLOMBIA S.A.' }, archivo: 'lote.pdf', verificacion: { esValido: true, hallazgos: [] } },
    { datos: { nombre: 'ENDAVA PLC' }, archivo: 'lote.pdf', verificacion: { esValido: true, hallazgos: [] } },
  ];
  const { aplicadas, rechazadas, nuevas } = repartir(entradas, COMPARABLES);

  assert.strictEqual(aplicadas.length, 2, 'debieron aplicarse Globant y Endava');
  /* Bancolombia ya no se RECHAZA: se CREA. No cruza con ninguna fila de la muestra, y desde el
     2026-09-02 un documento que no cruza con nadie crea su comparable —«al cargar un estado
     financiero lo que debe hacer es crear la comparable si esta no existe»—.

     Lo que la prueba sigue protegiendo, y es lo que vino a cerrar: que cada documento vaya a SU
     fila y no a la de al lado. La verificación de identidad no se debilita; lo que cambió es
     qué pasa cuando no hay ninguna fila con la que chocar. Que un estado financiero de un banco
     acabe creando una comparable en un estudio de software es una decisión del analista, y por
     eso la fila queda marcada como no firme y con el motivo escrito. */
  assert.strictEqual(rechazadas.length, 0);
  assert.strictEqual(nuevas.length, 1);
  assert.ok(nuevas[0].nombre.includes('BANCOLOMBIA'));
  assert.strictEqual(nuevas[0].firme, false, 'creada desde el documento: hay que verificarla');
  assert.match(nuevas[0].motivo, /Verifique que corresponde al estudio/);

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
  const { aplicadas, rechazadas, nuevas } = repartir(entradas, COMPARABLES);
  assert.strictEqual(aplicadas.length, 0, 'ninguna cruza con las que ya están');
  assert.strictEqual(rechazadas.length, 0);
  /* Ya no se rechazan: se crean. Traen razón social, que es lo único que hace falta para
     nombrarlas, y la verificación de identidad no tiene con qué chocar porque esas comparables
     no existen en la muestra. */
  assert.strictEqual(nuevas.length, 2);
  nuevas.forEach((n) => assert.ok(n.motivo && n.motivo.length > 20, 'y cada una dice que se creó'));
});

test('sin comparables cargadas no falla: crea la del documento', () => {
  const { aplicadas, rechazadas, nuevas } = repartir(
    [{ datos: { nombre: 'GLOBANT S.A.' }, archivo: 'x.pdf', verificacion: { esValido: true, hallazgos: [] } }],
    []
  );
  assert.strictEqual(aplicadas.length, 0);
  assert.strictEqual(rechazadas.length, 0);
  assert.strictEqual(nuevas.length, 1);
  assert.strictEqual(nuevas[0].nombre, 'GLOBANT S.A.');
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
