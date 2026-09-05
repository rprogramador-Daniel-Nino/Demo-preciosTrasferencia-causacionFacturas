/* Sesión con cuenta corporativa de Google.

   La restricción de dominio se aplica en dos sitios, y los dos hacen falta: esta capa
   cierra la sesión de quien entre con un correo fuera de los dominios permitidos, para
   que la aplicación no quede en un estado a medias; y `firestore.rules` es la que de
   verdad impide leer o escribir datos, porque es la que no se puede saltar desde el
   navegador. (El parámetro `hd` del proveedor de Google no se usa: solo admite un
   dominio, y aquí hay dos — ver `firebase.js`.) */

import {
  signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence,
} from 'firebase/auth';
import { auth, proveedorGoogle, esCorreoDeDominioPermitido, DOMINIOS_PERMITIDOS } from './firebase';

export class ErrorDeDominio extends Error {
  constructor(correo) {
    const dominios = DOMINIOS_PERMITIDOS.map((d) => '@' + d).join(' o ');
    super(`La cuenta ${correo || 'indicada'} no pertenece a ${dominios}. ` +
      'Entre con su correo corporativo.');
    this.name = 'ErrorDeDominio';
  }
}

/**
 * Abre el diálogo de Google y valida el dominio. Si el correo no pertenece a los
 * dominios permitidos se cierra la sesión antes de devolver el error: dejarla abierta
 * mostraría la aplicación a alguien que después va a recibir «permiso denegado» en cada
 * lectura, sin entender por qué.
 */
export async function iniciarSesionGoogle() {
  await setPersistence(auth, browserLocalPersistence);
  const credencial = await signInWithPopup(auth, proveedorGoogle);
  const correo = credencial.user && credencial.user.email;
  if (!esCorreoDeDominioPermitido(correo)) {
    await signOut(auth);
    throw new ErrorDeDominio(correo);
  }
  return credencial.user;
}

export function cerrarSesion() {
  return signOut(auth);
}

/**
 * Avisa de los cambios de sesión. Entrega `null` cuando no hay nadie o cuando quien hay
 * no pertenece a los dominios permitidos —caso posible si la sesión quedó guardada de
 * antes de que se restringiera—, y en ese caso además la cierra.
 */
export function observarSesion(alCambiar) {
  return onAuthStateChanged(auth, async (user) => {
    if (user && !esCorreoDeDominioPermitido(user.email)) {
      await signOut(auth);
      alCambiar(null, new ErrorDeDominio(user.email));
      return;
    }
    alCambiar(user || null, null);
  });
}
