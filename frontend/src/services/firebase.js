/* Conexión con Firebase: una sola instancia para toda la aplicación.
   Antes no había base de datos: los estudios vivían en localStorage, con un tope de
   ~5 MB por navegador que `guardarJSON` absorbía en silencio —solo un console.warn—,
   así que un estudio grande dejaba de persistirse sin que nadie lo notara. Y lo que
   guardaba un consultor no lo veía ninguno de los demás.

   La configuración de abajo NO es secreta. En Firebase Web es pública por diseño:
   viaja en el bundle de cualquier app y lo que protege los datos son las reglas de
   `firestore.rules` —cada persona solo alcanza su propio espacio, `usuarios/{uid}/…`—,
   no el ocultamiento de estas claves. Conviene además restringir la clave por
   dominio HTTP en la consola de Google Cloud, que es la defensa contra su uso desde
   otro sitio. */

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

/* DOS PROYECTOS, UN SOLO BUNDLE (2026-08-20). Además de producción hay un proyecto de
   pruebas, `precios-trasnferencia-pruebas`, con su propio Firestore, su propio Auth y
   sus propias functions, para poder probar sin tocar los estudios reales.

   El proyecto se decide EN TIEMPO DE EJECUCIÓN por el dominio, no en tiempo de build.
   La alternativa —variables de Vite y `vite build --mode pruebas`— obligaba a compilar
   dos veces al mismo `public/gestor-reportes`, que está trackeado en git: el bundle de
   pruebas sobrescribía el de producción y quedaba a un `git commit` de distancia de
   publicarse en producción apuntando a la base de pruebas. Resolviéndolo por dominio,
   el artefacto que se prueba es exactamente el que se despliega, `npm run build` sigue
   siendo uno solo y `firebase.json` no se duplica.

   Las llamadas al backend (`/api/claude`, `/api/gemini`, …) son todas relativas, así que
   no necesitan nada de esto: en el dominio de pruebas las resuelven los rewrites de ese
   proyecto contra sus propias functions. */

const CONFIG_PRODUCCION = {
  apiKey: 'AIzaSyB3H_D0rsNy8cJrd3N596qsHmzYSqSXTvA',
  authDomain: 'precios-trasnferencia.firebaseapp.com',
  projectId: 'precios-trasnferencia',
  storageBucket: 'precios-trasnferencia.firebasestorage.app',
  messagingSenderId: '503680823868',
  appId: '1:503680823868:web:5e0d75b3c1df3b83918939',
};

const CONFIG_PRUEBAS = {
  apiKey: 'AIzaSyAPoeZlHwiiyxEVNOBAk-EtbRxvXaCwckg',
  authDomain: 'precios-trasnferencia-pruebas.firebaseapp.com',
  projectId: 'precios-trasnferencia-pruebas',
  storageBucket: 'precios-trasnferencia-pruebas.firebasestorage.app',
  messagingSenderId: '671814198562',
  appId: '1:671814198562:web:276fb30fe49c8590bd717b',
};

const HOSTS_DE_PRUEBAS = new Set([
  'precios-trasnferencia-pruebas.web.app',
  'precios-trasnferencia-pruebas.firebaseapp.com',
]);

const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]']);

/* Solo para desarrollo local: permite apuntar el `npm run dev` a la base de pruebas sin
   recompilar, con `localStorage.setItem('pt:entorno-firebase', 'pruebas')` en la consola
   del navegador. Deliberadamente NO se consulta en los dominios reales: ahí manda el
   dominio y nada más, para que un valor olvidado en el navegador de alguien no pueda
   hacer que la aplicación de producción escriba en pruebas ni al contrario. */
const CLAVE_ENTORNO_LOCAL = 'pt:entorno-firebase';

function resolverEntorno() {
  const host = typeof window === 'undefined' ? '' : window.location.hostname;
  if (HOSTS_DE_PRUEBAS.has(host)) return 'pruebas';
  if (HOSTS_LOCALES.has(host)) {
    let elegido = null;
    try {
      elegido = window.localStorage.getItem(CLAVE_ENTORNO_LOCAL);
    } catch {
      /* localStorage puede estar bloqueado por la configuración del navegador; en ese
         caso simplemente no hay override y se cae al valor por defecto. */
    }
    if (elegido === 'pruebas') return 'pruebas';
  }
  return 'produccion';
}

export const entornoFirebase = resolverEntorno();

const firebaseConfig = entornoFirebase === 'pruebas' ? CONFIG_PRUEBAS : CONFIG_PRODUCCION;

/* Un aviso en consola, no en la interfaz: al depurar hay que poder distinguir de un
   vistazo si lo que se está viendo salió de la base real o de la de pruebas. */
if (entornoFirebase !== 'produccion') {
  console.info(`[Sistema PT] Firebase apuntando al proyecto de ${entornoFirebase}: ${firebaseConfig.projectId}`);
}

/* No hay restricción de dominio: por decisión del usuario entra cualquier cuenta de
   Google. Lo que protege los datos es que cada persona trabaja en su propio espacio
   (`usuarios/{uid}/…`), de modo que quien llegue de fuera ve su base vacía y nunca la de
   otro. */

/* El projectId del entorno activo. Lo necesita quien tenga que construir la URL de una
   Cloud Function a mano, porque no toda llamada puede ir por los rewrites de Hosting: ver
   URL_ANALISIS_SECTOR en ReporteGenerador. */
export const projectIdFirebase = firebaseConfig.projectId;

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

/* Sin `hd`: ese parámetro limitaba el selector de Google a las cuentas del dominio, y
   ahora cualquier cuenta sirve. Se conserva `select_account` para que quien tenga varias
   sesiones abiertas pueda elegir con cuál entra, en vez de que Google decida por él. */
export const proveedorGoogle = new GoogleAuthProvider();
proveedorGoogle.setCustomParameters({ prompt: 'select_account' });
