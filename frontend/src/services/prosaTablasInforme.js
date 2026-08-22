/* ─────────────────────────────────────────────────────────────────────────────
   prosaTablasInforme.js — las otras frases que citan cifras de una tabla: los conteos de la
   muestra, el monto de la operación con el vinculado, el de la información adicional del formato
   (códigos DIAN 61 a 63) y el año de los márgenes.

   La frase que comenta el rango intercuartil tiene su módulo (`prosaRangoInforme.js`) porque
   necesita emparejar tres cuartiles con tres cifras. Estas tres familias no: cada cifra la
   introduce un giro concreto y sin ambigüedad —«se identificó un total de N Compañías
   comparables potenciales», «por un valor total de $ N»—, así que van SÓLO por anclas y con el
   emparejamiento por cercanía DESACTIVADO (`rotulos: []`).

   POR QUÉ NO SE EMPAREJA POR CERCANÍA AQUÍ. Estas cifras no llevan «%»: son conteos («442»,
   «13») y montos («3.435.357.400»). Un entero suelto en prosa puede ser un año, el número de un
   artículo del Estatuto Tributario, un código de operación DIAN o una página. La cercanía a una
   palabra no basta para decidir que ese número es el que la tabla publica, y publicar un conteo
   equivocado en un documento que se radica ante la DIAN es peor que dejar el del informe de
   referencia.

   Redacciones medidas sobre el informe de referencia (`brain_estudio_pasado.txt`):

     «A partir del anterior criterio de búsqueda se identificó un total de 442 Compañías
      comparables potenciales.»
     «De esta manera, después de aplicar dichos criterios, quedaron 13 compañías comparables.»
     «La muestra final de comparables a End Game Colombia SAS, quedó conformada por 13
      compañías, los cuales se señalan a continuación:»
     «En el año 2024, END GAME INTERACTIVE COLOMBIA S.A.S, tuvo operaciones de ingreso con sus
      vinculados económicos por Otros servicios (07), por un valor total de $ 3.435.357.400»
     «La transacción efectuada […] durante el ejercicio fiscal finalizado el 31 de diciembre de
      2024. fue el Ingreso por Otros servicios (07), por un valor de $ 3.435.357.400, detalladas
      a continuación:»
     «El siguiente cuadro presenta las utilidades operacionales sobre ventas para el conjunto de
      compañías comparables para los estados financieros correspondientes al año 2024:»

   En la plantilla los conteos van resaltados —«quedaron <strong>13</strong> compañías»—, así que
   entre el giro y la cifra hay una etiqueta: es lo que `HUECO` resuelve, igual que en el rango.

   LO QUE NO SE TOCA. «…debían superar 3 razones de aceptación y solo tener hasta máximo 3
   razones de rechazo» son los umbrales con que se configuró la búsqueda, no cifras que ninguna
   tabla publique: el estudio no los guarda y ponerles un número sería inventarlo. Y el rótulo
   del indicador («Margen Operacional») no se sustituye aunque el estudio use otro: cambiar esa
   palabra es reescribir la redacción, no corregir una cifra. Se avisa.
   ───────────────────────────────────────────────────────────────────────────── */

import { filasRazonesRechazo, filasMuestraComparables } from './tablasInforme.js';
import { montoOperacionAdicional, tieneOperacionAdicional } from './tablasOperaciones.js';
import { fmt, num } from '../utils/calculations.js';
import { valorDeCampo } from './plantillaVocabulario.js';
import {
  sincronizarCifrasDeProsa, textoVisibleConMapa, HUECO, PARRAFO_HTML,
} from './prosaVecindad.js';

/* Un conteo, como lo escriben las plantillas: «13», «442», «1.024». */
const CONTEO = '\\d+(?:\\.\\d{3})*';

/* Un monto en pesos. El «$» queda fuera del grupo a propósito: se sustituye el número y el
   signo que la plantilla ponga delante se conserva, con su espacio y todo. */
const MONTO = '\\d+(?:\\.\\d{3})*(?:,\\d+)?';

const anioDe = (estudio) => {
  const n = Number(estudio && estudio.anio);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? String(n) : null;
};

/* ══════════════════ muestra y razones de rechazo ══════════════════ */

const RX_ES_PROSA_MUESTRA = new RegExp(
  '(?:comparables' + HUECO + 'potenciales)'
  + '|(?:(?:total|universo)\\s+de' + HUECO + '\\d)'
  + '|(?:identificaron?' + HUECO + '\\d)'
  + '|(?:(?:qued(?:aron|[óo])|conformad[ao]|integrad[ao]|compuest[ao]|seleccionaron|resultaron)'
  + '(?:' + HUECO + 'por)?' + HUECO + '\\d)', 'i');

/* Cómo llama el informe a lo que cuenta. El primer intento pedía un sustantivo de empresa
   —«compañías», «empresas», «sociedades»— porque así lo escribe el informe de referencia
   («quedó conformada por 13 compañías»). La plantilla del cliente siguiente escribe «quedó
   conformada por 8 comparables», con el adjetivo sustantivado y sin el sustantivo delante, y el
   conteo se radicaba con el del informe anterior mientras la tabla de debajo listaba doce.
   Enumerar un sinónimo por plantilla es perder siempre por un cliente de diferencia, así que se
   admite cualquiera de las formas y también que vayan combinadas. */
const COSA_CONTADA = '(?:comparables?|compa[ñn][íi]as?|empresas?|sociedades|entidades)';

/* Entre la cifra y esa palabra caben un par de palabras de relleno: «8 compañías o entidades
   comparables», «442 posibles empresas». No pueden ser unidades de magnitud, o «un total de 442
   millones de compañías» —una frase de estados financieros, no de la muestra— pasaría por un
   conteo de comparables. */
const RELLENO = '(?:(?!millones|miles|millardos|billones|pesos|d[óo]lares)[a-záéíóúñ]+'
  + HUECO + '){0,2}';

/* Lo que introduce cada conteo. Son dos grupos que no se pisan, y es el verbo —no la cifra ni
   la palabra que la sigue— lo que distingue el universo de la muestra final: las dos frases
   cuentan «compañías comparables» y sólo se diferencian en si las están buscando o ya las
   eligieron. */
const VERBO_UNIVERSO = '(?:(?:un|el)\\s+)?(?:total|universo)\\s+de|se\\s+identificaron?';
const VERBO_ACEPTADAS = '(?:qued(?:aron|[óo])|conformad[ao]|integrad[ao]|compuest[ao]'
  + '|seleccionaron|resultaron)(?:' + HUECO + 'por)?';

/* El lookahead lleva lo que va DETRÁS de la cifra sin capturarlo: es lo que distingue «un total
   de 442 Compañías comparables potenciales» de cualquier otro «total de» del informe —hay uno
   por cada tabla de estados financieros—. */
const ANCLAS_MUESTRA = [
  {
    clave: 'universo',
    grupoCifra: 2,
    rx: new RegExp('((?:' + VERBO_UNIVERSO + ')' + HUECO + ')(' + CONTEO + ')'
      + '(?=' + HUECO + RELLENO + COSA_CONTADA + ')', 'i'),
  },
  {
    clave: 'aceptadas',
    grupoCifra: 2,
    rx: new RegExp('((?:' + VERBO_ACEPTADAS + ')' + HUECO + ')(' + CONTEO + ')'
      + '(?=' + HUECO + RELLENO + COSA_CONTADA + ')', 'i'),
  },
];

/**
 * Pone en la prosa de la muestra los conteos que publican las tablas de razones de rechazo y de
 * muestra final.
 *
 * @param {string} texto
 * @param {object} estudio
 * @param {string[]} [avisos]
 * @param {{rxParrafo?:RegExp, reporte?:object}} [opciones]
 * @returns {string}
 */
export function actualizarProsaMuestra(texto, estudio, avisos, opciones = {}) {
  const study = estudio || {};
  const rechazo = filasRazonesRechazo(study.embudoSeleccion);
  /* Las aceptadas se toman de la muestra final —las comparables que el informe LISTA y que
     sostienen el rango— y no del contador del embudo. Si los dos no coinciden, el informe ya se
     contradice entre sus propias tablas, y de eso avisa `razonesRechazoDescuadradas`; la frase
     tiene que decir lo que el lector puede contar en la tabla que tiene delante. */
  const aceptadas = filasMuestraComparables(study).length;

  return sincronizarCifrasDeProsa(texto, {
    rxParrafo: opciones.rxParrafo || PARRAFO_HTML,
    reconocedor: RX_ES_PROSA_MUESTRA,
    rotulos: [],
    anclas: ANCLAS_MUESTRA,
    valores: {
      universo: rechazo.sinDatos || !rechazo.total ? null : String(rechazo.total),
      aceptadas: aceptadas ? String(aceptadas) : null,
    },
    avisos,
    reporte: opciones.reporte,
    mensajes: {
      sinCifras: 'el informe dice cuántas compañías comparables se identificaron o quedaron, '
        + 'pero el conteo no está donde se esperaba: se queda el del informe de referencia',
    },
  });
}

/* ══════════════════ operaciones con el vinculado ══════════════════ */

const RX_ES_PROSA_OPERACIONES = new RegExp(
  '(?:por' + HUECO + '(?:un' + HUECO + ')?(?:valor|monto|importe|suma))'
  + '|(?:operaciones\\s+de\\s+(?:ingreso|egreso))'
  + '|(?:transacci(?:[óo]n|ones)\\s+(?:efectuada|realizada))'
  + '|(?:vinculados?\\s+econ[óo]micos?)', 'i');

/* Cómo introduce cada plantilla el monto. Una firma escribe «por un valor total de $ X», otra
   «por valor de $X», otra «por un monto de X» y otra «cuyo importe asciende a X». Lo estable
   no es el giro sino la palabra que nombra la cifra —valor, monto, importe, suma— seguida de
   un conector corto; lo demás cambia con cada cliente. */
const INTRO_MONTO = '(?:valor|monto|importe|suma)'
  + '(?:\\s+(?:total|neto|bruto|global))?'
  + '(?:\\s+(?:de|por|a|que\\s+asciende\\s+a|asciende\\s+a|equivalente\\s+a))?';

/* ── el monto de la información adicional del formato (códigos DIAN 61 a 63) ──

   El análisis de la operación cita DOS montos con el mismo giro: el de la operación analizada y
   el de la sección «4. Información adicional» del Formato 1125 —préstamos, reintegros y
   operaciones a nombre de vinculados que no se reflejan en el Estado de Resultados—:

     «…realizó operaciones con su vinculado por compra neta de inventarios para distribución (31)
      por un valor total de $ 18.836.847.464; adicionalmente se realizó un contrato de mandato
      entre la sucursal y su vinculado en el exterior por reintegros o reembolsos de gastos con
      vinculados que no fueron reflejados en el Estado de Resultados (62) por valor total de
      $ 13.425.408.220.»

   El ancla del monto se llevaba el primero y el segundo se radicaba con la cifra del informe del
   año anterior. Son dos cifras de dos tablas distintas, así que son dos anclas.

   QUÉ MARCA LA SEGUNDA. El código DIAN entre paréntesis y la cola del nombre oficial de los tres
   tipos —«…que no fueron reflejados en el Estado de Resultados»— vienen del catálogo de la DIAN
   (`tiposOperacionDian.js`), así que no dependen de cómo redacte cada firma; «adicionalmente» y
   «adicional a lo anterior» son los giros con que el informe entra en esa segunda operación. Se
   pide uno de ellos ANTES del giro del monto y en la misma oración: el relleno no cruza un punto
   —ni el de miles de otro monto— ni un punto y coma, que es lo que separa las dos operaciones. */
const DISPARADOR_ADICIONAL = '(?:\\(\\s*6[123]\\s*\\)'
  + '|no\\s+(?:fueron|fue|se|est[áa]n|est[áa])\\s+reflejad[oa]s?'
  + '|no\\s+se\\s+reflej(?:aron|[óo])'
  + '|adicionalmente|adicional\\s+a\\s+lo\\s+anterior'
  + '|informaci[óo]n\\s+adicional'
  + '|operaci(?:[óo]n|ones)\\s+adicional(?:es)?)';

const RX_ES_ADICIONAL = new RegExp(DISPARADOR_ADICIONAL, 'i');

const RX_MONTO_ADICIONAL = new RegExp(
  '(' + DISPARADOR_ADICIONAL + '[^.;:]{0,200}?' + INTRO_MONTO + HUECO + '\\$?' + HUECO + ')('
  + MONTO + ')', 'i');

/* El orden importa: la información adicional va primero, para que en un párrafo que sólo hable de
   ella se quede con su cifra; y el `veto` del monto de la operación analizada es lo que impide
   que se la lleve él cuando el estudio no trae información adicional que declarar. */
const ANCLAS_OPERACIONES = [
  {
    clave: 'montoAdicional',
    grupoCifra: 2,
    rx: RX_MONTO_ADICIONAL,
  },
  {
    clave: 'monto',
    grupoCifra: 2,
    rx: new RegExp('(' + INTRO_MONTO + HUECO + '\\$?' + HUECO + ')(' + MONTO + ')', 'i'),
    veto: RX_ES_ADICIONAL,
  },
];

/* ¿Algún párrafo del análisis de la operación cita un monto de información adicional? Se mira
   sobre el TEXTO VISIBLE y no sobre el crudo: en el OOXML del .docx, un
   `<w:t xml:space="preserve">` por el medio mete dos puntos donde el relleno del ancla no los
   admite. Sólo sirve para avisar; lo que se escribe lo decide el ancla. */
function citaMontoAdicional(texto, rxParrafo) {
  const parrafos = String(texto || '').match(rxParrafo) || [];
  for (const parrafo of parrafos) {
    if (!RX_ES_PROSA_OPERACIONES.test(parrafo)) continue;
    if (RX_MONTO_ADICIONAL.test(textoVisibleConMapa(parrafo).plano)) return true;
  }
  return false;
}

/**
 * Pone en la prosa de la operación el monto que publican las Tablas 1, 2 y 12, el de la tabla de
 * la información adicional del formato cuando hay que declararla, y el año.
 *
 * @param {string} texto
 * @param {object} estudio
 * @param {string[]} [avisos]
 * @param {{rxParrafo?:RegExp, reporte?:object}} [opciones]
 * @returns {string}
 */
export function actualizarProsaOperaciones(texto, estudio, avisos, opciones = {}) {
  const study = estudio || {};
  /* El mismo valor y el mismo formateador que las tablas de la operación: `valorDeCampo`
     devuelve `monto_operacion` o `monto` pasado por `fmt`. */
  const monto = valorDeCampo(study, 'monto_operacion');
  /* El monto de la información adicional, con la MISMA condición que la tabla: sólo si el formato
     trajo la sección y su total supera el umbral del año gravable (45.000 UVT). Si la tabla no se
     publica, la frase no puede declararla —en el .docx la tabla se borra— y si el estudio no la
     trae, escribir aquí cualquier cifra sería inventarla. */
  const montoAdicional = tieneOperacionAdicional(study)
    ? fmt(montoOperacionAdicional(study))
    : null;
  const anio = anioDe(study);

  const sustituciones = anio ? [
    /* «…el ejercicio fiscal finalizado el 31 de diciembre de 2024». El día y el mes no cambian
       —el ejercicio gravable cierra el 31 de diciembre—, sólo el año. */
    {
      clave: 'anio',
      /* «finalizado», pero también «terminado» o «cerrado»: el ejercicio se cierra el 31 de
         diciembre en todas las plantillas y lo único que cambia es el participio. */
      rx: new RegExp('((?:finalizad|terminad|cerrad|concluid)o\\s+(?:el\\s+)?'
        + '\\d{1,2}\\s+de\\s+[a-záéíóú]+\\s+de' + HUECO + ')(20\\d{2})', 'gi'),
      valor: anio,
    },
    /* «En el año 2024, END GAME […] tuvo operaciones de ingreso…». Sólo si en ESE párrafo se
       colocó el monto: «en el año 20XX» sale por todo el informe —la macro, las fuentes citadas,
       el ANEXO B— y lo que lo hace seguro no es la frase, es haber acertado el monto ahí mismo. */
    {
      clave: 'anio',
      rx: new RegExp('((?:^|[^a-záéíóúñ])(?:en|durante)\\s+el\\s+a[ñn]o' + HUECO
        + ')(20\\d{2})', 'gi'),
      valor: anio,
      soloConCifras: true,
    },
  ] : [];

  const rxParrafo = opciones.rxParrafo || PARRAFO_HTML;

  /* Lo que el informe dice de la información adicional y lo que el estudio trae tienen que
     coincidir, y cuando no, no se toca la redacción: se avisa. Los dos sentidos importan porque
     la plantilla es el informe del año anterior —puede citar una operación adicional que este
     contribuyente no tiene— y porque un estudio que la declara con una plantilla que no la
     menciona necesita el párrafo escrito a mano. */
  if (Array.isArray(avisos)) {
    const citada = citaMontoAdicional(texto, rxParrafo);
    if (citada && !montoAdicional) {
      avisos.push('el informe cita un monto de información adicional (códigos 61 a 63) y el '
        + 'estudio no la declara: se queda el del informe de referencia, revise ese párrafo');
    } else if (!citada && montoAdicional) {
      avisos.push('el estudio declara información adicional (códigos 61 a 63) por $ '
        + montoAdicional + ' y el análisis de la operación no la menciona: redacte la frase '
        + 'que presenta esa tabla');
    }
  }

  return sincronizarCifrasDeProsa(texto, {
    rxParrafo,
    reconocedor: RX_ES_PROSA_OPERACIONES,
    rotulos: [],
    anclas: ANCLAS_OPERACIONES,
    valores: { monto, montoAdicional },
    sustituciones,
    avisos,
    reporte: opciones.reporte,
    mensajes: {
      sinCifras: 'el informe cita el monto de la operación con el vinculado, pero no está donde '
        + 'se esperaba: se queda el del informe de referencia',
    },
  });
}

/* ══════════════════ márgenes de las comparables ══════════════════ */

/* El párrafo que presenta la tabla de márgenes. Se reconoce por lo que anuncia —las utilidades
   o los márgenes del conjunto de comparables, o sus estados financieros— y no por un giro
   literal: cada firma lo redacta a su manera y el año que hay que corregir es el mismo. */
const RX_ES_PROSA_MARGENES = new RegExp(
  '(?:utilidades' + HUECO + 'operacionales)'
  + '|(?:m[áa]rgenes' + HUECO + '(?:de|del|obtenidos))'
  + '|(?:estados\\s+financieros' + HUECO + '(?:correspondientes|de\\s+las|del\\s+a[ñn]o))', 'i');

/* Cómo nombra el informe cada indicador. Sirve para avisar, no para sustituir. */
const NOMBRES_PLI = {
  MO: /margen\s+operacional|\bMO\b/i,
  MB: /margen\s+bruto|\bMB\b/i,
  Berry: /\bberry\b/i,
};

/**
 * Pone en la prosa que introduce la tabla de márgenes el año de los estados financieros, y avisa
 * si esa frase nombra un indicador que no es el del estudio.
 *
 * @param {string} texto
 * @param {object} estudio
 * @param {string[]} [avisos]
 * @param {{rxParrafo?:RegExp, reporte?:object}} [opciones]
 * @returns {string}
 */
export function actualizarProsaMargenes(texto, estudio, avisos, opciones = {}) {
  const study = estudio || {};
  const anio = anioDe(study);
  const rxParrafo = opciones.rxParrafo || PARRAFO_HTML;

  const salida = sincronizarCifrasDeProsa(texto, {
    rxParrafo,
    reconocedor: RX_ES_PROSA_MARGENES,
    rotulos: [],
    anclas: [],
    valores: {},
    sustituciones: anio ? [{
      clave: 'anio',
      /* «correspondientes al año 2024», «relativos al año 2024», «del año 2024», «para el año
         2024». Se exige la palabra «año» delante: sin ella, «de 2024» casaría cualquier fecha
         suelta del párrafo. */
      rx: new RegExp('((?:correspondiente|relativo|referid)?[so]?\\s*(?:al|del|para\\s+el|de)?'
        + '\\s*a[ñn]o' + HUECO + ')(20\\d{2})', 'gi'),
      valor: anio,
    }] : [],
    avisos,
    reporte: opciones.reporte,
  });

  /* El indicador que la frase nombra tiene que ser el que el informe usa. Si no lo es, la tabla
     de abajo publica márgenes de un indicador y la frase de arriba anuncia otro. No se sustituye
     la palabra: cambiarla es reescribir la redacción, y el matiz que el cliente haya pactado con
     su asesor se perdería sin avisar. */
  const pli = String(study.pli || 'MO');
  const mio = NOMBRES_PLI[pli];
  if (mio && Array.isArray(avisos)) {
    for (const otro of Object.keys(NOMBRES_PLI)) {
      if (otro === pli) continue;
      if (!nombraEnProsaDeMargenes(salida, rxParrafo, NOMBRES_PLI[otro], mio)) continue;
      avisos.push('la frase que introduce la tabla de márgenes nombra el indicador «' + otro
        + '» y el estudio usa «' + pli + '»: las cifras son las del estudio, la redacción hay '
        + 'que ajustarla a mano');
      break;
    }
  }

  return salida;
}

/* ¿Algún párrafo de la prosa de márgenes nombra `ajeno` y no el indicador del estudio? Se pide
   que no nombre el propio para no avisar de «Margen Operacional (MO) y Margen Bruto», donde los
   dos aparecen porque la frase compara. */
function nombraEnProsaDeMargenes(texto, rxParrafo, ajeno, propio) {
  const rx = new RegExp(rxParrafo.source, rxParrafo.flags);
  rx.lastIndex = 0;
  let m = rx.exec(String(texto || ''));
  while (m !== null) {
    const parrafo = m[0];
    if (RX_ES_PROSA_MARGENES.test(parrafo) && ajeno.test(parrafo) && !propio.test(parrafo)) {
      return true;
    }
    if (m[0] === '') rx.lastIndex += 1;
    m = rx.exec(String(texto || ''));
  }
  return false;
}

/* ══════════════════ ajustes a las comparables: la tasa de interés ══════════════════ */

const RX_ES_PROSA_AJUSTES = new RegExp(
  '(?:prime' + HUECO + 'rate)'
  + '|(?:tasa' + HUECO + 'prime)'
  /* La cita de la FED ocupa varias líneas y el extractor puede partirla en el salto de
     página, dejando la frase de la tasa en un párrafo que ya no dice «prime». */
  + '|(?:esta\\s+tasa\\s+durante)', 'i');

/* La tasa, sin el «%»: el grupo es SOLO el número. Así el «% EA» que la plantilla escriba
   —con espacio o sin él, con «EA» o con «E.A.»— se queda tal cual, y esta frase no cambia de
   aspecto por haberle corregido la cifra. */
const TASA = '\\d+(?:[.,]\\d+)?';

const ANCLAS_AJUSTES = [
  {
    clave: 'prime',
    grupoCifra: 2,
    rx: new RegExp('((?:fue|es|asciende\\s+a)\\s+(?:de\\s+|del\\s+)?' + HUECO + ')('
      + TASA + ')(?=' + HUECO + '%)', 'i'),
  },
];

/**
 * Pone en la prosa de los ajustes la tasa de interés que el estudio usa de verdad.
 *
 * «…"Average majority prime rate charged by banks on short-term loans to business". Esta tasa
 * durante el 2025 fue de 8.31% EA.» El motor calcula el ajuste por capital de trabajo con
 * `estudio.prime` —la que se escribe en la ingesta de cifras y la que publica el Excel de
 * soporte—, pero esta frase se quedaba con la del informe del que salió la plantilla. El
 * documento declaraba entonces una tasa que no es la que sustenta sus propios números.
 *
 * @param {string} texto
 * @param {object} estudio
 * @param {string[]} [avisos]
 * @param {{rxParrafo?:RegExp, reporte?:object}} [opciones]
 * @returns {string}
 */
export function actualizarProsaAjustes(texto, estudio, avisos, opciones = {}) {
  const study = estudio || {};
  const tasa = num(study.prime);
  /* Sin tasa no hay nada que corregir, y escribir un «—» donde la plantilla tenía un número
     es peor que el número viejo. Pasa cuando el estudio no aplica ajuste (`useadj` en falso):
     la plantilla conserva su frase, que es lo que corresponde. */
  const valor = tasa === null || !(tasa > 0)
    ? null
    : tasa.toLocaleString('es-CO', { maximumFractionDigits: 3 });

  return sincronizarCifrasDeProsa(texto, {
    rxParrafo: opciones.rxParrafo || PARRAFO_HTML,
    reconocedor: RX_ES_PROSA_AJUSTES,
    rotulos: [],
    anclas: ANCLAS_AJUSTES,
    valores: { prime: valor },
    /* El año de esa misma frase, y sólo si la tasa se colocó ahí: «durante el 20XX» aparece en
       todo el informe y lo que lo hace seguro no es la frase, es haber acertado la tasa en ese
       mismo párrafo. */
    sustituciones: anioDe(study) ? [{
      clave: 'anio',
      rx: new RegExp('(durante\\s+el\\s+(?:a[ñn]o\\s+)?' + HUECO + ')(20\\d{2})', 'gi'),
      valor: anioDe(study),
      soloConCifras: true,
    }] : [],
    avisos,
    reporte: opciones.reporte,
    mensajes: {
      sinCifras: 'el informe cita la tasa de interés de los ajustes («Prime Rate»), pero no '
        + 'está donde se esperaba: se queda la del informe de referencia',
    },
  });
}

/* ══════════════════ las cuatro, en el orden en que salen en el informe ══════════════════ */

/**
 * Corre las tres familias sobre el mismo texto. Es el punto único de enganche, para que las dos
 * rutas —la del PDF y la del .docx— no puedan quedarse una con menos arreglos que la otra, que
 * es lo que pasó con la prosa del rango.
 *
 * @param {string} texto
 * @param {object} estudio
 * @param {string[]} [avisos]
 * @param {{rxParrafo?:RegExp}} [opciones]
 * @returns {string}
 */
export function actualizarProsaTablas(texto, estudio, avisos, opciones = {}) {
  let salida = actualizarProsaOperaciones(texto, estudio, avisos, opciones);
  salida = actualizarProsaMuestra(salida, estudio, avisos, opciones);
  salida = actualizarProsaAjustes(salida, estudio, avisos, opciones);
  return actualizarProsaMargenes(salida, estudio, avisos, opciones);
}
