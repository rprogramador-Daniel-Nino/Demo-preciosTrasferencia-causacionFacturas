const { test } = require('node:test');
const assert = require('node:assert');
const { peticionAutenticada, tokenDeLaPeticion } = require('./verificarSesion');

test('tokenDeLaPeticion extrae el token del header Bearer', () => {
  const req = { get: (h) => (h === 'authorization' ? 'Bearer abc.def.ghi' : '') };
  assert.strictEqual(tokenDeLaPeticion(req), 'abc.def.ghi');
});

test('tokenDeLaPeticion devuelve vacío sin cabecera, o con otro esquema', () => {
  assert.strictEqual(tokenDeLaPeticion({ get: () => '' }), '');
  assert.strictEqual(tokenDeLaPeticion({ get: (h) => (h === 'authorization' ? 'Basic xyz' : '') }), '');
});

test('acepta cuando el verificador inyectado dice que el token es válido', async () => {
  const req = { get: (h) => (h === 'authorization' ? 'Bearer token-valido' : '') };
  const verificar = async (token) => token === 'token-valido';
  assert.strictEqual(await peticionAutenticada(req, verificar), true);
});

test('rechaza sin token, sin siquiera llamar al verificador', async () => {
  const req = { get: () => '' };
  let llamado = false;
  const resultado = await peticionAutenticada(req, async () => { llamado = true; return true; });
  assert.strictEqual(resultado, false);
  assert.strictEqual(llamado, false);
});

test('rechaza si el verificador lanza (token vencido o inválido)', async () => {
  const req = { get: (h) => (h === 'authorization' ? 'Bearer token-vencido' : '') };
  const verificar = async () => { throw new Error('Firebase ID token has expired'); };
  assert.strictEqual(await peticionAutenticada(req, verificar), false);
});

test('rechaza si el verificador devuelve false (token de otro proyecto)', async () => {
  const req = { get: (h) => (h === 'authorization' ? 'Bearer token-de-otro-proyecto' : '') };
  assert.strictEqual(await peticionAutenticada(req, async () => false), false);
});
