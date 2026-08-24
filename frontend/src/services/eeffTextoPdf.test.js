/* Tests de la capa de texto del PDF de estados financieros.

   Lo que se prueba aquí no es pdf.js, sino las dos decisiones propias: cómo se agrupan los
   fragmentos de una página en filas legibles —sin lo cual el rótulo y su cifra quedan en
   líneas distintas y el texto no sirve para nada— y cómo se comprueba que una cifra esté
   impresa en el documento, que es la única defensa mecánica contra una cifra inventada. */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  agruparEnLineas, cifrasDelTexto, cifraApareceEnTexto, extraerTextoPdf,
} from './eeffTextoPdf.js';

/* Los fragmentos como los entrega pdf.js: `transform[4]` es la X y `transform[5]` la Y, y
   la Y crece hacia arriba. Las tres celdas de una fila de estado financiero desalineadas
   por una fracción de punto, que es lo que de verdad llega. */
const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });

test('las celdas de una misma fila quedan en una sola línea, en orden de lectura', () => {
  const lineas = agruparEnLineas([
    item('337.546.138', 400, 700.4),
    item('EFECTIVO Y EQUIVALENTES DE EFECTIVO', 60, 700),
    item('1.530.565.829', 500, 701.2),
  ]);
  assert.deepStrictEqual(lineas, [
    'EFECTIVO Y EQUIVALENTES DE EFECTIVO | 337.546.138 | 1.530.565.829',
  ]);
});

test('dos filas distintas no se fusionan', () => {
  const lineas = agruparEnLineas([
    item('TOTAL ACTIVO CORRIENTE', 60, 600),
    item('14.050.942.064', 400, 600),
    item('TOTAL ACTIVO NO CORRIENTE', 60, 580),
    item('953.170.282', 400, 580),
  ]);
  assert.strictEqual(lineas.length, 2);
  assert.match(lineas[0], /^TOTAL ACTIVO CORRIENTE/);
  assert.match(lineas[1], /^TOTAL ACTIVO NO CORRIENTE/);
});

test('las líneas salen de arriba abajo, como se lee el documento', () => {
  const lineas = agruparEnLineas([item('abajo', 60, 100), item('arriba', 60, 700)]);
  assert.deepStrictEqual(lineas, ['arriba', 'abajo']);
});

test('los fragmentos vacíos no producen líneas fantasma', () => {
  assert.deepStrictEqual(agruparEnLineas([item('   ', 60, 700), item('', 60, 680)]), []);
  assert.deepStrictEqual(agruparEnLineas(null), []);
});

/* ══════ ¿Está esta cifra impresa? ══════ */

const TEXTO = `INGRESOS DE ACTIVIDADES ORDINARIAS | 23.741.367.744 | 20.551.569.611
COSTO DE VENTAS | -21.850.187.494
OTROS INGRESOS | 8.298
EQUIPO NETO | - | -`;

test('reconoce las cifras con separador de miles colombiano', () => {
  const cifras = cifrasDelTexto(TEXTO);
  assert.ok(cifraApareceEnTexto(23741367744, cifras));
  assert.ok(cifraApareceEnTexto(8298, cifras));
});

test('reconoce la magnitud aunque el documento le ponga signo', () => {
  /* El estado imprime «-21.850.187.494» y la lectura puede devolverlo con signo o sin él;
     lo que se comprueba es que la magnitud esté impresa, no cómo se representó el signo. */
  const cifras = cifrasDelTexto(TEXTO);
  assert.ok(cifraApareceEnTexto(-21850187494, cifras));
  assert.ok(cifraApareceEnTexto(21850187494, cifras));
});

test('tolera el redondeo de los decimales', () => {
  const cifras = cifrasDelTexto('COSTO | 21.850.187.494,00');
  assert.ok(cifraApareceEnTexto(21850187494, cifras));
});

test('reconoce también el separador anglosajón', () => {
  const cifras = cifrasDelTexto('REVENUE | 23,741,367,744.00');
  assert.ok(cifraApareceEnTexto(23741367744, cifras));
});

test('una cifra que no está impresa no pasa', () => {
  /* El caso que motivó todo esto: 44.177.669 como «cuentas por pagar comerciales» de un
     documento que no la contiene. */
  assert.strictEqual(cifraApareceEnTexto(44177669, cifrasDelTexto(TEXTO)), false);
});

test('una cifra parecida pero distinta tampoco pasa', () => {
  /* La tolerancia es de un peso, no de un orden de magnitud: un dígito mal leído en una
     cifra de miles de millones tiene que salir a la luz. */
  assert.strictEqual(cifraApareceEnTexto(23741367745, cifrasDelTexto(TEXTO)), true,
    'un peso de diferencia es redondeo');
  assert.strictEqual(cifraApareceEnTexto(23741367844, cifrasDelTexto(TEXTO)), false,
    'cien pesos de diferencia ya es otra cifra');
});

test('el cero no se somete a la comprobación', () => {
  /* Un rubro en cero no es una alucinación: el documento lo imprime como raya, como cero o
     no lo imprime, y afirmar que «está» no distinguiría nada. */
  assert.strictEqual(cifraApareceEnTexto(0, cifrasDelTexto(TEXTO)), true);
});

test('lo que no es número no pasa la comprobación', () => {
  const cifras = cifrasDelTexto(TEXTO);
  assert.strictEqual(cifraApareceEnTexto(null, cifras), false);
  assert.strictEqual(cifraApareceEnTexto(undefined, cifras), false);
  assert.strictEqual(cifraApareceEnTexto(NaN, cifras), false);
  assert.strictEqual(cifraApareceEnTexto(Infinity, cifras), false);
});

/* ══════ Degradación ══════ */

test('una imagen no tiene capa de texto y no se intenta leerla', async () => {
  const archivo = { type: 'image/png', name: 'balance.png', arrayBuffer: async () => { throw new Error('no debería llegar aquí'); } };
  assert.strictEqual(await extraerTextoPdf(archivo), '');
});

test('un PDF que pdf.js no puede abrir devuelve cadena vacía y no revienta la ingesta', async () => {
  const archivo = { type: 'application/pdf', name: 'roto.pdf', arrayBuffer: async () => new ArrayBuffer(8) };
  const resultado = await extraerTextoPdf(archivo, {
    getDocument: () => ({ promise: Promise.reject(new Error('formato inválido')) }),
  });
  assert.strictEqual(resultado, '');
});

test('un PDF escaneado, sin fragmentos de texto, devuelve cadena vacía', async () => {
  const archivo = { type: 'application/pdf', name: 'escaneo.pdf', arrayBuffer: async () => new ArrayBuffer(8) };
  const resultado = await extraerTextoPdf(archivo, {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async () => ({ getTextContent: async () => ({ items: [] }) }),
      }),
    }),
  });
  assert.strictEqual(resultado, '');
});

test('un PDF con texto devuelve sus páginas rotuladas', async () => {
  const archivo = { type: 'application/pdf', name: 'eeff.pdf', arrayBuffer: async () => new ArrayBuffer(8) };
  const resultado = await extraerTextoPdf(archivo, {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            items: [item('TOTAL ACTIVO', 60, 700), item('15.004.112.346', 400, 700)],
          }),
        }),
      }),
    }),
  });
  assert.strictEqual(resultado, '--- Página 1 ---\nTOTAL ACTIVO | 15.004.112.346');
});

/* ══════ Números partidos por pdf.js ══════
   pdf.js no devuelve celdas, devuelve fragmentos, y parte donde le conviene al archivo.
   Separar por fragmento convertía «2025» en «202 | 5» y una cifra de miles de millones en
   dos que no existen — y como esta capa de texto sirve para comprobar que una cifra esté
   impresa, esa partición descartaría cifras buenas del estado financiero diciendo que la
   lectura las inventó. El defecto lo documentó Juan sobre los PDF de las comparables
   (commit f8ea915). */

/* Un fragmento con su geometría: pdf.js da `width` y `height` por fragmento. */
const frag = (str, x, y, width, height = 10) => ({ str, transform: [1, 0, 0, 1, x, y], width, height });

test('dos fragmentos pegados son una sola celda: «2025» no sale como «202 | 5»', () => {
  /* El segundo empieza justo donde acaba el primero: hueco 0. */
  const lineas = agruparEnLineas([frag('202', 100, 700, 15), frag('5', 115, 700, 5)]);
  assert.deepStrictEqual(lineas, ['2025']);
});

test('dos fragmentos separados siguen siendo celdas distintas', () => {
  /* Hueco de 40 puntos con fuente de 10: muy por encima del 0,6 × alto. */
  const lineas = agruparEnLineas([frag('TOTAL ACTIVO', 60, 700, 60), frag('15.004.112.346', 160, 700, 70)]);
  assert.deepStrictEqual(lineas, ['TOTAL ACTIVO | 15.004.112.346']);
});

test('una cifra de miles de millones partida en dos se reconoce como impresa', () => {
  const lineas = agruparEnLineas([
    frag('COSTO DE VENTAS', 60, 700, 70),
    frag('21.850.', 200, 700, 30),
    frag('187.494', 230, 700, 30),
  ]);
  assert.deepStrictEqual(lineas, ['COSTO DE VENTAS | 21.850.187.494']);
  assert.ok(cifraApareceEnTexto(21850187494, cifrasDelTexto(lineas.join('\n'))));
});

test('aunque la partición sobreviva a la agrupación, la cifra sigue reconociéndose', () => {
  /* Si el hueco es ancho, `agruparEnLineas` separa —y hace bien, no puede saber que son
     el mismo número—, así que `cifrasDelTexto` da una segunda pasada pegando la línea. */
  const texto = 'COSTO DE VENTAS | 21.850. | 187.494';
  assert.ok(cifraApareceEnTexto(21850187494, cifrasDelTexto(texto)),
    'la cifra está impresa en el documento, aunque llegue troceada');
});

/* ══════ Cifras de una misma fila pegadas sin ningún separador ══════
   Caso real: LAMBERTI COLOMBIA SAS (2026-08-24). El hueco entre celdas de este generador
   de PDF no siempre alcanza el umbral de `unirTrozos`, y cuatro cifras de una misma fila
   del análisis vertical quedan pegadas en un solo bloque de dígitos: el final de una y el
   principio de la siguiente forman un grupo de miles de más de tres dígitos, que no es
   ninguna de las dos cifras reales. El modelo las leía bien (por la imagen); esta
   verificación las descartaba igual, con «no aparece impresa en el documento». */

test('dos cifras pegadas sin separador se reconocen las dos, no una mezcla de las dos', () => {
  const cifras = cifrasDelTexto('1.684.940.1711.232.048.169');
  assert.ok(cifraApareceEnTexto(1684940171, cifras), 'la primera cifra');
  assert.ok(cifraApareceEnTexto(1232048169, cifras), 'la segunda cifra');
  /* El grupo mixto «1711» no es ninguna cifra real: no debe colarse como si lo fuera. */
  assert.strictEqual(cifraApareceEnTexto(17111232048169, cifras), false);
});

test('cuatro cifras pegadas en cadena se reconocen todas', () => {
  /* El bloque real, tal como lo entrega `agruparEnLineas` para esa fila de Lamberti. */
  const cifras = cifrasDelTexto('1.684.940.1711.232.048.1692.856.848.8075.990.412.774');
  [1684940171, 1232048169, 2856848807, 5990412774].forEach((n) => assert.ok(
    cifraApareceEnTexto(n, cifras), `falta reconocer ${n}`));
});

test('una cifra normal, sin nada pegado, se sigue reconociendo igual que antes', () => {
  const cifras = cifrasDelTexto('TOTAL ACTIVO | 21.850.187.494');
  assert.ok(cifraApareceEnTexto(21850187494, cifras));
});

test('un número sin separadores de miles no se trocea', () => {
  /* Un año, un NIT o un código sin puntos no tiene grupos que desglosar: debe pasar entero. */
  const cifras = cifrasDelTexto('NIT 900213910');
  assert.ok(cifraApareceEnTexto(900213910, cifras));
  assert.strictEqual(cifraApareceEnTexto(900, cifras), false);
});

test('sin geometría en los fragmentos, cada uno sigue siendo su propia celda', () => {
  /* Degradación: un PDF cuyos fragmentos no traen width/height se comporta como antes de
     que existiera el criterio del hueco, en vez de pegarlo todo. */
  const sinGeo = [
    { str: 'RUBRO', transform: [1, 0, 0, 1, 60, 700] },
    { str: '100', transform: [1, 0, 0, 1, 200, 700] },
  ];
  assert.deepStrictEqual(agruparEnLineas(sinGeo), ['RUBRO | 100']);
});

test('el orden de lectura no depende del orden en que pdf.js entregue los fragmentos', () => {
  const desordenados = [
    frag('187.494', 230, 700, 30),
    frag('COSTO', 60, 700, 40),
    frag('21.850.', 200, 700, 30),
  ];
  assert.deepStrictEqual(agruparEnLineas(desordenados), ['COSTO | 21.850.187.494']);
});
