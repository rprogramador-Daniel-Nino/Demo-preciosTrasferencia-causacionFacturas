const { test } = require('node:test');
const assert = require('node:assert');
const {
  normalizarActividad,
  claveActividad,
  necesitaResumenActividad,
  recortarActividad,
  construirPromptResumenActividad,
  parsearRespuestaResumenActividad,
  construirPromptBusquedaSector,
  parsearRespuestaBusquedaSector,
  filtrarConfiables,
  construirPromptRedaccionSector,
  parsearRespuestaRedaccionSector,
  armarEntradaAnio,
  extraerJSON,
} = require('./analisisSectorPrompts');
const { URLS_BLOQUEADAS } = require('./urlsBloqueadas');

const URL_BLOQUEADA = [...URLS_BLOQUEADAS][0];

test('extraerJSON tolera una comilla doble sin escapar incrustada en un valor de texto', () => {
  const texto = '{"tituloSector": "de las telecomunicaciones", '
    + '"comportamiento": "<p>La empresa adoptó herramientas de "cloud computing" para operar.</p>"}';
  const obj = extraerJSON(texto);
  assert.strictEqual(obj.tituloSector, 'de las telecomunicaciones');
  assert.strictEqual(obj.comportamiento, '<p>La empresa adoptó herramientas de "cloud computing" para operar.</p>');
});

test('extraerJSON no confunde una coma de puntuación tras una frase citada con el fin de la cadena', () => {
  const texto = '{"comportamiento": "<p>El sector vive un "boom", según analistas del gremio.</p>"}';
  const obj = extraerJSON(texto);
  assert.strictEqual(obj.comportamiento, '<p>El sector vive un "boom", según analistas del gremio.</p>');
});

test('extraerJSON sigue lanzando cuando el JSON está genuinamente incompleto', () => {
  assert.throws(
    () => extraerJSON('{"tituloSector": "de las telecomunicaciones"'),
    /llaves sin cerrar/
  );
});

test('normalizarActividad ignora tildes, mayúsculas y espacios de sobra', () => {
  assert.strictEqual(
    normalizarActividad('  Fabricación de Software y Videojuegos  '),
    'fabricacion de software y videojuegos'
  );
});

test('normalizarActividad no revienta con entrada vacía o nula', () => {
  assert.strictEqual(normalizarActividad(''), '');
  assert.strictEqual(normalizarActividad(null), '');
  assert.strictEqual(normalizarActividad(undefined), '');
});

test('claveActividad es estable para el mismo texto normalizado', () => {
  const a = claveActividad(normalizarActividad('Fabricación de software'));
  const b = claveActividad(normalizarActividad('fabricacion de software'));
  assert.strictEqual(a, b);
  assert.ok(/^act_[a-z0-9]+$/.test(a), 'la clave no tiene la forma esperada');
});

test('claveActividad distingue actividades distintas', () => {
  const a = claveActividad(normalizarActividad('fabricacion de software'));
  const b = claveActividad(normalizarActividad('cultivo de cereales'));
  assert.notStrictEqual(a, b);
});

test('necesitaResumenActividad distingue una etiqueta corta de una descripción larga', () => {
  assert.strictEqual(necesitaResumenActividad('Desarrollo de videojuegos para dispositivos móviles'), false);
  const descripcionLarga = 'END GAME INTERACTIVE COLOMBIA S.A.S es una empresa especializada en el diseño y ' +
    'desarrollo de videojuegos para dispositivos móviles. Sus funciones principales abarcan el ciclo creativo.';
  assert.strictEqual(necesitaResumenActividad(descripcionLarga), true);
});

test('necesitaResumenActividad no revienta con entrada vacía o nula', () => {
  assert.strictEqual(necesitaResumenActividad(''), false);
  assert.strictEqual(necesitaResumenActividad(null), false);
  assert.strictEqual(necesitaResumenActividad(undefined), false);
});

test('recortarActividad deja intacto lo que ya es corto', () => {
  assert.strictEqual(recortarActividad('fabricación de software'), 'fabricación de software');
});

test('recortarActividad corta en un espacio, sin partir una palabra', () => {
  const larga = 'palabra1 palabra2 palabra3 palabra4 palabra5 palabra6 palabra7';
  const r = recortarActividad(larga, 30);
  assert.ok(r.length <= 30, 'el recorte no debe exceder el límite');
  assert.ok(larga.startsWith(r), 'el recorte debe ser un prefijo exacto de palabras completas');
  assert.strictEqual(larga[r.length], ' ', 'debe cortar justo en un espacio, no a mitad de palabra');
});

test('construirPromptResumenActividad incluye la descripción completa y pide una frase corta', () => {
  const prompt = construirPromptResumenActividad('una descripción larga cualquiera');
  assert.ok(prompt.includes('una descripción larga cualquiera'));
  assert.ok(prompt.includes('máximo 12 palabras'));
});

test('parsearRespuestaResumenActividad limpia comillas y punto final', () => {
  assert.strictEqual(
    parsearRespuestaResumenActividad('"desarrollo de videojuegos para dispositivos móviles."'),
    'desarrollo de videojuegos para dispositivos móviles'
  );
});

test('parsearRespuestaResumenActividad rechaza una respuesta vacía', () => {
  assert.throws(() => parsearRespuestaResumenActividad('   '), /vacío/);
  assert.throws(() => parsearRespuestaResumenActividad(''), /vacío/);
});

test('construirPromptBusquedaSector menciona la actividad y los tres años relevantes', () => {
  const prompt = construirPromptBusquedaSector('fabricación de software', 2025);
  assert.ok(prompt.includes('fabricación de software'));
  ['2024', '2025', '2026'].forEach((a) => assert.ok(prompt.includes(a), 'falta el año ' + a));
  assert.ok(prompt.includes('datosClaveTabla'));
});

test('parsearRespuestaBusquedaSector marca confiable según webSearchQueries, no groundingChunks (nunca llega con este modelo)', () => {
  const texto = JSON.stringify({
    datosClaveTabla: [
      { indicador: 'Empleo', valorAnterior: '100', valorActual: '120', fuente: 'DANE', fuenteUrl: 'https://dane.gov.co/x' },
    ],
    datosComportamiento: [{ dato: 'El sector creció.', fuente: 'DANE', fuenteUrl: 'https://dane.gov.co/y' }],
    datosComercioExterior: [],
    datosProyeccion: [],
  });
  const conBusqueda = parsearRespuestaBusquedaSector(texto, ['empleo sector software colombia 2025']);
  assert.strictEqual(conBusqueda.datosClaveTabla[0].confiable, true);
  assert.strictEqual(conBusqueda.datosClaveTabla[0].fuenteUrl, 'https://dane.gov.co/x');
  assert.strictEqual(conBusqueda.datosComportamiento[0].confiable, true);

  const sinBusqueda = parsearRespuestaBusquedaSector(texto, []);
  assert.strictEqual(sinBusqueda.datosClaveTabla[0].confiable, false);
  assert.strictEqual(sinBusqueda.datosClaveTabla[0].fuenteUrl, null, 'sin búsqueda real no debe conservar fuenteUrl');
});

test('parsearRespuestaBusquedaSector descarta una fuenteUrl de la lista negra aunque hubo búsqueda real', () => {
  const texto = JSON.stringify({
    datosClaveTabla: [
      { indicador: 'Empleo', valorAnterior: '100', valorActual: '120', fuente: 'FMI', fuenteUrl: URL_BLOQUEADA },
    ],
    datosComportamiento: [{ dato: 'El sector creció.', fuente: 'FMI', fuenteUrl: URL_BLOQUEADA }],
  });
  const r = parsearRespuestaBusquedaSector(texto, ['búsqueda real']);
  assert.strictEqual(r.datosClaveTabla[0].fuenteUrl, null);
  assert.strictEqual(r.datosClaveTabla[0].valorActual, '120', 'se perdió la cifra por una URL bloqueada');
  assert.strictEqual(r.datosComportamiento[0].fuenteUrl, null);
});

test('parsearRespuestaBusquedaSector descarta filas de la tabla sin indicador o sin valorActual', () => {
  const texto = JSON.stringify({
    datosClaveTabla: [
      { indicador: 'Empleo', valorActual: '120' },
      { indicador: '', valorActual: '999' },
      { valorActual: '999' },
      { indicador: 'Sin valor actual' },
    ],
  });
  const r = parsearRespuestaBusquedaSector(texto, []);
  assert.strictEqual(r.datosClaveTabla.length, 1);
  assert.strictEqual(r.datosClaveTabla[0].indicador, 'Empleo');
});

test('parsearRespuestaBusquedaSector acota datosClaveTabla a 6 filas', () => {
  const filas = Array.from({ length: 10 }, (_, i) => ({ indicador: 'Fila ' + i, valorActual: String(i) }));
  const texto = JSON.stringify({ datosClaveTabla: filas });
  const r = parsearRespuestaBusquedaSector(texto, []);
  assert.strictEqual(r.datosClaveTabla.length, 6);
});

test('filtrarConfiables descarta lo que no vino de una búsqueda real', () => {
  const datos = {
    datosClaveTabla: [{ confiable: true, indicador: 'A' }, { confiable: false, indicador: 'B' }],
    datosComportamiento: [{ confiable: false, dato: 'x' }],
    datosComercioExterior: [{ confiable: true, dato: 'y' }],
    datosProyeccion: [],
  };
  const r = filtrarConfiables(datos);
  assert.strictEqual(r.datosClaveTabla.length, 1);
  assert.strictEqual(r.datosClaveTabla[0].indicador, 'A');
  assert.strictEqual(r.datosComportamiento.length, 0);
  assert.strictEqual(r.datosComercioExterior.length, 1);
});

test('construirPromptRedaccionSector incluye la actividad, el resumen de datos y pide los 4 apartados', () => {
  const datos = {
    datosClaveTabla: [{ indicador: 'Empleo', valorAnterior: '100', valorActual: '120', fuente: 'DANE' }],
    datosComportamiento: [{ dato: 'Creció 20%.', fuente: 'DANE' }],
    datosComercioExterior: [],
    datosProyeccion: [],
  };
  const prompt = construirPromptRedaccionSector(datos, 'fabricación de software', 2025);
  assert.ok(prompt.includes('fabricación de software'));
  assert.ok(prompt.includes('Empleo: 2024=100, 2025=120'));
  assert.ok(prompt.includes('Creció 20%.'));
  assert.ok(
    prompt.includes('"tituloSector"') && prompt.includes('"comportamiento"') &&
    prompt.includes('"comercioExterior"') && prompt.includes('"proyeccion"') && prompt.includes('"conclusiones"')
  );
});

test('construirPromptRedaccionSector no rompe si no hay ningún dato verificado', () => {
  const vacio = { datosClaveTabla: [], datosComportamiento: [], datosComercioExterior: [], datosProyeccion: [] };
  const prompt = construirPromptRedaccionSector(vacio, 'una actividad rara', 2025);
  assert.ok(prompt.includes('(sin datos verificados)'));
});

test('parsearRespuestaRedaccionSector exige tituloSector y los 4 apartados con contenido suficiente', () => {
  const ok = parsearRespuestaRedaccionSector(JSON.stringify({
    tituloSector: 'la industria del software',
    comportamiento: '<p>El sector mostró un comportamiento estable durante el período.</p>',
    comercioExterior: '<p>Las exportaciones del sector crecieron de forma moderada.</p>',
    proyeccion: '<p>Se espera una expansión continuada del sector el próximo año.</p>',
    conclusiones: '<p>El sector es relevante para la comparabilidad del estudio.</p>',
  }));
  assert.strictEqual(ok.tituloSector, 'la industria del software');
  assert.strictEqual(typeof ok.comportamiento, 'string');
  assert.deepStrictEqual(ok.fuentesCitadas, []);

  assert.throws(() => parsearRespuestaRedaccionSector(JSON.stringify({
    comportamiento: '<p>bien</p>', comercioExterior: '<p>bien</p>', proyeccion: '<p>bien</p>', conclusiones: '<p>bien</p>',
  })), /tituloSector/, 'debió exigir tituloSector');

  assert.throws(() => parsearRespuestaRedaccionSector(JSON.stringify({
    tituloSector: 'x',
    comportamiento: 'N/A', comercioExterior: '<p>bien</p>', proyeccion: '<p>bien</p>', conclusiones: '<p>bien</p>',
  })), /comportamiento/);
});

test('parsearRespuestaRedaccionSector descarta una fuenteCitada cuya URL está en la lista negra', () => {
  const largo = '<p>Texto suficientemente largo para pasar la validación mínima de contenido.</p>';
  const r = parsearRespuestaRedaccionSector(JSON.stringify({
    tituloSector: 'la industria del software',
    comportamiento: largo, comercioExterior: largo, proyeccion: largo, conclusiones: largo,
    fuentesCitadas: [{ titulo: 'DANE', url: 'https://dane.gov.co' }, { titulo: 'Artículo roto', url: URL_BLOQUEADA }],
  }));
  assert.deepStrictEqual(r.fuentesCitadas, [{ titulo: 'DANE', url: 'https://dane.gov.co' }]);
});

test('parsearRespuestaRedaccionSector conserva fuentesCitadas bien formadas y descarta las incompletas', () => {
  const largo = '<p>Texto suficientemente largo para pasar la validación mínima de contenido.</p>';
  const r = parsearRespuestaRedaccionSector(JSON.stringify({
    tituloSector: 'la industria del software',
    comportamiento: largo, comercioExterior: largo, proyeccion: largo, conclusiones: largo,
    fuentesCitadas: [{ titulo: 'DANE', url: 'https://dane.gov.co' }, { titulo: 'Sin URL' }, null],
  }));
  assert.strictEqual(r.fuentesCitadas.length, 1);
  assert.strictEqual(r.fuentesCitadas[0].titulo, 'DANE');
});

test('construirPromptRedaccionSector pide el apartado "introduccion"', () => {
  const prompt = construirPromptRedaccionSector({
    datosClaveTabla: [], datosComportamiento: [], datosComercioExterior: [], datosProyeccion: [],
  }, 'desarrollo de videojuegos', 2025);
  assert.ok(prompt.includes('introduccion'), 'el prompt no pide "introduccion"');
});

test('el prompt fija una extensión mínima para cada apartado de III.C', () => {
  /* Medido sobre las tres últimas corridas el 2026-08-13: introducción ~70 palabras en 1
     párrafo, comportamiento ~250 en 2, comercio exterior ~160 en 1, proyección ~120 en 1 y
     conclusiones ~250 en 2. Para el análisis de sector de un informe local eso se queda
     corto, y el prompt no pedía un mínimo explícito de ninguno. */
  const prompt = construirPromptRedaccionSector(
    { datosClaveTabla: [], datosComportamiento: [], datosComercioExterior: [], datosProyeccion: [] },
    'videojuegos', 2025);

  for (const campo of ['introduccion', 'comportamiento', 'comercioExterior', 'proyeccion', 'conclusiones']) {
    const i = prompt.indexOf('"' + campo + '"');
    assert.ok(i > 0, 'el prompt no menciona ' + campo);
    const bloque = prompt.slice(i, i + 900);
    assert.ok(/\d{3}\s*palabras/.test(bloque),
      'no se le fija un mínimo de palabras a "' + campo + '"');
  }

  /* Extenderse NO puede volverse permiso para rellenar ni para inventar cifras. */
  assert.ok(/no rellenes|sin rellenar|no repitas la misma cifra/i.test(prompt),
    'no advierte contra el relleno');
  assert.ok(/NO menciones ninguna cifra que no esté en los datos/i.test(prompt),
    'se perdió la prohibición de inventar cifras');
});

test('el prompt explica CÓMO extenderse sin inventar datos', () => {
  /* Si solo se le pide longitud, la saca repitiendo la cifra o adornando. Se le dice que la
     extensión sale de desarrollar el mecanismo y la implicación, que es analisis y no relleno. */
  const prompt = construirPromptRedaccionSector(
    { datosClaveTabla: [], datosComportamiento: [], datosComercioExterior: [], datosProyeccion: [] },
    'videojuegos', 2025);
  assert.ok(/implicaci|mecanismo|por qué/i.test(prompt));
  assert.ok(/parte examinada/i.test(prompt));
});

test('el prompt pide una introducción desarrollada, no un par de frases', () => {
  /* La primera versión pedía «1-2 frases» y salían ~470 caracteres: el usuario la reportó
     como demasiado corta el 2026-08-13. Es el párrafo de entrada de III.C, el que sitúa el
     sector antes del detalle, y tiene que sostenerse solo. */
  const prompt = construirPromptRedaccionSector(
    { datosClaveTabla: [], datosComportamiento: [], datosComercioExterior: [], datosProyeccion: [] },
    'videojuegos', 2025);

  assert.ok(!/1-2 frases/.test(prompt), 'el prompt sigue pidiendo 1-2 frases');
  assert.ok(/2 a 3 párrafos|2-3 párrafos/i.test(prompt), 'no pide párrafos desarrollados');
  /* Y que no se convierta en un resumen de los otros apartados. */
  assert.ok(/no adelantes|sin adelantar|no repitas/i.test(prompt),
    'no advierte contra adelantar el contenido de los otros apartados');
});

test('parsearRespuestaRedaccionSector acepta la introducción aunque venga corta', () => {
  /* Pedirla más larga no puede volverse un motivo de descarte: una introducción corta es
     mejor que ninguna, porque sin ella el hueco de III.C sale con el marcador de
     pendiente, que es justo lo que no queremos volver a ver. */
  const texto = JSON.stringify({
    tituloSector: 'de videojuegos',
    introduccion: '<p>El sector de videojuegos creció en 2025 de forma sostenida.</p>',
    comportamiento: '<p>El sector generó 250.000 empleos, un 13,7% más que en 2024.</p>',
    comercioExterior: '<p>Las exportaciones sumaron USD 655 millones en el Q3.</p>',
    proyeccion: '<p>Se proyecta un CAGR del 11% hasta 2035 según el estudio citado.</p>',
    conclusiones: '<p>El sector crece pero con márgenes bajo presión competitiva.</p>',
  });
  const r = parsearRespuestaRedaccionSector(texto);
  assert.ok(r.introduccion.includes('creció en 2025'));
});

test('parsearRespuestaRedaccionSector incluye "introduccion" cuando viene con contenido', () => {
  const texto = JSON.stringify({
    tituloSector: 'de los videojuegos',
    introduccion: '<p>El sector de videojuegos en Colombia mostró dinamismo en 2025.</p>',
    comportamiento: '<p>Creció un 11 % frente a 2024, según 6Wresearch.</p>',
    comercioExterior: '<p>Las exportaciones subieron 419 % en 2024, según ProColombia.</p>',
    proyeccion: '<p>Se proyecta un CAGR del 11 % para 2026.</p>',
    conclusiones: '<p>El segmento móvil concentra el mayor dinamismo del sector.</p>',
  });
  const r = parsearRespuestaRedaccionSector(texto);
  assert.ok(r.introduccion.includes('dinamismo'));
});

test('parsearRespuestaRedaccionSector no exige "introduccion" para aceptar la redacción', () => {
  const texto = JSON.stringify({
    tituloSector: 'de los videojuegos',
    comportamiento: '<p>Creció un 11 % frente a 2024, según 6Wresearch.</p>',
    comercioExterior: '<p>Las exportaciones subieron 419 % en 2024, según ProColombia.</p>',
    proyeccion: '<p>Se proyecta un CAGR del 11 % para 2026.</p>',
    conclusiones: '<p>El segmento móvil concentra el mayor dinamismo del sector.</p>',
  });
  const r = parsearRespuestaRedaccionSector(texto);
  assert.strictEqual('introduccion' in r, false);
});

test('armarEntradaAnio exige narrativa y arma la forma final, con el tituloSector que redactó Claude', () => {
  const ahora = new Date('2026-08-04T00:00:00Z');
  assert.throws(() => armarEntradaAnio({ datosVerificados: { datosClaveTabla: [] }, narrativa: null, ahora }), /narrativa/);

  const entrada = armarEntradaAnio({
    datosVerificados: { datosClaveTabla: [{ indicador: 'Empleo', valorActual: '120' }] },
    narrativa: {
      tituloSector: 'la industria del software',
      comportamiento: '<p>A</p>', comercioExterior: '<p>B</p>', proyeccion: '<p>C</p>', conclusiones: '<p>D</p>', fuentesCitadas: [],
    },
    ahora,
  });
  assert.strictEqual(entrada.tituloSector, 'la industria del software');
  assert.strictEqual(entrada.actualizadoEn, ahora);
  assert.strictEqual(entrada.datosClaveTabla.length, 1);
  assert.strictEqual(entrada.narrativa.comportamiento, '<p>A</p>');
});
