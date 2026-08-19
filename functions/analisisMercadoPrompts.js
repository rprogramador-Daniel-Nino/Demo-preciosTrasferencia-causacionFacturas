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
   meta_inflacion_banrep porque es una meta de política fija, no una serie que buscar.

   `fuenteProyeccion` está en las series cuyo publicador SOLO da el dato realizado. Medido
   en Firestore el 2026-08-13, `desempleo_colombia` y `trm_promedio` eran las dos únicas que
   volvían sin el año de proyección —las demás traían hasta anioActual+2—, y la causa era
   esta: preguntar por «la tasa de desempleo de Colombia (DANE, GEIH)» para 2026 no tiene
   respuesta, porque el DANE publica lo ocurrido, no un pronóstico. El modelo omitía ese año
   bien (la regla 3 le prohíbe inventarlo) y el informe salía con «Desempleo Proyectado 2026:
   [Completar…]». Quien sí pronostica es otro: el FMI, la OCDE, Fedesarrollo o la Encuesta de
   Expectativas del propio Banco de la República. */
const SERIES_MACRO = [
  { clave: 'pib_mundial', pregunta: 'crecimiento porcentual del PIB mundial (FMI, World Economic Outlook)' },
  { clave: 'pib_colombia', pregunta: 'crecimiento porcentual del PIB de Colombia (DANE / FMI)' },
  { clave: 'inflacion_global', pregunta: 'inflación global promedio (OCDE / FMI)' },
  { clave: 'inflacion_colombia', pregunta: 'inflación anual de Colombia, variación del IPC (DANE)' },
  { clave: 'tasa_intervencion', pregunta: 'tasa de intervención del Banco de la República de Colombia, con la fecha de cada decisión relevante' },
  {
    clave: 'trm_promedio',
    pregunta: 'TRM promedio anual de Colombia (Banco de la República)',
    fuenteProyeccion: 'la Encuesta Mensual de Expectativas de Analistas Económicos del Banco de la República, o las proyecciones de tasa de cambio de Bancolombia, Corficolombiana o Fedesarrollo',
  },
  {
    clave: 'desempleo_colombia',
    pregunta: 'tasa de desempleo de Colombia (DANE, GEIH)',
    fuenteProyeccion: 'las proyecciones de desempleo del FMI (World Economic Outlook), la OCDE, Fedesarrollo o la Encuesta Mensual de Expectativas de Analistas Económicos del Banco de la República',
  },
  { clave: 'crecimiento_por_region', pregunta: 'proyecciones de crecimiento del PIB por región/país: Mundial, Estados Unidos, China, América Latina, Colombia (FMI/OCDE)' },
];

function construirPromptBusqueda(anioActual) {
  const anios = [anioActual - 2, anioActual - 1, anioActual, anioActual + 1];
  /* Dos años, no uno: este cron es global y no sabe para qué informe se va a usar cada
     corrida. Un informe de año gravable `anioActual - 1` —el caso más común, un informe que
     se radica el año después del que declara— necesita `anioActual` como SU año de
     proyección, porque el DANE todavía no cerró ese año. Uno de año gravable `anioActual`
     necesita `anioActual + 1`. Pedir solo `anioActual + 1` (como antes) dejaba sin cubrir el
     primer caso: para el cron `anioActual` es simplemente "el año en curso", así que la
     pregunta genérica de DANE/GEIH no encontraba nada (el año no ha cerrado) y el informe
     salía con «Desempleo Proyectado <anioActual>: [Completar...]». */
  const aniosProyeccion = [anioActual, anioActual + 1];
  const lista = SERIES_MACRO.map((s) => '- "' + s.clave + '": ' + s.pregunta + '.').join('\n');

  /* La instrucción va aparte de la lista de series y nombra los años explícitamente: dentro de
     la lista, «(DANE, GEIH)» pesa más que la ventana de años y el modelo se queda con el
     publicador histórico. */
  const proyecciones = SERIES_MACRO
    .filter((s) => s.fuenteProyeccion)
    .map((s) => '- "' + s.clave + '": para ' + aniosProyeccion.join(' y ') + ' consulta ' + s.fuenteProyeccion + '.')
    .join('\n');

  /* «Responde ÚNICAMENTE con un objeto JSON» era lo que rompía esta corrida: con esa
     exigencia de formato el modelo se salta la búsqueda y contesta de memoria. Devolvía las
     ocho series completas y bien formadas, pero con `groundingChunks` vacío, y como la
     confiabilidad se mide justo por ahí, la corrida entera se descartaba
     (`analisisMercadoActualizar.js`). Ahora se le pide primero que busque y cite, y el JSON
     se admite acompañado de texto: `extraerJSON` escanea llaves balanceadas, así que
     tolera prosa y markdown alrededor. */
  return (
    'Busca en la web, una por una, cada serie macroeconómica de la lista. NO respondas con ' +
    'cifras que recuerdes: cada valor tiene que salir de una página que hayas consultado en ' +
    'esta misma respuesta, y quiero ver citadas esas fuentes.\n\n' +
    'Series, para los años ' + anios.join(', ') + ':\n\n' + lista + '\n\n' +
    'Los años ' + aniosProyeccion.join(' y ') + ' pueden ser de PROYECCIÓN —según cuál sea el año ' +
    'gravable del informe que use esta corrida, uno de los dos es "el año siguiente" que hay que ' +
    'proyectar— y los quiero para TODAS las series. Ojo: algunas de las fuentes de arriba solo ' +
    'publican el dato ya ocurrido, no un pronóstico, así que para esos dos años hay que buscar en ' +
    'quien sí proyecta:\n\n' + proyecciones + '\n\n' +
    'Si la primera institución que consultes no lo publica, NO te rindas ni dejes el año ' +
    'vacío: sigue buscando en las demás de esa lista y, si ninguna lo trae, en cualquier otro ' +
    'pronóstico publicado y atribuible (banco central, banca de inversión, gremio, centro de ' +
    'investigación económica). Un año sin cifra obliga a completarlo a mano después, así que ' +
    'agota la búsqueda antes de omitirlo.\n\n' +
    'Cuando la cifra de un año venga de una fuente DISTINTA de la principal de esa serie ' +
    '—que es lo normal en un año de proyección—, no la des como un número suelto: devuélvela ' +
    'con SU propia fuente y SU propia URL, así:\n' +
    '  "desempleo_colombia": { "valores": { "' + (anioActual - 1) + '": "8.9", "' + anioActual +
    '": { "valor": "8.7", "fuente": "FMI, WEO Octubre ' + anioActual + '", "fuenteUrl": "https://..." }, "' +
    (anioActual + 1) + '": { "valor": "8.5", "fuente": "FMI, WEO Octubre ' + anioActual +
    '", "fuenteUrl": "https://..." } }, "fuente": "DANE, GEIH", "fuenteUrl": "https://..." }\n' +
    'Ese enlace se publica en la propia celda del informe, para que quien lo lea pueda ' +
    'verificar el pronóstico sin salir del documento. Sin él la cifra no sirve.\n\n' +
    'Esas proyecciones también tienen que salir de una página que hayas consultado: no las ' +
    'estimes tú ni las extrapoles de los años anteriores.\n\n' +
    'Cuando termines de buscar, incluye en tu respuesta un objeto JSON con esta forma (puede ' +
    'ir acompañado del texto y las citas que necesites; lo que importa es que el JSON esté ' +
    'completo y bien formado):\n' +
    '{\n' +
    '  "pib_mundial": { "valores": { "2025": "3.2", "2026": "3.2" }, "fuente": "Fondo Monetario Internacional, WEO", "fuenteUrl": "https://..." },\n' +
    '  "tasa_intervencion": { "valores": { "2026": { "etiqueta": "Agosto 2026", "valor": "12.00" } }, "fuente": "...", "fuenteUrl": "..." },\n' +
    '  "crecimiento_por_region": { "valores": { "2026": [{"region":"Mundial","valor":"3.0"},{"region":"Estados Unidos","valor":"2.0"}] }, "fuente": "...", "fuenteUrl": "..." }\n' +
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

/** La confianza depende de si esta llamada a Gemini trajo grounding real (al
 *  menos un chunk), no de si la fuenteUrl que el modelo escribió coincide con
 *  la URL exacta de algún chunk: los groundingChunks de Gemini son URLs de
 *  redirección propias de Google (vertexaisearch.cloud.google.com/…), nunca la
 *  URL del medio que el modelo cita en el JSON — compararlas byte a byte no
 *  puede coincidir jamás. La fuenteUrl queda como cita del modelo (que sí
 *  acaba de hacer una búsqueda real), no como algo verificado en esa URL
 *  puntual. */
function parsearRespuestaBusqueda(texto, groundingChunks) {
  const bruto = extraerJSON(texto);
  const huboBusquedaReal = Array.isArray(groundingChunks) && groundingChunks.length > 0;
  const clavesValidas = new Set(SERIES_MACRO.map((s) => s.clave));

  const series = {};
  Object.keys(bruto).forEach((clave) => {
    if (!clavesValidas.has(clave)) return;
    const entrada = bruto[clave];
    if (!entrada || typeof entrada.valores !== 'object' || entrada.valores === null) return;

    series[clave] = {
      valores: entrada.valores,
      fuente: entrada.fuente || 'Fuente sin especificar',
      fuenteUrl: huboBusquedaReal ? (entrada.fuenteUrl || null) : null,
      confiable: huboBusquedaReal,
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
    'Redacta lo siguiente, en español, tono técnico-formal. Los apartados 1 y 2 son extensos (mínimo ' +
    '3 párrafos); los apartados 3 a 9 son un solo párrafo corto y específico cada uno — no repitas en ' +
    'ellos lo que ya dijiste en 1 o 2, cada uno cubre SOLO su propio tema:\n' +
    '1. "mundial": Análisis del Panorama de la Economía Mundial — crecimiento del PIB mundial y su ' +
    'tendencia general (sin entrar en inflación ni proyecciones por región, eso va en 3 y 4).\n' +
    '2. "colombia": Análisis del panorama de la economía colombiana — PIB de Colombia y su efecto ' +
    'general sobre empresas que operan en el país (sin entrar en inflación, política monetaria, TRM, ' +
    'desempleo ni conclusiones, eso va en 5 a 9).\n' +
    '3. "inflacionMundial": un párrafo sobre la inflación global y su tendencia.\n' +
    '4. "proyeccionMundial": un párrafo sobre las proyecciones de crecimiento del PIB por región/país.\n' +
    '5. "inflacionColombia": un párrafo sobre la inflación de Colombia (IPC/DANE).\n' +
    '6. "politicaMonetaria": un párrafo sobre la tasa de intervención del Banco de la República y su ' +
    'evolución reciente.\n' +
    '7. "tasaCambio": un párrafo sobre la TRM promedio y su evolución.\n' +
    '8. "mercadoLaboral": un párrafo sobre la tasa de desempleo de Colombia.\n' +
    '9. "conclusiones": un párrafo que cierre el panorama económico de III.A/III.B, sintetizando el ' +
    'efecto conjunto de estas variables sobre empresas que operan en Colombia — no repitas cifras, ' +
    'esto es síntesis, no una fuente nueva.\n' +
    '10. "fuentesCitadas": la lista de las fuentes que efectivamente usaste para redactar cualquiera de ' +
    'los apartados de arriba, cada una con su título y su URL.\n\n' +
    'Reglas estrictas:\n' +
    '- NO menciones ninguna cifra que no esté en los datos de arriba. Si te falta un dato para algo que ' +
    'quieras afirmar, no lo afirmes.\n' +
    '- Si no tienes datos verificados para alguno de los apartados 3 a 8, omite esa clave del JSON por ' +
    'completo — no inventes el párrafo ni lo dejes vacío.\n' +
    '- Cada apartado en HTML, como uno o más párrafos <p>...</p>, sin encabezados ni tablas.\n' +
    '- En "fuentesCitadas" no inventes ninguna fuente ni ninguna URL: usa únicamente las que aparecen ' +
    'en los datos de arriba. Si una serie no trae URL, omítela de la lista.\n' +
    '- Responde ÚNICAMENTE con un objeto JSON (sin marcas markdown) con esta forma exacta:\n' +
    '{ "mundial": "<p>...</p><p>...</p>", "colombia": "<p>...</p><p>...</p>", ' +
    '"inflacionMundial": "<p>...</p>", "proyeccionMundial": "<p>...</p>", ' +
    '"inflacionColombia": "<p>...</p>", "politicaMonetaria": "<p>...</p>", ' +
    '"tasaCambio": "<p>...</p>", "mercadoLaboral": "<p>...</p>", "conclusiones": "<p>...</p>", ' +
    '"fuentesCitadas": [{"titulo":"...","url":"..."}] }'
  );
}

/** La narrativa es crítica: si "mundial" o "colombia" no llegan como texto, la
 *  corrida entera se aborta y se conserva el documento del mes anterior.
 *  "fuentesCitadas" no: es un campo de apoyo (la cita legal de respaldo, que el
 *  informe muestra si está), así que una lista malformada se degrada a [] en vez
 *  de tirar por la borda una redacción por lo demás usable. */
/* Longitud mínima de cada apartado. El contrato pide tres párrafos extensos, así
   que 20 caracteres es un piso deliberadamente bajo: no juzga la calidad, solo
   descarta lo que no es una redacción («», «<p></p>», «N/A»). Sin este piso una
   cadena vacía pasaba la validación de tipo y se guardaba como narrativa, y el
   informe salía con III.A y III.B en blanco en vez de con el marcador que avisa
   qué falta. */
const MIN_LARGO_APARTADO = 20;

/** Campos de tema que son "mejor si están, no bloqueantes" — a diferencia de
 *  "mundial"/"colombia", que siguen siendo obligatorios. Cada uno alimenta un hueco
 *  intermedio específico de III.A/III.B en docxRelleno.js/tablasHtmlInforme.js. */
const CAMPOS_TEMA_OPCIONALES = [
  'inflacionMundial', 'proyeccionMundial', 'inflacionColombia', 'politicaMonetaria',
  'tasaCambio', 'mercadoLaboral', 'conclusiones',
];

function parsearRespuestaRedaccion(texto) {
  const bruto = extraerJSON(texto);
  if (typeof bruto.mundial !== 'string' || typeof bruto.colombia !== 'string') {
    throw new Error('La redacción no trajo "mundial" y "colombia" como texto.');
  }
  if (bruto.mundial.trim().length < MIN_LARGO_APARTADO || bruto.colombia.trim().length < MIN_LARGO_APARTADO) {
    throw new Error('La redacción trajo "mundial" o "colombia" vacío o demasiado corto para ser un apartado.');
  }
  const fuentesCitadas = Array.isArray(bruto.fuentesCitadas)
    ? bruto.fuentesCitadas.filter(
        (f) => f && typeof f.titulo === 'string' && typeof f.url === 'string' && f.titulo && f.url
      ).map((f) => ({ titulo: f.titulo, url: f.url }))
    : [];

  const resultado = { mundial: bruto.mundial, colombia: bruto.colombia, fuentesCitadas };
  CAMPOS_TEMA_OPCIONALES.forEach((campo) => {
    if (typeof bruto[campo] === 'string' && bruto[campo].trim().length >= MIN_LARGO_APARTADO) {
      resultado[campo] = bruto[campo];
    }
  });
  return resultado;
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

  const narrativaDoc = {
    mundial: narrativa.mundial,
    colombia: narrativa.colombia,
    fuentesCitadas: narrativa.fuentesCitadas || [],
  };
  CAMPOS_TEMA_OPCIONALES.forEach((campo) => {
    if (typeof narrativa[campo] === 'string') narrativaDoc[campo] = narrativa[campo];
  });

  return {
    actualizadoEn: ahora,
    series: seriesConFecha,
    narrativa: narrativaDoc,
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
  CAMPOS_TEMA_OPCIONALES,
};
