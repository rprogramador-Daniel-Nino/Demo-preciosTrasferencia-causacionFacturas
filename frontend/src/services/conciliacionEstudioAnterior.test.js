/* Pruebas de la conciliación contra el estudio del año anterior.

   LO QUE VIENE A RESOLVER, dicho por el usuario el 2026-09-02 en tres mensajes seguidos:

     «la continuidad de las comparables no me está trayendo las mismas comparables del año
      pasado y lo que necesito es eso»
     «con eso podemos hacer una mejor justificación de porqué ya no esas comparables»
     «nuestra idea es como, bueno generamos con las comparables del año anterior, si nos funciona
      pues perfecto, y si no ya tenemos justificación del porqué no de ello a nuestros clientes»

   O sea: primero se intenta el estudio con la muestra del año pasado —que es lo más defendible,
   porque la consistencia año a año es un argumento de comparabilidad en sí mismo— y si no se
   puede, hace falta el motivo de CADA comparable que no volvió, para dárselo al cliente.

   El motor no podía darlo. Marcaba `esContinuidad` cruzando por nombre contra el universo de
   este año, así que reconocía a la que SIGUE en el cribado y nada más: una comparable que este
   año el screening no devolvió es invisible —no está entre las candidatas, no se puede
   seleccionar ni rechazar— y simplemente no sale. */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  conciliarConEstudioAnterior, parecidoEnElUniverso,
} from './conciliacionEstudioAnterior.js';

const c = (name, extra = {}) => ({ name, ...extra });

test('sin estudio anterior no hay nada que conciliar', () => {
  assert.strictEqual(conciliarConEstudioAnterior({ previas: [], universo: [], muestra: [] }), null);
  assert.strictEqual(conciliarConEstudioAnterior({}), null);
});

test('la que sigue en la muestra no necesita explicación', () => {
  const r = conciliarConEstudioAnterior({
    previas: [c('Furukawa Electric Co., Ltd.')],
    universo: [c('Furukawa Electric Co Ltd (TSE:5801)')],
    muestra: [c('Furukawa Electric Co Ltd (TSE:5801)')],
  });
  assert.strictEqual(r.filas[0].estado, 'enLaMuestra');
  assert.strictEqual(r.filas[0].motivo, '');
  assert.strictEqual(r.porExplicar, 0);
});

test('el cruce aguanta el sufijo de bolsa y las formas societarias', () => {
  /* Es lo que hace coincidir el nombre del informe del año pasado —«Furukawa Electric Co.,
     Ltd.»— con el del export de Capital IQ —«Furukawa Electric Co Ltd (TSE:5801)»—. Sin esta
     normalización el cruce de continuidad no encontraba nada aunque la compañía siguiera ahí. */
  const r = conciliarConEstudioAnterior({
    previas: [c('Huber+Suhner AG'), c('Tai Sin Electric Limited')],
    universo: [c('Huber+Suhner AG (SWX:HUBN)'), c('Tai Sin Electric Ltd.')],
    muestra: [c('Huber+Suhner AG (SWX:HUBN)'), c('Tai Sin Electric Ltd.')],
  });
  assert.strictEqual(r.enLaMuestra, 2, 'las dos cruzaron');
});

test('la descartada por un filtro trae el filtro y su motivo, para citarlo en el informe', () => {
  const r = conciliarConEstudioAnterior({
    previas: [c('Alfa SA')],
    universo: [c('Alfa SA')],
    muestra: [],
    rechazadas: [c('Alfa SA', {
      motivoClave: 'controlada',
      motivoRechazo: 'Vinculada: un accionista alcanza o supera el 50 % del capital (Art. 260-1 E.T.).',
    })],
  });
  assert.strictEqual(r.filas[0].estado, 'descartadaPorFiltro');
  assert.strictEqual(r.filas[0].filtro, 'controlada');
  assert.match(r.filas[0].motivo, /260-1/);
  assert.strictEqual(r.descartadas, 1);
});

test('la que quedó en reserva es la más fácil de sustentar: sigue siendo comparable', () => {
  const r = conciliarConEstudioAnterior({
    previas: [c('Beta SA')],
    universo: [c('Beta SA')],
    muestra: [],
    reserva: [c('Beta SA')],
  });
  assert.strictEqual(r.filas[0].estado, 'enReserva');
  assert.match(r.filas[0].motivo, /Sigue siendo comparable/);
});

test('la que el cribado NO devolvió se nombra, y se dice que el motor no puede traerla', () => {
  /* EL CASO QUE EL MOTOR NO PODIA VER, y el que motivó todo esto. */
  const r = conciliarConEstudioAnterior({
    previas: [c('Compañía Que Ya No Cotiza SA')],
    universo: [c('Otra Cosa Distinta Ltd')],
    muestra: [c('Otra Cosa Distinta Ltd')],
  });
  assert.strictEqual(r.filas[0].estado, 'fueraDelCribado');
  assert.strictEqual(r.fueraDelCribado, 1);
  assert.match(r.filas[0].motivo, /Ningún ajuste del motor puede traerla/);
  assert.match(r.filas[0].motivo, /deslistada|fusionada|dejó de publicar/,
    'y ofrece las causas que el analista puede sustentar');
});

test('cuando hay una candidata PARECIDA se nombra: suele ser la misma con otro nombre', () => {
  /* El motivo más común de «no me trae las mismas» no es que la compañía se haya ido: es que el
     informe del año pasado escribió el nombre de otra forma. Se nombra para poder corregirlo, y
     NO se da por continuidad: un parecido no es una identidad. */
  const r = conciliarConEstudioAnterior({
    previas: [c('Yangtze Optical Fibre and Cable Joint Stock Co')],
    universo: [c('Yangtze Optical Fibre And Cable Joint Stock Limited Company (SHSE:601869)')],
    muestra: [],
  });
  const f = r.filas[0];
  assert.strictEqual(f.estado, 'fueraDelCribado', 'no se da por continuidad');
  assert.ok(f.parecido, 'pero se nombra el parecido');
  assert.match(f.parecido.name, /Yangtze/);
  assert.match(f.motivo, /podría ser la misma escrita de otra forma/);
  assert.strictEqual(r.posiblesCoincidencias, 1);
});

test('un parecido necesita al menos dos palabras propias en común', () => {
  /* Con una sola, «Electric» emparejaría a media industria y el aviso dejaría de servir. */
  assert.strictEqual(
    parecidoEnElUniverso('Alfa Electric Group', [c('Beta Electric Holdings')]),
    null,
    'solo comparten palabras vacías: no hay parecido',
  );
  assert.ok(
    parecidoEnElUniverso('Sumitomo Electric Industries', [c('Sumitomo Electric Industries Ltd')]),
    'dos palabras propias en común sí',
  );
});

test('cuenta lo que hay que explicar, que es todo lo que no siguió en la muestra', () => {
  const r = conciliarConEstudioAnterior({
    previas: [c('Sigue SA'), c('Cae SA'), c('Reserva SA'), c('Se Fue SA')],
    universo: [c('Sigue SA'), c('Cae SA'), c('Reserva SA')],
    muestra: [c('Sigue SA')],
    rechazadas: [c('Cae SA', { motivoClave: 'holding', motivoRechazo: 'Sociedad de tenencia.' })],
    reserva: [c('Reserva SA')],
  });
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.enLaMuestra, 1);
  assert.strictEqual(r.descartadas, 1);
  assert.strictEqual(r.enReserva, 1);
  assert.strictEqual(r.fueraDelCribado, 1);
  assert.strictEqual(r.porExplicar, 3, 'las tres que no siguieron');
});

test('la que está en el cribado pero fuera de la última corrida no recibe un motivo inventado', () => {
  /* Pasa cuando el cribado se reimportó después de la última ejecución del motor. Se dice lo que
     se sabe —que hay que volver a ejecutar— en vez de atribuirle un descarte que nadie decidió. */
  const r = conciliarConEstudioAnterior({
    previas: [c('Gamma SA')],
    universo: [c('Gamma SA')],
    muestra: [],
  });
  assert.strictEqual(r.filas[0].estado, 'enElCribadoSinEvaluar');
  assert.match(r.filas[0].motivo, /Vuelva a ejecutar/);
});

test('acepta las comparables del estudio anterior vengan con `name` o con `nombre`', () => {
  /* `priorStudyParser` extrae `nombre` del informe en PDF y el catálogo de Firestore mapea a
     `name`: los dos llegan a este servicio según de dónde salga el estudio anterior. */
  const r = conciliarConEstudioAnterior({
    previas: [{ nombre: 'Delta SA' }],
    universo: [c('Delta SA')],
    muestra: [c('Delta SA')],
  });
  assert.strictEqual(r.enLaMuestra, 1);
  assert.strictEqual(r.filas[0].name, 'Delta SA');
});
