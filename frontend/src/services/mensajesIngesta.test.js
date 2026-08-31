/* Qué se le dice al analista cuando una lectura con IA no devuelve lo que se esperaba.

   POR QUÉ ESTO ES LÓGICA Y NO PINTURA. El defecto que motiva estas pruebas se vio en pruebas
   el 2026-08-31: se cargó un DICTAMEN de revisor fiscal en la casilla del certificado de
   composición accionaria. El modelo lo leyó bien y devolvió `accionistas: []` —correcto, un
   dictamen no lista accionistas—, no hubo excepción, y `handleAccionistasUpload` solo cambiaba
   el mensaje en dos ramas: éxito CON datos, o error. La tercera —«leyó y no encontró nada»— no
   existía, así que en pantalla quedaba «🤖 Leyendo Certificado…» indefinidamente. Para quien
   mira, eso es un cuelgue.

   Decidir qué mensaje corresponde a cada resultado es una decisión, no un estilo, y por eso
   vive en un servicio probado y no en el componente. Mismo criterio que `semaforoRadicacion.js`:
   la pantalla solo pinta lo que el servicio decide. */

import { test } from 'node:test';
import assert from 'node:assert';
import { mensajeAccionistas, mensajeDocumentoIdentidad } from './mensajesIngesta.js';

/* ══════════════ Composición accionaria ══════════════ */

test('con accionistas leídos, lo dice y cuántos', () => {
  const m = mensajeAccionistas({ accionistas: [{ nombre: 'A' }, { nombre: 'B' }] });
  assert.strictEqual(m.tono, 'ok');
  assert.match(m.texto, /2 accionista/);
  assert.strictEqual(m.aplicar, true, 'y autoriza a escribir en el estudio');
});

test('leído sin accionistas: se dice, y se sugiere el documento correcto', () => {
  /* El caso real. Antes esto no producía ningún mensaje y la pantalla quedaba en «Leyendo…». */
  const m = mensajeAccionistas({ accionistas: [], empresa: 'MAKITA COLOMBIA S.A.S.' });
  assert.strictEqual(m.tono, 'aviso');
  assert.match(m.texto, /no encontr/i, 'dice que no encontró accionistas');
  assert.match(m.texto, /certificad/i, 'y de qué documento sí los toma');
  assert.strictEqual(m.aplicar, false, 'y no pisa el estudio con una lista vacía');
});

test('el nombre de empresa que sí se leyó se aprovecha en el aviso', () => {
  /* Es la pista de que el documento se leyó de verdad: si el modelo saco la razón social, el
     problema es el documento, no la lectura. */
  const m = mensajeAccionistas({ accionistas: [], empresa: 'MAKITA COLOMBIA S.A.S.' });
  assert.match(m.texto, /MAKITA COLOMBIA S\.A\.S\./);
});

test('sin razón social el aviso no inventa una', () => {
  const m = mensajeAccionistas({ accionistas: [] });
  assert.strictEqual(m.tono, 'aviso');
  assert.doesNotMatch(m.texto, /undefined|null/);
});

test('una respuesta nula o sin la forma esperada se trata como no leída', () => {
  for (const entrada of [null, undefined, {}, { accionistas: null }, 'texto']) {
    const m = mensajeAccionistas(entrada);
    assert.strictEqual(m.aplicar, false);
    assert.notStrictEqual(m.tono, 'ok', `no debe cantar éxito con ${JSON.stringify(entrada)}`);
    assert.ok(m.texto && m.texto.length > 0, 'y SIEMPRE hay un mensaje: eso es lo que se rompió');
  }
});

test('un fallo de la lectura se distingue de una lectura sin resultados', () => {
  /* No es lo mismo «el documento no traía accionistas» que «no se pudo leer»: en el primer caso
     hay que cambiar de documento, en el segundo reintentar. */
  const m = mensajeAccionistas(null, new Error('502'));
  assert.strictEqual(m.tono, 'error');
  assert.match(m.texto, /no se pudo/i);
  assert.strictEqual(m.aplicar, false);
});

/* ══════════════ RUT y Cámara de Comercio ══════════════ */

test('con campos leídos, se nombra el documento y cuántos campos entraron', () => {
  const m = mensajeDocumentoIdentidad('rut', { ent: 'X S.A.S.', nit: '900.123.456-7' });
  assert.strictEqual(m.tono, 'ok');
  assert.match(m.texto, /RUT/);
  assert.match(m.texto, /2 campo/);
});

test('la Cámara de Comercio se nombra por su nombre', () => {
  const m = mensajeDocumentoIdentidad('camara', { ent: 'X S.A.S.' });
  assert.match(m.texto, /C[áa]mara de Comercio/);
});

test('cero campos leídos NO canta éxito', () => {
  /* `processFile` decía «✅ RUT extraído con éxito» aunque no hubiera llenado un solo campo:
     el analista se iba tranquilo con el formulario vacío. */
  const m = mensajeDocumentoIdentidad('rut', {});
  assert.strictEqual(m.tono, 'aviso');
  assert.match(m.texto, /no se pudo leer ning[úu]n campo|ning[úu]n dato/i);
});

test('una respuesta vacía del endpoint produce aviso, no silencio', () => {
  /* El `if (data)` sin `else`: con un cuerpo vacío la pantalla se quedaba en «Analizando
     documento…». */
  for (const entrada of [null, undefined, '']) {
    const m = mensajeDocumentoIdentidad('rut', entrada);
    assert.notStrictEqual(m.tono, 'ok');
    assert.ok(m.texto && m.texto.length > 0);
  }
});

test('un fallo se distingue de una lectura sin campos', () => {
  const m = mensajeDocumentoIdentidad('rut', null, new Error('timeout'));
  assert.strictEqual(m.tono, 'error');
  assert.match(m.texto, /manualmente/i, 'y ofrece la salida: escribirlo a mano');
});

test('un tipo de documento desconocido no rompe el mensaje', () => {
  const m = mensajeDocumentoIdentidad('otro', { ent: 'X' });
  assert.ok(m.texto && m.texto.length > 0);
  assert.doesNotMatch(m.texto, /undefined/);
});
