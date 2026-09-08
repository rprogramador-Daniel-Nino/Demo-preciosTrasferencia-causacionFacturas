/* ─────────────────────────────────────────────────────────────────────────────
   muestraManual.js — las comparables que el analista agregó a mano no las borra el motor.

   POR QUÉ EXISTE. Desde el 2026-09-04 cargar un estado financiero crea la comparable si no
   existe, que es el segundo camino del proceso: buscar las comparables por fuera, soltar sus
   EEFF y que el sistema arme la muestra. Pero esas filas viven solo en la MUESTRA, y el motor
   selecciona del UNIVERSO —el cribado importado en el paso 1—, así que la siguiente corrida de
   «Ejecutar Selección Automática» las borraba todas.

   El analista perdía el trabajo entero sin aviso: doce estados financieros cargados a mano y un
   clic en el botón equivocado.

   LA REGLA. Una comparable que el analista agregó a mano es una DECISIÓN TOMADA, no una
   candidata a evaluar. Se conserva, ocupa cupo, y solo sale si él la retira. Es la misma lógica
   que ya protege lo que se retira a mano (`retiradasManual` en `MotorComparables.jsx`): el
   motor propone, el analista dispone, y una corrida nueva no puede deshacer lo que él decidió.

   POR QUE NO SE RESUELVE METIENDOLAS AL UNIVERSO. Serían candidatas: competirían por puntaje,
   las filtraría el mismo embudo y la curación no podría juzgar su actividad —se crean desde su
   estado financiero, sin la descripción del negocio que trae Capital IQ—. Acabarían fuera de la
   muestra por criterios que no aplican a una elección deliberada.

   Servicio puro, sin React y sin red, como `conciliacionEstudioAnterior.js`.
   ───────────────────────────────────────────────────────────────────────────── */

import { claveDeCruce, nameKey, enPerdida } from './comparablesEngine.js';

/**
 * Une la selección del motor con las comparables que el analista agregó a mano.
 *
 * @param {Array}  muestraPrevia  la muestra antes de esta corrida; de ahí salen las de a mano.
 * @param {Array}  delMotor       lo que devolvió `scoreCandidates` en esta corrida.
 * @param {number} cupo           el tamaño de muestra que el motor aplicó —ya con su piso—.
 * @returns {{muestra: Array, conservadas: number, excedeObjetivo: boolean}}
 */
export function fusionarAgregadasAMano(muestraPrevia, delMotor, cupo) {
  const previas = Array.isArray(muestraPrevia) ? muestraPrevia : [];
  const motor = Array.isArray(delMotor) ? delMotor : [];

  /* Solo lo que el analista AGREGO, no lo que el motor eligió en una corrida anterior: si se
     conservara todo, cambiar un filtro no cambiaría nunca la muestra. */
  const aMano = previas.filter((c) => c && c.creadaDesdeEeff);
  if (!aMano.length) {
    return { muestra: motor, conservadas: 0, excedeObjetivo: false };
  }

  /* La compañía que acabó apareciendo también en el cribado es la MISMA: contarla dos veces la
     metería dos veces al cuartil. Gana la del analista, que es la que trae el estado financiero
     que él cargó. El cruce va por `claveDeCruce` y no por el nombre literal, para que «Bolak
     Co. Ltd» y «Bolak Company Limited» se reconozcan como una sola. */
  const clavesAMano = new Set(aMano.map((c) => claveDeCruce(c.name || '')));
  const delMotorSinRepetir = motor.filter((c) => !clavesAMano.has(claveDeCruce((c && c.name) || '')));

  /* Las de a mano ocupan cupo: sin eso, cargar doce y pedir doce daría veinticuatro. El motor
     completa lo que falte. */
  const sitiosLibres = Math.max(0, (Number(cupo) || 0) - aMano.length);

  return {
    /* Primero las de a mano: son decisiones tomadas y encabezan la muestra. */
    muestra: [...aMano, ...delMotorSinRepetir.slice(0, sitiosLibres)],
    conservadas: aMano.length,
    /* Con más agregadas a mano que cupo entran TODAS igual —retirar cinco por un número de
       configuración sería tirar el trabajo del analista— y se dice que la muestra excede el
       objetivo para que él decida si retira alguna. */
    excedeObjetivo: aMano.length > (Number(cupo) || 0),
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Lo que el analista RETIRÓ tampoco lo devuelve el motor.

   POR QUÉ EXISTE. Medido el 2026-09-08 con el motor real, a raíz de «estoy viendo resultados
   que difieren»: se borra una comparable de la muestra, se vuelve a ejecutar la selección, y
   VUELVE. `retiradasManual` se escribía en el embudo y se leía solo para contar
   (`tablasInforme.js`), pero nadie se la daba al motor, que selecciona del universo sin saber
   qué decidió el analista.

   Y esta nota lo afirmaba de más: decía que `fusionarAgregadasAMano` era «la misma lógica que ya
   protege lo que se retira a mano». No protegía nada. Ahora sí, y aquí está.

   SE REPONE EL SITIO. Retirar una comparable no es querer una muestra más pequeña: es querer
   OTRA comparable en su lugar —«esta no, busca otra»—. Así que el hueco se llena con la primera
   de la reserva, que ya pasó todos los filtros y la curación. Dejar la muestra corta empujaría
   el cuartil por una decisión que no era esa.

   POR QUÉ NO SE FILTRA EL UNIVERSO NI SE MARCAN COMO RECHAZADAS. Las dos cosas romperían la
   contabilidad que el informe ya publica: filtrar el universo baja `evaluadas` y la tabla de
   razones de rechazo deja de sumar el universo evaluado; y marcarlas rechazadas las contaría
   DOS veces, porque `filasRazonesRechazo` ya suma `retiradasManual` a las diferencias
   funcionales. Se quedan donde ya estaban contadas y solo se les quita el sitio en la muestra.

   @param {Array} seleccionadas  lo que el motor eligió, en su orden.
   @param {Array} reserva        las que pasaron todo y no alcanzaron cupo, por puntaje.
   @param {Array<string>} retiradas  claves (`nameKey`) de las que el analista quitó.
   @returns {{muestra: Array, retiradasHonradas: number, repuestas: number, sinReponer: number}}
   ───────────────────────────────────────────────────────────────────────────── */
export function aplicarRetiradasManuales(seleccionadas, reserva, retiradas) {
  const elegidas = Array.isArray(seleccionadas) ? seleccionadas : [];
  const suplentes = Array.isArray(reserva) ? reserva : [];
  const fuera = new Set((Array.isArray(retiradas) ? retiradas : []).filter(Boolean));
  if (!fuera.size) {
    return { muestra: elegidas, retiradasHonradas: 0, repuestas: 0, sinReponer: 0 };
  }

  const clave = (c) => (c && c.nameKey) || nameKey((c && c.name) || '');
  const quedan = elegidas.filter((c) => !fuera.has(clave(c)));
  const honradas = elegidas.length - quedan.length;
  if (!honradas) {
    return { muestra: elegidas, retiradasHonradas: 0, repuestas: 0, sinReponer: 0 };
  }

  /* La reserva también se filtra: una retirada que quedó en reserva no puede entrar por la
     puerta de atrás a ocupar el hueco que ella misma dejó. */
  const reponibles = suplentes.filter((c) => !fuera.has(clave(c)));
  const repuestas = reponibles.slice(0, honradas);

  return {
    muestra: [...quedan, ...repuestas],
    retiradasHonradas: honradas,
    repuestas: repuestas.length,
    /* Sin reserva suficiente la muestra queda corta, y eso hay que decirlo: el cuartil se
       calcula sobre menos comparables de las pedidas. */
    sinReponer: honradas - repuestas.length,
  };
}

/** Cuántas de la muestra están en pérdida, y cuántas de esas entraron ampliando la actividad.
 *
 *  Se cuenta sobre la muestra FINAL y no sobre lo que devolvió el motor: entre las dos cosas
 *  pasan las retiradas manuales y la fusión con las agregadas a mano, que cambian quién está
 *  dentro. El informe y el Excel justifican la política de pérdidas con este número, así que
 *  tiene que describir la muestra que se radica y no una intermedia. */
export function negativasDeLaMuestra(muestra) {
  const filas = (Array.isArray(muestra) ? muestra : []).filter(Boolean);
  const negativas = filas.filter((c) => enPerdida(c));
  return {
    incluidas: negativas.length,
    porAmpliacion: negativas.filter((c) => c.entroPorAmpliacion).length,
  };
}
