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
const EEFF_COMPARABLE_PROMPT = `Eres un analista senior de Precios de Transferencia. Lee los Estados Financieros de la empresa comparable y extrae la matriz contable completa.

Devuelve SOLO un JSON estricto con esta estructura:
{
  "periodo": "Año o rango del ejercicio (ej: 2025 o 2024)",
  "moneda": "USD, COP, EUR, etc.",
  "unidad_origen": "unidades|miles|millones",
  "ingresos_operacionales": 0,
  "costo_ventas": 0,
  "utilidad_bruta": 0,
  "gastos_operacionales": 0,
  "utilidad_operacional": 0,
  "cuentas_por_cobrar": 0,
  "inventarios": 0,
  "cuentas_por_pagar": 0,
  "total_activos": 0,
  "total_pasivos": 0,
  "patrimonio": 0
}`;

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
