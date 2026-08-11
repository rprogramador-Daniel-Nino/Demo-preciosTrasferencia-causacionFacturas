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
import { DATOS_MACRO } from './analisisMercado.js';
import { cuartilInterpolado } from './ajusteRangoCapitalTrabajo.js';
import { num, pliOf } from '../utils/calculations.js';

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

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

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

  const filas = [];
  RAZONES_RECHAZO.forEach(([clave, etiqueta]) => {
    /* La reserva se suma ANTES de descartar los ceros. Un estudio que no rechazó a
       nadie por rigor funcional pero dejó reserva necesita igual esta fila: omitirla
       dejaría la columna sin sumar el universo. */
    const cuantas = (Number(porMotivo[clave]) || 0)
      + (clave === 'rigorFuncional' ? reserva + sinEeff : 0);
    if (cuantas > 0) filas.push({ clave, etiqueta, cuantas });
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
 * Los percentiles ajustados salen de `stats`, que es lo que sostiene la conclusión de
 * cumplimiento; los no ajustados se calculan aquí sobre la serie sin ajuste, con el mismo
 * `cuartilInterpolado` (QUARTILE.INC) que usa el motor y que emite el Excel de soporte.
 *
 * @param {object} study
 * @returns {{filas:Array<{etiqueta:string, noAjustado:number|null, ajustado:number|null}>,
 *            tPLI:number|null, pli:string}}
 */
export function filasRangoIntercuartil(study) {
  const estudio = study || {};
  const r = analizarRango(estudio);
  const stats = r.stats || {};
  const compFilas = r.filas || [];

  const serie = (clave) => compFilas
    .map((f) => f[clave])
    .filter((v) => v !== null && v !== undefined)
    .sort((a, b) => a - b);

  const sinAjuste = serie('noAjustado');
  const conAjuste = serie('ajustado');
  const extremo = (s, i) => (s.length ? s[i < 0 ? s.length + i : i] : null);

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
      { etiqueta: ETIQUETAS_RANGO.min, noAjustado: extremo(sinAjuste, 0), ajustado: extremo(conAjuste, 0) },
      {
        etiqueta: ETIQUETAS_RANGO.p25,
        noAjustado: cuartilInterpolado(sinAjuste, 0.25),
        ajustado: stats.p25 !== undefined ? stats.p25 : null,
      },
      {
        etiqueta: ETIQUETAS_RANGO.med,
        noAjustado: cuartilInterpolado(sinAjuste, 0.5),
        ajustado: stats.med !== undefined ? stats.med : null,
      },
      {
        etiqueta: ETIQUETAS_RANGO.p75,
        noAjustado: cuartilInterpolado(sinAjuste, 0.75),
        ajustado: stats.p75 !== undefined ? stats.p75 : null,
      },
      { etiqueta: ETIQUETAS_RANGO.max, noAjustado: extremo(sinAjuste, -1), ajustado: extremo(conAjuste, -1) },
      /* El contribuyente cierra la tabla y lleva su indicador en las dos columnas: se
         ajusta contra sí mismo, así que el ajuste es cero. */
      { etiqueta: nombreContribuyente, noAjustado: tPLI, ajustado: tPLI },
    ],
  };
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
