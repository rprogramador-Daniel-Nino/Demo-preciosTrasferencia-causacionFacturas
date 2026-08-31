import XLSX from 'xlsx-js-style';
import axios from 'axios';
import { num, pliOf } from '../utils/calculations.js';
import {
  esHolding, tieneSemanticaHolding, holdingSospecha, esControlada, participacionMaxima,
} from './filtrosComparablesPatch.js';
import { perfilFuncionalBilingue, PERFILES_DETERMINADOS } from './perfilFuncionalPatch.js';

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
 * corrida real de este año en vez de arrastrar la del informe anterior. El
 * generador de esa tabla murió con la sustitución por literales; lo que se
 * parsea aquí queda en `study.criteriosScreening`, a la espera de que la ruta
 * por campos con nombre lo publique (Fase 2, `plantillaVocabulario.js`).
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
 * Solo los criterios de búsqueda (hoja "Screen Criteria") de un archivo de Capital IQ,
 * sin tocar nada de comparables.
 *
 * Existe para el caso de un estudio ya curado con IA al que le falta esta hoja (porque
 * el archivo que se subió al principio no la traía): volver a subir el archivo completo
 * por `importCapitalIQExcel` reiniciaría `iaMatch`, `selectionFunnel` y `motorAuditoria`
 * —el veredicto de la curación, el embudo y la auditoría de rechazadas/en reserva—,
 * borrando trabajo ya hecho solo para rellenar una tabla. Esta función lee el mismo tipo
 * de archivo pero no devuelve nada más que los criterios.
 */
export async function leerCriteriosScreeningDeArchivo(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        resolve(parsearCriteriosScreening(workbook));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsArrayBuffer(file);
  });
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

/** ¿La candidata tiene la utilidad operacional en negativo?
 *
 * Se mira la cifra, no un `hasLoss` calculado antes: ese campo solo lo pone
 * `importCapitalIQExcel`, así que una candidata que llegue por otra vía —cargada a
 * mano, traída del estudio anterior o con la utilidad corregida después de
 * importar— pasaba el filtro con la utilidad en rojo. Se acepta `op` y también
 * `utilidadOperacional`, que es como la nombra el paquete de parches. */
export function enPerdida(cand) {
  if (!cand) return false;
  if (cand.hasLoss === true) return true;
  const op = num(cand.op != null ? cand.op : cand.utilidadOperacional);
  return op !== null && op < 0;
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
  /* PP&E entra por la misma vía que las otras partidas de balance. Sin él, el ajuste
     de propiedad, planta y equipo se calcula contra cero en todas las comparables y
     los escenarios que lo incluyen quedan sin sentido. */
  ppe: {
    etiqueta: 'Propiedad, planta y equipo',
    esencial: false,
    claves: ['net property plant and equipment', 'property plant and equipment', 'net pp&e', 'pp&e', 'ppe',
      'propiedad planta y equipo', 'propiedad, planta y equipo', 'propiedades planta y equipo'],
  },
  sic: { etiqueta: 'SIC', esencial: false, claves: ['primary sic', 'sic', 'ciiu'] },
  id: { etiqueta: 'Identificador de la fuente', esencial: false, claves: ['excel company id', 'capital iq id', 'company id', 'iqid'] },
  desc: { etiqueta: 'Descripción del negocio', esencial: false, claves: ['business description', 'descripción', 'descripcion', 'actividad', 'profile'] },
  country: { etiqueta: 'País', esencial: false, claves: ['country', 'país', 'pais', 'ubicación', 'location'] },
  /* Capital IQ solo trae esta columna si el reporte se configuró con ese campo
     agregado (no siempre); si no está presente, holderPct queda en null y la
     hoja de Selección comparables la muestra en blanco, como antes. */
  holderPct: {
    etiqueta: '% mayor accionista (holder único)', esencial: false,
    claves: ['% owned by single holder', 'owned by single holder', 'single holder'],
  },
  /* El listado de accionistas en texto («Nombre (pct); Nombre (pct); …»), que es
     como viene el dato cuando el reporte no incluye la columna numérica de arriba.
     Se guarda tal cual para que la hoja de trazabilidad pueda mostrar de dónde sale
     el porcentaje, y de él se extrae el mayor cuando `holderPct` no llega. */
  holders: {
    etiqueta: 'Accionistas', esencial: false,
    claves: ['available holders', 'accionista', 'shareholders', 'participación', 'participacion'],
  },
};

/** Extrae el ticker bursátil que Capital IQ agrega entre paréntesis al final del
 * nombre, p. ej. "Akatsuki Inc. (TSE:3932)" → "TSE:3932". El export de Capital IQ
 * no trae una columna de ticker aparte: solo viene embebido en el nombre. */
export function extraerTicker(name) {
  const m = String(name || '').match(/\(([A-Za-z]+:[A-Za-z0-9.-]+)\)\s*$/);
  return m ? m[1] : '';
}

/** Quita el sufijo de bolsa/ticker que Capital IQ agrega al nombre, p. ej.
 * "Akatsuki Inc. (TSE:3932)" → "Akatsuki Inc.". Se usa junto con `extraerTicker`
 * para no perder el ticker: éste se guarda en su propio campo antes de limpiar
 * el nombre que se muestra en la interfaz y en los reportes. */
export function limpiarNombreIQ(name) {
  return String(name || '').replace(/\s*\([A-Za-z]+:[A-Za-z0-9.-]+\)\s*$/, '').trim();
}

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
          apIdx = idx.ap, ppeIdx = idx.ppe, sicIdx = idx.sic, idIdx = idx.id, descIdx = idx.desc,
          countryIdx = idx.country, holderPctIdx = idx.holderPct, holdersIdx = idx.holders;
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

          const nombreCrudo = String(row[nameIdx]).trim();
          if (!nombreCrudo) { saltadas++; continue; }

          const tickerIQ = extraerTicker(nombreCrudo);
          const name = limpiarNombreIQ(nombreCrudo);

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
          const ppe = ppeIdx >= 0 ? num(row[ppeIdx]) : null;
          const sic = sicIdx >= 0 ? String(row[sicIdx] || '').trim() : '';
          const idIQ = idIdx >= 0 ? String(row[idIdx] || '').trim() : '';
          const desc = descIdx >= 0 ? String(row[descIdx] || '').trim() : '';
          const country = countryIdx >= 0 ? String(row[countryIdx] || '').trim() : '';
          /* Capital IQ a veces junta accionistas y porcentaje bajo un solo encabezado
             («All Available Holders - % Owned by Single Holder»), que entonces cae en
             las dos entradas de COLUMNAS_IQ. Cuál es cuál se decide por el CONTENIDO
             de la celda, no por el encabezado: una celda con letras es el listado de
             accionistas, y pasarla por `num` la aplanaría concatenando sus dígitos
             —«Socio A (49); B (9)» → 499—, con lo que una compañía independiente
             quedaría excluida por control. */
          const soloTexto = (v) => {
            const s = String(v ?? '').trim();
            return /[a-zA-Z]/.test(s) ? s : '';
          };
          const crudoPct = holderPctIdx >= 0 ? row[holderPctIdx] : '';
          const holdersText = soloTexto(holdersIdx >= 0 ? row[holdersIdx] : '') || soloTexto(crudoPct);
          const holderPct = soloTexto(crudoPct) ? null : num(crudoPct);

          const isHolding = esHolding({ name, desc, sic });
          const hasNegativeBalance = (ar !== null && ar < 0) || (inv !== null && inv < 0) || (ap !== null && ap < 0);
          const hasLoss = op !== null && op < 0;

          rows.push({
            id: idIQ || `ciq_${i}`,
            name,
            nameKey: nameKey(name),
            ticker: tickerIQ,
            amb: country && !/colombia/i.test(country) ? 'Int' : 'Nac',
            country: country || 'Internacional',
            s,
            c,
            op,
            ar,
            inv,
            ap,
            ppe,
            sic,
            desc,
            holderPct,
            holdersText,
            /* Participación del mayor accionista, venga como número o dentro del
               texto de accionistas: es lo que mira el filtro de independencia. */
            maxpct: participacionMaxima({ holderPct, holdersText }),
            isHolding,
            /* 'no' | 'revisar': el holding se identifica por la razón social, y la
               hoja de trazabilidad lo muestra aunque el filtro esté desactivado. */
            sospechaHolding: holdingSospecha({ name, desc }),
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

/**
 * Perfil funcional a partir de la descripción del negocio. El prestador de
 * servicios es comparable con una filial que presta servicios; el empresario
 * pleno —con propiedad intelectual y riesgo de mercado propios— no lo es
 * (Art. 260-4 E.T.).
 *
 * Antes el gestor lo derivaba de la utilidad: `op > 0 ? 'SERVICIO' : 'INDEFINIDO'`,
 * que no dice nada de las funciones asumidas. Después pasó a una lista de palabras
 * clave solo en inglés y del nicho de software y juegos («publish», «free-to-play»,
 * «SaaS»), que fallaba con una constructora o una comercializadora y fallaba con
 * cualquier descripción en español. Hoy delega en `perfilFuncionalBilingue`, que
 * clasifica por funciones y riesgos —no por sector— en los dos idiomas.
 *
 * Se conserva el nombre por las llamadas existentes; la semántica del valor
 * devuelto (SERVICIO / EMPRESARIO / MIXTO / INDEFINIDO) no cambió.
 */
export function perfilDe(descripcion) {
  return perfilFuncionalBilingue(descripcion);
}

/* Perfiles que sí afirman algo sobre las funciones asumidas. INDEFINIDO queda
   fuera a propósito: es ausencia de información, no un perfil incompatible, y por
   eso nunca descarta ni desplaza al veredicto de la IA.

   Se reexporta el de `perfilFuncionalPatch.js` en lugar de declarar otro conjunto
   igual: dos copias del mismo criterio acaban divergiendo. */
export { PERFILES_DETERMINADOS };

/**
 * Filtros duros que no dependen de la descripción del negocio: control accionario,
 * holding, saldos negativos y pérdida operativa. Se aplican ANTES de curar para no
 * pagarle a la IA por candidatas que el motor iba a descartar igual — en un cribado
 * real de 2.987 compañías eran ~1.359 evaluaciones tiradas, casi la mitad del gasto
 * de la corrida.
 *
 * El rigor funcional NO se aplica aquí: depende del perfil, y el perfil lo dictamina
 * la propia curación. Se evalúa después, en `scoreCandidates`.
 *
 * `scoreCandidates` vuelve a aplicar estos mismos filtros —es idempotente— para
 * seguir siendo correcta cuando se la llama suelta con el universo completo. El
 * orden de las ramas es el mismo allá, para que las dos funciones atribuyan cada
 * candidata al mismo motivo.
 */
export function prefiltrar(candidates, config = {}) {
  const {
    perdidaOp = 'excluir', holding = 'excluir', saldoNegativo = 'excluir',
    control = 'excluir', umbralControl = 50,
  } = config;
  const validas = [], rechazadas = [];
  (candidates || []).forEach(cand => {
    if (control === 'excluir' && esControlada(cand, { umbral: umbralControl })) rechazadas.push(cand);
    else if (holding === 'excluir' && tieneSemanticaHolding(cand)) rechazadas.push(cand);
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
 * Los descartes se clasifican en `categoriaRechazo` — 'filtro' (control, holding,
 * saldos, pérdidas), 'ia' (la curación no reconoció la actividad) y 'rigor' (perfil
 * funcional incompatible)—, para que el embudo pueda contar cada etapa sin
 * adivinar el motivo con expresiones regulares sobre el texto.
 */
/* El motivo con el que se identifica la reserva: las válidas que no entraron en la muestra.
   Se usa en dos sitios —al armar la reserva de una corrida nueva y al enriquecer el universo de
   un estudio ya guardado— y por eso vive aquí y no dentro de `scoreCandidates`: los estudios
   corridos antes de este cambio tienen la reserva sin motivo, y su libro de soporte se genera en
   el momento de descargarlo, así que etiquetarla también al enriquecer es lo que permite
   auditar un informe ya radicado sin volver a ejecutar el motor. */
export const CLAVE_RESERVA = 'actividadDistinta';
export const MOTIVO_RESERVA = 'Supera los filtros objetivos pero no integra la muestra: '
  + 'menor grado de comparabilidad funcional frente a la parte examinada (Art. 260-4 E.T.).';

export function scoreCandidates(candidates, config, companyActivity = '', priorComps = [], contexto = {}) {
  const {
    nTarget = 12,
    /* Piso del tamaño de la muestra. Parámetro y no constante incrustada para poder probar la
       mecánica del cupo con números pequeños, y por si el despacho cambia el suelo. La
       aplicación nunca lo pasa: usa el de siempre. */
    minimo = MINIMO_COMPARABLES,
    perdidaOp = 'excluir',
    holding = 'excluir',
    control = 'excluir',
    umbralControl = 50,
    saldoNegativo = 'excluir',
    geo = 'ninguna',
    /* `rigor` sigue llegando en la configuración y se conserva en el estudio, pero ya
       no descarta a nadie: ver la nota del bloque «rigor funcional» más abajo. */
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

    const esContinuidad = priorSet.has(cand.nameKey || nameKey(cand.name));

    /* ── Filtros de exclusión ──
       Control y holding van separados y en ese orden. Son dos hechos distintos y el
       informe los reporta en filas distintas, así que fundirlos en un solo motivo
       obligaría a deshacer la suma después.

       El control efectivo (Art. 260-1) es el filtro más duro y NO se exime por
       continuidad: una participación por encima del umbral dice que la empresa no es
       independiente hoy, y eso no lo sustenta el estudio anterior. La condición de
       holding, en cambio, se presume de la razón social, y ahí una comparable que ya
       venía del estudio previo conserva su exención: su inclusión se sustentó en su
       momento y retirarla ahora rompería la continuidad de la serie. */
    if (control === 'excluir' && esControlada(cand, { umbral: umbralControl })) {
      rechazar('filtro', 'controlada',
        `Vinculada: un accionista alcanza o supera el ${umbralControl} % del capital (Art. 260-1 E.T.).`);
    } else if (holding === 'excluir' && tieneSemanticaHolding(cand) && !esContinuidad) {
      rechazar('filtro', 'holding', 'Sociedad holding o de grupo (en Razón Social).');
    } else if (saldoNegativo === 'excluir' && cand.hasNegativeBalance) {
      rechazar('filtro', 'saldoNegativo', 'Saldo negativo en balances (dato no verosímil).');
    } else if (perdidaOp === 'excluir' && enPerdida(cand)) {
      rechazar('filtro', 'perdidaOperativa', 'Pérdida operativa (criterio conservador DIAN).');
    }

    /* ── veredicto de la curación por IA ──
       Solo alcanza a las candidatas con identificador: las de otras fuentes no se
       curaron y no deben quedar descartadas por omisión. Una comparable que venía
       del estudio anterior no se retira aunque la IA diga que no coincide: su
       inclusión ya se sustentó en su momento. */
    const idIQ = cand.id ? String(cand.id).trim() : '';
    const ia = iaPorId && idIQ ? iaPorId[idIQ] : null;
    const grado = gradoDeActividad(ia);
    if (!descartada && iaPorId && idIQ && !String(cand.desc || '').trim() && !esContinuidad) {
      rechazar('ia', 'sinDescripcion', `Sin descripción del negocio para verificar la actividad (ID ${idIQ}).`);
    } else if (!descartada && grado === 'DISTINTA' && !esContinuidad) {
      rechazar('ia', 'actividadDistinta', `Curación IA: la descripción del negocio no coincide con la actividad${ia.motivo ? ' (' + ia.motivo + ')' : ''}.`);
    }

    /* Actividad afín, no idéntica. No se descarta ni entra por derecho propio: queda válida
       pero en segunda fila, y solo se recurre a ella si las de misma actividad no llenan el
       cupo. Las de continuidad nunca se marcan así: su inclusión ya se sustentó el año
       anterior y no necesitan la ampliación del criterio para entrar. */
    const esRelacionada = grado === 'RELACIONADA' && !esContinuidad;

    /* ── perfil funcional ──
       El dictamen de la IA manda cuando afirma algo: lee la Business Description
       entera, mientras que la heurística solo mira frases sueltas. Antes el perfil por
       palabras clave contradecía a la IA — una candidata que la IA aprobaba por
       actividad caía a factor 0,35 de perfil y salía del TOP-N por puntaje, aunque
       nada la hubiera descartado. Si la IA no logró decidirlo, se vuelve a la
       heurística, hoy bilingüe y agnóstica al sector. */
    const perfilIA = ia && PERFILES_DETERMINADOS.has(ia.perfil) ? ia.perfil : null;
    const perfil = perfilIA || cand.perfilFuncional || perfilFuncionalBilingue(cand.desc);
    const perfilOrigen = perfilIA ? 'ia' : 'heuristica';
    const fPerfil = perfil === 'SERVICIO' ? 1 : (perfil === 'MIXTO' ? 0.6 : 0.35);

    /* ── rigor funcional: RETIRADO como filtro (decisión del usuario, 2026-08-10) ──
       Descartaba por perfil —el rigor estricto admitía solo prestadores de servicios,
       el estándar excluía al empresario pleno— y separaba así un puñado de compañías
       del resto. Dejó de aportar cuando el informe pasó a reportar bajo un solo
       concepto, «diferencias funcionales», todo lo que supera los filtros objetivos
       y no integra la muestra: las que apartaba acababan en el mismo sitio que las
       demás, y de paso el motor perdía candidatas que podían puntuar bien.

       El perfil sigue vivo y sigue pesando: alimenta `fPerfil` justo arriba, que
       ordena el puntaje, y se publica en la columna «Perfil funcional» de la hoja de
       trazabilidad. Lo que se retira es su capacidad de excluir por sí solo. */

    /* ── especialidad: coincidencia con la actividad del contribuyente ──
       Si la IA ya confirmó la coincidencia sobre la descripción real, se toma su
       veredicto en lugar de recontar palabras clave. */
    const act = coincidenciaActividad(
      grado === 'MISMA' ? { ...cand, iaCoincide: true } : cand,
      companyActivity
    );
    /* La afín no puede puntuar como la idéntica: compite dentro de su propia fila, y ahí lo
       que las ordena es el resto de factores. El tope refleja que la IA la reconoció como del
       nicho —así no cae por debajo de una que la heurística no supo leer— sin igualarla a la
       que sí es la misma actividad. */
    const fEspecialidad = esRelacionada ? Math.max(act.factor, 0.55) : act.factor;

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
      esRelacionada ? `actividad relacionada${ia && ia.motivo ? ' (' + ia.motivo + ')' : ''}` : '',
      hayAct && !esRelacionada ? (fEspecialidad >= 0.5 ? `coincide con la actividad (${act.hits} coincidencias)` : `coincidencia parcial (${act.hits})`) : '',
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
      gradoActividad: grado || '',
      esRelacionada,
      descartada,
      motivoRechazo,
      categoriaRechazo,
      motivoClave,
    };
  });

  const validas = evaluated.filter(c => !c.descartada).sort((a, b) => b.score - a.score);
  const rechazadas = evaluated.filter(c => c.descartada);

  /* Las de continuidad ya pasaron los filtros sobre hechos (control, saldo negativo y
     pérdida operativa aplican igual para todas, arriba; solo la presunción de holding
     las exime) y entran primero, sin competir por puntaje: su inclusión ya se
     sustentó en el estudio anterior.

     Pero cuentan DENTRO del cupo, no aparte. Antes se sumaban al margen de `nTarget`,
     así que pedir 12 con 7 de continuidad devolvía 19 comparables: el número que el
     usuario escribe es el tamaño de la muestra final, no el de las candidatas nuevas.
     El cupo se completa con las mejores del resto. */
  const continuidadIncluidas = validas.filter(c => c.esContinuidad);
  const otrasValidas = validas.filter(c => !c.esContinuidad);

  /* El N del paso 2 manda cuando pide más que el mínimo; por debajo de `MINIMO_COMPARABLES` no
     se baja. Poner 6 en el paso 2 no puede producir una muestra de 6. */
  const cupo = Math.max(minimo, nTarget);
  const cupoRestante = Math.max(0, cupo - continuidadIncluidas.length);

  /* Dos filas, y la segunda solo se toca si la primera no llena el cupo: primero las de misma
     actividad, y las de actividad afín después. Es la ampliación del criterio de búsqueda que
     el informe tiene que justificar, así que se hace de forma mínima y queda marcada por
     candidata (`entroPorAmpliacion`) en vez de diluirse en el orden por puntaje. */
  const mismas = otrasValidas.filter(c => !c.esRelacionada);
  const afines = otrasValidas.filter(c => c.esRelacionada);

  const deMisma = mismas.slice(0, cupoRestante);
  const faltan = Math.max(0, cupoRestante - deMisma.length);
  const deAmpliacion = afines.slice(0, faltan).map(c => ({ ...c, entroPorAmpliacion: true }));

  const seleccionadas = [...continuidadIncluidas, ...deMisma, ...deAmpliacion];

  /* MOTIVO ESCRITO PARA LA RESERVA (2026-08-20, a pedido del usuario).

     La reserva es «suplente» solo mientras dura la corrida: si la curación descarta a una
     seleccionada, entra la primera de aquí. Cerrado el estudio, esa condición se acaba —no se
     vuelven a considerar hasta que alguien recure o reejecute el motor—, así que a efectos del
     informe son rechazadas y tienen que poder identificarse como tales. Sin motivo escrito, la
     columna «Motivo de rechazo» de la hoja «Selección comparables» queda vacía y quien audita
     el libro solo las encuentra combinando dos filtros («motivo vacío» + «no seleccionada»);
     al cotejar el informe a mano contra el Excel, esa parte no aparecía por ningún lado: la
     Tabla 16 declaraba 1.389 diferencias funcionales y por motivo solo se podían localizar
     1.304, con 85 sin etiqueta. Reportado sobre el informe de End Game 2025.

     Se marca `actividadDistinta` porque es la clave con la que el informe y el Excel ya agrupan
     las diferencias funcionales (`FUNDIDOS_EN_RIGOR` en `tablasInforme.js`, categoría `rigor`
     en `memoriaCalculoRangoOptimo.js`), de modo que el filtro por motivo devuelve el total
     completo. La frase, en cambio, dice el hecho real y no lo que dictaminó la curación: estas
     compañías NO fueron descartadas por su actividad —la curación las dio por buenas—, y
     escribir lo contrario dejaría el libro contradiciendo su propia columna de perfil funcional.

     NO se marcan `descartada` ni pasan a `rechazadas`: `rechazadasPorMotivo` cuenta sobre esa
     lista y el informe ya las suma aparte, por `reserva`. Contarlas en los dos sitios subiría la
     fila de diferencias funcionales a 1.474 y la tabla dejaría de sumar el universo. Lo que
     cambia es la ficha de cada compañía —que es lo que lee el Excel—, no los contadores. */
  const enReserva = (c) => ({
    ...c,
    motivoClave: c.motivoClave || CLAVE_RESERVA,
    motivoRechazo: c.motivoRechazo || MOTIVO_RESERVA,
    categoriaRechazo: c.categoriaRechazo || 'rigor',
  });

  /* Las afines que no hicieron falta vuelven a la reserva, detrás de las de misma actividad:
     si el analista sube el N objetivo, se echa mano primero de las idénticas. */
  const reserva = [
    ...mismas.slice(deMisma.length).map(enReserva),
    ...afines.slice(deAmpliacion.length).map(enReserva),
  ];

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
      controlada: rechazadas.filter(c => c.motivoClave === 'controlada').length,
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
    reserva,
    /* Cuántas entraron ampliando el criterio a actividades afines, y cuántas más había
       disponibles. Lo primero hay que declararlo en el informe; lo segundo dice si el techo lo
       pone el universo o el cupo. */
    ampliadas: deAmpliacion.length,
    relacionadasDisponibles: afines.length,
    /* El cupo de verdad aplicado, que no tiene por qué ser el N que el usuario escribió: por
       debajo de `MINIMO_COMPARABLES` no se baja. */
    cupo,
    /* Cuántas vienen del estudio anterior y si por sí solas ya pasan del objetivo: en
       ese caso no se recorta ninguna —descartar una comparable aceptada el año pasado
       exige justificarlo en el informe— y la muestra queda por encima de lo pedido. */
    continuidad: continuidadIncluidas.length,
    continuidadExcedeObjetivo: continuidadIncluidas.length > cupo,
    medianaPool,
    conActividad: !!String(companyActivity || '').trim(),
    ventasParteExaminada: ventasTP,
  };
}

/**
 * Devuelve el universo de Capital IQ con el veredicto del motor pegado a cada
 * candidata: si quedó seleccionada, por qué se rechazó y con qué perfil funcional.
 *
 * Existe porque el universo que guarda el componente es el import CRUDO —lo que
 * salió de `importCapitalIQExcel`—, mientras que `motivoClave` y `perfilFuncional`
 * los produce `scoreCandidates` sobre copias. La hoja «Selección comparables» cuenta
 * su embudo con fórmulas COUNTIF sobre la columna de motivo, así que sin este cruce
 * saldría con todas las filas en «Válida»: un embudo en cero que además cuadra, que
 * es peor que uno vacío porque parece correcto.
 *
 * Degrada sin romper: al reabrir un estudio sin volver a correr el motor no hay
 * auditoría —no se persiste, por la cuota de localStorage—, y entonces cada
 * candidata sale sin motivo, que es la verdad disponible en ese momento.
 *
 * @param {Array} universo      candidatas tal como las devolvió la importación.
 * @param {Array} comparables   la muestra final seleccionada.
 * @param {{rechazadas?:Array, reserva?:Array}|null} auditoria  detalle de la corrida.
 * @returns {Array} el universo con `seleccionada`, `motivoClave`, `motivoRechazo`,
 *          `categoriaRechazo` y `perfilFuncional` por candidata.
 */
export function enriquecerUniverso(universo, comparables = [], auditoria = null) {
  if (!Array.isArray(universo) || universo.length === 0) return [];

  /* El identificador de Capital IQ es único por compañía; `nameKey` NO lo es.
     `nameKey` se diseñó para cruzar con el estudio del año anterior —donde el nombre
     viene escrito de otra forma— y por eso quita paréntesis, sufijos societarios y
     todo lo que no sea alfanumérico. La contrapartida es que colapsa compañías
     distintas: «N-able, Inc. (NYSE:NABL)» y «Nable Inc. (KOSDAQ:A153460)» dan las dos
     «NABLE», y cruzar la auditoría por ahí le pegaba a la primera el motivo de la
     segunda —aparecía descartada por control con un 32,63 % de su mayor accionista,
     contradiciendo a la propia columna «Controlada» de la hoja—.

     Así que manda el identificador, y el nombre queda de respaldo solo cuando no hay
     dos identificadores que se contradigan. */
  const idDe = (c) => (c && c.id != null && String(c.id).trim()) || '';
  const nkDe = (c) => (c && (c.nameKey || nameKey(c.name))) || '';

  const indexar = (lista) => {
    const porId = new Map(), porNombre = new Map();
    lista.forEach((c) => {
      const id = idDe(c);
      if (id) porId.set(id, c);
      const nk = nkDe(c);
      if (nk && !porNombre.has(nk)) porNombre.set(nk, c);
    });
    return { porId, porNombre };
  };

  const buscar = (idx, cand) => {
    const id = idDe(cand);
    if (id && idx.porId.has(id)) return idx.porId.get(id);
    const ev = idx.porNombre.get(nkDe(cand));
    if (!ev) return null;
    /* Las dos traen identificador y no es el mismo: son compañías distintas que
       comparten clave de nombre, así que no se cruzan. */
    if (id && idDe(ev) && idDe(ev) !== id) return null;
    return ev;
  };

  const idxSeleccionadas = indexar(comparables || []);

  /* Un solo índice con todo lo que evaluó el motor: las rechazadas traen el motivo y
     las de reserva confirman el perfil de una válida que no entró al TOP-N. */
  const idxEvaluadas = indexar([
    ...((auditoria && auditoria.rechazadas) || []),
    ...((auditoria && auditoria.reserva) || []),
    ...(comparables || []),
  ]);

  /* La reserva, aparte: los estudios corridos antes de que se le escribiera el motivo la traen
     sin él, y su libro de soporte se genera al descargarlo. Sin esto, auditar un informe ya
     radicado obligaba a reejecutar el motor para que esas compañías dejaran de salir con la
     celda del motivo vacía. */
  const idxReserva = indexar((auditoria && auditoria.reserva) || []);

  return universo.map(cand => {
    const ev = buscar(idxEvaluadas, cand);
    const seleccionada = Boolean(buscar(idxSeleccionadas, cand));
    const esReserva = !seleccionada && Boolean(buscar(idxReserva, cand));
    return {
      ...cand,
      seleccionada,
      motivoClave: (ev && ev.motivoClave) || (esReserva ? CLAVE_RESERVA : ''),
      motivoRechazo: (ev && ev.motivoRechazo) || (esReserva ? MOTIVO_RESERVA : ''),
      categoriaRechazo: (ev && ev.categoriaRechazo) || (esReserva ? 'rigor' : ''),
      perfilFuncional: (ev && ev.perfilFuncional) || cand.perfilFuncional || '',
    };
  });
}

/**
 * Extrae el objeto JSON de una respuesta de la IA.
 *
 * Los modelos devuelven el JSON envuelto en prosa o en vallas de markdown con
 * frecuencia. Quitar las vallas y hacer JSON.parse falla en cuanto el modelo
 * añade una frase después del objeto, y entonces la curación se descartaba
 * entera. Aquí se escanean llaves balanceadas respetando las cadenas, que es lo
 * que hacía `extraerJSONDeRespuestaIA` en el monolito `index.html`, ya retirado.
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
/* Tamaño mínimo de la muestra. Es un piso, no un objetivo: el N del paso 2 manda cuando pide
   más, pero nunca se baja de aquí. Un rango intercuartil sobre menos observaciones deja de
   sostenerse, y el estudio se radica ante la DIAN con ese rango. */
export const MINIMO_COMPARABLES = 10;

/* Cuánto se parece la actividad de una candidata a la de la parte examinada. La curación
   devolvía un sí/no, y con un criterio tan estrecho como «la misma actividad específica» todo
   lo afín caía del mismo lado que lo ajeno: en un estudio real rechazó 188 de 270 y la muestra
   quedó en 6. Graduarlo permite ampliar el criterio solo lo necesario para llegar al mínimo, y
   dejar dicho cuáles entraron así para justificarlo en el informe. */
export const GRADOS_ACTIVIDAD = new Set(['MISMA', 'RELACIONADA', 'DISTINTA']);

/* El grado de un dictamen, tolerando los veredictos guardados antes de que existiera: ahí solo
   hay `coincide`, y un `false` de entonces significaba «no es la misma actividad específica»,
   que es exactamente DISTINTA bajo el criterio viejo. Se reevalúan al volver a curar. */
export function gradoDeActividad(dictamen) {
  if (!dictamen) return null;
  const grado = String(dictamen.grado || '').trim().toUpperCase();
  if (GRADOS_ACTIVIDAD.has(grado)) return grado;
  if (dictamen.coincide === true) return 'MISMA';
  if (dictamen.coincide === false) return 'DISTINTA';
  return null;
}

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
 *
 * Se exporta porque el reintento no es asunto de la curación: `/api/gemini` corta a los
 * 50 s y devuelve un 504 pensado para reintentarse (ver `GEMINI_CORTE_MS` en
 * `functions/index.js`), así que cualquier llamador que lo ignore pierde su trabajo. El
 * marcado de la plantilla lo ignoraba y perdía tramos enteros del documento sin marcar.
 * `etiqueta` solo cambia el prefijo del log, para saber qué se está reintentando.
 */
export async function consultarGemini(prompt, opciones = {}) {
  const {
    reintentos = CURACION_REINTENTOS, pausaBaseMs = CURACION_PAUSA_BASE_MS,
    modelo = GEMINI_MODELO_CURACION, etiqueta = 'curación IA',
  } = opciones;
  let ultimo;
  for (let intento = 0; intento <= reintentos; intento++) {
    try {
      const respuesta = await axios.post('/api/gemini', {
        model: modelo,
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
      console.warn(`[${etiqueta}] ${status ? 'HTTP ' + status : 'fallo de red'}; ` +
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
    targetProfitability = '4.716',
    pli = 'MO',
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
    relacionadas: 0,
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
  const previoCrudo = veredictoPrevio && veredictoPrevio.porId &&
    String(veredictoPrevio.actividadUsada || '').trim() === actividad
    ? veredictoPrevio.porId
    : null;

  /* Y solo los dictámenes que traen el grado. Los guardados antes de que existiera únicamente
     dicen sí/no bajo el criterio estricto de entonces —«la misma actividad específica»—, así
     que sus «no» esconden tanto las verdaderamente distintas como las afines. Reutilizarlos
     dejaría el estudio sin una sola candidata relacionada y la muestra seguiría corta sin que
     se entienda por qué: exactamente la trampa de un artefacto cacheado que el sistema da por
     al día. Se vuelven a consultar, que es lo único que puede producir el grado. */
  const previo = previoCrudo
    ? Object.fromEntries(Object.entries(previoCrudo).filter(([, d]) => d && d.grado))
    : null;
  const sinGrado = previoCrudo ? Object.keys(previoCrudo).length - Object.keys(previo).length : 0;
  if (sinGrado) {
    console.warn(`[curación IA] ${sinGrado} dictamen(es) guardados con el formato anterior ` +
      '(sin grado de actividad): se vuelven a consultar.');
  }

  const idsConsiderados = conDatos.map(c => String(c.id).trim());
  const contarGrado = (grado) =>
    idsConsiderados.filter(id => gradoDeActividad(veredicto.porId[id]) === grado).length;
  const contarCoincidencias = () => contarGrado('MISMA');

  const evaluables = previo ? conDatos.filter(c => !previo[String(c.id).trim()]) : conDatos;
  veredicto.reutilizadas = conDatos.length - evaluables.length;
  if (previo) {
    /* solo los del conjunto actual: arrastrar el veredicto entero dejaría en el
       estudio dictámenes de candidatas que ya no están en el universo */
    idsConsiderados.forEach(id => { if (previo[id]) veredicto.porId[id] = previo[id]; });
  }

  if (!evaluables.length) {
    veredicto.coinciden = contarCoincidencias();
    veredicto.relacionadas = contarGrado('RELACIONADA');
    avisar({
      etapa: 'fin', evaluadas: 0, total: conDatos.length, fallidas: 0,
      reutilizadas: veredicto.reutilizadas, coinciden: veredicto.coinciden,
      relacionadas: veredicto.relacionadas,
      mensaje: `Sin consultas nuevas: las ${veredicto.reutilizadas} candidatas ya estaban curadas para esta actividad · ` +
        `${veredicto.coinciden} coinciden` +
        (veredicto.relacionadas ? ` · ${veredicto.relacionadas} de actividad relacionada` : ''),
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
    const candidatos = lote.map(c => {
      const pliVal = pliOf({
        s: num(c.s),
        c: num(c.c),
        op: num(c.op),
        ar: num(c.ar),
        inv: num(c.inv),
        ap: num(c.ap),
      }, pli);
      const marginPct = pliVal !== null ? (pliVal * 100).toFixed(3) + ' %' : 'N/A';
      return {
        id: String(c.id).trim(),
        name: c.name || '',
        desc: String(c.desc || '').slice(0, 300),
        country: c.country || '',
        margin: marginPct,
      };
    });

        const prompt =
      'Eres un experto en precios de transferencia que revisa comparables de una base de datos financiera.\n\n' +
      'La empresa examinada tiene esta actividad económica real:\n"' + actividad + '"\n\n' +
      referencia +
      'La empresa examinada tiene un indicador de rentabilidad de ' + String(targetProfitability).replace('.', ',') + ' %. ' +
      'Prioriza como "MISMA" a las candidatas cuyo margen esté cerca de ese valor ' +
      'o sea bajo, y clasifica como "DISTINTA" a las que tengan márgenes altos sin omitir las la actividad economica .\n\n' +
      'A continuación hay una lista de empresas candidatas con su descripción de negocio y su margen financiero ("margin"). ' +
      'Para cada una, gradúa cuánto se parece su actividad real a la de la empresa examinada, sin importar el idioma ' +
      'en que esté escrita la descripción:\n' +
      '- "MISMA": el mismo tipo de negocio, los mismos productos o servicios, o una función equivalente.\n' +
      '- "RELACIONADA": actividad afín dentro de la misma cadena de valor o del mismo nicho —otro eslabón, un ' +
      'producto o servicio vecino, o la misma función sobre un mercado contiguo—, de modo que sus márgenes son ' +
      'razonablemente comparables aunque no sea idéntica. Pertenecer al mismo sector amplio NO basta.\n' +
      '- "DISTINTA": otro negocio. Úsalo también cuando el único parecido sea el sector amplio.\n\n' +
      'Sé estricto con "MISMA" y honesto con "RELACIONADA": no fuerces a "MISMA" lo que solo es afín, ni mandes a ' +
      '"DISTINTA" lo que de verdad comparte cadena de valor o nicho.\n\n' +
      'Clasifica también el perfil funcional de cada candidata, según las funciones y los riesgos que asume:\n' +
      '- "SERVICIO": presta servicios, fabrica o desarrolla por encargo de terceros; no explota propiedad ' +
      'intelectual propia ni asume el riesgo de mercado del producto final.\n' +
      '- "EMPRESARIO": explota su propia propiedad intelectual, marcas o productos y asume el riesgo de mercado.\n' +
      '- "MIXTO": hace las dos cosas de forma relevante.\n' +
        '- "INDEFINIDO": la descripción no alcanza para decidirlo. Úsalo en lugar de adivinar.\n\n' +
      'Candidatas:\n' + JSON.stringify(candidatos) + '\n\n' +
      'Responde ÚNICAMENTE con un objeto JSON válido, sin marcas markdown, con esta forma exacta:\n' +
      '{"resultados":[{"id":"","grado":"MISMA","perfil":"SERVICIO","motivo":""}]}\n' +
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
        /* Igual que el perfil: solo se acepta uno de los tres grados pedidos. Un texto libre
           del modelo no puede acabar decidiendo si una comparable entra en la muestra. Si el
           modelo se sale del guion —o contesta con el `coincide` del formato anterior—, manda
           lo que diga `coincide`, y si tampoco está se toma por DISTINTA, que es como se
           comportaba antes ante una respuesta ilegible. */
        const gradoCrudo = String(r.grado || '').trim().toUpperCase();
        const grado = GRADOS_ACTIVIDAD.has(gradoCrudo)
          ? gradoCrudo
          : (r.coincide === true ? 'MISMA' : 'DISTINTA');
        veredicto.porId[String(r.id).trim()] = {
          grado,
          /* Se conserva para no romper los estudios ya guardados ni lo que lo lea fuera de
             aquí: significa lo mismo que antes, «es la misma actividad». */
          coincide: grado === 'MISMA',
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
  const relacionadas = contarGrado('RELACIONADA');
  veredicto.coinciden = coinciden;
  /* Las de actividad afín. No entran a la muestra por sí solas: son con las que el motor
     completa el cupo cuando las de misma actividad no llegan al mínimo. */
  veredicto.relacionadas = relacionadas;
  const resumen = `${coinciden} de ${conDatos.length} coinciden con la actividad` +
    (relacionadas ? ` · ${relacionadas} de actividad relacionada, disponibles para completar la muestra` : '');
  avisar({
    etapa: 'fin',
    evaluadas: veredicto.evaluadas, total: conDatos.length, fallidas: veredicto.fallidas,
    reutilizadas: veredicto.reutilizadas, coinciden, relacionadas, errores: veredicto.errores,
    mensaje: veredicto.fallidas
      ? `${resumen} · ${veredicto.fallidas} no se pudieron evaluar (se dejan pasar sin descartarlas)`
      : resumen,
  });

  return veredicto;
}
