/* ─────────────────────────────────────────────────────────────────────────────
   notasAlPieHtml.js — las mismas citas de la Sección III, en la ruta de plantilla PDF.

   POR QUÉ ES OTRO MÓDULO. En el .docx una nota al pie es una parte del paquete
   (`word/footnotes.xml`) que Word coloca al pie de la página y renumera solo. En HTML eso no
   existe: no hay pie de página. La traducción honesta es la que usa cualquier documento web —un
   número en superíndice donde se afirma el dato y la referencia al terminar el apartado—, y es
   además lo que sobrevive si de ese HTML se genera un .docx (`docxWriter.js`), que no sabe crear
   notas de Word.

   LO QUE SE CONSERVA ENTRE LAS DOS RUTAS es lo que importa: la cita la redacta el mismo módulo
   (`citasApa.js`), así que el informe dice exactamente lo mismo venga la plantilla de un .docx o
   de un PDF. Lo que cambia es dónde se imprime.

   PÁRRAFOS Y NO UNA LISTA: el HTML de esta ruta se convierte a Word y `<ol>` no siempre
   sobrevive esa conversión; un párrafo con su número delante se ve igual en las dos y no depende
   de que la lista numere bien.
   ───────────────────────────────────────────────────────────────────────────── */

import { citasApa } from './citasApa.js';

const escapar = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* Solo http y https se publican como enlace. Un `javascript:` en el href de un informe que se
   abre en el navegador es una puerta que no tiene por qué existir, y el modelo escribe esa URL. */
const esEnlaceSeguro = (url) => /^https?:\/\//i.test(String(url || '').trim());

/**
 * Las notas de un apartado: el número que va en el texto y las referencias que van debajo.
 *
 * @param {Array<object>} fuentes  como las acepta `citasApa`.
 * @param {number} [numeroInicial]  para que la numeración siga corrida entre apartados.
 * @returns {{referencias:string, notas:string, siguiente:number}}
 *          `referencias` son los superíndices, para anclar al final de la frase; `notas`, los
 *          párrafos de las citas; `siguiente`, por dónde continúa el que venga detrás.
 */
export function notasApartadoHtml(fuentes, numeroInicial = 1) {
  const lista = citasApa(fuentes);
  let n = Number(numeroInicial) || 1;
  if (!lista.length) return { referencias: '', notas: '', siguiente: n };

  const referencias = [];
  const notas = [];

  for (const { cita, url } of lista) {
    const numero = n;
    n += 1;
    referencias.push(`<sup>${numero}</sup>`);

    /* El enlace se pone sobre la URL que cierra la cita, igual que en la nota del .docx. */
    let cuerpo = escapar(cita);
    if (url && esEnlaceSeguro(url) && cita.endsWith(url)) {
      const antes = escapar(cita.slice(0, cita.length - url.length));
      cuerpo = `${antes}<a href="${escapar(url)}">${escapar(url)}</a>`;
    }
    notas.push(`<p><span style="font-size:8pt"><sup>${numero}</sup> ${cuerpo}</span></p>`);
  }

  return { referencias: referencias.join(''), notas: notas.join('\n'), siguiente: n };
}

/**
 * Ancla los superíndices al final del último párrafo de un fragmento de HTML.
 *
 * Igual que en el .docx: el número va donde se afirma el dato, no en un párrafo aparte.
 *
 * @param {string} html
 * @param {string} referencias
 * @returns {string}
 */
export function anclarReferenciasHtml(html, referencias) {
  const texto = String(html || '');
  const refs = String(referencias || '');
  if (!texto || !refs) return texto;

  const cierre = texto.lastIndexOf('</p>');
  if (cierre === -1) return texto + refs;
  return texto.slice(0, cierre) + refs + texto.slice(cierre);
}

/**
 * Un contador de notas para todo el documento, para que la numeración no se reinicie en cada
 * apartado.
 *
 * @param {number} [desde]
 * @returns {{publicar:Function, cuantas:Function}}
 */
export function crearNumeradorDeNotasHtml(desde = 1) {
  let n = Number(desde) || 1;
  let publicadas = 0;

  return {
    /**
     * @param {string} html  la narrativa del apartado.
     * @param {Array<object>} fuentes
     * @returns {string} la narrativa con los superíndices y, debajo, sus referencias.
     */
    publicar(html, fuentes) {
      const { referencias, notas, siguiente } = notasApartadoHtml(fuentes, n);
      if (!referencias) return html;
      n = siguiente;
      publicadas += (notas.match(/<p>/g) || []).length;
      return anclarReferenciasHtml(html, referencias) + '\n' + notas;
    },
    cuantas: () => publicadas,
  };
}
