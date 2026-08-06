/* ─────────────────────────────────────────────────────────────────────────────
   filtrosComparablesPatch.js — Filtros de comparables, AGNÓSTICOS AL SECTOR.

   El sistema sirve a contribuyentes de MUCHOS sectores, así que ningún filtro
   puede depender de una lista de códigos SIC de un sector concreto: sería sesgada
   —funcionaría para software y fallaría para construcción, alimentos o
   manufactura—. Los dos filtros de este módulo responden preguntas universales.

   ── 1. HOLDING: CLASIFICACIÓN SOLO SEMÁNTICA ──
   La condición de holding se determina por la RAZÓN SOCIAL y la descripción del
   negocio, en español e inglés. El código SIC NO clasifica holdings (decisión del
   usuario, 2026-08-06): la familia SIC 67xx «Holding and Other Investment Offices»
   describe cómo Capital IQ codificó la actividad, no si la empresa opera, y hacerla
   decidir volvía el filtro dependiente de cómo vengan ordenados los códigos.

     · tieneSemanticaHolding(cand) → true si el nombre o la descripción trae un
       término inequívoco de sociedad de cartera o grupo empresarial.
     · esHolding(cand)             → alias de lo anterior. Conserva el nombre que el
       motor ya usaba (isHolding), pero OJO: su criterio cambió por completo.
     · holdingSospecha(cand)       → 'no' | 'revisar'.

   Del vocabulario se excluyen a propósito los términos ambiguos —«investment»,
   «invest», «ventures»—, que aparecen en nombres de empresas plenamente operativas
   («Cultural Investment», «Supreme Ventures») y producían falsos positivos.

   ── 2. INDEPENDENCIA / CONTROL (Art. 260-1 E.T.) ──
   Una empresa cuyo capital está en manos de un solo accionista por encima del
   umbral (50 % por defecto) no es un comparable independiente. El porcentaje se
   toma del dato numérico de Capital IQ («% Owned by Single Holder») cuando el
   export lo trae, y si no, se extrae del texto de accionistas «Nombre (pct); …».

   Fundamento normativo: Art. 260-4 (análisis funcional) y Art. 260-1
   (independencia). El Consejo de Estado evalúa la comparabilidad por las funciones
   reales y por la vinculación efectiva, no por una etiqueta mecánica.
   ───────────────────────────────────────────────────────────────────────────── */

/* Términos semánticos INEQUÍVOCOS de holding / grupo, en español e inglés. */
const TERMINOS_HOLDING = [
  // español
  'holding', 'holdings', 'grupo', 'grupo empresarial', 'sociedad de cartera',
  'sociedad tenedora', 'sociedad matriz', 'tenedora de acciones',
  // inglés / uso internacional en Capital IQ
  'group', 'holdco', 'hldg',
  // otros idiomas frecuentes
  'groupe', 'gruppo', 'holdingmaatschappij',
];
const RX_HOLDING_SEM = new RegExp(
  '\\b(' + TERMINOS_HOLDING.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'i',
);

/**
 * ¿El nombre o la descripción contienen un término de holding/grupo (ES/EN)?
 * @param {{name?:string, desc?:string}} cand
 * @returns {boolean}
 */
export function tieneSemanticaHolding(cand) {
  const texto = `${(cand && cand.name) || ''} ${(cand && cand.desc) || ''}`;
  return RX_HOLDING_SEM.test(texto);
}

/**
 * Nivel de sospecha de holding, para marcar la candidata en la trazabilidad.
 * @param {{name?:string, desc?:string}} cand
 * @returns {'no'|'revisar'}
 */
export function holdingSospecha(cand) {
  return tieneSemanticaHolding(cand) ? 'revisar' : 'no';
}

/**
 * ¿Es holding? Clasificación SOLO semántica; el SIC no interviene.
 * @param {{name?:string, desc?:string}} cand
 * @returns {boolean}
 */
export function esHolding(cand) {
  return tieneSemanticaHolding(cand);
}

/* ── Utilidades de código SIC ──
   Ya no deciden la condición de holding, pero se conservan: son la única forma que
   tiene el resto del sistema de leer los SIC de una candidata, y la hoja de
   trazabilidad los muestra. */

/** ¿Un código SIC pertenece a la familia holding / inversión (67xx)? */
export function esSicHolding(sic4) {
  return /^67\d\d$/.test(String(sic4 || ''));
}

/** Primer código SIC de cuatro dígitos (el principal). */
export function sicPrincipal(sic) {
  const m = /(\d{4})/.exec(String(sic || ''));
  return m ? m[1] : '';
}

/** Todos los códigos SIC de cuatro dígitos presentes. */
export function sicsTodos(sic) {
  return String(sic || '').match(/\d{4}/g) || [];
}

/* ── INDEPENDENCIA / CONTROL (Art. 260-1 E.T.) ── */

/** Mayor % de un accionista, desde «Nombre (pct); Nombre (pct); …». */
export function maxParticipacion(texto) {
  const s = String(texto || '');
  const pcts = s.match(/\(\s*([\d]+(?:\.[\d]+)?)\s*\)/g) || [];
  const vals = pcts.map((p) => parseFloat(p.replace(/[()\s]/g, ''))).filter((n) => Number.isFinite(n));
  return vals.length ? Math.max(...vals) : null;
}

/**
 * ¿La candidata está controlada (un accionista supera el umbral)?
 *
 * Acepta las dos formas en que puede llegar el dato: el porcentaje ya numérico que
 * Capital IQ entrega en `holderPct`/`maxpct` cuando el reporte se configuró con ese
 * campo, o el texto de accionistas del que hay que extraerlo. Sin ningún dato no se
 * excluye, que es el criterio conservador.
 *
 * @param {{holderPct?:number, maxpct?:number, holders?:string, holdersText?:string, ownership?:string}} cand
 * @param {{umbral?:number}} [config]  umbral de control (por defecto 50).
 * @returns {boolean}
 */
export function esControlada(cand, config = {}) {
  const umbral = config.umbral != null ? config.umbral : 50;
  const maxp = participacionMaxima(cand);
  if (maxp == null) return false;
  return maxp > umbral;
}

/**
 * Participación del mayor accionista de una candidata, venga como número o como
 * texto. Devuelve null si no hay dato.
 * @param {{holderPct?:number, maxpct?:number, holders?:string, holdersText?:string, ownership?:string}} cand
 * @returns {number|null}
 */
export function participacionMaxima(cand) {
  if (!cand) return null;
  for (const valor of [cand.maxpct, cand.holderPct]) {
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  }
  return maxParticipacion(cand.holders || cand.holdersText || cand.ownership || '');
}

/**
 * Criterio UNIFICADO de falta de independencia, para quien necesite una sola
 * pregunta: ¿holding/grupo por semántica, o controlada por participación?
 *
 * El motor NO lo usa —lleva los dos motivos por separado, porque el informe los
 * reporta en filas distintas—, pero `prefiltrar` sí lo aprovecha cuando el llamador
 * no distingue.
 *
 * @param {object} cand
 * @param {{umbral?:number}} [config]
 * @returns {boolean}
 */
export function esVinculadaOControlada(cand, config = {}) {
  return tieneSemanticaHolding(cand) || esControlada(cand, config);
}
