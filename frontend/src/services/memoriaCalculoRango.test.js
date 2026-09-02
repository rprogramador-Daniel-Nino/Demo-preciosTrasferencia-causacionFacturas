import { test } from 'node:test';
import assert from 'node:assert';
import { construirMemoriaRango, nombreArchivoMemoria } from './memoriaCalculoRango.js';
import { analizarRango } from './rangoIntercuartil.js';

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

test('la fórmula publicada del cuartil describe la interpolación que se ejecuta', () => {
  /* Este texto se imprime en el modal y en el Excel que se radica ante la DIAN. Decía
     «sin interpolar» mientras el código interpolaba: una afirmación falsa dentro de un
     documento tributario. El test existe para que no vuelva a divergir del cálculo. */
  const m = construirMemoriaRango(estudio);
  assert.match(m.cuartilFormula, /interpolaci[óo]n lineal/i);
  assert.match(m.cuartilFormula, /QUARTILE\.INC/);
  assert.doesNotMatch(m.cuartilFormula, /sin interpolar/i);
});

test('la fórmula publicada del ajuste nombra las dos convenciones de factor', () => {
  /* `indicadorAjustado` escala CxC y CxP por r/(1+r) e inventario por r, y multiplica
     cada partida por la base del método. El texto anterior describía un ajuste neto
     único multiplicado por la tasa, que no es lo que calcula el motor. */
  const m = construirMemoriaRango({ ...estudio, useadj: true, prime: '7.37' });
  assert.match(m.ajuste.formula, /r\/\(1\+r\)/);
  assert.match(m.ajuste.formula, /AjCxC/);
  assert.match(m.ajuste.formula, /AjInv/);
  assert.doesNotMatch(m.ajuste.formula, /^Tasa × \[/);
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
  /* Serie 0,10 · 0,10 · 0,13 · 0,13. La mediana cae entre el segundo y el tercero, así
     que interpola a 0,115 —QUARTILE.INC, la misma que usa el Excel de soporte—.
     (0,115 − 0,075) × 4000 = 160. Con la fórmula truncada anterior daba 0,10 y 100. */
  assert.ok(Math.abs(m.resultado.ajustePropuesto - 160) < 1e-9, `ajuste=${m.resultado.ajustePropuesto}`);
});

test('la memoria avisa cuándo un cuartil salió de interpolar entre dos datos', () => {
  /* Quien rehace la cuenta a mano busca el número en la serie de al lado; si el cuartil
     cayó entre dos posiciones, no lo va a encontrar y tiene que saber por qué. */
  const m = construirMemoriaRango(estudio);
  assert.strictEqual(m.cuartiles.mediana.valor, 0.115, 'entre 0,10 y 0,13');
  /* Con cuatro datos las tres posiciones caen fraccionarias (0,75 · 1,5 · 2,25). */
  assert.strictEqual(m.cuartiles.mediana.interpolado, true);
  assert.strictEqual(m.cuartiles.p25.interpolado, true);

  /* Con cinco, el P25 cae justo sobre el segundo dato: 0,25 × 4 = 1. */
  const cinco = construirMemoriaRango({
    ...estudio,
    comparables: [...estudio.comparables, { name: 'QUINTA S.A.', amb: 'Int', s: 5000, c: 4000, op: 750 }],
  });
  assert.strictEqual(cinco.cuartiles.p25.interpolado, false);
  assert.strictEqual(cinco.cuartiles.p25.posicion, 1);
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

test('el índice de Berry admite ajuste de capital de trabajo', () => {
  /* Estuvo exceptuado mientras el sistema lo definía como ventas / costos totales.
     Con la definición del motor —utilidad bruta / gastos operativos— sí lo admite,
     igual que la hoja Berry del Excel de soporte. */
  const m = construirMemoriaRango({ ...estudio, pli: 'Berry', useadj: true, prime: 10 });
  assert.strictEqual(m.ajuste.aplicado, true);
  assert.match(m.indicador.formula, /Gastos operativos/);
});

/* ══════════════ Calidad del dato de entrada ══════════════
   Las cuatro salen de la auditoría del modelo Excel del cliente: eran advertencias que
   un humano escribió a mano y que el sistema no sabía detectar. */

test('avisa de la comparable con PP&E desproporcionado', () => {
  const m = construirMemoriaRango({
    ...estudio,
    t_ppe: 40, // 1 % de las ventas de la parte examinada
    comparables: [
      ...estudio.comparables,
      { name: 'PESADA S.A.', amb: 'Int', s: 1000, c: 800, op: 100, ppe: 1300 },
    ],
  });
  assert.ok(
    m.advertencias.some((a) => /PESADA S\.A\./.test(a) && /PP&E/.test(a)),
    'debe nombrar la comparable y el activo fijo'
  );
});

test('avisa de comparables sin costo de ventas relevante', () => {
  const m = construirMemoriaRango({
    ...estudio,
    comparables: [
      ...estudio.comparables,
      { name: 'SIN COSTO LTD', amb: 'Int', s: 1000, c: 5, op: 100 },
    ],
  });
  assert.ok(
    m.advertencias.some((a) => /SIN COSTO LTD/.test(a) && /Berry/.test(a)),
    'debe decir qué métodos deja de sostener'
  );
});

test('avisa cuando el denominador de Cost Plus queda negativo', () => {
  const m = construirMemoriaRango({
    ...estudio,
    comparables: [
      ...estudio.comparables,
      { name: 'DEBE MAS LTD', amb: 'Int', s: 1000, c: 300, op: 100, ap: 500 },
    ],
  });
  assert.ok(m.advertencias.some((a) => /DEBE MAS LTD/.test(a) && /Cost Plus/.test(a)));
});

test('avisa de cuentas por pagar demasiado bajas en la parte examinada', () => {
  /* En los datos reales equivalían a 3,6 días de costo. */
  const m = construirMemoriaRango({ ...estudio, t_ap: 10 }); // 0,25 % de 4000
  assert.ok(m.advertencias.some((a) => /cuentas por pagar/i.test(a) && /1 %/.test(a)));
});

test('el estudio limpio no emite ninguna advertencia de calidad', () => {
  const m = construirMemoriaRango(estudio);
  assert.ok(
    !m.advertencias.some((a) => /PP&E|costo de ventas|Cost Plus|cuentas por pagar/i.test(a)),
    'salió una advertencia de calidad sobre datos que están bien: ' + m.advertencias.join(' / ')
  );
});

/* ══════════════ Nombre del archivo ══════════════ */

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

/* El fixture de las pruebas del rango que decide: cifras del contribuyente y comparables a las
   que se les pone el capital de trabajo a mano, porque el desplazamiento del ajuste es justo lo
   que separa las dos series. */
const ESTUDIO_BASE = {
  ent: 'ACME COLOMBIA S.A.S', nit: '900123456-7', anio: 2025, pli: 'MO', cmode: 'all',
  t_s: 100000, t_c: 92000, t_op: 6204,
};
const compMem = (nombre, margen, wc) => ({
  name: nombre, amb: 'Int', s: 10000, c: 8000, op: margen * 10000, ...wc,
});

/* ══════════ LA MEMORIA TIENE QUE EXPLICAR EL RANGO QUE DECIDE, NO OTRO ══════════

   Reportado el 2026-09-02 con dos capturas del mismo estudio, una al lado de la otra:

     Memoria del rango:  13,962 % – 22,250 % · mediana 16,297 % · MO del contribuyente 6,204 %
     Tarjeta:            CUMPLE, con 4,840 % de holgura sobre el primer cuartil

   Las dos eran ciertas y juntas se contradecían. La tarjeta decide con el rango SIN ajustar
   —`useadj` estaba apagado, y ella misma lo decía— cuyo primer cuartil es 1,364 %; la memoria
   publicaba el AJUSTADO, doce puntos más arriba, junto al indicador del contribuyente. Puesto
   así, cualquiera concluye que el estudio no cumple.

   La causa: `memoriaCalculoRango.js` armaba la serie con `c.ajustado` SIEMPRE, sin consultar
   `useadj`. Su propio `useAdj` existía y solo se usaba para un aviso y para informar
   `ajuste.aplicado`, nunca para elegir la serie. El modal existe para explicar el número de la
   tarjeta: si calcula sobre otra serie, explica un número que nadie ve. */

test('con el ajuste apagado, la memoria calcula sobre el margen SIN ajustar', () => {
  /* El caso reportado: comparables cuyo ajuste desplaza el rango varios puntos. Con `useadj`
     apagado la memoria tiene que publicar el rango que la tarjeta usa para concluir. */
  const estudio = {
    ...ESTUDIO_BASE,
    useadj: false,
    prime: 12.5,
    t_ar: 5000, t_inv: 9000, t_ap: 3000,
    comparables: [
      compMem('Alfa', 0.02, { ar: 0, inv: 0, ap: 0 }),
      compMem('Beta', 0.05, { ar: 0, inv: 0, ap: 0 }),
      compMem('Gama', 0.08, { ar: 0, inv: 0, ap: 0 }),
      compMem('Delta', 0.11, { ar: 0, inv: 0, ap: 0 }),
      compMem('Epsilon', 0.14, { ar: 0, inv: 0, ap: 0 }),
    ],
  };
  const m = construirMemoriaRango(estudio);
  const r = analizarRango(estudio);

  assert.ok(m.cuartiles, 'hay cuartiles');
  assert.ok(Math.abs(m.cuartiles.p25.valor - r.stats.p25) < 1e-12,
    `la memoria dice P25 ${m.cuartiles.p25.valor} y el que decide es ${r.stats.p25}`);
  assert.ok(Math.abs(m.cuartiles.p75.valor - r.stats.p75) < 1e-12, 'y el P75 igual');
  assert.ok(Math.abs(m.cuartiles.mediana.valor - r.stats.med) < 1e-12, 'y la mediana');
});

test('con el ajuste encendido, la memoria calcula sobre el ajustado', () => {
  /* La otra mitad de la regla: no se trata de dejar de usar el ajustado, sino de usar el que
     manda. Con `useadj` encendido el que manda es el ajustado. */
  const estudio = {
    ...ESTUDIO_BASE,
    useadj: true,
    prime: 12.5,
    t_ar: 5000, t_inv: 9000, t_ap: 3000,
    comparables: [
      compMem('Alfa', 0.02, { ar: 0, inv: 0, ap: 0 }),
      compMem('Beta', 0.05, { ar: 0, inv: 0, ap: 0 }),
      compMem('Gama', 0.08, { ar: 0, inv: 0, ap: 0 }),
      compMem('Delta', 0.11, { ar: 0, inv: 0, ap: 0 }),
      compMem('Epsilon', 0.14, { ar: 0, inv: 0, ap: 0 }),
    ],
  };
  const m = construirMemoriaRango(estudio);
  const r = analizarRango(estudio);
  assert.ok(Math.abs(m.cuartiles.p25.valor - r.stats.p25) < 1e-12,
    `la memoria dice P25 ${m.cuartiles.p25.valor} y el que decide es ${r.stats.p25}`);
});

test('la memoria dice cuál de los dos rangos está explicando', () => {
  /* Con las dos columnas a la vista —sin ajustar y ajustado— hay que decir cuál sostiene la
     conclusión, o el lector vuelve a comparar el indicador contra la que no manda, que es
     exactamente lo que pasó. */
  const base = {
    ...ESTUDIO_BASE, prime: 12.5, t_ar: 5000, t_inv: 9000, t_ap: 3000,
    comparables: [
      compMem('Alfa', 0.02, { ar: 0, inv: 0, ap: 0 }),
      compMem('Beta', 0.05, { ar: 0, inv: 0, ap: 0 }),
      compMem('Gama', 0.08, { ar: 0, inv: 0, ap: 0 }),
    ],
  };
  assert.strictEqual(construirMemoriaRango({ ...base, useadj: false }).serieQueDecide, 'noAjustado');
  assert.strictEqual(construirMemoriaRango({ ...base, useadj: true }).serieQueDecide, 'ajustado');
});

test('el veredicto de la memoria coincide con el de la tarjeta', () => {
  /* LA PRUEBA QUE CIERRA EL DEFECTO: el contribuyente en 6,204 % contra un rango ajustado que
     arranca en 13,962 % pero un rango sin ajustar que arranca por debajo. La memoria y la
     tarjeta tienen que concluir lo MISMO. */
  const estudio = {
    ...ESTUDIO_BASE,
    useadj: false, prime: 12.5,
    t_s: 100000, t_c: 88000, t_op: 6204,
    t_ar: 5000, t_inv: 9000, t_ap: 3000,
    comparables: [
      compMem('Alfa', 0.005, { ar: 0, inv: 0, ap: 0 }),
      compMem('Beta', 0.02, { ar: 0, inv: 0, ap: 0 }),
      compMem('Gama', 0.05, { ar: 0, inv: 0, ap: 0 }),
      compMem('Delta', 0.09, { ar: 0, inv: 0, ap: 0 }),
      compMem('Epsilon', 0.13, { ar: 0, inv: 0, ap: 0 }),
    ],
  };
  const m = construirMemoriaRango(estudio);
  const r = analizarRango(estudio);
  const dentroEnLaMemoria = m.cuartiles
    && m.parteExaminada.pli >= m.cuartiles.p25.valor
    && m.parteExaminada.pli <= m.cuartiles.p75.valor;
  assert.strictEqual(dentroEnLaMemoria, r.cumple === 'CUMPLE',
    'la memoria concluye lo mismo que la tarjeta sobre el mismo estudio');
});
