/* ─────────────────────────────────────────────────────────────────────────────
   recorteEeff.js — el pegamento entre el recorte de imágenes y el almacén del ANEXO B.

   Vive aparte de `recorteImagen.js` a propósito: ese módulo es puro más una envoltura de
   `canvas`, y su archivo de pruebas se carga en Node. Aquí se toca IndexedDB, que en Node
   no existe.

   PARA QUÉ. Los estudios que ya tienen los estados financieros de sus comparables
   cargados los guardaron como HOJA COMPLETA, antes de que existiera el recorte. Volver a
   subir cada documento no es opción —son trece por informe y el archivo original ya no
   está en memoria del navegador—, así que el recorte se hace al abrir el estudio y queda
   guardado.

   NO SE LLEVA CUENTA DE QUÉ SE RECORTÓ YA. `recortarDataUrl` es idempotente —deja
   margen blanco alrededor, así que en la segunda pasada no encuentra nada que quitar— y
   además, si no recorta, no vuelve a codificar la imagen ni se guarda nada. Se descartó
   el atajo de saltarse las imágenes cuya proporción no fuera de hoja: dejaba sin migrar
   las páginas apaisadas, que son precisamente hojas completas.
   ───────────────────────────────────────────────────────────────────────────── */

import { leerAnexoBImagenes, guardarAnexoBImagenes } from './plantillaStore.js';
import { recortarDataUrl } from './recorteImagen.js';

/**
 * Lee las imágenes del ANEXO B de un estudio, recorta las que sigan siendo hojas
 * completas y guarda el resultado si algo cambió.
 *
 * Nunca lanza: ante cualquier fallo se devuelve lo que se haya podido leer —o un mapa
 * vacío—, igual que hacía el `catch` de la lectura directa en `App.jsx`. El informe con
 * las páginas sin recortar es el comportamiento anterior; sin páginas, no.
 *
 * @param {string} estudioId
 * @returns {Promise<Object<string, string[]>>} el mapa por comparable, ya recortado.
 */
export async function recortarImagenesGuardadas(estudioId) {
  let mapa;
  try {
    mapa = await leerAnexoBImagenes(estudioId);
  } catch (err) {
    console.error('[anexo B] no se pudieron leer las imágenes guardadas', err);
    return {};
  }
  if (!mapa || typeof mapa !== 'object') return {};

  const salida = {};
  let cambio = false;
  for (const [clave, paginas] of Object.entries(mapa)) {
    if (!Array.isArray(paginas)) { salida[clave] = paginas; continue; }
    salida[clave] = await Promise.all(paginas.map(async (pagina) => {
      if (typeof pagina !== 'string') return pagina;
      const recortada = await recortarDataUrl(pagina);
      if (recortada !== pagina) cambio = true;
      return recortada;
    }));
  }

  if (cambio) {
    try {
      await guardarAnexoBImagenes(estudioId, salida);
    } catch (err) {
      /* Que no se pueda persistir no invalida el recorte: el informe de esta sesión ya
         sale bien, y la próxima apertura lo volverá a intentar. */
      console.error('[anexo B] no se pudo guardar el recorte de las imágenes', err);
    }
  }
  return salida;
}
