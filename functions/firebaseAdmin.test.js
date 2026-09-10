const test = require('node:test');
const assert = require('node:assert');
const { getApps, getApp, deleteApp } = require('firebase-admin/app');
const { asegurarAppFirebasePorDefecto } = require('./firebaseAdmin');

/** Ninguna app sobrevive entre pruebas: el SDK guarda su registro en un módulo compartido
 *  por proceso, así que una app que quedó de una prueba anterior falsearía la siguiente. */
async function limpiarApps() {
  await Promise.all(getApps().map((a) => deleteApp(a)));
}

test('asegurarAppFirebasePorDefecto crea la app por defecto aunque ya exista una app NOMBRADA (bug real: verificarSesion.js crea una antes)', async () => {
  await limpiarApps();
  /* Reproduce el orden real de una petición HTTP autenticada: verificarSesion.js
     (`appParaProyecto`) crea su app nombrada ANTES de que analisisSectorActualizar.js
     requiera este módulo. */
  const { initializeApp } = require('firebase-admin/app');
  initializeApp({ projectId: 'test-project' }, 'auth-test-project');
  assert.equal(getApps().length, 1, 'solo la app nombrada existe todavía');

  asegurarAppFirebasePorDefecto();

  assert.ok(getApps().some((a) => a.name === '[DEFAULT]'), 'debe existir la app por defecto');
  assert.doesNotThrow(() => getApp(), 'getApp()/getFirestore() sin nombre ya no deben lanzar');

  await limpiarApps();
});

test('asegurarAppFirebasePorDefecto no falla si se llama dos veces (la por defecto ya existe)', async () => {
  await limpiarApps();
  asegurarAppFirebasePorDefecto();
  assert.doesNotThrow(() => asegurarAppFirebasePorDefecto());
  await limpiarApps();
});
