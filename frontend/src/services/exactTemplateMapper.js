import { fmt, pctf, num, getUvtValue } from '../utils/calculations.js';
import { analizarRango } from './rangoIntercuartil.js';

const DATOS_MACRO = {
  pib_mundial: {
    '2022': '3.5',
    '2023': '3.2',
    '2024': '3.3',
    '2025': '3.2',
    '2026': '3.2', // Proyección FMI
    '2027': '3.1'  // Proyección FMI
  },
  pib_colombia: {
    '2022': '7.3',
    '2023': '0.6',
    '2024': '1.7',
    '2025': '2.6', // Real DANE
    '2026': '3.0', // Proyección OCDE
    '2027': '3.2'
  }
};

function generarTablaPibMundial(year, wrap) {
  const y1 = year - 1;
  const y2 = year;
  const y3 = year + 1;
  const v1 = DATOS_MACRO.pib_mundial[y1] || '—';
  const v2 = DATOS_MACRO.pib_mundial[y2] || '—';
  const v3 = DATOS_MACRO.pib_mundial[y3] || '—';

  return '<p>\n<strong>Crecimiento del PIB Mundial (' + y1 + '-' + y3 + ')</strong>\n</p>\n<table>\n<tr>\n<td>\n<p>\n<strong>Año</strong>\n</p>\n</td>\n<td>\n<p>\n<strong>Crecimiento Mundial (%)</strong>\n</p>\n</td>\n</tr>\n<tr>\n<td>\n<p>\n' + wrap(y1) + '\n</p>\n</td>\n<td>\n<p>\n' + wrap(v1) + '\n</p>\n</td>\n</tr>\n<tr>\n<td>\n<p>\n' + wrap(y2) + '\n</p>\n</td>\n<td>\n<p>\n' + wrap(v2) + '\n</p>\n</td>\n</tr>\n<tr>\n<td>\n<p>\n' + wrap(y3) + ' (Proyección)\n</p>\n</td>\n<td>\n<p>\n' + wrap(v3) + '\n</p>\n</td>\n</tr>\n</table>';
}

function generarTablaPibColombia(year, wrap) {
  const y1 = year - 1;
  const y2 = year;
  const y3 = year + 1;
  const v1 = DATOS_MACRO.pib_colombia[y1] || '—';
  const v2 = DATOS_MACRO.pib_colombia[y2] || '—';
  const v3 = DATOS_MACRO.pib_colombia[y3] || '—';

  return '<p>\n<strong>Crecimiento del PIB en Colombia (' + y1 + '-' + y3 + ')</strong>\n</p>\n<table>\n<tr>\n<td>\n<p>\n<strong>Año</strong>\n</p>\n</td>\n<td>\n<p>\n<strong>Crecimiento del PIB (%)</strong>\n</p>\n</td>\n</tr>\n<tr>\n<td>\n<p>\n' + wrap(y1) + '\n</p>\n</td>\n<td>\n<p>\n' + wrap(v1) + '\n</p>\n</td>\n</tr>\n<tr>\n<td>\n<p>\n' + wrap(y2) + '\n</p>\n</td>\n<td>\n<p>\n' + wrap(v2) + '\n</p>\n</td>\n</tr>\n<tr>\n<td>\n<p>\n' + wrap(y3) + ' (Proyección OCDE)\n</p>\n</td>\n<td>\n<p>\n' + wrap(v3) + '\n</p>\n</td>\n</tr>\n</table>';
}

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

  // El cálculo vive en su propio módulo: lo comparte la sustitución por campos.
  const { stats, adj, cumple: cumpleStr } = analizarRango(study);

  // Helper para destacar visualmente las variables reemplazadas en el editor web
  const wrap = (val) => {
    if (!val && val !== 0) return '—';
    return `<span style="font-weight:600;color:#0B7C7A;border-bottom:1px dashed #0FA3A1;background-color:#F0FDF4;padding:0 4px;border-radius:3px;">${val}</span>`;
  };

  const formattedMonto = study.t_s ? fmt(study.t_s) : '3.435.357.400';
  const formattedTipo = study.vinc_tipo || 'Otros servicios (07)';

  /* Fila del accionista principal (Tabla 6. Composición Accionaria): en la
     plantilla real, esta fila comparte texto literal con el vinculado
     ("END GAME INTERACTIVE INC"/"ESTADOS UNIDOS" — misma empresa, mismo país
     en el estudio original). Debe sustituirse ANTES y de forma acotada a esta
     fila exacta: si corriera después del reemplazo genérico del vinculado
     (global, sin acotar), ya no quedaría texto literal que sustituir aquí y
     la fila de accionistas se congelaría con los datos de End Game. */
  if (study.accionistas && study.accionistas.length > 0) {
    const mainAcc = study.accionistas[0];
    const rxFilaAccionista = /<tr>\n<td>\n<p>\nEND GAME INTERACTIVE INC\.\n<\/p>\n<\/td>\n<td>\n<p>\nESTADOS UNIDOS\n<\/p>\n<\/td>\n<td>\n<p>\n200\.000\n<\/p>\n<\/td>\n<td>\n<p>\n200\.000\.000\n<\/p>\n<\/td>\n<td>\n<p>\n100%\n<\/p>\n<\/td>\n<\/tr>/;
    html = html.replace(rxFilaAccionista, (fila) => {
      let out = fila;
      if (mainAcc.nombre) out = out.replace(/END GAME INTERACTIVE INC\./, wrap(mainAcc.nombre));
      if (mainAcc.pais) out = out.replace(/ESTADOS UNIDOS/, wrap(mainAcc.pais));
      if (mainAcc.acciones) out = out.replace(/200\.000\n/, wrap(fmt(mainAcc.acciones)) + '\n');
      if (mainAcc.valor_capital) out = out.replace(/200\.000\.000/, wrap(fmt(mainAcc.valor_capital)));
      return out;
    });
  }

  // Reemplazos de las variables del cliente
  const replacements = [
    /* Una sola regla para las tres formas en que el informe de referencia
       escribe la razón social —"S.A.S", "SAS" y "SA"—: con una regla por forma
       se olvidó la última y el nombre del cliente anterior se quedaba dentro
       del informe nuevo. El `(?!\w)` evita que "SA" muerda el arranque de una
       palabra que siga. */
    { target: /END GAME INTERACTIVE COLOMBIA\s+S\.?A\.?S?\.?(?!\w)/gi, val: wrap(study.ent || 'END GAME INTERACTIVE COLOMBIA S.A.S') },
    { target: /END GAME INTERACTIVE INC/gi, val: wrap(study.vinc || 'END GAME INTERACTIVE INC') },
    { target: /ESTADOS UNIDOS/gi, val: wrap(study.pais_vinc || 'ESTADOS UNIDOS') },
    { target: /604477955/g, val: wrap(study.vinc_id || '604477955') },
    { target: /Otros servicios \(\s*07\s*\)/gi, val: wrap(formattedTipo) },
    { target: /3\.435\.357\.400/g, val: wrap(formattedMonto) },
    
    // Reemplazo dinámico de los topes UVT calculados según el año fiscal
    { target: /2\.117\.925\.000/g, val: wrap(fmt(uvt45k)) },
    { target: /470\.650\.000/g, val: wrap(fmt(uvt10k)) },
    
    { target: /2024/g, val: wrap(year) },

    /* Cifras que no tenían regla y por eso viajaban de End Game a cualquier
       informe generado con esta plantilla. Los delimitadores (?<![\d.]) y
       (?![\d.]) son obligatorios: sin ellos, "1.247.447.456" se reemplazaría
       por su cola "247.447.456" y quedaría un número corrupto.
       El NIT se captura con su dígito de verificación para no dejarlo colgando. */
    { target: /(?<![\d.])901\.337\.576-\d(?![\d])/g, val: wrap(study.nit || '—') },
    { target: /(?<![\d.])1\.247\.447\.456(?![\d.])/g, val: wrap(study.t_inv_assoc ? fmt(num(study.t_inv_assoc)) : '—') },
    { target: /(?<![\d.])4\.703\.375(?![\d.])/g, val: wrap(study.t_intang ? fmt(num(study.t_intang)) : '—') },
    { target: /(?<![\d.])83\.801\.656(?![\d.])/g, val: wrap(study.t_dif ? fmt(num(study.t_dif)) : '—') },
    { target: /(?<![\d.])206\.129\.230(?![\d.])/g, val: wrap(study.t_act_nocurr ? fmt(num(study.t_act_nocurr)) : '—') }
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

  // Reemplazar Rango Intercuartil si se calculó
  if (stats) {
    html = html.replace(/Percentil 25:?\s*[\d\.\,%]+/gi, `Percentil 25: ${wrap(pctf(stats.p25))}`);
    html = html.replace(/Mediana:?\s*[\d\.\,%]+/gi, `Mediana: ${wrap(pctf(stats.med))}`);
    html = html.replace(/Percentil 75:?\s*[\d\.\,%]+/gi, `Percentil 75: ${wrap(pctf(stats.p75))}`);
  }

  /* Monto del ajuste. Si el estudio está dentro del rango no hay ajuste que
     reportar, pero la frase de la plantilla sí existe: se pone un marcador
     visible en vez de la cifra de End Game. Corregir la redacción de esa frase
     queda para el plan 2, cuando la plantilla tenga campos con nombre. */
  const montoAjuste = adj && !adj.within ? fmt(Math.abs(adj.capped)) : '—';
  html = html.replace(/(?<![\d.])983\.180\.000(?![\d.])/g, wrap(montoAjuste));

  // Reemplazar resultado Cumple/No Cumple
  html = html.replace(/cumple con el principio de plena competencia/gi, `${wrap(cumpleStr)} con el principio de plena competencia`);

  // Reemplazar de forma quirúrgica la tabla de PIB Mundial
  const rxPibMundial = /<p>\s*<strong>Crecimiento del PIB Mundial \(2023-2025\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi;
  html = html.replace(rxPibMundial, generarTablaPibMundial(year, wrap));

  // Reemplazar de forma quirúrgica la tabla de PIB de Colombia
  const rxPibColombia = /<p>\s*<strong>Crecimiento del PIB en Colombia \(2023-2025\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi;
  html = html.replace(rxPibColombia, generarTablaPibColombia(year, wrap));

  return html;
}
