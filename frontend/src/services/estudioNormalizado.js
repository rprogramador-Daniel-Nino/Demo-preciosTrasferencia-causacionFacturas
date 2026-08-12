/* Copia del estudio con la convención que espera el motor de rangos.
   ────────────────────────────────────────────────────────────────────
   El sistema guarda `op` (y `t_op`) como UTILIDAD operacional; el motor OCDE y las
   hojas del Excel de soporte los esperan como GASTOS operativos. Esta función hace
   esa traducción sobre una copia, para que el objeto que el resto de la aplicación
   tiene en memoria no cambie de significado a mitad de camino.

   Vive aparte porque estaba duplicada literalmente en `motorExcelExport.js` y en
   `MemoriaRangoModal.jsx`, y solo la primera tenía tests. Las dos copias ya habían
   empezado a divergir: la del modal leía `copia.t_s` a secas y la del servicio
   `copia.t_s ?? copia.T?.s`, de modo que un estudio con las cifras en `T` producía
   un libro correcto desde el motor y uno vacío desde el modal. Se conserva la
   versión con los respaldos `T?.`, que es la que cubre los dos casos. */

import { normalizarEeff } from './eeffParserNormalizador.js';

export function obtenerEstudioNormalizadoParaParche(estudioOriginal) {
  if (!estudioOriginal) return {};

  /* Clon profundo: la normalización reescribe `t_op` y el `op` de cada comparable,
     y hacerlo sobre el original invertiría el convenio para todo el que lo lea
     después. */
  const copia = JSON.parse(JSON.stringify(estudioOriginal));

  const cftNormalizadas = normalizarEeff({
    ingresos_operacionales: copia.t_s ?? copia.T?.s,
    costo_ventas: copia.t_c ?? copia.T?.c,
    utilidad_operacional: copia.t_op ?? copia.T?.op,
    gastos_operacionales: copia.t_gastos || copia.t_opex,
    cuentas_por_cobrar: copia.t_ar ?? copia.T?.ar,
    inventarios: copia.t_inv ?? copia.T?.inv,
    cuentas_por_pagar: copia.t_ap ?? copia.T?.ap,
    propiedad_planta_equipo: copia.t_ppe ?? copia.T?.ppe,
  });

  if (cftNormalizadas.op !== null && cftNormalizadas.op !== undefined) {
    copia.t_op = cftNormalizadas.op;
  } else if (copia.t_s != null && copia.t_c != null && copia.t_op != null) {
    /* Respaldo cuando el normalizador no puede decidir: se despeja a mano.
       opex = ventas − costo − utilidad operacional. */
    copia.t_op = Number(copia.t_s) - Number(copia.t_c) - Number(copia.t_op);
  }
  if (cftNormalizadas.ppe != null) copia.t_ppe = cftNormalizadas.ppe;

  if (Array.isArray(copia.comparables)) {
    copia.comparables = copia.comparables.map((comp) => {
      const compNorm = normalizarEeff({
        ingresos_operacionales: comp.s,
        costo_ventas: comp.c,
        utilidad_operacional: comp.op,
        gastos_operacionales: comp.gastos || comp.opex,
        cuentas_por_cobrar: comp.ar,
        inventarios: comp.inv,
        cuentas_por_pagar: comp.ap,
        propiedad_planta_equipo: comp.ppe || comp.propiedad_planta_equipo,
      });
      let opex = compNorm.op;
      if ((opex === null || opex === undefined) && comp.s != null && comp.c != null && comp.op != null) {
        opex = Number(comp.s) - Number(comp.c) - Number(comp.op);
      }
      return {
        ...comp,
        op: opex !== null && opex !== undefined ? opex : comp.op,
        ppe: compNorm.ppe !== null && compNorm.ppe !== undefined ? compNorm.ppe : comp.ppe,
      };
    });
  }
  return copia;
}
