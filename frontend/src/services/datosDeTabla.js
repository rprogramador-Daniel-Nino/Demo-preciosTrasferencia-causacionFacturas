/* ─────────────────────────────────────────────────────────────────────────────
   datosDeTabla.js — ¿la tabla que se va a publicar aporta algún dato del estudio?

   POR QUÉ EXISTE. Las tablas del contribuyente se rellenan celda a celda con lo que el
   estudio traiga, y lo que no trae sale como «—» (ver `wrap` en `tablasOperaciones.js` y
   en `tablasContribuyente.js`). Cuando el estudio no trae NINGUNO de los campos de una
   tabla, el generador seguía emitiéndola igual: una tabla completa de guiones que
   sustituía a la de la plantilla. Sobre el informe de SHANDONG KERUI 2025, reportado con
   el .docx generado el 2026-08-24, así salieron la Tabla 2 «Operación de egreso»
   («————»), la Tabla 3 «Operación de ingreso», la Tabla 4 «Operación analizar»
   («Ingreso (—) —»), la Tabla 7 «Transacciones Intercompañías» y la Tabla 14 «Compañías
   vinculadas» («———»), mientras las copias 18 a 21 de esas mismas tablas —que el
   generador no toca— seguían publicando los datos de la plantilla: el mismo dato vacío
   arriba y completo abajo, en el documento que se radica.

   LA REGLA. Sin datos no se sustituye: se conserva lo que la plantilla ya publica y se
   anota el aviso, que es el que la UI muestra como «Esto no se actualizó con los datos
   del estudio … revísalo antes de radicar». Es la decisión del usuario del 2026-08-24, y
   cambia la que traía la cabecera de `tablasOperaciones.js` («un hueco silencioso no
   queda vacío, queda con el dato del cliente anterior»): el guion tampoco avisaba de
   nada por sí solo, y dejaba el informe peor que la plantilla de la que salió.

   POR QUÉ NO SE DECIDE MIRANDO EL TEXTO YA ARMADO. Sería lo genérico —«si todas las
   celdas son guiones, no sustituyas»— y no alcanza: la ficha vertical de
   «Transacciones Inter compañía» lleva el rótulo de cada fila en su primera columna
   («Razón social», «Identificación fiscal»), los subtotales de «Activos a 31 de
   diciembre» llevan el suyo, y «Operación analizar» arma su celda como «Ingreso (—)».
   En los tres casos hay texto que NO es un dato del estudio, así que el criterio del
   texto los daría por llenos. Por eso cada tabla declara `sinDatos` a partir de los
   valores que consumió, que es lo único que lo sabe con certeza; `tablaSinDatos` respeta
   esa declaración y sólo cae en el criterio del texto cuando no la hay, para que una
   tabla nueva que se olvide de declararla siga protegida.
   ───────────────────────────────────────────────────────────────────────────── */

/** El valor que se escribe cuando un campo no tiene dato. Igual en las dos rutas. */
export const SIN_DATO = '—';

/** Un valor del estudio que no dice nada: ausente, vacío o ya reducido a «—». */
export function celdaSinDato(valor) {
  if (valor === null || valor === undefined) return true;
  const t = String(valor).trim();
  return t === '' || t === SIN_DATO || t === '-';
}

/**
 * ¿Ninguno de los valores que la tabla toma del estudio trae dato?
 *
 * Se le pasan los valores CRUDOS del estudio, antes de formatear: es la pregunta que cada
 * función `filas*` puede responder sin ambigüedad, porque sabe cuáles de sus celdas son
 * datos y cuáles son rótulos o texto de norma que ella misma pone.
 *
 * @param {Array<*>} valores
 * @returns {boolean} true si ni uno solo trae dato.
 */
export function sinNingunDato(valores) {
  return (valores || []).every(celdaSinDato);
}

/**
 * ¿Esta tabla se puede publicar, o hay que dejar la de la plantilla?
 *
 * @param {{filas?:Array<Array<*>>, sinDatos?:boolean}|null} tabla lo que devuelve una
 *        función `filas*`. `null` cuenta como sin datos: hay generadores que ya lo usaban
 *        para decir «no aplica» (`filasOperacionAdicional`, `filasComposicionAccionaria`).
 * @returns {boolean} true si no hay nada del estudio que publicar.
 */
export function tablaSinDatos(tabla) {
  if (!tabla) return true;
  if (tabla.sinDatos === true) return true;
  if (tabla.sinDatos === false) return false;

  /* Sin declaración explícita, el criterio del texto: una tabla sin filas no publica nada,
     y una en la que ninguna celda dice nada tampoco. */
  const filas = tabla.filas || [];
  if (!filas.length) return true;
  return filas.every((fila) => (fila || []).every(celdaSinDato));
}
