import axios from 'axios';

/**
 * Prompt para la lectura de Estados Financieros (EEFF) por Gemini Vision OCR.
 * Extrae tanto P&L como la matriz completa del Balance General (Activos, Pasivos, Patrimonio).
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
 * Función auxiliar con reintento automático para manejar errores de límite de tasa 429 (Too Many Requests)
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
        console.warn(`[Gemini OCR] HTTP 429 (Límite de peticiones). Reintentando en ${delayMs / 1000}s... (Intento ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Extrae Estados Financieros con Gemini Vision OCR enviando el documento
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
        } else if (file.name.match(/\.(pdf)$/i)) {
          mimeType = 'application/pdf';
        } else {
          mimeType = 'application/pdf';
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

          // Extraer valores absolutos numéricos con factor de escala
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
        if (err.response && err.response.status === 429) {
          reject(new Error("La API de Gemini alcanzó el límite de solicitudes por minuto (Error 429). Por favor espere 10 segundos y vuelva a intentarlo."));
        } else {
          reject(err);
        }
      }
    };
    reader.onerror = (e) => reject(e);
  });
}
