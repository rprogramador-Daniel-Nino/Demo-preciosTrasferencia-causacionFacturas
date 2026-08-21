/* Tests de la verificación de estados financieros del contribuyente.

   El fixture son las cifras reales de MONTACHEM INTERNATIONAL S.A. (NIT 900.213.910-7) al
   31 de diciembre de 2025, tal como las imprime el PDF que el analista carga. Se usa ese
   documento y no uno inventado porque los dos defectos que este módulo cierra solo
   aparecen con un estado real: una fila rotulada «RESULTADO DE ACTIVIDADES DE LA
   OPERACIÓN» que en realidad trae el total de los gastos, y una cuenta por pagar comercial
   que no existe en el balance.

   Alcance vigente (fijado por el usuario el 2026-08-21): del balance se toman tres
   partidas —CxC y CxP a partes relacionadas, e inventarios— más el total del activo
   corriente; del estado de resultados, los ingresos y el costo, y la utilidad operacional
   se CALCULA como ingresos − costo − (gastos de ventas + gastos de administración). */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  verificarEeff, camposAplicables, utilidadOperacionalDe, gastosOperativosDe,
} from './eeffVerificacion.js';

/* La capa de texto del PDF, reducida a las líneas con cifra. Es lo que `extraerTextoPdf`
   devuelve para este documento (tiene texto embebido; no es un escaneo). */
const TEXTO_PDF = `--- Página 1 ---
EFECTIVO Y EQUIVALENTES DE EFECTIVO | 3 | 337.546.138 | 1.530.565.829
DEUDORES COMERCIALES Y OTRAS CUENTAS POR COBRAR | 4 | 6.032.337.879 | 6.866.462.173
CUENTAS POR COBRAR A PARTES RELACIONADAS | 5 | 2.926.256.259 | 1.136.030.409
INVENTARIOS | 6 | 4.734.795.891 | 5.620.907.919
ACTIVOS FINANCIEROS | 7 | 20.005.897 | 18.456.845
TOTAL ACTIVO CORRIENTE | 14.050.942.064 | 15.172.423.175
TOTAL ACTIVO | 15.004.112.346 | 16.091.653.625
CUENTAS POR PAGAR A PARTES RELACIONADAS | 11 | 5.400.016.795 | 5.535.262.470
OTRAS CUENTAS POR PAGAR | 12 | 658.293.893 | 604.110.193

--- Página 2 ---
INGRESOS DE ACTIVIDADES ORDINARIAS | 17 | 23.741.367.744 | 20.551.569.611
COSTO DE VENTAS | 17 | -21.850.187.494 | -17.772.890.770
UTILIDAD BRUTA | 1.891.180.250 | 2.778.678.841
OTROS INGRESOS | 18 | 8.298 | 3.498.679
GASTOS DE VENTAS Y DISTRIBUCION | 19 | -2.409.923.291 | -1.318.200.870
GASTOS DE ADMINISTRACION | 19 | -572.260.813 | -458.220.142
OTROS GASTOS | 20 | -4.060.225 | -31.266.993
RESULTADO DE ACTIVIDADES DE LA OPERACIÓN | -2.986.236.031 | -1.804.189.326`;

/* La lectura tal como la devuelve el modelo con el prompt vigente: las tres partidas de
   partes relacionadas, el subtotal, ingresos, costo y los dos gastos del giro. Ninguna
   utilidad operacional: ya no se pide. */
const LECTURA = {
  t_s: 23741367744,
  t_c: -21850187494,
  t_ar: 2926256259,
  t_inv: 4734795891,
  t_ap: 5400016795,
  t_act_curr: 14050942064,
  cotejo: {
    gastos_ventas: -2409923291,
    gastos_administracion: -572260813,
    utilidad_bruta: 1891180250,
  },
  rotulos: {
    cuentas_por_cobrar_relacionadas: 'CUENTAS POR COBRAR A PARTES RELACIONADAS',
    cuentas_por_pagar_relacionadas: 'CUENTAS POR PAGAR A PARTES RELACIONADAS',
  },
  rubrosNoAsignados: [
    { rotulo: 'DEUDORES COMERCIALES Y OTRAS CUENTAS POR COBRAR', valor: 6032337879 },
    { rotulo: 'OTRAS CUENTAS POR PAGAR', valor: 658293893 },
    { rotulo: 'OTROS GASTOS', valor: -4060225 },
  ],
  periodo: '2025',
  unidadOrigen: 'unidades',
  textoPdf: TEXTO_PDF,
};

const verificar = (extra = {}) => verificarEeff({ ...LECTURA, ...extra }, { anioEstudio: 2025 });

/* ══════ Los gastos operativos y la utilidad operacional ══════ */

test('los gastos operativos son gastos de ventas + gastos de administración', () => {
  /* 2.409.923.291 + 572.260.813 = 2.982.184.104. «Otros gastos» (4.060.225) queda fuera. */
  assert.strictEqual(verificar().campos.t_gastos, 2982184104);
});

test('la utilidad operacional se calcula: ingresos − costo − gastos operativos', () => {
  /* 23.741.367.744 − 21.850.187.494 − 2.982.184.104 = −1.091.003.854 */
  assert.strictEqual(verificar().campos.t_op, -1091003854);
});

test('la fila «RESULTADO DE ACTIVIDADES DE LA OPERACIÓN» ya no puede decidir el margen', () => {
  /* Es el defecto que motivó el cambio: esa fila trae −2.986.236.031, que en ese estado es
     el total de los gastos y no la utilidad. Aunque la lectura la devolviera, no participa
     del cálculo — ni como valor ni para contradecirlo. */
  const conLaFila = verificar({
    cotejo: { ...LECTURA.cotejo, utilidad_operacional: -2986236031 },
  });
  assert.strictEqual(conLaFila.campos.t_op, -1091003854);
  assert.notStrictEqual(conLaFila.campos.t_gastos, 4877416281,
    'el 4.877.416.281 que publicaba el libro no puede volver a aparecer');
});

test('el costo con el signo del documento no infla la utilidad', () => {
  /* Con el costo en negativo sin normalizar, ingresos − costo sumaba: la utilidad salía
     de 45.591.555.238 − gastos en vez de 1.891.180.250 − gastos. */
  const conSigno = verificar().campos.t_op;
  const enPositivo = verificar({ t_c: 21850187494 }).campos.t_op;
  assert.strictEqual(conSigno, enPositivo);
  assert.ok(conSigno < 0, 'la compañía está en pérdida operativa y así debe entrar');
});

test('con un solo rubro de gasto se sigue adelante', () => {
  /* Hay estados que no desglosan gastos de ventas porque los llevan todos a
     administración. No es motivo para dejar el estudio sin margen. */
  const soloAdmon = verificar({
    cotejo: { ...LECTURA.cotejo, gastos_ventas: null },
  });
  assert.strictEqual(soloAdmon.campos.t_gastos, 572260813);
  assert.strictEqual(soloAdmon.campos.t_op, 23741367744 - 21850187494 - 572260813);
});

test('sin ninguno de los dos gastos no se inventa la utilidad, se avisa', () => {
  const sinGastos = verificar({
    cotejo: { gastos_ventas: null, gastos_administracion: null, utilidad_bruta: null },
  });
  assert.strictEqual(sinGastos.campos.t_op, null);
  assert.ok(sinGastos.advertencias.some((a) => a.tipo === 'sin-utilidad-operacional'));
});

test('si falta el costo, se dice cuál de las tres cifras falta', () => {
  const sinCosto = verificar({ t_c: null });
  assert.strictEqual(sinCosto.campos.t_op, null);
  const a = sinCosto.advertencias.find((x) => x.tipo === 'sin-utilidad-operacional');
  assert.match(a.mensaje, /costo de ventas/);
});

/* ══════ Las tres partidas del balance ══════ */

test('toma las cuentas por cobrar y por pagar de PARTES RELACIONADAS', () => {
  const { campos } = verificar();
  assert.strictEqual(campos.t_ar, 2926256259, 'no los 6.032.337.879 de deudores comerciales');
  assert.strictEqual(campos.t_ap, 5400016795, 'no las otras cuentas por pagar');
  assert.strictEqual(campos.t_inv, 4734795891);
});

test('el total del activo corriente entra tal como lo imprime el documento', () => {
  assert.strictEqual(verificar().campos.t_act_curr, 14050942064);
});

test('no toca ningún otro rubro del balance', () => {
  /* El alcance son tres partidas y un subtotal: si esta ingesta escribiera efectivo,
     intangibles o el total de activos, estaría pisando campos que ya no le corresponden. */
  const aplicables = camposAplicables(verificar().campos);
  ['t_cash', 't_inv_assoc', 't_tax', 't_ppe', 't_intang', 't_dif', 't_act_nocurr', 't_act_tot']
    .forEach((clave) => assert.ok(!(clave in aplicables), `${clave} no debería escribirse`));
});

test('si falta una partida de partes relacionadas, se listan las que el documento sí trae', () => {
  const sinCxp = verificar({ t_ap: null });
  const a = sinCxp.advertencias.find((x) => x.tipo === 'sin-partida-relacionada' && x.campo === 't_ap');
  assert.ok(a, 'su ajuste quedaría en cero sin avisar');
  assert.match(a.mensaje, /OTRAS CUENTAS POR PAGAR/);
  assert.match(a.mensaje, /en cero/);
});

test('sin inventarios se avisa, porque su ajuste queda contra cero', () => {
  const r = verificar({ t_inv: null });
  assert.ok(r.advertencias.some((a) => a.tipo === 'sin-inventarios'));
});

/* ══════ Anti-alucinación: la cifra tiene que estar impresa ══════ */

test('una cifra que no aparece en el documento se descarta y se reporta', () => {
  /* El caso literal: la lectura devolvió 44.177.669 como cuentas por pagar de un documento
     donde esa cifra no aparece en ninguna de sus cuatro páginas. */
  const { campos, advertencias } = verificar({ t_ap: 44177669 });
  assert.strictEqual(campos.t_ap, null);
  const a = advertencias.find((x) => x.tipo === 'cifra-inexistente' && x.campo === 't_ap');
  assert.ok(a);
  assert.match(a.mensaje, /44\.177\.669/);
});

test('una cifra descartada no se cuela en el cálculo de la utilidad', () => {
  /* Si el costo no está impreso, se descarta, y entonces no puede haber utilidad
     operacional calculada con él: sería una cifra derivada de otra que no existe. */
  const { campos } = verificar({ t_c: -99999999999 });
  assert.strictEqual(campos.t_c, null);
  assert.strictEqual(campos.t_op, null);
});

test('las cifras que sí están impresas pasan intactas', () => {
  const { campos } = verificar();
  assert.strictEqual(campos.t_s, 23741367744);
  assert.strictEqual(campos.t_c, -21850187494, 'el costo conserva el signo del documento');
});

test('sin capa de texto no se afirma haber verificado nada', () => {
  const { campos, advertencias, verificadoContraTexto } = verificar({
    textoPdf: '', t_ap: 44177669,
  });
  assert.strictEqual(verificadoContraTexto, false);
  assert.ok(advertencias.some((a) => a.tipo === 'sin-capa-de-texto'));
  /* Y con un escaneo la cifra no se descarta: no hay con qué desmentirla, y descartar por
     no poder comprobar sería peor que avisar. */
  assert.strictEqual(campos.t_ap, 44177669);
});

/* ══════ La utilidad bruta, como control de que las dos cifras son las correctas ══════ */

test('la utilidad bruta del documento cuadra con lo leído y no genera ruido', () => {
  /* 23.741.367.744 − 21.850.187.494 = 1.891.180.250, que es la que el estado imprime. */
  assert.deepStrictEqual(
    verificar().advertencias.filter((a) => a.tipo === 'utilidad-bruta-no-cuadra'), []);
});

test('una utilidad bruta que no cuadra delata que el costo salió de otra fila', () => {
  const r = verificar({ cotejo: { ...LECTURA.cotejo, utilidad_bruta: 2778678841 } });
  assert.ok(r.advertencias.some((a) => a.tipo === 'utilidad-bruta-no-cuadra'),
    '2.778.678.841 es la utilidad bruta de 2024: mezclar columnas tiene que salir a la luz');
});

/* ══════ Lo demás ══════ */

test('un período distinto del año del estudio se advierte', () => {
  assert.ok(verificar({ periodo: '2024' }).advertencias.some((a) => a.tipo === 'periodo-distinto'));
});

test('una escala en miles se advierte pero no se convierte', () => {
  const { campos, advertencias } = verificar({ unidadOrigen: 'miles' });
  assert.strictEqual(campos.t_s, 23741367744, 'la cifra entra tal como está impresa');
  assert.ok(advertencias.some((a) => a.tipo === 'escala-no-unitaria'));
});

test('camposAplicables no propaga los nulos, para no borrar lo escrito a mano', () => {
  const aplicables = camposAplicables(verificar({ t_inv: null }).campos);
  assert.ok(!('t_inv' in aplicables));
  assert.strictEqual(aplicables.t_ar, 2926256259);
});

/* ══════ LEY DE SIGNOS ══════
   El punto que hay que blindar: los estados imprimen el costo y los gastos con signo
   negativo o entre paréntesis casi sin excepción, y `ventas − costo − gastos` aplicado sobre
   esos valores tal cual los SUMA por doble negación. Con las cifras de este estado daría
   23.741.367.744 + 21.850.187.494 + 2.982.184.104 = 48.573.739.342 en vez de −1.091.003.854.

   Y no vale con probarlo una vez: la misma fórmula se aplica en dos sitios —al leer el
   documento y cuando el analista corrige una cifra a mano— y por eso vive en una sola
   función. Estas pruebas la recorren en las dos direcciones y con las cuatro combinaciones
   de signo con las que puede llegar un estado real. */

const VENTAS = 23741367744;
const COSTO = 21850187494;
const GASTOS = 2982184104;          // 2.409.923.291 + 572.260.813
const ESPERADO = -1091003854;       // 23.741.367.744 − 21.850.187.494 − 2.982.184.104

test('la utilidad operacional es la misma con cualquier combinación de signos', () => {
  [
    ['los dos negativos, como los imprime el PDF', -COSTO, -GASTOS],
    ['los dos positivos', COSTO, GASTOS],
    ['costo negativo, gastos positivos', -COSTO, GASTOS],
    ['costo positivo, gastos negativos', COSTO, -GASTOS],
  ].forEach(([caso, costo, gastos]) => {
    assert.strictEqual(
      utilidadOperacionalDe({ ventas: VENTAS, costo, gastos }), ESPERADO,
      `falla con ${caso}`);
  });
});

test('los egresos entre paréntesis, como los escribe un contador, dan lo mismo', () => {
  assert.strictEqual(
    utilidadOperacionalDe({
      ventas: '23.741.367.744', costo: '(21.850.187.494)', gastos: '(2.982.184.104)',
    }),
    ESPERADO, 'el formato colombiano con paréntesis es el del documento radicado');
});

test('la doble negación no puede volver: el resultado nunca sale positivo aquí', () => {
  /* La cifra que saldría de restar los negativos tal cual. Si alguna vez vuelve a aparecer,
     es que alguien quitó el valor absoluto. */
  [-COSTO, COSTO].forEach((costo) => [-GASTOS, GASTOS].forEach((gastos) => {
    assert.notStrictEqual(
      utilidadOperacionalDe({ ventas: VENTAS, costo, gastos }), 48573739342);
  }));
});

test('las ventas NO pasan por el valor absoluto', () => {
  /* Un ingreso negativo es un dato —devoluciones por encima de la facturación— y volverlo
     positivo cambiaría el sentido del estado. */
  assert.strictEqual(
    utilidadOperacionalDe({ ventas: -1000, costo: 200, gastos: 100 }), -1300);
});

test('la utilidad conserva su signo: una pérdida operativa sigue siendo pérdida', () => {
  assert.ok(utilidadOperacionalDe({ ventas: VENTAS, costo: -COSTO, gastos: -GASTOS }) < 0);
  /* Y una compañía rentable sale positiva, que es la otra mitad de la afirmación. */
  assert.ok(utilidadOperacionalDe({ ventas: 10000, costo: -6000, gastos: -1000 }) > 0);
});

test('sin uno de los tres términos devuelve null, no un cero', () => {
  assert.strictEqual(utilidadOperacionalDe({ ventas: null, costo: -COSTO, gastos: -GASTOS }), null);
  assert.strictEqual(utilidadOperacionalDe({ ventas: VENTAS, costo: null, gastos: -GASTOS }), null);
  assert.strictEqual(utilidadOperacionalDe({ ventas: VENTAS, costo: -COSTO, gastos: null }), null);
  assert.strictEqual(utilidadOperacionalDe({}), null);
});

test('un término en cero sí es un dato y se usa', () => {
  /* Distinto de la ausencia: una compañía sin gastos operativos desglosados es rara pero
     posible, y su utilidad operacional es la utilidad bruta. */
  assert.strictEqual(utilidadOperacionalDe({ ventas: 1000, costo: -600, gastos: 0 }), 400);
});

test('los gastos operativos suman en magnitud, sea cual sea el signo de cada rubro', () => {
  assert.strictEqual(gastosOperativosDe({ ventas: -2409923291, administracion: -572260813 }), GASTOS);
  assert.strictEqual(gastosOperativosDe({ ventas: 2409923291, administracion: 572260813 }), GASTOS);
  assert.strictEqual(gastosOperativosDe({ ventas: '(2.409.923.291)', administracion: '(572.260.813)' }), GASTOS);
  /* Nunca se restan entre sí: dos egresos suman, y un signo mezclado no puede convertir la
     suma en una diferencia. */
  assert.strictEqual(gastosOperativosDe({ ventas: -2409923291, administracion: 572260813 }), GASTOS);
});

test('con un solo rubro de gasto devuelve ese, y sin ninguno devuelve null', () => {
  assert.strictEqual(gastosOperativosDe({ ventas: null, administracion: -572260813 }), 572260813);
  assert.strictEqual(gastosOperativosDe({ ventas: -2409923291, administracion: null }), 2409923291);
  assert.strictEqual(gastosOperativosDe({ ventas: null, administracion: null }), null);
});

test('la advertencia de utilidad bruta no salta por el signo del costo', () => {
  /* Comparar 1.891.180.250 contra «ventas − costo» con el costo en negativo daría
     45.591.555.238 y una advertencia falsa en todos los estados que lo imprimen así, que son
     casi todos. */
  const r = verificar();
  assert.deepStrictEqual(r.advertencias.filter((a) => a.tipo === 'utilidad-bruta-no-cuadra'), []);
  const enPositivo = verificar({ t_c: 21850187494 });
  assert.deepStrictEqual(
    enPositivo.advertencias.filter((a) => a.tipo === 'utilidad-bruta-no-cuadra'), []);
});
