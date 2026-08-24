/* Persistencia de la plantilla marcada y de los recursos del cliente.
   Va en IndexedDB y no en localStorage: el tope de localStorage ronda los
   5 MB por origen y ya lo ocupan los estudios (pt:study:*), el anexo del PDF
   de referencia pesa 5.25 MB en base64, y setItem no falla limpio — lanza
   QuotaExceededError a mitad de la escritura y puede dejar el estudio a
   medias. */

const BASE = 'pt-plantillas';
const VERSION = 1;
/* Al agregar un almacén aquí hay que subir VERSION: si no, onupgradeneeded no
   se dispara para quien ya tenga la base creada, el almacén nuevo no existe, y
   la transacción falla con un NotFoundError cuyo mensaje no delata la causa. */
const ALMACENES = ['plantillas', 'recursos', 'anexos'];

/* Los ids se escapan porque un ':' dentro de uno haría colisionar dos claves
   distintas: 'a:b' + 'c' y 'a' + 'b:c'. */
const esc = (s) => String(s).replace(/%/g, '%25').replace(/:/g, '%3A');

/* Identifica una plantilla por el contenido del PDF del que salió, no por el
   estudio: la plantilla es muy parecida entre clientes, así que dos estudios
   que carguen el mismo documento comparten el marcado y no se vuelve a pagar. */
export async function hashPlantilla(datos) {
  const buf = await crypto.subtle.digest('SHA-256', datos);
  return [...new Uint8Array(buf)].slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

function abrir() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(BASE, VERSION);
    req.onupgradeneeded = () => {
      for (const nombre of ALMACENES) {
        if (!req.result.objectStoreNames.contains(nombre)) req.result.createObjectStore(nombre);
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

/* Cada operación abre y cierra su propia conexión. Dejarlas abiertas parece
   inofensivo, pero bloquea cualquier futuro `open` con versión mayor: el
   evento `blocked` no resuelve ni rechaza, así que subir el esquema colgaría
   la aplicación en silencio. */
async function operar(almacen, modo, fn) {
  const db = await abrir();
  try {
    return await new Promise((res, rej) => {
      const tx = db.transaction(almacen, modo);
      const req = fn(tx.objectStore(almacen));
      tx.oncomplete = () => res(req ? req.result : undefined);
      tx.onerror = () => rej(tx.error);
    });
  } finally {
    db.close();
  }
}

export const guardarRecursos = (estudioId, imagenes) =>
  operar('recursos', 'readwrite', (s) => s.put(imagenes, esc(estudioId)));

export const leerRecursos = (estudioId) =>
  operar('recursos', 'readonly', (s) => s.get(esc(estudioId))).then((r) => r || []);

export const borrarRecursos = (estudioId) =>
  operar('recursos', 'readwrite', (s) => s.delete(esc(estudioId)));

export const guardarPlantilla = (plantillaId, html) =>
  operar('plantillas', 'readwrite', (s) => s.put(html, plantillaId));

export const leerPlantilla = (plantillaId) =>
  operar('plantillas', 'readonly', (s) => s.get(plantillaId)).then((r) => r || null);

/* Páginas del PDF de estados financieros de la parte examinada, rasterizadas a PNG
   para el ANEXO A. Van en el almacén `anexos`, que ya estaba declarado en el esquema
   y sin usar.

   No pueden ir en el documento del estudio: son data URLs de varias páginas y un caso
   real pesó 3,4 MB, más del triple del máximo de 1 MiB que admite un documento de
   Firestore, así que el estudio entero dejaba de guardarse. Tampoco caben en
   localStorage, cuyo tope ronda los 5 MB para todo el origen. */
export const guardarAnexoEeff = (estudioId, imagenes) =>
  operar('anexos', 'readwrite', (s) => s.put(imagenes, esc(estudioId)));

export const leerAnexoEeff = (estudioId) =>
  operar('anexos', 'readonly', (s) => s.get(esc(estudioId))).then((r) => r || []);

export const borrarAnexoEeff = (estudioId) =>
  operar('anexos', 'readwrite', (s) => s.delete(esc(estudioId)));

/* Imágenes del EEFF de cada comparable para el ANEXO B, mismo almacén y mismo motivo de
   tamaño que el ANEXO A (`guardarAnexoEeff`): son data URLs, no caben en Firestore ni en
   localStorage. A diferencia del ANEXO A —un solo arreglo por estudio, un solo EEFF del
   contribuyente— aquí hay una comparable por fila, así que el valor es un mapa
   `{ [nameKey]: string[] }` en vez de un arreglo plano. Clave distinta (":cmpB") para no
   colisionar con la del ANEXO A del mismo estudio. */
export const guardarAnexoBImagenes = (estudioId, mapaPorComparable) =>
  operar('anexos', 'readwrite', (s) => s.put(mapaPorComparable, esc(estudioId) + ':cmpB'));

export const leerAnexoBImagenes = (estudioId) =>
  operar('anexos', 'readonly', (s) => s.get(esc(estudioId) + ':cmpB')).then((r) => r || {});

export const borrarAnexoBImagenes = (estudioId) =>
  operar('anexos', 'readwrite', (s) => s.delete(esc(estudioId) + ':cmpB'));

/* Páginas con las que el analista REEMPLAZA las de un anexo escaneado que no es el del
   contribuyente —el contrato de distribución, un certificado—. El extractor conserva las del
   informe de referencia, que sirven mientras el documento no cambie; cuando cambia, éstas las
   pisan.

   Mismo almacén y mismo motivo de tamaño que las dos de arriba: son data URLs de varias
   páginas y no caben ni en Firestore ni en localStorage. El valor es un mapa
   `{ [claveDeAnexo]: string[] }` y la clave es el NOMBRE normalizado del anexo, no su letra:
   la letra es de cada plantilla y cambia entre clientes, el nombre es lo que se conserva.
   Clave distinta (":escan") para no colisionar con las de los otros dos anexos. */
export const guardarAnexosEscaneados = (estudioId, mapaPorAnexo) =>
  operar('anexos', 'readwrite', (s) => s.put(mapaPorAnexo, esc(estudioId) + ':escan'));

export const leerAnexosEscaneados = (estudioId) =>
  operar('anexos', 'readonly', (s) => s.get(esc(estudioId) + ':escan')).then((r) => r || {});

export const borrarAnexosEscaneados = (estudioId) =>
  operar('anexos', 'readwrite', (s) => s.delete(esc(estudioId) + ':escan'));

/* Vínculo estudio -> plantilla. Sin esto, al recargar no hay forma de saber qué
   plantilla corresponde al estudio abierto, y la vista previa vuelve a la
   maestra genérica: las imágenes guardadas se quedan sin sitio donde ir.
   Se guarda en el almacén de plantillas con un prefijo, en vez de crear un
   almacén nuevo, para no subir VERSION del esquema. */
export const guardarVinculo = (estudioId, plantillaId) =>
  guardarPlantilla('vinculo:' + esc(estudioId), plantillaId);

export const leerVinculo = (estudioId) => leerPlantilla('vinculo:' + esc(estudioId));

/* HTML ya marcado con <span data-campo="...">. Va con prefijo dentro del
   almacén de plantillas, igual que el vínculo, para no subir VERSION del
   esquema. Se guarda por plantilla y no por estudio: el marcado se paga una
   vez y dos estudios que carguen el mismo PDF lo comparten.
   La derivación de la clave se exporta aparte porque es lo único de esto que
   se puede probar sin navegador. */
export const claveMarcado = (plantillaId) => 'marcado:' + plantillaId;

export const guardarMarcado = (plantillaId, html) =>
  guardarPlantilla(claveMarcado(plantillaId), html);

export const leerMarcado = (plantillaId) => leerPlantilla(claveMarcado(plantillaId));

/* Descarta el marcado de una plantilla para poder volver a marcarla.
   Hacía falta una salida: el marcado se guarda por hash del PDF, así que volver a
   subir el mismo documento encontraba el marcado viejo y no se podía repetir. Si
   el marcado salió incompleto —tramos caídos, o el modelo dejó apariciones sin
   marcar— la única alternativa era revisar cien páginas a mano. */
export const borrarMarcado = (plantillaId) =>
  operar('plantillas', 'readwrite', (s) => s.delete(claveMarcado(plantillaId)));

/* El .docx original del cliente, tal cual lo subió.
   Es la pieza de la ruta que rellena el documento en vez de reconstruirlo: como el
   informe se produce editando su propio OOXML, hay que conservar el archivo y no
   una conversión suya. Se guarda el binario (IndexedDB admite Blob y ArrayBuffer
   sin serializar) y, como el marcado, va por plantilla y no por estudio: el
   `plantillaId` es el hash del contenido, así que dos estudios que suban el mismo
   Word comparten archivo y marcado.
   Con prefijo en el almacén de plantillas, igual que el resto, para no subir
   VERSION del esquema. */
export const claveDocx = (plantillaId) => 'docx:' + plantillaId;

export const guardarDocx = (plantillaId, binario) =>
  guardarPlantilla(claveDocx(plantillaId), binario);

export const leerDocx = (plantillaId) => leerPlantilla(claveDocx(plantillaId));

/* El OOXML ya marcado con {campo}. Se guarda aparte del original para poder volver
   a marcar sin pedirle al usuario que suba otra vez el archivo. */
export const claveDocxMarcado = (plantillaId) => 'docx-marcado:' + plantillaId;

export const guardarDocxMarcado = (plantillaId, binario) =>
  guardarPlantilla(claveDocxMarcado(plantillaId), binario);

export const leerDocxMarcado = (plantillaId) => leerPlantilla(claveDocxMarcado(plantillaId));

export const borrarDocxMarcado = (plantillaId) =>
  operar('plantillas', 'readwrite', (s) => s.delete(claveDocxMarcado(plantillaId)));

/* Cuántos huecos de anexo dejó el extractor en esta plantilla. Sin conservarla
   no hay forma de saber, al recargar el estudio, que el documento tiene 16
   páginas de anexo sin rellenar: `ref.huecos` solo existe en el momento de
   subir el PDF, y la guarda del anexo se quedaba sin nada que mirar.
   Va con prefijo en el almacén de plantillas, igual que el vínculo y el
   marcado, para no subir VERSION del esquema. */
export const claveHuecos = (plantillaId) => 'huecos:' + plantillaId;

export const guardarHuecos = (plantillaId, cuantos) =>
  guardarPlantilla(claveHuecos(plantillaId), Number(cuantos) || 0);

/* Devuelve 0 y no null cuando no hay nada guardado: una plantilla anterior a
   este cambio, o un .docx sin huecos, no debe disparar el aviso del anexo. */
export const leerHuecos = (plantillaId) =>
  leerPlantilla(claveHuecos(plantillaId)).then((v) => Number(v) || 0);

export const borrarVinculo = (estudioId) =>
  operar('plantillas', 'readwrite', (s) => s.delete('vinculo:' + esc(estudioId)));

/**
 * Borra todo lo que este estudio tenía guardado en el navegador: las imágenes de su
 * plantilla, las páginas de su ANEXO A y su vínculo con la plantilla.
 *
 * La plantilla en sí NO se borra, y es a propósito: su clave es el hash del contenido
 * del PDF, así que la comparten todos los estudios que subieron el mismo documento.
 * Borrarla al eliminar un estudio dejaría a los demás sin plantilla.
 *
 * Por el mismo motivo tampoco se borran su marcado (`marcado:`) ni su cuenta de huecos
 * (`huecos:`): las dos van por plantilla, no por estudio, así que borrarlas obligaría a
 * volver a pagar el marcado por IA a todos los demás estudios que usan ese PDF.
 *
 * Cada borrado va por separado y los fallos no se propagan: el estudio ya se eliminó
 * de la base, y dejar un recurso suelto es menos grave que romper la operación a
 * medias.
 */
export async function borrarRecursosDelEstudio(estudioId) {
  const resultados = await Promise.allSettled([
    borrarRecursos(estudioId),
    borrarAnexoEeff(estudioId),
    borrarAnexoBImagenes(estudioId),
    borrarVinculo(estudioId),
  ]);
  const fallidos = resultados.filter((r) => r.status === 'rejected');
  if (fallidos.length) {
    console.warn('[plantillaStore] no se pudo limpiar todo del estudio ' + estudioId,
      fallidos.map((f) => f.reason));
  }
  return { borrados: resultados.length - fallidos.length, fallidos: fallidos.length };
}
