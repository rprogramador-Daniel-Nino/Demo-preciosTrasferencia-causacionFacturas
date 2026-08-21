/* ─────────────────────────────────────────────────────────────────────────────
   docxRelleno.js — RELLENAR la plantilla .docx del cliente conservando su formato.

   Segunda mitad de la ruta que abre `docxPlantilla.js`. Aquí se toma el .docx ya
   marcado, se sustituyen los `{campo}` por los datos del estudio y se reempaqueta.
   El documento nunca se reconstruye: se edita su propio OOXML, así que encabezado,
   pie, estilos, fuentes, colores, bordes, sombreados, márgenes, secciones y tabla
   de contenido salen exactamente como venían.

   POR QUÉ docxtemplater Y NO SUSTITUCIÓN A MANO. Word parte una misma frase en
   varios `<w:r><w:t>` por rsid, por el corrector o por un cambio de formato, así que
   un `{ent}` puede estar repartido en tres runs y un `.replace` sobre el XML no
   encuentra nada. docxtemplater une los runs antes de resolver los marcadores, y
   además trae los bucles con los que se repiten filas de tabla conservando su
   formato. Ya estaba en las dependencias del proyecto sin que nadie lo usara.

   LAS IMÁGENES VAN A MANO. El módulo de imágenes de docxtemplater es de pago, así
   que el anexo de estados financieros se inserta escribiendo el OOXML: el binario en
   `word/media/`, la relación en `document.xml.rels`, el content-type en
   `[Content_Types].xml` y un `<w:drawing>` en el cuerpo. Es la parte frágil de este
   módulo —el spec 2026-08-04-docx-real-ooxml-design.md documenta esa familia de
   trampas— y por eso va después del render y con tests de estructura.

   LO QUE ESTOS TESTS NO PUEDEN COMPROBAR: que Word abra el resultado sin quejarse.
   En esta máquina no hay con qué renderizar un .docx. Se verifica el XML emitido
   —relaciones existentes, sin identificadores repetidos, párrafos balanceados— y la
   comprobación final es manual.
   ───────────────────────────────────────────────────────────────────────────── */

import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { justificarCuerpoOoxml } from './justificarOoxml.js';
import { valorDeCampo } from './plantillaVocabulario.js';
/* El aspecto de la tabla sale de la MISMA hoja que pinta el previo y el .doc. Es lo único que
   impide que el cliente vea una tabla distinta según por qué ruta salió su informe. */
import { PUNTOS_TABLA, FUENTE_TABLA, FUENTE_MACRO, PUNTOS_MACRO } from './estiloDocumento.js';
/* La frontera de la Sección III sale de la MISMA función que la usa para decidir dónde no se
   marca ningún campo del contribuyente. Copiar aquí sus dos regex dejaría dos definiciones de
   «dónde empieza y acaba III» que se desincronizarían en el primer informe con otro título. */
import { zonaQueAbre, cierraSeccionMacro } from './plantillaMarcador.js';
import { FORMULAS, ROTULOS_FORMULA, ooxmlDeFormula } from './formulasOmml.js';
import {
  filasOperacionesDeIngreso, filasOperacionAnalizar, filasTransaccionesIntercompania,
  filasMetodoAplicable, filasCompaniasVinculadas, filasCriteriosVinculacion,
  filasOperacionAdicional, filasOperacionAdicionalFicha, tieneOperacionAdicional,
  NOMBRES_TABLA_ADICIONAL, NOMBRES_TABLA_TRANSACCIONES,
} from './tablasOperaciones.js';
/* `verticalSobreActivos` se reexporta al final: vivía aquí y hay quien la importa de
   este módulo. Su definición se mudó con la Tabla 10, que es quien la usa. */
import {
  filasComposicionAccionaria, filasActivos, verticalSobreActivos,
} from './tablasContribuyente.js';

export { verticalSobreActivos };
import {
  filasComparablesInforme, filasRazonesRechazo, filasMuestraComparables,
  filasRangoIntercuartil, tablasMacroInforme, ETIQUETAS_RANGO, AMBITO,
  enMayusculas, filasEnMayusculas, filasCriteriosScreening, NOMBRES_TABLA_MARGENES,
} from './tablasInforme.js';
/* El ANEXO C se arma con los mismos grupos, letras y conteos que la ruta HTML: una sola
   definición de la matriz para las dos salidas del informe. */
import {
  gruposDelAnexoC, filasResumenAnexoC, tituloDeGrupoAnexoC,
} from './anexoCHtml.js';
/* Qué anexo es cada uno se decide por su NOMBRE y no por su letra, con la misma tabla que
   usa la ruta de plantilla marcada (`anexoBHtml.js`): la numeración es de cada informe y
   no se repite entre clientes. */
import {
  interpretarEncabezadoAnexo, resolverAnexos, rotuloAnexo, nombreDeAnexo,
} from './anexosPlantilla.js';
import { pctf, fmt, num } from '../utils/calculations.js';
import { nameKey } from './comparablesEngine.js';
/* Para insertar una imagen con SU proporción y no con la de una hoja supuesta: ver
   `medidaDeImagenAnexoB`. */
import { deBase64, dimensionesDeImagen } from './png.js';
/* La frase que comenta el rango se resuelve con la MISMA función que la ruta de plantilla PDF:
   así el informe dice lo mismo venga la plantilla base de un .docx o de un PDF. */
import { actualizarProsaRango, PARRAFO_OOXML } from './prosaRangoInforme.js';
import { actualizarProsaTablas } from './prosaTablasInforme.js';
/* El nombre de la base de datos de los comparables, por la misma función que la ruta del PDF.
   `BASE_DATOS_FUENTE` es además el valor por defecto de la cita al pie de cada tabla del motor:
   una sola definición para la prosa y para los pies, en las dos rutas. */
import { actualizarProsaBaseDatos, BASE_DATOS_FUENTE } from './prosaBaseDatos.js';

/* Misma resolución fuente+fecha que ya usan las tablas macro (`tablasMacroInforme` en
   `tablasInforme.js`, que llama a esta función): así el párrafo de narrativa y la tabla
   de la misma serie que va justo debajo citan la fuente en el mismo formato, con la
   misma fecha de consulta. Sin riesgo de import circular: `analisisMercado.js` no
   importa de este módulo ni de `tablasHtmlInforme.js`. */
import {
  resolverSerie, filasDatosClaveSector, cabecerasDatosClaveSector, tituloDatosClaveSector,
  fuenteDatosClaveSector, titulosSectorial, citaDeSerie, fuentesDelSector,
} from './analisisMercado.js';
/* Las fuentes de la Sección III se publican como notas al pie, en formato bibliográfico y con el
   enlace clicable, en vez de como una línea «FUENTE:» con las URL crudas en el cuerpo. */
import { citaApa, citasApa } from './citasApa.js';
import {
  anclarEnUltimoParrafo, crearRecolectorDeNotas, siguienteIdDeNota, estilosDeNota,
  agregarNotasAlPie, relsDeNotasAlPie, idsDeRelacionLibres, contentTypesConNotasAlPie,
  relsDocumentoConNotasAlPie,
} from './notasAlPieOoxml.js';

/** EMU (English Metric Units) por centímetro: la unidad de medida de OOXML. */
export const EMU_POR_CM = 360000;

/** Ancho útil por defecto, en cm: A4 (21) menos 2,5 de margen a cada lado. */
const ANCHO_UTIL_CM = 16;

/* Ancho de la caja de texto de VERDAD, en cm: los 9405 twips con los que
   `generarTablaOoxml` fija el ancho de todas las tablas del informe, que son los que
   deja la hoja carta (21,59 cm) con 2,5 de margen a cada lado. `ANCHO_UTIL_CM` se
   calculó sobre A4 y por eso se queda 6 mm corto; no se corrige ahí porque lo comparten
   `insertarImagenes` e `insertarAnexoA`, y moverlo cambiaría el alto de las páginas del
   ANEXO A —que se deriva de él— sin que nadie lo haya pedido. */
const ANCHO_CAJA_CM = (9405 / 1440) * 2.54;

/* Alto máximo de una imagen del ANEXO B, en cm. La hoja carta deja 23,44 cm útiles
   (27,94 menos 2,5 arriba y 2 abajo); se deja algo de holgura para que la imagen no
   empuje sola un salto de página. */
const ALTO_MAX_ANEXO_B_CM = 22;

/**
 * A qué tamaño va una imagen del ANEXO B: al ancho de la caja de texto, con SU
 * proporción real.
 *
 * Antes el alto se calculaba con la proporción de un A4 (`ancho * 297/210` = 22,63 cm)
 * pasara lo que pasara con la imagen. Eso hacía dos cosas mal a la vez: estiraba
 * cualquier imagen que no fuera un A4 vertical, y con 22,63 cm de alto ya no cabía
 * debajo de la tabla de descripción de su comparable, así que cada estado financiero se
 * llevaba una página entera del informe.
 *
 * @param {Uint8Array|null} bytes  la imagen ya decodificada de base64.
 * @returns {{anchoCm:number, altoCm:number}}
 */
export function medidaDeImagenAnexoB(bytes) {
  const dim = bytes ? dimensionesDeImagen(bytes) : null;
  /* Sin dimensiones legibles se conserva la suposición de siempre —una hoja vertical—,
     pero pasando por el mismo tope de alto: es peor que medirla, y no hay por qué
     dejarla además más alta que la hoja. */
  const proporcion = dim && dim.ancho ? dim.alto / dim.ancho : 297 / 210;

  let anchoCm = ANCHO_CAJA_CM;
  let altoCm = anchoCm * proporcion;
  /* Una página completa sigue siendo más alta que el tope: se limita por el alto y el
     ancho se reduce en la misma proporción, para no deformarla. */
  if (altoCm > ALTO_MAX_ANEXO_B_CM) {
    altoCm = ALTO_MAX_ANEXO_B_CM;
    anchoCm = altoCm / proporcion;
  }
  return { anchoCm, altoCm };
}

/* Dónde va el anexo de estados financieros. Es un párrafo con este texto, que el
   marcado deja en la plantilla y aquí se sustituye por las imágenes. */
export const CENTINELA_ANEXO = '@@ANEXO_EEFF@@';

const RUTA_RELS = 'word/_rels/document.xml.rels';
const RUTA_CT = '[Content_Types].xml';
/* Donde viven las notas al pie y los enlaces de sus citas. El segundo no existe en una plantilla
   cuyas notas son solo texto —el caso de END GAME—, así que se crea al publicar la primera. */
const RUTA_FOOTNOTES = 'word/footnotes.xml';
const RUTA_FOOTNOTES_RELS = 'word/_rels/footnotes.xml.rels';
const RUTA_DOC = 'word/document.xml';

/** El valor que se escribe cuando un campo no tiene dato. */
export const SIN_DATO = '—';

/** Nombre con el que la plantilla del cliente rotula la tabla de criterios de búsqueda.
 *  No se importa de `tablasHtmlInforme.js`: esa dirección de import ya existe al revés
 *  (`tablasHtmlInforme.js` importa `claveTitulo`/`numeroDeTabla` de aquí), y traer la
 *  constante desde allí crearía un ciclo. */
const TABLA_CRITERIOS = 'Códigos SIC utilizados';


/**
 * Los datos de las tablas que se repiten, con la forma que esperan los bucles.
 *
 * Sale de las mismas funciones que alimentan la ruta de HTML —`filasComparablesInforme`
 * y `filasRazonesRechazo`, ambas sin una línea de markup—, y no de un cálculo propio.
 * No es una preferencia de estilo: los márgenes que publica la tabla tienen que ser
 * los que sustentan el rango intercuartil que el informe declara unas páginas más
 * adelante, y para eso los dos números han de venir del mismo `analizarRango`.
 *
 * @param {object} estudio
 * @returns {{comparables:Array, razonesRechazo:Array}}
 */
export function coleccionesDelEstudio(estudio) {
  const study = estudio || {};

  /* En mayúscula, como las otras dos rutas hacia esta misma tabla. Estas colecciones alimentan
     el bucle de la plantilla .docx marcada (`envolverTablaEnBucle`), que es la tercera: sin
     esto el informe salía en mayúscula por dos caminos y en caja mixta por el otro. Las
     razones de rechazo y los accionistas, más abajo, se quedan como están. */
  const comparables = filasComparablesInforme(study).map((f, i) => ({
    n: String(i + 1),
    nombre: enMayusculas(f.nombre),
    ambito: AMBITO[f.amb] || '',
    margen: pctf(f.noAjustado),
    margenAjustado: pctf(f.ajustado),
  }));

  const { filas } = filasRazonesRechazo(study.embudoSeleccion);
  const razonesRechazo = (filas || []).map((f) => ({
    letra: f.letra,
    criterio: f.etiqueta,
    cantidad: String(f.cuantas),
  }));

  const accionistas = (study.accionistas || []).map((a, i) => ({
    n: String(i + 1),
    nombre: a.nombre || '',
    pais: a.pais || '',
    acciones: a.acciones ? fmt(num(a.acciones)) : '',
    valorCapital: a.valor_capital ? fmt(num(a.valor_capital)) : '',
    participacion: a.participacion_pct ? String(a.participacion_pct) : '',
  }));

  return { comparables, razonesRechazo, accionistas };
}

function escaparXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Genera el XML de una tabla limpia y estilizada en OOXML. */
export function generarTablaOoxml(titulo, cabeceras, filas, fuente) {
  const colCount = cabeceras.length;
  const colWidth = Math.round(9405 / colCount); // 9405 dxa es el ancho útil aproximado

  /* Tipografía de la celda, la misma para toda la tabla y sin heredar del documento: antes no
     se declaraba ninguna, así que la misma tabla salía a 12 pt en un informe y a 10 en otro
     según la letra que el extractor hubiera leído del PDF. OOXML mide en medios puntos. */
  const letra = `<w:rFonts w:ascii="${FUENTE_TABLA}" w:hAnsi="${FUENTE_TABLA}"/>`
    + `<w:sz w:val="${PUNTOS_TABLA * 2}"/>`;
  /* Un borde de la rejilla. `sz` va en octavos de punto: los 6 de la rejilla son el 1px del
     modelo y los 12 del contorno, sus 1,5px. */
  const borde = (lado, sz) => `<w:${lado} w:val="single" w:sz="${sz}" w:space="0" w:color="000000"/>`;
  const celda = (texto, cabecera) =>
    `<w:tc><w:tcPr><w:tcW w:w="${colWidth}" w:type="dxa"/>`
    + (cabecera ? `<w:shd w:val="clear" w:color="auto" w:fill="999999"/>` : '')
    + `<w:vAlign w:val="center"/></w:tcPr>`
    + `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr>${letra}`
    + (cabecera ? `<w:color w:val="000000"/><w:b/>` : '')
    + `</w:rPr><w:t>${escaparXml(texto)}</w:t></w:r></w:p></w:tc>`;

  let xml = `<w:p><w:pPr><w:keepNext/><w:outlineLvl w:val="9"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${escaparXml(titulo)}</w:t></w:r></w:p>`;
  xml += `<w:tbl>`;
  /* Rejilla negra completa. Antes `left`, `right` e `insideV` eran `none` y el resto un gris
     claro (#E2E8F0): la tabla salía sin bordes verticales mientras el previo los pintaba.
     `tblCellMar` es el `padding:5px 6px` del modelo en twips —Word trae 108 a los lados y CERO
     arriba y abajo por defecto, así que sin esto las filas del archivo salen más apretadas—. */
  xml += `<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9405" w:type="dxa"/><w:tblBorders>`
    + borde('top', 12) + borde('bottom', 12) + borde('left', 12) + borde('right', 12)
    + borde('insideH', 6) + borde('insideV', 6)
    + `</w:tblBorders>`
    + `<w:tblCellMar><w:top w:w="75" w:type="dxa"/><w:left w:w="90" w:type="dxa"/>`
    + `<w:bottom w:w="75" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar>`
    + `</w:tblPr>`;

  // Headers
  xml += `<w:tr><w:trPr><w:tblHeader/></w:trPr>`;
  cabeceras.forEach((h) => { xml += celda(h, true); });
  xml += `</w:tr>`;

  // Rows
  filas.forEach((f) => {
    xml += `<w:tr>`;
    f.forEach((c) => { xml += celda(c, false); });
    xml += `</w:tr>`;
  });

  xml += `</w:tbl>`;

  if (fuente) {
    xml += `<w:p><w:pPr><w:pStyle w:val="Normal"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:b/></w:rPr><w:t>FUENTE: ${escaparXml(fuente)}</w:t></w:r></w:p>`;
  }

  return xml;
}

/** Mismo texto y misma referencia normativa que `marcadorPendiente` de
 *  `analisisMercado.js` — no se importa de ahí para no acoplar la ruta .docx a la
 *  ruta HTML por un solo texto; si cambia la redacción legal, cambia en los dos sitios
 *  a propósito. */
function marcadorApartadoPendiente(tema, year) {
  return '[Actualizar con el análisis del panorama de la economía ' + tema + ' del año gravable ' +
    year + ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]';
}

/** Línea "FUENTE: <fuente>" para un párrafo de narrativa con tema propio, a partir del
 *  texto YA formateado por `resolverSerie` (analisisMercado.js) — mismo texto,
 *  paréntesis alrededor de la URL y fecha de consulta incluidos, que la tabla de esa
 *  misma serie imprime justo debajo (`tablasMacroInforme` en `tablasInforme.js`, que
 *  también llama a `resolverSerie`). Antes este módulo reformateaba `fuente`/`fuenteUrl`
 *  por su cuenta ("FUENTE: <fuente>, <url>", sin fecha) y el resultado no coincidía con
 *  el pie de la tabla ni citaba la fecha que exige el numeral 4 del artículo
 *  1.2.2.2.1.5 del Decreto 1625 de 2016; ahora reutiliza la misma resolución.
 *  Vacío si `fuenteTexto` viene vacío (`conclusiones`, que es síntesis y no cita una
 *  serie nueva, no llama a esta función con nada que mostrar). */
function parrafoFuenteOoxml(fuenteTexto) {
  if (!fuenteTexto) return '';
  const texto = 'FUENTE: ' + fuenteTexto;
  return `<w:p><w:pPr><w:pStyle w:val="Normal"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:b/></w:rPr><w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r></w:p>`;
}

/** Marcador para un hueco intermedio de III.A/III.B con tema propio (inflación
 *  mundial, política monetaria, TRM, etc.) sin narrativa lista para ESE tema —
 *  distinto de `marcadorApartadoPendiente`, que es solo para los dos apartados
 *  líderes ("mundial"/"colombiana") y usa otra redacción legal ya fijada. */
function marcadorTemaMacroPendiente(tema, year) {
  return '[Actualizar con datos verificados sobre ' + tema + ' para el año gravable ' + year +
    ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]';
}

/**
 * Reemplaza la PROSA (no las tablas) de III.A y III.B, localizándola por su encabezado,
 * para que deje de depender de que el marcado con IA la haya marcado como
 * `ia.economia_mundial`/`ia.economia_colombia` (`plantillaVocabulario.js`).
 *
 * Las tablas de cada apartado quedan intactas aquí — las sigue actualizando
 * `actualizarTablasMacroOoxml` después, por su propio encabezado.
 *
 * @param {string} xml
 * @param {object|null} datosMacro  el documento `analisisMercado/actual` de Firestore.
 * @param {number} year
 * @param {string[]} [avisos]  nombres de apartado que no se pudieron localizar o que
 *        quedaron con el marcador de pendiente por falta de narrativa.
 * @returns {string}
 */
/** Marcador genérico para un hueco intermedio (entre dos tablas) que tenía prosa
 *  sustancial del informe de referencia y no hay una narrativa específica de ese
 *  tema para reemplazarla — a diferencia del hueco líder de cada apartado, que sí
 *  tiene la narrativa completa de Firestore. */
function marcadorContenidoRetirado() {
  return '[Este párrafo del informe de referencia se retiró porque describía cifras y ' +
    'hechos de otro contribuyente. Redáctelo con información propia de este año antes ' +
    'de radicar.]';
}

/** Longitud de texto plano a partir de la cual un hueco intermedio se considera
 *  "con prosa real" y se reemplaza. Los huecos vacíos de la plantilla —un
 *  subtítulo sin narrativa antes de la tabla— quedan bajo este umbral y no se
 *  tocan: no hay nada del cliente de referencia que retirar ahí. */
const UMBRAL_HUECO_CON_PROSA = 50;

/** Contenido para un hueco intermedio: el marcador SOLO si había prosa sustancial
 *  que retirar; si el hueco ya estaba vacío o casi vacío, no se toca. */
function contenidoHuecoIntermedio(textoHueco) {
  if (textoHueco.trim().length < UMBRAL_HUECO_CON_PROSA) {
    console.log('[docxRelleno] hueco corto (' + textoHueco.trim().length + ' car.), se deja como está: '
      + JSON.stringify(textoHueco.trim().slice(0, 40)));
    return null;
  }
  return `<w:p><w:r><w:t xml:space="preserve">${escaparXml(marcadorContenidoRetirado())}</w:t></w:r></w:p>`;
}

/**
 * Publica la fuente de un bloque de narrativa: nota al pie si se puede, línea «FUENTE:» si no.
 *
 * La nota al pie es lo que pidió el usuario (2026-08-20) y lo que hace el resto del informe: las
 * URL crudas entre paréntesis ocupaban media página en el cuerpo del documento. Pero una nota al
 * pie NO SE PUEDE CREAR SIN EL PAQUETE: necesita `word/footnotes.xml`, su relación y su content
 * type, y esta función solo ve un trozo de `word/document.xml`. Quien tiene el .docx entero
 * —`rellenarDocx`— pasa un recolector; quien llama con un fragmento suelto, no, y entonces la
 * línea «FUENTE:» sigue siendo la única forma de citar sin perder el dato.
 *
 * @param {string} parrafos  la narrativa ya en OOXML.
 * @param {object} datosCita  lo que `citaDeSerie`/`fuentesDelSector` devuelven.
 * @param {Function} fuenteEnLinea  la cadena de la línea «FUENTE:», solo si hay que caer a ella.
 * @param {object|null} notas  el recolector de notas al pie.
 * @returns {string}
 */
function conFuenteCitada(parrafos, datosCita, fuenteEnLinea, notas) {
  if (notas) {
    const ref = notas.referencia(citaApa(datosCita), datosCita && datosCita.url);
    if (ref) return anclarEnUltimoParrafo(parrafos, ref);
    /* Sin cita que publicar no se ancla un número que no lleva a ninguna nota. */
    return parrafos;
  }
  return parrafos + parrafoFuenteOoxml(fuenteEnLinea ? fuenteEnLinea() : '');
}

export function actualizarApartadosMacroOoxml(xml, datosMacro, year, avisos, notas = null) {
  const doc = sustituidorDeTablas(xml, null);

  const tituloMundial = 'Análisis del Panorama de la Economía Mundial';
  const tituloColombia = 'Análisis del panorama de la economía colombiana';
  const narrativa = (datosMacro && datosMacro.narrativa) || {};
  console.log('[docxRelleno] actualizarApartadosMacroOoxml: año ' + year
    + ', narrativa mundial: ' + (narrativa.mundial ? 'sí' : 'no (marcador)')
    + ', narrativa colombia: ' + (narrativa.colombia ? 'sí' : 'no (marcador)'));

  const primerHueco = (narrativaHtml, tema) => () => (
    narrativaHtml
      ? parrafosOoxmlDesdeHtml(narrativaHtml)
      : `<w:p><w:r><w:t xml:space="preserve">${escaparXml(marcadorApartadoPendiente(tema, year))}</w:t></w:r></w:p>`
  );

  /** Hueco intermedio con tema propio: párrafo + FUENTE si hay narrativa para ese
   *  tema; marcador específico (no el genérico) si no, y solo si había prosa
   *  sustancial que retirar — mismo umbral que ya aplicaba `contenidoHuecoIntermedio`
   *  a esta misma posición, para no fabricar un marcador donde el hueco ya venía
   *  vacío (p. ej. "INFLACIÓN MUNDIAL" como subtítulo corto sin desarrollo debajo).
   *  `serieClave` es la clave en `datosMacro.series` que resuelve la fuente/fecha del
   *  párrafo vía `resolverSerie` — `null` para "conclusiones", que sintetiza y no cita
   *  una serie nueva. Si `datosMacro.series[serieClave]` no trae `valores` (o falta del
   *  todo), `resolverSerie` cae al respaldo local (`DATOS_MACRO`/`FUENTES_MACRO`) igual
   *  que hace la tabla de esa misma serie: preferible citar una fuente conocida y
   *  estática a no citar ninguna, y mantiene párrafo y tabla en el mismo formato en
   *  cualquier escenario. */
  const temaHueco = (narrativaHtml, tema, serieClave) => (textoHueco) => {
    if (narrativaHtml) {
      const parrafos = parrafosOoxmlDesdeHtml(narrativaHtml);
      if (!serieClave) return parrafos;
      return conFuenteCitada(parrafos, citaDeSerie(datosMacro, serieClave),
        () => resolverSerie(datosMacro, serieClave).fuente, notas);
    }
    if (textoHueco.trim().length < UMBRAL_HUECO_CON_PROSA) return null;
    return `<w:p><w:r><w:t xml:space="preserve">${escaparXml(marcadorTemaMacroPendiente(tema, year))}</w:t></w:r></w:p>`;
  };

  reemplazarPorHitos(
    doc,
    [tituloMundial, 'PIB Mundial', 'Inflación Global', 'por Región/País', tituloColombia],
    [
      primerHueco(narrativa.mundial, 'mundial'),
      temaHueco(narrativa.inflacionMundial, 'la inflación mundial', 'inflacion_global'),
      temaHueco(narrativa.proyeccionMundial, 'la proyección de crecimiento mundial', 'crecimiento_por_region'),
    ],
    avisos,
    tituloMundial
  );

  reemplazarPorHitos(
    doc,
    [
      tituloColombia, 'PIB en Colombia', 'Inflación en Colombia', 'Intervención del Banco',
      'Tasa Representativa del Mercado',
      ['Desempleo en Colombia', 'Tasa de Desempleo', 'Mercado Laboral en Colombia'],
      'Análisis del Sector',
    ],
    [
      primerHueco(narrativa.colombia, 'colombiana'),
      temaHueco(narrativa.inflacionColombia, 'la inflación en Colombia', 'inflacion_colombia'),
      temaHueco(narrativa.politicaMonetaria, 'la política monetaria', 'tasa_intervencion'),
      temaHueco(narrativa.tasaCambio, 'la tasa de cambio (TRM)', 'trm_promedio'),
      temaHueco(narrativa.mercadoLaboral, 'el mercado laboral en Colombia', 'desempleo_colombia'),
      temaHueco(narrativa.conclusiones, 'las conclusiones del panorama económico', null),
    ],
    avisos,
    tituloColombia
  );

  if (!narrativa.mundial && Array.isArray(avisos)) avisos.push('narrativa de ' + tituloMundial);
  if (!narrativa.colombia && Array.isArray(avisos)) avisos.push('narrativa de ' + tituloColombia);

  return doc.xml;
}

/* La numeración con la que el informe del cliente rotula sus apartados: «C. », «1.4 »,
   «III. ». Es SUYA —su índice y sus referencias en el texto dependen de ella, igual que el
   «Tabla N.» que conserva `reescribirRotuloHtml`—, así que al reescribir el texto de un
   encabezado se vuelve a poner delante en vez de imponer una propia. */
const RX_PREFIJO_ENCABEZADO = /^\s*(?:[A-Z]|[IVXLC]{1,5}|\d+(?:\.\d+)*)[.)]?\s+/;

/** El prefijo de numeración de un encabezado, o cadena vacía si no lo lleva. */
export function prefijoDeEncabezado(texto) {
  const m = RX_PREFIJO_ENCABEZADO.exec(String(texto || ''));
  if (!m) return '';
  /* Sin separador (punto o paréntesis) solo cuenta como numeración si es un número o un
     romano: «Conclusiones y Perspectivas» empieza por una palabra y su primera letra no
     es un rótulo. */
  if (!/[.)]/.test(m[0]) && !/^\s*(?:[IVXLC]{1,5}|\d)/.test(m[0])) return '';
  return m[0];
}

/* ══════════════ La letra de la Sección III ══════════════

   La Sección III se lee en Arial 12 (`FUENTE_MACRO`/`PUNTOS_MACRO`) y hasta ahora no se lo decía
   nadie. En esta ruta el documento es el .docx del cliente, así que su letra la ponía el estilo
   de SU plantilla en ese punto — y la prosa que inserta `parrafosOoxmlDesdeHtml` sale sin `rPr`
   de fuente, o sea con lo que hubiera ahí. La misma sección salía en una letra distinta en cada
   informe.

   Va en UNA pasada al final y no repartida por cada emisor, porque tiene que alcanzar por igual
   lo que genera el código (prosa de III.A/III.B/III.C, marcadores de pendiente, rótulos de tabla)
   y lo que viene de la plantilla del cliente (sus encabezados, y cualquier párrafo de III que el
   motor no haya reemplazado). Repartirla dejaría fuera justo el segundo grupo. */

/* Un párrafo de OOXML. Mismo patrón que usa `localizarHitos`. Un `<w:p/>` vacío y autocerrado no
   encaja a propósito: no tiene runs que tocar. */
const RX_PARRAFO_LETRA = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

/* En `rPr` el orden de los hijos lo fija el esquema y Word pide reparar el documento si no se
   respeta: `rFonts` va al principio —sólo `rStyle` la precede— y `sz` después del color y antes
   del subrayado, así que se inserta delante del primero de estos que aparezca. */
const ANTES_DE_SZ = ['<w:highlight', '<w:u ', '<w:u/', '<w:u>', '<w:effect', '<w:bdr',
  '<w:shd', '<w:fitText', '<w:vertAlign', '<w:rtl', '<w:cs', '<w:em', '<w:lang',
  '<w:eastAsianLayout', '<w:specVanish', '<w:oMath'];

/** El `w:sz` que declara un `rPr`, en medios puntos, o null si no declara ninguno. */
function szDeRpr(rPr) {
  const m = /<w:sz\s+w:val="(\d+)"/.exec(rPr || '');
  return m ? Number(m[1]) : null;
}

/**
 * El `rPr` de un run con la letra de la Sección III puesta.
 *
 * La familia se impone siempre. El tamaño sólo si el run no declara ya uno MENOR: las líneas
 * «FUENTE: …» van a 9 pt y las citas al pie a 8, y subirlas a 12 las convertiría en cuerpo
 * (decisión del usuario, 2026-08-20). Un tamaño MAYOR sí se baja: eso es un encabezado de la
 * plantilla del cliente, y el acuerdo es que los títulos de III van a 12.
 *
 * El resto del `rPr` se conserva intacto: la negrita del rótulo de una tabla, la cursiva, y el
 * rojo del marcador de pendiente, que es un hueco que hay que ver antes de radicar.
 */
function rPrConLetraMacro(rPrInterior, negrita, modo = 'cuerpo') {
  let dentro = String(rPrInterior || '');
  const szPropio = szDeRpr(dentro);
  /* Tres tamaños, uno por sitio del informe:
     - `cuerpo`: 12 pt, salvo que el run declare uno menor (líneas «FUENTE:», citas al pie).
     - `tabla`: los 10 pt de `PUNTOS_TABLA`, impuestos, igual que hace `generarTablaOoxml` con
       las tablas que sí regenera. Es lo que deja todas las tablas del informe iguales.
     - `marca`: el de la marca de párrafo NO se toca. Los párrafos vacíos con que el informe
       separa sus bloques miden lo que mide su marca, y cambiarlo correría la paginación. */
  const sz = modo === 'tabla'
    ? PUNTOS_TABLA * 2
    : (modo === 'marca'
      ? szPropio
      : (szPropio !== null && szPropio < PUNTOS_MACRO * 2 ? szPropio : PUNTOS_MACRO * 2));
  const familia = modo === 'tabla' ? FUENTE_TABLA : FUENTE_MACRO;

  dentro = dentro
    .replace(/<w:rFonts\b[^>]*\/>/g, '')
    .replace(/<w:rFonts\b[^>]*>[\s\S]*?<\/w:rFonts>/g, '')
    .replace(/<w:sz\b[^>]*\/>/g, '')
    .replace(/<w:szCs\b[^>]*\/>/g, '');

  /* `rStyle` es el único hijo que precede a `rFonts`. */
  const rStyle = /<w:rStyle\b[^>]*\/>/.exec(dentro);
  if (rStyle) dentro = dentro.replace(rStyle[0], '');

  const letra = '<w:rFonts w:ascii="' + familia + '" w:hAnsi="' + familia +
    '" w:cs="' + familia + '"/>';
  const negritaXml = negrita && !/<w:b(?:\s[^>]*)?\/?>/.test(dentro) ? '<w:b/>' : '';
  /* Sin tamaño declarado no se inventa uno: es el caso de la marca de párrafo. */
  const tamano = sz === null ? ''
    : '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/>';

  let corte = dentro.length;
  for (const etiqueta of ANTES_DE_SZ) {
    const i = dentro.indexOf(etiqueta);
    if (i >= 0 && i < corte) corte = i;
  }
  const cuerpo = dentro.slice(0, corte) + tamano + dentro.slice(corte);
  return '<w:rPr>' + (rStyle ? rStyle[0] : '') + letra + negritaXml + cuerpo + '</w:rPr>';
}

/* La marca de párrafo, en Arial y sin cambiar de tamaño.

   De su `rPr` salen la viñeta y el número de una lista, así que sin esto el texto del renglón
   iba en Arial y su bolita en la letra de la plantilla. El tamaño no se toca: ver `modo` en
   `rPrConLetraMacro`.

   Se crea un `rPr` que no existía sólo cuando el párrafo es de una lista (`numPr`): ahí hay una
   viñeta que se ve. En los demás no se añade nada — serían miles de etiquetas por documento sin
   cambiar un píxel. En `pPr` el `rPr` va al final, que es donde lo pide el esquema. */
function marcaConLetraMacro(parrafo) {
  return parrafo.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (todo, dentro) => {
    const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(dentro);
    if (rPr) {
      return '<w:pPr>' + dentro.replace(rPr[0],
        rPrConLetraMacro(rPr[1], false, 'marca')) + '</w:pPr>';
    }
    if (!/<w:numPr[\s>]/.test(dentro)) return todo;
    return '<w:pPr>' + dentro + rPrConLetraMacro('', false, 'marca') + '</w:pPr>';
  });
}

/** Los runs de un párrafo, con la letra de la Sección III. */
function parrafoConLetraMacro(parrafo, negrita, modo = 'cuerpo') {
  const conMarca = modo === 'cuerpo' ? marcaConLetraMacro(parrafo) : parrafo;
  return conMarca.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, (run) => {
    const abre = /^<w:r(?:\s[^>]*)?>/.exec(run);
    if (!abre) return run;
    const resto = run.slice(abre[0].length);
    const conRpr = /^<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(resto);
    if (conRpr) {
      return abre[0] + rPrConLetraMacro(conRpr[1], negrita, modo) + resto.slice(conRpr[0].length);
    }
    return abre[0] + rPrConLetraMacro('', negrita, modo) + resto;
  });
}

/** Los tramos `<w:tbl>…</w:tbl>` del documento, contando el anidamiento. Un párrafo que caiga
 *  dentro de uno es una celda y no se toca: las ocho tablas de III siguen en `PUNTOS_TABLA`. */
function tramosDeTabla(xml) {
  const tramos = [];
  const rx = /<w:tbl(?:\s[^>]*)?>|<\/w:tbl>/g;
  let profundidad = 0;
  let inicio = 0;
  let m;
  while ((m = rx.exec(xml)) !== null) {
    if (m[0] === '</w:tbl>') {
      profundidad -= 1;
      if (profundidad === 0) tramos.push([inicio, m.index + m[0].length]);
      if (profundidad < 0) profundidad = 0;
      continue;
    }
    if (profundidad === 0) inicio = m.index;
    profundidad += 1;
  }
  return tramos;
}

/* ¿Es este párrafo un encabezado? Los títulos de III van a 12 EN NEGRITA (decisión del usuario,
   2026-08-20): al quedar del tamaño del cuerpo, la negrita es lo único que los distingue.

   Tres señales, y basta una. El estilo de párrafo y el nivel de esquema son lo que declara la
   plantilla del cliente; el prefijo de numeración («III. », «A. », «1.4 ») cubre al encabezado
   que llega sin estilo, con el mismo umbral de longitud que usa `localizarHitos` para no
   confundir un título con un párrafo de prosa que lo mencione de pasada. */
function esEncabezadoOoxml(parrafo, texto) {
  const estilo = /<w:pStyle\s+w:val="([^"]*)"/.exec(parrafo);
  if (estilo && /^(?:heading|t[íi]tulo|titulo)/i.test(estilo[1])) return true;
  const nivel = /<w:outlineLvl\s+w:val="(\d+)"/.exec(parrafo);
  if (nivel && Number(nivel[1]) < 9) return true;
  return texto.length <= 160 && prefijoDeEncabezado(texto) !== '';
}

/* ¿Es un encabezado de PRIMER nivel, es decir un capítulo del informe y no un subapartado?
   Es la señal que `cierraSeccionMacro` necesita para no tomar «V. Tasa de Cambio Representativa
   del Mercado» —subapartado de III.B, y encabezado legítimo— por el capítulo quinto.

   Sólo lo que el documento declara de primer nivel: «Heading1»/«Título 1» o `outlineLvl` 0. El
   prefijo de numeración NO cuenta aquí, que es justo lo que confundía los dos casos. */
function esCapituloOoxml(parrafo) {
  const estilo = /<w:pStyle\s+w:val="([^"]*)"/.exec(parrafo);
  if (estilo && /^(?:heading|t[íi]tulo|titulo)\s*1$/i.test(estilo[1].trim())) return true;
  const nivel = /<w:outlineLvl\s+w:val="(\d+)"/.exec(parrafo);
  return !!nivel && Number(nivel[1]) === 0;
}

/**
 * Pone la Sección III entera en Arial 12 —negrita en sus títulos— dejando fuera las tablas.
 *
 * La zona la delimita `zonaQueAbre`: abre en «III. TENDENCIAS DE LA ECONOMÍA», la cierra
 * cualquier capítulo romano o anexo posterior, y las entradas del índice no cuentan (terminan en
 * el número de página). Es la misma frontera que ya gobierna dónde no se marcan campos del
 * contribuyente, así que las dos no pueden discrepar sobre dónde está la sección.
 *
 * @param {string} xml  el `word/document.xml` completo.
 * @returns {string}
 */
export function aplicarLetraMacroOoxml(xml) {
  const texto = String(xml || '');
  const tablas = tramosDeTabla(texto);
  const enTabla = (pos) => tablas.some(([a, b]) => pos >= a && pos < b);

  let enMacro = false;
  let tocados = 0;
  let enCeldas = 0;
  const salida = texto.replace(RX_PARRAFO_LETRA, (parrafo, pos) => {
    /* Una celda de una tabla de la sección. No mueve la frontera —una celda que empiece por
       «IV. » no es un capítulo— y lleva la letra de TABLA, no la del cuerpo: las que el motor
       regenera ya salen así, y una que la plantilla traiga y el motor no reconozca se quedaba en
       la letra del cliente, de modo que en la misma sección había tablas en Arial 10 y tablas en
       la letra del informe anterior. */
    if (enTabla(pos)) {
      if (!enMacro) return parrafo;
      enCeldas += 1;
      return parrafoConLetraMacro(parrafo, false, 'tabla');
    }
    /* Las entradas del índice llevan el campo PAGEREF y repiten todos los encabezados del
       informe: si abrieran zona, la Sección III empezaría en la tabla de contenido. Mismo filtro
       que aplican `localizarHitos` y `localizarBloqueProsa`. */
    if (parrafo.includes('PAGEREF')) return parrafo;
    const plano = textoPlanoOoxml(parrafo);
    const encabezado = esEncabezadoOoxml(parrafo, plano.trim());
    /* Abrir y cerrar no son simétricos, y no por descuido: abrir pide reconocer «III.
       TENDENCIAS…», que es lo que hace `zonaQueAbre`; cerrar pide NO confundir un subapartado
       romano de la sección con el capítulo siguiente, que es lo que hace `cierraSeccionMacro`.
       Con la condición laxa en el cierre, «I. Producto Interno Bruto» cortaba la sección. */
    if (enMacro) {
      if (cierraSeccionMacro(plano, esCapituloOoxml(parrafo))) enMacro = false;
    } else if (zonaQueAbre(plano) === 'macro') {
      enMacro = true;
    }
    if (!enMacro) return parrafo;
    tocados += 1;
    return parrafoConLetraMacro(parrafo, encabezado);
  });

  /* Red propia: esta pasada corre sobre el `document.xml` antes de docxtemplater y no va por
     `escribirDocSiEsValido`, así que se comprueba a sí misma. Si el documento entraba sano y la
     salida no lo está, se devuelve lo que entró: radicar un Word que Word tiene que reparar es
     peor que radicarlo con la letra sin cambiar. */
  if (!problemaDeIntegridadOoxml(texto) && problemaDeIntegridadOoxml(salida)) {
    console.warn('[docxRelleno] la letra de la Sección III no se aplicó: ' +
      problemaDeIntegridadOoxml(salida));
    return texto;
  }

  /* Solo si hubo algo que tocar: una plantilla sin la Sección III no tiene por qué llenar la
     consola, y así el mensaje que sí aparece significa algo. */
  if (tocados || enCeldas) {
    console.log('[docxRelleno] Sección III en ' + FUENTE_MACRO + ' ' + PUNTOS_MACRO + ': ' +
      tocados + ' párrafo(s), y ' + enCeldas + ' celda(s) en ' + FUENTE_TABLA + ' ' +
      PUNTOS_TABLA);
  }
  return salida;
}

/**
 * Reescribe el texto de un párrafo de OOXML conservando su formato.
 *
 * Word parte una frase en varios `<w:r><w:t>` por rsid o por el corrector —el encabezado
 * «Datos Clave del Sector…» de la plantilla de END GAME viene en dos—, así que el texto
 * nuevo entra completo en el PRIMER `<w:t>` y los demás se vacían. Vaciarlos y no
 * eliminarlos deja el párrafo válido y conserva las propiedades de cada run.
 *
 * @returns {string} el párrafo con el texto nuevo, o el original si no tenía ningún `<w:t>`.
 */
export function reescribirTextoParrafoOoxml(parrafoXml, textoNuevo) {
  const xml = String(parrafoXml || '');
  if (!/<w:t(?:\s[^>]*)?>/.test(xml)) return xml;
  let primero = true;
  return xml.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, () => {
    if (!primero) return '<w:t xml:space="preserve"></w:t>';
    primero = false;
    return '<w:t xml:space="preserve">' + escaparXml(textoNuevo) + '</w:t>';
  });
}

/**
 * Escribe los encabezados de III.C con la industria y los años del estudio.
 *
 * Los `hitos` vienen de `localizarHitos`, que ya los localizó en orden y saltándose las
 * entradas de la tabla de contenido. Se recorre de atrás hacia adelante porque cada
 * reescritura mueve los índices de lo que va después.
 *
 * @param {string} xml
 * @param {Array<{inicio:number, finPropio:number}|null>} hitos
 * @param {Array<string|null>} titulos  uno por hito; `null` deja ese encabezado como está.
 */
function reescribirEncabezadosOoxml(xml, hitos, titulos) {
  let salida = String(xml || '');
  for (let i = titulos.length - 1; i >= 0; i -= 1) {
    const hito = hitos[i];
    if (!hito || !titulos[i]) continue;
    /* `finPropio` se extiende PASADA la tabla que sigue al encabezado (ver
       `localizarHitos`), así que no sirve para delimitar el párrafo: se toma el primer
       `</w:p>` desde su inicio, que es el cierre del propio encabezado. */
    const cierre = salida.indexOf('</w:p>', hito.inicio);
    if (cierre < 0) continue;
    const fin = cierre + '</w:p>'.length;
    const parrafo = salida.slice(hito.inicio, fin);
    const nuevo = reescribirTextoParrafoOoxml(
      parrafo, prefijoDeEncabezado(textoPlanoOoxml(parrafo)) + titulos[i]);
    if (nuevo === parrafo) continue;
    console.log('[docxRelleno] encabezado de III.C reescrito: ' + JSON.stringify(titulos[i]));
    salida = salida.slice(0, hito.inicio) + nuevo + salida.slice(fin);
  }
  return salida;
}

/** Mismo texto que `marcadorApartadoPendiente`, pero para un tema puntual de III.C
 *  en vez de todo el apartado de III.A/III.B. */
function marcadorTemaSectorPendiente(tema, year) {
  return '[Actualizar con el análisis del ' + tema + ' del sector para el año gravable ' +
    year + ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]';
}

/**
 * Reemplaza los cuatro bloques de prosa de III.C (Comportamiento, Importaciones y
 * exportaciones, Proyección, Conclusiones y Perspectivas) y la tabla "Datos Clave del
 * Sector", localizándolos por sus encabezados — mismo mecanismo de
 * `actualizarApartadosMacroOoxml`, aplicado a III.C, que hoy no se toca en absoluto:
 * depende enteramente del marcado con IA, y esta plantilla no lo trajo marcado.
 *
 * @param {string} xml
 * @param {object|null} analisisSector  el documento `analisisSector/{claveActividad}`.
 * @param {object} estudio
 * @param {number} year
 * @param {string[]} [avisos]
 * @returns {string}
 */
export function actualizarApartadoSectorialOoxml(xml, analisisSector, estudio, year, avisos, notas = null) {
  const entrada = analisisSector && analisisSector.porAnio && analisisSector.porAnio[String(year)];
  console.log('[docxRelleno] actualizarApartadoSectorialOoxml: año ' + year
    + ', corrida de sector para este año: ' + (entrada ? 'sí (' + (entrada.tituloSector || 'sin título') + ')' : 'no (marcador)'));
  const doc = sustituidorDeTablas(xml, null);

  const titulos = [
    'Análisis del Sector',
    'Comportamiento del Sector',
    'Datos Clave del Sector',
    'Importaciones y exportaciones del sector',
    '¿Qué se proyecta para el sector',
    'Conclusiones y Perspectivas',
    'ANÁLISIS ECONÓMICO',
  ];

  const bloque = (narrativaHtml, tema) => () => (
    narrativaHtml
      ? parrafosOoxmlDesdeHtml(narrativaHtml)
      : `<w:p><w:r><w:t xml:space="preserve">${escaparXml(marcadorTemaSectorPendiente(tema, year))}</w:t></w:r></w:p>`
  );

  /** Igual que `bloque`, pero cuando NO hay narrativa lista, el marcador de pendiente
   *  solo se fabrica si el hueco traía prosa sustancial que retirar — el hueco de
   *  entrada de III.C (antes de "Comportamiento del Sector") puede venir vacío en
   *  plantillas cuyo encabezado de sección no trae párrafo introductorio propio, y sin
   *  este resguardo se le fabricaría un marcador donde hoy no hay nada. El umbral NO
   *  aplica cuando SÍ hay narrativa: insertar contenido real y verificado no es
   *  "fabricar", así que se inserta siempre que esté disponible, sin importar cuánto
   *  medía el hueco viejo (mismo criterio asimétrico que `temaHueco`). */
  const bloqueConUmbral = (narrativaHtml, tema) => (textoHueco) => {
    if (!narrativaHtml && textoHueco.trim().length < UMBRAL_HUECO_CON_PROSA) return null;
    return bloque(narrativaHtml, tema)();
  };

  /** El bloque que precede a la tabla de datos clave, con las notas al pie de TODAS las fuentes
   *  del apartado ancladas al final de su última frase.
   *
   *  Van todas juntas aquí y no repartidas por bloque porque la corrida no dice qué fuente
   *  sostiene qué párrafo: dice qué fuentes verificó para el apartado. Anclarlas donde acaba el
   *  texto que introduce las cifras es lo más cerca que se puede estar del dato sin inventar una
   *  correspondencia que no existe. */
  const bloqueConFuentesDelSector = (narrativaHtml, tema) => (textoHueco) => {
    const base = bloque(narrativaHtml, tema)(textoHueco);
    if (!notas || !base) return base;

    const refs = citasApa(fuentesDelSector(entrada, tituloDatosClaveSector(entrada && entrada.tituloSector, year)))
      .map(({ cita, url }) => notas.referencia(cita, url))
      .join('');
    return refs ? anclarEnUltimoParrafo(base, refs) : base;
  };

  reemplazarPorHitos(
    doc,
    titulos,
    [
      bloqueConUmbral(entrada && entrada.narrativa.introduccion, 'contexto introductorio'),
      bloqueConFuentesDelSector(entrada && entrada.narrativa.comportamiento, 'comportamiento del sector'),
      /* La línea de fuente que va bajo la tabla de datos clave SE QUEDA, aunque las fuentes se
         citen además al pie. No es la misma cosa: el numeral 4 del artículo 1.2.2.2.1.5 del
         Decreto 1625 de 2016 exige que la información de la tabla indique su fuente y su fecha de
         consulta, y una nota al pie anclada en el párrafo de arriba no es la fuente DE LA TABLA.
         Lo que sí se sustituye es su contenido: la plantilla trae las fuentes del informe del año
         anterior. */
      () => parrafoFuenteOoxml(fuenteDatosClaveSector(entrada)) || null,
      bloque(entrada && entrada.narrativa.comercioExterior, 'comercio exterior del sector'),
      bloque(entrada && entrada.narrativa.proyeccion, 'proyección del sector'),
      bloque(entrada && entrada.narrativa.conclusiones, 'conclusiones del sector'),
    ],
    avisos,
    'Análisis del Sector'
  );

  /* Los encabezados, después de la prosa: `reemplazarPorHitos` no los toca por diseño (solo
     el hueco entre uno y el siguiente), así que se quedaban con la industria y los años del
     informe de referencia. Se localizan de nuevo sobre el XML ya modificado.
     "Datos Clave del Sector" NO va aquí —su rótulo lo reescribe `generarTablaOoxml` al
     regenerar la tabla entera, más abajo— y "Conclusiones y Perspectivas" tampoco, porque no
     lleva ni industria ni años. */
  if (entrada) {
    const t = titulosSectorial(entrada.tituloSector, year);
    doc.aplicar((actual) => reescribirEncabezadosOoxml(
      actual,
      localizarHitos(actual, titulos),
      [t.apartado, t.comportamiento, null, t.comercioExterior, t.proyeccion, null, null]
    ));
  }

  if (entrada && entrada.datosClaveTabla && entrada.datosClaveTabla.length) {
    const encontrada = doc.reemplazar('Datos Clave del Sector', () => generarTablaOoxml(
      tituloDatosClaveSector(entrada.tituloSector, year),
      cabecerasDatosClaveSector(year),
      filasDatosClaveSector(entrada.datosClaveTabla),
      null
    ));
    console.log('[docxRelleno] tabla "Datos Clave del Sector": '
      + (encontrada ? 'regenerada con ' + entrada.datosClaveTabla.length + ' fila(s)' : 'NO se encontró en la plantilla'));
  } else {
    console.log('[docxRelleno] tabla "Datos Clave del Sector": sin datos de la corrida de este año, se deja como está');
    if (Array.isArray(avisos)) avisos.push('tabla de Datos Clave del Sector');
  }

  return doc.xml;
}

/** Reemplaza quirúrgicamente las ocho tablas de tendencias económicas en el OOXML del documento. */
export function actualizarTablasMacroOoxml(xml, datosMacro, year, avisos) {
  const doc = sustituidorDeTablas(xml, avisos);

  /* Qué tabla es cada una y con qué contenido lo describe `tablasMacroInforme`, que es de
     donde las toma también la ruta de plantilla PDF. Antes la definición de las ocho vivía
     aquí, y llevarlas a la otra ruta habría significado copiarlas con sus series y sus
     fuentes: dos definiciones de la misma tabla que se separan en la primera corrección.

     Estas ocho no llevan «Tabla N.» en la plantilla, así que la numeración nunca fue su
     problema; lo que sí las alcanzaba es el otro defecto del patrón anterior: el título
     tenía que estar contiguo en el XML, y Word lo parte en varios runs. Por eso pasan por
     el mismo localizador, que compara sobre el texto ya reconstruido. */
  tablasMacroInforme(datosMacro, year).forEach((t) => {
    doc.reemplazar(t.nombre, () => generarTablaOoxml(t.titulo, t.cabeceras, t.filas, t.fuente));
  });

  return doc.xml;
}


/** Reemplaza quirúrgicamente las catorce tablas operativas en el OOXML del documento de la Fase 3. */
/* ─────────────────────────────────────────────────────────────────────────────
   Localización de tablas en la plantilla: por NOMBRE, no por número.

   La plantilla numera sus tablas, pero esa numeración no es fiable: cambia de un
   informe a otro según qué secciones lleve. Se ve en la propia plantilla —la de
   transacciones intercompañía viene como «Tabla 3» o como «Tabla 12», y el rango
   vertical como «Tabla 18» o como «Tabla 20»—, lo que obligaba a escribir dos
   patrones para la misma tabla y a no encontrarla con cualquier tercera numeración.

   Lo estable es el nombre. Este localizador:

     · lee el TEXTO VISIBLE de cada párrafo concatenando sus `<w:t>`. Word parte una
       frase en varios runs sin criterio —«Tabla 1» + «7. Muestra Com» + «pañías»— y
       un regex contra el XML crudo no la encuentra aunque el texto esté completo. Es
       el mismo motivo por el que este módulo usa docxtemplater para los marcadores;
     · normaliza el título: minúsculas, sin tildes y con los espacios colapsados, de
       modo que «Compañías», «COMPANIAS» y «compañias» cuenten igual;
     · descarta el prefijo «Tabla N.» antes de comparar, así que el número deja de
       decidir. Se puede pasar como PISTA para desambiguar dos tablas homónimas —el
       rango intercuartil aparece dos veces, horizontal y vertical—, pero si no
       coincide con ninguna, la búsqueda por nombre sigue valiendo;
     · cierra la tabla contando `<w:tbl>` anidados, en vez de parar en el primer
       `</w:tbl>`: Word permite tablas dentro de una celda y ahí el patrón anterior
       cortaba el bloque por la mitad.
   ───────────────────────────────────────────────────────────────────────────── */

/** Texto visible de un fragmento de OOXML: solo el contenido de los `<w:t>`. */
export function textoPlanoOoxml(fragmento) {
  const trozos = String(fragmento || '').match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || [];
  return trozos
    .map((t) => t.replace(/<[^>]*>/g, ''))
    .join('')
    /* Las entidades hay que deshacerlas para comparar contra texto legible; el
       espacio duro es frecuente en los títulos que el cliente maquetó a mano. */
    .replace(/&#160;|&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Clave de comparación de un título: sin «Tabla N.», sin tildes y sin puntuación. */
export function claveTitulo(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    /* El número es obligatorio para descartar el prefijo. Sin él se le arrancaba la palabra
       «Tabla» a la tabla que SE LLAMA «Tabla de rangos», y su clave quedaba en «de rangos»:
       incomparable de forma exacta y dependiente de la coincidencia por inclusión. */
    .replace(/^\s*tabla\s*n?[°º]?\s*\.?\s*\d+\s*[.:)\-–—]*\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Número que precede al título, si la plantilla lo trae. `null` si no hay. */
export function numeroDeTabla(texto) {
  const m = /^\s*tabla\s*n?[°º]?\s*\.?\s*(\d+)/i.exec(
    String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, ''));
  return m ? Number(m[1]) : null;
}

/** Fin del `<w:tbl>` que empieza en `desde`, contando anidamiento. -1 si no cierra. */
function finDeTabla(xml, desde) {
  const rx = /<w:tbl(?:\s[^>]*)?>|<\/w:tbl>/g;
  rx.lastIndex = desde;
  let nivel = 0, m;
  while ((m = rx.exec(xml)) !== null) {
    nivel += m[0] === '</w:tbl>' ? -1 : 1;
    if (nivel === 0) return m.index + m[0].length;
  }
  return -1;
}

/** Fin del `<w:tr>` que empieza en `desde`, contando anidamiento. -1 si no cierra. */
function finDeFila(xml, desde) {
  const rx = /<w:tr(?:\s[^>]*)?>|<\/w:tr>/g;
  rx.lastIndex = desde;
  let nivel = 0, m;
  while ((m = rx.exec(xml)) !== null) {
    nivel += m[0] === '</w:tr>' ? -1 : 1;
    if (nivel === 0) return m.index + m[0].length;
  }
  return -1;
}

/** Fin del `<w:tc>` que empieza en `desde`, contando anidamiento (una celda puede traer
 *  una tabla anidada con sus propios `<w:tc>`). Mismo patrón que `finDeTabla`/`finDeFila`. */
function finDeCelda(xml, desde) {
  const rx = /<w:tc(?:\s[^>]*)?>|<\/w:tc>/g;
  rx.lastIndex = desde;
  let nivel = 0, m;
  while ((m = rx.exec(xml)) !== null) {
    nivel += m[0] === '</w:tc>' ? -1 : 1;
    if (nivel === 0) return m.index + m[0].length;
  }
  return -1;
}

/** Las `<w:tr>` de una tabla OOXML, con su XML y posición. Análogo a `filasDe`
 *  (`tablasHtmlInforme.js`) pero apoyado en `finDeFila`, que ya cuenta anidamiento. */
function filasDeOoxml(tablaXml) {
  const texto = String(tablaXml || '');
  const filas = [];
  const rx = /<w:tr(?:\s[^>]*)?>/g;
  let m;
  while ((m = rx.exec(texto)) !== null) {
    const fin = finDeFila(texto, m.index);
    if (fin < 0) break;
    filas.push({ xml: texto.slice(m.index, fin), inicio: m.index, fin });
    rx.lastIndex = fin;
  }
  return filas;
}

/** Las `<w:tc>` de una fila OOXML, con su XML completo (`tcPr` —bordes, sombreado,
 *  `gridSpan`, `vMerge`— incluida). Análogo a `celdasDe` (`tablasHtmlInforme.js`). */
function celdasDeOoxml(filaXml) {
  const texto = String(filaXml || '');
  const celdas = [];
  const rx = /<w:tc(?:\s[^>]*)?>/g;
  let m;
  while ((m = rx.exec(texto)) !== null) {
    const fin = finDeCelda(texto, m.index);
    if (fin < 0) break;
    celdas.push({ xml: texto.slice(m.index, fin), inicio: m.index, fin });
    rx.lastIndex = fin;
  }
  return celdas;
}

/**
 * Reescribe las filas de datos de una tabla OOXML conservando su encabezado y el «molde»
 * de sus celdas (bordes, sombreado, `gridSpan`/`vMerge`) — equivalente de `reescribirFilasHtml`
 * (`tablasHtmlInforme.js`) para la ruta .docx.
 *
 * Uso exclusivo de «Códigos SIC utilizados»: una fila de 2 celdas (etiqueta/valor) por
 * criterio de búsqueda, clonando el molde existente para no perder su fusión de columnas.
 *
 * @param {string} tablaXml  el bloque «título + `<w:tbl>`» (o solo la tabla); basta con que
 *        contenga la tabla en algún punto, porque el parseo busca `<w:tr>` directamente y el
 *        párrafo de título, si lo hay, no tiene ninguno.
 * @param {Array<string[]>} filas  una entrada `[etiqueta, valor]` por fila — la forma que ya
 *        produce `filasCriteriosScreening` (`tablasInforme.js`).
 * @param {{filasEncabezado?:number, pie?:boolean}} [opciones]  mismo contrato que
 *        `reescribirFilasHtml`: `filasEncabezado` (1 por defecto), `pie` para desactivar la
 *        detección de la fila de fuente.
 * @returns {string} el XML con las filas de cuerpo nuevas, o el original si no hay molde.
 */
export function reescribirFilasOoxml(tablaXml, filas, opciones = {}) {
  const tabla = String(tablaXml || '');
  const encabezados = Math.max(1, Number(opciones.filasEncabezado) || 1);
  const todas = filasDeOoxml(tabla);
  if (todas.length <= encabezados) return tabla;

  /* Misma heurística de pie de fuente que `reescribirFilasHtml`: la última fila se conserva
     intacta cuando es de una sola celda y el resto de la tabla tiene más de una. No se
     regenera aquí — es la misma decisión ya tomada en la ruta HTML, no algo que decidir de
     nuevo: el pie «Fuente: ... publicado en ...» no se recalcula en ninguna de las dos rutas. */
  const columnas = celdasDeOoxml(todas[encabezados - 1].xml).length;
  const ultima = todas[todas.length - 1];
  const esPie = opciones.pie !== false
    && todas.length > encabezados + 1
    && columnas > 1
    && celdasDeOoxml(ultima.xml).length === 1;

  const cuerpo = todas.slice(encabezados, esPie ? todas.length - 1 : todas.length);
  if (!cuerpo.length) return tabla;

  /* Molde: la fila de dos celdas representativa del cuerpo existente. Se clona su XML
     COMPLETO —`tcPr` incluida— y solo se sustituye el texto con `reescribirTextoParrafoOoxml`;
     así no hace falta reconstruir la fusión de columnas a mano. */
  const molde = cuerpo.map((f) => celdasDeOoxml(f.xml)).find((cs) => cs.length === 2);
  if (!molde) return tabla;

  const nuevas = (filas || []).map((valores) => {
    const vals = valores || [];
    const celdas = molde.map((c, i) => reescribirTextoParrafoOoxml(
      c.xml, String(vals[Math.min(i, vals.length - 1)] ?? '')
    )).join('');
    return '<w:tr>' + celdas + '</w:tr>';
  }).join('');

  return tabla.slice(0, cuerpo[0].inicio) + nuevas + tabla.slice(cuerpo[cuerpo.length - 1].fin);
}

/**
 * Fin del `<w:p>` que empieza en `desde`, contando anidamiento. -1 si no cierra.
 *
 * Un párrafo puede contener otro: los cuadros de texto cuelgan un cuerpo entero de
 * `w:txbxContent`. Y el `(?:\s[^>]*)?` antes del `>` no es adorno: sin él la regex casaría
 * también con `<w:pPr>`, `<w:proofErr>` y `<w:permStart>`, que es exactamente lo que hacía que
 * buscar el párrafo siguiente con `indexOf('<w:p', …)` metiera la ecuación dentro del párrafo
 * del rótulo y dejara el documento con más aperturas que cierres. Los `<w:p/>` autocerrados no
 * cuentan como apertura.
 */
function finDeParrafo(xml, desde) {
  const rx = /<w:p(?:\s[^>]*?)?(\/?)>|<\/w:p>/g;
  rx.lastIndex = desde;
  let nivel = 0, m;
  while ((m = rx.exec(xml)) !== null) {
    if (m[0] === '</w:p>') nivel -= 1;
    else if (m[1] === '/') { if (nivel === 0) return m.index + m[0].length; }
    else nivel += 1;
    if (nivel === 0 && m[0] === '</w:p>') return m.index + m[0].length;
  }
  return -1;
}

/**
 * Apertura del `<w:p>` que CONTIENE la posición dada. -1 si no hay ninguna antes.
 *
 * La contrapartida de `finDeParrafo`, y por el mismo motivo: `lastIndexOf('<w:p', …)` casa
 * con `<w:pPr`, `<w:pStyle` y `<w:pict`, así que el «inicio del párrafo» acababa a mitad de
 * las propiedades y cortar ahí desbalanceaba el documento.
 */
function inicioDeParrafo(xml, posicion) {
  const rx = /<w:p(?:\s[^>]*?)?>/g;
  let inicio = -1, m;
  while ((m = rx.exec(xml)) !== null) {
    if (m.index > posicion) break;
    inicio = m.index;
  }
  return inicio;
}

/* Hueco de maquetación entre dos bloques de contenido: un párrafo vacío (o autocerrado), una
   marca de libro o un aviso del corrector. Word los deja tanto ANTES de una tabla —entre su
   rótulo y el `<w:tbl>`— como DESPUÉS —entre el cierre de la tabla y su línea «FUENTE:»—, así
   que el mismo bucle de salto sirve en los dos sentidos: lo usan `candidatosBloqueTabla` y
   `finDeTablaInmediata` por delante, y `finDeFuenteSiguienteOoxml` por detrás. Un párrafo que
   solo lleva una ecuación no cuenta como vacío: `textoPlanoOoxml` no le ve texto, pero es
   contenido, y tragárselo dentro del tramo que se recorta lo borraría. */
function saltarHuecosOoxml(texto, cursor) {
  let c = cursor;
  for (; ;) {
    const resto = texto.slice(c);
    const hueco = /^\s*(?:<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?<\/w:p>|<w:bookmarkStart[^>]*\/?>|<w:bookmarkEnd[^>]*\/?>|<w:proofErr[^>]*\/?>)/.exec(resto);
    if (!hueco) break;
    if (textoPlanoOoxml(hueco[0]).trim() || /<m:oMath[ >]/.test(hueco[0])) break;
    c += hueco[0].length;
  }
  return c;
}

/**
 * Tablas cuyo título no las precede, sino que es su PRIMERA FILA.
 *
 * Así trae la plantilla de referencia la «Tabla 20. Tabla de rangos» del final del informe:
 * el rótulo es una celda de la fila de arriba, no un párrafo aparte. Para el localizador
 * clásico —«párrafo de título seguido de `<w:tbl>`»— esa tabla era inalcanzable, y se
 * radicaba con los percentiles del informe anterior.
 *
 * Solo la primera fila cuenta. Si valiera cualquiera, una celda del cuerpo que mencione el
 * nombre —la matriz de rechazo lo hace— secuestraría la sustitución de la tabla completa.
 *
 * El bloque devuelto abarca la tabla entera, rótulo incluido: lo que se emite en su lugar
 * ya trae su propio párrafo de título.
 *
 * La coincidencia es EXACTA, no por inclusión como en el localizador por párrafo. Un rótulo
 * es exactamente el nombre de la tabla; una celda cualquiera, no. La plantilla trae una
 * tabla de definiciones cuya primera fila es «MO | Margen operacional de utilidad o
 * rentabilidad operacional»: por inclusión se haría pasar por la tabla de márgenes de las
 * comparables, y sustituirla borraría las definiciones del método.
 */
function candidatosPorFilaTitulo(texto, claves) {
  const encontrados = [];
  let cursor = 0;
  for (; ;) {
    const inicio = texto.indexOf('<w:tbl', cursor);
    if (inicio === -1) break;
    const fin = finDeTabla(texto, inicio);
    if (fin < 0) break;
    /* Desde `fin` y no desde el interior: así las tablas anidadas no se analizan por
       separado —su rótulo, si lo tienen, es de la celda que las contiene—. */
    cursor = fin;

    const iFila = texto.indexOf('<w:tr', inicio);
    if (iFila === -1 || iFila > fin) continue;
    const finFila = finDeFila(texto, iFila);
    if (finFila < 0 || finFila > fin) continue;

    const rxParrafo = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
    const primeraFila = texto.slice(iFila, finFila);
    let p;
    while ((p = rxParrafo.exec(primeraFila)) !== null) {
      const titulo = textoPlanoOoxml(p[0]);
      const clave = claveTitulo(titulo);
      if (!clave || !claves.some((c) => clave === c)) continue;
      encontrados.push({ inicio, fin, titulo, numero: numeroDeTabla(titulo) });
      break;
    }
  }
  return encontrados;
}

/**
 * Bloque «párrafo del título + la tabla que le sigue» cuyo título coincide con
 * alguno de los nombres dados.
 *
 * @param xml       el `document.xml` completo.
 * @param nombres   nombre canónico de la tabla, o varios sinónimos.
 * @param opciones  `numeros`: números con los que desambiguar dos tablas homónimas.
 *                  `ocurrencia`: cuál tomar si quedan varias (0 = la primera).
 * @returns {{inicio:number, fin:number, titulo:string, numero:number|null}|null}
 */
function candidatosBloqueTabla(xml, nombres) {
  const texto = String(xml || '');
  const claves = (Array.isArray(nombres) ? nombres : [nombres]).map(claveTitulo).filter(Boolean);
  if (!claves.length) return [];

  const candidatos = [];
  const rxParrafo = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let p;
  while ((p = rxParrafo.exec(texto)) !== null) {
    const titulo = textoPlanoOoxml(p[0]);
    const clave = claveTitulo(titulo);
    if (!clave || !claves.some((c) => clave.includes(c))) continue;

    /* Entre el título y la tabla la plantilla suele dejar párrafos vacíos. Se saltan
       los que no tienen texto; en cuanto aparece uno con contenido, el título ya no
       era el de esta tabla y se descarta. */
    const cursor = saltarHuecosOoxml(texto, p.index + p[0].length);
    const tras = /^\s*<w:tbl(?:\s[^>]*)?>/.exec(texto.slice(cursor));
    if (!tras) continue;

    const inicioTabla = cursor + tras[0].indexOf('<w:tbl');
    const fin = finDeTabla(texto, inicioTabla);
    if (fin < 0) continue;
    candidatos.push({ inicio: p.index, fin, titulo, numero: numeroDeTabla(titulo) });
  }

  /* Las del rótulo embebido se añaden y todo se ordena por posición en el documento, que es
     sobre lo que `ocurrencia` cuenta: «la primera» tiene que ser la primera que se lee. */
  candidatos.push(...candidatosPorFilaTitulo(texto, claves));
  candidatos.sort((a, b) => a.inicio - b.inicio);
  return candidatos;
}

/**
 * Bloque «párrafo del título + la tabla que le sigue» cuyo título coincide con
 * alguno de los nombres dados.
 *
 * @param xml       el `document.xml` completo.
 * @param nombres   nombre canónico de la tabla, o varios sinónimos.
 * @param opciones  `numeros`: números con los que desambiguar dos tablas homónimas.
 *                  `ocurrencia`: cuál tomar si quedan varias (0 = la primera).
 * @returns {{inicio:number, fin:number, titulo:string, numero:number|null}|null}
 */
export function localizarBloqueTabla(xml, nombres, opciones = {}) {
  const candidatos = descartarPorNombre(candidatosBloqueTabla(xml, nombres), opciones.excluir);
  if (!candidatos.length) return null;

  /* El número solo desempata. Si la plantilla renumeró y ninguno coincide, se sigue
     con todos los que dio el nombre en vez de no encontrar nada. */
  const numeros = Array.isArray(opciones.numeros) ? opciones.numeros : [];
  const porNumero = numeros.length ? candidatos.filter((c) => numeros.includes(c.numero)) : [];
  const finalistas = porNumero.length ? porNumero : candidatos;
  const i = Number(opciones.ocurrencia) || 0;
  return finalistas[Math.min(i, finalistas.length - 1)] || null;
}

/**
 * Descarta los candidatos cuyo rótulo contiene alguno de los nombres excluidos.
 *
 * La búsqueda casa por INCLUSIÓN, y hay tablas cuyo nombre contiene el de otra: «Operación
 * adicional Transacciones Intercompañía» contiene «Transacciones Intercompañía», así que las
 * dos la reclamarían. Sin esto, la ficha del vinculado acabaría escrita encima de la tabla de
 * la operación adicional —o al revés—, y las dos declaran cosas distintas ante la DIAN.
 *
 * Se aplica a los NOMBRES, no a los números: el prefijo «Tabla N.» se renumera entre
 * plantillas y no sirve para distinguir nada.
 *
 * @param {Array} candidatos
 * @param {string[]} [excluir]
 * @returns {Array}
 */
export function descartarPorNombre(candidatos, excluir) {
  const claves = (Array.isArray(excluir) ? excluir : [excluir])
    .map(claveTitulo).filter(Boolean);
  if (!claves.length) return candidatos;
  return candidatos.filter((c) => {
    const clave = claveTitulo(c && c.titulo);
    return !clave || !claves.some((e) => clave.includes(e));
  });
}

/**
 * TODAS las tablas cuyo título coincide con alguno de los nombres dados, en orden de
 * documento — equivalente OOXML de `localizarTablasHtml` (`tablasHtmlInforme.js`).
 *
 * Hace falta cuando la decisión de qué conservar y qué borrar depende de ver el conjunto
 * completo de una vez (p. ej. «Códigos SIC utilizados», que puede venir hasta tres veces
 * con el mismo nombre), y no de pedir una ocurrencia a la vez como hace
 * `localizarBloqueTabla`.
 *
 * @returns {{inicio:number, fin:number, titulo:string, numero:number|null}[]}
 */
export function localizarBloquesTabla(xml, nombres) {
  return candidatosBloqueTabla(xml, nombres);
}

/* Si justo después de `cursor` viene una tabla —saltando párrafos vacíos, marcas de
   libro y avisos del corrector, igual que `localizarBloqueTabla`—, el índice donde
   termina esa tabla; si no, -1. */
function finDeTablaInmediata(texto, cursor) {
  const c = saltarHuecosOoxml(texto, cursor);
  const tras = /^\s*<w:tbl(?:\s[^>]*)?>/.exec(texto.slice(c));
  if (!tras) return -1;
  const inicioTabla = c + tras[0].indexOf('<w:tbl');
  return finDeTabla(texto, inicioTabla);
}

/* Lo que Word intercala entre dos párrafos sin que sea contenido: marcas de libro, avisos del
   corrector ortográfico, permisos de edición y anclas de comentario. */
const RUIDO_ENTRE_PARRAFOS =
  /^\s*(?:<w:bookmarkStart[^>]*\/?>|<w:bookmarkEnd[^>]*\/?>|<w:proofErr[^>]*\/?>|<w:permStart[^>]*\/?>|<w:permEnd[^>]*\/?>|<w:commentRangeStart[^>]*\/?>|<w:commentRangeEnd[^>]*\/?>)/;

/**
 * El párrafo HERMANO que sigue a `cursor` en el cuerpo del documento.
 *
 * Devuelve `{inicio, fin, xml}` si lo que viene es un párrafo, o `{bloqueado}` si es una tabla,
 * un control de contenido, el `w:sectPr` o el final del cuerpo. Distinguirlo importa: buscar el
 * siguiente `<w:p` a pelo se mete dentro de la primera celda cuando al párrafo le sigue una
 * tabla, y sustituirlo destruye el contenido de esa celda.
 */
function parrafoHermanoSiguiente(xml, cursor) {
  let c = cursor;
  for (; ;) {
    const ruido = RUIDO_ENTRE_PARRAFOS.exec(xml.slice(c));
    if (!ruido) break;
    c += ruido[0].length;
  }
  const resto = xml.slice(c);
  const espacios = /^\s*/.exec(resto)[0].length;
  const desde = c + espacios;
  const cabeza = xml.slice(desde, desde + 12);

  if (/^<w:tbl[\s>]/.test(cabeza)) return { bloqueado: 'tabla', desde };
  if (/^<w:sdt[\s>]/.test(cabeza)) return { bloqueado: 'sdt', desde };
  if (/^<w:sectPr[\s>]/.test(cabeza) || /^<\/w:body>/.test(cabeza)) {
    return { bloqueado: 'fin', desde };
  }
  if (!/^<w:p[\s>/]/.test(cabeza)) return { bloqueado: 'fin', desde };

  const fin = finDeParrafo(xml, desde);
  if (fin < 0) return { bloqueado: 'fin', desde };
  return { inicio: desde, fin, xml: xml.slice(desde, fin) };
}

/** Si el texto de un párrafo empieza por «FUENTE:» o «FUENTES:» —una tabla que cita varias
 *  fuentes se rotula así con toda naturalidad, y antes solo se reconocía el singular. */
const esLineaFuenteOoxml = (texto) => /^\s*fuentes?\s*:/i.test(texto);

/**
 * Si tras `desde` —saltando los mismos huecos de maquetación que delante de una tabla
 * (`saltarHuecosOoxml`): párrafos vacíos, marcas de libro, avisos del corrector— viene un
 * párrafo «FUENTE: …», su final; si no, `desde` sin tocar.
 *
 * Reconocer esa línea es la misma pregunta en `reemplazar` (para absorberla), `borrar` (para
 * llevársela con la tabla) e `insertar` (para no colarse entre la tabla y su fuente):
 * equivalente en OOXML de `elementoFuenteSiguiente` (`tablasHtmlInforme.js`).
 *
 * @param {string} xml
 * @param {number} desde  el offset donde acaba el bloque de la tabla.
 * @returns {number}
 */
function finDeFuenteSiguienteOoxml(xml, desde) {
  const cursor = saltarHuecosOoxml(xml, desde);
  const hermano = parrafoHermanoSiguiente(xml, cursor);
  if (hermano && hermano.xml && esLineaFuenteOoxml(textoPlanoOoxml(hermano.xml))) {
    return hermano.fin;
  }
  return desde;
}

/**
 * Delimita un bloque de párrafos entre un encabezado de inicio y el primero de una
 * lista de encabezados de fin — pensado para reemplazar la PROSA de un apartado sin
 * tocar las tablas que le siguen (esas ya las localiza `localizarBloqueTabla`).
 *
 * `inicio` cae en el propio párrafo de `tituloInicio` (se conserva su encabezado en el
 * reemplazo) y `fin` justo antes del párrafo de fin encontrado, que queda intacto.
 *
 * @param {string} xml
 * @param {string} tituloInicio
 * @param {string[]} titulosFin
 * @returns {{inicio:number, fin:number}|null}
 */
export function localizarBloqueProsa(xml, tituloInicio, titulosFin) {
  const texto = String(xml || '');
  const claveInicio = claveTitulo(tituloInicio);
  const clavesFin = (titulosFin || []).map(claveTitulo).filter(Boolean);
  if (!claveInicio || !clavesFin.length) return null;

  const rxParrafo = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let p;
  let inicio = null;
  while ((p = rxParrafo.exec(texto)) !== null) {
    /* La Tabla de Contenido repite el mismo texto de cada encabezado en un párrafo con
       un campo PAGEREF, antes de que aparezca el encabezado real del cuerpo. Sin este
       filtro, `inicio` caía en la entrada del TOC —que nunca lleva la prosa del
       apartado— y todo lo que hay entre el TOC y la primera tabla (el índice entero)
       se tomaba como si fuera la prosa a reemplazar. */
    if (p[0].includes('PAGEREF')) continue;
    const clave = claveTitulo(textoPlanoOoxml(p[0]));
    if (inicio === null) {
      if (clave.includes(claveInicio)) inicio = p.index;
      continue;
    }
    if (clavesFin.some((c) => clave.includes(c))) {
      return { inicio, fin: p.index };
    }
  }
  return null;
}

/**
 * Los `titulos`, en el orden en que deben aparecer en el documento, con dónde empieza
 * y dónde termina el párrafo de cada uno. Sirve para delimitar TODOS los huecos entre
 * un encabezado y el siguiente en un solo recorrido — `localizarBloqueProsa` resuelve
 * un único hueco; esta es su generalización a una cadena de encabezados.
 *
 * Se exige que aparezcan en ESE orden: en cuanto se encuentra el título `i`, la
 * búsqueda del título `i+1` empieza después de él, nunca antes ni desde el principio
 * del documento — así una tabla que se llame igual que un encabezado posterior no se
 * confunde con él.
 *
 * @param {string} xml
 * @param {string[]} titulos
 * @returns {Array<{inicio:number, finPropio:number}|null>}
 */
export function localizarHitos(xml, titulos) {
  const texto = String(xml || '');
  /* Cada posición admite un título único o un arreglo de sinónimos: el mismo tema puede
     traer redacciones distintas según qué consultor escribió la plantilla de ese cliente
     en su momento ("Desempleo en Colombia" / "Tasa de Desempleo" / "Mercado Laboral en
     Colombia" son el mismo apartado universal, no contenido específico del contribuyente).
     Mismo mecanismo que ya usa `localizarBloqueTabla` para nombres de tabla. */
  const claves = (titulos || []).map((t) => (Array.isArray(t) ? t.map(claveTitulo) : [claveTitulo(t)]));
  const resultado = new Array(claves.length).fill(null);
  if (!claves.length) return resultado;

  /* Candidatos: cada párrafo con pinta de título, en orden de aparición, recogidos de
     una sola pasada. Antes se buscaba el título `objetivo` avanzando un único cursor
     por el documento: si ese título no aparecía —o aparecía con otra redacción, como
     en una plantilla de referencia más vieja que el título que se busca—, el cursor se
     quedaba clavado ahí y NINGUNO de los títulos siguientes llegaba siquiera a
     probarse, aunque sí existieran más adelante. Con los candidatos ya listados, un
     título que falta se salta sin mover el cursor de búsqueda de los que le siguen. */
  const candidatos = [];
  const rxParrafo = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = rxParrafo.exec(texto)) !== null) {
    if (m[0].includes('PAGEREF')) continue;
    const textoParrafo = textoPlanoOoxml(m[0]);
    /* Un párrafo de prosa puede mencionar de pasada el nombre de un hito posterior
       -"la inflación global ha venido descendiendo..."- y un includes() sobre
       texto largo lo confundiría con el título real. Los títulos de esta lista
       (encabezados de apartado, nombres de tabla) siempre son cortos; se descarta
       cualquier candidato que no lo sea y se sigue buscando uno más adelante. */
    if (textoParrafo.length > 160) continue;
    candidatos.push({ inicio: m.index, fin: m.index + m[0].length, clave: claveTitulo(textoParrafo) });
  }

  /* Se exige que los que sí aparecen lo hagan en ESE orden: la búsqueda del título
     `i+1` empieza después del candidato del título `i`, nunca antes ni desde el
     principio, así una tabla que se llame igual que un encabezado posterior no se
     confunde con él. */
  let desde = 0;
  for (let objetivo = 0; objetivo < claves.length; objetivo += 1) {
    let k = desde;
    while (k < candidatos.length && !claves[objetivo].some((c) => candidatos[k].clave.includes(c))) k += 1;
    if (k >= candidatos.length) continue;
    /* Si el hito es el título de una tabla —caso normal para los nombres de
       `tablasMacroInforme`—, el hueco siguiente empieza DESPUÉS de la tabla entera,
       no justo tras el título: si no, la tabla completa (y su "FUENTE:") cae dentro
       del hueco que se reemplaza, y `actualizarTablasMacroOoxml` deja de encontrar
       el título para regenerarla en el siguiente paso. */
    let finPropio = candidatos[k].fin;
    const finTabla = finDeTablaInmediata(texto, finPropio);
    if (finTabla >= 0) finPropio = finTabla;
    resultado[objetivo] = { inicio: candidatos[k].inicio, finPropio };
    desde = k + 1;
  }
  return resultado;
}

/**
 * Reemplaza, uno por uno, los huecos entre una lista ordenada de encabezados. Cada
 * hueco es el texto entre el final del párrafo de un hito y el inicio del párrafo del
 * siguiente — el propio encabezado nunca se toca.
 *
 * @param {{aplicar:(f:(s:string)=>string)=>void}} doc  un `sustituidorDeTablas`.
 * @param {string[]} titulos
 * @param {Array<(textoHueco:string)=>(string|null)>} contenidos  longitud
 *        `titulos.length - 1`; recibe el texto plano ya existente en ese hueco (para
 *        decidir si hace falta tocarlo) y devuelve el OOXML nuevo, o `null` para
 *        dejarlo como está.
 * @param {string[]} [avisos]
 * @param {string} [nombreParaAvisos]
 */
/** Nombre legible de una posición de `titulos`: el título tal cual, o el primero de sus
 *  sinónimos si trae varios (`['Desempleo en Colombia', 'Tasa de Desempleo', ...]`) — para
 *  avisos y logs, nunca la representación por defecto de un arreglo. */
const etiquetaTitulo = (t) => (Array.isArray(t) ? t[0] : t);

export function reemplazarPorHitos(doc, titulos, contenidos, avisos, nombreParaAvisos) {
  doc.aplicar((actual) => {
    const hitos = localizarHitos(actual, titulos);
    const etiquetas = titulos.map(etiquetaTitulo);
    console.log('[docxRelleno] ' + (nombreParaAvisos || '') + ': hitos encontrados '
      + hitos.filter(Boolean).length + '/' + titulos.length + ' (' + etiquetas.join(' → ') + ')');
    /* UN aviso por rótulo ausente, y no uno por cada par de rótulos consecutivos que no
       se pudo delimitar. Cada rótulo delimita dos apartados —el que cierra y el que
       abre—, así que el aviso por pares repetía la misma causa dos veces y una cadena de
       siete rótulos rota por el primero producía seis líneas idénticas en el fondo. Lo
       que quien radica necesita saber es qué rótulo escribe distinto su plantilla: eso se
       arregla una vez y descuelga todos los apartados que dependían de él. */
    titulos.forEach((titulo, i) => {
      if (hitos[i]) return;
      const aviso = (nombreParaAvisos || '') + ': no se encontró el rótulo «' + titulo
        + '», así que los apartados que delimita se quedan como están en la plantilla';
      console.warn('[docxRelleno] ' + aviso);
      if (!Array.isArray(avisos)) return;
      /* Y ni siquiera una vez por sección: el rótulo que CIERRA una cadena es el que ABRE
         la siguiente —«Análisis del Sector» cierra la economía colombiana y abre el
         sector—, así que sin esto el mismo rótulo ausente se avisa dos veces, con dos
         encabezados distintos y la misma causa detrás. Se compara por el rótulo
         entrecomillado, que es lo único que el usuario tiene que ir a corregir. */
      if (avisos.some((a) => a.includes('«' + titulo + '»'))) return;
      avisos.push(aviso);
    });
    let salida = actual;

    /* Respaldo para cuando un hueco no se puede localizar porque su propio título —o el
       siguiente— no aparece en la plantilla bajo NINGUNA redacción: no está mal escrito,
       la sección nunca existió ahí (plantilla más vieja que la sección que se quiere
       insertar). El último título de la lista es siempre un límite —sin generador propio
       en `contenidos`—, así que si se encuentra sirve de sitio de respaldo: mejor un
       párrafo al final de esta sección que perder en silencio un contenido que sí se
       generó. Se ajusta con cada edición que caiga antes de él, en el mismo recorrido de
       atrás hacia adelante, para no apuntar a un índice viejo. Misma lógica que
       `reemplazarHuecosHtml` de `tablasHtmlInforme.js`. */
    /* Si NI SIQUIERA el límite final aparece, no hay con qué distinguir "esta sección
       nunca existió aquí" de "la plantilla no tiene nada que ver con esta cadena de
       títulos" (la mayoría de las plantillas de prueba, por ejemplo): insertar al final
       del documento sería un despropósito en ese segundo caso. El respaldo solo se activa
       cuando el límite final SÍ se encontró. */
    const ultimoHito = hitos[hitos.length - 1];
    let cursorRespaldo = ultimoHito ? ultimoHito.inicio : null;

    for (let i = contenidos.length - 1; i >= 0; i -= 1) {
      const hitoActual = hitos[i];
      const hitoSiguiente = hitos[i + 1];
      if (!hitoActual || !hitoSiguiente) {
        /* El aviso de que este hueco no se pudo delimitar ya se emitió arriba, nombrando
           el rótulo ausente que lo causa. Aquí solo queda el respaldo. */
        if (cursorRespaldo !== null) {
          const nuevo = contenidos[i]('');
          if (nuevo !== null) {
            console.log('[docxRelleno] hueco "' + etiquetas[i] + '" → "' + etiquetas[i + 1] +
              '": sin ancla, insertado de respaldo al final de la sección');
            if (Array.isArray(avisos)) {
              avisos.push(
                (nombreParaAvisos || '') + ': "' + etiquetas[i] + '" no está en la plantilla, así que ' +
                'su contenido se insertó al final de esta sección en vez de en su lugar propio — ' +
                'revisa el orden antes de radicar'
              );
            }
            salida = salida.slice(0, cursorRespaldo) + nuevo + salida.slice(cursorRespaldo);
          }
        }
        continue;
      }
      const textoHueco = textoPlanoOoxml(salida.slice(hitoActual.finPropio, hitoSiguiente.inicio));
      const nuevo = contenidos[i](textoHueco);
      if (nuevo === null) {
        console.log('[docxRelleno] hueco "' + etiquetas[i] + '" → "' + etiquetas[i + 1] + '": sin tocar');
        continue;
      }
      console.log('[docxRelleno] hueco "' + etiquetas[i] + '" → "' + etiquetas[i + 1] + '": reemplazado ('
        + textoHueco.length + ' caracteres viejos → ' + nuevo.length + ' nuevos)');
      if (cursorRespaldo !== null && hitoActual.finPropio <= cursorRespaldo) {
        cursorRespaldo += nuevo.length - (hitoSiguiente.inicio - hitoActual.finPropio);
      }
      salida = salida.slice(0, hitoActual.finPropio) + nuevo + salida.slice(hitoSiguiente.inicio);
    }
    return salida;
  });
}

/** Texto de un fragmento de HTML de narrativa (sin sus etiquetas), con las entidades
 *  básicas deshechas — misma lista que `escaparXml` invierte, porque este texto vuelve
 *  a pasar por `escaparXml` al escribirse en el run. */
function textoPlanoDeNarrativa(fragmento) {
  return String(fragmento || '')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * La narrativa de III.A/III.B que redacta Claude (HTML simple: `<p>`, `<strong>`, `<a>`)
 * convertida a párrafos OOXML, para insertarla en el `.docx` sin depender del marcado.
 *
 * Solo entiende `<strong>` (negrita) y `<a>` (se aplana a su texto): es lo único que el
 * prompt de redacción produce (`functions/analisisMercadoPrompts.js`, "Cada apartado en
 * HTML, como una serie de párrafos <p>...</p>, sin encabezados ni tablas").
 *
 * @param {string} html
 * @returns {string} OOXML, una cadena vacía si `html` no trae ningún `<p>`.
 */
export function parrafosOoxmlDesdeHtml(html) {
  const bloques = String(html || '').match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
  return bloques.map((bloque) => {
    const interior = bloque.replace(/^<p\b[^>]*>/i, '').replace(/<\/p>\s*$/i, '');
    const runs = [];
    const rx = /<strong>([\s\S]*?)<\/strong>|([^<]+(?:<a\b[^>]*>[\s\S]*?<\/a>[^<]*)*)/gi;
    let m;
    while ((m = rx.exec(interior)) !== null) {
      if (m[1] !== undefined) {
        const texto = textoPlanoDeNarrativa(m[1]);
        if (texto) runs.push(`<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r>`);
      } else if (m[2] !== undefined) {
        const texto = textoPlanoDeNarrativa(m[2]);
        if (texto) runs.push(`<w:r><w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r>`);
      }
    }
    return `<w:p>${runs.join('')}</w:p>`;
  }).join('');
}

/* Un `<w:t>` que es SOLO una cifra: «2.05%», «-3.001%», «1,780 %». Es lo que Word deja
   cuando la plantilla escribe un número entre paréntesis dentro de una frase, y es lo que
   permite cambiarlo sin tocar una letra del resto. */
const RX_SOLO_CIFRA = /^\s*\(?\s*-?[\d]+(?:[.,][\d]+)?\s*%\s*\)?\s*$/;

/**
 * Actualiza las cifras del párrafo que describe una tabla, conservando su redacción.
 *
 * Las tablas del informe se rehacen con los datos del estudio, pero el párrafo que las
 * comenta seguía siendo el de la plantilla: la tabla decía que el rango va de 1,780 % a
 * 8,800 % y la frase debajo hablaba de -3,001 % y 6,418 %, cifras del informe del año
 * anterior. En un documento que se radica, esa contradicción la ve quien lo revise.
 *
 * Se sustituyen SOLO los números y en el orden en que los espera `cifras`, dejando intactas
 * la redacción, la puntuación y el formato: cada valor vive en su propio `<w:t>`, así que
 * cambiarlo no toca los runs vecinos.
 *
 * Si el párrafo no trae exactamente tantas cifras como se esperan, no se toca nada y se
 * anota el aviso. Es deliberado: una frase con más números de los previstos —o con ellos en
 * otro orden— se corrompería en silencio, y publicar una cifra en el sitio equivocado es
 * peor que dejar la de la plantilla, que al menos se nota que no cuadra con la tabla.
 *
 * @param {string} xml
 * @param {string|string[]} nombres  nombre de la tabla, como lo busca `localizarBloqueTabla`.
 * @param {string[]} cifras  los valores ya formateados, en el orden en que aparecen.
 * @param {string[]} [avisos]
 * @returns {string} el XML, con la prosa actualizada donde se pudo.
 */
export function actualizarProsaTrasTabla(xml, nombres, cifras, avisos) {
  let salida = String(xml || '');
  const esperadas = (cifras || []).filter((c) => c !== null && c !== undefined);
  if (esperadas.length !== (cifras || []).length || !esperadas.length) return salida;

  /* Todas las apariciones de la tabla: el rango intercuartil sale dos veces en el informe
     —en el resumen y en el desarrollo— y las dos llevan su propia frase debajo. */
  for (let ocurrencia = 0; ocurrencia < 6; ocurrencia += 1) {
    const bloque = localizarBloqueTabla(salida, nombres, { ocurrencia });
    if (!bloque) break;
    /* `localizarBloqueTabla` devuelve la última cuando se le piden más de las que hay, así
       que sin esto la misma tabla se procesaría en bucle. */
    if (ocurrencia > 0) {
      const previo = localizarBloqueTabla(salida, nombres, { ocurrencia: ocurrencia - 1 });
      if (previo && previo.inicio === bloque.inicio) break;
    }

    /* Entre la tabla y su descripción hay más párrafos: la línea de la fuente que emite
       `generarTablaOoxml` («Información suministrada por…»), y los vacíos de la plantilla.
       Quedarse con el primero que tenga texto tomaba la fuente por descripción, no
       encontraba las cifras y se iba sin tocar nada ni avisar. Así que se examinan unos
       cuantos y se elige el primero que traiga EXACTAMENTE las cifras que se esperan. */
    const rxParrafo = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
    rxParrafo.lastIndex = bloque.fin;
    let parrafo = null;
    let conCifra = [];
    let vistosConCifras = 0;
    for (let m = rxParrafo.exec(salida), n = 0; m && n < 6; m = rxParrafo.exec(salida), n += 1) {
      const trozos = [...m[0].matchAll(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g)];
      const cifras = trozos.filter((t) => RX_SOLO_CIFRA.test(t[2]));
      if (cifras.length) vistosConCifras += 1;
      if (cifras.length === esperadas.length) { parrafo = m; conCifra = cifras; break; }
      /* Una tabla nueva antes de encontrarla: la descripción de ESTA no está. */
      if (/<w:tbl[ >]/.test(salida.slice(rxParrafo.lastIndex, rxParrafo.lastIndex + 40))) break;
    }
    if (!parrafo) {
      if (Array.isArray(avisos) && vistosConCifras) {
        avisos.push(`la descripción de «${bloque.titulo || nombres}» no trae las `
          + `${esperadas.length} cifras que se esperaban, así que se dejó como estaba`);
      }
      continue;
    }

    /* De atrás hacia adelante: cada sustitución mueve los índices de lo que va después. */
    let nuevo = parrafo[0];
    for (let i = conCifra.length - 1; i >= 0; i -= 1) {
      const t = conCifra[i];
      /* Se conservan los paréntesis que la plantilla ponga dentro del propio `<w:t>`. */
      const abre = /^\s*\(/.test(t[2]) ? '(' : '';
      const cierra = /\)\s*$/.test(t[2]) ? ')' : '';
      nuevo = nuevo.slice(0, t.index) + t[1] + escaparXml(abre + esperadas[i] + cierra) + t[3]
        + nuevo.slice(t.index + t[0].length);
    }
    salida = salida.slice(0, parrafo.index) + nuevo + salida.slice(parrafo.index + parrafo[0].length);
  }

  return salida;
}

/* El año que la conclusión del rango menciona junto a las cifras del estudio: «…del margen
   operacional ajustado durante el 2024». Venía de la plantilla, así que el informe se
   radicaba con el año del contribuyente anterior al lado de cifras del actual.

   Se ancla en las palabras que rodean al año y NO en la posición respecto a la tabla: ese
   párrafo está a un salto de página de ella —carácter 501.297 en el informe del cliente— y la
   frase viaja completa dentro de un mismo `<w:t>`, así que cambiar el año ahí no toca los
   runs vecinos ni el formato.

   Solo ese año. Los demás del documento se quedan como están: los encabezados del ANEXO B
   son los estados financieros disponibles de las comparables, del año anterior, y las
   fuentes citadas llevan su propia fecha. */
const RX_ANIO_CONCLUSION = /(ajustado\s+durante\s+el\s+)(20\d{2})/g;

export function actualizarAnioConclusionRango(xml, anioGravable, avisos) {
  const gravable = Number(anioGravable);
  if (!Number.isInteger(gravable) || gravable < 2000 || gravable > 2100) {
    if (Array.isArray(avisos)) {
      avisos.push('no se pudo leer el año gravable ("' + String(anioGravable) + '"), así que el '
        + 'año de la conclusión del rango se queda como lo trajo la plantilla');
    }
    return String(xml || '');
  }

  let cambiados = 0;
  const salida = String(xml || '').replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g, (todo, abre, contenido, cierra) => {
    const hecho = contenido.replace(RX_ANIO_CONCLUSION, (coincidencia, antes, anio) => {
      if (Number(anio) === gravable) return coincidencia;
      cambiados += 1;
      return antes + gravable;
    });
    return hecho === contenido ? todo : abre + hecho + cierra;
  });

  if (!cambiados && Array.isArray(avisos)) {
    avisos.push('no se encontró el año en la conclusión del rango («…ajustado durante el AÑO»): '
      + 'si tu plantilla lo redacta de otro modo, revísalo a mano antes de radicar');
  }
  return salida;
}

/**
 * Sustituidor de tablas sobre un `document.xml`.
 *
 * Encapsula el XML que va mutando y el registro de las tablas que la plantilla no
 * trae, para que los dos generadores —el de macroeconomía y el de operaciones—
 * compartan el mecanismo en vez de llevar cada uno su copia.
 *
 * Anotar las ausentes es la mitad del valor: hasta ahora el fallo era mudo y la
 * tabla se quedaba con los datos del informe anterior, que es la peor forma de
 * fallar en un documento que se radica ante la DIAN.
 *
 * @param xmlInicial  el `document.xml` de partida.
 * @param avisos      (opcional) arreglo donde se anotan los nombres no encontrados.
 */
function sustituidorDeTablas(xmlInicial, avisos) {
  let out = String(xmlInicial || '');
  return {
    /** true si la tabla estaba y se sustituyó. */
    reemplazar(nombres, generar, opciones) {
      const bloque = localizarBloqueTabla(out, nombres, opciones);
      if (!bloque) {
        if (Array.isArray(avisos)) {
          avisos.push(Array.isArray(nombres) ? nombres[0] : nombres);
        }
        return false;
      }
      /* El generador recibe también el XML de la tabla que va a sustituir. Casi ninguno lo
         necesita, pero hay tablas que la plantilla trae en dos formas —en ficha vertical o
         en columnas— y la única manera de no imponer una es mirar cuántas columnas tiene la
         que ya está ahí. Es el mismo criterio que la ruta del PDF aplica al rango. */
      const nuevo = generar(bloque, out.slice(bloque.inicio, bloque.fin));

      /* La línea «FUENTE: …» de la plantilla vive DETRÁS del cierre de la tabla, fuera del
         bloque. `generarTablaOoxml` emite la suya, así que dejar la vieja publicaba las dos
         —y la vieja nombra al contribuyente del informe de referencia, debajo de la tabla y
         en negrita—. Se absorbe en el tramo que se recorta.

         Solo si la tabla nueva trae fuente: si el generador no emitió ninguna y borráramos la
         de la plantilla, el informe perdería una línea que sí era del cliente. */
      let fin = bloque.fin;
      if (/FUENTE/i.test(nuevo)) {
        fin = finDeFuenteSiguienteOoxml(out, fin);
      }

      out = out.slice(0, bloque.inicio) + nuevo + out.slice(fin);
      return true;
    },
    /** Quita la tabla, su rótulo y la línea FUENTE que la sigue. `true` si estaba.
     *
     *  NO anota en `avisos` cuando no la encuentra: ese arreglo se publica como «No se
     *  encontró en la plantilla: X» y alimenta el semáforo de radicación. Una tabla que se
     *  quiere borrar y no está es el resultado buscado, no un hallazgo. */
    borrar(nombres, opciones) {
      const bloque = localizarBloqueTabla(out, nombres, opciones);
      if (!bloque) return false;
      /* La fuente vive detrás del cierre de la tabla, fuera del bloque, y puede venir tras un
         párrafo vacío que Word deja al exportar. Al sustituir no importa —el generador emite
         la suya—, pero al borrar quedaría huérfana bajo la tabla siguiente, atribuyéndole un
         origen que no es el suyo. */
      const fin = finDeFuenteSiguienteOoxml(out, bloque.fin);
      out = out.slice(0, bloque.inicio) + out.slice(fin);
      return true;
    },
    /** Inserta una tabla después del bloque que sirve de ancla, localizada por NOMBRE.
     *
     *  `generar` recibe el bloque del ancla, para poder componer el rótulo a partir del
     *  número que ese bloque traiga. Devuelve `false` —sin anotar nada en `avisos`— cuando el
     *  ancla no está: quien llama decide qué decir, porque el aviso útil ahí no es «no
     *  encontré el ancla» sino «no pude poner la tabla que hay que declarar». */
    insertar(nombresAncla, generar, opciones) {
      const ancla = localizarBloqueTabla(out, nombresAncla, opciones);
      if (!ancla) return false;
      /* Después de la línea FUENTE del ancla —saltando un párrafo vacío intercalado, si lo
         hay—: colarse entre la tabla y su fuente se la atribuiría a la tabla nueva. */
      const fin = finDeFuenteSiguienteOoxml(out, ancla.fin);
      out = out.slice(0, fin) + generar(ancla) + out.slice(fin);
      return true;
    },
    /* Para lo que no es sustituir una tabla entera —la prosa que la describe, por ejemplo—.
       Existe porque `out` es privado y solo había getter: un `xml = transformar(xml)` en el
       generador modificaba una variable local que nadie volvía a leer, ya que al final se
       devuelve `doc.xml`. El cambio se descartaba en silencio, sin fallar ni avisar. */
    aplicar(transformar) {
      out = transformar(out);
    },
    get xml() { return out; },
  };
}

/* Un párrafo que hay que sustituir por la ecuación: o es la versión en una línea que escribe el
   calco del PDF, o son las letras corruptas que salieron del editor de ecuaciones, o está vacío,
   o ya es la ecuación (y entonces se rehace igual, para que pasar dos veces dé lo mismo). */
const pareceLaEcuacion = (texto, fragmento) => (
  /Adjustment\s*=/i.test(texto)
  || /[A-Z\u{1D400}-\u{1D7FF}]{4,}/u.test(texto)
  || !texto.trim()
  || /<m:oMath[ >]/.test(fragmento)
);

/**
 * Escribe las dos ecuaciones de ajuste con el motor matemático de Word (OMML), donde la plantilla
 * las anuncia con su rótulo.
 *
 * Localiza el rótulo recorriendo PÁRRAFOS y comparando su texto plano, no buscando la cadena en
 * el XML: Word parte el texto de un párrafo en varios `<w:r><w:t>` por revisiones o por el
 * corrector —y «FORMULA» sin tilde es justo lo que el corrector subraya—, y entonces la cadena
 * literal no existe en el XML y la búsqueda fallaba en silencio.
 *
 * Qué dice la ecuación lo decide `formulasOmml.js`, que es la misma fuente que usa el calco
 * del PDF en `docxWriter.js`.
 *
 * @param {string} xml
 * @param {string[]} [avisos] recoge las ecuaciones que no se pudieron escribir
 */
export function actualizarFormulasMatematicasOoxml(xml, avisos) {
  let salida = String(xml || '');
  const anotar = (m) => { if (Array.isArray(avisos)) avisos.push(m); };
  let insertadas = 0;

  for (const tipo of ['AR', 'AP']) {
    const rotulos = ROTULOS_FORMULA[tipo];
    const claves = rotulos.map(claveTitulo);
    const comoSeLlama = tipo === 'AR'
      ? 'la ecuación del ajuste de cuentas por cobrar'
      : 'la ecuación del ajuste de cuentas por pagar';

    /* Regex local y no `PARRAFO_OOXML`: ese es `/gi` compartido con `prosaRangoInforme.js` y
       arrastra su `lastIndex` entre llamadas. */
    const rxParrafo = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
    let rotulo = null;
    let p;
    while ((p = rxParrafo.exec(salida)) !== null) {
      /* Las entradas del índice llevan el rótulo igual que el cuerpo. Reemplazar ahí inyecta una
         segunda ecuación dentro del índice y se lleva por delante el párrafo que la seguía. Se
         descartan por tres vías independientes: el campo PAGEREF que Word pone en toda entrada de
         índice —el mismo filtro que ya usan `localizarBloqueProsa` y `localizarHitos`—, el estilo
         de índice (`TDC1..9` en Word en español, `TOC1..9` en inglés) y la comparación EXACTA,
         que además descarta la entrada con el número de página pegado. */
      if (p[0].includes('PAGEREF')) continue;
      if (/<w:pStyle\s+w:val="(?:TDC|TOC|Tdc|Toc)\d/.test(p[0])) continue;
      const clave = claveTitulo(textoPlanoOoxml(p[0]));
      if (!clave || !claves.includes(clave)) continue;
      rotulo = { fin: p.index + p[0].length };
      break;
    }

    if (!rotulo) {
      anotar(`${comoSeLlama} (el rótulo «${rotulos[0]}»)`);
      continue;
    }

    const hermano = parrafoHermanoSiguiente(salida, rotulo.fin);
    const ecuacion = ooxmlDeFormula(FORMULAS[tipo]);

    if (hermano.bloqueado || !pareceLaEcuacion(textoPlanoOoxml(hermano.xml), hermano.xml)) {
      /* No se sabe qué hay detrás del rótulo en el .docx del cliente: puede ser la basura del
         PDF, pero también una ecuación suya o el párrafo «Dónde:». Se inserta sin borrar y se
         avisa; perder texto de un informe que se radica es peor que dejar algo repetido. */
      salida = salida.slice(0, rotulo.fin) + ecuacion + salida.slice(rotulo.fin);
      insertadas++;
      console.warn('[relleno] tras el rótulo de', comoSeLlama,
        'no había un párrafo sustituible, se insertó la ecuación sin borrar nada');
      anotar(`${comoSeLlama}: se escribió detrás del rótulo sin borrar lo que había, `
        + 'porque no parecía la ecuación vieja');
      continue;
    }

    salida = salida.slice(0, hermano.inicio) + ecuacion + salida.slice(hermano.fin);
    insertadas++;
  }

  return insertadas ? asegurarNamespaceM(salida) : salida;
}


export function actualizarTablasOperacionesOoxml(xml, estudio, avisos) {
  if (!estudio) return xml;

  const doc = sustituidorDeTablas(xml, avisos);
  const reemplazar = (...args) => doc.reemplazar(...args);

  /* Título de la tabla que se emite. Conserva el número que traía la plantilla en vez
     de imponer el nuestro: si el cliente renumeró, escribir «Tabla 17» sobre lo que su
     documento llama «Tabla 15» descuadra la referencia en el índice y en el texto. */
  const tituloDe = (bloque, nombre) => (
    bloque && bloque.numero != null ? `Tabla ${bloque.numero}. ${nombre}` : nombre
  );
  /* El nombre TAL COMO LO ESCRIBE LA PLANTILLA, para las tablas que se buscan por varios
     nombres. Sin esto, regenerar la tabla de un cliente que la rotula «Margen Operacional
     Comparables» se la devolvía titulada «Margen Operacional Compañías Comparables»: corregirle
     las cifras no autoriza a renombrarle la tabla. Si el rótulo no casa con ninguno de los
     nombres —no debería, es como se encontró el bloque— se usa el canónico. */
  const nombreSegunPlantilla = (bloque, nombres) => {
    const clave = claveTitulo(bloque && bloque.titulo);
    return nombres.find((n) => clave.includes(claveTitulo(n))) || nombres[0];
  };
  const year = Number(estudio.anio) || 2025;
  const wrap = (v) => String(v == null || v === '' ? '—' : v);

  /* Las filas del rango y su cálculo viven en `tablasInforme.js`, que es de donde las toma
     también la ruta de plantilla PDF (`tablasHtmlInforme.js`). Antes se calculaban aquí, y
     al añadir esa segunda ruta el cálculo habría quedado duplicado: dos sitios donde
     computar los percentiles del mismo estudio es la forma de acabar publicando dos rangos
     distintos, que es lo que ya pasó cuando había dos implementaciones del cuartil. */
  const rango = filasRangoIntercuartil(estudio);
  const tPLI = rango.tPLI;

  /* La versión horizontal del rango (bloque 5) publica solo los percentiles ajustados. */
  const ajustadoDe = (etiqueta) => {
    const f = rango.filas.find((x) => x.etiqueta === etiqueta);
    return f ? f.ajustado : null;
  };
  const p25Ajustado = ajustadoDe(ETIQUETAS_RANGO.p25);
  const medAjustado = ajustadoDe(ETIQUETAS_RANGO.med);
  const p75Ajustado = ajustadoDe(ETIQUETAS_RANGO.p75);

  const pStr = (v) => (v === null || v === undefined ? '—' : pctf(v));

  /* Las Tablas 1 y 2 dicen lo mismo aquí y en la ruta de plantilla PDF, así que sus filas
     salen de `tablasOperaciones.js` y no se arman dos veces. Ahí vive también el motivo por
     el que el código de operación puede ser «—»: el que había antes en este archivo lo
     inventaba, devolvía '07' —el de END GAME 2024— para cualquier tipo sin paréntesis. */
  /* `titulo` cuando lo trae y `nombre` si no: hay tablas cuyo rótulo es más largo que el
     nombre con el que se localizan —«Método de Precios de Transferencia Aplicable» frente a
     «Método de Precios de Transferencia»— o que llevan el año gravable dentro. */
  const emitir = (b, t) => generarTablaOoxml(
    tituloDe(b, t.titulo || t.nombre), t.encabezados, t.filas, t.fuente
  );

  // 1. Operaciones de Ingreso/Egreso
  reemplazar(
    ['Operaciones de Ingreso', 'Operaciones de Egreso'],
    (b) => emitir(b, filasOperacionesDeIngreso(estudio)),
    { numeros: [1] }
  );

  // 2. Operación analizar
  reemplazar(
    'Operación analizar',
    (b) => emitir(b, filasOperacionAnalizar(estudio)),
    { numeros: [2] }
  );

  /* 3. Transacciones Inter compañía. La plantilla la trae dos veces —una en la
     descripción del vinculado y otra en el análisis— con la misma cabecera y números
     que cambian según el informe (3 y 12 en la del cliente). Se sustituyen las dos
     por ocurrencia, sin depender de esos números. */
  {
    const t3 = filasTransaccionesIntercompania(estudio);
    const tablaTx = (b) => generarTablaOoxml(
      tituloDe(b, t3.nombre), t3.encabezados, t3.filas, escaparXml(t3.fuente)
    );
    /* De atrás hacia adelante: sustituir la primera desplaza los índices de la
       segunda, y el localizador trabaja sobre posiciones del XML. */
    /* `excluir`: hay plantillas que rotulan la tabla de la sección 4 como «Operación adicional
       Transacciones Inter compañía», y el localizador casa por inclusión, así que sin el veto
       la ficha del vinculado se escribiría encima de aquélla. */
    const soloTx = { excluir: NOMBRES_TABLA_ADICIONAL };
    reemplazar(NOMBRES_TABLA_TRANSACCIONES, tablaTx, { ...soloTx, ocurrencia: 1 });
    reemplazar(NOMBRES_TABLA_TRANSACCIONES, tablaTx, { ...soloTx, ocurrencia: 0 });
  }

  /* 3-bis. Operación adicional Transacciones Intercompañía — la sección «4. Información
     adicional» del formato (códigos DIAN 61 a 63: préstamos, reintegros y operaciones a
     nombre de vinculados que no se reflejan en el Estado de Resultados).

     Se publica SOLO si el formato la trajo y su total supera el umbral del año gravable. Si
     no, la tabla que la plantilla trae hay que ELIMINARLA: la plantilla es el informe del
     año anterior, así que sus filas son las operaciones de ese informe y dejarlas quietas
     las declara como de este contribuyente. Se va con su rótulo y su línea de fuente, y sin
     aviso —un borrado intencionado no es una tabla que no se encontró—.

     La plantilla puede traerla en columnas o en ficha vertical, como pasa con el rango: se
     mira cuántas columnas declara la que ya está ahí en vez de imponer una forma. */
  if (tieneOperacionAdicional(estudio)) {
    /* `ficha`: cuando se sustituye una tabla que ya está, la forma la decide ella misma —se
       cuentan sus `<w:gridCol>`—; cuando se inserta no hay tabla previa que mirar y el
       conteo daría 0, así que la decide quien llama. En la inserción la forma la elegimos
       nosotros: ficha, como el ancla («Transacciones Inter compañía»). */
    const emitirAdicional = (b, xmlBloque, titulo, ficha) => {
      const columnas = (String(xmlBloque || '').match(/<w:gridCol\b/g) || []).length;
      const t = ficha != null
        ? (ficha ? filasOperacionAdicionalFicha(estudio) : filasOperacionAdicional(estudio))
        : (columnas > 0 && columnas <= 2
          ? filasOperacionAdicionalFicha(estudio)
          : filasOperacionAdicional(estudio));
      return generarTablaOoxml(
        titulo != null ? titulo : tituloDe(b, t.nombre),
        t.encabezados, t.filas, escaparXml(t.fuente)
      );
    };

    const bloques = candidatosBloqueTabla(doc.xml, NOMBRES_TABLA_ADICIONAL);
    if (bloques.length) {
      /* Reemplazamos todas las ocurrencias de atrás hacia adelante para no alterar offsets de forma destructiva */
      for (let idx = bloques.length - 1; idx >= 0; idx--) {
        reemplazar(NOMBRES_TABLA_ADICIONAL, (b, xmlBloque) => emitirAdicional(b, xmlBloque), { ocurrencia: idx });
      }
    } else {
      /* La plantilla no la trae y hay que declararla: se inserta tras «Transacciones Inter
         compañía», que es donde el informe de referencia la lleva. El ancla se busca por
         nombre —la numeración no es fiable— y con el veto de los nombres de esta tabla, para
         no anclar sobre ella. La tabla insertada es una ficha, como el ancla. */
      const t = filasOperacionAdicionalFicha(estudio);
      const insertada = doc.insertar(
        NOMBRES_TABLA_TRANSACCIONES,
        (ancla) => {
          /* El número del ancla + 1, sin número si no lo trae. No se renumera lo que sigue,
             así que esto puede repetir un número existente: el aviso lo nombra. */
          const titulo = ancla.numero != null
            ? 'Tabla ' + (ancla.numero + 1) + '. ' + t.nombre
            : t.nombre;
          return emitirAdicional(ancla, '', titulo, true);
        },
        { excluir: NOMBRES_TABLA_ADICIONAL }
      );
      if (Array.isArray(avisos)) {
        avisos.push(insertada
          ? 'se insertó la tabla «' + t.nombre + '» después de «Transacciones Inter compañía»'
            + ' porque la plantilla no la traía: revise la numeración de las tablas siguientes'
          : NOMBRES_TABLA_ADICIONAL[0]);
      }
    }
  } else {
    const bloques = candidatosBloqueTabla(doc.xml, NOMBRES_TABLA_ADICIONAL);
    for (let idx = bloques.length - 1; idx >= 0; idx--) {
      doc.borrar(NOMBRES_TABLA_ADICIONAL, { ocurrencia: idx });
    }
  }

  // 4. Método de Precios de Transferencia Aplicable
  reemplazar(
    'Método de Precios de Transferencia',
    (b) => emitir(b, filasMetodoAplicable(estudio)),
    { numeros: [4] }
  );

  // 6. Composición accionaria
  reemplazar(
    'Composición accionaria',
    (b) => emitir(b, filasComposicionAccionaria(estudio)),
    { numeros: [6] }
  );

  // 7. Compañías vinculadas al cierre del año gravable
  reemplazar(
    'Compañías vinculadas',
    (b) => emitir(b, filasCompaniasVinculadas(estudio)),
    { numeros: [8] }
  );

  // 8. Criterios de vinculación económica
  reemplazar(
    'Criterios de vinculación',
    (b) => emitir(b, filasCriteriosVinculacion(estudio)),
    { numeros: [9] }
  );

  // 9. Tabla 10. Activos a 31 de diciembre del año gravable
  reemplazar(
    'Activos a 31 de diciembre',
    (b) => emitir(b, filasActivos(estudio)),
    { numeros: [10] }
  );

  // 10. Razones de rechazo
  reemplazar('Razones de rechazo', (b) => {
    const { filas: razonesFilas } = filasRazonesRechazo(estudio.embudoSeleccion);
    const filas16 = (razonesFilas || []).map((f) => [
      f.etiqueta,
      f.letra,
      String(f.cuantas)
    ]);
    const totalEvaluadas = estudio.embudoSeleccion ? String(estudio.embudoSeleccion.evaluadas) : '—';
    filas16.push([
      'TOTAL, UNIVERSO',
      '',
      totalEvaluadas
    ]);
    const dbFuente = estudio.database_source || `${BASE_DATOS_FUENTE} Publicado en septiembre de 2025`;
    return generarTablaOoxml(
      tituloDe(b, 'Razones de rechazo (Filtros Cuantitativos – Filtros Cualitativos)'),
      ['FILTRO APLICADO INTERNACIONALES', 'FILTROS APLICADO', 'N° POR FILTRO'],
      filas16,
      `Información Base Datos ${dbFuente}.`
    );
  }, { numeros: [16] });

  /* 10.5. Códigos SIC utilizados (Criterios de búsqueda). La plantilla trae esta tabla hasta
     tres veces —Ryan LLC, Capital IQ y Refinitiv— y el sistema hoy usa únicamente Capital IQ
     como fuente del cribado. Mismo criterio, mismo motivo y misma fuente de datos
     (`filasCriteriosScreening`, `tablasInforme.js`) que la ruta de plantilla PDF
     (`actualizarTablasMotorHtml`, `tablasHtmlInforme.js:406-444`): sin este bloque, esta era
     la única tabla del motor que la ruta .docx nunca tocaba, y se radicaba con el cribado del
     año y la fuente (Capital IQ/Refinitiv) del informe del que salió la plantilla —
     reportado con capturas de un informe real el 2026-08-18.

     Sin `numeros` claros y con un número de ocurrencias distinto de 3, no hay forma de saber
     con certeza cuál copia es la real: se deja tal cual y se avisa, en vez de arriesgar borrar
     o mezclar la copia equivocada — mismo criterio que ya sigue este módulo ante ambigüedad
     (ver «Rango Intercuartil»/«Tabla de rangos» más abajo).

     Con exactamente 3 copias, «la del medio es Capital IQ» vale por POSICIÓN y no solo
     cuando la plantilla la numeró 14 (o no la numeró): un informe real de BEUMER las traía
     numeradas 18/19/20 —la plantilla se renumeró con los años— y, como ninguna es 14 ni es
     `null`, la tabla 19 no encajaba en ninguna de las dos ramas: no se borraba, pero tampoco
     se actualizaba, y el informe quedaba con el cribado del año anterior sin avisar. Solo se
     excluye por posición la que trae 13 o 15 explícito — un número inequívoco pesa más que la
     posición —, reportado por el usuario 2026-08-20.

     Con exactamente 2 copias y ninguna numerada 13/14/15, no hay una «del medio»: la posición
     no alcanza para distinguirlas. Ahí se decide por la línea de fuente de cada una —«Fuente:
     Búsqueda de Capital IQ…»—: la que la cite se conserva y se actualiza, la otra se borra. Si
     ninguna la cita, o la citan las dos, no hay con qué distinguir con certeza y se borran
     las dos —una tabla ausente y avisada es preferible a una desactualizada sin aviso—.
     También pedido por el usuario 2026-08-20. Con una sola copia ambigua (sin número y sin
     ninguna otra con la que distinguirla) no aplica esta regla: no hay nada que desambiguar,
     así que se deja como antes (sin tocar, con aviso). */
  doc.aplicar((actual) => {
    const criterios = filasCriteriosScreening(estudio);
    if (!criterios.length) {
      if (Array.isArray(avisos)) avisos.push(TABLA_CRITERIOS);
      return actual;
    }
    const bloques = localizarBloquesTabla(actual, TABLA_CRITERIOS);
    if (!bloques.length) {
      if (Array.isArray(avisos)) avisos.push(TABLA_CRITERIOS);
      return actual;
    }

    const veredictos = bloques.map((bloque, idx) => {
      const esNumeroDescartable = bloque.numero === 13 || bloque.numero === 15;
      return {
        eliminar: esNumeroDescartable
          || (bloque.numero !== 14 && bloques.length === 3 && (idx === 0 || idx === 2)),
        conservar: bloque.numero === 14
          || (!esNumeroDescartable && bloques.length === 3 && idx === 1),
      };
    });

    /* Los que ni el número ni la posición resolvieron se deciden por la fuente — pero solo
       cuando hay al menos dos copias entre las que elegir: con una sola no hay nada que
       desambiguar. */
    const indecisos = veredictos
      .map((v, i) => (!v.eliminar && !v.conservar ? i : -1))
      .filter((i) => i >= 0);
    if (indecisos.length >= 2) {
      const citaCapitalIQ = (i) => /capital\s*iq/i.test(
        textoPlanoOoxml(actual.slice(bloques[i].inicio, bloques[i].fin))
      );
      const conCita = indecisos.filter(citaCapitalIQ);
      const aConservar = conCita.length === 1 ? conCita[0] : -1;
      indecisos.forEach((i) => {
        if (i === aConservar) veredictos[i].conservar = true;
        else veredictos[i].eliminar = true;
      });
    }

    let salida = actual;
    let algunaConservada = false;
    /* De atrás hacia adelante, como en Transacciones Inter compañía y en Rango Intercuartil:
       borrar o reescribir mueve los índices de lo que va después en el documento. */
    for (let idx = bloques.length - 1; idx >= 0; idx -= 1) {
      const bloque = bloques[idx];
      const { eliminar, conservar } = veredictos[idx];
      if (eliminar) {
        salida = salida.slice(0, bloque.inicio) + salida.slice(bloque.fin);
      } else if (conservar) {
        salida = salida.slice(0, bloque.inicio)
          + reescribirFilasOoxml(salida.slice(bloque.inicio, bloque.fin), criterios)
          + salida.slice(bloque.fin);
        algunaConservada = true;
      }
    }
    if (!algunaConservada && Array.isArray(avisos)) avisos.push(TABLA_CRITERIOS);
    return salida;
  });

  // 11. Muestra Compañías comparables
  reemplazar('Muestra Compañías comparables', (b) => {
    const filas17 = filasMuestraComparables(estudio).map((f) => [
      String(f.numero), f.nombre, f.ambito,
    ]);
    const dbFuente = estudio.database_source || BASE_DATOS_FUENTE;
    /* Todo en mayúscula menos el rótulo: en la ruta de PDF el rótulo vive FUERA de la tabla y
       no se sube, así que subirlo aquí separaría las dos salidas. La línea de fuente sí, porque
       allá va dentro de la tabla y sube con ella. */
    return generarTablaOoxml(
      tituloDe(b, 'Muestra Compañías comparables'),
      ['Número', 'Nombre de la Compañía', 'Ámbito'].map(enMayusculas),
      filasEnMayusculas(filas17),
      enMayusculas(`Información Base Datos ${dbFuente}`)
    );
  }, { numeros: [17] });

  /* 5/12. Rango Intercuartil —horizontal Y vertical— más «Tabla de rangos».
   *
   * La plantilla trae el rango vertical con el MISMO rótulo «Rango Intercuartil» una,
   * dos o más veces —o con el nombre alterno «Tabla de rangos», el rótulo dentro de su
   * primera fila—, además de la versión horizontal de los resultados. Antes se asumía un
   * número fijo de ocurrencias (horizontal = ocurrencia 0, vertical = ocurrencia 1), que
   * es justo lo que se rompe en cuanto la plantilla trae una copia vertical de más: en un
   * informe real de MONTACHEM (reportado el 2026-08-20) la segunda tabla vertical se
   * quedaba con los percentiles del informe de referencia, sin aviso —exactamente lo que
   * ya no le pasa a la ruta de plantilla PDF (`actualizarTablasMotorHtml`,
   * `tablasHtmlInforme.js`), que es de donde sale este mismo criterio: tomar TODAS las
   * ocurrencias que declare el documento y distinguirlas por FORMA —la horizontal tiene 4
   * columnas (contribuyente + 3 percentiles), la vertical 3 (etiqueta + no ajustado +
   * ajustado)—, no por número ni por posición fija. */
  doc.aplicar((xmlActual) => {
    /* Una misma tabla puede calzar por las DOS vías de `candidatosBloqueTabla`: el
       párrafo que la precede («Tabla 21. Rango Intercuartil») Y su propia primera fila
       («RANGO INTERCUARTIL» como encabezado de columna). La segunda es un candidato
       anidado dentro del primero —mismo `fin`, `inicio` posterior—; sin descartarlo se
       sustituiría la misma tabla dos veces con offsets que la segunda vuelta ya no tiene
       vigentes. Se recorren de menor a mayor `inicio` y se descarta el que empiece dentro
       del bloque ya aceptado, quedándose con el más ancho de cada grupo. */
    const bloques = [
      ...localizarBloquesTabla(xmlActual, 'Rango Intercuartil'),
      ...localizarBloquesTabla(xmlActual, 'Tabla de rangos'),
    ].sort((a, b) => a.inicio - b.inicio);
    const sinSolape = [];
    for (const b of bloques) {
      const anterior = sinSolape[sinSolape.length - 1];
      if (anterior && b.inicio < anterior.fin) continue;
      sinSolape.push(b);
    }

    if (!sinSolape.length) {
      if (Array.isArray(avisos)) avisos.push('Rango Intercuartil');
      return xmlActual;
    }

    const filasVertical = rango.filas.map((f) => [
      wrap(f.etiqueta), pStr(f.noAjustado), pStr(f.ajustado),
    ]);
    const col1Horizontal = estudio.ent ? String(estudio.ent).toUpperCase() : 'CONTRIBUYENTE';
    const columnasDe = (bloque) => {
      const iFila = xmlActual.indexOf('<w:tr', bloque.inicio);
      if (iFila === -1 || iFila > bloque.fin) return 0;
      const finFila = finDeFila(xmlActual, iFila);
      if (finFila < 0 || finFila > bloque.fin) return 0;
      return (xmlActual.slice(iFila, finFila).match(/<w:tc\b/g) || []).length;
    };

    let salida = xmlActual;
    let verticalesHechas = 0;
    /* De atrás hacia adelante, como en Transacciones Inter compañía: sustituir uno mueve
       los offsets de los que van después. */
    for (const bloque of [...sinSolape].sort((a, b) => b.inicio - a.inicio)) {
      const esHorizontal = columnasDe(bloque) >= 4;
      const nuevo = esHorizontal
        ? generarTablaOoxml(
          tituloDe(bloque, 'Rango Intercuartil'),
          [col1Horizontal, 'Percentil 25', 'Mediana', 'Percentil 75'],
          [[pStr(tPLI), pStr(p25Ajustado), pStr(medAjustado), pStr(p75Ajustado)]],
          'Información suministrada por la Administración de la Compañía.'
        )
        : generarTablaOoxml(
          tituloDe(bloque, /tabla de rangos/i.test(bloque.titulo) ? 'Tabla de rangos' : 'Rango Intercuartil'),
          ['RANGO INTERCUARTIL', `RANGE ${estudio.pli || 'MO'} NO AJUSTADO`, `RANGE ${estudio.pli || 'MO'} AJUSTADO`],
          filasVertical
        );

      let fin = bloque.fin;
      if (/FUENTE/i.test(nuevo)) fin = finDeFuenteSiguienteOoxml(salida, fin);
      salida = salida.slice(0, bloque.inicio) + nuevo + salida.slice(fin);
      if (!esHorizontal) verticalesHechas += 1;
    }

    if (!verticalesHechas && Array.isArray(avisos)) avisos.push('Tabla de rangos');
    return salida;
  });

  /* La frase que comenta el rango, debajo de la tabla, y el año que menciona.

     Primero por las palabras que introducen cada cifra (`prosaRangoInforme.js`), que es la
     misma función que atiende la ruta de plantilla PDF: así las dos rutas producen la misma
     frase, sea la plantilla base un .docx o un PDF, y el orden en que la redacción liste los
     cuartiles deja de importar.

     Y sólo si eso no reconoció nada, por POSICIÓN, que es lo que se hacía: la primera cifra es
     el percentil 25, la segunda el 75 y la tercera la mediana, el orden de la redacción de la
     plantilla de este cliente («…se ubica entre el percentil 25 (X) y (Y) percentil 75, la
     mediana con (Z)»). Se conserva como respaldo porque cubre redacciones donde la cifra no va
     detrás de su rótulo, y porque es la que está probada contra el .docx real. */
  const reporteProsa = {};
  const antesDeProsa = doc.xml;
  doc.aplicar((x) => actualizarProsaRango(x, estudio, avisos,
    { rxParrafo: PARRAFO_OOXML, reporte: reporteProsa }));
  if (doc.xml === antesDeProsa) {
    doc.aplicar((x) => actualizarProsaTrasTabla(
      x, 'Rango Intercuartil',
      [pStr(p25Ajustado), pStr(p75Ajustado), pStr(medAjustado)],
      avisos,
    ));
  }
  /* El año va SIEMPRE, y no sólo cuando el respaldo posicional entra. Estaba dentro del `if`, y
     eso funcionaba mientras las plantillas que necesitaban el año fueran justo las que la prosa
     no sabía tocar. Al emparejar por cercanía, la frase de la plantilla que escribe las cifras
     sin paréntesis ya se actualiza —el `if` deja de entrar— y con él se habría ido el «ajustado
     durante el 20XX», que en esa plantilla vive en otro párrafo. Se salta si la prosa ya lo puso,
     porque entonces el aviso sería el mismo recado dos veces en el panel. */
  if (!reporteProsa.anioPuesto) {
    doc.aplicar((x) => actualizarAnioConclusionRango(x, year, avisos));
  }

  /* Las otras frases que citan cifras de una tabla: cuántas comparables se identificaron y
     cuántas quedaron, el monto de la operación con el vinculado y el año de los estados
     financieros de las comparables. Van por la misma función que la ruta del PDF, con el
     delimitador de párrafo de Word, para que las dos rutas no puedan quedarse una con menos
     arreglos que la otra. */
  doc.aplicar((x) => actualizarProsaTablas(x, estudio, avisos, { rxParrafo: PARRAFO_OOXML }));

  /* El nombre de la base de datos de la que salieron los comparables, por lo mismo: la plantilla
     es el informe del año anterior y nombra OneSource de Thomson Reuters, mientras el cribado sale
     de Capital IQ. Va por la misma función que la ruta del PDF, con el delimitador de Word. */
  doc.aplicar((x) => actualizarProsaBaseDatos(x, avisos, { rxParrafo: PARRAFO_OOXML }));

  /* 13. Margen Operacional Compañías Comparables.

     Se localiza por el nombre COMPLETO, no por «Margen Operacional» a secas. La clave corta
     casa por inclusión con la prosa del propio informe: en la plantilla de End Game, el
     párrafo «Para el análisis del método TU se consideró que el indicador financiero de
     rentabilidad más apropiado es el Margen Operacional…» va seguido de la tabla de
     definiciones del método, y está 79 000 caracteres ANTES del rótulo verdadero. Mientras la
     plantilla numere la tabla como la 19 el desempate de `numeros` lo tapa; en cuanto un
     cliente la renumera, `numeros` no filtra nada, gana el primer candidato por posición y el
     generador sustituye la tabla de definiciones mientras la de márgenes se queda con las
     cifras del informe anterior —el fallo que se reportó el 2026-08-11—.

     El nombre de la tabla es lo único estable: el prefijo se renumera al reordenar el informe,
     y hay plantillas que lo rotulan sin número. Por eso se busca solo por el nombre. */
  {
    const generarTabla19 = (b) => {
      const compList = filasComparablesInforme(estudio);
      const filas19 = (compList || []).map((f) => [
        f.nombre,
        pStr(f.noAjustado),
        pStr(f.ajustado)
      ]);
      const dbFuente = estudio.database_source || BASE_DATOS_FUENTE;
      /* En mayúscula, menos el rótulo: ver el comentario de la muestra. */
      return generarTablaOoxml(
        tituloDe(b, nombreSegunPlantilla(b, NOMBRES_TABLA_MARGENES)),
        ['COMPARABLES', `${estudio.pli || 'MO'} NO AJUSTADO`, `${estudio.pli || 'MO'} AJUSTADO`],
        filasEnMayusculas(filas19),
        enMayusculas(`Información Base Datos ${dbFuente} Fecha de consulta: septiembre de ${year}.`)
      );
    };
    /* Sin `numeros`: el prefijo «Tabla N.» cambia de una plantilla a otra —y hay plantillas que
       rotulan la tabla sin número—, así que el número no es criterio de nada. El nombre
       completo, en cambio, es único en el documento: se buscó sobre el word/document.xml de End
       Game y de los trece párrafos que mencionan «margen operacional» solo uno tiene esa clave.

       Tampoco se cae al nombre corto cuando no aparece. Con la clave corta el único candidato
       que queda es la prosa, y sustituir ahí destruye la tabla de definiciones del método sin
       tocar la de márgenes: dos tablas mal en vez de una. Si el rótulo no está, `reemplazar`
       anota la tabla en los avisos y el panel lo dice antes de radicar, que es lo que este
       mecanismo existe para hacer. */
    reemplazar(NOMBRES_TABLA_MARGENES, generarTabla19);
  }

  return doc.xml;
}

/**
 * Sustituye los marcadores del .docx por los datos del estudio.
 *
 * El `parser` delega en `valorDeCampo` (`plantillaVocabulario.js`), que ya resuelve
 * los campos con punto —`rango.p25`, `uvt.tope45k`, `accionista.nombre`— y devuelve
 * el valor ya formateado o `null`. Delegar evita construir un objeto anidado y, más
 * importante, mantiene una sola definición de qué vale cada campo: la misma que usa
 * la ruta de PDF.
 *
 * `nullGetter` escribe «—» y no un valor por defecto. Es la regla que el vocabulario
 * defiende explícitamente: el informe se radica ante la DIAN, y un hueco visible es
 * preferible a heredar la cifra del cliente anterior.
 *
 * @param {ArrayBuffer|Uint8Array|Buffer} binario  el .docx marcado.
 * @param {object} estudio
 * @param {{colecciones?:object, delimitadores?:{abrir:string,cerrar:string}}} [opciones]
 *        `colecciones` alimenta los bucles de tabla (`{#comparables}…{/comparables}`).
 * @returns {{zip:PizZip, camposVacios:string[], avisosTablas:string[]}} el zip listo para
 *          generar, qué campos salieron sin dato y qué tablas no se encontraron en la
 *          plantilla, para poder avisar de ambas cosas antes de radicar.
 */
/**
 * Si el marcado dejó un bucle de Docxtemplater desbalanceado —una celda sin `<w:t>`
 * donde escribir `{#coleccion}` o `{/coleccion}` se lo tragó en silencio, ver
 * `escribirEnCelda` en `docxPlantilla.js`—, Docxtemplater revienta el render COMPLETO
 * con "Unopened/Unclosed loop" aunque el resto del documento esté perfecto. Se detecta
 * contando aperturas y cierres de la colección y, si no cuadran, se retira el tag suelto
 * en vez de tumbar la generación entera de un informe que se radica ante la DIAN: la
 * fila que debía repetirse se queda como texto fijo de la plantilla.
 */
function quitarBucleSiDesbalanceado(xml, nombre, avisos) {
  const apertura = '{#' + nombre + '}';
  const cierre = '{/' + nombre + '}';
  const nAbre = xml.split(apertura).length - 1;
  const nCierra = xml.split(cierre).length - 1;
  if (nAbre === nCierra) return xml;
  if (Array.isArray(avisos)) {
    avisos.push(`el bucle "${nombre}" de la plantilla quedó desbalanceado, se ignoró para no bloquear la generación`);
  }
  console.warn(`[relleno] bucle "${nombre}" desbalanceado (${nAbre} apertura(s), ${nCierra} cierre(s)); se retira`);
  return xml.split(apertura).join('').split(cierre).join('');
}

export function renderizarDocx(binario, estudio, opciones = {}) {
  const { datosMacro, analisisSector, colecciones = {}, delimitadores } = opciones;
  const camposVacios = new Set();

  const zip = new PizZip(binario);

  /* Las tablas que la plantilla no trae se recogen aquí y se devuelven. Sin el arreglo, el
     sustituidor calcula el aviso y nadie lo lee: la tabla se queda con los datos del cliente
     anterior y el informe se radica así. */
  const avisosTablas = [];

  // Actualizar tablas macro antes de procesar marcas con docxtemplater
  let xml = zip.file(RUTA_DOC).asText();
  const year = Number(estudio && estudio.anio) || 2025;

  /* Las fuentes de la Sección III van como notas al pie, en formato bibliográfico y con el enlace
     clicable (2026-08-20). Aquí es el único sitio con el paquete entero, que es lo que una nota al
     pie necesita: su texto vive en `word/footnotes.xml` y su enlace en las relaciones de ese
     archivo. Los apartados solo piden el número y siguen. */
  const leerParte = (ruta) => {
    const parte = zip.file(ruta);
    return parte ? parte.asText() : '';
  };
  const footnotesPrevio = leerParte(RUTA_FOOTNOTES);
  const relsNotasPrevio = leerParte(RUTA_FOOTNOTES_RELS);
  const primerRelLibre = idsDeRelacionLibres(relsNotasPrevio, 1)[0] || 'rIdNota1';
  const notas = crearRecolectorDeNotas({
    idInicial: siguienteIdDeNota(footnotesPrevio),
    inicioRel: Number(String(primerRelLibre).replace(/\D+/g, '')) || 1,
    /* Los de la plantilla, para que las notas nuevas se lean igual que las que ya trae. */
    estilos: estilosDeNota(leerParte('word/styles.xml')),
  });

  /* Todo el cuerpo del informe justificado, ANTES de cualquier relleno. La ruta de HTML ya
     lo hacía por su CSS y por el conversor a OOXML; esta no, porque los párrafos vienen de
     la plantilla del cliente con la alineación que esta traiga —y varía: END GAME deja 339
     párrafos sin declararla y MC INTERNACIONAL trae 30 con «left» explícito—.

     Va aquí y no al final por una razón de propiedad: la justificación normaliza la
     PLANTILLA, mientras que los párrafos que este generador inserta después traen su
     formato deliberado (los pies «FUENTE:» a la izquierda, los títulos de tabla y las
     imágenes centrados). Al aplicarla antes, ese formato manda sobre ella. */
  const justificado = justificarCuerpoOoxml(xml, leerParte('word/styles.xml'));
  xml = justificado.xml;

  xml = actualizarApartadosMacroOoxml(xml, datosMacro, year, avisosTablas, notas);
  xml = actualizarApartadoSectorialOoxml(xml, analisisSector, estudio, year, avisosTablas, notas);
  xml = actualizarTablasMacroOoxml(xml, datosMacro, year, avisosTablas);
  xml = actualizarTablasOperacionesOoxml(xml, estudio, avisosTablas);
  /* La letra de la Sección III, DESPUÉS de que sus apartados, su análisis sectorial y sus ocho
     tablas estén ya puestos: la pasada tiene que ver el contenido definitivo, no el de la
     plantilla. Y antes de docxtemplater, que no se entera: insertar un `rPr` no parte ni funde
     ningún `<w:t>`, así que los marcadores `{campo}` siguen enteros. */
  xml = aplicarLetraMacroOoxml(xml);
  Object.keys(colecciones).forEach((nombre) => {
    xml = quitarBucleSiDesbalanceado(xml, nombre, avisosTablas);
  });
  zip.file(RUTA_DOC, xml);

  /* Las notas que pidieron los apartados, ahora que el cuerpo ya tiene sus referencias. Va DESPUÉS
     de escribir el documento y ANTES de docxtemplater: si el cuerpo cita una nota que no existe en
     `footnotes.xml`, Word declara el documento dañado al abrirlo. */
  if (notas.cuantas()) {
    zip.file(RUTA_FOOTNOTES, agregarNotasAlPie(footnotesPrevio, notas.notasXml()));

    const enlaces = notas.enlaces();
    if (enlaces.length) {
      zip.file(RUTA_FOOTNOTES_RELS, relsDeNotasAlPie(relsNotasPrevio, enlaces));
    }

    /* Si la plantilla no traía notas, la parte hay que declararla y relacionarla; con ellas ya
       está, y las dos funciones son idempotentes. */
    if (!footnotesPrevio) {
      zip.file(RUTA_CT, contentTypesConNotasAlPie(leerParte(RUTA_CT)));
      zip.file(RUTA_RELS, relsDocumentoConNotasAlPie(leerParte(RUTA_RELS), 'rIdNotasAlPie'));
    }
    console.log(`[docxRelleno] Sección III: ${notas.cuantas()} fuente(s) citadas como nota al pie`
      + `${enlaces.length ? `, ${enlaces.length} con enlace` : ''}.`);
  }

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    ...(delimitadores ? { delimiters: { start: delimitadores.abrir, end: delimitadores.cerrar } } : {}),
    parser: (tag) => ({
      get(scope) {
        /* Dentro de un bucle manda el elemento de la colección: `{nombre}` en una
           fila de comparables es del comparable, no del estudio. */
        if (scope && Object.prototype.hasOwnProperty.call(scope, tag)) return scope[tag];
        if (Object.prototype.hasOwnProperty.call(colecciones, tag)) return colecciones[tag];
        const v = valorDeCampo(estudio, tag, { datosMacro, analisisSector });
        if (v === null || v === undefined || v === '') { camposVacios.add(tag); return null; }
        return v;
      },
    }),
    nullGetter: () => SIN_DATO,
  });

  doc.render(colecciones);

  const zipFinal = doc.getZip();
  insertarFormulasAjuste(zipFinal, avisosTablas);
  return { zip: zipFinal, camposVacios: [...camposVacios], avisosTablas };
}

/**
 * Las ecuaciones de ajuste, DESPUÉS del render.
 *
 * Por el mismo motivo que las imágenes: docxtemplater no debe ver este XML. Su configuración
 * incluye `m:t` entre las etiquetas de texto de plantilla, así que una llave dentro de una
 * ecuación se tomaría por un marcador y `nullGetter` la sustituiría por un guion largo, en
 * silencio. Hoy ninguna de las dos lleva llaves; el día que alguien las toque, esto lo cubre.
 *
 * @param {PizZip} zip
 * @param {string[]} [avisos]
 */
export function insertarFormulasAjuste(zip, avisos) {
  const xml = zip.file(RUTA_DOC).asText();
  const salida = actualizarFormulasMatematicasOoxml(xml, avisos);
  if (salida === xml) return { cambiado: false };
  const escrito = escribirDocSiEsValido(zip, salida, avisos, 'Ecuaciones de ajuste');
  return { cambiado: escrito };
}

/** El mayor rId ya usado, para no repetir ninguno al añadir relaciones. */
function siguienteRId(rels) {
  const usados = [...String(rels).matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  return (usados.length ? Math.max(...usados) : 0) + 1;
}

/** El mayor id de `wp:docPr`, que Word exige único en todo el documento. */
function siguienteIdDibujo(xml) {
  const usados = [...String(xml).matchAll(/<wp:docPr\s+id="(\d+)"/g)].map((m) => Number(m[1]));
  return (usados.length ? Math.max(...usados) : 0) + 1;
}

/* Los tres namespaces que necesita un `<w:drawing>`. `a` y `pic` se declaran en el
   propio elemento; `wp` tiene que estar en la raíz del documento, y aunque Word
   siempre lo pone, un .docx generado por otra herramienta puede no traerlo. */
const NS_WP = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';

function asegurarNamespaceWp(xml) {
  if (/xmlns:wp=/.test(xml)) return xml;
  return xml.replace(/<w:document\b([^>]*)>/, (todo, attrs) => `<w:document${attrs} ${NS_WP}>`);
}

/* El namespace de las ecuaciones. Word siempre lo declara, pero el .docx del cliente puede venir
   de LibreOffice o de Google Docs sin una sola ecuación, y entonces no está: al insertar la
   nuestra, Word abre el archivo diciendo que está dañado. */
const NS_M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

function asegurarNamespaceM(xml) {
  if (/xmlns:m=/.test(xml)) return xml;
  return xml.replace(/<w:document\b([^>]*)>/, (todo, attrs) => `<w:document${attrs} ${NS_M}>`);
}

/** El `<w:p>` con la imagen, centrado y a tamaño dado en EMU. */
function parrafoConImagen({ rId, id, nombre, cx, cy }) {
  return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>'
    + '<wp:inline distT="0" distB="0" distL="0" distR="0">'
    + `<wp:extent cx="${cx}" cy="${cy}"/>`
    + `<wp:docPr id="${id}" name="${nombre}"/>`
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:nvPicPr><pic:cNvPr id="${id}" name="${nombre}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}

/**
 * Mete una imagen en el paquete y devuelve el `rId` con el que referirla.
 *
 * Las tres cosas que hay que tocar para que Word la abra —el binario en `word/media/`, el
 * content-type de su extensión y la relación en `document.xml.rels`— van juntas aquí porque
 * olvidar una sola de ellas produce un .docx que Word declara corrupto, y ese es el fallo
 * que el spec 2026-08-04-docx-real-ooxml-design.md documenta como el más fácil de repetir.
 *
 * @returns {{rels:string, ct:string, idRel:string}} los dos archivos ya actualizados.
 */
function registrarImagen({ zip, rels, ct, rId, nombre, base64, datos, ext }) {
  zip.file(`word/media/${nombre}`, base64 || datos, base64 ? { base64: true } : {});

  const ctNuevo = new RegExp(`Extension="${ext}"`).test(ct)
    ? ct
    : ct.replace('</Types>', `<Default Extension="${ext}" ContentType="image/${ext}"/></Types>`);

  const idRel = `rId${rId}`;
  const relsNuevo = rels.replace('</Relationships>',
    `<Relationship Id="${idRel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"`
    + ` Target="media/${nombre}"/></Relationships>`);

  return { rels: relsNuevo, ct: ctNuevo, idRel };
}

/** Separa una data URL en su tipo y sus bytes. */
export function desdeDataUrl(dataUrl) {
  const m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(String(dataUrl || '').trim());
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
  return { ext: ext === 'jpeg' ? 'jpeg' : ext, base64: m[2] };
}

/**
 * Sustituye el párrafo del centinela por una imagen por página.
 *
 * Va DESPUÉS del render: docxtemplater no debe ver el XML de los dibujos.
 *
 * @param {PizZip} zip
 * @param {Array<{dataUrl?:string, datos?:Uint8Array, ext?:string, anchoCm?:number, altoCm?:number}>} imagenes
 * @param {{centinela?:string, avisos?:string[]}} [opciones]
 * @returns {{insertadas:number}}
 */
export function insertarImagenes(zip, imagenes, opciones = {}) {
  const centinela = opciones.centinela || CENTINELA_ANEXO;
  const avisos = opciones.avisos;
  const lista = (imagenes || []).filter(Boolean);

  const xml = zip.file(RUTA_DOC).asText();
  const posicion = xml.indexOf(centinela);
  if (posicion === -1) return { insertadas: 0 };

  /* El párrafo que contiene el centinela. La apertura se busca con la regex que exige un
     espacio, un `>` o un `/` detrás de `<w:p`: `lastIndexOf('<w:p', …)` a secas casaba con
     `<w:pPr`, `<w:pStyle` y `<w:pict`, y el corte partía un elemento por la mitad. El cierre
     lo da `finDeParrafo`, que cuenta anidamiento —un cuadro de texto cuelga párrafos dentro
     de otro— en vez de parar en el primer `</w:p>`. */
  const inicio = inicioDeParrafo(xml, posicion);
  const fin = inicio === -1 ? -1 : finDeParrafo(xml, inicio);
  if (inicio === -1 || fin < 0) return { insertadas: 0 };

  let rels = zip.file(RUTA_RELS).asText();
  let ct = zip.file(RUTA_CT).asText();
  let rId = siguienteRId(rels);
  let idDibujo = siguienteIdDibujo(xml);
  const parrafos = [];

  lista.forEach((img, i) => {
    const desde = img.dataUrl ? desdeDataUrl(img.dataUrl) : null;
    if (!desde && !img.datos) return;
    const ext = (desde && desde.ext) || img.ext || 'png';
    const nombre = `anexo_eeff_${i + 1}.${ext}`;

    zip.file(`word/media/${nombre}`, desde ? desde.base64 : img.datos,
      desde ? { base64: true } : {});

    if (!new RegExp(`Extension="${ext}"`).test(ct)) {
      ct = ct.replace('</Types>',
        `<Default Extension="${ext}" ContentType="image/${ext}"/></Types>`);
    }

    const idRel = `rId${rId++}`;
    rels = rels.replace('</Relationships>',
      `<Relationship Id="${idRel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"`
      + ` Target="media/${nombre}"/></Relationships>`);

    const anchoCm = img.anchoCm || ANCHO_UTIL_CM;
    /* Sin alto conocido se asume la proporción de una hoja A4 vertical, que es lo
       que son las páginas escaneadas del anexo. */
    const altoCm = img.altoCm || (anchoCm * 297) / 210;
    parrafos.push(parrafoConImagen({
      rId: idRel, id: idDibujo++, nombre,
      cx: Math.round(anchoCm * EMU_POR_CM), cy: Math.round(altoCm * EMU_POR_CM),
    }));
  });

  zip.file(RUTA_RELS, rels);
  zip.file(RUTA_CT, ct);

  const candidato = asegurarNamespaceWp(
    xml.slice(0, inicio) + parrafos.join('') + xml.slice(fin));
  if (!escribirDocSiEsValido(zip, candidato, avisos, 'Páginas del anexo de estados financieros')) {
    return { insertadas: 0 };
  }
  return { insertadas: parrafos.length };
}

/**
 * El camino completo: plantilla marcada + estudio → .docx listo para descargar.
 *
 * @param {{binario:ArrayBuffer|Uint8Array|Buffer, estudio:object,
 *          colecciones?:object, imagenesAnexo?:Array, delimitadores?:object,
 *          tipoSalida?:'blob'|'nodebuffer'|'uint8array'}} args
 * @returns {{salida:*, camposVacios:string[], avisosTablas:string[], imagenesInsertadas:number}}
 */
/* ─────────────────────────────────────────────────────────────────────────────
   ANEXO A — Estados financieros del contribuyente, desde la ingesta.

   POR QUÉ NO BASTABA `insertarImagenes`. Depende del centinela `@@ANEXO_EEFF@@`, y la
   plantilla del cliente no lo trae: cero ocurrencias en el informe generado el
   2026-08-10. Las páginas que el usuario ya había cargado en la ingesta nunca entraban
   y el anexo se radicaba en blanco. El ANEXO B se ancla por su encabezado desde el
   principio; el A no tenía equivalente, y esto lo es.

   POR QUÉ TABLAS NATIVAS Y NO SOLO LAS PÁGINAS ESCANEADAS. Las cifras ya están
   parseadas: `eeffParser.js` las escribe en el estudio y de ahí salen la Tabla 10, el
   indicador de rentabilidad y el rango. Publicarlas como tabla —seleccionable, con el
   formato del informe y con el mismo A.V. que el cuerpo— es lo que hace que el anexo
   sea verificable contra el análisis en vez de una foto que nadie puede cotejar. Las
   páginas del PDF van debajo, como soporte.
   ───────────────────────────────────────────────────────────────────────────── */

/** Nombre y valor de cada rubro del ESF que la ingesta sabe leer, en orden de balance. */
const RUBROS_ESF = [
  ['Efectivo y equivalentes de efectivo', 't_cash'],
  ['Inversiones asociadas', 't_inv_assoc'],
  ['Cuentas por cobrar comerciales y otras cuentas por cobrar', 't_ar'],
  ['Inventarios', 't_inv'],
  ['Activos por impuestos corrientes', 't_tax'],
  ['Total, Activo corriente', 't_act_curr'],
  ['Propiedades, planta y equipo', 't_ppe'],
  ['Intangibles', 't_intang'],
  ['Diferidos', 't_dif'],
  ['Total, Activos no corrientes', 't_act_nocurr'],
  ['Total, Activos', 't_act_tot'],
];

/** true si el estudio trae algo del estado financiero que se pueda publicar. */
function traeCifrasEeff(estudio) {
  const claves = [...RUBROS_ESF.map(([, c]) => c), 't_ap', 't_s', 't_c', 't_op'];
  return claves.some((c) => num(estudio && estudio[c]) !== null);
}

/* ─────────────────────────────────────────────────────────────────────────────
   LOCALIZAR LOS ANEXOS.

   Sustituye al `bloqueDeAnexo` que buscaba «ANEXO <letra>» con una regex sobre el XML
   crudo. Aquel fallaba de tres maneras, las tres reproducidas con la plantilla de MC
   Internacional:

   · Anclaba en la TABLA DE CONTENIDO, que repite el título de cada anexo antes de que
     aparezca el del cuerpo. El anexo se rellenaba dentro del índice —al 4 % del
     documento— y el anexo de verdad se radicaba con los datos del cliente anterior. En el
     informe de referencia llevaba pasando sin que se notara.
   · Cerraba el bloque en `xml.length` cuando no encontraba el anexo siguiente. Esa
     plantilla numera A, C, D, E, F: al no haber «ANEXO B» se borraban 5,9 MB de
     `word/document.xml` —`</w:body></w:document>` incluidos— y del .docx resultante
     mammoth solo sabía decir «Hierarchy request error: Only one element can be added and
     only after doctype», que es lo que llegaba al panel de radicación.
   · No veía los encabezados partidos en varios runs (`<w:t>ANEXO </w:t>…<w:t>D. Matriz…`),
     que es como quedan en cuanto alguien los edita en Word. Es el mismo fallo que ya se
     corrigió para los rótulos de las ecuaciones de ajuste.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Los encabezados de anexo del CUERPO del documento, en orden de aparición.
 *
 * @param {string} xml
 * @returns {Array<{letra:string, titulo:string, nombre:string, clave:string, inicio:number,
 *                  finEncabezado:number, fin:number}>}
 *          `inicio` es el arranque del párrafo del encabezado y `finEncabezado` su cierre,
 *          de modo que el contenido del anexo se puede reemplazar conservando su rótulo.
 *          `fin` es el arranque del anexo siguiente o, para el último, el `<w:sectPr>` del
 *          cuerpo. Los anexos sin un corte válido NO se devuelven: mejor dejar uno sin
 *          rellenar que cortar a ciegas.
 */
export function localizarAnexosOoxml(xml) {
  const texto = String(xml || '');
  const rxParrafo = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  const anexos = [];
  let p;
  while ((p = rxParrafo.exec(texto)) !== null) {
    /* La tabla de contenido repite el título de cada anexo en un párrafo con un campo
       PAGEREF. Mismo filtro que `localizarBloqueProsa` y por el mismo motivo. */
    if (p[0].includes('PAGEREF')) continue;
    const cabeza = interpretarEncabezadoAnexo(textoPlanoOoxml(p[0]));
    if (!cabeza) continue;
    const finEncabezado = finDeParrafo(texto, p.index);
    if (finEncabezado < 0) continue;
    anexos.push({ ...cabeza, inicio: p.index, finEncabezado, fin: -1 });
  }

  /* Y si un anexo aparece dos veces con el mismo nombre, la ÚLTIMA es la del cuerpo: el índice
     va al principio del documento. Es la tercera red contra el índice, después del campo
     PAGEREF y del número de página pegado al título, y la única que sigue valiendo cuando el
     índice se escribió a mano y sin numerar. */
  const delCuerpo = anexos.filter(
    (a, i) => !anexos.some((otro, j) => j > i && otro.clave === a.clave));

  /* El corte de cada anexo es el arranque del siguiente. Para el último, el `<w:sectPr>` del
     cuerpo —el tamaño de página y los márgenes del informe viven ahí— o el cierre del cuerpo
     si la plantilla no lo trae. NUNCA `xml.length`: ahí es donde están los cierres de la
     raíz, y llevárselos deja un archivo que ninguna herramienta puede abrir. */
  const cierreCuerpo = texto.lastIndexOf('</w:body>');
  delCuerpo.forEach((a, i) => {
    const siguiente = delCuerpo[i + 1];
    if (siguiente) { a.fin = siguiente.inicio; return; }
    const sect = texto.indexOf('<w:sectPr', a.finEncabezado);
    a.fin = sect >= 0 ? sect : cierreCuerpo;
  });

  return delCuerpo.filter((a) => a.fin >= a.finEncabezado);
}

/** Los anexos que este módulo rellena, resueltos por su nombre. */
export function anexosDelDocumento(xml) {
  return resolverAnexos(localizarAnexosOoxml(xml));
}

/** Empuja un aviso si hay dónde recogerlo. */
function anotarAviso(avisos, texto) {
  if (Array.isArray(avisos)) avisos.push(texto);
}

/** El aviso de un anexo que no se pudo localizar. */
function avisoAnexoNoHallado(id) {
  return nombreDeAnexo(id) + ': la plantilla no trae, en el cuerpo del documento, un '
    + 'encabezado de anexo con ese nombre, así que se deja como estaba. Comprueba cómo está '
    + 'rotulado en tu Word: la letra da igual, el nombre es lo que se busca.';
}

/* ─────────────────────────────────────────────────────────────────────────────
   GUARDA DE INTEGRIDAD.

   Todo lo que va después del render corta y pega `word/document.xml` por índices. Un índice
   mal calculado no lanza ningún error: produce un .docx que Word declara dañado, o del que
   mammoth solo dice «Hierarchy request error». Nadie puede leer eso y el informe llega a
   radicación roto.

   Así que ninguna cirugía escribe directamente: pasan por aquí y lo que no cuadra no se
   aplica. Un anexo sin rehacer es un aviso que se ve y se corrige; un archivo que no abre,
   no.
   ───────────────────────────────────────────────────────────────────────────── */

/** Cuántas aperturas de `nombre` quedan sin cerrar. Los autocerrados no cuentan. */
function balanceDeEtiqueta(xml, nombre) {
  const rx = new RegExp(`<${nombre}(?:\\s[^>]*?)?(/?)>|</${nombre}>`, 'g');
  let abiertos = 0;
  let m;
  while ((m = rx.exec(xml)) !== null) {
    if (m[0].startsWith('</')) abiertos -= 1;
    else if (m[1] !== '/') abiertos += 1;
  }
  return abiertos;
}

/**
 * Qué le impide a `xml` ser el cuerpo de un .docx. Cadena vacía si está bien.
 *
 * Se comprueba lo que rompen los cortes por índice: que la raíz cierre una sola vez y al
 * final, y que los elementos que estas cirugías mueven en bloque —párrafos, tablas, filas
 * y celdas— queden balanceados.
 */
export function problemaDeIntegridadOoxml(xml) {
  const texto = String(xml || '');
  const cuerpos = (texto.match(/<\/w:body>/g) || []).length;
  const raices = (texto.match(/<\/w:document>/g) || []).length;
  if (cuerpos !== 1 || raices !== 1) {
    return `el documento no cierra una sola vez (${cuerpos} </w:body>, ${raices} </w:document>)`;
  }
  if (!/<\/w:body>\s*<\/w:document>\s*$/.test(texto)) {
    return 'el documento no termina en </w:body></w:document>';
  }
  for (const etiqueta of ['w:p', 'w:tbl', 'w:tr', 'w:tc']) {
    const balance = balanceDeEtiqueta(texto, etiqueta);
    if (balance > 0) return `quedan ${balance} <${etiqueta}> sin cerrar`;
    if (balance < 0) return `sobran ${-balance} </${etiqueta}>`;
  }
  return '';
}

/**
 * Escribe `word/document.xml` solo si el resultado sigue siendo un documento válido.
 *
 * @param {PizZip} zip
 * @param {string} xmlNuevo
 * @param {string[]} [avisos]
 * @param {string} etiqueta  con qué nombre se reporta la cirugía que no se pudo aplicar.
 * @returns {boolean} si se escribió.
 */
function escribirDocSiEsValido(zip, xmlNuevo, avisos, etiqueta) {
  const problema = problemaDeIntegridadOoxml(xmlNuevo);
  if (problema) {
    anotarAviso(avisos, `${etiqueta}: no se pudo reescribir sin romper el documento `
      + `(${problema}), así que se deja como estaba. Revísalo antes de radicar y avisa: `
      + 'es un defecto del generador, no de tu plantilla.');
    return false;
  }
  zip.file(RUTA_DOC, xmlNuevo);
  return true;
}

/**
 * Llena el anexo de estados financieros del contribuyente y sus páginas de soporte.
 *
 * El anexo se localiza por su NOMBRE, con la letra que le dé la plantilla: en el informe de
 * referencia es el ANEXO A, pero eso es cosa de cada informe.
 *
 * @param {PizZip} zip
 * @param {object} estudio
 * @param {{imagenes?:Array<{dataUrl?:string, datos?:Uint8Array, ext?:string}>, avisos?:string[]}}
 *        [opciones]  `avisos` recoge por qué no se pudo rellenar, si es el caso.
 * @returns {{insertadas:number}} cuántas páginas de soporte entraron.
 */
export function insertarAnexoA(zip, estudio, opciones = {}) {
  const avisos = opciones.avisos;
  const xml = zip.file(RUTA_DOC).asText();
  const anexo = anexosDelDocumento(xml).eeff;
  if (!anexo) {
    anotarAviso(avisos, avisoAnexoNoHallado('eeff'));
    return { insertadas: 0 };
  }

  const entidad = (estudio && estudio.ent) || 'la Compañía';
  const rotulo = rotuloAnexo('eeff', anexo.letra, { entidad });

  /* El párrafo del encabezado de la plantilla se conserva —su estilo, su nivel de esquema y
     el marcador al que apunta el índice— y solo se le reescribe el texto. La letra es la que
     trae el documento: escribir «ANEXO A» en un informe que numera A, C, D no rompe nada
     visible, pero deja el cuerpo contradiciendo a su propio índice. Y el nombre del
     contribuyente es el del estudio, porque el informe de referencia trae el del cliente
     anterior pegado al título («ANEXO A. Estados financieros END GAME INTERACTIVE COLOMBIA
     SAS») y conservarlo sería radicar su nombre. */
  let nuevo = reescribirTextoParrafoOoxml(xml.slice(anexo.inicio, anexo.finEncabezado), rotulo);

  if (!traeCifrasEeff(estudio)) {
    /* Mismo aviso que el anexo de comparables usa para una sin estado financiero: el hueco
       tiene que verse. Lo que NO puede quedarse es el anexo del informe anterior. */
    nuevo += '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:color w:val="991B1B"/>'
      + '<w:b/></w:rPr><w:t>Pendiente: carga el PDF de estados financieros en el paso de '
      + 'ingesta de cifras para que este anexo se llene.</w:t></w:r></w:p>';
    escribirDocSiEsValido(
      zip, xml.slice(0, anexo.inicio) + nuevo + xml.slice(anexo.fin), avisos, rotulo);
    return { insertadas: 0 };
  }

  let rels = zip.file(RUTA_RELS).asText();
  let ct = zip.file(RUTA_CT).asText();
  let rId = siguienteRId(rels);
  let idDibujo = siguienteIdDibujo(xml);
  let insertadas = 0;

  (opciones.imagenes || []).filter(Boolean).forEach((img, i) => {
    const desde = img.dataUrl ? desdeDataUrl(img.dataUrl) : null;
    if (!desde && !img.datos) return;
    const ext = (desde && desde.ext) || img.ext || 'png';
    const nombre = `anexo_a_${i + 1}.${ext}`;

    const reg = registrarImagen({
      zip, rels, ct, rId: rId++, nombre, ext,
      base64: desde ? desde.base64 : null, datos: img.datos,
    });
    rels = reg.rels;
    ct = reg.ct;

    const anchoCm = img.anchoCm || ANCHO_UTIL_CM;
    const altoCm = img.altoCm || (anchoCm * 297) / 210;
    nuevo += parrafoConImagen({
      rId: reg.idRel, id: idDibujo++, nombre,
      cx: Math.round(anchoCm * EMU_POR_CM), cy: Math.round(altoCm * EMU_POR_CM),
    });
    insertadas++;
  });

  /* Las relaciones y los content-types se escriben aunque el cuerpo se descarte: son
     añadidos, y una relación que nadie usa es legal en OOXML, mientras que una imagen ya
     metida en `word/media/` cuya extensión no esté declarada en `[Content_Types].xml` hace
     que Word declare dañado el paquete entero. */
  zip.file(RUTA_RELS, rels);
  zip.file(RUTA_CT, ct);

  const candidato = asegurarNamespaceWp(
    xml.slice(0, anexo.inicio) + nuevo + xml.slice(anexo.fin));
  if (!escribirDocSiEsValido(zip, candidato, avisos, rotulo)) return { insertadas: 0 };
  return { insertadas };
}

/* Cabeceras del ANEXO C, tal como las trae la plantilla. Las del resumen son las MISMAS
   que las de la Tabla 16 —el anexo es el respaldo nominal de esa tabla— y las del listado
   son las que la plantilla escribe encima de cada grupo de compañías. */
const CAB_RESUMEN_ANEXO_C = ['FILTRO APLICADO INTERNACIONALES', 'FILTROS APLICADO', 'N° POR FILTRO'];
const CAB_LISTADO_ANEXO_C = ['Nº', 'NOMBRE DE LA COMPAÑÍA', 'FILTRO'];

/**
 * Reescribe el ANEXO C —matriz de rechazo— con el universo del estudio.
 *
 * La ruta .docx no lo llenaba: el anexo salía tal cual de la plantilla, así que un informe
 * de 2025 se radicaba con la matriz del año anterior —sus conteos, sus letras y sus
 * compañías—, contradiciendo a la Tabla 16 que sí se rellena unas páginas antes. La ruta
 * HTML sí lo hacía (`anexoCHtml.js`), de modo que el mismo estudio salía distinto según
 * por dónde se generara.
 *
 * Los grupos, sus letras y los conteos se le piden a `anexoCHtml.js`, que es de donde los
 * toma también la otra ruta: aquí solo se los pasa a OOXML.
 *
 * Sin matriz en el estudio NO se toca nada. Vaciar el anexo por falta de datos sería peor
 * que dejarlo: el documento perdería el respaldo sin que nadie lo note, mientras que la
 * matriz vieja al menos se ve. Se devuelve el aviso para que el generador lo publique.
 *
 * @param {PizZip} zip
 * @param {object} estudio
 * @returns {{reescrito:boolean, grupos:number, aviso:string|null}}
 */
export function insertarAnexoC(zip, estudio) {
  const study = estudio || {};
  const grupos = gruposDelAnexoC(study);
  if (!grupos.length) {
    return {
      reescrito: false,
      grupos: 0,
      /* Por el nombre y sin letra: aquí todavía no se ha localizado el anexo, así que no hay
         letra que citar, y la del informe de referencia no vale para todas las plantillas. */
      aviso: nombreDeAnexo('matriz') + ': el estudio no trae la matriz del universo evaluado, así que el '
        + 'anexo se deja como estaba. Abre el paso 3 del motor de comparables con el cribado de '
        + 'Capital IQ cargado para que se calcule.',
    };
  }

  const xml = zip.file(RUTA_DOC).asText();

  /* Por el nombre y no por la letra: en el informe de referencia la matriz es el ANEXO C,
     pero en el de MC Internacional el ANEXO C son las descripciones de comparables y la
     matriz es el D. Buscar la letra escribía la matriz encima del anexo equivocado. */
  const anexo = anexosDelDocumento(xml).matriz;
  if (!anexo) {
    return { reescrito: false, grupos: 0, aviso: avisoAnexoNoHallado('matriz') };
  }

  const universo = Number(study.matrizRechazo && study.matrizRechazo.universo) || 0;
  const rotulo = rotuloAnexo('matriz', anexo.letra);

  /* Se conserva el párrafo del encabezado y solo se le reescribe el texto, con la letra de la
     plantilla: así el rótulo sigue siendo el que anuncia el índice. */
  let nuevo = reescribirTextoParrafoOoxml(xml.slice(anexo.inicio, anexo.finEncabezado), rotulo);
  /* El anexo entero en mayúscula, encabezados incluidos (usuario, 2026-08-19). El título de
     cada grupo ya salía así de `tituloDeGrupoAnexoC`. */
  nuevo += '\n' + generarTablaOoxml('', CAB_RESUMEN_ANEXO_C.map(enMayusculas),
    filasEnMayusculas(filasResumenAnexoC(grupos, universo)));
  grupos.forEach((g) => {
    const filas = g.companias.map((nombre, i) => [String(i + 1), nombre, g.letra]);
    nuevo += '\n' + generarTablaOoxml(tituloDeGrupoAnexoC(g),
      CAB_LISTADO_ANEXO_C.map(enMayusculas), filasEnMayusculas(filas));
  });

  const avisos = [];
  const candidato = xml.slice(0, anexo.inicio) + nuevo + xml.slice(anexo.fin);
  if (!escribirDocSiEsValido(zip, candidato, avisos, rotulo)) {
    return { reescrito: false, grupos: 0, aviso: avisos[0] };
  }
  return { reescrito: true, grupos: grupos.length, aviso: null };
}

/* Con dos decimales, y no con `fmt`, que redondea a entero.

   Las cifras de estas fichas vienen escaladas —Capital IQ las publica en millones, así
   que «862,60» son 862,6 millones— y ahí el decimal es información: redondear a 863
   pierde 600.000 unidades de la moneda de la comparable. Además la ficha que el analista
   tiene delante al revisar el anexo los imprime, así que sin decimales las dos no se
   pueden cotejar de un vistazo.

   La convención es la del informe (`es-CO`: punto de miles, coma decimal), no la de la
   ficha, que sale en formato inglés porque la produce Capital IQ. */
const celdaCifraAnexoB = (v) => {
  const n = num(v);
  if (n === null || n === undefined) return '';
  return n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * Inserta de manera dinámica el Anexo B en el OOXML de la plantilla .docx.
 * Identifica la sección de Anexo B, genera la tabla de Nombre y Descripción de comparables
 * utilizando la función nativa generarTablaOoxml, e inyecta las tablas del Estado de
 * Resultados (P&L) y Balance General como tablas editables en lugar de imágenes.
 *
 * @param {PizZip} zip
 * @param {object} estudio
 * @param {string[]} [avisos]  recoge por qué no se pudo rellenar, si es el caso.
 * @returns {{insertadas:number}}
 */
export function insertarImagenesAnexoB(zip, estudio, avisos) {
  /* TODAS las comparables de la muestra, tengan o no estado financiero cargado. El filtro
     por `eeffArchivo` dejaba fuera del anexo a las que faltaban, y el anexo se radicaba con
     los bloques del contribuyente anterior en su lugar. Las que no traen cifras salen con
     su descripción y las tablas de cifras vacías para que el usuario pueda completarlas: un
     hueco señalado se completa, unas cifras del año pasado se radican sin que nadie lo note. */
  const comparables = ((estudio && estudio.comparables) || []).filter((c) => c && c.name);
  if (!comparables.length) return { insertadas: 0 };

  const xml = zip.file(RUTA_DOC).asText();

  /* El anexo de descripciones, localizado por su nombre. Antes se buscaba «ANEXO B» y se
     cortaba en «ANEXO C», las dos por regex sobre el XML crudo y tomando la última aparición
     para saltarse el índice. Eso dejaba dos agujeros: en una plantilla que numere sus anexos
     de otro modo —MC Internacional los lleva A, C, D, E, F y ahí las descripciones son el
     ANEXO C— no encontraba nada y el anexo se radicaba con las comparables del cliente
     anterior; y si el de descripciones era el ULTIMO, `finB` se iba a `xml.length` y la
     reescritura se llevaba `</w:body></w:document>`. */
  const anexo = anexosDelDocumento(xml).descripciones;
  if (!anexo) {
    anotarAviso(avisos, avisoAnexoNoHallado('descripciones'));
    return { insertadas: 0 };
  }
  const rotulo = rotuloAnexo('descripciones', anexo.letra);

  /* El encabezado de la plantilla, con su texto reescrito y su letra: la del informe de
     referencia trae el nombre correcto, pero en otra plantilla este anexo puede ser el C. */
  let nuevoXmlB = reescribirTextoParrafoOoxml(
    xml.slice(anexo.inicio, anexo.finEncabezado), rotulo);

  const year = Number(estudio && estudio.anio) || 2025;
  let totalInsertadas = 0;

  /* La cita al pie de las tablas de cifras es la base de datos de donde salieron —Capital IQ—,
     no la comparable. Decía «Información de <razón social>», que es la fórmula de las tablas
     de operaciones del contribuyente, donde la información sí la entrega la parte examinada;
     aquí atribuía a un tercero unas cifras que él nunca nos dio y dejaba sin citar la única
     fuente que hay. El nombre de la comparable ya va en su tabla de descripción, justo arriba.
     Misma forma que el resto de las tablas del motor: `estudio.database_source` con
     `BASE_DATOS_FUENTE` por defecto, así una sola base cambia en todas a la vez. */
  const citaBaseDatos = 'Información Base Datos '
    + ((estudio && estudio.database_source) || BASE_DATOS_FUENTE) + '.';

  const sinCifras = comparables.filter((c) => !c.eeffDatos);
  if (sinCifras.length && Array.isArray(avisos)) {
    avisos.push('ANEXO B: ' + sinCifras.length + ' de ' + comparables.length
      + ' comparable(s) sin estado financiero leído (' + sinCifras.map((c) => c.name).join(', ')
      + '). Salen en el anexo con las cifras en blanco: carga sus EEFF en el paso 4 del motor '
      + 'de comparables y vuelve a generar.');
  }

  comparables.forEach((c) => {
    const desc = c.descActividad || c.desc || 'Descripción de actividad no disponible.';
    const anioCol = (c.eeffDatos && c.eeffDatos.periodo) || year;

    // 1. Tabla de Nombre y Descripción
    const tablaNombreXml = generarTablaOoxml(
      'Descripción de la Compañía Comparable',
      ['NOMBRE DE LA COMPAÑÍA COMPARABLE', 'DESCRIPCIÓN ACTIVIDAD'],
      [[c.name, desc]]
    );
    nuevoXmlB += '\n' + tablaNombreXml;

    if (c.eeffDatos) {
      // 2. Tabla de Pérdidas y Ganancias (P&L)
      const filasPL = [
        ['Ventas netas', celdaCifraAnexoB(c.s)],
        ['Costo de los bienes vendidos', celdaCifraAnexoB(c.c)],
        ['Beneficio bruto', celdaCifraAnexoB(c.eeffDatos.utilidad_bruta)],
        ['Gastos operativos', celdaCifraAnexoB(c.eeffDatos.gastos_operacionales)],
        ['Utilidad de operación', celdaCifraAnexoB(c.op)],
      ];
      // Gastos de I+D y Publicidad son opcionales (solo si vienen cargados y no son nulos/vacíos)
      const rd = c.eeffDatos.gastos_investigacion_desarrollo;
      const adv = c.eeffDatos.gastos_publicidad;
      if (rd !== null && rd !== undefined && rd !== '') {
        filasPL.push(['Gastos de investigación y desarrollo', celdaCifraAnexoB(rd)]);
      }
      if (adv !== null && adv !== undefined && adv !== '') {
        filasPL.push(['Gastos de publicidad', celdaCifraAnexoB(adv)]);
      }

      const tablaPlXml = generarTablaOoxml(
        'Estado de Resultados',
        ['Descripción', String(anioCol)],
        filasPL,
        citaBaseDatos
      );
      nuevoXmlB += '\n' + tablaPlXml;

      // 3. Tabla de Balance
      /* En el orden en que la ficha imprime el balance —efectivo, cuentas por cobrar,
         inventarios, propiedad planta y equipo, total de activos, cuentas por pagar—, y
         no en el que estaban. Es el documento que el analista revisa al lado del anexo:
         con las filas cruzadas hay que buscar cada rubro en vez de leer las dos en
         paralelo. El estado de resultados de arriba ya seguía ese orden. */
      const filasBalance = [
        ['Efectivo promedio y equivalentes de efectivo', celdaCifraAnexoB(c.eeffDatos.efectivo_y_equivalentes)],
        ['Promedio de cuentas por cobrar netas', celdaCifraAnexoB(c.ar)],
        ['Inventario neto promedio', celdaCifraAnexoB(c.inv)],
        ['EPP neto promedio', celdaCifraAnexoB(c.eeffDatos.propiedad_planta_equipo)],
        ['Activos totales promedio', celdaCifraAnexoB(c.eeffDatos.total_activos)],
        ['Promedio de cuentas por pagar netas', celdaCifraAnexoB(c.ap)],
      ];

      const tablaBalanceXml = generarTablaOoxml(
        'Balance General',
        ['Descripción', String(anioCol)],
        filasBalance,
        citaBaseDatos
      );
      nuevoXmlB += '\n' + tablaBalanceXml;
    } else {
      // Párrafo de pendiente si no tiene estado financiero leído
      /* En rojo y con el nombre: es un hueco que hay que ver antes de radicar, no una nota
         al pie. Sustituye a lo que había antes en su lugar. */
      nuevoXmlB += `\n<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:color w:val="991B1B"/><w:b/></w:rPr>`
        + `<w:t>${escaparXml('[PENDIENTE] Falta el estado financiero de ' + c.name
          + '. Cárgalo en el paso 4 del motor de comparables y vuelve a generar el informe.')}</w:t></w:r></w:p>`;
    }

    totalInsertadas++;
  });

  const candidato = asegurarNamespaceWp(
    xml.slice(0, anexo.inicio) + nuevoXmlB + xml.slice(anexo.fin));
  if (!escribirDocSiEsValido(zip, candidato, avisos, rotulo)) return { insertadas: 0 };

  return { insertadas: totalInsertadas };
}

/**
 * El camino completo: plantilla marcada + estudio → .docx listo para descargar.
 *
 * @param {{binario:ArrayBuffer|Uint8Array|Buffer, estudio:object,
 *          colecciones?:object, imagenesAnexo?:Array, delimitadores?:object,
 *          tipoSalida?:'blob'|'nodebuffer'|'uint8array'}} args
 * @returns {{salida:*, camposVacios:string[], avisosTablas:string[], imagenesInsertadas:number}}
 */
export function rellenarDocx({
  binario, estudio, datosMacro, analisisSector, colecciones, imagenesAnexo, delimitadores, tipoSalida = 'blob',
}) {
  const { zip, camposVacios, avisosTablas } = renderizarDocx(binario, estudio, { datosMacro, analisisSector, colecciones, delimitadores });
  const { insertadas } = insertarImagenes(zip, imagenesAnexo, { avisos: avisosTablas });
  /* El anexo de estados financieros siempre se rearma —sus tablas salen de la ingesta—, pero
     las páginas del PDF solo van aquí si el centinela no se las llevó ya: con las dos vías
     activas el anexo saldría con el escaneo repetido. */
  const { insertadas: insertadasA } = insertarAnexoA(zip, estudio, {
    imagenes: insertadas > 0 ? [] : imagenesAnexo,
    avisos: avisosTablas,
  });
  const { insertadas: insertadasB } = insertarImagenesAnexoB(zip, estudio, avisosTablas);

  /* Después del anexo de descripciones: los anexos se delimitan unos con otros, así que
     reescribir la matriz antes le movería el corte. Su aviso viaja con los de las tablas
     —es el mismo canal que ya publica el generador— para que un anexo sin rehacer no pase
     inadvertido. */
  const anexoC = insertarAnexoC(zip, estudio);
  if (anexoC.aviso) avisosTablas.push(anexoC.aviso);

  return {
    salida: zip.generate({
      type: tipoSalida,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    camposVacios,
    avisosTablas,
    imagenesInsertadas: insertadas + insertadasA + insertadasB,
  };
}
