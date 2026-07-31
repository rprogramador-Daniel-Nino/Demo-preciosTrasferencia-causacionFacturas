import * as XLSX from 'xlsx';
import axios from 'axios';
import { num, pliOf } from '../utils/calculations.js';

/**
 * Normaliza nombres de empresas para cruces de continuidad
 */
export function nameKey(str) {
  if (!str) return '';
  return String(str)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(COLOMBIA|INC|INC\.|CORP|CORP\.|LTD|LTD\.|LLC|S\.A\.S\.|SAS|S\.A\.|SA|LTDA|S\.A\. DE C\.V\.|C\.A\.|PLC|NV|GMBH|BV|CO\.|COMPANY|CORPORATION|LIMITED)\b/gi, '')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Parsea archivo de Capital IQ (.xlsx, .xls, .csv)
 */
export async function importCapitalIQExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (!json || json.length < 2) {
          throw new Error('El archivo no contiene suficientes filas.');
        }

        const headers = json[0].map(h => String(h || '').trim().toLowerCase());
        
        // Mapeo flexible de encabezados
        const findCol = (keywords) => headers.findIndex(h => keywords.some(k => h.includes(k)));

        const nameIdx = findCol(['company name', 'compañía', 'empresa', 'razon social', 'nombre']);
        const sIdx = findCol(['total revenue', 'revenue', 'ventas', 'ingresos']);
        const cIdx = findCol(['cost of goods', 'cost of goods sold', 'costo de ventas', 'costos']);
        const opIdx = findCol(['operating income', 'operating profit', 'utilidad operacional', 'ebit']);
        const arIdx = findCol(['accounts receivable', 'cuentas por cobrar', 'cxc']);
        const invIdx = findCol(['total inventory', 'inventarios', 'inventario', 'inv']);
        const apIdx = findCol(['accounts payable', 'cuentas por pagar', 'cxp']);
        const sicIdx = findCol(['primary sic', 'sic', 'ciiu']);
        const idIdx = findCol(['iqid', 'capital iq id', 'company id', 'id']);
        const descIdx = findCol(['business description', 'descripción', 'actividad', 'profile']);
        const countryIdx = findCol(['country', 'país', 'ubicación', 'location']);

        const rows = [];
        for (let i = 1; i < json.length; i++) {
          const row = json[i];
          if (!row || !row[nameIdx]) continue;

          const name = String(row[nameIdx]).trim();
          if (!name) continue;

          const s = sIdx >= 0 ? num(row[sIdx]) : null;
          const c = cIdx >= 0 ? Math.abs(num(row[cIdx]) || 0) : null;
          const op = opIdx >= 0 ? num(row[opIdx]) : null;
          const ar = arIdx >= 0 ? num(row[arIdx]) : null;
          const inv = invIdx >= 0 ? num(row[invIdx]) : null;
          const ap = apIdx >= 0 ? num(row[apIdx]) : null;
          const sic = sicIdx >= 0 ? String(row[sicIdx] || '').trim() : '';
          const idIQ = idIdx >= 0 ? String(row[idIdx] || '').trim() : '';
          const desc = descIdx >= 0 ? String(row[descIdx] || '').trim() : '';
          const country = countryIdx >= 0 ? String(row[countryIdx] || '').trim() : '';

          const isHolding = /\b(holding|inversiones|investment)\b/i.test(name + ' ' + desc);
          const hasNegativeBalance = (ar !== null && ar < 0) || (inv !== null && inv < 0) || (ap !== null && ap < 0);
          const hasLoss = op !== null && op < 0;

          rows.push({
            id: idIQ || `ciq_${i}`,
            name,
            nameKey: nameKey(name),
            amb: country && !/colombia/i.test(country) ? 'Int' : 'Nac',
            country: country || 'Internacional',
            s,
            c,
            op,
            ar,
            inv,
            ap,
            sic,
            desc,
            isHolding,
            hasNegativeBalance,
            hasLoss,
            perfil: op !== null && op > 0 ? 'SERVICIO' : 'INDEFINIDO'
          });
        }

        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Puntuación de candidatas (Motor TOP-N) con 5 criterios ponderados
 */
export function scoreCandidates(candidates, config, companyActivity = '', priorComps = []) {
  const {
    nTarget = 12,
    perdidaOp = 'excluir',
    holding = 'excluir',
    saldoNegativo = 'excluir',
    geo = 'ninguna',
    rigor = 'estandar'
  } = config;

  const priorSet = new Set((priorComps || []).map(c => nameKey(c.name || c)));

  const evaluated = candidates.map(cand => {
    let descartada = false;
    let motivoRechazo = '';

    // Filtros de exclusión
    if (holding === 'excluir' && cand.isHolding) {
      descartada = true;
      motivoRechazo = 'Sociedad holding sin actividad operativa directa.';
    } else if (saldoNegativo === 'excluir' && cand.hasNegativeBalance) {
      descartada = true;
      motivoRechazo = 'Saldo negativo en balances (dato no verosímil).';
    } else if (perdidaOp === 'excluir' && cand.hasLoss) {
      descartada = true;
      motivoRechazo = 'Pérdida operativa (criterio conservador DIAN).';
    }

    // Puntuación
    let score = 0.5;

    // Bono por continuidad del año anterior
    const esContinuidad = priorSet.has(cand.nameKey);
    if (esContinuidad) {
      score += 0.15;
    }

    // Factor geográfico
    if (geo !== 'ninguna') {
      if (geo === 'LATAM' && /colombia|mexico|chile|peru|argentina|brasil/i.test(cand.country)) {
        score += 0.1;
      }
    }

    return {
      ...cand,
      score: Math.min(1.0, score),
      esContinuidad,
      descartada,
      motivoRechazo
    };
  });

  const validas = evaluated.filter(c => !c.descartada).sort((a, b) => b.score - a.score);
  const rechazadas = evaluated.filter(c => c.descartada);

  const seleccionadas = validas.slice(0, nTarget);

  return {
    evaluadas: evaluated.length,
    seleccionadas,
    rechazadas,
    totalValidas: validas.length
  };
}

/**
 * Curación de candidatas enviando descripciones a Gemini Vision/AI API
 */
export async function curateCandidatesWithGemini(candidates, companyActivity) {
  if (!companyActivity || !candidates.length) return candidates;

  const prompt = `Eres un experto en precios de transferencia.
La empresa examinada tiene la siguiente actividad económica real:
"${companyActivity}"

A continuación se lista un conjunto de empresas candidatas con sus descripciones de negocio.
Para cada una, evalúa si su actividad real COINCIDE con la actividad de la empresa examinada.

Candidatas:
${candidates.slice(0, 30).map((c, i) => `${i + 1}. ID: ${c.id} | Nombre: ${c.name} | Desc: ${c.desc || 'Sin descripción'}`).join('\n')}

Devuelve SOLO un JSON estricto:
{
  "evaluacion": [
    { "id": "", "coincide": true, "motivo": "Explicación breve" }
  ]
}`;

  try {
    const response = await axios.post('/api/gemini', {
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: prompt }] }]
    });

    const candText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candText) {
      const cleanJson = candText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleanJson);
      const evalMap = new Map((parsed.evaluacion || []).map(item => [item.id, item]));

      return candidates.map(c => {
        const ev = evalMap.get(c.id);
        if (ev && ev.coincide === false && !c.esContinuidad) {
          return { ...c, descartada: true, motivoRechazo: `Curación IA: ${ev.motivo}` };
        }
        return c;
      });
    }
  } catch (err) {
    console.warn("Curación IA omitida por error o límite API:", err);
  }

  return candidates;
}
