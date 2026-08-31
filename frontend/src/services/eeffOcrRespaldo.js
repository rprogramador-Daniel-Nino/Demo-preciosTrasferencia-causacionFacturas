/* ─────────────────────────────────────────────────────────────────────────────
   eeffOcrRespaldo.js — una capa de texto para las páginas que no la tienen.

   POR QUÉ EXISTE. `verificarEeff` descarta toda cifra que no encuentre impresa en la capa de
   texto del PDF, y ese es el mecanismo que sostiene la ingesta: sin él, lo que el modelo
   devuelve entra sin red. En un documento escaneado esa capa no existe, así que no hay nada
   que cotejar: hoy la ingesta pone `verificadoContraTexto: false`, muestra un aviso ámbar
   honesto —«no se pudo verificar»— y el analista se queda con el problema entero. Medido con
   `paginasSinTextoUtilizable` sobre los seis documentos reales del usuario:

     · Robertet             — 25 de 25 páginas sin capa de texto (escaneo puro).
     · Inoxpa               — 24 de 29 (páginas 3-19 y 23-29: todas las notas).
     · Aluminios y Vidrios  —  5 de 50 (las últimas).
     · Inmotion, PFI, HH Colombia — ninguna: no gastan nada.

   QUÉ HACE Y QUÉ NO. Produce texto sintético SOLO para alimentar la verificación que ya
   existe. No se reenvía al prompt de extracción, y esa es una decisión, no un olvido: la capa
   nativa se le presenta al modelo como exacta porque sale del propio PDF, mientras esto es una
   segunda lectura de IA. Tratarla como exacta permitiría encadenar una alucinación sobre otra
   —el modelo transcribe mal, y la verificación confirma la cifra mala contra su propia
   transcripción—. Como verificación cruzada sigue teniendo valor: la transcripción y la
   extracción son dos llamadas independientes, con prompts distintos, y que las dos coincidan
   en una cifra es evidencia; que difieran es exactamente lo que hay que avisar.

   Y ES UNA VERIFICACIÓN MÁS DÉBIL QUE LA NATIVA. Por eso lo que aquí se devuelve queda
   marcado: `respaldoOcr` viaja con la lectura hasta la tarjeta de cumplimiento, que dice
   «verificado contra una transcripción» y no «verificado contra el documento». Dejar que el
   aviso ámbar se apagara sin más convertiría una verificación de segunda en una de primera.

   NO ALCANZA A VERIFICAR POR COLUMNA. `eeffColumnas.js` distingue el ejercicio de cada cifra
   por la posición horizontal de su celda, y una transcripción no trae geometría: deducir la
   columna del orden de las celdas en la línea es justo la inferencia posicional que causaba el
   defecto original. Para las páginas escaneadas el respaldo llega hasta «la cifra está impresa
   en el documento», que es lo que hoy no se tiene en absoluto.

   POR QUÉ POR LOTES, y no en una sola llamada como decía el diseño del 2026-08-28: el proxy de
   Gemini corta a los 50 s (`GEMINI_CORTE_MS` en `functions/index.js`) y el cuerpo de la
   petición tope en 32 MiB. Veinticinco páginas escaneadas en una sola llamada exceden las dos
   cosas —Robertet e Inoxpa habrían fallado siempre— así que van en lotes cortos y secuenciales,
   y lo que un lote entrega se conserva aunque el siguiente falle: media transcripción verifica
   la mitad de las cifras, y eso es más que nada.

   POR QUÉ ANTES DE LA PRIMERA VERIFICACIÓN, y no después de la pasada a notas como también
   decía ese diseño: `resolverFaltantesConNotas` re-verifica desde la lectura ORIGINAL
   —`fusionarHallazgosEnLectura(lectura, hallazgos)`—, así que enriquecer el texto después
   borraría los campos que las notas acabaran de resolver y su `conclusionNotas`. Hacerlo antes
   deja a las dos pasadas viendo el mismo texto y no pierde nada. El disparador sigue siendo
   estructural (hay páginas sin texto), no los campos que quedaron en `null`, que era el punto
   de esa decisión.

   Mismo patrón de `notasEeffOrquestacion.js`: I/O inyectado, sin red en las pruebas.
   ───────────────────────────────────────────────────────────────────────────── */

import { paginasSinTextoUtilizable } from './eeffTextoPdf.js';
import { rasterizarPaginas } from './pdfRenderer.js';
import { postGeminiWithRetry } from './eeffParser.js';

/* El modelo del flujo de EEFF del contribuyente (`eeffParser.js`), que es el flujo al que
   este respaldo pertenece. Lectura de documentos con Gemini y no con Claude por costo, según
   el reparto documentado en CLAUDE.md. */
const MODELO_OCR = 'gemini-3.5-flash';

/* Cuántas páginas por llamada. El proxy corta a los 50 s: transcribir una página escaneada
   cuesta del orden de cinco a diez segundos, así que cuatro caben con margen y ocho no. Bajar
   este número hace más llamadas más seguras; subirlo arriesga perder el lote entero por el
   corte. Cuatro es el punto donde un lote sigue cabiendo si el modelo va lento. */
export const PAGINAS_POR_LOTE = 4;

/* Cuántas páginas se transcriben en total, como máximo.

   No es un límite técnico sino de fricción: cada lote es una llamada de varios segundos, y el
   analista está esperando. Doce páginas son tres llamadas, del orden de un minuto.

   Se toman en ORDEN DE DOCUMENTO, y eso es lo que hace que el tope no cueste casi nada: en un
   estado financiero el balance y el estado de resultados van al principio y las notas después
   —así están los seis documentos reales—, y las cifras que la verificación necesita son las del
   balance y el P&L. En Robertet (25 escaneadas) las doce primeras cubren los dos estados con
   holgura; lo que queda fuera son notas, que solo alimentan el fallback y ya tienen su propio
   camino por imagen. */
export const MAX_PAGINAS_OCR_RESPALDO = 12;

/**
 * El prompt de transcripción.
 *
 * Deliberadamente angosto: transcribir, no interpretar. Un prompt que además clasificara
 * rubros produciría una segunda opinión sobre los mismos campos, y entonces dos IA que se
 * equivocan igual —lo más probable, siendo el mismo modelo— se confirmarían entre sí. Pedir
 * transcripción literal es lo que mantiene la verificación como verificación.
 */
export function promptOcrRespaldo(numerosPagina) {
  const paginas = (numerosPagina || []).join(', ');
  return `Eres un transcriptor. Tu única tarea es transcribir LITERALMENTE cada cifra, palabra `
    + `y rótulo que veas en las imágenes adjuntas, en el orden en que aparecen, sin interpretar `
    + `de qué rubro se trata, sin clasificar, sin resumir y sin omitir nada.

Cada imagen es una página de un estado financiero o de sus notas, y antes de cada imagen se te `
    + `indica su número real dentro del documento${paginas ? ` (páginas ${paginas})` : ''}. `
    + `Devuelve el texto de cada página por separado, con este encabezado exacto:

--- Página <N> ---
<texto transcrito, línea por línea>

Reglas de transcripción:
· Transcribe los números tal como están impresos, con los mismos separadores de miles y de `
    + `decimales. Si un valor viene entre paréntesis o con guion delante, conserva esa forma.
· Mantén cada fila de una tabla en una sola línea, separando las celdas con " | ".
· NO conviertas unidades, NO redondees, NO completes cifras que no estén impresas.
· Si algo es ilegible, escribe [ilegible] en su lugar. Nunca adivines una cifra.
· Si una página está en blanco o no contiene nada legible, escribe su encabezado y debajo `
    + `[sin contenido legible].`;
}

/**
 * Pide la transcripción de un lote de imágenes a Gemini.
 *
 * Cada imagen va precedida por un `text` con su número de página, para que el número no
 * dependa de que el modelo cuente bien las imágenes: en un lote de páginas salteadas —Inoxpa
 * salta de la 19 a la 23— contar mal desplazaría todos los encabezados.
 */
export async function pedirTranscripcionOcr(imagenes, numerosPagina, { post = postGeminiWithRetry } = {}) {
  const lista = Array.isArray(imagenes) ? imagenes : [];
  if (!lista.length) return '';

  const parts = [{ text: promptOcrRespaldo(numerosPagina) }];
  lista.forEach((dataUrl, i) => {
    const numero = (numerosPagina || [])[i];
    parts.push({ text: `Página ${numero !== undefined ? numero : i + 1} del documento:` });
    parts.push({
      inline_data: {
        mime_type: mimeDeDataUrl(dataUrl),
        data: String(dataUrl).split(',')[1] || '',
      },
    });
  });

  const respuesta = await post({ model: MODELO_OCR, contents: [{ parts }] });
  const partes = respuesta?.data?.candidates?.[0]?.content?.parts || [];
  return partes.map((p) => p.text || '').join('');
}

/* El tipo se lee del propio dataURL y no se fija a mano: `rasterizarPaginas` emite JPEG para
   este camino y PNG para el ANEXO A, y declarar el tipo equivocado haría que el modelo
   rechazara la imagen. */
function mimeDeDataUrl(dataUrl) {
  const m = /^data:([^;,]+)/.exec(String(dataUrl || ''));
  return m ? m[1] : 'image/png';
}

/** Parte una lista en trozos de a lo sumo `tamano`, conservando el orden. */
export function enLotes(lista, tamano = PAGINAS_POR_LOTE) {
  const paso = Math.max(1, Math.trunc(tamano) || 1);
  const lotes = [];
  for (let i = 0; i < lista.length; i += paso) lotes.push(lista.slice(i, i + paso));
  return lotes;
}

/**
 * Enriquece la lectura con una transcripción de las páginas escaneadas, para que la
 * verificación tenga contra qué cotejar.
 *
 * Devuelve SIEMPRE una lectura utilizable —la misma, por identidad, cuando el respaldo no
 * aplica o no aportó nada— porque ningún fallo aquí puede tumbar la ingesta: el analista
 * quedaría sin cifras por culpa de un refuerzo opcional.
 *
 * @param {object}   args
 * @param {File}     args.file       el PDF cargado.
 * @param {object}   args.lectura    lo que devolvió `parseEeffWithGeminiOCR`.
 * @param {Function} [args.alAvanzar] se llama con `{lote, lotes, paginas}` antes de cada lote,
 *   para que la ingesta pueda decir por dónde va en vez de dejar la pantalla muda un minuto.
 * @returns {Promise<{lectura: object, respaldoOcr: object|null}>} `respaldoOcr` trae las
 *   páginas transcritas y las que quedaron fuera, y es lo que permite decir después
 *   «verificado contra una transcripción» en vez de «verificado contra el documento».
 */
export async function respaldarLecturaConOcr({
  file,
  lectura,
  alAvanzar,
  paginasSinTexto = paginasSinTextoUtilizable,
  rasterizar = rasterizarPaginas,
  pedirOcr = pedirTranscripcionOcr,
  porLote = PAGINAS_POR_LOTE,
  maxPaginas = MAX_PAGINAS_OCR_RESPALDO,
} = {}) {
  const sinCambios = { lectura, respaldoOcr: null };
  if (!file || !lectura) return sinCambios;

  let paginas;
  try {
    paginas = await paginasSinTexto(file);
  } catch (err) {
    console.error('No se pudo determinar qué páginas necesitan transcripción:', err);
    return sinCambios;
  }
  /* El caso normal —documento con capa de texto completa— no gasta nada: ni rasterizado, ni
     llamada, ni cuota. El respaldo solo corre donde hay un vacío real. */
  if (!Array.isArray(paginas) || paginas.length === 0) return sinCambios;

  /* Las primeras `maxPaginas`, en orden de documento: ahí están el balance y el estado de
     resultados, que es lo que la verificación necesita. Lo que queda fuera se nombra. */
  const aTranscribir = paginas.slice(0, Math.max(0, Math.trunc(maxPaginas) || 0));
  if (!aTranscribir.length) return sinCambios;
  const omitidas = paginas.slice(aTranscribir.length);

  const lotes = enLotes(aTranscribir, porLote);
  const transcritas = [];
  const trozos = [];

  for (let i = 0; i < lotes.length; i++) {
    const lote = lotes[i];
    try {
      if (typeof alAvanzar === 'function') {
        alAvanzar({ lote: i + 1, lotes: lotes.length, paginas: lote });
      }
      const imagenes = await rasterizar(file, lote);
      /* `rasterizarPaginas` ya falla en silencio devolviendo `[]`: mandar cero imágenes con un
         prompt que promete imágenes es pedirle al modelo que invente. */
      if (!Array.isArray(imagenes) || imagenes.length === 0) continue;

      const texto = await pedirOcr(imagenes, lote);
      if (!texto || !String(texto).trim()) continue;

      trozos.push(String(texto));
      transcritas.push(...lote.slice(0, imagenes.length));
    } catch (err) {
      /* Un lote perdido no cancela los demás ni la ingesta: media transcripción verifica la
         mitad de las cifras, que es más que ninguna. Mismo criterio que
         `resolverFaltantesConNotas` con su pasada a notas. */
      console.error(`No se pudo transcribir el lote de páginas ${lote.join(', ')}:`, err);
    }
  }

  if (!trozos.length) return sinCambios;

  /* La capa nativa va primero y la transcripción después: `cifraApareceEnTexto` busca en todo
     el bloque, así que el orden no cambia el resultado, pero deja el texto del propio PDF antes
     del texto de una IA para quien lea el rastro. */
  const textoPdf = [lectura.textoPdf, ...trozos]
    .filter((t) => t && String(t).trim())
    .join('\n\n');

  return {
    lectura: { ...lectura, textoPdf },
    respaldoOcr: {
      paginas: transcritas,
      paginasTranscritas: transcritas.length,
      /* Cuántas páginas escaneadas quedaron sin transcribir, para poder decirlo en vez de
         insinuar que el documento entero quedó cubierto. */
      paginasOmitidas: omitidas.length,
      lotes: lotes.length,
    },
  };
}
