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

  /* El ancla se busca sobre el texto de los párrafos —puede venir partida en runs— y de ahí
     se pasa al offset del XML. Se exige que la tabla venga INMEDIATAMENTE después, y por eso
     se recorren todos los candidatos en vez de quedarse con el primero.

     Sin esa condición, el primer párrafo que menciona el nombre es el del ÍNDICE —en la
     plantilla de Shandong, «2.5.Razones de rechazo (Filtros Cuantitativos – Filtros
     Cualitativos)77», con el número de página pegado— y la primera tabla que hay después de
     él es la Tabla 1, «Operación con vinculados económicos», a 100 000 caracteres de
     distancia. Ahí acababan envueltos los DOS bucles, el de razones de rechazo y el de
     comparables, así que la última fila de la Tabla 1 se convertía en la fila modelo y el
     informe publicaba «A | Diferencias funcionales» donde iba «Ingreso intereses sobre presta
     (13) | 96.297.749». Reportado con capturas el 2026-08-24.

     Es el mismo error que `anexosDelDocumento` ya corrigió para los anexos —anclaba en la
     tabla de contenido—, y el mismo criterio que sigue `localizarBloqueTabla` en
     `docxRelleno.js`; no se reutiliza aquélla para no montar un ciclo de imports entre los
     dos módulos, que desde el 2026-08-24 se importan en un solo sentido. */
  const candidatos = textoPorParrafo(fuente).filter((p) => nombraLaTabla(p.texto, ancla));
  if (!candidatos.length) {
    return { xml: fuente, envuelta: false, motivo: 'no se encontró el título de la tabla' };
  }

  let inicioTabla = -1;
  for (const p of candidatos) {
    const i = tablaInmediataOoxml(fuente, p.fin);
    if (i >= 0) { inicioTabla = i; break; }
  }
  if (inicioTabla < 0) {
    return { xml: fuente, envuelta: false, motivo: 'el título no va seguido de una tabla' };
  }

  RX_TABLA.lastIndex = 0;
  const tabla = [...fuente.matchAll(RX_TABLA)].find((m) => m.index === inicioTabla);
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

/* ─────────────────────────────────────────────────────────────────────────────
   RESTAURAR LO QUE LA PLANTILLA YA PUBLICABA.

   El marcado sustituye el texto del cliente anterior por `{campo}`, y al rellenar, un
   campo que el estudio no trae sale como «—» (`nullGetter`, en `docxRelleno.js`). Sobre
   el informe de SHANDONG KERUI 2025 eso dejó las Tablas 2, 3, 5, 6 y 7 con todas sus
   celdas en guiones —concepto, vinculado, país y monto— donde la plantilla traía
   «SERVICIOS TÉCNICOS (35) | SHANDONG RUICHENG… | CHINA | 6.719.644.000». Es el mismo
   defecto que `datosDeTabla.js` cerró para las tablas que el generador reescribe, pero
   por el otro camino: aquí no interviene ningún generador de tablas, sino la marca que
   vive dentro de la celda.

   El texto original NO se perdió: `plantillaStore.js` guarda el .docx sin marcar
   (`docx:<id>`) al lado del marcado (`docx-marcado:<id>`), justamente para poder volver a
   marcar sin pedir el archivo otra vez. Así que se recupera sin gastar una llamada a la
   IA y sin volver a marcar nada.

   POR POSICIÓN Y NO POR CAMPO. Un mismo campo aparece en varias celdas con valores
   distintos —en la plantilla de Shandong la Tabla 3 lista tres vinculados diferentes en
   tres filas, todas con `{vinc}`—, así que un respaldo por nombre de campo escribiría el
   primer vinculado en las tres filas: falsearía el informe, que es peor que el guion.
   Aquí cada ocurrencia recupera SU texto, emparejando párrafo con párrafo.

   El emparejamiento es por índice porque el marcado no crea ni reordena párrafos: solo
   reescribe el texto de los que ya están (`sustituirRangosEnParrafo`), y `escribirEnCelda`
   convierte un `<w:p/>` vacío en `<w:p>…</w:p>`, que sigue siendo un párrafo. Si los dos
   documentos no traen el mismo número de párrafos no se adivina: no se restaura nada, se
   dice qué campos quedaron sin respaldo y el relleno sigue como antes.
   ───────────────────────────────────────────────────────────────────────────── */

/** Escapa lo que un delimitador pueda tener de metacarácter. */
const escRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Los tramos de un texto marcado: lo fijo y las marcas, en orden. */
function tramosDeMarcado(texto, rx) {
  const tramos = [];
  let ultimo = 0;
  let m;
  rx.lastIndex = 0;
  while ((m = rx.exec(texto)) !== null) {
    tramos.push({ tipo: 'fijo', texto: texto.slice(ultimo, m.index) });
    tramos.push({ tipo: 'campo', campo: m[1].trim(), pos: m.index, largo: m[0].length });
    ultimo = m.index + m[0].length;
  }
  if (!tramos.length) return [];
  tramos.push({ tipo: 'fijo', texto: texto.slice(ultimo) });
  return tramos;
}

/**
 * Qué decía el original en el sitio de cada marca de un párrafo.
 *
 * Se consumen los tramos FIJOS sobre el texto original —tienen que aparecer en orden— y
 * lo que queda entre dos de ellos es el valor que la marca sustituyó. Ante cualquier duda
 * se devuelve `null` y el párrafo se queda como está: dos marcas seguidas sin texto entre
 * ellas no dicen dónde acaba una y empieza la otra, y un tramo fijo que no aparece en el
 * original significa que estos dos párrafos no son el mismo.
 *
 * @returns {Array<{campo:string, pos:number, largo:number, valor:string}>|null}
 */
export function valoresQueSustituyoElMarcado(textoMarcado, textoOriginal, rx) {
  const tramos = tramosDeMarcado(String(textoMarcado || ''), rx);
  if (!tramos.length) return null;

  /* Los extremos se recortan por los extremos, y no buscando el tramo fijo de izquierda a
     derecha: con «El vinculado es {vinc}.» el tramo de cierre es «.», y su primera aparición
     cae dentro del propio valor —«SHANDONG RUICHENG PETROLEUM EQUIPMENT CO.,LTD»—, así que
     buscarla truncaba el nombre en «…EQUIPMENT CO.» y perdía «,LTD». Exigirlos al principio
     y al final es además lo que confirma que estos dos párrafos son el mismo. */
  let original = String(textoOriginal || '');
  const prefijo = tramos[0].texto;
  const sufijo = tramos[tramos.length - 1].texto;
  if (prefijo) {
    if (!original.startsWith(prefijo)) return null;
    original = original.slice(prefijo.length);
  }
  if (sufijo) {
    if (!original.endsWith(sufijo)) return null;
    original = original.slice(0, original.length - sufijo.length);
  }

  const salida = [];
  let cursor = 0;
  /* Los tramos alternan fijo/campo empezando y acabando en fijo, así que los campos están
     en las posiciones impares y el fijo que cierra cada uno, en la siguiente. */
  for (let i = 1; i < tramos.length; i += 2) {
    const t = tramos[i];
    const cierre = tramos[i + 1];
    const esElUltimo = i + 1 === tramos.length - 1;
    let valor;
    if (esElUltimo) {
      /* Lo que quede: el sufijo ya se recortó por la derecha. */
      valor = original.slice(cursor);
      cursor = original.length;
    } else if (!cierre.texto) {
      /* Dos marcas pegadas, «{vinc}{pais_vinc}»: no hay forma de saber dónde acaba el valor
         de una y empieza el de la otra. No se restaura el párrafo. */
      return null;
    } else {
      const k = original.indexOf(cierre.texto, cursor);
      if (k < 0) return null;
      valor = original.slice(cursor, k);
      cursor = k + cierre.texto.length;
    }
    salida.push({ campo: t.campo, pos: t.pos, largo: t.largo, valor });
  }
  return salida;
}

/**
 * Devuelve a su texto original las marcas cuyos campos el estudio no trae.
 *
 * Lo que el estudio SÍ trae se queda como marca, para que el relleno lo sustituya como
 * siempre: esto no reemplaza al relleno, solo evita que un campo vacío borre lo que la
 * plantilla publicaba.
 *
 * @param {string} xmlMarcado    `word/document.xml` de la plantilla marcada.
 * @param {string} xmlOriginal   el mismo archivo del .docx SIN marcar.
 * @param {{sinDato:(campo:string)=>boolean, abrir?:string, cerrar?:string,
 *          excluir?:string[]}} opciones
 *        `sinDato`: si ese campo carece de valor en el estudio.
 *        `excluir`: campos que no se tocan — los de las colecciones que se repiten en un
 *        bucle (`nombre`, `ambito`, `letra`…), que no los resuelve el estudio sino la
 *        fila en curso.
 * @returns {{xml:string, restaurados:Array<{campo:string, valor:string}>,
 *           sinRespaldo:string[]}}
 */
export function restaurarCamposSinDato(xmlMarcado, xmlOriginal, opciones = {}) {
  const xml = String(xmlMarcado || '');
  const sinDato = opciones.sinDato || (() => false);
  const excluidos = new Set(opciones.excluir || []);
  const abrir = opciones.abrir || '{';
  const cerrar = opciones.cerrar || '}';
  /* Sin `#`, `/` ni `^`: las marcas de bucle y de condición no son campos. */
  const rx = new RegExp(
    escRx(abrir) + '([^' + escRx(cerrar) + '\\s#/^]+)' + escRx(cerrar), 'g');

  const restaurados = [];
  const sinRespaldo = new Set();
  const anotarSinRespaldo = (texto) => {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(texto)) !== null) {
      const campo = m[1].trim();
      if (!excluidos.has(campo) && sinDato(campo)) sinRespaldo.add(campo);
    }
  };

  if (!xmlOriginal) return { xml, restaurados, sinRespaldo: [] };

  const marc = textoPorParrafo(xml);
  const orig = textoPorParrafo(xmlOriginal);
  if (marc.length !== orig.length) {
    marc.forEach((p) => anotarSinRespaldo(p.texto));
    return { xml, restaurados, sinRespaldo: [...sinRespaldo] };
  }

  /* De atrás hacia adelante: reescribir un párrafo cambia el largo del XML y movería los
     offsets de los que van después. */
  let salida = xml;
  for (let i = marc.length - 1; i >= 0; i -= 1) {
    const p = marc[i];
    rx.lastIndex = 0;
    if (!rx.test(p.texto)) continue;

    const encontrados = valoresQueSustituyoElMarcado(p.texto, orig[i].texto, rx);
    if (!encontrados) {
      anotarSinRespaldo(p.texto);
      continue;
    }
    const aRestaurar = encontrados.filter(
      (v) => !excluidos.has(v.campo) && sinDato(v.campo) && String(v.valor).trim() !== ''
    );
    if (!aRestaurar.length) continue;

    const bloque = salida.slice(p.inicio, p.fin);
    const nuevo = sustituirRangosEnParrafo(
      bloque, aRestaurar.map((v) => ({ pos: v.pos, largo: v.largo, texto: v.valor })));
    salida = salida.slice(0, p.inicio) + nuevo + salida.slice(p.fin);
    aRestaurar.forEach((v) => restaurados.push({ campo: v.campo, valor: v.valor }));
  }

  return { xml: salida, restaurados, sinRespaldo: [...sinRespaldo] };
}

/**
 * El `<w:tbl>` que sigue INMEDIATAMENTE a `desde`, o -1 si lo que sigue es otra cosa.
 *
 * Entre el rótulo de una tabla y la tabla, Word deja huecos de maquetación: párrafos en
 * blanco, marcas de índice y avisos del corrector. Todo eso se salta. Cualquier otra cosa
 * —un párrafo con texto, otra sección— significa que ese párrafo no era el rótulo de esa
 * tabla, que es como la entrada del ÍNDICE se colaba haciéndose pasar por el rótulo.
 *
 * Es la misma idea que `saltarHuecosOoxml` en `docxRelleno.js`. Vive aquí duplicada a
 * propósito: importarla montaría un ciclo entre los dos módulos, y son quince líneas.
 *
 * @param {string} xml
 * @param {number} desde  offset donde acaba el párrafo del rótulo.
 * @returns {number} offset de apertura del `<w:tbl>`, o -1.
 */
export function tablaInmediataOoxml(xml, desde) {
  const fuente = String(xml || '');
  let cursor = Math.max(0, desde);
  for (;;) {
    const resto = fuente.slice(cursor);
    if (/^\s*<w:tbl[\s>]/.test(resto)) return cursor + resto.indexOf('<w:tbl');
    const hueco = /^\s*(?:<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?<\/w:p>|<w:bookmarkStart[^>]*\/?>|<w:bookmarkEnd[^>]*\/?>|<w:proofErr[^>]*\/?>)/.exec(resto);
    if (!hueco) return -1;
    /* Un párrafo con texto visible no es un hueco: ahí se acabó la búsqueda. */
    if (/<w:t[\s>]/.test(hueco[0]) && textoPorParrafo(hueco[0]).some((p) => p.texto.trim())) {
      return -1;
    }
    cursor += hueco[0].length;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   BUCLES QUE QUEDARON EN LA TABLA EQUIVOCADA.

   `envolverTablaEnBucle` anclaba en el primer párrafo que mencionara el nombre de la tabla,
   y en un informe eso es la entrada del ÍNDICE. En la plantilla de Shandong los dos bucles
   —comparables y razones de rechazo— acabaron envueltos en la Tabla 1, «Operación con
   vinculados económicos», que es la primera tabla del documento: su última fila pasó a ser
   la fila modelo, y el informe publicaba «A | Diferencias funcionales» donde iba «Ingreso
   intereses sobre presta (13) | 96.297.749». Reportado con capturas el 2026-08-24.

   El anclaje ya está corregido, pero eso no basta: el marcado se paga una vez por plantilla
   y se guarda (`docx-marcado:<id>`), así que las plantillas marcadas antes siguen llevando
   el bucle donde no va. Retirarlo al rellenar las repara sin volver a llamar a la IA y sin
   pedir el archivo otra vez.

   Retirar el bucle no deja la tabla sin llenar: «Muestra Compañías comparables» y «Razones
   de rechazo» las regenera `actualizarTablasOperacionesOoxml` localizándolas por su nombre,
   que es de donde salen bien. Y las marcas de campo que el bucle dejó dentro de la fila
   (`{letra}`, `{criterio}`…) las devuelve a su texto `restaurarCamposSinDato`, porque una vez
   sin bucle ya no son campos de una colección.
   ───────────────────────────────────────────────────────────────────────────── */

/* Cómo se compara el rótulo de una tabla con el nombre que se busca: en minúsculas, sin
   tildes y con los espacios colapsados. NUNCA por el número que lleve delante — «Tabla 14.»
   en Beumer, «Tabla 16.» en Tyazhmash, «Tabla 19.» en Grupo VDT y «Tabla 31.» en Shandong
   son la MISMA tabla, y hay plantillas que no la numeran—. Es la misma normalización que
   `claveTitulo` aplica en `docxRelleno.js`, aquí duplicada para no cruzar los dos módulos. */
const normalizarTitulo = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/** ¿El texto de este párrafo nombra la tabla que se busca? */
function nombraLaTabla(texto, ancla) {
  return normalizarTitulo(texto).includes(normalizarTitulo(ancla));
}

/** Los bucles que el marcado envuelve, con la tabla a la que pertenece cada uno. */
export const BUCLES_DE_TABLA = [
  { ancla: 'Compañías comparables', coleccion: 'comparables', campos: ['n', 'nombre', 'ambito'] },
  { ancla: 'Razones de rechazo', coleccion: 'razonesRechazo', campos: ['letra', 'criterio', 'cantidad'] },
];

/** El `<w:tbl>` que contiene `posicion`, como par de offsets, o null si no está en ninguna. */
function tablaQueContiene(xml, posicion) {
  const apertura = xml.lastIndexOf('<w:tbl>', posicion);
  if (apertura < 0) return null;
  /* Contando anidamiento: Word admite tablas dentro de una celda. */
  const rx = /<w:tbl>|<\/w:tbl>/g;
  rx.lastIndex = apertura;
  let nivel = 0;
  let m;
  while ((m = rx.exec(xml)) !== null) {
    nivel += m[0] === '<w:tbl>' ? 1 : -1;
    if (nivel === 0) {
      const fin = m.index + m[0].length;
      return fin > posicion ? { inicio: apertura, fin } : null;
    }
  }
  return null;
}

/**
 * Quita el bucle de una colección si quedó envuelto en una tabla que no es la suya.
 *
 * @param {string} xml  `word/document.xml` de la plantilla marcada.
 * @param {{ancla:string, coleccion:string}} config
 * @param {{abrir?:string, cerrar?:string}} [delimitadores]
 * @returns {{xml:string, retirado:boolean, motivo:string|null}}
 */
export function retirarBucleFueraDeSitio(xml, config, delimitadores = {}) {
  const fuente = String(xml || '');
  const { ancla, coleccion } = config || {};
  if (!ancla || !coleccion) return { xml: fuente, retirado: false, motivo: 'configuración incompleta' };

  const abrir = delimitadores.abrir || '{';
  const cerrar = delimitadores.cerrar || '}';
  const marcaApertura = abrir + '#' + coleccion + cerrar;
  const marcaCierre = abrir + '/' + coleccion + cerrar;

  const parrafos = textoPorParrafo(fuente);
  const conApertura = parrafos.find((p) => p.texto.includes(marcaApertura));
  if (!conApertura) return { xml: fuente, retirado: false, motivo: 'la plantilla no trae ese bucle' };

  /* Dónde debería estar: la primera tabla que siga INMEDIATAMENTE a un rótulo con el nombre. */
  let inicioCorrecta = -1;
  for (const p of parrafos) {
    if (!nombraLaTabla(p.texto, ancla)) continue;
    const i = tablaInmediataOoxml(fuente, p.fin);
    if (i >= 0) { inicioCorrecta = i; break; }
  }

  const dondeEsta = tablaQueContiene(fuente, conApertura.inicio);
  if (!dondeEsta) return { xml: fuente, retirado: false, motivo: 'el bucle no está dentro de una tabla' };
  /* Sin tabla correcta identificable no se toca nada: quitar el bucle a ciegas dejaría la
     colección sin publicar y el informe sin esas filas. */
  if (inicioCorrecta < 0) return { xml: fuente, retirado: false, motivo: 'no se pudo ubicar la tabla propia' };
  if (dondeEsta.inicio === inicioCorrecta) return { xml: fuente, retirado: false, motivo: null };

  /* Está en la tabla equivocada: se quitan sus dos marcas, de atrás hacia adelante para no
     mover los offsets de la primera. */
  let salida = fuente;
  const aQuitar = parrafos
    .filter((p) => p.texto.includes(marcaApertura) || p.texto.includes(marcaCierre))
    .sort((a, b) => b.inicio - a.inicio);

  for (const p of aQuitar) {
    const rangos = [];
    for (const marca of [marcaApertura, marcaCierre]) {
      let desde = 0;
      for (;;) {
        const k = p.texto.indexOf(marca, desde);
        if (k < 0) break;
        rangos.push({ pos: k, largo: marca.length, texto: '' });
        desde = k + marca.length;
      }
    }
    if (!rangos.length) continue;
    const bloque = salida.slice(p.inicio, p.fin);
    salida = salida.slice(0, p.inicio) + sustituirRangosEnParrafo(bloque, rangos) + salida.slice(p.fin);
  }

  return { xml: salida, retirado: true, motivo: 'estaba en otra tabla' };
}
