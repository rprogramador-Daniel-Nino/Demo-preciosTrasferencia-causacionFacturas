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
/* Un encabezado que menciona una partida de balance pero NO es un saldo: una rotación, unos
   días, un porcentaje, una variación. Las claves de las cuatro partidas de capital de trabajo se
   ampliaron a raíces —`receivable`, `payable`, `inventor`, `plant`— porque Capital IQ cambia el
   rótulo entre plantillas, y una raíz se tragaría «Accounts Receivable Turnover»: meter una
   rotación donde va un saldo es basura con cara de dato. */
const RATIOS_NO_SON_SALDOS = /turnover|turns|days |ratio|%|growth|per share|margin|change in|outstanding|variation/;

/** ¿Este encabezado nombra un ratio en vez de un saldo? Case-insensitive. */
export function esRatioYNoSaldo(encabezado) {
  return RATIOS_NO_SON_SALDOS.test(String(encabezado || '').toLowerCase());
}

export const COLUMNAS_IQ = {
  name: { etiqueta: 'Compañía', esencial: true, claves: ['company name', 'compañía', 'compania', 'empresa', 'razon social', 'razón social', 'nombre'] },
  s: { etiqueta: 'Ingresos', esencial: true, claves: ['total revenue', 'revenue', 'ventas', 'ingresos'] },
  c: { etiqueta: 'Costo de ventas', esencial: false, claves: ['cost of goods', 'cost of revenue', 'costo de ventas', 'costos'] },
  op: { etiqueta: 'Utilidad operacional', esencial: true, claves: ['operating income', 'operating profit', 'utilidad operacional', 'ebit'] },
  /* Raíces y no nombres exactos: Capital IQ exporta «Total Receivables» en una plantilla y
     «Accounts Receivable» en otra, y con la lista cerrada anterior las cuatro partidas de
     capital de trabajo quedaban sin detectar en cribados reales — con el ajuste calculándose
     contra ceros. `esRatioYNoSaldo` es lo que impide que la raíz se coma una rotación. */
  ar: { etiqueta: 'Cuentas por cobrar', esencial: false, esSaldo: true, claves: ['receivable', 'cuentas por cobrar', 'cartera', 'cxc'] },
  inv: { etiqueta: 'Inventarios', esencial: false, esSaldo: true, claves: ['invent', 'existencias'] },
  ap: { etiqueta: 'Cuentas por pagar', esencial: false, esSaldo: true, claves: ['payable', 'cuentas por pagar', 'proveedores', 'cxp'] },
  /* PP&E entra por la misma vía que las otras partidas de balance. Sin él, el ajuste
     de propiedad, planta y equipo se calcula contra cero en todas las comparables y
     los escenarios que lo incluyen quedan sin sentido. */
  ppe: {
    etiqueta: 'Propiedad, planta y equipo',
    esencial: false,
    esSaldo: true,
    claves: ['plant', 'net pp&e', 'pp&e', 'ppe',
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
        /* Para las columnas de SALDO, un encabezado que es un ratio nunca casa por más que
           contenga la raíz: ver `esRatioYNoSaldo`. Sin esa guarda, ampliar las claves a raíces
           habría metido «Accounts Receivable Turnover» donde va el saldo de cartera.

           El veto NO es global: la columna del accionista mayoritario se llama «% owned by
           single holder» y su propio nombre lleva un %, así que un veto para todas la habría
           dejado sin detectar. */
        const findCol = (keywords, esSaldo) => headers.findIndex(
          h => (!esSaldo || !esRatioYNoSaldo(h)) && keywords.some(k => h.includes(k)),
        );

        const idx = {};
        const reconocidas = [], faltantes = [];
        Object.entries(COLUMNAS_IQ).forEach(([clave, def]) => {
          const i = findCol(def.claves, def.esSaldo);
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

/* Los cuatro filtros duros, en el orden de precedencia que manda, y con el motivo con el que
   el informe los cuenta. Vive en un solo sitio porque de él dependen DOS decisiones distintas
   que tienen que coincidir: a quién se le paga la curación (`prefiltrar`) y quién entra en la
   muestra (`scoreCandidates`).

   No coincidían. `prefiltrar` no eximía a las de continuidad del filtro de holding y el motor
   sí, de modo que una comparable del estudio del año pasado con «Group» en la razón social se
   caía antes de curarse aunque el motor la habría conservado — y se caía sin un aviso. Y
   `prefiltrar` miraba `cand.hasLoss` mientras el motor usa `enPerdida`, que además reconoce
   `op < 0` cuando el flag no viene: esas se curaban, pagando, para descartarlas después.

   Desde que el paso 2 pinta el embudo en vivo con estos mismos predicados, divergir dejó de ser
   un detalle: el panel prometería un número que el motor no respeta.

   El rigor funcional NO está aquí: depende del perfil, y el perfil lo dictamina la propia
   curación. Se evalúa después, en `scoreCandidates`. */
export const FILTROS_DUROS = [
  {
    clave: 'controlada',
    /* El control efectivo (Art. 260-1) es el más duro y NO se exime por continuidad: una
       participación sobre el umbral dice que la empresa no es independiente HOY, y eso no lo
       sustenta el estudio anterior. */
    activo: (cfg) => cfg.control === 'excluir',
    aplica: (cand, cfg) => esControlada(cand, { umbral: cfg.umbralControl }),
    eximeContinuidad: false,
    motivo: (cfg) => `Vinculada: un accionista alcanza o supera el ${cfg.umbralControl} % del capital (Art. 260-1 E.T.).`,
  },
  {
    clave: 'holding',
    /* La condición de holding se PRESUME de la razón social. Ahí una comparable que ya venía
       del estudio previo conserva su exención: su inclusión se sustentó en su momento y
       retirarla ahora rompería la continuidad de la serie. */
    activo: (cfg) => cfg.holding === 'excluir',
    aplica: (cand) => tieneSemanticaHolding(cand),
    eximeContinuidad: true,
    motivo: () => 'Sociedad holding o de grupo (en Razón Social).',
  },
  {
    clave: 'saldoNegativo',
    activo: (cfg) => cfg.saldoNegativo === 'excluir',
    aplica: (cand) => Boolean(cand.hasNegativeBalance),
    eximeContinuidad: false,
    motivo: () => 'Saldo negativo en balances (dato no verosímil).',
  },
  {
    clave: 'perdidaOperativa',
    /* La continuidad NO queda exenta, a diferencia del holding. Es una decisión deliberada y
       probada: la pérdida es un hecho del ejercicio en curso, no una presunción sobre la razón
       social, así que el estudio anterior no la sustenta; y desde que existe
       `negativasObjetivo` el analista tiene una palanca EXPLÍCITA para admitir pérdidas, de
       modo que eximirla aquí abriría un tercer camino oculto que contradiría su propio ajuste
       de «excluir». Ver `continuidadEnPerdida` en el retorno de `scoreCandidates`, que es lo
       que permite nombrarlas en vez de dejarlas caer en silencio. */
    activo: (cfg) => cfg.perdidaOp === 'excluir',
    aplica: (cand) => enPerdida(cand),
    eximeContinuidad: false,
    motivo: () => 'Pérdida operativa (criterio conservador DIAN).',
  },
];

/** La configuración de los filtros duros con sus valores por omisión, en un solo sitio. */
export function configDeFiltros(config = {}) {
  return {
    perdidaOp: config.perdidaOp || 'excluir',
    holding: config.holding || 'excluir',
    saldoNegativo: config.saldoNegativo || 'excluir',
    control: config.control || 'excluir',
    umbralControl: config.umbralControl === undefined ? 50 : config.umbralControl,
  };
}

/**
 * Qué filtro duro descarta a esta candidata, o `null` si ninguno.
 *
 * El PRIMERO que aplique manda: una candidata puede violar dos a la vez y el informe la cuenta
 * una sola vez, bajo el motivo de más precedencia.
 *
 * @returns {{clave:string, motivo:string}|null}
 */
export function filtroQueDescarta(cand, config = {}, esContinuidad = false) {
  const cfg = configDeFiltros(config);
  for (const f of FILTROS_DUROS) {
    if (!f.activo(cfg)) continue;
    if (f.eximeContinuidad && esContinuidad) continue;
    if (f.aplica(cand, cfg)) return { clave: f.clave, motivo: f.motivo(cfg) };
  }
  return null;
}

/**
 * Filtros duros aplicados sobre un universo, con la atribución de cada descarte.
 *
 * Se aplican ANTES de curar para no pagarle a la IA por candidatas que el motor iba a descartar
 * igual — en un cribado real de 2.987 compañías eran ~1.359 evaluaciones tiradas, casi la mitad
 * del gasto de la corrida.
 *
 * `porMotivo` es lo que permite pintar el embudo por control en el paso 2: sin él solo se sabe
 * cuántas caen, no por cuál, y la pantalla tendría que recalcularlo por su cuenta — que es
 * exactamente cómo los dos criterios volverían a divergir.
 *
 * @param {Array} candidates  el universo.
 * @param {object} config     los filtros del paso 2.
 * @param {Array} [previas]   las comparables del estudio anterior, para la exención de holding.
 * @returns {{validas:Array, rechazadas:Array, porMotivo:Object<string,Array>}}
 */
export function prefiltrar(candidates, config = {}, previas = []) {
  const priorSet = new Set(
    (previas || []).map((c) => c.nameKey || nameKey(c.name)).filter(Boolean),
  );
  const validas = [], rechazadas = [];
  const porMotivo = {};
  FILTROS_DUROS.forEach((f) => { porMotivo[f.clave] = []; });

  (candidates || []).forEach(cand => {
    const esContinuidad = priorSet.has(cand.nameKey || nameKey(cand.name));
    const fuera = filtroQueDescarta(cand, config, esContinuidad);
    if (fuera) {
      rechazadas.push(cand);
      porMotivo[fuera.clave].push(cand);
    } else {
      validas.push(cand);
    }
  });
  return { validas, rechazadas, porMotivo };
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
/* El motivo de una comparable del año anterior que la cuota de negativas dejó fuera. Se
   distingue del motivo general de reserva a propósito: no es que no alcanzara el puntaje, es que
   el analista pidió negativas y el N no daba para las dos cosas. El informe tiene que poder
   decir eso exactamente. */
export const MOTIVO_DESPLAZADA_POR_CUOTA = 'Venía del estudio anterior y se retiró para dar '
  + 'cupo a las comparables en pérdida que se pidieron en el paso 2. Retirarla del estudio hay '
  + 'que justificarlo: revise si conviene subir el N objetivo en lugar de perder la continuidad.';

export const CLAVE_RESERVA = 'actividadDistinta';
export const MOTIVO_RESERVA = 'Supera los filtros objetivos pero no integra la muestra: '
  + 'menor grado de comparabilidad funcional frente a la parte examinada (Art. 260-4 E.T.).';

/* ── INTENSIDAD DE CAPITAL DE TRABAJO ──
   Cuanto capital de trabajo mueve una compañia por peso de venta:
   (CxC + Inventario − CxP) / ventas.

   POR QUE ES UN FACTOR DE COMPARABILIDAD. El ajuste de capital de trabajo existe para corregir
   diferencias residuales en esta dimension, y su tamaño mide cuanto habia que corregir: un
   ajuste de diez puntos es la señal de que las comparables no eran comparables ahi. Medido en
   el caso reportado el 2026-09-02, sobre el mismo cribado y variando SOLO esta intensidad:

     comparables con intensidad muy baja     el ajuste desplaza el rango  +4,45 pt
     con la mitad de la del contribuyente                                 +2,37 pt
     con intensidad parecida (±10 %)                                      +0,24 pt
     con la misma intensidad                                              +0,00 pt

   Asi que preferir las que necesitan poco ajuste no es elegir por resultado: es elegir las que
   de verdad se parecen (Art. 260-4 E.T.; Guias OCDE cap. III), y produce un estudio que se
   sostiene mejor ante un revisor que uno con un ajuste enorme.

   ES UNA PREFERENCIA, NO UN FILTRO: pondera el puntaje, como la geografia y el tamaño.
   Descartar por capital de trabajo dejaria fuera compañias de la misma actividad por una
   dimension secundaria, y en un cribado sin esas columnas vaciaria la muestra.

   `null` cuando faltan las tres partidas: no saber no es lo mismo que ser distinta. */
function intensidadCapitalTrabajo(o) {
  const s = num(o && o.s);
  if (s === null || !s) return null;
  const ar = num(o.ar), inv = num(o.inv), ap = num(o.ap);
  if (ar === null && inv === null && ap === null) return null;
  return ((ar || 0) + (inv || 0) - (ap || 0)) / s;
}

/* Cuanto pesa esta dimension en el puntaje. Menos que la actividad y el perfil funcional —los
   que la norma nombra primero— y del orden del tamaño y la geografia, que son los otros dos
   factores de circunstancias economicas. */
const PESO_CAPITAL_TRABAJO = 0.10;

/* Con que brecha de intensidad el factor llega a cero. Media vuelta de venta (0,5) es mucho: a
   partir de ahi el ajuste que haria falta es tan grande que la comparable ya no describe la
   misma realidad economica. */
const INTENSIDAD_MAXIMA_TOLERADA = 0.5;

/* Lo que recibe quien no trae los datos: el punto medio. Penalizarla castigaria a toda la
   muestra en un cribado sin esas columnas —el caso de la exportacion de Capital IQ del
   2026-09-01, que no traia ninguna de las cuatro—; premiarla la pondria por delante de una que
   si se pudo verificar. */
const FACTOR_CAPITAL_TRABAJO_SIN_DATOS = 0.5;

export function scoreCandidates(candidates, config, companyActivity = '', priorComps = [], contexto = {}) {
  const {
    nTarget = 12,
    /* Piso del tamaño de la muestra. Parámetro y no constante incrustada para poder probar la
       mecánica del cupo con números pequeños, y por si el despacho cambia el suelo. La
       aplicación nunca lo pasa: usa el de siempre. */
    minimo = MINIMO_COMPARABLES,
    perdidaOp = 'excluir',
    /* Cuántas comparables en pérdida se quieren en la muestra final. Es un OBJETIVO y a la
       vez un TOPE: si hay más disponibles no entran de más, y si hay menos entran las que
       haya y se reporta cuántas faltaron. Cuenta DENTRO de `nTarget`, no aparte: pedir 12
       con 3 negativas da una muestra de 12, no de 15 (mismo criterio que la continuidad, que
       ya se corrigió una vez por esto). Solo se llena con actividad `MISMA`, por decisión
       del usuario (2026-08-31). Con `perdidaOp: 'excluir'` no hay negativas que repartir y
       el objetivo se ignora solo. */
    negativasObjetivo = 0,
    holding = 'excluir',
    control = 'excluir',
    umbralControl = 50,
    saldoNegativo = 'excluir',
    geo = 'ninguna',
    /* `rigor` puede seguir llegando en estudios guardados antes del 2026-09-01. Se acepta y se
       ignora a propósito: su filtro se retiró el 2026-08-10 —ver la nota del bloque «rigor
       funcional» más abajo— y desde entonces no descarta a nadie. No se destructura porque nada
       lo usa; destructurarlo sin usarlo haría creer que sí. */
  } = config;

  const priorSet = new Set((priorComps || []).map(c => nameKey((c && c.name) || c)));
  const ventasTP = num(contexto.ventasParteExaminada);
  /* La intensidad de capital de trabajo del contribuyente: la vara del factor nuevo. Llega como
     ratios ya calculados y no como saldos, porque el llamador tiene las cifras del estudio y
     aqui solo se comparan; asi este motor no necesita saber que campo del estudio es cual.
     `null` cuando el llamador no la manda, y entonces la dimension no puntua. */
  const ctTP = contexto.capitalTrabajoParteExaminada || null;
  const intensidadTP = ctTP
    ? ((num(ctTP.ar) || 0) + (num(ctTP.inv) || 0) - (num(ctTP.ap) || 0))
    : null;
  /* El margen de la parte examinada, para ordenar la cuota de negativas por cercanía. Puede
     faltar —un estudio sin cifras cargadas todavía—, y entonces la cuota degrada al orden por
     puntaje: elegir por cercanía a un número que no existe sería inventar. */
  const pliTP = num(contexto.pliParteExaminada);
  const metodoPli = contexto.metodoPli || 'MO';
  /* CON QUÉ VARA se mide la cercanía. Por omisión el margen crudo de la fuente, pero el
     llamador puede inyectar la suya, y debe hacerlo cuando la conclusión del estudio se
     sostiene en el rango AJUSTADO: ahí la vara que importa es el PLI ajustado por capital de
     trabajo, no el crudo.

     La diferencia no es cosmética. El contribuyente no se ajusta contra sí mismo —sus ratios
     se cancelan— así que su PLI no se mueve, pero el de cada comparable sí. Con el capital de
     trabajo de las comparables en cero el ajuste es un corrimiento constante hacia arriba, de
     modo que para quedar cerca del contribuyente EN TÉRMINOS AJUSTADOS hay que elegir
     comparables cuyo margen crudo esté ese corrimiento más abajo. Medir con la vara equivocada
     elige el conjunto equivocado (reportado el 2026-09-01).

     Se inyecta en lugar de importar el motor de ajuste aquí porque «qué vara decide» lo sabe
     quien conoce `useadj`, que es el llamador, y porque así se prueba sin montar el ajuste. */
  const margenInyectado = typeof contexto.margenDeCandidata === 'function'
    ? contexto.margenDeCandidata
    : null;
  /* Veredicto de la curación por IA, por identificador de la fuente. Se aplica
     como filtro duro y, cuando confirma la coincidencia, como factor máximo de
     especialidad. */
  const iaPorId = (contexto.iaMatch && contexto.iaMatch.porId) || null;

  /* Mediana del margen operacional del pool: el comportamiento central del universo cribado.
     Es el ancla de respaldo del factor de rentabilidad. */
  const medianaPool = medianaDe(
    (candidates || []).map(c => (c.s ? (c.op ?? 0) / c.s : null)).filter(x => x !== null)
  );

  /* ── EL ANCLA DE LA RENTABILIDAD: LA PARTE EXAMINADA ──
     Pedido el 2026-09-02: «tomar comparables que encajen con el indicador de nuestra compañia,
     hacemos ese dato dinamico para que sirva para todas las compañias».

     Antes el factor premiaba la cercania a la MEDIANA DEL POOL, asi que la muestra se centraba
     en la industria y no en la parte examinada. En el caso reportado el pool estaba cerca del
     10 % y el contribuyente en 6,204 %: el puntaje empujaba justo hacia las que lo dejaban
     fuera del rango.

     Anclarlo en el indicador de la parte examinada es criterio de comparabilidad del Art. 260-4
     —un nivel de rentabilidad semejante suele reflejar funciones y riesgos semejantes— y es
     DINAMICO por construccion: sale del propio estudio, no de un parametro, asi que sirve para
     todas las compañias sin configurar nada.

     Se mide con el margen SIN AJUSTAR, que es la vara con la que se busca («primero buscamos
     las comparables con el no ajustado», criterio del contador del 2026-09-01). El cumplimiento
     se sigue concluyendo sobre el ajustado.

     Sin indicador propio se cae a la mediana del pool: el comportamiento anterior es mejor que
     ninguno. */
  /* Se reutiliza , que el componente ya envia para ordenar la cuota de
     negativas: es el mismo margen del contribuyente medido con la misma vara sin ajustar, asi
     que pedirlo dos veces con dos nombres invitaria a que divergieran. */
  const margenTP = num(contexto.pliParteExaminada);
  const anclaRent = margenTP !== null ? margenTP : medianaPool;
  const anclaRentabilidad = margenTP !== null ? 'parteExaminada' : 'medianaPool';

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
    /* El MISMO juez que usa `prefiltrar` para decidir a quién se le paga la curación. Estaban
       escritos dos veces y divergían en dos puntos —la exención de continuidad del holding y el
       reconocimiento de `op < 0` sin flag—, de modo que se pagaba por candidatas que el motor
       descartaba y se perdían de continuidad que el motor habría conservado. */
    const fuera = filtroQueDescarta(cand, {
      perdidaOp, holding, saldoNegativo, control, umbralControl,
    }, esContinuidad);
    if (fuera) rechazar('filtro', fuera.clave, fuera.motivo);

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

    /* ── rentabilidad: cercanía al ancla, o preferencia por pérdida ──
       La política de pérdidas manda sobre el ancla: con `preferir` es una decisión explícita del
       analista y no puede quedar por debajo de una preferencia de comparabilidad. */
    let fRent;
    if (cand.hasLoss) fRent = perdidaOp === 'preferir' ? 1 : 0.4;
    else if (perdidaOp === 'preferir') fRent = 0.4;
    else {
      const pli = cand.s ? (cand.op ?? 0) / cand.s : 0;
      fRent = Math.max(0, 1 - Math.min(1, Math.abs(pli - anclaRent) / 0.5));
    }

    /* ── capital de trabajo: cuanto ajuste haria falta para poder compararla ── */
    const intensidadCand = intensidadCapitalTrabajo(cand);
    let fCapTrabajo = FACTOR_CAPITAL_TRABAJO_SIN_DATOS;
    if (intensidadTP !== null && intensidadCand !== null) {
      const brecha = Math.abs(intensidadCand - intensidadTP);
      fCapTrabajo = Math.max(0, 1 - Math.min(1, brecha / INTENSIDAD_MAXIMA_TOLERADA));
    }

    /* Pesos dinámicos: con actividad detectada el nicho manda. */
    const hayAct = act.hayActividad;
    /* Los cinco pesos de siempre, REESCALADOS para dejarle sitio al capital de trabajo sin que
       la suma pase de 1. Sin reescalar, agregar un factor subiria el puntaje de todas y el tope
       de `Math.min(1, ...)` empezaria a aplanar a las mejores, que es como se pierde la
       capacidad de ordenar justo en la cabeza de la lista. El reparto RELATIVO entre los cinco
       no cambia, asi que el orden que producian entre ellos se conserva. */
    const escala = 1 - PESO_CAPITAL_TRABAJO;
    const wPerfil = (hayAct ? 0.20 : 0.35) * escala;
    const wEspecialidad = (hayAct ? 0.40 : 0.15) * escala;
    const wGeo = (hayAct ? 0.10 : 0.15) * escala;
    const wTamano = (hayAct ? 0.15 : 0.20) * escala;
    const wRent = 0.15 * escala;

    const score = Math.min(1,
      wPerfil * fPerfil + wEspecialidad * fEspecialidad + wGeo * fGeo +
      wTamano * fTamano + wRent * fRent + PESO_CAPITAL_TRABAJO * fCapTrabajo +
      (esContinuidad ? 0.08 : 0)
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
      factores: {
        perfil: fPerfil, especialidad: fEspecialidad, geografia: fGeo, tamano: fTamano,
        rentabilidad: fRent, capitalTrabajo: fCapTrabajo,
      },
      /* La intensidad medida, para que la tabla la muestre al lado del factor: el numero explica
         el factor, y sin el hay que creerselo. */
      intensidadCapitalTrabajo: intensidadCand,
      razones,
      esContinuidad,
      gradoActividad: grado || '',
      /* El motivo que escribió la curación. Sin él el grado es una etiqueta que hay que creer;
         con él el analista puede validar el veredicto antes de generar los EEFF, que es para lo
         que se pidió (2026-09-01). Vacío cuando nadie la curó: agregada a mano, sin
         identificador, o curación no corrida. */
      motivoActividad: (ia && ia.motivo) || '',
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
  const continuidadTodas = validas.filter(c => c.esContinuidad);
  const otrasValidas = validas.filter(c => !c.esContinuidad);

  /* El N del paso 2 manda cuando pide más que el mínimo; por debajo de `MINIMO_COMPARABLES` no
     se baja. Poner 6 en el paso 2 no puede producir una muestra de 6. */
  const cupo = Math.max(minimo, nTarget);

  /* Dos filas, y la segunda solo se toca si la primera no llena el cupo: primero las de misma
     actividad, y las de actividad afín después. Es la ampliación del criterio de búsqueda que
     el informe tiene que justificar, así que se hace de forma mínima y queda marcada por
     candidata (`entroPorAmpliacion`) en vez de diluirse en el orden por puntaje. */
  const mismas = otrasValidas.filter(c => !c.esRelacionada);
  const afines = otrasValidas.filter(c => c.esRelacionada);

  /* ── Cuota de comparables en pérdida ──
     El objetivo se reserva ANTES de llenar con positivas, porque si no las positivas —que
     casi siempre son muchas más— se llevarían todo el cupo y la cuota no se cumpliría nunca.

     Y es también un TOPE: las negativas que no ganan cupo NO compiten después en el llenado
     de positivas, se van a la reserva. Sin eso, pedir 3 podía devolver 5 —las 3 de la cuota
     más las que entraran por puntaje— y el número dejaría de significar «las que salen en el
     informe», que es lo que el usuario pidió.

     Solo de actividad MISMA: las afines nunca aportan negativas. Es la decisión del usuario
     y además lo más defendible, porque una comparable en pérdida ya obliga a explicar por
     qué se incluye; sumarle que su actividad solo es afín es pedir dos justificaciones a la
     vez. */
  const objetivoNegativas = Math.max(0, Math.trunc(Number(negativasObjetivo) || 0));

  /* ── Cuál de las negativas disponibles entra ──
     Reportado el 2026-09-01: con la cuota ya funcionando, el rango de un estudio real bajó de
     3,111-9,173 % a -0,355-4,312 %, y el contribuyente —en -4,595 %— seguía fuera. La cuota
     tomaba las de mayor PUNTAJE de comparabilidad, que no son las que acercan el rango: entre 37
     negativas disponibles podía quedarse con cuatro cercanas a cero.

     Decisión del usuario (2026-09-01): dentro de la cuota se prefieren las de margen más CERCANO
     al del contribuyente. Es a la vez lo más efectivo y lo más defendible, y esa coincidencia no
     es casual: el principio de comparabilidad pide justamente comparables con un perfil
     semejante al de la parte examinada. Una compañía en pérdida real comparada con compañías en
     pérdida es la comparación correcta, no un estiramiento (Guías OCDE cap. III, §3.64-3.65). El
     criterio que el informe escribe es «se eligieron las comparables cuyo perfil de rentabilidad
     más se parece al de la parte examinada», y se publica en `criterioNegativas`.

     Dos límites deliberados:
       · Solo REORDENA dentro de las que ya pasaron todo —filtros, actividad, curación—, así que
         no admite ninguna que antes no fuera válida.
       · Solo gobierna LA CUOTA. El llenado con positivas sigue por puntaje: si el margen mandara
         en toda la muestra, la comparabilidad pasaría a segundo plano en cada fila, y eso es otra
         cosa y no se pidió.

     Se compara el margen crudo (`pliOf` sobre las cifras de la fuente) y no el PLI ajustado por
     capital de trabajo, que es el que decide el rango: replicar el motor OCDE aquí encadenaría
     los dos módulos. Para ordenar por semejanza el margen crudo es la medida correcta —es el
     perfil de la compañía, no el del escenario de ajuste— y basta. */
  const margenCrudoDe = (cand) => pliOf({
    s: num(cand.s), c: num(cand.c), op: num(cand.op),
    ar: num(cand.ar), inv: num(cand.inv), ap: num(cand.ap),
  }, metodoPli);
  const margenDe = (cand) => {
    if (!margenInyectado) return margenCrudoDe(cand);
    /* Si la vara inyectada no puede medir esta candidata —le faltan partidas—, se cae al margen
       crudo en vez de mandarla al final: quedarse sin medida no es lo mismo que estar lejos. */
    const v = num(margenInyectado(cand));
    return v === null ? margenCrudoDe(cand) : v;
  };
  /* Y DENTRO de las cercanas, primero las que están POR DEBAJO del contribuyente.

     Reportado el 2026-09-01: «ya son muchas negativas, la idea es que cumpla así ponga pocas».
     La cercanía a secas elige alrededor del margen del contribuyente, así que la mitad quedan
     por encima y empujan el primer cuartil hacia arriba. Medido sobre las 37 negativas de un
     cribado real, con el contribuyente en -4,595 % y muestra de 12:

       cercanas                 hacían falta 7   P25  -4,940 %
       cercanas POR DEBAJO      hacen falta  4   P25  -4,940 %
       las más profundas        harían falta 4   P25 -16,460 %  ← rango indefendible

     Por debajo cumple con CUATRO y deja el rango igual de sano. Y sigue siendo comparabilidad y
     no resultado: «se eligieron comparables cuya rentabilidad es comparable o inferior a la de
     la parte examinada», que es lo que corresponde cuando la parte examinada está en pérdida.

     Es una PREFERENCIA, no un filtro: si no hay suficientes por debajo se completa con las más
     cercanas de las que quedan. Y dentro de cada grupo manda la cercanía, no la profundidad —
     tomar las más hondas daría el rango de -16 % de la tabla. */
  const ordenarNegativas = (lista) => {
    if (pliTP === null) return lista;
    const porCercania = (a, b) => {
      const da = margenDe(a), db = margenDe(b);
      /* Las que no tienen margen calculable van al final: no se puede afirmar que se parezcan. */
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return Math.abs(da - pliTP) - Math.abs(db - pliTP);
    };
    const estaDebajo = (c) => {
      const m = margenDe(c);
      return m !== null && m <= pliTP;
    };
    return [
      ...lista.filter(estaDebajo).sort(porCercania),
      ...lista.filter((c) => !estaDebajo(c)).sort(porCercania),
    ];
  };
  const criterioNegativas = pliTP === null ? 'puntaje' : 'cercania-por-debajo';

  const mismasNegativas = ordenarNegativas(mismas.filter(enPerdida));
  const mismasPositivas = mismas.filter((c) => !enPerdida(c));
  /* Las de continuidad ya entraron y cuentan contra el objetivo: si el estudio anterior
     aporta una en pérdida y se piden 3, faltan 2, no 3. El objetivo es «cuántas negativas
     salen en el informe», no «cuántas nuevas se buscan». */
  /* Las de continuidad que YA están en pérdida van al frente y no ceden nunca: satisfacen la
     cuota, y retirar una negativa para meter otra negativa sería absurdo. */
  const continuidadOrdenada = [
    ...continuidadTodas.filter(enPerdida),
    ...continuidadTodas.filter((c) => !enPerdida(c)),
  ];
  const negativasDeContinuidad = continuidadTodas.filter(enPerdida).length;
  const porCubrir = Math.max(0, objetivoNegativas - negativasDeContinuidad);
  /* Cuántas negativas nuevas hay DE VERDAD: no se retira continuidad por unas que no existen. */
  const negativasAUsar = Math.min(porCubrir, mismasNegativas.length);

  /* ── La continuidad cede sitio a la cuota ──
     Reportado el 2026-09-01 sobre un estudio real: 16 comparables del año anterior, todas
     rentables, N objetivo 12 y cuota de 4 con 41 negativas disponibles. La muestra salió con 16
     y CERO negativas, porque `cupoRestante = max(0, 12 − 16) = 0` dejaba a la cuota sin espacio
     en silencio.

     Decisión del usuario (2026-09-01): la cuota MANDA. Se retiran las de MENOR puntaje hasta
     respetar el N exacto, y quedan NOMBRADAS en `continuidadDesplazada` — retirar una comparable
     aceptada el año anterior se justifica en el informe, así que no puede desaparecer en
     silencio. Van a la reserva, no a `rechazadas`: el informe suma la reserva aparte y meterlas
     en las dos listas descuadraría la tabla contra el universo.

     Con la cuota en 0 NO se retira ninguna: esa es la decisión anterior —«no se descarta ninguna,
     porque retirar una ya aceptada hay que justificarlo»— y sigue en pie, con su aviso
     `continuidadExcedeObjetivo`. Lo que cambia es solo el caso en que el analista pide negativas
     de forma explícita. */
  const topeContinuidad = objetivoNegativas > 0
    ? Math.max(negativasDeContinuidad, cupo - negativasAUsar)
    : continuidadOrdenada.length;
  const continuidadIncluidas = continuidadOrdenada.slice(0, topeContinuidad);
  const continuidadDesplazadaLista = continuidadOrdenada.slice(topeContinuidad);

  const cupoRestante = Math.max(0, cupo - continuidadIncluidas.length);
  const deNegativas = mismasNegativas.slice(0, Math.min(porCubrir, cupoRestante));

  const cupoParaPositivas = Math.max(0, cupoRestante - deNegativas.length);

  /* ── ALTERNATIVAS DE SELECCION, NUMERADAS Y REPRODUCIBLES ──
     Pedido el 2026-09-02: poder reejecutar y obtener comparables distintas.

     NO es aleatorio, y la diferencia importa. La seleccion de este motor es determinista a
     proposito: mismo cribado y misma configuracion dan siempre la misma muestra, y eso es lo
     que permite responderle a un revisor «estas doce, porque son las de mayor puntaje segun
     estos criterios» en vez de «salieron esas». Con azar el estudio deja de ser reproducible
     —ni el propio despacho podria volver a obtener la muestra que radico— y reejecutar hasta
     que cumpla es seleccion por resultado, que es justo lo que un revisor busca.

     Asi que se explora sin perder eso: la alternativa N conserva las mejores por puntaje y
     sustituye las ultimas N-1 por las siguientes de la reserva. La alternativa 3 de hoy es la
     alternativa 3 de dentro de un anio, de modo que la muestra se reconstruye desde el cribado
     mas el numero de alternativa, y el informe puede declarar cual se uso.

     SOLO VARIAN LAS POSITIVAS. La cuota de negativas se elige por un criterio declarado —las
     mas cercanas por debajo del contribuyente— y variar entre ellas contradiria ese criterio.
     La continuidad tampoco cede: retirar una comparable aceptada el anio anterior hay que
     justificarlo en el informe, y no puede pasar porque alguien pulso «otra combinacion».

     El desplazamiento se topa en lo que la reserva permite de verdad: una alternativa que no
     existe devolveria la misma muestra y el boton pareceria roto, asi que se satura en la
     ultima y `alternativasDisponibles` dice cuantas hay. */
  const sustituiblesPositivas = Math.min(
    cupoParaPositivas,
    Math.max(0, mismasPositivas.length - cupoParaPositivas),
  );
  const alternativasDisponibles = 1 + sustituiblesPositivas;
  const alternativaPedida = Math.max(1, Math.trunc(Number(config.alternativa) || 1));
  const alternativa = Math.min(alternativaPedida, alternativasDisponibles);
  const sustituciones = alternativa - 1;

  const deMisma = sustituciones > 0
    ? [
      ...mismasPositivas.slice(0, cupoParaPositivas - sustituciones),
      ...mismasPositivas.slice(cupoParaPositivas, cupoParaPositivas + sustituciones),
    ]
    : mismasPositivas.slice(0, cupoParaPositivas);
  const faltan = Math.max(0, cupoParaPositivas - deMisma.length);
  const afinesPositivas = afines.filter((c) => !enPerdida(c));
  const deAmpliacion = afinesPositivas.slice(0, faltan).map(c => ({ ...c, entroPorAmpliacion: true }));

  const seleccionadas = [...continuidadIncluidas, ...deNegativas, ...deMisma, ...deAmpliacion];

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
  /* Las positivas de misma actividad van primero: si el analista sube el N objetivo, el cupo
     nuevo lo llena una positiva, porque la cuota de negativas ya está satisfecha. Detrás las
     negativas que no cupieron, y al final las afines —de las que primero las positivas—,
     igual que antes: se echa mano de las idénticas antes que de las afines. */
  const reserva = [
    ...continuidadDesplazadaLista.map((c) => ({
      ...c,
      motivoClave: CLAVE_RESERVA,
      motivoRechazo: MOTIVO_DESPLAZADA_POR_CUOTA,
      categoriaRechazo: 'rigor',
    })),
    /* Por IDENTIDAD y no por «slice(deMisma.length)»: la alternativa rompe el supuesto de que
       las seleccionadas son un prefijo de la lista ordenada. Con la alternativa 3, `deMisma`
       tiene el mismo tamanio pero NO son las primeras, asi que cortar por longitud dejaba a dos
       seleccionadas TAMBIEN en la reserva —contadas dos veces en el embudo, que entonces deja de
       cuadrar contra el universo— y perdia de vista a las desplazadas, que es justo lo que el
       informe tiene que poder nombrar. */
    ...mismasPositivas.filter((c) => !deMisma.includes(c)).map(enReserva),
    ...mismasNegativas.slice(deNegativas.length).map(enReserva),
    ...afinesPositivas.slice(deAmpliacion.length).map(enReserva),
    ...afines.filter(enPerdida).map(enReserva),
  ];

  return {
    evaluadas: evaluated.length,
    seleccionadas,
    rechazadas,
    /* Cual de las combinaciones se uso y cuantas hay. Viaja en el resultado —y de ahi al
       `selectionFunnel` que se persiste con el estudio— porque es lo que hace reproducible la
       muestra: con el cribado y este numero se reconstruye exactamente la misma seleccion. */
    alternativa,
    alternativasDisponibles,
    /* Contra que se midio la cercania de rentabilidad. Se declara porque centrar la muestra en
       la rentabilidad de la parte examinada es lo que un revisor mira mas de cerca: tiene que
       quedar escrito en el soporte, no implicito en un puntaje. */
    anclaRentabilidad,
    /* ── LA DIMENSION QUE EXPLICA EL AJUSTE ──
       Si el ajuste desplaza el rango diez puntos, el problema del estudio no es la muestra: es
       que las comparables no se parecen al contribuyente en capital de trabajo. Estos numeros
       permiten decirlo con evidencia en vez de sospecharlo. */
    capitalTrabajo: (() => {
      const conDatos = seleccionadas.filter((c) => intensidadCapitalTrabajo(c) !== null);
      const media = conDatos.length
        ? conDatos.reduce((a, c) => a + intensidadCapitalTrabajo(c), 0) / conDatos.length
        : null;
      return {
        conDatos: conDatos.length,
        total: seleccionadas.length,
        intensidadMediaMuestra: media,
        intensidadParteExaminada: intensidadTP,
      };
    })(),
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
      /* Vale 0 desde que el filtro de rigor funcional se retiró (2026-08-10): nada asigna ya
         ese motivo. NO es un contador roto y no se retira, porque `rigorFuncional` es la clave
         con la que el informe nombra su fila de diferencias funcionales —`filasRazonesRechazo`
         le suma ahí la reserva y los motivos de `FUNDIDOS_EN_RIGOR`—, así que la fila de la
         Tabla 16 sale con su cifra real aunque este componente aporte cero. */
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

    /* ── La cuota de negativas, en tres cifras ──
       Las tres hacen falta para poder decir la verdad en pantalla y en el informe:
         · lo que se pidió,
         · lo que se consiguió —continuidad en pérdida incluida, porque también sale en el
           informe—,
         · y el techo real del universo cargado, que es lo que distingue «no hay más en
           Capital IQ» de «el motor no las buscó». Sin la tercera, el aviso de que solo
           entraron 2 de 3 no se puede escribir sin adivinar por qué. */
    negativasObjetivo: objetivoNegativas,
    negativasIncluidas: deNegativas.length + negativasDeContinuidad,
    negativasDisponibles: mismasNegativas.length + negativasDeContinuidad,
    /* Las que el filtro de pérdidas dejó fuera. Con `perdidaOp: 'excluir'` es el número que
       le permite al diagnóstico del rango decir «hay N negativas que el filtro está
       excluyendo, incluirlas bajaría el P25» en vez de una sugerencia genérica. */
    negativasExcluidasPorFiltro: rechazadas.filter(c => c.motivoClave === 'perdidaOperativa').length,
    negativasDeContinuidad,
    /* Las comparables del estudio anterior que ESTE año están en pérdida y por eso el filtro
       las dejó fuera. Se publican por su nombre porque retirar una comparable ya aceptada hay
       que justificarlo en el informe, y hasta ahora se caían sin un solo aviso: el analista
       veía la muestra más corta y no tenía cómo saber cuál faltaba ni por qué. */
    continuidadEnPerdida: rechazadas
      .filter(c => c.esContinuidad && c.motivoClave === 'perdidaOperativa')
      .map(c => c.name),
    /* El cupo de verdad aplicado, que no tiene por qué ser el N que el usuario escribió: por
       debajo de `MINIMO_COMPARABLES` no se baja. */
    cupo,
    /* Cuántas vienen del estudio anterior y si por sí solas ya pasan del objetivo: en
       ese caso no se recorta ninguna —descartar una comparable aceptada el año pasado
       exige justificarlo en el informe— y la muestra queda por encima de lo pedido. */
    continuidad: continuidadIncluidas.length,
    continuidadExcedeObjetivo: continuidadIncluidas.length > cupo,
    /* Las del año anterior que la cuota de negativas obligó a retirar, con nombre y motivo:
       el informe tiene que justificar cada una. Arreglo vacío cuando no se retiró ninguna. */
    continuidadDesplazada: continuidadDesplazadaLista.map((c) => ({
      name: c.name,
      motivo: MOTIVO_DESPLAZADA_POR_CUOTA,
    })),
    continuidadDesplazadaPorCuota: continuidadDesplazadaLista.length,
    /* Con qué criterio se eligieron las negativas de la cuota. El informe lo escribe: la
       selección de comparables es una decisión metodológica y su criterio se sustenta. */
    criterioNegativas,
    /* Con qué vara se midió la cercanía: el margen crudo de la fuente, o la que inyectó el
       llamador —el PLI ajustado cuando la conclusión se sostiene en el rango ajustado—. */
    varaDeCercania: margenInyectado ? 'inyectada' : 'margen-crudo',
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
 *
 * Además, dentro de una cadena, una `"` sin backslash delante no siempre es el
 * cierre: el modelo a veces cita un término entre comillas dobles rectas sin
 * escaparlas (mismo defecto reportado el 2026-09-01 en analisisSectorPrompts.js
 * — mantener esta heurística sincronizada con la de ese archivo y con la de
 * analisisMercadoPrompts.js si cambia). La comilla de cierre real de JSON está
 * casi siempre seguida (tras espacios) de `:`, `}`, `]` o el fin de la
 * respuesta; una coma es ambigua en español y solo cuenta si además le sigue
 * una `"` — el inicio de la siguiente clave/elemento. Cualquier otro caso es
 * texto suelto: la cadena sigue abierta y esa comilla se escapa en el buffer
 * que se le pasa a JSON.parse, en vez de cortarla ahí.
 */
export function extraerJSON(texto) {
  const s = String(texto || '');
  const inicio = s.indexOf('{');
  if (inicio < 0) throw new Error('La respuesta no contiene ningún objeto JSON.');
  let nivel = 0, enCadena = false, escapado = false, saneado = '';
  for (let i = inicio; i < s.length; i++) {
    const ch = s[i];
    if (enCadena) {
      if (escapado) {
        escapado = false;
      } else if (ch === '\\') {
        escapado = true;
      } else if (ch === '"') {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        const siguiente = s[j];
        let cierreReal = siguiente === undefined || siguiente === ':' || siguiente === '}' || siguiente === ']';
        if (!cierreReal && siguiente === ',') {
          let k = j + 1;
          while (k < s.length && /\s/.test(s[k])) k++;
          cierreReal = k >= s.length || s[k] === '"';
        }
        if (cierreReal) enCadena = false;
        else saneado += '\\';
      }
      saneado += ch;
      continue;
    }
    if (ch === '"') { enCadena = true; saneado += ch; continue; }
    if (ch === '{') nivel++;
    else if (ch === '}') {
      nivel--;
      saneado += ch;
      if (nivel === 0) return JSON.parse(saneado);
      continue;
    }
    saneado += ch;
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
export const SEGUNDOS_POR_LOTE = 15;

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
