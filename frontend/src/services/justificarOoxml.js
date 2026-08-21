/* ─────────────────────────────────────────────────────────────────────────────
   Justificar el cuerpo del informe en la ruta de plantilla .docx.

   La ruta de HTML ya salía justificada por dos vías propias: el CSS del documento
   (`estiloDocumento.js`, `p,li{text-align:justify}`) y el conversor a OOXML real
   (`docxWriter.js`, que emite `AlignmentType.JUSTIFIED` por defecto). La ruta de
   plantilla .docx no tenía ninguna: los párrafos vienen del documento del cliente con
   la alineación que este traiga, y esa alineación varía de plantilla en plantilla.
   Medido sobre las dos plantillas reales del repositorio, fuera de tablas:

     · Informe Local END GAME 2024 — 928 párrafos con `both` explícito, 339 SIN `w:jc`, y
       un estilo `Normal` que tampoco lo declara: esos 339 salían alineados a la izquierda.
     · Informe local MC INTERNACIONAL 2024 — ningún `both` explícito, 1.361 sin `w:jc`
       (justificados por herencia, porque ahí `Normal` sí lo declara) y 30 con
       `w:jc="left"` explícito, que salían a la izquierda pese al estilo.

   Es decir: los dos casos existen y por causas distintas, y ninguna se arregla mirando
   solo el párrafo o solo el estilo. Por eso este módulo escribe `w:jc="both"` EXPLÍCITO
   en cada párrafo de cuerpo en lugar de intentar resolver la cadena de herencia de
   estilos: es idempotente —en un párrafo ya justificado no cambia nada— y no depende de
   cómo esté configurada la plantilla del cliente.

   ── Qué NO se justifica, y por qué ──

   · Los párrafos de las tablas. Van centrados por decisión del usuario (2026-08-19), y es
     lo que ya hacen las dos rutas.
   · Las entradas del índice. Llevan tabuladores de relleno y un campo PAGEREF con el
     número de página; justificarlas separa el título de sus puntos y descuadra la columna
     de páginas. Se detectan por el campo PAGEREF y por el nombre interno del estilo, que
     Word escribe siempre como «toc N» en cualquier idioma de instalación.
   · Los títulos, identificados por el `w:outlineLvl` de su estilo — el dato con el que
     Word los reconoce como tales, y por eso independiente de que la plantilla los llame
     `Ttulo1`, `Heading1` o `T1XMAY`.
   · Lo que ya declara `center` o `right`: la portada, los pies de tabla, las firmas y las
     imágenes. Una alineación explícita distinta de la izquierda es una decisión de quien
     hizo la plantilla, y no se pisa.

   ── Cuándo se aplica ──

   Sobre el XML de la plantilla, ANTES de que el generador inserte sus tablas, sus
   imágenes y sus pies de fuente. No es un detalle de orden: la justificación es una
   propiedad de la plantilla del cliente, mientras que los párrafos que el generador
   añade traen su propio formato deliberado —los pies «FUENTE:» van a la izquierda
   (`docxRelleno.js`), los títulos de tabla y las imágenes centrados—. Aplicándolo antes,
   ese formato manda sobre esta normalización en lugar de ser barrido por ella.
   ───────────────────────────────────────────────────────────────────────────── */

/* Los elementos de `w:pPr` que el esquema de OOXML (CT_PPr) coloca DESPUÉS de `w:jc`.
   El orden dentro de `w:pPr` es una secuencia, no un conjunto: un `w:jc` puesto detrás de
   un `w:outlineLvl` o de un `w:rPr` produce un documento que Word rechaza al abrir. Se
   inserta antes del primero de estos que aparezca, y al final si no hay ninguno. */
const POSTERIORES_A_JC = [
  'w:textDirection', 'w:textAlignment', 'w:textboxTightWrap', 'w:outlineLvl',
  'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange',
];

const JC_JUSTIFICADO = '<w:jc w:val="both"/>';

/**
 * Los identificadores de estilo cuyos párrafos no se justifican: los títulos y las
 * entradas del índice.
 *
 * Se derivan de `word/styles.xml` y no de una lista de nombres, porque los nombres son
 * del idioma y del gusto de quien hizo la plantilla. Un título es un estilo con
 * `w:outlineLvl`; una entrada de índice, un estilo cuyo nombre interno es «toc N».
 */
export function estilosNoJustificables(stylesXml) {
  const excluidos = new Set();
  const estilos = String(stylesXml || '').match(/<w:style[ >][\s\S]*?<\/w:style>/g) || [];
  estilos.forEach((estilo) => {
    const id = (/w:styleId="([^"]+)"/.exec(estilo) || [])[1];
    if (!id) return;
    const nombre = (/<w:name w:val="([^"]*)"/.exec(estilo) || [])[1] || '';
    if (/<w:outlineLvl\b/.test(estilo) || /^toc\s*\d+$/i.test(nombre.trim())) {
      excluidos.add(id);
    }
  });
  return excluidos;
}

/* Las regiones `<w:tbl>…</w:tbl>` del XML, como pares [inicio, fin), para saltarlas.
   Se recorre con un contador de anidamiento porque las tablas de este informe llevan
   tablas dentro (el ANEXO B anida una por comparable), y un `indexOf` del cierre se
   quedaría con el de la tabla interna y dejaría fuera media tabla externa. */
function regionesDeTabla(xml) {
  const regiones = [];
  const marcas = /<w:tbl[ >]|<\/w:tbl>/g;
  let profundidad = 0;
  let inicio = -1;
  let m;
  while ((m = marcas.exec(xml)) !== null) {
    if (m[0] === '</w:tbl>') {
      profundidad -= 1;
      if (profundidad === 0 && inicio >= 0) {
        regiones.push([inicio, m.index + m[0].length]);
        inicio = -1;
      }
    } else {
      if (profundidad === 0) inicio = m.index;
      profundidad += 1;
    }
  }
  return regiones;
}

/* ¿Este párrafo es una entrada del índice? El campo PAGEREF es la marca infalible: es lo
   que Word inserta en cada entrada para resolver el número de página, y no aparece en
   ninguna otra parte del cuerpo. */
const esEntradaDeIndice = (parrafo) => /PAGEREF/.test(parrafo);

/* El bloque `w:pPr` del párrafo, si lo trae, en sus dos formas: con contenido
   (`<w:pPr>…</w:pPr>`) y autocerrado (`<w:pPr/>`), que es como Word escribe un párrafo con
   propiedades vacías. La segunda hay que reconocerla explícitamente: tratarla como
   «no tiene pPr» hacía que se le añadiera un segundo, y dos `w:pPr` en un `w:p` son un
   documento inválido. */
function pPrDe(parrafo) {
  const abre = /<w:pPr[ />]/.exec(parrafo);
  if (!abre) return null;

  /* ¿Se cierra en la propia etiqueta de apertura? */
  const finApertura = parrafo.indexOf('>', abre.index);
  if (finApertura > 0 && parrafo[finApertura - 1] === '/') {
    return { inicio: abre.index, fin: finApertura + 1 };
  }

  const cierre = parrafo.indexOf('</w:pPr>', abre.index);
  if (cierre < 0) return null;
  return { inicio: abre.index, fin: cierre + '</w:pPr>'.length };
}

/* Inserta `w:jc` en un `w:pPr` existente, en la posición que el esquema exige. */
function conJcInsertado(pPr) {
  /* Autocerrado: se abre para poder meterle el hijo. */
  if (/^<w:pPr[^>]*\/>$/.test(pPr)) return `<w:pPr>${JC_JUSTIFICADO}</w:pPr>`;

  let corte = -1;
  POSTERIORES_A_JC.forEach((tag) => {
    const m = new RegExp(`<${tag}[ />]`).exec(pPr);
    if (m && (corte === -1 || m.index < corte)) corte = m.index;
  });
  if (corte === -1) corte = pPr.lastIndexOf('</w:pPr>');
  return pPr.slice(0, corte) + JC_JUSTIFICADO + pPr.slice(corte);
}

/** Un párrafo con el cuerpo justificado, o el mismo si no le corresponde. */
function justificarParrafo(parrafo, excluidos) {
  const estilo = (/<w:pStyle w:val="([^"]+)"/.exec(parrafo) || [])[1];
  if (estilo && excluidos.has(estilo)) return parrafo;
  if (esEntradaDeIndice(parrafo)) return parrafo;

  const jc = /<w:jc w:val="(\w+)"\s*\/>/.exec(parrafo);
  if (jc) {
    /* `left` y `start` son la misma cosa en dos versiones del formato, y las dos son lo
       que hay que corregir. `center`, `right`, `end` y las distributivas se respetan. */
    if (!/^(left|start)$/i.test(jc[1])) return parrafo;
    return parrafo.slice(0, jc.index) + JC_JUSTIFICADO + parrafo.slice(jc.index + jc[0].length);
  }

  const pPr = pPrDe(parrafo);
  if (!pPr) {
    /* Sin `w:pPr` se crea, y va como PRIMER hijo de `w:p`: el esquema no admite
       propiedades de párrafo después del contenido. */
    const finApertura = parrafo.indexOf('>') + 1;
    return parrafo.slice(0, finApertura)
      + `<w:pPr>${JC_JUSTIFICADO}</w:pPr>`
      + parrafo.slice(finApertura);
  }
  const bloque = parrafo.slice(pPr.inicio, pPr.fin);
  return parrafo.slice(0, pPr.inicio) + conJcInsertado(bloque) + parrafo.slice(pPr.fin);
}

/**
 * Justifica el cuerpo del documento: escribe `w:jc="both"` en cada párrafo de prosa que
 * esté fuera de las tablas, no sea título ni entrada de índice, y no declare ya una
 * alineación distinta de la izquierda.
 *
 * @param {string} documentXml `word/document.xml` de la plantilla.
 * @param {string} stylesXml `word/styles.xml`, para reconocer títulos e índice.
 * @returns {{xml: string, justificados: number}} el XML y cuántos párrafos cambiaron, que
 *   es lo que permite al generador decir en su aviso si la pasada hizo algo o no.
 */
export function justificarCuerpoOoxml(documentXml, stylesXml) {
  const xml = String(documentXml || '');
  if (!xml) return { xml, justificados: 0 };

  const excluidos = estilosNoJustificables(stylesXml);
  const tablas = regionesDeTabla(xml);
  const enTabla = (i) => tablas.some(([a, b]) => i >= a && i < b);

  let salida = '';
  let cursor = 0;
  let justificados = 0;
  const parrafos = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let m;
  while ((m = parrafos.exec(xml)) !== null) {
    if (enTabla(m.index)) continue;
    const cambiado = justificarParrafo(m[0], excluidos);
    if (cambiado === m[0]) continue;
    salida += xml.slice(cursor, m.index) + cambiado;
    cursor = m.index + m[0].length;
    justificados += 1;
  }
  salida += xml.slice(cursor);
  return { xml: salida, justificados };
}
