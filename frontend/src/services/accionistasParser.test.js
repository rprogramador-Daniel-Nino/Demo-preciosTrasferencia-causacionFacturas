import { test } from 'node:test';
import assert from 'node:assert';
import { mensajeErrorGemini } from './accionistasParser.js';

test('mensajeErrorGemini reporta el status HTTP cuando el error viene de axios', () => {
  assert.strictEqual(
    mensajeErrorGemini({ response: { status: 429 } }),
    'el servicio de IA respondió con error 429'
  );
});

test('mensajeErrorGemini usa el mensaje del error si no hay status HTTP', () => {
  assert.strictEqual(mensajeErrorGemini(new Error('Network Error')), 'Network Error');
});

test('mensajeErrorGemini tiene un mensaje genérico si el error no trae nada útil', () => {
  assert.strictEqual(mensajeErrorGemini({}), 'fallo de red o del servicio de IA');
  assert.strictEqual(mensajeErrorGemini(undefined), 'fallo de red o del servicio de IA');
});
