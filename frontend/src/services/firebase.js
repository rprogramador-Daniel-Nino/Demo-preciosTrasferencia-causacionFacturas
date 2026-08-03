/* Conexión con Firebase: una sola instancia para toda la aplicación.
   Antes no había base de datos: los estudios vivían en localStorage, con un tope de
   ~5 MB por navegador que `guardarJSON` absorbía en silencio —solo un console.warn—,
   así que un estudio grande dejaba de persistirse sin que nadie lo notara. Y lo que
   guardaba un consultor no lo veía ninguno de los demás.

   La configuración de abajo NO es secreta. En Firebase Web es pública por diseño:
   viaja en el bundle de cualquier app y lo que protege los datos son las reglas de
   `firestore.rules` (solo cuentas @crconsultorescolombia.com con correo verificado),
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

/** Dominio corporativo. Las reglas de Firestore exigen lo mismo del lado del
    servidor: esta constante solo evita el viaje inútil y da un mensaje claro. */
export const DOMINIO = 'crconsultorescolombia.com';

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

/* `hd` le pide a Google que muestre solo cuentas del dominio en el selector. Es
   comodidad, no seguridad: la restricción de verdad está en las reglas y se vuelve a
   comprobar al recibir la sesión. */
export const proveedorGoogle = new GoogleAuthProvider();
proveedorGoogle.setCustomParameters({ hd: DOMINIO, prompt: 'select_account' });

/** ¿El correo pertenece al dominio corporativo? */
export function esCorreoDelDominio(correo) {
  return typeof correo === 'string' &&
    correo.trim().toLowerCase().endsWith('@' + DOMINIO);
}
