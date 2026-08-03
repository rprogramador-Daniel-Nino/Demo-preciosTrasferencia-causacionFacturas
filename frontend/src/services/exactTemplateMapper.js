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

  /* Cifra formateada, o hueco visible si el estudio no la trae. Los valores por
     defecto que había aquí eran los literales de End Game: un estudio recién
     creado salía con el monto, el tipo de operación, la razón social, el NIT del
     vinculado y las cifras de balance del cliente anterior. El principio del
     spec es el contrario —antes un hueco evidente que el dato del año
     anterior—, porque este documento se radica ante la DIAN. */
  const cifra = (v) => wrap(v === null || v === undefined ? null : fmt(v));

  const formattedMonto = study.t_s ? fmt(study.t_s) : null;
  const formattedTipo = study.vinc_tipo || null;

  /* Fila del accionista principal (Tabla 6. Composición Accionaria): en la
     plantilla real, esta fila comparte texto literal con el vinculado
     ("END GAME INTERACTIVE INC"/"ESTADOS UNIDOS" — misma empresa, mismo país
     en el estudio original). Debe sustituirse ANTES y de forma acotada a esta
     fila exacta: si corriera después del reemplazo genérico del vinculado
     (global, sin acotar), ya no quedaría texto literal que sustituir aquí y
     la fila de accionistas se congelaría con los datos de End Game. */
  /* Corre aunque el estudio no traiga accionistas: sin esto las 200.000 acciones
     y los 200.000.000 de capital de End Game se quedaban en la tabla de
     composición accionaria del informe nuevo. El patrón está anclado a esa fila
     exacta, así que poner huecos aquí no puede tocar otras cifras. */
  {
    const mainAcc = (study.accionistas && study.accionistas[0]) || {};
    const rxFilaAccionista = /<tr>\n<td>\n<p>\nEND GAME INTERACTIVE INC\.\n<\/p>\n<\/td>\n<td>\n<p>\nESTADOS UNIDOS\n<\/p>\n<\/td>\n<td>\n<p>\n200\.000\n<\/p>\n<\/td>\n<td>\n<p>\n200\.000\.000\n<\/p>\n<\/td>\n<td>\n<p>\n100%\n<\/p>\n<\/td>\n<\/tr>/;
    html = html.replace(rxFilaAccionista, (fila) => {
      let out = fila;
      out = out.replace(/END GAME INTERACTIVE INC\./, wrap(mainAcc.nombre));
      out = out.replace(/ESTADOS UNIDOS/, wrap(mainAcc.pais));
      out = out.replace(/200\.000\n/, cifra(mainAcc.acciones ? num(mainAcc.acciones) : null) + '\n');
      out = out.replace(/200\.000\.000/, cifra(mainAcc.valor_capital ? num(mainAcc.valor_capital) : null));
      return out;
    });
  }

  // Reemplazos de las variables del cliente
  const replacements = [
    /* Una sola regla para todas las formas en que el informe de referencia
       escribe la razón social del contribuyente. La regla anterior exigía la
       forma larga completa ("END GAME INTERACTIVE COLOMBIA" + S.A.S/SAS/SA), así
       que "END GAME" a secas, "END GAME INTERACTIVE" suelto y "End Game Colombia
       SAS" pasaban intactos al informe nuevo. Ahora "INTERACTIVE", "COLOMBIA" y
       el sufijo societario son opcionales.

       Los dos anclajes del final no son cosméticos:
       - `(?!\w)` evita que "SA" muerda el arranque de la palabra que siga.
       - `(?!\s+INTERACTIVE\s+INC)` justo después de "END GAME" es lo que impide
         que esta regla se coma el prefijo de "END GAME INTERACTIVE INC", que es
         el VINCULADO y lo sustituye la regla siguiente. Va como lookahead
         inmediato y no al final de la expresión a propósito: puesto al final, el
         motor haría backtracking y acabaría casando solo "END GAME", dejando
         " INTERACTIVE INC" colgando y sin sustituir. */
    { target: /END\s+GAME(?!\s+INTERACTIVE\s+INC)(?:\s+INTERACTIVE)?(?:\s+COLOMBIA)?(?:\s+S\.?A\.?S?\.?)?(?!\w)/gi, val: wrap(study.ent) },
    { target: /END GAME INTERACTIVE INC/gi, val: wrap(study.vinc) },
    { target: /ESTADOS UNIDOS/gi, val: wrap(study.pais_vinc) },
    { target: /604477955/g, val: wrap(study.vinc_id) },
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

  /* Tabla de EEFF (Activos / Balance General). Corre siempre, no solo cuando el
     año es 2025 o se ingirieron cifras: con los valores por defecto puestos en
     hueco ya no hay nada que perder por entrar aquí, y con la condición anterior
     un estudio de otro año sin cifras dejaba las seis cifras de End Game
     intactas en el documento.

     Los totales solo se calculan si están todos sus sumandos: sumar un hueco
     como si fuera cero produce un total plausible y falso, que es peor que un
     hueco. */
  {
    const eeffActual = {
      efectivo: study.t_cash ? num(study.t_cash) : null,
      cxc: study.t_ar ? num(study.t_ar) : null,
      impuestos: study.t_tax ? num(study.t_tax) : null,
      ppe: study.t_ppe ? num(study.t_ppe) : null
    };

    const sumandosCorriente = [eeffActual.efectivo, eeffActual.cxc, eeffActual.impuestos];
    const totalActivoCorriente = study.t_act_curr
      ? num(study.t_act_curr)
      : (sumandosCorriente.every((v) => v !== null) ? sumandosCorriente.reduce((a, b) => a + b, 0) : null);
    const totalActivos = study.t_act_tot
      ? num(study.t_act_tot)
      : (totalActivoCorriente !== null && eeffActual.ppe !== null ? totalActivoCorriente + eeffActual.ppe : null);

    html = html.replace(/87\.957\.645/g, cifra(eeffActual.efectivo));
    html = html.replace(/179\.720\.372/g, cifra(eeffActual.cxc));
    html = html.replace(/268\.433\.497/g, cifra(eeffActual.impuestos));
    html = html.replace(/1\.783\.558\.970/g, cifra(totalActivoCorriente));
    html = html.replace(/117\.624\.200/g, cifra(eeffActual.ppe));
    html = html.replace(/1\.989\.688\.200/g, cifra(totalActivos));
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
