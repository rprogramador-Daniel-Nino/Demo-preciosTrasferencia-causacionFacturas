// functions/firebaseAdmin.js
const { initializeApp, getApps } = require('firebase-admin/app');

/** Asegura que exista la app POR DEFECTO de Firebase Admin. `!getApps().length` NO basta:
 *  `verificarSesion.js` (functions/verificarSesion.js) ya crea una app NOMBRADA
 *  ('auth-<proyecto>') en cada petición HTTP autenticada, y eso corre ANTES de que
 *  `analisisSectorActualizar.js`/`analisisMercadoActualizar.js` requieran este módulo — con
 *  `getApps().length` esa app nombrada ya cuenta como "alguna existe", así que el guardia se
 *  saltaba la creación de la POR DEFECTO. `getFirestore()`/`getApp()` (sin nombre) buscan
 *  específicamente la app `'[DEFAULT]'`, así que seguían explotando con "The default Firebase
 *  app does not exist" aunque SÍ hubiera una app Admin inicializada, solo que con otro nombre.
 *  Bug real en producción, confirmado en vivo el 2026-09-10 contra `generarAnalisisSector`. */
function asegurarAppFirebasePorDefecto() {
  if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp();
}

module.exports = { asegurarAppFirebasePorDefecto };
