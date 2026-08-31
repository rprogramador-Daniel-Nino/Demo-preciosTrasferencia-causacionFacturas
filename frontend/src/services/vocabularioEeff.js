/* ─────────────────────────────────────────────────────────────────────────────
   El diccionario compartido de vocabulario para los campos de EEFF que pueden
   desglosarse solo en una nota — o no existir en el documento en absoluto: costo de
   ventas, cuentas por cobrar/pagar a partes relacionadas, inventarios.

   Cada campo aprende, con el tiempo, qué palabras usa un documento real para referirse a
   ese concepto (ver `agregarPalabras`), y solo se le confía la decisión de "esto no está
   en ninguna parte, ni vale la pena preguntarle a la IA" cuando lleva muchos estudios
   seguidos sin aportar una palabra nueva (`esMaduro`) — antes de eso, la pasada angosta a
   Gemini sigue corriendo igual que si el diccionario no existiera.

   Puro: sin Firestore, sin red. El acceso a la nube vive en `firestoreRepo.js`.
   Ver docs/superpowers/specs/2026-08-25-fallback-notas-utilidad-operacional-design.md.
   ───────────────────────────────────────────────────────────────────────────── */

/* Cuántos estudios seguidos sin aportar una palabra nueva hacen falta para confiar en el
   diccionario y saltarse la pasada angosta. Arranca conservador a propósito: un diccionario
   que decide solo, mientras todavía puede estar incompleto, repite el error de un
   vocabulario fijo de un solo cliente (ver el defecto D5 del spec de 2026-08-21), esta vez
   por incompletitud en vez de por diseño fijo. */
export const UMBRAL_MADUREZ = 20;

export function diccionarioVacio() {
  return { palabras: [], estudiosSinPalabraNueva: 0 };
}

/** minúsculas, sin tildes, sin espacios de más — para que «Relacionadas» y
 *  «relacionadas  » cuenten como la misma palabra del diccionario. */
export function normalizarPalabra(palabra) {
  return String(palabra || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

export function esMaduro(diccionario, umbral = UMBRAL_MADUREZ) {
  return Boolean(diccionario) && (diccionario.estudiosSinPalabraNueva || 0) >= umbral;
}

/** ¿Aparece alguna palabra del diccionario en el texto completo del documento? Insensible
 *  a mayúsculas y tildes, igual que `normalizarPalabra`. */
export function contienePalabraConocida(texto, diccionario) {
  const normalizado = normalizarPalabra(texto);
  if (!normalizado) return false;
  const palabras = (diccionario && diccionario.palabras) || [];
  return palabras.some((p) => p && normalizado.includes(p));
}

/**
 * Agrega palabras nuevas al diccionario. Si ninguna es nueva, solo incrementa el contador
 * de madurez; si alguna sí lo es, se agrega y el contador vuelve a cero — un diccionario
 * que sigue aprendiendo no está maduro todavía. No muta el diccionario recibido.
 */
export function agregarPalabras(diccionario, palabrasNuevas) {
  const base = diccionario || diccionarioVacio();
  const normalizadas = Array.from(new Set(
    (palabrasNuevas || []).map(normalizarPalabra).filter(Boolean),
  ));
  const yaConocidas = new Set(base.palabras || []);
  const nuevas = normalizadas.filter((p) => !yaConocidas.has(p));

  if (nuevas.length === 0) {
    return { ...base, estudiosSinPalabraNueva: (base.estudiosSinPalabraNueva || 0) + 1 };
  }
  return {
    palabras: [...(base.palabras || []), ...nuevas],
    estudiosSinPalabraNueva: 0,
  };
}
