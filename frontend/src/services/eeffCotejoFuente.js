/* ─────────────────────────────────────────────────────────────────────────────
   eeffCotejoFuente.js — ¿lo que se leyó de la ficha coincide con la base de datos
   de donde salieron esas cifras?

   POR QUÉ EXISTE. Las fichas de estados financieros que se adjuntan al Anexo B las
   produce una macro de Word a partir de Capital IQ, y el estudio ya trae ese mismo
   origen cargado: el export de screening (`END GAME 2025.xls` y sus equivalentes)
   entra por `importCapitalIQExcel` y deja en cada fila los ingresos, el costo y la
   utilidad operacional de la compañía. Es un testigo externo de la lectura, y no se
   estaba usando.

   Lo que había hasta ahora, `verifyAccountingEqualities`, comprueba la aritmética
   INTERNA del documento: que la utilidad bruta sea ventas menos costo, que la
   ecuación patrimonial cuadre. Es necesario y no alcanza — una cifra tomada de la
   fila equivocada puede cuadrar consigo misma perfectamente. En la ficha de AKATSUKI,
   leer la utilidad operacional de la fila de gastos operativos (9.782 en vez de
   3.916) no rompe ninguna identidad contable, y manda la comparable al rango
   intercuartil con un margen de 41 % en lugar de 16,6 %.

   SE COMPARAN MÁRGENES, NO CIFRAS. Es lo que hace el cotejo posible: la ficha imprime
   moneda local —zlotys, yenes, yuanes, rupias, wones— y el export de Capital IQ viene
   convertido a dólares. Medido sobre las 19 fichas del estudio de End Game, el factor
   va de 3,59 (PLN) a 1.442 (KRW), así que las cifras absolutas no son comparables.
   Un margen sí: es adimensional y el factor cambiario se cancela. Y además es lo que
   el estudio de verdad usa, porque el indicador del rango es un margen.

   DOS TESTIGOS, NO UNO. El margen operacional y el bruto se calculan por separado.
   El bruto no es redundante: la utilidad operacional puede estar bien leída y el
   costo de ventas venir de otra fila, y entonces solo el bruto lo delata.

   LA TOLERANCIA ESTÁ FIJADA CON DATOS, no a ojo. Sobre las 19 fichas reales contra el
   export real, los márgenes coinciden con una desviación máxima de 0,06 pp, que es el
   redondeo del propio export (Capital IQ publica 3–4 cifras significativas: «8.02»,
   «0.041»). Un error de lectura de verdad mueve el margen en puntos enteros, no en
   centésimas. 0,5 pp deja ocho veces el ruido observado y sigue estando a un orden de
   magnitud de cualquier confusión de fila.

   DE DÓNDE SE ASUME QUE VIENEN LAS CIFRAS DE LA FILA. De `importCapitalIQExcel`, que
   es lo que puebla `s`, `c` y `op` cuando el estudio corre el motor del paso 3 — y es
   la misma fuente que el informe cita al pie de cada tabla del Anexo B. En un estudio
   con comparables escritas a mano, sin pasar por el motor, esas cifras son las que
   tecleó el analista y el hallazgo hablará de «la base de datos» sin serlo del todo;
   sigue señalando una discrepancia real entre el documento y lo que la fila afirmaba,
   que es lo que hay que mirar.

   ADVIERTE, NO BLOQUEA (decisión del usuario, 2026-08-21). El descuadre también puede
   venir de que el export sea de otro año fiscal que la ficha, o de cifras editadas a
   mano, y rechazar ahí frenaría cargas legítimas sin que el analista pueda hacer nada.
   El hallazgo entra en la misma lista que ya se pinta y se guarda con el estudio, y la
   comparable queda marcada para que alguien la mire.
   ───────────────────────────────────────────────────────────────────────────── */

import { num } from '../utils/calculations.js';

/** Puntos porcentuales de diferencia que se admiten entre los dos márgenes. */
export const TOLERANCIA_PP = 0.5;

/** Margen sobre ventas en porcentaje, o `null` si no se puede calcular.
 *  Ventas en cero o negativas no dan margen: no es un descuadre, es que no hay qué
 *  cotejar. */
function margen(numerador, ventas) {
  const n = num(numerador);
  const v = num(ventas);
  if (n === null || v === null || v <= 0) return null;
  return (n / v) * 100;
}

/* La utilidad bruta se deriva de ventas y costo en los dos lados en vez de leer el
   rubro que el documento imprima: así el testigo apunta al costo, que es lo que se
   quiere vigilar. El costo va en magnitud porque el documento lo imprime entre
   paréntesis o con menos según quién lo emitió, igual que en
   `verifyAccountingEqualities`. */
function bruta(ventas, costo) {
  const v = num(ventas);
  const c = num(costo);
  if (v === null || c === null) return null;
  return v - Math.abs(c);
}

const MARGENES = [
  {
    nombre: 'operacional',
    deLaFicha: (d) => num(d.utilidad_operacional),
    deLaFuente: (f) => num(f.op),
  },
  {
    nombre: 'bruto',
    deLaFicha: (d) => bruta(d.ingresos_operacionales, d.costo_ventas),
    deLaFuente: (f) => bruta(f.s, f.c),
  },
];

/**
 * Coteja las cifras leídas de la ficha contra las que el estudio ya tiene de la base
 * de datos para esa misma comparable.
 *
 * @param {object} datosFicha  la matriz contable que devolvió el parser del PDF.
 * @param {object} filaFuente  la fila de la comparable ANTES de volcarle la ficha, con
 *   las cifras de la base de datos: `s` (ingresos), `c` (costo), `op` (utilidad
 *   operacional).
 * @param {{toleranciaPp?: number}} [opciones]
 * @returns {{cotejado: boolean, hallazgos: string[]}} `cotejado` en `false` significa
 *   que no había con qué comparar — que no es lo mismo que haber comparado y estar
 *   bien, ni que una falla. En ese caso `hallazgos` va vacío.
 */
export function cotejarConFuente(datosFicha, filaFuente, { toleranciaPp = TOLERANCIA_PP } = {}) {
  const d = datosFicha || {};
  const f = filaFuente || {};
  const hallazgos = [];
  let cotejado = false;

  MARGENES.forEach((m) => {
    const deLaFicha = margen(m.deLaFicha(d), d.ingresos_operacionales);
    const deLaFuente = margen(m.deLaFuente(f), f.s);
    if (deLaFicha === null || deLaFuente === null) return;

    cotejado = true;
    const diferencia = Math.abs(deLaFicha - deLaFuente);
    if (diferencia <= toleranciaPp) return;

    hallazgos.push(`⚠️ El margen ${m.nombre} de la ficha (${deLaFicha.toFixed(2)} %) no coincide `
      + `con el de la base de datos (${deLaFuente.toFixed(2)} %): ${diferencia.toFixed(2)} pp de `
      + 'diferencia. Revise de qué fila del documento se tomó la cifra.');
  });

  return { cotejado, hallazgos };
}
