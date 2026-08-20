/* ══════════════ Criterios de búsqueda de Capital IQ, en español ══════════════

   La hoja «Screen Criteria» del export de Capital IQ viene en inglés, y desde que la
   Tabla 14 del informe («Códigos SIC utilizados») se reconstruye con la corrida real del
   año —en vez de arrastrar la del informe anterior— ese inglés entra tal cual al informe
   que se radica ante la DIAN. `parsearCriteriosScreening` (comparablesEngine.js:51) solo
   traduce el conector («And)» → Y, «Or)» → O); el resto llegaba crudo.

   Este módulo es puro y sincrónico: corre en cada render, así que los estudios ya
   guardados con el texto en inglés salen en español sin reimportar el Excel. Lo que el
   diccionario no reconozca queda marcado como `residuo` para que `criteriosScreeningIA.js`
   lo resuelva con una llamada a Claude y lo cachee en el estudio como `etiquetaEs` /
   `valorEs`; si esa llamada nunca ocurre, el informe sale con lo que sí cubre el
   diccionario y nada se rompe.

   REGLA DURA: ningún número se toca. Un código SIC o un umbral alterado manda al informe
   una industria o un filtro que nadie cribó, y eso es peor que una palabra en inglés.

   Los diccionarios son bilingües a propósito —la forma española también es entrada
   válida—, igual que `COLUMNAS_IQ` (comparablesEngine.js:111): así el traductor es
   idempotente y no marca como pendiente lo que ya está traducido. */

/** Normaliza para buscar en los diccionarios: minúsculas, espacios colapsados y sin los
 *  dos puntos o el punto final con que Capital IQ y las plantillas adornan las etiquetas. */
function norm(texto) {
  return String(texto == null ? '' : texto)
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:.]+$/, '')
    .toLowerCase();
}

/* ── Detección de idioma, solo para decidir si algo queda pendiente ──

   Marcar el residuo por cobertura del diccionario no alcanza: los estudios ya guardados y
   las plantillas traen valores en prosa española libre («Incluya solo comparables con un
   sitio web»), que ningún diccionario de valores enumerados puede cubrir y que marcarlos
   como pendientes haría pagar una llamada de IA en cada render. Se mira entonces si el
   texto trae alguna marca de español: una tilde/ñ, o una palabra funcional que el inglés
   no usa suelta. `a`, `no` y `e` quedan fuera de la lista justamente porque también son
   palabras inglesas. */
const MARCAS_ES = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'del', 'de', 'al', 'en', 'con',
  'sin', 'por', 'para', 'que', 'y', 'o', 'más', 'menos', 'solo', 'sólo', 'entre', 'es',
  'son', 'sea', 'está', 'están', 'ser', 'su', 'sus', 'lo', 'se', 'hasta', 'desde', 'cada',
  'todo', 'toda', 'todos', 'todas', 'cualquier', 'cualquiera', 'donde', 'cuando', 'según',
  'incluya', 'contiene', 'mayor', 'menor', 'igual', 'compañía', 'año', 'código', 'códigos',
]);

const RX_LETRAS = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/;
const RX_TILDES = /[ÁÉÍÓÚÜÑáéíóúüñ¿¡]/;

function tieneLetras(texto) {
  return RX_LETRAS.test(String(texto || ''));
}

function pareceEspanol(texto) {
  const t = String(texto || '');
  if (RX_TILDES.test(t)) return true;
  return t.toLowerCase().split(/[^a-záéíóúüñ]+/i).some((p) => p && MARCAS_ES.has(p));
}

/** ¿Este trozo sin reconocer hay que mandarlo a la IA? Solo si tiene letras y no da
 *  ninguna señal de estar ya en español. */
function esPendiente(texto) {
  return tieneLetras(texto) && !pareceEspanol(texto);
}

/* ── Etiquetas (campos de Capital IQ) ── */

const ETIQUETAS_EN_ES = {
  'company name': 'Nombre de la compañía',
  'company type': 'Tipo de compañía',
  'company status': 'Estado de la compañía',
  'company website': 'Sitio web de la compañía',
  'business description': 'Descripción del negocio',
  'sic codes': 'Códigos SIC',
  'sic code': 'Código SIC',
  'primary sic code': 'Código SIC primario',
  'primary sic': 'Código SIC primario',
  'total revenue': 'Ingresos totales',
  'revenue': 'Ingresos',
  'cost of goods sold': 'Costo de ventas',
  'cost of revenue': 'Costo de ventas',
  'operating income': 'Utilidad operacional',
  'operating profit': 'Utilidad operacional',
  'total inventory': 'Inventarios totales',
  'accounts receivable': 'Cuentas por cobrar',
  'total receivables': 'Cuentas por cobrar totales',
  'accounts payable': 'Cuentas por pagar',
  'net property plant and equipment': 'Propiedad, planta y equipo neta',
  'property plant and equipment': 'Propiedad, planta y equipo',
  'total assets': 'Activos totales',
  'total equity': 'Patrimonio total',
  'geographic locations': 'Ubicación geográfica',
  'exchange country': 'País de la bolsa',
  'country': 'País',
  'country/region': 'País o región',
  'all available holders - % owned by single holder': 'Accionistas conocidos — % en manos de un solo accionista',
  'fiscal year end': 'Cierre del año fiscal',
  'industry classifications': 'Clasificación industrial',
  'primary industry': 'Industria principal',
  'number of employees': 'Número de empleados',
  'market capitalization': 'Capitalización de mercado',
  'keyword': 'Palabra clave',
  'keywords': 'Palabras clave',
  /* Redacciones de las plantillas del informe y del estudio anterior
     (brain_estudio_pasado.txt:1114-1149): entran como están y salen como están. */
  'nivel de propiedad': 'Nivel de propiedad',
  'información compañía': 'Información compañía',
  'información de la compañía': 'Información de la compañía',
  'exclusión de fin de año fiscal': 'Exclusión de fin de año fiscal',
  'criterios de inclusión': 'Criterios de inclusión',
};

/** Añade la forma española como entrada válida, para que traducir dos veces dé lo mismo. */
function conIdentidades(mapa) {
  const salida = { ...mapa };
  Object.values(mapa).forEach((es) => { salida[norm(es)] = es; });
  return salida;
}

export const ETIQUETAS_IQ = conIdentidades(ETIQUETAS_EN_ES);

/* ── Sufijos de periodo y de unidad que Capital IQ cuelga de cada campo financiero ──
   El año se conserva por captura: no se traduce, se copia. */

export const SUFIJOS = [
  [/^\[FY\s*(\d{2,4})\]$/i, '[año fiscal $1]'],
  [/^\[CY\s*(\d{2,4})\]$/i, '[año calendario $1]'],
  [/^\[LTM\]$/i, '[últimos 12 meses]'],
  [/^\[Latest\]$/i, '[último dato]'],
  [/^\[Latest Quarter\]$/i, '[último trimestre]'],
  [/^\[Latest Annual\]$/i, '[último año]'],
  [/^\(\$USDmm,\s*Historical rate\)$/i, '(millones de USD, tasa histórica)'],
  [/^\(\$USDmm,\s*Today'?s rate\)$/i, '(millones de USD, tasa de hoy)'],
  [/^\(\$USDmm\)$/i, '(millones de USD)'],
  [/^\(\$USD,\s*Historical rate\)$/i, '(USD, tasa histórica)'],
  [/^\(\$USD\)$/i, '(USD)'],
  /* Identidades: la forma ya traducida vuelve a pasar sin cambio. */
  [/^\[año fiscal\s*(\d{2,4})\]$/i, '[año fiscal $1]'],
  [/^\[año calendario\s*(\d{2,4})\]$/i, '[año calendario $1]'],
  [/^\[últimos 12 meses\]$/i, '[últimos 12 meses]'],
  [/^\[último dato\]$/i, '[último dato]'],
  [/^\[último trimestre\]$/i, '[último trimestre]'],
  [/^\[último año\]$/i, '[último año]'],
  [/^\(millones de USD,\s*tasa histórica\)$/i, '(millones de USD, tasa histórica)'],
  [/^\(millones de USD,\s*tasa de hoy\)$/i, '(millones de USD, tasa de hoy)'],
  [/^\(millones de USD\)$/i, '(millones de USD)'],
  [/^\(USD,\s*tasa histórica\)$/i, '(USD, tasa histórica)'],
  [/^\(USD\)$/i, '(USD)'],
];

/* ── Valores enumerados ── */

const VALORES_EN_ES = {
  'public company': 'Compañía pública',
  'private company': 'Compañía privada',
  'public investment firm': 'Firma de inversión pública',
  'private investment firm': 'Firma de inversión privada',
  'operating': 'En operación',
  'operating subsidiary': 'Subsidiaria en operación',
  'acquired/merged': 'Adquirida o fusionada',
  'liquidating': 'En liquidación',
  'out of business': 'Fuera de operación',
  'reorganizing': 'En reorganización',
  'yes': 'Sí',
  'no': 'No',
  'primary': 'principal',
};

export const VALORES_IQ = conIdentidades(VALORES_EN_ES);

/* ── Muletillas que Capital IQ agrega entre paréntesis ── */

const BOILERPLATE_EN_ES = [
  ['(Unreported data set to 0)', '(los datos no reportados se toman como 0)'],
  ['(Primary)', '(principal)'],
];

export const BOILERPLATE = BOILERPLATE_EN_ES.concat(
  BOILERPLATE_EN_ES.map(([, es]) => [es, es])
);

/* ── Operadores de comparación ──
   Ordenados de más largo a más corto para que «is greater than or equal to» no se coma
   por «is greater than». `is between … and …` se trata aparte, más abajo. */

const OPERADORES_EN_ES = [
  ['is greater than or equal to', 'es mayor o igual que'],
  ['is less than or equal to', 'es menor o igual que'],
  ['is greater than', 'es mayor que'],
  ['is less than', 'es menor que'],
  ['is not equal to', 'es distinto de'],
  ['is equal to', 'es igual a'],
  ['does not contain', 'no contiene'],
  ['is any of', 'es cualquiera de'],
  ['starts with', 'empieza por'],
  ['ends with', 'termina en'],
  ['contains', 'contiene'],
  ['is in', 'está en'],
  ['is not', 'no es'],
];

export const OPERADORES = OPERADORES_EN_ES
  .concat(OPERADORES_EN_ES.map(([, es]) => [es, es]))
  .sort((a, b) => b[0].length - a[0].length);

/* Operadores cuya cola es un término de búsqueda literal —la cadena que se escribió en
   Capital IQ—, no texto por traducir. */
const OPERADORES_LITERALES = new Set([
  'contains', 'does not contain', 'starts with', 'ends with',
  'contiene', 'no contiene', 'empieza por', 'termina en',
]);

/* ── Catálogo de títulos SIC ──

   Catálogo de crecimiento: se siembra con la familia 737x, la única verificable en el
   material del repo (el Excel real de END GAME 2025 y las Tablas 13-15 del informe
   anterior). Cualquier código ausente conserva su título en inglés y se reporta como
   residuo, así que lo resuelve la IA y queda registrado en el log del Motor para poder
   promoverlo aquí. Nunca inventar un título: un SIC mal nombrado describe una industria
   que no se cribó. */

export const TITULOS_SIC = {
  7370: 'Servicios de computación y procesamiento de datos',
  7371: 'Servicios de programación de computadores',
  7372: 'Software preempaquetado',
  7373: 'Servicios integrados de diseño de sistemas de computación',
  7374: 'Servicios de procesamiento de datos y preparación de información',
  7375: 'Servicios de recuperación de información',
  7376: 'Servicios de gestión de instalaciones de computación',
  7377: 'Arrendamiento de equipos de computación',
  7378: 'Mantenimiento y reparación de equipos de computación',
  7379: 'Servicios relacionados con computación',
};

/* ══════════════ Traducción ══════════════ */

/** Separa los sufijos entre corchetes o paréntesis del final de la etiqueta. */
function partirEtiqueta(etiqueta) {
  const original = String(etiqueta == null ? '' : etiqueta).replace(/\s+/g, ' ').trim();
  const sufijos = [];
  let base = original;
  const rx = /\s*(\[[^[\]]*\]|\([^()]*\))$/;
  let m = base.match(rx);
  while (m) {
    sufijos.unshift(m[1]);
    base = base.slice(0, m.index).trim();
    m = base.match(rx);
  }
  /* Una etiqueta que es solo un paréntesis no tiene base que traducir: se deja entera. */
  if (!base) return { base: original, sufijos: [] };
  return { base, sufijos };
}

function traducirSufijo(sufijo) {
  for (const [rx, es] of SUFIJOS) {
    if (rx.test(sufijo)) return { texto: sufijo.replace(rx, es), pendiente: null };
  }
  return { texto: sufijo, pendiente: esPendiente(sufijo) ? sufijo : null };
}

function traducirEtiqueta(etiqueta) {
  const { base, sufijos } = partirEtiqueta(etiqueta);
  const pendientes = [];
  const clave = norm(base);
  let baseEs = ETIQUETAS_IQ[clave];
  if (!baseEs) {
    baseEs = base;
    if (esPendiente(base)) pendientes.push(base);
  }
  const partes = [baseEs];
  sufijos.forEach((s) => {
    const t = traducirSufijo(s);
    partes.push(t.texto);
    if (t.pendiente) pendientes.push(t.pendiente);
  });
  return { texto: partes.filter((p) => p !== '').join(' '), pendientes };
}

/** Reemplaza un literal sin tratarlo como expresión regular, sin importar mayúsculas. */
function reemplazarLiteral(texto, literal, es) {
  const rx = new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return texto.replace(rx, es);
}

/** Traduce la cola de un operador numérico: cifras más muletillas de Capital IQ. Lo que
 *  quede después de consumir las muletillas es lo que decide si hay pendiente. */
function traducirCola(cola) {
  let texto = cola;
  let sinConsumir = cola;
  for (const [en, es] of BOILERPLATE) {
    if (reemplazarLiteral(sinConsumir, en, '') !== sinConsumir) {
      texto = reemplazarLiteral(texto, en, es);
      sinConsumir = reemplazarLiteral(sinConsumir, en, ' ');
    }
  }
  return { texto, pendiente: esPendiente(sinConsumir) ? sinConsumir.trim() : null };
}

/** Copia en la salida la caja de la primera letra de la entrada: así «Entre 7371 y 7375»
 *  no se convierte en «entre 7371 y 7375» al volver a pasar por aquí. */
function espejarCaja(entrada, salida) {
  const a = String(entrada || '');
  const b = String(salida || '');
  if (!a || !b) return b;
  const inicialAlta = a[0] === a[0].toUpperCase() && a[0] !== a[0].toLowerCase();
  if (inicialAlta) return b[0].toUpperCase() + b.slice(1);
  return b;
}

function minusculaInicial(texto) {
  const t = String(texto || '');
  return t ? t[0].toLowerCase() + t.slice(1) : t;
}

const RX_PALABRA_CLAVE = /^(?:keyword|keywords|palabra clave|palabras clave)\s*:\s*(.*)$/i;
const RX_ENTRE = /^(is\s+between|est[áa]\s+entre|between|entre)\s+(.+?)\s+(?:and|y)\s+(.+)$/i;

function traducirSegmento(segmento, encadenado) {
  const bruto = String(segmento || '').trim();
  if (!bruto) return { texto: '', pendiente: null };

  /* El término buscado es la cadena literal que se escribió en Capital IQ: se traduce la
     etiqueta «Keyword», nunca lo buscado. */
  const mClave = bruto.match(RX_PALABRA_CLAVE);
  if (mClave) return { texto: 'Palabra clave: ' + mClave[1].trim(), pendiente: null };

  const mEntre = bruto.match(RX_ENTRE);
  if (mEntre) {
    const conVerbo = /^(is\s+between|est[áa]\s+entre)$/i.test(mEntre[1]);
    const desde = traducirCola(mEntre[2]);
    const hasta = traducirCola(mEntre[3]);
    const texto = (conVerbo ? 'está entre ' : 'entre ') + desde.texto + ' y ' + hasta.texto;
    return {
      texto: encadenado ? texto : espejarCaja(bruto, texto),
      pendiente: desde.pendiente || hasta.pendiente,
    };
  }

  for (const [en, es] of OPERADORES) {
    const rx = new RegExp('^' + en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b\\s*(.*)$', 'i');
    const m = bruto.match(rx);
    if (!m) continue;
    const cola = m[1].trim();
    const literal = OPERADORES_LITERALES.has(en);
    const t = literal ? { texto: cola, pendiente: null } : traducirCola(cola);
    const texto = (es + (t.texto ? ' ' + t.texto : '')).trim();
    return {
      texto: encadenado ? texto : espejarCaja(bruto, texto),
      pendiente: t.pendiente,
    };
  }

  const enumerado = VALORES_IQ[norm(bruto)];
  if (enumerado) {
    return { texto: encadenado ? minusculaInicial(enumerado) : espejarCaja(bruto, enumerado), pendiente: null };
  }

  const conMuletillas = traducirCola(bruto);
  return { texto: conMuletillas.texto, pendiente: conMuletillas.pendiente };
}

/* El conector que une valores dentro de un mismo campo va SIEMPRE en mayúsculas en el
   export de Capital IQ («Public Company OR Private Company»). Exigir mayúsculas es lo que
   evita partir «Entre 7371 y 7375» por su «y». */
const RX_CONECTOR = /\s+(OR|AND|O|Y)\s+/;
const RX_CONECTOR_SIC = /\s+(OR|AND|O|Y)\s+(?=\d{3,4}\b)/;

function conectorEs(sep) {
  return /^(OR|O)$/.test(sep) ? 'O' : 'Y';
}

/** Valor de un criterio de códigos SIC: «NNNN título [OR NNNN título]*».
 *  Devuelve null si no tiene esa forma, para que siga el camino general. */
function traducirValorSic(valor) {
  const partes = String(valor).trim().split(RX_CONECTOR_SIC);
  const salida = [];
  const pendientes = [];
  for (let i = 0; i < partes.length; i += 2) {
    const m = String(partes[i]).trim().match(/^(\d{3,4})\s+(.+)$/);
    if (!m) return null;
    const codigo = m[1];
    const tituloCrudo = m[2].trim();
    const es = TITULOS_SIC[codigo];
    if (es) {
      salida.push(codigo + ' ' + es);
    } else {
      salida.push(codigo + ' ' + tituloCrudo);
      if (esPendiente(tituloCrudo)) pendientes.push(tituloCrudo);
    }
    if (partes[i + 1]) salida.push(conectorEs(partes[i + 1]));
  }
  return { texto: salida.join(' '), pendientes };
}

function traducirValor(valor, etiquetaBase) {
  const bruto = String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim();
  if (!bruto) return { texto: '', pendientes: [] };

  /* Solo se intenta el camino SIC cuando el campo es de códigos SIC: si no, un valor como
     «1000 Millones» se leería como el código 1000. */
  if (norm(etiquetaBase).includes('sic')) {
    const sic = traducirValorSic(bruto);
    if (sic) return { texto: sic.texto, pendientes: sic.pendientes };
  }

  const partes = bruto.split(RX_CONECTOR);
  const salida = [];
  const pendientes = [];
  for (let i = 0; i < partes.length; i += 2) {
    const t = traducirSegmento(partes[i], salida.length > 0);
    salida.push(t.texto);
    if (t.pendiente) pendientes.push(t.pendiente);
    if (partes[i + 1]) salida.push(conectorEs(partes[i + 1]));
  }
  return { texto: salida.filter((p) => p !== '').join(' '), pendientes };
}

/**
 * Traduce un criterio de búsqueda al español.
 *
 * Si el criterio trae `etiquetaEs` / `valorEs` —la traducción que ya cacheó
 * `criteriosScreeningIA.js`—, esos ganan sobre el diccionario y no dejan pendiente.
 * El `conector` pasa intacto: lo intercala quien arma las filas
 * (`filasCriteriosScreening`, tablasInforme.js).
 *
 * @param {{conector?:string|null, etiqueta?:string, valor?:string, etiquetaEs?:string, valorEs?:string}} criterio
 * @returns {{conector:string|null, etiqueta:string, valor:string, residuo:string[]}}
 */
export function traducirCriterio(criterio) {
  const c = criterio || {};
  const residuo = [];

  let etiqueta;
  if (String(c.etiquetaEs || '').trim()) {
    etiqueta = String(c.etiquetaEs).trim();
  } else {
    const t = traducirEtiqueta(c.etiqueta);
    etiqueta = t.texto;
    residuo.push(...t.pendientes);
  }

  let valor;
  if (String(c.valorEs || '').trim()) {
    valor = String(c.valorEs).trim();
  } else {
    const t = traducirValor(c.valor, partirEtiqueta(c.etiqueta).base);
    valor = t.texto;
    residuo.push(...t.pendientes);
  }

  return { conector: c.conector == null ? null : c.conector, etiqueta, valor, residuo };
}

/** Traduce la lista completa, saltando los huecos igual que `filasCriteriosScreening`. */
export function traducirCriterios(criterios) {
  return (criterios || []).filter(Boolean).map(traducirCriterio);
}

/**
 * Criterios que el diccionario no pudo cubrir, con el índice que ocupan en la lista
 * original. Es lo que `criteriosScreeningIA.js` manda a traducir; una lista vacía
 * significa que no hay nada que pedirle a la IA.
 *
 * @param {Array} criterios
 * @returns {{indice:number, residuo:string[]}[]}
 */
export function residuoDeCriterios(criterios) {
  const pendientes = [];
  (criterios || []).forEach((c, indice) => {
    if (!c) return;
    const { residuo } = traducirCriterio(c);
    if (residuo.length) pendientes.push({ indice, residuo });
  });
  return pendientes;
}
