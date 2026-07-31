import { fmt, pctf, pliOf, ratios, quart, adjustInfo, num, getUvtValue } from '../utils/calculations';

/**
 * Recibe el HTML completo del informe modelo End Game (con sus 27 secciones intactas)
 * y realiza el reemplazo quirúrgico de las variables del cliente activo.
 */
export function hydrateExactWordTemplate(rawHtml, study) {
  if (!rawHtml) return '';

  let html = rawHtml;

  const year = study.anio || 2025;
  const uvtRate = getUvtValue(year);

  // Valores dinámicos según el año gravable
  const uvt45k = 45000 * uvtRate;
  const uvt10k = 10000 * uvtRate;

  // Calculamos el Rango Intercuartil y Ajuste si hay comparables
  const kind = study.pli || 'MO';
  const T = { 
    s: num(study.t_s), 
    c: num(study.t_c), 
    op: num(study.t_op), 
    ar: num(study.t_ar), 
    inv: num(study.t_inv), 
    ap: num(study.t_ap) 
  };
  const tPLI = pliOf(T, kind);

  const useAdj = study.useadj || false;
  const interestRate = (num(study.prime) || 0) / 100;
  const tR = ratios(T);

  let stats = null;
  if (study.comparables && study.comparables.length >= 3) {
    const activeSeries = study.comparables
      .map(c => {
        const rawVal = { s: num(c.s), c: num(c.c), op: num(c.op), ar: num(c.ar), inv: num(c.inv), ap: num(c.ap) };
        const pliVal = pliOf(rawVal, kind);
        if (pliVal === null) return null;
        let adjVal = 0;
        const cR = ratios(rawVal);
        if (useAdj && kind !== 'Berry' && tR && cR && tR.apC !== null && cR.apC !== null) {
          adjVal = interestRate * ((tR.arS - cR.arS) + (tR.invS - cR.invS) - (tR.apC - cR.apC));
        }
        return pliVal + adjVal;
      })
      .filter(val => val !== null)
      .sort((a, b) => a - b);

    if (activeSeries.length >= 3) {
      stats = {
        p25: quart(activeSeries, .25),
        med: quart(activeSeries, .5),
        p75: quart(activeSeries, .75)
      };
    }
  }

  const adj = (stats && tPLI !== null) ? adjustInfo(T, tPLI, stats, T.s || 0, 1, study.egreso) : null;
  const cumpleStr = adj ? (adj.within ? 'CUMPLE' : 'NO CUMPLE') : 'CUMPLE';

  // Helper para destacar visualmente las variables reemplazadas en el editor web
  const wrap = (val) => {
    if (!val && val !== 0) return '—';
    return `<span style="font-weight:600;color:#0B7C7A;border-bottom:1px dashed #0FA3A1;background-color:#F0FDF4;padding:0 4px;border-radius:3px;">${val}</span>`;
  };

  const formattedMonto = study.t_s ? fmt(study.t_s) : '3.435.357.400';
  const formattedTipo = study.vinc_tipo || 'Otros servicios (07)';

  // Reemplazos de las variables del cliente
  const replacements = [
    { target: /END GAME INTERACTIVE COLOMBIA S\.A\.S/gi, val: wrap(study.ent || 'END GAME INTERACTIVE COLOMBIA S.A.S') },
    { target: /END GAME INTERACTIVE COLOMBIA SAS/gi, val: wrap(study.ent || 'END GAME INTERACTIVE COLOMBIA SAS') },
    { target: /END GAME INTERACTIVE INC/gi, val: wrap(study.vinc || 'END GAME INTERACTIVE INC') },
    { target: /ESTADOS UNIDOS/gi, val: wrap(study.pais_vinc || 'ESTADOS UNIDOS') },
    { target: /604477955/g, val: wrap(study.vinc_id || '604477955') },
    { target: /Otros servicios \(\s*07\s*\)/gi, val: wrap(formattedTipo) },
    { target: /3\.435\.357\.400/g, val: wrap(formattedMonto) },
    
    // Reemplazo dinámico de los topes UVT calculados según el año fiscal
    { target: /2\.117\.925\.000/g, val: wrap(fmt(uvt45k)) },
    { target: /470\.650\.000/g, val: wrap(fmt(uvt10k)) },
    
    { target: /2024/g, val: wrap(year) }
  ];

  // Aplicar reemplazos iniciales
  replacements.forEach(({ target, val }) => {
    html = html.replace(target, val);
  });

  // Reemplazo dinámico de la Tabla de EEFF (Activos / Balance General) si el año es 2025 o si se ingirieron las cifras de EEFF
  if (String(year) === '2025' || study.t_ar || study.t_s || study.t_cash) {
    const eeff2025 = {
      efectivo: study.t_cash ? num(study.t_cash) : 1031832388,
      cxc: study.t_ar ? num(study.t_ar) : 578289605,
      impuestos: study.t_tax ? num(study.t_tax) : 388909218,
      ppe: study.t_ppe ? num(study.t_ppe) : 168030721
    };

    const totalActivoCorriente = study.t_act_curr ? num(study.t_act_curr) : (eeff2025.efectivo + eeff2025.cxc + eeff2025.impuestos);
    const totalActivos = study.t_act_tot ? num(study.t_act_tot) : (totalActivoCorriente + eeff2025.ppe);

    html = html.replace(/87\.957\.645/g, wrap(fmt(eeff2025.efectivo)));
    html = html.replace(/179\.720\.372/g, wrap(fmt(eeff2025.cxc)));
    html = html.replace(/268\.433\.497/g, wrap(fmt(eeff2025.impuestos)));
    html = html.replace(/1\.783\.558\.970/g, wrap(fmt(totalActivoCorriente)));
    html = html.replace(/117\.624\.200/g, wrap(fmt(eeff2025.ppe)));
    html = html.replace(/1\.989\.688\.200/g, wrap(fmt(totalActivos)));
  }

  // Reemplazo dinámico de la Tabla 6. Composición Accionaria
  if (study.accionistas && study.accionistas.length > 0) {
    const mainAcc = study.accionistas[0];
    if (mainAcc.nombre) html = html.replace(/END GAME INTERACTIVE INC\./gi, wrap(mainAcc.nombre));
    if (mainAcc.pais) html = html.replace(/ESTADOS UNIDOS/g, wrap(mainAcc.pais));
    if (mainAcc.acciones) html = html.replace(/200\.000/g, wrap(fmt(mainAcc.acciones)));
    if (mainAcc.valor_capital) html = html.replace(/200\.000\.000/g, wrap(fmt(mainAcc.valor_capital)));
  }

  // Reemplazar Rango Intercuartil si se calculó
  if (stats) {
    html = html.replace(/Percentil 25:?\s*[\d\.\,%]+/gi, `Percentil 25: ${wrap(pctf(stats.p25))}`);
    html = html.replace(/Mediana:?\s*[\d\.\,%]+/gi, `Mediana: ${wrap(pctf(stats.med))}`);
    html = html.replace(/Percentil 75:?\s*[\d\.\,%]+/gi, `Percentil 75: ${wrap(pctf(stats.p75))}`);
  }

  // Reemplazar resultado Cumple/No Cumple
  html = html.replace(/cumple con el principio de plena competencia/gi, `${wrap(cumpleStr)} con el principio de plena competencia`);

  return html;
}
