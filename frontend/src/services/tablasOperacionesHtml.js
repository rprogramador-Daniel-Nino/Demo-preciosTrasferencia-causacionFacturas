/* ─────────────────────────────────────────────────────────────────────────────
   tablasOperacionesHtml.js — las Tablas 1 y 2 en la ruta de plantilla PDF.

   POR QUÉ EXISTE. En esta ruta el informe del año anterior se convierte a HTML y solo
   se sustituye lo que el marcado envolvió en un `<span data-campo>`. Las celdas de
   estas dos tablas no llevan marca: «Ingreso (07)» y «Otros servicios» no
   corresponden a ningún campo del vocabulario. Así que el informe se radicaba con el
   concepto, el vinculado, el país y el monto del cliente anterior.

   POR QUÉ NO POR MARCADO. «Otros servicios» es subcadena de «Otros servicios (07)»:
   la primera se marcaría dentro de la segunda y la segunda quedaría descartada por
   solape, así que el resultado dependería del orden en que el modelo las propusiera.

   LAS PRIMITIVAS SON DE `tablasHtmlInforme.js`. Localizar la tabla por su rótulo y
   reescribir sus filas conservando el markup del cliente ya estaba resuelto ahí para
   las tablas del motor y las de macroeconomía. Este módulo solo aporta QUÉ tablas y
   con qué filas; el cómo es compartido. Llevar aquí una segunda copia del localizador
   —que es como nació este módulo— dejaba dos definiciones de «qué es el rótulo de una
   tabla» divergiendo en el mismo documento.
   ───────────────────────────────────────────────────────────────────────────── */

import { localizarTablaHtml, reescribirFilasHtml } from './tablasHtmlInforme.js';
import { filasOperacionesDeIngreso, filasOperacionAnalizar } from './tablasOperaciones.js';

/* Nombres con los que las plantillas rotulan estas dos tablas. La de operaciones se
   llama de ingreso o de egreso según el sentido de la operación del contribuyente, y la
   plantilla trae el que le corresponde: se buscan los dos. */
export const TABLA_OPERACIONES = ['Operaciones de Ingreso', 'Operaciones de Egreso'];
export const TABLA_OPERACION_ANALIZAR = 'Operación analizar';

/**
 * Reescribe las Tablas 1 y 2 del informe en HTML con los datos ingeridos del estudio.
 *
 * @param {string} html     la plantilla marcada.
 * @param {object} estudio
 * @param {string[]} [avisos] arreglo donde se anotan las tablas que la plantilla no trae.
 *        Sin el aviso, una tabla ausente conserva las cifras del informe de referencia y
 *        nadie se entera. Es el mismo arreglo que llenan los otros dos motores de tablas,
 *        así que el banner de `ReporteGenerador` las reporta todas por un solo canal.
 * @returns {string} el informe con las dos tablas actualizadas.
 */
export function actualizarTablasOperacionesHtml(html, estudio, avisos) {
  let out = String(html || '');
  if (!estudio) return out;

  const objetivos = [
    { nombres: TABLA_OPERACIONES, tabla: filasOperacionesDeIngreso(estudio) },
    { nombres: TABLA_OPERACION_ANALIZAR, tabla: filasOperacionAnalizar(estudio) },
  ];

  for (const { nombres, tabla } of objetivos) {
    const donde = localizarTablaHtml(out, nombres);
    if (!donde) {
      if (Array.isArray(avisos)) avisos.push(tabla.nombre);
      continue;
    }
    const nueva = reescribirFilasHtml(out.slice(donde.inicio, donde.fin), tabla.filas);
    out = out.slice(0, donde.inicio) + nueva + out.slice(donde.fin);
  }

  return out;
}
