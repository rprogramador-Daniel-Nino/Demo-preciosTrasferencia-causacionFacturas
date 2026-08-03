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

const firebaseConfig = {
  apiKey: 'AIzaSyB3H_D0rsNy8cJrd3N596qsHmzYSqSXTvA',
  authDomain: 'precios-trasnferencia.firebaseapp.com',
  projectId: 'precios-trasnferencia',
  storageBucket: 'precios-trasnferencia.firebasestorage.app',
  messagingSenderId: '503680823868',
  appId: '1:503680823868:web:5e0d75b3c1df3b83918939',
};

/* No hay restricción de dominio: por decisión del usuario entra cualquier cuenta de
   Google. Lo que protege los datos es que cada persona trabaja en su propio espacio
   (`usuarios/{uid}/…`), de modo que quien llegue de fuera ve su base vacía y nunca la de
   otro. */

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

/* Sin `hd`: ese parámetro limitaba el selector de Google a las cuentas del dominio, y
   ahora cualquier cuenta sirve. Se conserva `select_account` para que quien tenga varias
   sesiones abiertas pueda elegir con cuál entra, en vez de que Google decida por él. */
export const proveedorGoogle = new GoogleAuthProvider();
proveedorGoogle.setCustomParameters({ prompt: 'select_account' });
