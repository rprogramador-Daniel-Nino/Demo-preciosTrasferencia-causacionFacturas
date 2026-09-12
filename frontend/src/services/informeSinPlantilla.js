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
import { filasMuestraComparables, filasRazonesRechazo } from './tablasInforme.js';
import { gruposDelAnexoC, filasResumenAnexoC, tituloDeGrupoAnexoC } from './anexoCHtml.js';
import { RUBROS_RESULTADOS, RUBROS_BALANCE, cifraDeRubro, rubrosConDato } from './anexoBRubros.js';
import { citaBaseDatos } from './prosaBaseDatos.js';
import {
  tablaHTML, generarApartadoMundial, generarApartadoColombia, generarApartadoSectorial,
  tituloSectorial,
} from './analisisMercado.js';
import { escaparTextoHtml } from './tablasHtmlInforme.js';
import { num } from '../utils/calculations.js';

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

/** Tabla 16 — Razones de rechazo: letra y conteo por motivo, más el total del universo
 *  evaluado. Mismas columnas y mismo título que arma `docxRelleno.js` (`reemplazar
 *  ('Razones de rechazo', ...)`), para que el borrador declare lo mismo que la ruta
 *  con plantilla ante el mismo estudio. */
function tablaRazonesRechazo(e) {
  const { filas, total } = filasRazonesRechazo(e.embudoSeleccion);
  if (!filas.length) return '';
  const filasTabla = filas.map((f) => [f.etiqueta, f.letra, String(f.cuantas)]);
  filasTabla.push(['TOTAL, UNIVERSO', '', String(total)]);
  return tablaHTML(
    'Razones de rechazo (Filtros Cuantitativos – Filtros Cualitativos)',
    ['FILTRO APLICADO INTERNACIONALES', 'FILTROS APLICADO', 'N° POR FILTRO'],
    filasTabla.map((f) => f.map(escaparTextoHtml)),
    '',
  );
}

/** ANEXO C — el respaldo nominal de la Tabla 16: qué compañías se descartaron por cada
 *  motivo, con la misma letra que les da la tabla. `gruposDelAnexoC` es la única fuente
 *  para las dos rutas del informe (ver su cabecera), así que aquí no se recalcula nada. */
function anexoC(e) {
  const grupos = gruposDelAnexoC(e);
  if (!grupos.length) return '';
  const universo = num(e.matrizRechazo && e.matrizRechazo.universo) || 0;
  const resumen = tablaHTML(
    'Resumen ANEXO C',
    ['FILTRO APLICADO INTERNACIONALES', 'FILTROS APLICADO', 'N° POR FILTRO'],
    filasResumenAnexoC(grupos, universo).map((f) => f.map(escaparTextoHtml)),
    '',
  );
  const detalle = grupos.map((g) => tablaHTML(
    escaparTextoHtml(tituloDeGrupoAnexoC(g)),
    ['Nº', 'NOMBRE DE LA COMPAÑÍA', 'FILTRO'],
    g.companias.map((nombre, i) => [String(i + 1), escaparTextoHtml(nombre), escaparTextoHtml(g.letra)]),
    '',
  )).join('\n');
  return resumen + '\n' + detalle;
}

/* La misma conversión que `celdaCifraAnexoB` de `docxRelleno.js`: dos decimales en
 * formato es-CO, sin separador de miles detectado de ninguna plantilla —aquí no hay
 * ninguna— porque es la que usa la ruta OOXML, que tampoco depende de un molde. */
const cifraAnexoB = (v) => {
  const n = num(v);
  return n === null ? '' : n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** ANEXO B — ficha de cada comparable: nombre y descripción de actividad, YA
 *  redactada en español en el paso 4 del motor (`descripcionComparables.js` corrió
 *  entonces, no aquí — este módulo solo lee `descActividad`), y sus cifras de Estado
 *  de Resultados y Balance General (`anexoBRubros.js`, la misma lista de rubros que
 *  usan las otras dos rutas). Sin `eeffDatos` se avisa en el propio documento —igual
 *  que hace `docxRelleno.js`— en vez de omitir la comparable entera. */
function anexoB(e) {
  const comparables = Array.isArray(e.comparables) ? e.comparables.filter((c) => c && c.name) : [];
  if (!comparables.length) return '';
  const cita = e.database_source || e.database_consulta ? citaBaseDatos(e) : '';
  const year = Number(e.anio) || new Date().getFullYear();

  return comparables.map((c) => {
    const desc = c.descActividad || c.desc || 'Descripción de actividad no disponible.';
    const anioCol = (c.eeffDatos && c.eeffDatos.periodo) || year;
    const ficha = tablaHTML(
      'Descripción de la Compañía Comparable',
      ['NOMBRE DE LA COMPAÑÍA COMPARABLE', 'DESCRIPCIÓN ACTIVIDAD'],
      [[escaparTextoHtml(c.name), escaparTextoHtml(desc)]],
      '',
    );
    if (!c.eeffDatos) {
      return ficha + '\n<p><strong>[PENDIENTE] Falta el estado financiero de ' +
        escaparTextoHtml(c.name) + '. Cárgalo en el paso 4 del motor de comparables y ' +
        'vuelve a generar el informe.</strong></p>';
    }
    const tablaCifras = (titulo, rubros) => tablaHTML(
      titulo,
      ['Descripción', String(anioCol)],
      rubrosConDato(rubros, c).map((r) => [escaparTextoHtml(r.etiqueta), cifraAnexoB(cifraDeRubro(r, c))]),
      cita,
    );
    return ficha + '\n' + tablaCifras('Estado de Resultados', RUBROS_RESULTADOS) +
      '\n' + tablaCifras('Balance General', RUBROS_BALANCE);
  }).join('\n');
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
    seccion(
      'Matriz de rechazo (motor de comparables)',
      [tablaRazonesRechazo(e), anexoC(e)].filter(Boolean).join('\n'),
    ),
    seccion('Descripción y estados financieros de las comparables (ANEXO B)', anexoB(e)),
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
