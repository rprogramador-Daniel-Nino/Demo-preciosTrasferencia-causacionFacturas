/* ─────────────────────────────────────────────────────────────────────────────
   Puente entre el rango que el sistema ya calculaba y el ajuste de capital de
   trabajo del modelo Excel.

   No reemplaza a rangoIntercuartil.js: lo envuelve. `analizarRango` sigue siendo
   la fuente del rango sin ajuste y de la ruta heredada (que las tablas 17 y 19 del
   informe ya consumen). Este módulo añade encima la capacidad de pedir cualquiera
   de los seis sabores de ajuste del Excel y de comparar todos a la vez, que es lo
   que el consultor hacía a mano en la hoja.

   La regla de convivencia es simple: si el ajuste pedido es 'ninguno', se delega
   en `analizarRango` para no cambiar ni un decimal de lo que hoy sale por esa vía.
   Cualquier otro sabor entra por `analizarRangoAjustado`, que usa la interpolación
   de cuartiles del Excel (QUARTILE.INC) en lugar del truncado heredado —porque es
   con esa que el rango ajustado cuadra con la hoja que el consultor validó.
   ───────────────────────────────────────────────────────────────────────────── */

import { analizarRango } from './rangoIntercuartil.js';
import {
  analizarRangoAjustado, TIPOS_AJUSTE,
} from './ajusteRangoCapitalTrabajo.js';

/* Un solo rango, con o sin ajuste, con la misma forma de salida siempre.

   `metodo` cae al pli del estudio; `ajuste` a 'ninguno'. Cuando es 'ninguno' se
   devuelve tal cual lo que produce la ruta heredada, más un envoltorio uniforme
   para que quien consuma no tenga que ramificar. */
export function rango(estudio, metodo, ajuste) {
  const kind = metodo || (estudio && estudio.pli) || 'MO';
  const tipo = ajuste || 'ninguno';

  /* La tabla de sensibilidad quiere el «sin ajuste» con la misma interpolación
     que los demás escenarios; el informe lo quiere con el cuartil heredado. El
     flag `_forzarAjustado` distingue una intención de la otra sin dos funciones. */
  if (tipo === 'ninguno' && !(estudio && estudio._forzarAjustado)) {
    const heredado = analizarRango({ ...estudio, pli: kind });
    return {
      metodo: kind,
      ajuste: 'ninguno',
      ajusteEtiqueta: TIPOS_AJUSTE.ninguno,
      stats: heredado.stats,
      cumple: heredado.cumple,
      filas: heredado.filas,
      sujeto: heredado.adj ? heredado.adj.pli : null,
      fuente: 'heredado', // vino de rangoIntercuartil.js sin tocar
    };
  }

  const r = analizarRangoAjustado(estudio, kind, tipo);
  return {
    metodo: kind,
    ajuste: tipo,
    ajusteEtiqueta: TIPOS_AJUSTE[tipo] || tipo,
    stats: r.stats,
    cumple: r.cumple,
    filas: r.filas,
    sujeto: r.sujeto,
    fuente: 'ajustado', // vino del ajuste de capital de trabajo
  };
}

/* Todos los sabores de un método de una vez, para la tabla de sensibilidad: el
   consultor quiere ver, uno al lado de otro, cómo se mueve el rango y si la
   conclusión aguanta en todos. Devuelve un arreglo en el orden de TIPOS_AJUSTE. */
export function rangoTodosLosAjustes(estudio, metodo) {
  const kind = metodo || (estudio && estudio.pli) || 'MO';
  return Object.keys(TIPOS_AJUSTE).map((tipo) => rango(estudio, kind, tipo));
}

/* Resumen de sensibilidad: dado un método, ¿la conclusión es la misma con todos
   los ajustes? Si CUMPLE en todos, la posición del contribuyente es robusta; si
   cambia según el ajuste, hay que documentarlo y elegir con criterio.

   Aquí todos los escenarios —incluido «sin ajuste»— pasan por el ajuste con
   interpolación de cuartiles del Excel, para que la tabla compare peras con peras.
   El «sin ajuste» heredado (truncado) sigue disponible vía `rango(estudio, m,
   'ninguno')` para las tablas del informe que ya dependen de esa cifra exacta. */
export function analizarSensibilidad(estudio, metodo) {
  const kind = metodo || (estudio && estudio.pli) || 'MO';
  const filas = Object.keys(TIPOS_AJUSTE)
    .map((tipo) => rango({ ...estudio, _forzarAjustado: true }, kind, tipo === 'ninguno' ? 'ninguno' : tipo))
    .filter((r) => r.stats);
  const conclusiones = new Set(filas.map((r) => r.cumple));
  return {
    metodo: metodo || (estudio && estudio.pli) || 'MO',
    escenarios: filas.map((r) => ({
      ajuste: r.ajuste,
      etiqueta: r.ajusteEtiqueta,
      p25: r.stats.p25,
      med: r.stats.med,
      p75: r.stats.p75,
      sujeto: r.sujeto,
      cumple: r.cumple,
    })),
    robusta: conclusiones.size === 1, // misma conclusión en todos los escenarios
    conclusionUnica: conclusiones.size === 1 ? [...conclusiones][0] : null,
  };
}
