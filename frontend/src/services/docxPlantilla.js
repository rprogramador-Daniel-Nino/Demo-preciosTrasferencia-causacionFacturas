/* ─────────────────────────────────────────────────────────────────────────────
   docxPlantilla.js — Leer y MARCAR el OOXML de una plantilla .docx.

   Es la mitad de entrada de la ruta que rellena el .docx del cliente en vez de
   reconstruirlo. La otra mitad es `docxRelleno.js`.

   POR QUÉ EXISTE. La ruta anterior pasaba el .docx por `mammoth.convertToHtml` y
   volvía a construir el documento desde ese HTML. Mammoth produce HTML semántico
   limpio y descarta la presentación —es su propósito declarado—, así que el informe
   salía sin encabezado ni pie, sin la fuente ni los colores del cliente, sin bordes
   ni sombreados de tabla y con los márgenes del sistema. Medido sobre un .docx con
   todo eso, lo único que sobrevivía eran párrafos, títulos, listas, tablas y
   negrita. Aquí no se convierte nada: se escriben marcadores dentro del propio
   OOXML del cliente y se reempaqueta, de modo que el formato ni se toca.

   CÓMO SE REUTILIZA EL MARCADO QUE YA EXISTE. `plantillaMarcador.js` sabe pedirle a
   la IA pares «fragmento → campo» y anclarlos por (texto literal, N-ª aparición).
   Ese anclaje no depende del formato, pero su implementación sí: corta las corridas
   de texto en cada etiqueta. Word parte una misma frase en varios `<w:r><w:t>` por
   rsid, por el corrector o por un cambio de formato, de modo que pasarle el XML
   crudo dejaría sin marcar todo fragmento repartido entre runs —que en un informe
   real son la mayoría—. La solución es `aHtmlSintetico`: un `<p>` por párrafo con
   el texto ya unido. Sobre eso, `proponerMarcas` funciona sin modificarlo, y las
   ocurrencias que devuelve valen tal cual aquí porque el orden de los párrafos y el
   texto visible son los mismos.
   ───────────────────────────────────────────────────────────────────────────── */

import { esCampoValido } from './plantillaVocabulario.js';
import { MOTIVO_NO_APARECE, MOTIVO_SOLAPE, MOTIVO_SIN_APARICION_LIBRE } from './plantillaMarcador.js';

/* Un `<w:p>` completo. Contempla las tres formas en que Word lo escribe: con
   atributos (`<w:p w14:paraId="…">`), sin ellos (`<w:p>`) y vacío y autocerrado
   (`<w:p/>`), que es como queda un párrafo en blanco. Exigir `\s`, `>` o `/`
   después de `<w:p` es lo que evita confundirlo con `<w:pPr>`. */
const RX_PARRAFO = /<w:p(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:p>)/g;
/* Apertura, contenido y cierre de cada `<w:t>`, por separado: al reescribir hay que
   conservar la etiqueta de apertura tal cual (lleva `xml:space`, y perderlo come los
   espacios de los extremos). */
const RX_TEXTO = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;

/** Escapa lo que no puede ir crudo dentro de un `<w:t>`. */
function escaparXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Deshace el escapado de XML para poder buscar sobre el texto tal como se lee. */
function desescaparXml(s) {
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Los párrafos del documento con su texto visible ya unido.
 *
 * @param {string} xml  contenido de `word/document.xml` (o de un encabezado/pie).
 * @returns {Array<{indice:number, inicio:number, fin:number, texto:string, partes:number}>}
 *          `inicio`/`fin` son offsets sobre `xml`; `partes`, cuántos `<w:t>` lo componen.
 */
export function textoPorParrafo(xml) {
  const fuente = String(xml || '');
  const parrafos = [];
  let m;
  RX_PARRAFO.lastIndex = 0;
  while ((m = RX_PARRAFO.exec(fuente)) !== null) {
    const bloque = m[0];
    const tes = [...bloque.matchAll(RX_TEXTO)];
    parrafos.push({
      indice: parrafos.length,
      inicio: m.index,
      fin: m.index + bloque.length,
      texto: desescaparXml(tes.map((t) => t[2]).join('')),
      partes: tes.length,
    });
  }
  return parrafos;
}

/**
 * HTML sintético para que `proponerMarcas` pueda trabajar sobre un .docx.
 *
 * Un `<p>` por párrafo con el texto unido. No pretende parecerse al documento: su
 * único cometido es dar a la IA el mismo texto visible, en el mismo orden, con las
 * fronteras en los párrafos y no en los runs.
 *
 * @param {Array<{texto:string}>} parrafos  lo que devuelve `textoPorParrafo`.
 * @returns {string}
 */
export function aHtmlSintetico(parrafos) {
  return (parrafos || [])
    .map((p) => '<p>' + escaparXml(p.texto) + '</p>')
    .join('');
}

/** Atajo: de un `word/document.xml` al HTML que se le pasa a `proponerMarcas`. */
export function htmlParaMarcar(xml) {
  return aHtmlSintetico(textoPorParrafo(xml));
}

/**
 * Reparte un texto ya marcado sobre los `<w:t>` de un párrafo.
 *
 * El primero se queda con todo el contenido y los demás quedan vacíos —no se
 * eliminan: borrar el run se llevaría por delante su `<w:rPr>` y con él el formato
 * de lo que venga después—.
 *
 * CONSECUENCIA QUE HAY QUE CONOCER: si un fragmento marcado cruzaba runs con
 * formatos distintos, el valor sustituido sale con el formato del primero. Para un
 * dato que se sustituye es lo deseable —un NIT medio en negrita sería un defecto—,
 * pero significa que un párrafo con formato variado se uniforma al marcarlo.
 */
function redistribuir(bloque, textoNuevo) {
  let restante = escaparXml(textoNuevo);
  return bloque.replace(RX_TEXTO, (todo, apertura, _contenido, cierre) => {
    const contenido = restante;
    restante = '';
    /* `xml:space="preserve"` o Word recorta los espacios de los extremos y las
       palabras se pegan justo donde estaba el marcador. */
    const con = /xml:space=/.test(apertura)
      ? apertura
      : apertura.replace(/^<w:t/, '<w:t xml:space="preserve"');
    return con + contenido + cierre;
  });
}

/**
 * Sustituye TRAMOS del texto de un párrafo, sin aplanarlo.
 *
 * Recibe el bloque `<w:p>…</w:p>` y los rangos a cambiar, en coordenadas del texto UNIDO
 * del párrafo —el mismo que devuelve `textoPorParrafo`—, y devuelve el bloque con solo esos
 * tramos cambiados.
 *
 * ── Por qué existe, y qué arregla ──
 *
 * `redistribuir` mete todo el texto del párrafo en su primer `<w:t>` y vacía los demás. Eso
 * tiene una consecuencia que se ve en la portada de cualquier informe: el `<w:br/>` que
 * separa el nombre de la compañía del título del informe NO contiene texto, así que al
 * aplanar el párrafo todo el texto queda antes del salto y la portada sale con
 * «MONTACHEM INTERNATIONAL SAINFORME LOCAL DE PRECIOS DE TRANSFERENCIA», pegado. Medido
 * sobre el informe de MONTACHEM 2025 que reportó el usuario.
 *
 * Aquí, en cambio, lo que está fuera del rango no se toca: ni su texto, ni su formato, ni
 * los `<w:br/>` que haya entre medias.
 *
 * ── Lo que sí se conserva del comportamiento anterior, a propósito ──
 *
 * El texto nuevo entra COMPLETO en el primer `<w:t>` que toca el rango, y de los demás se
 * quita solo la parte cubierta. No es un detalle estético: si un `{campo}` quedara partido
 * entre dos `<w:t>`, Docxtemplater no lo reconocería y el dato no se sustituiría nunca —el
 * marcador tiene que viajar contiguo—. Y un valor que cruzaba runs con formatos distintos
 * sale con el del primero, que para un dato sustituido es lo deseable: un NIT medio en
 * negrita sería un defecto.
 *
 * @param {string} bloque  el `<w:p>…</w:p>` completo.
 * @param {Array<{pos:number, largo:number, texto:string}>} rangos  en coordenadas del texto
 *        unido. Se aplican de derecha a izquierda, así que el orden de entrada no importa.
 * @returns {string} el bloque con los tramos sustituidos.
 */
export function sustituirRangosEnParrafo(bloque, rangos) {
  const fuente = String(bloque || '');
  const pendientes = (rangos || []).filter((r) => r && r.largo >= 0 && r.pos >= 0);
  if (!pendientes.length) return fuente;

  /* Los `<w:t>` con su sitio en el XML y su tramo dentro del texto unido. */
  const tes = [];
  let acumulado = 0;
  let m;
  RX_TEXTO.lastIndex = 0;
  while ((m = RX_TEXTO.exec(fuente)) !== null) {
    const contenido = desescaparXml(m[2]);
    tes.push({
      xmlInicio: m.index,
      xmlFin: m.index + m[0].length,
      apertura: m[1],
      cierre: m[3],
      contenido,
      desde: acumulado,
      hasta: acumulado + contenido.length,
    });
    acumulado += contenido.length;
  }
  if (!tes.length) return fuente;

  /* De derecha a izquierda: así un rango no invalida la posición del anterior. */
  [...pendientes].sort((a, b) => b.pos - a.pos).forEach((r) => {
    const fin = r.pos + r.largo;
    /* Los `<w:t>` que el rango toca. Un rango de largo cero —una inserción— toca aquel en
       cuyo interior cae. */
    const tocados = tes.filter((t) => (t.desde < fin && r.pos < t.hasta)
      || (r.largo === 0 && r.pos >= t.desde && r.pos <= t.hasta));
    if (!tocados.length) return;

    tocados.forEach((t, i) => {
      const desdeLocal = Math.max(0, r.pos - t.desde);
      const hastaLocal = Math.min(t.contenido.length, fin - t.desde);
      const prefijo = t.contenido.slice(0, desdeLocal);
      const sufijo = t.contenido.slice(Math.max(desdeLocal, hastaLocal));
      /* El texto nuevo, entero, en el primero que toca; en los demás solo se quita lo
         cubierto. */
      t.contenido = i === 0 ? prefijo + String(r.texto ?? '') + sufijo : prefijo + sufijo;
    });
  });

  /* Se reconstruye de atrás hacia delante, por la misma razón. */
  let salida = fuente;
  [...tes].sort((a, b) => b.xmlInicio - a.xmlInicio).forEach((t) => {
    /* `xml:space="preserve"` o Word recorta los espacios de los extremos y las palabras se
       pegan justo donde estaba el marcador. */
    const apertura = /xml:space=/.test(t.apertura)
      ? t.apertura
      : t.apertura.replace(/^<w:t/, '<w:t xml:space="preserve"');
    salida = salida.slice(0, t.xmlInicio)
      + apertura + escaparXml(t.contenido) + t.cierre
      + salida.slice(t.xmlFin);
  });
  return salida;
}

/**
 * Como `redistribuir`, pero para una celda de tabla que puede no traer ningún `<w:t>`
 * —vacía salvo por su formato/sombreado, algo frecuente en la columna que el cliente
 * dejó en blanco de la fila que se usa de modelo—.
 *
 * `redistribuir` sobre una celda así no encuentra nada que reemplazar y devuelve el
 * bloque intacto: el marcador se pierde EN SILENCIO. Para un `{campo}` cualquiera es un
 * dato que no sale; para el `{#coleccion}`/`{/coleccion}` de `envolverTablaEnBucle` es
 * un bucle que queda desbalanceado para siempre en la plantilla persistida, y
 * Docxtemplater revienta el render completo en cuanto lo encuentra.
 *
 * Si no hay `<w:t>`, se inserta un run nuevo dentro del primer `<w:p>` de la celda en
 * vez de no escribir nada.
 */
function escribirEnCelda(celda, textoNuevo) {
  RX_TEXTO.lastIndex = 0;
  if (RX_TEXTO.test(celda)) {
    RX_TEXTO.lastIndex = 0;
    return redistribuir(celda, textoNuevo);
  }
  const run = '<w:r><w:t xml:space="preserve">' + escaparXml(textoNuevo) + '</w:t></w:r>';
  if (/<w:p(?:\s[^>]*)?\/>/.test(celda)) {
    return celda.replace(/<w:p(?:\s[^>]*)?\/>/, (m) => m.slice(0, -2) + '>' + run + '</w:p>');
  }
  return celda.replace(
    /(<w:p(?:\s[^>]*)?>)(\s*<w:pPr>[\s\S]*?<\/w:pPr>)?/,
    (m, apertura, pPr) => apertura + (pPr || '') + run,
  );
}

/**
 * Escribe los marcadores `{campo}` dentro del OOXML.
 *
 * Mismo contrato de entrada y de salida que `aplicarMarcas` de
 * `plantillaMarcador.js`, para que el revisor humano y quien informa los descartes
 * no tengan que distinguir de qué formato viene la plantilla.
 *
 * La ocurrencia se cuenta sobre TODO el documento y sobre todas las apariciones,
 * incluidas las ya marcadas, exactamente por la razón que documenta `aplicarMarcas`:
 * contar solo las libres renumera el documento después de cada marca y las
 * sustituciones acaban cayendo en el sitio equivocado.
 *
 * @param {string} xml  `word/document.xml` de la plantilla.
 * @param {Array<{fragmento:string, campo:string, ocurrencia?:number}>} marcas
 * @param {{abrir?:string, cerrar?:string}} [delimitadores]  por defecto `{` y `}`.
 * @returns {{xml:string, aplicadas:number, descartadas:Array<{marca:object, motivo:string}>}}
 */
export function aplicarMarcasOoxml(xml, marcas, delimitadores = {}) {
  const abrir = delimitadores.abrir || '{';
  const cerrar = delimitadores.cerrar || '}';

  const parrafos = textoPorParrafo(xml);
  const descartadas = [];
  /* Las sustituciones se RESUELVEN todas primero, sobre el texto original, y se
     APLICAN después de derecha a izquierda. Hacerlo marca a marca obliga a
     reubicar cada posición según lo que ya se sustituyó, y ahí es donde una marca
     acaba cayendo en la aparición siguiente: sustituir la 1.ª de tres «2024» dejaba
     a la 2.ª apuntando a la 3.ª. */
  const porParrafo = new Map(); // indice -> [{ pos, largo, campo }]

  for (const marca of marcas || []) {
    const { fragmento, campo } = marca || {};
    const ocurrencia = marca && marca.ocurrencia ? marca.ocurrencia : 1;

    if (!campo || !esCampoValido(campo)) {
      descartadas.push({ marca, motivo: 'el campo no está en el vocabulario' });
      continue;
    }
    if (!fragmento) {
      descartadas.push({ marca, motivo: 'la marca no trae fragmento' });
      continue;
    }

    /* La ocurrencia se cuenta sobre el texto ORIGINAL y sobre todas las apariciones,
       marcadas o no, que es la regla que ya sigue `aplicarMarcas`: contar solo las
       libres renumera el documento tras cada marca. */
    let vistas = 0;
    let destino = null; // { parrafo, pos }
    for (const p of parrafos) {
      let desde = 0, i;
      while ((i = p.texto.indexOf(fragmento, desde)) !== -1) {
        vistas++;
        if (vistas === ocurrencia) { destino = { parrafo: p.indice, pos: i }; break; }
        desde = i + fragmento.length;
      }
      if (destino) break;
    }

    if (!destino) {
      descartadas.push({ marca, motivo: vistas === 0 ? MOTIVO_NO_APARECE : MOTIVO_SIN_APARICION_LIBRE });
      continue;
    }

    /* Solape: dos marcas que pisan el mismo tramo de texto. Se compara por rangos
       sobre el original, que es exacto; la segunda no se aplica. */
    const yaEnEste = porParrafo.get(destino.parrafo) || [];
    const fin = destino.pos + fragmento.length;
    if (yaEnEste.some((s) => destino.pos < s.pos + s.largo && s.pos < fin)) {
      descartadas.push({ marca, motivo: MOTIVO_SOLAPE });
      continue;
    }

    yaEnEste.push({ pos: destino.pos, largo: fragmento.length, campo });
    porParrafo.set(destino.parrafo, yaEnEste);
  }

  let aplicadas = 0;
  /* Los párrafos, de atrás hacia delante para no invalidar sus offsets sobre el XML;
     dentro de cada uno, las sustituciones también de derecha a izquierda. */
  let salida = String(xml || '');
  [...porParrafo.keys()].sort((a, b) => b - a).forEach((idx) => {
    const p = parrafos[idx];
    porParrafo.get(idx).forEach(() => { aplicadas++; });
    /* Quirúrgico y no aplanando el párrafo: `redistribuir` metía todo el texto en el
       primer `<w:t>` y con ello el `<w:br/>` de la portada perdía su sitio, de modo que el
       nombre de la compañía salía pegado al título del informe. */
    const bloque = salida.slice(p.inicio, p.fin);
    const rangos = porParrafo.get(idx).map((s) => ({
      pos: s.pos, largo: s.largo, texto: abrir + s.campo + cerrar,
    }));
    salida = salida.slice(0, p.inicio) + sustituirRangosEnParrafo(bloque, rangos) + salida.slice(p.fin);
  });

  return { xml: salida, aplicadas, descartadas };
}

/* ── Tablas que se repiten ──
   Una tabla de comparables no se marca campo a campo: se marca su FILA MODELO y se
   envuelve en un bucle, de modo que el relleno genere una fila por comparable
   clonando el formato de la del cliente. Clonar su fila es justo lo que conserva los
   bordes, el sombreado y los anchos de columna que la conversión a HTML perdía. */

const RX_TABLA = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
const RX_FILA = /<w:tr[ >][\s\S]*?<\/w:tr>/g;
const RX_CELDA = /<w:tc>[\s\S]*?<\/w:tc>/g;

/**
 * Envuelve la fila de datos de una tabla en un bucle de relleno.
 *
 * La tabla se localiza por un texto que la precede —su título, como «Tabla 15» o
 * «Compañías comparables»—: anclar en el título y no en el enésimo `<w:tbl>`,
 * porque un informe trae decenas de tablas indistinguibles por su marcado. Es la
 * misma estrategia que usaba la sustitución por literales, ya retirada.
 *
 * La fila modelo es la ÚLTIMA de la tabla cuando hay más de una: las anteriores son
 * el encabezado, y regenerarlo perdería las anclas de Word que puedan colgar de él.
 *
 * @param {string} xml
 * @param {{ancla:string, coleccion:string, campos:string[]}} config
 *        `campos` va en el orden de las columnas; una posición vacía deja la celda
 *        como está, para columnas fijas como un número de orden.
 * @returns {{xml:string, envuelta:boolean, motivo?:string}}
 */
export function envolverTablaEnBucle(xml, config) {
  const { ancla, coleccion, campos } = config || {};
  const fuente = String(xml || '');
  if (!ancla || !coleccion || !Array.isArray(campos)) {
    return { xml: fuente, envuelta: false, motivo: 'configuración incompleta' };
  }

  /* El ancla se busca sobre el texto de los párrafos —puede venir partida en runs—
     y de ahí se pasa al offset del XML. */
  const parrafo = textoPorParrafo(fuente).find((p) => p.texto.includes(ancla));
  if (!parrafo) return { xml: fuente, envuelta: false, motivo: 'no se encontró el título de la tabla' };

  RX_TABLA.lastIndex = 0;
  const tabla = [...fuente.matchAll(RX_TABLA)].find((m) => m.index >= parrafo.fin);
  if (!tabla) return { xml: fuente, envuelta: false, motivo: 'no hay ninguna tabla tras el título' };

  const filas = [...tabla[0].matchAll(RX_FILA)];
  if (!filas.length) return { xml: fuente, envuelta: false, motivo: 'la tabla no tiene filas' };

  const modelo = filas[filas.length - 1];
  const celdas = [...modelo[0].matchAll(RX_CELDA)];
  if (!celdas.length) return { xml: fuente, envuelta: false, motivo: 'la fila modelo no tiene celdas' };

  let filaNueva = modelo[0];
  const ultima = celdas.length - 1;
  celdas.forEach((celda, i) => {
    const campo = campos[i];
    if (!campo && i !== 0 && i !== ultima) return; // columna fija: se deja tal cual
    let texto = campo ? '{' + campo + '}' : '';
    if (i === 0) texto = '{#' + coleccion + '}' + texto;
    if (i === ultima) texto += '{/' + coleccion + '}';
    filaNueva = filaNueva.replace(celda[0], escribirEnCelda(celda[0], texto));
  });

  const tablaNueva = tabla[0].slice(0, modelo.index) + filaNueva
    + tabla[0].slice(modelo.index + modelo[0].length);
  return {
    xml: fuente.slice(0, tabla.index) + tablaNueva + fuente.slice(tabla.index + tabla[0].length),
    envuelta: true,
  };
}

/**
 * Los marcadores presentes en un OOXML ya marcado, en orden de aparición y sin
 * repetir. Sirve para saber qué campos trae una plantilla sin renderizarla —el aviso
 * de «campos marcados sin dato» se calcula con esto— y para detectar que un .docx ya
 * venía marcado.
 *
 * @param {string} xml
 * @param {{abrir?:string, cerrar?:string}} [delimitadores]
 * @returns {string[]}
 */
export function camposMarcados(xml, delimitadores = {}) {
  const abrir = delimitadores.abrir || '{';
  const cerrar = delimitadores.cerrar || '}';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* Sobre el texto de los párrafos y no sobre el XML: un marcador puede estar
     partido en varios runs, y ahí solo se ve una vez unido. */
  const texto = textoPorParrafo(xml).map((p) => p.texto).join('\n');
  const rx = new RegExp(esc(abrir) + '([^' + esc(cerrar) + '\\s#/^]+)' + esc(cerrar), 'g');
  const vistos = new Set();
  let m;
  while ((m = rx.exec(texto)) !== null) vistos.add(m[1]);
  return [...vistos];
}
