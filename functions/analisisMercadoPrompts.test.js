const { test } = require('node:test');
const assert = require('node:assert');
const {
  SERIES_MACRO,
  extraerJSON,
  construirPromptBusqueda,
  parsearRespuestaBusqueda,
  construirPromptRedaccion,
  parsearRespuestaRedaccion,
  armarDocumentoFirestore,
} = require('./analisisMercadoPrompts');

/* Narrativas de prueba con largo realista. parsearRespuestaRedaccion exige un
   mínimo por apartado, así que «<p>A</p>» ya no pasa la validación — y no debe
   pasarla: era el hueco por el que una cadena vacía se guardaba como narrativa y
   III.A/III.B salían en blanco en el informe en vez de con el marcador. */
const MUNDIAL_OK = '<p>La economía mundial creció 3,2 % en el período, según el FMI.</p>';
const COLOMBIA_OK = '<p>El PIB de Colombia creció 1,7 % en el período, según el DANE.</p>';

test('extraerJSON encuentra el objeto aunque venga envuelto en prosa y marcas markdown', () => {
  const texto = 'Aquí está el resultado:\n```json\n{"a": 1, "b": {"c": "x}y"}}\n```\nListo.';
  const obj = extraerJSON(texto);
  assert.deepStrictEqual(obj, { a: 1, b: { c: 'x}y' } });
});

test('extraerJSON lanza si no hay ninguna llave de apertura', () => {
  assert.throws(() => extraerJSON('sin json aquí'), /no contiene un objeto JSON/);
});

test('construirPromptBusqueda pide las 8 series y la ventana de 4 años', () => {
  const prompt = construirPromptBusqueda(2026);
  SERIES_MACRO.forEach((s) => assert.ok(prompt.includes(s.clave), 'falta la serie ' + s.clave));
  ['2024', '2025', '2026', '2027'].forEach((a) => assert.ok(prompt.includes(a), 'falta el año ' + a));
});

/* La confianza depende de que la respuesta haya venido de una búsqueda real
   (grounding no vacío), no de que la fuenteUrl del JSON coincida con la URI de
   algún chunk: los groundingChunks de Gemini son URLs de redirección de Google
   (vertexaisearch.cloud.google.com/grounding-api-redirect/…), nunca la URL del
   medio que el modelo cita. Comparándolas byte a byte, ninguna serie salía
   confiable jamás y el cron abortaba cada mes con «Ninguna serie trajo un dato
   confiable»: la colección de Firestore nunca se habría poblado. */

test('con grounding real, cada serie entra confiable y conserva la fuenteUrl que citó el modelo', () => {
  const texto = JSON.stringify({
    pib_mundial: { valores: { '2026': '3.2' }, fuente: 'FMI', fuenteUrl: 'https://imf.org/weo' },
    inflacion_colombia: { valores: { '2026': '3.8' }, fuente: 'DANE', fuenteUrl: 'https://dane.gov.co/ipc' },
  });
  // Las URIs reales del grounding: redirecciones de Google, no las del medio.
  const chunks = [
    { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123', title: 'imf.org' } },
  ];
  const series = parsearRespuestaBusqueda(texto, chunks);

  assert.strictEqual(series.pib_mundial.confiable, true);
  assert.strictEqual(series.pib_mundial.fuenteUrl, 'https://imf.org/weo');
  assert.strictEqual(series.inflacion_colombia.confiable, true);
  assert.strictEqual(series.inflacion_colombia.fuenteUrl, 'https://dane.gov.co/ipc');
});

test('sin grounding no se confía en ninguna serie y la fuenteUrl se descarta', () => {
  const texto = JSON.stringify({
    pib_mundial: { valores: { '2026': '3.2' }, fuente: 'FMI', fuenteUrl: 'https://imf.org/weo' },
  });
  [[], undefined, null].forEach((chunks) => {
    const series = parsearRespuestaBusqueda(texto, chunks);
    assert.strictEqual(series.pib_mundial.confiable, false, 'confió sin grounding: ' + JSON.stringify(chunks));
    assert.strictEqual(series.pib_mundial.fuenteUrl, null, 'conservó una URL recordada de memoria');
    // La cifra sigue ahí: la descarta actualizarAnalisisMercado por confiable:false.
    assert.deepStrictEqual(series.pib_mundial.valores, { 2026: '3.2' });
  });
});

test('con grounding, una serie sin fuenteUrl entra confiable con fuenteUrl null y no undefined', () => {
  /* undefined es un valor que Firestore rechaza; null se guarda sin problema. */
  const texto = JSON.stringify({ pib_mundial: { valores: { '2026': '3.2' }, fuente: 'FMI' } });
  const series = parsearRespuestaBusqueda(texto, [{ web: { uri: 'https://vertexaisearch.cloud.google.com/x' } }]);
  assert.strictEqual(series.pib_mundial.confiable, true);
  assert.strictEqual(series.pib_mundial.fuenteUrl, null);
});

test('una serie sin "fuente" declarada no queda sin respaldo declarado', () => {
  const texto = JSON.stringify({ pib_mundial: { valores: { '2026': '3.2' } } });
  const series = parsearRespuestaBusqueda(texto, [{ web: { uri: 'https://vertexaisearch.cloud.google.com/x' } }]);
  assert.strictEqual(series.pib_mundial.fuente, 'Fuente sin especificar');
});

test('parsearRespuestaBusqueda ignora claves que no están en SERIES_MACRO', () => {
  const texto = JSON.stringify({ serie_inventada: { valores: { '2026': '1' }, fuente: 'x', fuenteUrl: 'https://x' } });
  const series = parsearRespuestaBusqueda(texto, []);
  assert.deepStrictEqual(series, {});
});

test('parsearRespuestaBusqueda descarta una serie sin "valores"', () => {
  const texto = JSON.stringify({ pib_mundial: { fuente: 'FMI', fuenteUrl: 'https://fmi.example' } });
  const series = parsearRespuestaBusqueda(texto, []);
  assert.deepStrictEqual(series, {});
});

test('construirPromptRedaccion solo incluye las series verificadas, con su fuente', () => {
  const series = { pib_mundial: { valores: { '2026': '3.2' }, fuente: 'FMI', fuenteUrl: 'https://fmi.example' } };
  const prompt = construirPromptRedaccion(series, 2026);
  assert.ok(prompt.includes('pib_mundial'));
  assert.ok(prompt.includes('FMI'));
  assert.ok(prompt.includes('https://fmi.example'));
  assert.ok(prompt.includes('"mundial"') && prompt.includes('"colombia"'));
});

test('parsearRespuestaRedaccion exige mundial y colombia como texto', () => {
  const ok = parsearRespuestaRedaccion(JSON.stringify({ mundial: MUNDIAL_OK, colombia: COLOMBIA_OK }));
  assert.deepStrictEqual(ok, { mundial: MUNDIAL_OK, colombia: COLOMBIA_OK, fuentesCitadas: [] });
  assert.throws(() => parsearRespuestaRedaccion(JSON.stringify({ mundial: MUNDIAL_OK })), /mundial.*colombia/);
});

test('parsearRespuestaRedaccion rechaza un apartado vacío o de una línea suelta', () => {
  /* Sin este piso, un string vacío pasaba la validación de tipo y se guardaba
     como narrativa: III.A/III.B salían en blanco y ni el informe ni el banner
     avisaban de nada, porque para el lector la narrativa «existía». */
  [
    { mundial: '', colombia: COLOMBIA_OK },
    { mundial: MUNDIAL_OK, colombia: '' },
    { mundial: '   ', colombia: COLOMBIA_OK },
    { mundial: '<p></p>', colombia: COLOMBIA_OK },
    { mundial: MUNDIAL_OK, colombia: 'N/A' },
  ].forEach((caso) => {
    assert.throws(
      () => parsearRespuestaRedaccion(JSON.stringify(caso)),
      /vacío o demasiado corto/,
      'aceptó un apartado no redactado: ' + JSON.stringify(caso)
    );
  });
});

/* ─── fuentesCitadas: campo de apoyo, no crítico ───
   El numeral 4 del art. 1.2.2.2.1.5 del Decreto 1625 de 2016 exige fuente y
   fecha de consulta; esta lista es la que el informe imprime al cierre de III.B.
   Se parsea con tolerancia: una lista malformada no debe tirar por la borda una
   redacción por lo demás usable, a diferencia de la narrativa misma. */

test('construirPromptRedaccion pide fuentesCitadas y la muestra en la forma del JSON', () => {
  const series = { pib_mundial: { valores: { '2026': '3.2' }, fuente: 'FMI', fuenteUrl: 'https://fmi.example' } };
  const prompt = construirPromptRedaccion(series, 2026);
  assert.ok(prompt.includes('"fuentesCitadas"'), 'el prompt no pide fuentesCitadas');
  assert.ok(prompt.includes('"titulo"') && prompt.includes('"url"'), 'el prompt no describe la forma de cada fuente');
  assert.ok(prompt.includes('[{"titulo":"...","url":"..."}]'), 'el ejemplo de forma JSON no incluye fuentesCitadas');
  assert.ok(/no inventes ninguna fuente/i.test(prompt), 'el prompt no prohíbe inventar fuentes');
});

test('parsearRespuestaRedaccion extrae fuentesCitadas bien formadas', () => {
  const salida = parsearRespuestaRedaccion(JSON.stringify({
    mundial: MUNDIAL_OK,
    colombia: COLOMBIA_OK,
    fuentesCitadas: [{ titulo: 'FMI, WEO', url: 'https://imf.org/weo' }],
  }));
  assert.deepStrictEqual(salida.fuentesCitadas, [{ titulo: 'FMI, WEO', url: 'https://imf.org/weo' }]);
});

test('parsearRespuestaRedaccion degrada una fuentesCitadas malformada a [] sin lanzar', () => {
  const casos = [
    { mundial: MUNDIAL_OK, colombia: COLOMBIA_OK },
    { mundial: MUNDIAL_OK, colombia: COLOMBIA_OK, fuentesCitadas: 'FMI y DANE' },
    { mundial: MUNDIAL_OK, colombia: COLOMBIA_OK, fuentesCitadas: null },
    { mundial: MUNDIAL_OK, colombia: COLOMBIA_OK, fuentesCitadas: [{ titulo: 'sin url' }, { url: 'https://x' }, null, 7] },
  ];
  casos.forEach((caso) => {
    const salida = parsearRespuestaRedaccion(JSON.stringify(caso));
    assert.deepStrictEqual(salida.fuentesCitadas, [], 'no se degradó a [] con: ' + JSON.stringify(caso));
    assert.strictEqual(salida.mundial, MUNDIAL_OK, 'se perdió la narrativa por un campo de apoyo');
  });
});

test('parsearRespuestaRedaccion conserva las fuentes válidas y descarta solo las incompletas', () => {
  const salida = parsearRespuestaRedaccion(JSON.stringify({
    mundial: MUNDIAL_OK,
    colombia: COLOMBIA_OK,
    fuentesCitadas: [{ titulo: 'DANE', url: 'https://dane.gov.co' }, { titulo: 'sin url' }],
  }));
  assert.deepStrictEqual(salida.fuentesCitadas, [{ titulo: 'DANE', url: 'https://dane.gov.co' }]);
});

test('armarDocumentoFirestore rechaza guardar sin series o sin narrativa', () => {
  assert.throws(() => armarDocumentoFirestore({ series: {}, narrativa: { mundial: 'x', colombia: 'y' }, ahora: new Date() }), /ninguna serie/);
  assert.throws(() => armarDocumentoFirestore({ series: { pib_mundial: {} }, narrativa: null, ahora: new Date() }), /narrativa/);
});

test('armarDocumentoFirestore adjunta la fecha de consulta a cada serie', () => {
  const ahora = new Date('2026-08-01T06:00:00Z');
  const doc = armarDocumentoFirestore({
    series: { pib_mundial: { valores: { '2026': '3.2' }, fuente: 'FMI', fuenteUrl: 'https://fmi.example', confiable: true } },
    narrativa: { mundial: '<p>A</p>', colombia: '<p>B</p>' },
    ahora,
  });
  assert.strictEqual(doc.series.pib_mundial.fechaConsulta, ahora);
  assert.strictEqual(doc.narrativa.mundial, '<p>A</p>');
  assert.strictEqual(doc.actualizadoEn, ahora);
});

test('armarDocumentoFirestore lleva fuentesCitadas al documento, y [] si no vinieron', () => {
  const ahora = new Date('2026-08-01T06:00:00Z');
  const series = { pib_mundial: { valores: { '2026': '3.2' }, fuente: 'FMI', confiable: true } };
  const fuentes = [{ titulo: 'FMI, WEO', url: 'https://imf.org/weo' }];

  const conFuentes = armarDocumentoFirestore({
    series,
    narrativa: { mundial: '<p>A</p>', colombia: '<p>B</p>', fuentesCitadas: fuentes },
    ahora,
  });
  assert.deepStrictEqual(conFuentes.narrativa.fuentesCitadas, fuentes);

  /* El campo se guarda siempre, aunque venga vacío: Firestore no tiene esquema y
     un campo ausente obliga a cada lector a distinguir «sin fuentes» de «versión
     vieja del documento». */
  const sinFuentes = armarDocumentoFirestore({
    series,
    narrativa: { mundial: '<p>A</p>', colombia: '<p>B</p>' },
    ahora,
  });
  assert.deepStrictEqual(sinFuentes.narrativa.fuentesCitadas, []);
});

test('el ejemplo de crecimiento_por_region del prompt es admisible en Firestore', () => {
  /* Firestore prohíbe un arreglo dentro de un arreglo. Si el prompt le enseña a
     Gemini la forma vieja [["Mundial","3.0"]], el set() del cron falla y por ser
     escritura atómica se pierde el mes completo, no solo esa serie. */
  const prompt = construirPromptBusqueda(2026);
  assert.ok(
    prompt.includes('[{"region":"Mundial","valor":"3.0"}'),
    'el prompt no muestra la forma de objetos planos'
  );
  assert.ok(!prompt.includes('[["Mundial"'), 'el prompt sigue mostrando arreglos anidados');
});
