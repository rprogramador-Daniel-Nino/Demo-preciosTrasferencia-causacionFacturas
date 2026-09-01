/* ─────────────────────────────────────────────────────────────────────────────
   eeffColumnas.js — de qué ejercicio y de qué fila es cada cifra del estado financiero.

   POR QUÉ EXISTE. Todo estado financiero que llega al estudio es COMPARATIVO: imprime el
   ejercicio y el anterior en dos columnas contiguas. Medido sobre seis documentos reales
   del usuario (Robertet, Inoxpa, Inmotion, PFI, HH Colombia, Aluminios y Vidrios), los seis
   lo son, en los seis el encabezado de años vive en su propia línea —lejos de los datos— y
   cada uno maqueta sus filas distinto:

     PFI        «rótulo | nota | 2025 | 2024», y sin nota solo tres celdas
     HH         igual, con los valores vacíos impresos como «-» y las cifras en miles
     Inmotion   «rótulo | $ | 2025 | $ | 2024»: el signo de pesos ocupa celda propia

   Es decir: el valor del ejercicio buscado está en la celda 2, en la 1 o en la 2 según la
   fila y según el documento. `agruparEnLineas` (eeffTextoPdf.js) colapsa la posición
   horizontal en separadores « | », así que lo que le llega al modelo no dice qué columna es
   qué año y tiene que inferirlo. De ahí las cifras tomadas del ejercicio anterior, de la
   columna de notas o de la fila vecina.

   La información para resolverlo SÍ está en el PDF: las columnas están físicamente
   alineadas. Este módulo la conserva en lugar de tirarla, y con ella hace dos cosas:

     1. anotar el texto que va al prompt, para que el modelo deje de inferir;
     2. permitirle a `eeffVerificacion.js` comprobar que una cifra está en la fila de su
        rótulo Y en la columna del año pedido — lo que `cifraApareceEnTexto` no puede hacer,
        porque solo pregunta si la cifra está impresa en ALGÚN sitio del documento y una
        cifra tomada de la fila vecina la pasa intacta.

   SE COMPARA EL BORDE DERECHO Y NO EL IZQUIERDO. Las cifras van alineadas a la derecha, así
   que «3,532,784,816» y «-» comparten borde derecho y no tienen nada que ver por el
   izquierdo. Alinear por la izquierda fallaría justo en las filas con un valor vacío, que
   son las que más confunden al modelo hoy: en HH Colombia, «Intangible | 8 | - | 4.146» es
   una fila cuyo valor del ejercicio es vacío y cuyo 4.146 es del anterior.

   VA APARTE DE `eeffTextoPdf.js` a propósito: ese módulo responde «qué dice el documento» y
   este «dónde lo dice». Se le importan los tres criterios que no pueden divergir —la
   tolerancia de línea, el umbral de celda y la lectura de un literal numérico— en lugar de
   repetirlos.
   ───────────────────────────────────────────────────────────────────────────── */

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  TOLERANCIA_LINEA, FACTOR_MISMA_CELDA, interpretaciones,
} from './eeffTextoPdf.js';
/* La misma normalización del diccionario de vocabulario: sin tildes, en minúscula y con los
   espacios colapsados. Se importa en vez de repetirla porque es el mismo criterio, y dos
   copias del mismo criterio acaban divergiendo. */
import { normalizarPalabra } from './vocabularioEeff.js';

/** Una celda cuyo texto es EXACTAMENTE un año de cuatro dígitos. */
const RX_ANIO_CELDA = /^(19|20)\d{2}$/;

/**
 * Las filas de una página con la posición de cada celda, sin colapsar a cadena.
 *
 * Es `agruparEnLineas` sin su último paso. Se escribe aquí en vez de cambiarla porque
 * `extraerTextoPdf` y sus pruebas dependen de que siga devolviendo exactamente lo mismo.
 *
 * @returns {Array<{y:number, celdas:Array<{x:number, derecha:number, texto:string}>}>}
 */
export function filasConColumnas(items, tolerancia = TOLERANCIA_LINEA) {
  const filas = [];
  (items || []).forEach((it) => {
    if (!it || !it.str || !it.str.trim()) return;
    const trozo = {
      x: it.transform[4],
      texto: it.str,
      ancho: Number.isFinite(it.width) ? it.width : 0,
      alto: Number.isFinite(it.height) ? it.height : 0,
    };
    const y = Math.round(it.transform[5]);
    const existente = filas.find((f) => Math.abs(f.y - y) <= tolerancia);
    if (existente) existente.trozos.push(trozo);
    else filas.push({ y, trozos: [trozo] });
  });

  return filas
    .sort((a, b) => b.y - a.y)
    .map((f) => ({ y: f.y, celdas: celdasDeTrozos(f.trozos) }))
    .filter((f) => f.celdas.length > 0);
}

/* Parte los trozos de una fila en celdas con el MISMO umbral que `unirTrozos`: dos trozos
   separados por menos de FACTOR_MISMA_CELDA veces el alto de la fuente son la misma celda.
   Sin esto «2025» saldría partido en «202» y «5», y «21.850» en dos cifras que no existen. */
function celdasDeTrozos(trozos) {
  const enOrden = [...trozos].sort((a, b) => a.x - b.x);
  const celdas = [];
  let actual = null;
  let previo = null;

  enOrden.forEach((t) => {
    const texto = t.texto.trim();
    if (!texto) { previo = t; return; }
    if (actual === null) {
      actual = { x: t.x, derecha: t.x + t.ancho, texto };
      previo = t;
      return;
    }
    const hueco = t.x - (previo.x + previo.ancho);
    const umbral = FACTOR_MISMA_CELDA * (t.alto || previo.alto || 0);
    if (hueco < umbral) {
      actual.texto += texto;
      actual.derecha = t.x + t.ancho;
    } else {
      celdas.push(actual);
      actual = { x: t.x, derecha: t.x + t.ancho, texto };
    }
    previo = t;
  });
  if (actual) celdas.push(actual);

  return celdas.map((c) => ({ ...c, texto: c.texto.replace(/[ \t]+/g, ' ').trim() }));
}

/**
 * El encabezado que declara los ejercicios de un estado comparativo, con la posición de
 * cada año y la tolerancia con la que se le puede atribuir una cifra.
 *
 * Se exigen AL MENOS DOS años en la fila, y que ninguna OTRA celda de esa fila tenga forma de
 * cifra. Lo primero descarta el año suelto de un título. Lo segundo descarta una frase como
 * «POR LOS AÑOS TERMINADOS AL 31 DE DICIEMBRE 2025 Y 2024» cuando el maquetado la parte en
 * celdas: ahí aparece «31» como celda propia y la delata.
 *
 * NO se exige que los años sean la mitad o más de las celdas, y esa guarda —que sí estuvo
 * aquí— costó un caso real: el estado de resultados de Llantas Emotion (2026-08-31) encabeza
 * con `Notas | 2025 | 2024 | VARIACION | %`, dos años de cinco celdas, así que se rechazaba y
 * la página entera quedaba sin columnas. Un encabezado de verdad puede traer tantas columnas
 * de contexto como quiera; la proporción no dice nada sobre si es un encabezado.
 *
 * LO QUE SÍ LO DICE ES LA PROPIA GEOMETRÍA. Un encabezado real tiene cifras alineadas debajo
 * de sus años; un título con dos años sueltos no. Por eso cada candidata se PRUEBA contra las
 * filas que vienen después: se cuenta cuántas celdas con forma de cifra caen dentro de su
 * tolerancia, y gana la que más explica. Es una comprobación contra el documento, no una
 * heurística sobre el texto, y es lo que permite aflojar la guarda anterior sin volver a
 * arriesgar que un título corra todas las columnas.
 *
 * La tolerancia no es un número fijo: sale de la mitad de la distancia entre dos columnas
 * contiguas del propio documento. Así se calibra sola —una hoja apretada y una holgada no
 * necesitan el mismo margen— y, sobre todo, deja fuera la columna de notas, que en PFI está
 * a más de cien puntos de la primera columna de cifras.
 *
 * @returns {{y:number, columnas:Array<{anio:string, derecha:number}>, tolerancia:number}|null}
 */
export function encabezadoDeAnios(filas) {
  const lista = filas || [];
  let mejor = null;

  for (let i = 0; i < lista.length; i += 1) {
    const candidata = encabezadoDeFila(lista[i]);
    if (!candidata) continue;
    /* Cuántas cifras de las filas siguientes explica esta candidata. El encabezado va arriba
       de sus datos, así que solo cuentan las de abajo. */
    const respaldo = cifrasExplicadas(lista.slice(i + 1), candidata);
    if (!mejor || respaldo > mejor.respaldo) mejor = { candidata, respaldo };
  }

  if (!mejor) return null;
  /* Sin ninguna cifra alineada debajo no hay nada que sostenga que esto es un encabezado de
     columnas: puede ser un título, un pie de página o una referencia en prosa. Anotar con él
     correría TODAS las columnas del documento, que es peor que no anotar nada. */
  if (mejor.respaldo < MINIMO_CIFRAS_QUE_RESPALDAN) return null;
  return mejor.candidata;
}

/* Cuántas cifras hacen falta debajo para creerle a un encabezado. Dos: una sola podría caer
   por casualidad cerca de un año de un título, dos alineadas en columnas distintas ya no. */
const MINIMO_CIFRAS_QUE_RESPALDAN = 2;

/** La fila leída COMO encabezado, o `null` si no puede serlo. Sin mirar el resto del documento. */
function encabezadoDeFila(fila) {
  const celdas = (fila && fila.celdas) || [];
  const anios = [];
  let otraCifra = false;
  celdas.forEach((c) => {
    if (RX_ANIO_CELDA.test(c.texto)) anios.push({ anio: c.texto, derecha: c.derecha });
    else if (esCeldaDeCifra(c.texto)) otraCifra = true;
  });
  if (anios.length < 2) return null;
  /* Una celda con forma de cifra que no es un año delata una fila de datos o una frase con un
     día del mes suelto («AL 31 DE DICIEMBRE 2025 Y 2024»). */
  if (otraCifra) return null;

  const ordenadas = [...anios].sort((a, b) => a.derecha - b.derecha);
  let hueco = Infinity;
  for (let i = 1; i < ordenadas.length; i += 1) {
    hueco = Math.min(hueco, ordenadas[i].derecha - ordenadas[i - 1].derecha);
  }
  /* Hueco nulo o negativo: dos años en la misma posición. No se puede distinguir la columna,
     y afirmar cualquiera sería inventar. */
  if (!Number.isFinite(hueco) || hueco <= 0) return null;

  return { y: fila.y, columnas: ordenadas, tolerancia: hueco / 2 };
}

/* Cuántas celdas con forma de cifra de estas filas caen en alguna columna del encabezado
   candidato. Se cuentan por columna distinta y no en bruto, para que una fila con cinco
   números pegados a un mismo año no infle el respaldo. */
function cifrasExplicadas(filas, encabezado) {
  const porColumna = new Set();
  let total = 0;
  (filas || []).forEach((fila) => {
    const anios = asignarAnios(fila, encabezado);
    anios.forEach((anio) => { porColumna.add(anio); total += 1; });
  });
  /* Exige que se expliquen cifras en AL MENOS DOS columnas distintas: un título cuyo primer
     año caiga por azar cerca de una columna de cifras no llega a dos. */
  return porColumna.size >= 2 ? total : 0;
}

/* Una celda con FORMA de cifra: dígitos con sus separadores, con signo o entre paréntesis,
   y nada más. O el guion con que los estados imprimen un rubro que el ejercicio no reporta.

   Hace falta ser estricto aquí y no basta con preguntarle a `num()`: ese conversor está
   hecho para rescatar la cifra que escribe un analista, así que descarta todo lo que no sea
   dígito y devuelve un número igualmente. «Comparativo 31 de Diciembre de 2025 y 2024» le
   sale 3120252024, de modo que un título recibiría etiqueta de ejercicio y el modelo leería
   una columna donde solo hay prosa. */
const RX_CELDA_CIFRA = /^\(?\s*-?\s*\d[\d.,]*\s*\)?$/;
const RX_CELDA_VACIA = /^[-–—]$/;

/** ¿Esta celda es una cifra (o el hueco de una)? */
export function esCeldaDeCifra(texto) {
  const t = String(texto || '').trim();
  return RX_CELDA_CIFRA.test(t) || RX_CELDA_VACIA.test(t);
}

/**
 * Qué ejercicio le corresponde a cada celda de una fila.
 *
 * Dos reglas, y las dos hacen falta:
 *
 *   · Solo se consideran celdas con forma de cifra. Deja fuera el rótulo, el signo de pesos
 *     que Inmotion imprime en celda propia y los títulos de la portada.
 *   · Cada columna se queda con UNA sola celda, la más cercana, y cada celda con un solo
 *     año: los pares se resuelven del más cercano al más lejano. Sin esto, la columna de
 *     notas puede robarle la etiqueta a la cifra de verdad cuando la hoja va apretada — en
 *     HH Colombia la nota queda a 64 puntos de una tolerancia de 71, o sea a diez de que el
 *     valor del ejercicio se atribuyera al número de la nota.
 *
 * @returns {Map<object, string>} celda → año.
 */
export function asignarAnios(fila, encabezado) {
  const asignado = new Map();
  if (!fila || !encabezado || !encabezado.columnas.length) return asignado;

  const candidatas = (fila.celdas || []).filter((c) => esCeldaDeCifra(c.texto));
  const pares = [];
  encabezado.columnas.forEach((col) => {
    candidatas.forEach((celda) => {
      const d = Math.abs(col.derecha - celda.derecha);
      if (d <= encabezado.tolerancia) pares.push({ anio: col.anio, celda, d });
    });
  });
  pares.sort((a, b) => a.d - b.d);

  const aniosUsados = new Set();
  pares.forEach(({ anio, celda }) => {
    if (asignado.has(celda) || aniosUsados.has(anio)) return;
    asignado.set(celda, anio);
    aniosUsados.add(anio);
  });
  return asignado;
}

/* Las secciones del estado financiero, reconocidas por cómo ABRE la fila. Los patrones van
   anclados al principio a propósito: «TOTAL ACTIVO» no abre sección, la cierra. «PASIVO Y
   PATRIMONIO NETO» abre PASIVO, que es lo correcto —lo que sigue son pasivos—. */
const SECCIONES = [
  { nombre: 'ACTIVO', rx: /^activos?\b/ },
  { nombre: 'PASIVO', rx: /^pasivos?\b/ },
  { nombre: 'PATRIMONIO', rx: /^patrimonio\b/ },
  {
    nombre: 'RESULTADOS',
    rx: /^(estado de resultado|ingresos de actividades|ingresos operacionales|ingresos por)/,
  },
];

/* CORRIENTE y NO CORRIENTE, que es la distinción que decide de cuál fila sale cada partida
   de capital de trabajo. Lo confirmó el usuario el 2026-08-31: las cuentas por cobrar, las
   por pagar y los inventarios se toman del activo y del pasivo CORRIENTES.

   Sin esto la elección quedaba al azar del orden del documento. En Llantas Emotion
   «Cuentas comerciales por cobrar» aparece dos veces —4.003.623.665 en el corriente y
   3.697.232.608 en el no corriente— y «Cuentas comerciales por pagar» también
   —53.708.962.262 y 59.805.002—. Tomar la equivocada no vacía el campo: lo llena con una
   cifra creíble del sitio equivocado, y eso no se nota al revisar.

   NO CORRIENTE va primero en la lista porque «no corrientes» también satisface el patrón de
   «corrientes» si se prueba al revés. */
const SUBSECCIONES = [
  { nombre: 'NO CORRIENTE', rx: /^(no\s+corriente|activos?\s+no\s+corriente|pasivos?\s+no\s+corriente)/ },
  { nombre: 'CORRIENTE', rx: /^(corriente|activos?\s+corriente|pasivos?\s+corriente)/ },
];

/** La sección que abre esta fila, o `null` si no abre ninguna. */
export function seccionQueAbre(fila) {
  const primera = ((fila && fila.celdas) || [])[0];
  if (!primera) return null;
  const clave = normalizarPalabra(primera.texto);
  const hallada = SECCIONES.find((s) => s.rx.test(clave));
  return hallada ? hallada.nombre : null;
}

/**
 * La subsección —CORRIENTE o NO CORRIENTE— que abre esta fila.
 *
 * Se mira en TODAS las celdas y no solo en la primera, porque el balance de dos paneles pone
 * «CORRIENTES» a la izquierda para el activo y otra vez a la derecha para el pasivo, en la
 * misma fila: la de Llantas Emotion es literalmente `CORRIENTES | CORRIENTES`.
 */
export function subseccionQueAbre(fila) {
  for (const celda of (fila && fila.celdas) || []) {
    const clave = normalizarPalabra(celda.texto);
    const hallada = SUBSECCIONES.find((x) => x.rx.test(clave));
    if (hallada) return hallada.nombre;
  }
  return null;
}

/** La sección y la subsección en las que cae cada fila, arrastrando las últimas que se abrieron. */
export function seccionesDeFilas(filas) {
  let actual = null;
  let sub = null;
  return (filas || []).map((fila) => {
    const abre = seccionQueAbre(fila);
    /* Una sección nueva reinicia la subsección: el «CORRIENTES» del activo no rige sobre el
       pasivo cuando el estado los pone uno debajo del otro. */
    if (abre && abre !== actual) { actual = abre; sub = null; }
    const abreSub = subseccionQueAbre(fila);
    if (abreSub) sub = abreSub;
    return { fila, seccion: actual, subseccion: sub };
  });
}

/**
 * La estructura de un PDF: por página, sus filas con posición, su encabezado de ejercicios
 * y la sección en la que cae cada fila.
 *
 * Devuelve `{ paginas: [], anios: [] }` sin lanzar cuando el archivo es una imagen, un
 * escaneo sin capa de texto o pdf.js no puede abrirlo. Es el mismo criterio de
 * `extraerTextoPdf`: esto es un refuerzo de la lectura, no un requisito, y que el llamador
 * tenga que distinguir «no hay texto» de «falló algo» sería una carga inútil.
 */
export async function extraerEstructuraPdf(file, { getDocument = pdfjs.getDocument } = {}) {
  const vacio = { paginas: [], anios: [] };
  if (!file) return vacio;
  if (file.type && file.type.startsWith('image/')) return vacio;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const doc = await getDocument({
      data: new Uint8Array(arrayBuffer),
      isOffscreenCanvasSupported: false,
    }).promise;

    const paginas = [];
    const anios = new Set();
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const contenido = await page.getTextContent();
      const filas = filasConColumnas(contenido.items);
      if (!filas.length) continue;
      const encabezado = encabezadoDeAnios(filas);
      if (encabezado) encabezado.columnas.forEach((c) => anios.add(c.anio));
      paginas.push({ numero: n, filas, encabezado, conSeccion: seccionesDeFilas(filas) });
    }
    return { paginas, anios: [...anios].sort().reverse() };
  } catch (err) {
    console.warn('[eeffColumnas] no se pudo leer la estructura del PDF:', err && err.message);
    return vacio;
  }
}

/**
 * La misma estructura, a partir de las filas ya extraídas.
 *
 * Existe para el OCR de respaldo: en un documento escaneado las filas no salen de pdf.js
 * sino de la transcripción, y el resto del módulo no tiene por qué saber de dónde vienen.
 */
export function estructuraDeFilas(paginasDeFilas) {
  const paginas = [];
  const anios = new Set();
  (paginasDeFilas || []).forEach(({ numero, filas }) => {
    if (!filas || !filas.length) return;
    const encabezado = encabezadoDeAnios(filas);
    if (encabezado) encabezado.columnas.forEach((c) => anios.add(c.anio));
    paginas.push({ numero, filas, encabezado, conSeccion: seccionesDeFilas(filas) });
  });
  return { paginas, anios: [...anios].sort().reverse() };
}

/* Texto de una fila tal como lo vería `unirTrozos`, para comparar contra el rótulo que
   devolvió la lectura. */
const textoDeFila = (fila) => ((fila && fila.celdas) || []).map((c) => c.texto).join(' | ');

/** El rótulo de una fila: sus celdas hasta la primera que sea de una columna de año. Sirve
 *  para poder decir a qué rubro pertenece de verdad una cifra mal atribuida. */
function rotuloDeFila(fila, encabezado) {
  const anios = asignarAnios(fila, encabezado);
  const partes = [];
  for (const celda of fila.celdas || []) {
    if (anios.has(celda)) break;
    partes.push(celda.texto);
  }
  return partes.join(' ').trim() || textoDeFila(fila);
}

/** ¿Esta celda contiene la cifra buscada? Misma tolerancia de un peso y mismo desprecio del
 *  signo que `cifraApareceEnTexto`, y las mismas dos convenciones de separador de miles. */
function celdaTraeCifra(celda, objetivo) {
  return interpretaciones(String(celda.texto))
    .some((n) => Math.abs(Math.abs(n) - objetivo) <= 1);
}

/** La cifra de una fila que cae en la columna de un ejercicio dado, o `null`. */
function cifraDelAnioEnFila(fila, encabezado, anio) {
  const anios = asignarAnios(fila, encabezado);
  for (const celda of fila.celdas || []) {
    if (anios.get(celda) !== anio) continue;
    const lecturas = interpretaciones(String(celda.texto));
    if (lecturas.length) return { texto: celda.texto, valor: lecturas[0] };
    /* Celda de la columna correcta pero sin cifra legible: es el «-» de un rubro que el
       ejercicio no reporta, y decirlo es más útil que devolver null. */
    return { texto: celda.texto, valor: null };
  }
  return null;
}

/**
 * Dónde está de verdad una cifra que la lectura atribuyó a un rótulo.
 *
 * Es la comprobación que `cifraApareceEnTexto` no puede hacer: esa solo pregunta si la
 * cifra está impresa en ALGÚN sitio del documento, así que una tomada de la fila vecina o
 * de la columna del ejercicio anterior la pasa intacta —está impresa, solo que en otro
 * lado—. Aquí se exige que esté en la fila de su rótulo y en la columna del año pedido.
 *
 * Veredictos:
 *   `coincide`          está en la fila del rótulo y en la columna del año objetivo.
 *   `otro-anio`         está en esa fila pero en la columna de otro ejercicio.
 *   `corregible`        la fila de su rótulo trae OTRA cifra en la columna del año objetivo, y
 *                       esa cifra viene en `esperado`. No se descarta: se corrige con lo que el
 *                       documento imprime, que es información del propio PDF.
 *   `vacio-en-el-anio`  la fila existe y su columna del año objetivo está en blanco o en «-»:
 *                       el ejercicio no reporta ese rubro. Es el caso de HH Colombia
 *                       («Intangible | 8 | - | 4.146»), donde la cifra que se leyó era de 2024.
 *   `fuera-de-columna`  no está en ninguna columna de ejercicio de la fila del rótulo y esa
 *                       fila tampoco trae cifra en el año pedido.
 *   `sin-verificar`     no se puede afirmar nada: el rótulo no aparece —la lectura lo
 *                       parafraseó, o cita dos filas a la vez—, la página no trae encabezado
 *                       de ejercicios, o no hay capa de texto. Se degrada al chequeo por
 *                       documento de siempre, que es el comportamiento actual.
 *
 * NO EXISTE UN VEREDICTO QUE BUSQUE LA CIFRA POR TODO EL DOCUMENTO, y esa ausencia es
 * deliberada. Lo hubo —`otra-fila`, que barría las páginas hasta encontrar el número y
 * declaraba a qué fila pertenecía— y descartó una cifra CORRECTA en Llantas Emotion
 * (2026-08-31): en un estado de 49 páginas cada cifra del estado aparece otra vez en su nota,
 * así que el barrido siempre encuentra «otra fila» y siempre acusa. La única fila que puede
 * decir algo sobre una cifra es la del rótulo que la lectura citó.
 *
 * @returns {{veredicto:string, anioHallado?:string, seccion?:string, rotuloReal?:string,
 *            esperado?:{texto:string, valor:number|null}|null}}
 */
export function ubicacionDeCifra(estructura, { rotulo, valor, anio, subseccion }) {
  const objetivo = Math.abs(Number(valor));
  const clave = normalizarPalabra(rotulo);
  const anioObjetivo = String(anio || '').trim();
  if (!clave || !Number.isFinite(objetivo) || !anioObjetivo) {
    return { veredicto: 'sin-verificar' };
  }

  const paginas = (estructura && estructura.paginas) || [];
  const candidatas = [];
  paginas.forEach((pagina) => {
    if (!pagina.encabezado) return;
    (pagina.conSeccion || []).forEach(({ fila, seccion, subseccion: sub }) => {
      /* La propia fila del encabezado no es una fila de datos. Sin esta guarda entraba como
         candidata y producía avisos absurdos: se vio en pruebas un «en esa fila, el ejercicio
         2025 dice 2025», porque su celda de la columna 2025 contiene el texto «2025». */
      if (fila.y === pagina.encabezado.y) return;
      if (!normalizarPalabra(textoDeFila(fila)).includes(clave)) return;
      candidatas.push({ fila, seccion, subseccion: sub, encabezado: pagina.encabezado });
    });
  });

  if (!candidatas.length) return { veredicto: 'sin-verificar' };

  /* Cuando el mismo rótulo aparece en el corriente y en el no corriente, manda el que pidió
     quien llama. No es un filtro sino una preferencia: si no hay ninguna candidata en esa
     subsección se sigue con todas, porque descartar por esto dejaría el campo vacío cuando el
     documento simplemente no rotula sus bloques. */
  const preferida = String(subseccion || '').trim().toUpperCase();
  if (preferida) {
    const enSubseccion = candidatas.filter((c) => c.subseccion === preferida);
    if (enSubseccion.length) {
      candidatas.length = 0;
      candidatas.push(...enSubseccion);
    }
  }

  /* 1. ¿Está en la columna pedida de alguna fila del rótulo? Si sí, la lectura acertó, y no
        importa que el mismo rótulo aparezca en otra parte del documento. */
  for (const c of candidatas) {
    const anios = asignarAnios(c.fila, c.encabezado);
    for (const celda of c.fila.celdas || []) {
      if (!celdaTraeCifra(celda, objetivo)) continue;
      if (anios.get(celda) === anioObjetivo) {
        return { veredicto: 'coincide', anioHallado: anioObjetivo, seccion: c.seccion };
      }
    }
  }

  /* 2. ¿Está en otra columna de la misma fila? Es el error del ejercicio equivocado, el más
        probable en un estado comparativo, y se informa con la cifra que sí correspondía. */
  for (const c of candidatas) {
    const anios = asignarAnios(c.fila, c.encabezado);
    for (const celda of c.fila.celdas || []) {
      if (!celdaTraeCifra(celda, objetivo)) continue;
      const anioCelda = anios.get(celda);
      if (anioCelda && anioCelda !== anioObjetivo) {
        return {
          veredicto: 'otro-anio',
          anioHallado: anioCelda,
          seccion: c.seccion,
          esperado: cifraDelAnioEnFila(c.fila, c.encabezado, anioObjetivo),
        };
      }
    }
  }

  /* 3. La cifra leída no está en la fila de su rótulo. Lo que se hace entonces NO es buscarla
        por el documento —eso acusaba en falso, ver la nota del bloque de arriba— sino mirar qué
        dice esa fila en la columna del año pedido, que es la única cifra con derecho a estar en
        ese campo.

        Se prefiere la candidata que SÍ trae cifra en el año objetivo: el mismo rótulo puede
        aparecer dos veces —en Llantas Emotion «Cuentas comerciales por cobrar» está en el
        corriente y en el no corriente— y quedarse con la primera sería jugar a los dados. */
  const conCifra = candidatas
    .map((c) => ({ ...c, esperado: cifraDelAnioEnFila(c.fila, c.encabezado, anioObjetivo) }))
    .filter((c) => c.esperado);
  const elegida = conCifra.find((c) => c.esperado.valor !== null) || conCifra[0] || null;

  if (elegida && elegida.esperado.valor !== null) {
    /* Hay una cifra en esa fila y esa columna, y no es la que la lectura trajo. Se ofrece la
       del documento en vez de vaciar el campo: descartar dejaba el estudio sin costo de ventas
       —y por tanto sin margen ni Índice de Berry—, mientras corregir deja el número bueno,
       visible y editable. Sale del propio PDF, no de una interpretación. */
    return {
      veredicto: 'corregible',
      anioHallado: anioObjetivo,
      seccion: elegida.seccion,
      rotuloReal: rotuloDeFila(elegida.fila, elegida.encabezado),
      esperado: elegida.esperado,
    };
  }

  if (elegida) {
    /* La fila existe y su columna del año objetivo está vacía o en «-»: el ejercicio no
       reporta ese rubro, y la cifra que se leyó salió de otra parte. */
    return {
      veredicto: 'vacio-en-el-anio',
      anioHallado: anioObjetivo,
      seccion: elegida.seccion,
      esperado: elegida.esperado,
    };
  }

  /* 4. La fila del rótulo existe pero no tiene ninguna celda en las columnas de ejercicio: no
        es una fila de cifras comparativas (un encabezado de bloque, una nota al pie). */
  const primera = candidatas[0];
  return {
    veredicto: 'fuera-de-columna',
    seccion: primera.seccion,
    esperado: null,
  };
}

/**
 * El texto del documento con cada cifra etiquetada por el ejercicio al que pertenece y con
 * las secciones marcadas.
 *
 * Es lo que va al prompt en lugar del texto crudo. El modelo deja de inferir qué columna es
 * qué año —lo que hoy le hace tomar la del ejercicio anterior— y deja de adivinar dónde
 * acaba la sección de activos. Todo lo que se agrega sale del propio PDF: no hay ninguna
 * interpretación de por medio.
 *
 *     antes:    Intangible | 8 | - | 4.146
 *     después:  Intangible | 8 | [2025] - | [2024] 4.146
 *
 * Ese caso es el decisivo: hoy el modelo ve un guion y una cifra y toma la cifra.
 */
export function textoAnotado(estructura) {
  const partes = [];
  ((estructura && estructura.paginas) || []).forEach((pagina) => {
    const lineas = [];
    let seccionAnterior = null;
    (pagina.conSeccion || []).forEach(({ fila, seccion }) => {
      if (seccion && seccion !== seccionAnterior) {
        lineas.push(`--- SECCIÓN: ${seccion} ---`);
        seccionAnterior = seccion;
      }
      const anios = asignarAnios(fila, pagina.encabezado);
      const celdas = (fila.celdas || []).map((celda) => {
        const anio = anios.get(celda);
        return anio ? `[${anio}] ${celda.texto}` : celda.texto;
      });
      lineas.push(celdas.join(' | '));
    });
    if (lineas.length) partes.push(`--- Página ${pagina.numero} ---\n${lineas.join('\n')}`);
  });
  return partes.join('\n\n');
}
