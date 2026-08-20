/* ─────────────────────────────────────────────────────────────────────────────
   prosaBaseDatos.js — el nombre de la base de datos de la que salieron los comparables, en la
   prosa del informe.

   POR QUÉ. La plantilla de cada cliente es su propio informe del año anterior, y los informes
   viejos se hicieron con OneSource de Thomson Reuters. El cribado de hoy sale de Capital IQ —es
   la única fuente que el sistema usa, y por eso la ruta de tablas ya elimina las copias de
   «Códigos SIC utilizados» de Ryan LLC y Refinitiv y conserva solo la de Capital IQ
   (`tablasHtmlInforme.js`, `docxRelleno.js`)—, así que la prosa que sigue nombrando OneSource
   atribuye los estados financieros a una base de datos que nadie consultó.

   En la plantilla de referencia son dos frases seguidas dentro de «1.3 Proceso General de
   búsqueda» (`brain_estudio_pasado.txt:1055-1067`):

     «…el estudio y análisis estadístico del rango intercuartil sobre la base de los estados
      financieros obtenidos por medio de la base de datos OneSource de Thomson Reuters; así
      pues, el grupo de sociedades…»
     «…se realiza una búsqueda por sectores económicos y palabras claves del objeto social
      registrada en las bases de datos OneSource de Thomson Reuters con el código Standard
      Industrial Classification (SIC)…»

   SE SUSTITUYE EL NOMBRE Y NADA MÁS. «la base de datos» y «las bases de datos» los pone la
   plantilla, en singular o en plural según la frase, y se conservan tal como estén escritos:
   reescribir la frase alrededor es redactar, no corregir un dato.

   LO QUE NO TOCA. La fuente al pie de las tablas —«Información Base Datos ONESOURCE (Thomson
   Reuters)»— no lleva el conector «de» y queda fuera del patrón a propósito: esa la escribe el
   generador de cada tabla desde `estudio.database_source` (`docxRelleno.js`), que es otro sitio
   con su propia decisión. Si esa fuente también debe cambiar, se cambia allí.

   POR PÁRRAFO Y SOBRE EL TEXTO VISIBLE, como el resto de la prosa del informe: Word parte una
   frase en varios `<w:t>` en cuanto cambia el formato o pasa el corrector, así que un `replace`
   sobre el XML no encuentra «OneSource de Thomson Reuters» aunque el lector la lea seguida. Con
   `textoVisibleConMapa` la búsqueda va sobre lo que se lee y la escritura vuelve al tramo exacto
   del original.
   ───────────────────────────────────────────────────────────────────────────── */

import { PARRAFO_HTML, textoVisibleConMapa, escribirEnTextoVisible } from './prosaVecindad.js';

/* La base de datos que el sistema usa hoy, escrita como la pidió el usuario (2026-08-20). */
export const BASE_DATOS_ACTUAL = "Capital IQ de Standard & Poor's";

export const AVISO_BASE_DATOS = 'la plantilla nombra una base de datos anterior (OneSource / '
  + 'Thomson Reuters) en un giro que no se reconoció: revise que el informe no atribuya los '
  + 'comparables a una base que no se consultó';

/* «OneSource de Thomson Reuters», con lo que varía entre plantillas: «One Source» separado, el
   guion en «Thomson-Reuters» y la cola «-Refinitiv Fundamentals» que arrastran los informes
   posteriores a la compra. Los espacios van flexibles porque el lector de PDF entrega la frase
   con el salto de línea de la página en medio.

   Sin `\b` al final de «Reuters»: la plantilla escribe «Reuters;» y «Reuters.» y el límite de
   palabra ya lo da el propio patrón. */
const RX_BASE_VIEJA = /One\s*Source\s+de\s+Thomson\s*[-–—]?\s*Reuters(?:\s*[-–—]\s*Refinitiv(?:\s+Fundamentals)?)?/gi;

/* Cualquier rastro de la base vieja. Sirve para dos cosas: descartar de entrada los párrafos que
   no la mencionan —son casi todos, y así no se paga el mapa de caracteres por párrafo en un
   documento de trescientas páginas— y avisar cuando queda una mención que el patrón de arriba no
   supo sustituir. */
const RX_RASTRO = /One\s*Source|Thomson\s*[-–—]?\s*Reuters/i;

/* La fuente al pie de una tabla, que NO cuenta para el aviso. La escribe el generador de cada
   tabla desde `estudio.database_source`, así que aparece en todos los informes: avisar por ella
   sería un recado en cada corrida sobre algo que este módulo no gobierna. Se reconoce por las dos
   formas en que se presenta, el rótulo «Información Base Datos …» y el nombre seguido de su
   paréntesis. */
const RX_PIE_DE_TABLA = /Informaci[óo]n\s+Base\s+Datos[^.]*|One\s*Source\s*\([^)]*\)/gi;

/* Solo `&` y `<`: el texto se escribe dentro de un `<w:t>` o entre dos etiquetas de HTML, y son
   los dos caracteres que allí no pueden ir crudos. «Standard & Poor's» trae uno. */
const escaparParaMarcado = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * Pone en la prosa el nombre de la base de datos de la que salieron los comparables.
 *
 * No recibe el estudio a propósito: el nombre no es un dato del contribuyente ni depende del
 * año, es la fuente que usa el sistema. El día que el sistema consulte otra, cambia la
 * constante y no la firma.
 *
 * @param {string} texto  el OOXML de `word/document.xml`, o el HTML renderizado.
 * @param {string[]} [avisos]  se le agrega `AVISO_BASE_DATOS` si queda una mención sin cambiar.
 * @param {{rxParrafo?:RegExp}} [opciones]  delimitador de párrafo; `PARRAFO_HTML` por defecto.
 * @returns {string} el texto con el nombre de la base de datos actualizado donde se pudo.
 */
export function actualizarProsaBaseDatos(texto, avisos, opciones = {}) {
  const fuente = String(texto || '');
  if (!fuente || !RX_RASTRO.test(fuente)) return fuente;

  const rxParrafo = opciones.rxParrafo || PARRAFO_HTML;
  const nuevo = escaparParaMarcado(BASE_DATOS_ACTUAL);
  let quedaRastro = false;

  const salida = fuente.replace(rxParrafo, (parrafo) => {
    const mapa = textoVisibleConMapa(parrafo);
    if (!mapa.plano || !RX_RASTRO.test(mapa.plano)) return parrafo;

    const escrituras = [];
    RX_BASE_VIEJA.lastIndex = 0;
    let m;
    while ((m = RX_BASE_VIEJA.exec(mapa.plano)) !== null) {
      escrituras.push({ inicio: m.index, fin: m.index + m[0].length, texto: nuevo });
      /* Una coincidencia vacía no puede darse con este patrón, pero dejar el avance al
         `lastIndex` del propio motor es lo que evita el bucle infinito si alguien lo relaja. */
      if (m.index === RX_BASE_VIEJA.lastIndex) RX_BASE_VIEJA.lastIndex += 1;
    }

    /* Lo que el patrón no alcanzó: la plantilla nombra la base vieja de otra manera —«la base
       de datos OneSource» a secas, por ejemplo— y eso no se adivina, se avisa. */
    const resto = mapa.plano
      .replace(RX_BASE_VIEJA, BASE_DATOS_ACTUAL)
      .replace(RX_PIE_DE_TABLA, ' ');
    if (RX_RASTRO.test(resto)) quedaRastro = true;
    if (!escrituras.length) return parrafo;

    return escribirEnTextoVisible(parrafo, mapa, escrituras);
  });

  if (quedaRastro && Array.isArray(avisos) && !avisos.includes(AVISO_BASE_DATOS)) {
    avisos.push(AVISO_BASE_DATOS);
  }

  return salida;
}
