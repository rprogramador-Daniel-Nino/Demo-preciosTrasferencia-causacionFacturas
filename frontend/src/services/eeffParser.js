import axios from 'axios';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extraerJSON } from './comparablesEngine.js';

if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
  ).href;
}

/**
 * Prompt para la lectura de Estados Financieros del Contribuyente por Gemini Vision OCR.
 */
export const EEFF_PROMPT = `Eres un contador público que lee estados financieros colombianos preparados bajo NIIF.
Extrae las cifras del ESTADO DE RESULTADOS y del ESTADO DE SITUACIÓN FINANCIERA del ejercicio más reciente que aparezca.

Campos del Estado de Situación Financiera (Balance General) a extraer:
- efectivo_y_equivalentes: Efectivo y equivalentes de efectivo / Bancos
- inversiones_asociadas: Inversiones asociadas / Fiducuenta
- cuentas_por_cobrar: Cuentas por cobrar comerciales y otras cuentas por cobrar
- activos_impuestos: Activos por impuestos corrientes / Anticipos de impuestos
- total_activo_corriente: Total Activo Corriente
- propiedad_planta_equipo: Propiedades, planta y equipo
- intangibles: Intangibles / Licencias
- diferidos: Diferidos / Gastos pagados por anticipado
- total_activos_no_corrientes: Total Activos no Corrientes
- total_activos: Total Activos

Campos del Estado de Resultados (P&L):
- ingresos_operacionales: Ventas / Ingresos por servicios
- costo_ventas: Costo de ventas / Costo de servicios
- utilidad_operacional: Utilidad operacional / EBIT
- cuentas_por_pagar: Cuentas por pagar a proveedores
- inventarios: Inventarios / Existencias

Reglas:
· Si una cifra aparece entre paréntesis o con signo negativo, devuélvela con signo negativo.
· Regla de escala, obligatoria y sin excepción: cada cifra numérica va EXACTAMENTE como aparece impresa en el documento, dígito por dígito — NUNCA la multipliques ni la conviertas tú, así el documento diga "en miles" o "en millones" en el encabezado. Si el documento imprime "28,81" en una columna rotulada "millones", el campo lleva 28.81 — NO 28810000. "unidad_origen" solo describe esa escala impresa para que otra parte del sistema decida qué hacer con ella; no es una instrucción para que tú calcules nada.
· Si un concepto no aparece, usa null. NO estimes, NO deduzcas por diferencia, NO inventes.

Devuelve SOLO este JSON estricto sin marcas markdown:
{
  "periodo": "",
  "moneda": "",
  "unidad_origen": "unidades|miles|millones",
  "ingresos_operacionales": {"valor": 0},
  "costo_ventas": {"valor": 0},
  "utilidad_operacional": {"valor": 0},
  "cuentas_por_cobrar": {"valor": 0},
  "inventarios": {"valor": 0},
  "cuentas_por_pagar": {"valor": 0},
  "efectivo_y_equivalentes": {"valor": 0},
  "inversiones_asociadas": {"valor": 0},
  "activos_impuestos": {"valor": 0},
  "total_activo_corriente": {"valor": 0},
  "propiedad_planta_equipo": {"valor": 0},
  "intangibles": {"valor": 0},
  "diferidos": {"valor": 0},
  "total_activos_no_corrientes": {"valor": 0},
  "total_activos": {"valor": 0}
}`;

/**
 * Prompt especializado para la Ingesta Asistida de EEFF de Empresas Comparables
 */
/* «nombre» e «identificador_fuente» son obligatorios para poder cruzar el
   documento con la comparable a la que pertenece. Sin ellos el sistema no sabe de
   qué empresa es el PDF que acaba de leer, y las cifras entraban en la fila donde
   se hubiera soltado el archivo, fuera o no la correcta. */
export const EEFF_COMPARABLE_PROMPT = `Eres un analista senior de Precios de Transferencia. Lee los Estados Financieros de la empresa comparable y extrae la matriz contable completa.

Devuelve SOLO un JSON estricto con esta estructura:
{
  "nombre": "Razón social EXACTA de la empresa a la que pertenecen estos estados financieros, tal como aparece en el documento. Si no aparece, cadena vacía: no la inventes ni la deduzcas.",
  "identificador_fuente": "Identificador de la empresa si figura (Company ID de Capital IQ, NIT, tax ID). Cadena vacía si no aparece.",
  "periodo": "Año o rango del ejercicio (ej: 2025 o 2024)",
  "moneda": "USD, COP, EUR, etc.",
  "unidad_origen": "unidades|miles|millones",
  "ingresos_operacionales": null,
  "costo_ventas": null,
  "utilidad_bruta": null,
  "gastos_operacionales": null,
  "utilidad_operacional": null,
  "cuentas_por_cobrar": null,
  "inventarios": null,
  "cuentas_por_pagar": null,
  "total_activos": null,
  "total_pasivos": null,
  "patrimonio": null,
  "propiedad_planta_equipo": null,
  "efectivo_y_equivalentes": null,
  "gastos_investigacion_desarrollo": null,
  "gastos_publicidad": null
}

Regla general: si un rubro numérico no aparece en el documento, devuelve null — NUNCA 0. Un 0 se lee como "la empresa reportó cero en este concepto", que es una afirmación falsa cuando en realidad el concepto simplemente no se desglosó. NO estimes, NO deduzcas por diferencia, NO inventes.

Reglas para "gastos_investigacion_desarrollo" y "gastos_publicidad": son rubros OPCIONALES. Úsalos solo si la empresa los desglosa como línea propia en su estado de resultados. Si no aparecen desglosados, devuelve null — NO los deduzcas restando de gastos_operacionales, NO estimes.

Regla de escala, obligatoria y sin excepción: cada cifra numérica va EXACTAMENTE como aparece impresa en el documento, dígito por dígito — NUNCA la multipliques ni la conviertas tú, así el documento diga "en miles" o "en millones" en el encabezado. Si el documento imprime "28,81" en una columna rotulada "millones", el campo lleva 28.81 — NO 28810000. "unidad_origen" solo describe esa escala impresa para que otra parte del sistema decida qué hacer con ella; no es una instrucción para que tú calcules nada.`;

/* Códigos que merecen otro intento. Antes solo se reintentaba el 429 y todo lo demás se
   descartaba de inmediato, así que la lectura de un documento se perdía por un corte
   pasajero: leer un PDF de estados financieros tarda decenas de segundos y compite con el
   techo de 60 s que Firebase Hosting impone al rewrite hacia la función —de ahí los 502 y
   504 en una carga de varios archivos—. Un 400 no entra: es un error de contrato o un
   documento que el modelo rechaza, y repetirlo solo gasta cuota. */
const ESTADOS_REINTENTABLES = [408, 425, 429, 500, 502, 503, 504];

/**
 * Llama a Gemini reintentando los fallos pasajeros.
 *
 * Un documento perdido aquí no es un inconveniente menor: son las cifras de una comparable
 * que se queda fuera del rango intercuartil, y el analista solo lo nota si lee la lista de
 * rechazos.
 */
async function postGeminiWithRetry(payload, maxRetries = 3) {
  let ultimo;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await axios.post('/api/gemini', payload);
    } catch (err) {
      ultimo = err;
      const status = err && err.response ? err.response.status : undefined;
      /* Sin `response` es un fallo de red o una conexión cortada a mitad —que es lo que
         hace el borde de Hosting al agotarse su plazo—: también pasajero. */
      const pasajero = status === undefined || ESTADOS_REINTENTABLES.includes(status);
      if (!pasajero || attempt === maxRetries) break;
      const delayMs = attempt * 3000;
      console.warn(`[Gemini OCR] ${status ? 'HTTP ' + status : 'fallo de red'}. ` +
        `Reintentando en ${delayMs / 1000}s... (Intento ${attempt}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw ultimo;
}

/**
 * Extrae Estados Financieros del Contribuyente con Gemini Vision OCR
 */
export async function parseEeffWithGeminiOCR(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const base64Data = reader.result.split(',')[1];
        let mimeType = 'application/pdf';

        if (file.type.includes('image') || file.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
          mimeType = file.type || 'image/jpeg';
        }

        const payload = {
          model: 'gemini-3.5-flash',
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType, data: base64Data } },
              { text: EEFF_PROMPT }
            ]
          }]
        };

        const response = await postGeminiWithRetry(payload);
        const cand = response.data?.candidates?.[0];
        const text = cand?.content?.parts?.map(p => p.text || '').join('') || '';

        if (text) {
          const cleanJsonStr = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          const parsed = JSON.parse(cleanJsonStr);

          const extractVal = (obj) => {
            if (!obj || typeof obj.valor !== 'number') return null;
            return obj.valor;
          };

          resolve({
            t_s: extractVal(parsed.ingresos_operacionales),
            t_c: extractVal(parsed.costo_ventas),
            t_op: extractVal(parsed.utilidad_operacional),
            t_ar: extractVal(parsed.cuentas_por_cobrar),
            t_inv: extractVal(parsed.inventarios),
            t_ap: extractVal(parsed.cuentas_por_pagar),
            t_cash: extractVal(parsed.efectivo_y_equivalentes),
            t_inv_assoc: extractVal(parsed.inversiones_asociadas),
            t_tax: extractVal(parsed.activos_impuestos),
            t_act_curr: extractVal(parsed.total_activo_corriente),
            t_ppe: extractVal(parsed.propiedad_planta_equipo),
            t_intang: extractVal(parsed.intangibles),
            t_dif: extractVal(parsed.diferidos),
            t_act_nocurr: extractVal(parsed.total_activos_no_corrientes),
            t_act_tot: extractVal(parsed.total_activos),
            periodo: parsed.periodo,
            rawJson: parsed
          });
        } else {
          reject(new Error("No se obtuvo respuesta en formato JSON de Gemini Vision OCR."));
        }
      } catch (err) {
        console.error("Error en parseEeffWithGeminiOCR:", err);
        reject(err);
      }
    };
    reader.onerror = (e) => reject(e);
  });
}

/**
 * Extrae y verifica los EEFF de una Empresa Comparable específica conservando escala/unidad original.
 */
/* Un mismo PDF suele traer los estados financieros de todas las comparables
   seleccionadas, uno tras otro. Este prompt los separa por empresa en vez de
   devolver una sola matriz mezclando cifras de varias. */
export const EEFF_COMPARABLES_LOTE_PROMPT = `Eres un analista senior de Precios de Transferencia. Este documento contiene los Estados Financieros de VARIAS empresas comparables, una tras otra.

Identifica CADA empresa presente y extrae su matriz contable por separado. No mezcles cifras de empresas distintas y no promedies nada.

Devuelve SOLO un JSON estricto con esta estructura:
{
  "empresas": [
    {
      "nombre": "Razón social EXACTA de la empresa, tal como aparece en el documento",
      "identificador_fuente": "Company ID de Capital IQ, NIT o tax ID si figura; cadena vacía si no",
      "pagina_inicio": 1,
      "pagina_fin": 1,
      "periodo": "Año o rango del ejercicio",
      "moneda": "USD, COP, EUR, etc.",
      "unidad_origen": "unidades|miles|millones",
      "ingresos_operacionales": null,
      "costo_ventas": null,
      "utilidad_bruta": null,
      "gastos_operacionales": null,
      "utilidad_operacional": null,
      "cuentas_por_cobrar": null,
      "inventarios": null,
      "cuentas_por_pagar": null,
      "total_activos": null,
      "total_pasivos": null,
      "patrimonio": null,
      "propiedad_planta_equipo": null,
      "efectivo_y_equivalentes": null,
      "gastos_investigacion_desarrollo": null,
      "gastos_publicidad": null
    }
  ]
}

Reglas: una entrada por empresa, en el orden en que aparecen. Si un rubro no figura para una empresa, devuélvelo en null — NUNCA en 0, porque 0 se lee como "la empresa reportó cero" y ese no es el caso cuando el concepto simplemente no aparece. Esto aplica a TODOS los rubros numéricos, incluyendo "gastos_investigacion_desarrollo" y "gastos_publicidad" (que además son OPCIONALES: van en null salvo que la empresa los desglose como línea propia). No estimes ni deduzcas ningún rubro por diferencia. Si el documento resulta contener una sola empresa, devuelve un arreglo de un elemento. "pagina_inicio" y "pagina_fin" son la primera y la última página (1-indexadas) del PDF COMPLETO tal como se envió donde aparecen los estados financieros de esa empresa — no un conteo relativo a la empresa. Si el documento no permite determinarlas con certeza, devuelve null en ambas: no estimes.

Regla de escala, obligatoria y sin excepción, para cada empresa: cada cifra numérica va EXACTAMENTE como aparece impresa para esa empresa, dígito por dígito — NUNCA la multipliques ni la conviertas tú, así su tabla diga "en miles" o "en millones" en el encabezado. Si su tabla imprime "28,81" en una columna rotulada "millones", el campo lleva 28.81 — NO 28810000. "unidad_origen" solo describe esa escala impresa; no es una instrucción para que tú calcules nada.`;

/* ═══════════ Lectura nativa del PDF, antes de gastar un OCR ═══════════

   Los EEFF de las comparables salen de una macro de Word, así que el PDF trae
   capa de texto y no hay por qué pagarle un Vision OCR —que además devolvía las
   filas desordenadas— para leer lo que ya está escrito.

   Tres vías, de la más fiel a la más tolerante:
     1. árbol de estructura (Table/TR/TD) que Word escribe al exportar: da las
        celdas exactas, fila por fila y columna por columna, en el orden del
        documento y sin heurística ninguna. Las fichas individuales lo traen;
        el PDF de lote, no, así que hacen falta las dos vías;
     2. agrupado por coordenadas, cuando hay capa de texto pero no etiquetas;
     3. Vision OCR sobre el documento entero (lo de siempre), cuando no hay
        capa de texto porque el PDF es un escaneo. */

/* Puntos de desfase vertical que siguen siendo la misma fila. Word centra el
   valor frente a una etiqueta de dos líneas, así que la tolerancia no puede ser
   cero, y las filas de estas tablas van a ~16 pt, así que tampoco puede crecer. */
const TOLERANCIA_FILA = 5;
/* Separación horizontal, en múltiplos del alto de la fuente, a partir de la
   cual dos trozos de texto son celdas distintas y no palabras de la misma. */
const FACTOR_SALTO_CELDA = 0.6;
/* Por debajo de esto no hay capa de texto que aprovechar: es un escaneo. */
const MIN_TEXTO_DIGITAL = 100;
/* Tope del texto nativo que se manda en el prompt. */
const LIMITE_TEXTO_NATIVO = 150000;

/* El árbol de estructura no lleva el texto: apunta a identificadores de
   contenido marcado, que getTextContent solo emite con includeMarkedContent. */
function textoPorContenidoMarcado(items) {
  const mapa = new Map();
  const pila = [];
  for (const it of items || []) {
    if (it.type === 'beginMarkedContent' || it.type === 'beginMarkedContentProps') {
      pila.push(it.id || null);
      continue;
    }
    if (it.type === 'endMarkedContent') { pila.pop(); continue; }
    if (typeof it.str !== 'string') continue;
    let id = null;
    for (let i = pila.length - 1; i >= 0 && !id; i--) id = pila[i];
    if (!id) continue;
    /* El salto de línea dentro de una celda llega como un trozo aparte con
       hasEOL: sin conservarlo, "Gastos generales y administrativos" y "(SG&A)"
       —las dos líneas de una misma celda— quedan pegados en una sola palabra. */
    mapa.set(id, (mapa.get(id) || '') + it.str + (it.hasEOL ? '\n' : ''));
  }
  return mapa;
}

/* Texto de un nodo del árbol, en el orden del documento. Cada P es una línea
   dentro de la celda: sin separador, "Gastos generales y administrativos" y
   "(SG&A)" —que Word parte en dos líneas de la misma celda— salen pegados. */
function textoDeNodo(nodo, mapa) {
  const trozos = [];
  const recorrer = (n) => {
    if (!n) return;
    if (n.type === 'content') { if (n.id) trozos.push(mapa.get(n.id) || ''); return; }
    if (n.role === 'P') trozos.push(' ');
    for (const h of n.children || []) recorrer(h);
  };
  recorrer(nodo);
  return trozos.join('').replace(/\s+/g, ' ').trim();
}

const BLOQUES_DE_TEXTO = new Set(['P', 'H', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'Caption', 'LI', 'LBody']);

/* Una línea por fila de tabla (celdas separadas por " | ") y una por párrafo
   suelto, todo en el orden del documento. Devuelve null si la página no trae
   ninguna tabla etiquetada, para que decida el agrupado por coordenadas. */
function lineasDeEstructura(raiz, mapa) {
  const lineas = [];
  let hayTabla = false;
  const recorrer = (nodo, enTabla) => {
    if (!nodo) return;
    if (nodo.role === 'TR') {
      const celdas = (nodo.children || [])
        .filter((c) => c.role === 'TD' || c.role === 'TH')
        .map((c) => textoDeNodo(c, mapa));
      /* Word deja filas y columnas de relleno; una fila sin una sola celda con
         texto solo alarga el prompt. */
      if (celdas.some((t) => t)) lineas.push(celdas.join(' | '));
      return;
    }
    if (!enTabla && BLOQUES_DE_TEXTO.has(nodo.role)) {
      const texto = textoDeNodo(nodo, mapa);
      if (texto) lineas.push(texto);
      return;
    }
    if (nodo.role === 'Table') hayTabla = true;
    for (const h of nodo.children || []) recorrer(h, enTabla || nodo.role === 'Table');
  };
  recorrer(raiz, false);
  return hayTabla ? lineas : null;
}

/* Agrupa los trozos de texto por su coordenada vertical (filas, de arriba a
   abajo) y los ordena por la horizontal (columnas, de izquierda a derecha).
   Sin etiquetas no hay forma de saber dónde empieza cada celda, así que se
   parte por el hueco: dos trozos separados por menos de FACTOR_SALTO_CELDA
   veces el alto de la fuente son la misma celda —así "2025" no sale partido en
   "202 | 5"— y por más, celdas distintas. */
function lineasPorCoordenadas(items) {
  const trozos = [];
  for (const it of items || []) {
    if (!it.str) continue;
    trozos.push({
      x: it.transform[4],
      y: it.transform[5],
      ancho: it.width || 0,
      alto: it.height || Math.abs(it.transform[3]) || 10,
      texto: it.str,
      /* Los trozos de solo espacios no se imprimen, pero dicen que ahí había
         una separación: sin ellos "1" y "AKATSUKI INC." salen pegados. Su ancho
         sí se descarta, porque Word lo estira hasta la columna siguiente y
         entonces el hueco medido saldría negativo. */
      blanco: !it.str.trim(),
    });
  }
  if (trozos.length === 0) return [];

  trozos.sort((a, b) => (Math.abs(a.y - b.y) <= TOLERANCIA_FILA ? a.x - b.x : b.y - a.y));

  const filas = [];
  for (const t of trozos) {
    const ultima = filas[filas.length - 1];
    if (ultima && Math.abs(ultima.y - t.y) <= TOLERANCIA_FILA) ultima.trozos.push(t);
    else filas.push({ y: t.y, trozos: [t] });
  }

  return filas
    .map((fila) => {
      fila.trozos.sort((a, b) => a.x - b.x);
      let linea = '';
      let finAnterior = null;
      let altoAnterior = 0;
      let huboBlanco = false;
      for (const t of fila.trozos) {
        if (t.blanco) { huboBlanco = true; continue; }
        if (finAnterior !== null) {
          const hueco = t.x - finAnterior;
          if (hueco > FACTOR_SALTO_CELDA * Math.max(altoAnterior, t.alto)) linea += ' | ';
          else if (huboBlanco) linea += ' ';
        }
        linea += t.texto;
        finAnterior = t.x + t.ancho;
        altoAnterior = t.alto;
        huboBlanco = false;
      }
      return linea.replace(/\s+/g, ' ').trim();
    })
    .filter((l) => l);
}

/**
 * Devuelve el contenido del PDF como texto: una línea por fila, las celdas
 * separadas por " | " y un marcador por página (el prompt del lote pide
 * pagina_inicio y pagina_fin sobre el PDF completo). Devuelve null si el
 * documento no trae capa de texto aprovechable, para que la lectura caiga al
 * Vision OCR.
 */
export async function extraerTextoEstructuradoPdf(file) {
  let doc = null;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    /* isOffscreenCanvasSupported: false por lo mismo que en pdfReferenceExtractor. */
    doc = await pdfjs.getDocument({ data, isOffscreenCanvasSupported: false }).promise;

    let documento = '';
    let largoUtil = 0;

    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const contenido = await page.getTextContent({ includeMarkedContent: true });

      let lineas = null;
      try {
        const arbol = await page.getStructTree();
        if (arbol) lineas = lineasDeEstructura(arbol, textoPorContenidoMarcado(contenido.items));
      } catch {
        /* PDF sin árbol de estructura utilizable: queda el agrupado por coordenadas. */
      }
      if (!lineas || lineas.length === 0) lineas = lineasPorCoordenadas(contenido.items);
      if (lineas.length === 0) continue;

      documento += `--- PÁGINA ${n} ---\n${lineas.join('\n')}\n\n`;
      largoUtil += lineas.join('').length;
    }

    return largoUtil < MIN_TEXTO_DIGITAL ? null : documento;
  } catch (err) {
    console.warn('[eeffParser] Falló la lectura nativa del PDF; se usará Vision OCR.', err);
    return null;
  } finally {
    /* Sin esto cada comparable de un lote deja su documento en memoria. */
    if (doc) await doc.destroy().catch(() => {});
  }
}

/* ═══════════ Lectura de los EEFF de las comparables ═══════════ */

function esPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

/* Un solo lugar donde se arma la consulta y se lee la respuesta, para que la
   vía nativa y la de OCR no puedan desincronizarse. */
async function pedirJSONaGemini(parts, model, file) {
  const response = await postGeminiWithRetry({ model, contents: [{ parts }] });
  const text = response.data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new Error(`La IA no devolvió nada al leer ${file.name}.`);
  /* extraerJSON escanea llaves balanceadas: quitar las vallas y hacer
     JSON.parse falla en cuanto el modelo añade una frase después del objeto. */
  return extraerJSON(text);
}

/* Dos intentos como máximo: el texto nativo del PDF y, si no cuaja por
   cualquier motivo —incluido un JSON ilegible—, el Vision OCR sobre el
   documento entero. */
async function leerEeffConGemini(file, prompt, model, mapear) {
  const nativo = esPdf(file) ? await extraerTextoEstructuradoPdf(file) : null;
  if (nativo) {
    const encabezado = `${prompt}\n\nCONTENIDO DEL DOCUMENTO, EXTRAÍDO DIRECTAMENTE DEL PDF (una línea por fila, celdas separadas por " | ", en el orden exacto del documento):\n`;
    try {
      return mapear(await pedirJSONaGemini([{ text: encabezado + nativo.slice(0, LIMITE_TEXTO_NATIVO) }], model, file));
    } catch (err) {
      console.warn(`[eeffParser] La lectura del texto nativo de ${file.name} no cuajó; se reintenta con Vision OCR.`, err);
    }
  }
  const parts = [
    { inline_data: { mime_type: mimeDe(file), data: await leerBase64(file) } },
    { text: prompt },
  ];
  return mapear(await pedirJSONaGemini(parts, model, file));
}

/** Lee un PDF (o imagen) que contiene los EEFF de varias comparables y devuelve
 *  una entrada por empresa, cada una con su verificación contable.
 *  Devuelve [] si el documento no permite separar ninguna empresa. */
export async function parseEEFFComparablesLote(file, studyYear) {
  return leerEeffConGemini(file, EEFF_COMPARABLES_LOTE_PROMPT, 'gemini-3-flash-preview', (parsed) => {
    const empresas = Array.isArray(parsed.empresas) ? parsed.empresas : [];
    return empresas
      /* Sin razón social no hay forma de cruzar la entrada con una comparable, y
         aplicarla a ciegas es justo lo que se quiere evitar. */
      .filter((e) => e && (String(e.nombre || '').trim() || String(e.identificador_fuente || '').trim()))
      .map((datos) => ({
        datos,
        verificacion: verifyAccountingEqualities(datos, studyYear),
        archivo: file.name,
      }));
  });
}

/* Extraídos para que la lectura individual y la de lote no dupliquen el manejo
   del archivo. */
function leerBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = (e) => reject(e);
  });
}

function mimeDe(file) {
  if (file.type?.includes('image') || file.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
    return file.type || 'image/jpeg';
  }
  return 'application/pdf';
}

/** Lee los EEFF de una sola comparable. */
export async function parseEEFFComparableOCR(file, studyYear) {
  return leerEeffConGemini(file, EEFF_COMPARABLE_PROMPT, 'gemini-3.5-flash', (data) => ({
    data,
    verificacion: verifyAccountingEqualities(data, studyYear),
    filename: file.name,
  }));
}

/**
 * Verificación Aritmética Automática de Identidades Contables
 */
export function verifyAccountingEqualities(data, studyYear) {
  const hallazgos = [];
  let esValido = true;

  const s = data.ingresos_operacionales || 0;
  const c = Math.abs(data.costo_ventas || 0);
  const ub = data.utilidad_bruta || (s - c);
  const go = data.gastos_operacionales || 0;
  const op = data.utilidad_operacional || 0;
  const at = data.total_activos || 0;
  const pas = data.total_pasivos || 0;
  const pat = data.patrimonio || 0;

  // 1. Verificación U. Bruta = Ventas - Costo
  if (ub !== 0 && Math.abs(ub - (s - c)) > 2) {
    hallazgos.push(`⚠️ Inconsistencia U. Bruta: leída ${ub}, calculada (${s} - ${c}) = ${s - c}`);
    esValido = false;
  }

  // 2. Verificación U. Op = UB - GO
  if (op !== 0 && go !== 0 && Math.abs(op - (ub - go)) > 2) {
    hallazgos.push(`⚠️ Inconsistencia U. Operacional: leída ${op}, calculada (${ub} - ${go}) = ${ub - go}`);
    esValido = false;
  }

  // 3. Verificación Ecuación Patrimonial (Activos = Pasivos + Patrimonio)
  if (at !== 0 && (pas !== 0 || pat !== 0)) {
    if (Math.abs(at - (pas + pat)) > 2) {
      hallazgos.push(`⚠️ Ecuación patrimonial no cuadra: Activos (${at}) ≠ Pasivos (${pas}) + Patrimonio (${pat})`);
      esValido = false;
    }
  }

  // 4. Verificación de Período
  if (studyYear && data.periodo && !String(data.periodo).includes(String(studyYear))) {
    hallazgos.push(`⚠️ El período leído (${data.periodo}) no coincide con el año del estudio (${studyYear}).`);
    esValido = false;
  }

  if (esValido && hallazgos.length === 0) {
    hallazgos.push(`✅ Verificación contable superada. Período: ${data.periodo || studyYear}`);
  }

  return {
    esValido,
    hallazgos
  };
}
