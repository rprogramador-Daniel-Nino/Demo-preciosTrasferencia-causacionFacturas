import { test } from 'node:test';
import assert from 'node:assert';
import { analizarRango } from './rangoIntercuartil.js';

const conComparables = {
  pli: 'MO', t_s: 100000, t_c: 80000, t_op: 10000,
  comparables: [
    { s: 1000, c: 800, op: 100 }, { s: 2000, c: 1600, op: 260 },
    { s: 3000, c: 2400, op: 300 }, { s: 4000, c: 3200, op: 520 },
  ],
};

test('con cuatro comparables sale el rango completo y ordenado', () => {
  const r = analizarRango(conComparables);
  assert.ok(r.stats, 'debería haber rango');
  assert.ok(r.stats.p25 <= r.stats.med && r.stats.med <= r.stats.p75, 'cuartiles desordenados');
});

test('con menos de tres comparables no hay rango', () => {
  assert.strictEqual(analizarRango({ ...conComparables, comparables: [{ s: 1, c: 1, op: 1 }] }).stats, null);
  assert.strictEqual(analizarRango({}).stats, null);
});

/* Comportamiento heredado de exactTemplateMapper.js. Se conserva exactamente:
   cambiarlo alteraría los informes que hoy salen por esa ruta. */
test('sin rango, la conclusión heredada sigue siendo CUMPLE', () => {
  assert.strictEqual(analizarRango({}).cumple, 'CUMPLE');
  assert.strictEqual(analizarRango({}).adj, null);
});

test('una comparable sin PLI calculable no rompe el resto', () => {
  const r = analizarRango({
    ...conComparables,
    comparables: [...conComparables.comparables, { s: null, c: null, op: null }],
  });
  assert.ok(r.stats, 'la comparable inservible debe descartarse, no tumbar el cálculo');
});

/* `filas` alimenta las tablas 17 y 19 del informe. Sale de aquí y no de un cálculo
   aparte para que la lista de márgenes publicada sea la misma que sustenta el rango. */
test('filas trae el margen de cada comparable, ajustado y sin ajustar', () => {
  const r = analizarRango({
    ...conComparables,
    comparables: [{ name: 'ACME LTDA', amb: 'Nac', s: 1000, c: 800, op: 100 }],
  });
  assert.strictEqual(r.filas.length, 1);
  assert.strictEqual(r.filas[0].nombre, 'ACME LTDA');
  assert.strictEqual(r.filas[0].amb, 'Nac');
  assert.strictEqual(r.filas[0].noAjustado, 0.1, 'MO = 100 / 1000');
  /* Sin `useadj` el ajuste no corre y el ajustado es el mismo margen. */
  assert.strictEqual(r.filas[0].ajustado, 0.1);
});

test('la comparable sin cifras aparece en filas con margen nulo', () => {
  /* No se omite: es parte de la muestra final y la tabla 17 la numera. Omitirla en la
     19 dejaría dos tablas de distinto tamaño sin nada que lo explique. */
  const r = analizarRango({ ...conComparables, comparables: [{ name: 'SIN DATOS S.A.', s: '', c: '', op: '' }] });
  assert.strictEqual(r.filas.length, 1);
  assert.strictEqual(r.filas[0].noAjustado, null);
  assert.strictEqual(r.filas[0].ajustado, null);
  assert.strictEqual(r.filas[0].amb, 'Int', 'sin ámbito declarado se asume internacional');
});

test('los márgenes salen en el orden del estudio y los cuartiles interpolan', () => {
  const r = analizarRango(conComparables);
  assert.deepStrictEqual(
    r.filas.map((f) => f.ajustado),
    [0.1, 0.13, 0.1, 0.13],
    'los márgenes por comparable deben salir en el orden en que están en el estudio'
  );
  /* Serie ordenada: 0,10 · 0,10 · 0,13 · 0,13.

     La mediana es 0,115, no 0,10. Antes este módulo usaba `quart`, que toma el
     elemento en la posición truncada; ahora usa la interpolación de QUARTILE.INC,
     que es la que calcula el Excel de soporte. Los dos documentos publicaban
     cuartiles distintos sobre la misma serie, y esta línea era la que fijaba el
     comportamiento divergente. */
  assert.strictEqual(r.stats.med, 0.115);
  assert.strictEqual(r.stats.p25, 0.1);
  assert.strictEqual(r.stats.p75, 0.13);
});

/* ─── El ajuste de capital de trabajo, que no tenía ninguna cobertura aquí ─── */

const conAjuste = {
  pli: 'MO', t_s: 100000, t_c: 60000, t_op: 20000,
  t_ar: 12000, t_inv: 5000, t_ap: 8000,
  useadj: true, prime: 7.37,
  comparables: [
    { name: 'Uno', s: 1000, c: 600, op: 100, ar: 300, inv: 100, ap: 50 },
    { name: 'Dos', s: 2000, c: 1600, op: 260, ar: 200, inv: 20, ap: 400 },
    { name: 'Tres', s: 3000, c: 2400, op: 300, ar: 90, inv: 0, ap: 120 },
  ],
};

test('el ajuste solo corre con useadj y mueve el margen de cada comparable', () => {
  const con = analizarRango(conAjuste);
  const sin = analizarRango({ ...conAjuste, useadj: false });

  con.filas.forEach((f, i) => {
    assert.notStrictEqual(f.ajustado, f.noAjustado, `${f.nombre}: el ajuste no movió nada`);
    assert.strictEqual(f.noAjustado, sin.filas[i].ajustado,
      `${f.nombre}: sin useadj el ajustado debe ser el margen crudo`);
  });
});

test('con la tasa en cero el ajuste no mueve nada aunque useadj esté activo', () => {
  /* Es el escenario silencioso que dejaba el campo vacío: el informe decía
     «ajustado» y publicaba exactamente el margen sin ajustar. */
  const r = analizarRango({ ...conAjuste, prime: 0 });
  r.filas.forEach((f) => assert.strictEqual(f.ajustado, f.noAjustado));
});

test('la tasa va en porcentaje: 7,37 no es lo mismo que 0,0737', () => {
  const enPorcentaje = analizarRango(conAjuste);
  const enFraccion = analizarRango({ ...conAjuste, prime: 0.0737 });
  assert.notStrictEqual(enPorcentaje.stats.med, enFraccion.stats.med,
    'si alguien pasa la tasa ya dividida, el rango tiene que salir distinto');
});

test('el filtro de ámbito llega al rango del informe, no solo al de la pantalla', () => {
  /* Cuatro comparables para que, al dejar fuera la nacional, sigan quedando las tres
     que el rango necesita como mínimo. */
  const conAmbito = {
    ...conAjuste,
    comparables: [
      { name: 'Local', amb: 'Nac', s: 5000, c: 3000, op: 1500, ar: 400, inv: 50, ap: 200 },
      ...conAjuste.comparables.map((c) => ({ ...c, amb: 'Int' })),
    ],
  };
  const todas = analizarRango({ ...conAmbito, cmode: 'all' });
  const soloInt = analizarRango({ ...conAmbito, cmode: 'intl' });
  assert.ok(todas.stats && soloInt.stats, 'ambos filtros deberían dar rango');
  assert.notStrictEqual(todas.stats.med, soloInt.stats.med);
  assert.strictEqual(soloInt.filas.length, 4, 'las filas siguen trayendo toda la muestra');
});

test('Berry usa la definición del motor y sí admite ajuste', () => {
  /* El sistema definía Berry como «ventas / costos totales» y el motor como
     «utilidad bruta / gastos operativos». Convivían las dos y el informe y su Excel
     de soporte publicaban cifras distintas para el mismo estudio. Se adoptó la del
     motor —la del Anexo del Cap. III de las Guías OCDE, y la que replica el modelo
     Excel validado—, así que Berry entra por la misma ruta que MO y MB.

     Con la comparable del fixture (ventas 1000, costo 600, utilidad operacional 100)
     los gastos operativos son 1000 − 600 − 100 = 300, y Berry = 400 / 300. */
  const r = analizarRango({ ...conAjuste, pli: 'Berry' });
  const uno = r.filas[0];
  assert.ok(Math.abs(uno.noAjustado - (400 / 300)) < 1e-12,
    `Berry = utilidad bruta / gastos operativos, dio ${uno.noAjustado}`);

  /* Y deja de estar exceptuado del ajuste de capital de trabajo: la hoja Berry del
     Excel ya lo venía calculando con sus siete escenarios. */
  assert.notStrictEqual(uno.ajustado, uno.noAjustado,
    'con useadj activo el margen de Berry tiene que moverse');
});
