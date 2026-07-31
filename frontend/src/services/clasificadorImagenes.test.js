import { test } from 'node:test';
import assert from 'node:assert';
import { clasificarImagen, UMBRAL_PAGINA } from './clasificadorImagenes.js';

/* Carta en unidades PDF: 612 x 792 puntos. */
const CARTA = { ancho: 612, alto: 792 };

test('una imagen que cubre casi toda la página es un escaneo', () => {
  assert.strictEqual(clasificarImagen({ ancho: 600, alto: 780 }, CARTA), 'pagina');
});

test('un logo en una esquina es un recurso', () => {
  assert.strictEqual(clasificarImagen({ ancho: 120, alto: 27 }, CARTA), 'recurso');
});

test('el umbral es inclusivo: justo en 80% cuenta como página', () => {
  const area = CARTA.ancho * CARTA.alto * UMBRAL_PAGINA;
  const lado = Math.sqrt(area);
  assert.strictEqual(clasificarImagen({ ancho: lado, alto: lado }, CARTA), 'pagina');
});

test('justo por debajo del umbral es recurso', () => {
  const area = CARTA.ancho * CARTA.alto * (UMBRAL_PAGINA - 0.01);
  const lado = Math.sqrt(area);
  assert.strictEqual(clasificarImagen({ ancho: lado, alto: lado }, CARTA), 'recurso');
});

/* El criterio es la superficie sobre la página, no los píxeles del archivo:
   un logo en alta resolución tiene más píxeles que un escaneo mediocre pero
   ocupa una esquina. */
test('una página con dimensiones cero no revienta', () => {
  assert.strictEqual(clasificarImagen({ ancho: 100, alto: 100 }, { ancho: 0, alto: 0 }), 'recurso');
});

test('una imagen sin dimensiones es recurso', () => {
  assert.strictEqual(clasificarImagen({ ancho: 0, alto: 0 }, CARTA), 'recurso');
});
