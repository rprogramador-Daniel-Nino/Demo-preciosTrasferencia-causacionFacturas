/* HTML final + recursos → .docx real (OOXML).

   No conoce el PDF ni precios de transferencia: recibe HTML y devuelve un zip. Esa frontera es
   lo que lo hace probable con `node --test` sin navegador, y es la lección de los cuatro
   fallos de formato que sólo se veían abriendo Word —834 páginas, una hoja por párrafo, los
   dos logos encimados, el resaltado colándose—: todos vivían en el único trozo sin tests.

   Las medidas y el estilo NO se deciden aquí. Salen de `estiloDocumento.js`, que es la misma
   fuente que pinta la vista previa. Es lo que da la paridad que se pidió. */
import {
  Document, Packer, Paragraph, TextRun, Header, Footer, PageNumber, AlignmentType, HeadingLevel,
  PositionalTab, PositionalTabAlignment, PositionalTabLeader,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  ImageRun, LevelFormat, PageBreak, PageOrientation,
  Bookmark, InternalHyperlink,
  Math as DocxMath, MathFraction, MathSubScript, MathRoundBrackets, MathRun,
  FootnoteReferenceRun,
} from 'docx';
import {
  HOJA_TWIPS, cmAPixeles, medidaEnCm, FACTOR_TABLA,
} from './estiloDocumento.js';
import { estiloBaseDe } from './pdfReferenceExtractor.js';
import { htmlAArbol, textoDe } from './htmlAArbol.js';

/* `docx` mide las fuentes en medios puntos: Arial 12 son 24. */
const mediosPuntos = (pt) => Math.round((Number(pt) || 12) * 2);

const PAGINA = {
  size: { width: HOJA_TWIPS.ancho, height: HOJA_TWIPS.alto },
  margin: {
    top: HOJA_TWIPS.margen, right: HOJA_TWIPS.margen,
    bottom: HOJA_TWIPS.pie, left: HOJA_TWIPS.margen,
    header: HOJA_TWIPS.borde, footer: HOJA_TWIPS.borde,
  },
};

/* El pie es la numeración, y va con el campo PAGE de Word. El número literal que traía el PDF
   mentiría en cuanto Word repagine. */
const pieConNumero = () => new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '666666' })],
  })],
});

/* El logo que el extractor apartó como encabezado, con su lado y su primera página. Los tres
   datos los midió el extractor sobre el PDF (versión 7): el del informe de referencia va a la
   derecha y empieza en la página 5. Una plantilla anterior no los trae y se cae a centrado y a
   imprimirlo también en la portada, que es lo que se hacía antes. */
function encabezadoDe(html) {
  const m = /<div data-encabezado="1"([^>]*)>([\s\S]*?)<\/div>/.exec(html);
  if (!m) return null;
  const lado = (/data-lado="([^"]+)"/.exec(m[1]) || [])[1] || 'centro';
  const desde = Number((/data-desde-pagina="(\d+)"/.exec(m[1]) || [])[1] || 1);
  return { bloque: m[0], contenido: m[2], lado, enLaPortada: desde <= 1 };
}

const ALINEACION = {
  derecha: AlignmentType.RIGHT,
  izquierda: AlignmentType.LEFT,
  centro: AlignmentType.CENTER,
};

const NIVELES = {
  h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3, h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6,
};

/* Etiquetas que en Word son un bloque propio y no pueden compartir párrafo con el texto que
   las rodea. `span`, `strong`, `em` y `br` NO están aquí a propósito: son en línea y se funden
   en el párrafo, que es lo que conserva la negrita y la familia del informe. */
const BLOQUES = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'blockquote', 'section', 'article']);
const esBloque = (n) => !!n && n.etiqueta !== undefined && BLOQUES.has(n.etiqueta);

/* La familia que declara un `<span style="font-family:'X'">`. El extractor sólo la declara
   cuando se desvía del cuerpo del documento. */
/* Tamaño de fuente que declara un fragmento, en medios puntos, o null si no se desvía del
   cuerpo del documento.

   Sin esto el documento salía con 61 hojas de más sobre las 112 del original, y **todas** en
   páginas con tabla: las que llevan tabla ocupaban 1,48 veces la caja de texto y las que no,
   0,32. La causa es que las tablas del informe van a 8 y 9 puntos —el extractor lo anota, se
   midió: 228 fragmentos a 9 pt, 99 a 8 pt, 42 a 10 pt— y el writer sólo leía la familia, así
   que las emitía todas al cuerpo de 12 pt. Un 33 % más de alto por línea, sobre 890 filas.

   El interlineado sí era correcto (276 twips, y la mediana medida en el PDF es 13,80 pt = 276);
   el tamaño era lo que faltaba. */
const tamanoDeEstilo = (estilo) => {
  const m = /font-size:\s*([\d.]+)pt/.exec(estilo || '');
  return m ? Math.round(Number(m[1]) * 2) : null;
};

const familiaDeEstilo = (estilo) => {
  const m = /font-family:\s*["']?([^;"']+)["']?/.exec(estilo || '');
  return m ? m[1].trim() : null;
};

/* Una entrada del índice: título, un espacio, uno o más puntos, y el número de página al final
   de la línea.

   Basta UN punto, y esto es una decisión medida, no un descuido. Con cuatro —que es lo que se
   pidió primero— la entrada «1.5 Razones de rechazo (Filtros Cuantitativos – Filtros
   Cualitativos) . 33» del informe de referencia se quedaba sin detectar y salía sin alinear,
   con el punto y el número pegados al texto.

   Lo que impide el falso positivo no es la cantidad de puntos, es exigir espacio antes del
   punto y sólo cifras hasta el final de la línea. Comprobado contra los casos reales del
   informe: «El margen fue de 3.5 puntos porcentuales en 2024» no encaja porque no hay punto
   justo antes del número; «Ver anexo A ....... y también el B» tampoco, porque no acaba en
   cifra; y unos puntos suspensivos sin número al final tampoco. Queda un caso ambiguo de
   verdad —una frase que acabe en punto seguido de una cifra, «según la norma. 2024»— que es
   raro y se ve al revisar. */
const RX_ENTRADA_INDICE = /^(.*?\S)\s+\.+\s*(\d+)\s*$/;

/* Normaliza el texto de una entrada de índice o cabecera para poder compararlos de forma
   robusta. Remueve tildes, convierte a minúsculas, quita numeración inicial (como 1., 1.1) y
   cualquier carácter especial que no sea letra o número. */
function normalizarTextoParaComparar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quita tildes
    .replace(/^\s*(?:\d+\.)+\s*/g, '') // Quita numeraciones tipo 1.1, 1.2
    .replace(/^\s*\d+\s*/g, '') // Quita numeración tipo 1
    .replace(/[^a-z0-9]/g, ''); // Deja solo letras y números
}

/* Escanea de forma recursiva todo el árbol de HTML buscando los elementos que corresponden a
   cabeceras (h1-h6) y les asigna un identificador de marcador (bookmark) único. */
function escanearCabeceras(arbol) {
  const cabeceras = [];
  let contador = 1;
  const buscar = (n) => {
    if (n.texto !== undefined) return;
    if (NIVELES[n.etiqueta]) {
      const texto = textoDe(n).trim();
      if (texto) {
        const normalized = normalizarTextoParaComparar(texto);
        // ID de marcador válido para Word (sin números ni caracteres especiales)
        const id = 'heading_ref_' + contador++;
        cabeceras.push({ id, texto, normalized, nodo: n });
      }
    }
    for (const h of n.hijos || []) {
      buscar(h);
    }
  };
  buscar(arbol);
  return cabeceras;
}

/* ── Notas al pie ──────────────────────────────────────────────────────────────────────────
   El informe lleva sus citas legales al pie de la hoja, bajo la línea separadora de Word. El
   PDF las declara con el rol `Note`, pero **ancladas justo detrás del párrafo que las cita**,
   así que emitirlas donde el árbol las pone las deja en mitad de la página y empuja el resto
   del texto hacia abajo: el diseño de las páginas siguientes deja de parecerse al original.
   Medido en el informe de referencia: 42 notas en 15 páginas, hasta 6 en una sola de la
   sección III.

   La solución es emitirlas como notas al pie DE VERDAD (`footnotes` + `FootnoteReferenceRun`),
   no como párrafos reubicados: así Word las coloca al pie de la hoja donde acabe cayendo su
   llamada, las numera y las mueve al repaginar. Es el mismo criterio que el pie de página, que
   lleva el campo PAGE en vez del número literal del PDF.

   Se reconocen por dos vías. La del lector versión 9, que las apartó en un `div[data-nota-pie]`
   con su llamada en un `sup[data-ref-nota]`; y una de respaldo por la forma del párrafo, para
   que una plantilla marcada con el lector anterior —que sigue viva en IndexedDB— quede
   arreglada sin obligar a subir otra vez el PDF y a volver a marcar con IA. */

/* Un párrafo de nota empieza por su número. Medido sobre el informe: fuera de las tablas hay
   exactamente 42 párrafos que empiezan así y son las 42 notas, ni una más. El único candidato
   que engañaba a esta regla —«11 BIT STUDIOS S.A.», una razón social— vive dentro de una tabla,
   y por eso `parrafosDe` no entra en ellas. */
const RX_NUMERO_NOTA = /^\s*(\d{1,3})\s/;

/* Las notas van a 8 puntos y las fuentes de tabla a 8 y 9; el cuerpo va a 12. En medios puntos,
   que es como mide `docx`. Sirve para reconocer la llamada y para decidir si un párrafo continúa
   la nota anterior, no para reconocer la nota misma: el extractor sólo declara el tamaño cuando
   se desvía más de un punto del cuerpo, y medido sobre el informe hay 6 notas de las 42 cuyo
   texto llega sin ninguna declaración. */
const TAMANO_NOTA = 18;

/* ¿Está este bloque ENTERO en letra de nota? No basta con que traiga algún fragmento pequeño:
   un párrafo del cuerpo lleva la llamada de su nota en esa misma letra, y con la prueba laxa el
   párrafo «…de acuerdo al artículo 1 del decreto 2120³» de la página 7 pasaba por continuación
   de la nota anterior y se arrastraba entero al pie, llevándose además la llamada de la nota 3
   —que dejaba de encontrarse y tumbaba en cascada las cuarenta siguientes—. Lo que distingue de
   verdad es que NADA de su texto está a cuerpo de 12. */
function esLetraDeNota(nodo) {
  if (!nodo || nodo.texto !== undefined) return false;
  let pequena = false;
  let aCuerpo = '';
  const recorrer = (n, chico) => {
    if (n.texto !== undefined) {
      if (chico) { if (n.texto.trim()) pequena = true; } else aCuerpo += n.texto;
      return;
    }
    const t = tamanoDeEstilo(n.atributos && n.atributos.style);
    const ahora = chico || (t !== null && t <= TAMANO_NOTA);
    for (const h of n.hijos || []) recorrer(h, ahora);
  };
  recorrer(nodo, false);
  return pequena && !aCuerpo.trim();
}

/* Los párrafos del documento en orden, sin entrar en las tablas: las fuentes al pie de una
   tabla van en la misma letra pequeña que una nota, y sin esta frontera se colarían. */
function parrafosDe(nodo, salida = []) {
  for (const h of nodo.hijos || []) {
    if (h.texto !== undefined) continue;
    if (h.etiqueta === 'table') continue;
    if (h.etiqueta === 'p') { salida.push(h); continue; }
    parrafosDe(h, salida);
  }
  return salida;
}

/* Las llamadas, emparejadas con sus notas en una pasada propia y ANTES de emitir nada. Se hace
   aparte por dos razones. Una: en el informe hay una nota que aparece antes que su llamada, así
   que decidirlo sobre la marcha dejaba esa nota emitida dos veces —al pie y en el cuerpo—. Otra:
   así el reconocimiento vive todo en un sitio y el traductor sólo consulta el resultado, sin
   volver a aplicar reglas que podrían desincronizarse con éstas.

   Devuelve `llamadaDeNodo`, del nodo que hace de llamada al número de su nota. */
function llamadasDe(arbol, notas, numeroDeNodo) {
  const llamadaDeNodo = new Map();
  const puestas = new Set();
  /* El respaldo sólo acepta como llamada el siguiente número que espera: es lo que distingue el
     «12» de una nota del «12» de una celda de tabla. El informe las numera de corrido, así que
     el orden del documento es el de los números. */
  const pendientes = [...notas.keys()].sort((a, b) => a - b);
  let siguiente = 0;

  const recorrer = (n) => {
    if (n.texto !== undefined) return;
    /* Dentro de una nota no se busca: su propio número va en la misma letra pequeña que una
       llamada y se haría pasar por ella. */
    if (numeroDeNodo.has(n)) return;

    if (n.etiqueta === 'sup' && n.atributos && n.atributos['data-ref-nota'] !== undefined) {
      const numero = Number(n.atributos['data-ref-nota']);
      if (notas.has(numero) && !puestas.has(numero)) {
        llamadaDeNodo.set(n, numero);
        puestas.add(numero);
      }
      return;
    }

    /* Respaldo: el lector anterior emitía la llamada como un dígito a cuerpo de nota, sin
       `sup`, indistinguible a la vista de un número cualquiera. */
    if (n.etiqueta === 'span') {
      const tamano = tamanoDeEstilo(n.atributos && n.atributos.style);
      const esperado = pendientes[siguiente];
      if (tamano && tamano <= TAMANO_NOTA && esperado !== undefined &&
          textoDe(n).trim() === String(esperado)) {
        llamadaDeNodo.set(n, esperado);
        puestas.add(esperado);
        while (pendientes[siguiente] !== undefined && puestas.has(pendientes[siguiente])) {
          siguiente += 1;
        }
        return;
      }
    }

    for (const h of n.hijos || []) recorrer(h);
  };
  recorrer(arbol);
  return llamadaDeNodo;
}

/* Las notas al pie del documento: `notas` va del número de la nota al nodo que contiene sus
   párrafos, `numeroDeNodo` dice qué nodos del cuerpo pertenecen a una nota —para no emitirlos
   dos veces— y `llamadaDeNodo`, qué nodo hace de llamada de cada una. */
export function notasAlPieDe(arbol) {
  const notas = new Map();
  const numeroDeNodo = new Map();

  /* Vía del lector 9. Si hay una sola nota apartada se usa esta y no la otra: mezclarlas
     duplicaría las notas de un documento a medio migrar. */
  const marcados = [];
  const buscarMarcados = (n) => {
    if (n.texto !== undefined) return;
    const marca = n.atributos && n.atributos['data-nota-pie'];
    if (marca) { marcados.push([Number(marca), n]); return; }
    for (const h of n.hijos || []) buscarMarcados(h);
  };
  buscarMarcados(arbol);
  if (marcados.length) {
    for (const [numero, nodo] of marcados) {
      notas.set(numero, nodo);
      numeroDeNodo.set(nodo, numero);
    }
    return { notas, numeroDeNodo, llamadaDeNodo: llamadasDe(arbol, notas, numeroDeNodo) };
  }

  /* Respaldo por la forma del párrafo. */
  const parrafos = parrafosDe(arbol);
  for (let i = 0; i < parrafos.length; i++) {
    const m = RX_NUMERO_NOTA.exec(textoDe(parrafos[i]).trim());
    if (!m) continue;
    const numero = Number(m[1]);
    if (notas.has(numero)) continue;
    const grupo = [parrafos[i]];
    /* Una nota puede seguir en el párrafo de al lado —le pasa a la primera del informe, que cita
       el artículo y después lo transcribe—. Se arrastra sólo uno, y sólo si está entero en letra
       de nota: medido sobre el informe, una de las 42 lo necesita y ninguna más. Un párrafo
       vacío, uno a cuerpo de 12 o uno que empiece por número —la nota siguiente— la cierran. */
    const sig = parrafos[i + 1];
    const textoSig = sig ? textoDe(sig).trim() : '';
    if (textoSig && esLetraDeNota(sig) && !RX_NUMERO_NOTA.test(textoSig)) {
      grupo.push(sig);
      i += 1;
    }
    notas.set(numero, { etiqueta: 'div', atributos: {}, hijos: grupo });
    for (const g of grupo) numeroDeNodo.set(g, numero);
  }
  return { notas, numeroDeNodo, llamadaDeNodo: llamadasDe(arbol, notas, numeroDeNodo) };
}

/* Ancho de la caja de texto: la hoja menos los dos márgenes. Las tablas del informe la ocupan
   entera. */
const CAJA_TEXTO = HOJA_TWIPS.ancho - 2 * HOJA_TWIPS.margen;

const BORDE = { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' };

/* ── Fórmulas Matemáticas Nativas de Word ──────────────────────────────────────────────────
   Cuando se exporta el reporte a Word, las ecuaciones de ajuste de LaTeX no deben salir como
   texto plano lineal (tipo "AR Adjustment = (((ANC_TP / TNS_TP)..."). En su lugar, usamos el
   motor matemático nativo de Microsoft Word (OMML) para que las renderice perfectamente como
   ecuaciones reales con fracciones, paréntesis y subíndices, idéntico al PDF original. */
const sub = (base, subText) => new MathSubScript({
  children: [new MathRun(base)],
  subScript: [new MathRun(subText)],
});

const formulaAR = () => new Paragraph({
  children: [
    new DocxMath({
      children: [
        new MathRun('AR Adjustment = '),
        new MathRoundBrackets({
          children: [
            new MathRoundBrackets({
              children: [
                new MathFraction({
                  numerator: [sub('ANC', 'TP')],
                  denominator: [sub('TNS', 'TP')],
                }),
                new MathRun(' * '),
                sub('TNS', 'comp'),
              ],
            }),
            new MathRun(' - '),
            sub('ANC', 'comp'),
          ],
        }),
        new MathRun(' * '),
        new MathRoundBrackets({
          children: [
            new MathFraction({
              numerator: [new MathRun('R')],
              denominator: [new MathRun('1 + R')],
            }),
          ],
        }),
      ],
    }),
  ],
  spacing: { before: 120, after: 120 },
  alignment: AlignmentType.CENTER,
});

const formulaAP = () => new Paragraph({
  children: [
    new DocxMath({
      children: [
        new MathRun('AP Adjustment = '),
        new MathRoundBrackets({
          children: [
            new MathRoundBrackets({
              children: [
                new MathFraction({
                  numerator: [sub('ANP', 'TP')],
                  denominator: [sub('TNS', 'TP')],
                }),
                new MathRun(' * '),
                sub('TNS', 'comp'),
              ],
            }),
            new MathRun(' - '),
            sub('ANP', 'comp'),
          ],
        }),
        new MathRun(' * '),
        new MathRoundBrackets({
          children: [
            new MathFraction({
              numerator: [new MathRun('R')],
              denominator: [new MathRun('1 + R')],
            }),
          ],
        }),
      ],
    }),
  ],
  spacing: { before: 120, after: 120 },
  alignment: AlignmentType.CENTER,
});

/* Agrupa las cinco funciones de traducción (`runsDe`, `parrafoDe`, `bloquesDe`, `tablaDe`,
   `runDeImagen`) y sus auxiliares detrás de un cierre sobre `porId`, el catálogo de recursos
   de la tarea 7 (y, en la 10, un contador del anexo). La alternativa —hilar el catálogo como
   último parámetro de las cinco— se descartó a propósito: es más ruido que un cierre y hay que
   tocar las cinco firmas dos veces, una ahora y otra en la tarea 10. Se llama una vez por
   documento desde `construirDocumento`. */
function traductor({
  porId, anexo = [], tamanoBase = 24, cabeceras = [],
  notas = new Map(), numeroDeNodo = new Map(), llamadaDeNodo = new Map(),
}) {
  /* Qué notas tienen llamada en el texto y por tanto pueden salir al pie. Una que no la tenga se
     queda como párrafo donde estaba: en Word una nota al pie sin llamada no se ve, y perder
     texto de un informe que se radica ante la DIAN es el peor resultado posible. */
  const conLlamada = new Set(llamadaDeNodo.values());
  /* Puesta mientras se emite el contenido de una nota, para que `bloquesDe` no la confunda con
     el cuerpo y la descarte. */
  let enNota = false;
  /* De data URL a bytes. Las imágenes van como binario en `word/media/`: en el .doc iban en
     base64 dentro del propio archivo y pesaba 3,3 MB. */
  function bytesDeDataUrl(dataUrl) {
    const m = /^data:image\/([a-z+]+);base64,(.*)$/i.exec(String(dataUrl || ''));
    if (!m) return null;
    const tipo = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
    const b64 = m[2];
    /* `atob` en el navegador, `Buffer` en Node. */
    const bytes = typeof Buffer !== 'undefined'
      ? Buffer.from(b64, 'base64')
      : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return { tipo, bytes };
  }

  /* El tamaño del `style` de la marca, que es el que el PDF le da. `transformation` va en
     píxeles de 96 ppp: comprobado contra docx 9.7.1, que emite 9525 EMU por unidad. */
  function tamanoDeImagen(estilo) {
    const ancho = medidaEnCm((/width:\s*([\d.]+cm)/.exec(estilo || '') || [])[1]);
    const alto = medidaEnCm((/height:\s*([\d.]+cm)/.exec(estilo || '') || [])[1]);
    if (!ancho || !alto) return null;
    let wPx = cmAPixeles(ancho);
    let hPx = cmAPixeles(alto);
    const anchoMaxPx = Math.round(CAJA_TEXTO * 96 / 1440);
    if (wPx > anchoMaxPx) {
      hPx = Math.round(hPx * (anchoMaxPx / wPx));
      wPx = anchoMaxPx;
    }
    return { width: wPx, height: hPx };
  }

  /* Una imagen cuyo recurso no está en el catálogo no rompe el documento: se emite nada y el
     texto de alrededor sigue. Pasa si el catálogo y la plantilla se desincronizan, y un throw
     dejaría al usuario sin documento y sin explicación. */
  const runDeImagen = (nodo) => {
    const id = nodo.atributos['data-recurso'];
    const dataUrl = porId.get(id) || nodo.atributos.src;
    const datos = bytesDeDataUrl(dataUrl);
    const tamano = tamanoDeImagen(nodo.atributos.style);
    if (!datos || !tamano) {
      if (id) console.warn('[docxWriter] imagen sin recurso o sin tamaño: ' + id);
      return [];
    }
    return [new ImageRun({ type: datos.tipo, data: datos.bytes, transformation: tamano })];
  };

  /* Traduce UN hijo a runs. Vive aparte porque la usan dos sitios: el bucle de `runsDe` y
     `bloquesDe`, cuando un fragmento en línea cuelga directamente de un bloque —una imagen o
     un `<strong>` dentro de un `<td>` o un `<div>`, sin `<p>` de por medio—. Antes `bloquesDe`
     llamaba a `runsDe(h, heredado)` sobre ese fragmento suelto, y `runsDe` itera los HIJOS de
     lo que recibe, no traduce al nodo mismo: una imagen o una negrita en esa posición se perdía
     en silencio (con `<strong>`, además, quedaba el texto pero sin negrita). Con `runDeImagen`
     provisional devolviendo siempre `[]` esto era invisible; ahora que traduce imágenes de
     verdad, el hueco se nota. */
  const runsDeHijo = (h, heredado) => {
    if (h.texto !== undefined) return h.texto ? [new TextRun({ text: h.texto, ...heredado })] : [];
    if (h.etiqueta === 'img') return runDeImagen(h);
    if (h.etiqueta === 'br') return [];
    /* La llamada de la nota: el número deja de ser texto y pasa a ser la referencia de Word,
       que es la que arrastra la nota al pie de la hoja. */
    const nota = llamadaDeNodo.get(h);
    if (nota !== undefined) return [new FootnoteReferenceRun(nota)];
    /* Un bloque anidado no aporta runs a este párrafo: lo emite `bloquesDe` en el suyo. Sin
       esto el texto salía dos veces, una aquí y otra como párrafo espurio. */
    if (esBloque(h)) return [];
    const propio = { ...heredado };
    if (h.etiqueta === 'strong' || h.etiqueta === 'b') propio.bold = true;
    if (h.etiqueta === 'em' || h.etiqueta === 'i') propio.italics = true;
    const estilo = h.atributos && h.atributos.style;
    const familia = familiaDeEstilo(estilo);
    if (familia) propio.font = familia;
    /* El tamaño se hereda igual que la familia: un `<span style="font-size:9pt">` con un
       `<strong>` dentro tiene que conservar los 9 puntos. */
    const tamano = tamanoDeEstilo(estilo);
    if (tamano) propio.size = tamano;
    return runsDe(h, propio);
  };

  /* Texto del subárbol convertido a runs, arrastrando el estilo heredado. `<strong>` y `<em>`
     son las dos etiquetas que el extractor emite para el estilo de fuente; una familia propia
     llega en el `style` de un `<span>`.

     `pt-valor` no se mira a propósito: el resaltado del valor sustituido es de pantalla. En el
     .doc se colaba y cada dato sustituido salía más negrita y con aire a los lados.

     No desciende en bloques: cuando encuentra un `<p>` u otro bloque, se detiene. Eso permite
     que un párrafo con párrafos anidados emita primero su propio contenido en línea, y luego
     `bloquesDe` maneje los bloques anidados como bloques independientes. */
  function runsDe(nodo, heredado = {}) {
    const salida = [];
    for (const h of nodo.hijos || []) {
      salida.push(...runsDeHijo(h, heredado));
    }
    return salida;
  }

  /* El título y el número, con el tabulador de Word en medio. Es lo que mantiene la fila de
     puntos pegada al margen derecho cuando la métrica de la fuente cambia.
     Y con redirección (InternalHyperlink) al marcador (Bookmark) de la sección correspondiente. */
  const parrafoDeIndice = (titulo, numero) => {
    const normalizedTOC = normalizarTextoParaComparar(titulo);
    const cabeceraMatch = cabeceras.find((c) => c.normalized === normalizedTOC);

    const runs = [new TextRun({
      children: [
        titulo,
        new PositionalTab({
          alignment: PositionalTabAlignment.RIGHT,
          leader: PositionalTabLeader.DOT,
          relativeTo: 'margin',
        }),
        numero,
      ],
      bold: true,
    })];

    return new Paragraph({
      children: cabeceraMatch
        ? [new InternalHyperlink({
            anchor: cabeceraMatch.id,
            children: runs,
          })]
        : runs,
      spacing: { before: 0, after: 0, line: 276 },
    });
  };

  function parrafoDe(nodo, runs = runsDe(nodo)) {
    const nivel = NIVELES[nodo.etiqueta];

    /* Entrada del índice: se detecta sobre el texto plano del bloque. El extractor ya pone
       cada entrada en su propio párrafo (rol TOCI), así que el texto del bloque es la entrada
       completa. */
    if (!nivel) {
      const m = RX_ENTRADA_INDICE.exec(textoDe(nodo));
      if (m && m[1].trim()) return parrafoDeIndice(m[1].trim(), m[2]);

      // Si es una de las fórmulas de ajuste normalizadas de LaTeX, usamos el motor matemático de Word
      const texto = textoDe(nodo).trim();
      if (texto.includes('AR Adjustment = (((ANC_TP / TNS_TP)')) {
        return formulaAR();
      }
      if (texto.includes('AP Adjustment = (((ANP_TP / TNS_TP)')) {
        return formulaAP();
      }
    }

    // Si es una cabecera/sección, la envolvemos en un Bookmark con su ID correspondiente
    if (nivel) {
      const cabeceraMatch = cabeceras.find((c) => c.nodo === nodo);
      if (cabeceraMatch) {
        runs = [
          new Bookmark({
            id: cabeceraMatch.id,
            children: runs,
          })
        ];
      }
    }

    return new Paragraph({
      ...(nivel ? { heading: nivel } : { alignment: AlignmentType.JUSTIFIED }),
      children: runs,
      spacing: { before: 0, after: 0, line: 276 },
      ...(nivel === HeadingLevel.HEADING_1 ? { pageBreakBefore: true } : {}),
    });
  }

  /* Celdas de una fila. Un hijo que no es celda se descarta: el PDF cuelga un `P` vacío de
     cada `TR`, y en el .doc eso costó un documento de 834 páginas porque Word sacaba el
     párrafo de la tabla y la partía. Aquí no hay importador que lo interprete, pero tampoco
     hay razón para emitirlo. */
  const celdasDe = (fila) =>
    (fila.hijos || []).filter((c) => c.etiqueta === 'td' || c.etiqueta === 'th');

  function tablaDe(nodo) {
    const filas = [];
    /* Las filas pueden venir envueltas en `<thead>`/`<tbody>` si el HTML pasó por el
       navegador. */
    const recogerFilas = (n) => {
      for (const h of n.hijos || []) {
        if (h.texto !== undefined) continue;
        if (h.etiqueta === 'tr') filas.push(h);
        /* No se desciende en una tabla anidada: sus filas son suyas, no de la exterior. La
           celda que la contiene la emite por su cuenta, porque `bloquesDe` sabe armar
           tablas. */
        else if (h.etiqueta === 'table') continue;
        else recogerFilas(h);
      }
    };
    recogerFilas(nodo);

    const conCeldas = filas.filter((f) => celdasDe(f).length > 0);
    if (!conCeldas.length) return null;

    /* Los anchos tienen que sumar el ancho de la tabla o Word recalcula. Se reparte a partes
       iguales sobre el número máximo de celdas: el árbol del PDF no expone ColSpan ni RowSpan
       —está medido en el spec— así que no hay geometría de columna que respetar. El último
       absorbe el resto de la división. */
    const columnas = Math.max(...conCeldas.map((f) => celdasDe(f).length));
    const ancho = Math.floor(CAJA_TEXTO / columnas);
    const anchos = Array.from({ length: columnas }, (_, i) =>
      (i === columnas - 1 ? CAJA_TEXTO - ancho * (columnas - 1) : ancho));

    return new Table({
      columnWidths: anchos,
      width: { size: CAJA_TEXTO, type: WidthType.DXA },
      rows: conCeldas.map((f) => new TableRow({
        children: celdasDe(f).map((c, i) => {
          /* El heredado tiene que llegar hasta los párrafos que arma `bloquesDe`, no quedarse
             en un fallback que nunca se alcanza: `bloquesDe` siempre vuelca el texto suelto
             de una celda como párrafo (el `volcar()` final, fuera del `for`), así que la rama
             de abajo nunca estaba vacía y el color nunca llegaba a los runs. */
          /* El tamaño reducido de la tabla se hereda a la celda. La vista previa lo aplica
             por CSS (`table{font-size:0.9em}` en REGLAS_DOCUMENTO) desde siempre; sin esto el
             .docx emitía las tablas al cuerpo entero y pantalla y archivo divergían en el 99 %
             del texto de tabla del informe —2311 nodos de 2333, medido—. Un fragmento que
             declare su propio `font-size` lo sobrescribe después, en `runsDeHijo`, que es lo
             correcto: ahí manda lo que dice el PDF. */
          const heredadoCelda = {
            size: Math.round(tamanoBase * FACTOR_TABLA),
            ...(c.etiqueta === 'th' ? { color: 'FFFFFF' } : {}),
          };
          const todo = bloquesDe(c, [], heredadoCelda);
          /* Los párrafos vacíos de una celda se descartan, y sólo dentro de una celda.
             El PDF cuelga un `<p>` vacío delante del contenido de 432 de las 2291 celdas del
             informe —el 19 %—, que es la marca de párrafo que Word deja al exportar la tabla.
             Emitirlos dobla el alto de esas filas: sobre 890 filas eran una docena de hojas de
             más, y en la página 73 el PDF pone 69 renglones donde el writer emitía 141
             párrafos.

             Fuera de una tabla NO se descartan, y esa distinción es deliberada: la portada del
             informe se centra con 35 párrafos vacíos seguidos y quitarlos la descuadraría. Aquí
             no centran nada, son un artefacto de la exportación.

             Si la celda se queda sin nada, más abajo recibe un párrafo vacío: una celda de
             OOXML sin ningún párrafo obliga a Word a reparar el documento. */
          const contenido = todo.filter((b) =>
            !(b instanceof Paragraph) || JSON.stringify(b).includes('"w:t"'));
          return new TableCell({
            width: { size: anchos[i] ?? ancho, type: WidthType.DXA },
            /* CLEAR y no SOLID: la skill lo marca porque SOLID sale negro. */
            ...(c.etiqueta === 'th'
              ? { shading: { type: ShadingType.CLEAR, fill: '0E1726' } } : {}),
            borders: { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE },
            /* Una celda de OOXML necesita al menos un párrafo: una celda vacía sin ninguno
               da un documento que Word tiene que reparar. */
            children: contenido.length ? contenido : [new Paragraph({ children: [] })],
          });
        }),
      })),
    });
  }

  /* Las páginas del anexo se reparten en orden entre los huecos que dejó el extractor. Si hay
     menos que huecos, los que sobran siguen avisando de lo que falta.

     No se copian las páginas escaneadas del año anterior: el informe se radica ante la DIAN, y
     un calco perfecto con los estados financieros firmados del año equivocado dentro es peor
     que un hueco evidente. */
  let siguienteAnexo = 0;

  const bloqueDeHueco = (nodo) => {
    const pagina = anexo[siguienteAnexo];
    if (!pagina) return bloquesDe(nodo);
    siguienteAnexo += 1;
    const datos = bytesDeDataUrl(pagina);
    if (!datos) return bloquesDe(nodo);
    /* La página del anexo ocupa la caja de texto entera: la misma `CAJA_TEXTO` que usan las
       tablas, sólo que en píxeles y no en twips. 96/1440 es la conversión de twips (1440 por
       pulgada) a píxeles de 96 ppp, la misma proporción que usa `cmAPixeles` para centímetros.
       Mantener la proporción real de la página no se puede saber sin decodificar el PNG: se usa
       el ancho de la caja y un alto proporcional a una hoja carta (11/8,5), que es una
       SUPOSICIÓN razonable para estos escaneos, no una medida tomada del archivo. */
    const anchoPx = Math.round(CAJA_TEXTO * 96 / 1440);
    return [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({
        type: datos.tipo, data: datos.bytes,
        transformation: { width: anchoPx, height: Math.round(anchoPx * 11 / 8.5) },
      })],
    })];
  };

  /* Recorre el HTML y emite bloques. Las etiquetas que no son bloque se atraviesan, que es lo
     que permite que un `<div>` del contentEditable no pierda su contenido.

     El texto y los fragmentos en línea que aparecen fuera de un párrafo se acumulan y se
     vuelcan como un párrafo al toparse con el siguiente bloque. Así el orden del documento se
     conserva: si se emitieran al final, el texto de después de una tabla saldría antes que
     ella. */
  function bloquesDe(nodo, salida = [], heredado = {}) {
    let sueltos = [];
    const volcar = () => {
      if (!sueltos.length) return;
      salida.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: sueltos, spacing: { before: 0, after: 0, line: 276 } }));
      sueltos = [];
    };
    for (const h of nodo.hijos || []) {
      if (h.texto !== undefined) {
        if (h.texto.trim()) sueltos.push(new TextRun({ text: h.texto, ...heredado }));
        continue;
      }
      /* `runsDeHijo`, no `runsDe`: `h` es el propio fragmento suelto —una imagen, un
         `<strong>`— y `runsDe` traduciría a sus HIJOS, perdiendo `h`. Es el fallo que hacía
         desaparecer en silencio una imagen o una negrita colgadas directamente de un `<td>`
         o un `<div>`, sin `<p>` de por medio. */
      if (!esBloque(h)) { sueltos.push(...runsDeHijo(h, heredado)); continue; }
      volcar();
      /* Un bloque que pertenece a una nota al pie sale al pie de la hoja por su referencia: no
         se repite en el cuerpo. Si no tiene llamada se queda donde estaba y se avisa, porque en
         Word una nota sin llamada no se ve. */
      const numeroNota = enNota ? undefined : numeroDeNodo.get(h);
      if (numeroNota !== undefined) {
        if (conLlamada.has(numeroNota)) continue;
        console.warn('[docxWriter] la cita al pie ' + numeroNota + ' no tiene llamada en el ' +
          'texto: se deja como párrafo del cuerpo para no perderla.');
      }
      /* El hueco del anexo de estados financieros: lo deja el extractor donde iba una página
         que no puede reproducir. Se resuelve aquí, como cualquier otro bloque. */
      if (h.atributos && h.atributos['data-hueco'] === 'anexo_eeff') {
        salida.push(...bloqueDeHueco(h));
        continue;
      }
      if (h.etiqueta === 'table') {
        const t = tablaDe(h);
        if (t) salida.push(t);
        continue;
      }
      /* Listas: viñeta de Word vía `numbering`, jamás un `•` literal. Un carácter no es una
         lista, no se renumera ni se sangra. */
      if (h.etiqueta === 'ul' || h.etiqueta === 'ol') {
        for (const li of h.hijos || []) {
          if (li.etiqueta !== 'li') continue;
          salida.push(new Paragraph({
            numbering: { reference: 'vinetas', level: 0 },
            children: runsDe(li, heredado),
            spacing: { before: 0, after: 0, line: 276 },
          }));
        }
        continue;
      }
      if (h.etiqueta === 'p' || NIVELES[h.etiqueta]) {
        const runs = runsDe(h, heredado);
        const dentro = (h.hijos || []).filter(esBloque);
        /* Un párrafo vacío sigue siendo un párrafo: la portada del informe se centra con 35
           seguidos. Se emite también sin runs, salvo que sea sólo un envoltorio de otros
           bloques —ahí el párrafo vacío no existía en el original—. */
        if (runs.length || !dentro.length) salida.push(parrafoDe(h, runs));
        for (const b of dentro) bloquesDe({ hijos: [b] }, salida, heredado);
        continue;
      }
      bloquesDe(h, salida, heredado);
    }
    volcar();
    return salida;
  }

  /* Las notas que tienen llamada, con la forma que espera `Document`. Cada una conserva su
     cursiva, su negrita y sus 8 puntos, que ya vienen en los fragmentos; lo que Word pone por su
     cuenta es el número. */
  const notasDeWord = () => {
    const salida = {};
    /* La bandera es lo que permite reusar `bloquesDe` para el contenido de la nota: sus
       párrafos están en `numeroDeNodo` —por eso el cuerpo los omite—, y sin esto se omitirían
       también aquí y la nota saldría vacía. */
    enNota = true;
    try {
      for (const numero of [...conLlamada].sort((a, b) => a - b)) {
        const hijos = bloquesDe(notas.get(numero));
        salida[numero] = { children: hijos.length ? hijos : [new Paragraph('')] };
      }
    } finally {
      enNota = false;
    }
    return salida;
  };

  return { runsDe, parrafoDe, bloquesDe, tablaDe, runDeImagen, notasDeWord };
}

/* Las páginas del original, agrupadas en tandas de la misma orientación. Cada tanda es una
   sección de Word, porque la orientación es una propiedad de la sección. Dentro de una tanda,
   un salto de página duro entre página y página: es lo que hace que la página N empiece donde
   debe. Word repagina, así que si el contenido de una no cabe desborda a una hoja extra —eso
   no lo evita nada—, pero ya no hay un importador de HTML añadiendo desbordes propios. */
function paginasDe(arbol) {
  const paginas = [];
  const buscar = (n) => {
    for (const h of n.hijos || []) {
      if (h.texto !== undefined) continue;
      const clase = (h.atributos && h.atributos.class) || '';
      if (/\bpagina\b/.test(clase)) {
        paginas.push({
          nodo: h,
          orientacion: (h.atributos['data-orientacion'] === 'apaisada')
            ? 'apaisada' : 'vertical',
        });
        continue;
      }
      buscar(h);
    }
  };
  buscar(arbol);
  return paginas;
}

const tandasDe = (paginas) => paginas.reduce((tandas, p) => {
  const ultima = tandas[tandas.length - 1];
  if (ultima && ultima.orientacion === p.orientacion) ultima.paginas.push(p.nodo);
  else tandas.push({ orientacion: p.orientacion, paginas: [p.nodo] });
  return tandas;
}, []);

export function construirDocumento({ html = '', recursos = [], anexo = [] } = {}) {
  const base = estiloBaseDe(html) || { familia: 'Arial', tamano: 12 };
  const enc = encabezadoDe(html);
  /* El encabezado se saca del cuerpo: si se queda, el logo sale además como primera imagen
     del documento. En el .doc llegó a repetirse 96 veces. `estiloBaseDe` sigue leyendo `html`
     completo: la marca `data-estilo-base` vive en otro div y no se ve afectada. */
  const cuerpo = enc ? html.replace(enc.bloque, '') : html;
  const arbol = htmlAArbol(cuerpo);
  const porId = new Map((recursos || []).map((r) => [r.id, r.dataUrl]));
  /* Si suben más páginas de anexo que huecos hay, las que sobran no se pierden en silencio:
     perder páginas de un anexo firmado sería grave. Se avisa por consola y se quedan sin usar,
     en el orden en que llegaron. */
  const totalHuecos = (cuerpo.match(/data-hueco="anexo_eeff"/g) || []).length;
  if ((anexo || []).length > totalHuecos) {
    console.warn('[docxWriter] el anexo trae ' + anexo.length + ' página(s) para sólo ' +
      totalHuecos + ' hueco(s) en el informe: sobran ' + (anexo.length - totalHuecos) +
      ' página(s) que no se usan.');
  }

  /* Escaneamos todas las secciones/cabeceras reales del documento para poder referenciarlas
     desde el índice (tabla de contenido) con marcadores (Bookmarks) e hipervínculos internos. */
  const cabeceras = escanearCabeceras(arbol);

  /* Las citas legales, apartadas para salir al pie de la hoja y no en mitad de la página. */
  const { notas, numeroDeNodo, llamadaDeNodo } = notasAlPieDe(arbol);

  /* El cuerpo base se pasa al traductor porque de él sale el tamaño reducido de las tablas:
     el mismo 0,9 que la vista previa aplica por CSS. */
  const { bloquesDe, runsDe, notasDeWord } = traductor({
    porId, anexo, tamanoBase: mediosPuntos(base.tamano), cabeceras,
    notas, numeroDeNodo, llamadaDeNodo,
  });

  const cabecera = enc
    ? new Header({
      children: [new Paragraph({
        alignment: ALINEACION[enc.lado] || AlignmentType.CENTER,
        children: runsDe(htmlAArbol(enc.contenido)),
      })],
    })
    : null;

  const paginas = paginasDe(arbol);

  /* Sin páginas marcadas —la plantilla maestra, o un .docx por mammoth— se emite una sola
     sección corrida. Mejor eso que inventar una paginación que el original no tiene. */
  const cuerpoCorrido = paginas.length ? [] : bloquesDe(arbol);
  const secciones = paginas.length
    ? tandasDe(paginas).map((t, iTanda) => ({
      properties: {
        page: t.orientacion === 'apaisada'
          ? { ...PAGINA, size: { ...PAGINA.size, orientation: PageOrientation.LANDSCAPE } }
          : PAGINA,
        /* `titlePage` deja la primera página sin encabezado: Word sólo sabe distinguir la
           primera de las demás. El informe de referencia no lo lleva hasta la página 5, así
           que las páginas 2 a 4 seguirán llevándolo. Para eso harían falta más secciones, y
           esto ya quita el solape con el logo grande de la portada. */
        ...(iTanda === 0 && cabecera && !enc.enLaPortada ? { titlePage: true } : {}),
      },
      ...(cabecera ? { headers: { default: cabecera } } : {}),
      footers: { default: pieConNumero() },
      children: t.paginas.flatMap((nodo, i) => [
        /* Salto delante de la segunda página para separar la portada (primera página de la primera tanda) */
        ...(iTanda === 0 && i === 1 ? [new Paragraph({ children: [new PageBreak()] })] : []),
        ...bloquesDe(nodo),
      ]),
    }))
    : [{
      properties: {
        page: PAGINA,
        /* Misma regla que arriba: es la única sección, así que ella hace de "primera". */
        ...(cabecera && !enc.enLaPortada ? { titlePage: true } : {}),
      },
      ...(cabecera ? { headers: { default: cabecera } } : {}),
      footers: { default: pieConNumero() },
      /* Una sola pasada, no dos: `bloquesDe` lleva cuenta de las páginas de anexo ya
         repartidas y de las notas ya referenciadas, así que llamarla dos veces —lo que se
         hacía para preguntar si venía vacía— gastaba el anexo por duplicado y dejaba las
         notas sin su llamada la segunda vez. */
      children: cuerpoCorrido.length ? cuerpoCorrido : [new Paragraph('')],
    }];

  const notasAlPie = notasDeWord();
  const sinLlamada = notas.size - Object.keys(notasAlPie).length;
  if (sinLlamada > 0) {
    console.warn('[docxWriter] ' + sinLlamada + ' de ' + notas.size + ' cita(s) al pie no ' +
      'tienen llamada en el texto y salen como párrafo del cuerpo, no al pie.');
  }

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: base.familia || 'Arial', size: mediosPuntos(base.tamano) },
          /* `after: 0` no es redundante: **sin él Word aplica su valor de fábrica, 200 twips
             = 10 pt de espacio después de CADA párrafo**. Sobre los 3867 párrafos del informe
             son unas 49 hojas de espaciado puro, y es la causa principal de que el documento
             saliera con 173 hojas donde el original tiene 112. La vista previa no lo sufría
             porque su CSS no añade ese margen: era la última asimetría pantalla/archivo.

             El informe separa sus párrafos con párrafos vacíos —los trae el PDF—, así que el
             espacio que hace falta ya está en el contenido y no hay que añadir más.

             `lineRule: 'auto'` hace que el 276 sea proporcional (1,15 líneas) en vez de fijo,
             para que una celda de tabla a 9 pt no arrastre el interlineado del cuerpo de 12. */
          paragraph: { spacing: { line: 276, lineRule: 'auto', after: 0 } },
        },
      },
    },
    /* Viñeta de Word, no un `•` escrito a mano: un carácter literal no es una lista y no se
       puede renumerar ni sangrar. */
    numbering: {
      config: [{
        reference: 'vinetas',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      }],
    },
    /* Las citas legales del informe, al pie de la hoja y con el número que Word les pone. Sin
       esto salían como párrafos en mitad de la página, empujando el resto del texto. */
    ...(Object.keys(notasAlPie).length ? { footnotes: notasAlPie } : {}),
    sections: secciones,
  });
}

export const aDocxBuffer = (args) => Packer.toBuffer(construirDocumento(args));
export const aDocxBlob = (args) => Packer.toBlob(construirDocumento(args));
