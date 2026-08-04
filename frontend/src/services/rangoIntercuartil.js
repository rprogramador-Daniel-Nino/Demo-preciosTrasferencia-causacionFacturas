/* Rango intercuartil de las comparables y conclusión de cumplimiento.
   Vive aparte porque lo usan dos rutas: la sustitución por campos con nombre y
   `exactTemplateMapper.js`, que queda como respaldo de las plantillas sin
   marcar. Cuando el mapper se retire, este módulo se queda donde está. */

import { num, pliOf, ratios, quart, adjustInfo } from '../utils/calculations.js';

export function analizarRango(estudio) {
  const study = estudio || {};
  const kind = study.pli || 'MO';
  const T = {
    s: num(study.t_s), c: num(study.t_c), op: num(study.t_op),
    ar: num(study.t_ar), inv: num(study.t_inv), ap: num(study.t_ap),
  };
  const tPLI = pliOf(T, kind);

  const useAdj = study.useadj || false;
  const interestRate = (num(study.prime) || 0) / 100;
  const tR = ratios(T);

  /* Margen de cada comparable, con su nombre y su ámbito, además de los cuartiles.
     Las tablas 17 (muestra) y 19 (márgenes) del informe se arman con esto y no con un
     cálculo propio: si cada una repitiera la fórmula del ajuste, el documento podría
     acabar publicando unos márgenes que no sustentan el rango que declara unas páginas
     más adelante.

     Se devuelven todas las comparables del estudio, también las que no tienen cifras
     —su margen sale `null` y quien las presente pondrá un hueco—: esconderlas
     maquillaría el tamaño de la muestra final. */
  const filas = (study.comparables || []).map((c) => {
    const rawVal = { s: num(c.s), c: num(c.c), op: num(c.op), ar: num(c.ar), inv: num(c.inv), ap: num(c.ap) };
    const noAjustado = pliOf(rawVal, kind);
    let adjVal = 0;
    const cR = ratios(rawVal);
    if (useAdj && kind !== 'Berry' && tR && cR && tR.apC !== null && cR.apC !== null) {
      adjVal = interestRate * ((tR.arS - cR.arS) + (tR.invS - cR.invS) - (tR.apC - cR.apC));
    }
    return {
      nombre: String((c && c.name) || '').trim(),
      amb: c && c.amb === 'Nac' ? 'Nac' : 'Int',
      noAjustado,
      ajustado: noAjustado === null ? null : noAjustado + adjVal,
    };
  });

  let stats = null;
  if (study.comparables && study.comparables.length >= 3) {
    const activeSeries = filas
      .map((f) => f.ajustado)
      .filter((val) => val !== null)
      .sort((a, b) => a - b);

    if (activeSeries.length >= 3) {
      stats = { p25: quart(activeSeries, 0.25), med: quart(activeSeries, 0.5), p75: quart(activeSeries, 0.75) };
    }
  }

  const adj = stats && tPLI !== null ? adjustInfo(T, tPLI, stats, T.s || 0, 1, study.egreso) : null;
  /* 'CUMPLE' cuando no hay ajuste es comportamiento heredado, no un descuido.
     Ver la nota de la Task 0 del plan antes de cambiarlo. */
  const cumple = adj ? (adj.within ? 'CUMPLE' : 'NO CUMPLE') : 'CUMPLE';

  return { stats, adj, cumple, filas };
}
