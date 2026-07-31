import { test } from 'node:test';
import assert from 'node:assert';
import {
  fraccionDePagina,
  detectarPaginasDeAnexo,
  UMBRAL_DOMINANTE,
  MIN_PAGINAS_ANEXO,
} from './clasificadorImagenes.js';

/* Carta en unidades PDF: 612 x 792 puntos. */
const CARTA = { ancho: 612, alto: 792 };

test('fraccionDePagina calcula la proporción de área', () => {
  assert.strictEqual(fraccionDePagina({ ancho: 306, alto: 396 }, CARTA), 0.25);
});

test('fraccionDePagina devuelve 0 si falta alguna dimensión', () => {
  assert.strictEqual(fraccionDePagina({ ancho: 100, alto: 100 }, { ancho: 0, alto: 0 }), 0);
  assert.strictEqual(fraccionDePagina({ ancho: 0, alto: 0 }, CARTA), 0);
  assert.strictEqual(fraccionDePagina(null, CARTA), 0);
});

test('una racha de páginas consecutivas dominantes es anexo', () => {
  const dibujos = [
    { pagina: 44, fraccion: 0.52 },
    { pagina: 45, fraccion: 0.52 },
    { pagina: 46, fraccion: 0.52 },
  ];
  assert.deepStrictEqual([...detectarPaginasDeAnexo(dibujos)].sort(), [44, 45, 46]);
});

/* Un gráfico grande en una sola página no es un anexo: lo que distingue al
   anexo es la continuidad, no el tamaño de una imagen suelta. */
test('una página dominante aislada no es anexo', () => {
  assert.strictEqual(detectarPaginasDeAnexo([{ pagina: 19, fraccion: 0.9 }]).size, 0);
});

test('una racha más corta que el mínimo no es anexo', () => {
  const dibujos = [
    { pagina: 10, fraccion: 0.6 },
    { pagina: 11, fraccion: 0.6 },
  ];
  assert.strictEqual(detectarPaginasDeAnexo(dibujos).size, 0);
});

test('dos rachas separadas se detectan ambas', () => {
  const dibujos = [
    { pagina: 5, fraccion: 0.6 }, { pagina: 6, fraccion: 0.6 }, { pagina: 7, fraccion: 0.6 },
    { pagina: 20, fraccion: 0.6 }, { pagina: 21, fraccion: 0.6 }, { pagina: 22, fraccion: 0.6 },
  ];
  assert.deepStrictEqual(
    [...detectarPaginasDeAnexo(dibujos)].sort((a, b) => a - b),
    [5, 6, 7, 20, 21, 22]
  );
});

/* El logo se dibuja como encabezado en las 112 páginas: son muchas páginas
   consecutivas, pero ninguna dominante. No debe confundirse con un anexo. */
test('un logo repetido en todas las páginas no es anexo', () => {
  const dibujos = Array.from({ length: 40 }, (_, i) => ({ pagina: i + 1, fraccion: 0.02 }));
  assert.strictEqual(detectarPaginasDeAnexo(dibujos).size, 0);
});

test('se toma la imagen más grande de cada página', () => {
  /* Una página del anexo lleva además el logo de encabezado: debe contar la
     imagen dominante, no la primera ni la última que aparezca. */
  const dibujos = [
    { pagina: 44, fraccion: 0.02 }, { pagina: 44, fraccion: 0.52 },
    { pagina: 45, fraccion: 0.52 }, { pagina: 45, fraccion: 0.02 },
    { pagina: 46, fraccion: 0.52 },
  ];
  assert.deepStrictEqual([...detectarPaginasDeAnexo(dibujos)].sort(), [44, 45, 46]);
});

test('sin dibujos no hay anexo', () => {
  assert.strictEqual(detectarPaginasDeAnexo([]).size, 0);
});

test('los umbrales son los verificados contra el PDF real', () => {
  /* 0,35 cae en el hueco entre el gráfico más grande (20,9 %) y el anexo
     (52,1 %). Tres páginas es el mínimo para hablar de una secuencia. */
  assert.strictEqual(UMBRAL_DOMINANTE, 0.35);
  assert.strictEqual(MIN_PAGINAS_ANEXO, 3);
});
