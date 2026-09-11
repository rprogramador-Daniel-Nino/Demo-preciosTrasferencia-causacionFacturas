/* ─────────────────────────────────────────────────────────────────────────────
   informeSinPlantilla.js — un borrador de trabajo cuando no hay ninguna plantilla.

   Las dos rutas normales de generación (`docxRelleno.js` y la que usa
   `plantillaRenderer.js` sobre `aDocxBlob`) parten de un archivo de referencia — el
   .docx o el PDF que sube el consultor. Sin ninguno de los dos, esas rutas no tienen
   de dónde sacar la forma del documento y el .docx sale vacío.

   Este módulo arma un HTML propio, sin depender de ningún archivo de referencia: una
   sección por cada bloque de datos que el estudio ya trae. No redacta el Informe
   Local completo — no lleva la prosa legal de los artículos 260-1 a 260-11 del E.T.
   ni la tabla de contenido de un informe real, eso lo aporta la forma de la plantilla
   y aquí no hay ninguna — es un volcado estructurado que el consultor termina de
   formatear a mano. `ReporteGenerador.jsx` lo pasa tal cual a `aDocxBlob`
   (`docxWriter.js`), que sí sabe convertir HTML llano a un .docx real.

   Todo el contenido sale de funciones que ya existen y que usan las otras dos rutas,
   para no tener una tercera versión de las mismas cifras:
   `tablasContribuyente.js`, `tablasOperaciones.js`, `tablasInforme.js` y los
   generadores de III.A/III.B/III.C de `analisisMercado.js`, que ya saben producir su
   apartado desde cero cuando la plantilla no lo trae.
   ───────────────────────────────────────────────────────────────────────────── */

import { filasComposicionAccionaria, filasActivos } from './tablasContribuyente.js';
import { filasOperacionesDeIngreso, filasOperacionAnalizar } from './tablasOperaciones.js';
import { filasMuestraComparables } from './tablasInforme.js';
import { citaBaseDatos } from './prosaBaseDatos.js';
import {
  tablaHTML, generarApartadoMundial, generarApartadoColombia, generarApartadoSectorial,
  tituloSectorial,
} from './analisisMercado.js';
import { escaparTextoHtml } from './tablasHtmlInforme.js';

const identidad = (v) => v;

const seccion = (titulo, contenidoHtml) => (contenidoHtml
  ? '<h2>' + escaparTextoHtml(titulo) + '</h2>\n' + contenidoHtml + '\n'
  : '');

/** Una de las tablas `{titulo|nombre, encabezados, filas, fuente, sinDatos?}` que ya
 *  producen `tablasContribuyente.js`/`tablasOperaciones.js`, a HTML con `tablaHTML`
 *  (`analisisMercado.js`). Sin filas, o marcada `sinDatos`, no se emite: una tabla de
 *  puros guiones no aporta nada en un borrador que ya avisa qué falta por bloque. */
function tablaDesde(tabla) {
  if (!tabla || tabla.sinDatos || !Array.isArray(tabla.filas) || !tabla.filas.length) return '';
  return tablaHTML(
    escaparTextoHtml(tabla.titulo || tabla.nombre || ''),
    tabla.encabezados.map(escaparTextoHtml),
    tabla.filas.map((fila) => fila.map(escaparTextoHtml)),
    tabla.fuente ? escaparTextoHtml(tabla.fuente) : '',
  );
}

const dato = (v) => (v == null || v === '' ? '—' : escaparTextoHtml(v));

function fichaContribuyente(e) {
  return tablaHTML('Datos del contribuyente', ['Campo', 'Valor'], [
    ['Razón social', dato(e.ent)],
    ['NIT', dato(e.nit)],
    ['Año gravable', dato(e.anio)],
    ['Actividad económica (CIIU)', dato(e.ciiu)],
    ['Objeto social', dato(e.objeto)],
    ['Representante legal', dato(e.representante)],
  ], '');
}

function fichaVinculado(e) {
  return tablaHTML('Vinculado económico', ['Campo', 'Valor'], [
    ['Nombre', dato(e.vinc)],
    ['País', dato(e.pais_vinc)],
    ['Tipo de operación analizada', dato(e.vinc_tipo)],
  ], '');
}

/** Los huecos que `docxWriter.js` sabe repartir con las páginas del anexo de EEFF, en
 *  la misma convención que ya usa `pdfReferenceExtractor.js` — sin esto el anexo no
 *  se insertaría en absoluto (`docxWriter.js` cuenta `data-hueco="anexo_eeff"`). */
function anexoEeff(e) {
  const paginas = Array.isArray(e.eeffImages) ? e.eeffImages : [];
  if (!paginas.length) return '';
  const huecos = paginas.map((_, i) => (
    '<div data-hueco="anexo_eeff" data-id="hueco_' + i + '"></div>'
  )).join('');
  return '<h1>ANEXO A. Estados financieros' + (e.ent ? ' ' + escaparTextoHtml(e.ent) : '') +
    '</h1>\n' + huecos;
}

/**
 * Arma el HTML de un borrador de Informe Local con solo lo que el estudio ya trae,
 * sin partir de ninguna plantilla ni informe de referencia.
 *
 * @param {object} estudio
 * @param {object|null} analisisMercado  el mismo dato que usan las otras dos rutas
 *        para III.A/III.B (`datosMacro`); si no se ha generado aún, esos apartados
 *        salen con el marcador de pendiente, igual que en el resto del sistema.
 * @param {object|null} analisisSector  idem para III.C.
 * @returns {string} HTML listo para `aDocxBlob` (`docxWriter.js`).
 */
export function construirHtmlSinPlantilla(estudio, analisisMercado, analisisSector) {
  const e = estudio || {};
  const year = Number(e.anio) || new Date().getFullYear();

  const partes = [
    '<h1>Informe Local de Precios de Transferencia — Borrador sin plantilla</h1>',
    '<p>Documento generado directamente con los datos ingresados al sistema para este ' +
      'estudio, sin partir de ninguna plantilla ni informe de referencia. Es un borrador ' +
      'de trabajo: complételo y dele formato antes de radicar.</p>',
    seccion('Datos del contribuyente', fichaContribuyente(e)),
    seccion('Vinculado económico', fichaVinculado(e)),
    seccion('Composición accionaria', tablaDesde(filasComposicionAccionaria(e))),
    seccion('Operación analizada', tablaDesde(filasOperacionAnalizar(e))),
    seccion('Operaciones con el vinculado', tablaDesde(filasOperacionesDeIngreso(e))),
    seccion('Estados financieros', tablaDesde(filasActivos(e))),
    seccion('Muestra de comparables seleccionadas', tablaDesde({
      nombre: 'Muestra de comparables seleccionadas',
      encabezados: ['N°', 'Razón social', 'Ámbito'],
      filas: filasMuestraComparables(e).map((f) => [f.numero, f.nombre, f.ambito]),
    })),
    e.database_source || e.database_consulta
      ? '<p>' + escaparTextoHtml(citaBaseDatos(e)) + '</p>\n' : '',
    seccion('Panorama de la economía mundial', generarApartadoMundial(analisisMercado, year, identidad)),
    seccion('Panorama de la economía colombiana', generarApartadoColombia(analisisMercado, year, identidad)),
    seccion(
      tituloSectorial(e, analisisSector, year),
      generarApartadoSectorial(e, year, identidad, analisisSector),
    ),
    anexoEeff(e),
  ];

  return partes.filter(Boolean).join('\n');
}
