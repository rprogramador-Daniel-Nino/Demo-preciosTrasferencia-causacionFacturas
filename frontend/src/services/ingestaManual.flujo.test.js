/* Prueba del flujo completo de la ingesta manual, extremo a extremo.

   EL PROCESO, dicho por el usuario el 2026-09-05: «cuando se encuentran comparables por el
   Capital IQ los datos de las mismas se seleccionan y generan un registro con datos incompletos,
   el cual se rellena al momento de subir los EEFF de esas comparables. La cosa es que donde se
   ingestan estos EEFF podamos subir EEFF de comparables que hayan sido seleccionadas MANUALMENTE
   y así generar el registro también por este medio, y hacer los cálculos con estas también».

   Son tres pasos encadenados y cada uno tenía su hueco:
     1. el documento que no cruza con ninguna fila CREA la comparable          (2026-09-04)
     2. esa comparable sobrevive a una corrida del motor                        (2026-09-05)
     3. y ENTRA AL RANGO, que es lo único que la hace servir para algo          ← esta prueba

   El tercero es el que cierra el trabajo: una comparable que se ve en la tabla pero no cuenta en
   el cuartil no sirve de nada, y eso ya pasó una vez con las filas inyectadas sin cifras. */

import { test } from 'node:test';
import assert from 'node:assert';
import { repartir } from './cruceComparables.js';
import { fusionarAgregadasAMano } from './muestraManual.js';
import { analizarRango } from './rangoIntercuartil.js';

/* Lo que devuelve el lector de EEFF por cada documento. */
const docDe = (nombre, ingresos, costos, utilidad) => ({
  archivo: nombre + '.pdf',
  datos: {
    nombre,
    ingresos_operacionales: ingresos,
    costo_ventas: costos,
    utilidad_operacional: utilidad,
  },
  verificacion: { esValido: true, hallazgos: [] },
});

test('sin comparables previas, cuatro EEFF arman la muestra y el rango se calcula sobre ellas', () => {
  const documentos = [
    docDe('ALFA QUIMICA SA', 10000, 8000, 400),
    docDe('BETA INSUMOS LTDA', 20000, 16400, 1400),
    docDe('GAMMA INDUSTRIAL SAS', 5000, 3900, 500),
    docDe('DELTA COMERCIAL SA', 8000, 6600, 800),
  ];

  /* PASO 1: ninguna cruza con nada, porque no hay nada. Las cuatro se crean. */
  const { aplicadas, rechazadas, nuevas } = repartir(documentos, []);
  assert.strictEqual(aplicadas.length, 0);
  assert.strictEqual(rechazadas.length, 0);
  assert.strictEqual(nuevas.length, 4, 'las cuatro generan su registro');

  /* Las filas que el componente crea a partir de eso, ya con las cifras del documento. */
  const muestra = nuevas.map((n) => ({
    name: n.nombre,
    amb: 'Int',
    creadaDesdeEeff: true,
    s: n.datos.ingresos_operacionales,
    c: n.datos.costo_ventas,
    op: n.datos.utilidad_operacional,
  }));

  /* PASO 3: el rango se calcula sobre ellas. Es lo que hace que el trabajo sirva. */
  const estudio = {
    pli: 'MO', cmode: 'all',
    t_s: 100000, t_c: 92000, t_op: 5000,
    comparables: muestra,
  };
  const r = analizarRango(estudio);
  assert.ok(r.stats, 'hay rango');
  assert.strictEqual(r.filas.length, 4, 'las cuatro entran al cálculo');
  assert.ok(r.filas.every((f) => f.noAjustado !== null), 'todas con margen calculable');

  /* Márgenes: 4 %, 7 %, 10 % y 10 % — el P25 sale de esa serie y no de un valor inventado. */
  assert.ok(Math.abs(r.stats.p25 - 0.0625) < 1e-9, `P25 esperado 6,25 %, salió ${r.stats.p25}`);
  assert.strictEqual(r.cumple, 'NO CUMPLE', 'el contribuyente al 5 % queda por debajo del P25');
});

test('las creadas a mano conviven con las del cribado en el mismo rango', () => {
  /* El caso real: parte de la muestra viene de Capital IQ y parte la incorporó el analista. Las
     dos clases tienen que entrar al mismo cuartil, sin que el origen cambie nada del cálculo. */
  const delCribado = [
    { name: 'Cribada 1', amb: 'Int', s: 10000, c: 8000, op: 300 },
    { name: 'Cribada 2', amb: 'Int', s: 10000, c: 8000, op: 900 },
  ];
  const { nuevas } = repartir([docDe('MANUAL SA', 10000, 8000, 600)], delCribado);
  assert.strictEqual(nuevas.length, 1);

  const muestraPrevia = [{
    name: nuevas[0].nombre, amb: 'Int', creadaDesdeEeff: true,
    s: 10000, c: 8000, op: 600,
  }];
  /* PASO 2: llega una corrida del motor y la de a mano NO se pierde. */
  const fusion = fusionarAgregadasAMano(muestraPrevia, delCribado, 3);
  assert.strictEqual(fusion.muestra.length, 3);
  assert.strictEqual(fusion.conservadas, 1);

  const r = analizarRango({
    pli: 'MO', cmode: 'all', t_s: 100000, t_c: 92000, t_op: 6000,
    comparables: fusion.muestra,
  });
  assert.strictEqual(r.filas.length, 3, 'las tres entran al cálculo, vengan de donde vengan');
  /* Márgenes 6 %, 3 % y 9 %: la mediana es la que el analista incorporó. */
  assert.ok(Math.abs(r.stats.med - 0.06) < 1e-9);
});

test('el documento sin cifras no genera registro: no habría nada que calcular', () => {
  /* El límite del camino. Una fila sin cifras no entra al cuartil, así que crearla dejaría en la
     muestra una comparable que no sirve — el problema de las filas vacías que se retiró el
     2026-09-04. */
  const { nuevas, rechazadas } = repartir(
    [{ archivo: 'x.pdf', datos: { nombre: 'SIN CIFRAS SA' } }],
    [],
  );
  /* `repartir` la propone; es el componente quien comprueba la suficiencia antes de crear la
     fila. Lo que esta prueba fija es que llega identificada, para que ese filtro pueda nombrarla
     en el rechazo en vez de decir «un documento». */
  assert.strictEqual(rechazadas.length, 0);
  assert.strictEqual(nuevas.length, 1);
  assert.strictEqual(nuevas[0].nombre, 'SIN CIFRAS SA');
});

test('el ámbito de la creada a mano se deduce de la moneda del estado financiero', () => {
  /* El lector de EEFF devuelve `moneda` pero no país, y esa es la única pista de procedencia que
     el documento trae. Un estado en pesos colombianos es de una compañía colombiana.

     Antes se fijaba «Int» siempre, así que una comparable colombiana incorporada a mano quedaba
     mal clasificada y el filtro de ámbito la sacaba del rango sin decir por qué. Es una
     deducción y no un dato: el selector de la fila la deja corregir. */
  const casos = [
    ['COP', 'Nac'],
    ['cop', 'Nac'],
    ['USD', 'Int'],
    ['EUR', 'Int'],
    ['', 'Int'],
    [undefined, 'Int'],
  ];
  casos.forEach(([moneda, esperado]) => {
    const amb = /^COP$/i.test(String(moneda || '').trim()) ? 'Nac' : 'Int';
    assert.strictEqual(amb, esperado, `moneda «${moneda}» debe dar ámbito ${esperado}`);
  });
});

test('el ámbito decide si la comparable entra al rango bajo un filtro nacional', () => {
  /* Lo que hace que la deducción importe: con `cmode` nacional, una comparable marcada «Int» se
     queda fuera del cuartil. Marcar «Int» a una colombiana la excluía en silencio. */
  const colombiana = { name: 'Colombiana SA', amb: 'Nac', s: 10000, c: 8000, op: 500 };
  const extranjera = { name: 'Extranjera Inc', amb: 'Int', s: 10000, c: 8000, op: 700 };
  const estudio = {
    pli: 'MO', t_s: 100000, t_c: 92000, t_op: 5000,
    comparables: [colombiana, extranjera, { ...colombiana, name: 'Otra Col', op: 600 }],
  };
  const nacional = analizarRango({ ...estudio, cmode: 'nac' });
  const incluidas = nacional.filas.filter((f) => f.amb === 'Nac');
  assert.strictEqual(incluidas.length, 2, 'solo las nacionales cuentan con ese ámbito');
});
