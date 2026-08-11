import { test } from 'node:test';
import assert from 'node:assert';
import { hojasMemoriaRangoOptimo } from './memoriaCalculoRangoOptimo.js';
import { analizarRangoAjustado, cuartilInterpolado } from './ajusteRangoCapitalTrabajo.js';
import { analizarRango } from './rangoIntercuartil.js';
import { obtenerEstudioNormalizadoParaParche } from './estudioNormalizado.js';

/* ─────────────────────────────────────────────────────────────────────────────
   Paridad entre el libro de soporte y las tablas del informe.

   El informe local se radica ante la DIAN y el libro «Soporte del Motor de
   Comparables» es lo que lo sustenta. Si el libro publica un rango distinto del que
   publica el informe, no lo respalda: lo contradice. Hasta agosto de 2026 los dos
   números salían de dos implementaciones distintas de la misma matemática y nadie
   cotejaba que coincidieran. Estas pruebas afirman que coinciden y fallan si alguien
   vuelve a separarlos.

   Nótese la convención: el LIBRO y el MOTOR esperan `t_op` y `op` como GASTOS
   operativos; el resto del sistema los guarda como UTILIDAD operacional. El estudio
   del informe se escribe con la convención del sistema y se normaliza con
   `obtenerEstudioNormalizadoParaParche` antes de dárselo al libro y al motor. `prime`
   va EN PORCENTAJE (7.37, no 0.0737): la divide entre 100 cada consumidor.

   ─── El riesgo de esta prueba no es salir en rojo, es salir verde sin afirmar nada ───

   Una prueba de paridad miente de tres formas: iterando sobre una colección vacía,
   comparando celdas que ambas resultan `null`, o leyendo una columna equivocada donde
   no hay nada. Contra las tres:

     · cada bucle lleva un CONTADOR y afirma cuántas comparaciones hizo y que todas
       traían valor. Un `find` que no encontrara nada, o un fixture sin comparables,
       dejaría el contador en cero y la prueba caería;
     · `estadisticaDelLibro` exige que la celda que lee EXISTA y sea una celda de
       fórmula del libro. Si las columnas se mueven —ya se movieron una vez durante
       este plan—, la prueba grita en vez de comparar `null` contra `null`;
     · la paridad de fondo se coteja del INFORME (`analizarRango`, que normaliza por
       su cuenta con `aConvenioOCDE`) al LIBRO (`hojasMemoriaRangoOptimo`), no de dos
       llamadas al mismo motor.
   ───────────────────────────────────────────────────────────────────────────── */

const ESTUDIO_INFORME = {
  ent: 'END GAME INTERACTIVE COLOMBIA S.A.S.', anio: 2025,
  pli: 'MO', useadj: true, cmode: 'all', prime: 7.37, seg_excluido: 0,
  t_s: 5271105507, t_c: 2761202249, t_op: 294255770,
  t_ar: 578289605, t_inv: 0, t_ap: 27255376, t_ppe: 114783610,
  t_act_tot: 2179479687, t_cash: 12417756,
  comparables: [
    { name: 'QubicGames S.A.', amb: 'Int', s: 28.81, c: 0.15, op: 0.43, ar: 5.94, inv: 0.06, ap: 5.88, ppe: 0.42 },
    { name: 'Tose Co., Ltd.', amb: 'Int', s: 6636, c: 4844, op: 690, ar: 2508, inv: 7, ap: 189, ppe: 1395 },
    { name: 'Akatsuki Inc.', amb: 'Int', s: 23652, c: 9954, op: 3916, ar: 4252, inv: 0, ap: 763, ppe: 403 },
    { name: 'Marvelous Inc.', amb: 'Int', s: 186.7, c: 100.4, op: 11.7, ar: 0, inv: 0, ap: 0, ppe: 0 },
    { name: 'Drecom Co.,Ltd.', amb: 'Nac', s: 84.5, c: 61.3, op: 0.748, ar: 0, inv: 0, ap: 0, ppe: 0 },
  ],
};

/* El orden que fija `AJUSTES` dentro del emisor, que ES el orden de las columnas
   AA–AG de las filas de estadística y el de las filas de la hoja Resumen. Se repite
   aquí como literal a propósito: reordenar `AJUSTES` cruzaría los valores con las
   fórmulas y el libro saldría con cifras creíbles en el sitio errado sin que nada
   reventara. Este literal es lo que lo delata. */
const SABORES = ['ninguno', 'aar', 'aap', 'inv', 'aar_aap_inv', 'aar_aap_inv_ppe', 'ppe'];
const METODOS = ['MO', 'MB', 'Berry', 'CostPlus', 'NCP'];
/* Los cinco estadísticos que publica la tabla de rango del informe. */
const CLAVES = ['min', 'p25', 'med', 'p75', 'max'];

/* Escenario que reporta el informe cuando el estudio pide ajuste de capital de
   trabajo. `SABOR_INFORME` es privado de rangoIntercuartil.js, así que la
   correspondencia «useadj → columna del libro» se fija aquí: si el informe cambia de
   escenario y el libro sigue publicando el anterior, la Tabla 18 dejaría de estar
   respaldada y esa es exactamente la separación que hay que detectar. */
const IDX_SABOR_INFORME = SABORES.indexOf('aar_aap_inv');
const IDX_SIN_AJUSTE = SABORES.indexOf('ninguno');

/* Un libro por estudio, no uno por consulta: armarlo pide 35 llamadas al motor y
   cada prueba lo interroga decenas de veces. La clave es la identidad del objeto
   normalizado, así que cada prueba tiene que reusar su propio `norm`. */
const librosArmados = new Map();
function libroDe(estudioNorm) {
  if (!librosArmados.has(estudioNorm)) {
    librosArmados.set(estudioNorm, hojasMemoriaRangoOptimo(estudioNorm, null));
  }
  return librosArmados.get(estudioNorm);
}

/** Los estadísticos del libro para un método y una columna de sabor.
 *
 *  La etiqueta de cada fila de estadística va en la columna R (índice 17) y los siete
 *  valores, uno por sabor, empiezan en AA (índice 26). En las filas de comparable la
 *  columna R es el denominador ajustado, que va sin valor, así que nunca colisiona con
 *  una etiqueta. */
function estadisticaDelLibro(estudioNorm, hoja, idxSabor) {
  const h = libroDe(estudioNorm).find((x) => x.nombre === hoja);
  assert.ok(h, `el libro no trae la hoja «${hoja}»`);
  const col = 26 + idxSabor; // AA = 26
  const buscar = (etq) => h.celdas.find((f) => f && f[17] && f[17].v === etq);
  const v = (etq) => {
    const fila = buscar(etq);
    assert.ok(fila, `${hoja}: el libro no trae la fila «${etq}»`);
    const celda = fila[col];
    /* La guarda que impide que esta prueba mienta: si la columna del sabor se moviera
       —o si `26 + idxSabor` dejara de apuntar al bloque de estadística—, aquí no habría
       celda de fórmula y la prueba cae en vez de comparar `null` contra `null`. */
    assert.ok(celda && celda.f,
      `${hoja}: la columna ${col} de «${etq}» no es una celda de fórmula del libro`);
    return celda.v !== undefined ? celda.v : null;
  };
  return {
    min: v('Mínimo'), p25: v('P25 (cuartil inferior)'), med: v('Mediana (P50)'),
    p75: v('P75 (cuartil superior)'), max: v('Máximo'),
    sujeto: v('Indicador del contribuyente'),
    conclusion: v('Conclusión'),
  };
}

/** La serie que el libro publica para un sabor: los valores en caché de la columna
 *  AA+k en las filas de comparable —las que traen el nombre como referencia a la hoja
 *  Datos—. Es lo que QUARTILE, MIN y MAX van a leer cuando Excel recalcule. */
function serieDelLibro(estudioNorm, hoja, idxSabor) {
  const h = libroDe(estudioNorm).find((x) => x.nombre === hoja);
  assert.ok(h, `el libro no trae la hoja «${hoja}»`);
  const filas = h.celdas.filter((f) => f && f[0] && f[0].f && f[0].f.startsWith('Datos!A'));
  const celdas = filas.map((f) => f[26 + idxSabor]);
  celdas.forEach((celda, i) => assert.ok(celda && celda.f,
    `${hoja}: la fila ${i} no trae fórmula de serie en la columna ${26 + idxSabor}`));
  return {
    filas: filas.length,
    /* Vacías fuera: la celda de una fila que no entra va sin valor, y eso es
       precisamente lo que MIN, MAX y QUARTILE ignoran. */
    valores: celdas.filter((c) => c.v !== undefined).map((c) => c.v),
  };
}

test('las siete columnas de estadística son las de los siete sabores, en ese orden', () => {
  /* Ancla del índice de columna del que dependen TODAS las pruebas de este archivo. Si
     el bloque de series se desplaza, esta prueba lo dice con su nombre en vez de dejar
     que las demás comparen celdas vacías. */
  const norm = obtenerEstudioNormalizadoParaParche(ESTUDIO_INFORME);
  const mo = libroDe(norm).find((h) => h.nombre === 'MO');
  const encabezado = mo.celdas[1].slice(26, 33).map((c) => c.v);
  assert.deepStrictEqual(encabezado, [
    'Serie: Sin ajuste', 'Serie: CxC', 'Serie: CxP', 'Serie: Inv',
    'Serie: CxC+CxP+Inv', 'Serie: +PP&E', 'Serie: PP&E',
  ], 'las columnas 26–32 son las siete series, en el orden de SABORES');
  /* Y la fila de estadística llega hasta la 33.ª celda y no más: siete valores a
     partir de AA, ni seis ni ocho. */
  const filaMin = mo.celdas.find((f) => f && f[17] && f[17].v === 'Mínimo');
  assert.strictEqual(filaMin.length, 33, 'la fila de estadística cubre A–AG');
});

test('el libro y el motor publican el mismo rango en los cinco métodos y los siete sabores', () => {
  const norm = obtenerEstudioNormalizadoParaParche(ESTUDIO_INFORME);
  let comparadas = 0;
  let conRango = 0;
  METODOS.forEach((metodo) => {
    SABORES.forEach((sabor, i) => {
      const delMotor = analizarRangoAjustado(norm, metodo, sabor);
      const delLibro = estadisticaDelLibro(norm, metodo, i);
      const donde = `${metodo}/${sabor}`;
      if (!delMotor.stats) {
        assert.strictEqual(delLibro.p25, null, `${donde}: sin rango, el libro no publica`);
        return;
      }
      conRango++;
      CLAVES.forEach((k) => {
        assert.ok(Number.isFinite(delLibro[k]),
          `${donde}: el libro publica ${delLibro[k]} en ${k}; comparar nada contra nada no demuestra nada`);
        assert.strictEqual(delLibro[k], delMotor.stats[k], `${donde}: ${k} no coincide`);
        comparadas++;
      });
      assert.ok(Number.isFinite(delLibro.sujeto), `${donde}: el libro no trae el indicador del contribuyente`);
      assert.strictEqual(delLibro.sujeto, delMotor.sujeto,
        `${donde}: el indicador del contribuyente no coincide`);
      comparadas++;
      /* Con rango, la conclusión también tiene que ser la del motor. Sin rango difieren
         a propósito, y de eso se ocupa la prueba del ámbito nacional. */
      assert.strictEqual(delLibro.conclusion, delMotor.cumple, `${donde}: la conclusión no coincide`);
      comparadas++;
    });
  });
  /* Cinco métodos × siete sabores × (cinco estadísticos + contribuyente + conclusión).
     Sin este piso, un `find` que no encontrara la hoja, un fixture sin comparables o un
     `stats` que saliera null en todas partes harían pasar la prueba sin comparar nada. */
  assert.strictEqual(comparadas, 5 * 7 * 7, `debería comparar 245 celdas, comparó ${comparadas}`);
  assert.strictEqual(conRango, 5 * 7,
    'los 35 pares método/sabor tienen que traer rango con este fixture de cinco comparables');
});

test('lo que el informe publica en su tabla de rango es lo que trae el libro', () => {
  /* La ruta del informe: `analizarRango` recibe el estudio en la convención del sistema
     y normaliza por su cuenta con `aConvenioOCDE`; el libro lo recibe normalizado con
     `obtenerEstudioNormalizadoParaParche`. Son dos normalizadores distintos y este es el
     único sitio que afirma que producen el mismo rango: aquí se cotejan las dos puntas
     reales, no dos llamadas al mismo motor. */
  const delInforme = analizarRango(ESTUDIO_INFORME);
  const norm = obtenerEstudioNormalizadoParaParche(ESTUDIO_INFORME);
  const delLibro = estadisticaDelLibro(norm, 'MO', IDX_SABOR_INFORME);
  const sinAjusteLibro = estadisticaDelLibro(norm, 'MO', IDX_SIN_AJUSTE);

  assert.ok(delInforme.stats, 'el informe publica rango con este estudio');
  assert.ok(delInforme.statsNoAjustado, 'y también la columna sin ajuste');

  let comparadas = 0;
  CLAVES.forEach((k) => {
    /* La columna AJUSTADO de la Tabla 18. */
    assert.ok(Number.isFinite(delLibro[k]), `el libro no publica ${k} en la columna del informe`);
    assert.strictEqual(delLibro[k], delInforme.stats[k], `el ${k} de la Tabla 18`);
    comparadas++;
    /* Y la columna NO AJUSTADO de la misma tabla, contra la columna «Sin ajuste». */
    assert.ok(Number.isFinite(sinAjusteLibro[k]), `el libro no publica ${k} sin ajuste`);
    assert.strictEqual(sinAjusteLibro[k], delInforme.statsNoAjustado[k],
      `el ${k} sin ajuste de la Tabla 18`);
    comparadas++;
  });
  assert.strictEqual(comparadas, 10, `debería comparar 10 estadísticos, comparó ${comparadas}`);

  /* Las dos columnas son DISTINTAS entre sí: si coincidieran, la prueba estaría
     comparando la misma columna dos veces y no distinguiría «con ajuste» de «sin
     ajuste» en ninguno de los dos lados. */
  assert.notStrictEqual(delLibro.p25, sinAjusteLibro.p25,
    'el ajuste de capital de trabajo mueve el P25 de forma observable');

  /* Y la columna que reproduce el rango del informe es EXACTAMENTE la del escenario que
     el informe declara, no otra que dé el mismo número por casualidad. Si el informe
     cambiara de escenario sin que el libro lo siguiera, aquí coincidiría otra columna
     —o ninguna— y la prueba lo diría. */
  const coincidencias = SABORES
    .map((_, i) => estadisticaDelLibro(norm, 'MO', i))
    .map((l, i) => (CLAVES.every((k) => l[k] === delInforme.stats[k]) ? i : -1))
    .filter((i) => i >= 0);
  assert.deepStrictEqual(coincidencias, [IDX_SABOR_INFORME],
    'una sola columna del libro reproduce el rango del informe, y es la del escenario reportado');
});

test('el informe y el libro coinciden en los tres indicadores del sistema, con ajuste y sin él', () => {
  /* `analizarRango` enruta MO, MB y Berry —los tres `pli` que ofrece el sistema— y
     elige el escenario según `useadj`. Las seis combinaciones se cotejan contra la
     columna del libro que les corresponde. Una divergencia que solo apareciera en MB o
     en Berry, o solo al desactivar el ajuste, pasaría inadvertida con MO a secas. */
  let comparadas = 0;
  ['MO', 'MB', 'Berry'].forEach((pli) => {
    [true, false].forEach((useadj) => {
      const estudio = { ...ESTUDIO_INFORME, pli, useadj };
      const delInforme = analizarRango(estudio);
      const norm = obtenerEstudioNormalizadoParaParche(estudio);
      const idx = useadj ? IDX_SABOR_INFORME : IDX_SIN_AJUSTE;
      const delLibro = estadisticaDelLibro(norm, pli, idx);
      const donde = `${pli}, useadj=${useadj}`;
      assert.ok(delInforme.stats, `${donde}: el informe publica rango`);
      CLAVES.forEach((k) => {
        assert.ok(Number.isFinite(delLibro[k]), `${donde}: el libro no publica ${k}`);
        assert.strictEqual(delLibro[k], delInforme.stats[k], `${donde}: ${k}`);
        comparadas++;
      });
    });
  });
  /* Tres indicadores × dos escenarios × cinco estadísticos. */
  assert.strictEqual(comparadas, 30, `debería comparar 30 estadísticos, comparó ${comparadas}`);
});

test('la hoja Resumen, que es la que se abre sola, trae el rango del informe', () => {
  /* El Resumen es la primera hoja del libro. Sus celdas son referencias a las hojas de
     método, pero llevan el valor en caché, y ese valor es lo que ve quien abre el
     archivo en un visor que no recalcula. Si el Resumen se separara del informe, el
     lector vería un rango que la Tabla 18 desmiente antes de llegar a la hoja MO. */
  const delInforme = analizarRango(ESTUDIO_INFORME);
  const norm = obtenerEstudioNormalizadoParaParche(ESTUDIO_INFORME);
  const resumen = libroDe(norm).find((h) => h.nombre === 'Resumen');
  assert.ok(resumen, 'el libro trae la hoja Resumen');
  const fila = resumen.celdas.find((f) => f && f[0] && f[0].v === 'Margen Operacional'
    && f[1] && f[1].v === 'CxC+CxP+Inv');
  assert.ok(fila, 'el Resumen trae la fila del método y el escenario que reporta el informe');
  /* Columnas 3..7 del Resumen: Mínimo, P25, Mediana, P75, Máximo. */
  const publicado = fila.slice(3, 8).map((c) => c.v);
  assert.deepStrictEqual(publicado, CLAVES.map((k) => delInforme.stats[k]),
    'el Resumen publica los cinco estadísticos de la Tabla 18, en el orden de su encabezado');
  assert.strictEqual(publicado.filter(Number.isFinite).length, 5,
    'y los cinco son números, no huecos');
});

test('la estadística que publica el libro es la que Excel sacará de la propia serie del libro', () => {
  /* El punto ciego de comparar solo valores en caché: el libro emite FÓRMULA y VALOR. Si
     la serie que emite no es la que el motor cuartiló, el valor en caché seguiría siendo
     el del informe pero Excel movería la celda al abrir, y el libro dejaría de respaldar
     al informe en cuanto alguien lo recalculara. Esta prueba rehace el trabajo de Excel
     —MIN, MAX y QUARTILE.INC sobre las celdas con número de la columna de serie, con la
     misma guarda de menos de tres observaciones— y exige que dé la cifra publicada.

     `cuartilInterpolado` es el cuartil del motor, documentado como equivalente a
     QUARTILE.INC, que es la función que la hoja escribe.

     Se recorren los tres ámbitos porque es donde la serie y la estadística pueden
     separarse: si el emisor dejara de filtrar la serie por `cmode`, los valores en caché
     de la estadística seguirían siendo los del motor y solo esta prueba lo vería. */
  const CASOS = [
    { cmode: 'all', enSerie: 5 },
    { cmode: 'intl', enSerie: 4 },
    { cmode: 'nac', enSerie: 1 },
  ];
  let recalculadas = 0;
  let conRango = 0;
  let sinRango = 0;
  CASOS.forEach(({ cmode, enSerie }) => {
    const norm = obtenerEstudioNormalizadoParaParche({ ...ESTUDIO_INFORME, cmode });
    METODOS.forEach((metodo) => {
      SABORES.forEach((sabor, i) => {
        const donde = `${metodo}/${sabor}/cmode=${cmode}`;
        const { filas, valores } = serieDelLibro(norm, metodo, i);
        assert.strictEqual(filas, ESTUDIO_INFORME.comparables.length,
          `${donde}: la hoja escribe una fila por comparable`);
        assert.strictEqual(valores.length, enSerie,
          `${donde}: el ámbito deja ${enSerie} observaciones en la serie del libro`);
        const orden = [...valores].sort((a, b) => a - b);
        const delLibro = estadisticaDelLibro(norm, metodo, i);
        if (orden.length < 3) {
          /* La guarda de la hoja es IF(COUNT(...)<3,"",…): Excel resolverá a "" y el
             valor en caché tiene que estar ausente, no ser un número. */
          CLAVES.forEach((k) => assert.strictEqual(delLibro[k], null,
            `${donde}: con menos de tres observaciones la hoja no publica ${k}`));
          sinRango++;
          return;
        }
        const recalculado = {
          min: orden[0],
          p25: cuartilInterpolado(orden, 0.25),
          med: cuartilInterpolado(orden, 0.5),
          p75: cuartilInterpolado(orden, 0.75),
          max: orden[orden.length - 1],
        };
        CLAVES.forEach((k) => {
          assert.ok(Number.isFinite(delLibro[k]), `${donde}: el libro no publica ${k}`);
          assert.strictEqual(delLibro[k], recalculado[k],
            `${donde}: el ${k} publicado no es el que sale de la serie de la propia hoja`);
          recalculadas++;
        });
        conRango++;
      });
    });
  });
  /* Dos ámbitos con muestra suficiente × cinco métodos × siete sabores × cinco
     estadísticos, y el tercero —'nac', con una sola comparable— sin publicar nada. */
  assert.strictEqual(conRango, 2 * 5 * 7, `debería recalcular 70 pares, recalculó ${conRango}`);
  assert.strictEqual(sinRango, 5 * 7, `debería dejar 35 pares sin rango, dejó ${sinRango}`);
  assert.strictEqual(recalculadas, 2 * 5 * 7 * 5,
    `debería comparar 350 estadísticos, comparó ${recalculadas}`);
});

/* Las siete columnas de serie por sus letras, y el estadístico que cada fila tiene que
   emitir. La letra importa tanto como la función: una fórmula que cuartilara la columna
   de otro sabor daría un número creíble y ajeno. */
const LETRAS_SERIE = ['AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG'];
const ESTADISTICOS = [
  ['Mínimo', 'MIN', null],
  ['P25 (cuartil inferior)', 'QUARTILE', '1'],
  ['Mediana (P50)', 'QUARTILE', '2'],
  ['P75 (cuartil superior)', 'QUARTILE', '3'],
  ['Máximo', 'MAX', null],
];

/* El indicador del contribuyente de cada método, en función de las tres referencias de la
   hoja Datos: ventas, costo y gastos operativos. Es la misma tabla que construye
   `testedFor` en el emisor, escrita aquí a mano a propósito: es lo único que distingue
   «MB divide la utilidad bruta» de «MB divide el EBIT», dos fórmulas igual de creíbles que
   publican indicadores distintos. Las referencias NO se escriben con su dirección: se
   derivan de la etiqueta del rubro en la hoja Datos, igual que hace el emisor, para que
   insertar un rubro no vuelva falsa esta prueba. */
const CONTRIBUYENTE = {
  MO: (S, C, OP) => `(${S}-${C}-${OP})/${S}`,
  MB: (S, C) => `(${S}-${C})/${S}`,
  Berry: (S, C, OP) => `(${S}-${C})/${OP}`,
  CostPlus: (S, C) => `(${S}-${C})/${C}`,
  NCP: (S, C, OP) => `(${S}-${C}-${OP})/(${C}+${OP})`,
};

test('la fórmula de cada fila de estadística apunta a su propia columna y a su propio cuartil', () => {
  /* El otro punto ciego del valor en caché: la fórmula. Intercambiar los argumentos de
     QUARTILE entre la fila de la mediana y la del P75, apuntar la fórmula a la columna de
     otro sabor, hacer que el indicador del contribuyente de MB divida el EBIT en vez de la
     utilidad bruta, o cruzar el P25 con el P75 dentro de la comparación de la Conclusión:
     todas dejan los valores en caché intactos —siguen siendo los del motor, así que el
     .docx y el .xlsx sin recalcular coinciden— y el libro pasa a publicar otro número, otro
     indicador o otro veredicto en cuanto alguien pulsa Ctrl+Alt+F9. Nada más en el
     repositorio mira el CONTENIDO de estas fórmulas: las pruebas del emisor comprueban que
     la celda tiene fórmula, no cuál.

     Se revisan las SIETE filas de estadística, no solo los cinco estadísticos: el indicador
     del contribuyente y la Conclusión son las dos que el informe también publica. */
  const norm = obtenerEstudioNormalizadoParaParche(ESTUDIO_INFORME);

  /* Las tres referencias del contribuyente, derivadas de la etiqueta del rubro. */
  const datos = libroDe(norm).find((x) => x.nombre === 'Datos');
  assert.ok(datos, 'el libro trae la hoja Datos');
  const refRubro = (etiqueta) => {
    const i = datos.celdas.findIndex((f) => f && f[0] && f[0].v === etiqueta);
    assert.ok(i >= 0, `la hoja Datos no trae el rubro «${etiqueta}»`);
    return `Datos!$B$${i + 1}`;
  };
  const S = refRubro('Ventas netas');
  const C = refRubro('Costo de ventas');
  const OP = refRubro('Gastos operativos');

  let revisadas = 0;
  METODOS.forEach((metodo) => {
    const h = libroDe(norm).find((x) => x.nombre === metodo);
    assert.ok(h, `el libro no trae la hoja «${metodo}»`);
    /* Las filas de comparable, por su 1-based, que es como las nombra una fórmula. */
    const filasComp = h.celdas
      .map((f, i) => ({ f, fila: i + 1 }))
      .filter(({ f }) => f && f[0] && f[0].f && f[0].f.startsWith('Datos!A'));
    assert.strictEqual(filasComp.length, ESTUDIO_INFORME.comparables.length,
      `${metodo}: una fila por comparable`);
    const primera = filasComp[0].fila;
    const ultima = filasComp[filasComp.length - 1].fila;
    /* La fila 1-based de cada etiqueta, derivada de la hoja. Si el emisor cruzara los
       índices que escribe en la fórmula de la Conclusión, discreparían de estos. */
    const filaDe = (etq) => {
      const i = h.celdas.findIndex((f) => f && f[17] && f[17].v === etq);
      assert.ok(i >= 0, `${metodo}: el libro no trae la fila «${etq}»`);
      return i + 1;
    };
    const celdaDe = (etq, k) => h.celdas[filaDe(etq) - 1][26 + k];

    ESTADISTICOS.forEach(([etq, fn, q]) => {
      LETRAS_SERIE.forEach((L, k) => {
        const rango = `${L}${primera}:${L}${ultima}`;
        /* La guarda de muestra mínima es parte de la fórmula, no un adorno: sin ella la
           celda daría un rango sobre dos observaciones. */
        const esperada = `IF(COUNT(${rango})<3,"",${fn}(${rango}${q ? `,${q}` : ''}))`;
        assert.strictEqual(celdaDe(etq, k).f, esperada,
          `${metodo}/${etq}/${SABORES[k]}: la fórmula emitida no es la de este estadístico`);
        revisadas++;
      });
    });

    /* El indicador del contribuyente: la misma fórmula en las siete columnas —el
       contribuyente se ajusta contra sí mismo y sus ratios se anulan—, y la del método. */
    const esperadaSujeto = CONTRIBUYENTE[metodo](S, C, OP);
    LETRAS_SERIE.forEach((L, k) => {
      assert.strictEqual(celdaDe('Indicador del contribuyente', k).f, esperadaSujeto,
        `${metodo}/${SABORES[k]}: la fórmula del indicador del contribuyente no es la del método`);
      revisadas++;
    });

    /* La Conclusión: el contribuyente dentro del rango, con el P25 abajo y el P75 arriba,
       en esa dirección y sobre la columna de su propio sabor. */
    const filaTested = filaDe('Indicador del contribuyente');
    const filaP25 = filaDe('P25 (cuartil inferior)');
    const filaP75 = filaDe('P75 (cuartil superior)');
    LETRAS_SERIE.forEach((L, k) => {
      const rango = `${L}${primera}:${L}${ultima}`;
      const esperada = `IF(COUNT(${rango})<3,"",IF(AND(${L}${filaTested}>=${L}${filaP25},`
        + `${L}${filaTested}<=${L}${filaP75}),"CUMPLE","NO CUMPLE"))`;
      assert.strictEqual(celdaDe('Conclusión', k).f, esperada,
        `${metodo}/${SABORES[k]}: la fórmula de la Conclusión no compara el contribuyente `
        + 'contra su propio P25 y P75');
      revisadas++;
    });
  });
  /* Cinco métodos × siete sabores × siete filas (cinco estadísticos, el indicador del
     contribuyente y la Conclusión). */
  assert.strictEqual(revisadas, 5 * 7 * 7, `debería revisar 245 fórmulas, revisó ${revisadas}`);
});

test('con menos de tres observaciones ni el libro ni el informe publican rango, y solo ahí difieren', () => {
  /* Con una sola nacional en el fixture, ni el motor ni el libro publican rango. Es
     también el único sitio donde el libro y el informe difieren A PROPÓSITO, y hay que
     dejarlo escrito para quien lo lea dentro de un año:

     el motor devuelve `stats: null` y `cumple: 'CUMPLE'` por comportamiento heredado
     (ver el comentario de rangoIntercuartil.js:81, que pide expresamente no cambiarlo
     sin leer la nota del plan). El libro NO lo repite: deja la celda de Conclusión en
     blanco, porque un soporte que declara CUMPLE sin un rango que lo sustente es peor
     que uno que deja el hueco. Así que aquí se afirma que el libro no publica
     estadística, y la conclusión no se compara: se fija en blanco.

     No es un parche para que la prueba pase. Es la divergencia deliberada, la única, y
     está acotada al caso «menos de tres observaciones». */
  const soloNac = { ...ESTUDIO_INFORME, cmode: 'nac' };
  const norm = obtenerEstudioNormalizadoParaParche(soloNac);

  let sinPublicar = 0;
  let enBlanco = 0;
  METODOS.forEach((metodo) => {
    SABORES.forEach((sabor, i) => {
      const delMotor = analizarRangoAjustado(norm, metodo, sabor);
      const delLibro = estadisticaDelLibro(norm, metodo, i);
      const donde = `${metodo}/${sabor}`;
      assert.strictEqual(delMotor.stats, null,
        `${donde}: con una sola nacional el motor no publica rango`);
      assert.strictEqual(delMotor.cumple, 'CUMPLE',
        `${donde}: y sigue diciendo CUMPLE por comportamiento heredado`);
      CLAVES.forEach((k) => {
        assert.strictEqual(delLibro[k], null,
          `${donde}: el libro tampoco publica ${k} cuando el ámbito deja menos de tres`);
        sinPublicar++;
      });
      /* La divergencia deliberada, afirmada en los dos sentidos: el motor dice CUMPLE
         (arriba) y el libro deja el hueco (aquí). */
      assert.strictEqual(delLibro.conclusion, '',
        `${donde}: el libro no declara CUMPLE sin un rango que lo sustente`);
      enBlanco++;
    });
  });
  /* Cinco métodos × siete sabores × cinco estadísticos, y una conclusión por par. */
  assert.strictEqual(sinPublicar, 5 * 7 * 5, `debería revisar 175 celdas, revisó ${sinPublicar}`);
  assert.strictEqual(enBlanco, 5 * 7, `debería revisar 35 conclusiones, revisó ${enBlanco}`);

  /* Y la punta real: el INFORME tampoco publica rango. `porMetodologiaOCDE` arma su propio
     `preparado` (rangoIntercuartil.js:93-98) y podría pisar `cmode` por el camino; si lo
     hiciera, el informe publicaría un rango sobre las cinco comparables que su libro no
     respalda. Comparar solo contra `analizarRangoAjustado` no lo vería, porque ese es el
     motor y no la ruta del informe. */
  const delInforme = analizarRango(soloNac);
  assert.strictEqual(delInforme.stats, null,
    'el informe respeta el ámbito y no publica rango con una sola nacional');
  assert.strictEqual(delInforme.statsNoAjustado, null,
    'ni en su columna sin ajuste');
});

test('con ámbito internacional el libro cuartila el mismo subconjunto que el informe', () => {
  /* El fixture trae cuatro internacionales y una nacional, así que con 'intl' sí hay
     muestra suficiente y el rango se calcula sobre un subconjunto propio. Es el caso
     que de verdad distingue «filtra» de «no filtra»: con 'all' los dos coincidirían
     por accidente. */
  const soloIntl = { ...ESTUDIO_INFORME, cmode: 'intl' };
  const norm = obtenerEstudioNormalizadoParaParche(soloIntl);
  const delMotor = analizarRangoAjustado(norm, 'MO', 'ninguno');
  const delLibro = estadisticaDelLibro(norm, 'MO', IDX_SIN_AJUSTE);

  assert.ok(delMotor.stats, 'con cuatro internacionales hay rango');
  assert.strictEqual(delMotor.stats.n, 4, 'la nacional queda fuera');
  let comparadas = 0;
  CLAVES.forEach((k) => {
    assert.ok(Number.isFinite(delLibro[k]), `el libro no publica ${k} con ámbito internacional`);
    assert.strictEqual(delLibro[k], delMotor.stats[k], `${k} con ámbito internacional`);
    comparadas++;
  });
  assert.strictEqual(comparadas, 5, `debería comparar 5 estadísticos, comparó ${comparadas}`);

  /* Y el resultado tiene que diferir del de 'all': si coincide, el filtro no se aplicó
     en ninguno de los dos y la prueba anterior no demuestra nada. */
  const normTodas = obtenerEstudioNormalizadoParaParche(ESTUDIO_INFORME);
  const conTodas = analizarRangoAjustado(normTodas, 'MO', 'ninguno');
  assert.notStrictEqual(delMotor.stats.n, conTodas.stats.n,
    'el filtro de ámbito cambia el universo de forma observable');
  /* Observable también en el libro, no solo en el conteo del motor. */
  assert.notStrictEqual(delLibro.p25, estadisticaDelLibro(normTodas, 'MO', IDX_SIN_AJUSTE).p25,
    'y el libro publica otro P25 cuando el ámbito cambia');

  /* Y la punta real, que es donde de verdad importa: el INFORME sobre el mismo ámbito.
     `porMetodologiaOCDE` arma su propio `preparado` (rangoIntercuartil.js:93-98); si ahí se
     perdiera `cmode`, el informe cuartilaría las cinco comparables y el libro cuatro, y solo
     este cotejo lo vería. Se comprueban las dos columnas de la Tabla 18. */
  const delInforme = analizarRango(soloIntl);
  const libroAjustado = estadisticaDelLibro(norm, 'MO', IDX_SABOR_INFORME);
  assert.ok(delInforme.stats, 'el informe publica rango con cuatro internacionales');
  let deLasDosPuntas = 0;
  CLAVES.forEach((k) => {
    assert.ok(Number.isFinite(libroAjustado[k]), `el libro no publica ${k} ajustado con 'intl'`);
    assert.strictEqual(libroAjustado[k], delInforme.stats[k],
      `el ${k} de la Tabla 18 con ámbito internacional`);
    assert.strictEqual(delLibro[k], delInforme.statsNoAjustado[k],
      `el ${k} sin ajuste de la Tabla 18 con ámbito internacional`);
    deLasDosPuntas += 2;
  });
  assert.strictEqual(deLasDosPuntas, 10,
    `debería cotejar 10 estadísticos contra el informe, cotejó ${deLasDosPuntas}`);
});

test('una comparable sin cifras no entra en el libro ni en el informe', () => {
  const conHueco = {
    ...ESTUDIO_INFORME,
    comparables: [
      ...ESTUDIO_INFORME.comparables,
      /* Sin ventas ni costo: `indicadorAjustado` devuelve null (:113) y la fórmula de
         la hoja la descarta por ISNUMBER. */
      { name: 'Sin Cifras SA', amb: 'Int' },
    ],
  };
  const norm = obtenerEstudioNormalizadoParaParche(conHueco);
  const delMotor = analizarRangoAjustado(norm, 'MO', 'ninguno');
  const delLibro = estadisticaDelLibro(norm, 'MO', IDX_SIN_AJUSTE);

  const completas = ESTUDIO_INFORME.comparables.length;
  assert.strictEqual(delMotor.stats.n, completas,
    'la comparable sin cifras no entra a la serie del motor');
  let comparadas = 0;
  CLAVES.forEach((k) => {
    assert.ok(Number.isFinite(delLibro[k]), `el libro no publica ${k} con la fila hueca`);
    assert.strictEqual(delLibro[k], delMotor.stats[k],
      `${k} no se mueve por una comparable sin cifras`);
    comparadas++;
  });
  assert.strictEqual(comparadas, 5, `debería comparar 5 estadísticos, comparó ${comparadas}`);

  /* Y su celda de serie sale vacía, no en cero: un cero fingiría una observación. */
  const mo = libroDe(norm).find((h) => h.nombre === 'MO');
  const filaHueco = mo.celdas.find((f) => f && f[0] && f[0].v === 'Sin Cifras SA');
  assert.ok(filaHueco, 'la fila de la comparable sin cifras sí se escribe en la hoja');
  assert.ok(filaHueco[26].f, 'y conserva la fórmula, que Excel resuelve a ""');
  assert.strictEqual(filaHueco[26].v, undefined,
    'la serie del rango deja la celda sin valor, no en cero');
});

test('el segmento excluido sale de un solo sitio', () => {
  const conSeg = { ...ESTUDIO_INFORME, seg_excluido: 271105507 };
  const norm = obtenerEstudioNormalizadoParaParche(conSeg);
  const delMotor = analizarRangoAjustado(norm, 'MO', 'aar_aap_inv');
  const delLibro = estadisticaDelLibro(norm, 'MO', IDX_SABOR_INFORME);

  let comparadas = 0;
  assert.ok(Number.isFinite(delLibro.sujeto), 'el libro trae el indicador del contribuyente');
  assert.strictEqual(delLibro.sujeto, delMotor.sujeto,
    'el indicador del contribuyente parte de las mismas ventas en las dos rutas');
  comparadas++;
  /* El descuento también mueve el rango de las comparables: sus ajustes se escalan
     contra los ratios del contribuyente, que cambian con las ventas. */
  CLAVES.forEach((k) => {
    assert.ok(Number.isFinite(delLibro[k]), `el libro no publica ${k} con segmento excluido`);
    assert.strictEqual(delLibro[k], delMotor.stats[k], `${k} con segmento excluido`);
    comparadas++;
  });
  assert.strictEqual(comparadas, 6, `debería comparar 6 celdas, comparó ${comparadas}`);

  /* Y el descuento se nota: si no se notara, la paridad de arriba se sostendría con el
     segmento excluido ignorado en los dos lados y no demostraría nada. */
  const sinSeg = obtenerEstudioNormalizadoParaParche(ESTUDIO_INFORME);
  const libroSinSeg = estadisticaDelLibro(sinSeg, 'MO', IDX_SABOR_INFORME);
  assert.notStrictEqual(delLibro.sujeto, libroSinSeg.sujeto,
    'descontar el segmento excluido mueve el indicador del contribuyente');
  assert.notStrictEqual(delLibro.p25, libroSinSeg.p25,
    'y mueve el P25, porque los ajustes se escalan contra los ratios del contribuyente');

  /* Y la punta real. Es el otro sitio donde la ruta del informe hace trabajo propio:
     `analizarRango` descuenta el segmento de sus `T` y `porMetodologiaOCDE` arma su propio
     `preparado` (rangoIntercuartil.js:93-98) —donde `t_op` se deriva de las ventas SIN
     descontar, igual que en `obtenerEstudioNormalizadoParaParche`—. Si una de las dos rutas
     descontara el segmento y la otra no, o lo descontara dos veces, aquí saldría, y contra
     `analizarRangoAjustado` no: ese es el motor, no el informe. */
  const delInforme = analizarRango(conSeg);
  assert.ok(delInforme.stats, 'el informe publica rango con el segmento descontado');
  let deLasDosPuntas = 0;
  CLAVES.forEach((k) => {
    assert.strictEqual(delLibro[k], delInforme.stats[k],
      `el ${k} de la Tabla 18 con segmento excluido`);
    assert.strictEqual(estadisticaDelLibro(norm, 'MO', IDX_SIN_AJUSTE)[k],
      delInforme.statsNoAjustado[k],
      `el ${k} sin ajuste de la Tabla 18 con segmento excluido`);
    deLasDosPuntas += 2;
  });
  assert.strictEqual(deLasDosPuntas, 10,
    `debería cotejar 10 estadísticos contra el informe, cotejó ${deLasDosPuntas}`);
});
