import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cotejarConFuente, TOLERANCIA_PP } from './eeffCotejoFuente.js';
import { importCapitalIQExcel, nameKey } from './comparablesEngine.js';
import { extraerTextoEstructuradoPdf } from './eeffParser.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/* AKATSUKI INC., tal como sale de su ficha y del export de Capital IQ: la ficha en
   yenes y el export en dólares, con el mismo margen. Es el caso que hace posible todo
   este cotejo, así que sirve de base para los demás. */
const FICHA = { ingresos_operacionales: 23652, costo_ventas: 9954, utilidad_operacional: 3916 };
const FUENTE = { s: 157.1, c: 66.13, op: 26.01 };

test('con los dos márgenes cuadrando no hay nada que reportar, y consta que se cotejó', () => {
  const r = cotejarConFuente(FICHA, FUENTE);
  assert.strictEqual(r.cotejado, true);
  assert.deepStrictEqual(r.hallazgos, []);
});

test('la moneda no importa: la ficha en local y la fuente en dólares cotejan igual', () => {
  /* Sin esto el cotejo sería imposible: la ficha imprime yenes, coronas o yuanes y el
     export de Capital IQ viene convertido a dólares. Un margen es adimensional. */
  const enDolares = cotejarConFuente(FICHA, FUENTE);
  const enYenes = cotejarConFuente(FICHA, { s: 23652, c: 9954, op: 3916 });
  assert.deepStrictEqual(enDolares.hallazgos, []);
  assert.deepStrictEqual(enYenes.hallazgos, []);
});

test('una utilidad operacional tomada de la fila equivocada se delata', () => {
  /* El error que este cotejo existe para atrapar: la aritmética interna del documento
     puede cuadrar consigo misma y la cifra venir de la fila de gastos operativos. */
  const r = cotejarConFuente({ ...FICHA, utilidad_operacional: 9782 }, FUENTE);
  assert.strictEqual(r.cotejado, true);
  assert.strictEqual(r.hallazgos.length, 1);
  assert.match(r.hallazgos[0], /operacional/i);
  assert.match(r.hallazgos[0], /41[.,]36|41[.,]4/, 'dice el margen que se leyó');
  assert.match(r.hallazgos[0], /16[.,]5/, 'y el que trae la base de datos');
});

test('un costo de ventas equivocado se delata aunque el margen operacional cuadre', () => {
  /* Por esto el margen bruto no es redundante: la utilidad operacional puede estar
     bien leída y el costo venir de otra fila. */
  const r = cotejarConFuente({ ...FICHA, costo_ventas: 13698 }, FUENTE);
  assert.strictEqual(r.hallazgos.length, 1);
  assert.match(r.hallazgos[0], /bruto/i);
});

test('si las dos cifras están mal, se reportan las dos', () => {
  const r = cotejarConFuente(
    { ...FICHA, costo_ventas: 13698, utilidad_operacional: 9782 }, FUENTE);
  assert.strictEqual(r.hallazgos.length, 2);
});

test('el costo impreso en negativo cuadra con el positivo de la base de datos', () => {
  /* El documento imprime el costo entre paréntesis o con menos según quién lo emitió, y
     `verifyAccountingEqualities` ya lo trata en magnitud. Aquí igual. */
  assert.deepStrictEqual(cotejarConFuente({ ...FICHA, costo_ventas: -9954 }, FUENTE).hallazgos, []);
  assert.deepStrictEqual(cotejarConFuente(FICHA, { ...FUENTE, c: -66.13 }).hallazgos, []);
});

test('una pérdida operativa es un dato válido y se coteja como cualquier otro', () => {
  const enPerdida = { ...FICHA, utilidad_operacional: -3916 };
  assert.deepStrictEqual(cotejarConFuente(enPerdida, { ...FUENTE, op: -26.01 }).hallazgos, []);
  /* Y una pérdida en la ficha frente a una ganancia en la fuente sí es un hallazgo. */
  assert.strictEqual(cotejarConFuente(enPerdida, FUENTE).hallazgos.length, 1);
});

test('justo en la tolerancia no se reporta; pasándola, sí', () => {
  /* El límite se prueba explícitamente porque es el número que decide si un aviso
     aparece o no, y está fijado con datos: el ruido real medido es de 0,06 pp. */
  const margen = (pp) => ({ s: 100, c: 0, op: (3916 / 23652) * 100 + pp });
  const justo = cotejarConFuente(
    { ingresos_operacionales: 100, utilidad_operacional: (3916 / 23652) * 100 },
    margen(TOLERANCIA_PP));
  assert.deepStrictEqual(justo.hallazgos, [], 'una diferencia igual a la tolerancia se admite');

  const pasado = cotejarConFuente(
    { ingresos_operacionales: 100, utilidad_operacional: (3916 / 23652) * 100 },
    margen(TOLERANCIA_PP + 0.02));
  assert.strictEqual(pasado.hallazgos.length, 1);
});

/* ══════ Cuando NO hay con qué cotejar: ni hallazgo, ni falso visto bueno ══════ */

test('sin cifras de la fuente no se coteja, y no se reporta nada', () => {
  /* «No pude comprobar» no puede leerse como «comprobé y está bien» ni como una falla:
     una comparable cargada a mano no trae cifras de Capital IQ en su fila. */
  for (const fila of [null, undefined, {}, { s: null, op: null }, { s: 0, op: 5 }]) {
    const r = cotejarConFuente(FICHA, fila);
    assert.strictEqual(r.cotejado, false, JSON.stringify(fila));
    assert.deepStrictEqual(r.hallazgos, []);
  }
});

test('sin ventas en la ficha no hay margen que cotejar', () => {
  for (const datos of [null, {}, { ingresos_operacionales: 0, utilidad_operacional: 5 }]) {
    const r = cotejarConFuente(datos, FUENTE);
    assert.strictEqual(r.cotejado, false, JSON.stringify(datos));
    assert.deepStrictEqual(r.hallazgos, []);
  }
});

test('si la fuente no trae costo se coteja solo el margen operacional', () => {
  const r = cotejarConFuente({ ...FICHA, costo_ventas: 13698 }, { s: 157.1, op: 26.01 });
  assert.strictEqual(r.cotejado, true, 'el operacional sí se pudo cotejar');
  assert.deepStrictEqual(r.hallazgos, [], 'y el bruto no se inventa un hallazgo sin con qué comparar');
});

/* ══════ Sobre los archivos reales del estudio ══════ */

const DIR_FICHAS = path.resolve(AQUI, '../../Archivos Prueba/EEFF Comparables');
const XLS_IQ = path.resolve(
  AQUI, '../../../Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/END GAME 2025.xls');

/* FileReader no existe en node: se simula el mínimo que usa el importador, igual que en
   comparablesEngine.test.js. */
function conFileReader(buf, fn) {
  const previo = global.FileReader;
  global.FileReader = class {
    readAsArrayBuffer() {
      setImmediate(() => this.onload({
        target: { result: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) },
      }));
    }
  };
  return Promise.resolve(fn()).finally(() => {
    if (previo) global.FileReader = previo; else delete global.FileReader;
  });
}

/* Hace de modelo: saca de la ficha las tres cifras que el cotejo mira. En producción esto
   lo devuelve Gemini; aquí se transcribe con una expresión regular sobre el mismo texto
   que se le manda, para poder correr la prueba sin llamar a la IA. */
function transcribirFicha(texto) {
  const cifra = (rx) => {
    const m = texto.match(rx);
    if (!m) return null;
    const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  return {
    nombre: (texto.match(/^\d+ \| (.+?) \|/m) || texto.match(/^\d+ \| (.+)$/m) || [])[1] || '',
    ingresos_operacionales: cifra(/Ventas netas \| ([\d.,]+)/),
    costo_ventas: cifra(/Costo de ventas \| ([\d.,]+)/),
    utilidad_operacional: cifra(/Utilidad operativa \| ([\d.,]+)/),
  };
}

const hayFixtures = fs.existsSync(DIR_FICHAS) && fs.existsSync(XLS_IQ);

test('las 19 fichas reales cotejan contra el export real de Capital IQ',
  { skip: !hayFixtures }, async () => {
    /* Es la red que avisaría si un cambio en el lector de PDF degradara la lectura en
       silencio: hoy las cifras de las fichas y las del export coinciden en margen, y esta
       prueba lo fija sobre los archivos del estudio, no sobre datos inventados. */
    const buf = fs.readFileSync(XLS_IQ);
    const { rows } = await conFileReader(buf, () =>
      importCapitalIQExcel({ name: 'END GAME 2025.xls', size: buf.length }));

    const porNombre = new Map();
    rows.forEach((r) => { if (r && r.name) porNombre.set(nameKey(r.name), r); });

    let cotejadas = 0;
    let sinCruce = 0;
    for (const archivo of fs.readdirSync(DIR_FICHAS).filter((f) => f.toLowerCase().endsWith('.pdf'))) {
      const contenido = fs.readFileSync(path.join(DIR_FICHAS, archivo));
      const texto = await extraerTextoEstructuradoPdf({
        name: archivo, type: 'application/pdf', arrayBuffer: async () => contenido,
      });
      assert.ok(texto, archivo + ': la ficha tiene capa de texto y debería leerse');

      const datos = transcribirFicha(texto);
      const fila = porNombre.get(nameKey(datos.nombre));
      const r = cotejarConFuente(datos, fila);
      if (!r.cotejado) { sinCruce++; continue; }
      cotejadas++;
      assert.deepStrictEqual(r.hallazgos, [], archivo + ': la ficha debería cotejar con Capital IQ');
    }

    assert.strictEqual(cotejadas, 18, 'cotejan 18 fichas');
    /* SILICON STUDIO CORPORATION trae la ficha con todas sus filas en «-»: no hay margen
       que cotejar y la guarda de suficiencia ya la rechaza antes de aplicarla. */
    assert.strictEqual(sinCruce, 1, 'y una queda sin cotejar por venir vacía');
  });
