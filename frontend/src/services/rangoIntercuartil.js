/* Rango intercuartil de las comparables y conclusión de cumplimiento.
   Vive aparte porque lo usan dos rutas: la sustitución por campos con nombre y
   `exactTemplateMapper.js`, que queda como respaldo de las plantillas sin
   marcar. Cuando el mapper se retire, este módulo se queda donde está.

   ─── Sobre el ajuste de capital de trabajo ───

   Hasta agosto de 2026 este módulo aplicaba una fórmula propia —sumaba el ajuste
   en puntos al margen, sin venta ajustada ni factor t/(1+t)— distinta de la que
   emite el Excel de soporte, que sí sigue el Anexo del Cap. III de las Guías OCDE.
   El informe y el libro que lo sustenta publicaban por tanto rangos distintos.

   Ahora el cálculo lo hace `ajusteRangoCapitalTrabajo.js`, el mismo motor que
   alimenta el Excel, para los métodos en que ambas definiciones del indicador
   coinciden exactamente:

     · MO → utilidad operacional / ventas
     · MB → utilidad bruta / ventas

   Berry se queda en la ruta heredada a propósito. El sistema lo define como
   «Ventas / Costos totales» (así lo dice el selector de IngestaCifras.jsx y así lo
   calcula `pliOf`), mientras que el motor OCDE lo define como «utilidad bruta /
   gastos operativos». No son el mismo indicador, así que enrutarlo al motor no
   sería unificar el ajuste: sería cambiarle el indicador al informe sin decirlo.
   Mientras esa definición no se decida, Berry sigue como estaba —y sin ajuste,
   igual que antes—.

   ─── Convenio de `op` ───

   El resto del sistema guarda `op` como UTILIDAD operacional; el motor OCDE lo
   espera como GASTOS operativos. La traducción se hace aquí, en `aConvenioOCDE`,
   y no en el motor, porque el motor también lo consume el Excel, que ya recibe las
   cifras normalizadas. */

import { num, pliOf, ratios, quart, adjustInfo } from '../utils/calculations.js';
import { analizarRangoAjustado } from './ajusteRangoCapitalTrabajo.js';

/* Métodos cuyo indicador es idéntico en las dos implementaciones. Ampliar esta
   lista exige comprobar antes que `pliOf` y el motor calculen lo mismo sin ajuste;
   si no, el rango cambia de significado en silencio. */
const METODOS_OCDE = new Set(['MO', 'MB']);

/* Escenario que reporta el informe: cuentas por cobrar, cuentas por pagar e
   inventario. Es el que describe el anexo de ajustes de capital de trabajo y el
   que la auditoría de la plantilla señaló como el defendible; PP&E queda fuera
   porque desborda el resultado en comparables con activo fijo desproporcionado. */
const SABOR_INFORME = 'aar_aap_inv';

/** Utilidad operacional → gastos operativos, el convenio que espera el motor. */
function aConvenioOCDE(o) {
  const s = num(o.s), c = num(o.c), op = num(o.op);
  return { ...o, op: (s !== null && c !== null && op !== null) ? s - c - op : null };
}

export function analizarRango(estudio) {
  const study = estudio || {};
  const kind = study.pli || 'MO';
  /* Ingreso de una operación no controlada ajena a la vinculada: se descuenta de
     ventas y de utilidad, igual que hace el panel, para que el indicador del
     contribuyente no se calcule sobre cifras mezcladas. Aquí `op` es la utilidad
     operacional, así que baja con las ventas. */
  const seg = num(study.seg_excluido) || 0;
  const tS = num(study.t_s), tOp = num(study.t_op);
  const T = {
    s: tS !== null ? tS - seg : null,
    c: num(study.t_c),
    op: tOp !== null ? tOp - seg : null,
    ar: num(study.t_ar), inv: num(study.t_inv), ap: num(study.t_ap),
  };
  const tPLI = pliOf(T, kind);

  const { filas, stats } = METODOS_OCDE.has(kind)
    ? porMetodologiaOCDE(study, kind)
    : heredado(study, kind, T);


  const adj = stats && tPLI !== null ? adjustInfo(T, tPLI, stats, T.s || 0, 1, study.egreso) : null;
  /* 'CUMPLE' cuando no hay ajuste es comportamiento heredado, no un descuido.
     Ver la nota de la Task 0 del plan antes de cambiarlo. */
  const cumple = adj ? (adj.within ? 'CUMPLE' : 'NO CUMPLE') : 'CUMPLE';

  return { stats, adj, cumple, filas };
}

/* Ruta unificada: el mismo motor que emite las fórmulas del Excel de soporte.
   Trae de propina dos cosas que antes solo hacía la pantalla y que el informe
   ignoraba —el filtro de ámbito (`cmode`) y el descuento del segmento excluido—,
   de modo que el rango del documento pasa a ser el que se ve en el tablero. */
function porMetodologiaOCDE(study, kind) {
  const ajuste = study.useadj ? SABOR_INFORME : 'ninguno';
  const r = analizarRangoAjustado({
    ...study,
    t_op: aConvenioOCDE({ s: study.t_s, c: study.t_c, op: study.t_op }).op,
    comparables: (study.comparables || []).map(aConvenioOCDE),
  }, kind, ajuste);

  return {
    stats: r.stats,
    filas: r.filas.map((f) => ({
      nombre: f.nombre,
      amb: f.amb,
      noAjustado: f.noAjustado,
      ajustado: f.valor,
    })),
  };
}

/* Ruta heredada, hoy solo para Berry: margen sin ajuste de capital de trabajo y
   cuartiles por posición truncada. Se conserva tal cual estaba para no moverle el
   rango a los estudios que usan ese método mientras su definición se decide. */
function heredado(study, kind, T) {
  const useAdj = study.useadj || false;
  const interestRate = (num(study.prime) || 0) / 100;
  const tR = ratios(T);

  /* Se devuelven todas las comparables del estudio, también las que no tienen
     cifras —su margen sale `null` y quien las presente pondrá un hueco—:
     esconderlas maquillaría el tamaño de la muestra final. */
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

  return { stats, filas };
}
