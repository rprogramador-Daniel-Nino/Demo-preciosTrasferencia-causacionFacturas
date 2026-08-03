/* Sección III del Informe Local — TENDENCIAS DE LA ECONOMÍA.
   Datos macroeconómicos, generadores de sus ocho tablas y el apartado sectorial.

   Por qué existe este módulo: esas doce páginas venían como texto fijo del informe
   de End Game Interactive 2024 (sector videojuegos) y solo dos de sus ocho tablas
   se actualizaban. Para cualquier otro cliente el informe salía con datos macro
   atribuidos a años que no les corresponden y con el análisis sectorial de una
   empresa de videojuegos.

   El monolito ya había corregido este mismo defecto en su Bloque 4
   (index.html, «ANÁLISIS MUNDIAL, COLOMBIANO Y DEL SECTOR») cuando el texto
   precargado estaba redactado para una compañía agroquímica. Se porta su criterio:
   macro neutro respecto del sector, apartado sectorial construido con la actividad
   real del contribuyente, y ninguna cifra afirmada sin respaldo.

   Sobre la fecha de consulta: el numeral 4 del artículo 1.2.2.2.1.5 del Decreto
   1625 de 2016 exige indicar la fuente y la fecha de consulta de cada cifra. Aquí
   se anota la publicación de la que sale cada serie (FUENTES_MACRO), pero NO una
   fecha de consulta: nadie registró cuándo se consultaron estos valores, y
   fabricar esa fecha sería precisamente el vicio que la norma quiere evitar. Quien
   radique debe verificar cada cifra contra su fuente. */

/* ─────────────────────────────────────────────────────────────────────────────
   1. SERIES MACRO
   Un mapa año → valor por serie. Los años ausentes NO se rellenan: producen un
   marcador visible (ver marcadorPendiente) en lugar de una cifra de otro año.
   ───────────────────────────────────────────────────────────────────────────── */

export const DATOS_MACRO = {
  pib_mundial: {
    2022: '3.5',
    2023: '3.2',
    2024: '3.3',
    2025: '3.2',
    2026: '3.2',
    2027: '3.1',
  },

  pib_colombia: {
    2022: '7.3',
    2023: '0.6',
    2024: '1.7',
    2025: '2.6',
    2026: '3.0',
    2027: '3.2',
  },

  inflacion_global: {
    2022: '10.7',
    2023: '6.8',
    2024: '5.9',
    2025: '4.5',
    2026: '3.8',
  },

  inflacion_colombia: {
    2024: '5.2',
    2025: '5.1',
    2026: '3.8',
  },

  /* Meta puntual de inflación del Banco de la República. Es una meta de política,
     no una serie observada: no cambia con el año gravable. */
  meta_inflacion_banrep: '3.0',

  /* Tasa de intervención del Banco de la República. A diferencia de las demás,
     estas son observaciones puntuales y no promedios anuales, así que cada una
     conserva su etiqueta original: reetiquetar «marzo de 2023» como «2023» daría
     por anual un máximo que fue de un mes. */
  tasa_intervencion: {
    2023: { etiqueta: 'Marzo 2023 (máximo del ciclo)', valor: '13.25' },
    2024: { etiqueta: 'Diciembre 2024', valor: '9.50' },
    2025: { etiqueta: 'Diciembre 2025', valor: '8.50' },
    2026: { etiqueta: 'Diciembre 2026', valor: '6.75' },
  },

  trm_promedio: {
    2023: '4325',
    2024: '4062',
    2025: '4120',
    2026: '4180',
  },

  desempleo_colombia: {
    2024: '9.7',
    2025: '9.0',
    2026: '8.8',
  },

  /* Proyecciones por región para un año dado. No es una serie temporal: cada año
     trae su propio corte de regiones. */
  crecimiento_por_region: {
    2025: [
      ['Mundial', '2.8'],
      ['Estados Unidos', '1.8'],
      ['China', '4.0'],
      ['América Latina', '2.3'],
      ['Colombia (OCDE)', '2.8'],
    ],
    2026: [
      ['Mundial', '3.0'],
      ['Estados Unidos', '2.0'],
      ['China', '4.6'],
      ['América Latina', '2.3'],
      ['Colombia (OCDE)', '2.4'],
    ],
  },
};

export const FUENTES_MACRO = {
  pib_mundial: 'Fondo Monetario Internacional (FMI), Informe de Perspectivas de la Economía Mundial (World Economic Outlook - WEO)',
  pib_colombia: 'Departamento Administrativo Nacional de Estadística (DANE), Dirección de Síntesis y Cuentas Nacionales',
  inflacion_global: 'Organización para la Cooperación y el Desarrollo Económicos (OCDE) / Fondo Monetario Internacional (FMI)',
  inflacion_colombia: 'Departamento Administrativo Nacional de Estadística (DANE), Índice de Precios al Consumidor (IPC)',
  tasa_intervencion: 'Banco de la República de Colombia, Junta Directiva - Informes de Política Monetaria',
  trm_promedio: 'Banco de la República de Colombia, Serie de Tasa Representativa del Mercado (TRM)',
  desempleo_colombia: 'Departamento Administrativo Nacional de Estadística (DANE), Gran Encuesta Integrada de Hogares (GEIH)',
  crecimiento_por_region: 'Fondo Monetario Internacional (FMI), WEO / OCDE Economic Outlook',
};

/* ─────────────────────────────────────────────────────────────────────────────
   2. MARCADOR DE DATO PENDIENTE
   ───────────────────────────────────────────────────────────────────────────── */

/** Texto que ocupa el lugar de una cifra que no tenemos, en vez de un guion mudo
 *  o —peor— el valor de otro año. */
export function marcadorPendiente(anio, concepto) {
  return (
    '[Completar con ' + concepto + ' de ' + anio + ' e indicar fuente y fecha de consulta, ' +
    'conforme al numeral 4 del artículo 1.2.2.2.1.5 del Decreto 1625 de 2016]'
  );
}

/** Valor de una serie para un año, o el marcador si no está. */
function valorODisponible(serie, anio, concepto) {
  const v = serie && serie[anio];
  return (v === undefined || v === null || v === '') ? marcadorPendiente(anio, concepto) : v;
}

/* ─────────────────────────────────────────────────────────────────────────────
   3. CONSTRUCCIÓN DE TABLAS
   El formato replica el que Word produjo en la plantilla original (una etiqueta
   por línea, cada celda con su <p> interno). Mantenerlo importa: el HTML se
   exporta como .doc y Word es sensible a esa anidación.
   ───────────────────────────────────────────────────────────────────────────── */

function celda(contenido, negrita) {
  const cuerpo = negrita ? '<strong>' + contenido + '</strong>' : String(contenido);
  return '<td>\n<p>\n' + cuerpo + '\n</p>\n</td>\n';
}

function fila(celdas) {
  return '<tr>\n' + celdas.join('') + '</tr>\n';
}

/** Tabla con título en negrita, una fila de encabezados, n filas de datos y pie de fuente ordenada. */
export function tablaHTML(titulo, encabezados, filas, fuente) {
  const pieFuente = fuente ? '\n<p>\n<strong>FUENTE:</strong> ' + fuente + '.\n</p>' : '';
  return (
    '<p>\n<strong>' + titulo + '</strong>\n</p>\n<table>\n' +
    fila(encabezados.map((h) => celda(h, true))) +
    filas.map((f) => fila(f.map((c) => celda(c, false)))).join('') +
    '</table>' + pieFuente
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   4. LOS OCHO GENERADORES
   Firma común (year, wrap): `wrap` resalta en el editor lo que se sustituyó, y
   lo inyecta el llamador para que este módulo no dependa de los estilos de la UI.
   La ventana es deslizante —año anterior, año gravable, proyección del siguiente—
   igual que hacían los dos generadores originales.
   ───────────────────────────────────────────────────────────────────────────── */

/** Serie y fuente para una clave: prioriza datosMacro (de Firestore) sobre el
 *  respaldo local embebido en el código. */
function resolverSerie(datosMacro, clave) {
  const remota = datosMacro && datosMacro.series && datosMacro.series[clave];
  if (remota && remota.valores) {
    let fuenteTexto = remota.fuente || FUENTES_MACRO[clave];
    if (remota.fuenteUrl) fuenteTexto += ' (' + remota.fuenteUrl + ')';
    return { valores: remota.valores, fuente: fuenteTexto };
  }
  return { valores: DATOS_MACRO[clave], fuente: FUENTES_MACRO[clave] };
}

export function generarTablaPibMundial(datosMacro, year, wrap) {
  const y1 = year - 1, y2 = year, y3 = year + 1;
  const { valores: S, fuente } = resolverSerie(datosMacro, 'pib_mundial');
  return tablaHTML(
    'Crecimiento del PIB Mundial (' + y1 + '-' + y3 + ')',
    ['Año', 'Crecimiento Mundial (%)'],
    [
      [wrap(y1), wrap(valorODisponible(S, y1, 'el crecimiento del PIB mundial'))],
      [wrap(y2), wrap(valorODisponible(S, y2, 'el crecimiento del PIB mundial'))],
      [wrap(y3) + ' (Proyección)', wrap(valorODisponible(S, y3, 'la proyección de crecimiento del PIB mundial'))],
    ],
    fuente
  );
}

export function generarTablaPibColombia(datosMacro, year, wrap) {
  const y1 = year - 1, y2 = year, y3 = year + 1;
  const { valores: S, fuente } = resolverSerie(datosMacro, 'pib_colombia');
  return tablaHTML(
    'Crecimiento del PIB en Colombia (' + y1 + '-' + y3 + ')',
    ['Año', 'Crecimiento del PIB (%)'],
    [
      [wrap(y1), wrap(valorODisponible(S, y1, 'el crecimiento del PIB de Colombia'))],
      [wrap(y2), wrap(valorODisponible(S, y2, 'el crecimiento del PIB de Colombia'))],
      [wrap(y3) + ' (Proyección OCDE)', wrap(valorODisponible(S, y3, 'la proyección de crecimiento del PIB de Colombia'))],
    ],
    fuente
  );
}

export function generarTablaInflacionGlobal(datosMacro, year, wrap) {
  const y1 = year - 1, y2 = year, y3 = year + 1;
  const { valores: S, fuente } = resolverSerie(datosMacro, 'inflacion_global');
  return tablaHTML(
    'Tasas de Inflación Global (' + y1 + '-' + y3 + ')',
    ['Año', 'Tasa de Inflación (%)'],
    [
      [wrap(y1), wrap(valorODisponible(S, y1, 'la inflación global'))],
      [wrap(y2), wrap(valorODisponible(S, y2, 'la inflación global'))],
      [wrap(y3) + ' (Proyección)', wrap(valorODisponible(S, y3, 'la proyección de inflación global'))],
    ],
    fuente
  );
}

export function generarTablaCrecimientoPorRegion(datosMacro, year, wrap) {
  const { valores: porAnio, fuente } = resolverSerie(datosMacro, 'crecimiento_por_region');
  const porRegion = porAnio[year];
  const titulo = 'Proyecciones de Crecimiento del PIB por Región/País (' + year + ')';
  if (!porRegion || !porRegion.length) {
    /* Sin corte del año no se reutiliza el de otro: se listan las regiones con el
       marcador, que es lo que hay que completar. */
    const regiones = ['Mundial', 'Estados Unidos', 'China', 'América Latina', 'Colombia (OCDE)'];
    return tablaHTML(titulo, ['Región/País', 'Crecimiento Proyectado (%)'],
      regiones.map((r) => [r, wrap(marcadorPendiente(year, 'la proyección de crecimiento de ' + r))]),
      fuente);
  }
  return tablaHTML(titulo, ['Región/País', 'Crecimiento Proyectado (%)'],
    porRegion.map(([region, valor]) => [region, wrap(valor)]),
    fuente);
}

export function generarTablaInflacionColombia(datosMacro, year, wrap) {
  const { valores: S, fuente } = resolverSerie(datosMacro, 'inflacion_colombia');
  return tablaHTML(
    'Inflación en Colombia (' + year + ' vs. Meta ' + (year + 1) + ')',
    ['Indicador', 'Valor (%)'],
    [
      ['Inflación ' + wrap(year), wrap(valorODisponible(S, year, 'la inflación de Colombia'))],
      ['Meta Inflación ' + wrap(year + 1), wrap(DATOS_MACRO.meta_inflacion_banrep)],
    ],
    fuente
  );
}

export function generarTablaTasaIntervencion(datosMacro, year, wrap) {
  const { valores: S, fuente } = resolverSerie(datosMacro, 'tasa_intervencion');
  const y1 = year - 1, y2 = year;
  /* Se toman las observaciones de los dos años de la ventana con su etiqueta
     original; si falta alguna, esa fila lleva el marcador. */
  const filas = [y1, y2].map((y) => {
    const obs = S[y];
    return obs
      ? [obs.etiqueta, wrap(obs.valor)]
      : ['Diciembre ' + y, wrap(marcadorPendiente(y, 'la tasa de intervención del Banco de la República'))];
  });
  const etiquetas = filas.map((f) => f[0]);
  return tablaHTML(
    'Tasa de Intervención del Banco de la República (' + etiquetas[0] + ' - ' + etiquetas[1] + ')',
    ['Fecha', 'Tasa de Intervención (%)'],
    filas,
    fuente
  );
}

export function generarTablaTRM(datosMacro, year, wrap) {
  const y1 = year - 1, y2 = year;
  const { valores: S, fuente } = resolverSerie(datosMacro, 'trm_promedio');
  return tablaHTML(
    'Tasa Representativa del Mercado (TRM) Promedio (' + y1 + '-' + y2 + ')',
    ['Año', 'TRM Promedio ($)'],
    [
      [wrap(y1), wrap(valorODisponible(S, y1, 'la TRM promedio'))],
      [wrap(y2), wrap(valorODisponible(S, y2, 'la TRM promedio'))],
    ],
    fuente
  );
}

export function generarTablaDesempleo(datosMacro, year, wrap) {
  const { valores: S, fuente } = resolverSerie(datosMacro, 'desempleo_colombia');
  return tablaHTML(
    'Tasa de Desempleo en Colombia (' + year + ' vs. Proyección ' + (year + 1) + ')',
    ['Indicador', 'Valor (%)'],
    [
      ['Desempleo ' + wrap(year), wrap(valorODisponible(S, year, 'la tasa de desempleo'))],
      ['Desempleo Proyectado ' + wrap(year + 1), wrap(valorODisponible(S, year + 1, 'la proyección de desempleo'))],
    ],
    fuente
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   5. APARTADO SECTORIAL (III.C)
   Port de ptSectorAuto (index.html, Bloque 4). Construye el apartado con la
   actividad real del contribuyente y no afirma ninguna cifra sectorial: exige
   los indicadores del año con su fuente mediante un marcador explícito.
   ───────────────────────────────────────────────────────────────────────────── */

/* El objeto social y la actividad vienen de OCR y pueden traer caracteres que
   rompen el HTML del informe. */
function escaparHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Título de III.C. Neutro a propósito: el detalle de la actividad va en el
 *  cuerpo, donde hay espacio, y no en un encabezado que también aparece en el
 *  índice del informe. */
export function tituloSectorial(study) {
  const ciiu = escaparHtml((study && study.ciiu) || '').trim();
  return ciiu
    ? 'Análisis del Sector económico de la Compañía (actividad CIIU ' + ciiu + ')'
    : 'Análisis del Sector económico de la Compañía';
}

export function generarApartadoSectorial(study, year, wrap) {
  const marca = typeof wrap === 'function' ? wrap : (v) => v;
  const ent = escaparHtml((study && study.ent) || '').trim();
  const ciiu = escaparHtml((study && study.ciiu) || '').trim();
  const actividad = escaparHtml(
    ((study && (study.actividad_especifica || study.objeto)) || '').replace(/\s+/g, ' ').trim()
  );

  let html =
    '<p>\nEl sector en el que opera ' + (ent ? marca(ent) : 'la Compañía') +
    (ciiu ? ' (actividad CIIU ' + marca(ciiu) + ')' : '') +
    ' se describe a continuación para el año gravable ' + marca(year) + '.\n</p>\n';

  if (actividad) {
    html +=
      '<p>\nConforme a la información aportada por el contribuyente, su actividad corresponde a: ' +
      marca(actividad.slice(0, 900)) + '\n</p>\n';
  }

  html +=
    '<p>\nSe analizan la estructura de la industria, la dinámica de la demanda, el comportamiento ' +
    'de los precios y las condiciones de competencia del período, por ser los factores que explican ' +
    'el margen obtenido por la parte examinada y su comparabilidad con las compañías seleccionadas.\n</p>\n';

  html +=
    '<p>\n[Actualizar con los indicadores sectoriales del año gravable ' + year +
    ' e indicar expresamente la fuente y la fecha de consulta de cada cifra y gráfico, conforme al ' +
    'numeral 4 del artículo 1.2.2.2.1.5 del Decreto 1625 de 2016.]\n</p>\n';

  return html;
}

/* ─────────────────────────────────────────────────────────────────────────────
   6. APARTADOS III.A Y III.B
   Narrativa ya redactada por functions/analisisMercadoActualizar.js (Gemini busca,
   Claude redacta), o un marcador de pendiente si Firestore todavía no tiene una
   corrida guardada. A diferencia del apartado sectorial, el título de estos dos
   no depende del cliente, así que no hace falta una función de título aparte.
   ───────────────────────────────────────────────────────────────────────────── */

export function generarApartadoMundial(datosMacro, year, wrap) {
  const marca = typeof wrap === 'function' ? wrap : (v) => v;
  const narrativa = datosMacro && datosMacro.narrativa && datosMacro.narrativa.mundial;
  if (narrativa) return narrativa;
  return '<p>\n' + marca(
    '[Actualizar con el análisis del panorama de la economía mundial del año gravable ' + year +
    ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo 1.2.2.2.1.5 del Decreto 1625 de 2016.]'
  ) + '\n</p>\n';
}

export function generarApartadoColombia(datosMacro, year, wrap) {
  const marca = typeof wrap === 'function' ? wrap : (v) => v;
  const narrativa = datosMacro && datosMacro.narrativa && datosMacro.narrativa.colombia;
  if (narrativa) return narrativa;
  return '<p>\n' + marca(
    '[Actualizar con el análisis del panorama de la economía colombiana del año gravable ' + year +
    ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo 1.2.2.2.1.5 del Decreto 1625 de 2016.]'
  ) + '\n</p>\n';
}
