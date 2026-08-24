import axios from 'axios';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { num } from '../utils/calculations.js';
import { extraerJSON } from './comparablesEngine.js';
import { extraerTextoPdf } from './eeffTextoPdf.js';

/* Dos lecturas del PDF nativo conviven en este archivo y hay que saber cuál es cuál:
   `extraerTextoEstructuradoPdf` (de aquí abajo) lee las FICHAS DE LAS COMPARABLES, que
   salen de una macro de Word y traen árbol de estructura con sus celdas; `extraerTextoPdf`
   (en eeffTextoPdf.js) lee el ESTADO FINANCIERO DEL CONTRIBUYENTE, que es un PDF cualquiera
   del contador del cliente. Son el mismo problema resuelto para dos documentos distintos, y
   la unificación queda pendiente con su propio spec — no dentro de un merge. */
if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
  ).href;
}

/**
 * Prompt para la lectura de Estados Financieros del Contribuyente.
 *
 * ── Qué se lee, y por qué (alcance fijado por el usuario, 2026-08-21; ampliado 2026-08-24) ──
 *
 * Del ESTADO DE SITUACIÓN FINANCIERA se toman: cuentas por cobrar y por pagar A PARTES
 * RELACIONADAS (no las comerciales, porque la operación bajo estudio es con la vinculada —
 * el propio estado lo confirma: en su flujo de efectivo, la línea «Aumento / disminución en
 * proveedores» es exactamente la variación de las cuentas por pagar a partes relacionadas),
 * inventarios, el total del activo corriente, el total general de activos y propiedad,
 * planta y equipo — esta última desde el caso de Symtek (2026-08-24): dejarla 100% manual
 * hacía que un PP&E real se tratara como cero por omisión en los ajustes que lo usan, a
 * diferencia del caso que fijó el alcance original (Montachem), donde sí era cero.
 *
 * Del ESTADO DE RESULTADOS se toman los ingresos de actividades ordinarias y el costo de
 * ventas (con una excepción angosta para sumar renglones de costo desglosado — ver su propia
 * definición abajo). La utilidad operacional del estudio NO se lee como fuente primaria de
 * ninguna fila: se CALCULA
 *
 *     gastos operativos    = gastos de ventas + gastos de administración
 *     utilidad operacional = ingresos − costo de ventas − gastos operativos
 *
 * y por eso se piden esos dos rubros de gasto por separado en vez de un total.
 *
 * Calcularla es lo que cierra el defecto que motivó todo esto: la versión anterior leía la
 * fila que el documento rotulara «resultado de la operación», y en el estado de Montachem
 * 2025 esa fila (−2.986.236.031) es en realidad el total de los gastos operativos. Se
 * publicaban 4.877.416.281 de gastos y un margen operacional de tres dígitos. Con la
 * utilidad derivada de cifras que no se pueden confundir —ingresos, costo y los dos gastos
 * del giro— ningún rótulo engañoso puede volver a decidirla por sí solo.
 *
 * La fila impresa SÍ se pide, bajo otro nombre (utilidad_operacional_impresa) y solo como
 * último recurso: el caso de Symtek (2026-08-24) mostró que el cálculo analítico, aunque
 * completo, puede no cuadrar con la utilidad bruta impresa cuando el documento reconoce un
 * ingreso (p. ej. un diferido NIIF) que no está en los ingresos de actividades ordinarias.
 * `eeffVerificacion.js` recurre entonces a la fila impresa, pero solo si supera las mismas
 * verificaciones que hubieran atrapado el defecto de Montachem (no se parece al total de
 * gastos; sí cuadra con utilidad bruta − gastos).
 */
export const EEFF_PROMPT = `Eres un contador público que lee estados financieros colombianos preparados bajo NIIF.
Extrae ÚNICAMENTE los rubros que se piden abajo. No devuelvas ningún otro.

REGLA CENTRAL: transcribe, no interpretes. Cada cifra que devuelvas debe estar impresa en el documento, dígito por dígito. Si un concepto no aparece, va en null. NO estimes, NO deduzcas por diferencia, NO inventes, NO sumes varias filas para armar un rubro.

Para CADA campo devuelve un objeto {"valor": <número o null>, "rotulo": "<el texto EXACTO de la fila del documento de donde tomaste la cifra, o cadena vacía si el campo va en null>"}.
El rótulo es obligatorio cuando hay valor: es lo que permite revisar si la fila que elegiste es la correcta.

── ESTADO DE SITUACIÓN FINANCIERA ──
· cuentas_por_cobrar_relacionadas: cuentas por cobrar A PARTES RELACIONADAS, a vinculados, a compañías del grupo, a la matriz o a subsidiarias. NO uses aquí los deudores comerciales, los clientes ni las «otras cuentas por cobrar» con terceros: si el documento solo trae esas, este campo va en null.
· inventarios: inventarios, existencias, mercancías.
· cuentas_por_pagar_relacionadas: cuentas por pagar A PARTES RELACIONADAS, a vinculados, a compañías del grupo, a la matriz o a subsidiarias. NO uses aquí proveedores de terceros, acreedores comerciales ni «otras cuentas por pagar»: si el documento solo trae esas, este campo va en null.
· total_activo_corriente: el subtotal del activo corriente, tal como el documento lo imprime.
· total_activos: el total general de activos ("Total Activo", "Total de activos", "TOTAL ACTIVOS"), tal como el documento lo imprime.
· propiedad_planta_equipo: propiedad, planta y equipo, activos fijos, inmuebles maquinaria y equipo — el NETO (después de depreciación acumulada), tal como el documento lo imprime.

── ACTIVOS: DETALLE COMPLETO, PARA LA TABLA DE ACTIVOS DEL INFORME ──
Distintos estados financieros traen distintas filas de activo (uno trae "Inversiones asociadas", otro "Activos financieros", otro separa "Cuentas por cobrar a partes relacionadas" de las comerciales), así que además de las partidas de arriba se pide la sección ACTIVOS completa:

"activos_detalle": TODAS las filas de la sección ACTIVOS (activo corriente y activo no corriente), en el ORDEN EXACTO en que aparecen en el documento. Cada fila:
  {"rotulo": "<texto EXACTO de la fila>", "valor": <número o null>, "es_subtotal": true|false}
Incluye los subtotales de cada grupo ("Total Activo Corriente", "Total Activo No Corriente") con "es_subtotal": true. NO agrupes ni renombres filas: cada una lleva el rótulo tal como el documento lo imprime. NO omitas ninguna fila que traiga cifra. Un título de sección sin cifra propia (p. ej. "Activos corrientes" como encabezado, sin número al frente) no es una fila de este arreglo: no la incluyas.

── ESTADO DE RESULTADOS ──
· ingresos_operacionales: ingresos de actividades ordinarias, ventas netas, ingresos operacionales, ingresos por servicios.
· costo_ventas: costo de ventas, costo de los servicios prestados, costo de mercancía vendida.
  EXCEPCIÓN a la regla central de no sumar filas, solo para este campo: si el documento NO imprime un total consolidado de "Costo de Ventas" y en cambio lo desglosa en varios renglones de costo del giro (por ejemplo "Costo de servicios prestados" + "Costo de venta de mercancía", o con "Costo de producción"), suma esos renglones y devuelve el total en costo_ventas. Esta excepción es SOLO para costo_ventas: si el documento ya imprime un total consolidado, transcríbelo tal cual y no sumes nada; y ningún otro campo de este prompt admite sumar filas.
· gastos_ventas: gastos de ventas, gastos de ventas y distribución, gastos comerciales.
· gastos_administracion: gastos de administración, gastos administrativos.
· utilidad_bruta: la utilidad o ganancia bruta, si el documento la imprime como fila propia.
· utilidad_operacional_impresa: la utilidad, ganancia o resultado operacional, SI el documento la imprime como fila propia (por ejemplo "Utilidad Operacional", "Ganancia Operacional", "Resultado de Actividades de la Operación"). Transcríbela tal cual esté impresa, con su rótulo exacto. NO la calcules ni la deduzcas: si no aparece como fila propia, va en null.

El sistema NO usa esta fila como la utilidad operacional del estudio: la calcula como ingresos menos costo de ventas menos la suma de los dos rubros de gasto, y solo si ese cálculo falla o no cuadra con la utilidad bruta recurre a la fila impresa, verificándola contra el resto del estado antes de usarla — hay estados donde ese rótulo acompaña al total de los gastos y no a la utilidad, y esa confusión es la que ese cálculo evita. Por eso se pide igual: es el último recurso, no la primera fuente.
Tampoco se piden «otros gastos» ni «otros ingresos»: quedan fuera de los gastos operativos a propósito.

── RUBROS SIN ASIGNAR ──
"rubros_no_asignados": las filas del estado de situación financiera con cifra que NO hayas usado en los campos de arriba y que sean partidas de capital de trabajo o de gasto — deudores comerciales, otras cuentas por cobrar, proveedores, otras cuentas por pagar, otros gastos—, con su rótulo literal. Sirve para que el analista vea qué quedó fuera y decida. NO incluyas los totales ni los subtotales.

── REGLAS DE TRANSCRIPCIÓN ──
· Si una cifra aparece entre paréntesis o con signo negativo, devuélvela con signo negativo, tal como está impresa.
· Una raya, un guion o una celda vacía significan que no hay cifra: eso es null, no cero. Un cero explícito impreso sí es 0.
· Regla de escala, obligatoria y sin excepción: cada cifra numérica va EXACTAMENTE como aparece impresa en el documento, dígito por dígito — NUNCA la multipliques ni la conviertas tú, así el documento diga "en miles" o "en millones" en el encabezado. Si el documento imprime "28,81" en una columna rotulada "millones", el campo lleva 28.81 — NO 28810000. "unidad_origen" solo describe esa escala impresa para que otra parte del sistema decida qué hacer con ella; no es una instrucción para que tú calcules nada.

Devuelve SOLO este JSON, sin marcas markdown:
{
  "periodo": "el año o ejercicio de la columna que leíste",
  "moneda": "COP, USD, etc.",
  "unidad_origen": "unidades|miles|millones",
  "cuentas_por_cobrar_relacionadas": {"valor": null, "rotulo": ""},
  "inventarios": {"valor": null, "rotulo": ""},
  "cuentas_por_pagar_relacionadas": {"valor": null, "rotulo": ""},
  "total_activo_corriente": {"valor": null, "rotulo": ""},
  "total_activos": {"valor": null, "rotulo": ""},
  "propiedad_planta_equipo": {"valor": null, "rotulo": ""},
  "ingresos_operacionales": {"valor": null, "rotulo": ""},
  "costo_ventas": {"valor": null, "rotulo": ""},
  "gastos_ventas": {"valor": null, "rotulo": ""},
  "gastos_administracion": {"valor": null, "rotulo": ""},
  "utilidad_bruta": {"valor": null, "rotulo": ""},
  "utilidad_operacional_impresa": {"valor": null, "rotulo": ""},
  "rubros_no_asignados": [{"rotulo": "", "valor": null}],
  "activos_detalle": [{"rotulo": "", "valor": null, "es_subtotal": false}]
}`;

/**
 * El prompt del contribuyente para un año gravable concreto.
 *
 * Los estados financieros colombianos son comparativos: imprimen el ejercicio y el
 * anterior en dos columnas contiguas. El prompt anterior decía «del ejercicio más reciente
 * que aparezca», que acierta solo cuando el estudio es del último año cerrado — y falla en
 * silencio, con cifras internamente coherentes, cuando se está trabajando un año anterior.
 * Nada las delataba después: cuadran entre sí, porque son las de otro ejercicio.
 */
export function promptEeffContribuyente(anio) {
  const anioLimpio = String(anio || '').trim();
  if (!anioLimpio) return EEFF_PROMPT;
  return `${EEFF_PROMPT}

── AÑO A EXTRAER: ${anioLimpio} ──
El documento es comparativo y trae más de una columna de ejercicios. Extrae ÚNICAMENTE la columna del año ${anioLimpio} e ignora por completo las demás. Devuelve "${anioLimpio}" en "periodo" si esa columna existe; si el documento NO trae una columna del ${anioLimpio}, devuelve en "periodo" el año que sí leíste, para que el sistema pueda advertirlo. No mezcles cifras de dos columnas.`;
}

/**
 * El texto del documento, si lo tiene, formateado para el prompt.
 *
 * Se manda ADEMÁS de la imagen, no en su lugar: la imagen conserva la disposición de las
 * columnas —que es lo que permite saber qué cifra es de qué año— y el texto aporta los
 * dígitos exactos. Un PDF escaneado no tiene capa de texto y entonces esto no aporta nada
 * y se omite, quedando la lectura como era antes.
 */
export function bloqueDeTexto(texto) {
  if (!texto || !String(texto).trim()) return null;
  return `A continuación, la capa de texto del MISMO documento, extraída directamente del PDF. Los dígitos de aquí son exactos: úsalos para transcribir las cifras, y usa la imagen para entender la disposición de las columnas y a qué año pertenece cada una. Si el texto y la imagen discrepan, manda el texto.

<texto_del_documento>
${texto}
</texto_del_documento>`;
}

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
  "gastos_generales_administrativos": null,
  "depreciacion": null,
  "utilidad_operacional": null,
  "cuentas_por_cobrar": null,
  "inventarios": null,
  "cuentas_por_pagar": null,
  "total_activos": null,
  "activos_operativos": null,
  "total_pasivos": null,
  "patrimonio": null,
  "propiedad_planta_equipo": null,
  "efectivo_y_equivalentes": null,
  "otras_inversiones": null,
  "gastos_investigacion_desarrollo": null,
  "gastos_publicidad": null
}

Regla general: si un rubro numérico no aparece en el documento, devuelve null — NUNCA 0. Un 0 se lee como "la empresa reportó cero en este concepto", que es una afirmación falsa cuando en realidad el concepto simplemente no se desglosó. NO estimes, NO deduzcas por diferencia, NO inventes.

Reglas para "gastos_investigacion_desarrollo" y "gastos_publicidad": son rubros OPCIONALES. Úsalos solo si la empresa los desglosa como línea propia en su estado de resultados. Si no aparecen desglosados, devuelve null — NO los deduzcas restando de gastos_operacionales, NO estimes.

Regla para "otras_inversiones": las inversiones DISTINTAS del efectivo y sus equivalentes —inversiones a corto o largo plazo, instrumentos financieros, participaciones en otras sociedades—, cuando el documento las presenta como línea propia. Si no figuran, null: no las sumes al efectivo ni las deduzcas de ningún total.

Reglas para "gastos_generales_administrativos", "depreciacion" y "activos_operativos": son las tres filas que la ficha imprime y que antes no se pedian. "gastos_generales_administrativos" son los gastos generales y administrativos (SG&A) cuando la empresa los desglosa como linea propia. "depreciacion" es la depreciacion —y la amortizacion si van en la misma linea— cuando figura como linea propia del estado de resultados. "activos_operativos" es el subtotal de activos operativos cuando el documento lo imprime. Las tres van en null si no figuran: NO las deduzcas restando ni las repartas desde otro rubro.

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

/* Las cifras que la lectura devuelve y el campo del estudio al que van.

   El alcance lo fijó el usuario el 2026-08-21, después de una primera versión que leía los
   quince rubros del balance: de la situación financiera se toman las partidas de PARTES
   RELACIONADAS (no las comerciales), el subtotal del activo corriente, el total general de
   activos y, desde el caso de Symtek (2026-08-24), PP&E — antes 100% manual, lo que dejaba
   en cero por omisión el PP&E de un estudio con esa partida significativa.

   La elección de partes relacionadas no es un detalle de nomenclatura. En este estudio la
   operación vinculada es con la matriz, y el propio estado financiero lo confirma: en su
   flujo de efectivo, la línea «Aumento / disminución en proveedores» (−135.245.675) es
   exactamente la variación de CUENTAS POR PAGAR A PARTES RELACIONADAS (5.400.016.795 −
   5.535.262.470). El proveedor es la vinculada, así que el capital de trabajo que el ajuste
   debe neutralizar es el de esas partidas y no el de los deudores comerciales con terceros.

   Se escribe una sola vez, aquí, y de ella salen el mapeo y la verificación. */
export const CAMPO_POR_RUBRO = {
  ingresos_operacionales: 't_s',
  costo_ventas: 't_c',
  cuentas_por_cobrar_relacionadas: 't_ar',
  inventarios: 't_inv',
  cuentas_por_pagar_relacionadas: 't_ap',
  total_activo_corriente: 't_act_curr',
  /* El total general de activos, aparte de las tres partidas de partes relacionadas: lo
     necesita `verticalSobreActivos()` como denominador del A.V. de la Tabla 10, y no lo
     alimenta ninguna otra partida — es universal a cualquier balance, a diferencia del
     detalle de `activos_detalle`, que varía de un EEFF a otro. */
  total_activos: 't_act_tot',
  /* Universal igual que el total de activos: no depende de con quién sea la operación. Antes
     era 100% manual (ver el comentario que acompañaba a `RUBROS_MANUALES` en
     `IngestaCifras.jsx`) porque el caso que fijó el alcance (Montachem) tenía el equipo
     totalmente depreciado y en cero; para una compañía con PP&E real, dejarlo en manual lo
     trataba como cero por omisión en los ajustes que lo usan. */
  propiedad_planta_equipo: 't_ppe',
};

/* Los rubros que NO son campos del estudio pero se leen porque de ellos sale la utilidad
   operacional (o, en su defecto, su fallback). Por decisión del usuario (2026-08-21) la
   utilidad operacional NO se lee como fuente primaria de ninguna fila, se CALCULA, y los
   gastos operativos son la suma de los dos rubros de gasto del giro:

     gastos operativos   = gastos de ventas + gastos de administración
     utilidad operacional = ventas netas − costo de ventas − gastos operativos

   Con eso, la fila que el documento rotule «resultado de la operación» deja de decidir el
   margen por sí sola —y era justo la que en el estado de Montachem 2025 traía el total de
   los gastos en lugar de la utilidad, y hacía que el libro publicara 4.877.416.281 de gastos
   operativos—. Quedan fuera del cálculo «otros gastos» y «otros ingresos»: la definición del
   usuario son los dos rubros del giro, y en ese estado esa diferencia es de 4.051.927 pesos.

   `utilidad_bruta` se sigue leyendo para advertir si el costo o las ventas no cuadran con lo
   que el documento imprime, y también como la identidad contra la que se valida cualquier
   utilidad operacional antes de aplicarla.

   `utilidad_operacional_impresa` se agregó el 2026-08-24 (caso Symtek): la fila impresa, SI
   el documento la trae, para que `eeffVerificacion.js` la use como último recurso cuando el
   cálculo analítico falla o no cuadra con la utilidad bruta — verificada primero contra el
   resto del estado (no se parece al total de gastos; sí cuadra con utilidad bruta − gastos),
   así que el defecto de Montachem sigue cerrado. Ninguno de los dos entra en ningún campo
   del estudio directamente: `eeffVerificacion.js` decide. */
export const RUBROS_DE_COTEJO = [
  'gastos_ventas',
  'gastos_administracion',
  'utilidad_bruta',
  'utilidad_operacional_impresa',
];

/**
 * El valor de un rubro de la respuesta, sea la forma que sea.
 *
 * Sustituye a un `extractVal` que exigía `typeof obj.valor === 'number'` y devolvía null
 * en cuanto el modelo respondía `{"valor": "337.546.138"}` o el número plano
 * `337546138` — dos formas que da con frecuencia, y las dos se descartaban en silencio
 * dejando la celda del libro en cero. La ruta de comparables no tenía el problema porque
 * pasaba el valor crudo y `num()` lo rescataba después; esta era la única asimétrica.
 */
export function valorDeRubro(rubro) {
  if (rubro === null || rubro === undefined) return null;
  if (typeof rubro === 'object') return num(rubro.valor);
  return num(rubro);
}

/** El rótulo literal con que el documento imprimió ese rubro, si vino. */
export function rotuloDeRubro(rubro) {
  if (!rubro || typeof rubro !== 'object') return '';
  return String(rubro.rotulo || '').trim();
}

/**
 * Lee los estados financieros del contribuyente.
 *
 * Manda las páginas rasterizadas Y la capa de texto del PDF cuando la tiene: el texto da
 * los dígitos exactos y la imagen la disposición de las columnas. Devuelve los campos
 * `t_*` del estudio, los rubros de cotejo, los rótulos de origen y el texto extraído, que
 * es lo que `eeffVerificacion.js` necesita para comprobar que cada cifra existe de verdad
 * en el documento.
 *
 * `anioEstudio` no es opcional en la práctica: sin él, un documento comparativo se lee por
 * la columna que el modelo elija.
 */
export async function parseEeffWithGeminiOCR(file, anioEstudio) {
  const base64Data = await leerBase64(file);
  const mimeType = mimeDe(file);
  const textoPdf = await extraerTextoPdf(file);

  const partes = [
    { inline_data: { mime_type: mimeType, data: base64Data } },
    { text: promptEeffContribuyente(anioEstudio) },
  ];
  const conTexto = bloqueDeTexto(textoPdf);
  if (conTexto) partes.push({ text: conTexto });

  const response = await postGeminiWithRetry({
    model: 'gemini-3.5-flash',
    contents: [{ parts: partes }],
  });

  const text = response.data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new Error('No se obtuvo respuesta en formato JSON de Gemini Vision OCR.');

  /* `extraerJSON` y no un `replace` de fences: el modelo agrega prosa antes o después del
     objeto con frecuencia, y entonces `JSON.parse` sobre el texto recortado a mano
     revienta y se pierde la lectura completa del documento (ver comparablesEngine.js). */
  const parsed = extraerJSON(text);
  if (!parsed) throw new Error('La respuesta de la lectura de estados financieros no traía un JSON reconocible.');

  const lectura = {};
  Object.entries(CAMPO_POR_RUBRO).forEach(([rubro, campo]) => {
    lectura[campo] = valorDeRubro(parsed[rubro]);
  });

  const cotejo = {};
  RUBROS_DE_COTEJO.forEach((rubro) => { cotejo[rubro] = valorDeRubro(parsed[rubro]); });

  const rotulos = {};
  [...Object.keys(CAMPO_POR_RUBRO), ...RUBROS_DE_COTEJO].forEach((rubro) => {
    const r = rotuloDeRubro(parsed[rubro]);
    if (r) rotulos[rubro] = r;
  });

  return {
    ...lectura,
    /* `t_op` NO se llena aquí. El estudio lo guarda como utilidad operacional y el libro
       lo necesita como gastos, y cuál de las dos cosas es la que cuadra con el resto del
       estado lo decide `eeffVerificacion.js` a partir de los rubros de cotejo — no el
       rótulo de una sola fila, que es justo lo que llevó a publicar 4.877.416.281 como
       gastos operativos de un estado que dice 2.986.236.031. */
    cotejo,
    rotulos,
    rubrosNoAsignados: Array.isArray(parsed.rubros_no_asignados)
      ? parsed.rubros_no_asignados
        .map((r) => ({
          rotulo: String((r && r.rotulo) || '').trim(),
          valor: valorDeRubro(r && r.valor !== undefined ? r.valor : null),
          seccion: String((r && r.seccion) || '').trim(),
        }))
        .filter((r) => r.rotulo && r.valor !== null)
      : [],
    /* El detalle completo de la sección ACTIVOS, tal como el documento la imprime: es lo
       que alimenta la Tabla 10 y el ANEXO A sin importar qué estructura de balance traiga
       cada EEFF (ver eeffVerificacion.js, que la verifica fila por fila contra el texto). */
    activosDetalle: Array.isArray(parsed.activos_detalle)
      ? parsed.activos_detalle
        .map((r) => ({
          etiqueta: String((r && r.rotulo) || '').trim(),
          valor: valorDeRubro(r && r.valor !== undefined ? r.valor : null),
          esSubtotal: Boolean(r && r.es_subtotal),
        }))
        .filter((r) => r.etiqueta)
      : [],
    periodo: parsed.periodo,
    unidadOrigen: String(parsed.unidad_origen || '').trim().toLowerCase(),
    moneda: parsed.moneda,
    textoPdf,
    rawJson: parsed,
  };
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
      "gastos_generales_administrativos": null,
      "depreciacion": null,
      "utilidad_operacional": null,
      "cuentas_por_cobrar": null,
      "inventarios": null,
      "cuentas_por_pagar": null,
      "total_activos": null,
      "activos_operativos": null,
      "total_pasivos": null,
      "patrimonio": null,
      "propiedad_planta_equipo": null,
      "efectivo_y_equivalentes": null,
      "otras_inversiones": null,
      "gastos_investigacion_desarrollo": null,
      "gastos_publicidad": null
    }
  ]
}

Reglas: una entrada por empresa, en el orden en que aparecen. Si un rubro no figura para una empresa, devuélvelo en null — NUNCA en 0, porque 0 se lee como "la empresa reportó cero" y ese no es el caso cuando el concepto simplemente no aparece. Esto aplica a TODOS los rubros numéricos, incluyendo "gastos_investigacion_desarrollo" y "gastos_publicidad" (que además son OPCIONALES: van en null salvo que la empresa los desglose como línea propia). No estimes ni deduzcas ningún rubro por diferencia. Si el documento resulta contener una sola empresa, devuelve un arreglo de un elemento. "pagina_inicio" y "pagina_fin" son la primera y la última página (1-indexadas) del PDF COMPLETO tal como se envió donde aparecen los estados financieros de esa empresa — no un conteo relativo a la empresa. Si el documento no permite determinarlas con certeza, devuelve null en ambas: no estimes.

Regla para "otras_inversiones": las inversiones DISTINTAS del efectivo y sus equivalentes —inversiones a corto o largo plazo, instrumentos financieros, participaciones en otras sociedades—, cuando el documento las presenta como línea propia. Si no figuran, null: no las sumes al efectivo ni las deduzcas de ningún total.

Reglas para "gastos_generales_administrativos", "depreciacion" y "activos_operativos": son las tres filas que la ficha imprime y que antes no se pedian. "gastos_generales_administrativos" son los gastos generales y administrativos (SG&A) cuando la empresa los desglosa como linea propia. "depreciacion" es la depreciacion —y la amortizacion si van en la misma linea— cuando figura como linea propia del estado de resultados. "activos_operativos" es el subtotal de activos operativos cuando el documento lo imprime. Las tres van en null si no figuran: NO las deduzcas restando ni las repartas desde otro rubro.

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
async function leerBase64(file) {
  if (typeof FileReader === 'undefined') {
    const arrayBuffer = await file.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
  }
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

  /* 3. Ecuación patrimonial (Activos = Pasivos + Patrimonio), solo cuando los TRES
     términos están impresos.

     Se pide presencia y no verdad: los `|| 0` de arriba sirven para calcular, pero
     borran la distinción entre «no aparece» y «la empresa reportó cero», que es
     justo la que decide si esta identidad se puede comprobar. El prompt la garantiza
     —null para lo ausente, 0 solo para el cero reportado—, así que aquí se lee del
     dato crudo.

     Las fichas que la macro de Word produce para el Anexo B imprimen «Total de
     activos» y «Total de pasivos» y NINGUNA fila de patrimonio. Con la guarda
     anterior, `(pas !== 0 || pat !== 0)` se cumplía por los pasivos y la identidad
     fallaba siempre: un estudio de 12 comparables salía con 12 «Con Alertas» por una
     ecuación que sin patrimonio no es comprobable, y el aviso de verdad quedaba
     enterrado en ese ruido. */
  const hayPasivos = num(data.total_pasivos) !== null;
  const hayPatrimonio = num(data.patrimonio) !== null;
  if (at !== 0 && hayPasivos && hayPatrimonio) {
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
