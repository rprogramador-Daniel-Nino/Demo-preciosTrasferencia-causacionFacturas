/* ─────────────────────────────────────────────────────────────────────────────
   notasAlPieOoxml.js — publicar una cita como nota al pie de verdad en el .docx.

   POR QUÉ. Las fuentes de la Sección III se citaban en un párrafo «FUENTE:» al final del
   apartado, con las URL crudas entre paréntesis: media página de direcciones ilegibles en el
   cuerpo del documento. El resto del informe cita al pie, en formato bibliográfico y con el
   enlace en azul, porque eso lo escribe el consultor a mano. Ahora lo escribe el sistema.

   CÓMO FUNCIONA UNA NOTA AL PIE EN OOXML. Son dos sitios y una relación:

     · en `word/document.xml`, donde va el número: un run con `<w:footnoteReference w:id="N"/>`;
     · en `word/footnotes.xml`, el texto: un `<w:footnote w:id="N">` con su párrafo, que abre
       con `<w:footnoteRef/>` —el número, que Word renumera solo— y sigue con el contenido;
     · si el enlace ha de ser clicable, una relación EXTERNA en `word/_rels/footnotes.xml.rels`
       apuntada desde `<w:hyperlink r:id="…">`. Ese archivo no existe en las plantillas que solo
       traen notas de texto, así que hay que crearlo.

   LOS ESTILOS SON LOS DE LA PLANTILLA. En la de END GAME están en español —`Textonotapie`,
   `Refdenotaalpie`, `Hipervnculo`—, que es lo que escribe Word en un documento en español.
   Se usan si existen y, si no, se emite el mismo aspecto con formato directo: una nota que
   depende de un estilo ausente sale con la letra del cuerpo y se lee como un párrafo perdido al
   final de la página.

   LOS IDS NO SE REINVENTAN. Se continúa desde el mayor que ya haya en el archivo, contando los
   separadores —que van con id -1 y 0 y con `w:type` DELANTE del `w:id`, de ahí que el patrón
   tenga que tolerar atributos por medio—. Repetir un id que ya está usado hace que Word declare
   el documento dañado y ofrezca repararlo, que es la peor forma de enterarse.
   ───────────────────────────────────────────────────────────────────────────── */

const escapar = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Mete contenido dentro del elemento raíz de una parte del paquete.
 *
 * Hay que contar con la RAÍZ AUTO-CERRADA: un archivo de relaciones sin ninguna relación se
 * escribe `<Relationships …/>`, sin etiqueta de cierre —así lo genera la librería que arma los
 * .docx de prueba, y así viene en paquetes reales—. Buscando solo `</Relationships>` no había
 * dónde insertar y la relación se perdía en silencio: el enlace de la cita quedaba sin apuntar a
 * nada. Lo cazó la prueba de integración del paquete.
 *
 * @param {string} xml
 * @param {string} raiz  nombre del elemento raíz («Relationships», «Types»).
 * @param {string} contenido
 * @returns {string} el XML con el contenido dentro, o tal cual si no se reconoce la raíz.
 */
function insertarEnRaiz(xml, raiz, contenido) {
  const actual = String(xml || '');
  if (!contenido) return actual;

  const cierre = actual.lastIndexOf(`</${raiz}>`);
  if (cierre !== -1) return actual.slice(0, cierre) + contenido + actual.slice(cierre);

  /* Raíz auto-cerrada: se abre para poder meter dentro lo nuevo. */
  const rx = new RegExp(`<${raiz}(\\s[^>]*?)?/>`);
  const m = rx.exec(actual);
  if (!m) return actual;
  return actual.slice(0, m.index)
    + `<${raiz}${m[1] || ''}>${contenido}</${raiz}>`
    + actual.slice(m.index + m[0].length);
}

/* Tolera cualquier atributo antes del `w:id`: los separadores llevan `w:type` delante. */
const RX_ID_NOTA = /<w:footnote\b[^>]*\bw:id="(-?\d+)"/g;

const TIPO_HIPERVINCULO = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';

/**
 * Los ids de nota que ya están usados, separadores incluidos.
 *
 * @param {string} footnotesXml
 * @returns {number[]}
 */
export function idsDeNotas(footnotesXml) {
  const ids = [];
  RX_ID_NOTA.lastIndex = 0;
  let m;
  while ((m = RX_ID_NOTA.exec(String(footnotesXml || ''))) !== null) ids.push(Number(m[1]));
  return ids;
}

/**
 * El primer id libre. Los separadores ocupan -1 y 0, así que el primero de contenido es el 1.
 *
 * @param {string} footnotesXml
 * @returns {number}
 */
export function siguienteIdDeNota(footnotesXml) {
  const ids = idsDeNotas(footnotesXml);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

/* El tamaño de letra de las notas, en medios puntos: 16 = 8 pt, que es el de las notas de la
   plantilla y el que ya usa este generador para las citas al pie de tabla. */
const MEDIO_PUNTO_NOTA = 16;

const rPr = (extra, estilo) => '<w:rPr>'
  + (estilo ? `<w:rStyle w:val="${estilo}"/>` : '')
  + (extra || '')
  + `<w:sz w:val="${MEDIO_PUNTO_NOTA}"/><w:szCs w:val="${MEDIO_PUNTO_NOTA}"/>`
  + '</w:rPr>';

/**
 * Si esa URL se puede enlazar dentro de esa cita.
 *
 * Solo cuando la cierra: la URL se corta por el final y no se busca dentro, porque puede
 * aparecer citada en el título del artículo y partir la cita por el medio la dejaría ilegible.
 *
 * La regla vive aquí y no repetida en cada sitio para que el recolector no reserve una relación
 * que la nota no va a usar: eso dejaba un `Relationship` huérfano en el .rels por cada cita cuya
 * URL no estuviera al final.
 *
 * @param {string} cita
 * @param {string} url
 * @returns {boolean}
 */
export function urlEnlazable(cita, url) {
  const texto = String(cita == null ? '' : cita);
  const u = String(url == null ? '' : url).trim();
  return Boolean(u) && texto.endsWith(u);
}

/**
 * El XML de una nota al pie.
 *
 * @param {object} nota
 * @param {number} nota.id
 * @param {string} nota.cita  la referencia ya redactada (ver `citasApa.js`).
 * @param {string} [nota.url]  si la cita termina en esta URL, se publica como enlace.
 * @param {string} [nota.idRel]  el `r:id` de la relación externa de ese enlace. Sin él la URL
 *        se escribe con el aspecto del enlace pero sin serlo: es lo que se puede hacer cuando el
 *        paquete no admite relaciones nuevas, y sigue siendo legible y copiable.
 * @param {{textoNota?:string, refNota?:string, hipervinculo?:string}} [estilos]  ids de estilo
 *        de la plantilla; se omite el que no exista en ella.
 * @returns {string}
 */
export function notaAlPieOoxml(nota, estilos = {}) {
  const { id, cita, url, idRel } = nota || {};
  const texto = String(cita == null ? '' : cita);
  if (!texto.trim()) return '';

  const estiloParrafo = estilos.textoNota ? `<w:pStyle w:val="${estilos.textoNota}"/>` : '';
  const partes = [];

  partes.push(`<w:p><w:pPr>${estiloParrafo}<w:jc w:val="both"/></w:pPr>`);
  /* El número. `<w:footnoteRef/>` lo renumera Word, así que aquí no va ninguna cifra. */
  partes.push(`<w:r>${rPr('', estilos.refNota)}<w:footnoteRef/></w:r>`);
  partes.push(`<w:r>${rPr()}<w:t xml:space="preserve"> </w:t></w:r>`);

  const urlLimpia = String(url == null ? '' : url).trim();
  const conUrlAlFinal = urlEnlazable(texto, urlLimpia);
  const cuerpo = conUrlAlFinal ? texto.slice(0, texto.length - urlLimpia.length) : texto;

  if (cuerpo) {
    partes.push(`<w:r>${rPr()}<w:t xml:space="preserve">${escapar(cuerpo)}</w:t></w:r>`);
  }

  if (conUrlAlFinal) {
    /* Azul y subrayado por formato directo además del estilo: si la plantilla no trae
       `Hipervnculo`, el enlace tiene que seguir viéndose como un enlace. */
    const aspecto = '<w:color w:val="0563C1"/><w:u w:val="single"/>';
    const run = `<w:r>${rPr(aspecto, estilos.hipervinculo)}`
      + `<w:t xml:space="preserve">${escapar(urlLimpia)}</w:t></w:r>`;
    partes.push(idRel
      ? `<w:hyperlink r:id="${escapar(idRel)}" w:history="1">${run}</w:hyperlink>`
      : run);
  }

  partes.push('</w:p>');
  return `<w:footnote w:id="${Number(id)}">${partes.join('')}</w:footnote>`;
}

/** El run que ancla la nota en el cuerpo del documento, donde va el número. */
export function referenciaDeNotaOoxml(id, estilos = {}) {
  const estilo = estilos.refNota ? `<w:rStyle w:val="${estilos.refNota}"/>` : '';
  return `<w:r><w:rPr>${estilo}<w:vertAlign w:val="superscript"/></w:rPr>`
    + `<w:footnoteReference w:id="${Number(id)}"/></w:r>`;
}

/* Un `footnotes.xml` recién creado necesita los dos separadores: son la línea que Word dibuja
   sobre las notas y la de continuación cuando una nota parte de página. Sin ellos el documento
   abre, pero cualquier nota sale pegada al cuerpo sin separación. */
const CABECERA_FOOTNOTES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:footnotes xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  + ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">';

const SEPARADORES = '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr>'
  + '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
  + '<w:r><w:separator/></w:r></w:p></w:footnote>'
  + '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr>'
  + '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
  + '<w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';

/**
 * Mete las notas nuevas en `word/footnotes.xml`, creándolo si la plantilla no lo traía.
 *
 * @param {string} footnotesXml  el archivo actual, o vacío/ausente.
 * @param {string[]} notasXml  cada nota ya serializada por `notaAlPieOoxml`.
 * @returns {string} el archivo con las notas añadidas al final.
 */
export function agregarNotasAlPie(footnotesXml, notasXml) {
  const nuevas = (notasXml || []).filter((n) => n && n.trim()).join('');
  const actual = String(footnotesXml || '').trim();
  if (!nuevas) return actual;

  if (!actual) return CABECERA_FOOTNOTES + SEPARADORES + nuevas + '</w:footnotes>';

  const cierre = actual.lastIndexOf('</w:footnotes>');
  if (cierre === -1) return actual;
  return actual.slice(0, cierre) + nuevas + actual.slice(cierre);
}

/**
 * Las relaciones externas de los enlaces de las notas, en `word/_rels/footnotes.xml.rels`.
 *
 * @param {string} relsXml  el archivo actual, o vacío si no existe —lo normal en una plantilla
 *        cuyas notas son solo texto—.
 * @param {Array<{idRel:string, url:string}>} enlaces
 * @returns {string}
 */
export function relsDeNotasAlPie(relsXml, enlaces) {
  const entradas = (enlaces || []).filter((e) => e && e.idRel && e.url);
  const actual = String(relsXml || '').trim();
  if (!entradas.length) return actual;

  const nuevas = entradas.map((e) =>
    `<Relationship Id="${escapar(e.idRel)}" Type="${TIPO_HIPERVINCULO}"`
    + ` Target="${escapar(e.url)}" TargetMode="External"/>`).join('');

  if (!actual) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + nuevas + '</Relationships>';
  }

  return insertarEnRaiz(actual, 'Relationships', nuevas);
}

/**
 * Un `r:id` que no choque con los que ya usa ese archivo de relaciones.
 *
 * @param {string} relsXml
 * @param {number} cuantos
 * @returns {string[]}
 */
export function idsDeRelacionLibres(relsXml, cuantos) {
  const usados = new Set();
  const rx = /Id="([^"]+)"/g;
  let m;
  while ((m = rx.exec(String(relsXml || ''))) !== null) usados.add(m[1]);

  const ids = [];
  let n = 1;
  while (ids.length < Math.max(0, cuantos | 0)) {
    const id = `rIdNota${n}`;
    if (!usados.has(id)) ids.push(id);
    n += 1;
  }
  return ids;
}

/* La parte de notas al pie tiene que estar declarada en `[Content_Types].xml`, o Word no la lee
   —y si además hay referencias en el cuerpo, declara el documento dañado—. */
const CT_FOOTNOTES = '<Override PartName="/word/footnotes.xml"'
  + ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>';

/** Declara `word/footnotes.xml` en `[Content_Types].xml` si no estaba. */
export function contentTypesConNotasAlPie(ctXml) {
  const actual = String(ctXml || '');
  if (!actual || actual.includes('/word/footnotes.xml')) return actual;
  return insertarEnRaiz(actual, 'Types', CT_FOOTNOTES);
}

const TIPO_FOOTNOTES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';

/** Relaciona `word/footnotes.xml` desde `word/_rels/document.xml.rels` si no estaba. */
export function relsDocumentoConNotasAlPie(relsXml, idRel) {
  const actual = String(relsXml || '');
  if (!actual || actual.includes(TIPO_FOOTNOTES)) return actual;
  return insertarEnRaiz(actual, 'Relationships',
    `<Relationship Id="${escapar(idRel)}" Type="${TIPO_FOOTNOTES}" Target="footnotes.xml"/>`);
}

/**
 * Ancla un run —la referencia de la nota— al final del último párrafo de un fragmento.
 *
 * El número de la nota va DONDE SE AFIRMA EL DATO, es decir al final de la frase, no en un
 * párrafo aparte: un párrafo que solo contenga números de nota deja el cuerpo del informe con
 * cifras huérfanas y sin frase que las sostenga.
 *
 * @param {string} parrafosXml  uno o varios `<w:p>…</w:p>`.
 * @param {string} runXml  el run a insertar.
 * @returns {string} el fragmento con el run dentro del último párrafo; sin párrafos, devuelve el
 *          fragmento intacto —el llamador decide qué hacer con una nota que no tiene dónde ir—.
 */
export function anclarEnUltimoParrafo(parrafosXml, runXml) {
  const xml = String(parrafosXml || '');
  const run = String(runXml || '');
  if (!xml || !run) return xml;

  const cierre = xml.lastIndexOf('</w:p>');
  if (cierre === -1) return xml;
  return xml.slice(0, cierre) + run + xml.slice(cierre);
}

/**
 * Recolector de notas al pie de una corrida.
 *
 * Existe porque las funciones que redactan los apartados trabajan sobre el string de
 * `word/document.xml` y no ven el paquete: ellas piden el número de la nota y siguen, y quien
 * tiene el zip —`rellenarDocx`— escribe al final `footnotes.xml`, sus relaciones y el content
 * type. Sin este reparto, cada apartado tendría que conocer el .docx entero.
 *
 * @param {object} opciones
 * @param {number} opciones.idInicial  primer id libre (ver `siguienteIdDeNota`).
 * @param {number} [opciones.inicioRel]  primer sufijo libre para los `r:id` de los enlaces.
 * @param {object} [opciones.estilos]  los de la plantilla (ver `estilosDeNota`).
 * @returns {{referencia:Function, notasXml:Function, enlaces:Function, cuantas:Function}}
 */
export function crearRecolectorDeNotas({ idInicial = 1, inicioRel = 1, estilos = {} } = {}) {
  const notas = [];
  const enlaces = [];
  let idSiguiente = Number(idInicial) || 1;
  let relSiguiente = Number(inicioRel) || 1;

  return {
    /**
     * Registra una cita y devuelve el run que la ancla en el cuerpo.
     *
     * @param {string} cita  la referencia ya redactada; vacía si no había con qué citar.
     * @param {string} [url]
     * @returns {string} el run de la referencia, o cadena vacía si no hay cita: así el llamador
     *          no ancla un número que no lleva a ninguna nota.
     */
    referencia(cita, url) {
      const texto = String(cita || '').trim();
      if (!texto) return '';

      const id = idSiguiente;
      idSiguiente += 1;

      /* La relación se reserva solo si la nota va a usarla de verdad: misma regla que aplica
         `notaAlPieOoxml`, para no dejar un `Relationship` huérfano por cada cita cuya URL no
         cierre la frase. */
      let idRel = '';
      if (urlEnlazable(texto, url)) {
        idRel = `rIdNota${relSiguiente}`;
        relSiguiente += 1;
        enlaces.push({ idRel, url });
      }

      notas.push(notaAlPieOoxml({ id, cita: texto, url, idRel }, estilos));
      return referenciaDeNotaOoxml(id, estilos);
    },
    notasXml: () => notas.slice(),
    enlaces: () => enlaces.slice(),
    cuantas: () => notas.length,
  };
}

/**
 * Qué estilos de nota trae la plantilla, para usar los suyos y no imponer unos que no existan.
 *
 * @param {string} stylesXml  el `word/styles.xml`.
 * @returns {{textoNota:string, refNota:string, hipervinculo:string}} con cadena vacía en el que
 *          no esté definido.
 */
export function estilosDeNota(stylesXml) {
  const xml = String(stylesXml || '');
  const cual = (candidatos) => candidatos.find((id) => xml.includes(`w:styleId="${id}"`)) || '';
  return {
    /* Word en español los nombra así; los de un documento en inglés, con el nombre inglés. */
    textoNota: cual(['Textonotapie', 'FootnoteText']),
    refNota: cual(['Refdenotaalpie', 'FootnoteReference']),
    hipervinculo: cual(['Hipervnculo', 'Hyperlink']),
  };
}
