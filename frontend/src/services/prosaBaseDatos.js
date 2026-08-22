/* ─────────────────────────────────────────────────────────────────────────────
   prosaBaseDatos.js — el nombre de la base de datos de la que salieron los comparables, allí
   donde el informe lo escribe.

   POR QUÉ. La plantilla de cada cliente es su propio informe del año anterior, y los informes
   viejos se hicieron con OneSource de Thomson Reuters. El cribado de hoy sale de Capital IQ —es
   la única fuente que el sistema usa, y por eso la ruta de tablas ya elimina las copias de
   «Códigos SIC utilizados» de Ryan LLC y Refinitiv y conserva solo la de Capital IQ
   (`tablasHtmlInforme.js`, `docxRelleno.js`)—, así que el informe que sigue nombrando OneSource
   atribuye los estados financieros a una base de datos que nadie consultó.

   DOS FORMAS, DOS ESCRITURAS. El nombre aparece en el informe de dos maneras distintas, y cada
   una pide la suya:

     · En prosa, dentro de la frase: «…obtenidos por medio de la base de datos OneSource de
       Thomson Reuters…». El giro «la base de datos» lo pone la plantilla, así que aquí solo cabe
       el nombre con su proveedor detrás: «Capital IQ de Standard & Poor's».
     · Al pie de una tabla, como cita: «Información Base Datos ONESOURCE (Thomson Reuters).
       Fecha de consulta: julio de 2024». Ahí el proveedor va entre paréntesis, que es como lo
       escriben todas las plantillas vistas: «Capital IQ (Standard & Poor's)».

   En «1.3 Proceso General de búsqueda» son dos frases seguidas
   (`brain_estudio_pasado.txt:1055-1067`):

     «…el estudio y análisis estadístico del rango intercuartil sobre la base de los estados
      financieros obtenidos por medio de la base de datos OneSource de Thomson Reuters; así
      pues, el grupo de sociedades…»
     «…se realiza una búsqueda por sectores económicos y palabras claves del objeto social
      registrada en las bases de datos OneSource de Thomson Reuters con el código Standard
      Industrial Classification (SIC)…»

   SE SUSTITUYE EL NOMBRE Y NADA MÁS. «la base de datos», «las bases de datos» e «Información
   Base Datos» los pone la plantilla, en singular o en plural según la frase, y se conservan tal
   como estén escritos: reescribir la frase alrededor es redactar, no corregir un dato. La fecha
   de consulta tampoco se toca: no es esto lo que la gobierna.

   POR QUÉ TAMBIÉN LOS PIES. Los pies que el motor regenera ya salen con la base actual —los
   escribe cada tabla desde `estudio.database_source`, con `BASE_DATOS_FUENTE` por defecto—, pero
   hay pies que el motor no reescribe: en la ruta del PDF la nota de fuente que vive DENTRO de la
   tabla se conserva de la plantilla a propósito, para no perder su formato. Sin este módulo,
   esos se radicaban citando Thomson Reuters bajo una tabla con comparables de Capital IQ.

   POR PÁRRAFO Y SOBRE EL TEXTO VISIBLE, como el resto de la prosa del informe: Word parte una
   frase en varios `<w:t>` en cuanto cambia el formato o pasa el corrector, así que un `replace`
   sobre el XML no encuentra «OneSource de Thomson Reuters» aunque el lector la lea seguida. Con
   `textoVisibleConMapa` la búsqueda va sobre lo que se lee y la escritura vuelve al tramo exacto
   del original.
   ───────────────────────────────────────────────────────────────────────────── */

import { PARRAFO_HTML, textoVisibleConMapa, escribirEnTextoVisible } from './prosaVecindad.js';

/* La base de datos que el sistema usa hoy, en sus dos formas (2026-08-20). Un solo sitio para
   las dos: si mañana el cribado sale de otra parte, se cambian aquí y con ellas cambian la prosa
   y los pies de todas las tablas de las dos rutas. */
export const BASE_DATOS_ACTUAL = "Capital IQ de Standard & Poor's";
export const BASE_DATOS_FUENTE = "Capital IQ (Standard & Poor's)";

export const AVISO_BASE_DATOS = 'la plantilla nombra una base de datos anterior (OneSource / '
  + 'Thomson Reuters) en un giro que no se reconoció: revise que el informe no atribuya los '
  + 'comparables a una base que no se consultó';

/* ══════════ La cita al pie de cada tabla del motor ══════════

   Estaba escrita en SIETE sitios —cuatro en la ruta de OOXML y tres en la de HTML—, cada
   uno con su sufijo: unos cerraban con punto, otros no, y dos añadían «Fecha de consulta:
   septiembre de <año>» con el mes escrito a mano. Ese «septiembre» venía del informe de
   referencia y se radicaba igual en un estudio consultado en otro mes.

   Aquí se arma una sola vez, con la fecha de consulta REAL cuando el estudio la tiene:
   `database_consulta`, que se sella al importar el export de Capital IQ. Cuando no la
   tiene no se inventa —es el mismo criterio de `analisisMercado.js` con las fuentes
   macroeconómicas— y la cita sale sin fecha; el generador lo anota en los avisos para que
   el analista sepa que el informe va sin ella. El numeral 4 del artículo 1.2.2.2.1.5 del
   Decreto 1625 de 2016 la exige, así que la ausencia importa. */

/** Mes y año de consulta, «agosto de 2026», o cadena vacía si el estudio no la registró. */
export function fechaConsultaBaseDatos(estudio) {
  const bruto = estudio && estudio.database_consulta;
  if (!bruto) return '';
  const fecha = typeof bruto.toDate === 'function' ? bruto.toDate() : new Date(bruto);
  if (Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleDateString('es-CO', { year: 'numeric', month: 'long' });
}

/**
 * La cita al pie de una tabla armada con datos de la base: «Información Base Datos Capital
 * IQ (Standard & Poor's). Fecha de consulta: agosto de 2026.»
 *
 * El nombre de la base sale de `estudio.database_source` y por defecto de
 * `BASE_DATOS_FUENTE`, para que cambiar de proveedor siga siendo un solo sitio.
 */
export function citaBaseDatos(estudio) {
  const base = (estudio && estudio.database_source) || BASE_DATOS_FUENTE;
  const fecha = fechaConsultaBaseDatos(estudio);
  return `Información Base Datos ${base}.` + (fecha ? ` Fecha de consulta: ${fecha}.` : '');
}

/** `true` si la cita va a salir sin fecha de consulta, para poder avisarlo. */
export function faltaFechaConsulta(estudio) {
  return !fechaConsultaBaseDatos(estudio);
}

export const AVISO_SIN_FECHA_CONSULTA = 'el estudio no registra cuándo se consultó la base '
  + 'de datos, así que las tablas del motor salen sin fecha de consulta: vuelva a importar '
  + 'el export de Capital IQ en el paso 3 para sellarla (el numeral 4 del artículo '
  + '1.2.2.2.1.5 del Decreto 1625 de 2016 la exige)';

/* El proveedor viejo tal como lo escriben las plantillas, con lo que varía entre ellas: el guion
   de «Thomson-Reuters» y la cola «-Refinitiv Fundamentals» que arrastran los informes
   posteriores a la compra. */
const PROVEEDOR_VIEJO = 'Thomson\\s*[-–—]?\\s*Reuters(?:\\s*[-–—]\\s*Refinitiv(?:\\s+Fundamentals)?)?';

/* Qué se busca y con qué se reemplaza, de la forma más específica a la menos. El orden importa:
   una coincidencia que solape con otra ya aceptada se descarta, así que «ONESOURCE (Thomson
   Reuters)» se resuelve como cita de pie y no como el nombre suelto del tercer patrón. */
const SUSTITUCIONES = [
  /* En prosa: «la base de datos OneSource de Thomson Reuters». Los espacios van flexibles porque
     el lector de PDF entrega la frase con el salto de línea de la página en medio. */
  {
    rx: new RegExp('One\\s*Source\\s+de\\s+' + PROVEEDOR_VIEJO, 'gi'),
    texto: BASE_DATOS_ACTUAL,
  },
  /* Al pie de una tabla, con el proveedor entre paréntesis. */
  {
    rx: new RegExp('One\\s*Source\\s*\\(\\s*' + PROVEEDOR_VIEJO + '\\s*\\)', 'gi'),
    texto: BASE_DATOS_FUENTE,
  },
  /* Al pie, sin proveedor: «Información Base Datos ONESOURCE.». Se exige el rótulo delante para
     no tocar un «OneSource» suelto en medio de una frase, que sin más contexto no se sabe si es
     la base de datos o el nombre de un producto en la descripción de una comparable. */
  {
    rx: /(?<=Base\s+Datos\s+)One\s*Source\b/gi,
    texto: BASE_DATOS_FUENTE,
  },
];

/* Solo `&` y `<`: el texto se escribe dentro de un `<w:t>` o entre dos etiquetas de HTML, y son
   los dos caracteres que allí no pueden ir crudos. «Standard & Poor's» trae uno, y sin escaparlo
   no es solo que el OOXML quede mal formado: el propio lector de texto visible ve «& Poor's;» y
   lo interpreta como una entidad, así que se come el nombre del proveedor. */
const escaparParaMarcado = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* Cualquier rastro de la base vieja. Sirve para dos cosas: descartar de entrada los párrafos que
   no la mencionan —son casi todos, y así no se paga el mapa de caracteres por párrafo en un
   documento de trescientas páginas— y avisar cuando queda una mención que ningún patrón supo
   sustituir. */
const RX_RASTRO = new RegExp('One\\s*Source|' + PROVEEDOR_VIEJO, 'i');

/**
 * Pone el nombre de la base de datos de la que salieron los comparables, en la prosa y en las
 * citas al pie de las tablas.
 *
 * No recibe el estudio a propósito: el nombre no es un dato del contribuyente ni depende del
 * año, es la fuente que usa el sistema. El día que el sistema consulte otra, cambian las dos
 * constantes de arriba y no la firma.
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
  let quedaRastro = false;

  const salida = fuente.replace(rxParrafo, (parrafo) => {
    const mapa = textoVisibleConMapa(parrafo);
    if (!mapa.plano || !RX_RASTRO.test(mapa.plano)) return parrafo;

    const escrituras = [];
    /* Lo que ya se resolvió no se vuelve a tocar: dos patrones pueden casar sobre el mismo
       trozo y escribir dos veces ahí dejaría el texto partido. */
    const ocupado = (inicio, fin) => escrituras.some((e) => inicio < e.fin && fin > e.inicio);

    for (const { rx, texto: reemplazo } of SUSTITUCIONES) {
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(mapa.plano)) !== null) {
        const inicio = m.index;
        const fin = inicio + m[0].length;
        if (!ocupado(inicio, fin)) {
          escrituras.push({ inicio, fin, texto: escaparParaMarcado(reemplazo) });
        }
        /* Ninguno de estos patrones puede casar en vacío, pero dejar el avance al `lastIndex`
           del motor es lo que evita el bucle infinito si alguien los relaja. */
        if (fin === inicio) rx.lastIndex += 1;
      }
    }

    /* Lo que ningún patrón alcanzó: la plantilla nombra la base vieja de otra manera —«la base
       de datos OneSource» a secas en medio de una frase, por ejemplo— y eso no se adivina, se
       avisa. */
    let resto = mapa.plano;
    for (const { rx, texto: reemplazo } of SUSTITUCIONES) resto = resto.replace(rx, reemplazo);
    if (RX_RASTRO.test(resto)) quedaRastro = true;

    if (!escrituras.length) return parrafo;
    return escribirEnTextoVisible(parrafo, mapa, escrituras);
  });

  if (quedaRastro && Array.isArray(avisos) && !avisos.includes(AVISO_BASE_DATOS)) {
    avisos.push(AVISO_BASE_DATOS);
  }

  return salida;
}
