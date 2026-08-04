import axios from 'axios';

/**
 * Prompt para la lectura de Estados Financieros del Contribuyente por Gemini Vision OCR.
 */
const EEFF_PROMPT = `Eres un contador público que lee estados financieros colombianos preparados bajo NIIF.
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
· Devuelve los valores en UNIDADES de la moneda. Si el estado está expresado en miles o millones, multiplica y di en qué unidad venía.
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

Reglas para "gastos_investigacion_desarrollo" y "gastos_publicidad": son rubros OPCIONALES. Úsalos solo si la empresa los desglosa como línea propia en su estado de resultados. Si no aparecen desglosados, devuelve null — NO los deduzcas restando de gastos_operacionales, NO estimes.`;

/**
 * Función auxiliar con reintento automático para manejar errores de límite de tasa 429
 */
async function postGeminiWithRetry(payload, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post('/api/gemini', payload);
      return response;
    } catch (err) {
      const is429 = err.response && err.response.status === 429;
      if (is429 && attempt < maxRetries) {
        const delayMs = attempt * 3000;
        console.warn(`[Gemini OCR] HTTP 429. Reintentando en ${delayMs / 1000}s... (Intento ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        throw err;
      }
    }
  }
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
          model: 'gemini-3-flash-preview',
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
            let v = obj.valor;
            if (parsed.unidad_origen === 'miles') v *= 1000;
            if (parsed.unidad_origen === 'millones') v *= 1000000;
            return v;
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

Reglas: una entrada por empresa, en el orden en que aparecen. Si un rubro no figura para una empresa, devuélvelo en null — NUNCA en 0, porque 0 se lee como "la empresa reportó cero" y ese no es el caso cuando el concepto simplemente no aparece. Esto aplica a TODOS los rubros numéricos, incluyendo "gastos_investigacion_desarrollo" y "gastos_publicidad" (que además son OPCIONALES: van en null salvo que la empresa los desglose como línea propia). No estimes ni deduzcas ningún rubro por diferencia. Si el documento resulta contener una sola empresa, devuelve un arreglo de un elemento.`;

/** Lee un PDF (o imagen) que contiene los EEFF de varias comparables y devuelve
 *  una entrada por empresa, cada una con su verificación contable.
 *  Devuelve [] si el documento no permite separar ninguna empresa. */
export async function parseEEFFComparablesLote(file, studyYear) {
  const base64Data = await leerBase64(file);
  const mimeType = mimeDe(file);

  const payload = {
    model: 'gemini-3-flash-preview',
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64Data } },
        { text: EEFF_COMPARABLES_LOTE_PROMPT },
      ],
    }],
  };

  const response = await postGeminiWithRetry(payload);
  const text = response.data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new Error('La IA no devolvió nada al leer el documento de comparables.');

  const cleanJson = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(cleanJson);
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

export async function parseEEFFComparableOCR(file, studyYear) {
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
          model: 'gemini-3-flash-preview',
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType, data: base64Data } },
              { text: EEFF_COMPARABLE_PROMPT }
            ]
          }]
        };

        const response = await postGeminiWithRetry(payload);
        const text = response.data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

        if (text) {
          const cleanJson = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          const data = JSON.parse(cleanJson);

          const verificacion = verifyAccountingEqualities(data, studyYear);

          resolve({
            data,
            verificacion,
            filename: file.name
          });
        } else {
          reject(new Error("No se pudo obtener el JSON de EEFF de la comparable."));
        }
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (e) => reject(e);
  });
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
