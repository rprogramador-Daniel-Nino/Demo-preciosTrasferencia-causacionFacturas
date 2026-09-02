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
  /* El encabezado se valida contra las cifras que trae debajo (ver `cifrasExplicadas`), así
     que se le pasa la fila de datos junto con él: una fila de años sin nada alineado abajo no
     se acepta, y con razón — podría ser un título. */
  const enc = encabezadoDeAnios([PFI_ENCABEZADO, PFI_INVENTARIOS]);
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
  const enc = encabezadoDeAnios([PFI_ENCABEZADO, PFI_TOTAL_CORRIENTE]);
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

test('la cifra de la fila vecina se corrige con la que dice la fila del rótulo', () => {
  /* 906.935.410 es el valor de «Otras cuentas por cobrar», la fila de arriba. Antes esto
     devolvía «otra-fila» y se DESCARTABA el campo; ahora se corrige con lo que el documento
     imprime en la fila de Inventarios y en la columna de 2025. Vaciar el campo dejaba el
     estudio sin el dato; corregirlo lo deja bueno, visible y editable, y sale del propio PDF. */
  const r = ubicacionDeCifra(estructuraPFI(), {
    rotulo: 'Inventarios', valor: 906935410, anio: '2025',
  });
  assert.equal(r.veredicto, 'corregible');
  assert.equal(r.esperado.valor, 7636521401, 'la cifra que sí corresponde');
  assert.equal(r.esperado.texto, '7,636,521,401');
  assert.match(r.rotuloReal, /Inventarios/, 'y se nombra la fila que la sostiene');
});

test('el número de una nota se corrige con la cifra del rubro', () => {
  /* 19 es el número de la nota, no una cifra. La fila de Inventarios sí trae su valor de 2025:
     esa es la que vale. */
  const r = ubicacionDeCifra(estructuraPFI(), {
    rotulo: 'Inventarios', valor: 19, anio: '2025',
  });
  assert.equal(r.veredicto, 'corregible');
  assert.equal(r.esperado.valor, 7636521401);
});

test('con la columna del año en «-» no se corrige: el ejercicio no reporta ese rubro', () => {
  /* El caso de HH Colombia, «Intangible | 8 | - | 4.146»: 2025 está vacío y 4.146 es de 2024.
     Aquí NO hay cifra que aplicar, y ponerle la de 2024 sería exactamente el defecto original. */
  const estructura = estructuraDeFilas([{
    numero: 1,
    filas: [
      fila(700, [celda('2025', 348), celda('2024', 420)]),
      fila(680, [
        celda('Inventarios', 180, 120), celda('8', 250, 10),
        celda('-', 348, 6), celda('4.146', 420, 40),
      ]),
      fila(660, [
        celda('Total activo', 200, 120),
        celda('9.000', 348, 40), celda('8.000', 420, 40),
      ]),
    ],
  }]);
  const r = ubicacionDeCifra(estructura, { rotulo: 'Inventarios', valor: 4146, anio: '2025' });
  assert.equal(r.veredicto, 'otro-anio', 'está en esa fila, pero en la columna de 2024');
  assert.equal(r.esperado.valor, null, 'y no hay cifra de 2025 con que reemplazarla');
});

test('un rótulo repetido: manda la fila que sí trae cifra en el año pedido', () => {
  /* En Llantas Emotion «Cuentas comerciales por cobrar» aparece dos veces —en el activo
     corriente y en el no corriente—. Quedarse con la primera que aparezca es jugar a los
     dados; se prefiere la que tiene cifra en la columna del ejercicio. */
  const estructura = estructuraDeFilas([{
    numero: 1,
    filas: [
      fila(700, [celda('2025', 348), celda('2024', 420)]),
      fila(680, [
        celda('Cuentas comerciales por cobrar', 200, 160),
        celda('-', 348, 6), celda('-', 420, 6),
      ]),
      fila(660, [
        celda('Cuentas comerciales por cobrar', 200, 160),
        celda('4.003.623.665', 348, 70), celda('3.900.000.000', 420, 70),
      ]),
    ],
  }]);
  const r = ubicacionDeCifra(estructura, {
    rotulo: 'Cuentas comerciales por cobrar', valor: 777, anio: '2025',
  });
  assert.equal(r.veredicto, 'corregible');
  assert.equal(r.esperado.valor, 4003623665);
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

/* ══════════ Llantas Emotion: el encabezado con columnas de más ══════════

   Caso real, 2026-08-31, y el que destapó dos defectos que se componían. Su estado de
   resultados encabeza con `Notas | 2025 | 2024 | VARIACION | %`: cinco celdas y dos años.
   La guarda «los años son la mitad o más de las celdas» lo rechazaba —2 × 2 < 5—, así que la
   página entera quedaba sin columnas y la fila buena de COSTO DE VENTAS nunca era candidata.
   Después, el barrido por las 49 páginas encontraba la misma cifra en una nota y declaraba que
   pertenecía a otra fila: se descartaba una cifra CORRECTA, comprobable contra la identidad del
   propio estado (35.850.121.412 − 33.136.894.215 − 9.457.526.064 = −6.744.298.867).

   Las posiciones son las medidas en el PDF, incluida la desalineación del encabezado: el
   rótulo «2025» cierra en 259 y sus cifras en 284. */
const EMOTION_ENCABEZADO = fila(660, [
  celda('Notas', 211, 30), celda('2025', 259, 26), celda('2024', 385, 26),
  celda('VARIACION', 512, 60), celda('%', 560, 10),
]);
const EMOTION_INGRESOS = fila(640, [
  celda('INGRESOS DE ACTIVIDADES ORDINARIAS', 176, 170), celda('23', 205, 12),
  celda('35.850.121.412', 284, 70), celda('41.116.461.229', 412, 70),
  celda('-', 456, 6), celda('5.266.339.817', 525, 65),
]);
const EMOTION_COSTO = fila(620, [
  celda('COSTO DE VENTAS', 98, 90), celda('24', 205, 12),
  celda('33.136.894.215', 284, 70), celda('37.270.742.614', 412, 70),
  celda('-', 456, 6), celda('4.133.848.399', 525, 65),
]);

test('un encabezado con columnas de más (Notas, VARIACION, %) SÍ es un encabezado', () => {
  /* La guarda de proporción rechazaba este encabezado real y con él toda la página. */
  const enc = encabezadoDeAnios([EMOTION_ENCABEZADO, EMOTION_INGRESOS, EMOTION_COSTO]);
  assert.ok(enc, 'debe reconocerse');
  assert.deepEqual(enc.columnas.map((c) => c.anio), ['2025', '2024']);
});

test('las cifras se atribuyen bien aunque el rótulo del año no esté alineado con ellas', () => {
  /* «2025» cierra en 259 y sus cifras en 284: 25 puntos de desfase, dentro de la tolerancia
     que sale de la propia separación entre columnas. */
  const enc = encabezadoDeAnios([EMOTION_ENCABEZADO, EMOTION_INGRESOS, EMOTION_COSTO]);
  const anios = asignarAnios(EMOTION_COSTO, enc);
  const porTexto = new Map([...anios].map(([c, a]) => [c.texto, a]));
  assert.equal(porTexto.get('33.136.894.215'), '2025');
  assert.equal(porTexto.get('37.270.742.614'), '2024');
  assert.equal(porTexto.get('24'), undefined, 'el número de la nota no es cifra del ejercicio');
  assert.equal(porTexto.get('4.133.848.399'), undefined, 'ni la columna de variación');
});

test('el costo de ventas de Llantas Emotion se verifica en su fila, no se descarta', () => {
  const estructura = estructuraDeFilas([{
    numero: 2,
    filas: [
      fila(700, [celda('ESTADO DE RESULTADOS', 359, 140)]),
      EMOTION_ENCABEZADO, EMOTION_INGRESOS, EMOTION_COSTO,
    ],
  }]);
  const u = ubicacionDeCifra(estructura, {
    rotulo: 'COSTO DE VENTAS', valor: 33136894215, anio: 2025,
  });
  assert.equal(u.veredicto, 'coincide');
});

test('la misma cifra repetida en una nota NO convierte la lectura buena en «otra fila»', () => {
  /* El barrido por todo el documento encontraba 33.136.894.215 en la nota 24 —donde el
     maquetado usa comas— y con eso descartaba la cifra del estado de resultados. En un
     documento de 49 páginas cada cifra del estado aparece también en su nota: buscar el
     número por todo el archivo no puede decidir nada. */
  const estructura = estructuraDeFilas([
    {
      numero: 2,
      filas: [EMOTION_ENCABEZADO, EMOTION_INGRESOS, EMOTION_COSTO],
    },
    {
      /* La nota, con su propio encabezado y la cifra desglosada bajo otro rótulo. */
      numero: 24,
      filas: [
        fila(660, [celda('2025', 300, 26), celda('2024', 420, 26)]),
        fila(640, [
          celda('Compras de mercancía', 150, 130),
          celda('33,136,894,215', 300, 70), celda('37,270,742,614', 420, 70),
        ]),
      ],
    },
  ]);
  const u = ubicacionDeCifra(estructura, {
    rotulo: 'COSTO DE VENTAS', valor: 33136894215, anio: 2025,
  });
  assert.equal(u.veredicto, 'coincide', 'manda la fila de su propio rótulo');
});

test('el encabezado no puede ser candidato a fila de datos', () => {
  /* Se vio en pruebas: el aviso decía «en esa fila, el ejercicio 2025 dice 2025». La fila del
     encabezado entraba como candidata y su celda de la columna 2025 contiene el texto «2025». */
  const estructura = estructuraDeFilas([{
    numero: 2, filas: [EMOTION_ENCABEZADO, EMOTION_INGRESOS, EMOTION_COSTO],
  }]);
  const u = ubicacionDeCifra(estructura, { rotulo: '2025', valor: 2025, anio: 2025 });
  assert.equal(u.veredicto, 'sin-verificar', 'no se afirma nada sobre el propio encabezado');
});

test('cuando la fila del rótulo dice otra cifra, se ofrece la del documento en vez de descartar', () => {
  /* Descartar deja el campo vacío y el estudio sin margen; corregir con lo que el documento
     imprime en esa fila y esa columna deja el número bueno, visible y editable. Es información
     del propio PDF, no una interpretación. */
  const estructura = estructuraDeFilas([{
    numero: 2, filas: [EMOTION_ENCABEZADO, EMOTION_INGRESOS, EMOTION_COSTO],
  }]);
  const u = ubicacionDeCifra(estructura, {
    rotulo: 'COSTO DE VENTAS', valor: 99999999999, anio: 2025,
  });
  assert.equal(u.veredicto, 'corregible');
  assert.equal(u.esperado.valor, 33136894215, 'y trae la cifra que sí está en esa fila');
});

test('una fila de años sin cifras alineadas debajo NO se toma por encabezado', () => {
  /* Es lo que sustituye a la guarda de proporción: en vez de contar celdas, se comprueba
     contra el propio documento. Un título con dos años y nada alineado debajo no explica
     ninguna cifra, y anotar con él correría todas las columnas. */
  const soloAnios = fila(700, [celda('2025', 348), celda('2024', 420)]);
  assert.equal(encabezadoDeAnios([soloAnios]), null);
});

test('entre dos filas de años gana la que explica las cifras del documento', () => {
  /* Caso real de riesgo: un título que menciona los ejercicios ANTES del encabezado de la
     tabla. Antes mandaba el primero que apareciera; ahora manda el que cuadra con las cifras. */
  const tituloConAnios = fila(760, [celda('2025', 120, 26), celda('2024', 170, 26)]);
  const enc = encabezadoDeAnios([tituloConAnios, PFI_ENCABEZADO, PFI_INVENTARIOS, PFI_TOTAL_CORRIENTE]);
  assert.ok(enc);
  assert.equal(enc.y, PFI_ENCABEZADO.y, 'el encabezado de la tabla, no el del título');
  assert.equal(enc.columnas[0].derecha, 348);
});

/* ══════════ Corriente y no corriente ══════════

   Lo fijó el usuario el 2026-08-31: las cuentas por cobrar, las por pagar y los inventarios
   se toman del activo y del pasivo CORRIENTES. Es la distinción que decide entre dos filas
   con el MISMO rótulo, y equivocarse no vacía el campo: lo llena con una cifra creíble del
   bloque que no es, que no se nota al revisar. */

/* El balance de dos paneles de Llantas Emotion, reducido a lo que importa: el rótulo repetido
   en corriente y en no corriente. La fila «CORRIENTES | CORRIENTES» es literal del documento
   —una para el activo y otra para el pasivo, en la misma línea—. */
const estructuraDosBloques = () => estructuraDeFilas([{
  numero: 1,
  filas: [
    fila(720, [celda('ACTIVOS', 120, 60), celda('2025', 300, 26), celda('2024', 420, 26)]),
    fila(700, [celda('CORRIENTES', 130, 70)]),
    fila(680, [
      celda('Cuentas comerciales por cobrar', 200, 160),
      celda('4.003.623.665', 300, 70), celda('6.847.838.474', 420, 70),
    ]),
    fila(660, [celda('NO CORRIENTES', 150, 90)]),
    fila(640, [
      celda('Cuentas comerciales por cobrar', 200, 160),
      celda('3.697.232.608', 300, 70), celda('4.713.236.712', 420, 70),
    ]),
  ],
}]);

test('con el rótulo repetido, la subsección pedida decide cuál fila manda', () => {
  const est = estructuraDosBloques();
  const corriente = ubicacionDeCifra(est, {
    rotulo: 'Cuentas comerciales por cobrar', valor: 1, anio: '2025', subseccion: 'CORRIENTE',
  });
  assert.equal(corriente.veredicto, 'corregible');
  assert.equal(corriente.esperado.valor, 4003623665, 'la del activo corriente');

  const noCorriente = ubicacionDeCifra(est, {
    rotulo: 'Cuentas comerciales por cobrar', valor: 1, anio: '2025', subseccion: 'NO CORRIENTE',
  });
  assert.equal(noCorriente.esperado.valor, 3697232608, 'y la otra si se pide la otra');
});

test('la cifra del bloque corriente se acepta y la del no corriente se corrige', () => {
  const est = estructuraDosBloques();
  const buena = ubicacionDeCifra(est, {
    rotulo: 'Cuentas comerciales por cobrar', valor: 4003623665, anio: '2025', subseccion: 'CORRIENTE',
  });
  assert.equal(buena.veredicto, 'coincide');
  /* Y la del no corriente, atribuida al campo de capital de trabajo, se corrige en vez de
     colarse: es exactamente lo que pasaba antes en Llantas Emotion. */
  const mala = ubicacionDeCifra(est, {
    rotulo: 'Cuentas comerciales por cobrar', valor: 3697232608, anio: '2025', subseccion: 'CORRIENTE',
  });
  assert.equal(mala.veredicto, 'corregible');
  assert.equal(mala.esperado.valor, 4003623665);
});

test('sin subsección pedida no se filtra nada', () => {
  const u = ubicacionDeCifra(estructuraDosBloques(), {
    rotulo: 'Cuentas comerciales por cobrar', valor: 3697232608, anio: '2025',
  });
  assert.equal(u.veredicto, 'coincide', 'las dos filas siguen siendo válidas');
});

test('si el documento no rotula sus bloques, la preferencia no descarta la fila', () => {
  /* Es una preferencia, no un filtro: exigirla dejaría el campo vacío en todo estado que no
     imprima «CORRIENTES», que son muchos. */
  const est = estructuraDeFilas([{
    numero: 1,
    filas: [
      fila(720, [celda('ACTIVOS', 120, 60), celda('2025', 300, 26), celda('2024', 420, 26)]),
      fila(680, [
        celda('Inventarios', 200, 120),
        celda('21.381.500.956', 300, 70), celda('22.101.221.597', 420, 70),
      ]),
    ],
  }]);
  const u = ubicacionDeCifra(est, {
    rotulo: 'Inventarios', valor: 21381500956, anio: '2025', subseccion: 'CORRIENTE',
  });
  assert.equal(u.veredicto, 'coincide');
});

test('una sección nueva reinicia la subsección', () => {
  /* En un balance vertical el «CORRIENTES» del activo no puede seguir rigiendo cuando empieza
     el pasivo: si lo hiciera, una cuenta por pagar del bloque no corriente quedaría marcada
     como corriente. */
  const est = estructuraDeFilas([{
    numero: 1,
    filas: [
      fila(760, [celda('ACTIVOS', 120, 60), celda('2025', 300, 26), celda('2024', 420, 26)]),
      fila(740, [celda('CORRIENTES', 130, 70)]),
      fila(720, [celda('Inventarios', 200, 120), celda('100', 300, 30), celda('90', 420, 30)]),
      fila(700, [celda('PASIVOS', 120, 60)]),
      fila(680, [celda('Cuentas comerciales por pagar', 200, 160), celda('50', 300, 30), celda('40', 420, 30)]),
    ],
  }]);
  const filas = est.paginas[0].conSeccion;
  const pagar = filas.find((f) => /pagar/i.test(f.fila.celdas[0].texto));
  assert.equal(pagar.seccion, 'PASIVO');
  assert.equal(pagar.subseccion, null, 'el CORRIENTES del activo no se arrastra al pasivo');
});
