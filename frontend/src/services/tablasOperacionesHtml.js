/* ─────────────────────────────────────────────────────────────────────────────
   tablasOperacionesHtml.js — las Tablas 1 y 2 en la ruta de plantilla PDF.

   La ruta OOXML rellena el .docx del cliente y regenera veinte tablas
   (`docxRelleno.js`). La ruta de plantilla PDF no regeneraba ninguna: convierte el
   informe del año anterior a HTML y solo sustituye lo que quedó envuelto en un
   `<span data-campo>` por el marcado. Las celdas de estas dos tablas no llevan marca
   —«Ingreso (07)» y «Otros servicios» no corresponden a ningún campo del
   vocabulario— así que el informe se radicaba con el concepto, el vinculado, el país
   y el monto del cliente anterior.

   POR QUÉ DETERMINISTA Y NO POR MARCADO. Marcar tablas con un modelo es frágil, y
   aquí además «Otros servicios» es subcadena de «Otros servicios (07)»: la primera se
   marcaría dentro de la segunda y la segunda quedaría descartada por solape, así que
   el resultado dependería del orden en que el modelo las propusiera. Es el mismo
   razonamiento por el que existe `actualizarTablasOperacionesOoxml`.

   SE CONSERVA LA FILA DE ENCABEZADOS. Es el formato del cliente —sus negritas, su
   sombreado, sus anchos—; solo se reescriben las filas de datos. Y el rótulo tampoco
   se toca, así que la numeración del cliente sobrevive intacta aunque haya renumerado.
   ───────────────────────────────────────────────────────────────────────────── */

import { claveTitulo, numeroDeTabla } from './docxRelleno.js';
import { resaltarValor } from './estiloDocumento.js';
import { filasOperacionesDeIngreso, filasOperacionAnalizar } from './tablasOperaciones.js';

/** Texto visible de un fragmento de HTML, con las entidades deshechas para poder comparar. */
function textoPlanoHtml(fragmento) {
  return String(fragmento || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#160;|&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/* El valor va escapado: sale del OCR de un RUT o de un Excel del cliente y puede traer
   `&` o `<`. Sin escapar, un `&` rompería el HTML del informe. */
function escaparHtml(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Fin de la etiqueta contenedora que empieza en `desde`, contando anidamiento.
 *
 * Las tablas y las filas se anidan —la plantilla mete tablas dentro de celdas—, así que
 * un `indexOf('</table>')` cerraría en la interior y partiría el documento.
 *
 * @returns {{inicioCierre:number, fin:number}|null}
 */
function finDeElemento(html, desde, etiqueta) {
  const rx = new RegExp('<' + etiqueta + '(?:\\s[^>]*)?>|</' + etiqueta + '\\s*>', 'gi');
  rx.lastIndex = desde;
  let nivel = 0;
  let m;
  while ((m = rx.exec(html)) !== null) {
    nivel += m[0].startsWith('</') ? -1 : 1;
    if (nivel === 0) return { inicioCierre: m.index, fin: m.index + m[0].length };
  }
  return null;
}

/* Bloques que pueden llevar el rótulo de una tabla. El extractor de PDF lo emite como
   `<p><strong> Tabla 1. …</strong></p>`; un cliente puede haberlo puesto como encabezado. */
const RX_BLOQUE = /<(p|h[1-6])(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;

/* Entre el rótulo y la tabla la plantilla deja párrafos vacíos. Se saltan; en cuanto
   aparece uno con texto, ese rótulo no era el de esta tabla. */
const RX_HUECO = /^\s*(?:<p(?:\s[^>]*)?\/>|<p(?:\s[^>]*)?>(?:(?!<\/p\s*>)[\s\S])*?<\/p\s*>)/i;

/**
 * La tabla cuyo rótulo coincide con alguno de los nombres dados.
 *
 * @param html      el informe completo.
 * @param nombres   nombre canónico de la tabla, o varios sinónimos.
 * @param numeros   números con los que desambiguar rótulos homónimos.
 * @returns {{inicioTabla:number, inicioCierre:number, fin:number, numero:number|null}|null}
 */
export function localizarTablaHtml(html, nombres, numeros = []) {
  const texto = String(html || '');
  const claves = (Array.isArray(nombres) ? nombres : [nombres]).map(claveTitulo).filter(Boolean);
  if (!claves.length) return null;

  const candidatos = [];
  RX_BLOQUE.lastIndex = 0;
  let b;
  while ((b = RX_BLOQUE.exec(texto)) !== null) {
    const titulo = textoPlanoHtml(b[2]);
    const clave = claveTitulo(titulo);
    if (!clave || !claves.some((c) => clave.includes(c))) continue;

    let cursor = b.index + b[0].length;
    for (;;) {
      const hueco = RX_HUECO.exec(texto.slice(cursor));
      if (!hueco || textoPlanoHtml(hueco[0]).trim()) break;
      cursor += hueco[0].length;
    }
    const tras = /^\s*<table(?:\s[^>]*)?>/i.exec(texto.slice(cursor));
    if (!tras) continue;

    const inicioTabla = cursor + tras[0].search(/<table/i);
    const cierre = finDeElemento(texto, inicioTabla, 'table');
    if (!cierre) continue;
    candidatos.push({ inicioTabla, ...cierre, numero: numeroDeTabla(titulo) });
  }

  if (!candidatos.length) return null;

  /* El número solo desempata. Si el cliente renumeró y ninguno coincide, se sigue con lo
     que dio el nombre en vez de no encontrar nada: misma regla que la ruta OOXML. */
  const porNumero = numeros.length ? candidatos.filter((c) => numeros.includes(c.numero)) : [];
  return (porNumero.length ? porNumero : candidatos)[0];
}

/** Una fila de datos. La primera celda va en `<th>` porque así la trae la plantilla. */
function filaHtml(celdas) {
  return '<tr>' + celdas.map((c, i) => {
    const et = i === 0 ? 'th' : 'td';
    return '<' + et + '><p>' + resaltarValor(escaparHtml(c)) + '</p></' + et + '>';
  }).join('') + '</tr>';
}

/** Sustituye las filas de datos de `tabla` por las de `filas`, conservando la de encabezados. */
function reescribirFilas(html, tabla, filas) {
  /* La primera fila es la de encabezados y se conserva. Si la tabla no trae ninguna, las
     filas nuevas entran justo antes del cierre. */
  const iFila = html.indexOf('<tr', tabla.inicioTabla);
  let desde = tabla.inicioCierre;
  if (iFila !== -1 && iFila < tabla.inicioCierre) {
    const cierreFila = finDeElemento(html, iFila, 'tr');
    if (cierreFila && cierreFila.fin <= tabla.inicioCierre) desde = cierreFila.fin;
  }
  return html.slice(0, desde) + filas.map(filaHtml).join('') + html.slice(tabla.inicioCierre);
}

/**
 * Reescribe las Tablas 1 y 2 del informe en HTML con los datos del estudio.
 *
 * @param {string} html     el informe renderizado.
 * @param {object} estudio
 * @param {string[]} [avisos] arreglo donde se anotan las tablas que la plantilla no trae.
 *        Sin el aviso, una tabla ausente se queda con las cifras del informe de referencia
 *        y nadie se entera: mismo contrato que `sustituidorDeTablas` de la ruta OOXML.
 * @returns {string} el informe con las dos tablas actualizadas.
 */
export function actualizarTablasOperacionesHtml(html, estudio, avisos) {
  let out = String(html || '');
  if (!estudio) return out;

  const objetivos = [
    { nombres: ['Operaciones de Ingreso', 'Operaciones de Egreso'], numeros: [1],
      tabla: filasOperacionesDeIngreso(estudio) },
    { nombres: 'Operación analizar', numeros: [2], tabla: filasOperacionAnalizar(estudio) },
  ];

  for (const { nombres, numeros, tabla } of objetivos) {
    const donde = localizarTablaHtml(out, nombres, numeros);
    if (!donde) {
      if (Array.isArray(avisos)) avisos.push(tabla.nombre);
      continue;
    }
    out = reescribirFilas(out, donde, tabla.filas);
  }

  return out;
}
