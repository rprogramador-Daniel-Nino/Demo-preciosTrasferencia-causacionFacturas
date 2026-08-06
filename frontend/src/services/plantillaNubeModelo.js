/**
 * Qué se guarda de la plantilla del informe y cuándo sirve para restaurarla.
 *
 * Aparte de `plantillaNube.js` por lo mismo que `cribadoModelo.js` respecto a
 * `cribadoStorage.js`: importar el servicio arrastra el SDK de Firebase e IndexedDB, y
 * entonces estas decisiones no se pueden probar.
 */

/* Sube de versión si cambia la forma del paquete: al leer uno viejo hay que saber qué
   falta en lugar de dar por hecho que están todos los campos. */
export const VERSION_PAQUETE = 1;

/** Empaqueta lo que hace falta para reproducir el formato del Word en otro equipo. */
export function paqueteDePlantilla({ plantillaId, html, marcado, huecos, recursos, ahora }) {
  return {
    version: VERSION_PAQUETE,
    plantillaId: String(plantillaId || ''),
    html: html || null,
    marcado: marcado || null,
    huecos: Number(huecos) || 0,
    recursos: Array.isArray(recursos) ? recursos : [],
    subidoEn: ahora,
  };
}

/**
 * ¿El paquete sirve para restaurar?
 *
 * Hace falta el identificador —IndexedDB indexa la plantilla por él— y algo que renderizar:
 * el marcado, que es la ruta buena del generador, o al menos el HTML crudo.
 */
export function paqueteUtil(paquete) {
  if (!paquete || typeof paquete !== 'object') return false;
  if (!paquete.plantillaId) return false;
  return !!(paquete.html || paquete.marcado);
}
