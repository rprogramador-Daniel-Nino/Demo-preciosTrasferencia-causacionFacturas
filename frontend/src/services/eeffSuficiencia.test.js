import { test } from 'node:test';
import assert from 'node:assert';
import {
  partidasFaltantes, aportaInformacionFinanciera, motivoSinInformacionFinanciera,
  separarPorSuficiencia, retirarFilas,
} from './eeffSuficiencia.js';

/* Un estado financiero completo, como el que devuelve el parser cuando el documento
   trae la página de la empresa entera. */
const COMPLETO = {
  nombre: 'ALFA COMPARABLE SA',
  ingresos_operacionales: 5000, costo_ventas: 3500, utilidad_bruta: 1500,
  gastos_operacionales: 600, utilidad_operacional: 900,
  cuentas_por_cobrar: 400, inventarios: 250, cuentas_por_pagar: 300,
  propiedad_planta_equipo: 180,
};

test('un estado financiero completo aporta información financiera', () => {
  assert.deepStrictEqual(partidasFaltantes(COMPLETO), []);
  assert.strictEqual(aportaInformacionFinanciera(COMPLETO), true);
});

test('sin ingresos operacionales no hay denominador para el margen', () => {
  /* El parser devuelve null cuando el rubro no figura, así que se distingue de un cero. */
  const faltantes = partidasFaltantes({ ...COMPLETO, ingresos_operacionales: null });
  assert.strictEqual(faltantes.length, 1);
  assert.match(faltantes[0], /ingresos operacionales/);
});

test('ingresos en cero tampoco sirven: el margen sería una división por cero', () => {
  assert.strictEqual(aportaInformacionFinanciera({ ...COMPLETO, ingresos_operacionales: 0 }), false);
});

test('sin utilidad operacional no hay numerador', () => {
  const faltantes = partidasFaltantes({ ...COMPLETO, utilidad_operacional: null });
  assert.strictEqual(faltantes.length, 1);
  assert.match(faltantes[0], /utilidad operacional/);
});

test('una utilidad operacional en cero es un dato válido y no retira la comparable', () => {
  /* «La empresa reportó cero» no es lo mismo que «el concepto no aparece»: el prompt del
     parser lo garantiza devolviendo null en el segundo caso. Tratar el cero como ausencia
     retiraría comparables con estado de resultados completo. */
  assert.strictEqual(aportaInformacionFinanciera({ ...COMPLETO, utilidad_operacional: 0 }), true);
});

test('una pérdida operativa aporta información: el rango admite márgenes negativos', () => {
  assert.strictEqual(aportaInformacionFinanciera({ ...COMPLETO, utilidad_operacional: -450 }), true);
});

test('las partidas de capital de trabajo no se exigen', () => {
  /* Solo alimentan el ajuste, que es opcional. Exigirlas dejaría fuera comparables con
     un margen perfectamente calculable. */
  const soloResultados = {
    ingresos_operacionales: 5000, utilidad_operacional: 900,
    cuentas_por_cobrar: null, inventarios: null, cuentas_por_pagar: null,
    propiedad_planta_equipo: null,
  };
  assert.strictEqual(aportaInformacionFinanciera(soloResultados), true);
});

test('un documento del que no se leyó nada falta en las dos partidas', () => {
  const faltantes = partidasFaltantes({ nombre: 'BETA SA' });
  assert.strictEqual(faltantes.length, 2);
  assert.strictEqual(aportaInformacionFinanciera(null), false);
});

test('las cifras escritas como texto se leen igual', () => {
  /* `num` admite lo que llega del navegador y de la IA: cadenas, paréntesis para el
     negativo y separadores de miles. */
  assert.strictEqual(aportaInformacionFinanciera({
    ingresos_operacionales: '5.000', utilidad_operacional: '(450)',
  }), true);
});

test('el motivo dice qué faltó y cómo corregirlo', () => {
  /* Un rechazo sin motivo no se puede corregir: el usuario tiene que poder decidir entre
     conseguir otro documento o escribir las cifras a mano. */
  const motivo = motivoSinInformacionFinanciera(
    'ALFA COMPARABLE SA', partidasFaltantes({ nombre: 'x' }), 'eeff_lote.pdf');
  assert.match(motivo, /ingresos operacionales/);
  assert.match(motivo, /utilidad operacional/);
  assert.match(motivo, /eeff_lote\.pdf/);
  assert.match(motivo, /diferencias funcionales/i, 'debe decir dónde queda contada');
  assert.match(motivo, /ALFA COMPARABLE SA/, 'y en qué fila escribirlas a mano');
});

test('separarPorSuficiencia reparte sin perder ninguna entrada', () => {
  const aplicadas = [
    { indice: 0, datos: COMPLETO },
    { indice: 1, datos: { ...COMPLETO, ingresos_operacionales: null } },
    { indice: 2, datos: { ...COMPLETO, utilidad_operacional: 0 } },
    { indice: 3, datos: {} },
  ];
  const { conCifras, sinCifras } = separarPorSuficiencia(aplicadas);
  assert.deepStrictEqual(conCifras.map((a) => a.indice), [0, 2]);
  assert.deepStrictEqual(sinCifras.map((a) => a.indice), [1, 3]);
  assert.strictEqual(conCifras.length + sinCifras.length, aplicadas.length);
  assert.ok(sinCifras[0].faltantes.length, 'las retiradas llevan qué les faltó');
});

test('separarPorSuficiencia tolera una lista ausente', () => {
  assert.deepStrictEqual(separarPorSuficiencia(null), { conCifras: [], sinCifras: [] });
});

/* ══════ Retiro de filas y traducción de índices ══════ */

test('retirarFilas quita la fila y traduce las posiciones de las que quedan', () => {
  /* Sin la traducción, la descripción que la IA redacta un rato después se escribiría
     sobre la comparable equivocada: `redactarDescripcionesDeFilas` guarda posiciones y
     resuelve con `setComparables` cuando la respuesta llega. */
  const filas = [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }];
  const { filas: quedan, nuevoIndice } = retirarFilas(filas, new Set([1]));

  assert.deepStrictEqual(quedan.map((f) => f.name), ['A', 'C', 'D']);
  assert.strictEqual(nuevoIndice.get(0), 0);
  assert.strictEqual(nuevoIndice.get(2), 1, 'C pasa de la posición 2 a la 1');
  assert.strictEqual(nuevoIndice.get(3), 2);
  assert.strictEqual(nuevoIndice.has(1), false, 'la retirada no tiene posición nueva');
  assert.strictEqual(quedan[nuevoIndice.get(2)].name, 'C', 'la traducción apunta a la misma empresa');
});

test('retirarFilas no toca nada si no hay filas que retirar', () => {
  const filas = [{ name: 'A' }, { name: 'B' }];
  const r = retirarFilas(filas, new Set());
  assert.strictEqual(r.filas, filas, 'devuelve el mismo arreglo, sin copiarlo');
  assert.strictEqual(r.nuevoIndice, null, 'y avisa de que los índices siguen valiendo');
});

test('retirarFilas admite varias a la vez y no descoloca ninguna', () => {
  const filas = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name }));
  const { filas: quedan, nuevoIndice } = retirarFilas(filas, new Set([0, 3]));
  assert.deepStrictEqual(quedan.map((f) => f.name), ['B', 'C', 'E']);
  [1, 2, 4].forEach((viejo) => {
    assert.strictEqual(quedan[nuevoIndice.get(viejo)].name, filas[viejo].name);
  });
});

test('el flujo completo: de 16 seleccionadas, la que no trae cifras deja 15', () => {
  /* El caso que se pidió el 2026-08-11: se cargan los EEFF de las 16 y una viene sin
     información financiera, así que la muestra queda en 15 con el aviso de por qué. */
  const seleccionadas = Array.from({ length: 16 }, (_, i) => ({ name: `COMPARABLE ${i + 1}` }));
  const aplicadas = seleccionadas.map((c, i) => ({
    indice: i,
    archivo: 'eeff_lote.pdf',
    datos: i === 7
      ? { nombre: c.name, ingresos_operacionales: null, utilidad_operacional: null }
      : { nombre: c.name, ingresos_operacionales: 1000 + i, utilidad_operacional: 100 + i },
  }));

  const { conCifras, sinCifras } = separarPorSuficiencia(aplicadas);
  assert.strictEqual(conCifras.length, 15);
  assert.strictEqual(sinCifras.length, 1);
  assert.strictEqual(sinCifras[0].datos.nombre, 'COMPARABLE 8');

  const { filas: muestra, nuevoIndice } = retirarFilas(
    seleccionadas, new Set(sinCifras.map((a) => a.indice)));
  assert.strictEqual(muestra.length, 15, 'la muestra queda en 15');
  assert.ok(!muestra.some((c) => c.name === 'COMPARABLE 8'), 'y sin la que no trae cifras');

  /* Las 15 que sí entraron siguen apuntando a su propia fila tras el retiro. */
  conCifras.forEach((a) => {
    assert.strictEqual(muestra[nuevoIndice.get(a.indice)].name, a.datos.nombre);
  });
});
