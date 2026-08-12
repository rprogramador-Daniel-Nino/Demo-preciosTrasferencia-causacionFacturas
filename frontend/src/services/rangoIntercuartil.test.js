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

test('las dos cifras de cada comparable se publican aunque useadj esté apagado', () => {
  /* La columna de la tabla se titula «AJUSTADO» y el motor calcula ese número siempre, así
     que ahí va. Antes se copiaba el margen crudo cuando la casilla estaba apagada: el
     informe publicaba dos columnas idénticas mientras el libro de soporte, en su columna
     CxC+CxP+Inv, publicaba el ajuste de verdad. */
  const con = analizarRango(conAjuste);
  const sin = analizarRango({ ...conAjuste, useadj: false });

  con.filas.forEach((f, i) => {
    assert.notStrictEqual(f.ajustado, f.noAjustado, `${f.nombre}: el ajuste no movió nada`);
    assert.strictEqual(sin.filas[i].ajustado, f.ajustado,
      `${f.nombre}: el ajustado no depende de la casilla`);
    assert.strictEqual(sin.filas[i].noAjustado, f.noAjustado,
      `${f.nombre}: ni el crudo`);
  });
});

test('useadj decide el rango que sostiene la conclusión, no lo que muestran las tablas', () => {
  /* Lo que la casilla significa: si el ANÁLISIS ajusta por capital de trabajo. Eso cambia
     contra qué rango se compara el indicador del contribuyente —y por tanto el CUMPLE—,
     pero no puede cambiar el contenido de una columna que ya tiene su título. */
  const con = analizarRango(conAjuste);
  const sin = analizarRango({ ...conAjuste, useadj: false });

  assert.deepStrictEqual(con.stats, con.statsAjustado, 'con la casilla, concluye con el ajustado');
  assert.deepStrictEqual(sin.stats, sin.statsNoAjustado, 'sin ella, con el crudo');
  /* Y las dos estadísticas de las tablas son las mismas en ambos casos. */
  assert.deepStrictEqual(sin.statsAjustado, con.statsAjustado);
  assert.deepStrictEqual(sin.statsNoAjustado, con.statsNoAjustado);
  assert.notDeepStrictEqual(con.statsAjustado, con.statsNoAjustado, 'y son distintas entre sí');
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

test('la estadística sin ajuste respeta el filtro de ámbito, igual que la ajustada', () => {
  /* Con cmode 'nac' el rango ajustado excluye las internacionales. La estadística
     sin ajuste tiene que excluirlas también: son las dos columnas de la MISMA
     tabla del informe, y publicar cada una sobre un universo distinto es la fuga
     que esta prueba cierra. */
  const estudio = {
    pli: 'MO', useadj: true, cmode: 'nac', prime: 7.37,
    t_s: 1000, t_c: 600, t_op: 200, t_ar: 100, t_inv: 50, t_ap: 80, t_ppe: 300,
    comparables: [
      { name: 'Nacional A', amb: 'Nac', s: 500, c: 300, op: 120, ar: 50, inv: 20, ap: 40, ppe: 100 },
      { name: 'Nacional B', amb: 'Nac', s: 800, c: 500, op: 180, ar: 70, inv: 30, ap: 50, ppe: 120 },
      { name: 'Nacional C', amb: 'Nac', s: 600, c: 350, op: 150, ar: 60, inv: 25, ap: 45, ppe: 110 },
      /* Margen deliberadamente extremo: si entra, mueve el mínimo y el máximo. */
      { name: 'Internacional X', amb: 'Int', s: 900, c: 100, op: 100, ar: 10, inv: 5, ap: 5, ppe: 10 },
    ],
  };

  const r = analizarRango(estudio);
  assert.ok(r.statsNoAjustado, 'se publica la estadística sin ajuste');

  const nacionales = estudio.comparables.filter((c) => c.amb === 'Nac').length;
  assert.strictEqual(r.statsNoAjustado.n, nacionales,
    'la serie sin ajuste cuenta solo las nacionales');
  assert.strictEqual(r.stats.n, r.statsNoAjustado.n,
    'las dos columnas de la tabla se calculan sobre el mismo universo');
});

test('el mínimo y el máximo de la columna AJUSTADO también respetan el filtro de ámbito', () => {
  /* Mismo hueco que la prueba anterior, pero dentro de una sola columna:
     `docxRelleno.js` calculaba min/max de «AJUSTADO» recorriendo TODAS las filas a
     mano, mientras p25/mediana/p75 de esa misma columna ya venían de `stats`, que sí
     filtra por `cmode`. El margen de la internacional es tan extremo que, si min/max
     volvieran a recorrer la muestra completa, esta prueba lo delataría: el mínimo
     bajaría muy por debajo del de las nacionales. */
  const estudio = {
    pli: 'MO', useadj: true, cmode: 'nac', prime: 7.37,
    t_s: 1000, t_c: 600, t_op: 200, t_ar: 100, t_inv: 50, t_ap: 80, t_ppe: 300,
    comparables: [
      { name: 'Nacional A', amb: 'Nac', s: 500, c: 300, op: 120, ar: 50, inv: 20, ap: 40, ppe: 100 },
      { name: 'Nacional B', amb: 'Nac', s: 800, c: 500, op: 180, ar: 70, inv: 30, ap: 50, ppe: 120 },
      { name: 'Nacional C', amb: 'Nac', s: 600, c: 350, op: 150, ar: 60, inv: 25, ap: 45, ppe: 110 },
      /* Margen deliberadamente extremo: si entra, mueve el mínimo y el máximo. */
      { name: 'Internacional X', amb: 'Int', s: 900, c: 100, op: 100, ar: 10, inv: 5, ap: 5, ppe: 10 },
    ],
  };

  const r = analizarRango(estudio);
  const nacFilas = r.filas.filter((f) => f.amb === 'Nac');
  const minEsperado = Math.min(...nacFilas.map((f) => f.ajustado));
  const maxEsperado = Math.max(...nacFilas.map((f) => f.ajustado));
  const ajustadoInternacional = r.filas.find((f) => f.amb === 'Int').ajustado;

  assert.strictEqual(r.stats.min, minEsperado,
    'el mínimo de AJUSTADO debe salir solo de las nacionales');
  assert.strictEqual(r.stats.max, maxEsperado,
    'el máximo de AJUSTADO debe salir solo de las nacionales');
  assert.ok(r.stats.min > ajustadoInternacional,
    'la internacional tiene un margen más bajo que cualquier nacional: si entrara, sería ella el mínimo');
});
