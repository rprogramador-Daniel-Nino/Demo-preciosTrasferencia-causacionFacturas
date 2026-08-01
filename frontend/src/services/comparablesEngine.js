import * as XLSX from 'xlsx';
import axios from 'axios';
import { num, pliOf } from '../utils/calculations.js';

/**
 * Normaliza nombres de empresas para cruces de continuidad
 */
export function nameKey(str) {
  if (!str) return '';
  return String(str)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

          const isHolding = /\b(holding|inversiones|investment)\b/i.test(name + ' ' + desc);
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
 */
export function scoreCandidates(candidates, config, companyActivity = '', priorComps = [], contexto = {}) {
  const {
    nTarget = 12,
    perdidaOp = 'excluir',
    holding = 'excluir',
    saldoNegativo = 'excluir',
    geo = 'ninguna',
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

    // Filtros de exclusión
    if (holding === 'excluir' && cand.isHolding) {
      descartada = true;
      motivoRechazo = 'Sociedad holding sin actividad operativa directa.';
    } else if (saldoNegativo === 'excluir' && cand.hasNegativeBalance) {
      descartada = true;
      motivoRechazo = 'Saldo negativo en balances (dato no verosímil).';
    } else if (perdidaOp === 'excluir' && cand.hasLoss) {
      descartada = true;
      motivoRechazo = 'Pérdida operativa (criterio conservador DIAN).';
    }

    const esContinuidad = priorSet.has(cand.nameKey || nameKey(cand.name));

    /* ── veredicto de la curación por IA ──
       Solo alcanza a las candidatas con identificador: las de otras fuentes no se
       curaron y no deben quedar descartadas por omisión. Una comparable que venía
       del estudio anterior no se retira aunque la IA diga que no coincide: su
       inclusión ya se sustentó en su momento. */
    const idIQ = cand.id ? String(cand.id).trim() : '';
    const ia = iaPorId && idIQ ? iaPorId[idIQ] : null;
    if (!descartada && iaPorId && idIQ && !String(cand.desc || '').trim()) {
      descartada = true;
      motivoRechazo = `Sin descripción del negocio para verificar la actividad (ID ${idIQ}).`;
    } else if (!descartada && ia && ia.coincide === false && !esContinuidad) {
      descartada = true;
      motivoRechazo = `Curación IA: la descripción del negocio no coincide con la actividad${ia.motivo ? ' (' + ia.motivo + ')' : ''}.`;
    }

    /* ── perfil funcional ── */
    const perfil = cand.perfilFuncional || perfilDe(cand.desc);
    const fPerfil = perfil === 'SERVICIO' ? 1 : (perfil === 'MIXTO' ? 0.6 : 0.35);

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
      score,
      factores: { perfil: fPerfil, especialidad: fEspecialidad, geografia: fGeo, tamano: fTamano, rentabilidad: fRent },
      razones,
      esContinuidad,
      descartada,
      motivoRechazo,
    };
  });

  const validas = evaluated.filter(c => !c.descartada).sort((a, b) => b.score - a.score);
  const rechazadas = evaluated.filter(c => c.descartada);

  const seleccionadas = validas.slice(0, nTarget);

  return {
    evaluadas: evaluated.length,
    seleccionadas,
    rechazadas,
    totalValidas: validas.length,
    /* reserva: las válidas que no entraron al TOP-N, para poder reponer las que
       la curación por IA descarte sin quedarse corto de comparables */
    reserva: validas.slice(nTarget),
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

export const CURACION_LOTE = 60;
export const CURACION_CONCURRENCIA = 6;
/* Cada lote tarda del orden de 30-45 s porque el modelo razona un motivo por
   candidata. Se usa para estimar la espera y avisarla desde el principio. */
const SEGUNDOS_POR_LOTE = 35;

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
 * Los lotes que fallan NO descartan a sus candidatas: un problema de red no puede
 * traducirse en excluir comparables del estudio.
 */
export async function curateCandidatesWithGemini(candidates, companyActivity, opciones = {}) {
  const { onProgress, priorComps = [], fuente = '' } = opciones;
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
    omitida: null,
  };

  if (!actividad) {
    veredicto.omitida = 'Sin actividad detectada: no hay contra qué comparar. El motor usará las palabras clave.';
    avisar({ etapa: 'omitida', mensaje: veredicto.omitida });
    return veredicto;
  }

  const evaluables = (candidates || []).filter(
    c => c && c.id && String(c.id).trim() && c.desc && String(c.desc).trim()
  );
  veredicto.total = evaluables.length;

  if (!evaluables.length) {
    veredicto.omitida = 'Ninguna candidata trae identificador y descripción del negocio para curar con IA; ' +
      'el motor usará el emparejamiento por palabras clave.';
    avisar({ etapa: 'omitida', mensaje: veredicto.omitida });
    return veredicto;
  }

  const lotes = enLotes(evaluables, CURACION_LOTE);
  const etaMinutos = Math.ceil((lotes.length / CURACION_CONCURRENCIA) * SEGUNDOS_POR_LOTE / 60);
  const referencia = bloqueConfirmadas(priorComps);

  avisar({
    etapa: 'inicio', evaluadas: 0, total: evaluables.length, lotes: lotes.length, etaMinutos,
    mensaje: `Curando ${evaluables.length} candidatas en ${lotes.length} lote(s); estimado ~${etaMinutos} min. No cierre la pestaña.`,
  });

  await conConcurrencia(lotes, async (lote) => {
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
      'Candidatas:\n' + JSON.stringify(candidatos) + '\n\n' +
      'Responde ÚNICAMENTE con un objeto JSON válido, sin marcas markdown, con esta forma exacta:\n' +
      '{"resultados":[{"id":"","coincide":true,"motivo":""}]}\n' +
      '"motivo" debe ser brevísimo (máximo 12 palabras, sin explicaciones largas). ' +
      'Incluye una entrada por cada ID recibido, en el mismo orden.';

    try {
      const respuesta = await axios.post('/api/gemini', {
        model: 'gemini-3-flash-preview',
        contents: [{ parts: [{ text: prompt }] }],
      });
      /* todas las partes, no solo la primera: los modelos parten la respuesta */
      const texto = (respuesta.data?.candidates?.[0]?.content?.parts || [])
        .map(p => p.text || '').join('');
      if (!texto) throw new Error('Respuesta vacía de Gemini');

      const j = extraerJSON(texto);
      (j.resultados || j.evaluacion || []).forEach(r => {
        if (!r || !r.id) return;
        veredicto.porId[String(r.id).trim()] = { coincide: !!r.coincide, motivo: r.motivo || '' };
      });
      veredicto.evaluadas += lote.length;
    } catch (err) {
      veredicto.fallidas += lote.length;
      console.error('[curación IA] lote falló:', err);
    }

    avisar({
      etapa: 'lote',
      evaluadas: veredicto.evaluadas + veredicto.fallidas,
      total: evaluables.length,
      fallidas: veredicto.fallidas,
      mensaje: `${veredicto.evaluadas + veredicto.fallidas} de ${evaluables.length} procesadas`,
    });
  }, CURACION_CONCURRENCIA);

  const coinciden = Object.values(veredicto.porId).filter(v => v.coincide).length;
  veredicto.coinciden = coinciden;
  avisar({
    etapa: 'fin',
    evaluadas: veredicto.evaluadas, total: evaluables.length, fallidas: veredicto.fallidas, coinciden,
    mensaje: veredicto.fallidas
      ? `${coinciden} de ${evaluables.length} coinciden con la actividad · ${veredicto.fallidas} no se pudieron evaluar (se dejan pasar sin descartarlas)`
      : `${coinciden} de ${evaluables.length} coinciden con la actividad`,
  });

  return veredicto;
}
