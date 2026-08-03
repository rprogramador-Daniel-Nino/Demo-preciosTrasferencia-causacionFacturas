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
