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
  fusionarHallazgosEnLectura, marcarEstadosConHallazgos, marcarProbableAusentePorVocabulario,
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
  t_act_tot: 15004112346,
  /* El detalle completo de la sección ACTIVOS, en el orden del documento (ver TEXTO_PDF
     arriba). A diferencia de t_ar (solo partes relacionadas), aquí entra TAMBIÉN la fila
     comercial (6.032.337.879): son dos cifras distintas del mismo balance. */
  activosDetalle: [
    { etiqueta: 'EFECTIVO Y EQUIVALENTES DE EFECTIVO', valor: 337546138, esSubtotal: false },
    { etiqueta: 'DEUDORES COMERCIALES Y OTRAS CUENTAS POR COBRAR', valor: 6032337879, esSubtotal: false },
    { etiqueta: 'CUENTAS POR COBRAR A PARTES RELACIONADAS', valor: 2926256259, esSubtotal: false },
    { etiqueta: 'INVENTARIOS', valor: 4734795891, esSubtotal: false },
    { etiqueta: 'ACTIVOS FINANCIEROS', valor: 20005897, esSubtotal: false },
    { etiqueta: 'TOTAL ACTIVO CORRIENTE', valor: 14050942064, esSubtotal: true },
  ],
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

test('el total de activos se verifica y entra igual que las demás cifras', () => {
  assert.strictEqual(verificar().campos.t_act_tot, 15004112346);
});

/* ══════ Detalle completo de Activos (Tabla 10 / ANEXO A) ══════ */

test('el detalle de activos pasa completo cuando cada cifra está impresa en el documento', () => {
  const { campos } = verificar();
  assert.strictEqual(campos.t_activos_detalle.length, LECTURA.activosDetalle.length);
  assert.strictEqual(
    campos.t_activos_detalle.find((f) => f.etiqueta === 'DEUDORES COMERCIALES Y OTRAS CUENTAS POR COBRAR').valor,
    6032337879,
    'la comercial entra con su propio valor, no el de partes relacionadas');
});

test('una fila del detalle cuya cifra no está impresa se descarta y se avisa, sin tumbar las demás', () => {
  const r = verificar({
    activosDetalle: [
      ...LECTURA.activosDetalle,
      { etiqueta: 'INVENTADO', valor: 999999999, esSubtotal: false },
    ],
  });
  const inventado = r.campos.t_activos_detalle.find((f) => f.etiqueta === 'INVENTADO');
  assert.strictEqual(inventado.valor, null);
  assert.ok(r.advertencias.some((a) => a.tipo === 'activos-detalle-cifra-inexistente'));
  /* Las demás filas, correctas, no se ven afectadas por el descarte de una. */
  assert.strictEqual(
    r.campos.t_activos_detalle.find((f) => f.etiqueta === 'INVENTARIOS').valor, 4734795891);
});

test('sin capa de texto el detalle de activos pasa tal cual, sin descartar nada', () => {
  const r = verificar({ textoPdf: '' });
  assert.deepStrictEqual(r.campos.t_activos_detalle, LECTURA.activosDetalle);
});

test('un detalle de activos vacío no pisa uno ya cargado a mano', () => {
  const aplicables = camposAplicables(verificar({ activosDetalle: [] }).campos);
  assert.ok(!('t_activos_detalle' in aplicables));
});

test('no toca ningún otro campo con nombre del balance', () => {
  /* Las partidas de partes relacionadas siguen siendo tres y un subtotal; el total general
     de activos (`t_act_tot`) y el detalle completo (`t_activos_detalle`) sí se escriben
     ahora, porque alimentan la Tabla 10 y el ANEXO A y no el motor de ajuste. `t_ppe` YA NO
     está en esta lista: ver la sección de PP&E más abajo — el criterio cambió porque dejarlo
     100% manual hacía que un PP&E real (como el de Symtek, ~32% del activo) se tratara como
     cero en los ajustes por omisión, a diferencia del caso que motivó el diseño manual
     (Montachem, donde el PP&E neto SÍ era cero por depreciación total). */
  const aplicables = camposAplicables(verificar().campos);
  ['t_cash', 't_inv_assoc', 't_tax', 't_intang', 't_dif', 't_act_nocurr']
    .forEach((clave) => assert.ok(!(clave in aplicables), `${clave} no debería escribirse`));
});

test('si falta una partida de partes relacionadas y hay una sola cifra mayor sin desglosar, se indexa como corrección', () => {
  const sinCxp = verificar({ t_ap: null });
  const c = sinCxp.correcciones.find((x) => x.campo === 't_ap');
  assert.ok(c, 'debe indexar la única cifra agregada emparentada');
  assert.strictEqual(c.valorLeido, null);
  assert.strictEqual(c.valorAplicado, 658293893);
  assert.match(c.motivo, /OTRAS CUENTAS POR PAGAR/);
  assert.match(c.motivo, /cliente/i);
  assert.strictEqual(sinCxp.campos.t_ap, 658293893, 'se aplica al campo, no solo se sugiere');
  assert.strictEqual(
    sinCxp.advertencias.find((x) => x.tipo === 'sin-partida-relacionada' && x.campo === 't_ap'),
    undefined,
    'ya no queda como advertencia sin resolver: se resolvió con la corrección',
  );
});

test('si hay varias cifras mayores emparentadas y ambiguas, no se indexa ninguna sola', () => {
  const r = verificar({
    t_ap: null,
    rubrosNoAsignados: [...LECTURA.rubrosNoAsignados, { rotulo: 'PROVEEDORES DEL EXTERIOR', valor: 500000000 }],
  });
  assert.strictEqual(r.campos.t_ap, null, 'ambiguo: no se aplica ninguna');
  assert.strictEqual(r.correcciones.find((c) => c.campo === 't_ap'), undefined);
  const a = r.advertencias.find((x) => x.tipo === 'sin-partida-relacionada' && x.campo === 't_ap');
  assert.ok(a);
  assert.match(a.mensaje, /OTRAS CUENTAS POR PAGAR/);
  assert.match(a.mensaje, /PROVEEDORES DEL EXTERIOR/);
  assert.match(a.mensaje, /ambiguas/);
});

test('sin inventarios se avisa, porque su ajuste queda contra cero', () => {
  const r = verificar({ t_inv: null });
  assert.ok(r.advertencias.some((a) => a.tipo === 'sin-inventarios'));
});

/* ══════ Anti-alucinación: la cifra tiene que estar impresa ══════ */

test('una cifra que no aparece en el documento se descarta y se reporta', () => {
  /* El caso literal: la lectura devolvió 44.177.669 como cuentas por pagar de un documento
     donde esa cifra no aparece en ninguna de sus cuatro páginas. */
  const { campos, advertencias, correcciones } = verificar({ t_ap: 44177669 });
  const a = advertencias.find((x) => x.tipo === 'cifra-inexistente' && x.campo === 't_ap');
  assert.ok(a);
  assert.match(a.mensaje, /44\.177\.669/);
  /* Descartada la cifra inventada, campos.t_ap vuelve a null — y como sigue habiendo una
     única cifra agregada sin ambigüedad en la tabla principal, se indexa en su lugar (ver
     el siguiente bloque de pruebas). */
  const c = correcciones.find((x) => x.campo === 't_ap');
  assert.ok(c);
  assert.strictEqual(campos.t_ap, 658293893);
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

/* ══════ Fallback: la utilidad operacional impresa, cuando el cálculo analítico no basta ══════

   El fixture son las cifras reales de INDUSTRIA Y TECNOLOGÍA SYMTEK S.A.S. al 31 de
   diciembre de 2025. El Estado de Resultados desglosa el costo en dos renglones («Costo de
   servicios prestados» + «Costo de venta de mercancía») sin imprimir un total de «Costo de
   Ventas», y además trae una fila «Ingreso diferido NIIF» (168.595) que SÍ está incluida en
   la «Utilidad Bruta» impresa (6.216.008) pero no en «Ingresos de actividades ordinarias»
   (16.028.194) — lo único que este módulo lee como ventas. Por eso, aun con el costo ya
   consolidado (9.980.782), `ventas − costo − gastos` da 1.292.133 (8,062 %), no los
   1.460.729 (9,113 %) que el documento imprime y que sí son la cifra correcta: coincide
   exactamente con «Utilidad Bruta» (6.216.008) − gastos (4.755.279). El fallback existe para
   este caso: cuando el cálculo analítico falla O da un número que no cuadra con esa
   identidad, y hay una fila impresa que sí cuadra y no se confunde con el total de gastos. */

const TEXTO_SYMTEK = `--- Página 1 ---
Ingresos de actividades ordinarias | 3 | $ 16.028.194 | $ 14.581.884
Costo de servicios prestados | 4 | $ 1.578.593 | $ 1.778.649
Costo de venta de mercancia | 4 | $ 8.402.189 | $ 8.037.264
Utilidad Bruta | $ 6.216.008 | $ 4.492.417
Gastos de administracion | 5 y 7 | $ 3.234.968 | $ 3.106.673
Gastos de venta | 6 y 7 | $ 1.520.311 | $ 1.016.835
Utilidad Operacional | $ 1.460.729 | $ 368.909
Propiedades, planta y equipo, neto | 16 | $ 3.590.297 | $ 3.674.607`;

const LECTURA_SYMTEK = {
  t_s: 16028194,
  t_c: null,
  t_ppe: 3590297,
  cotejo: {
    gastos_ventas: 1520311,
    gastos_administracion: 3234968,
    utilidad_bruta: 6216008,
    utilidad_operacional_impresa: 1460729,
  },
  rotulos: {},
  periodo: '2025',
  unidadOrigen: 'miles',
  textoPdf: TEXTO_SYMTEK,
};

const verificarSymtek = (extra = {}) => verificarEeff({ ...LECTURA_SYMTEK, ...extra }, { anioEstudio: 2025 });

test('sin costo consolidado (uop analítico null), el fallback aplica la utilidad operacional impresa', () => {
  assert.strictEqual(verificarSymtek().campos.t_op, 1460729);
});

test('el margen que resulta del fallback es el 9,113 % objetivo, no el 8,062 % del cálculo analítico', () => {
  const { campos } = verificarSymtek();
  const margen = campos.t_op / campos.t_s;
  assert.ok(Math.abs(margen - 0.0911350) < 1e-6, `margen calculado: ${margen}`);
});

test('con el costo ya consolidado, el uop analítico no cuadra con la identidad y el fallback igual aplica', () => {
  /* Este es el caso que importa: después de arreglar la suma de renglones de costo,
     `t_c` deja de ser null (9.980.782), así que el cálculo analítico YA NO da null — da
     1.292.133, un número válido pero equivocado por el ingreso diferido NIIF. Sin este
     camino, arreglar el costo desharía el propio arreglo del margen. */
  const r = verificarSymtek({ t_c: 9980782 });
  assert.strictEqual(r.campos.t_op, 1460729, 'debe preferir la cifra impresa, no el 1.292.133 analítico');
});

test('el fallback deja constancia en correcciones, no entra en silencio', () => {
  const { correcciones } = verificarSymtek();
  const c = correcciones.find((x) => x.campo === 't_op');
  assert.ok(c, 'debe registrar que aplicó la utilidad operacional impresa');
  assert.strictEqual(c.valorAplicado, 1460729);
  assert.match(c.motivo, /impresa/i);
});

test('ya no se avisa "sin-utilidad-operacional" cuando el fallback sí pudo aplicarse', () => {
  assert.ok(!verificarSymtek().advertencias.some((a) => a.tipo === 'sin-utilidad-operacional'));
});

test('si la cifra impresa no aparece en el texto del documento, el fallback no se aplica', () => {
  const r = verificarSymtek({
    cotejo: { ...LECTURA_SYMTEK.cotejo, utilidad_operacional_impresa: 9999999 },
  });
  assert.strictEqual(r.campos.t_op, null);
  assert.ok(r.advertencias.some((a) => a.tipo === 'sin-utilidad-operacional'));
});

test('sin utilidad bruta impresa, el fallback no tiene con qué confirmar la cifra y no se aplica', () => {
  const r = verificarSymtek({ cotejo: { ...LECTURA_SYMTEK.cotejo, utilidad_bruta: null } });
  assert.strictEqual(r.campos.t_op, null);
});

test('anti-Montachem: una cifra impresa que se parece al total de gastos se rechaza como fallback', () => {
  /* Variante de Montachem: el costo no se pudo leer (cálculo analítico null) y la fila
     «resultado de la operación» (−2.986.236.031) es, en la práctica, el total de gastos del
     giro (2.982.184.104) con otro rótulo — la diferencia es apenas 0,14 % (los 4.051.927 de
     «otros gastos» que ese estado también mete en esa fila). El chequeo debe rechazarla
     igual que si no existiera. */
  const r = verificarEeff({
    t_s: 23741367744,
    t_c: null,
    cotejo: {
      gastos_ventas: -2409923291,
      gastos_administracion: -572260813,
      utilidad_bruta: 1891180250,
      utilidad_operacional_impresa: -2986236031,
    },
    textoPdf: `INGRESOS DE ACTIVIDADES ORDINARIAS | 23.741.367.744
GASTOS DE VENTAS Y DISTRIBUCION | -2.409.923.291
GASTOS DE ADMINISTRACION | -572.260.813
UTILIDAD BRUTA | 1.891.180.250
RESULTADO DE ACTIVIDADES DE LA OPERACIÓN | -2.986.236.031`,
  }, { anioEstudio: 2025 });
  assert.strictEqual(r.campos.t_op, null, 'no debe adoptar un subtotal de gastos como utilidad');
  assert.ok(r.advertencias.some((a) => a.tipo === 'sin-utilidad-operacional'));
});

test('el uop analítico que sí cuadra con la identidad no dispara el fallback ni avisa de más', () => {
  /* Montachem: −1.091.003.854 (analítico) == 1.891.180.250 − 2.982.184.104 (bruta − gastos).
     Cuadra exacto, así que no debe tocarse ni generar ninguna corrección. */
  const r = verificar();
  assert.strictEqual(r.campos.t_op, -1091003854);
  assert.deepStrictEqual(r.correcciones, []);
});

/* ══════ PP&E: se lee y se verifica como cualquier otra partida del balance ══════ */

test('t_ppe se lee, se verifica contra el texto y se escribe como las demás partidas', () => {
  const { campos } = verificarSymtek();
  assert.strictEqual(campos.t_ppe, 3590297);
  assert.ok('t_ppe' in camposAplicables(campos));
});

test('un t_ppe que no aparece impreso se descarta igual que cualquier otra cifra', () => {
  const r = verificarSymtek({ t_ppe: 999999999 });
  assert.strictEqual(r.campos.t_ppe, null);
  assert.ok(r.advertencias.some((a) => a.tipo === 'cifra-inexistente' && a.campo === 't_ppe'));
});

/* ══════ Costo de ventas ausente: implícito en cero, o genuinamente sin dato ══════
   Caso real: LATV Sucursal Colombia (2026-08-25). Su Estado de Resultados imprime
   Utilidad Bruta == Ingresos, sin línea de Costo de Ventas en ningún lado del documento
   (ni en sus notas) — el propio estado está afirmando que el costo es cero, no que sea
   desconocido. */

test('sin costo de ventas se avisa con su propio tipo, con campo t_c', () => {
  const r = verificar({ t_c: null });
  const a = r.advertencias.find((x) => x.tipo === 'sin-costo-de-ventas');
  assert.ok(a, 'debe haber una advertencia dedicada al costo de ventas');
  assert.strictEqual(a.campo, 't_c');
});

test('si la utilidad bruta impresa es igual a los ingresos, el costo ausente es "implicito_cero"', () => {
  const r = verificar({
    t_c: null,
    cotejo: { gastos_ventas: -2409923291, gastos_administracion: -572260813, utilidad_bruta: 23741367744 },
  });
  const a = r.advertencias.find((x) => x.tipo === 'sin-costo-de-ventas');
  assert.strictEqual(a.estado, 'implicito_cero');
  assert.match(a.mensaje, /cero/);
});

test('si la utilidad bruta impresa NO es igual a los ingresos, el costo ausente queda "no_verificado"', () => {
  const r = verificar({ t_c: null }); // LECTURA.cotejo.utilidad_bruta = 1.891.180.250, distinto de t_s
  const a = r.advertencias.find((x) => x.tipo === 'sin-costo-de-ventas');
  assert.strictEqual(a.estado, 'no_verificado');
});

test('sin utilidad bruta impresa, el costo ausente tampoco es implicito_cero', () => {
  const r = verificar({ t_c: null, cotejo: { ...LECTURA.cotejo, utilidad_bruta: null } });
  const a = r.advertencias.find((x) => x.tipo === 'sin-costo-de-ventas');
  assert.strictEqual(a.estado, 'no_verificado');
});

test('el costo implícito en cero NO se asigna solo: t_c sigue en null', () => {
  const r = verificar({
    t_c: null,
    cotejo: { gastos_ventas: -2409923291, gastos_administracion: -572260813, utilidad_bruta: 23741367744 },
  });
  assert.strictEqual(r.campos.t_c, null, 'se sugiere, no se asigna — el analista decide');
});

/* ══════ Estado por campo en las advertencias ya existentes ══════ */

test('las advertencias de partes relacionadas e inventarios llevan estado "no_verificado" por defecto', () => {
  const r = verificar({
    t_ap: null, t_ar: null, t_inv: null, rubrosNoAsignados: [],
  });
  ['t_ap', 't_ar'].forEach((campo) => {
    const a = r.advertencias.find((x) => x.tipo === 'sin-partida-relacionada' && x.campo === campo);
    assert.strictEqual(a.estado, 'no_verificado');
  });
  const inv = r.advertencias.find((x) => x.tipo === 'sin-inventarios');
  assert.strictEqual(inv.estado, 'no_verificado');
});

/* ══════ Partes relacionadas sin desglose: una sola cifra mayor se indexa, varias no ══════
   Caso real: NET LOGISTIK COLOMBIA S.A.S. (2026-08-26). El documento no desglosa "Cuentas
   por cobrar/pagar a partes relacionadas" en ninguna fila propia — solo trae, en la tabla
   principal, una cifra agregada por rubro emparentado ("Deudores comerciales y otras
   cuentas por cobrar" $8.439.325.383; "Acreedores y otras cuentas por pagar"
   $3.519.703.689). Decisión explícita del usuario (2026-08-26): cuando esa cifra agregada
   es única y no ambigua, se indexa igual —como corrección, con su motivo, editable—; el
   analista la confirma con el cliente después. Con varias candidatas ambiguas, no se
   indexa ninguna sola y solo se advierte. */

test('con el campo en $0 y una única cifra mayor sin desglosar, se indexa como corrección', () => {
  const r = verificar({ t_ar: 0 });
  const c = r.correcciones.find((x) => x.campo === 't_ar');
  assert.ok(c, 'debe indexar la única cifra agregada emparentada');
  assert.strictEqual(c.valorLeido, 0);
  assert.strictEqual(c.valorAplicado, 6032337879);
  assert.match(c.motivo, /DEUDORES COMERCIALES Y OTRAS CUENTAS POR COBRAR/);
  assert.match(c.motivo, /cliente/i);
  assert.strictEqual(r.campos.t_ar, 6032337879, 'se aplica al campo, no solo se sugiere');
  assert.strictEqual(
    r.advertencias.find((x) => x.tipo === 'relacionada-en-cero-con-total-mayor'),
    undefined,
    'se resolvió con la corrección, ya no queda como advertencia sin resolver',
  );
});

test('con el campo en $0 y sin ninguna cifra mayor sin desglosar, no hace nada', () => {
  const r = verificar({ t_ar: 0, rubrosNoAsignados: [] });
  assert.strictEqual(r.campos.t_ar, 0, 'nada que indexar: el $0 ya está sustentado');
  assert.strictEqual(r.correcciones.find((c) => c.campo === 't_ar'), undefined);
  assert.strictEqual(r.advertencias.find((a) => a.campo === 't_ar'), undefined);
});

test('con el campo en $0 y varias cifras mayores ambiguas, advierte pero no indexa ninguna', () => {
  const r = verificar({
    t_ar: 0,
    rubrosNoAsignados: [...LECTURA.rubrosNoAsignados, { rotulo: 'CLIENTES DEL EXTERIOR', valor: 900000000 }],
  });
  assert.strictEqual(r.campos.t_ar, 0, 'ambiguo: no se aplica ninguna, el $0 queda tal cual');
  assert.strictEqual(r.correcciones.find((c) => c.campo === 't_ar'), undefined);
  const a = r.advertencias.find((x) => x.tipo === 'relacionada-en-cero-con-total-mayor' && x.campo === 't_ar');
  assert.ok(a);
  assert.strictEqual(a.estado, 'revisar_total_mayor');
  assert.match(a.mensaje, /DEUDORES COMERCIALES Y OTRAS CUENTAS POR COBRAR/);
  assert.match(a.mensaje, /CLIENTES DEL EXTERIOR/);
});

test('con el campo en un valor distinto de $0, no toca nada (comportamiento sin cambios)', () => {
  const r = verificar(); // LECTURA.t_ar = 2926256259
  assert.strictEqual(r.campos.t_ar, 2926256259);
  assert.strictEqual(r.correcciones.find((c) => c.campo === 't_ar'), undefined);
  assert.strictEqual(r.advertencias.find((a) => a.campo === 't_ar'), undefined);
});

/* ══════ Fusionar los hallazgos de la pasada angosta a notas ══════ */

test('fusionarHallazgosEnLectura escribe el valor encontrado sobre la lectura original', () => {
  const lectura = { t_c: null, t_s: 100 };
  const hallazgos = { t_c: { valor: 42, encontradoEn: 'nota', palabra: 'costo del servicio', cita: 'Nota 19' } };
  const fusionada = fusionarHallazgosEnLectura(lectura, hallazgos);
  assert.strictEqual(fusionada.t_c, 42);
  assert.strictEqual(fusionada.t_s, 100, 'no toca lo que no vino en hallazgos');
});

test('fusionarHallazgosEnLectura no pisa con null lo que ya venía en la lectura', () => {
  const lectura = { t_ap: null };
  const hallazgos = { t_ap: { valor: null, encontradoEn: null, palabra: '', cita: 'Revisé la Nota 13, no lo desglosa.' } };
  assert.strictEqual(fusionarHallazgosEnLectura(lectura, hallazgos).t_ap, null);
});

test('fusionarHallazgosEnLectura no muta la lectura original', () => {
  const lectura = { t_c: null };
  fusionarHallazgosEnLectura(lectura, { t_c: { valor: 42 } });
  assert.strictEqual(lectura.t_c, null);
});

test('marcarEstadosConHallazgos marca confirmado_ausente con su cita cuando la IA no lo encontró', () => {
  const advertencias = [{ tipo: 'sin-costo-de-ventas', campo: 't_c', estado: 'no_verificado', mensaje: 'No se leyó el costo de ventas.' }];
  const hallazgos = { t_c: { valor: null, encontradoEn: null, palabra: '', cita: 'Revisé la Nota 19: solo trae gastos de administración, sin desglose de costo.' } };
  const [a] = marcarEstadosConHallazgos(advertencias, hallazgos);
  assert.strictEqual(a.estado, 'confirmado_ausente');
  assert.match(a.mensaje, /Nota 19/);
});

test('marcarEstadosConHallazgos no toca una advertencia cuyo campo sí se encontró', () => {
  const advertencias = [{ tipo: 'sin-costo-de-ventas', campo: 't_c', estado: 'no_verificado', mensaje: 'No se leyó el costo de ventas.' }];
  const hallazgos = { t_c: { valor: 42, encontradoEn: 'nota', palabra: 'costo del servicio', cita: '' } };
  const [a] = marcarEstadosConHallazgos(advertencias, hallazgos);
  assert.strictEqual(a.estado, 'no_verificado', 'se resuelve por re-verificación, no por esta función');
});

test('marcarEstadosConHallazgos no toca advertencias sin campo, o de campos fuera de hallazgos', () => {
  const advertencias = [{ tipo: 'periodo-distinto', mensaje: 'x' }];
  assert.deepStrictEqual(marcarEstadosConHallazgos(advertencias, { t_c: { valor: null } }), advertencias);
});

test('marcarProbableAusentePorVocabulario marca solo los campos indicados', () => {
  const advertencias = [
    { tipo: 'sin-inventarios', campo: 't_inv', estado: 'no_verificado', mensaje: 'No se leyeron inventarios.' },
    { tipo: 'sin-costo-de-ventas', campo: 't_c', estado: 'no_verificado', mensaje: 'No se leyó el costo de ventas.' },
  ];
  const marcadas = marcarProbableAusentePorVocabulario(advertencias, ['t_inv']);
  assert.strictEqual(marcadas.find((a) => a.campo === 't_inv').estado, 'probable_ausente_por_vocabulario');
  assert.strictEqual(marcadas.find((a) => a.campo === 't_c').estado, 'no_verificado');
});
