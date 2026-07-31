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
