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
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  ImageRun, LevelFormat,
} from 'docx';
import { HOJA_TWIPS, cmAPixeles, medidaEnCm } from './estiloDocumento.js';
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

/* Ancho de la caja de texto: la hoja menos los dos márgenes. Las tablas del informe la ocupan
   entera. */
const CAJA_TEXTO = HOJA_TWIPS.ancho - 2 * HOJA_TWIPS.margen;

const BORDE = { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' };

/* Agrupa las cinco funciones de traducción (`runsDe`, `parrafoDe`, `bloquesDe`, `tablaDe`,
   `runDeImagen`) y sus auxiliares detrás de un cierre sobre `porId`, el catálogo de recursos
   de la tarea 7 (y, en la 10, un contador del anexo). La alternativa —hilar el catálogo como
   último parámetro de las cinco— se descartó a propósito: es más ruido que un cierre y hay que
   tocar las cinco firmas dos veces, una ahora y otra en la tarea 10. Se llama una vez por
   documento desde `construirDocumento`. */
function traductor({ porId }) {
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
    return { width: cmAPixeles(ancho), height: cmAPixeles(alto) };
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

    /* Entrada del índice: se detecta sobre el texto plano del bloque. El extractor ya pone
       cada entrada en su propio párrafo (rol TOCI), así que el texto del bloque es la entrada
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
          const heredadoCelda = c.etiqueta === 'th' ? { color: 'FFFFFF' } : {};
          const contenido = bloquesDe(c, [], heredadoCelda);
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
      salida.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: sueltos }));
      sueltos = [];
    };
    for (const h of nodo.hijos || []) {
      if (h.texto !== undefined) {
        if (h.texto.trim()) sueltos.push(new TextRun({ text: h.texto, ...heredado }));
        continue;
      }
      if (!esBloque(h)) { sueltos.push(...runsDe(h, heredado)); continue; }
      volcar();
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

  return { runsDe, parrafoDe, bloquesDe, tablaDe, runDeImagen };
}

export function construirDocumento({ html = '', recursos = [], anexo = [] } = {}) {
  const base = estiloBaseDe(html) || { familia: 'Arial', tamano: 12 };
  const arbol = htmlAArbol(html);
  const porId = new Map((recursos || []).map((r) => [r.id, r.dataUrl]));
  const { bloquesDe } = traductor({ porId });

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
    sections: [{
      properties: { page: PAGINA },
      footers: { default: pieConNumero() },
      children: hijos.length ? hijos : [new Paragraph('')],
    }],
  });
}

export const aDocxBuffer = (args) => Packer.toBuffer(construirDocumento(args));
export const aDocxBlob = (args) => Packer.toBlob(construirDocumento(args));
