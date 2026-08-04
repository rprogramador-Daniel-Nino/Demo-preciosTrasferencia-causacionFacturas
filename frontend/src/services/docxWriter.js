/* HTML final + recursos → .docx real (OOXML).

   No conoce el PDF ni precios de transferencia: recibe HTML y devuelve un zip. Esa frontera es
   lo que lo hace probable con `node --test` sin navegador, y es la lección de los cuatro
   fallos de formato que sólo se veían abriendo Word —834 páginas, una hoja por párrafo, los
   dos logos encimados, el resaltado colándose—: todos vivían en el único trozo sin tests.

   Las medidas y el estilo NO se deciden aquí. Salen de `estiloDocumento.js`, que es la misma
   fuente que pinta la vista previa. Es lo que da la paridad que se pidió. */

import {
  Document, Packer, Paragraph, TextRun, Footer, PageNumber, AlignmentType, HeadingLevel,
} from 'docx';
import { HOJA_TWIPS } from './estiloDocumento.js';
import { estiloBaseDe } from './pdfReferenceExtractor.js';
import { htmlAArbol } from './htmlAArbol.js';

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

/* La familia que declara un `<span style="font-family:'X'">`. El extractor sólo la declara
   cuando se desvía del cuerpo del documento. */
const familiaDeEstilo = (estilo) => {
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
    /* No descender en bloques. */
    if (h.etiqueta === 'p' || NIVELES[h.etiqueta]) continue;
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

function parrafoDe(nodo) {
  const nivel = NIVELES[nodo.etiqueta];
  const hijos = runsDe(nodo);
  return new Paragraph({
    ...(nivel ? { heading: nivel } : { alignment: AlignmentType.JUSTIFIED }),
    children: hijos,
  });
}

/* Recorre el HTML y emite bloques. Las etiquetas que no son bloque se atraviesan, que es lo
   que permite que un `<div>` del contentEditable no pierda su contenido.

   Cuando un bloque tiene bloques anidados, emite primero el párrafo del padre (que no
   desciende en bloques por el cambio en `runsDe`) y luego los bloques anidados como
   párrafos independientes. Esto maneja el HTML del contentEditable, donde los bloques
   pueden no estar cerrados. */
function bloquesDe(nodo, salida = []) {
  for (const h of nodo.hijos || []) {
    if (h.texto !== undefined) {
      if (h.texto.trim()) salida.push(new Paragraph({ children: [new TextRun(h.texto)] }));
      continue;
    }
    if (h.etiqueta === 'p' || NIVELES[h.etiqueta]) {
      salida.push(parrafoDe(h));
      /* Emitir bloques anidados (aunque htmlAArbol los cierre implícitamente, el HTML del
         contentEditable puede tenerlos). */
      for (const nieto of h.hijos || []) {
        if (nieto.texto === undefined && (nieto.etiqueta === 'p' || NIVELES[nieto.etiqueta])) {
          salida.push(parrafoDe(nieto));
          bloquesDe(nieto, salida);
        } else if (nieto.texto === undefined) {
          bloquesDe(nieto, salida);
        }
      }
      continue;
    }
    bloquesDe(h, salida);
  }
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
