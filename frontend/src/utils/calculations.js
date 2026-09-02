// Calculations and utilities for Transfer Pricing

export const PLIN = {
  'MO': 'Margen Operacional (MO)',
  'MB': 'Margen Bruto (MB)',
  'Berry': 'Índice de Berry'
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

/**
 * Magnitud de un EGRESO: el valor absoluto de la cifra, o null si no hay cifra.
 *
 * Los estados financieros imprimen los egresos con signo negativo o entre paréntesis
 * —«COSTO DE VENTAS (21.850.187.494)»— y el prompt de lectura conserva ese signo a
 * propósito, para que la hoja del libro y el ANEXO A se lean igual que el documento
 * radicado. Pero el cálculo usa el convenio contrario: la utilidad bruta es
 * `ventas − costo` y el EBIT `ventas − costo − gastos`, así que un costo negativo
 * SUMA en lugar de restar. Con las cifras de Montachem 2025 la utilidad bruta salía
 * 45.591.555.238 en vez de 1.891.180.250 y el margen operacional 171 %, sin que nada
 * lo advirtiera.
 *
 * Este helper es la frontera única entre los dos convenios. Se aplica SOLO a costo de
 * ventas y gastos operativos, que son magnitudes de egreso: la utilidad operacional
 * NO pasa por aquí, porque una pérdida es legítimamente negativa y volverla positiva
 * convertiría un estudio en pérdidas en uno rentable.
 */
export function egreso(v) {
  const n = num(v);
  return n === null ? null : Math.abs(n);
}

/* Tres decimales y separador de es-CO. Es la convención del informe y la que `index.html` ya
   aplicaba: antes de unificarlo, un mismo estudio publicaba «4,985%» por la ruta del monolito y
   «4.98%» por la del gestor para la misma cifra.

   Los tres decimales no son cosmética. Los márgenes de este dominio se mueven en centésimas de
   punto, y con dos decimales «4,985 %» y «4,984 %» se imprimen iguales.

   `toLocaleString` pone la coma sola; un `replace('.', ',')` a mano se rompe en cuanto el
   número lleva separador de miles. La guarda de `isNaN` la tenía el monolito y aquí faltaba:
   `pctf(NaN)` devolvía la cadena «NaN%», que se radicaba tal cual. */
export function pctf(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (v * 100).toLocaleString('es-CO',
    { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' %';
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
  if (kind === 'MO') {
    const op = num(o.op);
    return op === null ? null : op / s;
  }
  /* `egreso` y no `num`: el costo llega con el signo que traía el documento (ver
     `egreso`), y con signo negativo la utilidad bruta salía por el doble. */
  if (kind === 'MB') return (s - egreso(o.c)) / s;
  /* Berry = utilidad bruta ÷ gastos operativos, la definición del Anexo del Cap. III
     de las Guías OCDE y la que replica el modelo Excel validado por el consultor.

     Hasta agosto de 2026 aquí se calculaba «ventas ÷ costos totales», que no es el
     mismo indicador que emite `ajusteRangoCapitalTrabajo.js`. Convivían las dos y el
     informe y su Excel de soporte publicaban cifras distintas para el mismo estudio.

     `op` llega como UTILIDAD operacional (convenio del sistema), así que los gastos
     operativos se despejan: opex = ventas − costo − utilidad operacional. */
  if (kind === 'Berry') {
    const c = egreso(o.c);
    const op = num(o.op);
    if (c === null || op === null) return null;
    const utilidadBruta = s - c;
    const opex = s - c - op;
    return opex !== 0 ? utilidadBruta / opex : null;
  }
  return null;
}

export function ratios(o) {
  if (!o) return null;
  const s = num(o.s);
  /* `apC` divide por el costo; con el signo del documento el ratio salía negativo
     y el ajuste de capital de trabajo se movía al revés (ver `egreso`). */
  const c = egreso(o.c);
  if (s && o.ar !== null && o.inv !== null) {
    return {
      arS: num(o.ar) / s,
      invS: num(o.inv) / s,
      apC: (c && o.ap !== null) ? num(o.ap) / c : null
    };
  }
  return null;
}

/* Aquí vivía `quart`: cuartil por posición truncada de la serie ordenada, sin
   interpolar. Era el segundo algoritmo de cuartil del sistema frente a
   `cuartilInterpolado` (QUARTILE.INC) de `services/ajusteRangoCapitalTrabajo.js`, y
   sobre la misma serie los dos publicaban números distintos. Se retiró al quedarse sin
   llamadores para que no haya dos definiciones del rango intercuartil. */

/**
 * EL CRITERIO DE CUMPLIMIENTO: el indicador por encima del primer cuartil.
 *
 * Decision del despacho, con su contador, el 2026-09-02: «el modo de decidir que esta
 * cumpliendo es que este por encima del p25». Antes se exigia estar DENTRO del rango
 * (P25 <= PLI <= P75), de modo que un contribuyente por encima del tercer cuartil salia como
 * «NO CUMPLE (por encima)».
 *
 * POR QUE ES COHERENTE CON LO QUE EL SISTEMA YA CALCULABA. El ajuste de precios de
 * transferencia solo procede cuando el contribuyente declaro MENOS utilidad de la que
 * corresponde: por encima del rango no hay nada que cobrarle al contribuyente. Y `adjustInfo`
 * ya lo trataba asi —con el indicador sobre la mediana, `raw` sale negativo y el ajuste queda
 * marcado improcedente con monto cero—, asi que el sistema ya concluia que no habia ajuste que
 * declarar mientras la etiqueta decia lo contrario. Lo que cambio es la etiqueta.
 *
 * VIVE AQUI Y SE IMPORTA. Habia CINCO copias de la condicion —esta, `analizarRangoAjustado`,
 * el `dentro` del diagnostico, el de la memoria del rango y una formula de Excel—, y el
 * 2026-09-02 ya se pago un defecto por dos definiciones que divergieron. Con la regla en un
 * solo sitio no pueden volver a decir cosas distintas.
 */
export function cumpleElRango(st, indicador) {
  if (!st || indicador === null || indicador === undefined || Number.isNaN(indicador)) return false;
  if (st.p25 === null || st.p25 === undefined) return false;
  return indicador >= st.p25;
}

export function adjustInfo(T, tPLI, st, base, unitMult, egresoValue = null) {
  if (!st || tPLI === null) return null;
  /* Sobre el tercer cuartil NO es incumplimiento, pero si es informativo: puede indicar que el
     metodo o la parte examinada no son los adecuados. Se reporta como observacion. */
  const sobreP75 = st.p75 !== null && st.p75 !== undefined && tPLI > st.p75;
  const within = cumpleElRango(st, tPLI);
  if (within) return { within: true, raw: 0, capped: 0, flag: false, sobreP75 };
  
  let raw = (st.med - tPLI) * base * unitMult;
  /* Renombrado desde `egreso` para no sombrear el helper del mismo nombre que
     normaliza los egresos del estado de resultados: aquí es el monto del egreso de
     la operación, que es el tope del ajuste, no una magnitud contable a normalizar. */
  const montoEgreso = num(egresoValue);
  let capped = raw, flag = false;
  if (montoEgreso !== null && montoEgreso > 0 && Math.abs(raw) > montoEgreso) {
    capped = Math.sign(raw) * montoEgreso;
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
    sobreP75,
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
