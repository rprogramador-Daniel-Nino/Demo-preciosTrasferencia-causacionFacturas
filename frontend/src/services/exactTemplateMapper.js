import { fmt, pctf, num, getUvtValue } from '../utils/calculations.js';
import { analizarRango } from './rangoIntercuartil.js';
import {
  DATOS_MACRO,
  generarTablaPibMundial,
  generarTablaPibColombia,
  generarTablaInflacionGlobal,
  generarTablaCrecimientoPorRegion,
  generarTablaInflacionColombia,
  generarTablaTasaIntervencion,
  generarTablaTRM,
  generarTablaDesempleo,
  generarApartadoSectorial,
  tituloSectorial,
} from './analisisMercado.js';

/* ─── Sección III del informe: tablas macro ───
   Cada entrada empareja el título literal que trae la plantilla con el generador
   que la reconstruye para el año gravable. La regex captura el título más su
   <table> completa. Antes solo estaban cubiertas las dos de PIB, así que las seis
   restantes viajaban de End Game a cualquier informe con sus valores originales. */
const TABLAS_MACRO = [
  { rx: /<p>\s*<strong>Crecimiento del PIB Mundial \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaPibMundial },
  { rx: /<p>\s*<strong>Crecimiento del PIB en Colombia \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaPibColombia },
  { rx: /<p>\s*<strong>Tasas de Inflación Global \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaInflacionGlobal },
  { rx: /<p>\s*<strong>Proyecciones de Crecimiento del PIB por Región\/País \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaCrecimientoPorRegion },
  { rx: /<p>\s*<strong>Inflación en Colombia \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaInflacionColombia },
  { rx: /<p>\s*<strong>Tasa de Intervención del Banco de la República \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaTasaIntervencion },
  { rx: /<p>\s*<strong>Tasa Representativa del Mercado \(TRM\) Promedio \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaTRM },
  { rx: /<p>\s*<strong>Tasa de Desempleo en Colombia \([^<]*\)<\/strong>\s*<\/p>\s*<table>[\s\S]*?<\/table>/gi, gen: generarTablaDesempleo },
];

/* Anclas de Word que delimitan el apartado sectorial (III.C) y la sección
   siguiente (IV. ANÁLISIS ECONÓMICO). Son estables y únicas: cada una aparece dos
   veces en el documento, una en el índice como href y otra en el cuerpo como id.
   Delimitar por ancla y no por texto literal es lo que hace que el reemplazo
   sobreviva a que cambie la redacción del apartado. */
const ANCLA_SECTORIAL = '_Toc208930979';
const ANCLA_SIGUIENTE = '_Toc208930980';

/* Años del estudio: los contextos donde «2024» significa el año gravable y no un
   dato histórico. Es una lista blanca deliberada. La regla anterior —reemplazar
   toda aparición de 2024— falseaba las series macro («en 2024 la inflación
   descendió a 5,9 %» pasaba a decir el año del estudio) y corrompía las URLs de
   las fuentes citadas.

   Un año del estudio que quede fuera de esta lista se ve y se corrige en el
   editor; un dato macro atribuido al año equivocado no lo nota nadie.

   Se usan lookbehind y lookahead en vez de grupos de captura: así el reemplazo es
   el año a secas y no hay que reconstruir prefijos, que es donde un patrón sin su
   grupo dejaría un «$2» literal en el informe. */
const ANIOS_DEL_ESTUDIO = [
  /(?<=PERÍODO FISCAL AL 31 DE DICIEMBRE DE )2024/g,
  /(?<=estudio de precios de transferencia para el año )2024/gi,
  /(?<=efectuadas para el año )2024/gi,
  /(?<=En el año )2024(?=,)/g,
  /(?<=durante el periodo fiscal )2024/gi,
  /(?<=para el año fiscal )2024/gi,
  /(?<=comparables seleccionadas en el año )2024/gi,
  /(?<=durante el año gravable )2024/gi,
  /(?<=al? 31 de diciembre de )2024/gi,
  /(?<=Último estado financiero entre junio de )2024/gi,
  /(?<=A\.V\. )2024/g,
  // Encabezado de año de las tablas de estados financieros (Anexo A)
  /(?<=<strong>Descripción<\/strong>\s*<\/p>\s*<\/th>\s*<th>\s*<p>\s*<strong>)2024(?=<\/strong>)/g,
  /* La misma columna en la tabla de análisis vertical trae el año con punto de
     miles. Sin esta regla, «A.V. 2024» cambiaba y «2.024» se quedaba, dejando
     dos años distintos en una misma cabecera. */
  /(?<=<strong>\s{2,})2\.024(?=<\/strong>)/g,
];

/* ─── Guarda de enlaces ───
   Se aparta la ETIQUETA DE APERTURA de cada <a>, con sus atributos, y no el enlace
   completo. La diferencia es deliberada: el índice del informe lleva la razón
   social dentro del texto visible del enlace («I. INFORMACIÓN GENERAL END GAME
   INTERACTIVE COLOMBIA S.A.S»), así que apartar el <a> entero dejaría el nombre de
   End Game en el índice de todos los informes. Lo que hay que proteger es el href,
   donde viven las URLs de las fuentes citadas. */
/* Marcador en ASCII imprimible a propósito. Un carácter de control quedaría como
   byte crudo en el fuente y las herramientas tratarían este archivo como binario. */
const MARCA_ENLACE = '@@PT_ENLACE_';

function apartarEnlaces(html, deposito) {
  /* Si el documento ya trajera el marcador, apartar corrompería el texto al
     reponer. No debería pasar nunca en un informe, pero salir sin tocar nada es
     más barato que el fallo que evita. */
  if (html.includes(MARCA_ENLACE)) return html;

  return html.replace(/<a\b[^>]*>/gi, (etiqueta) => {
    deposito.push(etiqueta);
    return MARCA_ENLACE + (deposito.length - 1) + '@@';
  });
}

function reponerEnlaces(html, deposito) {
  return html.replace(/@@PT_ENLACE_(\d+)@@/g, (marca, i) => {
    const original = deposito[Number(i)];
    return original === undefined ? marca : original;
  });
}

/** Sustituye el apartado sectorial (III.C) y su título, en el cuerpo y en el
 *  índice. Si el HTML no trae las anclas —una plantilla que el usuario subió— no
 *  toca nada: devuelve el mismo HTML y diagnosticarCobertura lo reporta. */
function reemplazarApartadoSectorial(html, study, year, wrap) {
  const titulo = tituloSectorial(study);

  /* Cuerpo: conserva el <a id> y la estructura <ol><li> —si se borra el ancla, el
     hipervínculo del índice queda roto— y cambia el título y todo el contenido que
     sigue, hasta el <ol><li> que abre la sección IV. */
  const rxCuerpo = new RegExp(
    '(<a id="' + ANCLA_SECTORIAL + '"></a><strong>)[\\s\\S]*?(</strong>\\s*</li>\\s*</ol>)' +
    '[\\s\\S]*?(?=<ol>\\s*<li>\\s*<a id="' + ANCLA_SIGUIENTE + '">)'
  );
  html = html.replace(rxCuerpo, (completo, abre, cierra) =>
    abre + titulo + cierra + '\n' + generarApartadoSectorial(study, year, wrap)
  );

  // Índice: solo el texto del enlace, conservando el número de página.
  const rxIndice = new RegExp(
    '(<a href="#' + ANCLA_SECTORIAL + '">C\\.\\t)[^\\t<]*(\\t\\d+</a>)'
  );
  html = html.replace(rxIndice, (completo, abre, cierra) => abre + titulo + cierra);

  return html;
}

/** Qué quedó sin cubrir al hidratar. Alimenta el aviso de ReporteGenerador: un
 *  banner que dice qué falta sirve; uno que solo dice «revise el documento» no. */
export function diagnosticarCobertura(rawHtml, study) {
  const year = Number(study && study.anio) || 2025;
  const html = String(rawHtml || '');

  const seriesFaltantes = [];
  const porAnio = [
    ['el crecimiento del PIB mundial', DATOS_MACRO.pib_mundial],
    ['el crecimiento del PIB de Colombia', DATOS_MACRO.pib_colombia],
    ['la inflación global', DATOS_MACRO.inflacion_global],
    ['la inflación de Colombia', DATOS_MACRO.inflacion_colombia],
    ['la TRM promedio', DATOS_MACRO.trm_promedio],
    ['la tasa de desempleo', DATOS_MACRO.desempleo_colombia],
    ['la tasa de intervención del Banco de la República', DATOS_MACRO.tasa_intervencion],
    ['las proyecciones de crecimiento por región', DATOS_MACRO.crecimiento_por_region],
  ];
  porAnio.forEach(([concepto, serie]) => {
    if (!serie || serie[year] === undefined) seriesFaltantes.push(concepto);
  });

  return {
    year,
    sectorialCubierto: html.includes('id="' + ANCLA_SECTORIAL + '"'),
    seriesFaltantes,
  };
}

/**
 * Recibe el HTML completo del informe modelo End Game (con sus 27 secciones intactas)
 * y realiza el reemplazo quirúrgico de las variables del cliente activo.
 */
export function hydrateExactWordTemplate(rawHtml, study) {
  if (!rawHtml) return '';

  let html = rawHtml;

  /* Number() y no study.anio directo: el campo del formulario entrega una cadena
     (DatosContribuyente.jsx, onChange de «Año gravable»), y los generadores de
     tabla calculan year + 1 para la columna de proyección. Con la cadena '2025'
     eso daba '20251' en el encabezado. */
  const year = Number(study.anio) || 2025;
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

  /* ─── Apartado sectorial (III.C) ───
     Va antes que todo lo demás porque se delimita con las anclas <a id="_Toc…">, y
     el paso siguiente aparta todos los <a> del documento. Sustituye el análisis
     del sector de videojuegos de End Game —título incluido, en el cuerpo y en el
     índice— por uno construido con la actividad real del contribuyente. */
  html = reemplazarApartadoSectorial(html, study, year, wrap);

  /* ─── Guarda de enlaces ───
     Varias fuentes citadas en la sección III llevan el año en la URL
     (caracol.com.co/2024/…, forbes.co/2024/…). Una regla que sustituya ese año no
     solo lo cambia: inyecta el <span> de resaltado dentro del atributo href y deja
     el enlace muerto. Se aparta cada <a> completo y se repone al final, de modo
     que ninguna regla —ni las de hoy ni las que se agreguen— pueda tocarlos. */
  const enlaces = [];
  html = apartarEnlaces(html, enlaces);

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

    /* Cifras que no tenían regla y por eso viajaban de End Game a cualquier
       informe generado con esta plantilla. Los delimitadores (?<![\d.]) y
       (?![\d.]) son obligatorios: sin ellos, "1.247.447.456" se reemplazaría
       por su cola "247.447.456" y quedaría un número corrupto.
       El NIT se captura con su dígito de verificación para no dejarlo colgando. */
    { target: /(?<![\d.])901\.337\.576-\d(?![\d])/g, val: wrap(study.nit || '—') },
    { target: /(?<![\d.])1\.247\.447\.456(?![\d.])/g, val: wrap(study.t_inv_assoc ? fmt(num(study.t_inv_assoc)) : '—') },
    { target: /(?<![\d.])4\.703\.375(?![\d.])/g, val: wrap(study.t_intang ? fmt(num(study.t_intang)) : '—') },
    { target: /(?<![\d.])83\.801\.656(?![\d.])/g, val: wrap(study.t_dif ? fmt(num(study.t_dif)) : '—') },
    { target: /(?<![\d.])206\.129\.230(?![\d.])/g, val: wrap(study.t_act_nocurr ? fmt(num(study.t_act_nocurr)) : '—') },

    /* Barrido final del nombre del cliente anterior. Las reglas de arriba cubren
       las razones sociales completas, pero en el informe original quedaban tres
       variantes sin regla: «ENG GAME…» (error de tecleo del propio informe),
       «END GAME INTERACTIVE» sin sufijo, y «END GAME» a secas en prosa («permite a
       END GAME trabajar…»). Eran 13 apariciones que viajaban a cualquier informe.

       Van al final por orden de especificidad: una regla genérica antes de las
       específicas partiría la razón social completa por la mitad. */
    { target: /ENG GAME INTERACTIVE COLOMBIA SAS/gi, val: wrap(study.ent || 'ENG GAME INTERACTIVE COLOMBIA SAS') },
    { target: /END GAME INTERACTIVE/g, val: wrap(study.vinc || 'END GAME INTERACTIVE') },
    { target: /END GAME/g, val: wrap(study.ent || 'END GAME') }
  ];

  // Aplicar reemplazos iniciales
  replacements.forEach(({ target, val }) => {
    html = html.replace(target, val);
  });

  /* Año gravable, solo en los contextos donde «2024» es el año del estudio.
     Ver ANIOS_DEL_ESTUDIO: la regla global que había aquí antes reasignaba de año
     todas las series macro de la sección III. */
  ANIOS_DEL_ESTUDIO.forEach((rx) => {
    html = html.replace(rx, wrap(year));
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

  /* ─── Las ocho tablas macro de la sección III ───
     Antes solo se regeneraban las dos de PIB; las otras seis (inflación global,
     proyecciones por región, inflación de Colombia, tasa de intervención, TRM y
     desempleo) salían con los valores de End Game. El título se reconoce con
     \([^<]*\) en vez del rango literal «(2023-2025)», para que la tabla siga
     siendo reconocible después de haberse regenerado una vez con otro año. */
  TABLAS_MACRO.forEach(({ rx, gen }) => {
    html = html.replace(rx, () => gen(year, wrap));
  });

  return reponerEnlaces(html, enlaces);
}
