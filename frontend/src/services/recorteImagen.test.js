import { test } from 'node:test';
import assert from 'node:assert';
import { cajaDeContenido, recortarPaginas, recortarDataUrl } from './recorteImagen.js';

/* Un mapa RGBA de `ancho`×`alto`, blanco opaco, sobre el que pintar el contenido de la
   prueba. Blanco opaco y no transparente: así cada caso declara cuál de los dos papeles
   está ejercitando. */
function hoja(ancho, alto, { transparente = false } = {}) {
  const px = new Uint8Array(ancho * alto * 4);
  if (!transparente) px.fill(255);
  return px;
}

function pintar(px, ancho, x, y, [r, g, b, a] = [0, 0, 0, 255]) {
  const i = (y * ancho + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

/* Un rectángulo relleno, que es la forma de lo que hay que recortar de verdad: el cuadro
   de un estado financiero. */
function pintarBloque(px, ancho, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) pintar(px, ancho, x, y);
}

test('cajaDeContenido recorta el blanco de los cuatro lados', () => {
  const px = hoja(100, 100);
  pintarBloque(px, 100, 30, 20, 69, 39);
  assert.deepStrictEqual(
    cajaDeContenido(px, 100, 100, { margenPx: 0 }),
    { x: 30, y: 20, ancho: 40, alto: 20 });
});

test('cajaDeContenido añade el margen de aire pedido', () => {
  const px = hoja(100, 100);
  pintarBloque(px, 100, 30, 20, 69, 39);
  assert.deepStrictEqual(
    cajaDeContenido(px, 100, 100, { margenPx: 5 }),
    { x: 25, y: 15, ancho: 50, alto: 30 });
});

/* El margen no puede salirse de la hoja: un `x` negativo o un ancho mayor que el papel
   haría que `drawImage` recortara con relleno transparente por ese lado. */
test('cajaDeContenido no deja que el margen se salga de la hoja', () => {
  const px = hoja(40, 40);
  pintarBloque(px, 40, 0, 0, 9, 9);
  assert.deepStrictEqual(
    cajaDeContenido(px, 40, 40, { margenPx: 20 }),
    { x: 0, y: 0, ancho: 30, alto: 30 });
});

test('cajaDeContenido devuelve null en una hoja en blanco', () => {
  assert.strictEqual(cajaDeContenido(hoja(50, 50), 50, 50), null);
});

/* El caso del papel de un PDF vectorial: llega transparente, no blanco. Tomarlo por
   contenido dejaría la caja en la hoja entera y no se recortaría nada. */
test('cajaDeContenido trata el papel transparente como blanco', () => {
  const px = hoja(100, 100, { transparente: true });
  pintarBloque(px, 100, 10, 10, 29, 19);
  assert.deepStrictEqual(
    cajaDeContenido(px, 100, 100, { margenPx: 0 }),
    { x: 10, y: 10, ancho: 20, alto: 10 });
});

/* Idempotencia: volver a recortar lo ya recortado no debe recodificar la imagen. */
test('cajaDeContenido devuelve null cuando el contenido ya llena la hoja', () => {
  const px = hoja(50, 50);
  pintarBloque(px, 50, 0, 0, 49, 49);
  assert.strictEqual(cajaDeContenido(px, 50, 50), null);
});

test('cajaDeContenido sí recorta cuando solo una de las dos dimensiones está llena', () => {
  const px = hoja(100, 100);
  pintarBloque(px, 100, 0, 40, 99, 59);
  const caja = cajaDeContenido(px, 100, 100, { margenPx: 0 });
  assert.deepStrictEqual(caja, { x: 0, y: 40, ancho: 100, alto: 20 });
});

/* Una mota suelta en el margen —ruido de compresión, una raya del escáner— anularía el
   recorte entero si bastara un píxel por línea. */
test('cajaDeContenido ignora una mota aislada en el margen', () => {
  const px = hoja(100, 100);
  pintarBloque(px, 100, 40, 40, 59, 49);
  pintar(px, 100, 2, 95);
  assert.deepStrictEqual(
    cajaDeContenido(px, 100, 100, { margenPx: 0 }),
    { x: 40, y: 40, ancho: 20, alto: 10 });
});

test('cajaDeContenido respeta minPorLinea cuando se le sube', () => {
  const px = hoja(100, 100);
  /* Un bloque de 3×3: contenido con el mínimo de 2, ruido con el de 5. */
  pintarBloque(px, 100, 10, 10, 12, 12);
  assert.deepStrictEqual(
    cajaDeContenido(px, 100, 100, { minPorLinea: 2, margenPx: 0 }),
    { x: 10, y: 10, ancho: 3, alto: 3 });
  assert.strictEqual(cajaDeContenido(px, 100, 100, { minPorLinea: 5, margenPx: 0 }), null);
});

/* El mínimo por línea se aplica a los DOS ejes, así que una raya de un píxel de alto no
   deja caja aunque su fila sí llegue al mínimo. La consecuencia es la deseable —se
   devuelve `null` y la página se queda completa— y no una caja degenerada. */
test('cajaDeContenido devuelve null ante contenido de un solo píxel de grueso', () => {
  const px = hoja(100, 100);
  pintarBloque(px, 100, 10, 10, 40, 10);
  assert.strictEqual(cajaDeContenido(px, 100, 100, { margenPx: 0 }), null);
});

/* Un gris claro de fondo no es contenido; el texto negro sí. Sin el umbral, un papel
   escaneado con tinte gris no se recortaría nunca. */
test('cajaDeContenido no toma por contenido un gris más claro que el umbral', () => {
  const px = hoja(60, 60);
  for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) pintar(px, 60, x, y, [250, 250, 250, 255]);
  pintarBloque(px, 60, 20, 20, 29, 24);
  assert.deepStrictEqual(
    cajaDeContenido(px, 60, 60, { margenPx: 0 }),
    { x: 20, y: 20, ancho: 10, alto: 5 });
});

test('cajaDeContenido devuelve null ante dimensiones inválidas o píxeles insuficientes', () => {
  assert.strictEqual(cajaDeContenido(null, 10, 10), null);
  assert.strictEqual(cajaDeContenido(hoja(10, 10), 0, 10), null);
  assert.strictEqual(cajaDeContenido(hoja(10, 10), 10.5, 10), null);
  assert.strictEqual(cajaDeContenido(new Uint8Array(40), 10, 10), null);
});

/* Idempotencia, que es lo que permite a `recorteEeff.js` recortar lo ya guardado sin
   llevar cuenta de qué recortó antes: lo que sale de un recorte trae `margenPx` de
   blanco por lado, y en la segunda pasada la caja vuelve a dar la imagen completa. */
test('cajaDeContenido no vuelve a recortar lo que ya tiene el margen justo', () => {
  const px = hoja(100, 100);
  pintarBloque(px, 100, 10, 10, 89, 89);
  assert.strictEqual(cajaDeContenido(px, 100, 100, { margenPx: 10 }), null);
});

test('cajaDeContenido sí recorta si el blanco sobra por encima del margen', () => {
  const px = hoja(100, 100);
  pintarBloque(px, 100, 30, 30, 69, 69);
  assert.deepStrictEqual(
    cajaDeContenido(px, 100, 100, { margenPx: 10 }),
    { x: 20, y: 20, ancho: 60, alto: 60 });
});

/* Fuera del navegador no hay `canvas`: el recorte se salta y las páginas salen intactas.
   Es la misma degradación que ante un error de decodificación. */
test('recortarDataUrl devuelve la imagen intacta sin canvas disponible', async () => {
  const dataUrl = 'data:image/png;base64,QUJD';
  assert.strictEqual(await recortarDataUrl(dataUrl), dataUrl);
});

/* ─── la parte que usa canvas ───
   `cajaDeContenido` decide dónde cortar y se prueba arriba con píxeles a mano; lo que
   queda por verificar es que el corte se PIDA bien: que el lienzo destino tenga el
   tamaño de la caja y que el `drawImage` copie justo esa región. Se monta un navegador
   falso porque `canvas` no existe en Node, y era la única pieza del recorte sin cubrir. */
const URL_FALSA = 'data:image/png;base64,' + 'Q'.repeat(48);

async function conNavegadorFalso({ ancho, alto, pixeles, fallaCarga = false }, fn) {
  const antes = { document: globalThis.document, Image: globalThis.Image };
  const lienzos = [];
  globalThis.Image = class {
    set src(v) {
      this._src = v;
      Promise.resolve().then(() => {
        if (fallaCarga) { if (this.onerror) this.onerror(); return; }
        if (this.onload) this.onload();
      });
    }
    get src() { return this._src; }
    get naturalWidth() { return ancho; }
    get naturalHeight() { return alto; }
  };
  globalThis.document = {
    createElement: () => {
      const lienzo = { width: 0, height: 0, copias: [], rellenos: [] };
      lienzo.getContext = () => ({
        fillStyle: '',
        fillRect: (...a) => lienzo.rellenos.push(a),
        drawImage: (...a) => lienzo.copias.push(a),
        getImageData: () => ({ data: pixeles }),
      });
      lienzo.toDataURL = () => 'data:image/png;base64,' + 'R'.repeat(48);
      lienzos.push(lienzo);
      return lienzo;
    },
  };
  try {
    return await fn(lienzos);
  } finally {
    globalThis.document = antes.document;
    globalThis.Image = antes.Image;
  }
}

test('recortarDataUrl copia al lienzo destino exactamente la caja del contenido', async () => {
  const px = hoja(100, 100);
  pintarBloque(px, 100, 30, 20, 69, 39);
  await conNavegadorFalso({ ancho: 100, alto: 100, pixeles: px }, async (lienzos) => {
    const salida = await recortarDataUrl(URL_FALSA, { margenPx: 0 });
    assert.notStrictEqual(salida, URL_FALSA, 'tiene que devolver la imagen recortada');
    assert.strictEqual(lienzos.length, 2, 'un lienzo para leer y otro para recortar');
    const destino = lienzos[1];
    assert.strictEqual(destino.width, 40);
    assert.strictEqual(destino.height, 20);
    /* El fondo blanco va ANTES de la copia: el papel de un PDF vectorial llega
       transparente y en un .docx la transparencia se ve distinta según el visor. */
    assert.deepStrictEqual(destino.rellenos, [[0, 0, 40, 20]]);
    assert.deepStrictEqual(destino.copias[0].slice(1), [30, 20, 40, 20, 0, 0, 40, 20]);
  });
});

test('recortarDataUrl no toca la imagen cuando no hay blanco que quitar', async () => {
  const px = hoja(60, 60);
  pintarBloque(px, 60, 0, 0, 59, 59);
  await conNavegadorFalso({ ancho: 60, alto: 60, pixeles: px }, async (lienzos) => {
    assert.strictEqual(await recortarDataUrl(URL_FALSA), URL_FALSA);
    assert.strictEqual(lienzos.length, 1, 'no se crea el lienzo destino si no se recorta');
  });
});

test('recortarDataUrl devuelve la original si el navegador no puede decodificarla', async () => {
  await conNavegadorFalso({ ancho: 0, alto: 0, pixeles: null, fallaCarga: true }, async () => {
    assert.strictEqual(await recortarDataUrl(URL_FALSA), URL_FALSA);
  });
});

test('recortarDataUrl devuelve la original ante una imagen sin dimensiones', async () => {
  await conNavegadorFalso({ ancho: 0, alto: 0, pixeles: hoja(1, 1) }, async (lienzos) => {
    assert.strictEqual(await recortarDataUrl(URL_FALSA), URL_FALSA);
    assert.strictEqual(lienzos.length, 0, 'ni siquiera se llega a crear el lienzo');
  });
});

test('recortarPaginas recorta cada página del arreglo', async () => {
  const px = hoja(80, 80);
  pintarBloque(px, 80, 10, 10, 29, 19);
  await conNavegadorFalso({ ancho: 80, alto: 80, pixeles: px }, async () => {
    const salida = await recortarPaginas([URL_FALSA, URL_FALSA], { margenPx: 0 });
    assert.strictEqual(salida.length, 2);
    assert.ok(salida.every((s) => s !== URL_FALSA), 'las dos páginas salen recortadas');
  });
});

test('recortarPaginas conserva el largo y el orden del arreglo', async () => {
  const entrada = ['data:image/png;base64,QQ==', 'data:image/png;base64,Qg=='];
  assert.deepStrictEqual(await recortarPaginas(entrada), entrada);
});

test('recortarPaginas tolera entradas que no son arreglo', async () => {
  assert.deepStrictEqual(await recortarPaginas(null), []);
  assert.deepStrictEqual(await recortarPaginas(undefined), []);
});
