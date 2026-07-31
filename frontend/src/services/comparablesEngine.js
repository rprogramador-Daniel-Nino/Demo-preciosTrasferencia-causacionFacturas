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

/**
 * Puntuación de candidatas (Motor TOP-N) con 5 criterios ponderados
 */
export function scoreCandidates(candidates, config, companyActivity = '', priorComps = []) {
  const {
    nTarget = 12,
    perdidaOp = 'excluir',
    holding = 'excluir',
    saldoNegativo = 'excluir',
    geo = 'ninguna',
    rigor = 'estandar'
  } = config;

  const priorSet = new Set((priorComps || []).map(c => nameKey(c.name || c)));

  const evaluated = candidates.map(cand => {
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

    // Puntuación
    let score = 0.5;

    // Bono por continuidad del año anterior
    const esContinuidad = priorSet.has(cand.nameKey);
    if (esContinuidad) {
      score += 0.15;
    }

    // Factor geográfico
    if (geo !== 'ninguna') {
      if (geo === 'LATAM' && /colombia|mexico|chile|peru|argentina|brasil/i.test(cand.country)) {
        score += 0.1;
      }
    }

    return {
      ...cand,
      score: Math.min(1.0, score),
      esContinuidad,
      descartada,
      motivoRechazo
    };
  });

  const validas = evaluated.filter(c => !c.descartada).sort((a, b) => b.score - a.score);
  const rechazadas = evaluated.filter(c => c.descartada);

  const seleccionadas = validas.slice(0, nTarget);

  return {
    evaluadas: evaluated.length,
    seleccionadas,
    rechazadas,
    totalValidas: validas.length
  };
}

/**
 * Curación de candidatas enviando descripciones a Gemini Vision/AI API
 */
export async function curateCandidatesWithGemini(candidates, companyActivity) {
  if (!companyActivity || !candidates.length) return candidates;

  const prompt = `Eres un experto en precios de transferencia.
La empresa examinada tiene la siguiente actividad económica real:
"${companyActivity}"

A continuación se lista un conjunto de empresas candidatas con sus descripciones de negocio.
Para cada una, evalúa si su actividad real COINCIDE con la actividad de la empresa examinada.

Candidatas:
${candidates.slice(0, 30).map((c, i) => `${i + 1}. ID: ${c.id} | Nombre: ${c.name} | Desc: ${c.desc || 'Sin descripción'}`).join('\n')}

Devuelve SOLO un JSON estricto:
{
  "evaluacion": [
    { "id": "", "coincide": true, "motivo": "Explicación breve" }
  ]
}`;

  try {
    const response = await axios.post('/api/gemini', {
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: prompt }] }]
    });

    const candText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candText) {
      const cleanJson = candText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleanJson);
      const evalMap = new Map((parsed.evaluacion || []).map(item => [item.id, item]));

      return candidates.map(c => {
        const ev = evalMap.get(c.id);
        if (ev && ev.coincide === false && !c.esContinuidad) {
          return { ...c, descartada: true, motivoRechazo: `Curación IA: ${ev.motivo}` };
        }
        return c;
      });
    }
  } catch (err) {
    console.warn("Curación IA omitida por error o límite API:", err);
  }

  return candidates;
}
