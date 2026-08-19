/* ─────────────────────────────────────────────────────────────────────────────
   prosaVecindad.js — el motor que pone en la prosa que comenta una tabla las cifras que
   esa tabla publica.

   POR QUÉ EXISTE. La prosa se anclaba en las palabras que introducen cada cifra, con una
   lista de patrones medidos contra una plantilla concreta. Todos exigían un paréntesis
   —«el percentil 25 (X)», «la mediana con (Z)»—, así que la plantilla del siguiente cliente,
   que escribe «…se ubica entre 10.925% percentil 25 y 17.258% percentil 75 y la mediana con
   15.356%», no encajaba en ninguno: el informe se radicaba ante la DIAN con las cifras del
   informe de referencia y la tabla justo encima diciendo otras. Añadir un patrón por cada
   redacción que aparezca es perder siempre por un cliente de diferencia.

   LA REGLA. Dentro del párrafo, cada rótulo se queda con la cifra más cercana que ningún otro
   rótulo reclama, esté delante o detrás y lleve paréntesis o no. Es lo que hace un lector: no
   memoriza redacciones, mira qué número tiene al lado la palabra «mediana».

   ANTES QUE LA VECINDAD, LAS ANCLAS. Los patrones medidos contra el informe real siguen
   corriendo primero y mandan sobre el emparejamiento. Cubren lo que la vecindad no puede
   cubrir sin ponerse en peligro: el indicador del contribuyente, cuyo «rótulo» sería «margen
   operacional» o «rentabilidad», que aparecen por todo el informe.

   Y CUANDO NO SE PUEDE DECIDIR, NO SE TOCA NADA. Si algún rótulo del párrafo se queda sin
   pareja, o si dos se disputan la misma cifra a la misma distancia, no se escribe ninguna de
   las cifras de esa pasada y se anota. Es la doctrina que ya rige en `docxRelleno.js`:
   publicar una cifra en el sitio equivocado es peor que dejar la de la plantilla, porque una
   cifra creíble en el lugar equivocado ya no se nota al revisar.

   UNA SOLA IMPLEMENTACIÓN PARA LAS DOS RUTAS. La plantilla puede ser un PDF —que se lee a
   HTML— o un .docx del cliente —cuyo OOXML se edita en el sitio—. Las dos son texto con
   etiquetas intercaladas, así que se trabaja sobre el texto visible y se guarda el mapa de
   vuelta. Sólo cambia cómo se delimita un párrafo.

   Este módulo NO sabe nada del dominio: recibe las cifras ya calculadas y ya formateadas.
   ───────────────────────────────────────────────────────────────────────────── */

/* Una cifra en tanto por ciento, con TODO lo que la compone. Es a propósito distinta del
   `RX_PCT` de las anclas (`-?\d+(?:[.,]\d+)?\s*%`, un solo grupo decimal): aquélla casa
   «234,567 %» dentro de «1.234,567 %», y sustituir ese tramo dejaría «1.2,327 %» en un
   documento que se radica. En las anclas eso no llega a pasar porque su prefijo fija dónde
   empieza la coincidencia; aquí se escanean cifras sueltas, así que el tramo tiene que ser o
   la cifra entera o nada. `(?:[.,]\d+)*` es codicioso, de modo que arranca en el primer
   dígito y se come cuantos grupos de separador haya. */
export const RX_CIFRA_PCT = /-?\d+(?:[.,]\d+)*\s*%/g;

/* Entre la palabra que ancla y su cifra puede haber etiquetas. En la ruta del PDF las pone el
   marcado con IA (`<span data-campo>`) y el resaltado de la vista previa; en la del .docx, el
   propio Word, que parte una frase en varios `<w:r><w:t>` por el corrector o por un cambio de
   formato. También el `<strong>` con que la plantilla resalta un conteo. Vive aquí, y no en cada
   módulo de vocabulario, porque tolerar etiquetas intercaladas es justo lo que este motor hace
   para servir a las dos rutas con una sola implementación. */
export const HUECO = '(?:<[^>]*>|\\s|&nbsp;)*';

/* Un párrafo por ruta. En HTML es `<p>`; en el OOXML de Word, `<w:p>`. Es lo único que cambia
   entre atender una plantilla PDF y una .docx del cliente. */
export const PARRAFO_HTML = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
export const PARRAFO_OOXML = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gi;

/* Cuánto texto puede haber entre un rótulo y su cifra. Medido sobre los conectores que usan
   los informes: « (»=2, « con (»=6, « es de »=7, « alcanza un valor de »=21. Con 24 se cubren
   todos y no se llega a saltar de una oración a la siguiente. */
const HUECO_MAXIMO = 24;

/* Una celda de tabla es «Percentil 25», o «Mediana 5,519 %» cuando el rótulo y la cifra
   comparten celda; la frase que comenta el rango no baja de veinticinco palabras. Es lo que
   impide que el emparejamiento reescriba la tabla por segunda vez y por otra vía. */
const MIN_PALABRAS = 10;

/* El lector de PDF puede entregar una página entera como un solo `<p>` cuando el árbol
   etiquetado no rinde texto (`pdfReferenceExtractor.js`). Eso no es una frase: dentro hay
   tablas aplanadas, y emparejar por cercanía ahí no significa nada. */
const LARGO_MAXIMO = 1500;

/* Nueve porcentajes en un párrafo son una tabla o una enumeración, no una frase. */
const MAX_CIFRAS = 8;

/* Puntuación que corta el paso entre un rótulo y una cifra: cruzarla es cambiar de idea. El
   punto sólo cuenta si va seguido de espacio, o «10.925» sería tres barreras. */
const RX_PUNTUACION_FUERTE = /[;:]|\.\s/;

/* Lo que separa dos miembros de una enumeración. No es barrera —«(X) y (Y) percentil 75» es
   una redacción real y ahí la «y» está en medio del par bueno—, pero sí liga menos que un
   conector: en «la mediana con 1.234,567 % y el percentil 75 con 2.000,111 %» la « y » que
   separa la cifra de la mediana del percentil 75 es más corta que el « con » que la une a su
   propio rótulo, y por distancia sola el percentil 75 se llevaba la cifra de la mediana. Un
   par que cruza un separador se considera peor que cualquiera que no lo cruce, sea cual sea
   la distancia. */
const RX_SEPARADOR_CLAUSULA = /(?:^|[\s(])(?:y|e|o|u)(?=[\s)]|$)|,/i;

/* Cruzar un separador cuesta más que cualquier hueco admisible, así que ordena por delante de
   la distancia sin necesidad de un segundo criterio de comparación. */
const COSTE_SEPARADOR = 1000;

/* Elementos cuyo texto no se ve en el documento. `w:delText` es texto BORRADO con control de
   cambios: si la plantilla del cliente llega con marcas de revisión, sus cifras viejas no
   están en el documento que nadie lee, y contarlas nos haría emparejar contra lo que el
   revisor no ve. `w:instrText` son instrucciones de campo (índices, referencias cruzadas). */
const SIN_TEXTO_VISIBLE = new Set(['w:delText', 'w:instrText', 'script', 'style']);

const ENTIDADES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'',
};

function caracterDeEntidad(cuerpo) {
  if (Object.prototype.hasOwnProperty.call(ENTIDADES, cuerpo)) return ENTIDADES[cuerpo];
  if (/^#\d+$/.test(cuerpo)) return String.fromCodePoint(Number(cuerpo.slice(1)));
  if (/^#x[0-9a-f]+$/i.test(cuerpo)) return String.fromCodePoint(parseInt(cuerpo.slice(2), 16));
  /* Una entidad que no se reconoce se deja pasar como su primer carácter para no descuadrar el
     mapa: lo que importa es que cada posición del plano tenga su tramo en el original. */
  return '&';
}

function nombreDeEtiqueta(src, inicio) {
  let i = inicio + 1;
  if (src[i] === '/') i += 1;
  let fin = i;
  while (fin < src.length && !/[\s/>]/.test(src[fin])) fin += 1;
  return src.slice(i, fin);
}

/**
 * El texto visible de un fragmento con etiquetas, y el tramo del original que produjo cada
 * carácter.
 *
 * Un tramo POR CARÁCTER y no un desplazamiento global: una entidad (`&nbsp;`, `&amp;`) ocupa
 * un carácter visible y seis del original, así que la correspondencia no es uno a uno y sumar
 * longitudes se desalinea a la primera. Con el tramo de cada carácter, sustituir un rango del
 * plano es exacto en las dos rutas.
 *
 * @param {string} fragmento  un párrafo de HTML (`<p>…</p>`) o de OOXML (`<w:p>…</w:p>`).
 * @returns {{plano: string, desde: Int32Array, hasta: Int32Array}}
 */
export function textoVisibleConMapa(fragmento) {
  const src = String(fragmento || '');
  const chars = [];
  const desde = [];
  const hasta = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (c === '<') {
      const cierre = src.indexOf('>', i);
      /* Una etiqueta sin cerrar: lo que queda no es texto que nadie vea. */
      if (cierre === -1) break;
      const nombre = nombreDeEtiqueta(src, i);
      const autocerrada = src[cierre - 1] === '/';
      if (!autocerrada && src[i + 1] !== '/' && SIN_TEXTO_VISIBLE.has(nombre)) {
        const marca = '</' + nombre;
        const donde = src.indexOf(marca, cierre + 1);
        if (donde === -1) break;
        const finCierre = src.indexOf('>', donde);
        i = finCierre === -1 ? src.length : finCierre + 1;
        continue;
      }
      i = cierre + 1;
      continue;
    }

    if (c === '&') {
      const pyc = src.indexOf(';', i);
      if (pyc !== -1 && pyc - i <= 10) {
        chars.push(caracterDeEntidad(src.slice(i + 1, pyc)));
        desde.push(i);
        hasta.push(pyc + 1);
        i = pyc + 1;
        continue;
      }
    }

    chars.push(c);
    desde.push(i);
    hasta.push(i + 1);
    i += 1;
  }

  return { plano: chars.join(''), desde: Int32Array.from(desde), hasta: Int32Array.from(hasta) };
}

/* Los tramos del original que corresponden a `[inicio, fin)` del plano, fundiendo los que van
   seguidos. Donde el original mete una etiqueta por el medio —Word parte una frase en varios
   `<w:r><w:t>` por el corrector o por un cambio de formato— sale un tramo nuevo. */
function tramosDelPlano(mapa, inicio, fin) {
  const tramos = [];
  for (let j = inicio; j < fin && j < mapa.desde.length; j += 1) {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.fin === mapa.desde[j]) ultimo.fin = mapa.hasta[j];
    else tramos.push({ inicio: mapa.desde[j], fin: mapa.hasta[j] });
  }
  return tramos;
}

/**
 * Aplica sobre el fragmento original unas sustituciones dadas en coordenadas del texto visible.
 *
 * Si el tramo está partido en varios `<w:t>`, el texto nuevo se escribe ENTERO en el primero y
 * los demás quedan vacíos, sin tocar una sola etiqueta. Es el mismo idioma de `redistribuir`
 * (`docxPlantilla.js`), y es lo que impide que cambie el número de runs o que se pierda un
 * `xml:space`: borrar un run se llevaría por delante su `<w:rPr>` y con él el formato de lo que
 * venga después.
 *
 * @param {string} fragmento
 * @param {{desde: Int32Array, hasta: Int32Array}} mapa
 * @param {Array<{inicio: number, fin: number, texto: string}>} escrituras  en coordenadas del plano.
 * @returns {string}
 */
export function escribirEnTextoVisible(fragmento, mapa, escrituras) {
  /* De atrás hacia adelante: cada corte desplaza los offsets de todo lo que va antes. */
  const lista = (escrituras || []).slice().sort((a, b) => b.inicio - a.inicio);
  let salida = String(fragmento || '');

  for (const e of lista) {
    if (!(e.fin > e.inicio)) continue;
    const tramos = tramosDelPlano(mapa, e.inicio, e.fin);
    if (!tramos.length) continue;
    for (let k = tramos.length - 1; k >= 1; k -= 1) {
      salida = salida.slice(0, tramos[k].inicio) + salida.slice(tramos[k].fin);
    }
    salida = salida.slice(0, tramos[0].inicio) + e.texto + salida.slice(tramos[0].fin);
  }

  return salida;
}

/* Un regex igual pero con los flags que hagan falta. Se cachea por instancia para no
   recompilarlo en cada párrafo de un documento de trescientas páginas; como las copias con `g`
   arrastran `lastIndex`, quien las use lo pone a cero antes. */
const cacheDeFlags = new WeakMap();
function conFlags(rx, extra) {
  let porRegex = cacheDeFlags.get(rx);
  if (!porRegex) { porRegex = new Map(); cacheDeFlags.set(rx, porRegex); }
  const hecha = porRegex.get(extra);
  if (hecha) return hecha;
  let flags = rx.flags;
  for (const f of extra) if (!flags.includes(f)) flags += f;
  const nueva = new RegExp(rx.source, flags);
  porRegex.set(extra, nueva);
  return nueva;
}

function estaVetada(plano, inicio, fin, vetos) {
  for (const veto of vetos || []) {
    if (veto.despues && veto.despues.test(plano.slice(fin))) return true;
    if (veto.antes && veto.antes.test(plano.slice(0, inicio))) return true;
  }
  return false;
}

/**
 * Las cifras del párrafo, con el tramo que ocupa cada una y si está vetada.
 *
 * Una cifra vetada no se puede asignar a ningún rótulo, pero SIGUE contando como barrera: en
 * «…se eliminó el 25 % superior e inferior de las observaciones, de modo que la mediana…», ese
 * 25 % no es el indicador de nadie, y además es lo que impide que un rótulo de más allá salte
 * por encima de él a buscarse una cifra.
 *
 * @param {string} plano
 * @param {RegExp} [rxCifra]  por defecto `RX_CIFRA_PCT`.
 * @param {Array<{antes?: RegExp, despues?: RegExp}>} [vetos]
 * @returns {Array<{inicio: number, fin: number, texto: string, vetada: boolean}>}
 */
export function cifrasDe(plano, rxCifra = RX_CIFRA_PCT, vetos = []) {
  const rx = conFlags(rxCifra, 'g');
  rx.lastIndex = 0;
  const fuera = [];
  let m = rx.exec(plano);
  while (m !== null) {
    if (m[0] === '') rx.lastIndex += 1;
    else {
      const inicio = m.index;
      const fin = inicio + m[0].length;
      fuera.push({ inicio, fin, texto: m[0], vetada: estaVetada(plano, inicio, fin, vetos) });
    }
    m = rx.exec(plano);
  }
  return fuera;
}

/**
 * Las apariciones de cada rótulo en el párrafo, en orden.
 *
 * @param {string} plano
 * @param {Array<{clave: string, rx: RegExp}>} rotulos
 * @returns {Array<{clave: string, inicio: number, fin: number}>}
 */
export function rotulosDe(plano, rotulos) {
  const fuera = [];
  for (const r of rotulos || []) {
    const rx = conFlags(r.rx, 'g');
    rx.lastIndex = 0;
    let m = rx.exec(plano);
    while (m !== null) {
      if (m[0] === '') rx.lastIndex += 1;
      else fuera.push({ clave: r.clave, inicio: m.index, fin: m.index + m[0].length });
      m = rx.exec(plano);
    }
  }
  return fuera.sort((a, b) => a.inicio - b.inicio);
}

const señaDe = (t) => t.inicio + ':' + t.fin;

function hayBarrera(plano, desde, hasta, rotulos, cifras, rotulo, cifra) {
  if (hasta <= desde) return false;
  if (RX_PUNTUACION_FUERTE.test(plano.slice(desde, hasta))) return true;
  for (const r of rotulos) {
    if (r === rotulo) continue;
    if (r.inicio < hasta && r.fin > desde) return true;
  }
  for (const c of cifras) {
    if (c === cifra) continue;
    if (c.inicio < hasta && c.fin > desde) return true;
  }
  return false;
}

/**
 * Empareja cada rótulo con la cifra que tiene al lado.
 *
 * @param {string} plano
 * @param {Array<{clave: string, inicio: number, fin: number}>} rotulos
 * @param {Array<{inicio: number, fin: number, vetada: boolean}>} cifras
 * @param {{huecoMaximo?: number}} [limites]
 * @returns {{pares: Array, ambiguas: Array<string>, sinPareja: Array<string>}}
 */
export function emparejarPorVecindad(plano, rotulos, cifras, limites = {}) {
  const huecoMaximo = limites.huecoMaximo ?? HUECO_MAXIMO;
  const posibles = [];

  for (const rotulo of rotulos) {
    for (const cifra of cifras) {
      if (cifra.vetada) continue;
      const delante = cifra.fin <= rotulo.inicio;
      const detras = cifra.inicio >= rotulo.fin;
      /* Se solapan: el rótulo lleva un número dentro («percentil 25») y no es su cifra. */
      if (!delante && !detras) continue;
      const desde = delante ? cifra.fin : rotulo.fin;
      const hasta = delante ? rotulo.inicio : cifra.inicio;
      const hueco = hasta - desde;
      if (hueco > huecoMaximo) continue;
      if (hayBarrera(plano, desde, hasta, rotulos, cifras, rotulo, cifra)) continue;
      const separado = RX_SEPARADOR_CLAUSULA.test(plano.slice(desde, hasta));
      const coste = hueco + (separado ? COSTE_SEPARADOR : 0);
      posibles.push({ clave: rotulo.clave, rotulo, cifra, hueco, separado, coste });
    }
  }

  /* Por coste; a igualdad, la cifra que aparece antes en el párrafo y luego el rótulo que
     aparece antes. Recorrer así y tomar el primero que quepa equivale a «vecino mutuo más
     cercano», sin necesidad de resolver un emparejamiento completo. */
  posibles.sort((a, b) => a.coste - b.coste
    || a.cifra.inicio - b.cifra.inicio
    || a.rotulo.inicio - b.rotulo.inicio);

  /* Empate exacto = nadie se lleva nada. Si una cifra queda a la misma distancia de dos rótulos
     distintos («percentil 25 6.418 % percentil 75»), o un rótulo a la misma distancia de dos
     cifras, elegir es tirar una moneda, y una cifra creíble en el sitio de otra ya no se nota. */
  const ambiguas = [];
  const cifrasAmbiguas = new Set();
  const rotulosAmbiguos = new Set();

  for (const grupo of agrupar(posibles, (p) => señaDe(p.cifra))) {
    const minimo = Math.min(...grupo.map((p) => p.coste));
    const mejores = grupo.filter((p) => p.coste === minimo);
    if (new Set(mejores.map((p) => p.clave)).size > 1) {
      cifrasAmbiguas.add(señaDe(grupo[0].cifra));
      for (const p of mejores) if (!ambiguas.includes(p.clave)) ambiguas.push(p.clave);
    }
  }
  for (const grupo of agrupar(posibles, (p) => señaDe(p.rotulo))) {
    const minimo = Math.min(...grupo.map((p) => p.coste));
    const mejores = grupo.filter((p) => p.coste === minimo);
    if (new Set(mejores.map((p) => señaDe(p.cifra))).size > 1) {
      rotulosAmbiguos.add(señaDe(grupo[0].rotulo));
      if (!ambiguas.includes(grupo[0].clave)) ambiguas.push(grupo[0].clave);
    }
  }

  const clavesUsadas = new Set();
  const cifrasUsadas = new Set();
  const pares = [];
  for (const p of posibles) {
    if (cifrasAmbiguas.has(señaDe(p.cifra)) || rotulosAmbiguos.has(señaDe(p.rotulo))) continue;
    if (clavesUsadas.has(p.clave) || cifrasUsadas.has(señaDe(p.cifra))) continue;
    clavesUsadas.add(p.clave);
    cifrasUsadas.add(señaDe(p.cifra));
    pares.push(p);
  }

  const sinPareja = [];
  for (const r of rotulos) {
    if (!clavesUsadas.has(r.clave) && !sinPareja.includes(r.clave)) sinPareja.push(r.clave);
  }

  return { pares, ambiguas, sinPareja };
}

function agrupar(lista, clave) {
  const mapa = new Map();
  for (const x of lista) {
    const k = clave(x);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(x);
  }
  return [...mapa.values()];
}

/* Nunca se escribe algo que no sea una cifra. `pctf` devuelve «—» cuando el valor no es
   finito, y poner un guion donde la plantilla tenía un número es peor que dejar el número: el
   hueco visible es para los campos del vocabulario, no para una frase de prosa. */
const esEscribible = (v) => typeof v === 'string' && /\d/.test(v);

const solapa = (escrituras, inicio, fin) => escrituras.some(
  (e) => e.inicio < fin && e.fin > inicio,
);

/**
 * Pone en la prosa que comenta una tabla las cifras que la tabla publica.
 *
 * NO REESCRIBE LA REDACCIÓN: sólo sustituye tramos de cifra, y las sustituciones que se le
 * pasen aparte (el año). Si el emparejamiento queda incompleto o ambiguo, no toca nada y lo
 * anota.
 *
 * @param {string} texto  HTML de la plantilla, u OOXML de `word/document.xml`.
 * @param {object} opciones
 * @param {RegExp} opciones.rxParrafo  cómo se delimita un párrafo en esta ruta.
 * @param {RegExp} [opciones.reconocedor]  qué párrafos son la prosa de esta tabla.
 * @param {Array<{clave: string, rx: RegExp}>} [opciones.rotulos]  vacío desactiva la vecindad.
 * @param {Object<string, string|null>} [opciones.valores]  clave → cifra YA formateada.
 * @param {Array<{clave: string, rx: RegExp, grupoCifra: number}>} [opciones.anclas]  primera
 *        pasada, en el orden en que se prueban; manda sobre la vecindad.
 * @param {RegExp} [opciones.rxCifra]  por defecto `RX_CIFRA_PCT`.
 * @param {Array<{antes?: RegExp, despues?: RegExp}>} [opciones.vetosCifra]
 * @param {Array<{clave: string, rx: RegExp, grupo?: number, valor: string, soloConCifras?: boolean}>}
 *        [opciones.sustituciones]  lo que no es una cifra de la tabla: el año, una fecha.
 * @param {{huecoMaximo?: number, minPalabras?: number, largoMaximo?: number, maxCifras?: number}}
 *        [opciones.limites]
 * @param {string[]} [opciones.avisos]
 * @param {object} [opciones.reporte]  se rellena con el recuento, para decidir respaldos.
 * @returns {string} el texto con la prosa actualizada donde se pudo.
 */
export function sincronizarCifrasDeProsa(texto, opciones = {}) {
  const {
    rxParrafo, reconocedor, rotulos = [], valores = {}, anclas = [],
    rxCifra = RX_CIFRA_PCT, vetosCifra = [], sustituciones = [],
    limites = {}, avisos, reporte,
  } = opciones;

  const minPalabras = limites.minPalabras ?? MIN_PALABRAS;
  const largoMaximo = limites.largoMaximo ?? LARGO_MAXIMO;
  const maxCifras = limites.maxCifras ?? MAX_CIFRAS;

  const rep = {
    parrafosReconocidos: 0,
    parrafosTocados: 0,
    cifrasPuestas: 0,
    sinResolver: [],
    ambiguas: [],
    sustituidas: new Set(),
  };

  /* `rxParrafo` es global y se comparte entre módulos, así que su `lastIndex` tiene que quedar
     a cero o la segunda llamada empezaría a medio documento. */
  rxParrafo.lastIndex = 0;

  const salida = String(texto || '').replace(rxParrafo, (parrafo) => {
    /* El prefiltro va sobre el crudo y no sobre el texto visible: tokenizar cada párrafo de un
       documento entero para descartar el 99 % es tiempo tirado, y la vista previa se
       re-renderiza a cada cambio del estudio. */
    if (reconocedor && !reconocedor.test(parrafo)) return parrafo;
    rep.parrafosReconocidos += 1;

    const mapa = textoVisibleConMapa(parrafo);
    const plano = mapa.plano;
    const escrituras = [];
    const resueltas = new Set();
    let cifrasAqui = 0;

    /* ── primera pasada: las anclas medidas contra el informe real ── */
    for (const ancla of anclas) {
      const valor = valores[ancla.clave];
      if (!esEscribible(valor) || resueltas.has(ancla.clave)) continue;
      const rx = conFlags(ancla.rx, 'd');
      rx.lastIndex = 0;
      const m = rx.exec(plano);
      const tramo = m && m.indices && m.indices[ancla.grupoCifra];
      if (!tramo) continue;
      if (solapa(escrituras, tramo[0], tramo[1])) continue;
      escrituras.push({ inicio: tramo[0], fin: tramo[1], texto: valor });
      resueltas.add(ancla.clave);
      cifrasAqui += 1;
    }

    /* ── segunda pasada: la cifra que cada rótulo tiene al lado ── */
    const palabras = plano.trim() ? plano.trim().split(/\s+/).length : 0;
    if (rotulos.length && palabras >= minPalabras && plano.length <= largoMaximo) {
      const cifras = cifrasDe(plano, rxCifra, vetosCifra)
        .filter((c) => !solapa(escrituras, c.inicio, c.fin));
      const disponibles = cifras.filter((c) => !c.vetada).length;
      if (cifras.length <= maxCifras && disponibles) {
        const presentes = rotulosDe(plano, rotulos)
          .filter((r) => !resueltas.has(r.clave) && esEscribible(valores[r.clave]));
        if (presentes.length) {
          const { pares, ambiguas, sinPareja } = emparejarPorVecindad(
            plano, presentes, cifras, limites,
          );
          if (sinPareja.length) {
            /* Todo o nada. Sobre «el percentil 25 y el percentil 75 son 10.925 % y 17.258 %»
               nada impide que el percentil 75 se lleve la cifra del 25 —entre los dos sólo hay
               « son »—, y colocada ahí ya nadie la distingue de la buena. Que un rótulo se
               quede sin pareja es la señal de que la redacción no lista cifra por rótulo. */
            for (const clave of sinPareja) {
              if (!rep.sinResolver.includes(clave)) rep.sinResolver.push(clave);
            }
            for (const clave of ambiguas) {
              if (!rep.ambiguas.includes(clave)) rep.ambiguas.push(clave);
            }
          } else {
            for (const p of pares) {
              escrituras.push({ inicio: p.cifra.inicio, fin: p.cifra.fin, texto: valores[p.clave] });
              resueltas.add(p.clave);
              cifrasAqui += 1;
            }
          }
        }
      }
    }

    /* ── lo que no es una cifra de la tabla ── */
    for (const s of sustituciones) {
      if (!esEscribible(s.valor)) continue;
      if (s.soloConCifras && !cifrasAqui) continue;
      const rx = conFlags(s.rx, 'gd');
      rx.lastIndex = 0;
      let m = rx.exec(plano);
      while (m !== null) {
        if (m[0] === '') { rx.lastIndex += 1; m = rx.exec(plano); continue; }
        const tramo = m.indices && m.indices[s.grupo ?? 2];
        if (tramo && !solapa(escrituras, tramo[0], tramo[1])) {
          rep.sustituidas.add(s.clave);
          /* Si ya dice lo que tiene que decir, se da por puesta y no se escribe: así la
             segunda pasada sobre la propia salida no mueve un solo byte. */
          if (plano.slice(tramo[0], tramo[1]) !== s.valor) {
            escrituras.push({ inicio: tramo[0], fin: tramo[1], texto: s.valor });
          }
        }
        m = rx.exec(plano);
      }
    }

    if (!escrituras.length) return parrafo;
    rep.parrafosTocados += 1;
    rep.cifrasPuestas += cifrasAqui;
    return escribirEnTextoVisible(parrafo, mapa, escrituras);
  });

  if (Array.isArray(avisos) && opciones.mensajes) {
    for (const mensaje of mensajesDe(rep, opciones.mensajes)) avisos.push(mensaje);
  }
  if (reporte) Object.assign(reporte, rep);

  return salida;
}

function mensajesDe(rep, mensajes) {
  const fuera = [];
  if (!rep.parrafosReconocidos) {
    if (mensajes.sinFrase) fuera.push(mensajes.sinFrase);
    return fuera;
  }
  if (!rep.cifrasPuestas && mensajes.sinCifras) fuera.push(mensajes.sinCifras);
  if (rep.sinResolver.length && mensajes.sinResolver) {
    fuera.push(mensajes.sinResolver(rep.sinResolver, rep.ambiguas));
  }
  return fuera;
}
