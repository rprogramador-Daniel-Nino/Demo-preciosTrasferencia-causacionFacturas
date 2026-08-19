/* ─────────────────────────────────────────────────────────────────────────────
   prosaRangoInforme.js — la frase que comenta el rango intercuartil, con las cifras
   y el año del estudio.

   «…el comportamiento del Margen Operacional se sitúa en 4.985 %, el cual se encuentra entre la
   mediana (-1.075 %) y el percentil 75 (6.418 %), del margen operacional ajustado durante el
   2024…»

   La tabla del rango se rehace con los datos del estudio, pero esta frase se quedaba con las
   cifras y el año del informe del que salió la plantilla. En un documento que se radica ante la
   DIAN, la frase contradice a la tabla que tiene justo encima, y eso lo ve quien lo revise.

   UNA SOLA IMPLEMENTACIÓN PARA LAS DOS RUTAS. La plantilla puede ser un PDF —que se lee a HTML y
   se reconstruye— o un .docx del cliente —cuyo OOXML se edita en el sitio—. Las dos son texto con
   etiquetas intercaladas, así que el anclaje es el mismo y sólo cambia cómo se delimita un
   párrafo. Tenerlo dos veces es exactamente lo que dejó a la ruta del PDF sin el arreglo que la
   del .docx ya tenía.

   POR QUÉ SE ANCLA EN LAS PALABRAS Y NO EN LA POSICIÓN. El primer intento identificaba las cifras
   por su orden —la primera es el percentil 25, la segunda el 75, la tercera la mediana—, que es el
   de la redacción de una plantilla concreta. Otras plantillas las llevan en otro orden: la del
   informe de End Game pone primero el indicador del contribuyente, después la mediana y al final
   el percentil 75. Sustituir por posición ahí pone cada cifra en el sitio de otra, y eso es peor
   que dejar la de la plantilla, porque una cifra creíble en el lugar equivocado ya no se nota.
   Anclando en las palabras que introducen cada cifra, el orden deja de importar y la misma
   función sirve para las dos redacciones.

   Y POR QUÉ ADEMÁS SE MIRA QUÉ CIFRA TIENE CADA RÓTULO AL LADO. Las ocho anclas exigían un
   paréntesis junto a la cifra, porque así lo escriben las dos plantillas contra las que se
   midieron. La del cliente siguiente escribe «…se ubica entre 10.925% percentil 25 y 17.258%
   percentil 75 y la mediana con 15.356%»: sin paréntesis, y con la cifra delante del rótulo. No
   encajaba en ninguna, y el informe salía con las cifras del informe de referencia mientras la
   tabla de encima publicaba las del estudio. Añadir un ancla por cada redacción que aparezca es
   perder siempre por un cliente de diferencia, así que las anclas corren primero —cubren lo que
   la vecindad no puede cubrir sin ponerse en peligro— y lo que quede sin resolver se empareja
   por cercanía. El motor vive en `prosaVecindad.js`.

   NO SE TOCA LA REDACCIÓN, sólo las cifras y el año. Si el indicador del estudio cayera en otro
   tramo del rango, la frase seguiría afirmando el tramo de la plantilla: eso se avisa para que
   alguien lo ajuste, no se reescribe a la brava.
   ───────────────────────────────────────────────────────────────────────────── */

import { filasRangoIntercuartil, ETIQUETAS_RANGO } from './tablasInforme.js';
import { pctf } from '../utils/calculations.js';
import {
  sincronizarCifrasDeProsa, HUECO, PARRAFO_HTML, PARRAFO_OOXML,
} from './prosaVecindad.js';

/* Una cifra en tanto por ciento, como la escriben las plantillas: «4.985%», «-1,075 %». Los
   paréntesis quedan fuera a propósito: así se sustituye el número y los que la plantilla ponga
   alrededor se conservan.

   Ojo: no es la misma expresión que usa la vecindad (`RX_CIFRA_PCT`, con `(?:[.,]\d+)*`). Aquí
   sobra un solo grupo decimal porque el prefijo del ancla fija dónde empieza la coincidencia,
   así que ante «1.234,567 %» esta expresión no llega a casar y el ancla se abstiene. La otra
   escanea cifras sueltas y sí necesita delimitar la cifra entera. Conviven a propósito. */
const RX_PCT = '-?\\d+(?:[.,]\\d+)?\\s*%';

/* Entre el rótulo de un cuartil y su cifra puede haber alguna palabra de enlace: la plantilla
   .docx de este cliente escribe «la mediana con (5.100 %)». Se admiten hasta dos, pero ninguna
   puede ser el rótulo de otro cuartil: sin ese veto, «la mediana y el percentil 75 (X)» daría el
   valor del percentil 75 por mediana, que es justo el error que este módulo existe para evitar. */
const ENLACE = '(?:\\s+(?!percentil|mediana|m[íi]nimo|m[áa]ximo)[a-záéíóúñ]+){0,2}';

/* Cada cifra, anclada en lo que la introduce. `\b` tras «en» es lo que evita que «se encuentra
   entre la mediana» se tome por el indicador del contribuyente.

   `grupoCifra` es el grupo que ocupa la cifra dentro del patrón; con él se obtiene su tramo
   exacto (`m.indices`) en vez de buscar el texto de la cifra dentro de la coincidencia, que
   sustituía la primera aparición y no la del grupo: en «(6.418 %) … 6.418 %» escribía en la
   equivocada. */
const ANCLAS = [
  {
    clave: 'tpli',
    grupoCifra: 2,
    rx: new RegExp('((?:se\\s+(?:sit[úu]a|ubica|encuentra)\\s+en\\b)' + HUECO + ')(' + RX_PCT + ')', 'i'),
  },
  /* El indicador del contribuyente sale en el informe con cuatro redacciones distintas, y las
     tres siguientes son las que faltaban. Medidas sobre el informe de referencia:

       «…una rentabilidad para el Margen Operacional (MO) dentro de los Márgenes Transaccionales
        de Utilidad de Operación (TU), de (4.985 %) en las operaciones…»
       «…generó una rentabilidad operacional de 4.985 %, en la operación de otros servicios (07)…»
       «…para dispositivos móviles de 4.985 %, en su operación, ubicándose sobre los parámetros…»

     Se ancla en cada giro concreto y NO en un «de» seguido de cifra, que aparece por todo el
     informe. Tampoco en «la única cifra del párrafo»: hay uno que dice «El rango de los
     indicadores de rentabilidad fue reducido […] con este fin 25 %», donde ese 25 % es el
     cuartil del método y no el resultado de nadie. */
  {
    clave: 'tpli',
    grupoCifra: 2,
    rx: new RegExp('((?:rentabilidad|margen)\\s+operacional' + ENLACE + '\\s+de' + HUECO
      + '\\(?' + HUECO + ')(' + RX_PCT + ')', 'i'),
  },
  {
    /* `HUECO` y no `\s*` entre el rótulo y la coma: en el informe el rótulo va en negrita y la
       coma queda fuera —«<strong>…de Operación (TU)</strong>, de (4.985 %)»—, así que entre los
       dos hay una etiqueta de cierre. Con `\s*` el ancla no llegaba a la cifra y este párrafo
       —el que se reportó— salía sin actualizar aunque en aislado pareciera funcionar. */
    clave: 'tpli',
    grupoCifra: 2,
    rx: new RegExp('(\\(\\s*TU\\s*\\)' + HUECO + ',?' + HUECO + 'de' + HUECO + '\\(?' + HUECO + ')('
      + RX_PCT + ')', 'i'),
  },
  {
    clave: 'tpli',
    grupoCifra: 1,
    rx: new RegExp('(' + RX_PCT + ')' + '\\)?\\s*,?\\s*en\\s+su\\s+operaci[óo]n', 'i'),
  },
  {
    clave: 'med',
    grupoCifra: 2,
    rx: new RegExp('((?:la\\s+)?mediana' + ENLACE + HUECO + '\\(' + HUECO + ')(' + RX_PCT + ')', 'i'),
  },
  {
    clave: 'p75',
    grupoCifra: 2,
    rx: new RegExp('((?:el\\s+)?percentil\\s+75' + HUECO + '\\(' + HUECO + ')(' + RX_PCT + ')', 'i'),
  },
  {
    clave: 'p25',
    grupoCifra: 2,
    rx: new RegExp('((?:el\\s+)?percentil\\s+25' + HUECO + '\\(' + HUECO + ')(' + RX_PCT + ')', 'i'),
  },
  /* La variante en que el paréntesis va delante del rótulo, que es la de la plantilla .docx:
     «…se ubica entre el percentil 25 (X) y (Y) percentil 75, la mediana con (Z)». */
  {
    clave: 'p75',
    grupoCifra: 1,
    rx: new RegExp('\\(' + HUECO + '(' + RX_PCT + ')' + HUECO + '\\)' + HUECO + '(?:el\\s+)?percentil\\s+75', 'i'),
  },
];

/* Los rótulos que la vecindad sabe emparejar. Sólo los cuartiles: el indicador del contribuyente
   NO entra por aquí, porque su rótulo sería «margen operacional» o «rentabilidad», que aparecen
   por todo el informe, y bastaría un número suelto cerca para publicar el resultado del cliente
   en mitad de otra frase. Ése sigue viniendo de las cuatro anclas, medidas contra el informe.

   «Mínimo» y «máximo» tampoco, y no por prudencia genérica: como un rótulo sin pareja anula la
   pasada entera (es lo que impide colocar una cifra en el sitio de otra), cada «el mínimo
   exigido» de la prosa convertiría en abstención las tres cifras que sí sabíamos poner. */
const ROTULOS_RANGO = [
  { clave: 'p25', rx: /(?:el\s+)?percentil\s+25|primer\s+cuartil|cuartil\s+inferior/i },
  { clave: 'p75', rx: /(?:el\s+)?percentil\s+75|tercer\s+cuartil|cuartil\s+superior/i },
  { clave: 'med', rx: /(?:la\s+)?mediana/i },
];

/* «…se eliminó el 25 % superior e inferior de las observaciones» describe cómo se recorta el
   rango: ese 25 % no es el resultado de nadie. Vetada como candidata, la cifra sigue contando
   como barrera, que es lo que impide que un rótulo salte por encima de ella a buscarse otra. */
const VETOS_CIFRA = [
  { despues: /^\s*(?:superior|inferior|de\s+las\s+observaciones|m[áa]s\s+alto|m[áa]s\s+bajo)\b/i },
  { antes: /(?:se\s+elimin|se\s+recort|se\s+descart|se\s+depur)\w*[^.]{0,40}$/i },
];

/* El año que la frase menciona junto a las cifras. Se ancla en las palabras que lo rodean y no se
   toca ningún otro año del documento: los encabezados del ANEXO B son los estados financieros
   disponibles de las comparables, del año anterior, y las fuentes citadas llevan su fecha. */
const RX_ANIO = new RegExp('((?:ajustado|analizado|operacional)\\s+durante\\s+el' + HUECO + ')(20\\d{2})', 'gi');

/* El giro de la plantilla que motivó el arreglo: «…para la industria petrolera en el año 2025».
   Éste sólo se aplica en un párrafo cuyas cifras se reconocieron, porque «en el año 20XX» sale
   por todo el informe —la macro, las fuentes citadas, el ANEXO B— y lo que lo hace seguro no es
   la frase, es haber acertado el rango en ese mismo párrafo. */
const RX_ANIO_AMPLIADO =
  new RegExp('((?:en|durante)\\s+el\\s+a[ñn]o(?:\\s+gravable)?' + HUECO + ')(20\\d{2})', 'gi');

/* Un párrafo por ruta. Viven en el motor, que es quien los usa; se reexportan aquí porque es de
   donde los importan la ruta del .docx y las pruebas desde que existe este módulo. */
export { PARRAFO_HTML, PARRAFO_OOXML };

/* ¿Este párrafo es el que comenta el rango? Se reconoce porque nombra un cuartil, sitúa el
   indicador o atribuye una rentabilidad operacional al contribuyente. Una celda de la tabla del
   rango dice «Mediana» a secas, sin el paréntesis que las anclas exigen, y es demasiado corta
   para que la vecindad la mire, así que no puede confundirse con la frase.

   Los tres últimos giros no estaban, y por eso dos de los cuatro párrafos que citan el indicador
   se descartaban antes de mirarles las cifras: no nombran ningún cuartil. Son «…una rentabilidad
   para el Margen Operacional (MO) dentro de los […] (TU), de (4.985 %)…» y «…generó una
   rentabilidad operacional de 4.985 %…». Reconocerlos no basta por sí solo para tocarlos: dentro
   siguen mandando las anclas, y el párrafo que dice «El rango de los indicadores de rentabilidad
   fue reducido […] con este fin 25 %» no encaja en ninguna. */
const RX_ES_PROSA_RANGO =
  /percentil\s+(?:25|75)|mediana|se\s+(?:sit[úu]a|ubica)\s+en|rentabilidad\s+operacional|\(\s*TU\s*\)|en\s+su\s+operaci[óo]n/i;

const NOMBRE_DE_CLAVE = {
  p25: 'percentil 25', p75: 'percentil 75', med: 'mediana', tpli: 'indicador del contribuyente',
};

/**
 * Pone en la prosa que comenta el rango las cifras y el año del estudio.
 *
 * @param {string} texto  HTML de la plantilla, u OOXML de `word/document.xml`.
 * @param {object} estudio
 * @param {string[]} [avisos]  se anota si la frase no aparece, si sus cifras no están donde se
 *        esperaba, si algún rótulo se quedó sin cifra que asignarle, si el año no se puede leer,
 *        o si el indicador no cae en el tramo que la frase afirma.
 * @param {{rxParrafo?:RegExp, reporte?:object}} [opciones]  `rxParrafo` por defecto es el `<p>`
 *        del HTML; para OOXML se pasa `PARRAFO_OOXML`. `reporte` se rellena con el recuento,
 *        para que quien llama decida si hace falta un respaldo.
 * @returns {string} el texto con la prosa actualizada donde se pudo.
 */
export function actualizarProsaRango(texto, estudio, avisos, opciones = {}) {
  const study = estudio || {};
  const anotar = (mensaje) => { if (Array.isArray(avisos)) avisos.push(mensaje); };
  const rxParrafo = opciones.rxParrafo || PARRAFO_HTML;

  const rango = filasRangoIntercuartil(study);
  const ajustadoDe = (etiqueta) => {
    const f = rango.filas.find((x) => x.etiqueta === etiqueta);
    return f ? f.ajustado : null;
  };
  /* Las MISMAS cifras que publica la tabla, por la misma función y el mismo formateador. Es lo
     que hace imposible que la frase y la tabla discrepen. La columna ajustada es la que sostiene
     la conclusión, y es de la que habla la frase: «…del margen operacional ajustado». */
  const crudos = {
    tpli: rango.tPLI,
    med: ajustadoDe(ETIQUETAS_RANGO.med),
    p75: ajustadoDe(ETIQUETAS_RANGO.p75),
    p25: ajustadoDe(ETIQUETAS_RANGO.p25),
  };
  const pct = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—' : pctf(Number(v)));
  /* `null` y no «—» cuando no hay dato: un guion donde la plantilla tenía una cifra es peor que
     la cifra vieja. El hueco visible es para los campos del vocabulario, no para la prosa. */
  const cifra = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))
    ? null : pctf(Number(v)));
  const valores = {
    tpli: cifra(crudos.tpli), med: cifra(crudos.med),
    p75: cifra(crudos.p75), p25: cifra(crudos.p25),
  };

  const anio = Number(study.anio);
  const anioValido = Number.isInteger(anio) && anio >= 2000 && anio <= 2100;
  const sustituciones = anioValido ? [
    { clave: 'anio', rx: RX_ANIO, valor: String(anio) },
    { clave: 'anio', rx: RX_ANIO_AMPLIADO, valor: String(anio), soloConCifras: true },
  ] : [];

  const reporte = opciones.reporte || {};
  const salida = sincronizarCifrasDeProsa(texto, {
    rxParrafo,
    reconocedor: RX_ES_PROSA_RANGO,
    rotulos: ROTULOS_RANGO,
    anclas: ANCLAS,
    valores,
    vetosCifra: VETOS_CIFRA,
    sustituciones,
    avisos,
    reporte,
    mensajes: {
      sinFrase: 'la frase que comenta el rango intercuartil no se encontró en la plantilla, así '
        + 'que el informe se radica con las cifras y el año del informe de referencia',
      sinCifras: 'la frase que comenta el rango se encontró, pero ninguna de sus cifras está '
        + 'donde se esperaba: se quedan las del informe de referencia',
      sinResolver: (claves) => 'la frase que comenta el rango nombra '
        + claves.map((c) => '«' + (NOMBRE_DE_CLAVE[c] || c) + '»').join(' y ')
        + ' pero no se pudo decidir qué cifra de la frase le corresponde, así que no se tocó '
        + 'ninguna: se quedan las del informe de referencia',
    },
  });

  reporte.anioPuesto = Boolean(reporte.sustituidas && reporte.sustituidas.has('anio'));

  if (reporte.parrafosTocados && !anioValido) {
    anotar('no se pudo leer el año gravable del estudio ("' + String(study.anio) + '"), así que el '
      + 'año de la frase que comenta el rango se queda como lo trajo la plantilla');
  }

  /* Las cifras ya cuadran con la tabla, pero si el indicador no cae donde la frase dice, la
     redacción afirma algo que sus propias cifras desmienten. Hay que decirlo. */
  const { tpli, med, p75 } = crudos;
  if (reporte.cifrasPuestas && tpli !== null && med !== null && p75 !== null
      && /entre\s+la\s+mediana/i.test(salida) && !(tpli >= med && tpli <= p75)) {
    anotar('la frase del rango dice que el indicador está entre la mediana (' + pct(med)
      + ') y el percentil 75 (' + pct(p75) + '), pero el del estudio es ' + pct(tpli)
      + ': las cifras ya son las del estudio, la redacción hay que ajustarla a mano');
  }

  return salida;
}
