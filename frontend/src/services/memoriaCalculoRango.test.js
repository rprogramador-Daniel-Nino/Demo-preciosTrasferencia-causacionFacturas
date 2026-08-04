import { test } from 'node:test';
import assert from 'node:assert';
import {
  construirMemoriaRango, hojasMemoriaRango, nombreArchivoMemoria,
} from './memoriaCalculoRango.js';

/* Cuatro comparables con margen 10 %, 13 %, 10 % y 13 %, y un contribuyente al 7,5 %.
   Números redondos a propósito: la memoria tiene que poder rehacerse a mano, y un test
   que no se puede verificar mentalmente no comprueba nada. */
const estudio = {
  ent: 'ACME COLOMBIA S.A.S',
  nit: '900123456-7',
  anio: 2025,
  pli: 'MO',
  t_s: 4000, t_c: 3300, t_op: 300, t_ar: 500, t_inv: 250, t_ap: 400,
  comparables: [
    { name: 'ANDINA S.A.', amb: 'Nac', s: 1000, c: 800, op: 100 },
    { name: 'GULF TRADING CO', amb: 'Int', s: 2000, c: 1600, op: 260 },
    { name: 'DEL SUR S.A.S', amb: 'Nac', s: 3000, c: 2400, op: 300 },
    { name: 'NORTH FUEL LTD', amb: 'Int', s: 4000, c: 3200, op: 520 },
  ],
};

test('el indicador y su fórmula salen del PLI del estudio', () => {
  const m = construirMemoriaRango(estudio);
  assert.strictEqual(m.indicador.clave, 'MO');
  assert.match(m.indicador.etiqueta, /Margen Operacional/);
  assert.strictEqual(m.resultado.pli, 0.075, 'MO del contribuyente = 300 / 4000');

  const berry = construirMemoriaRango({ ...estudio, pli: 'Berry' });
  assert.match(berry.indicador.etiqueta, /Berry/);
});

test('cada comparable trae su margen y el ajuste como diferencia entre los dos', () => {
  const m = construirMemoriaRango(estudio);
  assert.strictEqual(m.comparables.length, 4);
  assert.strictEqual(m.comparables[0].nombre, 'ANDINA S.A.');
  assert.strictEqual(m.comparables[0].noAjustado, 0.1);
  assert.strictEqual(m.comparables[0].ajustado, 0.1);
  /* Sin ajuste activado la columna del medio es cero, no un hueco: cero es el ajuste
     que de verdad se sumó. */
  assert.strictEqual(m.comparables[0].ajuste, 0);
});

test('los cuartiles publican la posición además del valor', () => {
  /* Sin la posición no se puede rehacer la cuenta sobre la serie de al lado, que es
     justamente lo que esta pantalla viene a permitir. */
  const m = construirMemoriaRango(estudio);
  assert.deepStrictEqual(m.serie, [0.1, 0.1, 0.13, 0.13]);
  assert.strictEqual(m.cuartiles.p25.posicion, 0);
  assert.strictEqual(m.cuartiles.mediana.posicion, 1);
  assert.strictEqual(m.cuartiles.p75.posicion, 2);
  assert.strictEqual(m.cuartiles.p75.valor, 0.13);
});

test('el filtro de ámbito deja fuera comparables y lo advierte', () => {
  /* El panel filtra por ámbito y el informe no. Que las dos cifras difieran es
     tolerable; que nadie lo sepa, no. */
  const m = construirMemoriaRango({ ...estudio, cmode: 'intl' });
  assert.strictEqual(m.serie.length, 2, 'solo las dos internacionales');
  assert.strictEqual(m.comparables.filter((c) => !c.incluida).length, 2);
  assert.match(m.comparables[0].excluida, /ámbito/);
  assert.ok(
    m.advertencias.some((a) => /informe en Word/.test(a)),
    'debe avisar de que el informe usa todas'
  );
});

test('la comparable sin cifras se marca excluida con su motivo', () => {
  const m = construirMemoriaRango({
    ...estudio,
    comparables: [...estudio.comparables, { name: 'SIN DATOS S.A.', amb: 'Int', s: '', c: '', op: '' }],
  });
  const sinDatos = m.comparables.find((c) => c.nombre === 'SIN DATOS S.A.');
  assert.strictEqual(sinDatos.incluida, false);
  assert.match(sinDatos.excluida, /estados financieros/);
  assert.ok(m.advertencias.some((a) => /no tienen estados financieros/.test(a)));
});

test('con el contribuyente fuera del rango se propone el ajuste hasta la mediana', () => {
  const m = construirMemoriaRango(estudio);
  assert.strictEqual(m.resultado.dentro, false);
  assert.strictEqual(m.resultado.dir, 'por debajo', '7,5 % está por debajo del P25 de 10 %');
  /* (0,10 − 0,075) × 4000 = 100 */
  assert.ok(Math.abs(m.resultado.ajustePropuesto - 100) < 1e-9);
});

test('con el contribuyente dentro del rango no hay ajuste que proponer', () => {
  const m = construirMemoriaRango({ ...estudio, t_op: 460 });
  assert.strictEqual(m.resultado.pli, 0.115);
  assert.strictEqual(m.resultado.dentro, true);
  assert.strictEqual(m.resultado.ajustePropuesto, null);
});

test('sin comparables no se inventa un rango', () => {
  const m = construirMemoriaRango({ ...estudio, comparables: [] });
  assert.strictEqual(m.cuartiles, null);
  assert.strictEqual(m.stats, null);
  assert.strictEqual(m.resultado.dentro, null);
  assert.deepStrictEqual(m.serie, []);
});

test('avisa cuando el rango se sostiene en menos de tres comparables', () => {
  /* El panel pinta un rango con una sola comparable y el informe exige tres: quien mira
     la tarjeta tiene que saber que esa cifra no va a salir en el Word. */
  const m = construirMemoriaRango({ ...estudio, comparables: [estudio.comparables[0]] });
  assert.ok(m.advertencias.some((a) => /tres como mínimo/.test(a)));
});

test('el ajuste activado con tasa en cero se advierte', () => {
  const m = construirMemoriaRango({ ...estudio, useadj: true, prime: 0 });
  assert.ok(m.advertencias.some((a) => /tasa de interés está en cero/.test(a)));
});

test('el ajuste de capital de trabajo mueve el margen de las comparables', () => {
  /* El ajuste solo corre si la comparable trae cuentas por cobrar, inventario y cuentas
     por pagar: sin capital de trabajo no hay nada que comparar y `ratios` devuelve null. */
  const m = construirMemoriaRango({
    ...estudio,
    useadj: true,
    prime: 10,
    comparables: [
      /* Ratios idénticos a los de la parte examinada (CxC/Ventas 12,5 %,
         Inventario/Ventas 6,25 %, CxP/Costos 12,12 %): la diferencia es cero y el
         ajuste también, aunque la tasa no lo sea. */
      { name: 'ESPEJO S.A.', amb: 'Int', s: 8000, c: 6600, op: 800, ar: 1000, inv: 500, ap: 800 },
      /* Con más capital de trabajo inmovilizado que la parte examinada, el ajuste baja
         su margen. */
      { name: 'PESADA LTDA', amb: 'Int', s: 1000, c: 800, op: 100, ar: 400, inv: 200, ap: 80 },
    ],
  });

  assert.strictEqual(m.ajuste.aplicado, true);
  assert.strictEqual(m.ajuste.tasa, 0.1);

  const espejo = m.comparables[0];
  assert.ok(Math.abs(espejo.ajuste) < 1e-9, 'sin diferencia de ratios el ajuste debe ser cero');

  const pesada = m.comparables[1];
  assert.ok(pesada.ajuste < 0, 'más capital de trabajo que la parte examinada baja el margen');
  assert.ok(
    Math.abs(pesada.ajustado - (pesada.noAjustado + pesada.ajuste)) < 1e-9,
    'el ajustado tiene que ser el margen más el ajuste'
  );
});

test('el índice de Berry no admite ajuste de capital de trabajo', () => {
  const m = construirMemoriaRango({ ...estudio, pli: 'Berry', useadj: true, prime: 10 });
  assert.strictEqual(m.ajuste.aplicado, false);
});

/* ══════════════ Hojas del Excel ══════════════ */

/** Valor de una celda, que siempre llega tipada como `{v, t, z, s}`. */
const valor = (c) => (c && typeof c === 'object' ? c.v : c);
/** Aplana una hoja a texto. */
const textoDe = (hoja) => hoja.filas.map((f) => f.map(valor).join(' | ')).join('\n');
const valores = (fila) => fila.map(valor);

const hojaLlamada = (hojas, nombre) => hojas.find((h) => h.nombre === nombre);
const filaQueEmpiezaEn = (hoja, etiqueta) => hoja.filas.find((f) => valor(f[0]) === etiqueta);

test('el libro trae las cuatro hojas de la memoria', () => {
  const hojas = hojasMemoriaRango(construirMemoriaRango(estudio), estudio);
  assert.deepStrictEqual(
    hojas.map((h) => h.nombre),
    ['Resumen', 'Comparables', 'Serie y cuartiles', 'Parte examinada']
  );
  hojas.forEach((h) => assert.ok(h.filas.length, 'la hoja ' + h.nombre + ' salió vacía'));
});

test('la hoja de resumen identifica al contribuyente y publica las fórmulas', () => {
  /* Un Excel de cuartiles sin el nombre del contribuyente ni la fórmula no sirve como
     soporte: es una lista de porcentajes sin dueño. */
  const texto = textoDe(hojaLlamada(hojasMemoriaRango(construirMemoriaRango(estudio), estudio), 'Resumen'));
  assert.match(texto, /ACME COLOMBIA S\.A\.S/);
  assert.match(texto, /900123456-7/);
  assert.match(texto, /2025/);
  assert.match(texto, /Utilidad operacional ÷ Ingresos operacionales/);
  assert.match(texto, /Posición en la serie/, 'falta la posición de la que sale cada cuartil');
});

test('cada bloque del resumen tiene su fila de encabezado', () => {
  /* Es lo que distingue una tabla de una lista de pares suelta: sin el encabezado, la
     columna de la derecha no dice si es un valor, una posición o una fórmula. */
  const texto = textoDe(hojaLlamada(hojasMemoriaRango(construirMemoriaRango(estudio), estudio), 'Resumen'));
  assert.match(texto, /IDENTIFICACIÓN/);
  assert.match(texto, /CUARTILES/);
  assert.match(texto, /RESULTADO/);
  assert.match(texto, /Concepto \| Posición en la serie \| Valor/);
});

test('la hoja de comparables empieza por su encabezado y lleva autofiltro', () => {
  /* El encabezado va en la fila 1 sin título encima para que el autofiltro cubra la
     tabla entera: así se ordena por margen de un clic. */
  const hoja = hojaLlamada(hojasMemoriaRango(construirMemoriaRango(estudio), estudio), 'Comparables');
  assert.strictEqual(valor(hoja.filas[0][0]), '#');
  assert.strictEqual(valor(hoja.filas[0][1]), 'Compañía');
  assert.strictEqual(hoja.autofiltro, 'A1:H5', '4 comparables + encabezado, 8 columnas');
  for (const c of estudio.comparables) {
    assert.ok(textoDe(hoja).includes(c.name), 'falta ' + c.name);
  }
});

test('la serie ordenada va en su propia hoja, con la compañía de cada margen', () => {
  /* Aparte de la tabla de comparables para no romperle el autofiltro, y con el nombre
     al lado porque un cuartil sin saber de quién es no se puede defender. */
  const hoja = hojaLlamada(hojasMemoriaRango(construirMemoriaRango(estudio), estudio), 'Serie y cuartiles');
  assert.deepStrictEqual(valores(hoja.filas[0]), ['Posición', 'Compañía', 'Margen ajustado', 'Cuartil']);
  const texto = textoDe(hoja);
  assert.match(texto, /P25/);
  assert.match(texto, /Mediana/);
  assert.match(texto, /P75/);
  assert.match(texto, /ANDINA S\.A\./, 'falta la compañía dueña del margen');
});

test('los porcentajes y los importes van como número con formato, no como texto', () => {
  /* Es la diferencia entre una hoja que se puede ordenar, filtrar y sumar y una lista de
     etiquetas: sobre el texto «10,00 %» no se puede cruzar nada. */
  const hojas = hojasMemoriaRango(construirMemoriaRango(estudio), estudio);
  const margen = hojaLlamada(hojas, 'Comparables').filas[1][3];
  assert.strictEqual(margen.v, 0.1, 'debe guardar el decimal, no la cadena');
  assert.strictEqual(margen.t, 'n');
  assert.strictEqual(margen.z, '0.00%');

  const ingresos = filaQueEmpiezaEn(hojaLlamada(hojas, 'Parte examinada'), 'Ingresos operacionales')[1];
  assert.strictEqual(ingresos.v, 4000);
  assert.strictEqual(ingresos.z, '#,##0');
});

test('la comparable sin cifras deja las celdas vacías, no en cero', () => {
  /* Un cero en la columna de margen es un margen del 0 %, que es un dato falso. */
  const conHueco = {
    ...estudio,
    comparables: [{ name: 'SIN DATOS S.A.', amb: 'Int', s: '', c: '', op: '' }],
  };
  const fila = hojaLlamada(hojasMemoriaRango(construirMemoriaRango(conHueco), conHueco), 'Comparables').filas[1];
  assert.strictEqual(valor(fila[3]), '', 'margen sin ajustar');
  assert.strictEqual(fila[3].t, 's', 'la celda vacía va como texto vacío, no como cero');
  assert.strictEqual(valor(fila[5]), '', 'margen ajustado');
  assert.strictEqual(valor(fila[7]), 'sin estados financieros cargados');
});

test('todas las hojas traen anchos de columna', () => {
  /* Sin ellos las columnas de texto salen cortadas al ancho de una celda y la hoja se
     lee peor que la pantalla que viene a acompañar. */
  const hojas = hojasMemoriaRango(construirMemoriaRango(estudio), estudio);
  hojas.forEach((h) => {
    assert.ok(h.cols && h.cols.length, 'la hoja ' + h.nombre + ' no trae anchos');
    assert.ok(h.cols.every((c) => c.wch > 0), 'ancho inválido en ' + h.nombre);
    const columnas = Math.max(...h.filas.map((f) => f.length));
    assert.ok(h.cols.length >= columnas, 'faltan anchos en ' + h.nombre);
  });
});

test('las filas de título ocupan el ancho de la tabla', () => {
  const hojas = hojasMemoriaRango(construirMemoriaRango(estudio), estudio);
  const resumen = hojaLlamada(hojas, 'Resumen');
  assert.ok(resumen.merges.length >= 4, 'faltan combinaciones de los títulos de bloque');
  /* La primera combinación es la del título del documento, en la fila 0. */
  assert.deepStrictEqual(resumen.merges[0], { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } });
  assert.ok(hojaLlamada(hojas, 'Parte examinada').merges.length >= 3);
});

test('las advertencias viajan al Excel numeradas, no solo a la pantalla', () => {
  /* El Excel se manda por correo y se adjunta al expediente; si la salvedad se queda en
     la pantalla, el documento que circula afirma más de lo que se comprobó. */
  const conFiltro = { ...estudio, cmode: 'nac' };
  const texto = textoDe(hojaLlamada(hojasMemoriaRango(construirMemoriaRango(conFiltro), conFiltro), 'Resumen'));
  assert.match(texto, /ADVERTENCIAS/);
  assert.match(texto, /# \| Salvedad/);
  assert.match(texto, /informe en Word/);
});

test('el nombre del archivo lleva contribuyente y año, sin caracteres prohibidos', () => {
  assert.strictEqual(
    nombreArchivoMemoria(estudio),
    'Memoria rango intercuartil - ACME COLOMBIA S.A.S 2025.xlsx'
  );
  const raro = nombreArchivoMemoria({ ent: 'A/B:C*D?E"F<G>H|I', anio: 2024 });
  assert.ok(!/[\\/:*?"<>|]/.test(raro), 'quedó un carácter que Windows no admite: ' + raro);
});

test('sin razón social el archivo sigue teniendo nombre', () => {
  assert.match(nombreArchivoMemoria({}), /^Memoria rango intercuartil - estudio\.xlsx$/);
});

/* ══════════════ Estilo de las tablas del Excel ══════════════
   Se comprueba sobre las celdas y no sobre el archivo porque el archivo lo escribe
   `xlsx-js-style` y lo que aquí se decide es qué formato lleva cada celda. */

test('el título del documento va en negrita, blanco sobre el color del producto', () => {
  const hoja = hojaLlamada(hojasMemoriaRango(construirMemoriaRango(estudio), estudio), 'Resumen');
  const titulo = hoja.filas[0][0];
  assert.strictEqual(titulo.s.font.bold, true);
  assert.strictEqual(titulo.s.font.color.rgb, 'FFFFFF');
  assert.strictEqual(titulo.s.fill.fgColor.rgb, '0B7C7A');
});

test('el encabezado de cada tabla va en negrita sobre fondo, con borde', () => {
  /* Es lo que separa la fila de nombres de columna de las filas de dato: sin ella la
     tabla se lee como una lista de valores sin saber de qué. */
  const hoja = hojaLlamada(hojasMemoriaRango(construirMemoriaRango(estudio), estudio), 'Comparables');
  hoja.filas[0].forEach((celda) => {
    assert.strictEqual(celda.s.font.bold, true);
    assert.strictEqual(celda.s.fill.fgColor.rgb, '0FA3A1');
    assert.ok(celda.s.border.bottom, 'el encabezado debe llevar borde');
  });
});

test('los títulos de bloque se distinguen de los encabezados y de los datos', () => {
  const hoja = hojaLlamada(hojasMemoriaRango(construirMemoriaRango(estudio), estudio), 'Resumen');
  const bloque = filaQueEmpiezaEn(hoja, 'IDENTIFICACIÓN')[0];
  assert.strictEqual(bloque.s.font.bold, true);
  assert.strictEqual(bloque.s.fill.fgColor.rgb, 'F1F5F9');
  assert.strictEqual(bloque.s.font.color.rgb, '0B7C7A');
});

test('las filas de dato alternan el fondo dentro de cada tabla', () => {
  /* Seguir una fila de ocho columnas sin perder el renglón es lo que hace legible la
     tabla de comparables. */
  const hoja = hojaLlamada(hojasMemoriaRango(construirMemoriaRango(estudio), estudio), 'Comparables');
  assert.ok(!hoja.filas[1][0].s.fill, 'la primera fila de dato va sin fondo');
  assert.strictEqual(hoja.filas[2][0].s.fill.fgColor.rgb, 'F8FAFC', 'la segunda alterna');
  assert.ok(!hoja.filas[3][0].s.fill, 'la tercera vuelve a ir sin fondo');
});

test('la alternancia se reinicia en cada tabla, no arrastra del bloque anterior', () => {
  /* Si el contador siguiera corriendo entre bloques, la primera fila de una tabla podría
     salir sombreada y la de al lado no, y las tablas dejarían de parecer la misma cosa. */
  const hoja = hojaLlamada(hojasMemoriaRango(construirMemoriaRango(estudio), estudio), 'Resumen');
  const primeraDeIdentificacion = filaQueEmpiezaEn(hoja, 'Contribuyente')[0];
  const primeraDeResultado = filaQueEmpiezaEn(hoja, 'Indicador del contribuyente')[0];
  assert.ok(!primeraDeIdentificacion.s.fill);
  assert.ok(!primeraDeResultado.s.fill);
});

test('las cifras se alinean a la derecha y el texto no', () => {
  /* Con los decimales en la misma vertical se comparan dos porcentajes de un vistazo. */
  const fila = hojaLlamada(hojasMemoriaRango(construirMemoriaRango(estudio), estudio), 'Comparables').filas[1];
  assert.strictEqual(fila[3].s.alignment.horizontal, 'right', 'el margen es cifra');
  assert.notStrictEqual(fila[1].s.alignment.horizontal, 'right', 'la razón social no');
});

test('la primera columna de cada fila de dato es la etiqueta y va destacada', () => {
  const fila = filaQueEmpiezaEn(
    hojaLlamada(hojasMemoriaRango(construirMemoriaRango(estudio), estudio), 'Parte examinada'),
    'Ingresos operacionales'
  );
  assert.strictEqual(fila[0].s.font.bold, true, 'la etiqueta va en seminegrita');
  assert.ok(!fila[1].s.font.bold, 'el valor no compite con ella');
});

test('las advertencias van sobre ámbar, para que no se lean como un dato más', () => {
  const conFiltro = { ...estudio, cmode: 'nac' };
  const hoja = hojaLlamada(hojasMemoriaRango(construirMemoriaRango(conFiltro), conFiltro), 'Resumen');
  const aviso = hoja.filas[hoja.filas.length - 1];
  assert.strictEqual(aviso[1].s.fill.fgColor.rgb, 'FEF3C7');
  assert.strictEqual(aviso[1].s.alignment.wrapText, true, 'un párrafo largo tiene que envolver');
});

test('toda celda de tabla lleva borde, incluidas las vacías', () => {
  /* Sin la celda vacía estilizada el borde de la fila se corta a media tabla y el bloque
     parece recortado. */
  const hojas = hojasMemoriaRango(construirMemoriaRango(estudio), estudio);
  const resumen = hojaLlamada(hojas, 'Resumen');
  const fila = filaQueEmpiezaEn(resumen, 'Contribuyente');
  assert.strictEqual(fila.length, 3, 'la fila se rellena hasta el ancho de la tabla');
  fila.forEach((celda, i) => assert.ok(celda.s.border, 'sin borde en la columna ' + i));
  assert.strictEqual(valor(fila[2]), '', 'la tercera columna va vacía pero presente');
});

test('las filas en blanco entre bloques quedan sin celdas ni estilo', () => {
  /* Son el aire entre tablas: una fila «vacía» con bordes se vería como una fila de dato
     sin datos. */
  const hoja = hojaLlamada(hojasMemoriaRango(construirMemoriaRango(estudio), estudio), 'Resumen');
  assert.deepStrictEqual(hoja.filas[1], [], 'la fila que sigue al título debe estar vacía');
});

test('el alto de la fila del título acompaña al tamaño de letra', () => {
  const hoja = hojaLlamada(hojasMemoriaRango(construirMemoriaRango(estudio), estudio), 'Resumen');
  assert.ok(hoja.rows && hoja.rows[0].hpt >= 20, 'el título necesita más alto que una fila normal');
});
