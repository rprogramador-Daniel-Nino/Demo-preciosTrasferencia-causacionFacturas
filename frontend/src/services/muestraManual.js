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

import { claveDeCruce } from './comparablesEngine.js';

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
