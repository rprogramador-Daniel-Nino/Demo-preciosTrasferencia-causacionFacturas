/* Tests de la ubicación de cada cifra dentro del estado financiero.

   Lo que se prueba aquí es la defensa que `cifraApareceEnTexto` no puede dar: esa comprueba
   que una cifra esté impresa en ALGÚN sitio del documento, así que una tomada de la columna
   del ejercicio anterior o de la fila vecina la pasa intacta. Estas pruebas fijan que se
   detecte de qué columna y de qué fila salió de verdad.

   Las geometrías no son inventadas: salen de medir los seis estados financieros reales del
   usuario con el mismo algoritmo del sistema. Las tres que aparecen aquí son los tres
   layouts distintos que se encontraron —PFI con columna de notas, HH Colombia con los
   valores vacíos impresos como «-», Inmotion con el signo de pesos en celda propia— porque
   son los tres que hoy hacen fallar la lectura. */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  filasConColumnas, encabezadoDeAnios, asignarAnios, esCeldaDeCifra,
  seccionQueAbre, seccionesDeFilas, estructuraDeFilas, ubicacionDeCifra, textoAnotado,
} from './eeffColumnas.js';

/* Una celda por su borde derecho, que es por donde se compara la columna: las cifras van
   alineadas a la derecha. */
const celda = (texto, derecha, ancho = 40) => ({ x: derecha - ancho, derecha, texto });
const fila = (y, celdas) => ({ y, celdas });

/* ══════════ PFI: «rótulo | nota | 2025 | 2024», y sin nota solo tres celdas ══════════
   Medido: encabezado 2025@348 y 2024@420, así que la tolerancia sale 36. La columna de
   notas queda en 250, a 98 puntos de la primera de cifras: fuera por mucho. */
const PFI_ENCABEZADO = fila(700, [celda('2025', 348), celda('2024', 420)]);
const PFI_INVENTARIOS = fila(600, [
  celda('Inventarios', 180, 120), celda('19', 250, 12),
  celda('7,636,521,401', 348, 70), celda('4,542,840,983', 420, 70),
]);
const PFI_OTRAS_CXC = fila(620, [
  celda('Otras cuentas por cobrar', 200, 140), celda('17', 250, 12),
  celda('906,935,410', 348, 60), celda('901,890,580', 420, 60),
]);
/* La fila de subtotal, SIN columna de notas: es la que hace que el valor del ejercicio
   cambie de posición dentro del mismo documento. */
const PFI_TOTAL_CORRIENTE = fila(580, [
  celda('TOTAL ACTIVO CORRIENTE', 220, 160),
  celda('14,099,264,924', 348, 70), celda('11,515,819,752', 420, 70),
]);

const estructuraPFI = () => estructuraDeFilas([{
  numero: 1,
  filas: [
    fila(720, [celda('ACTIVOS', 120, 60)]),
    PFI_ENCABEZADO, PFI_OTRAS_CXC, PFI_INVENTARIOS, PFI_TOTAL_CORRIENTE,
  ],
}]);

test('encabezadoDeAnios reconoce el encabezado y deriva la tolerancia del propio documento', () => {
  const enc = encabezadoDeAnios([PFI_ENCABEZADO, PFI_INVENTARIOS]);
  assert.ok(enc);
  assert.deepEqual(enc.columnas.map((c) => c.anio), ['2025', '2024']);
  /* La mitad de la distancia entre columnas contiguas: (420 − 348) / 2. */
  assert.equal(enc.tolerancia, 36);
});

test('un año suelto en un título no es un encabezado de columnas', () => {
  const titulo = fila(760, [celda('ESTADO DE SITUACION FINANCIERA 2025', 300, 240)]);
  assert.equal(encabezadoDeAnios([titulo]), null);
});

test('una frase con dos años entre muchas celdas tampoco lo es', () => {
  /* «POR LOS AÑOS TERMINADOS AL 31 DE DICIEMBRE 2025 Y 2024» si el maquetado la parte:
     los años son dos de nueve celdas, así que no manda. Sin esta guarda todas las columnas
     del documento quedarían corridas, que es peor que no anotar nada. */
  const prosa = fila(750, [
    celda('POR', 60, 30), celda('LOS', 95, 30), celda('AÑOS', 130, 35),
    celda('TERMINADOS', 200, 65), celda('AL', 225, 20), celda('31', 250, 15),
    celda('DICIEMBRE', 320, 65), celda('2025', 360, 35), celda('2024', 400, 35),
  ]);
  assert.equal(encabezadoDeAnios([prosa]), null);
});

test('asignarAnios etiqueta las cifras y deja la columna de notas fuera', () => {
  const enc = encabezadoDeAnios([PFI_ENCABEZADO]);
  const anios = asignarAnios(PFI_INVENTARIOS, enc);
  const porTexto = new Map([...anios].map(([c, a]) => [c.texto, a]));
  assert.equal(porTexto.get('7,636,521,401'), '2025');
  assert.equal(porTexto.get('4,542,840,983'), '2024');
  assert.equal(porTexto.get('19'), undefined, 'el número de la nota no es una cifra del ejercicio');
  assert.equal(porTexto.get('Inventarios'), undefined);
});

test('en una fila de subtotal, sin nota, el valor del ejercicio sigue siendo el del ejercicio', () => {
  /* Es el defecto que hacía fallar la lectura: aquí el valor de 2025 está en la celda 1 y en
     la fila de arriba en la celda 2. Por posición no se puede resolver; por columna sí. */
  const enc = encabezadoDeAnios([PFI_ENCABEZADO]);
  const anios = asignarAnios(PFI_TOTAL_CORRIENTE, enc);
  const porTexto = new Map([...anios].map(([c, a]) => [c.texto, a]));
  assert.equal(porTexto.get('14,099,264,924'), '2025');
  assert.equal(porTexto.get('11,515,819,752'), '2024');
});

test('una nota dentro de la tolerancia no le roba la columna a la cifra de verdad', () => {
  /* En HH Colombia la tolerancia sale 71 y la nota queda a 64 puntos: a diez de que el valor
     del ejercicio se atribuyera al número de la nota. Cada columna se queda con la celda MÁS
     CERCANA, así que la cifra gana. */
  const enc = { columnas: [{ anio: '2025', derecha: 394 }, { anio: '2024', derecha: 537 }], tolerancia: 71.5 };
  const conNotaCerca = fila(500, [
    celda('Efectivo y equivalentes en efectivo', 300, 220),
    celda('5', 330, 10),
    celda('2.048.014', 394, 55), celda('5.314.569', 537, 55),
  ]);
  const porTexto = new Map([...asignarAnios(conNotaCerca, enc)].map(([c, a]) => [c.texto, a]));
  assert.equal(porTexto.get('2.048.014'), '2025');
  assert.equal(porTexto.get('5'), undefined);
});

test('el signo de pesos en celda propia no recibe etiqueta de ejercicio', () => {
  /* Layout de Inmotion: «rótulo | $ | 2025 | $ | 2024». */
  const enc = { columnas: [{ anio: '2025', derecha: 347 }, { anio: '2024', derecha: 486 }], tolerancia: 69 };
  const conPesos = fila(500, [
    celda('Inventario', 200, 100), celda('$', 290, 8),
    celda('404.377.809', 347, 60), celda('$', 430, 8), celda('119.817.936', 486, 60),
  ]);
  const porTexto = new Map([...asignarAnios(conPesos, enc)].map(([c, a]) => [c.texto, a]));
  assert.equal(porTexto.get('404.377.809'), '2025');
  assert.equal(porTexto.get('119.817.936'), '2024');
  assert.equal(porTexto.get('$'), undefined);
});

test('un rubro que el ejercicio no reporta se etiqueta igual, con su guion', () => {
  /* HH Colombia, «Intangible | 8 | - | 4.146»: el valor del ejercicio es vacío y 4.146 es
     del anterior. Etiquetar el guion es lo que impide que el modelo tome 4.146. */
  const enc = { columnas: [{ anio: '2025', derecha: 394 }, { anio: '2024', derecha: 537 }], tolerancia: 71.5 };
  const intangible = fila(400, [
    celda('Intangible', 250, 80), celda('8', 330, 10),
    celda('-', 394, 6), celda('4.146', 537, 35),
  ]);
  const porTexto = new Map([...asignarAnios(intangible, enc)].map(([c, a]) => [c.texto, a]));
  assert.equal(porTexto.get('-'), '2025');
  assert.equal(porTexto.get('4.146'), '2024');
});

test('esCeldaDeCifra rechaza la prosa que `num()` sí convertiría', () => {
  /* `num('Comparativo 31 de Diciembre de 2025 y 2024')` devuelve 3120252024, porque está
     hecho para rescatar la cifra que teclea un analista. Si eso contara como cifra, el
     título de la portada recibiría etiqueta de ejercicio. */
  assert.equal(esCeldaDeCifra('Comparativo 31 de Diciembre de 2025 y 2024'), false);
  assert.equal(esCeldaDeCifra('PFI GROUP INC. SUCURSAL COLOMBIA'), false);
  assert.equal(esCeldaDeCifra('A diciembre 31 de'), false);
  assert.equal(esCeldaDeCifra('3,532,784,816'), true);
  assert.equal(esCeldaDeCifra('2.048.014'), true);
  assert.equal(esCeldaDeCifra('(1.500)'), true);
  assert.equal(esCeldaDeCifra('-'), true);
  assert.equal(esCeldaDeCifra('0'), true);
});

test('las secciones se abren por el rótulo de la fila, y un total no abre ninguna', () => {
  assert.equal(seccionQueAbre(fila(0, [celda('ACTIVOS', 100, 60)])), 'ACTIVO');
  assert.equal(seccionQueAbre(fila(0, [celda('ACTIVOS CORRIENTES:', 140, 120)])), 'ACTIVO');
  assert.equal(seccionQueAbre(fila(0, [celda('PASIVO Y PATRIMONIO NETO', 180, 160)])), 'PASIVO');
  assert.equal(seccionQueAbre(fila(0, [celda('PATRIMONIO', 120, 80)])), 'PATRIMONIO');
  assert.equal(seccionQueAbre(fila(0, [celda('ESTADO DE RESULTADO INTEGRAL', 200, 180)])), 'RESULTADOS');
  assert.equal(seccionQueAbre(fila(0, [celda('INGRESOS DE ACTIVIDADES ORDINARIAS', 220, 200)])), 'RESULTADOS');
  /* Un total CIERRA su grupo, no abre sección: por eso los patrones van anclados. */
  assert.equal(seccionQueAbre(fila(0, [celda('TOTAL ACTIVO', 120, 80)])), null);
  assert.equal(seccionQueAbre(fila(0, [celda('Inventarios', 120, 80)])), null);
});

test('seccionesDeFilas arrastra la última sección abierta', () => {
  const filas = [
    fila(700, [celda('ACTIVOS', 100, 60)]),
    fila(680, [celda('Inventarios', 120, 80)]),
    fila(660, [celda('PASIVOS', 100, 60)]),
    fila(640, [celda('Proveedores', 120, 80)]),
  ];
  assert.deepEqual(seccionesDeFilas(filas).map((x) => x.seccion),
    ['ACTIVO', 'ACTIVO', 'PASIVO', 'PASIVO']);
});

/* ══════════ Los cuatro veredictos ══════════ */

test('la cifra del ejercicio pedido coincide', () => {
  const r = ubicacionDeCifra(estructuraPFI(), {
    rotulo: 'Inventarios', valor: 7636521401, anio: '2025',
  });
  assert.equal(r.veredicto, 'coincide');
  assert.equal(r.seccion, 'ACTIVO');
});

test('la cifra del ejercicio ANTERIOR se detecta y se dice cuál era la correcta', () => {
  /* El error más probable en un estado comparativo, y el que la verificación por documento
     no puede ver: 4.542.840.983 está impresa, solo que en la columna de 2024. */
  const r = ubicacionDeCifra(estructuraPFI(), {
    rotulo: 'Inventarios', valor: 4542840983, anio: '2025',
  });
  assert.equal(r.veredicto, 'otro-anio');
  assert.equal(r.anioHallado, '2024');
  assert.equal(r.esperado.texto, '7,636,521,401');
});

test('la cifra de la fila vecina se detecta y se nombra el rubro al que pertenece', () => {
  const r = ubicacionDeCifra(estructuraPFI(), {
    rotulo: 'Inventarios', valor: 906935410, anio: '2025',
  });
  assert.equal(r.veredicto, 'otra-fila');
  assert.match(r.rotuloReal, /Otras cuentas por cobrar/);
  assert.equal(r.esperado.texto, '7,636,521,401');
});

test('el número de una nota no pasa por cifra del rubro', () => {
  const r = ubicacionDeCifra(estructuraPFI(), {
    rotulo: 'Inventarios', valor: 19, anio: '2025',
  });
  assert.equal(r.veredicto, 'fuera-de-columna');
  assert.equal(r.esperado.texto, '7,636,521,401');
});

test('un rótulo que la lectura parafraseó no se puede verificar, y no se descarta nada', () => {
  /* Es deliberado que degrade en vez de fallar: un falso negativo descartaría una cifra
     buena del estado financiero y le diría al analista que la lectura se la inventó. */
  const r = ubicacionDeCifra(estructuraPFI(), {
    rotulo: 'Existencias de mercancía', valor: 7636521401, anio: '2025',
  });
  assert.equal(r.veredicto, 'sin-verificar');
});

test('sin encabezado de ejercicios no se afirma nada', () => {
  const sinEncabezado = estructuraDeFilas([{ numero: 1, filas: [PFI_INVENTARIOS] }]);
  const r = ubicacionDeCifra(sinEncabezado, {
    rotulo: 'Inventarios', valor: 7636521401, anio: '2025',
  });
  assert.equal(r.veredicto, 'sin-verificar');
});

/* ══════════ El texto que va al prompt ══════════ */

test('textoAnotado etiqueta solo las cifras y marca las secciones', () => {
  const salida = textoAnotado(estructuraPFI());
  assert.match(salida, /--- SECCIÓN: ACTIVO ---/);
  assert.match(salida, /Inventarios \| 19 \| \[2025\] 7,636,521,401 \| \[2024\] 4,542,840,983/);
  /* El subtotal sin nota, con su valor del ejercicio bien atribuido pese a estar en otra
     posición dentro de la fila. */
  assert.match(salida, /TOTAL ACTIVO CORRIENTE \| \[2025\] 14,099,264,924/);
  /* Y el rótulo de la sección, que no es una cifra, sin etiqueta. */
  assert.doesNotMatch(salida, /\[20\d\d\] ACTIVOS/);
});

/* ══════════ Agrupado de fragmentos, con la geometría de pdf.js ══════════ */

test('filasConColumnas agrupa por línea base y parte las celdas por el hueco', () => {
  const item = (str, x, y, ancho, alto = 10) => ({
    str, width: ancho, height: alto, transform: [1, 0, 0, 1, x, y],
  });
  /* Misma fila desalineada por una fracción de punto, como llegan de verdad, y dos trozos
     contiguos que son la misma celda («2» y «025» de un año partido por el generador). */
  const filas = filasConColumnas([
    item('Inventarios', 60, 600.4, 60),
    item('7.636', 300, 600, 30),
    item('.521.401', 330, 599.8, 45),
    item('4.542.840.983', 420, 600.2, 70),
  ]);
  assert.equal(filas.length, 1);
  assert.deepEqual(filas[0].celdas.map((c) => c.texto),
    ['Inventarios', '7.636.521.401', '4.542.840.983']);
});

test('dos líneas base separadas por más que la tolerancia son dos filas', () => {
  const item = (str, x, y) => ({ str, width: 40, height: 10, transform: [1, 0, 0, 1, x, y] });
  const filas = filasConColumnas([item('Inventarios', 60, 600), item('Efectivo', 60, 580)]);
  assert.equal(filas.length, 2);
  /* De arriba abajo: en el sistema de coordenadas del PDF la Y crece hacia arriba. */
  assert.deepEqual(filas.map((f) => f.celdas[0].texto), ['Inventarios', 'Efectivo']);
});
