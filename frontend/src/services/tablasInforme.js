/* ─────────────────────────────────────────────────────────────────────────────
   tablasInforme.js — filas de tabla y diagnóstico de cobertura del Informe Local.

   Lo que sobrevive de `exactTemplateMapper.js`. Aquel módulo producía el informe
   sustituyendo por expresión regular los literales del documento de END GAME 2024
   (el NIT, el Tax ID del vinculado, el monto de la operación, las anclas
   `_Toc2089309xx` y trece reglas amarradas al año «2024»), de modo que una
   plantilla de otro cliente no casaba con ninguna regla y el informe salía con los
   datos del contribuyente anterior sin una sola señal. Se retiró entero.

   Aquí quedan las tres piezas que no dependían de aquel documento y que consume la
   ruta viva —rellenar el `.docx` del propio cliente con docxtemplater, ver
   `docxRelleno.js`—: las filas de la tabla de razones de rechazo, las filas de la
   muestra de comparables, y el diagnóstico de qué le falta al estudio antes de
   generar.
   ───────────────────────────────────────────────────────────────────────────── */

import { analizarRango } from './rangoIntercuartil.js';
import {
  DATOS_MACRO, resolverSerie, cifraODisponible, marcadorPendiente,
} from './analisisMercado.js';
import { num, pliOf } from '../utils/calculations.js';
import { traducirCriterio } from './criteriosScreeningEs.js';

/* ══════════════ Razones de rechazo ══════════════
   Cada fila es un criterio del motor. Se omiten las que no descartaron a nadie: un
   informe que declara «Pérdidas operativas: 0» cuando el criterio se puso en «incluir»
   confunde a quien lo revisa. Las letras se asignan sobre las filas que quedan, para
   conservar el formato de la columna «FILTROS APLICADO» del documento. */

const RAZONES_RECHAZO = [
  ['rigorFuncional', 'Diferencias funcionales: perfil no comparable con la parte examinada'],
  ['actividadDistinta', 'Actividad económica distinta a la de la parte examinada'],
  ['sinDescripcion', 'Sin descripción del negocio que permita verificar la actividad'],
  ['holding', 'Compañías holding o de grupo (en la razón social)'],
  /* El descarte por mención en la DESCRIPCIÓN se retiró del motor: la descripción
     nombra al grupo del que la empresa forma parte, que no es lo mismo que ser ella
     la sociedad de cartera. Además su motivo no estaba entre los siete que cuenta la
     hoja de trazabilidad, y esas compañías descuadraban la suma de control.

     Motivo separado del de control y no fundido con él: el holding se presume de la
     razón social, mientras que el control es un hecho de la composición accionaria
     (Art. 260-1 E.T.). Ante la DIAN son dos justificaciones distintas y la tabla las
     tiene que poder sustentar por separado. Los estudios guardados antes de este
     cambio no traen la clave, cuentan 0 y la fila se omite sola. */
  ['controlada', 'Compañías vinculadas: un accionista alcanza o supera el umbral de independencia'],
  ['perdidaOperativa', 'Pérdidas operativas en el período analizado'],
  ['saldoNegativo', 'Saldos negativos en balances: cifras no verosímiles'],
];

/* Los tres motivos de comparabilidad funcional van en UNA sola fila de la tabla, no en
   una cada uno. Es como los presenta la hoja «Matriz de rechazo» del libro de soporte
   (`memoriaCalculoRangoOptimo.js:885`), y el informe tiene que declarar la misma cifra
   que el libro que lo sustenta: con las filas separadas, el documento publicaba 85 y
   1.304 donde el Excel publica 1.389.

   Se unifica solo la PRESENTACIÓN: las claves siguen separadas en el motor, que es
   donde cada compañía conserva el motivo exacto por el que salió. El desglose fino vive
   en la columna «Motivo de rechazo» de la base de datos, igual que en el libro.

   Se exporta porque el ANEXO C tiene que fundir los mismos motivos bajo la misma letra
   (`anexoCHtml.js`): si la tabla declara 1.389 en «A» y el anexo lista ahí otra cifra,
   el anexo deja de sustentar la tabla. Una sola definición para los dos. */
export const FUNDIDOS_EN_RIGOR = ['actividadDistinta', 'sinDescripcion'];

/* Mayúsculas para las tablas que las llevan: la de márgenes, la de la muestra y el ANEXO C
   entero (requisito del usuario, 2026-08-19). La «Tabla 16. Razones de rechazo» NO, y por eso
   esto vive aquí como utilidad y no dentro de un generador de tablas: aplicado ahí subiría toda
   tabla del informe y la excepción se perdería. Sube quien arma las filas, tabla por tabla.

   Vive en este módulo porque es el que ya comparten las dos rutas —la de plantilla .docx
   (`docxRelleno.js`) y la de PDF (`tablasHtmlInforme.js`)—, así que las dos suben igual. La
   ruta de PDF tiene además `mayusculasEnTablaHtml`, que sube el texto de una tabla YA armada:
   lo necesita porque ahí los encabezados vienen de la plantilla del cliente y no de un array
   nuestro. */
export const enMayusculas = (valor) => String(valor == null ? '' : valor).toUpperCase();

/** Una matriz de filas, celda a celda. */
export const filasEnMayusculas = (filas) =>
  (filas || []).map((fila) => (fila || []).map(enMayusculas));

/* La fila fundida se nombra en corto, como en el libro y como en los informes de años
   anteriores: la coletilla «perfil no comparable con la parte examinada» describía solo
   uno de los tres motivos que ahora recoge. */
const ETIQUETA_RIGOR = 'Diferencias funcionales';

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Etiqueta de cada motivo, para quien necesite nombrar uno que el embudo no declara. */
export const ETIQUETAS_MOTIVO = Object.freeze({
  ...Object.fromEntries(RAZONES_RECHAZO),
  aceptadas: 'Compañías comparables aceptadas',
});

/**
 * Filas de la tabla de razones de rechazo, ya con su letra y su conteo.
 *
 * Devuelve también si los números cuadran: rechazos —con la reserva ya sumada a las
 * diferencias funcionales— más aceptadas debe dar el universo evaluado. Si no cuadra,
 * quien genera el informe tiene que saberlo antes de radicarlo, no después.
 */
export function filasRazonesRechazo(embudo) {
  const e = embudo || null;
  if (!e || !e.evaluadas) return { filas: [], total: 0, cuadra: false, sinDatos: true };

  const porMotivo = e.porMotivo || {};

  /* Las válidas que no entraron al cupo se cuentan dentro de las diferencias
     funcionales, no en una fila propia. La fila que tenían declaraba por escrito que
     esas compañías superaron todos los criterios y aun así quedaron fuera, y el motivo
     real —el tamaño de muestra pedido— no es un criterio de comparabilidad que se
     sostenga ante quien revise el informe.

     El destino no es arbitrario: `scoreCandidates` ordena las válidas por puntaje
     descendente (`comparablesEngine.js:505`) y la reserva es la cola de ese orden
     (`:550`), es decir las de menor grado de comparabilidad funcional frente a la parte
     examinada. */
  const reserva = Number(e.reserva) || 0;

  /* Las que se retiraron de la muestra en la ingesta del paso 4 porque su estado
     financiero no traía cifras con las que calcular el margen (`eeffSuficiencia.js`).
     Van al mismo sitio que la reserva y por la misma razón: superaron los filtros
     objetivos y no integran la muestra. El motivo real —falta el documento con las
     cifras— no es un criterio de comparabilidad que se sostenga ante quien revise el
     informe, y sí lo es no ser funcionalmente comparable con la parte examinada.

     Tiene que estar aquí para que la tabla cuadre: el componente baja `seleccionadas`
     al retirarlas, así que sin recogerlas en alguna fila la suma dejaría de dar el
     universo evaluado y el generador avisaría de un descuadre que no existe. */
  const sinEeff = Number(e.sinEeff) || 0;

  /* Las que el analista retiró a mano de la muestra en el paso 4, con la papelera. Van al mismo
     sitio que la reserva y las que se quedaron sin estado financiero, y por la misma razón:
     superaron los filtros objetivos y no integran la muestra, así que el motivo que se sostiene
     ante quien revise el informe es no ser funcionalmente comparable con la parte examinada.

     Sin esto la tabla mentía y nadie se enteraba. El borrado manual solo quitaba la fila de la
     pantalla: el embudo seguía declarando las aceptadas de antes, así que el informe decía «13
     compañías comparables aceptadas» mientras la tabla de márgenes listaba 12 y el rango se
     calculaba sobre 12. Y la comprobación de cuadre seguía dando `true` —los conteos del embudo
     no habían cambiado y seguían sumando el universo—, de modo que el descuadre llegaba hasta la
     radicación sin un solo aviso.

     Es una LISTA de nombres y no un contador para que el conteo no pueda desincronizarse: retirar
     dos veces la misma no la cuenta dos veces, y volver a añadirla la saca de aquí. */
  const retiradasMano = Array.isArray(e.retiradasManual) ? e.retiradasManual.length : 0;

  const filas = [];
  RAZONES_RECHAZO.forEach(([clave, etiqueta]) => {
    /* Sin fila propia: su conteo se suma al de «Diferencias funcionales», más abajo. */
    if (FUNDIDOS_EN_RIGOR.includes(clave)) return;

    const esRigor = clave === 'rigorFuncional';

    /* La reserva se suma ANTES de descartar los ceros. Un estudio que no rechazó a
       nadie por rigor funcional pero dejó reserva necesita igual esta fila: omitirla
       dejaría la columna sin sumar el universo. Los motivos fundidos entran por la
       misma puerta y por el mismo motivo. */
    const cuantas = (Number(porMotivo[clave]) || 0)
      + (esRigor
        ? reserva + sinEeff + retiradasMano
          + FUNDIDOS_EN_RIGOR.reduce((acc, k) => acc + (Number(porMotivo[k]) || 0), 0)
        : 0);
    if (cuantas > 0) filas.push({ clave, etiqueta: esRigor ? ETIQUETA_RIGOR : etiqueta, cuantas });
  });

  const aceptadas = Number(e.seleccionadas) || 0;
  filas.push({ clave: 'aceptadas', etiqueta: 'Compañías comparables aceptadas', cuantas: aceptadas });

  const filasConLetra = filas.map((f, i) => ({ ...f, letra: LETRAS[i] || '' }));
  const suma = filas.reduce((acc, f) => acc + f.cuantas, 0);
  const total = Number(e.evaluadas) || 0;

  return { filas: filasConLetra, total, cuadra: suma === total, suma, sinDatos: false };
}

/* ══════════════ Muestra y márgenes de las comparables ══════════════
   Las dos tablas salen de `analizarRango`, que es de donde sale también el rango
   intercuartil. Repetir aquí la fórmula del ajuste habría permitido que el informe
   publicara unos márgenes que no sustentan el rango que declara unas páginas más
   adelante. */

/* Las comparables que se pueden nombrar en el informe. Se descartan las filas sin
   razón social —la tabla del motor arranca con filas en blanco que el usuario va
   llenando— porque una fila numerada y sin nombre en la muestra final no dice nada. */
export function filasComparablesInforme(study) {
  const { filas } = analizarRango(study || {});
  return (filas || []).filter((f) => f.nombre);
}

/** Cómo se nombra el ámbito de una comparable en el informe. */
export const AMBITO = { Int: 'INTERNACIONAL', Nac: 'NACIONAL' };

/* Etiquetas de las filas del rango. Se exportan porque hay tablas que publican solo
   algunos percentiles —la versión horizontal del rango lleva P25, mediana y P75— y
   buscarlos por un literal repetido en cada consumidor deja de encontrarlos en silencio
   el día que se reescriba una etiqueta. */
export const ETIQUETAS_RANGO = {
  min: 'Mínimo',
  p25: 'Percentil 25',
  med: 'Mediana',
  p75: 'Percentil 75',
  max: 'Máximo',
};

/**
 * Filas de la tabla «Muestra Compañías comparables»: número, razón social y ámbito.
 *
 * La numeración es la de la tabla, no un identificador: se recalcula sobre las filas que
 * quedan, así que retirar una comparable durante la ingesta no deja huecos en la columna.
 */
export function filasMuestraComparables(study) {
  return filasComparablesInforme(study).map((f, i) => ({
    numero: i + 1,
    nombre: f.nombre,
    ambito: AMBITO[f.amb] || '',
  }));
}

/**
 * Filas del rango intercuartil en vertical, con los valores SIN formatear.
 *
 * Vivía dentro de `actualizarTablasOperacionesOoxml`, que es la ruta de plantilla .docx.
 * Se extrajo al añadir la misma tabla a la ruta de PDF (`tablasHtmlInforme.js`): con el
 * cálculo repetido en cada ruta, las dos podían publicar percentiles distintos para el
 * mismo estudio, y ese defecto ya se pagó una vez en este repo —había dos
 * implementaciones del cuartil y el modal mostraba un rango y el informe otro—.
 *
 * Las dos columnas se le piden al motor: `stats` para la ajustada —la que sostiene la
 * conclusión de cumplimiento— y `statsNoAjustado` para la otra. Ninguna se calcula aquí, así
 * que las dos salen del mismo universo y con el mismo filtro de ámbito.
 *
 * @param {object} study
 * @returns {{filas:Array<{etiqueta:string, noAjustado:number|null, ajustado:number|null}>,
 *            tPLI:number|null, pli:string}}
 */
export function filasRangoIntercuartil(study) {
  const estudio = study || {};
  const r = analizarRango(estudio);
  /* `statsAjustado` y NO `stats`: el segundo es el escenario que sostiene la conclusión
     —el que elige `useadj`—, mientras esta columna se titula «AJUSTADO» y tiene que
     llevar el rango ajustado por capital de trabajo, que el motor calcula siempre. Con
     `stats` aquí, un estudio con la casilla apagada repetía la columna de al lado. */
  const stats = r.statsAjustado || {};
  /* La estadística del escenario SIN ajuste se le pide al motor (`statsNoAjustado`) en vez
     de ordenar la serie aquí. Ordenarla a mano fue el defecto que Juan corrigió el
     2026-08-11 en `rangoIntercuartil.js`: ese cálculo propio no aplicaba el filtro de
     ámbito (`cmode`), así que el mínimo, el máximo y los percentiles de la columna «NO
     AJUSTADO» contaban comparables que el ámbito excluye, y las dos columnas de una misma
     tabla salían sobre universos distintos.

     Al extraer esta función de `docxRelleno.js` esa mañana el cálculo a mano vino con ella,
     de modo que al integrar las dos ramas su arreglo se quedaba sin consumidor y el defecto
     habría vuelto sin que git marcara nada. */
  const sinAjuste = r.statsNoAjustado || {};
  const valor = (o, clave) => (o && o[clave] !== undefined ? o[clave] : null);

  /* Indicador del contribuyente con el mismo método, descontando el segmento excluido:
     es la cifra que la conclusión compara contra el rango. */
  const seg = num(estudio.seg_excluido) || 0;
  const tS = num(estudio.t_s), tOp = num(estudio.t_op);
  const T = {
    s: tS !== null ? tS - seg : null,
    c: num(estudio.t_c),
    op: tOp !== null ? tOp - seg : null,
    ar: num(estudio.t_ar), inv: num(estudio.t_inv), ap: num(estudio.t_ap),
  };
  const pli = estudio.pli || 'MO';
  const tPLI = pliOf(T, pli);

  const nombreContribuyente = estudio.ent ? String(estudio.ent).toUpperCase() : 'CONTRIBUYENTE';

  return {
    pli,
    tPLI,
    filas: [
      { etiqueta: ETIQUETAS_RANGO.min, noAjustado: valor(sinAjuste, 'min'), ajustado: valor(stats, 'min') },
      { etiqueta: ETIQUETAS_RANGO.p25, noAjustado: valor(sinAjuste, 'p25'), ajustado: valor(stats, 'p25') },
      { etiqueta: ETIQUETAS_RANGO.med, noAjustado: valor(sinAjuste, 'med'), ajustado: valor(stats, 'med') },
      { etiqueta: ETIQUETAS_RANGO.p75, noAjustado: valor(sinAjuste, 'p75'), ajustado: valor(stats, 'p75') },
      { etiqueta: ETIQUETAS_RANGO.max, noAjustado: valor(sinAjuste, 'max'), ajustado: valor(stats, 'max') },
      /* El contribuyente cierra la tabla y lleva su indicador en las dos columnas: se
         ajusta contra sí mismo, así que el ajuste es cero. */
      { etiqueta: nombreContribuyente, noAjustado: tPLI, ajustado: tPLI },
    ],
  };
}

/* ══════════════ Tablas de tendencias de la economía ══════════════

   Las ocho salen de las series macro y no del motor de comparables. Se describen aquí —qué
   se busca en la plantilla, qué título llevan, qué columnas y qué filas— para que las dos
   rutas del informe emitan lo mismo: la de plantilla .docx las escribe como OOXML y la de
   PDF reescribe las filas del HTML. Antes la definición vivía dentro del generador de
   OOXML, así que llevarla a la otra ruta habría significado copiar ocho tablas y sus
   fuentes, y cualquier corrección en una habría dejado a la otra atrás. */

/**
 * Descriptores de las ocho tablas macro, ya resueltos contra las series.
 *
 * @param {object} datosMacro  el análisis de mercado del estudio, o null para usar las
 *        series de respaldo de `analisisMercado.js`.
 * @param {number} year  año gravable.
 * @returns {Array<{nombre:string, titulo:string, cabeceras:string[],
 *          filas:Array<string[]>, fuente:string}>} `nombre` es lo que se busca en la
 *          plantilla; el resto es el contenido que debe quedar.
 */
export function tablasMacroInforme(datosMacro, year) {
  const y = Number(year) || 2025;
  const y1 = y - 1, y2 = y, y3 = y + 1;
  const wrap = (v) => String(v == null ? '—' : v);
  const serie = (clave) => resolverSerie(datosMacro, clave);

  const porAnios = (clave, concepto, cabecera, titulo, etiquetaProyeccion) => {
    const { valores: S, fuente } = serie(clave);
    return {
      titulo, fuente, cabeceras: ['Año', cabecera],
      filas: [
        [String(y1), wrap(cifraODisponible(S, y1, concepto))],
        [String(y2), wrap(cifraODisponible(S, y2, concepto))],
        [String(y3) + etiquetaProyeccion, wrap(cifraODisponible(S, y3, 'la proyección de ' + concepto))],
      ],
    };
  };

  const tablas = [];

  tablas.push({
    nombre: 'PIB Mundial',
    ...porAnios('pib_mundial', 'el crecimiento del PIB mundial', 'Crecimiento Mundial (%)',
      'Crecimiento del PIB Mundial (' + y1 + '-' + y3 + ')', ' (Proyección)'),
  });

  tablas.push({
    nombre: 'PIB en Colombia',
    ...porAnios('pib_colombia', 'el crecimiento del PIB de Colombia', 'Crecimiento del PIB (%)',
      'Crecimiento del PIB en Colombia (' + y1 + '-' + y3 + ')', ' (Proyección OCDE)'),
  });

  tablas.push({
    nombre: 'Inflación Global',
    ...porAnios('inflacion_global', 'la inflación global', 'Tasa de Inflación (%)',
      'Tasas de Inflación Global (' + y1 + '-' + y3 + ')', ' (Proyección)'),
  });

  /* Proyecciones por región: las filas dependen de lo que traiga la serie del año, así que
     cuando falta se emiten las cinco regiones del informe con su marcador de pendiente en
     vez de una tabla vacía. */
  {
    const { valores: porAnio, fuente } = serie('crecimiento_por_region');
    const porRegion = porAnio[y];
    const filas = (!porRegion || !porRegion.length)
      ? ['Mundial', 'Estados Unidos', 'China', 'América Latina', 'Colombia (OCDE)']
        .map((r) => [r, wrap(marcadorPendiente(y, 'la proyección de crecimiento de ' + r))])
      : porRegion.map(({ region, valor }) => [region, wrap(valor)]);
    tablas.push({
      nombre: 'por Región/País',
      titulo: 'Proyecciones de Crecimiento del PIB por Región/País (' + y + ')',
      cabeceras: ['Región/País', 'Crecimiento Proyectado (%)'],
      filas, fuente,
    });
  }

  {
    const { valores: S, fuente } = serie('inflacion_colombia');
    tablas.push({
      nombre: 'Inflación en Colombia',
      titulo: 'Inflación en Colombia (' + y + ' vs. Meta ' + y3 + ')',
      cabeceras: ['Indicador', 'Valor (%)'],
      filas: [
        ['Inflación ' + y, wrap(cifraODisponible(S, y, 'la inflación de Colombia'))],
        ['Meta Inflación ' + y3, wrap(DATOS_MACRO.meta_inflacion_banrep)],
      ],
      fuente,
    });
  }

  /* Tasa de intervención: la serie trae su propia etiqueta de fecha («Diciembre 2024»),
     que además da el título. */
  {
    const { valores: S, fuente } = serie('tasa_intervencion');
    const filas = [y1, y2].map((anio) => {
      const obs = S[anio];
      return obs
        ? [obs.etiqueta, wrap(obs.valor)]
        : ['Diciembre ' + anio,
          wrap(marcadorPendiente(anio, 'la tasa de intervención del Banco de la República'))];
    });
    tablas.push({
      nombre: 'Intervención del Banco',
      titulo: 'Tasa de Intervención del Banco de la República ('
        + filas[0][0] + ' - ' + filas[1][0] + ')',
      cabeceras: ['Fecha', 'Tasa de Intervención (%)'],
      filas, fuente,
    });
  }

  {
    const { valores: S, fuente } = serie('trm_promedio');
    tablas.push({
      nombre: 'Tasa Representativa del Mercado',
      titulo: 'Tasa Representativa del Mercado (TRM) Promedio (' + y1 + '-' + y2 + ')',
      cabeceras: ['Año', 'TRM Promedio ($)'],
      filas: [
        [String(y1), wrap(cifraODisponible(S, y1, 'la TRM promedio'))],
        [String(y2), wrap(cifraODisponible(S, y2, 'la TRM promedio'))],
      ],
      fuente,
    });
  }

  {
    const { valores: S, fuente } = serie('desempleo_colombia');
    tablas.push({
      nombre: 'Desempleo en Colombia',
      titulo: 'Tasa de Desempleo en Colombia (' + y + ' vs. Proyección ' + y3 + ')',
      cabeceras: ['Indicador', 'Valor (%)'],
      filas: [
        ['Desempleo ' + y, wrap(cifraODisponible(S, y, 'la tasa de desempleo'))],
        ['Desempleo Proyectado ' + y3, wrap(cifraODisponible(S, y3, 'la proyección de desempleo'))],
      ],
      fuente,
    });
  }

  return tablas;
}

/* ══════════════ Diagnóstico de cobertura ══════════════ */

/* Texto plano, sin etiquetas, sin acentos y en minúsculas. Sirve para reconocer un
   apartado del informe por lo que dice y no por cómo está marcado: la plantilla de
   cada cliente trae su propio HTML. */
const textoPlano = (html) => String(html || '')
  .replace(/<[^>]*>/g, ' ')
  .normalize('NFD')
  /* \p{M} (marcas combinantes) y no una clase con los caracteres literales: escritos
     tal cual son invisibles en el editor y cualquier herramienta que normalice el
     fuente los borraría sin que se note. */
  .replace(/\p{M}/gu, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/* Antes esto era `html.includes('id="_Toc208930979"')`: el ancla de Word del
   apartado III.C en el .docx de End Game. Ese identificador no existe en la
   plantilla de ningún otro cliente, así que el diagnóstico daba «no cubierto» para
   todo el mundo y el aviso se volvía ruido que se aprende a ignorar.

   Se reconoce por texto porque el encabezado del apartado sí es estable entre
   informes: «Análisis del Sector …» o «… del sector de …». La detección es
   deliberadamente laxa —basta con que la frase aparezca en cualquier parte— porque
   el coste de los dos errores no es simétrico: un falso «cubierto» calla un aviso
   informativo, mientras que un falso «no cubierto» acusa de incompleta a una
   plantilla que está bien, que es como se enseña a la gente a no leer el banner. */
const RX_SECTORIAL = /analisis del sector|del sector de /;

/** Qué quedó sin cubrir en el informe. Alimenta el aviso de ReporteGenerador: un
 *  banner que dice qué falta sirve; uno que solo dice «revise el documento» no. */
export function diagnosticarCobertura(rawHtml, study, datosMacro, analisisSector) {
  const year = Number(study && study.anio) || 2025;

  const seriesFaltantes = [];
  const porAnio = [
    ['el crecimiento del PIB mundial', 'pib_mundial'],
    ['el crecimiento del PIB de Colombia', 'pib_colombia'],
    ['la inflación global', 'inflacion_global'],
    ['la inflación de Colombia', 'inflacion_colombia'],
    ['la TRM promedio', 'trm_promedio'],
    ['la tasa de desempleo', 'desempleo_colombia'],
    ['la tasa de intervención del Banco de la República', 'tasa_intervencion'],
    ['las proyecciones de crecimiento por región', 'crecimiento_por_region'],
  ];
  porAnio.forEach(([concepto, clave]) => {
    const remota = datosMacro && datosMacro.series && datosMacro.series[clave];
    const serie = (remota && remota.valores) || DATOS_MACRO[clave];
    if (!serie || serie[year] === undefined) seriesFaltantes.push(concepto);
  });

  /* La tabla de razones de rechazo solo se puede armar si el motor dejó su embudo. Sin
     él, esa tabla sale con los números que traiga la plantilla, que es exactamente lo
     que no debe pasar en un documento que se radica: hay que avisarlo antes. */
  const razones = filasRazonesRechazo(study && study.embudoSeleccion);

  /* Lo mismo para las tablas de la muestra y de los márgenes: sin comparables en el
     estudio se quedan con las compañías que trajera la plantilla, con nombre y margen.
     Es la fuga más visible que puede tener el documento, así que se avisa aparte. */
  const comparables = filasComparablesInforme(study);

  return {
    year,
    sectorialCubierto: RX_SECTORIAL.test(textoPlano(rawHtml)),
    seriesFaltantes,
    narrativaCubierta: !!(datosMacro && datosMacro.narrativa && datosMacro.narrativa.mundial && datosMacro.narrativa.colombia),
    /* Distinto de sectorialCubierto: ese solo dice si la plantilla trae el apartado
       III.C; esto dice si YA se generó (o se reutilizó) el análisis de esa actividad
       para este año — sin eso, el apartado sale con el respaldo genérico y marcador. */
    sectorNarrativaCubierta: !!(analisisSector && analisisSector.porAnio && analisisSector.porAnio[String(year)]),
    razonesRechazoCubiertas: !razones.sinDatos,
    /* Los conteos no suman el universo evaluado: algo cambió en el estudio después de
       ejecutar la selección y la tabla quedaría inconsistente. */
    razonesRechazoDescuadradas: !razones.sinDatos && !razones.cuadra,
    comparablesCubiertas: comparables.length > 0,
    /* Comparables de la muestra sin estados financieros cargados: salen con hueco en la
       tabla de márgenes y no entran al rango. */
    comparablesSinCifras: comparables.filter((f) => f.ajustado === null).length,
  };
}

/* ══════════════ Criterios de búsqueda (Tablas 13 a 15) ══════════════

   Los criterios con los que se cribó el universo salen de la hoja «Screen Criteria» del
   export de Capital IQ y `parsearCriteriosScreening` los deja en `study.criteriosScreening`
   —ver el comentario de esa función en `comparablesEngine.js`, que ya anticipaba esta
   tabla y la dejó «a la espera de que la ruta por campos con nombre lo publique»—. Hasta
   ahora nadie los publicaba: el informe se radicaba con los criterios de la corrida del año
   anterior, incluidos el rango de códigos SIC y la ventana de cierre fiscal.

   La plantilla arma la tabla alternando una fila de dos celdas por criterio (etiqueta y
   valor) con una fila de una sola celda que lleva el conector. El primer criterio no lleva
   conector delante, igual que en la hoja de origen. */

/**
 * Filas de la tabla de criterios de búsqueda, con su conector intercalado.
 *
 * Devuelve `[]` cuando el estudio no trae criterios: la tabla conserva entonces lo que
 * traía la plantilla y el motor lo avisa. Blanquearla sería peor —quien revisa no sabría
 * que el cribado de este año no dejó criterios— y es el mismo contrato que siguen las
 * demás tablas del motor.
 *
 * El texto se traduce aquí, en el render, y no al importar el Excel: la hoja «Screen
 * Criteria» de Capital IQ viene en inglés, y traducir en este punto hace que los estudios
 * ya guardados —que tienen el inglés almacenado en Firestore— salgan en español sin
 * reimportar nada. `traducirCriterio` es puro e idempotente, así que un criterio que ya
 * esté en español pasa sin cambio (ver `criteriosScreeningEs.js`).
 *
 * @param {object} study
 * @returns {string[][]}
 */
export function filasCriteriosScreening(study) {
  const criterios = (study && study.criteriosScreening) || [];
  const filas = [];
  criterios.forEach((c, i) => {
    if (!c) return;
    /* `parsearCriteriosScreening` solo deja null en el primero. Si un estudio guardado trae
       el conector vacío en medio, la fila que une los dos criterios no puede faltar: se cae
       a «Y», que es la combinación por defecto de la hoja de origen. */
    if (i > 0) filas.push([c.conector || 'Y']);
    const es = traducirCriterio(c);
    filas.push([es.etiqueta, es.valor]);
  });
  return filas;
}
