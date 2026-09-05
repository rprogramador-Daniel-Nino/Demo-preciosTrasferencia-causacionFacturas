/* Pruebas del respaldo de actividad económica por razón social.

   LO QUE VIENE A RESOLVER, reportado el 2026-09-05 con una captura: diez comparables creadas
   desde sus estados financieros, todas con «Actividad sin verificar» y un textarea vacío que
   había que llenar a mano, empresa por empresa.

   El camino que manda es el documento —el prompt del lote lee la nota de «Entidad reportante»—
   pero buena parte de lo que se carga a mano es un estado de resultados suelto, sin ninguna
   nota. Este servicio cubre eso preguntando por la razón social.

   LO QUE LAS PRUEBAS PROTEGEN, y es una sola cosa: que NO invente. Una actividad deducida del
   nombre acaba publicada en un informe tributario como si fuera un hecho verificado. Por eso
   casi todos los casos de abajo son formas distintas de decir «no la conozco», y todas tienen
   que acabar en el mismo sitio: fuera. */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  promptActividadPorRazonSocial, leerRespuestaActividades,
} from './actividadComparables.js';

const respuesta = (companias) => JSON.stringify({ companias });

test('sin nombres no hay prompt: no se gasta una llamada en una lista vacía', () => {
  assert.strictEqual(promptActividadPorRazonSocial([]), '');
  assert.strictEqual(promptActividadPorRazonSocial(null), '');
  assert.strictEqual(promptActividadPorRazonSocial(['', '   ']), '');
});

test('el prompt numera las compañías y le prohíbe deducirlas del nombre', () => {
  const p = promptActividadPorRazonSocial(['SYMRISE AG', 'T. HASEGAWA CO., LTD.']);
  assert.match(p, /1\. SYMRISE AG/);
  assert.match(p, /2\. T\. HASEGAWA CO\., LTD\./);
  assert.match(p, /NO DEDUZCAS/);
  assert.match(p, /"seguro": false/, 'y le da la forma de decir que no la conoce');
});

test('la actividad de una compañía conocida vuelve con el nombre TAL COMO SE PIDIÓ', () => {
  /* El nombre que devuelve el modelo no sirve para encontrar la fila: la fila está indexada por
     el nombre que trae el estado financiero. */
  const r = leerRespuestaActividades(
    respuesta([{ nombre: 'Symrise AG', actividad: 'Produce fragancias y aromas.', seguro: true }]),
    ['SYMRISE AG'],
  );
  assert.deepStrictEqual(r, [{ nombre: 'SYMRISE AG', actividad: 'Produce fragancias y aromas.' }]);
});

test('`seguro: false` se descarta aquí, y no más adelante', () => {
  /* Es el caso que da sentido al servicio: el modelo dijo que no la conoce y aun así redactó
     algo. Se tira lo redactado. */
  const r = leerRespuestaActividades(
    respuesta([{ nombre: 'ANHUI HYEA AROMAS', actividad: 'Fabricación de aromas.', seguro: false }]),
    ['ANHUI HYEA AROMAS'],
  );
  assert.deepStrictEqual(r, [], 'no la conoce: no entra, por bien redactada que esté');
});

test('la actividad vacía también descarta, aunque falte la bandera', () => {
  const r = leerRespuestaActividades(
    respuesta([{ nombre: 'BOLAK COMPANY LIMITED', actividad: '   ', seguro: true }]),
    ['BOLAK COMPANY LIMITED'],
  );
  assert.deepStrictEqual(r, []);
});

test('la compañía por la que el modelo no respondió no se inventa', () => {
  const r = leerRespuestaActividades(
    respuesta([{ nombre: 'GIVAUDAN SA', actividad: 'Fragancias y sabores.', seguro: true }]),
    ['GIVAUDAN SA', 'PRIVI SPECIALITY CHEMICALS LIMITED'],
  );
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].nombre, 'GIVAUDAN SA');
});

test('el cruce aguanta la forma societaria y la puntuación', () => {
  /* Mismo criterio que la conciliación con el estudio anterior: el modelo normaliza el nombre a
     su gusto, y con una comparación literal se perdería la respuesta que sí dio. */
  const r = leerRespuestaActividades(
    respuesta([{ nombre: 'T Hasegawa Co Ltd', actividad: 'Sabores para alimentos.', seguro: true }]),
    ['T. HASEGAWA CO., LTD.'],
  );
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].nombre, 'T. HASEGAWA CO., LTD.', 'devuelve el nombre de la fila');
});

test('el JSON envuelto en prosa se rescata, que es como responden los modelos', () => {
  /* La razón por la que el sistema usa `extraerJSON` y no `JSON.parse` sobre el texto recortado
     a mano: el modelo agrega una frase después del objeto con frecuencia. */
  const texto = 'Claro, aquí tienes:\n```json\n'
    + respuesta([{ nombre: 'ORIENTAL AROMATICS LIMITED', actividad: 'Aromas y fragancias.', seguro: true }])
    + '\n```\nEspero que te sirva.';
  const r = leerRespuestaActividades(texto, ['ORIENTAL AROMATICS LIMITED']);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].actividad, 'Aromas y fragancias.');
});

test('una respuesta ilegible deja el lote sin actividades, no lo tumba', () => {
  assert.deepStrictEqual(leerRespuestaActividades('lo siento, no puedo ayudarte', ['ALFA SA']), []);
  assert.deepStrictEqual(leerRespuestaActividades('', ['ALFA SA']), []);
  assert.deepStrictEqual(leerRespuestaActividades(respuesta([]), ['ALFA SA']), []);
});

test('sin nombres pedidos no devuelve nada, aunque el modelo mande compañías', () => {
  /* Defensivo: lo que no se pidió no se aplica a ninguna fila. */
  const r = leerRespuestaActividades(
    respuesta([{ nombre: 'Una Que Nadie Pidió SA', actividad: 'Algo.', seguro: true }]),
    [],
  );
  assert.deepStrictEqual(r, []);
});
