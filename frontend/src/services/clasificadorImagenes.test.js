import { test } from 'node:test';
import assert from 'node:assert';
import {
  fraccionDePagina,
  detectarPaginasDeAnexo,
  UMBRAL_DOMINANTE,
  MIN_PAGINAS_ANEXO,
  UMBRAL_INTERIOR,
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

/* --- Páginas interiores que se quedan cortas --- */

/* En el informe de ATEB 2024 la página 54 —la última hoja de un estado financiero— se
   escanea a media página: se dibuja al 31,1 % entre veintisiete páginas al 52 %. Por debajo
   del umbral se quedaba fuera del anexo, y una página de anexo que no es anexo se COPIA al
   informe nuevo: el estudio de 2025 se radicaba con una hoja firmada de 2024 dentro. */

test('una página corta en medio del anexo entra con las demás', () => {
  const dibujos = [
    { pagina: 47, fraccion: 0.52 }, { pagina: 48, fraccion: 0.52 },
    { pagina: 49, fraccion: 0.52 }, { pagina: 50, fraccion: 0.31 },
    { pagina: 51, fraccion: 0.52 }, { pagina: 52, fraccion: 0.52 },
    { pagina: 53, fraccion: 0.52 },
  ];
  assert.deepStrictEqual(
    [...detectarPaginasDeAnexo(dibujos)].sort((a, b) => a - b),
    [47, 48, 49, 50, 51, 52, 53]
  );
});

test('un hueco interior de varias páginas cortas se llena entero', () => {
  const dibujos = [
    { pagina: 1, fraccion: 0.52 }, { pagina: 2, fraccion: 0.52 }, { pagina: 3, fraccion: 0.52 },
    { pagina: 4, fraccion: 0.28 }, { pagina: 5, fraccion: 0.31 },
    { pagina: 6, fraccion: 0.52 }, { pagina: 7, fraccion: 0.52 }, { pagina: 8, fraccion: 0.52 },
  ];
  assert.deepStrictEqual(
    [...detectarPaginasDeAnexo(dibujos)].sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8]
  );
});

/* El anexo se cierra por donde acaba: una página corta pegada al final no lo alarga, porque
   nada del otro lado dice que el anexo siga. Si lo hiciera, el gráfico de la página siguiente
   al anexo se perdería. */
test('una página corta pegada al borde del anexo no lo alarga', () => {
  const dibujos = [
    { pagina: 10, fraccion: 0.52 }, { pagina: 11, fraccion: 0.52 },
    { pagina: 12, fraccion: 0.52 }, { pagina: 13, fraccion: 0.31 },
  ];
  assert.deepStrictEqual(
    [...detectarPaginasDeAnexo(dibujos)].sort((a, b) => a - b),
    [10, 11, 12]
  );
});

/* Entre dos anexos hay páginas de texto —el título del siguiente, su índice—, y esas no son
   anexo: sin imagen dominante no hay hoja escaneada que sustituir. */
test('las páginas de texto entre dos anexos no se cuelan', () => {
  const dibujos = [
    { pagina: 1, fraccion: 0.52 }, { pagina: 2, fraccion: 0.52 }, { pagina: 3, fraccion: 0.52 },
    { pagina: 4, fraccion: 0.02 }, { pagina: 5, fraccion: 0.02 },
    { pagina: 6, fraccion: 0.52 }, { pagina: 7, fraccion: 0.52 }, { pagina: 8, fraccion: 0.52 },
  ];
  assert.deepStrictEqual(
    [...detectarPaginasDeAnexo(dibujos)].sort((a, b) => a - b),
    [1, 2, 3, 6, 7, 8]
  );
});

/* Con una sola página corta de por medio basta que UNA no llegue al umbral interior para que
   el hueco no se llene: es lo que separa dos anexos distintos de una hoja a medias. */
test('un hueco interior con una página sin imagen no se llena', () => {
  const dibujos = [
    { pagina: 1, fraccion: 0.52 }, { pagina: 2, fraccion: 0.52 }, { pagina: 3, fraccion: 0.52 },
    { pagina: 4, fraccion: 0.31 }, { pagina: 5, fraccion: 0.02 },
    { pagina: 6, fraccion: 0.52 }, { pagina: 7, fraccion: 0.52 }, { pagina: 8, fraccion: 0.52 },
  ];
  assert.deepStrictEqual(
    [...detectarPaginasDeAnexo(dibujos)].sort((a, b) => a - b),
    [1, 2, 3, 6, 7, 8]
  );
});

test('el umbral de las páginas interiores es el verificado contra el PDF real', () => {
  /* La página 54 del informe de ATEB se dibuja al 31,1 %, y el gráfico suelto más grande del
     cuerpo al 20,9 %. 0,25 cae entre los dos, y sólo se aplica dentro de un anexo ya
     detectado: fuera de ahí un gráfico grande sigue siendo un gráfico. */
  assert.strictEqual(UMBRAL_INTERIOR, 0.25);
});
