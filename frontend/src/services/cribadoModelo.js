/**
 * Reglas del cribado guardado, sin tocar la red.
 *
 * Va aparte de `cribadoStorage.js` por lo mismo que `firestoreModelo.js` va aparte de
 * `firestoreRepo.js`: importar el acceso a Storage arrastra el SDK de Firebase y la
 * inicialización de la aplicación, y entonces nada de esto se puede probar. Aquí están
 * las decisiones —qué ruta, qué nombre de archivo, cuándo hay que restaurar, qué error
 * significa que Storage no está habilitado— y son justo las que conviene fijar con
 * pruebas.
 */

/* Extensiones que admiten las reglas de Storage (ver storage.rules). Se comprueba
   también aquí para fallar antes de gastar la subida, con un mensaje que diga qué pasó. */
export const EXTENSIONES_CRIBADO = ['xlsx', 'xls', 'csv'];

/** Tope de las reglas de Storage para el cribado, repetido para avisar antes de subir. */
export const TOPE_CRIBADO_BYTES = 50 * 1024 * 1024;

/**
 * Nombre de archivo utilizable como parte de una ruta de Storage.
 *
 * El nombre viene del disco del usuario y puede traer barras, acentos, `#`, `?` o `..`.
 * En una ruta de Storage `/` crea carpetas y `..` produce rutas que las reglas no
 * reconocen, así que la subida fallaría con un error de permisos que no explica nada. Se
 * conserva la extensión porque las reglas la comprueban, y se cae a `.xlsx` cuando no
 * hay ninguna reconocible: es el formato del cribado de Capital IQ.
 */
export function nombreSeguro(nombre) {
  const bruto = String(nombre || '').trim();
  const soloArchivo = bruto.split(/[\\/]/).pop() || '';
  const punto = soloArchivo.lastIndexOf('.');
  const ext = punto > 0 ? soloArchivo.slice(punto + 1).toLowerCase() : '';
  const base = (punto > 0 ? soloArchivo.slice(0, punto) : soloArchivo)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-. ]+|[-. ]+$/g, '')
    .slice(0, 90);
  const nombreBase = base || 'cribado';
  return EXTENSIONES_CRIBADO.includes(ext) ? `${nombreBase}.${ext}` : `${nombreBase}.xlsx`;
}

/** Ruta del cribado dentro del espacio privado del usuario. */
export function rutaCribado(uid, estudioId, nombreArchivo) {
  if (!uid) throw new Error('Sin usuario: no se puede guardar el cribado en la nube.');
  if (!estudioId) throw new Error('Sin identificador de estudio: no se puede guardar el cribado en la nube.');
  return `usuarios/${uid}/estudios/${estudioId}/cribado/${nombreSeguro(nombreArchivo)}`;
}

/** Ruta del veredicto de la curación. Uno por estudio, se reemplaza al recurar. */
export function rutaCuracion(uid, estudioId) {
  if (!uid) throw new Error('Sin usuario: no se puede guardar la curación en la nube.');
  if (!estudioId) throw new Error('Sin identificador de estudio: no se puede guardar la curación en la nube.');
  return `usuarios/${uid}/estudios/${estudioId}/curacion.json`;
}

/**
 * ¿El fallo es que Cloud Storage no está habilitado en el proyecto?
 *
 * Merece distinguirse porque no es un error del usuario ni algo que se arregle
 * reintentando: hay que habilitarlo una vez en la consola de Firebase. El SDK lo reporta
 * como `storage/unknown` cuando el backend responde 404 al bucket, así que se mira
 * también el mensaje y no solo el código.
 */
export function esStorageNoHabilitado(err) {
  const codigo = (err && err.code) || '';
  if (codigo === 'storage/bucket-not-found' || codigo === 'storage/project-not-found') return true;
  return codigo === 'storage/unknown' && /404|not found|bucket/i.test((err && err.message) || '');
}

/** Mensaje único para lo anterior, con el paso concreto que falta. */
export const AVISO_STORAGE_APAGADO =
  'El almacenamiento de archivos no está habilitado en el proyecto de Firebase, así que ' +
  'el cribado no se guardó: habilítelo una vez en la consola (Compilación → Storage) y ' +
  'vuelva a cargar el archivo. Mientras tanto el motor funciona igual, pero al reabrir ' +
  'el estudio habrá que cargar el Excel de nuevo.';

/**
 * ¿Hay que traerse el cribado de la nube?
 *
 * Solo si no hay universo en memoria y sí una referencia guardada. Se separa de la
 * pantalla para poder comprobarlo sin montarla: es la condición que evita tanto la
 * descarga inútil —el universo ya está— como el silencio cuando falta.
 */
export function debeRestaurarCribado({ universo, cribadoIQ } = {}) {
  const hayUniverso = Array.isArray(universo) && universo.length > 0;
  return !hayUniverso && !!(cribadoIQ && cribadoIQ.ruta);
}

/**
 * Referencia que se guarda con el estudio. `filas` y `hoja` van junto a la ruta
 * —redundantes con el archivo— para que la pantalla pueda decir qué hay guardado sin
 * descargar dos megas solo para contarlo.
 */
export function referenciaCribado({ ruta, archivo, bytes, filas = null, hoja = '', uid, ahora }) {
  return {
    ruta,
    archivo: String(archivo || ''),
    bytes: bytes || 0,
    filas,
    hoja: hoja || '',
    subidoEn: ahora,
    subidoPor: uid,
  };
}
