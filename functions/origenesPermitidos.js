'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
   origenesPermitidos.js — Filtra quién puede llamar a /api/claude y /api/gemini.

   POR QUÉ EXISTE. `claude` y `gemini` (functions/index.js) y sus equivalentes en
   `server.js` son funciones HTTP públicas: `cors: true`, sin App Check, sin
   verificación de sesión. Antes de esto, cualquiera que descubriera la URL de la
   Cloud Function (`https://us-central1-<proyecto>.cloudfunctions.net/claude`) podía
   pegarle directo y gastar la cuota de Anthropic/Gemini del proyecto sin pasar por
   el Hosting ni por la app. Este archivo es la primera barrera —barata y sin
   dependencias nuevas— mientras no se integre Firebase App Check, que es la
   protección real contra un llamador que sabe falsificar cabeceras.

   QUÉ NO HACE. Un cliente que arma su petición a mano (curl, script) puede poner
   cualquier `Origin`/`Referer` que quiera: esto no autentica, solo descarta el caso
   más común —un bot o scanner que golpea la URL sin cabeceras de navegador, o con
   las de otro sitio—. Se combina con `limitadorTasa.js` para acotar el daño de
   quien sí falsifica la cabecera.

   ES LÓGICA PURA (sin red, sin Firebase) para que `server.js` y
   `functions/index.js` compartan una sola lista en vez de divergir, mismo patrón
   que `fallbackGemini.js`. La versión PHP de cPanel sigue siendo un port a mano.
   ───────────────────────────────────────────────────────────────────────────── */

/* *.web.app y *.firebaseapp.com: dominios que Firebase Hosting asigna a cada
   proyecto. Si el Hosting tiene dominio propio conectado, agrégalo aquí también —
   si no, las peticiones que sí vienen del dominio real quedan bloqueadas. */
const ORIGENES_PERMITIDOS = [
  'https://precios-trasnferencia.web.app',
  'https://precios-trasnferencia.firebaseapp.com',
  'https://precios-trasnferencia-pruebas.web.app',
  'https://precios-trasnferencia-pruebas.firebaseapp.com',
  /* Desarrollo local: server.js sirve el mismo front en localhost. */
  'http://localhost:3000',
];

/** true si `origen` (el valor crudo de la cabecera Origin o Referer) es uno de
 *  los dominios propios. Referer trae ruta detrás del origen (p. ej.
 *  "https://precios-trasnferencia.web.app/gestor-reportes/"), por eso compara
 *  con `startsWith(base + '/')` además de la igualdad exacta. */
function origenPermitido(origen) {
  if (!origen) return false;
  return ORIGENES_PERMITIDOS.some((base) => origen === base || origen.startsWith(base + '/'));
}

/** true si la petición trae un Origin o un Referer reconocido. Sin ninguna de
 *  las dos cabeceras, se rechaza: una petición de navegador a un POST siempre
 *  manda al menos una. */
function peticionDeOrigenPermitido(req) {
  const origen = (req.get ? req.get('origin') : (req.headers && req.headers.origin)) || '';
  const referer = (req.get ? req.get('referer') : (req.headers && req.headers.referer)) || '';
  return origenPermitido(origen) || origenPermitido(referer);
}

module.exports = { ORIGENES_PERMITIDOS, origenPermitido, peticionDeOrigenPermitido };
