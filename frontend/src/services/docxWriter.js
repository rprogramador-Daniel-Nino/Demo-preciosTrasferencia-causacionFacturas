/* HTML final + recursos → .docx real (OOXML).

   No conoce el PDF ni precios de transferencia: recibe HTML y devuelve un zip. Esa frontera es
   lo que lo hace probable con `node --test` sin navegador, y es la lección de los cuatro
   fallos de formato que sólo se veían abriendo Word —834 páginas, una hoja por párrafo, los
   dos logos encimados, el resaltado colándose—: todos vivían en el único trozo sin tests.

   Las medidas y el estilo NO se deciden aquí. Salen de `estiloDocumento.js`, que es la misma
   fuente que pinta la vista previa. Es lo que da la paridad que se pidió. */

import {
  Document, Packer, Paragraph, TextRun, Footer, PageNumber, AlignmentType, HeadingLevel,
  PositionalTab, PositionalTabAlignment, PositionalTabLeader,
} from 'docx';
import { HOJA_TWIPS } from './estiloDocumento.js';
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
const familiaDeEstilo = (estilo) => {
  const m = /font-family:\s*["']?([^;"']+)["']?/.exec(estilo || '');
  const m = /font-family:\s*["']?([^;"']+)["']?/.exec(estilo || '');
  return m ? m[1].trim() : null;
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
    if (h.texto !== undefined) {
      if (h.texto) salida.push(new TextRun({ text: h.texto, ...heredado }));
      continue;
    }
    if (h.etiqueta === 'img') { salida.push(...runDeImagen(h)); continue; }
    if (h.etiqueta === 'br') continue;
    /* Un bloque anidado no aporta runs a este párrafo: lo emite `bloquesDe` en el suyo. Sin
       esto el texto salía dos veces, una aquí y otra como párrafo espurio. */
    if (esBloque(h)) continue;
    const propio = { ...heredado };
    if (h.etiqueta === 'strong' || h.etiqueta === 'b') propio.bold = true;
    if (h.etiqueta === 'em' || h.etiqueta === 'i') propio.italics = true;
    const familia = familiaDeEstilo(h.atributos && h.atributos.style);
    if (familia) propio.font = familia;
    salida.push(...runsDe(h, propio));
  }
  return salida;
}

/* Se completa en la tarea 7. */
function runDeImagen() { return []; }

/* Una entrada del índice: título, una fila de al menos cuatro puntos, y el número de página.
   Se exige el número al final para no confundirla con unos puntos suspensivos. */
const RX_ENTRADA_INDICE = /^(.*?)\s*\.{4,}\s*(\d+)\s*$/;

/* El título y el número, con el tabulador de Word en medio. Es lo que mantiene la fila de
   puntos pegada al margen derecho cuando la métrica de la fuente cambia. */
const parrafoDeIndice = (titulo, numero) => new Paragraph({
  children: [new TextRun({
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
  })],
});

function parrafoDe(nodo, runs = runsDe(nodo)) {
  const nivel = NIVELES[nodo.etiqueta];

  /* Entrada del índice: se detecta sobre el texto plano del bloque. El extractor ya pone cada
     entrada en su propio párrafo (rol TOCI), así que el texto del bloque es la entrada
     completa. */
  if (!nivel) {
    const m = RX_ENTRADA_INDICE.exec(textoDe(nodo));
    if (m && m[1].trim()) return parrafoDeIndice(m[1].trim(), m[2]);
  }

  return new Paragraph({
    ...(nivel ? { heading: nivel } : { alignment: AlignmentType.JUSTIFIED }),
    children: runs,
  });
}

/* Recorre el HTML y emite bloques. Las etiquetas que no son bloque se atraviesan, que es lo
   que permite que un `<div>` del contentEditable no pierda su contenido.

   El texto y los fragmentos en línea que aparecen fuera de un párrafo se acumulan y se
   vuelcan como un párrafo al toparse con el siguiente bloque. Así el orden del documento se
   conserva: si se emitieran al final, el texto de después de una tabla saldría antes que
   ella. */
function bloquesDe(nodo, salida = []) {
  let sueltos = [];
  const volcar = () => {
    if (!sueltos.length) return;
    salida.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: sueltos }));
    sueltos = [];
  };
  for (const h of nodo.hijos || []) {
    if (h.texto !== undefined) {
      if (h.texto.trim()) sueltos.push(new TextRun(h.texto));
      continue;
    }
    if (!esBloque(h)) { sueltos.push(...runsDe(h)); continue; }
    volcar();
    if (h.etiqueta === 'p' || NIVELES[h.etiqueta]) {
      const runs = runsDe(h);
      const dentro = (h.hijos || []).filter(esBloque);
      /* Un párrafo vacío sigue siendo un párrafo: la portada del informe se centra con 35
         seguidos. Se emite también sin runs, salvo que sea sólo un envoltorio de otros
         bloques —ahí el párrafo vacío no existía en el original—. */
      if (runs.length || !dentro.length) salida.push(parrafoDe(h, runs));
      for (const b of dentro) bloquesDe({ hijos: [b] }, salida);
      continue;
    }
    bloquesDe(h, salida);
  }
  volcar();
  return salida;
}

export function construirDocumento({ html = '', recursos = [], anexo = [] } = {}) {
  const base = estiloBaseDe(html) || { familia: 'Arial', tamano: 12 };
  const arbol = htmlAArbol(html);

  const hijos = bloquesDe(arbol);

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: base.familia || 'Arial', size: mediosPuntos(base.tamano) },
          paragraph: { spacing: { line: 276 } },
        },
      },
    },
    sections: [{
      properties: { page: PAGINA },
      footers: { default: pieConNumero() },
      children: hijos.length ? hijos : [new Paragraph('')],
    }],
  });
}

export const aDocxBuffer = (args) => Packer.toBuffer(construirDocumento(args));
export const aDocxBlob = (args) => Packer.toBlob(construirDocumento(args));
