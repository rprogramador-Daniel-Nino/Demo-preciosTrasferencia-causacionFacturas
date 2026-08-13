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

   NO SE TOCA LA REDACCIÓN, sólo las cifras y el año. Si el indicador del estudio cayera en otro
   tramo del rango, la frase seguiría afirmando el tramo de la plantilla: eso se avisa para que
   alguien lo ajuste, no se reescribe a la brava.
   ───────────────────────────────────────────────────────────────────────────── */

import { filasRangoIntercuartil, ETIQUETAS_RANGO } from './tablasInforme.js';
import { pctf } from '../utils/calculations.js';

/* Una cifra en tanto por ciento, como la escriben las plantillas: «4.985%», «-1,075 %». Los
   paréntesis quedan fuera a propósito: así se sustituye el número y los que la plantilla ponga
   alrededor se conservan. */
const RX_PCT = '-?\\d+(?:[.,]\\d+)?\\s*%';

/* Entre la palabra que ancla y su cifra puede haber etiquetas. En la ruta del PDF las pone el
   marcado con IA (`<span data-campo>`) y el resaltado de la vista previa; en la del .docx, el
   propio Word, que parte una frase en varios `<w:r><w:t>` por el corrector o por un cambio de
   formato. Es lo que permite que un mismo patrón valga para HTML y para OOXML. */
const HUECO = '(?:<[^>]*>|\\s|&nbsp;)*';

/* Entre el rótulo de un cuartil y su cifra puede haber alguna palabra de enlace: la plantilla
   .docx de este cliente escribe «la mediana con (5.100 %)». Se admiten hasta dos, pero ninguna
   puede ser el rótulo de otro cuartil: sin ese veto, «la mediana y el percentil 75 (X)» daría el
   valor del percentil 75 por mediana, que es justo el error que este módulo existe para evitar. */
const ENLACE = '(?:\\s+(?!percentil|mediana|m[íi]nimo|m[áa]ximo)[a-záéíóúñ]+){0,2}';

/* Cada cifra, anclada en lo que la introduce. `\b` tras «en» es lo que evita que «se encuentra
   entre la mediana» se tome por el indicador del contribuyente. */
const ANCLAS = [
  {
    clave: 'tpli',
    rx: new RegExp('((?:se\\s+(?:sit[úu]a|ubica|encuentra)\\s+en\\b)' + HUECO + ')(' + RX_PCT + ')', 'i'),
  },
  {
    clave: 'med',
    rx: new RegExp('((?:la\\s+)?mediana' + ENLACE + HUECO + '\\(' + HUECO + ')(' + RX_PCT + ')', 'i'),
  },
  {
    clave: 'p75',
    rx: new RegExp('((?:el\\s+)?percentil\\s+75' + HUECO + '\\(' + HUECO + ')(' + RX_PCT + ')', 'i'),
  },
  {
    clave: 'p25',
    rx: new RegExp('((?:el\\s+)?percentil\\s+25' + HUECO + '\\(' + HUECO + ')(' + RX_PCT + ')', 'i'),
  },
  /* La variante en que el paréntesis va delante del rótulo, que es la de la plantilla .docx:
     «…se ubica entre el percentil 25 (X) y (Y) percentil 75, la mediana con (Z)». */
  {
    clave: 'p75',
    cifraPrimero: true,
    rx: new RegExp('\\(' + HUECO + '(' + RX_PCT + ')' + HUECO + '\\)' + HUECO + '(?:el\\s+)?percentil\\s+75', 'i'),
  },
];

/* El año que la frase menciona junto a las cifras. Se ancla en las palabras que lo rodean y no se
   toca ningún otro año del documento: los encabezados del ANEXO B son los estados financieros
   disponibles de las comparables, del año anterior, y las fuentes citadas llevan su fecha. */
const RX_ANIO = new RegExp('((?:ajustado|analizado|operacional)\\s+durante\\s+el' + HUECO + ')(20\\d{2})', 'gi');

/* Un párrafo por ruta. En HTML es `<p>`; en el OOXML de Word, `<w:p>`. */
export const PARRAFO_HTML = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
export const PARRAFO_OOXML = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gi;

/* ¿Este párrafo es el que comenta el rango? Se reconoce porque nombra un cuartil o sitúa el
   indicador. Una celda de la tabla del rango dice «Mediana» a secas, sin el paréntesis que las
   anclas exigen, así que no puede confundirse con la frase. */
const RX_ES_PROSA_RANGO = /percentil\s+(?:25|75)|mediana|se\s+(?:sit[úu]a|ubica)\s+en/i;

/**
 * Pone en la prosa que comenta el rango las cifras y el año del estudio.
 *
 * @param {string} texto  HTML de la plantilla, u OOXML de `word/document.xml`.
 * @param {object} estudio
 * @param {string[]} [avisos]  se anota si la frase no aparece, si sus cifras no están donde se
 *        esperaba, si el año no se puede leer, o si el indicador no cae en el tramo que la frase
 *        afirma.
 * @param {{rxParrafo?:RegExp}} [opciones]  `rxParrafo` por defecto es el `<p>` del HTML; para
 *        OOXML se pasa `PARRAFO_OOXML`.
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
  const valores = {
    tpli: rango.tPLI,
    med: ajustadoDe(ETIQUETAS_RANGO.med),
    p75: ajustadoDe(ETIQUETAS_RANGO.p75),
    p25: ajustadoDe(ETIQUETAS_RANGO.p25),
  };
  const pct = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—' : pctf(Number(v)));

  const anio = Number(study.anio);
  const anioValido = Number.isInteger(anio) && anio >= 2000 && anio <= 2100;

  let cifrasPuestas = 0;
  let parrafosTocados = 0;
  let parrafosReconocidos = 0;

  /* `rxParrafo` es global y se reutiliza entre llamadas, así que su `lastIndex` tiene que quedar
     a cero o la segunda llamada empezaría a medio documento. `String.replace` con un regex
     global ya lo hace, pero dejarlo dicho evita que un cambio futuro lo rompa. */
  rxParrafo.lastIndex = 0;

  const salida = String(texto || '').replace(rxParrafo, (parrafo) => {
    if (!RX_ES_PROSA_RANGO.test(parrafo)) return parrafo;
    parrafosReconocidos += 1;

    let nuevo = parrafo;
    let tocado = false;
    for (const ancla of ANCLAS) {
      const valor = valores[ancla.clave];
      if (valor === null || valor === undefined) continue;
      const antes = nuevo;
      nuevo = nuevo.replace(ancla.rx, (todo, uno) => (
        /* En la variante con el paréntesis delante, el primer grupo ES la cifra y hay que
           sustituirla dentro de la coincidencia entera; en las demás, es lo que la precede y la
           cifra va detrás. */
        ancla.cifraPrimero ? todo.replace(uno, pct(valor)) : uno + pct(valor)
      ));
      if (nuevo !== antes) { cifrasPuestas += 1; tocado = true; }
    }

    if (anioValido) {
      const antes = nuevo;
      nuevo = nuevo.replace(RX_ANIO, (todo, delante) => delante + String(anio));
      if (nuevo !== antes) tocado = true;
    }

    if (tocado) parrafosTocados += 1;
    return nuevo;
  });

  if (!parrafosReconocidos) {
    anotar('la frase que comenta el rango intercuartil no se encontró en la plantilla, así que el '
      + 'informe se radica con las cifras y el año del informe de referencia');
    return salida;
  }
  if (!cifrasPuestas) {
    anotar('la frase que comenta el rango se encontró, pero ninguna de sus cifras está donde se '
      + 'esperaba: se quedan las del informe de referencia');
  }
  if (parrafosTocados && !anioValido) {
    anotar('no se pudo leer el año gravable del estudio ("' + String(study.anio) + '"), así que el '
      + 'año de la frase que comenta el rango se queda como lo trajo la plantilla');
  }

  /* Las cifras ya cuadran con la tabla, pero si el indicador no cae donde la frase dice, la
     redacción afirma algo que sus propias cifras desmienten. Hay que decirlo. */
  const { tpli, med, p75 } = valores;
  if (cifrasPuestas && tpli !== null && med !== null && p75 !== null
      && /entre\s+la\s+mediana/i.test(salida) && !(tpli >= med && tpli <= p75)) {
    anotar('la frase del rango dice que el indicador está entre la mediana (' + pct(med)
      + ') y el percentil 75 (' + pct(p75) + '), pero el del estudio es ' + pct(tpli)
      + ': las cifras ya son las del estudio, la redacción hay que ajustarla a mano');
  }

  return salida;
}
