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

  const filas = [];
  RAZONES_RECHAZO.forEach(([clave, etiqueta]) => {
    /* La reserva se suma ANTES de descartar los ceros. Un estudio que no rechazó a
       nadie por rigor funcional pero dejó reserva necesita igual esta fila: omitirla
       dejaría la columna sin sumar el universo. */
    const cuantas = (Number(porMotivo[clave]) || 0) + (clave === 'rigorFuncional' ? reserva : 0);
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
