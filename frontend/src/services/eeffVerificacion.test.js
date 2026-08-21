/* Tests de la verificación de estados financieros del contribuyente.

   El fixture son las cifras reales de MONTACHEM INTERNATIONAL S.A. (NIT 900.213.910-7),
   estado de situación financiera y estado de resultados al 31 de diciembre de 2025, tal
   como los imprime el PDF que el analista carga. Se usa este documento y no uno inventado
   porque el defecto que este módulo cierra solo aparece con un estado real: la fila
   rotulada «RESULTADO DE ACTIVIDADES DE LA OPERACIÓN» que en realidad trae el total de los
   gastos operativos. Un fixture limpio no lo habría reproducido nunca. */

import { test } from 'node:test';
import assert from 'node:assert';
import { verificarEeff, camposAplicables, subconjuntoQueSuma } from './eeffVerificacion.js';

/* La capa de texto del PDF, reducida a las líneas con cifra. Es lo que `extraerTextoPdf`
   devuelve para este documento (tiene texto embebido; no es un escaneo). */
const TEXTO_PDF = `--- Página 1 ---
EFECTIVO Y EQUIVALENTES DE EFECTIVO | 3 | 337.546.138 | 1.530.565.829
DEUDORES COMERCIALES Y OTRAS CUENTAS POR COBRAR | 4 | 6.032.337.879 | 6.866.462.173
CUENTAS POR COBRAR A PARTES RELACIONADAS | 5 | 2.926.256.259 | 1.136.030.409
INVENTARIOS | 6 | 4.734.795.891 | 5.620.907.919
ACTIVOS FINANCIEROS | 7 | 20.005.897 | 18.456.845
TOTAL ACTIVO CORRIENTE | 14.050.942.064 | 15.172.423.175
EQUIPO | 8 | 49.408.567 | 49.408.567
DEPRECIACION ACUMULADA | 8 | -49.408.567 | -49.408.567
GASTOS PAGADOS POR ANTICIPADO | 9 | 45.975.242 | 12.035.410
ACTIVOS POR IMPUESTO DIFERIDO | 10 | 907.195.040 | 907.195.040
TOTAL ACTIVO NO CORRIENTE | 953.170.282 | 919.230.450
TOTAL ACTIVO | 15.004.112.346 | 16.091.653.625
CUENTAS POR PAGAR A PARTES RELACIONADAS | 11 | 5.400.016.795 | 5.535.262.470
OTRAS CUENTAS POR PAGAR | 12 | 658.293.893 | 604.110.193
PASIVOS POR IMPUESTOS CORRIENTES | 13 | 33.365.000 | 26.905.742
TOTAL PASIVO | 7.461.123.748 | 7.382.447.102
TOTAL PATRIMONIO | 7.542.988.598 | 8.709.206.523

--- Página 2 ---
INGRESOS DE ACTIVIDADES ORDINARIAS | 17 | 23.741.367.744 | 20.551.569.611
COSTO DE VENTAS | 17 | -21.850.187.494 | -17.772.890.770
UTILIDAD BRUTA | 1.891.180.250 | 2.778.678.841
OTROS INGRESOS | 18 | 8.298 | 3.498.679
GASTOS DE VENTAS Y DISTRIBUCION | 19 | -2.409.923.291 | -1.318.200.870
GASTOS DE ADMINISTRACION | 19 | -572.260.813 | -458.220.142
OTROS GASTOS | 20 | -4.060.225 | -31.266.993
RESULTADO DE ACTIVIDADES DE LA OPERACIÓN | -2.986.236.031 | -1.804.189.326
COSTOS FINANCIEROS NETOS | 21 | -71.162.144 | 14.491.545
(PÉRDIDA) UTILIDAD NETA ANTES DE IMPUESTOS | -1.166.217.925 | 988.981.060`;

/* La lectura tal como la devuelve el modelo para este documento, con el rótulo engañoso
   transcrito fielmente —que es lo que se le pide— y sin la cuenta por pagar comercial,
   que el documento no desglosa. */
const LECTURA = {
  t_s: 23741367744,
  t_c: -21850187494,
  t_ar: 6032337879,
  t_inv: 4734795891,
  t_ap: null,
  t_cash: 337546138,
  t_inv_assoc: null,
  t_tax: null,
  t_act_curr: 14050942064,
  t_ppe: 0,
  t_intang: null,
  t_dif: 45975242,
  t_act_nocurr: 953170282,
  t_act_tot: 15004112346,
  cotejo: {
    utilidad_bruta: 1891180250,
    gastos_operacionales: null, // el estado los presenta desglosados, no en una fila
    utilidad_operacional: -2986236031, // la fila mal rotulada
    resultado_financiero_neto: -71162144,
    utilidad_antes_impuestos: -1166217925,
    total_pasivos: 7461123748,
    patrimonio: 7542988598,
  },
  rotulos: {
    utilidad_operacional: 'RESULTADO DE ACTIVIDADES DE LA OPERACIÓN',
    cuentas_por_cobrar: 'DEUDORES COMERCIALES Y OTRAS CUENTAS POR COBRAR',
    diferidos: 'GASTOS PAGADOS POR ANTICIPADO',
  },
  rubrosNoAsignados: [
    { rotulo: 'CUENTAS POR COBRAR A PARTES RELACIONADAS', valor: 2926256259, seccion: 'situacion_financiera' },
    { rotulo: 'ACTIVOS FINANCIEROS', valor: 20005897, seccion: 'situacion_financiera' },
    { rotulo: 'CUENTAS POR PAGAR A PARTES RELACIONADAS', valor: 5400016795, seccion: 'situacion_financiera' },
    { rotulo: 'OTRAS CUENTAS POR PAGAR', valor: 658293893, seccion: 'situacion_financiera' },
    { rotulo: 'GASTOS DE VENTAS Y DISTRIBUCION', valor: -2409923291, seccion: 'resultados' },
    { rotulo: 'GASTOS DE ADMINISTRACION', valor: -572260813, seccion: 'resultados' },
  ],
  periodo: '2025',
  unidadOrigen: 'unidades',
  textoPdf: TEXTO_PDF,
};

const verificar = (extra = {}) => verificarEeff({ ...LECTURA, ...extra }, { anioEstudio: 2025 });

/* ══════ La utilidad operacional, por identidad y no por rótulo ══════ */

test('la utilidad operacional se despeja del estado y no de la fila mal rotulada', () => {
  const { campos } = verificar();
  /* −1.166.217.925 − (−71.162.144) = −1.095.055.781. Y se comprueba contra el propio
     documento: 1.891.180.250 (UB) − 2.986.236.031 (gastos) − 71.162.144 = −1.166.217.925,
     la utilidad antes de impuestos que el estado imprime. */
  assert.strictEqual(campos.t_op, -1095055781);
});

test('el cambio queda registrado, con el rótulo que lo indujo', () => {
  const { correcciones } = verificar();
  const c = correcciones.find((x) => x.campo === 't_op');
  assert.ok(c, 'la corrección de la utilidad operacional tiene que quedar registrada');
  assert.strictEqual(c.valorLeido, -2986236031);
  assert.strictEqual(c.valorAplicado, -1095055781);
  assert.strictEqual(c.rotuloLeido, 'RESULTADO DE ACTIVIDADES DE LA OPERACIÓN');
  assert.match(c.motivo, /no cuadra con el resto del estado/);
});

test('los gastos operativos que se derivan son los del documento, no el doble', () => {
  /* 1.891.180.250 − (−1.095.055.781) = 2.986.236.031, que es exactamente la suma de los
     gastos del estado (2.409.923.291 + 572.260.813 + 4.060.225 − 8.298 de otros ingresos).
     El libro publicaba 4.877.416.281: inflado en la utilidad bruta entera. */
  const { campos } = verificar();
  assert.strictEqual(campos.t_gastos, 2986236031);
  assert.notStrictEqual(campos.t_gastos, 4877416281);
});

test('una utilidad operacional que sí cuadra no se toca ni se reporta', () => {
  const { campos, correcciones } = verificar({
    cotejo: { ...LECTURA.cotejo, utilidad_operacional: -1095055781 },
  });
  assert.strictEqual(campos.t_op, -1095055781);
  assert.deepStrictEqual(correcciones.filter((c) => c.campo === 't_op'), []);
});

test('sin utilidad antes de impuestos se cae a la utilidad bruta menos los gastos', () => {
  const { campos } = verificar({
    cotejo: {
      ...LECTURA.cotejo,
      utilidad_antes_impuestos: null,
      resultado_financiero_neto: null,
      gastos_operacionales: -2986236031,
    },
  });
  assert.strictEqual(campos.t_op, -1095055781);
});

test('sin nada con que despejarla, se avisa en vez de inventarla', () => {
  const { campos, advertencias } = verificar({
    cotejo: {
      utilidad_bruta: null, gastos_operacionales: null, utilidad_operacional: null,
      resultado_financiero_neto: null, utilidad_antes_impuestos: null,
      total_pasivos: null, patrimonio: null,
    },
  });
  assert.strictEqual(campos.t_op, null);
  assert.ok(advertencias.some((a) => a.tipo === 'sin-utilidad-operacional'));
});

/* ══════ Anti-alucinación: la cifra tiene que estar impresa ══════ */

test('una cifra que no aparece en el documento se descarta y se reporta', () => {
  /* El caso literal: la lectura devolvió 44.177.669 como cuentas por pagar comerciales de
     un documento donde esa cifra no aparece en ninguna de sus cuatro páginas. */
  const { campos, advertencias } = verificar({ t_ap: 44177669 });
  assert.strictEqual(campos.t_ap, null, 'no puede entrar al estudio una cifra que no está impresa');
  const a = advertencias.find((x) => x.tipo === 'cifra-inexistente' && x.campo === 't_ap');
  assert.ok(a, 'y el analista tiene que enterarse');
  assert.match(a.mensaje, /44\.177\.669/);
});

test('las cifras que sí están impresas pasan intactas', () => {
  const { campos } = verificar();
  assert.strictEqual(campos.t_s, 23741367744);
  assert.strictEqual(campos.t_c, -21850187494, 'el costo conserva el signo del documento');
  assert.strictEqual(campos.t_cash, 337546138);
  assert.strictEqual(campos.t_act_curr, 14050942064);
  assert.strictEqual(campos.t_act_nocurr, 953170282);
  assert.strictEqual(campos.t_act_tot, 15004112346);
  assert.strictEqual(campos.t_dif, 45975242);
});

test('el signo no impide reconocer una cifra impresa entre paréntesis', () => {
  /* El documento imprime «-21.850.187.494»; lo que se comprueba es la magnitud. */
  const { campos } = verificar({ t_c: 21850187494 });
  assert.strictEqual(campos.t_c, 21850187494);
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

/* ══════ Los subtotales del balance ══════ */

test('el faltante del activo corriente se explica con los rubros sin asignar', () => {
  /* 14.050.942.064 − (337.546.138 + 6.032.337.879 + 4.734.795.891) = 2.946.262.156, que son
     exactamente las cuentas por cobrar a partes relacionadas (2.926.256.259) más los
     activos financieros (20.005.897). Es la información que le permite al analista decidir
     si alguna entra en el ajuste de capital de trabajo. */
  const { advertencias } = verificar();
  const a = advertencias.find((x) => x.tipo === 'subtotal-con-faltante' && x.campo === 't_act_curr');
  assert.ok(a, 'el faltante del activo corriente tiene que reportarse');
  assert.match(a.mensaje, /2\.946\.262\.156/);
  assert.match(a.mensaje, /CUENTAS POR COBRAR A PARTES RELACIONADAS/);
  assert.match(a.mensaje, /ACTIVOS FINANCIEROS/);
});

test('el total de activos se despeja de los dos subtotales cuando no se leyó', () => {
  const { campos, correcciones } = verificar({ t_act_tot: null });
  assert.strictEqual(campos.t_act_tot, 15004112346, '14.050.942.064 + 953.170.282');
  assert.ok(correcciones.some((c) => c.campo === 't_act_tot'));
});

test('un total de activos que no es la suma de sus subtotales se reporta', () => {
  /* El caso realista de una cifra impresa pero equivocada: 16.091.653.625 es el total del
     activo de 2024, la columna de al lado. Está en el documento —así que la comprobación
     anti-alucinación la deja pasar, y hace bien— y solo la identidad de los subtotales
     puede delatar que se mezclaron dos ejercicios. */
  const { advertencias } = verificar({ t_act_tot: 16091653625 });
  assert.ok(advertencias.some((a) => a.tipo === 'subtotales-no-cuadran'),
    'un total del año anterior con subtotales de este año tiene que salir a la luz');
});

test('la ecuación patrimonial de este estado cuadra y no genera ruido', () => {
  /* 7.461.123.748 + 7.542.988.598 = 15.004.112.346. */
  const { advertencias } = verificar();
  assert.deepStrictEqual(advertencias.filter((a) => a.tipo === 'ecuacion-patrimonial'), []);
});

test('una ecuación patrimonial que no cuadra se reporta', () => {
  const { advertencias } = verificar({
    cotejo: { ...LECTURA.cotejo, patrimonio: 1 },
  });
  assert.ok(advertencias.some((a) => a.tipo === 'ecuacion-patrimonial'));
});

/* ══════ Lo que necesita una decisión humana ══════ */

test('sin cuenta por pagar comercial se listan las que el documento sí trae', () => {
  const { advertencias } = verificar();
  const a = advertencias.find((x) => x.tipo === 'sin-cuentas-por-pagar');
  assert.ok(a, 'el ajuste por cuentas por pagar quedaría en cero sin avisar');
  assert.match(a.mensaje, /CUENTAS POR PAGAR A PARTES RELACIONADAS/);
  assert.match(a.mensaje, /OTRAS CUENTAS POR PAGAR/);
});

test('un período distinto del año del estudio se advierte', () => {
  const { advertencias } = verificar({ periodo: '2024' });
  assert.ok(advertencias.some((a) => a.tipo === 'periodo-distinto'));
});

test('una escala en miles se advierte pero no se convierte', () => {
  /* Convertir dejaría el texto del informe diciendo una cifra y el ANEXO A, que adjunta
     las páginas del propio PDF, mostrando otra. */
  const { campos, advertencias } = verificar({ unidadOrigen: 'miles' });
  assert.strictEqual(campos.t_s, 23741367744, 'la cifra entra tal como está impresa');
  assert.ok(advertencias.some((a) => a.tipo === 'escala-no-unitaria'));
});

/* ══════ camposAplicables ══════ */

test('camposAplicables no propaga los nulos, para no borrar lo escrito a mano', () => {
  const aplicables = camposAplicables(verificar().campos);
  assert.ok(!('t_ap' in aplicables), 'un rubro sin cifra no debe sobrescribir el del analista');
  assert.ok(!('t_intang' in aplicables));
  assert.strictEqual(aplicables.t_cash, 337546138);
  assert.strictEqual(aplicables.t_ppe, 0, 'un cero leído del documento sí es un dato');
});

/* ══════ Qué explica un faltante ══════ */

test('el faltante se atribuye al subconjunto exacto, no a todo lo que sobró', () => {
  /* Con las secciones que el prompt pide, las cuentas por pagar quedan fuera del cotejo
     del activo: listarlas ahí era ruido, y un aviso ruidoso deja de leerse. */
  const conSecciones = {
    ...LECTURA,
    rubrosNoAsignados: [
      { rotulo: 'CUENTAS POR COBRAR A PARTES RELACIONADAS', valor: 2926256259, seccion: 'activo_corriente' },
      { rotulo: 'ACTIVOS FINANCIEROS', valor: 20005897, seccion: 'activo_corriente' },
      { rotulo: 'ACTIVOS POR IMPUESTO DIFERIDO', valor: 907195040, seccion: 'activo_no_corriente' },
      { rotulo: 'CUENTAS POR PAGAR A PARTES RELACIONADAS', valor: 5400016795, seccion: 'pasivo' },
    ],
  };
  const { advertencias } = verificarEeff(conSecciones, { anioEstudio: 2025 });

  const corriente = advertencias.find((a) => a.tipo === 'subtotal-con-faltante' && a.campo === 't_act_curr');
  assert.match(corriente.mensaje, /CUENTAS POR COBRAR A PARTES RELACIONADAS/);
  assert.match(corriente.mensaje, /ACTIVOS FINANCIEROS/);
  assert.doesNotMatch(corriente.mensaje, /POR PAGAR/,
    'un pasivo no puede aparecer explicando un subtotal del activo');

  /* El no corriente: 953.170.282 − 45.975.242 de diferidos = 907.195.040, que es
     exactamente el activo por impuesto diferido que la lectura dejó sin asignar. */
  const noCorriente = advertencias.find((a) => a.tipo === 'subtotal-con-faltante' && a.campo === 't_act_nocurr');
  assert.match(noCorriente.mensaje, /ACTIVOS POR IMPUESTO DIFERIDO/);
});

test('cuando nada suma el faltante, no se atribuye a nadie', () => {
  const sinExplicacion = {
    ...LECTURA,
    rubrosNoAsignados: [{ rotulo: 'OTRO CONCEPTO', valor: 7, seccion: 'activo_corriente' }],
  };
  const { advertencias } = verificarEeff(sinExplicacion, { anioEstudio: 2025 });
  const a = advertencias.find((x) => x.tipo === 'subtotal-con-faltante' && x.campo === 't_act_curr');
  assert.match(a.mensaje, /Ning[uú]n rubro sin asignar/);
  assert.doesNotMatch(a.mensaje, /OTRO CONCEPTO/, 'no se señala a un rubro que no cuadra');
});

test('subconjuntoQueSuma encuentra la combinación exacta y no una aproximada', () => {
  const rubros = [
    { rotulo: 'A', valor: 2926256259 },
    { rotulo: 'B', valor: 20005897 },
    { rotulo: 'C', valor: 907195040 },
  ];
  const r = subconjuntoQueSuma(rubros, 2946262156, 1);
  assert.deepStrictEqual(r.map((x) => x.rotulo).sort(), ['A', 'B']);
});

test('subconjuntoQueSuma devuelve null cuando ninguna combinación da el objetivo', () => {
  const rubros = [{ rotulo: 'A', valor: 100 }, { rotulo: 'B', valor: 250 }];
  assert.strictEqual(subconjuntoQueSuma(rubros, 999, 1), null);
});

test('subconjuntoQueSuma no se cuelga con muchas partidas', () => {
  /* Un documento anómalo no puede congelar la pantalla mientras el analista espera. */
  const rubros = Array.from({ length: 40 }, (_, i) => ({ rotulo: `R${i}`, valor: (i + 1) * 7919 }));
  const r = subconjuntoQueSuma(rubros, 1, 0);
  assert.strictEqual(r, null);
});

test('subconjuntoQueSuma ignora el signo de las partidas', () => {
  /* Los gastos y la depreciación vienen negativos del documento y lo que se compara es la
     magnitud que le falta al subtotal. */
  const rubros = [{ rotulo: 'DEPRECIACION', valor: -49408567 }];
  const r = subconjuntoQueSuma(rubros, 49408567, 1);
  assert.deepStrictEqual(r.map((x) => x.rotulo), ['DEPRECIACION']);
});
