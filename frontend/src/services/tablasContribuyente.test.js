import { test } from 'node:test';
import assert from 'node:assert';
import {
  verticalSobreActivos, filasComposicionAccionaria, filasActivos, resolverComposicionAccionaria,
  tieneComposicionAccionariaPropia,
} from './tablasContribuyente.js';
import { pctf } from '../utils/calculations.js';

/* ── verticalSobreActivos ── */

test('el análisis vertical es el rubro sobre el total de activos', () => {
  const av = verticalSobreActivos({ t_act_tot: 2000 });
  /* Se coteja contra `pctf` y no contra una cadena a mano: así el A.V. y el resto del informe
     no pueden volver a divergir, que es lo que pasaba cuando cada sitio se formateaba solo. */
  assert.strictEqual(av(500), pctf(0.25));
  assert.strictEqual(av(500), '25,000 %');
});

test('sin total de activos el vertical queda en hueco y no en cero', () => {
  /* Un «0,000 %» afirma que el rubro no pesa nada; el hueco dice que no se pudo calcular. */
  assert.strictEqual(verticalSobreActivos({})(500), '—');
  assert.strictEqual(verticalSobreActivos({ t_act_tot: 0 })(500), '—');
});

/* ── Tabla 6. Composición accionaria ── */

const ACCIONISTAS = [
  { nombre: 'END GAME INTERACTIVE INC', pais: 'ESTADOS UNIDOS', acciones: 900, valor_capital: 9000, participacion_pct: 90 },
  { nombre: 'JUAN PÉREZ', pais: 'COLOMBIA', acciones: 100, valor_capital: 1000, participacion_pct: 10 },
];

test('la composición accionaria lista cada accionista y cierra con el total', () => {
  const t = filasComposicionAccionaria({ accionistas: ACCIONISTAS });
  assert.strictEqual(t.nombre, 'Composición accionaria');
  assert.deepStrictEqual(t.filas, [
    ['END GAME INTERACTIVE INC', 'ESTADOS UNIDOS', '900', '9.000', '90%'],
    ['JUAN PÉREZ', 'COLOMBIA', '100', '1.000', '10%'],
    ['Total', '', '1.000', '10.000', '100%'],
  ]);
});

test('sin composición accionaria no se emite tabla: la de la plantilla se queda tal cual', () => {
  /* Antes se emitía la fila «Total» con huecos para delatar que faltaba el certificado. Se
     cambió por decisión del usuario (2026-08-22): la plantilla es el informe del año anterior
     del mismo contribuyente y su composición accionaria es un dato que casi nunca cambia, así
     que vale más conservarla entera que publicar una tabla de huecos. */
  assert.strictEqual(filasComposicionAccionaria({}), null);
});

test('los accionistas leídos de la propia plantilla no regeneran la tabla', () => {
  /* `plantillaAccionistas` sale de leer con IA la misma tabla que se iba a reescribir: la
     extracción trae razón social, país y participación, pero no las acciones ni el capital, y
     la tabla se publicaba con «—» donde la plantilla traía las cifras. */
  const estudio = {
    plantillaAccionistas: {
      accionistas: [{ nombre: 'MONTACHEM INTERNATIONAL INC', pais: 'ESTADOS UNIDOS', participacion_pct: 100 }],
    },
  };
  assert.strictEqual(resolverComposicionAccionaria(estudio).fuente, 'plantilla');
  assert.strictEqual(filasComposicionAccionaria(estudio), null);
});

test('el certificado y el informe del año anterior sí regeneran la tabla', () => {
  assert.ok(tieneComposicionAccionariaPropia({ accionistas: ACCIONISTAS }));
  assert.ok(tieneComposicionAccionariaPropia({ estudioAnterior: { accionistas: ACCIONISTAS } }));
  assert.ok(!tieneComposicionAccionariaPropia({ plantillaAccionistas: { accionistas: ACCIONISTAS } }));
  assert.ok(!tieneComposicionAccionariaPropia({}));
  /* El certificado manda sobre lo que la plantilla ya tenía escrito. */
  assert.ok(tieneComposicionAccionariaPropia({
    accionistas: ACCIONISTAS,
    plantillaAccionistas: { accionistas: [{ nombre: 'OTRO' }] },
  }));
});

test('un accionista sin cifras no inventa ceros', () => {
  assert.deepStrictEqual(
    filasComposicionAccionaria({ accionistas: [{ nombre: 'ACME' }] }).filas[0],
    ['ACME', '—', '—', '—', '—']
  );
});

test('resolverComposicionAccionaria prioriza el certificado de la sección 1', () => {
  const estudio = {
    accionistas: [{ nombre: 'CERTIFICADO INC', participacion_pct: 100 }],
    estudioAnterior: { accionistas: [{ nombre: 'ANTERIOR INC' }] },
    plantillaAccionistas: { accionistas: [{ nombre: 'PLANTILLA INC' }] },
  };
  const res = resolverComposicionAccionaria(estudio);
  assert.strictEqual(res.fuente, 'certificado');
  assert.strictEqual(res.accionistas[0].nombre, 'CERTIFICADO INC');
});

test('resolverComposicionAccionaria cae a estudioAnterior si no hay certificado', () => {
  const estudio = {
    accionistas: [],
    estudioAnterior: { accionistas: [{ nombre: 'ANTERIOR INC', participacion_pct: 100 }] },
    plantillaAccionistas: { accionistas: [{ nombre: 'PLANTILLA INC' }] },
  };
  const res = resolverComposicionAccionaria(estudio);
  assert.strictEqual(res.fuente, 'estudioAnterior');
  assert.strictEqual(res.accionistas[0].nombre, 'ANTERIOR INC');
});

test('resolverComposicionAccionaria cae a plantillaAccionistas si no hay certificado ni estudioAnterior', () => {
  const estudio = {
    accionistas: [],
    estudioAnterior: { accionistas: [] },
    plantillaAccionistas: { accionistas: [{ nombre: 'PLANTILLA INC', participacion_pct: 100 }] },
  };
  const res = resolverComposicionAccionaria(estudio);
  assert.strictEqual(res.fuente, 'plantilla');
  assert.strictEqual(res.accionistas[0].nombre, 'PLANTILLA INC');
});

test('resolverComposicionAccionaria devuelve vacíos si ningún origen tiene accionistas', () => {
  const res = resolverComposicionAccionaria({});
  assert.strictEqual(res.fuente, null);
  assert.deepStrictEqual(res.accionistas, []);
});

/* ── Tabla 10. Activos ── */

const EEFF = {
  anio: 2025,
  t_cash: 12417756, t_inv_assoc: 0, t_ar: 1998031210, t_tax: 1000000,
  t_act_curr: 2011448966, t_ppe: 168030721, t_intang: 0, t_dif: 0,
  t_act_nocurr: 168030721, t_act_tot: 2179479687,
};

test('los activos llevan el año gravable en el título y en las columnas', () => {
  /* La plantilla de referencia rotula «Activos a 31 de diciembre de 2024»: si el rótulo no
     se reescribe, el informe de 2025 publica el encabezado del año anterior. */
  const t = filasActivos(EEFF);
  assert.strictEqual(t.nombre, 'Activos a 31 de diciembre');
  assert.strictEqual(t.titulo, 'Activos a 31 de diciembre de 2025');
  assert.deepStrictEqual(t.encabezados, [
    'Cifras Expresadas en pesos colombianos', '2025', 'A.V. 2025',
  ]);
  assert.strictEqual(t.fuente, 'Estados financieros de la Compañía a 31 de diciembre de 2025.');
});

test('los activos publican los rubros con dato y los tres subtotales, con su análisis vertical', () => {
  /* `EEFF` trae en cero `t_inv_assoc`, `t_intang` y `t_dif`: al no ser subtotales, esos tres
     rubros de línea no publican fila. Quedan 4 rubros de línea con dato + los 3 subtotales = 7. */
  const t = filasActivos(EEFF);
  assert.strictEqual(t.filas.length, 7);
  assert.deepStrictEqual(t.filas[0], ['Efectivo y equivalentes de efectivo', '12.417.756', '0,570 %']);
  assert.deepStrictEqual(t.filas[t.filas.length - 1], ['Total, Activos', '2.179.479.687', '100,000 %']);
  assert.ok(!t.filas.some((f) => f[0] === 'Inversiones asociadas'));
  assert.ok(!t.filas.some((f) => f[0] === 'Intangibles'));
});

test('un rubro de línea sin dato no publica fila', () => {
  const t = filasActivos({ anio: 2025, t_act_tot: 1000 });
  assert.ok(!t.filas.some((f) => f[0] === 'Efectivo y equivalentes de efectivo'));
});

test('un rubro de línea en cero no publica fila, igual que si no tuviera dato', () => {
  /* Criterio que ya seguía la ruta .docx para el guion: en un balance, un rubro en cero y un
     rubro que nadie cargó se leen igual de mal si se publica «0» — y ahora, igual de mal si se
     publica la fila vacía con un guion. */
  const t = filasActivos({ ...EEFF, t_intang: 0 });
  assert.ok(!t.filas.some((f) => f[0] === 'Intangibles'));
});

test('un subtotal sin dato sí publica su fila, con «—» en vez de desaparecer', () => {
  const t = filasActivos({ anio: 2025, t_cash: 12417756 });
  const totalActivos = t.filas.find((f) => f[0] === 'Total, Activos');
  assert.deepStrictEqual(totalActivos, ['Total, Activos', '—', '—']);
});

test('solo se publican los rubros de línea que el estudio trae, más los tres subtotales', () => {
  const t = filasActivos({ anio: 2025, t_cash: 12417756, t_ppe: 168030721, t_act_tot: 2179479687 });
  assert.deepStrictEqual(t.filas.map((f) => f[0]), [
    'Efectivo y equivalentes de efectivo',
    'Total, Activo corriente',
    'Propiedades, planta y equipo',
    'Total, Activos no corrientes',
    'Total, Activos',
  ]);
});

test('sin detalle dinámico, los inventarios sí publican fila (antes faltaban en la lista fija)', () => {
  /* El único campo que la ingesta vigente sí llena por sí solo (t_inv) no tenía fila propia
     en RUBROS_ACTIVO, así que nunca aparecía en la Tabla 10 aunque el estudio lo trajera. */
  const t = filasActivos({ ...EEFF, t_inv: 4734795891 });
  const fila = t.filas.find((f) => f[0] === 'Inventarios');
  assert.ok(fila, 'la fila de Inventarios debe publicarse');
  assert.strictEqual(fila[1], '4.734.795.891');
});

/* ── Tabla 10 con detalle dinámico: cualquier estructura de EEFF, no solo la de End Game ── */

test('con t_activos_detalle, la Tabla 10 se arma directo de esa lista, en su orden', () => {
  const estudio = {
    anio: 2025,
    t_act_tot: 15004112346,
    t_activos_detalle: [
      { etiqueta: 'Efectivo y equivalentes de efectivo', valor: 337546138, esSubtotal: false },
      { etiqueta: 'Deudores comerciales y otras cuentas por cobrar', valor: 6032337879, esSubtotal: false },
      { etiqueta: 'Cuentas por cobrar a partes relacionadas', valor: 2926256259, esSubtotal: false },
      { etiqueta: 'Inventarios', valor: 4734795891, esSubtotal: false },
      { etiqueta: 'Activos financieros', valor: 20005897, esSubtotal: false },
      { etiqueta: 'Total, Activo corriente', valor: 14050942064, esSubtotal: true },
    ],
  };
  const t = filasActivos(estudio);
  assert.deepStrictEqual(t.filas.map((f) => f[0]), [
    'Efectivo y equivalentes de efectivo',
    'Deudores comerciales y otras cuentas por cobrar',
    'Cuentas por cobrar a partes relacionadas',
    'Inventarios',
    'Activos financieros',
    'Total, Activo corriente',
  ]);
  assert.deepStrictEqual(t.filas[0], [
    'Efectivo y equivalentes de efectivo', '337.546.138', pctf(337546138 / 15004112346),
  ]);
});

test('con t_activos_detalle, un rubro de línea sin dato no publica fila pero su subtotal sí', () => {
  const estudio = {
    anio: 2025,
    t_act_tot: 1000,
    t_activos_detalle: [
      { etiqueta: 'Efectivo', valor: null, esSubtotal: false },
      { etiqueta: 'Total, Activo corriente', valor: null, esSubtotal: true },
    ],
  };
  const t = filasActivos(estudio);
  assert.deepStrictEqual(t.filas, [['Total, Activo corriente', '—', '—']]);
});

test('sin t_activos_detalle (o vacío) la Tabla 10 cae al camino fijo de siempre', () => {
  const t = filasActivos({ ...EEFF, t_activos_detalle: [] });
  assert.strictEqual(t.filas.length, 7);
  assert.strictEqual(t.filas[0][0], 'Efectivo y equivalentes de efectivo');
});
