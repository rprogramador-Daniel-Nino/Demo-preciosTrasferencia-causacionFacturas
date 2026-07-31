import { test } from 'node:test';
import assert from 'node:assert';
import axios from 'axios';
import { scoreCandidates, curateCandidatesWithGemini, nameKey } from './comparablesEngine.js';

function mockGeminiRechazandoTodas() {
  const original = axios.post;
  axios.post = async () => ({
    data: {
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              evaluacion: [
                { id: 'A', coincide: false, motivo: 'no coincide según la IA' },
                { id: 'B', coincide: false, motivo: 'no coincide según la IA' }
              ]
            })
          }]
        }
      }]
    }
  });
  return () => { axios.post = original; };
}

test('scoreCandidates: una comparable con pérdida operativa se excluye aunque sea de continuidad', () => {
  const candidatas = [
    { id: 'A', name: 'Continuidad Corp', nameKey: nameKey('Continuidad Corp'), isHolding: false, hasNegativeBalance: false, hasLoss: true, country: 'Colombia' }
  ];
  const priorComps = [{ name: 'Continuidad Corp' }];
  const result = scoreCandidates(candidatas, {}, '', priorComps);
  assert.strictEqual(result.seleccionadas.length, 0, 'la pérdida operativa debe seguir excluyendo incluso a las de continuidad');
  assert.strictEqual(result.rechazadas.length, 1);
  assert.strictEqual(result.rechazadas[0].esContinuidad, true, 'sí debió reconocerse como continuidad');
});

test('curateCandidatesWithGemini: una candidata de continuidad no se descarta aunque la IA diga que no coincide', async () => {
  const restore = mockGeminiRechazandoTodas();
  try {
    const candidatas = [
      { id: 'A', name: 'Continuidad Corp', desc: 'x', esContinuidad: true, descartada: false },
      { id: 'B', name: 'Nueva Corp', desc: 'y', esContinuidad: false, descartada: false }
    ];
    const result = await curateCandidatesWithGemini(candidatas, 'actividad de prueba');
    const a = result.find(c => c.id === 'A');
    const b = result.find(c => c.id === 'B');
    assert.strictEqual(a.descartada, false, 'la candidata de continuidad no debe descartarse aunque la IA diga que no coincide');
    assert.strictEqual(b.descartada, true, 'la candidata sin continuidad sí debe descartarse');
  } finally {
    restore();
  }
});
