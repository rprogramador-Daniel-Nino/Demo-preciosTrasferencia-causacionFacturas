/* Sesión con cuenta corporativa de Google.

   La restricción de dominio se aplica en tres sitios, y los tres hacen falta:
   `hd` en el proveedor solo filtra lo que Google muestra en el selector; esta capa
   cierra la sesión de quien entre con otro dominio, para que la aplicación no quede
   en un estado a medias; y `firestore.rules` es la única que de verdad impide leer o
   escribir datos, porque es la que no se puede saltar desde el navegador. */

import {
  signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence,
} from 'firebase/auth';
import { auth, proveedorGoogle, esCorreoDelDominio, DOMINIO } from './firebase';

export class ErrorDeDominio extends Error {
  constructor(correo) {
    super(`La cuenta ${correo || 'indicada'} no pertenece a @${DOMINIO}. ` +
      'Entre con su correo corporativo.');
    this.name = 'ErrorDeDominio';
  }
}

/**
 * Abre el diálogo de Google y valida el dominio. Si el correo es de otro dominio se
 * cierra la sesión antes de devolver el error: dejarla abierta mostraría la aplicación
 * a alguien que después va a recibir «permiso denegado» en cada lectura, sin entender
 * por qué.
 */
export async function iniciarSesionGoogle() {
  await setPersistence(auth, browserLocalPersistence);
  const credencial = await signInWithPopup(auth, proveedorGoogle);
  const correo = credencial.user && credencial.user.email;
  if (!esCorreoDelDominio(correo)) {
    await signOut(auth);
    throw new ErrorDeDominio(correo);
  }
  return credencial.user;
}

export function cerrarSesion() {
  return signOut(auth);
}

/**
 * Avisa de los cambios de sesión. Entrega `null` cuando no hay nadie o cuando quien
 * hay no es del dominio —caso posible si la sesión quedó guardada de antes de que se
 * restringiera—, y en ese caso además la cierra.
 */
export function observarSesion(alCambiar) {
  return onAuthStateChanged(auth, async (user) => {
    if (user && !esCorreoDelDominio(user.email)) {
      await signOut(auth);
      alCambiar(null, new ErrorDeDominio(user.email));
      return;
    }
    alCambiar(user || null, null);
  });
}
