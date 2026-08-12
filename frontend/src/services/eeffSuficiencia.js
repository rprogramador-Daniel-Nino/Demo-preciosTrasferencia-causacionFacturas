/* ─────────────────────────────────────────────────────────────────────────────
   eeffSuficiencia.js — ¿el estado financiero leído alcanza para que la comparable
   entre al rango?

   POR QUÉ EXISTE. Un PDF de lote trae los estados financieros de las comparables
   seleccionadas, pero no todas vienen con cifras: hay compañías cuya página trae
   solo el encabezado, o un balance sin estado de resultados. Hasta ahora esas filas
   se aplicaban igual —`aplicarEeffEnFila` conserva con `||` lo que la fila ya tenía
   de Capital IQ— y la comparable seguía en la muestra sin respaldo documental de sus
   cifras. Quedaba en el informe indistinguible de las que sí lo tienen.

   QUÉ SE EXIGE. Las dos partidas con las que se construye el indicador:

     · ingresos_operacionales — el denominador del margen. Un cero no sirve: el
       margen sería una división por cero, así que se pide estrictamente mayor que
       cero.
     · utilidad_operacional — el numerador. Aquí el cero SÍ es un dato («la empresa
       reportó cero»), y se acepta; lo que se rechaza es la ausencia.

   Esa distinción se puede hacer porque el prompt del parser es explícito: «Si un
   rubro no figura para una empresa, devuélvelo en null — NUNCA en 0, porque 0 se lee
   como "la empresa reportó cero" y ese no es el caso cuando el concepto simplemente
   no aparece» (`eeffParser.js`, EEFF_COMPARABLES_LOTE_PROMPT). Sin esa garantía habría
   que tratar todo cero como ausencia y se eliminarían comparables buenas.

   LAS PARTIDAS DE CAPITAL DE TRABAJO NO SE EXIGEN. CxC, inventario, CxP y PP&E solo
   alimentan el ajuste, que es opcional (`useadj`). Pedirlas dejaría fuera comparables
   que sostienen un margen perfectamente calculable.

   ES DELIBERADAMENTE UN VEREDICTO SOBRE EL DOCUMENTO, no sobre la fila resultante:
   una comparable con cifras de Capital IQ pero cuyo EEFF llegó vacío se retira igual
   —decisión del usuario, 2026-08-11—, porque lo que el informe debe poder soportar
   ante la DIAN es la cifra con el documento que la respalda.
   ───────────────────────────────────────────────────────────────────────────── */

import { num } from '../utils/calculations.js';

/** Nombre legible de cada partida exigida, para el aviso. */
export const PARTIDAS_EXIGIDAS = [
  { campo: 'ingresos_operacionales', etiqueta: 'los ingresos operacionales (ventas)' },
  { campo: 'utilidad_operacional', etiqueta: 'la utilidad operacional' },
];

/**
 * Qué le falta al documento para sostener el indicador de la comparable.
 *
 * @param {object} datos  la matriz contable que devolvió el parser.
 * @returns {string[]} etiquetas de las partidas ausentes; vacío si no falta ninguna.
 */
export function partidasFaltantes(datos) {
  const d = datos || {};
  const faltantes = [];

  /* Mayor que cero, no solo presente: con ventas en cero el margen no existe. */
  const ventas = num(d.ingresos_operacionales);
  if (ventas === null || ventas <= 0) faltantes.push(PARTIDAS_EXIGIDAS[0].etiqueta);

  /* Presente, aunque sea cero o negativa: una pérdida operativa es un dato válido y
     el rango la admite —el filtro de pérdidas es una decisión aparte del paso 2—. */
  if (num(d.utilidad_operacional) === null) faltantes.push(PARTIDAS_EXIGIDAS[1].etiqueta);

  return faltantes;
}

/** ¿Trae el documento lo mínimo para calcular el indicador de esta comparable? */
export function aportaInformacionFinanciera(datos) {
  return partidasFaltantes(datos).length === 0;
}

/**
 * El aviso que se le muestra a quien cargó los documentos.
 *
 * Dice qué faltó y qué se hizo, porque el usuario tiene que poder decidir entre
 * conseguir un estado financiero completo o escribir las cifras a mano: un rechazo
 * sin motivo no se puede corregir. Este texto vive solo en la pantalla del paso 4 —no
 * se escribe en el Excel de soporte ni en el informe—.
 *
 * @param {string} nombre      razón social de la comparable retirada.
 * @param {string[]} faltantes lo que devolvió `partidasFaltantes`.
 * @param {string} [archivo]   documento del que se leyó, si se conoce.
 */
export function motivoSinInformacionFinanciera(nombre, faltantes, archivo) {
  const quien = String(nombre || '').trim() || 'la comparable';
  const lista = (faltantes || []).join(' ni ');
  const deDonde = archivo ? ` en «${archivo}»` : '';
  return `Se retiró de la muestra: su estado financiero${deDonde} no trae ${lista}, así que no se ` +
    'puede calcular su margen y no puede integrar el rango intercuartil. Queda contada entre las ' +
    'diferencias funcionales del informe. Si el documento sí las traía, escríbelas a mano en la ' +
    `fila de ${quien} y vuelve a incluirla.`;
}

/**
 * Reparte las entradas ya cruzadas según aporten o no información financiera.
 *
 * Se hace en un paso propio y no dentro del bucle que aplica las cifras porque el
 * índice de cada fila cambia al retirar filas: primero se decide todo, después se
 * aplica y se retira de una sola vez.
 *
 * @param {Array<{datos:object, indice:number}>} aplicadas  lo que devolvió `repartir`.
 * @returns {{conCifras:Array, sinCifras:Array}} las mismas entradas, separadas.
 *          Cada una de `sinCifras` lleva además `faltantes`.
 */
export function separarPorSuficiencia(aplicadas) {
  const conCifras = [];
  const sinCifras = [];
  (aplicadas || []).forEach((a) => {
    const faltantes = partidasFaltantes(a && a.datos);
    if (faltantes.length) sinCifras.push({ ...a, faltantes });
    else conCifras.push(a);
  });
  return { conCifras, sinCifras };
}

/**
 * Quita las filas indicadas y devuelve la traducción de posiciones viejo→nuevo.
 *
 * La traducción no es un lujo: quien retira filas sigue teniendo en la mano los índices
 * con los que venía trabajando —los que usan `publicarEeff` y la redacción de
 * descripciones—, y esa última escribe con `setComparables` cuando la IA responde, un
 * rato después. Con las posiciones sin traducir, esa escritura tardía cae sobre la
 * comparable equivocada y le pega la descripción de otra empresa.
 *
 * @param {Array} filas    las comparables actuales.
 * @param {Set<number>} aRetirar  posiciones a quitar.
 * @returns {{filas:Array, nuevoIndice:Map<number,number>|null}} `nuevoIndice` es null
 *          cuando no se retiró nada, para poder seguir usando los índices originales.
 */
export function retirarFilas(filas, aRetirar) {
  const lista = filas || [];
  const quitar = aRetirar || new Set();
  if (!quitar.size) return { filas: lista, nuevoIndice: null };

  const nuevoIndice = new Map();
  let siguiente = 0;
  lista.forEach((_, i) => { if (!quitar.has(i)) nuevoIndice.set(i, siguiente++); });
  return { filas: lista.filter((_, i) => !quitar.has(i)), nuevoIndice };
}
