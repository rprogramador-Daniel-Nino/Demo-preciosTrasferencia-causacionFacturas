import { test } from 'node:test';
import assert from 'node:assert';
import { hydrateExactWordTemplate } from './exactTemplateMapper.js';

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
