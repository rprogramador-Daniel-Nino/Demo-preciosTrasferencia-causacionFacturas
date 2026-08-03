/* Sesión con cuenta de Google.

   Entra cualquier cuenta de Google, por decisión del usuario. Antes se exigía el dominio
   corporativo en tres capas; ahora lo que protege los datos es el aislamiento por
   usuario: cada quien trabaja bajo `usuarios/{uid}/…` y `firestore.rules` compara ese
   uid con el de quien pide, así que alguien de fuera aterriza en su propia base vacía y
   no puede leer ni escribir la de otro.

   Lo que sigue exigiéndose del lado del servidor es que el correo esté verificado, que
   es lo que impide reclamar una dirección ajena. */

import {
  signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence,
} from 'firebase/auth';
import { auth, proveedorGoogle } from './firebase';

/** Abre el diálogo de Google y devuelve la cuenta con la que se entró. */
export async function iniciarSesionGoogle() {
  await setPersistence(auth, browserLocalPersistence);
  const credencial = await signInWithPopup(auth, proveedorGoogle);
  return credencial.user;
}

export function cerrarSesion() {
  return signOut(auth);
}

/** Avisa de los cambios de sesión. Entrega `null` cuando no hay nadie. */
export function observarSesion(alCambiar) {
  return onAuthStateChanged(auth, (user) => alCambiar(user || null, null));
}
