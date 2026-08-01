import { test } from 'node:test';
import assert from 'node:assert';
import {
  cruzar,
  esCruceFirme,
  motivoCruce,
  motivoRechazoEnFila,
  parecido,
  repartir,
  tokensNombre,
  UMBRAL_TOKENS,
} from './cruceComparables.js';

const COMPARABLES = [
  { name: 'GLOBANT S.A.', id: 'IQ4295856' },
  { name: 'ENDAVA PLC', id: 'IQ253546' },
  { name: 'EPAM SYSTEMS INC', id: 'IQ32307058' },
];

/* ─── Tokens y parecido ─── */

test('las palabras que no distinguen una empresa no cuentan', () => {
  assert.ok(!tokensNombre('HOLDING GROUP COLOMBIA').length,
    'HOLDING, GROUP y COLOMBIA no deberían contar como palabras distintivas');
  assert.ok(tokensNombre('GLOBANT S.A.').includes('GLOBANT'));
});

test('dos holdings sin relación no se parecen', () => {
  assert.strictEqual(parecido('HOLDING GROUP COLOMBIA', 'COLOMBIA HOLDING SERVICES'), 0);
});

test('la misma empresa escrita distinto se parece por encima del umbral', () => {
  assert.ok(parecido('EPAM SYSTEMS INC', 'EPAM SYSTEMS') >= UMBRAL_TOKENS);
});

/* ─── Cascada de cruce ─── */

test('cruza por identificador de la fuente cuando está', () => {
  const c = cruzar({ nombre: 'nombre ilegible', identificador_fuente: 'iq253546' }, 'x.pdf', COMPARABLES);
  assert.strictEqual(c.modo, 'id');
  assert.strictEqual(c.comparable.name, 'ENDAVA PLC');
  assert.ok(esCruceFirme(c), 'un cruce por identificador es firme');
});

test('cruza por razón social aunque cambie el sufijo societario', () => {
  const c = cruzar({ nombre: 'Globant SAS' }, 'archivo-cualquiera.pdf', COMPARABLES);
  assert.strictEqual(c.modo, 'nombre');
  assert.strictEqual(c.comparable.name, 'GLOBANT S.A.');
  assert.ok(esCruceFirme(c));
});

test('cruza por el nombre del archivo cuando el documento no trae razón social', () => {
  const c = cruzar({ nombre: '' }, 'ENDAVA PLC.pdf', COMPARABLES);
  assert.strictEqual(c.modo, 'archivo');
  assert.strictEqual(c.comparable.name, 'ENDAVA PLC');
  assert.ok(!esCruceFirme(c), 'el nombre del archivo no es prueba suficiente: debe quedar por confirmar');
});

test('cruza por solapamiento de palabras y queda por confirmar', () => {
  const c = cruzar({ nombre: 'EPAM SYSTEMS DELAWARE HOLDINGS' }, 'x.pdf', COMPARABLES);
  assert.strictEqual(c.modo, 'tokens');
  assert.strictEqual(c.comparable.name, 'EPAM SYSTEMS INC');
  assert.ok(!esCruceFirme(c), 'un cruce por palabras debe quedar por confirmar');
});

test('una empresa ajena no cruza, y se informa la candidata más cercana', () => {
  const c = cruzar({ nombre: 'BANCOLOMBIA S.A.' }, 'bancolombia.pdf', COMPARABLES);
  assert.strictEqual(c.indice, -1);
  assert.strictEqual(c.modo, 'sin-cruce');
  const motivo = motivoCruce(c, { nombre: 'BANCOLOMBIA S.A.' }, 'bancolombia.pdf');
  assert.ok(motivo.includes('BANCOLOMBIA'), 'el motivo debe decir qué empresa se leyó');
  assert.ok(/no está entre las comparables|no se parece a ninguna/.test(motivo),
    'el motivo debe explicar que no está entre las comparables');
});

test('el motivo de un cruce dudoso trae el porcentaje y pide confirmación', () => {
  const c = cruzar({ nombre: 'EPAM SYSTEMS DELAWARE HOLDINGS' }, 'x.pdf', COMPARABLES);
  const motivo = motivoCruce(c, { nombre: 'EPAM SYSTEMS DELAWARE HOLDINGS' }, 'x.pdf');
  assert.ok(/%/.test(motivo), 'falta el porcentaje de coincidencia');
  assert.ok(/confírmalo/i.test(motivo), 'no pide confirmar un cruce que no es firme');
});

/* ─── Rechazo al cargar en una fila concreta ─── */

test('el motivo de rechazo en fila nombra las dos empresas y no culpa al usuario', () => {
  const motivo = motivoRechazoEnFila({ nombre: 'BANCOLOMBIA S.A.' }, COMPARABLES[0], 'banco.pdf');
  assert.ok(motivo.includes('BANCOLOMBIA'), 'falta la empresa del documento');
  assert.ok(motivo.includes('GLOBANT'), 'falta la comparable de destino');
  assert.ok(/No se aplicaron las cifras/.test(motivo), 'no queda claro que no se aplicó nada');
  assert.ok(/carga masiva/.test(motivo), 'no ofrece la salida al usuario');
});

/* ─── Reparto de un lote ─── */

test('reparte cada empresa a su fila y rechaza las ajenas con motivo', () => {
  const entradas = [
    { datos: { nombre: 'GLOBANT S.A.' }, archivo: 'lote.pdf', verificacion: { esValido: true, hallazgos: [] } },
    { datos: { nombre: 'BANCOLOMBIA S.A.' }, archivo: 'lote.pdf', verificacion: { esValido: true, hallazgos: [] } },
    { datos: { nombre: 'ENDAVA PLC' }, archivo: 'lote.pdf', verificacion: { esValido: true, hallazgos: [] } },
  ];
  const { aplicadas, rechazadas } = repartir(entradas, COMPARABLES);

  assert.strictEqual(aplicadas.length, 2, 'debieron aplicarse Globant y Endava');
  assert.strictEqual(rechazadas.length, 1, 'debió rechazarse Bancolombia');
  assert.ok(rechazadas[0].motivo.includes('BANCOLOMBIA'), 'el rechazo no dice de qué empresa era el documento');

  const destinos = aplicadas.map((a) => COMPARABLES[a.indice].name).sort();
  assert.deepStrictEqual(destinos, ['ENDAVA PLC', 'GLOBANT S.A.']);
});

test('ninguna fila recibe dos documentos: gana el cruce más firme', () => {
  /* El dudoso se procesa después del firme aunque venga primero en la lista. Sin
     el orden por confianza, el primero en llegar se queda la fila y el bueno
     acabaría rechazado. */
  const entradas = [
    { datos: { nombre: 'EPAM SYSTEMS DELAWARE HOLDINGS' }, archivo: 'dudoso.pdf', verificacion: { esValido: true, hallazgos: [] } },
    { datos: { nombre: 'EPAM SYSTEMS INC', identificador_fuente: 'IQ32307058' }, archivo: 'firme.pdf', verificacion: { esValido: true, hallazgos: [] } },
  ];
  const { aplicadas, rechazadas } = repartir(entradas, COMPARABLES);

  assert.strictEqual(aplicadas.length, 1, 'solo uno debía entrar en la fila de EPAM');
  assert.strictEqual(aplicadas[0].archivo, 'firme.pdf', 'entró el dudoso en lugar del que trae identificador');
  assert.strictEqual(rechazadas.length, 1);
  assert.ok(/ya se aplicó/.test(rechazadas[0].motivo), 'el motivo no explica que la fila ya estaba ocupada');
});

test('un lote sin ninguna coincidencia no aplica nada y lo explica todo', () => {
  const entradas = [
    { datos: { nombre: 'ECOPETROL S.A.' }, archivo: 'a.pdf', verificacion: { esValido: true, hallazgos: [] } },
    { datos: { nombre: 'AVIANCA HOLDINGS' }, archivo: 'b.pdf', verificacion: { esValido: true, hallazgos: [] } },
  ];
  const { aplicadas, rechazadas } = repartir(entradas, COMPARABLES);
  assert.strictEqual(aplicadas.length, 0);
  assert.strictEqual(rechazadas.length, 2);
  rechazadas.forEach((r) => assert.ok(r.motivo && r.motivo.length > 20, 'todo rechazo necesita su motivo'));
});

test('sin comparables cargadas no se aplica nada, en vez de fallar', () => {
  const { aplicadas, rechazadas } = repartir(
    [{ datos: { nombre: 'GLOBANT S.A.' }, archivo: 'x.pdf', verificacion: { esValido: true, hallazgos: [] } }],
    []
  );
  assert.strictEqual(aplicadas.length, 0);
  assert.strictEqual(rechazadas.length, 1);
});
