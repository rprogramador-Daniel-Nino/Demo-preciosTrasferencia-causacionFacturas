import { test } from 'node:test';
import assert from 'node:assert';
import { hydrateExactWordTemplate } from './exactTemplateMapper.js';
import { MASTER_WORD_TEMPLATE } from './masterTemplate.js';

/* Estudio de un cliente que NO es End Game. Todo lo que salga con datos de
   End Game en la salida es una fuga. */
const otroCliente = {
  ent: 'ACME COLOMBIA S.A.S',
  nit: '800123456-7',
  anio: 2025,
  t_inv_assoc: 5000000,
  t_intang: 111111,
  t_dif: 222222,
  t_act_nocurr: 5333333,
};

test('el NIT de End Game no sobrevive, y el DV no queda colgando', () => {
  const html = '<p>END GAME INTERACTIVE COLOMBIA S.A.S con NIT 901.337.576-6 es una empresa</p>';
  const salida = hydrateExactWordTemplate(html, otroCliente);
  assert.ok(!salida.includes('901.337.576'), 'el NIT de End Game sigue en la salida');
  assert.ok(!salida.includes('-6'), 'quedó colgando el dígito de verificación de End Game');
  assert.ok(salida.includes('800123456-7'), 'no se insertó el NIT del estudio');
});

test('las cuatro líneas de balance huérfanas se sustituyen', () => {
  const html =
    '<td>1.247.447.456</td><td>4.703.375</td><td>83.801.656</td><td>206.129.230</td>';
  const salida = hydrateExactWordTemplate(html, otroCliente);
  for (const cifra of ['1.247.447.456', '4.703.375', '83.801.656', '206.129.230']) {
    assert.ok(!salida.includes(cifra), 'sobrevivió la cifra de End Game ' + cifra);
  }
  assert.ok(salida.includes('5.000.000'), 'falta Inversiones asociadas del estudio');
  assert.ok(salida.includes('5.333.333'), 'falta Total activos no corrientes del estudio');
});

/* Regresión del error que cometí al analizar: 247.447.456 y 435.357.400 NO son
   cifras independientes, son la cola de 1.247.447.456 y 3.435.357.400. Un
   patrón sin delimitar las reemplazaría por separado y corrompería ambas. */
test('no se parte un número largo por su cola', () => {
  const html = '<td>1.247.447.456</td>';
  const salida = hydrateExactWordTemplate(html, otroCliente);
  assert.ok(!/\d\.?5\.000\.000/.test(salida), 'se sustituyó la cola dejando el prefijo suelto');
  assert.ok(!salida.includes('1.5.000.000'), 'quedó un número corrupto');
});

test('la fila de accionista principal no se congela con los datos de End Game cuando coincide con el vinculado', () => {
  // La plantilla real tiene "END GAME INTERACTIVE INC"/"ESTADOS UNIDOS" tanto
  // en las secciones del vinculado como en la fila del accionista principal
  // (Tabla 6. Composición Accionaria) — misma empresa, mismo país, en el
  // estudio original. Si el reemplazo del vinculado corre primero y es
  // global, no queda texto literal para que el reemplazo del accionista
  // encuentre después: la fila de accionistas se congela con End Game.
  const html =
    '<p>Funciones llevadas a cabo por el vinculado END GAME INTERACTIVE INC en las operaciones.</p>' +
    '<p>País vinculado</p><p>ESTADOS UNIDOS</p>' +
    '<tr>\n<td>\n<p>\nEND GAME INTERACTIVE INC.\n</p>\n</td>\n<td>\n<p>\nESTADOS UNIDOS\n</p>\n</td>\n<td>\n<p>\n200.000\n</p>\n</td>\n<td>\n<p>\n200.000.000\n</p>\n</td>\n<td>\n<p>\n100%\n</p>\n</td>\n</tr>';
  const estudio = {
    ...otroCliente,
    vinc: 'PARTNER GAMES LLC',
    pais_vinc: 'CANADA',
    accionistas: [{ nombre: 'HOLDCO ASIA PTE LTD', pais: 'SINGAPUR', acciones: 500000, valor_capital: 900000000 }]
  };
  const salida = hydrateExactWordTemplate(html, estudio);
  assert.ok(salida.includes('HOLDCO ASIA PTE LTD'), 'la fila de accionistas debió reflejar el nombre del accionista, no quedarse en End Game ni en el vinculado');
  assert.ok(salida.includes('SINGAPUR'), 'la fila de accionistas debió reflejar el país del accionista');
  assert.ok(salida.includes('500.000'), 'la fila de accionistas debió reflejar las acciones del accionista');
  assert.ok(salida.includes('900.000.000'), 'la fila de accionistas debió reflejar el valor de capital del accionista');
});

test('sin datos del estudio no se filtran los de End Game', () => {
  const html = '<p>NIT 901.337.576-6</p><td>4.703.375</td>';
  const salida = hydrateExactWordTemplate(html, {});
  assert.ok(!salida.includes('901.337.576'), 'con estudio vacío sigue el NIT de End Game');
  assert.ok(!salida.includes('4.703.375'), 'con estudio vacío sigue una cifra de End Game');
});

test('reemplazo dinámico de la tabla de PIB Mundial y PIB de Colombia para el año 2025', () => {
  const htmlPibMundial = '<p><strong>Crecimiento del PIB Mundial (2023-2025)</strong></p><table><tr><td>Año</td></tr></table>';
  const htmlPibColombia = '<p><strong>Crecimiento del PIB en Colombia (2023-2025)</strong></p><table><tr><td>Año</td></tr></table>';
  
  const salidaMundial = hydrateExactWordTemplate(htmlPibMundial, { anio: 2025 });
  const salidaColombia = hydrateExactWordTemplate(htmlPibColombia, { anio: 2025 });

  // Para 2025: y1 = 2024, y2 = 2025, y3 = 2026
  assert.ok(salidaMundial.includes('Crecimiento del PIB Mundial (2024-2026)'), 'No actualizó el título del PIB Mundial para 2025');
  assert.ok(salidaMundial.includes('2024'), 'Falta el año 2024 en PIB Mundial');
  assert.ok(salidaMundial.includes('2025'), 'Falta el año 2025 en PIB Mundial');
  assert.ok(salidaMundial.includes('2026</span> (Proyección)'), 'Falta la proyección 2026 en PIB Mundial');
  // PIB mundial valores: 2024 -> 3.3, 2025 -> 3.2, 2026 -> 3.2
  assert.ok(salidaMundial.includes('3.3'), 'Falta valor 3.3 de PIB Mundial');
  assert.ok(salidaMundial.includes('3.2'), 'Falta valor 3.2 de PIB Mundial');

  // Para Colombia 2025: y1 = 2024, y2 = 2025, y3 = 2026
  assert.ok(salidaColombia.includes('Crecimiento del PIB en Colombia (2024-2026)'), 'No actualizó el título del PIB Colombia para 2025');
  assert.ok(salidaColombia.includes('2026</span> (Proyección OCDE)'), 'Falta proyección OCDE 2026 en PIB Colombia');
  // PIB Colombia valores: 2024 -> 1.7, 2025 -> 2.6, 2026 -> 3.0
  assert.ok(salidaColombia.includes('1.7'), 'Falta valor 1.7 de PIB Colombia');
  assert.ok(salidaColombia.includes('2.6'), 'Falta valor 2.6 de PIB Colombia');
  assert.ok(salidaColombia.includes('3.0'), 'Falta valor 3.0 de PIB Colombia');
});

test('reemplazo dinámico de la tabla de PIB Mundial y PIB de Colombia para el año 2026', () => {
  const htmlPibMundial = '<p><strong>Crecimiento del PIB Mundial (2023-2025)</strong></p><table><tr><td>Año</td></tr></table>';
  const htmlPibColombia = '<p><strong>Crecimiento del PIB en Colombia (2023-2025)</strong></p><table><tr><td>Año</td></tr></table>';
  
  const salidaMundial = hydrateExactWordTemplate(htmlPibMundial, { anio: 2026 });
  const salidaColombia = hydrateExactWordTemplate(htmlPibColombia, { anio: 2026 });

  // Para 2026: y1 = 2025, y2 = 2026, y3 = 2027
  assert.ok(salidaMundial.includes('Crecimiento del PIB Mundial (2025-2027)'), 'No actualizó el título del PIB Mundial para 2026');
  assert.ok(salidaMundial.includes('2027</span> (Proyección)'), 'Falta proyección 2027 en PIB Mundial');
  // PIB mundial valores: 2025 -> 3.2, 2026 -> 3.2, 2027 -> 3.1
  assert.ok(salidaMundial.includes('3.2'), 'Falta valor 3.2 de PIB Mundial');
  assert.ok(salidaMundial.includes('3.1'), 'Falta valor 3.1 de PIB Mundial');

  // Para Colombia 2026: y1 = 2025, y2 = 2026, y3 = 2027
  assert.ok(salidaColombia.includes('Crecimiento del PIB en Colombia (2025-2027)'), 'No actualizó el título del PIB Colombia para 2026');
  assert.ok(salidaColombia.includes('2027</span> (Proyección OCDE)'), 'Falta proyección OCDE 2027 en PIB Colombia');
  // PIB Colombia valores: 2025 -> 2.6, 2026 -> 3.0, 2027 -> 3.2
  assert.ok(salidaColombia.includes('2.6'), 'Falta valor 2.6 de PIB Colombia');
  assert.ok(salidaColombia.includes('3.0'), 'Falta valor 3.0 de PIB Colombia');
  assert.ok(salidaColombia.includes('3.2'), 'Falta valor 3.2 de PIB Colombia');
});

test('el apartado mundial (III.A) usa la narrativa de datosMacro cuando existe', () => {
  const html =
    '<ol>\n<li>\n<a id="_Toc208930977"></a><strong>Análisis del Panorama de la Economía Mundial</strong>\n</li>\n</ol>\n' +
    '<p>Texto original de End Game sobre 2023-2024 y Ucrania-Rusia.</p>\n' +
    '<ol>\n<li>\n<a id="_Toc208930978"></a><strong>Análisis del panorama de la economía colombiana</strong>\n</li>\n</ol>';
  const datosMacro = { narrativa: { mundial: '<p>Narrativa nueva de la economía mundial.</p>' } };
  const salida = hydrateExactWordTemplate(html, { anio: 2026 }, datosMacro);

  assert.ok(salida.includes('Narrativa nueva de la economía mundial.'), 'no se insertó la narrativa nueva');
  assert.ok(!salida.includes('Ucrania-Rusia'), 'quedó el texto viejo de End Game');
  assert.ok(salida.includes('id="_Toc208930977"'), 'se borró el ancla de III.A');
  assert.ok(salida.includes('id="_Toc208930978"'), 'el reemplazo se comió el ancla de III.B');
});

test('el apartado colombiano (III.B) usa la narrativa de datosMacro cuando existe', () => {
  const html =
    '<ol>\n<li>\n<a id="_Toc208930978"></a><strong>Análisis del panorama de la economía colombiana</strong>\n</li>\n</ol>\n' +
    '<p>Texto original de End Game.</p>\n' +
    '<ol>\n<li>\n<a id="_Toc208930979"></a><strong>Análisis del Sector</strong>\n</li>\n</ol>';
  const datosMacro = { narrativa: { colombia: '<p>Narrativa nueva de Colombia.</p>' } };
  const salida = hydrateExactWordTemplate(html, { anio: 2026 }, datosMacro);

  assert.ok(salida.includes('Narrativa nueva de Colombia.'), 'no se insertó la narrativa nueva');
  assert.ok(!salida.includes('Texto original de End Game'), 'quedó el texto viejo');
});

test('sin datosMacro, III.A y III.B quedan con el marcador de pendiente, no con el texto de End Game', () => {
  const html =
    '<ol>\n<li>\n<a id="_Toc208930977"></a><strong>Análisis del Panorama de la Economía Mundial</strong>\n</li>\n</ol>\n' +
    '<p>Texto original de End Game.</p>\n' +
    '<ol>\n<li>\n<a id="_Toc208930978"></a><strong>Análisis del panorama de la economía colombiana</strong>\n</li>\n</ol>\n' +
    '<p>Texto original de End Game.</p>\n' +
    '<ol>\n<li>\n<a id="_Toc208930979"></a><strong>Análisis del Sector</strong>\n</li>\n</ol>';
  const salida = hydrateExactWordTemplate(html, { anio: 2026 });

  assert.ok(!salida.includes('Texto original de End Game'), 'quedó el texto de End Game sin datosMacro');
  assert.ok(salida.includes('Actualizar con el análisis del panorama de la economía mundial'), 'falta el marcador de III.A');
  assert.ok(salida.includes('Actualizar con el análisis del panorama de la economía colombiana'), 'falta el marcador de III.B');
});

test('las 8 tablas macro usan las cifras de datosMacro cuando están disponibles', () => {
  const html = '<p>\n<strong>Crecimiento del PIB Mundial (2023-2025)</strong>\n</p>\n<table>\n<tr>\n<td>\n<p>\n3.2\n</p>\n</td>\n</tr>\n</table>';
  const datosMacro = {
    series: { pib_mundial: { valores: { '2026': '9.9' }, fuente: 'Fuente de prueba' } },
  };
  const salida = hydrateExactWordTemplate(html, { anio: 2026 }, datosMacro);
  assert.ok(salida.includes('9.9'), 'la tabla no usó la cifra de datosMacro');
  assert.ok(salida.includes('Fuente de prueba'), 'la tabla no citó la fuente de datosMacro');
});

/* ─── Regresión con la plantilla REAL, no con un fixture sintético ───
   Las 8 tablas macro viven DENTRO del cuerpo de III.A (3) y III.B (5). Los
   fixtures de arriba las prueban aisladas y por eso no vieron el bug:
   reemplazarCuerpoApartado borraba todo el cuerpo, tablas incluidas, y cuando
   TABLAS_MACRO.forEach corría después ya no quedaba nada que regenerar. Las 8
   desaparecían del informe en silencio. */

test('las 8 tablas macro sobreviven al hidratar la plantilla real (regresión)', () => {
  const salida = hydrateExactWordTemplate(MASTER_WORD_TEMPLATE, { anio: 2026 });
  const titulosEsperados = [
    'Crecimiento del PIB Mundial (',
    'Crecimiento del PIB en Colombia (',
    'Tasas de Inflación Global (',
    'Proyecciones de Crecimiento del PIB por Región/País (',
    'Inflación en Colombia (',
    'Tasa de Intervención del Banco de la República (',
    'Tasa Representativa del Mercado (TRM) Promedio (',
    'Tasa de Desempleo en Colombia (',
  ];
  titulosEsperados.forEach((t) => {
    assert.ok(salida.includes(t), 'desapareció la tabla: ' + t);
  });
  assert.ok(!salida.includes('@@PT_APARTADO_'), 'quedó un marcador de apartado sin sustituir');
  assert.ok(!salida.includes('@@PT_ENLACE_'), 'quedó un marcador de enlace sin sustituir');
});

test('en la plantilla real cada tabla macro queda regenerada con el año del estudio', () => {
  /* Que el título sobreviva no basta: tiene que sobrevivir REGENERADO. Si la
     tabla se conservara pero el forEach no la alcanzara, el rango seguiría
     siendo el de End Game (2023-2025) y el informe saldría con datos de otro
     año gravable. */
  const salida = hydrateExactWordTemplate(MASTER_WORD_TEMPLATE, { anio: 2026 });
  const rangosEsperados = [
    'Crecimiento del PIB Mundial (2025-2027)',
    'Crecimiento del PIB en Colombia (2025-2027)',
    'Tasas de Inflación Global (2025-2027)',
    'Proyecciones de Crecimiento del PIB por Región/País (2026)',
    'Inflación en Colombia (2026 vs. Meta 2027)',
    'Tasa de Intervención del Banco de la República (Diciembre 2025 - Diciembre 2026)',
    'Tasa Representativa del Mercado (TRM) Promedio (2025-2026)',
    'Tasa de Desempleo en Colombia (2026 vs. Proyección 2027)',
  ];
  rangosEsperados.forEach((t) => {
    assert.ok(salida.includes(t), 'la tabla no se regeneró para el año del estudio: ' + t);
  });
  assert.ok(
    !salida.includes('Crecimiento del PIB Mundial (2023-2025)'),
    'quedó el rango original de End Game en la tabla de PIB mundial'
  );
  /* Las 5 regiones vienen de DATOS_MACRO.crecimiento_por_region[2026], que ahora
     son objetos {region, valor} y no pares anidados. Si el .map se hubiera
     quedado desestructurando un arreglo, aquí saldrían celdas «undefined». */
  ['Mundial', 'Estados Unidos', 'China', 'América Latina', 'Colombia (OCDE)'].forEach((r) => {
    assert.ok(salida.includes(r), 'falta la región ' + r + ' en la tabla por región');
  });
  assert.ok(!salida.includes('undefined'), 'quedó un «undefined» en el documento');
});

test('la narrativa de III.A/III.B llega intacta: ni los años ni los literales la reescriben', () => {
  /* La narrativa se inserta al final a propósito. Si se insertara donde se
     reserva el lugar, ANIOS_DEL_ESTUDIO reescribiría «En el año 2024,» dentro de
     la prosa —atribuyendo a 2026 una cifra correctamente citada de 2024— y los
     reemplazos literales cambiarían «END GAME» aunque la IA lo mencionara como
     un dato del mercado. */
  const mundial = '<p>En el año 2024, la inflación global descendió a 5,9 % según el FMI.</p>';
  const colombia = '<p>Durante el año 2024 el DANE reportó un crecimiento de 1,7 %.</p>';
  const salida = hydrateExactWordTemplate(
    MASTER_WORD_TEMPLATE,
    { anio: 2026, ent: 'ACME COLOMBIA S.A.S' },
    { narrativa: { mundial, colombia } }
  );
  assert.ok(salida.includes(mundial), 'la narrativa mundial se alteró al hidratar');
  assert.ok(salida.includes(colombia), 'la narrativa de Colombia se alteró al hidratar');
  // Y las tablas del mismo cuerpo siguen ahí, regeneradas.
  assert.ok(salida.includes('Tasas de Inflación Global (2025-2027)'), 'la narrativa se comió las tablas de III.A');
  assert.ok(salida.includes('Tasa de Desempleo en Colombia (2026 vs. Proyección 2027)'), 'la narrativa se comió las tablas de III.B');
});

test('sobre la plantilla real, sin narrativa quedan los marcadores y no el texto de End Game', () => {
  const salida = hydrateExactWordTemplate(MASTER_WORD_TEMPLATE, { anio: 2026 });
  assert.ok(salida.includes('Actualizar con el análisis del panorama de la economía mundial'), 'falta el marcador de III.A');
  assert.ok(salida.includes('Actualizar con el análisis del panorama de la economía colombiana'), 'falta el marcador de III.B');
  assert.ok(!/Ucrania|guerra en Ucrania/i.test(salida), 'quedó la prosa original de End Game en la sección III');
});
