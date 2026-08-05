/**
 * La plantilla del informe, su marcado y los recursos del cliente, guardados con el
 * estudio en Cloud Storage.
 *
 * De esto depende el formato del Word más que de cualquier otra cosa: el generador
 * renderiza sobre la plantilla marcada si la encuentra, sobre la plantilla sin marcar si
 * solo hay eso, y si no hay nada cae a la plantilla maestra incrustada en el código. Y
 * todo ello vivía únicamente en IndexedDB, es decir en un solo navegador. El resultado
 * era que dos personas con el mismo estudio descargaban documentos con formatos
 * distintos, y la misma persona los perdía al cambiar de equipo, sin ningún aviso.
 *
 * Aquí se sube una copia y se restaura en IndexedDB al abrir el estudio en otra parte, de
 * modo que el resto del generador sigue leyendo de donde siempre.
 *
 * No cabía en Firestore: el HTML de una plantilla real y las imágenes en data URL suman
 * varios megas y un documento admite algo más de un millón de bytes.
 *
 * Límite conocido: el aislamiento de Storage es por usuario y sus reglas no pueden
 * consultar Firestore, así que esto cubre los equipos de una misma persona. Un estudio
 * compartido no arrastra la plantilla de su dueño; quien lo reciba tiene que subirla.
 */
import { getBytes, getStorage, ref, uploadBytes } from 'firebase/storage';
import { app } from './firebase.js';
import { rutaPlantilla } from './cribadoModelo.js';
import { paqueteDePlantilla, paqueteUtil } from './plantillaNubeModelo.js';
import {
  guardarPlantilla, guardarMarcado, guardarHuecos, guardarVinculo, guardarRecursos,
} from './plantillaStore.js';

export { VERSION_PAQUETE, paqueteDePlantilla, paqueteUtil } from './plantillaNubeModelo.js';

/** Sube la copia. Devuelve la referencia que se anota en el estudio. */
export async function subirPlantillaDelEstudio({ uid, estudioId, plantillaId, html, marcado, huecos, recursos }) {
  const paquete = paqueteDePlantilla({
    plantillaId, html, marcado, huecos, recursos, ahora: new Date().toISOString(),
  });
  if (!paqueteUtil(paquete)) throw new Error('No hay plantilla que subir.');
  const ruta = rutaPlantilla(uid, estudioId);
  const cuerpo = new Blob([JSON.stringify(paquete)], { type: 'application/json' });
  await uploadBytes(ref(getStorage(app), ruta), cuerpo, { contentType: 'application/json' });
  return {
    ruta,
    plantillaId: paquete.plantillaId,
    marcada: !!paquete.marcado,
    huecos: paquete.huecos,
    recursos: paquete.recursos.length,
    bytes: cuerpo.size,
    subidoEn: paquete.subidoEn,
  };
}

/** Lee la copia guardada. Devuelve null si no hay ninguna, que es lo normal. */
export async function descargarPlantillaDelEstudio({ uid, estudioId }) {
  const ruta = rutaPlantilla(uid, estudioId);
  try {
    const bytes = await getBytes(ref(getStorage(app), ruta));
    const paquete = JSON.parse(new TextDecoder().decode(bytes));
    return paqueteUtil(paquete) ? paquete : null;
  } catch (err) {
    /* Que no haya copia es el caso corriente —la mayoría de estudios nunca subieron
       plantilla—, así que no es un error que merezca contarse a nadie. */
    if (err && err.code === 'storage/object-not-found') return null;
    throw err;
  }
}

/**
 * Deja el paquete en IndexedDB, tal como lo espera el resto del generador.
 *
 * Se restaura en el almacén local en lugar de enseñárselo directamente al componente para
 * que el flujo siga siendo uno: leer de IndexedDB. Así el marcado, los huecos y el vínculo
 * quedan disponibles también para las demás pantallas y para la próxima recarga, sin
 * volver a descargar.
 */
export async function restaurarPlantillaEnLocal(estudioId, paquete) {
  if (!paqueteUtil(paquete)) return false;
  const { plantillaId, html, marcado, huecos, recursos } = paquete;
  if (html) await guardarPlantilla(plantillaId, html);
  if (marcado) await guardarMarcado(plantillaId, marcado);
  await guardarHuecos(plantillaId, huecos);
  if (recursos && recursos.length) await guardarRecursos(estudioId, recursos);
  /* El vínculo va al final: es lo que el generador consulta para saber que hay plantilla,
     así que hasta que exista, un fallo a mitad deja el estudio como estaba y no con una
     plantilla a medio restaurar. */
  await guardarVinculo(estudioId, plantillaId);
  return true;
}
