/* Puerto de extraerJSONDeRespuestaIA (index.html:1994-2012): escanea llaves
   balanceadas respetando cadenas, porque los modelos casi siempre envuelven el JSON
   en prosa o marcas markdown y JSON.parse(texto.trim()) falla apenas sobra una
   palabra. functions/ no comparte código con index.html ni con frontend/src (son
   entornos y formatos de módulo distintos), así que se porta aquí en vez de
   importarlo. */
function extraerJSON(texto) {
  const s = String(texto || '');
  const inicio = s.indexOf('{');
  if (inicio < 0) throw new Error('La respuesta no contiene un objeto JSON.');
  let profundidad = 0, enCadena = false, escapado = false;
  for (let i = inicio; i < s.length; i++) {
    const c = s[i];
    if (enCadena) {
      if (escapado) escapado = false;
      else if (c === '\\') escapado = true;
      else if (c === '"') enCadena = false;
      continue;
    }
    if (c === '"') { enCadena = true; continue; }
    if (c === '{') profundidad++;
    else if (c === '}') { profundidad--; if (profundidad === 0) return JSON.parse(s.slice(inicio, i + 1)); }
  }
  throw new Error('El JSON de la respuesta de la IA quedó incompleto (llaves sin cerrar).');
}

/* Las 8 series de DATOS_MACRO (frontend/src/services/analisisMercado.js), sin
   meta_inflacion_banrep porque es una meta de política fija, no una serie que buscar. */
const SERIES_MACRO = [
  { clave: 'pib_mundial', pregunta: 'crecimiento porcentual del PIB mundial (FMI, World Economic Outlook)' },
  { clave: 'pib_colombia', pregunta: 'crecimiento porcentual del PIB de Colombia (DANE / FMI)' },
  { clave: 'inflacion_global', pregunta: 'inflación global promedio (OCDE / FMI)' },
  { clave: 'inflacion_colombia', pregunta: 'inflación anual de Colombia, variación del IPC (DANE)' },
  { clave: 'tasa_intervencion', pregunta: 'tasa de intervención del Banco de la República de Colombia, con la fecha de cada decisión relevante' },
  { clave: 'trm_promedio', pregunta: 'TRM promedio anual de Colombia (Banco de la República)' },
  { clave: 'desempleo_colombia', pregunta: 'tasa de desempleo de Colombia (DANE, GEIH)' },
  { clave: 'crecimiento_por_region', pregunta: 'proyecciones de crecimiento del PIB por región/país: Mundial, Estados Unidos, China, América Latina, Colombia (FMI/OCDE)' },
];

function construirPromptBusqueda(anioActual) {
  const anios = [anioActual - 2, anioActual - 1, anioActual, anioActual + 1];
  const lista = SERIES_MACRO.map((s) => '- "' + s.clave + '": ' + s.pregunta + '.').join('\n');

  return (
    'Usa la búsqueda de Google para encontrar el valor más reciente y verificable de estas series ' +
    'macroeconómicas, para los años ' + anios.join(', ') + ':\n\n' + lista + '\n\n' +
    'Responde ÚNICAMENTE con un objeto JSON (sin texto adicional, sin marcas markdown) con esta forma:\n' +
    '{\n' +
    '  "pib_mundial": { "valores": { "2025": "3.2", "2026": "3.2" }, "fuente": "Fondo Monetario Internacional, WEO", "fuenteUrl": "https://..." },\n' +
    '  "tasa_intervencion": { "valores": { "2026": { "etiqueta": "Agosto 2026", "valor": "12.00" } }, "fuente": "...", "fuenteUrl": "..." },\n' +
    '  "crecimiento_por_region": { "valores": { "2026": [["Mundial","3.0"],["Estados Unidos","2.0"]] }, "fuente": "...", "fuenteUrl": "..." }\n' +
    '}\n\n' +
    'Reglas estrictas:\n' +
    '1. Cada "valores" es un mapa de año (string) a la cifra encontrada. No inventes un año que no verificaste.\n' +
    '2. "fuenteUrl" debe ser la URL real de la página que consultaste con la búsqueda, nunca una que ' +
    'recuerdes de memoria.\n' +
    '3. Si no encuentras un dato confiable para una serie, omite esa clave del JSON por completo — no la ' +
    'rellenes con un valor inventado ni con un guion.\n' +
    '4. No agregues ninguna clave que no esté en la lista de arriba.'
  );
}

/** Solo se confía en la fuenteUrl que el propio grounding de Gemini reporta haber
 *  consultado — no en una URL que el modelo redacte de memoria dentro del JSON,
 *  que sí puede inventar o recordar mal. */
function parsearRespuestaBusqueda(texto, groundingChunks) {
  const bruto = extraerJSON(texto);
  const urlsVerificadas = new Set(
    (groundingChunks || []).map((g) => g && g.web && g.web.uri).filter(Boolean)
  );
  const clavesValidas = new Set(SERIES_MACRO.map((s) => s.clave));

  const series = {};
  Object.keys(bruto).forEach((clave) => {
    if (!clavesValidas.has(clave)) return;
    const entrada = bruto[clave];
    if (!entrada || typeof entrada.valores !== 'object' || entrada.valores === null) return;

    const urlConfiable = urlsVerificadas.has(entrada.fuenteUrl);
    series[clave] = {
      valores: entrada.valores,
      fuente: entrada.fuente || 'Fuente sin especificar',
      fuenteUrl: urlConfiable ? entrada.fuenteUrl : null,
      confiable: urlConfiable,
    };
  });
  return series;
}

function construirPromptRedaccion(series, anioActual) {
  const resumen = Object.keys(series).map((clave) => {
    const s = series[clave];
    return '- ' + clave + ': ' + JSON.stringify(s.valores) + ' (fuente: ' + s.fuente + (s.fuenteUrl ? ', ' + s.fuenteUrl : '') + ')';
  }).join('\n');

  return (
    'Eres economista y redactas la Sección III ("TENDENCIAS DE LA ECONOMÍA") de un informe local de ' +
    'precios de transferencia para Colombia, año gravable ' + anioActual + '. Tienes ÚNICAMENTE estos ' +
    'datos ya verificados, con su fuente:\n\n' + resumen + '\n\n' +
    'Redacta dos apartados extensos (mínimo 3 párrafos cada uno, tono técnico-formal, en español):\n' +
    '1. "mundial": Análisis del Panorama de la Economía Mundial — crecimiento del PIB mundial, ' +
    'inflación global y su tendencia, riesgos y factores relevantes del período.\n' +
    '2. "colombia": Análisis del panorama de la economía colombiana — PIB, inflación, tasa de ' +
    'intervención del Banco de la República, TRM, desempleo, y su efecto sobre empresas que operan en ' +
    'el país.\n\n' +
    'Reglas estrictas:\n' +
    '- NO menciones ninguna cifra que no esté en los datos de arriba. Si te falta un dato para algo que ' +
    'quieras afirmar, no lo afirmes.\n' +
    '- Cada apartado en HTML, como una serie de párrafos <p>...</p>, sin encabezados ni tablas.\n' +
    '- Responde ÚNICAMENTE con un objeto JSON (sin marcas markdown) con esta forma exacta:\n' +
    '{ "mundial": "<p>...</p><p>...</p>", "colombia": "<p>...</p><p>...</p>" }'
  );
}

function parsearRespuestaRedaccion(texto) {
  const bruto = extraerJSON(texto);
  if (typeof bruto.mundial !== 'string' || typeof bruto.colombia !== 'string') {
    throw new Error('La redacción no trajo "mundial" y "colombia" como texto.');
  }
  return { mundial: bruto.mundial, colombia: bruto.colombia };
}

/** Documento final para `analisisMercado/actual`. No escribe nada por sí mismo —
 *  eso lo hace la capa impura (Task 2) — solo decide la forma. */
function armarDocumentoFirestore({ series, narrativa, ahora }) {
  if (!series || !Object.keys(series).length) {
    throw new Error('No hay ninguna serie verificada: no se arma el documento.');
  }
  if (!narrativa || typeof narrativa.mundial !== 'string' || typeof narrativa.colombia !== 'string') {
    throw new Error('Falta la narrativa redactada: no se arma el documento.');
  }

  const seriesConFecha = {};
  Object.keys(series).forEach((clave) => {
    seriesConFecha[clave] = { ...series[clave], fechaConsulta: ahora };
  });

  return {
    actualizadoEn: ahora,
    series: seriesConFecha,
    narrativa: { mundial: narrativa.mundial, colombia: narrativa.colombia },
  };
}

module.exports = {
  SERIES_MACRO,
  extraerJSON,
  construirPromptBusqueda,
  parsearRespuestaBusqueda,
  construirPromptRedaccion,
  parsearRespuestaRedaccion,
  armarDocumentoFirestore,
};
