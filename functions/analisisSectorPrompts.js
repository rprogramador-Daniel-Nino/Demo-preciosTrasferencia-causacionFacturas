/* Análisis del Sector (III.C) — búsqueda con Gemini, redacción con Claude,
   parametrizado por la actividad económica real del contribuyente. A
   diferencia del análisis de mercado (Sección III.A/III.B, un solo documento
   global), este se genera una vez por actividad y se reutiliza entre todos
   los estudios que compartan esa misma actividad — ver claveActividad más
   abajo y functions/analisisSectorActualizar.js, que decide cuándo generar
   uno nuevo. */

/* Mismo puerto de extraerJSONDeRespuestaIA que usa analisisMercadoPrompts.js
   (index.html:1994-2012) — se duplica aquí por la misma razón que allá: este
   módulo no comparte código con index.html ni con frontend/src. */
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

/* ─────────────────────────────────────────────────────────────────────────────
   Clave de reutilización: dos estudios con la misma actividad (aunque de
   clientes distintos) comparten el mismo análisis de sector, así que no hay
   que volver a consumir IA para generarlo. La clave sale de normalizar el
   texto libre de actividad_especifica —minúsculas, sin tildes, espacios
   colapsados— y hashearlo a un id corto y válido como documento de Firestore
   (el texto original puede traer cualquier carácter, incluida "/", que
   Firestore prohíbe en un id). Debe existir una copia idéntica en
   frontend/src/services/analisisMercado.js: frontend decide qué leer/pedir,
   backend decide dónde escribir, y tienen que coincidir en la misma clave.
   ───────────────────────────────────────────────────────────────────────────── */

function normalizarActividad(actividad) {
  return String(actividad || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hash FNV-1a de 32 bits, en base36: corto, determinista, sin caracteres que
 *  Firestore rechace en un id de documento. No necesita resistir colisiones
 *  adversarias —es una clave de caché, no un control de acceso—, solo ser
 *  estable para el mismo texto normalizado. */
function claveActividad(actividadNormalizada) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < actividadNormalizada.length; i++) {
    hash ^= actividadNormalizada.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 'act_' + (hash >>> 0).toString(36);
}

function construirPromptBusquedaSector(actividad, year) {
  const y1 = year - 1;
  return (
    'Usa la búsqueda de Google para encontrar información real y verificable sobre el sector ' +
    'económico de esta actividad en Colombia: "' + actividad + '". Necesito datos para el año ' +
    y1 + ' y para el año ' + year + ', y proyecciones para ' + (year + 1) + '.\n\n' +
    'Responde ÚNICAMENTE con un objeto JSON (sin texto adicional, sin marcas markdown) con esta forma:\n' +
    '{\n' +
    '  "datosClaveTabla": [\n' +
    '    { "indicador": "Empleo del sector", "valorAnterior": "...", "valorActual": "...", "fuente": "...", "fuenteUrl": "https://..." },\n' +
    '    { "indicador": "Exportaciones del sector", "valorAnterior": "...", "valorActual": "...", "fuente": "...", "fuenteUrl": "https://..." }\n' +
    '  ],\n' +
    '  "datosComportamiento": [ { "dato": "descripción de un hecho o cifra sobre el comportamiento del sector en ' + year + '", "fuente": "...", "fuenteUrl": "https://..." } ],\n' +
    '  "datosComercioExterior": [ { "dato": "cifra de importaciones o exportaciones del sector", "fuente": "...", "fuenteUrl": "https://..." } ],\n' +
    '  "datosProyeccion": [ { "dato": "proyección o expectativa para el sector en ' + (year + 1) + '", "fuente": "...", "fuenteUrl": "https://..." } ]\n' +
    '}\n\n' +
    'Reglas estrictas:\n' +
    '1. Solo incluye datos que hayas verificado con la búsqueda. Si no encuentras nada confiable ' +
    'para una sección, deja su arreglo vacío — no inventes una cifra ni un dato.\n' +
    '2. "fuenteUrl" debe ser la URL real de la página que consultaste con la búsqueda, nunca una ' +
    'que recuerdes de memoria.\n' +
    '3. "datosClaveTabla" son indicadores cuantitativos comparables entre ' + y1 + ' y ' + year + ' ' +
    '(empleo, exportaciones, tamaño del mercado, inversión, etc.) — máximo 6 filas, las más relevantes.\n' +
    '4. No agregues ninguna clave que no esté en la lista de arriba.'
  );
}

/** Confiable a nivel de respuesta completa, no por URL puntual: los
 *  groundingChunks de Gemini son redirecciones propias de Google, nunca la URL
 *  del medio que el modelo cita — comparar cadena a cadena nunca coincide (ver
 *  el mismo ajuste en analisisMercadoPrompts.js, Importante 3 de la revisión
 *  final del análisis de mercado). */
function parsearRespuestaBusquedaSector(texto, groundingChunks) {
  const bruto = extraerJSON(texto);
  const huboBusquedaReal = Array.isArray(groundingChunks) && groundingChunks.length > 0;

  const datosClaveTabla = (Array.isArray(bruto.datosClaveTabla) ? bruto.datosClaveTabla : [])
    .filter((f) => f && typeof f.indicador === 'string' && f.indicador.trim() && typeof f.valorActual === 'string' && f.valorActual.trim())
    .slice(0, 6)
    .map((f) => ({
      indicador: f.indicador,
      valorAnterior: typeof f.valorAnterior === 'string' ? f.valorAnterior : '',
      valorActual: f.valorActual,
      fuente: f.fuente || 'Fuente sin especificar',
      fuenteUrl: huboBusquedaReal ? (f.fuenteUrl || null) : null,
      confiable: huboBusquedaReal,
    }));

  const listaDeDatos = (clave) =>
    (Array.isArray(bruto[clave]) ? bruto[clave] : [])
      .filter((f) => f && typeof f.dato === 'string' && f.dato.trim())
      .map((f) => ({
        dato: f.dato,
        fuente: f.fuente || 'Fuente sin especificar',
        fuenteUrl: huboBusquedaReal ? (f.fuenteUrl || null) : null,
        confiable: huboBusquedaReal,
      }));

  return {
    datosClaveTabla,
    datosComportamiento: listaDeDatos('datosComportamiento'),
    datosComercioExterior: listaDeDatos('datosComercioExterior'),
    datosProyeccion: listaDeDatos('datosProyeccion'),
  };
}

/** Solo lo confiable llega al prompt de redacción — igual que en el análisis
 *  de mercado, Claude nunca ve un dato que Gemini no haya verificado con una
 *  búsqueda real. */
function filtrarConfiables(datos) {
  return {
    datosClaveTabla: datos.datosClaveTabla.filter((f) => f.confiable),
    datosComportamiento: datos.datosComportamiento.filter((f) => f.confiable),
    datosComercioExterior: datos.datosComercioExterior.filter((f) => f.confiable),
    datosProyeccion: datos.datosProyeccion.filter((f) => f.confiable),
  };
}

function construirPromptRedaccionSector(datos, actividad, year) {
  const y1 = year - 1;
  const resumir = (lista) => lista.map((f) => '- ' + f.dato + ' (fuente: ' + f.fuente + (f.fuenteUrl ? ', ' + f.fuenteUrl : '') + ')').join('\n') || '(sin datos verificados)';
  const resumenTabla = datos.datosClaveTabla
    .map((f) => '- ' + f.indicador + ': ' + y1 + '=' + (f.valorAnterior || 's/d') + ', ' + year + '=' + f.valorActual + ' (fuente: ' + f.fuente + ')')
    .join('\n') || '(sin datos verificados)';

  return (
    'Eres economista sectorial y redactas el análisis de sector (Sección III.C) de un informe local ' +
    'de precios de transferencia para Colombia, para la actividad: "' + actividad + '", año gravable ' +
    year + '. Tienes ÚNICAMENTE estos datos ya verificados:\n\n' +
    'Datos clave (tabla, no la redactes, ya se arma aparte):\n' + resumenTabla + '\n\n' +
    'Comportamiento del sector:\n' + resumir(datos.datosComportamiento) + '\n\n' +
    'Comercio exterior:\n' + resumir(datos.datosComercioExterior) + '\n\n' +
    'Proyección para ' + (year + 1) + ':\n' + resumir(datos.datosProyeccion) + '\n\n' +
    'Redacta cuatro apartados en español, tono técnico-formal (mínimo 1 párrafo cada uno, más si hay ' +
    'material), más un título corto para los encabezados de esta sección:\n' +
    '1. "tituloSector": el fragmento que completa la frase "Análisis del Sector de la industria ___", ' +
    'con la preposición correcta en español y en 2 a 6 palabras (ej. "del software y los videojuegos", ' +
    '"de la construcción", "de los alimentos procesados") — a partir de la actividad de arriba, no la ' +
    'copies completa, resúmela.\n' +
    '2. "comportamiento": comportamiento del sector en ' + year + ' y comparación con ' + y1 + '.\n' +
    '3. "comercioExterior": importaciones y exportaciones del sector.\n' +
    '4. "proyeccion": qué se proyecta para el sector en ' + (year + 1) + '.\n' +
    '5. "conclusiones": conclusiones y perspectivas del sector, relevantes para evaluar la ' +
    'comparabilidad de la parte examinada.\n\n' +
    'Reglas estrictas:\n' +
    '- NO menciones ninguna cifra que no esté en los datos de arriba. Si no tienes datos para un ' +
    'apartado, redáctalo en términos cualitativos sin inventar números.\n' +
    '- Cada apartado (excepto tituloSector) en HTML, como párrafos <p>...</p>, sin encabezados ni ' +
    'tablas (la tabla de datos clave se arma aparte, no la repitas).\n' +
    '- Responde ÚNICAMENTE con un objeto JSON (sin marcas markdown) con esta forma exacta:\n' +
    '{ "tituloSector": "...", "comportamiento": "<p>...</p>", "comercioExterior": "<p>...</p>", ' +
    '"proyeccion": "<p>...</p>", "conclusiones": "<p>...</p>", "fuentesCitadas": [{"titulo":"...","url":"..."}] }'
  );
}

const MIN_LARGO_APARTADO = 20;

function parsearRespuestaRedaccionSector(texto) {
  const bruto = extraerJSON(texto);
  if (typeof bruto.tituloSector !== 'string' || !bruto.tituloSector.trim()) {
    throw new Error('La redacción del sector no trajo "tituloSector".');
  }
  for (const campo of ['comportamiento', 'comercioExterior', 'proyeccion', 'conclusiones']) {
    if (typeof bruto[campo] !== 'string' || bruto[campo].replace(/<[^>]*>/g, '').trim().length < MIN_LARGO_APARTADO) {
      throw new Error('La redacción del sector no trajo "' + campo + '" con contenido suficiente.');
    }
  }
  const fuentesCitadas = (Array.isArray(bruto.fuentesCitadas) ? bruto.fuentesCitadas : [])
    .filter((f) => f && typeof f.titulo === 'string' && f.titulo.trim() && typeof f.url === 'string' && f.url.trim());

  return {
    tituloSector: bruto.tituloSector.trim(),
    comportamiento: bruto.comportamiento,
    comercioExterior: bruto.comercioExterior,
    proyeccion: bruto.proyeccion,
    conclusiones: bruto.conclusiones,
    fuentesCitadas,
  };
}

/** Entrada de `porAnio` para un año dado. No escribe nada por sí misma — eso
 *  lo hace la capa impura (analisisSectorActualizar.js) — solo decide la
 *  forma, y solo si hay suficiente para publicar. */
function armarEntradaAnio({ datosVerificados, narrativa, ahora }) {
  if (!narrativa) {
    throw new Error('Falta la narrativa redactada: no se arma la entrada del año.');
  }
  return {
    actualizadoEn: ahora,
    tituloSector: narrativa.tituloSector,
    datosClaveTabla: datosVerificados.datosClaveTabla,
    narrativa: {
      comportamiento: narrativa.comportamiento,
      comercioExterior: narrativa.comercioExterior,
      proyeccion: narrativa.proyeccion,
      conclusiones: narrativa.conclusiones,
      fuentesCitadas: narrativa.fuentesCitadas,
    },
  };
}

module.exports = {
  extraerJSON,
  normalizarActividad,
  claveActividad,
  construirPromptBusquedaSector,
  parsearRespuestaBusquedaSector,
  filtrarConfiables,
  construirPromptRedaccionSector,
  parsearRespuestaRedaccionSector,
  armarEntradaAnio,
};
