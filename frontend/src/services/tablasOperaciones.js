/* ─────────────────────────────────────────────────────────────────────────────
   tablasOperaciones.js — QUÉ dice cada celda de las Tablas 1 y 2 del Informe Local.

   Solo los datos; el formato es de quien las emite. `docxRelleno.js` las convierte a
   OOXML para rellenar el .docx del cliente y `tablasOperacionesHtml.js` a HTML para la
   ruta de plantilla en PDF. Una sola definición porque las dos rutas producen el MISMO
   documento: si cada una armara sus filas, un cambio en una dejaría a la otra declarando
   otra cosa ante la DIAN, y nadie compara los dos formatos del mismo estudio.

   Ninguna celda tiene valor por defecto. Lo que el estudio no traiga sale como «—»: la
   plantilla es el informe del año anterior, así que un hueco silencioso no queda vacío,
   queda con el dato del cliente anterior.
   ───────────────────────────────────────────────────────────────────────────── */

import { fmt, num } from '../utils/calculations.js';
import { codigoDeTipoOperacion } from './tiposOperacionDian.js';

const FUENTE = 'Información suministrada por la Administración de la Compañía.';
const SIN_DATO = '—';

const wrap = (v) => String(v == null || v === '' ? SIN_DATO : v);

/**
 * El concepto de la operación, partido en descripción y código DIAN.
 *
 * `cod` es `null` cuando no se puede establecer, y eso es una respuesta legítima: la
 * columna «Cod» del Excel es opcional y «Tipo de operación» admite texto libre. El
 * archivo de referencia de 2025 trae «VENTA SERVICIOS», que no es ninguno de los 63
 * nombres del catálogo. Antes esto devolvía '07' fijo —el código que traía el informe de
 * END GAME 2024— y el número viajaba al informe de cualquier cliente.
 *
 * @param {object} estudio
 * @returns {{desc: string|null, cod: string|null}}
 */
export function conceptoDeOperacion(estudio) {
  const texto = String((estudio && estudio.vinc_tipo) || '').trim();
  if (!texto) return { desc: null, cod: null };

  /* Un código ya escrito es la declaración del contribuyente y no se re-deriva. */
  const m = /^(.*?)\s*\((\d+)\)\s*$/.exec(texto);
  if (m) {
    return { desc: m[1].trim(), cod: String(m[2]).padStart(2, '0') };
  }

  return { desc: texto, cod: codigoDeTipoOperacion(texto, !!(estudio && estudio.egreso)) };
}

/** El monto de la operación ya formateado, o «—». Los dos campos porque la ingesta
 *  escribe ambos y un estudio guardado antes puede traer solo uno. */
function montoDeLaOperacion(estudio) {
  const bruto = (estudio && (estudio.monto_operacion ?? estudio.monto)) ?? null;
  const n = num(bruto);
  return n === null ? SIN_DATO : fmt(n);
}

/**
 * Tabla 1 — «Operaciones de Ingreso» (o de Egreso), tal como la declara el estudio.
 *
 * Una sola fila: el estudio guarda un vinculado y un tipo de operación, no una lista.
 * Cuando el Excel trae varias contrapartes, `parseExcelOperations` avisa de que el monto
 * es la suma de todas y se atribuye a la primera.
 *
 * @returns {{nombre:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasOperacionesDeIngreso(estudio) {
  const e = estudio || {};
  return {
    nombre: 'Operaciones de ' + (e.egreso ? 'Egreso' : 'Ingreso'),
    encabezados: [
      'Concepto de Operaciones a analizar', 'Nombre vinculado', 'País vinculado',
      'Monto de la Operación analizar',
    ],
    filas: [[wrap(e.vinc_tipo), wrap(e.vinc), wrap(e.pais_vinc), montoDeLaOperacion(e)]],
    fuente: FUENTE,
  };
}

/**
 * Tabla 2 — «Operación analizar»: el tipo con su código y la descripción.
 *
 * @returns {{nombre:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasOperacionAnalizar(estudio) {
  const e = estudio || {};
  const { desc, cod } = conceptoDeOperacion(e);
  const tipo = e.egreso ? 'Egreso' : 'Ingreso';
  return {
    nombre: 'Operación analizar',
    encabezados: ['No. Operaciones de análisis', 'Descripción'],
    filas: [[tipo + ' (' + (cod || SIN_DATO) + ')', wrap(desc)]],
    fuente: FUENTE,
  };
}

/**
 * Tabla 3 — «Transacciones Inter compañía»: la ficha del vinculado, en vertical.
 *
 * Cada fila es etiqueta y valor, no una columna de datos. La plantilla la trae DOS veces
 * —en la descripción del vinculado y otra vez en el análisis— y las dos publican lo mismo.
 *
 * @returns {{nombre:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasTransaccionesIntercompania(estudio) {
  const e = estudio || {};
  return {
    nombre: 'Transacciones Inter compañía',
    encabezados: ['Compañía vinculada', ''],
    filas: [
      ['Razón social', wrap(e.vinc)],
      ['Identificación fiscal', wrap(e.vinc_id)],
      ['País - Residencia fiscal', wrap(e.pais_vinc)],
      /* El inciso es el del caso más común y el estudio puede corregirlo. No es un dato
         que se pueda dejar en blanco: la vinculación hay que sustentarla. */
      ['Tipo de vinculación', wrap(e.tipo_vinculacion || 'Art 260-1 E-T Inciso 1')],
      ['Tipo de operaciones (' + (e.egreso ? 'Egreso' : 'Ingreso') + ')', wrap(e.vinc_tipo)],
      ['Monto en pesos', montoDeLaOperacion(e)],
    ],
    fuente: 'Información de ' + (e.ent || 'la Compañía') + '.',
  };
}

/**
 * Tabla 4 — «Método de Precios de Transferencia Aplicable».
 *
 * Publica el código de operación en su propia columna, así que comparte
 * `conceptoDeOperacion` con las Tablas 1 y 2: es el mismo dato y no puede diferir entre
 * dos tablas del mismo informe.
 *
 * `nombre` es más corto que `titulo` porque es con lo que se localiza la tabla, y las
 * plantillas rotulan el título completo.
 *
 * @returns {{nombre:string, titulo:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasMetodoAplicable(estudio) {
  const e = estudio || {};
  const { desc, cod } = conceptoDeOperacion(e);
  return {
    nombre: 'Método de Precios de Transferencia',
    titulo: 'Método de Precios de Transferencia Aplicable',
    encabezados: [
      'Código de Operación', 'Descripción de la operación', 'Método seleccionado',
      'Indicador de Rentabilidad',
    ],
    filas: [[wrap(cod), wrap(desc), e.metodo || 'TU', e.pli || 'MO']],
    fuente: FUENTE,
  };
}

/** El año gravable del estudio. 2025 por omisión, igual que el resto del sistema. */
const anioDe = (estudio) => Number(estudio && estudio.anio) || 2025;

/**
 * Tabla 8 — «Compañías vinculadas al 31 de diciembre de {año}».
 *
 * El título lleva el año gravable, que es un DATO: la plantilla trae el del informe
 * anterior y dejarlo publica «al 31 de diciembre de 2024» en el informe de 2025.
 *
 * @returns {{nombre:string, titulo:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasCompaniasVinculadas(estudio) {
  const e = estudio || {};
  return {
    nombre: 'Compañías vinculadas',
    titulo: 'Compañías vinculadas al 31 de diciembre de ' + anioDe(e),
    encabezados: ['Nombre Vinculada', 'No. ID Fiscal', 'País'],
    filas: [[wrap(e.vinc), wrap(e.vinc_id), wrap(e.pais_vinc)]],
    fuente: FUENTE,
  };
}

/**
 * Tabla 9 — «Criterios de vinculación económica».
 *
 * El criterio y su detalle son los del caso que el sistema sustenta hoy —vinculación
 * directa por el numeral 1— y no salen del estudio porque no hay dónde escribirlos.
 *
 * @returns {{nombre:string, titulo:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasCriteriosVinculacion(estudio) {
  const e = estudio || {};
  return {
    nombre: 'Criterios de vinculación',
    titulo: 'Criterios de vinculación económica',
    encabezados: [
      'Nombre Vinculada', 'País', 'Criterio de vinculación',
      'Detalle del Criterio de Vinculación',
    ],
    filas: [[
      wrap(e.vinc), wrap(e.pais_vinc),
      'Artículo. 260-1 del Estatuto Tributario, numeral 1, literal a', 'Vinculación Directa',
    ]],
    fuente: FUENTE,
  };
}
