/**
 * Persistencia del cribado de Capital IQ y del veredicto de la curación en Cloud Storage.
 *
 * Ninguno de los dos cabía en la base de datos: un cribado son miles de filas con la
 * descripción de negocio de cada candidata —entre 1 y 2 MB— y un documento de Firestore
 * admite algo más de un millón de bytes (ver `TOPE_DOCUMENTO` en firestoreModelo.js). Por
 * eso el universo no se guardaba en ninguna parte y había que volver a cargar el Excel
 * cada vez que se reabría el estudio, y por eso el veredicto de la curación vivía solo en
 * localStorage: abrirlo en otra máquina obligaba a volver a pagar las consultas a Gemini
 * de todas las candidatas.
 *
 * Aquí van los dos a Storage y en el estudio queda solo la referencia —unos cientos de
 * bytes—, que sí viaja cómodamente en el documento. El archivo se guarda tal como se
 * cargó, sin reprocesar: además de restaurar el universo, deja el soporte de qué cribado
 * exacto sustenta el estudio.
 *
 * Las decisiones puras (rutas, saneado del nombre, cuándo restaurar) están en
 * `cribadoModelo.js` para poder probarlas sin arrastrar el SDK, igual que
 * `firestoreModelo.js` respecto a `firestoreRepo.js`. Se reexportan desde aquí para que
 * la pantalla tenga un solo sitio del que importar.
 */
import { deleteObject, getBytes, getStorage, ref, uploadBytes } from 'firebase/storage';
import { app } from './firebase.js';
import {
  rutaCribado, rutaCuracion, referenciaCribado, TOPE_CRIBADO_BYTES,
  podriaFaltarElBucket, esStorageNoHabilitado, urlSondaBucket, faltaElBucket,
} from './cribadoModelo.js';

export {
  nombreSeguro, rutaCribado, rutaCuracion, debeRestaurarCribado, esStorageNoHabilitado,
  AVISO_STORAGE_APAGADO, TOPE_CRIBADO_BYTES,
} from './cribadoModelo.js';

/**
 * ¿El fallo se explica porque el proyecto no tiene bucket?
 *
 * El SDK no lo dice: sin bucket, el preflight CORS responde 404, el navegador lo reporta
 * como bloqueo de CORS y el SDK lo toma por un fallo de red y reintenta hasta agotarse,
 * devolviendo `storage/retry-limit-exceeded` —el mismo código que daría una conexión
 * mala—. Se confirma preguntando por el bucket, que sin credenciales responde 404 si no
 * existe y 401/403 si existe pero no se puede listar.
 *
 * Solo se consulta cuando ya ha fallado algo, así que no añade tráfico al camino normal.
 * Ante la duda devuelve `false`: es peor mandar a habilitar Storage a quien ya lo tiene
 * que dejar el mensaje genérico.
 */
export async function bucketAusente(err) {
  if (!podriaFaltarElBucket(err)) return false;
  if (esStorageNoHabilitado(err)) return true;
  const bucket = (app.options && app.options.storageBucket) || '';
  if (!bucket) return true;
  try {
    const respuesta = await fetch(urlSondaBucket(bucket), { method: 'GET' });
    return faltaElBucket(respuesta.status);
  } catch {
    /* Sin red no se puede afirmar nada, y afirmarlo sería mandar a tocar la consola de
       Firebase a quien solo se quedó sin conexión. */
    return false;
  }
}

/** Sube el cribado y devuelve la referencia que se guarda con el estudio. */
export async function subirCribado(archivo, { uid, estudioId, filas = null, hoja = '' }) {
  if (!archivo) throw new Error('No hay archivo que subir.');
  if (archivo.size > TOPE_CRIBADO_BYTES) {
    throw new Error(`El archivo pesa ${Math.round(archivo.size / 1024 / 1024)} MB y el máximo es ` +
      `${Math.round(TOPE_CRIBADO_BYTES / 1024 / 1024)} MB.`);
  }
  const ruta = rutaCribado(uid, estudioId, archivo.name);
  await uploadBytes(ref(getStorage(app), ruta), archivo, {
    contentType: archivo.type || 'application/octet-stream',
    /* El nombre original, con sus acentos y espacios, se conserva aquí: la ruta lleva la
       versión saneada y sin esto no habría forma de decir qué archivo cargó el usuario. */
    customMetadata: { nombreOriginal: String(archivo.name || '') },
  });
  return referenciaCribado({
    ruta, archivo: archivo.name, bytes: archivo.size, filas, hoja, uid,
    ahora: new Date().toISOString(),
  });
}

/**
 * Descarga el cribado como Blob, listo para volver a pasarlo por
 * `importCapitalIQExcel`: su FileReader acepta un Blob igual que un File.
 */
export async function descargarCribado(ruta) {
  if (!ruta) throw new Error('Sin ruta: no hay cribado que descargar.');
  const bytes = await getBytes(ref(getStorage(app), ruta));
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Sube el veredicto de la curación como JSON y devuelve su referencia. */
export async function subirCuracion(veredicto, { uid, estudioId }) {
  const ruta = rutaCuracion(uid, estudioId);
  const cuerpo = new Blob([JSON.stringify(veredicto)], { type: 'application/json' });
  await uploadBytes(ref(getStorage(app), ruta), cuerpo, { contentType: 'application/json' });
  return {
    ruta,
    bytes: cuerpo.size,
    evaluadas: (veredicto && Object.keys(veredicto.porId || {}).length) || 0,
    subidoEn: new Date().toISOString(),
  };
}

/**
 * Borra un cribado anterior. Se usa al reimportar con otro nombre de archivo, que da
 * otra ruta: sin esto cada reimportación dejaría una copia más en Storage, pagada y sin
 * nada que la referencie. No lanza —es limpieza, no parte del guardado— y un objeto que
 * ya no está se trata como éxito.
 */
export async function borrarCribado(ruta) {
  if (!ruta) return false;
  try {
    await deleteObject(ref(getStorage(app), ruta));
    return true;
  } catch (err) {
    if (err && err.code === 'storage/object-not-found') return true;
    console.warn('[cribado] no se pudo borrar el anterior', ruta, err);
    return false;
  }
}

/** Lee el veredicto guardado. Devuelve null si no hay ruta que leer. */
export async function descargarCuracion(ruta) {
  if (!ruta) return null;
  const bytes = await getBytes(ref(getStorage(app), ruta));
  return JSON.parse(new TextDecoder().decode(bytes));
}
