// Calculations and utilities for Transfer Pricing

export const PLIN = {
  'MO': 'Margen Operacional (MO)',
  'MB': 'Margen Bruto (MB)',
  'Berry': 'Razón Berry'
};

export const UVT_VALUES = {
  2023: 42412,
  2024: 47065,
  2025: 49799,
  2026: 52300
};

export function getUvtValue(year) {
  const y = parseInt(year, 10);
  return UVT_VALUES[y] || 47065;
}

export const JURISDICCIONES_D1496_2024 = [
  'svalbard', 'san pedro y miguelon', 'kuwait', 'qatar',
  'samoa occidental', 'queshm', 'pitcairn', 'islas salomon', 'labuan', 'macao', 'bahamas',
  'bahrein', 'jordania', 'guyana', 'angola', 'cabo verde', 'islas marshall', 'liberia',
  'maldivas', 'nauru', 'trinidad y tobago', 'vanuatu', 'yemen', 'santa elena', 'oman'
];

export const PAIS_DIAN = {
  'COLOMBIA': '170', 'RUSIA': '643', 'FEDERACION RUSA': '643',
  'EMIRATOS ARABES': '784', 'EMIRATOS ARABES UNIDOS': '784', 'MEXICO': '484', 'PERU': '604',
  'ECUADOR': '218', 'ARGENTINA': '032', 'BRASIL': '076', 'BOLIVIA': '068', 'CHILE': '152',
  'ALEMANIA': '276', 'ESPANA': '724', 'CHINA': '156', 'INDIA': '356', 'JAPON': '392',
  'COREA DEL SUR': '410', 'PAISES BAJOS': '528', 'SERBIA': '688', 'ESTADOS UNIDOS': '840',
  'TAIWAN': '158', 'AUSTRALIA': '036', 'SUDAFRICA': '710', 'EGIPTO': '818', 'SINGAPUR': '702'
};

export function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^\d.-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export function pctf(v) {
  if (v === null || v === undefined) return '—';
  return (v * 100).toFixed(2) + '%';
}

export function fmt(v) {
  if (v === null || v === undefined) return '—';
  return Math.round(v).toLocaleString('es-CO');
}

export function pliOf(o, kind) {
  if (!o) return null;
  const s = num(o.s);
  if (!s || s === 0) return null;
  if (kind === 'MO') return num(o.op) / s;
  if (kind === 'MB') return (s - num(o.c)) / s;
  if (kind === 'Berry') {
    const c = num(o.c);
    const op = num(o.op);
    const costOfSales = c !== null ? c : 0;
    const opExpenses = (num(o.s) - costOfSales - (op !== null ? op : 0));
    const denom = costOfSales + opExpenses;
    return denom !== 0 ? num(o.s) / denom : null;
  }
  return null;
}

export function ratios(o) {
  if (!o) return null;
  const s = num(o.s);
  const c = num(o.c);
  if (s && o.ar !== null && o.inv !== null) {
    return {
      arS: num(o.ar) / s,
      invS: num(o.inv) / s,
      apC: (c && o.ap !== null) ? num(o.ap) / c : null
    };
  }
  return null;
}

export function quart(s, p) {
  if (!s || !s.length) return 0;
  return s[Math.floor(p * (s.length - 1))];
}

export function adjustInfo(T, tPLI, st, base, unitMult, egresoValue = null) {
  if (!st || tPLI === null) return null;
  const within = tPLI >= st.p25 && tPLI <= st.p75;
  if (within) return { within: true, raw: 0, capped: 0, flag: false };
  
  let raw = (st.med - tPLI) * base * unitMult;
  const egreso = num(egresoValue);
  let capped = raw, flag = false;
  if (egreso !== null && egreso > 0 && Math.abs(raw) > egreso) {
    capped = Math.sign(raw) * egreso;
    flag = true;
  }
  let improcedente = false;
  if (raw < 0) {
    capped = 0;
    flag = false;
    improcedente = true;
  }
  return {
    within: false,
    raw,
    capped,
    flag,
    improcedente,
    dir: tPLI < st.p25 ? 'por debajo' : 'por encima'
  };
}

const _sinAc = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function checkJurisdiccionD1496(pais) {
  const p = _sinAc(pais);
  if (!p) return false;
  return JURISDICCIONES_D1496_2024.some(k => p.includes(k) || k.includes(p));
}

export function paisCodigo(n) {
  const k = _sinAc(n).toUpperCase();
  if (!k) return '';
  if (PAIS_DIAN[k]) return PAIS_DIAN[k];
  for (const p in PAIS_DIAN) {
    if (k.includes(p) || p.includes(k)) return PAIS_DIAN[p];
  }
  return '';
}
