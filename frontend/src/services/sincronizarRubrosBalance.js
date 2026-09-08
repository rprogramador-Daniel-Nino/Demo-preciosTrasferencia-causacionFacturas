/* ─────────────────────────────────────────────────────────────────────────────
   Relaciona las 6 casillas escalares de "Cifras del Estado de Situación Financiera"
   (t_cash, t_inv_assoc, t_tax, t_intang, t_dif, t_act_nocurr) con las filas de "Detalle de
   Activos" (`study.t_activos_detalle`) que representan el mismo concepto.

   Son dos representaciones independientes del mismo balance: las 6 casillas son escalares
   de nombre fijo (las lee el Excel Soporte Motor vía `RUBROS_EXAMINADA`), y "Detalle de
   Activos" es un arreglo de texto libre —una fila por cada renglón que el EEFF imprime—
   que alimenta la Tabla 10/ANEXO A del informe. Sin este módulo el analista tenía que
   digitar el mismo dato dos veces.

   El matching es por FORMA/PATRÓN de redacción, no por frase literal de una empresa (misma
   convención que `docxRelleno.js` usa para las tablas del Word, patrón `{etiqueta, test}`):
   generaliza a cualquier EEFF, no a un cliente puntual.

   Regla de ambigüedad: si cero filas o más de una fila coinciden con la misma clave, no se
   deriva ni se sincroniza nada para esa clave — se deja en manos del analista. Nunca se
   crea una fila nueva en "Detalle de Activos": esa tabla sigue siendo 100% manual en cuanto
   a qué filas contiene.

   Puro: sin React, sin red.
   ───────────────────────────────────────────────────────────────────────────── */

import { normalizarPalabra } from './vocabularioEeff.js';

export const CLAVES_RUBROS_BALANCE_ADICIONALES = [
  't_cash', 't_inv_assoc', 't_tax', 't_intang', 't_dif', 't_act_nocurr',
];

/* Un patrón por clave, sobre la etiqueta ya normalizada (sin tildes/mayúsculas). Única
   colisión real entre los 6: "impuestos corrientes" vs. "impuesto diferido" — se resuelve
   excluyendo "diferid" del patrón de t_tax, así que un impuesto diferido cae en t_dif. */
const PATRONES_POR_CLAVE = {
  t_cash: (n) => /efectivo/.test(n) || /caja\s*y\s*bancos/.test(n) || /^disponible\b/.test(n),
  t_inv_assoc: (n) => /invers/.test(n) && /asociad/.test(n),
  t_tax: (n) => /impuesto/.test(n) && !/diferid/.test(n),
  t_intang: (n) => /intangible/.test(n),
  t_dif: (n) => /diferid/.test(n) || (/anticipad/.test(n) && /gasto|pago|costo/.test(n)),
  t_act_nocurr: (n) => /total/.test(n) && /activo/.test(n) && /no\s*corriente/.test(n),
};

/** La clave (de las 6) cuyo patrón reconoce esta etiqueta, o `null` si ninguna coincide. */
export function claveDeEtiquetaEnDetalle(etiqueta) {
  const n = normalizarPalabra(etiqueta);
  if (!n) return null;
  return CLAVES_RUBROS_BALANCE_ADICIONALES.find((clave) => PATRONES_POR_CLAVE[clave](n)) || null;
}

/** Índice de la única fila de `detalle` que corresponde a `clave`, o -1 si hay cero o más
 *  de una (ambigüedad: no se fuerza nada). */
export function indiceFilaCoincidenteUnica(detalle, clave) {
  const indices = (detalle || []).reduce((acc, fila, i) => {
    if (claveDeEtiquetaEnDetalle(fila && fila.etiqueta) === clave) acc.push(i);
    return acc;
  }, []);
  return indices.length === 1 ? indices[0] : -1;
}

/** Al editar la casilla escalar `clave` a mano, escribe `valor` en la única fila
 *  coincidente de `detalle`. Sin match único devuelve el MISMO arreglo (misma referencia,
 *  para no disparar actualizaciones de estado de más) y nunca agrega una fila nueva. */
export function sincronizarDetalleDesdeEscalar(detalle, clave, valor) {
  const idx = indiceFilaCoincidenteUnica(detalle, clave);
  if (idx === -1) return detalle;
  return detalle.map((fila, i) => (i === idx ? { ...fila, valor } : fila));
}

/** Al editar una fila de `detalle` (por índice) a mano, si esa fila —y solo ella— matchea
 *  una de las 6 claves, devuelve `{clave, valor}` para propagarlo a la casilla escalar.
 *  `null` si la fila no matchea ninguna clave, o si matchea pero hay ambigüedad (otra fila
 *  coincide con la misma clave). */
export function sincronizarEscalarDesdeFila(detalle, index) {
  const fila = (detalle || [])[index];
  if (!fila) return null;
  const clave = claveDeEtiquetaEnDetalle(fila.etiqueta);
  if (!clave) return null;
  if (indiceFilaCoincidenteUnica(detalle, clave) !== index) return null;
  return { clave, valor: fila.valor };
}
