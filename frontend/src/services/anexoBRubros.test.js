import { test } from 'node:test';
import assert from 'node:assert';
import {
  RUBROS_RESULTADOS, RUBROS_BALANCE, cifraDeRubro, rubrosConDato,
} from './anexoBRubros.js';
import { EEFF_COMPARABLE_PROMPT, EEFF_COMPARABLES_LOTE_PROMPT } from './eeffParser.js';
import {
  RUBROS_RESULTADOS as PL_HTML, RUBROS_BALANCE as BAL_HTML,
} from './anexoBHtml.js';

/* Las filas que imprime la ficha de estados financieros que la macro de Word produce para
   cada comparable, en su orden. Es el documento que el analista tiene delante al revisar
   el anexo, así que es la referencia: medido sobre las fichas de HUAXIN RESOURCES, ASIA
   POLYMER y LYONDELLBASELL. */
const FICHA_RESULTADOS = [
  'ingresos_operacionales',              // Ventas netas
  'costo_ventas',                        // Costo de ventas
  'utilidad_bruta',                      // Utilidad bruta
  'gastos_generales_administrativos',    // Gastos generales y administrativos (SG&A)
  'depreciacion',                        // Depreciación
  'gastos_operacionales',                // Gastos operativos
  'utilidad_operacional',                // Utilidad operativa
];
const FICHA_BALANCE = [
  'efectivo_y_equivalentes',   // Efectivo y equivalentes de efectivo
  'otras_inversiones',         // Otras inversiones
  'cuentas_por_cobrar',        // Cuentas por cobrar
  'inventarios',               // Inventarios
  'propiedad_planta_equipo',   // Propiedad, planta y equipo
  'total_activos',             // Total de activos
  'activos_operativos',        // Activos operativos
  'total_pasivos',             // Total de pasivos
  'cuentas_por_pagar',         // Cuentas por pagar
];

test('el estado de resultados cubre las siete filas de la ficha, en su orden', () => {
  /* Los dos opcionales del final no están en la ficha: los traen algunas plantillas del
     cliente. Lo que se fija aquí es que las siete de la ficha estén y en su orden. */
  assert.deepStrictEqual(RUBROS_RESULTADOS.slice(0, 7).map((r) => r.campo), FICHA_RESULTADOS);
  assert.deepStrictEqual(RUBROS_RESULTADOS.slice(7).map((r) => r.campo),
    ['gastos_investigacion_desarrollo', 'gastos_publicidad']);
});

test('el balance cubre las nueve filas de la ficha, en su orden y sin nada de más', () => {
  assert.deepStrictEqual(RUBROS_BALANCE.map((r) => r.campo), FICHA_BALANCE);
});

test('los dos prompts de comparables piden todos los rubros que el anexo escribe', () => {
  /* El defecto que esto cierra: «Otras inversiones» estaba en la ficha y en la tabla del
     informe, pero no en el esquema del parser, así que el modelo nunca la devolvía y la
     fila salía vacía sin que nada lo delatara. */
  [...RUBROS_RESULTADOS, ...RUBROS_BALANCE].forEach(({ campo }) => {
    assert.ok(EEFF_COMPARABLE_PROMPT.includes(campo), `falta "${campo}" en el prompt individual`);
    assert.ok(EEFF_COMPARABLES_LOTE_PROMPT.includes(campo), `falta "${campo}" en el prompt de lote`);
  });
});

test('las dos rutas del Anexo B leen la misma lista', () => {
  /* La ruta de plantilla (`anexoBHtml.js`) y la de OOXML (`docxRelleno.js`) mantenían cada
     una su copia, y al corregir el orden y añadir filas en la segunda la primera se quedó
     con la tabla vieja: quien generaba con plantilla la seguía viendo incompleta. Esta
     prueba falla si alguien vuelve a duplicar la lista. */
  assert.strictEqual(PL_HTML, RUBROS_RESULTADOS, 'la ruta de plantilla reexporta la lista, no una copia');
  assert.strictEqual(BAL_HTML, RUBROS_BALANCE);
});

/* ══════ De dónde sale la cifra de cada fila ══════ */

const COMPARABLE = {
  s: 862.6, c: 683.24, op: 78.63, ar: 594.39, inv: 119.95, ap: 93.64,
  eeffDatos: {
    ingresos_operacionales: 800, utilidad_bruta: 179.36, total_activos: 2619.3,
    otras_inversiones: null, depreciacion: null,
  },
};
const rubro = (lista, campo) => lista.find((r) => r.campo === campo);

test('la cifra corregida en la fila del estudio manda sobre la del documento', () => {
  /* `s`, `c`, `op`, `ar`, `inv` y `ap` son las que el analista puede haber corregido a mano
     en el paso 4; leerlas de `eeffDatos` descartaría esa corrección en silencio. */
  assert.strictEqual(cifraDeRubro(rubro(RUBROS_RESULTADOS, 'ingresos_operacionales'), COMPARABLE), 862.6);
  assert.strictEqual(cifraDeRubro(rubro(RUBROS_BALANCE, 'cuentas_por_cobrar'), COMPARABLE), 594.39);
});

test('sin cifra en la fila se cae a la del documento', () => {
  assert.strictEqual(cifraDeRubro(rubro(RUBROS_RESULTADOS, 'utilidad_bruta'), COMPARABLE), 179.36);
  assert.strictEqual(cifraDeRubro(rubro(RUBROS_BALANCE, 'total_activos'), COMPARABLE), 2619.3);
});

test('un rubro que la comparable no reporta devuelve null y no se emite su fila', () => {
  assert.strictEqual(cifraDeRubro(rubro(RUBROS_BALANCE, 'otras_inversiones'), COMPARABLE), null);
  assert.strictEqual(cifraDeRubro(rubro(RUBROS_RESULTADOS, 'depreciacion'), COMPARABLE), null);
  const emitidos = rubrosConDato(RUBROS_BALANCE, COMPARABLE).map((r) => r.campo);
  assert.ok(!emitidos.includes('otras_inversiones'));
  assert.ok(!emitidos.includes('total_pasivos'), 'el que no viene en el documento tampoco');
  assert.deepStrictEqual(emitidos, ['cuentas_por_cobrar', 'inventarios', 'total_activos', 'cuentas_por_pagar'],
    'y los que quedan conservan el orden de la ficha');
});

test('un cero reportado SÍ es un dato y su fila se emite', () => {
  /* La distinción que el prompt garantiza: null para el rubro que no figura, 0 solo para el
     cero reportado. Tratar el cero como ausencia borraría una cifra que la empresa publicó. */
  const conCero = { eeffDatos: { total_pasivos: 0 } };
  assert.strictEqual(cifraDeRubro(rubro(RUBROS_BALANCE, 'total_pasivos'), conCero), 0);
  assert.deepStrictEqual(rubrosConDato(RUBROS_BALANCE, conCero).map((r) => r.campo), ['total_pasivos']);
});

test('sin comparable ni eeffDatos no revienta y no emite nada', () => {
  assert.strictEqual(cifraDeRubro(rubro(RUBROS_BALANCE, 'total_activos'), null), null);
  assert.deepStrictEqual(rubrosConDato(RUBROS_BALANCE, {}), []);
});
