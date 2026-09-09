/* Pruebas de la conservación de las comparables agregadas a mano.

   EL HUECO QUE CIERRAN. Desde el 2026-09-04 cargar un estado financiero crea la comparable si
   no existe, que es el segundo camino del proceso: buscar las comparables por fuera, soltar sus
   EEFF y que el sistema arme la muestra. Pero esas filas viven solo en la MUESTRA, y el motor
   selecciona del UNIVERSO —el cribado de Capital IQ—, asi que la siguiente corrida de «Ejecutar
   Seleccion Automatica» las borraba todas.

   El analista perdia el trabajo entero sin aviso: doce estados financieros cargados a mano y un
   clic en el boton equivocado.

   La regla: una comparable que el analista agrego a mano es una DECISION TOMADA, no una
   candidata a evaluar. Se conserva, ocupa cupo, y solo sale si el analista la retira.

   Esta nota decia que era «la misma logica que ya protege lo que se retira a mano
   (`retiradasManual`)», y eso era FALSO: esa lista se escribia en el embudo y se leia solo para
   contar, sin llegar nunca al motor, asi que una comparable borrada volvia en la corrida
   siguiente. Se midio y se corrigio el 2026-09-08; la proteccion la da ahora
   `aplicarRetiradasManuales`, probada al final de este archivo. */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  fusionarAgregadasAMano, aplicarRetiradasManuales, negativasDeLaMuestra,
} from './muestraManual.js';
import { nameKey } from './comparablesEngine.js';

const dele = (name, extra = {}) => ({ name, s: 1000, c: 800, op: 100, ...extra });
const aMano = (name) => dele(name, { creadaDesdeEeff: true });

test('la agregada a mano sobrevive a una corrida del motor', () => {
  const previas = [aMano('Cargada A'), aMano('Cargada B'), dele('Del cribado')];
  const delMotor = [dele('Motor 1'), dele('Motor 2')];
  const r = fusionarAgregadasAMano(previas, delMotor, 4);
  const nombres = r.muestra.map((c) => c.name);
  assert.ok(nombres.includes('Cargada A') && nombres.includes('Cargada B'),
    'las dos cargadas a mano siguen ahí');
  assert.strictEqual(r.conservadas, 2);
});

test('la del cribado NO se conserva: esa sí la decide el motor', () => {
  /* Solo se protege lo que el analista agregó, no lo que el motor eligió en una corrida
     anterior: si no, cambiar un filtro no cambiaría nunca la muestra. */
  const previas = [dele('Del cribado', { creadaDesdeEeff: false })];
  const r = fusionarAgregadasAMano(previas, [dele('Motor 1')], 4);
  assert.deepStrictEqual(r.muestra.map((c) => c.name), ['Motor 1']);
  assert.strictEqual(r.conservadas, 0);
});

test('las agregadas a mano ocupan cupo: el motor completa el resto', () => {
  /* Si no ocuparan cupo, cargar doce a mano y pedir doce daría veinticuatro. */
  const previas = [aMano('A'), aMano('B'), aMano('C')];
  const delMotor = [dele('M1'), dele('M2'), dele('M3'), dele('M4'), dele('M5')];
  const r = fusionarAgregadasAMano(previas, delMotor, 5);
  assert.strictEqual(r.muestra.length, 5);
  assert.deepStrictEqual(r.muestra.slice(0, 3).map((c) => c.name), ['A', 'B', 'C'],
    'las de a mano van primero: son decisiones tomadas');
  assert.strictEqual(r.muestra.filter((c) => c.creadaDesdeEeff).length, 3);
});

test('nunca se recorta por debajo de lo que el motor considera su mínimo', () => {
  /* El cupo del motor ya viene con el piso aplicado; recortar por debajo dejaría la muestra
     sin el número que el informe exige. */
  const previas = [aMano('A')];
  const delMotor = Array.from({ length: 10 }, (_, i) => dele('M' + i));
  const r = fusionarAgregadasAMano(previas, delMotor, 10);
  assert.strictEqual(r.muestra.length, 10);
});

test('con más agregadas a mano que cupo, entran todas igual', () => {
  /* El analista cargó quince estados financieros: retirar cinco por un número de configuración
     sería tirar su trabajo. Se conservan y se dice que la muestra excede el objetivo. */
  const previas = Array.from({ length: 15 }, (_, i) => aMano('A' + i));
  const r = fusionarAgregadasAMano(previas, [dele('M1')], 12);
  assert.strictEqual(r.muestra.length, 15);
  assert.strictEqual(r.excedeObjetivo, true);
  assert.ok(!r.muestra.some((c) => c.name === 'M1'), 'y el motor no agrega más');
});

test('no se duplica la que el motor también trajo', () => {
  /* Si la compañía acabó apareciendo en el cribado, es la misma: contarla dos veces la metería
     dos veces al cuartil. */
  const previas = [aMano('Bolak Co. Ltd')];
  const delMotor = [dele('Bolak Company Limited'), dele('Otra')];
  const r = fusionarAgregadasAMano(previas, delMotor, 4);
  assert.strictEqual(r.muestra.filter((c) => /Bolak/i.test(c.name)).length, 1);
  assert.strictEqual(r.muestra[0].name, 'Bolak Co. Ltd',
    'gana la del analista: trae el EEFF que él cargó');
});

test('sin agregadas a mano no cambia nada', () => {
  const delMotor = [dele('M1'), dele('M2')];
  const r = fusionarAgregadasAMano([], delMotor, 4);
  assert.deepStrictEqual(r.muestra, delMotor);
  assert.strictEqual(r.conservadas, 0);
  assert.strictEqual(r.excedeObjetivo, false);
});

/* ══════════ LO RETIRADO A MANO NO VUELVE, Y LAS NEGATIVAS SE CUENTAN DONDE IMPORTA ══════════

   Medido el 2026-09-08 con el motor real, tras «estoy viendo resultados que difieren»:

     · se borraba una comparable, se reejecutaba la selección y VOLVÍA. `retiradasManual` se
       escribía en el embudo y se leía solo para contar; nadie se la daba al motor.
     · con diez comparables agregadas a mano, la muestra acababa con DOS en pérdida y el embudo
       —y con él el informe y el Excel— seguía declarando TRES: `negativasIncluidas` venía del
       motor, sin corregir por la fusión que recorta su lista para hacer sitio a las manuales. */

const c = (name, extra = {}) => ({ name, nameKey: nameKey(name), s: 100, op: 10, ...extra });
const enPerdidaC = (name, extra = {}) => c(name, { op: -10, ...extra });

test('la comparable retirada sale de la muestra y su sitio lo ocupa la reserva', () => {
  /* Retirar no es querer una muestra más pequeña: es querer OTRA en su lugar. */
  const r = aplicarRetiradasManuales(
    [c('Alfa SA'), c('Beta SA'), c('Gamma SA')],
    [c('Suplente SA'), c('Otra Suplente SA')],
    [nameKey('Beta SA')],
  );
  assert.deepStrictEqual(r.muestra.map((x) => x.name),
    ['Alfa SA', 'Gamma SA', 'Suplente SA']);
  assert.strictEqual(r.muestra.length, 3, 'la muestra no se encoge');
  assert.strictEqual(r.retiradasHonradas, 1);
  assert.strictEqual(r.repuestas, 1);
  assert.strictEqual(r.sinReponer, 0);
});

test('una retirada que quedó en reserva no entra por la puerta de atrás', () => {
  /* Si no, ocuparía el hueco que ella misma dejó y el borrado no serviría de nada. */
  const r = aplicarRetiradasManuales(
    [c('Alfa SA'), c('Beta SA')],
    [c('Beta SA'), c('Suplente SA')],
    [nameKey('Beta SA')],
  );
  assert.deepStrictEqual(r.muestra.map((x) => x.name), ['Alfa SA', 'Suplente SA']);
});

test('sin reserva suficiente la muestra queda corta, y se dice', () => {
  /* El cuartil se calcularía sobre menos comparables de las pedidas: callarlo es lo que hacía
     que un descuadre llegara a la radicación sin aviso. */
  const r = aplicarRetiradasManuales([c('Alfa SA'), c('Beta SA')], [], [nameKey('Beta SA')]);
  assert.strictEqual(r.muestra.length, 1);
  assert.strictEqual(r.repuestas, 0);
  assert.strictEqual(r.sinReponer, 1);
});

test('sin retiradas no toca nada, y devuelve la misma lista', () => {
  const elegidas = [c('Alfa SA'), c('Beta SA')];
  const r = aplicarRetiradasManuales(elegidas, [c('Suplente SA')], []);
  assert.strictEqual(r.muestra, elegidas, 'la misma referencia: no hay trabajo que hacer');
  assert.strictEqual(r.retiradasHonradas, 0);
  /* Y una clave que no está en la muestra tampoco altera nada. */
  const ajena = aplicarRetiradasManuales(elegidas, [], [nameKey('Nadie SA')]);
  assert.strictEqual(ajena.muestra, elegidas);
  assert.strictEqual(ajena.retiradasHonradas, 0);
});

test('las negativas se cuentan sobre la muestra FINAL, no sobre la del motor', () => {
  /* El número exacto del defecto: diez a mano y dos en pérdida donde el embudo decía tres. */
  const muestra = [
    ...Array.from({ length: 10 }, (_, i) => c('Manual ' + i, { creadaDesdeEeff: true })),
    enPerdidaC('Neg 0'),
    enPerdidaC('Neg 1'),
  ];
  const n = negativasDeLaMuestra(muestra);
  assert.strictEqual(n.incluidas, 2, 'las que de verdad están en la muestra que se radica');
  assert.strictEqual(n.porAmpliacion, 0);
});

test('distingue las negativas que entraron ampliando la actividad', () => {
  /* Esas piden dos justificaciones en el informe —la pérdida y la ampliación del criterio— así
     que el conteo no puede fundirlas con las de actividad idéntica. */
  const n = negativasDeLaMuestra([
    enPerdidaC('Identica SA'),
    enPerdidaC('Afin SA', { entroPorAmpliacion: true }),
    c('Positiva SA', { entroPorAmpliacion: true }),
  ]);
  assert.strictEqual(n.incluidas, 2);
  assert.strictEqual(n.porAmpliacion, 1, 'la positiva ampliada no es una negativa');
});

test('una muestra vacía o basura no rompe el conteo', () => {
  assert.deepStrictEqual(negativasDeLaMuestra([]), { incluidas: 0, porAmpliacion: 0 });
  assert.deepStrictEqual(negativasDeLaMuestra(null), { incluidas: 0, porAmpliacion: 0 });
  assert.deepStrictEqual(negativasDeLaMuestra([null, undefined]), { incluidas: 0, porAmpliacion: 0 });
});
