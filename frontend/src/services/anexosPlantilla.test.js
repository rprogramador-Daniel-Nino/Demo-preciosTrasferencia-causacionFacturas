import { test } from 'node:test';
import assert from 'node:assert';
import {
  interpretarEncabezadoAnexo, esEntradaDeIndice, resolverAnexos, rotuloAnexo,
  nombreDeAnexo, claveDeAnexo,
} from './anexosPlantilla.js';

/* Los encabezados de las dos plantillas reales con las que se ha verificado esto. El informe
   de referencia numera A, B, C, D, E; el de MC Internacional A, C, D, F, E —sin B, y con la
   matriz de rechazo en el D—. */
const END_GAME = [
  'ANEXO A. Estados financieros END GAME INTERACTIVE COLOMBIA SAS',
  'ANEXO B. Descripciones de comparables y Estados Financieros',
  'ANEXO C. Matriz de Rechazo',
  'ANEXO D. Metodología de los ajustes económicos',
  'ANEXO E. Legislación Colombiana en materia de Precios de Transferencia',
];
const MC_INTERNACIONAL = [
  'ANEXO A. Estados Financieros',
  'ANEXO C. Descripciones de comparables y Estados Financieros',
  'ANEXO D. Matriz de Rechazo',
  'ANEXO F. Metodología de los ajustes económicos',
  'ANEXO E. Legislación Colombiana en materia de Precios de Transferencia',
];

const resolver = (titulos) => resolverAnexos(titulos.map(interpretarEncabezadoAnexo));

test('reconoce un encabezado de anexo y separa su letra de su nombre', () => {
  const a = interpretarEncabezadoAnexo('ANEXO C. Descripciones de comparables y Estados Financieros');
  assert.strictEqual(a.letra, 'C');
  assert.strictEqual(a.nombre, 'Descripciones de comparables y Estados Financieros');
  assert.strictEqual(a.clave, 'descripciones de comparables y estados financieros');
});

test('acepta los separadores que usan las plantillas', () => {
  ['ANEXO D: Matriz de Rechazo', 'ANEXO D) Matriz de Rechazo', 'ANEXO D - Matriz de Rechazo']
    .forEach((t) => assert.strictEqual(interpretarEncabezadoAnexo(t).letra, 'D', t));
});

test('no confunde con un encabezado lo que no lo es', () => {
  /* «ANEXOS» abre la sección pero no es un anexo, y la prosa que menciona uno tampoco: sin
     este filtro el relleno se escribía sobre un párrafo del cuerpo, porque se toma el
     primero que aparece. */
  ['ANEXOS', 'VIII. ANEXOS', 'ANEXO A',
    'ANEXO A se presentan los estados financieros de la Compañía y sus notas',
    'En el anexo C se detallan las compañías descartadas'].forEach((t) =>
    assert.strictEqual(interpretarEncabezadoAnexo(t), null, t));
});

test('descarta las entradas del índice por cómo terminan', () => {
  /* Con el número de página pegado al título, que es como se lee un campo TOC, o detrás de
     los puntos de relleno. */
  assert.ok(esEntradaDeIndice('ANEXO A. Estados Financieros52'));
  assert.ok(esEntradaDeIndice('ANEXO D. Matriz de Rechazo . 95'));
  assert.strictEqual(interpretarEncabezadoAnexo('ANEXO A. Estados Financieros52'), null);

  /* Pero un anexo puede llamarse «Estados financieros 2024»: descartarlo dejaría el anexo del
     cuerpo sin rellenar, que es el fallo contrario y se nota igual de tarde. */
  assert.ok(!esEntradaDeIndice('ANEXO A. Estados financieros 2024'));
  assert.strictEqual(interpretarEncabezadoAnexo('ANEXO A. Estados financieros 2024').letra, 'A');
});

test('resuelve cada anexo por su nombre en las dos numeraciones conocidas', () => {
  const eg = resolver(END_GAME);
  assert.deepStrictEqual(
    [eg.eeff.letra, eg.descripciones.letra, eg.matriz.letra], ['A', 'B', 'C']);

  const mc = resolver(MC_INTERNACIONAL);
  assert.deepStrictEqual(
    [mc.eeff.letra, mc.descripciones.letra, mc.matriz.letra], ['A', 'C', 'D'],
    'sin ANEXO B, y con la matriz en el D');
});

test('el anexo de comparables no le roba el suyo al contribuyente', () => {
  /* En las dos plantillas el anexo de comparables se titula «Descripciones de comparables Y
     ESTADOS FINANCIEROS», así que resolver «estados financieros» primero se lo llevaría a él
     y el anexo del contribuyente se radicaría con las cifras del cliente anterior. */
  const r = resolver([
    'ANEXO C. Descripciones de comparables y Estados Financieros',
    'ANEXO A. Estados Financieros',
  ]);
  assert.strictEqual(r.descripciones.letra, 'C');
  assert.strictEqual(r.eeff.letra, 'A');
});

test('reconoce un nombre abreviado cuando no hay uno más específico', () => {
  const r = resolver(['ANEXO B. Descripciones', 'ANEXO C. Matriz']);
  assert.strictEqual(r.descripciones.letra, 'B');
  assert.strictEqual(r.matriz.letra, 'C');
});

test('lo específico gana a lo genérico aunque aparezca después', () => {
  const r = resolver(['ANEXO B. Descripciones', 'ANEXO C. Descripciones de comparables']);
  assert.strictEqual(r.descripciones.letra, 'C', 'el nombre completo manda');
});

test('un anexo que no está no se resuelve con otro', () => {
  const r = resolver(['ANEXO A. Estados Financieros', 'ANEXO B. Legislación Colombiana']);
  assert.strictEqual(r.eeff.letra, 'A');
  assert.strictEqual(r.descripciones, undefined);
  assert.strictEqual(r.matriz, undefined);
});

test('el rótulo se compone con la letra de la plantilla', () => {
  assert.strictEqual(rotuloAnexo('matriz', 'D'), 'ANEXO D. Matriz de Rechazo');
  assert.strictEqual(rotuloAnexo('eeff', 'A', { entidad: 'MC INTERNACIONAL S.A.S.' }),
    'ANEXO A. Estados financieros MC INTERNACIONAL S.A.S.');
  assert.strictEqual(rotuloAnexo('eeff', 'A'), 'ANEXO A. Estados financieros');
});

test('el nombre con el que se avisa no lleva letra', () => {
  /* Si hay que nombrar un anexo en un aviso es porque no se encontró, y entonces no hay letra
     que citar: la del informe de referencia no vale para todas las plantillas. */
  assert.strictEqual(nombreDeAnexo('matriz'), 'Matriz de Rechazo');
  assert.ok(!nombreDeAnexo('descripciones').includes('ANEXO'));
});

test('la clave normaliza tildes, mayúsculas y puntuación', () => {
  assert.strictEqual(claveDeAnexo('Metodología de los AJUSTES económicos'),
    'metodologia de los ajustes economicos');
});
