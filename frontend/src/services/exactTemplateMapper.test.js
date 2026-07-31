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
