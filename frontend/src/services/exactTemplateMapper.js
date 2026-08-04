import { fmt, pctf, num, getUvtValue } from '../utils/calculations.js';
import { analizarRango } from './rangoIntercuartil.js';
import { resaltarValor } from './estiloDocumento.js';
import {
  DATOS_MACRO,
  generarTablaPibMundial,
  generarTablaPibColombia,
  generarTablaInflacionGlobal,
  generarTablaCrecimientoPorRegion,
  generarTablaInflacionColombia,
  generarTablaTasaIntervencion,
  generarTablaTRM,
  generarTablaDesempleo,
  generarApartadoSectorial,
  generarApartadoMundial,
  generarApartadoColombia,
  tituloSectorial,
} from './analisisMercado.js';

/* ─── Sección III del informe: tablas macro ───
   Cada entrada empareja el título literal que trae la plantilla con el generador
   que la reconstruye para el año gravable. La regex captura el título más su
   <table> completa. Antes solo estaban cubiertas las dos de PIB, así que las seis
   restantes viajaban de End Game a cualquier informe con sus valores originales. */
const TABLAS_MACRO = [
  { rx: /<p>\s*<strong>Crecimiento del PIB Mundial \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaPibMundial },
  { rx: /<p>\s*<strong>Crecimiento del PIB en Colombia \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaPibColombia },
  { rx: /<p>\s*<strong>Tasas de Inflación Global \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaInflacionGlobal },
  { rx: /<p>\s*<strong>Proyecciones de Crecimiento del PIB por Región\/País \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaCrecimientoPorRegion },
  { rx: /<p>\s*<strong>Inflación en Colombia \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaInflacionColombia },
  { rx: /<p>\s*<strong>Tasa de Intervención del Banco de la República \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaTasaIntervencion },
  { rx: /<p>\s*<strong>Tasa Representativa del Mercado \(TRM\) Promedio \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaTRM },
  { rx: /<p>\s*<strong>Tasa de Desempleo en Colombia \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaDesempleo },
];

/* Anclas de Word que delimitan el apartado sectorial (III.C) y la sección
   siguiente (IV. ANÁLISIS ECONÓMICO). Son estables y únicas: cada una aparece dos
   veces en el documento, una en el índice como href y otra en el cuerpo como id.
   Delimitar por ancla y no por texto literal es lo que hace que el reemplazo
   sobreviva a que cambie la redacción del apartado. */
const ANCLA_SECTORIAL = '_Toc208930979';
const ANCLA_SIGUIENTE = '_Toc208930980';
/* III.A y III.B: mismo documento de Word, anclas ya presentes en la plantilla
   (confirmadas en el índice de masterTemplate.js). El orden es
   Mundial(977) -> Colombia(978) -> Sectorial(979) -> IV(980). */
const ANCLA_MUNDIAL = '_Toc208930977';
const ANCLA_COLOMBIA = '_Toc208930978';

/* Marcadores para sustituir III.A/III.B en dos fases: primero se reserva el
   lugar (antes de apartarEnlaces, por la misma razón que el resto de anclas),
   y la narrativa real se inserta al final, después de ANIOS_DEL_ESTUDIO y de
   los reemplazos literales — si se insertara antes, esas reglas reescribirían
   años y textos dentro de la prosa de Claude. Mismo patrón que MARCA_ENLACE. */
const MARCA_APARTADO_MUNDIAL = '@@PT_APARTADO_MUNDIAL@@';
const MARCA_APARTADO_COLOMBIA = '@@PT_APARTADO_COLOMBIA@@';

/* Años del estudio: los contextos donde «2024» significa el año gravable y no un
   dato histórico. Es una lista blanca deliberada. La regla anterior —reemplazar
   toda aparición de 2024— falseaba las series macro («en 2024 la inflación
   descendió a 5,9 %» pasaba a decir el año del estudio) y corrompía las URLs de
   las fuentes citadas.

   Un año del estudio que quede fuera de esta lista se ve y se corrige en el
   editor; un dato macro atribuido al año equivocado no lo nota nadie.

   Se usan lookbehind y lookahead en vez de grupos de captura: así el reemplazo es
   el año a secas y no hay que reconstruir prefijos, que es donde un patrón sin su
   grupo dejaría un «$2» literal en el informe. */
const ANIOS_DEL_ESTUDIO = [
  /(?<=PERÍODO FISCAL AL 31 DE DICIEMBRE DE )2024/g,
  /(?<=estudio de precios de transferencia para el año )2024/gi,
  /(?<=efectuadas para el año )2024/gi,
  /(?<=En el año )2024(?=,)/g,
  /(?<=durante el periodo fiscal )2024/gi,
  /(?<=para el año fiscal )2024/gi,
  /(?<=comparables seleccionadas en el año )2024/gi,
  /(?<=durante el año gravable )2024/gi,
  /(?<=al? 31 de diciembre de )2024/gi,
  /(?<=Último estado financiero entre junio de )2024/gi,
  /* Frase que introduce la tabla 17: «los estados financieros correspondientes al año
     2024». Es el año de las cifras que ahora se regeneran con las comparables del
     estudio, así que dejarlo en el del informe de referencia fecharía mal la tabla. */
  /(?<=estados financieros correspondientes al año )2024/gi,
  /(?<=A\.V\. )2024/g,
  // Encabezado de año de las tablas de estados financieros (Anexo A)
  /(?<=<strong>Descripción<\/strong>\s*<\/p>\s*<\/th>\s*<th>\s*<p>\s*<strong>)2024(?=<\/strong>)/g,
  /* La misma columna en la tabla de análisis vertical trae el año con punto de
     miles. Sin esta regla, «A.V. 2024» cambiaba y «2.024» se quedaba, dejando
     dos años distintos en una misma cabecera. */
  /(?<=<strong>\s{2,})2\.024(?=<\/strong>)/g,
];

/* ─── Guarda de enlaces ───
   Se aparta la ETIQUETA DE APERTURA de cada <a>, con sus atributos, y no el enlace
   completo. La diferencia es deliberada: el índice del informe lleva la razón
   social dentro del texto visible del enlace («I. INFORMACIÓN GENERAL END GAME
   INTERACTIVE COLOMBIA S.A.S»), así que apartar el <a> entero dejaría el nombre de
   End Game en el índice de todos los informes. Lo que hay que proteger es el href,
   donde viven las URLs de las fuentes citadas. */
/* Marcador en ASCII imprimible a propósito. Un carácter de control quedaría como
   byte crudo en el fuente y las herramientas tratarían este archivo como binario. */
const MARCA_ENLACE = '@@PT_ENLACE_';

function apartarEnlaces(html, deposito) {
  /* Si el documento ya trajera el marcador, apartar corrompería el texto al
     reponer. No debería pasar nunca en un informe, pero salir sin tocar nada es
     más barato que el fallo que evita. */
  if (html.includes(MARCA_ENLACE)) return html;

  return html.replace(/<a\b[^>]*>/gi, (etiqueta) => {
    deposito.push(etiqueta);
    return MARCA_ENLACE + (deposito.length - 1) + '@@';
  });
}

function reponerEnlaces(html, deposito) {
  return html.replace(/@@PT_ENLACE_(\d+)@@/g, (marca, i) => {
    const original = deposito[Number(i)];
    return original === undefined ? marca : original;
  });
}

/** Sustituye el cuerpo de III.A o III.B entre su ancla y la del apartado
 *  siguiente, conservando el título original (a diferencia del sectorial, este
 *  título no depende del cliente) y descartando el resto del cuerpo original
 *  (las tablas de End Game incluidas). En el lugar de la narrativa deja
 *  `marcador`, no el contenido final — ver MARCA_APARTADO_MUNDIAL/COLOMBIA
 *  arriba. Ya no se preservan las tablas del cuerpo original: desde que
 *  generarApartadoMundial/Colombia incrustan sus propias tablas —junto al
 *  párrafo del tema que comentan, no todas al final— conservar las de End
 *  Game solo produciría duplicados. Si el HTML no trae la ancla —una
 *  plantilla que el usuario subió— no toca nada. */
function reemplazarCuerpoApartado(html, anclaInicio, anclaFin, marcador) {
  const rx = new RegExp(
    '(<a id="' + anclaInicio + '"></a><strong>[\\s\\S]*?</strong>\\s*</li>\\s*</ol>)' +
    '[\\s\\S]*?(?=<ol>\\s*<li>\\s*<a id="' + anclaFin + '">)'
  );
  return html.replace(rx, (completo, tituloCompleto) => tituloCompleto + '\n' + marcador);
}

/** Sustituye el apartado sectorial (III.C) y su título, en el cuerpo y en el
 *  índice. Si el HTML no trae las anclas —una plantilla que el usuario subió— no
 *  toca nada: devuelve el mismo HTML y diagnosticarCobertura lo reporta. */
function reemplazarApartadoSectorial(html, study, year, wrap, analisisSector) {
  const titulo = tituloSectorial(study, analisisSector, year);

  /* Cuerpo: conserva el <a id> y la estructura <ol><li> —si se borra el ancla, el
     hipervínculo del índice queda roto— y cambia el título y todo el contenido que
     sigue, hasta el <ol><li> que abre la sección IV. */
  const rxCuerpo = new RegExp(
    '(<a id="' + ANCLA_SECTORIAL + '"></a><strong>)[\\s\\S]*?(</strong>\\s*</li>\\s*</ol>)' +
    '[\\s\\S]*?(?=<ol>\\s*<li>\\s*<a id="' + ANCLA_SIGUIENTE + '">)'
  );
  html = html.replace(rxCuerpo, (completo, abre, cierra) =>
    abre + titulo + cierra + '\n' + generarApartadoSectorial(study, year, wrap, analisisSector)
  );

  // Índice: solo el texto del enlace, conservando el número de página.
  const rxIndice = new RegExp(
    '(<a href="#' + ANCLA_SECTORIAL + '">C\\.\\t)[^\\t<]*(\\t\\d+</a>)'
  );
  html = html.replace(rxIndice, (completo, abre, cierra) => abre + titulo + cierra);

  return html;
}

/** Qué quedó sin cubrir al hidratar. Alimenta el aviso de ReporteGenerador: un
 *  banner que dice qué falta sirve; uno que solo dice «revise el documento» no. */
export function diagnosticarCobertura(rawHtml, study, datosMacro, analisisSector) {
  const year = Number(study && study.anio) || 2025;
  const html = String(rawHtml || '');

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
     él, esa tabla sale con los números del informe de referencia, que es exactamente lo
     que no debe pasar en un documento que se radica: hay que avisarlo antes. */
  const razones = filasRazonesRechazo(study && study.embudoSeleccion);

  /* Lo mismo para las tablas 17 y 19: sin comparables en el estudio se quedan con las
     trece compañías de videojuegos del informe de referencia, con nombre y margen. Es
     la fuga más visible que puede tener el documento, así que se avisa aparte. */
  const comparables = filasComparablesInforme(study);

  return {
    year,
    sectorialCubierto: html.includes('id="' + ANCLA_SECTORIAL + '"'),
    seriesFaltantes,
    narrativaCubierta: !!(datosMacro && datosMacro.narrativa && datosMacro.narrativa.mundial && datosMacro.narrativa.colombia),
    /* Distinto de sectorialCubierto: ese solo dice si la plantilla trae el ancla de
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

/* ══════════════ Tabla 14. Razones de rechazo ══════════════
   La plantilla trae los números del informe de referencia —442 candidatas, 327 por
   diferencias funcionales, 13 aceptadas— y hay que sustituirlos por los del estudio.
   El insumo es `study.embudoSeleccion`, que guarda el motor al ejecutar la selección.

   Cada fila es un criterio del motor. Se omiten las que no descartaron a nadie: un
   informe que declara «Pérdidas operativas: 0» cuando el criterio se puso en «incluir»
   confunde a quien lo revisa. Las letras se asignan sobre las filas que quedan, para
   conservar el formato de la columna «FILTROS APLICADO» del documento original. */

const RAZONES_RECHAZO = [
  ['rigorFuncional', 'Diferencias funcionales: perfil no comparable con la parte examinada'],
  ['actividadDistinta', 'Actividad económica distinta a la de la parte examinada'],
  ['sinDescripcion', 'Sin descripción del negocio que permita verificar la actividad'],
  ['holding', 'Compañías holding o sin actividad operativa propia'],
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

/**
 * Cuerpo de la tabla 14 con los datos del estudio. Sin selección ejecutada devuelve
 * null y quien llama deja la tabla como estaba: es preferible que el usuario vea que
 * falta ejecutar el motor a que el informe salga con cifras inventadas —o peor, con las
 * del cliente anterior, que es el error que este documento no puede cometer.
 */
export function generarTablaRazonesRechazo(study, wrap) {
  const { filas, total, sinDatos } = filasRazonesRechazo(study && study.embudoSeleccion);
  if (sinDatos) return null;

  const celda = (contenido, negrita) => `<td>\n<p>\n${negrita ? `<strong>${contenido}</strong>` : contenido}\n</p>\n</td>`;

  const cuerpo = filas.map(f =>
    `<tr>\n${celda(f.etiqueta)}\n${celda(f.letra)}\n${celda(wrap(fmt(f.cuantas)))}\n</tr>`
  ).join('\n');

  return `<tbody>\n${cuerpo}\n<tr>\n<td colspan="2">\n<p>\n<strong>TOTAL, UNIVERSO</strong>\n</p>\n</td>\n` +
    `${celda(wrap(fmt(total)), true)}\n</tr>\n</tbody>`;
}

/**
 * Sustituye el cuerpo de la tabla de razones de rechazo dentro del HTML del informe.
 *
 * Se localiza por el texto del encabezado y no con una sola expresión regular sobre
 * todo el documento: el informe trae más de veinte tablas con el mismo marcado, y una
 * regex de `<tbody>` acabaría reemplazando la primera que encontrara.
 */
export function reemplazarTablaRazonesRechazo(html, study, wrap) {
  const cuerpoNuevo = generarTablaRazonesRechazo(study, wrap);
  if (!cuerpoNuevo) return html;

  const ancla = html.search(/FILTRO\s+APLICADO\s+INTERNACIONALES/i);
  if (ancla < 0) return html;

  const inicio = html.indexOf('<tbody>', ancla);
  if (inicio < 0) return html;
  const fin = html.indexOf('</tbody>', inicio);
  if (fin < 0) return html;

  return html.slice(0, inicio) + cuerpoNuevo + html.slice(fin + '</tbody>'.length);
}

/* ══════════════ Tablas 15 y 17. Muestra y márgenes de las comparables ══════════════
   La plantilla trae las trece compañías de videojuegos del informe de referencia con
   sus nombres y sus márgenes, y ninguna regla las tocaba: era el bloque que más
   delataba que el documento se armó sobre el estudio de otro contribuyente.

   Las dos salen de `analizarRango`, que es de donde sale también el rango intercuartil.
   Repetir aquí la fórmula del ajuste habría permitido que el informe publicara unos
   márgenes que no sustentan el rango que declara unas páginas más adelante. */

const AMBITO = { Int: 'INTERNACIONAL', Nac: 'NACIONAL' };

/* Las comparables que se pueden nombrar en el informe. Se descartan las filas sin
   razón social —la tabla del motor arranca con filas en blanco que el usuario va
   llenando— porque una fila numerada y sin nombre en la muestra final no dice nada. */
export function filasComparablesInforme(study) {
  const { filas } = analizarRango(study || {});
  return (filas || []).filter((f) => f.nombre);
}

const celdaTabla = (contenido) => `<td>\n<p>\n${contenido}\n</p>\n</td>`;

/**
 * Filas de la tabla 15 (Muestra Compañías comparables): número, razón social y ámbito.
 * Sin comparables devuelve null y quien llama deja la tabla como estaba.
 */
export function generarFilasMuestraComparables(study, wrap) {
  const filas = filasComparablesInforme(study);
  if (!filas.length) return null;

  return filas.map((f, i) =>
    `<tr>\n${celdaTabla(i + 1)}\n${celdaTabla(wrap(f.nombre))}\n${celdaTabla(wrap(AMBITO[f.amb]))}\n</tr>`
  ).join('\n');
}

/**
 * Sustituye las filas de datos de la tabla 15, conservando su encabezado.
 *
 * El encabezado no se reconstruye a propósito: su primera celda lleva las anclas de
 * Word («RANGE!E11», «_Hlk143111901») a las que apuntan referencias del documento, y
 * regenerarlas las dejaría rotas.
 */
export function reemplazarTablaMuestraComparables(html, study, wrap) {
  const cuerpo = generarFilasMuestraComparables(study, wrap);
  if (!cuerpo) return html;

  const ancla = html.indexOf('Tabla 15. Muestra Compañías comparables');
  if (ancla < 0) return html;
  const tabla = html.indexOf('<table>', ancla);
  if (tabla < 0) return html;
  const finEncabezado = html.indexOf('</tr>', tabla);
  if (finEncabezado < 0) return html;
  const fin = html.indexOf('</table>', finEncabezado);
  if (fin < 0) return html;

  return html.slice(0, finEncabezado + '</tr>'.length) + '\n' + cuerpo + '\n' + html.slice(fin);
}

/**
 * Cuerpo de la tabla 17 (Margen Operacional Compañías Comparables).
 *
 * Una comparable sin estados financieros cargados sale con hueco en los dos márgenes y
 * no se omite: es la muestra final del informe, y esconder a la que le falta el dato
 * dejaría una tabla más corta que la 15 sin que nada lo explique.
 */
export function generarTablaMargenComparables(study, wrap) {
  const filas = filasComparablesInforme(study);
  if (!filas.length) return null;

  const cuerpo = filas.map((f) =>
    `<tr>\n${celdaTabla(wrap(f.nombre))}\n${celdaTabla(wrap(pctf(f.noAjustado)))}\n` +
    `${celdaTabla(wrap(pctf(f.ajustado)))}\n</tr>`
  ).join('\n');

  return `<tbody>\n${cuerpo}\n</tbody>`;
}

/** Sustituye el cuerpo de la tabla 17, anclado en su título, que es único en el documento. */
export function reemplazarTablaMargenComparables(html, study, wrap) {
  const cuerpoNuevo = generarTablaMargenComparables(study, wrap);
  if (!cuerpoNuevo) return html;

  const ancla = html.indexOf('Tabla 17. Margen Operacional Compañías Comparables');
  if (ancla < 0) return html;
  const inicio = html.indexOf('<tbody>', ancla);
  if (inicio < 0) return html;
  const fin = html.indexOf('</tbody>', inicio);
  if (fin < 0) return html;

  return html.slice(0, inicio) + cuerpoNuevo + html.slice(fin + '</tbody>'.length);
}

/* Tabla 13 (Códigos SIC utilizados), a partir de `study.criteriosScreening` —lo que
   dejó frontend/src/services/comparablesEngine.js:parsearCriteriosScreening al leer
   la hoja "Screen Criteria" del export de Capital IQ en el Paso 1 del motor de
   comparables—. Antes esta tabla era texto fijo del informe de referencia (SIC 7371/
   7372, "games", 2025): una corrida real con otra actividad o otro año la dejaba
   describiendo una búsqueda que nunca se hizo. Sin criterios cargados (estudio nuevo,
   o Excel sin esa hoja) se deja el hueco pendiente en vez de ese texto ajeno. */
function generarTablaCriteriosScreeningHtml(study, wrap) {
  const criterios = (study && study.criteriosScreening) || [];
  if (!criterios.length) {
    return '<p>\nPendiente: importe el archivo de Capital IQ en el Paso 1 del motor de comparables para completar los criterios de búsqueda.\n</p>';
  }
  const filaConector = (conector) => `<tr>\n<td colspan="2">\n<p>\n<strong>${conector}</strong>\n</p>\n</td>\n</tr>\n`;
  const filaCriterio = (etiqueta, valor) =>
    `<tr>\n<td>\n<p>\n<strong>${wrap(etiqueta)}:</strong>\n</p>\n</td>\n<td>\n<p>\n${wrap(valor)}\n</p>\n</td>\n</tr>\n`;

  const filas = criterios
    .map((c) => (c.conector ? filaConector(c.conector) : '') + filaCriterio(c.etiqueta, c.valor))
    .join('');

  return (
    '<table>\n<tr>\n<td colspan="2">\n<p>\n<strong>Criterio de búsqueda</strong>\n</p>\n</td>\n</tr>\n' +
    filas +
    '</table>'
  );
}

/**
 * Genera el cuerpo dinámico del ANEXO A (Estados Financieros del Contribuyente),
 * pegando las imágenes del PDF ingestadas de la compañía.
 */
export function generarAnexoAHtml(study, year, wrap) {
  const entName = study.ent || 'LA COMPAÑÍA';
  const images = study.eeffImages || [];

  if (images && images.length > 0) {
    return `<p>
<a id="_Toc208931005"></a><strong>ANEXO A. Estados financieros ${wrap(entName)}</strong>
</p>
<p>
A continuación se adjuntan las páginas originales de los Estados Financieros de <strong>${wrap(entName)}</strong> correspondientes al período fiscal finalizado a 31 de diciembre de <strong>${wrap(year)}</strong>:
</p>
${images.map((imgUrl, i) => `
<p style="text-align:center;margin:16px 0;">
  <img src="${imgUrl}" alt="Página ${i + 1} EEFF ${entName}" style="max-width:100%;height:auto;border:1px solid #e2e8f0;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.1);" />
</p>`).join('\n')}
`;
  }

  // Si no hay imágenes ingestadas aún, conserva los marcadores de imagen originales de la plantilla
  return `<p>
<a id="_Toc208931005"></a><strong>ANEXO A. Estados financieros ${wrap(entName)}</strong>
</p>
<p>
<img src="IMAGE_PLACEHOLDER" />
</p>
<p>
<img src="IMAGE_PLACEHOLDER" /><img src="IMAGE_PLACEHOLDER" /><img src="IMAGE_PLACEHOLDER" /><img src="IMAGE_PLACEHOLDER" /><img src="IMAGE_PLACEHOLDER" /><img src="IMAGE_PLACEHOLDER" /><img src="IMAGE_PLACEHOLDER" /><img src="IMAGE_PLACEHOLDER" /><img src="IMAGE_PLACEHOLDER" /><img src="IMAGE_PLACEHOLDER" /><img src="IMAGE_PLACEHOLDER" /><img src="IMAGE_PLACEHOLDER" /><img src="IMAGE_PLACEHOLDER" /><img src="IMAGE_PLACEHOLDER" />
</p>`;
}

/**
 * Recibe el HTML completo del informe modelo End Game (con sus 27 secciones intactas)
 * y realiza el reemplazo quirúrgico de las variables del cliente activo.
 */
export function hydrateExactWordTemplate(rawHtml, study, datosMacro, analisisSector) {
  if (!rawHtml) return '';

  let html = rawHtml;

  /* Number() y no study.anio directo: el campo del formulario entrega una cadena
     (DatosContribuyente.jsx, onChange de «Año gravable»), y los generadores de
     tabla calculan year + 1 para la columna de proyección. Con la cadena '2025'
     eso daba '20251' en el encabezado. */
  const year = Number(study.anio) || 2025;
  const uvtRate = getUvtValue(year);

  // Valores dinámicos según el año gravable
  const uvt45k = 45000 * uvtRate;
  const uvt10k = 10000 * uvtRate;

  // El cálculo vive en su propio módulo: lo comparte la sustitución por campos.
  const { stats, adj, cumple: cumpleStr } = analizarRango(study);

  /* Helper para destacar visualmente las variables reemplazadas en el editor web. El
     estilo va por clase y lo pinta sólo el CSS del previo: en inline se colaba en el
     .doc, y cada valor sustituido salía más negrita y con aire a los lados en el
     documento que se radica. */
  const wrap = (val) => {
    if (!val && val !== 0) return '—';
    return resaltarValor(val);
  };

  /* Cifra formateada, o hueco visible si el estudio no la trae. Los valores por
     defecto que había aquí eran los literales de End Game: un estudio recién
     creado salía con el monto, el tipo de operación, la razón social, el NIT del
     vinculado y las cifras de balance del cliente anterior. El principio del
     spec es el contrario —antes un hueco evidente que el dato del año
     anterior—, porque este documento se radica ante la DIAN. */
  const cifra = (v) => wrap(v === null || v === undefined ? null : fmt(v));

  /* El monto sale de `monto`/`monto_operacion`, que es lo que escribe la ingesta
     de operaciones con vinculados, y no de `t_s`: ese es el total de ingresos del
     estado de resultados, otra cosa. Poner los ingresos donde va el monto de la
     operación daría una cifra plausible y equivocada, que es peor que el hueco.
     Sin ingesta de operaciones no hay monto, y sale hueco. */
  const montoOperacion = study.monto || study.monto_operacion || null;
  const formattedMonto = montoOperacion ? fmt(montoOperacion) : null;
  const formattedTipo = study.vinc_tipo || null;

  /* ─── Apartado sectorial (III.C) ───
     Va antes que todo lo demás porque se delimita con las anclas <a id="_Toc…">, y
     el paso siguiente aparta todos los <a> del documento. Sustituye el análisis
     del sector de videojuegos de End Game —título incluido, en el cuerpo y en el
     índice— por uno construido con la actividad real del contribuyente. */
  html = reemplazarApartadoSectorial(html, study, year, wrap, analisisSector);

  /* III.A y III.B: se reserva el lugar con un marcador (van antes de
     apartarEnlaces por la misma razón que el sectorial, se delimitan con las
     anclas <a id="_Toc…">) y se conservan las tablas macro que traiga cada
     cuerpo. La narrativa real se inserta al final de esta función — ver el
     comentario junto a MARCA_APARTADO_MUNDIAL. */
  html = reemplazarCuerpoApartado(html, ANCLA_MUNDIAL, ANCLA_COLOMBIA, MARCA_APARTADO_MUNDIAL);
  html = reemplazarCuerpoApartado(html, ANCLA_COLOMBIA, ANCLA_SECTORIAL, MARCA_APARTADO_COLOMBIA);

  /* ─── Guarda de enlaces ───
     Varias fuentes citadas en la sección III llevan el año en la URL
     (caracol.com.co/2024/…, forbes.co/2024/…). Una regla que sustituya ese año no
     solo lo cambia: inyecta el <span> de resaltado dentro del atributo href y deja
     el enlace muerto. Se aparta cada <a> completo y se repone al final, de modo
     que ninguna regla —ni las de hoy ni las que se agreguen— pueda tocarlos. */
  const enlaces = [];
  html = apartarEnlaces(html, enlaces);

  /* Fila del accionista principal (Tabla 6. Composición Accionaria): en la
     plantilla real, esta fila comparte texto literal con el vinculado
     ("END GAME INTERACTIVE INC"/"ESTADOS UNIDOS" — misma empresa, mismo país
     en el estudio original). Debe sustituirse ANTES y de forma acotada a esta
     fila exacta: si corriera después del reemplazo genérico del vinculado
     (global, sin acotar), ya no quedaría texto literal que sustituir aquí y
     la fila de accionistas se congelaría con los datos de End Game. */
  /* Corre aunque el estudio no traiga accionistas: sin esto las 200.000 acciones
     y los 200.000.000 de capital de End Game se quedaban en la tabla de
     composición accionaria del informe nuevo. El patrón está anclado a esa fila
     exacta, así que poner huecos aquí no puede tocar otras cifras. */
  {
    const mainAcc = (study.accionistas && study.accionistas[0]) || {};
    const rxFilaAccionista = /<tr>\n<td>\n<p>\nEND GAME INTERACTIVE INC\.\n<\/p>\n<\/td>\n<td>\n<p>\nESTADOS UNIDOS\n<\/p>\n<\/td>\n<td>\n<p>\n200\.000\n<\/p>\n<\/td>\n<td>\n<p>\n200\.000\.000\n<\/p>\n<\/td>\n<td>\n<p>\n100%\n<\/p>\n<\/td>\n<\/tr>/;
    html = html.replace(rxFilaAccionista, (fila) => {
      let out = fila;
      out = out.replace(/END GAME INTERACTIVE INC\./, wrap(mainAcc.nombre));
      out = out.replace(/ESTADOS UNIDOS/, wrap(mainAcc.pais));
      out = out.replace(/200\.000\n/, cifra(mainAcc.acciones ? num(mainAcc.acciones) : null) + '\n');
      out = out.replace(/200\.000\.000/, cifra(mainAcc.valor_capital ? num(mainAcc.valor_capital) : null));
      return out;
    });
  }

  // Reemplazos de las variables del cliente
  const replacements = [
    /* Una sola regla para todas las formas en que el informe de referencia
       escribe la razón social del contribuyente. La regla anterior exigía la
       forma larga completa ("END GAME INTERACTIVE COLOMBIA" + S.A.S/SAS/SA), así
       que "END GAME" a secas, "END GAME INTERACTIVE" suelto y "End Game Colombia
       SAS" pasaban intactos al informe nuevo. Ahora "INTERACTIVE", "COLOMBIA" y
       el sufijo societario son opcionales.

       Los dos anclajes del final no son cosméticos:
       - `(?!\w)` evita que "SA" muerda el arranque de la palabra que siga.
       - `(?!\s+INTERACTIVE\s+INC)` justo después de "END GAME" es lo que impide
         que esta regla se coma el prefijo de "END GAME INTERACTIVE INC", que es
         el VINCULADO y lo sustituye la regla siguiente. Va como lookahead
         inmediato y no al final de la expresión a propósito: puesto al final, el
         motor haría backtracking y acabaría casando solo "END GAME", dejando
         " INTERACTIVE INC" colgando y sin sustituir. */
    { target: /END\s+GAME(?!\s+INTERACTIVE\s+INC)(?:\s+INTERACTIVE)?(?:\s+COLOMBIA)?(?:\s+S\.?A\.?S?\.?)?(?!\w)/gi, val: wrap(study.ent) },
    { target: /END GAME INTERACTIVE INC/gi, val: wrap(study.vinc) },
    { target: /ESTADOS UNIDOS/gi, val: wrap(study.pais_vinc) },
    { target: /604477955/g, val: wrap(study.vinc_id) },
    { target: /Otros servicios \(\s*07\s*\)/gi, val: wrap(formattedTipo) },
    { target: /3\.435\.357\.400/g, val: wrap(formattedMonto) },
    
    // Reemplazo dinámico de los topes UVT calculados según el año fiscal
    { target: /2\.117\.925\.000/g, val: wrap(fmt(uvt45k)) },
    { target: /470\.650\.000/g, val: wrap(fmt(uvt10k)) },

    /* Cifras que no tenían regla y por eso viajaban de End Game a cualquier
       informe generado con esta plantilla. Los delimitadores (?<![\d.]) y
       (?![\d.]) son obligatorios: sin ellos, "1.247.447.456" se reemplazaría
       por su cola "247.447.456" y quedaría un número corrupto.
       El NIT se captura con su dígito de verificación para no dejarlo colgando. */
    { target: /(?<![\d.])901\.337\.576-\d(?![\d])/g, val: wrap(study.nit || '—') },
    { target: /(?<![\d.])1\.247\.447\.456(?![\d.])/g, val: wrap(study.t_inv_assoc ? fmt(num(study.t_inv_assoc)) : '—') },
    { target: /(?<![\d.])4\.703\.375(?![\d.])/g, val: wrap(study.t_intang ? fmt(num(study.t_intang)) : '—') },
    { target: /(?<![\d.])83\.801\.656(?![\d.])/g, val: wrap(study.t_dif ? fmt(num(study.t_dif)) : '—') },
    { target: /(?<![\d.])206\.129\.230(?![\d.])/g, val: wrap(study.t_act_nocurr ? fmt(num(study.t_act_nocurr)) : '—') },

    /* Solo queda el error de tecleo del propio informe de referencia («ENG GAME…»
       en vez de «END GAME…»), que la regla de arriba no reconoce porque no
       empieza por «END». Las variantes «END GAME INTERACTIVE» sin sufijo y
       «END GAME» a secas que este barrido cubría antes ya las captura la regla
       de arriba (todos sus grupos —INTERACTIVE, COLOMBIA, sufijo— son opcionales).
       Un barrido adicional para esas dos formas duplicaba la razón social cuando
       el cliente real es el mismo End Game de un año anterior: el texto recién
       insertado (p. ej. «END GAME INTERACTIVE COLOMBIA SOCIEDAD POR ACCIONES
       SIMPLIFICADA») vuelve a empezar por «END GAME [INTERACTIVE]», y ese barrido
       lo volvía a capturar y a reemplazar sobre sí mismo. */
    { target: /ENG GAME INTERACTIVE COLOMBIA SAS/gi, val: wrap(study.ent || 'ENG GAME INTERACTIVE COLOMBIA SAS') }
  ];

  // Aplicar reemplazos iniciales
  replacements.forEach(({ target, val }) => {
    html = html.replace(target, val);
  });

  /* Año gravable, solo en los contextos donde «2024» es el año del estudio.
     Ver ANIOS_DEL_ESTUDIO: la regla global que había aquí antes reasignaba de año
     todas las series macro de la sección III. */
  ANIOS_DEL_ESTUDIO.forEach((rx) => {
    html = html.replace(rx, wrap(year));
  });

  /* Tasa Prime Rate y año gravable en el Anexo D (ajustes de capital). Sin tasa
     ingresada queda hueco: la tasa por defecto que había aquí era la del informe
     de referencia, y un ajuste de plena competencia calculado con la tasa de otro
     año es una cifra que se radica y no se sostiene. */
  const primeVal = study.prime
    ? (String(study.prime).includes('%') ? String(study.prime) : `${study.prime}%`)
    : null;
  html = html.replace(
    /Esta tasa durante el año \d{4} fue de [\d\.\,]+%\s*EA\./gi,
    () => `Esta tasa durante el año ${wrap(year)} fue de ${wrap(primeVal ? primeVal + ' EA.' : null)}`
  );

  /* Tabla de EEFF (Activos / Balance General). Corre siempre, no solo cuando el
     año es 2025 o se ingirieron cifras: con los valores por defecto puestos en
     hueco ya no hay nada que perder por entrar aquí, y con la condición anterior
     un estudio de otro año sin cifras dejaba las seis cifras de End Game
     intactas en el documento.

     Los totales solo se calculan si están todos sus sumandos: sumar un hueco
     como si fuera cero produce un total plausible y falso, que es peor que un
     hueco. */
  {
    const eeffActual = {
      efectivo: study.t_cash ? num(study.t_cash) : null,
      cxc: study.t_ar ? num(study.t_ar) : null,
      impuestos: study.t_tax ? num(study.t_tax) : null,
      ppe: study.t_ppe ? num(study.t_ppe) : null
    };

    const sumandosCorriente = [eeffActual.efectivo, eeffActual.cxc, eeffActual.impuestos];
    const totalActivoCorriente = study.t_act_curr
      ? num(study.t_act_curr)
      : (sumandosCorriente.every((v) => v !== null) ? sumandosCorriente.reduce((a, b) => a + b, 0) : null);
    const totalActivos = study.t_act_tot
      ? num(study.t_act_tot)
      : (totalActivoCorriente !== null && eeffActual.ppe !== null ? totalActivoCorriente + eeffActual.ppe : null);

    html = html.replace(/87\.957\.645/g, cifra(eeffActual.efectivo));
    html = html.replace(/179\.720\.372/g, cifra(eeffActual.cxc));
    html = html.replace(/268\.433\.497/g, cifra(eeffActual.impuestos));
    html = html.replace(/1\.783\.558\.970/g, cifra(totalActivoCorriente));
    html = html.replace(/117\.624\.200/g, cifra(eeffActual.ppe));
    html = html.replace(/1\.989\.688\.200/g, cifra(totalActivos));
  }

  /* ─── ANEXO A: Reemplazo de los anexos estáticos de End Game por los EEFF ingestados ─── */
  const rxAnexoABody = /<p>\s*<a id="_Toc208931005"><\/a>ANEXO A\. Estados financieros[\s\S]*?(?=<h1[^>]*>\s*<a id="_Toc208931006"><\/a>|<p>\s*<a id="_Toc208931006"><\/a>|<h1>\s*<a id="_Toc208931006"><\/a>ANEXO B)/i;
  html = html.replace(rxAnexoABody, () => generarAnexoAHtml(study, year, wrap));

  /* ─── Tabla 14 y las cifras que la rodean ───
     La tabla se arma con el embudo del motor. Y con ella hay que mover el texto que la
     acompaña: el informe dice «se identificó un total de 442 Compañías potenciales» y
     «quedaron 13 compañías comparables», cifras de End Game. Dejar la tabla al día y el
     párrafo con los números del cliente anterior deja un documento que se contradice
     dentro de la misma página. */
  html = reemplazarTablaRazonesRechazo(html, study, wrap);
  const embudo = study.embudoSeleccion || null;
  if (embudo && embudo.evaluadas) {
    html = html.replace(
      /total de\s*(?:<[^>]+>)*\s*442\s*(?:<\/[^>]+>)*\s*Compañías comparables potenciales/i,
      `total de ${wrap(fmt(embudo.evaluadas))} Compañías comparables potenciales`
    );
    const finales = Number(embudo.seleccionadas) || 0;
    if (finales) {
      html = html.replace(
        /quedaron\s*<strong>\s*13\s*<\/strong>\s*compañías comparables/i,
        `quedaron <strong>${wrap(fmt(finales))}</strong> compañías comparables`
      );
      html = html.replace(
        /(qued[óo] conformada por\s*)<strong>\s*13\s*<\/strong>(\s*compañías)/i,
        (todo, antes, despues) => antes + '<strong>' + wrap(fmt(finales)) + '</strong>' + despues
      );
    }
  }

  /* ─── Tablas 17 y 19: la muestra final y sus márgenes ───
     Van después de la 16 porque cierran el mismo bloque: la 16 dice cuántas quedaron y
     estas dicen cuáles son y cuánto ganan. Con la 16 al día y estas dos con las
     compañías de videojuegos del informe de referencia, el documento declaraba una
     muestra de un tamaño y listaba otra, del sector equivocado. */
  html = reemplazarTablaMuestraComparables(html, study, wrap);
  html = reemplazarTablaMargenComparables(html, study, wrap);

  // Reemplazar Rango Intercuartil si se calculó
  if (stats) {
    html = html.replace(/Percentil 25:?\s*[\d\.\,%]+/gi, `Percentil 25: ${wrap(pctf(stats.p25))}`);
    html = html.replace(/Mediana:?\s*[\d\.\,%]+/gi, `Mediana: ${wrap(pctf(stats.med))}`);
    html = html.replace(/Percentil 75:?\s*[\d\.\,%]+/gi, `Percentil 75: ${wrap(pctf(stats.p75))}`);
  }

  /* Monto del ajuste. Si el estudio está dentro del rango no hay ajuste que
     reportar, pero la frase de la plantilla sí existe: se pone un marcador
     visible en vez de la cifra de End Game. Corregir la redacción de esa frase
     queda para el plan 2, cuando la plantilla tenga campos con nombre. */
  const montoAjuste = adj && !adj.within ? fmt(Math.abs(adj.capped)) : '—';
  html = html.replace(/(?<![\d.])983\.180\.000(?![\d.])/g, wrap(montoAjuste));

  // Reemplazar resultado Cumple/No Cumple
  html = html.replace(/cumple con el principio de plena competencia/gi, `${wrap(cumpleStr)} con el principio de plena competencia`);

  /* ─── Las ocho tablas macro de la sección III ───
     Antes solo se regeneraban las dos de PIB; las otras seis (inflación global,
     proyecciones por región, inflación de Colombia, tasa de intervención, TRM y
     desempleo) salían con los valores de End Game. El título se reconoce con
     \([^<]*\) en vez del rango literal «(2023-2025)», para que la tabla siga
     siendo reconocible después de haberse regenerado una vez con otro año. */
  /* datosMacro es el documento de Firestore (analisisMercado/actual) que recibe
     hydrateExactWordTemplate como tercer parámetro. Cuando no trae una serie —o
     cuando el llamador no pasa datosMacro en absoluto— cada generadora cae a su
     respaldo local DATOS_MACRO/FUENTES_MACRO. */
  TABLAS_MACRO.forEach(({ rx, gen }) => {
    html = html.replace(rx, () => gen(datosMacro, year, wrap));
  });

  /* Tabla 13 (Códigos SIC utilizados): la corrida real de Capital IQ de este estudio,
     no la del informe de referencia. El título de la tabla no cambia con el año, así
     que se conserva literal y solo se regenera el <table> que le sigue. */
  html = html.replace(
    /<p>\s*Tabla 13\.\s*C[oó]digos SIC utilizados\s*<\/p>\s*<table>[\s\S]*?<\/table>/,
    () => '<p>\nTabla 13. Códigos SIC utilizados\n</p>\n' + generarTablaCriteriosScreeningHtml(study, wrap)
  );

  /* Sustitución tardía de III.A/III.B: si la narrativa se insertara donde se
     reservó el lugar (arriba, antes de ANIOS_DEL_ESTUDIO y de los reemplazos
     literales), esas reglas reescribirían años y textos dentro de la prosa de
     Claude. Se sustituye aquí, después de todos los pases de texto, para que
     la narrativa llegue intacta. */
  html = html.replace(MARCA_APARTADO_MUNDIAL, () => generarApartadoMundial(datosMacro, year, wrap));
  html = html.replace(MARCA_APARTADO_COLOMBIA, () => generarApartadoColombia(datosMacro, year, wrap));

  return reponerEnlaces(html, enlaces);
}
