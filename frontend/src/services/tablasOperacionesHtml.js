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

import {
  localizarTablaHtml, localizarTablasHtml, reescribirFilasHtml, reescribirRotuloHtml,
} from './tablasHtmlInforme.js';
import {
  filasOperacionesDeIngreso, filasOperacionAnalizar, filasTransaccionesIntercompania,
  filasMetodoAplicable, filasCompaniasVinculadas, filasCriteriosVinculacion,
} from './tablasOperaciones.js';
import { filasComposicionAccionaria, filasActivos } from './tablasContribuyente.js';

/* La tabla de operaciones se llama de ingreso o de egreso según el sentido de la operación
   del contribuyente, y la plantilla trae el rótulo que le corresponde: se buscan los dos. */
export const TABLA_OPERACIONES = ['Operaciones de Ingreso', 'Operaciones de Egreso'];

/**
 * Las tablas que este motor regenera, con lo que cada una necesita de la plantilla.
 *
 * `todas`: la ficha del vinculado viene DOS veces en la plantilla —rotulada «Tabla 3.» y
 * «Tabla 12.», una en la descripción del vinculado y otra en el análisis— y las dos
 * publican lo mismo. Sustituir solo la primera deja la segunda con el vinculado anterior.
 *
 * `rotulo`: solo cuando el título lleva un dato. El de los activos y el de las compañías
 * vinculadas llevan el año gravable, y la plantilla trae el del informe anterior: sin
 * reescribirlo, el informe de 2025 rotula «al 31 de diciembre de 2024». En las demás el
 * título no contiene datos y no se toca, que es el criterio de las tablas del motor.
 */
const OBJETIVOS = [
  { nombres: TABLA_OPERACIONES, filas: filasOperacionesDeIngreso },
  { nombres: 'Operación analizar', filas: filasOperacionAnalizar },
  { nombres: 'Transacciones Inter compañía', filas: filasTransaccionesIntercompania, todas: true },
  { nombres: 'Método de Precios de Transferencia', filas: filasMetodoAplicable },
  { nombres: 'Composición accionaria', filas: filasComposicionAccionaria },
  { nombres: 'Compañías vinculadas', filas: filasCompaniasVinculadas, rotulo: true },
  { nombres: 'Criterios de vinculación', filas: filasCriteriosVinculacion },
  { nombres: 'Activos a 31 de diciembre', filas: filasActivos, rotulo: true },
];

/* Tablas que publican datos DEL CLIENTE y que ningún motor sabe regenerar, porque el
   estudio no tiene dónde guardar su contenido. No se tocan —no hay con qué— pero se nombran
   en los avisos: la Tabla 7 lista los competidores del contribuyente, y hasta ahora fallaba
   en silencio, así que los competidores de END GAME viajaban al informe de cualquier cliente.

   La «Tabla 11. Fuentes de Información» NO está aquí a propósito. Sus entradas son
   instituciones —FMI, Banco de la República, ANDI, DANE, Datos Abiertos— idénticas en todos
   los informes de la firma, así que no arrastra ningún dato ajeno. Avisar de ella sería un
   falso «no cubierto», que es como se enseña a la gente a no leer el banner.

   Cada entrada trae su propia explicación porque el banner mezcla estos avisos con nombres
   de tabla no encontrada y no puede suponer de qué tipo es cada uno. */
const SIN_MOTOR = [
  {
    nombres: 'Competencia nacional e internacional',
    aviso: 'Competencia nacional e internacional (el estudio no guarda los competidores, '
      + 'así que hoy trae los del informe de referencia: complétala a mano)',
  },
];

/* Sustituye una ocurrencia: primero las filas y DESPUÉS el rótulo. El orden importa —el
   rótulo está antes en el documento, así que reescribirlo primero movería los offsets del
   bloque que ya se localizó—; es el mismo orden que sigue `actualizarTablasMacroHtml`. */
function sustituir(html, bloque, tabla, conRotulo) {
  let out = html.slice(0, bloque.inicio)
    + reescribirFilasHtml(html.slice(bloque.inicio, bloque.fin), tabla.filas)
    + html.slice(bloque.fin);

  if (conRotulo && bloque.rotulo) {
    const nuevo = reescribirRotuloHtml(bloque.rotulo.xml, tabla.titulo || tabla.nombre);
    out = out.slice(0, bloque.rotulo.inicio) + nuevo + out.slice(bloque.rotulo.fin);
  }
  return out;
}

/**
 * Reescribe con los datos del estudio las tablas del informe que el marcado no alcanza.
 *
 * @param {string} html     la plantilla marcada.
 * @param {object} estudio
 * @param {string[]} [avisos] arreglo donde se anotan las tablas que la plantilla no trae.
 *        Sin el aviso, una tabla ausente conserva las cifras del informe de referencia y
 *        nadie se entera. Es el mismo arreglo que llenan los otros dos motores de tablas,
 *        así que el banner de `ReporteGenerador` las reporta todas por un solo canal.
 * @returns {string} el informe con las tablas actualizadas.
 */
export function actualizarTablasOperacionesHtml(html, estudio, avisos) {
  let out = String(html || '');
  if (!estudio) return out;

  for (const objetivo of OBJETIVOS) {
    const tabla = objetivo.filas(estudio);

    if (objetivo.todas) {
      /* De atrás hacia adelante: sustituir una desplaza los offsets de las que van después.
         Es la misma razón por la que la ruta OOXML recorre sus dos ocurrencias al revés. */
      const bloques = localizarTablasHtml(out, objetivo.nombres);
      if (!bloques.length) {
        if (Array.isArray(avisos)) avisos.push(tabla.nombre);
        continue;
      }
      for (const bloque of [...bloques].reverse()) {
        out = sustituir(out, bloque, tabla, objetivo.rotulo);
      }
      continue;
    }

    const bloque = localizarTablaHtml(out, objetivo.nombres);
    if (!bloque) {
      if (Array.isArray(avisos)) avisos.push(tabla.nombre);
      continue;
    }
    out = sustituir(out, bloque, tabla, objetivo.rotulo);
  }

  /* Lo que no se puede arreglar, al menos se dice. Solo si la plantilla trae la tabla: un
     aviso por una tabla que no existe acusa de incompleta a una plantilla que está bien. */
  if (Array.isArray(avisos)) {
    for (const { nombres, aviso } of SIN_MOTOR) {
      if (localizarTablaHtml(out, nombres)) avisos.push(aviso);
    }
  }

  return out;
}
