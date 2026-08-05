/* ─────────────────────────────────────────────────────────────────────────────
   Parche de lectura de estados financieros para el rango ajustado.

   El cálculo del rango (ajustado y sin ajustar) define el campo `op` de cada
   parte como GASTOS OPERATIVOS: usa `EBIT = s − c − op` y `Berry = (s − c) / op`.
   El parser del sistema (eeffParser.js) venía llenando `op` con la UTILIDAD
   operacional, que es lo contrario. Con ese cruce:

     · el margen operacional del contribuyente END GAME salía 42% en vez de 5,58%;
     · el de cada comparable salía invertido (Tose 16,6% en vez de 10,4%);
     · el Índice de Berry quedaba igualmente mal.

   Además, el mapeo de comparables no trasladaba `propiedad_planta_equipo` al
   campo `ppe`, sin el cual los ajustes de PP&E no pueden calcularse.

   Este módulo normaliza la salida del parser ANTES de volcarla en el estudio, de
   modo que:
     · `op` toma los gastos operativos; si el documento solo trae utilidad
       operacional y utilidad bruta, los deriva como `op = utilidad_bruta −
       utilidad_operacional`, que es una identidad contable, no una estimación;
     · `ppe` se traslada desde `propiedad_planta_equipo`.

   No inventa cifras: si no hay forma de obtener los gastos operativos ni por
   lectura directa ni por identidad, deja `op` en null y lo reporta, para que la
   comparable entre como "sin margen" en vez de con un margen falso.
   ───────────────────────────────────────────────────────────────────────────── */

import { num } from '../utils/calculations.js';

/* Gastos operativos de una lectura de EEFF, con trazabilidad de cómo se obtuvieron.

   Orden de preferencia:
     1. gastos_operacionales, si el documento lo desglosa (lo que el prompt pide).
     2. utilidad_bruta − utilidad_operacional (identidad: UB = UOp + Gastos Op).
     3. (ingresos − costo) − utilidad_operacional, si falta la utilidad bruta pero
        hay ingresos y costo.
   Devuelve { valor, fuente } o { valor: null, fuente: 'no disponible' }. */
export function gastosOperativosDe(datos) {
  const go = num(datos.gastos_operacionales);
  if (go !== null) return { valor: go, fuente: 'lectura directa' };

  const ub = num(datos.utilidad_bruta);
  const uop = num(datos.utilidad_operacional);
  if (ub !== null && uop !== null) {
    return { valor: ub - uop, fuente: 'derivado: utilidad bruta − utilidad operacional' };
  }

  const ing = num(datos.ingresos_operacionales);
  const cos = num(datos.costo_ventas);
  if (ing !== null && cos !== null && uop !== null) {
    return { valor: (ing - Math.abs(cos)) - uop, fuente: 'derivado: (ingresos − costo) − utilidad operacional' };
  }

  return { valor: null, fuente: 'no disponible' };
}

/* Normaliza una lectura de EEFF (contribuyente o comparable) a los campos que el
   cálculo del rango espera: s, c, op, ar, inv, ap, ppe. `op` son GASTOS
   operativos, no utilidad. Conserva la lectura cruda y una nota de trazabilidad
   sobre cómo se resolvió `op`. */
export function normalizarEeff(datos) {
  const d = datos || {};
  const gastos = gastosOperativosDe(d);
  return {
    s: num(d.ingresos_operacionales),
    c: num(d.costo_ventas),
    op: gastos.valor,               // gastos operativos, no utilidad
    ar: num(d.cuentas_por_cobrar),
    inv: num(d.inventarios),
    ap: num(d.cuentas_por_pagar),
    ppe: num(d.propiedad_planta_equipo), // faltaba en el mapeo de comparables
    opFuente: gastos.fuente,
    /* Se conserva la utilidad operacional leída solo como referencia de auditoría;
       el cálculo la reconstruye a partir de s, c y op para no depender de ella. */
    utilidadOperacionalLeida: num(d.utilidad_operacional),
    eeffDatos: d,
  };
}

/* Aplicación al contribuyente: devuelve el parche de campos t_* del estudio.
   Reemplaza el mapeo t_op ← utilidad_operacional del parser por t_op ← gastos. */
export function camposContribuyente(datos) {
  const n = normalizarEeff(datos);
  return {
    t_s: n.s, t_c: n.c, t_op: n.op,
    t_ar: n.ar, t_inv: n.inv, t_ap: n.ap, t_ppe: n.ppe,
    t_opFuente: n.opFuente,
  };
}

/* Aplicación a una fila de comparable: los campos cortos que consume el cálculo.
   Sustituye el mapeo op ← utilidad_operacional y añade ppe, que no se mapeaba. */
export function camposComparable(datos) {
  const n = normalizarEeff(datos);
  return {
    s: n.s, c: n.c, op: n.op,
    ar: n.ar, inv: n.inv, ap: n.ap, ppe: n.ppe,
    opFuente: n.opFuente,
  };
}
