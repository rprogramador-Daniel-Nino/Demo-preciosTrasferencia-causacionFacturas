/* ─────────────────────────────────────────────────────────────────────────────
   La capa de texto del PDF de estados financieros.

   Hasta agosto de 2026 el documento se le mandaba a la IA únicamente rasterizado a
   imagen, aunque la enorme mayoría de los estados financieros que llegan al estudio
   los exporta un software contable y traen su texto embebido: se le pedía interpretar
   píxeles cuando los dígitos exactos estaban ahí, disponibles. El costo de eso no es
   teórico. En el estado financiero de Montachem 2025 la lectura devolvió 44.177.669
   como «cuentas por pagar comerciales», una cifra que no aparece en ninguna de las
   cuatro páginas del documento, y nada podía desmentirla.

   Con el texto delante pasan dos cosas: el modelo transcribe en vez de adivinar, y
   —sobre todo— `eeffVerificacion.js` puede comprobar que cada cifra que devolvió
   existe de verdad en el documento. Un PDF escaneado no tiene capa de texto y ahí se
   sigue trabajando solo con la imagen; esta función devuelve la cadena vacía y el
   llamador lo dice explícitamente en vez de fingir una verificación que no hizo.
   ───────────────────────────────────────────────────────────────────────────── */

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { num } from '../utils/calculations.js';

/* Dos fragmentos pertenecen a la misma línea si sus líneas base distan menos que esto,
   en unidades de PDF (1/72 de pulgada). Los estados financieros desalinean por una
   fracción de punto las celdas de una misma fila —la columna del año y la del rubro no
   siempre comparten la línea base exacta—, y con una tolerancia de cero cada celda
   salía en su propia línea, deshaciendo justo la asociación rótulo-cifra que hace útil
   este texto. Tres puntos es menos que el interlineado de cualquier estado financiero
   impreso, así que no fusiona filas distintas. */
const TOLERANCIA_LINEA = 3;

/* Separador entre celdas de una misma línea. Se elige la barra vertical y no el espacio
   porque los rótulos ya llevan espacios («CUENTAS POR PAGAR A PARTES RELACIONADAS») y
   sin una marca el rótulo y la cifra quedaban pegados en una sola cadena ambigua. */
const SEPARADOR_CELDA = ' | ';

/* Cuándo dos fragmentos consecutivos de la misma línea son la MISMA celda: cuando el
   hueco que los separa es menor que este factor por el alto de la fuente.

   pdf.js no devuelve celdas, devuelve trozos, y parte donde le conviene al formato del
   archivo: poner un separador entre cada trozo convierte «2025» en «202 | 5» y «21.850»
   en dos cifras que no existen. Como esta capa de texto se usa para comprobar que una
   cifra esté impresa en el documento, esa partición no es cosmética — descartaría cifras
   buenas y le diría al analista que la lectura las inventó.

   El mismo criterio, con el mismo factor, lo implementa `lineasPorCoordenadas` en la rama
   `juandev` para los PDF de las comparables (commit f8ea915, 2026-08-21), que llegó al
   remoto mientras esto se escribía. Al integrar esa rama las dos implementaciones deben
   unificarse en una: son el mismo problema resuelto dos veces. */
const FACTOR_MISMA_CELDA = 0.6;

/** Agrupa los fragmentos de una página en líneas por su posición vertical, y ordena
 *  cada línea de izquierda a derecha. Exportada para poder probarla sin un PDF. */
export function agruparEnLineas(items, tolerancia = TOLERANCIA_LINEA) {
  const lineas = [];
  (items || []).forEach((it) => {
    if (!it || !it.str || !it.str.trim()) return;
    const x = it.transform[4];
    const y = Math.round(it.transform[5]);
    const trozo = {
      x,
      texto: it.str,
      /* `width` y `height` los da pdf.js por fragmento; sin ellos se cae al criterio de
         que todo fragmento es una celda nueva, que es como se comportaba antes. */
      ancho: Number.isFinite(it.width) ? it.width : 0,
      alto: Number.isFinite(it.height) ? it.height : 0,
    };
    const existente = lineas.find((l) => Math.abs(l.y - y) <= tolerancia);
    if (existente) existente.trozos.push(trozo);
    else lineas.push({ y, trozos: [trozo] });
  });

  return lineas
    /* De arriba abajo: en el sistema de coordenadas del PDF la Y crece hacia arriba. */
    .sort((a, b) => b.y - a.y)
    .map((l) => unirTrozos(l.trozos))
    .filter(Boolean);
}

/* Une los fragmentos de una línea, separando por celdas y no por fragmento. */
function unirTrozos(trozos) {
  const enOrden = [...trozos].sort((a, b) => a.x - b.x);
  let salida = '';
  let previo = null;
  enOrden.forEach((t) => {
    const texto = t.texto.trim();
    if (!texto) return;
    if (previo === null) {
      salida = texto;
    } else {
      const hueco = t.x - (previo.x + previo.ancho);
      const umbral = FACTOR_MISMA_CELDA * (t.alto || previo.alto || 0);
      salida += hueco < umbral ? texto : SEPARADOR_CELDA + texto;
    }
    previo = t;
  });
  return salida.replace(/[ \t]+/g, ' ').trim();
}

/**
 * Texto de un PDF, página por página, con las celdas de cada fila en una sola línea.
 *
 * Devuelve `''` sin lanzar cuando el archivo es una imagen, cuando es un PDF escaneado
 * (sin capa de texto) o cuando pdf.js no puede abrirlo: la lectura por imagen sigue
 * siendo el camino y este texto es un refuerzo, no un requisito. Que el llamador tenga
 * que distinguir «no hay texto» de «falló algo» sería una carga inútil — en los dos
 * casos hace lo mismo.
 */
export async function extraerTextoPdf(file, { getDocument = pdfjs.getDocument } = {}) {
  if (!file) return '';
  if (file.type && file.type.startsWith('image/')) return '';

  try {
    const arrayBuffer = await file.arrayBuffer();
    const doc = await getDocument({
      data: new Uint8Array(arrayBuffer),
      isOffscreenCanvasSupported: false,
    }).promise;

    const paginas = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const contenido = await page.getTextContent();
      const lineas = agruparEnLineas(contenido.items);
      if (lineas.length) paginas.push(`--- Página ${n} ---\n${lineas.join('\n')}`);
    }
    return paginas.join('\n\n');
  } catch (err) {
    /* Un PDF que no se puede leer como texto no interrumpe la ingesta: se sigue con la
       imagen, que es lo que funcionaba antes de que esta función existiera. */
    console.warn('[extraerTextoPdf] sin capa de texto utilizable:', err && err.message);
    return '';
  }
}

/* Cuando dos o más cifras de una misma fila quedan pegadas sin ningún separador —el hueco
   entre celdas no alcanzó el umbral de `unirTrozos» para este generador de PDF en
   particular—, el bloque de dígitos que arma `agregar()` mezcla los grupos de miles de
   varias cifras en uno solo: el final de una y el principio de la siguiente forman un
   grupo de más de tres dígitos, que no es ninguna de las dos cifras reales. Caso real:
   LAMBERTI COLOMBIA SAS (2026-08-24), donde el modelo leía bien las diez cifras del activo
   —por la imagen— y esta verificación las descartaba igual, con «no aparece impresa».

   Un grupo de miles colombiano vale SIEMPRE tres dígitos, salvo el primero de cada cifra.
   Un grupo de más de tres dígitos delata la costura: los tres primeros cierran la cifra en
   curso y el resto empieza la siguiente. Repetirlo grupo a grupo separa cualquier cantidad
   de cifras pegadas en cadena — el caso de Lamberti pega cuatro seguidas.

   El primer grupo del bloque (`i === 0`) nunca se parte: es la cabecera de la primera
   cifra, que puede tener de uno a tres dígitos por sí misma, y partirla arriesgaría a
   trocear un número que simplemente no lleva separador de miles (un año, un NIT, un
   código). Sin nada pegado, esta función devuelve el bloque intacto, tal como antes.

   Igual que `interpretaciones()`, no se elige una convención: se prueban las dos —miles
   con punto y miles con coma— y se devuelven los candidatos de ambas. Elegir mal para un
   bloque anglosajón («23,741,367,744.00») no debe romper su lectura solo por perseguir el
   defecto colombiano; los candidatos de más son gratis para lo único que esto alimenta,
   «¿está esta cifra impresa?». */
function desglosarCifrasPegadas(bloque) {
  return [
    ...desglosarPorSeparador(bloque, '.', ','),
    ...desglosarPorSeparador(bloque, ',', '.'),
  ];
}

function desglosarPorSeparador(bloque, sepMiles, sepDecimal) {
  const partes = String(bloque).split(sepDecimal);
  const entero = partes[0];
  const decimal = partes.length > 1 ? partes.slice(1).join(sepDecimal) : undefined;
  const grupos = entero.split(sepMiles);
  const cifras = [];
  let actual = [];
  grupos.forEach((grupo, i) => {
    if (i === 0 || grupo.length <= 3) {
      actual.push(grupo);
      return;
    }
    actual.push(grupo.slice(0, 3));
    cifras.push(actual.join(sepMiles));
    actual = [grupo.slice(3)];
  });
  cifras.push(actual.join(sepMiles));
  if (decimal !== undefined) cifras[cifras.length - 1] += sepDecimal + decimal;
  return cifras;
}

/**
 * Todas las cifras que aparecen impresas en un texto, normalizadas a número.
 *
 * Es el conjunto contra el que `eeffVerificacion.js` comprueba que una cifra devuelta
 * por la IA existe en el documento. Se reconocen las dos convenciones que llegan —la
 * colombiana `21.850.187.494,00` y la anglosajona `21,850,187,494.00`— y también los
 * enteros sin separador, porque no todos los estados financieros los usan.
 *
 * El signo se descarta a propósito: el documento imprime el costo entre paréntesis o con
 * menos y la lectura puede devolverlo con cualquiera de los dos, y lo que se está
 * comprobando es que la MAGNITUD esté impresa, no cómo se representó su signo.
 */
export function cifrasDelTexto(texto) {
  const encontradas = new Set();
  const agregar = (cadena) => {
    const patron = /\d[\d.,]*/g;
    let m;
    while ((m = patron.exec(cadena)) !== null) {
      const crudo = m[0].replace(/[.,]+$/, '');
      if (!crudo) continue;
      desglosarCifrasPegadas(crudo).forEach((pieza) => {
        interpretaciones(pieza).forEach((n) => encontradas.add(Math.abs(n)));
      });
    }
  };

  const completo = String(texto || '');
  agregar(completo);

  /* Y otra pasada por línea, con los separadores de celda y los espacios quitados de
     entre los dígitos. Es una red por si un número llega partido de todas formas —pdf.js
     puede devolver «21.850.» y «187.494» como dos fragmentos con un hueco ancho de por
     medio, y ahí `agruparEnLineas` hace bien en separarlos porque no puede saber que son
     el mismo número—. Para lo único que sirve este conjunto, «¿está esta cifra impresa?»,
     admitir una lectura de más es el lado seguro: un falso positivo deja pasar una cifra,
     mientras que un falso negativo descarta un dato bueno del estado financiero y le dice
     al analista que la lectura se lo inventó. */
  completo.split('\n').forEach((linea) => {
    const pegada = linea.replace(/\s*\|\s*/g, '').replace(/(\d)\s+(\d)/g, '$1$2');
    if (pegada !== linea) agregar(pegada);
  });

  return encontradas;
}

/* Las lecturas posibles de un literal numérico. Se aceptan las DOS, y no se elige:
 *
 *  · `num()` resuelve la convención cuando el literal trae los dos separadores
 *    —«21.850.187.494,00» es coma decimal y «23,741,367,744.00» punto decimal—, que es el
 *    caso de casi todo estado financiero con decimales.
 *  · La lectura «todos los separadores son de miles» cubre el literal con un separador
 *    solo, donde «1.234» puede ser mil doscientos treinta y cuatro o uno con doscientos
 *    treinta y cuatro milésimas según quién emitió el estado.
 *
 * Para el único uso de esta función —¿está esta cifra impresa en el documento?— admitir
 * las dos lecturas es lo correcto: sigue rechazando lo que no aparece, y no rechaza por
 * haber elegido mal la convención de un documento extranjero. */
function interpretaciones(crudo) {
  const salida = [];
  const canonica = num(crudo);
  if (canonica !== null) salida.push(canonica);
  const comoMiles = Number(crudo.replace(/[.,]/g, ''));
  if (Number.isFinite(comoMiles)) salida.push(comoMiles);
  return salida;
}

/**
 * ¿Está esta cifra impresa en el texto del documento?
 *
 * Compara contra las cifras del texto ya extraídas (`cifrasDelTexto`) ignorando el signo
 * y los separadores, y con una tolerancia de un peso para absorber el redondeo de los
 * decimales: un estado que imprime «21.850.187.494,00» y una lectura que devuelve
 * 21850187494 son la misma cifra.
 */
export function cifraApareceEnTexto(valor, cifrasImpresas) {
  if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return false;
  const objetivo = Math.abs(Number(valor));
  /* El cero no se verifica: aparece impreso en cualquier documento —o como raya, o no
     aparece— y afirmar que «está» no dice nada. Un rubro en cero no es una alucinación. */
  if (objetivo === 0) return true;
  for (const c of cifrasImpresas) {
    if (Math.abs(c - objetivo) <= 1) return true;
  }
  return false;
}
