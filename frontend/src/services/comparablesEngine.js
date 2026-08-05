import XLSX from 'xlsx-js-style';
import axios from 'axios';
import { num, pliOf } from '../utils/calculations.js';
import { esHolding } from './filtrosComparablesPatch.js';

/**
 * Normaliza nombres de empresas para cruces de continuidad
 */
export function nameKey(str) {
  if (!str) return '';
  return String(str)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    /* Capital IQ agrega el sufijo de bolsa/ticker entre parentesis al nombre,
       p. ej. "Akatsuki Inc. (TSE:3932)" - el estudio del anio anterior nunca
       lo trae, asi que sin esto el cruce de continuidad nunca encontraba
       coincidencias aunque la compania siguiera en el universo. */
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(COLOMBIA|INC|INC\.|CORP|CORP\.|LTD|LTD\.|LLC|S\.A\.S\.|SAS|S\.A\.|SA|LTDA|S\.A\. DE C\.V\.|C\.A\.|PLC|NV|GMBH|BV|CO\.|COMPANY|CORPORATION|LIMITED)\b/gi, '')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Localiza la hoja de cribado. El export de Capital IQ trae varias —Screening,
 * Aggregates, Screen Criteria— y las candidatas están en la primera. Tomar
 * SheetNames[0] a ciegas funciona por casualidad cuando Screening va primera.
 */
export function elegirHoja(nombresDeHoja) {
  const lista = nombresDeHoja || [];
  return lista.find(n => /screening|cribado|candidat/i.test(n)) || lista[0] || '';
}

/**
 * Extrae los criterios de búsqueda de la hoja "Screen Criteria" del export de
 * Capital IQ —aparte de "Screening" (las candidatas) y "Aggregates"—, para
 * poder reconstruir la Tabla 13 (Códigos SIC utilizados) del informe con la
 * corrida real de este año en vez de arrastrar la del informe anterior (ver
 * frontend/src/services/exactTemplateMapper.js:generarTablaCriteriosScreeningHtml).
 *
 * Cada fila de esa hoja es una sola celda de texto, con la forma
 * "N) Etiqueta: valor", "And) Etiqueta: valor" u "Or) Etiqueta: valor" — el
 * conector antes del paréntesis dice cómo se combina ese criterio con el
 * anterior; el primero de la lista no lleva conector.
 */
export function parsearCriteriosScreening(workbook) {
  const nombreHoja = ((workbook && workbook.SheetNames) || []).find(n => /screen.*criteria/i.test(n));
  if (!nombreHoja) return [];
  const filas = XLSX.utils.sheet_to_json(workbook.Sheets[nombreHoja], { header: 1, defval: '' });
  const patronLinea = /^(\d+|and|or)\)\s*(.+)$/i;
  const criterios = [];
  (filas || []).forEach((fila) => {
    const texto = String((fila || [])[0] || '').trim();
    const m = texto.match(patronLinea);
    if (!m) return;
    const resto = m[2];
    const separador = resto.indexOf(':');
    const etiqueta = (separador > -1 ? resto.slice(0, separador) : resto).trim();
    const valor = (separador > -1 ? resto.slice(separador + 1) : '').trim();
    if (!etiqueta || !valor) return;
    criterios.push({ conector: m[1].toLowerCase() === 'or' ? 'O' : 'Y', etiqueta, valor });
  });
  if (criterios.length) criterios[0].conector = null;
  return criterios;
}

/**
 * Localiza la fila de encabezados. El export de Capital IQ NO los pone en la
 * primera fila: la 0 es el título del reporte ("Capital IQ Company Screening
 * Report > ..."), la 1 va vacía y los encabezados están en la 2. Asumir json[0]
 * dejaba todos los índices de columna en -1, el bucle saltaba las 2.990 filas y
 * la función devolvía un array vacío SIN lanzar ninguna excepción: en pantalla no
 * aparecía ni un error ni un resultado.
 *
 * Se elige la fila con más celdas de texto entre las 15 primeras, que es la
 * heurística que ya usaba el monolito y acierta con los reportes reales.
 */
export function encontrarFilaEncabezados(filas) {
  let mejor = 0, mejorPuntaje = -1;
  const tope = Math.min((filas || []).length, 15);
  for (let i = 0; i < tope; i++) {
    const celdas = (filas[i] || []).filter(x => String(x ?? '').trim() !== '');
    if (!celdas.length) continue;
    const textuales = celdas.filter(x => isNaN(parseFloat(x)) || !isFinite(x));
    const puntaje = textuales.length + (celdas.length >= 3 ? 1 : 0);
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = i; }
  }
  return mejor;
}

/** Sinónimos por columna, en un solo sitio para poder informar qué se buscó. */
export const COLUMNAS_IQ = {
  name: { etiqueta: 'Compañía', esencial: true, claves: ['company name', 'compañía', 'compania', 'empresa', 'razon social', 'razón social', 'nombre'] },
  s: { etiqueta: 'Ingresos', esencial: true, claves: ['total revenue', 'revenue', 'ventas', 'ingresos'] },
  c: { etiqueta: 'Costo de ventas', esencial: false, claves: ['cost of goods', 'cost of revenue', 'costo de ventas', 'costos'] },
  op: { etiqueta: 'Utilidad operacional', esencial: true, claves: ['operating income', 'operating profit', 'utilidad operacional', 'ebit'] },
  ar: { etiqueta: 'Cuentas por cobrar', esencial: false, claves: ['accounts receivable', 'cuentas por cobrar', 'cxc'] },
  inv: { etiqueta: 'Inventarios', esencial: false, claves: ['total inventory', 'inventarios', 'inventario'] },
  ap: { etiqueta: 'Cuentas por pagar', esencial: false, claves: ['accounts payable', 'cuentas por pagar', 'cxp'] },
  sic: { etiqueta: 'SIC', esencial: false, claves: ['primary sic', 'sic', 'ciiu'] },
  id: { etiqueta: 'Identificador de la fuente', esencial: false, claves: ['excel company id', 'capital iq id', 'company id', 'iqid'] },
  desc: { etiqueta: 'Descripción del negocio', esencial: false, claves: ['business description', 'descripción', 'descripcion', 'actividad', 'profile'] },
  country: { etiqueta: 'País', esencial: false, claves: ['country', 'país', 'pais', 'ubicación', 'location'] },
};

/**
 * Parsea archivo de Capital IQ (.xlsx, .xls, .csv).
 *
 * Devuelve { rows, meta }: meta lleva la hoja elegida, la fila de encabezados, las
 * columnas reconocidas y las que faltan, para que la interfaz pueda explicar qué
 * se leyó en lugar de quedarse muda. onProgress(etapa, hechas, total) permite
 * mostrar el avance.
 */
export async function importCapitalIQExcel(file, onProgress) {
  const avisar = (etapa, hechas, total) => {
    if (typeof onProgress === 'function') {
      try { onProgress(etapa, hechas, total); } catch (e) { /* la UI no debe romper la lectura */ }
    }
  };

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        avisar('Abriendo el archivo…', 0, null);
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const criteriosScreening = parsearCriteriosScreening(workbook);
        const hoja = elegirHoja(workbook.SheetNames);
        const worksheet = workbook.Sheets[hoja];
        if (!worksheet) throw new Error('El archivo no tiene ninguna hoja legible.');

        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        if (!json || json.length < 2) {
          throw new Error('La hoja «' + hoja + '» no contiene suficientes filas.');
        }

        avisar('Reconociendo columnas…', 0, null);
        const filaEncabezados = encontrarFilaEncabezados(json);
        const headers = (json[filaEncabezados] || []).map(h => String(h || '').trim().toLowerCase());

        // Mapeo flexible de encabezados
        const findCol = (keywords) => headers.findIndex(h => keywords.some(k => h.includes(k)));

        const idx = {};
        const reconocidas = [], faltantes = [];
        Object.entries(COLUMNAS_IQ).forEach(([clave, def]) => {
          const i = findCol(def.claves);
          idx[clave] = i;
          if (i >= 0) reconocidas.push({ clave, etiqueta: def.etiqueta, columna: i, header: (json[filaEncabezados] || [])[i] });
          else faltantes.push({ clave, etiqueta: def.etiqueta, esencial: def.esencial, claves: def.claves });
        });

        const meta = {
          archivo: file.name || '',
          hojas: workbook.SheetNames.slice(),
          hoja,
          filas: json.length,
          filaEncabezados,
          encabezados: (json[filaEncabezados] || []).map(h => String(h || '')).filter(h => h.trim()),
          reconocidas,
          faltantes,
          sinCuentasDeBalance: ['ar', 'inv', 'ap'].every(k => idx[k] < 0),
          criteriosScreening,
        };

        const nameIdx = idx.name;
        if (nameIdx < 0) {
          /* Antes esto devolvía [] en silencio. Un error explícito con lo que sí se
             encontró es lo que permite corregir el export. */
          const err = new Error(
            'No se encontró la columna de la compañía en la hoja «' + hoja + '» (encabezados en la fila ' +
            (filaEncabezados + 1) + '). Encabezados leídos: ' +
            (meta.encabezados.slice(0, 10).join(' | ') || '(ninguno)')
          );
          err.meta = meta;
          throw err;
        }
        const sIdx = idx.s, cIdx = idx.c, opIdx = idx.op, arIdx = idx.ar, invIdx = idx.inv,
          apIdx = idx.ap, sicIdx = idx.sic, idIdx = idx.id, descIdx = idx.desc, countryIdx = idx.country;
        const total = json.length - filaEncabezados - 1;
        avisar('Leyendo compañías…', 0, total);
        const rows = [];
        let saltadas = 0;
        /* desde la fila SIGUIENTE a los encabezados, no desde la 1: con el título
           del reporte arriba, empezar en 1 leía la fila de encabezados como dato */
        for (let i = filaEncabezados + 1; i < json.length; i++) {
          if (i % 500 === 0) avisar('Leyendo compañías…', i - filaEncabezados - 1, total);
          const row = json[i];
          if (!row || !row[nameIdx]) { saltadas++; continue; }

          const name = String(row[nameIdx]).trim();
          if (!name) { saltadas++; continue; }

          /* Capital IQ agrega al final de «Screening» una fila de nota legal
             ("*Denotes proprietary information.") escrita en la misma columna del
             nombre de la compañía, con el resto de la fila vacío. Una compañía real
             siempre trae algo más —ticker, ID, SIC, estado o alguna cifra—, así que
             una fila donde ninguna otra columna tiene dato no es una candidata. */
          const soloTieneNombre = !row.some((valor, idx) => idx !== nameIdx && String(valor ?? '').trim() !== '');
          if (soloTieneNombre) { saltadas++; continue; }

          const s = sIdx >= 0 ? num(row[sIdx]) : null;
          const c = cIdx >= 0 ? Math.abs(num(row[cIdx]) || 0) : null;
          const op = opIdx >= 0 ? num(row[opIdx]) : null;
          const ar = arIdx >= 0 ? num(row[arIdx]) : null;
          const inv = invIdx >= 0 ? num(row[invIdx]) : null;
          const ap = apIdx >= 0 ? num(row[apIdx]) : null;
          const sic = sicIdx >= 0 ? String(row[sicIdx] || '').trim() : '';
          const idIQ = idIdx >= 0 ? String(row[idIdx] || '').trim() : '';
          const desc = descIdx >= 0 ? String(row[descIdx] || '').trim() : '';
          const country = countryIdx >= 0 ? String(row[countryIdx] || '').trim() : '';

          const isHolding = esHolding({ name, desc, sic });
          const hasNegativeBalance = (ar !== null && ar < 0) || (inv !== null && inv < 0) || (ap !== null && ap < 0);
          const hasLoss = op !== null && op < 0;

          rows.push({
            id: idIQ || `ciq_${i}`,
            name,
            nameKey: nameKey(name),
            amb: country && !/colombia/i.test(country) ? 'Int' : 'Nac',
            country: country || 'Internacional',
            s,
            c,
            op,
            ar,
            inv,
            ap,
            sic,
            desc,
            isHolding,
            hasNegativeBalance,
            hasLoss,
            perfil: op !== null && op > 0 ? 'SERVICIO' : 'INDEFINIDO'
          });
        }

        meta.candidatas = rows.length;
        meta.saltadas = saltadas;
        avisar('Leyendo compañías…', total, total);
        resolve({ rows, meta });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('No se pudo leer «' + (file.name || 'el archivo') + '».'));
    reader.readAsArrayBuffer(file);
  });
}

/* ══════════════ Factores de la puntuación ══════════════
   Los mismos que aplica el motor del monolito. Antes aquí la puntuación era
   score = 0.5, +0.15 si venía del año anterior y +0.1 si el país era de LATAM:
   con casi 3.000 candidatas todas empataban en 0,5, de modo que quedarse con las
   primeras nTarget equivalía a tomar las primeras del archivo en orden
   alfabético. El encabezado anunciaba una ponderación que no existía. */

const REGIONES = {
  LATAM: ['colombia', 'argentina', 'brazil', 'brasil', 'chile', 'mexico', 'méxico', 'peru', 'perú', 'uruguay', 'ecuador', 'panam', 'costa rica', 'guatemala'],
  ASIA: ['japan', 'japón', 'korea', 'corea', 'china', 'india', 'taiwan', 'thailand', 'singapore', 'malaysia', 'vietnam', 'indonesia', 'philippines', 'hong kong'],
  EUROPA: ['poland', 'polonia', 'german', 'aleman', 'france', 'francia', 'spain', 'españa', 'united kingdom', 'reino unido', 'sweden', 'norway', 'finland', 'italy', 'netherlands', 'denmark', 'romania', 'ukraine', 'czech', 'suiza', 'switzerland'],
  NORTEAM: ['united states', 'estados unidos', 'canada', 'canadá'],
};

/** Región del país, para el factor geográfico. Antes solo se reconocía LATAM. */
export function regionDe(pais) {
  const p = String(pais || '').toLowerCase();
  for (const r in REGIONES) if (REGIONES[r].some(x => p.includes(x))) return r;
  return 'OTRA';
}

const CLAVES_PERFIL = {
  servicio: /software development services|it services|information technology services|custom software|application development|development .{0,25}services|systems integration|software engineering|technology consulting|outsourc|offshore|nearshore|contract develop|develops? .{0,20}for |work[- ]?for[- ]?hire|co-develop|porting/i,
  empresario: /publish|free[- ]?to[- ]?play|in-house|its own|own (ip|titles|games|brands|products)|monetiz|franchis|licenses its|its (own )?(products?|platform)|saas|subscription|proprietary/i,
};

/**
 * Perfil funcional a partir de la descripción del negocio. El prestador de
 * servicios es comparable con una filial que presta servicios; el empresario
 * pleno —con propiedad intelectual y riesgo de mercado propios— no lo es
 * (Art. 260-4 E.T.).
 *
 * Antes el gestor lo derivaba de la utilidad: `op > 0 ? 'SERVICIO' : 'INDEFINIDO'`,
 * que no dice nada de las funciones asumidas.
 */
export function perfilDe(descripcion) {
  const d = String(descripcion || '');
  const esServicio = CLAVES_PERFIL.servicio.test(d);
  const esEmpresario = CLAVES_PERFIL.empresario.test(d);
  if (esServicio && !esEmpresario) return 'SERVICIO';
  if (esServicio && esEmpresario) return 'MIXTO';
  if (esEmpresario) return 'EMPRESARIO';
  return 'INDEFINIDO';
}

/* Perfiles que sí afirman algo sobre las funciones asumidas. INDEFINIDO queda
   fuera a propósito: es ausencia de información, no un perfil incompatible, y por
   eso nunca descarta ni desplaza al veredicto de la IA. */
export const PERFILES_DETERMINADOS = new Set(['SERVICIO', 'EMPRESARIO', 'MIXTO']);

/**
 * Filtros duros que no dependen de la descripción del negocio: holding, saldos
 * negativos y pérdida operativa. Se aplican ANTES de curar para no pagarle a la IA
 * por candidatas que el motor iba a descartar igual — en un cribado real de 2.987
 * compañías eran ~1.359 evaluaciones tiradas, casi la mitad del gasto de la corrida.
 *
 * El rigor funcional NO se aplica aquí: depende del perfil, y el perfil lo dictamina
 * la propia curación. Se evalúa después, en `scoreCandidates`.
 *
 * `scoreCandidates` vuelve a aplicar estos mismos filtros —es idempotente— para
 * seguir siendo correcta cuando se la llama suelta con el universo completo.
 */
export function prefiltrar(candidates, config = {}) {
  const { perdidaOp = 'excluir', holding = 'excluir', saldoNegativo = 'excluir' } = config;
  const validas = [], rechazadas = [];
  (candidates || []).forEach(cand => {
    if (holding === 'excluir' && cand.isHolding) rechazadas.push(cand);
    else if (saldoNegativo === 'excluir' && cand.hasNegativeBalance) rechazadas.push(cand);
    else if (perdidaOp === 'excluir' && cand.hasLoss) rechazadas.push(cand);
    else validas.push(cand);
  });
  return { validas, rechazadas };
}

const VACIAS = /^(de|del|la|el|los|las|y|o|para|con|por|the|and|for|with|its|del)$/i;

/** Palabras con carga semántica de un texto: 4 letras o más, sin repetir. */
export function tokensSignificativos(texto) {
  return [...new Set(
    String(texto || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 4 && !VACIAS.test(t))
  )];
}

/**
 * Coincidencia de la candidata con la actividad del contribuyente. Es el factor
 * de mayor peso (40 %) cuando hay actividad detectada, porque es lo que separa a
 * una comparable del sector de una del mismo código pero otro nicho.
 */
export function coincidenciaActividad(candidata, actividad) {
  if (candidata && candidata.iaCoincide === true) {
    return { factor: 1, hits: 4, posibles: 4, hayActividad: true, tieneDescripcion: true };
  }
  const texto = String(actividad || '').trim();
  if (!texto) return { factor: 1, hits: 0, posibles: 0, hayActividad: false, tieneDescripcion: false };
  const desc = String((candidata && candidata.desc) || '');
  const base = [(candidata && candidata.name) || '', desc, (candidata && candidata.sic) || ''].join(' ').toLowerCase();
  const tokens = tokensSignificativos(texto);
  let hits = 0;
  tokens.forEach(t => { if (base.includes(t)) hits++; });
  return {
    factor: Math.max(0.15, Math.min(1, hits / 4)),
    hits,
    posibles: tokens.length,
    hayActividad: true,
    tieneDescripcion: !!desc.trim(),
  };
}

/** Mediana de una lista de números, para el factor de rentabilidad. */
function medianaDe(valores) {
  const v = valores.filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Puntuación de candidatas (Motor TOP-N) con 5 criterios ponderados.
 *
 * Pesos, los del monolito: con actividad detectada la especialidad pesa 40 % y el
 * perfil baja a 20 %; sin actividad, el perfil sube a 35 % y la especialidad baja
 * a 15 %. Más un bono de 0,08 por continuidad con el estudio anterior.
 *
 * `contexto.ventasParteExaminada` alimenta el factor de tamaño: sin él, ese
 * factor queda neutro en 0,5 para todas.
 *
 * Los descartes se clasifican en `categoriaRechazo` — 'filtro' (holding, saldos,
 * pérdidas), 'ia' (la curación no reconoció la actividad) y 'rigor' (perfil
 * funcional incompatible)—, para que el embudo pueda contar cada etapa sin
 * adivinar el motivo con expresiones regulares sobre el texto.
 */
export function scoreCandidates(candidates, config, companyActivity = '', priorComps = [], contexto = {}) {
  const {
    nTarget = 12,
    perdidaOp = 'excluir',
    holding = 'excluir',
    saldoNegativo = 'excluir',
    geo = 'ninguna',
    rigor = 'estandar',
  } = config;

  const priorSet = new Set((priorComps || []).map(c => nameKey((c && c.name) || c)));
  const ventasTP = num(contexto.ventasParteExaminada);
  /* Veredicto de la curación por IA, por identificador de la fuente. Se aplica
     como filtro duro y, cuando confirma la coincidencia, como factor máximo de
     especialidad. */
  const iaPorId = (contexto.iaMatch && contexto.iaMatch.porId) || null;

  /* Mediana del margen operacional del pool: el factor de rentabilidad premia a
     las candidatas próximas al comportamiento central del conjunto. */
  const medianaPool = medianaDe(
    (candidates || []).map(c => (c.s ? (c.op ?? 0) / c.s : null)).filter(x => x !== null)
  );

  const evaluated = (candidates || []).map(cand => {
    let descartada = false;
    let motivoRechazo = '';
    let categoriaRechazo = '';
    /* Clave estable del motivo, aparte del texto: la tabla de razones de rechazo del
       informe necesita contar por criterio, y hacerlo sobre la redacción obligaría a
       una expresión regular que se rompe en cuanto alguien ajusta una palabra. */
    let motivoClave = '';
    /* El primer motivo manda y los siguientes no lo sobrescriben: el orden en que
       se evalúan las reglas es el orden de precedencia. */
    const rechazar = (categoria, clave, motivo) => {
      if (descartada) return;
      descartada = true;
      categoriaRechazo = categoria;
      motivoClave = clave;
      motivoRechazo = motivo;
    };

    // Filtros de exclusión
    if (holding === 'excluir' && cand.isHolding) {
      rechazar('filtro', 'holding', 'Sociedad holding sin actividad operativa directa.');
    } else if (saldoNegativo === 'excluir' && cand.hasNegativeBalance) {
      rechazar('filtro', 'saldoNegativo', 'Saldo negativo en balances (dato no verosímil).');
    } else if (perdidaOp === 'excluir' && cand.hasLoss) {
      rechazar('filtro', 'perdidaOperativa', 'Pérdida operativa (criterio conservador DIAN).');
    }

    const esContinuidad = priorSet.has(cand.nameKey || nameKey(cand.name));

    /* ── veredicto de la curación por IA ──
       Solo alcanza a las candidatas con identificador: las de otras fuentes no se
       curaron y no deben quedar descartadas por omisión. Una comparable que venía
       del estudio anterior no se retira aunque la IA diga que no coincide: su
       inclusión ya se sustentó en su momento. */
    const idIQ = cand.id ? String(cand.id).trim() : '';
    const ia = iaPorId && idIQ ? iaPorId[idIQ] : null;
    if (!descartada && iaPorId && idIQ && !String(cand.desc || '').trim() && !esContinuidad) {
      rechazar('ia', 'sinDescripcion', `Sin descripción del negocio para verificar la actividad (ID ${idIQ}).`);
    } else if (!descartada && ia && ia.coincide === false && !esContinuidad) {
      rechazar('ia', 'actividadDistinta', `Curación IA: la descripción del negocio no coincide con la actividad${ia.motivo ? ' (' + ia.motivo + ')' : ''}.`);
    }

    /* ── perfil funcional ──
       El dictamen de la IA manda cuando afirma algo: lee la Business Description
       entera, mientras que `perfilDe` busca literales en inglés del nicho de software
       y deja en INDEFINIDO casi todo lo demás. Antes el perfil por palabras clave
       contradecía a la IA — una candidata que la IA aprobaba por actividad caía a
       factor 0,35 de perfil y salía del TOP-N por puntaje, aunque nada la hubiera
       descartado. Si la IA no logró decidirlo, se vuelve a la heurística. */
    const perfilIA = ia && PERFILES_DETERMINADOS.has(ia.perfil) ? ia.perfil : null;
    const perfil = perfilIA || cand.perfilFuncional || perfilDe(cand.desc);
    const perfilOrigen = perfilIA ? 'ia' : 'heuristica';
    const fPerfil = perfil === 'SERVICIO' ? 1 : (perfil === 'MIXTO' ? 0.6 : 0.35);

    /* ── rigor funcional ──
       Antes `rigor` se guardaba en la configuración y se pintaba en el paso 2, pero
       el motor no lo leía: elegir «Estricto» daba exactamente el mismo resultado que
       «Amplio», porque el perfil solo pesaba en el puntaje. Ahora descarta.

       Dos exenciones, las mismas que rigen para el veredicto de la IA: INDEFINIDO no
       descarta (no hay perfil que juzgar, y así llegan las candidatas de otras
       fuentes o agregadas a mano), y una comparable de continuidad no se retira
       porque su inclusión ya se sustentó en el estudio anterior. */
    if (!descartada && !esContinuidad && PERFILES_DETERMINADOS.has(perfil)) {
      if (rigor === 'estricto' && perfil !== 'SERVICIO') {
        rechazar('rigor', 'rigorFuncional', `Perfil ${perfil.toLowerCase()}: el rigor estricto admite solo prestadores de servicios.`);
      } else if (rigor === 'estandar' && perfil === 'EMPRESARIO') {
        rechazar('rigor', 'rigorFuncional', 'Empresario pleno, con propiedad intelectual y riesgo de mercado propios (art. 260-4 E.T.).');
      }
    }

    /* ── especialidad: coincidencia con la actividad del contribuyente ──
       Si la IA ya confirmó la coincidencia sobre la descripción real, se toma su
       veredicto en lugar de recontar palabras clave. */
    const act = coincidenciaActividad(
      ia && ia.coincide ? { ...cand, iaCoincide: true } : cand,
      companyActivity
    );
    const fEspecialidad = act.factor;

    /* ── geografía ── */
    let fGeo = 1;
    const region = regionDe(cand.country);
    if (geo !== 'ninguna') fGeo = region === geo ? 1 : (region === 'OTRA' ? 0.5 : 0.65);

    /* ── tamaño: cercanía de las ventas a las de la parte examinada ── */
    let fTamano = 0.5, distancia = null;
    if (ventasTP && cand.s) {
      distancia = Math.abs(Math.log10(cand.s / ventasTP));
      fTamano = 1 / (1 + distancia);
    }

    /* ── rentabilidad: cercanía a la mediana del pool, o preferencia por pérdida ── */
    let fRent;
    if (cand.hasLoss) fRent = perdidaOp === 'preferir' ? 1 : 0.4;
    else if (perdidaOp === 'preferir') fRent = 0.4;
    else {
      const pli = cand.s ? (cand.op ?? 0) / cand.s : 0;
      fRent = Math.max(0, 1 - Math.min(1, Math.abs(pli - medianaPool) / 0.5));
    }

    /* Pesos dinámicos: con actividad detectada el nicho manda. */
    const hayAct = act.hayActividad;
    const wPerfil = hayAct ? 0.20 : 0.35;
    const wEspecialidad = hayAct ? 0.40 : 0.15;
    const wGeo = hayAct ? 0.10 : 0.15;
    const wTamano = hayAct ? 0.15 : 0.20;
    const wRent = 0.15;

    const score = Math.min(1,
      wPerfil * fPerfil + wEspecialidad * fEspecialidad + wGeo * fGeo +
      wTamano * fTamano + wRent * fRent + (esContinuidad ? 0.08 : 0)
    );

    const razones = [
      'perfil ' + perfil.toLowerCase(),
      hayAct ? (fEspecialidad >= 0.5 ? `coincide con la actividad (${act.hits} coincidencias)` : `coincidencia parcial (${act.hits})`) : '',
      geo !== 'ninguna' && region === geo ? `región prioritaria (${cand.country || ''})` : '',
      distancia !== null && distancia < 1 ? 'tamaño próximo al de la parte examinada' : '',
      cand.hasLoss ? `con pérdida operativa (${perdidaOp})` : '',
      esContinuidad ? 'continuidad con el año anterior' : '',
    ].filter(Boolean).join(', ');

    return {
      ...cand,
      perfilFuncional: perfil,
      perfilOrigen,
      score,
      factores: { perfil: fPerfil, especialidad: fEspecialidad, geografia: fGeo, tamano: fTamano, rentabilidad: fRent },
      razones,
      esContinuidad,
      descartada,
      motivoRechazo,
      categoriaRechazo,
      motivoClave,
    };
  });

  const validas = evaluated.filter(c => !c.descartada).sort((a, b) => b.score - a.score);
  const rechazadas = evaluated.filter(c => c.descartada);

  /* Las de continuidad ya pasaron los filtros duros (holding/saldo negativo/pérdida
     operativa aplican igual para todas, arriba) y entran primero, sin competir por
     puntaje: su inclusión ya se sustentó en el estudio anterior.

     Pero cuentan DENTRO del cupo, no aparte. Antes se sumaban al margen de `nTarget`,
     así que pedir 12 con 7 de continuidad devolvía 19 comparables: el número que el
     usuario escribe es el tamaño de la muestra final, no el de las candidatas nuevas.
     El cupo se completa con las mejores del resto. */
  const continuidadIncluidas = validas.filter(c => c.esContinuidad);
  const otrasValidas = validas.filter(c => !c.esContinuidad);

  const cupoRestante = Math.max(0, nTarget - continuidadIncluidas.length);
  const seleccionadas = [...continuidadIncluidas, ...otrasValidas.slice(0, cupoRestante)];

  return {
    evaluadas: evaluated.length,
    seleccionadas,
    rechazadas,
    /* Conteo por etapa, calculado aquí y no en la UI: son categorías del motor y
       deducirlas del texto del motivo obligaba a mantener una expresión regular en
       el componente, que se desincronizaba en cuanto cambiaba una redacción. */
    rechazadasPorCategoria: {
      filtro: rechazadas.filter(c => c.categoriaRechazo === 'filtro').length,
      ia: rechazadas.filter(c => c.categoriaRechazo === 'ia').length,
      rigor: rechazadas.filter(c => c.categoriaRechazo === 'rigor').length,
    },
    /* Desglose por criterio concreto, que es lo que necesita la tabla de razones de
       rechazo del informe: ahí no vale decir «descartadas por los filtros», hay que
       decir cuántas por holding, cuántas por pérdidas y cuántas por actividad. */
    rechazadasPorMotivo: {
      holding: rechazadas.filter(c => c.motivoClave === 'holding').length,
      saldoNegativo: rechazadas.filter(c => c.motivoClave === 'saldoNegativo').length,
      perdidaOperativa: rechazadas.filter(c => c.motivoClave === 'perdidaOperativa').length,
      sinDescripcion: rechazadas.filter(c => c.motivoClave === 'sinDescripcion').length,
      actividadDistinta: rechazadas.filter(c => c.motivoClave === 'actividadDistinta').length,
      rigorFuncional: rechazadas.filter(c => c.motivoClave === 'rigorFuncional').length,
    },
    totalValidas: validas.length,
    /* reserva: las válidas que no entraron al TOP-N, para poder reponer las que
       la curación por IA descarte sin quedarse corto de comparables. Se corta en el cupo
       restante, no en `nTarget`, o las que la continuidad desplazó aparecerían a la vez
       como seleccionadas y como reserva. */
    reserva: otrasValidas.slice(cupoRestante),
    /* Cuántas vienen del estudio anterior y si por sí solas ya pasan del objetivo: en
       ese caso no se recorta ninguna —descartar una comparable aceptada el año pasado
       exige justificarlo en el informe— y la muestra queda por encima de lo pedido. */
    continuidad: continuidadIncluidas.length,
    continuidadExcedeObjetivo: continuidadIncluidas.length > nTarget,
    medianaPool,
    conActividad: !!String(companyActivity || '').trim(),
    ventasParteExaminada: ventasTP,
  };
}

/**
 * Extrae el objeto JSON de una respuesta de la IA.
 *
 * Los modelos devuelven el JSON envuelto en prosa o en vallas de markdown con
 * frecuencia. Quitar las vallas y hacer JSON.parse falla en cuanto el modelo
 * añade una frase después del objeto, y entonces la curación se descartaba
 * entera. Aquí se escanean llaves balanceadas respetando las cadenas, que es lo
 * que hace `extraerJSONDeRespuestaIA` en el monolito.
 */
export function extraerJSON(texto) {
  const s = String(texto || '');
  const inicio = s.indexOf('{');
  if (inicio < 0) throw new Error('La respuesta no contiene ningún objeto JSON.');
  let nivel = 0, enCadena = false, escapado = false;
  for (let i = inicio; i < s.length; i++) {
    const ch = s[i];
    if (escapado) { escapado = false; continue; }
    if (ch === '\\') { escapado = true; continue; }
    if (ch === '"') { enCadena = !enCadena; continue; }
    if (enCadena) continue;
    if (ch === '{') nivel++;
    else if (ch === '}') {
      nivel--;
      if (nivel === 0) return JSON.parse(s.slice(inicio, i + 1));
    }
  }
  throw new Error('El objeto JSON de la respuesta quedó incompleto.');
}

/** Parte una lista en trozos del tamaño pedido. */
function enLotes(lista, tamano) {
  const out = [];
  for (let i = 0; i < lista.length; i += tamano) out.push(lista.slice(i, i + tamano));
  return out;
}

/**
 * Ejecuta tareas con un tope de concurrencia. Sin esto, curar un universo grande
 * sería una consulta detrás de otra —minutos de espera secuencial— o todas a la
 * vez, que la API rechaza.
 */
async function conConcurrencia(items, trabajo, limite) {
  const resultados = new Array(items.length);
  let siguiente = 0;
  async function corredor() {
    while (siguiente < items.length) {
      const mio = siguiente++;
      resultados[mio] = await trabajo(items[mio], mio);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, corredor));
  return resultados;
}

/** Comparables confirmadas en el estudio anterior, como referencia para la IA. */
function bloqueConfirmadas(priorComps) {
  const nombres = (priorComps || []).map(c => (c && c.name) || c).filter(Boolean).slice(0, 25);
  if (!nombres.length) return '';
  return 'Estas compañías fueron aceptadas como comparables en el estudio del año anterior, ' +
    'así que su actividad ya se consideró coincidente; úsalas como referencia de qué cuenta como la misma actividad:\n' +
    nombres.map(n => '- ' + n).join('\n') + '\n\n';
}

/* 20 y no 60: el modelo razona un motivo por candidata, así que un lote de 60
   tardaba 30-45 s y quedaba pegado al techo de 60 s que Firebase Hosting impone a
   todo lo que pasa por el rewrite hacia la función —los `timeoutSeconds` de la
   función no cuentan detrás del rewrite—. Los lotes que se pasaban de ahí volvían
   con 502 desde el borde y dejaban sin curar a sus 60 candidatas. Con 20 el lote
   baja a ~12-15 s y queda margen para un pico de latencia del modelo. No subirlo
   sin medir cuánto tarda el lote de verdad. */
export const CURACION_LOTE = 20;
export const CURACION_CONCURRENCIA = 3;
/* Se usa para estimar la espera y avisarla desde el principio. */
const SEGUNDOS_POR_LOTE = 15;

/* Códigos que merecen otro intento: el borde de Hosting corta a los 60 s (502/504),
   Gemini responde 429 cuando se satura y un despliegue en curso tumba las peticiones
   en vuelo. Todos son transitorios, y sin reintento cada uno cuesta el lote entero.
   Un 400/401/403 no entra: es un error de contrato o de credenciales y repetirlo
   solo gasta cuota. */
/* En una constante y no incrustado en la llamada: el nombre del modelo vive también
   en `GEMINI_MODEL_DEFAULT` de server.js y functions/index.js, y cada vez que alguien
   lo actualiza en un sitio y no en los otros la curación queda pidiendo un modelo
   distinto al del resto del sistema. Mantener los tres iguales. */
export const GEMINI_MODELO_CURACION = 'gemini-3.5-flash';

const ESTADOS_REINTENTABLES = new Set([408, 425, 429, 500, 502, 503, 504]);
const CURACION_REINTENTOS = 2;
const CURACION_PAUSA_BASE_MS = 1500;

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

/** El mensaje que de verdad explica el fallo: Gemini lo manda en el cuerpo, y el de
 *  axios se queda en un «Request failed with status code 429» que no dice nada. */
function mensajeDeError(err) {
  const cuerpo = err?.response?.data;
  return String(
    cuerpo?.error?.message || cuerpo?.error || cuerpo?.detail ||
    err?.message || 'error desconocido'
  ).trim();
}

/* No todo 429 es un pico de tráfico: cuando el proyecto agota su tope de gasto
   mensual —o la cuota del plan— Gemini responde también 429, y ahí reintentar es
   tiempo perdido, porque eso no se levanta esperando unos segundos. Se distingue por
   el mensaje del cuerpo, no por el código. */
function esCuotaAgotada(err) {
  return /spending cap|current quota|billing|free tier/i.test(mensajeDeError(err));
}

/**
 * Consulta a Gemini reintentando los fallos transitorios y devuelve el texto de la
 * respuesta ya recompuesto.
 *
 * Si se agotan los intentos lanza el último error con `status` adjunto, para que
 * quien reporte el fallo pueda decir de qué se trató en lugar de «error desconocido».
 */
async function consultarGemini(prompt, { reintentos, pausaBaseMs }) {
  let ultimo;
  for (let intento = 0; intento <= reintentos; intento++) {
    try {
      const respuesta = await axios.post('/api/gemini', {
        model: GEMINI_MODELO_CURACION,
        contents: [{ parts: [{ text: prompt }] }],
      });
      /* todas las partes, no solo la primera: los modelos parten la respuesta */
      const texto = (respuesta.data?.candidates?.[0]?.content?.parts || [])
        .map(p => p.text || '').join('');
      if (!texto) throw new Error('Respuesta vacía de Gemini');
      return texto;
    } catch (err) {
      ultimo = err;
      const status = err?.response?.status;
      /* sin `response` es un fallo de red o una conexión cortada a mitad —que es
         justo lo que hace el borde cuando se agota su plazo—: también transitorio.
         Con `response`, manda la lista de códigos. */
      const transitorio = (status === undefined || ESTADOS_REINTENTABLES.has(status)) && !esCuotaAgotada(err);
      if (!transitorio || intento === reintentos) break;
      /* espera creciente con jitter, para que los lotes en vuelo no vuelvan a
         chocar todos en el mismo instante */
      const espera = pausaBaseMs * (2 ** intento) * (0.75 + Math.random() * 0.5);
      console.warn(`[curación IA] ${status ? 'HTTP ' + status : 'fallo de red'}; ` +
        `reintento ${intento + 1} de ${reintentos} en ${Math.round(espera / 1000)} s`);
      await dormir(espera);
    }
  }
  if (ultimo && ultimo.response && ultimo.status === undefined) ultimo.status = ultimo.response.status;
  throw ultimo;
}

/**
 * Curación de candidatas contra la actividad del contribuyente, con la Business
 * Description real de la fuente.
 *
 * Solo evalúa las que traen identificador Y descripción: las agregadas a mano o
 * venidas de otras fuentes no tienen con qué compararse y siguen de largo hacia
 * la heurística de palabras clave, sin quedar descartadas por omisión.
 *
 * Devuelve un veredicto por identificador, NO una lista filtrada: el descarte lo
 * decide el motor, que es quien conoce las excepciones (una comparable de
 * continuidad no se descarta aunque la IA diga que no coincide). Antes esta
 * función devolvía las candidatas marcadas y el componente las pasaba enteras a
 * la tabla, así que las rechazadas seguían entrando al rango.
 *
 * Cada lote se reintenta ante fallos transitorios (ver `consultarGemini`), y los que
 * aun así fallan NO descartan a sus candidatas: un problema de red no puede
 * traducirse en excluir comparables del estudio. El motivo de cada fallo queda en
 * `veredicto.errores` con su código HTTP, para poder decirlo en pantalla.
 *
 * De cada candidata se pide también el perfil funcional (prestador de servicios,
 * empresario pleno o mixto), en la misma consulta y sin costo extra: es el criterio
 * que después aplica el rigor funcional del paso 2, y la heurística de palabras
 * clave solo reconoce los literales en inglés del nicho de software.
 *
 * `opciones.veredictoPrevio` permite reutilizar lo ya curado en lugar de volver a
 * pagarlo. Solo se reutiliza si la actividad evaluada es la misma.
 */
export async function curateCandidatesWithGemini(candidates, companyActivity, opciones = {}) {
  const {
    onProgress, priorComps = [], fuente = '', veredictoPrevio = null,
    /* parametrizados para que las pruebas no tengan que esperar los backoffs reales */
    reintentos = CURACION_REINTENTOS, pausaBaseMs = CURACION_PAUSA_BASE_MS,
  } = opciones;
  const avisar = (info) => {
    if (typeof onProgress === 'function') {
      try { onProgress(info); } catch (e) { /* la UI no debe romper la curación */ }
    }
  };

  const actividad = String(companyActivity || '').trim();
  const veredicto = {
    porId: {},
    fecha: new Date().toISOString(),
    actividadUsada: actividad,
    fuente,
    total: 0,
    evaluadas: 0,
    fallidas: 0,
    /* Qué falló y con qué código, para poder decirlo en pantalla: antes el único
       rastro de un lote caído era un console.error que nadie ve. */
    errores: [],
    omitida: null,
  };

  if (!actividad) {
    veredicto.omitida = 'Sin actividad detectada: no hay contra qué comparar. El motor usará las palabras clave.';
    avisar({ etapa: 'omitida', mensaje: veredicto.omitida });
    return veredicto;
  }

  const conDatos = (candidates || []).filter(
    c => c && c.id && String(c.id).trim() && c.desc && String(c.desc).trim()
  );
  veredicto.total = conDatos.length;

  if (!conDatos.length) {
    veredicto.omitida = 'Ninguna candidata trae identificador y descripción del negocio para curar con IA; ' +
      'el motor usará el emparejamiento por palabras clave.';
    avisar({ etapa: 'omitida', mensaje: veredicto.omitida });
    return veredicto;
  }

  /* ── reutilización de lo ya curado ──
     La curación corre en el paso 3, después de los filtros, así que cambiar un
     filtro y volver a ejecutar la traería otra vez completa. Se reutiliza solo si la
     actividad es la misma —es el criterio contra el que se evaluó cada candidata— y
     solo para los identificadores ya presentes: relajar un filtro admite candidatas
     nuevas, y esas sí hay que curarlas. */
  const previo = veredictoPrevio && veredictoPrevio.porId &&
    String(veredictoPrevio.actividadUsada || '').trim() === actividad
    ? veredictoPrevio.porId
    : null;

  const idsConsiderados = conDatos.map(c => String(c.id).trim());
  const contarCoincidencias = () =>
    idsConsiderados.filter(id => veredicto.porId[id] && veredicto.porId[id].coincide).length;

  const evaluables = previo ? conDatos.filter(c => !previo[String(c.id).trim()]) : conDatos;
  veredicto.reutilizadas = conDatos.length - evaluables.length;
  if (previo) {
    /* solo los del conjunto actual: arrastrar el veredicto entero dejaría en el
       estudio dictámenes de candidatas que ya no están en el universo */
    idsConsiderados.forEach(id => { if (previo[id]) veredicto.porId[id] = previo[id]; });
  }

  if (!evaluables.length) {
    veredicto.coinciden = contarCoincidencias();
    avisar({
      etapa: 'fin', evaluadas: 0, total: conDatos.length, fallidas: 0,
      reutilizadas: veredicto.reutilizadas, coinciden: veredicto.coinciden,
      mensaje: `Sin consultas nuevas: las ${veredicto.reutilizadas} candidatas ya estaban curadas para esta actividad · ` +
        `${veredicto.coinciden} coinciden`,
    });
    return veredicto;
  }

  const lotes = enLotes(evaluables, CURACION_LOTE);
  const etaMinutos = Math.ceil((lotes.length / CURACION_CONCURRENCIA) * SEGUNDOS_POR_LOTE / 60);
  const referencia = bloqueConfirmadas(priorComps);

  avisar({
    etapa: 'inicio', evaluadas: 0, total: evaluables.length, lotes: lotes.length, etaMinutos,
    reutilizadas: veredicto.reutilizadas,
    mensaje: `Curando ${evaluables.length} candidatas en ${lotes.length} lote(s)` +
      (veredicto.reutilizadas ? ` (${veredicto.reutilizadas} ya curadas se reutilizan)` : '') +
      `; estimado ~${etaMinutos} min. No cierre la pestaña.`,
  });

  await conConcurrencia(lotes, async (lote, indice) => {
    const candidatos = lote.map(c => ({
      id: String(c.id).trim(),
      name: c.name || '',
      desc: String(c.desc || '').slice(0, 300),
      country: c.country || '',
    }));

    const prompt =
      'Eres un experto en precios de transferencia que revisa comparables de una base de datos financiera.\n\n' +
      'La empresa examinada tiene esta actividad económica real:\n"' + actividad + '"\n\n' +
      referencia +
      'A continuación hay una lista de empresas candidatas con su descripción de negocio real (habitualmente en inglés). ' +
      'Para cada una, decide si su actividad real coincide con la de la empresa examinada (mismo tipo de negocio, ' +
      'mismos productos o servicios, o función equivalente), sin importar el idioma en que esté escrita la descripción. ' +
      'No la aceptes solo por pertenecer al mismo sector amplio: debe ser la misma actividad específica.\n\n' +
      'Clasifica también el perfil funcional de cada candidata, según las funciones y los riesgos que asume:\n' +
      '- "SERVICIO": presta servicios, fabrica o desarrolla por encargo de terceros; no explota propiedad ' +
      'intelectual propia ni asume el riesgo de mercado del producto final.\n' +
      '- "EMPRESARIO": explota su propia propiedad intelectual, marcas o productos y asume el riesgo de mercado.\n' +
      '- "MIXTO": hace las dos cosas de forma relevante.\n' +
      '- "INDEFINIDO": la descripción no alcanza para decidirlo. Úsalo en lugar de adivinar.\n\n' +
      'Candidatas:\n' + JSON.stringify(candidatos) + '\n\n' +
      'Responde ÚNICAMENTE con un objeto JSON válido, sin marcas markdown, con esta forma exacta:\n' +
      '{"resultados":[{"id":"","coincide":true,"perfil":"SERVICIO","motivo":""}]}\n' +
      '"motivo" debe ser brevísimo (máximo 12 palabras, sin explicaciones largas). ' +
      'Incluye una entrada por cada ID recibido, en el mismo orden.';

    try {
      const texto = await consultarGemini(prompt, { reintentos, pausaBaseMs });
      const j = extraerJSON(texto);
      (j.resultados || j.evaluacion || []).forEach(r => {
        if (!r || !r.id) return;
        /* El perfil se acepta solo si es uno de los cuatro valores pedidos: un texto
           libre del modelo no puede acabar decidiendo un descarte por rigor. */
        const perfil = String(r.perfil || '').trim().toUpperCase();
        veredicto.porId[String(r.id).trim()] = {
          coincide: !!r.coincide,
          motivo: r.motivo || '',
          perfil: (PERFILES_DETERMINADOS.has(perfil) || perfil === 'INDEFINIDO') ? perfil : '',
        };
      });
      veredicto.evaluadas += lote.length;
    } catch (err) {
      veredicto.fallidas += lote.length;
      const status = err?.status || err?.response?.status || null;
      veredicto.errores.push({
        lote: indice + 1,
        candidatas: lote.length,
        status,
        mensaje: mensajeDeError(err),
      });
      console.error(`[curación IA] lote ${indice + 1} falló tras ${reintentos + 1} intento(s)` +
        (status ? ` (HTTP ${status})` : ''), err);
    }

    avisar({
      etapa: 'lote',
      evaluadas: veredicto.evaluadas + veredicto.fallidas,
      total: evaluables.length,
      fallidas: veredicto.fallidas,
      mensaje: `${veredicto.evaluadas + veredicto.fallidas} de ${evaluables.length} procesadas`,
    });
  }, CURACION_CONCURRENCIA);

  /* Solo las candidatas del conjunto actual: `porId` puede traer dictámenes
     reutilizados de una corrida con más candidatas, y contarlos daría un total que
     no cuadra con el embudo. */
  const coinciden = contarCoincidencias();
  veredicto.coinciden = coinciden;
  avisar({
    etapa: 'fin',
    evaluadas: veredicto.evaluadas, total: conDatos.length, fallidas: veredicto.fallidas,
    reutilizadas: veredicto.reutilizadas, coinciden, errores: veredicto.errores,
    mensaje: veredicto.fallidas
      ? `${coinciden} de ${conDatos.length} coinciden con la actividad · ${veredicto.fallidas} no se pudieron evaluar (se dejan pasar sin descartarlas)`
      : `${coinciden} de ${conDatos.length} coinciden con la actividad`,
  });

  return veredicto;
}
