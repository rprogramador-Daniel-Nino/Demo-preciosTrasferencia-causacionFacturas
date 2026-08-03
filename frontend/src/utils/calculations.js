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

/**
 * Convierte a número lo que escriben los analistas y lo que traen los archivos.
 *
 * La versión anterior hacía String(v).replace(/[^\d.-]/g,'') + parseFloat, que
 * con "2.761.202.249" devolvía 2,761 —parseFloat se detiene en el segundo punto—
 * y con "(1.500)" devolvía 1.500 en positivo. Sobre cifras de estados financieros
 * eso falsea el margen sin avisar.
 *
 * Reglas, las mismas que aplica el monolito:
 *  · paréntesis o signo menos → negativo
 *  · si hay punto y coma, el ÚLTIMO manda: "1.234,56" es coma decimal,
 *    "1,234.56" es punto decimal
 *  · si solo hay un separador, se decide por la forma de los grupos: "27.255.376"
 *    y "1,234" son miles; "1,5" y "1.5" son decimales
 *  · se descartan el símbolo de moneda, los espacios y el porcentaje
 */
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;

  let s = String(v).trim();
  if (!s) return null;

  let negativo = false;
  const enParentesis = /^\((.*)\)$/.exec(s);
  if (enParentesis) { negativo = true; s = enParentesis[1]; }

  s = s.replace(/[\s$€%]/g, '').replace(/[^\d.,-]/g, '');
  if (s.startsWith('-')) { negativo = true; s = s.slice(1); }
  if (!s) return null;

  // ¿los grupos tienen forma de separador de miles?
  const sonMiles = (partes) =>
    partes.length >= 2 &&
    partes.slice(1).every(g => /^\d{3}$/.test(g)) &&
    /^\d{1,3}$/.test(partes[0]);

  const ultPunto = s.lastIndexOf('.');
  const ultComa = s.lastIndexOf(',');

  if (ultPunto > -1 && ultComa > -1) {
    s = ultComa > ultPunto
      ? s.replace(/\./g, '').replace(',', '.')   // 1.234,56
      : s.replace(/,/g, '');                     // 1,234.56
  } else if (ultComa > -1) {
    const partes = s.split(',');
    s = sonMiles(partes) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (ultPunto > -1) {
    const partes = s.split('.');
    if (sonMiles(partes)) s = s.replace(/\./g, '');
  }

  const n = parseFloat(s);
  if (isNaN(n) || !isFinite(n)) return null;
  return negativo ? -n : n;
}

export function pctf(v) {
  if (v === null || v === undefined) return '—';
  return (v * 100).toFixed(2) + '%';
}

export function fmt(v) {
  if (v === null || v === undefined) return '—';
  return Math.round(v).toLocaleString('es-CO');
}

/**
 * Monto total de las operaciones con vinculados del estudio.
 *
 * Existe porque este dato se guarda en más de un campo y cada pantalla leía uno
 * distinto: la ingesta de operaciones escribe `monto` y `monto_operacion`, y la
 * tarjeta de resumen leía `t_s`, que ahí ya no se llena —mostraba «COP $ 0» junto a un
 * mensaje de éxito que sí traía la cifra. `t_s` son los ingresos operacionales de la
 * compañía, que vienen del estado financiero, y por eso el paso de operaciones dejó de
 * escribirlo: el paso de estados financieros lo sobrescribía después.
 *
 * `t_s` queda como último recurso solo para los estudios anteriores a esa separación,
 * donde era el único sitio donde el monto llegó a guardarse. No es equivalente: si hay
 * `monto_operacion` o `monto`, esos mandan.
 */
export function montoOperacion(study) {
  const s = study || {};
  for (const candidato of [s.monto_operacion, s.monto, s.t_s]) {
    const valor = num(candidato);
    if (valor !== null && valor !== 0) return valor;
  }
  return null;
}

/**
 * Compara el ingreso total del P&L (`t_s`) contra el monto de la operación con la
 * vinculada (`montoOperacion`). Cuando la parte examinada también factura a terceros
 * no vinculados (por ejemplo un proyecto tipo CoCrea), esos dos montos difieren y el
 * margen no debe calcularse sobre el ingreso total sin depurar — de ahí `seg_excluido`
 * en el modelo del estudio. Devuelve null si falta alguno de los dos montos.
 */
export function segmentacionDesajuste(study, umbral = 0.05) {
  const s = study || {};
  const ingresoPL = num(s.t_s);
  const monto = montoOperacion(s);
  if (ingresoPL === null || monto === null || ingresoPL === 0) return null;

  const diferencia = ingresoPL - monto;
  const diferenciaPct = Math.abs(diferencia) / Math.abs(ingresoPL);

  return {
    ingresoPL,
    monto,
    diferencia,
    diferenciaPct,
    desajuste: diferenciaPct > umbral
  };
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
