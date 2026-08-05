/* ─────────────────────────────────────────────────────────────────────────────
   filtrosComparablesPatch.js — Detección de sociedades holding, AGNÓSTICA AL SECTOR.

   El sistema analiza contribuyentes de MUCHOS sectores. Por eso la detección de
   holding NO puede depender de una lista de SIC de un sector concreto (sería
   sesgada: funcionaría para software y fallaría para construcción, alimentos,
   manufactura, etc.). La regla es universal:

     · Un holding es una sociedad de cartera / oficina de inversión: su función es
       TENER participaciones o invertir, no operar. En la clasificación SIC esto
       es el grupo mayor 67xx «Holding and Other Investment Offices»
       (6712 bank holding, 6719 holding NEC, 6722/6726 investment offices,
       6732/6733 trusts, 6792/6794/6798/6799 inversores, REIT, etc.).
     · Un SIC es «operativo» si NO pertenece a esa familia 67xx — cualquiera que
       sea el sector (7372 software, 1531 construcción, 2000 alimentos, 3600
       manufactura, 6021 banca…). No hay lista blanca por sector.

   DECISIÓN (con el SIC siempre presente, como en los export de Capital IQ):
     1. Todos los SIC de la empresa son de la familia holding (67xx) → HOLDING puro
        (solo tiene participaciones/inversión) → se excluye.
     2. Tiene algún SIC operativo (fuera de 67xx), aunque el principal sea 67xx o
        el nombre diga "Holdings" → OPERA en algún sector → NO es holding.
     3. Sólo si NO hay ningún SIC (caso rarísimo), se usa el nombre como respaldo.

   Esto es agnóstico: nunca se nombra un sector. La comparabilidad por sector la
   resuelve OTRA parte del motor (cribado por actividad + curación funcional); la
   detección de holding sólo responde «¿es una sociedad de cartera sin operación?»,
   que es universal.

   PROBLEMA QUE CORRIGE (verificado sobre el universo real de END GAME, 2.987
   candidatas; el criterio anterior detectaba holding sólo por el nombre):
     · 415 falsos positivos (operativas con "Holdings" en la razón social, p. ej.
       «360 Ludashi Holdings», SIC 7372, excluidas mal).
     · 91 holdings reales que se escapaban (SIC 6719 sin "holding" en el nombre,
       p. ej. «Acroud AB»).

   Fundamento normativo: Art. 260-4 E.T. (análisis funcional). El Consejo de Estado
   evalúa la comparabilidad por las funciones reales, no por la razón social;
   clasificar por actividad (SIC) y no por el nombre alinea el filtro con la norma.

   INTEGRACIÓN: en comparablesEngine.js sustituir
       const isHolding = /\b(holdings?|inversiones|investment)\b/i.test(name + ' ' + desc);
   por
       const isHolding = esHolding({ name, desc, sic });
   importando `esHolding` de este módulo. El resto del motor no cambia.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * ¿Un código SIC pertenece a la familia holding / oficina de inversión (67xx)?
 * Universal, no depende del sector operativo del contribuyente.
 */
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

/**
 * Detección de holding agnóstica al sector.
 *
 * @param {{name?:string, desc?:string, sic?:string}} cand  candidata (Capital IQ)
 * @param {{familiaHolding?:(s:string)=>boolean}} [config]  test de familia holding
 *        personalizable (por defecto, grupo SIC 67xx).
 * @returns {boolean} true si es una sociedad de cartera sin operación.
 */
export function esHolding(cand, config = {}) {
  const esFamiliaHolding = config.familiaHolding || esSicHolding;
  const sics = sicsTodos(cand && cand.sic);

  if (sics.length > 0) {
    // Con SIC presente, la decisión es 100% por actividad (agnóstica al sector).
    const tieneOperativo = sics.some((s) => !esFamiliaHolding(s));
    const tieneHolding = sics.some((s) => esFamiliaHolding(s));
    // Holding puro sólo si TODOS sus SIC son de la familia holding.
    return tieneHolding && !tieneOperativo;
  }

  // Respaldo (SIC ausente, muy raro en Capital IQ): el nombre por sí solo.
  const texto = `${(cand && cand.name) || ''} ${(cand && cand.desc) || ''}`.toLowerCase();
  return /\b(holdings?|inversiones|investment holding|sociedad de inversi[oó]n)\b/.test(texto);
}
