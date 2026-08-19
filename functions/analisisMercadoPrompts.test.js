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

test('construirPromptBusqueda nombra dónde buscar la PROYECCIÓN de las series históricas', () => {
  /* `desempleo_colombia` y `trm_promedio` eran las dos únicas series que volvían sin el año
     de proyección (medido en Firestore el 2026-08-13: las demás traían 2026 y hasta 2027).
     La causa es que el prompt las anclaba a DANE y al Banco de la República, que publican el
     dato realizado y no un pronóstico, así que el modelo omitía ese año — correctamente,
     porque la regla 3 le prohíbe inventarlo. El informe salía con
     «Desempleo Proyectado 2026: [Completar…]». */
  const prompt = construirPromptBusqueda(2026);

  assert.ok(/proyecci[oó]n/i.test(prompt), 'el prompt no menciona la proyección');
  /* Que se diga explícitamente cuáles son los años a proyectar, no solo la ventana. */
  assert.ok(prompt.includes('2027'), 'no se nombra el año de proyección del cron (anioActual+1)');

  const proyectables = SERIES_MACRO.filter((s) => s.fuenteProyeccion);
  assert.ok(proyectables.length >= 2, 'ninguna serie declara fuente de proyección');
  proyectables.forEach((s) => {
    assert.ok(prompt.includes(s.fuenteProyeccion),
      'el prompt no dice dónde buscar la proyección de ' + s.clave);
  });

  const claves = proyectables.map((s) => s.clave);
  assert.ok(claves.includes('desempleo_colombia'), 'desempleo_colombia sin fuente de proyección');
  assert.ok(claves.includes('trm_promedio'), 'trm_promedio sin fuente de proyección');
});

test('construirPromptBusqueda pide la proyección de DOS años, no solo anioActual+1', () => {
  /* Un informe de año gravable 2025 (anioActual - 1, el caso más común: se radica el año
     después del que declara) necesita 2026 como SU año de proyección — y para el cron
     `anioActual` (2026) es "el año en curso", no "el año de proyección", así que la
     pregunta genérica de DANE no encuentra nada (2026 no ha cerrado) y el informe sale con
     «Desempleo Proyectado 2026: [Completar...]» aunque el fix de fuenteProyeccion ya exista
     para el año que el cron SÍ trata como proyección (anioActual+1 = 2027). */
  const prompt = construirPromptBusqueda(2026);

  assert.ok(/2026 y 2027/.test(prompt),
    'el prompt no pide fuente de proyección para los dos años (anioActual y anioActual+1)');

  const proyectables = SERIES_MACRO.filter((s) => s.fuenteProyeccion);
  proyectables.forEach((s) => {
    /* La línea de instrucción de cada serie proyectable, sin depender de una regex con
       caracteres especiales del texto de `fuenteProyeccion` (trae comas y paréntesis). */
    const linea = prompt.split('\n').find((l) => l.includes('"' + s.clave + '"') && l.includes('consulta'));
    assert.ok(linea, 'no hay línea de instrucción de proyección para ' + s.clave);
    assert.ok(linea.includes('2026 y 2027'),
      'la instrucción de fuente de proyección de ' + s.clave + ' no cubre 2026 y 2027 juntos');
    assert.ok(linea.includes(s.fuenteProyeccion),
      'la línea de ' + s.clave + ' no trae su fuenteProyeccion completa');
  });

  /* El ejemplo de JSON tiene que mostrar la forma {valor, fuente, fuenteUrl} para AMBOS años
     de riesgo, no solo para uno — si el modelo solo ve el ejemplo con un año, tiende a
     replicar nada más ese patrón para ese único año. */
  const ejemplo = prompt.slice(prompt.indexOf('"desempleo_colombia": { "valores"'));
  assert.ok(/"2025"\s*:\s*"8\.9"/.test(ejemplo), 'el ejemplo no muestra 2025 como valor simple');
  assert.ok(/"2026"\s*:\s*\{\s*"valor"/.test(ejemplo), 'el ejemplo no muestra 2026 con fuente propia');
  assert.ok(/"2027"\s*:\s*\{\s*"valor"/.test(ejemplo), 'el ejemplo no muestra 2027 con fuente propia');
});

test('el prompt manda insistir en otra fuente y devolver el enlace pegado a ese valor', () => {
  /* Dejar «[Completar…]» en el informe no es una salida aceptable: es trabajo que queda
     para quien lo radica. Si el publicador habitual no proyecta, hay que buscar en quien
     sí, y el valor tiene que traer SU propia fuente y URL —no la del pie de la tabla, que
     respalda otra cosa— para poder verificarlo. */
  const prompt = construirPromptBusqueda(2026);

  assert.ok(/no te rindas|sigue buscando|insiste/i.test(prompt),
    'el prompt no manda insistir en otra fuente');
  /* La forma por valor, con su fuente y su URL. */
  assert.ok(/"valor"\s*:/.test(prompt), 'el prompt no muestra la forma { valor, fuente, fuenteUrl }');
  assert.ok(/fuenteUrl/.test(prompt));
  assert.ok(/distinta|distinto|otra fuente/i.test(prompt),
    'no se explica cuándo usar la forma con fuente propia');
});

test('parsearRespuestaBusqueda conserva la fuente propia de un valor de proyección', () => {
  const texto = JSON.stringify({
    desempleo_colombia: {
      valores: {
        2025: '8.9',
        2026: { valor: '8.5', fuente: 'FMI, WEO', fuenteUrl: 'https://www.imf.org/weo' },
      },
      fuente: 'DANE, GEIH',
      fuenteUrl: 'https://www.dane.gov.co/geih',
    },
  });
  const series = parsearRespuestaBusqueda(texto, [{ web: { uri: 'https://x' } }]);
  assert.deepStrictEqual(series.desempleo_colombia.valores[2026], {
    valor: '8.5', fuente: 'FMI, WEO', fuenteUrl: 'https://www.imf.org/weo',
  });
  assert.strictEqual(series.desempleo_colombia.valores[2025], '8.9');
});

test('parsearRespuestaBusqueda descarta una URL que dos series distintas reclaman como propia', () => {
  /* Caso real de producción (2026-08-19): la misma URL —un artículo sobre el
     crecimiento del PIB— salió como fuenteUrl tanto de pib_colombia como de
     desempleo_colombia, y encima daba 404. No hay forma de saber a cuál de las dos
     pertenece de verdad, así que se descarta en ambas; la cifra y el nombre de la
     fuente se conservan. */
  const urlCompartida = 'https://www.swissinfo.ch/spa/el-fmi-reduce-la-prevision';
  const texto = JSON.stringify({
    pib_colombia: {
      valores: { 2026: '2.3', 2027: { valor: '2.5', fuente: 'FMI, WEO', fuenteUrl: urlCompartida } },
      fuente: 'DANE, Cuentas Nacionales',
      fuenteUrl: 'https://www.dane.gov.co/cuentas-nacionales',
    },
    desempleo_colombia: {
      valores: {
        2025: '8.9',
        2026: { valor: '9.0', fuente: 'FMI, WEO', fuenteUrl: urlCompartida },
      },
      fuente: 'DANE, GEIH',
      fuenteUrl: 'https://www.dane.gov.co/geih',
    },
  });
  const series = parsearRespuestaBusqueda(texto, [{ web: { uri: 'https://x' } }]);

  assert.deepStrictEqual(series.pib_colombia.valores[2027],
    { valor: '2.5', fuente: 'FMI, WEO', fuenteUrl: null });
  assert.deepStrictEqual(series.desempleo_colombia.valores[2026],
    { valor: '9.0', fuente: 'FMI, WEO', fuenteUrl: null });
  /* Las fuentes de nivel de serie no se comparten entre estas dos, así que no se tocan. */
  assert.strictEqual(series.pib_colombia.fuenteUrl, 'https://www.dane.gov.co/cuentas-nacionales');
  assert.strictEqual(series.desempleo_colombia.fuenteUrl, 'https://www.dane.gov.co/geih');
});

test('parsearRespuestaBusqueda conserva una URL repetida DENTRO de la misma serie', () => {
  /* Un solo informe del FMI puede cubrir varios años de la MISMA serie -eso no es el
     caso sospechoso, es lo normal-, así que no se descarta. */
  const urlDelInforme = 'https://www.imf.org/weo-abril-2026';
  const texto = JSON.stringify({
    desempleo_colombia: {
      valores: {
        2025: '8.9',
        2026: { valor: '9.0', fuente: 'FMI, WEO', fuenteUrl: urlDelInforme },
        2027: { valor: '10.0', fuente: 'FMI, WEO', fuenteUrl: urlDelInforme },
      },
      fuente: 'DANE, GEIH',
      fuenteUrl: 'https://www.dane.gov.co/geih',
    },
  });
  const series = parsearRespuestaBusqueda(texto, [{ web: { uri: 'https://x' } }]);

  assert.strictEqual(series.desempleo_colombia.valores[2026].fuenteUrl, urlDelInforme);
  assert.strictEqual(series.desempleo_colombia.valores[2027].fuenteUrl, urlDelInforme);
});

test('parsearRespuestaBusqueda no toca la URL de nivel de serie cuando es de esa serie sola', () => {
  const texto = JSON.stringify({
    pib_mundial: {
      valores: { 2026: '3.2' },
      fuente: 'FMI, WEO',
      fuenteUrl: 'https://www.imf.org/weo-mundial',
    },
  });
  const series = parsearRespuestaBusqueda(texto, [{ web: { uri: 'https://x' } }]);
  assert.strictEqual(series.pib_mundial.fuenteUrl, 'https://www.imf.org/weo-mundial');
});

test('la regla de no inventar sobrevive a la instrucción de proyección', () => {
  /* Pedirle una proyección no puede convertirse en permiso para estimarla él mismo: la
     cifra sigue teniendo que salir de una página consultada. */
  const prompt = construirPromptBusqueda(2026);
  assert.ok(/no la rellenes con un valor inventado/i.test(prompt));
  assert.ok(/no la[s]? estimes|no la[s]? calcules|no inventes/i.test(prompt));
});

test('el prompt manda buscar y NO exige que la respuesta sea solo el JSON', () => {
  /* Esto es lo que tenía muerta la Sección III. Con «Responde ÚNICAMENTE con un objeto
     JSON (sin texto adicional)», Gemini se salta la búsqueda y contesta de memoria:
     devolvía las ocho series completas y bien formadas, pero con `groundingChunks` vacío,
     y como la confiabilidad se mide justo por ahí, la corrida se descartaba entera. Un mes
     por intento.

     Medido en producción el 2026-08-12: con la exigencia de formato, grounding=0 y ninguna
     serie guardada; pidiendo primero buscar y citar, grounding=32 y las ocho series con
     fuente del DANE, el Banco de la República y el FMI.

     `extraerJSON` escanea llaves balanceadas, así que el JSON se recupera igual venga con
     prosa o con markdown alrededor: no hace falta prohibirle escribir. */
  const prompt = construirPromptBusqueda(2026);
  assert.ok(/Busca en la web/i.test(prompt), 'tiene que ordenar buscar');
  assert.ok(/NO respondas con cifras que recuerdes/i.test(prompt), 'y prohibir contestar de memoria');
  assert.ok(!/ÚNICAMENTE con un objeto JSON/i.test(prompt),
    'no puede volver la exigencia de responder solo el JSON: apaga la búsqueda');
  assert.ok(!/sin texto adicional/i.test(prompt),
    'ni la de no añadir texto, por el mismo motivo');
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

const TEMA_OK = '<p>La inflación mundial se moderó al 4,1 % en el período, según el FMI.</p>';

test('construirPromptRedaccion pide los 7 apartados por tema, no solo mundial/colombia', () => {
  const prompt = construirPromptRedaccion({}, 2026);
  ['inflacionMundial', 'proyeccionMundial', 'inflacionColombia', 'politicaMonetaria',
    'tasaCambio', 'mercadoLaboral', 'conclusiones'].forEach((campo) => {
    assert.ok(prompt.includes(campo), 'el prompt no pide el campo ' + campo);
  });
});

test('parsearRespuestaRedaccion incluye un tema cuando Claude lo trae con contenido suficiente', () => {
  const texto = JSON.stringify({
    mundial: MUNDIAL_OK, colombia: COLOMBIA_OK, inflacionMundial: TEMA_OK,
  });
  const r = parsearRespuestaRedaccion(texto);
  assert.strictEqual(r.inflacionMundial, TEMA_OK);
});

test('parsearRespuestaRedaccion omite un tema ausente sin lanzar ni afectar mundial/colombia', () => {
  const texto = JSON.stringify({ mundial: MUNDIAL_OK, colombia: COLOMBIA_OK });
  const r = parsearRespuestaRedaccion(texto);
  assert.strictEqual(r.mundial, MUNDIAL_OK);
  assert.strictEqual('inflacionMundial' in r, false);
});

test('parsearRespuestaRedaccion omite un tema demasiado corto para ser un párrafo real', () => {
  const texto = JSON.stringify({
    mundial: MUNDIAL_OK, colombia: COLOMBIA_OK, politicaMonetaria: '<p>Sí.</p>',
  });
  const r = parsearRespuestaRedaccion(texto);
  assert.strictEqual('politicaMonetaria' in r, false);
});

test('armarDocumentoFirestore guarda solo los temas que sí vinieron, sin claves undefined', () => {
  const doc = armarDocumentoFirestore({
    series: { pib_mundial: { valores: { 2026: '3' }, fuente: 'FMI', fuenteUrl: 'https://fmi.org', confiable: true } },
    narrativa: { mundial: MUNDIAL_OK, colombia: COLOMBIA_OK, fuentesCitadas: [], tasaCambio: TEMA_OK },
    ahora: new Date('2026-08-13T00:00:00Z'),
  });
  assert.strictEqual(doc.narrativa.tasaCambio, TEMA_OK);
  assert.strictEqual('inflacionMundial' in doc.narrativa, false);
});
