/**
 * Guarda en localStorage sin dejar que un fallo de cuota tumbe la app: no hay
 * ErrorBoundary en frontend/, así que una excepción sin capturar en el efecto
 * que persiste el estudio desmonta todo el árbol de React.
 */
export function guardarJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`[pt] No se pudo guardar '${key}' en localStorage (${e && e.message}). Este cambio no quedó persistido.`);
    return false;
  }
}
