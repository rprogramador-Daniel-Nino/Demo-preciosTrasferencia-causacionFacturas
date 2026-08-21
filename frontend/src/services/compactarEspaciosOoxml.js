/* ─────────────────────────────────────────────────────────────────────────────
   Los espacios en blanco del informe, en la ruta de plantilla .docx.

   ── El defecto, medido ──

   La plantilla del cliente no usa saltos de página: empuja cada capítulo a la hoja
   siguiente con RACHAS DE PÁRRAFOS VACÍOS. Sobre `Informe Local End Game _ 2024_v2.docx`,
   fuera de tablas: 612 de sus 1.302 párrafos están vacíos (47 %), en rachas de hasta 35
   seguidos. Y cada racha precede a un capítulo:

     35 vacíos → «INFORMACIÓN GENERAL …»       18 vacíos → «TENDENCIAS DE LA ECONOMÍA»
      5 vacíos → «INFORMACIÓN ESPECÍFICA»       7 vacíos → «ANEXO C. Matriz de Rechazo»

   Ese relleno está calibrado a la longitud del contenido ORIGINAL. El generador sustituye
   ese contenido por el del estudio nuevo —otra compañía, prosa de la IA de otra extensión,
   tablas con otro número de filas—, y entonces la cuenta ya no cuadra:

     · si el contenido nuevo es más CORTO, los vacíos sobran y desbordan a una hoja en blanco;
     · si es más LARGO, se suman al desborde y dejan un hueco enorme a mitad de página.

   Verificado que el generador NO añade vacíos: de 612 en la plantilla baja a 587 en el
   informe generado. El problema es que hereda un relleno que ya no aplica.

   ── La corrección ──

   Una racha de vacíos que precede a un capítulo se sustituye por UN salto de página. Dice lo
   mismo que quiso decir quien hizo la plantilla —«esto empieza en hoja nueva»— pero de una
   forma que no depende de cuánto midan las páginas anteriores. Las demás rachas se recortan:
   seis renglones en blanco entre dos tablas de un anexo son relleno, no diseño.

   Lo que NO se toca, porque quitarlo rompe el documento:
     · el párrafo que lleva `w:sectPr` — define tamaño de hoja, márgenes y encabezados;
     · el que lleva un marcador (`bookmarkStart`) — de ahí cuelgan las entradas del índice;
     · el que lleva una imagen, un campo o una nota al pie, que no está vacío aunque no
       tenga texto;
     · nada dentro de una tabla.
   ───────────────────────────────────────────────────────────────────────────── */

/* Desde cuántos vacíos seguidos se considera relleno y no separación deliberada. Dos
   renglones en blanco son aire; tres ya es alguien empujando contenido hacia abajo. */
const UMBRAL_RACHA = 3;

/* Desde cuántos vacíos seguidos la racha ES, por sí sola, un salto de página: nadie escribe
   ocho renglones en blanco para separar dos párrafos.

   Este umbral es el criterio PRINCIPAL, y no el estilo del título que sigue, porque el
   estilo no es fiable: en el informe de MONTACHEM 2025 los capítulos usan `T1XMAY` y
   `Prrafodelista`, y NINGUNO de los dos está declarado en `word/styles.xml` —solo están
   `Ttulo1..9`, que el documento no usa—, así que no hay `outlineLvl` del que deducir el
   nivel. La longitud de la racha, en cambio, es evidencia directa de la intención. */
const UMBRAL_SALTO = 8;

/* Cuántos se dejan cuando la racha NO precede a un capítulo: los de entre dos tablas de un
   anexo, donde hace falta separación pero no media hoja. */
const VACIOS_QUE_QUEDAN = 2;

const SALTO_DE_PAGINA = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/** Los identificadores de estilo que el documento declara como TÍTULO, con su nivel.
 *
 *  Se derivan de `word/styles.xml` y no de una lista de nombres: el estilo de capítulo de
 *  una plantilla se llama `Ttulo1`, de otra `Heading1` y de otra `T1XMAY`. Lo que las tres
 *  comparten es el `w:outlineLvl`, que es con lo que Word arma el índice. */
export function nivelesDeTitulo(stylesXml) {
  const niveles = new Map();
  const estilos = String(stylesXml || '').match(/<w:style[ >][\s\S]*?<\/w:style>/g) || [];
  estilos.forEach((estilo) => {
    const id = (/w:styleId="([^"]+)"/.exec(estilo) || [])[1];
    if (!id) return;
    const lvl = /<w:outlineLvl\s+w:val="(\d+)"/.exec(estilo);
    if (lvl) { niveles.set(id, Number(lvl[1])); return; }
    /* Sin `outlineLvl` declarado, el nombre canónico de Word todavía identifica el nivel:
       «heading 1», «Título 1». Es el mismo criterio de `esCapituloOoxml` en docxRelleno. */
    const nombre = ((/<w:name w:val="([^"]*)"/.exec(estilo) || [])[1] || '').trim();
    const m = /^(?:heading|t[íi]tulo|titulo)\s*(\d)$/i.exec(nombre);
    if (m) niveles.set(id, Number(m[1]) - 1);
  });
  return niveles;
}

/* Las regiones que NO son cuerpo del documento y por tanto quedan fuera del recorrido:
   las tablas y los cuadros de texto.

   Las tablas, porque la altura de una celda es diseño de la tabla y no relleno de página.
   Los cuadros de texto (`w:txbxContent`), porque son una caja flotante con su propia
   maquetación: sus párrafos vacíos no empujan nada en la hoja. Y sobre todo porque tratarlos
   como cuerpo era peligroso — en la plantilla de END GAME hay dos párrafos vacíos antes de un
   cuadro y dos después, y unirlos en una sola racha se habría llevado por delante el
   `</w:txbxContent></wps:txbx>` de en medio, es decir el cuadro entero. */
function regionesExcluidas(xml) {
  return [...regionesDe(xml, /<w:tbl[ >]|<\/w:tbl>/g, '</w:tbl>'),
    ...regionesDe(xml, /<w:txbxContent[ >]|<\/w:txbxContent>/g, '</w:txbxContent>')];
}

/* Las regiones de un elemento que puede anidarse, contando profundidad: el ANEXO B mete una
   tabla por comparable dentro de otra, y buscar el primer cierre dejaría fuera media tabla. */
function regionesDe(xml, marcas, cierre) {
  const regiones = [];
  let profundidad = 0;
  let inicio = -1;
  let m;
  marcas.lastIndex = 0;
  while ((m = marcas.exec(xml)) !== null) {
    if (m[0] === cierre) {
      profundidad -= 1;
      if (profundidad === 0 && inicio >= 0) { regiones.push([inicio, m.index + m[0].length]); inicio = -1; }
    } else {
      if (profundidad === 0) inicio = m.index;
      profundidad += 1;
    }
  }
  return regiones;
}

const textoDe = (parrafo) => (parrafo.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
  .map((t) => t.replace(/<[^>]+>/g, '')).join('').trim();

/** ¿Este párrafo está vacío Y se puede quitar sin romper nada?
 *
 *  «Vacío» no es «sin texto»: un párrafo que sostiene la configuración de la sección, un
 *  marcador del índice, una imagen o un campo lleva información aunque no imprima letras. */
export function esVacioDescartable(parrafo) {
  if (textoDe(parrafo)) return false;
  return !/<w:sectPr|<w:bookmarkStart|<w:drawing|<w:pict|<w:object|w:instrText|<w:fldChar|<w:footnoteReference|<w:commentRangeStart|<w:br\s+w:type="page"/.test(parrafo);
}

/** ¿Abre este párrafo un capítulo o un apartado, es decir, algo que empieza en hoja nueva?
 *
 *  `hasta` acota qué niveles cuentan: 0 son solo los capítulos, 1 incluye sus apartados. */
export function esTitulo(parrafo, niveles, hasta = 0) {
  const estilo = (/<w:pStyle w:val="([^"]+)"/.exec(parrafo) || [])[1];
  if (estilo && niveles.has(estilo) && niveles.get(estilo) <= hasta) return true;
  /* El `outlineLvl` puesto en el propio párrafo, que gana sobre el del estilo. */
  const propio = /<w:outlineLvl\s+w:val="(\d+)"/.exec(parrafo);
  return !!propio && Number(propio[1]) <= hasta;
}

/* Lo que puede haber entre dos párrafos sin que deje de ser una racha contigua: marcas que
   no imprimen nada y que el propio Word deja sueltas entre párrafos. Cualquier otra cosa
   —una TABLA, sobre todo— parte la racha.

   Esta comprobación no es un detalle: los párrafos de dentro de las tablas se excluyen del
   recorrido, así que sin ella un vacío de antes de una tabla y otro de después quedaban
   «consecutivos», y el tramo que los sustituye SE TRAGABA la tabla de en medio. Medido sobre
   el informe de MONTACHEM 2025: desaparecía la tabla de la fórmula del Índice de Berry
   —«Razón Berry = (Ub/Go vs. V)* 100»— sin que nada lo advirtiera. */
/* Solo espacios y la marca de corrección ortográfica, que es inerte. Los marcadores de
   índice (`bookmarkStart`/`bookmarkEnd`) quedan FUERA a propósito: caen dentro del tramo que
   se sustituye, así que tratarlos como inocuos los borraría y con ellos el destino de una
   entrada del índice. Ante un marcador, la racha se parte y ahí no se toca nada. */
const RX_RELLENO_INOCUO = /^(?:\s|<w:proofErr[^>]*\/>)*$/;

const contiguos = (xml, a, b) => RX_RELLENO_INOCUO.test(xml.slice(a.fin, b.ini));

/* ¿Este párrafo ya empieza hoja nueva por su cuenta? Un `w:br` de tipo página, o un
   `pageBreakBefore` en sus propiedades — las dos formas que usa Word.

   Importa porque es el caso que produce la hoja COMPLETAMENTE en blanco, y no un hueco: en
   el informe de MONTACHEM 2025, tras «En consecuencia, los resultados obtenidos…» vienen
   NUEVE párrafos vacíos y DESPUÉS un salto de página, antes del capítulo «INFORMACIÓN
   GENERAL». Los nueve vacíos llenan lo que queda de la hoja y el salto fuerza otra: la hoja
   intermedia sale entera en blanco. Con el salto ya presente, esos vacíos no sobran a
   medias — sobran del todo. */
const fuerzaHojaNueva = (parrafo) => /<w:br[^>]*w:type="page"|<w:pageBreakBefore(?![^>]*w:val="(?:0|false)")/.test(parrafo);

/**
 * Compacta los espacios en blanco del cuerpo: las rachas de párrafos vacíos que empujan un
 * capítulo a la hoja siguiente pasan a ser un salto de página, y las demás se recortan.
 *
 * @param {string} documentXml `word/document.xml` del informe ya relleno.
 * @param {string} stylesXml `word/styles.xml`, para reconocer los títulos.
 * @param {{umbral?: number, dejar?: number, nivelTitulo?: number}} [opciones]
 * @returns {{xml: string, saltos: number, vaciosQuitados: number}} el XML y cuánto se movió,
 *   que es lo que permite al generador decir en su aviso si la pasada hizo algo.
 */
export function compactarEspaciosOoxml(documentXml, stylesXml, opciones = {}) {
  const xml = String(documentXml || '');
  if (!xml) return { xml, saltos: 0, vaciosQuitados: 0 };

  const umbral = opciones.umbral ?? UMBRAL_RACHA;
  const dejar = opciones.dejar ?? VACIOS_QUE_QUEDAN;
  const nivelTitulo = opciones.nivelTitulo ?? 0;
  const niveles = nivelesDeTitulo(stylesXml);
  const excluidas = regionesExcluidas(xml);
  const fueraDelCuerpo = (i) => excluidas.some(([a, b]) => i >= a && i < b);

  /* Los párrafos del cuerpo, con su posición, para poder reconstruir el XML sin tocar el
     resto: entre dos párrafos puede haber marcadores, comentarios o el propio `sectPr`. */
  const parrafos = [];
  const rx = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = rx.exec(xml)) !== null) {
    if (fueraDelCuerpo(m.index)) continue;
    parrafos.push({ ini: m.index, fin: m.index + m[0].length, txt: m[0] });
  }

  /* Los tramos a sustituir, calculados sobre las rachas y aplicados de una vez al final:
     modificar el XML mientras se recorre invalidaría las posiciones. */
  const tramos = [];
  let saltos = 0;
  let vaciosQuitados = 0;

  let i = 0;
  while (i < parrafos.length) {
    if (!esVacioDescartable(parrafos[i].txt)) { i += 1; continue; }
    let j = i + 1;
    while (j < parrafos.length
      && esVacioDescartable(parrafos[j].txt)
      && contiguos(xml, parrafos[j - 1], parrafos[j])) j += 1;
    const n = j - i;

    if (n >= umbral) {
      const siguiente = parrafos[j];
      /* Un salto de página solo si hay contenido DETRÁS al que llevar. Al final del cuerpo
         —o antes de un párrafo que no imprime nada— un salto añadiría la hoja en blanco que
         esto viene a quitar. */
      const hayContenidoDetras = !!siguiente
        && contiguos(xml, parrafos[j - 1], siguiente)
        && !esVacioDescartable(siguiente.txt);
      const abreCapitulo = hayContenidoDetras
        && (n >= (opciones.umbralSalto ?? UMBRAL_SALTO)
          || esTitulo(siguiente.txt, niveles, nivelTitulo));
      /* La racha se sustituye desde el primer vacío hasta el último, sin tocar lo que haya
         entre ellos —un `bookmarkEnd` suelto, por ejemplo— porque los párrafos vacíos son
         contiguos en el XML salvo por esas marcas, que se conservan al recortar por
         posiciones de párrafo y no por rango completo. */
      /* Si lo que sigue ya fuerza hoja nueva, la racha entera es desperdicio: se quita sin
         dejar ninguno y sin añadir un salto, que ya está puesto. */
      if (siguiente && contiguos(xml, parrafos[j - 1], siguiente) && fuerzaHojaNueva(siguiente.txt)) {
        tramos.push({ ini: parrafos[i].ini, fin: parrafos[j - 1].fin, con: '' });
        vaciosQuitados += n;
      } else if (abreCapitulo) {
        tramos.push({ ini: parrafos[i].ini, fin: parrafos[j - 1].fin, con: SALTO_DE_PAGINA });
        saltos += 1;
        vaciosQuitados += n;
      } else if (n > dejar) {
        const conserva = parrafos.slice(i, i + dejar).map((p) => p.txt).join('');
        tramos.push({ ini: parrafos[i].ini, fin: parrafos[j - 1].fin, con: conserva });
        vaciosQuitados += n - dejar;
      }
    }
    i = j;
  }

  if (!tramos.length) return { xml, saltos: 0, vaciosQuitados: 0 };

  let salida = '';
  let cursor = 0;
  tramos.forEach((t) => {
    salida += xml.slice(cursor, t.ini) + t.con;
    cursor = t.fin;
  });
  salida += xml.slice(cursor);

  return { xml: salida, saltos, vaciosQuitados };
}
