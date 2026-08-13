import { test } from 'node:test';
import assert from 'node:assert';
import {
  DATOS_MACRO,
  FUENTES_MACRO,
  generarApartadoSectorial,
  valorODisponible,
  proyectarPorTendencia,
  cifraODisponible,
  corridaSectorIncompleta,
  fuenteDatosClaveSector,
  generarApartadoMundial,
  generarApartadoColombia,
  generarTablaPibMundial,
  generarTablaInflacionGlobal,
  generarTablaInflacionColombia,
  generarTablaCrecimientoPorRegion,
  generarTablaTasaIntervencion,
  generarTablaDesempleo,
  generarTablaTRM,
  tituloSectorial,
  normalizarActividad,
  claveActividad,
} from './analisisMercado.js';

/* Cliente que NO es del sector de videojuegos: el apartado sectorial tiene que
   hablar de SU actividad. */
const otroCliente = {
  ent: 'ACME AGROINDUSTRIAL S.A.S',
  nit: '800123456-7',
  anio: 2026,
  ciiu: '0111',
  objeto: 'Cultivo de cereales y producción de alimentos concentrados para animales',
};

/* ─── Las ocho tablas macro se titulan y se pueblan con el año del estudio ───
   Antes estos casos pasaban por `hydrateExactWordTemplate`, que localizaba la tabla
   en el HTML del informe de End Game por su título literal y la sustituía. Esa ruta
   se retiró: ahora la tabla se escribe directamente en el OOXML de la plantilla del
   cliente (`docxRelleno.js:actualizarTablasMacroOoxml`) y quien decide su contenido
   es el generador, que es lo que se prueba aquí. */

test('cada tabla macro se titula con la ventana de años del estudio', () => {
  const esperados = [
    [generarTablaInflacionGlobal, 'Tasas de Inflación Global (2025-2027)'],
    [generarTablaCrecimientoPorRegion, 'Proyecciones de Crecimiento del PIB por Región/País (2026)'],
    [generarTablaInflacionColombia, 'Inflación en Colombia (2026 vs. Meta 2027)'],
    [generarTablaTRM, 'Tasa Representativa del Mercado (TRM) Promedio (2025-2026)'],
    [generarTablaDesempleo, 'Tasa de Desempleo en Colombia (2026 vs. Proyección 2027)'],
  ];
  for (const [gen, titulo] of esperados) {
    const salida = gen(null, 2026, (v) => String(v));
    assert.ok(salida.includes(titulo), 'la tabla no se tituló con el año del estudio: ' + titulo);
  }
});

test('la tabla de tasa de intervención conserva la etiqueta original de cada observación', () => {
  /* El 13,25 % es de marzo de 2023, no del cierre del año: reetiquetarlo como
     «2023» daría por anual el máximo de un mes. */
  const salida = generarTablaTasaIntervencion(null, 2024, (v) => String(v));
  assert.ok(salida.includes('Marzo 2023 (máximo del ciclo)'), 'se perdió la etiqueta real de la observación');
  assert.ok(salida.includes('Diciembre 2024'), 'falta la observación del año gravable');
  assert.ok(
    salida.includes('Tasa de Intervención del Banco de la República (Marzo 2023 (máximo del ciclo) - Diciembre 2024)'),
    'el título no se armó con las etiquetas reales de las dos observaciones'
  );
});

test('un año sin datos se estima sobre la serie, con su método a la vista y sin guion mudo', () => {
  /* Antes esta prueba EXIGÍA el marcador «[Completar...]». El criterio cambió el
     2026-08-13 por decisión del usuario: la Sección III no puede radicarse con casillas
     por completar, porque eso no es una salvaguarda sino trabajo que queda para quien
     firma. Con serie suficiente se calcula y se declara cómo; el marcador queda solo para
     cuando no hay ni con qué calcular (ver la prueba siguiente). */
  const salida = generarTablaTRM(null, 2031, (v) => String(v));
  assert.ok(!salida.includes('[Completar con la TRM promedio de 2031'), 'dejó la casilla por completar');
  assert.ok(/estimación propia/i.test(salida), 'no se declaró que la cifra es una estimación');
  assert.ok(/R²/.test(salida), 'no se publicó la calidad del ajuste');
  assert.ok(/no es una cifra publicada/i.test(salida), 'no se advierte que no es un dato publicado');
  assert.ok(!salida.includes('>—<'), 'quedó un guion mudo');
});

test('el marcador sobrevive solo donde no hay serie con la que estimar', () => {
  /* Dos observaciones no bastan (MIN_OBSERVACIONES_TENDENCIA): ahí sí, hueco declarado
     antes que una cifra sin respaldo ni ajuste que enseñar. */
  const salida = generarTablaTRM(
    { series: { trm_promedio: { valores: { 2030: '4000', 2031: '4100' } } } },
    2033, (v) => String(v));
  assert.ok(salida.includes('[Completar con la TRM promedio de 2033'), 'no se marcó el dato ausente');
  assert.ok(salida.includes('Decreto 1625 de 2016'), 'el marcador no invoca la obligación de citar la fuente');
});

test('el desempleo del año siguiente sale como proyección y no repite el del año en curso', () => {
  const salida = generarTablaDesempleo(null, 2024, (v) => String(v));
  assert.ok(salida.includes('9.7'), 'falta el desempleo de 2024');
  assert.ok(salida.includes('9.0'), 'falta la proyección de 2025');
});

test('con datosMacro vacío se cae al respaldo local y se estima sobre él, no al hueco', () => {
  /* `series: {}` hace que `resolverSerie` caiga a DATOS_MACRO, que sí trae TRM: hay con
     qué estimar, así que la casilla no puede salir por completar. */
  const salida = generarTablaTRM({ series: {} }, 2031, (v) => String(v));
  assert.ok(!salida.includes('[Completar con la TRM promedio de 2031'), 'dejó la casilla por completar');
  assert.ok(/estimación propia/i.test(salida));
});

test('con datosMacro de Firestore, la tabla usa esas cifras y esa fuente, no el respaldo local', () => {
  const datosMacro = {
    series: {
      pib_mundial: { valores: { '2026': '9.9' }, fuente: 'Fuente de prueba', fuenteUrl: 'https://prueba.example' },
    },
  };
  const salida = generarTablaPibMundial(datosMacro, 2026, (v) => String(v));
  assert.ok(salida.includes('9.9'), 'no usó la cifra de Firestore');
  assert.ok(!salida.includes('3.2'), 'usó la cifra del respaldo local en vez de la de Firestore');
  assert.ok(salida.includes('Fuente de prueba'), 'no citó la fuente de Firestore');
});

test('sin datosMacro (null), la tabla cae al respaldo DATOS_MACRO embebido', () => {
  const salida = generarTablaPibMundial(null, 2025, (v) => String(v));
  assert.ok(salida.includes('3.2'), 'no cayó al valor del respaldo local para 2025');
});

test('generarApartadoMundial usa la narrativa de Firestore cuando existe, y le agrega las 3 tablas que la narrativa no trae incrustadas', () => {
  const datosMacro = { narrativa: { mundial: '<p>Texto redactado por IA sobre la economía mundial.</p>' } };
  const salida = generarApartadoMundial(datosMacro, 2026, (v) => String(v));
  assert.ok(salida.startsWith('<p>Texto redactado por IA sobre la economía mundial.</p>'), 'no empieza con la narrativa');
  assert.ok(salida.includes('Crecimiento del PIB Mundial ('), 'falta la tabla de PIB mundial');
  assert.ok(salida.includes('Tasas de Inflación Global ('), 'falta la tabla de inflación global');
  assert.ok(salida.includes('Proyecciones de Crecimiento del PIB por Región/País ('), 'falta la tabla de regiones');
});

test('generarApartadoMundial no duplica una tabla que la narrativa ya incrusta junto a su tema', () => {
  const narrativaConTabla =
    '<p><strong>CRECIMIENTO MUNDIAL</strong></p><p>Texto.</p>' +
    generarTablaPibMundial(null, 2026, (v) => String(v));
  const datosMacro = { narrativa: { mundial: narrativaConTabla } };
  const salida = generarApartadoMundial(datosMacro, 2026, (v) => String(v));
  const apariciones = salida.split('Crecimiento del PIB Mundial (').length - 1;
  assert.strictEqual(apariciones, 1, 'la tabla de PIB mundial quedó duplicada');
  assert.ok(salida.includes('Tasas de Inflación Global ('), 'la tabla de inflación (que la narrativa no traía) no se agregó');
});

test('generarApartadoMundial deja marcador si no hay narrativa todavía', () => {
  const salida = generarApartadoMundial(null, 2026, (v) => String(v));
  assert.ok(salida.includes('Actualizar con el análisis del panorama de la economía mundial'));
  assert.ok(salida.includes('Decreto 1625 de 2016'));
});

test('generarApartadoColombia usa la narrativa de Firestore cuando existe, y le agrega las 5 tablas que la narrativa no trae incrustadas', () => {
  const datosMacro = { narrativa: { colombia: '<p>Texto redactado por IA sobre Colombia.</p>' } };
  const salida = generarApartadoColombia(datosMacro, 2026, (v) => String(v));
  assert.ok(salida.startsWith('<p>Texto redactado por IA sobre Colombia.</p>'), 'no empieza con la narrativa');
  assert.ok(salida.includes('Crecimiento del PIB en Colombia ('), 'falta la tabla de PIB de Colombia');
  assert.ok(salida.includes('Inflación en Colombia ('), 'falta la tabla de inflación de Colombia');
  assert.ok(salida.includes('Tasa de Intervención del Banco de la República ('), 'falta la tabla de tasa de intervención');
  assert.ok(salida.includes('Tasa Representativa del Mercado (TRM) Promedio ('), 'falta la tabla de TRM');
  assert.ok(salida.includes('Tasa de Desempleo en Colombia ('), 'falta la tabla de desempleo');
});

test('generarApartadoColombia deja marcador si no hay narrativa todavía', () => {
  const salida = generarApartadoColombia(undefined, 2025, (v) => String(v));
  assert.ok(salida.includes('Actualizar con el análisis del panorama de la economía colombiana'));
});

/* ─── crecimiento_por_region: arreglo de objetos, no de pares anidados ───
   Firestore prohíbe que un elemento de un arreglo sea a su vez un arreglo. Con
   la forma vieja [['Mundial','3.0'], …], el set() del cron mensual fallaba y por
   ser escritura atómica se perdía el mes completo, no solo esta serie. */

test('crecimiento_por_region usa objetos planos, admisibles en Firestore', () => {
  Object.values(DATOS_MACRO.crecimiento_por_region).forEach((corte) => {
    assert.ok(Array.isArray(corte), 'el corte de un año debe ser un arreglo');
    corte.forEach((entrada) => {
      assert.ok(!Array.isArray(entrada), 'un elemento del arreglo es otro arreglo: Firestore lo rechaza');
      assert.strictEqual(typeof entrada, 'object', 'cada entrada debe ser un objeto plano');
      assert.strictEqual(typeof entrada.region, 'string', 'falta region');
      assert.strictEqual(typeof entrada.valor, 'string', 'falta valor');
    });
  });
});

test('la tabla por región lee la forma de objetos y no deja celdas undefined', () => {
  const salida = generarTablaCrecimientoPorRegion(null, 2026, (v) => String(v));
  ['Mundial', 'Estados Unidos', 'China', 'América Latina', 'Colombia (OCDE)'].forEach((r) => {
    assert.ok(salida.includes(r), 'falta la región ' + r);
  });
  assert.ok(salida.includes('3.0'), 'falta el valor de la región Mundial para 2026');
  assert.ok(!salida.includes('undefined'), 'quedó una celda undefined: el .map no leyó la forma nueva');
});

test('la tabla por región acepta la misma forma viniendo de Firestore', () => {
  const datosMacro = {
    series: {
      crecimiento_por_region: {
        valores: { 2026: [{ region: 'Zona Euro', valor: '1.1' }] },
        fuente: 'Fuente de prueba',
      },
    },
  };
  const salida = generarTablaCrecimientoPorRegion(datosMacro, 2026, (v) => String(v));
  assert.ok(salida.includes('Zona Euro'), 'no usó el corte de Firestore');
  assert.ok(salida.includes('1.1'), 'no usó el valor de Firestore');
  assert.ok(!salida.includes('Mundial'), 'mezcló el respaldo local con el corte de Firestore');
});

/* ─── Fecha de consulta: la exige el numeral 4 del art. 1.2.2.2.1.5 del D. 1625/2016 ───
   Se guardaba en Firestore desde la primera corrida pero ningún generador la
   mostraba, así que el informe seguía saliendo con fuente y sin fecha. */

test('con fechaConsulta, la tabla la cita junto a la fuente', () => {
  const datosMacro = {
    series: {
      pib_mundial: {
        valores: { 2026: '9.9' },
        fuente: 'Fuente de prueba',
        fuenteUrl: 'https://prueba.example',
        fechaConsulta: new Date('2026-08-01'),
      },
    },
  };
  const salida = generarTablaPibMundial(datosMacro, 2026, (v) => String(v));
  assert.ok(salida.includes('consultado el'), 'no se citó la fecha de consulta');
  assert.ok(/consultado el[^<]*2026/.test(salida), 'la fecha citada no lleva el año');
  assert.ok(salida.includes('Fuente de prueba'), 'se perdió la fuente al agregar la fecha');
});

test('un Timestamp de Firestore (con .toDate) también se formatea', () => {
  const timestampFalso = { toDate: () => new Date('2026-08-01') };
  const datosMacro = {
    series: { pib_mundial: { valores: { 2026: '9.9' }, fuente: 'X', fechaConsulta: timestampFalso } },
  };
  const salida = generarTablaPibMundial(datosMacro, 2026, (v) => String(v));
  assert.ok(/consultado el[^<]*2026/.test(salida), 'no se interpretó el Timestamp de Firestore');
});

test('una fechaConsulta ausente o ilegible no ensucia la fuente', () => {
  const sinFecha = { series: { pib_mundial: { valores: { 2026: '9.9' }, fuente: 'X' } } };
  assert.ok(
    !generarTablaPibMundial(sinFecha, 2026, (v) => String(v)).includes('consultado el'),
    'inventó una fecha de consulta que nadie registró'
  );
  const basura = { series: { pib_mundial: { valores: { 2026: '9.9' }, fuente: 'X', fechaConsulta: 'no es fecha' } } };
  const salida = generarTablaPibMundial(basura, 2026, (v) => String(v));
  assert.ok(!salida.includes('consultado el'), 'aceptó una fecha ilegible');
  assert.ok(!salida.includes('Invalid Date'), 'filtró «Invalid Date» al informe');
});

test('el respaldo local no finge una fecha de consulta', () => {
  /* Nadie registró cuándo se consultaron los valores embebidos en el código;
     fabricar esa fecha es el vicio que la norma quiere evitar. */
  const salida = generarTablaPibMundial(null, 2025, (v) => String(v));
  assert.ok(!salida.includes('consultado el'), 'el respaldo local inventó una fecha de consulta');
});

/* ─── narrativa.fuentesCitadas: la lista de respaldo al cierre de III.B ─── */

test('fuentesCitadas se renderiza como enlaces al final de III.B', () => {
  const datosMacro = {
    narrativa: {
      colombia: '<p>Narrativa de Colombia.</p>',
      fuentesCitadas: [
        { titulo: 'DANE, IPC', url: 'https://dane.gov.co/ipc' },
        { titulo: 'Banco de la República', url: 'https://banrep.gov.co/trm' },
      ],
    },
  };
  const salida = generarApartadoColombia(datosMacro, 2026, (v) => String(v));
  assert.ok(salida.startsWith('<p>Narrativa de Colombia.</p>'), 'se alteró la narrativa');
  assert.ok(salida.includes('Fuentes consultadas:'), 'falta el encabezado de la lista de fuentes');
  assert.ok(salida.includes('<a href="https://dane.gov.co/ipc">DANE, IPC</a>'), 'falta la primera fuente como enlace');
  assert.ok(salida.includes('<a href="https://banrep.gov.co/trm">Banco de la República</a>'), 'falta la segunda fuente');
});

test('fuentesCitadas ausente o vacía no agrega el párrafo', () => {
  const sinCampo = { narrativa: { colombia: '<p>N.</p>' } };
  assert.ok(!generarApartadoColombia(sinCampo, 2026, (v) => String(v)).includes('Fuentes consultadas'));
  const vacia = { narrativa: { colombia: '<p>N.</p>', fuentesCitadas: [] } };
  assert.ok(!generarApartadoColombia(vacia, 2026, (v) => String(v)).includes('Fuentes consultadas'));
});

test('una fuente incompleta se descarta en vez de dejar un enlace roto', () => {
  const datosMacro = {
    narrativa: {
      colombia: '<p>N.</p>',
      fuentesCitadas: [{ titulo: 'Sin URL' }, { url: 'https://sin-titulo.example' }, null],
    },
  };
  const salida = generarApartadoColombia(datosMacro, 2026, (v) => String(v));
  assert.ok(!salida.includes('Fuentes consultadas'), 'una fuente sin título o sin URL llegó al informe');
});

test('una fuente con HTML en el título o en la URL no rompe el documento', () => {
  /* titulo y url vienen de la IA vía Firestore: no se confía en que estén
     limpios. La URL va dentro de un href="…", así que la comilla doble también
     tiene que escaparse o se sale del atributo. */
  const datosMacro = {
    narrativa: {
      colombia: '<p>N.</p>',
      fuentesCitadas: [
        { titulo: 'DANE <script>alert(1)</script> & Co', url: 'https://x.example/a"onmouseover="alert(1)' },
      ],
    },
  };
  const salida = generarApartadoColombia(datosMacro, 2026, (v) => String(v));
  assert.ok(!salida.includes('<script>'), 'se inyectó una etiqueta desde el título de la fuente');
  assert.ok(salida.includes('&amp; Co'), 'no se escapó el ampersand del título');
  assert.ok(!salida.includes('onmouseover="'), 'la URL se salió del atributo href');
  const hrefs = salida.match(/href="[^"]*"/g) || [];
  assert.strictEqual(hrefs.length, 1, 'el href quedó partido: la comilla de la URL rompió el atributo');
});

/* ─── Hallazgos 5 y 6: el sector deja de ser el de End Game ─── */

test('el apartado sectorial no menciona videojuegos y sí la actividad del cliente', () => {
  const salida = generarApartadoSectorial(otroCliente, 2026, (v) => String(v));
  assert.ok(!/videojuego/i.test(salida), 'el apartado sigue hablando de videojuegos');
  assert.ok(!/software/i.test(salida), 'el apartado sigue hablando de software');
  assert.ok(salida.includes('ACME AGROINDUSTRIAL S.A.S'), 'falta la razón social del cliente');
  assert.ok(salida.includes('0111'), 'falta el CIIU del cliente');
  assert.ok(salida.includes('Cultivo de cereales'), 'falta la actividad declarada del cliente');
  assert.ok(salida.includes('año gravable 2026'), 'el apartado no se sitúa en el año del estudio');
});

test('el título de III.C sale del CIIU del cliente, no del sector de la plantilla', () => {
  /* El caso anterior comprobaba además que el reemplazo respetara las anclas
     `_Toc2089309xx` del .docx de End Game. Eso murió con la sustitución por
     literales: la plantilla del cliente ya no se recorta por anclas. Lo que sigue
     importando —y es lo que se conserva— es de dónde sale el título. */
  assert.strictEqual(
    tituloSectorial(otroCliente),
    'Análisis del Sector económico de la Compañía (actividad CIIU 0111)'
  );
});

test('sin CIIU el título usa el respaldo y el apartado no queda vacío', () => {
  const sinDatos = { ent: 'EMPRESA SIN FICHA S.A.S', anio: 2025 };
  assert.strictEqual(tituloSectorial(sinDatos), 'Análisis del Sector económico de la Compañía');
  const salida = generarApartadoSectorial(sinDatos, 2025, (v) => String(v));
  assert.ok(salida.includes('EMPRESA SIN FICHA S.A.S'), 'falta la razón social');
  assert.ok(salida.includes('Actualizar con los indicadores sectoriales'), 'falta el marcador de pendiente');
});

test('el objeto social con caracteres de HTML no rompe el documento', () => {
  const conHtml = { ent: 'X & Y S.A.S', anio: 2025, objeto: 'Comercio <mayorista> & minorista' };
  const salida = generarApartadoSectorial(conHtml, 2025, (v) => String(v));
  assert.ok(salida.includes('&amp;'), 'no se escapó el ampersand');
  assert.ok(!salida.includes('<mayorista>'), 'se inyectó una etiqueta desde el objeto social');
});

/* ─── Análisis de sector (III.C) variable por actividad, con reutilización ─── */

test('normalizarActividad y claveActividad coinciden entre estudios con la misma actividad', () => {
  const a = claveActividad(normalizarActividad('Fabricación de Software y Videojuegos'));
  const b = claveActividad(normalizarActividad('  fabricacion de software y videojuegos  '));
  assert.strictEqual(a, b, 'dos textos equivalentes deberían dar la misma clave de reutilización');
});

const analisisSectorEjemplo = {
  actividadOriginal: 'Fabricación de software y videojuegos',
  actividadNormalizada: 'fabricacion de software y videojuegos',
  porAnio: {
    2025: {
      actualizadoEn: new Date('2026-08-04'),
      tituloSector: 'del software y los videojuegos',
      datosClaveTabla: [
        { indicador: 'Empleo del sector', valorAnterior: '250.000', valorActual: '260.000' },
      ],
      narrativa: {
        comportamiento: '<p>El sector mostró un comportamiento sólido en 2025.</p>',
        comercioExterior: '<p>Las exportaciones del sector crecieron en 2025.</p>',
        proyeccion: '<p>Se proyecta una expansión moderada para 2026.</p>',
        conclusiones: '<p>El sector es relevante para la comparabilidad del estudio.</p>',
        fuentesCitadas: [{ titulo: 'DANE', url: 'https://dane.gov.co' }],
      },
    },
  },
};

test('tituloSectorial usa el título de la corrida guardada cuando existe para ese año', () => {
  const study = { ent: 'ACME SOFTWARE S.A.S', anio: 2025 };
  const titulo = tituloSectorial(study, analisisSectorEjemplo, 2025);
  assert.strictEqual(titulo, 'Análisis del Sector de la industria del software y los videojuegos');
});

test('tituloSectorial cae al respaldo si no hay corrida para ESE año, aunque exista para otro', () => {
  const study = { ent: 'ACME SOFTWARE S.A.S', anio: 2024, ciiu: '6201' };
  const titulo = tituloSectorial(study, analisisSectorEjemplo, 2024);
  assert.strictEqual(titulo, 'Análisis del Sector económico de la Compañía (actividad CIIU 6201)');
});

test('generarApartadoSectorial arma los 6 títulos en orden con la narrativa guardada', () => {
  const study = { ent: 'ACME SOFTWARE S.A.S', anio: 2025 };
  const salida = generarApartadoSectorial(study, 2025, (v) => String(v), analisisSectorEjemplo);

  const temas = [
    'Comportamiento del Sector de la Industria del software y los videojuegos en 2025 y Comparación con 2024',
    'El sector mostró un comportamiento sólido en 2025.',
    'Datos Clave del Sector de la Industria del software y los videojuegos en Colombia (2024 vs. 2025)',
    'Importaciones y exportaciones del sector de la industria del software y los videojuegos',
    '¿Qué se proyecta para el sector de la industria del software y los videojuegos en 2026?',
    'Conclusiones y Perspectivas',
    'Fuentes consultadas',
  ];
  let ultimaPosicion = -1;
  temas.forEach((t) => {
    const pos = salida.indexOf(t);
    assert.ok(pos !== -1, 'falta: ' + t);
    assert.ok(pos > ultimaPosicion, 'fuera de orden: ' + t);
    ultimaPosicion = pos;
  });
  assert.ok(salida.includes('250.000') && salida.includes('260.000'), 'faltan los valores de la tabla de datos clave');
  assert.ok(salida.includes('href="https://dane.gov.co"'), 'falta el enlace de la fuente citada');
});

test('valorODisponible publica el enlace en la celda cuando el valor trae fuente propia', () => {
  /* La proyección del año siguiente sale de otra institución que la serie histórica —el
     desempleo lo publica el DANE, pero quien lo proyecta es el FMI—, así que su fuente NO
     es la del pie de la tabla. Va en la propia celda, con la URL a la vista, para que se
     pueda verificar sin salir del documento. */
  const serie = {
    2025: '8.9',
    2026: { valor: '8.5', fuente: 'FMI, WEO Octubre 2026', fuenteUrl: 'https://www.imf.org/weo' },
  };

  assert.strictEqual(valorODisponible(serie, 2025, 'la tasa de desempleo'), '8.9');

  const proyectado = valorODisponible(serie, 2026, 'la proyección de desempleo');
  assert.match(proyectado, /^8\.5/);
  assert.match(proyectado, /FMI, WEO Octubre 2026/);
  assert.match(proyectado, /https:\/\/www\.imf\.org\/weo/);
  assert.doesNotMatch(proyectado, /Completar/);
});

test('valorODisponible con valor propio pero sin URL publica al menos el nombre de la fuente', () => {
  const texto = valorODisponible(
    { 2026: { valor: '8.5', fuente: 'Fedesarrollo' } }, 2026, 'la proyección de desempleo');
  assert.match(texto, /^8\.5/);
  assert.match(texto, /Fedesarrollo/);
});

test('proyectarPorTendencia ajusta una recta por mínimos cuadrados sobre los años observados', () => {
  /* Serie perfectamente lineal: −0,5 por año. La proyección de 2026 tiene que ser 8.0 y el
     ajuste, perfecto. */
  const r = proyectarPorTendencia({ 2022: '10.0', 2023: '9.5', 2024: '9.0', 2025: '8.5' }, 2026);
  assert.strictEqual(r.valor, '8.0');
  assert.strictEqual(r.r2, 1);
  assert.deepStrictEqual(r.puntos, [[2022, 10], [2023, 9.5], [2024, 9], [2025, 8.5]]);
  assert.strictEqual(r.pendiente, -0.5);
});

test('proyectarPorTendencia conserva los decimales de la serie observada', () => {
  /* La TRM se publica con dos decimales; devolver «4052.8600000001» delataría el cálculo. */
  const r = proyectarPorTendencia({ 2023: '4325.10', 2024: '4062.59', 2025: '4052.86' }, 2026);
  assert.match(r.valor, /^\d+\.\d{2}$/);
});

test('proyectarPorTendencia se niega con menos de tres observaciones', () => {
  /* Con dos puntos la «tendencia» es la recta que los une: no hay ajuste que evaluar ni
     evidencia que enseñar, solo una extrapolación disfrazada. */
  assert.strictEqual(proyectarPorTendencia({ 2024: '10.2', 2025: '8.9' }, 2026), null);
  assert.strictEqual(proyectarPorTendencia({}, 2026), null);
});

test('proyectarPorTendencia ignora los años posteriores al que se proyecta y los no numéricos', () => {
  const r = proyectarPorTendencia(
    { 2022: '10.0', 2023: '9.5', 2024: '9.0', 2025: '8.5', 2027: '99', 2021: 'N.D.' }, 2026);
  assert.deepStrictEqual(r.puntos.map((p) => p[0]), [2022, 2023, 2024, 2025]);
});

test('cifraODisponible prefiere el pronóstico publicado sobre la estimación propia', () => {
  const serie = {
    2023: '10.0', 2024: '9.5', 2025: '8.9',
    2026: { valor: '8.5', fuente: 'FMI, WEO', fuenteUrl: 'https://www.imf.org/weo' },
  };
  const texto = cifraODisponible(serie, 2026, 'la proyección de desempleo');
  assert.match(texto, /^8\.5/);
  assert.match(texto, /https:\/\/www\.imf\.org\/weo/);
  assert.doesNotMatch(texto, /estimación propia/i);
});

test('cifraODisponible estima y muestra el método y los datos cuando nadie lo publicó', () => {
  /* Lo que pidió el usuario: en vez del hueco, la cifra calculada, cómo se calculó y sobre
     qué datos, para poder rehacer la cuenta. */
  const texto = cifraODisponible(
    { 2022: '10.0', 2023: '9.5', 2024: '9.0', 2025: '8.5' }, 2026, 'la proyección de desempleo');

  assert.match(texto, /^8\.0/);
  assert.match(texto, /estimación propia/i);
  assert.match(texto, /tendencia lineal|mínimos cuadrados/i);
  /* La evidencia: los años y valores sobre los que se ajustó. */
  assert.match(texto, /2022/);
  assert.match(texto, /2025/);
  assert.match(texto, /10|8\.5/);
  /* La calidad del ajuste, para que se pueda desconfiar de ella con criterio. */
  assert.match(texto, /R²/);
  /* Y el aviso de que NO es una cifra publicada. */
  assert.match(texto, /no es una cifra publicada/i);
  assert.doesNotMatch(texto, /Completar/);
});

test('cifraODisponible cae al marcador si no hay con qué estimar', () => {
  /* Sin serie suficiente no se inventa nada: ahí el hueco sigue siendo la única salida
     honesta, y lo dice el marcador de siempre. */
  const texto = cifraODisponible({ 2025: '8.9' }, 2026, 'la proyección de desempleo');
  assert.match(texto, /Completar con la proyección de desempleo de 2026/);
});

test('valorODisponible sigue marcando pendiente si el objeto no trae cifra', () => {
  /* Un objeto sin `valor` es una respuesta a medias del modelo: no se publica como si
     fuera un dato, y NUNCA se cae en "[object Object]". */
  const texto = valorODisponible(
    { 2026: { fuente: 'FMI', fuenteUrl: 'https://x' } }, 2026, 'la proyección de desempleo');
  assert.match(texto, /Completar con la proyección de desempleo de 2026/);
  assert.doesNotMatch(texto, /object Object/);
});

test('valorODisponible no altera las series cuyo valor es una lista', () => {
  /* `crecimiento_por_region` guarda un arreglo de regiones por año; tratarlo como el
     objeto {valor,fuente} lo convertiría en un marcador de pendiente. */
  const regiones = [{ region: 'Mundial', valor: '3.0' }];
  assert.strictEqual(valorODisponible({ 2026: regiones }, 2026, 'x'), regiones);
});

test('corridaSectorIncompleta señala la corrida vieja sin párrafo de entrada', () => {
  const entrada = analisisSectorEjemplo.porAnio[2025];
  const sinIntro = { ...entrada, narrativa: { ...entrada.narrativa } };
  delete sinIntro.narrativa.introduccion;
  assert.strictEqual(corridaSectorIncompleta(sinIntro), true);

  const conIntro = {
    ...entrada,
    narrativa: { ...entrada.narrativa, introduccion: '<p>El sector mostró dinamismo en 2025.</p>' },
  };
  assert.strictEqual(corridaSectorIncompleta(conIntro), false);

  /* Sin corrida no hay nada que regenerar: el flujo de generación bajo demanda ya se
     encarga de ese caso, y decir «incompleta» aquí ofrecería un botón de más. */
  assert.strictEqual(corridaSectorIncompleta(null), false);
  assert.strictEqual(corridaSectorIncompleta(undefined), false);
});

test('fuenteDatosClaveSector cita cada fuente una vez, con su URL y la fecha de la corrida', () => {
  const texto = fuenteDatosClaveSector({
    actualizadoEn: new Date('2026-08-13T15:42:46Z'),
    datosClaveTabla: [
      { fuente: 'ProColombia', fuenteUrl: 'https://procolombia.co/x' },
      { fuente: 'ProColombia', fuenteUrl: 'https://procolombia.co/x' },
      { fuente: 'DANE' },
    ],
  });
  assert.strictEqual((texto.match(/ProColombia/g) || []).length, 1);
  assert.match(texto, /ProColombia \(https:\/\/procolombia\.co\/x\); DANE/);
  assert.match(texto, /consultado el/);

  /* Sin fuentes no se devuelve una línea hueca: el llamador la usa para decidir si toca
     la nota al pie de la plantilla o la deja como estaba. */
  assert.strictEqual(fuenteDatosClaveSector({ datosClaveTabla: [] }), '');
  assert.strictEqual(fuenteDatosClaveSector(null), '');
});

test('generarApartadoSectorial sin datosClaveTabla no deja una tabla vacía', () => {
  const sinTabla = {
    ...analisisSectorEjemplo,
    porAnio: { 2025: { ...analisisSectorEjemplo.porAnio[2025], datosClaveTabla: [] } },
  };
  const salida = generarApartadoSectorial({ anio: 2025 }, 2025, (v) => String(v), sinTabla);
  assert.ok(!salida.includes('<table>'), 'quedó una tabla sin filas');
});

test('generarApartadoSectorial sin analisisSector sigue usando el respaldo genérico (compatibilidad)', () => {
  const study = { ent: 'EMPRESA SIN SECTOR S.A.S', anio: 2025 };
  const salida = generarApartadoSectorial(study, 2025, (v) => String(v));
  assert.ok(salida.includes('Actualizar con los indicadores sectoriales'), 'no cayó al respaldo esperado');
});

/* El caso del «año en cadena» (el formulario entrega '2025' y `year + 1` daba
   «20251») vivía aquí porque quien coaccionaba el año era `hydrateExactWordTemplate`.
   Los generadores nunca lo hicieron: reciben `year` ya numérico. Esa coacción vive
   ahora en `docxRelleno.js:332` (`Number(estudio.anio) || 2025`) y la ejercita el
   estudio de `docxRelleno.test.js`, cuyo `anio` es la cadena '2024'. */

/* ─── Diagnóstico de cobertura ───
   `diagnosticarCobertura` se mudó a `tablasInforme.js` y sus casos con ella. Aquí
   quedan solo los datos macro que consume. */

test('las series macro declaran su fuente', () => {
  /* El Decreto 1625 de 2016 obliga a citar la fuente de cada cifra. Si una serie
     entra sin fuente, el informe la publica sin respaldo. */
  Object.keys(DATOS_MACRO)
    .filter((k) => k !== 'meta_inflacion_banrep')
    .forEach((serie) => {
      assert.ok(serie in FUENTES_MACRO, 'la serie ' + serie + ' no declara fuente');
    });
});
