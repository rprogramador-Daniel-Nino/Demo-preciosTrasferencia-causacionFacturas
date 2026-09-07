/* axiosAutenticado.js — Adjunta el ID token de Firebase Auth a toda llamada al proxy
   propio, para que /api/claude, /api/gemini, /api/extraer-rut, /api/extraer-camara y
   generarAnalisisSector (ver functions/verificarSesion.js) puedan exigir sesión del
   lado del servidor.

   POR QUÉ AQUÍ Y NO EN CADA LLAMADA. Hay más de diez sitios que llaman a estas rutas
   con `axios.post(...)` directo —servicios y componentes—. Registrar un interceptor
   una sola vez, importado por su efecto secundario en main.jsx, cubre todos sin
   tocarlos uno por uno ni arriesgarse a que un sitio nuevo se cree sin la cabecera.

   POR QUÉ TAMBIÉN *.cloudfunctions.net. `generarAnalisisSector` no pasa por el rewrite
   de Hosting —ver el comentario junto a `URL_ANALISIS_SECTOR` en
   ReporteGenerador.jsx—, así que su URL es absoluta y no empieza por "/api/". */
import axios from 'axios';
import { auth } from './firebase';

function esLlamadaAlBackendPropio(url) {
  if (!url) return false;
  return url.startsWith('/api/') || url.includes('.cloudfunctions.net/');
}

axios.interceptors.request.use(async (config) => {
  if (esLlamadaAlBackendPropio(config.url) && auth.currentUser) {
    const token = await auth.currentUser.getIdToken();
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
