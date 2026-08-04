import { test } from 'node:test';
import assert from 'node:assert';
import {
  hydrateExactWordTemplate, filasRazonesRechazo, diagnosticarCobertura,
  filasComparablesInforme, reemplazarTablaMuestraComparables, reemplazarTablaMargenComparables,
} from './exactTemplateMapper.js';
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

/* --- Higiene de la ruta de respaldo. Es la que toma TODO estudio que no haya
   subido y marcado un PDF, así que hoy es la ruta real de casi todo el mundo.
   Con un estudio recién creado salían 25 rastros del cliente anterior. --- */

test('sin dato en el estudio sale hueco, nunca el literal de End Game', () => {
  const html =
    '<p>Monto de la operación: 3.435.357.400</p>' +
    '<p>Tipo: Otros servicios (07)</p>' +
    '<p>Vinculado END GAME INTERACTIVE INC de ESTADOS UNIDOS, id 604477955</p>';
  const salida = hydrateExactWordTemplate(html, { anio: 2025 });
  for (const rastro of ['3.435.357.400', 'Otros servicios (07)', 'END GAME INTERACTIVE INC',
                        'ESTADOS UNIDOS', '604477955']) {
    assert.ok(!salida.includes(rastro), 'sobrevivió el valor por defecto de End Game: ' + rastro);
  }
  assert.ok(salida.includes('—'), 'debía quedar el marcador de hueco');
});

test('la tabla de EEFF sale en huecos y no con las cifras de End Game', () => {
  const html =
    '<td>87.957.645</td><td>179.720.372</td><td>268.433.497</td>' +
    '<td>1.783.558.970</td><td>117.624.200</td><td>1.989.688.200</td>';
  const salida = hydrateExactWordTemplate(html, { anio: 2025 });
  for (const cifra of ['87.957.645', '179.720.372', '268.433.497', '1.783.558.970',
                       '117.624.200', '1.989.688.200']) {
    assert.ok(!salida.includes(cifra), 'sobrevivió la cifra de End Game ' + cifra);
  }
});

test('la tabla de EEFF también se limpia en un año distinto de 2025', () => {
  /* La condición anterior solo entraba con año 2025 o con cifras ingeridas: un
     estudio de 2024 sin EEFF dejaba las seis cifras de End Game intactas. */
  const html = '<td>87.957.645</td><td>1.989.688.200</td>';
  const salida = hydrateExactWordTemplate(html, { anio: 2024 });
  assert.ok(!salida.includes('87.957.645'), 'sobrevivió el efectivo de End Game');
  assert.ok(!salida.includes('1.989.688.200'), 'sobrevivió el total de activos de End Game');
});

test('un total no se calcula sumando huecos como si fueran cero', () => {
  const html = '<td>1.783.558.970</td>';
  const salida = hydrateExactWordTemplate(html, { anio: 2025, t_cash: 1000, t_ar: 2000 });
  /* Falta t_tax: el total corriente no se puede calcular y tiene que salir hueco,
     no como 3.000, que parecería un total real. */
  assert.ok(!salida.includes('3.000'), 'inventó un total sumando un hueco como cero');
  assert.ok(salida.includes('—'), 'el total incalculable debía salir como hueco');
});

test('las formas cortas de la razón social tampoco pasan', () => {
  const casos = [
    '<p>La compañía END GAME es residente</p>',
    '<p>La compañía END GAME INTERACTIVE es residente</p>',
    '<p>La compañía End Game Colombia SAS es residente</p>',
    '<p>La compañía END GAME INTERACTIVE COLOMBIA SA es residente</p>',
  ];
  for (const html of casos) {
    const salida = hydrateExactWordTemplate(html, otroCliente);
    assert.ok(!/END\s+GAME/i.test(salida), 'sobrevivió la razón social en: ' + html);
    assert.ok(salida.includes('ACME COLOMBIA S.A.S'), 'no se insertó la razón social del estudio en: ' + html);
  }
});

test('la regla de la razón social no se come el nombre del vinculado', () => {
  /* "END GAME INTERACTIVE INC" es el VINCULADO. Si la regla del contribuyente
     muerde su prefijo, la regla del vinculado ya no encuentra nada y queda un
     " INC" colgando pegado al nombre del contribuyente. */
  const html = '<p>Operaciones con END GAME INTERACTIVE INC durante el año</p>';
  const salida = hydrateExactWordTemplate(html, { ...otroCliente, vinc: 'PARTNER GAMES LLC' });
  assert.ok(salida.includes('PARTNER GAMES LLC'), 'el vinculado no se sustituyó');
  assert.ok(!/\bINC\b/.test(salida), 'quedó " INC" colgando: ' + salida);
  assert.ok(!salida.includes('ACME COLOMBIA S.A.S'), 'el contribuyente se colocó donde iba el vinculado');
});

test('un cliente que se llama igual que la plantilla no duplica su razón social', () => {
  /* Si el contribuyente real es el mismo "End Game" de un año anterior, la
     razón social insertada (tomada del RUT) empieza otra vez por
     "END GAME INTERACTIVE". Un barrido final que busque esa misma cadena
     sobre el HTML ya hidratado la vuelve a capturar y la reemplaza sobre sí
     misma, duplicando el nombre. */
  const html = '<p>END GAME INTERACTIVE COLOMBIA S.A.S con NIT 901.337.576-6 es una empresa</p>';
  const study = {
    ent: 'END GAME INTERACTIVE COLOMBIA SOCIEDAD POR ACCIONES SIMPLIFICADA',
    vinc: 'END GAME INTERACTIVE INC',
    nit: '800123456-7',
    anio: 2025,
  };
  const salida = hydrateExactWordTemplate(html, study);
  const apariciones = salida.split('SOCIEDAD POR ACCIONES SIMPLIFICADA').length - 1;
  assert.strictEqual(apariciones, 1, 'la razón social salió duplicada: ' + salida);
  assert.ok(!salida.includes('INTERACTIVE INC COLOMBIA'), 'quedó el nombre del vinculado pegado al del contribuyente: ' + salida);
});

/* ══════ Tabla 16. Razones de rechazo ══════
   La plantilla trae los números de End Game —442 candidatas, 327 por diferencias
   funcionales, 13 aceptadas— y hay que sustituirlos por los del estudio. */

const TABLA_16 = `<p>
A partir del anterior criterio de búsqueda se identificó un total de 442 Compañías comparables potenciales.
</p>
<p>
<strong>Tabla 16. Razones de rechazo (Filtros Cuantitativos – Filtros Cualitativos)</strong>
</p>
<table>
<thead>
<tr>
<th><p><strong>FILTRO APLICADO INTERNACIONALES</strong></p></th>
<th><p><strong>FILTROS APLICADO</strong></p></th>
<th><p><strong>N° POR FILTRO</strong></p></th>
</tr>
</thead>
<tbody>
<tr><td><p>Diferencias funcionales</p></td><td><p>A</p></td><td><p>327</p></td></tr>
<tr><td><p>Compañías Holding o consideradas grupo multinacional</p></td><td><p>C</p></td><td><p>36</p></td></tr>
<tr><td colspan="2"><p><strong>TOTAL, UNIVERSO</strong></p></td><td><p><strong>442</strong></p></td></tr>
</tbody>
</table>
<p>
De esta manera, después de aplicar dichos criterios, quedaron <strong>13</strong> compañías comparables.
</p>`;

const embudoReal = {
  evaluadas: 100,
  seleccionadas: 8,
  reserva: 12,
  porMotivo: {
    holding: 30, saldoNegativo: 5, perdidaOperativa: 15,
    sinDescripcion: 0, actividadDistinta: 25, rigorFuncional: 5,
  },
};

test('filasRazonesRechazo omite los criterios que no descartaron a nadie', () => {
  /* Un informe que declara «Pérdidas operativas: 0» cuando el criterio se puso en
     «incluir» confunde a quien lo revisa. */
  const { filas } = filasRazonesRechazo(embudoReal);
  assert.ok(!filas.some(f => f.clave === 'sinDescripcion'), 'la fila con cero no aparece');
  assert.ok(filas.some(f => f.clave === 'holding'));
});

test('filasRazonesRechazo asigna letras corridas sobre las filas que quedan', () => {
  /* Cinco criterios con descartes (el de «sin descripción» quedó en cero y se omite)
     más las aceptadas: seis filas, letras A a F sin huecos. La reserva ya no es una
     fila propia. */
  const { filas } = filasRazonesRechazo(embudoReal);
  assert.deepStrictEqual(filas.map(f => f.letra), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.deepStrictEqual(filas.map(f => f.clave), [
    'rigorFuncional', 'actividadDistinta', 'holding', 'perdidaOperativa', 'saldoNegativo',
    'aceptadas',
  ]);
});

test('la reserva se cuenta dentro de las diferencias funcionales', () => {
  /* Declarar en el informe que hubo compañías que superaron todos los criterios y aun
     así quedaron fuera invita a una pregunta que el cupo de muestra no puede responder.
     Van con las diferencias funcionales, que es lo que las apartó: el corte del cupo es
     por puntaje de comparabilidad. */
  const { filas } = filasRazonesRechazo(embudoReal);
  assert.ok(!filas.some(f => f.clave === 'reserva'), 'la reserva no puede tener fila propia');
  const rigor = filas.find(f => f.clave === 'rigorFuncional');
  assert.strictEqual(rigor.cuantas, 17, '5 por rigor + 12 de reserva');
});

test('la fila de diferencias funcionales aparece aunque solo la sostenga la reserva', () => {
  /* Sin este caso la suma de la columna se rompe: la fila se omitiría por valer cero en
     `porMotivo` y las 12 de reserva desaparecerían del universo. */
  const soloReserva = { evaluadas: 20, seleccionadas: 8, reserva: 12, porMotivo: {} };
  const { filas, cuadra } = filasRazonesRechazo(soloReserva);
  const rigor = filas.find(f => f.clave === 'rigorFuncional');
  assert.ok(rigor, 'la fila tiene que aparecer');
  assert.strictEqual(rigor.cuantas, 12);
  assert.ok(cuadra, '12 + 8 = 20');
});

test('filasRazonesRechazo cuadra la suma con el universo evaluado', () => {
  /* 30+5+15+25 rechazos + (5 de rigor + 12 de reserva) + 8 aceptadas = 100 */
  const { cuadra, suma, total } = filasRazonesRechazo(embudoReal);
  assert.strictEqual(suma, 100);
  assert.strictEqual(total, 100);
  assert.ok(cuadra);
});

test('filasRazonesRechazo avisa cuando los conteos no suman el universo', () => {
  const desfasado = { ...embudoReal, evaluadas: 500 };
  const { cuadra } = filasRazonesRechazo(desfasado);
  assert.ok(!cuadra, 'un estudio cambiado tras la selección deja la tabla inconsistente');
});

test('filasRazonesRechazo sin selección ejecutada no inventa nada', () => {
  assert.ok(filasRazonesRechazo(null).sinDatos);
  assert.ok(filasRazonesRechazo({}).sinDatos);
  assert.deepStrictEqual(filasRazonesRechazo(null).filas, []);
});

test('la tabla 16 se reemplaza con los datos del estudio', () => {
  const salida = hydrateExactWordTemplate(TABLA_16, { ...otroCliente, embudoSeleccion: embudoReal });
  assert.ok(!salida.includes('>327<'), 'la cifra de End Game sigue en la tabla');
  assert.ok(!/>442</.test(salida), 'el total de End Game sigue en la tabla');
  assert.ok(salida.includes('30'), 'debe aparecer el conteo real de holdings');
  assert.ok(salida.includes('100'), 'y el universo real como total');
  assert.ok(salida.includes('Compañías comparables aceptadas'));
});

test('el texto que rodea la tabla 16 queda con las cifras del estudio', () => {
  /* Dejar la tabla al día y el párrafo con los números del cliente anterior produce un
     documento que se contradice dentro de la misma página. */
  const salida = hydrateExactWordTemplate(TABLA_16, { ...otroCliente, embudoSeleccion: embudoReal });
  assert.ok(!salida.includes('total de 442 Compañías'), 'el universo de End Game sobrevivió en el texto');
  assert.ok(/quedaron <strong>[\s\S]{0,200}?8[\s\S]{0,200}?<\/strong> compañías comparables/.test(salida),
    'el número de comparables finales no se actualizó en el texto');
});

test('sin selección ejecutada la tabla 16 no se toca', () => {
  /* Preferible que se vea que falta ejecutar el motor a que salgan cifras inventadas.
     El aviso de cobertura es el que se encarga de decirlo. */
  const salida = hydrateExactWordTemplate(TABLA_16, otroCliente);
  assert.ok(salida.includes('327'), 'la tabla queda como estaba');
  const d = diagnosticarCobertura(TABLA_16, otroCliente);
  assert.strictEqual(d.razonesRechazoCubiertas, false);
});

test('el diagnóstico avisa cuando la tabla 16 quedó descuadrada', () => {
  const d = diagnosticarCobertura(TABLA_16, { ...otroCliente, embudoSeleccion: { ...embudoReal, evaluadas: 500 } });
  assert.strictEqual(d.razonesRechazoCubiertas, true);
  assert.strictEqual(d.razonesRechazoDescuadradas, true);
});

/* ══════════════ Tablas 17 y 19: la muestra de comparables ══════════════ */

/* Reproduce la estructura de la plantilla real: la 17 no tiene <thead> —su primera
   <tr> es el encabezado y lleva las anclas de Word— y la 19 sí. */
const TABLA_17 = `<p>
<strong>Tabla 17. Muestra Compañías comparables</strong>
</p>
<table>
<tr>
<td><p><a id="RANGE!E11"></a><a id="_Hlk143111901"></a><strong>Número</strong></p></td>
<td><p><strong>Nombre de la Compañía</strong></p></td>
<td><p><strong>Ámbito</strong></p></td>
</tr>
<tr><td><p>1</p></td><td><p>AKATSUKI INC.</p></td><td><p>INTERNACIONAL</p></td></tr>
<tr><td><p>2</p></td><td><p>COLOPL, INC.</p></td><td><p>INTERNACIONAL</p></td></tr>
</table>`;

const TABLA_19 = `<p><a id="_Hlk143112656"></a>Tabla 19. Margen Operacional Compañías Comparables</p>
<table>
<thead>
<tr><th><p><strong>COMPARABLES</strong></p></th><th><p><strong>MO NO AJUSTADO </strong></p></th><th><p><strong>MO AJUSTADO</strong></p></th></tr>
</thead>
<tbody>
<tr><td><p>AKATSUKI INC.</p></td><td><p>16.557%</p></td><td><p>16.132%</p></td></tr>
<tr><td><p>COLOPL, INC.</p></td><td><p>-4.647%</p></td><td><p>-8.675%</p></td></tr>
</tbody>
</table>`;

const conComparables = {
  ...otroCliente,
  pli: 'MO',
  t_s: 4000, t_c: 3300, t_op: 300,
  comparables: [
    { name: 'DISTRIBUIDORA ANDINA S.A.', amb: 'Nac', s: 1000, c: 800, op: 100 },
    { name: 'GULF FUEL TRADING CO', amb: 'Int', s: 2000, c: 1600, op: 260 },
    { name: 'SIN CIFRAS S.A.', amb: 'Int', s: '', c: '', op: '' },
  ],
};

test('la tabla 17 lista las comparables del estudio, no las de End Game', () => {
  const salida = reemplazarTablaMuestraComparables(TABLA_17, conComparables, (v) => v);
  assert.ok(!salida.includes('AKATSUKI'), 'sobrevivió una comparable del informe de referencia');
  assert.ok(!salida.includes('COLOPL'), 'sobrevivió una comparable del informe de referencia');
  assert.ok(salida.includes('DISTRIBUIDORA ANDINA S.A.'));
  assert.ok(salida.includes('GULF FUEL TRADING CO'));
});

test('la tabla 17 conserva su encabezado y las anclas de Word', () => {
  /* «RANGE!E11» y «_Hlk143111901» son destino de referencias del documento:
     reconstruir la fila del encabezado las dejaría rotas. */
  const salida = reemplazarTablaMuestraComparables(TABLA_17, conComparables, (v) => v);
  assert.ok(salida.includes('id="RANGE!E11"'), 'se perdió el ancla del encabezado');
  assert.ok(salida.includes('id="_Hlk143111901"'), 'se perdió el ancla del encabezado');
  assert.ok(salida.includes('<strong>Número</strong>'), 'se perdió el encabezado');
});

test('la tabla 17 numera correlativo y traduce el ámbito', () => {
  const salida = reemplazarTablaMuestraComparables(TABLA_17, conComparables, (v) => v);
  const texto = salida.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(/1 DISTRIBUIDORA ANDINA S\.A\. NACIONAL/.test(texto), 'la nacional debe salir como NACIONAL');
  assert.ok(/2 GULF FUEL TRADING CO INTERNACIONAL/.test(texto));
  assert.ok(/3 SIN CIFRAS S\.A\./.test(texto), 'la comparable sin cifras también es parte de la muestra');
});

test('la tabla 19 sale con los márgenes del estudio', () => {
  const salida = reemplazarTablaMargenComparables(TABLA_19, conComparables, (v) => v);
  assert.ok(!salida.includes('16.557%'), 'sobrevivió un margen del informe de referencia');
  assert.ok(!salida.includes('AKATSUKI'), 'sobrevivió una comparable del informe de referencia');
  const texto = salida.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(/DISTRIBUIDORA ANDINA S\.A\. 10\.00% 10\.00%/.test(texto), 'MO = 100 / 1000');
  assert.ok(/GULF FUEL TRADING CO 13\.00% 13\.00%/.test(texto), 'MO = 260 / 2000');
});

test('la comparable sin estados financieros sale con hueco, no omitida', () => {
  /* Omitirla dejaría la tabla 19 más corta que la 17 sin nada que lo explique, y el
     hueco es lo que delata que falta cargarle las cifras. */
  const salida = reemplazarTablaMargenComparables(TABLA_19, conComparables, (v) => v);
  const texto = salida.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(/SIN CIFRAS S\.A\. — —/.test(texto), 'la comparable sin cifras debe salir con dos huecos');
});

test('sin comparables las tablas 17 y 19 se quedan como estaban', () => {
  /* Mismo criterio que la tabla 16: preferible que se vea que falta cargar la muestra
     a que salgan filas inventadas. El aviso del generador es el que lo dice. */
  assert.strictEqual(reemplazarTablaMuestraComparables(TABLA_17, otroCliente, (v) => v), TABLA_17);
  assert.strictEqual(reemplazarTablaMargenComparables(TABLA_19, otroCliente, (v) => v), TABLA_19);
});

test('filasComparablesInforme descarta las filas sin razón social', () => {
  /* La tabla del motor arranca con filas en blanco que el usuario va llenando: una fila
     numerada y sin nombre en la muestra final no dice nada. */
  const filas = filasComparablesInforme({
    ...conComparables,
    comparables: [...conComparables.comparables, { name: '   ', s: 500, c: 400, op: 50 }],
  });
  assert.strictEqual(filas.length, 3);
  assert.ok(filas.every((f) => f.nombre), 'se coló una fila sin nombre');
});

test('la hidratación completa engancha las dos tablas', () => {
  /* Sin esta llamada dentro de `hydrateExactWordTemplate` las funciones existirían y no
     las usaría nadie, que es como estaba el documento hasta ahora. */
  const salida = hydrateExactWordTemplate(TABLA_17 + TABLA_19, conComparables);
  assert.ok(!salida.includes('AKATSUKI'), 'la tabla 17 no se enganchó en la hidratación');
  assert.ok(!salida.includes('16.557%'), 'la tabla 19 no se enganchó en la hidratación');
  assert.ok(salida.includes('DISTRIBUIDORA ANDINA S.A.'));
});

test('el diagnóstico avisa de la muestra sin cargar y de las comparables sin cifras', () => {
  const sinMuestra = diagnosticarCobertura(TABLA_17, otroCliente);
  assert.strictEqual(sinMuestra.comparablesCubiertas, false);

  const con = diagnosticarCobertura(TABLA_17, conComparables);
  assert.strictEqual(con.comparablesCubiertas, true);
  assert.strictEqual(con.comparablesSinCifras, 1, 'la comparable sin estados financieros');
});

test('el año de la frase que introduce la tabla 19 se actualiza', () => {
  /* «los estados financieros correspondientes al año 2024» fecha las cifras que ahora
     se regeneran: dejarlo en el año del informe de referencia las fecharía mal. */
  const html = '<p>para los estados financieros correspondientes al año 2024:</p>';
  const salida = hydrateExactWordTemplate(html, conComparables);
  assert.ok(!salida.includes('correspondientes al año 2024'), 'quedó el año del informe de referencia');
  assert.ok(salida.includes('2025'), 'no se puso el año del estudio');
});
