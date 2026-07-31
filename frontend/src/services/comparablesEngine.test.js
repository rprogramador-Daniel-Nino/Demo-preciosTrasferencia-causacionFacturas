import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import * as XLSX from 'xlsx';
import {
  scoreCandidates, curateCandidatesWithGemini, nameKey,
  elegirHoja, encontrarFilaEncabezados, COLUMNAS_IQ, importCapitalIQExcel
} from './comparablesEngine.js';
import { num } from '../utils/calculations.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/* FileReader no existe en node: se simula el mínimo que usa el importador. */
function conFileReader(buf, fn) {
  const previo = global.FileReader;
  global.FileReader = class {
    readAsArrayBuffer() {
      setImmediate(() => this.onload({
        target: { result: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
      }));
    }
  };
  return Promise.resolve(fn()).finally(() => {
    if (previo) global.FileReader = previo; else delete global.FileReader;
  });
}

function mockGeminiRechazandoTodas() {
  const original = axios.post;
  axios.post = async () => ({
    data: {
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              evaluacion: [
                { id: 'A', coincide: false, motivo: 'no coincide según la IA' },
                { id: 'B', coincide: false, motivo: 'no coincide según la IA' }
              ]
            })
          }]
        }
      }]
    }
  });
  return () => { axios.post = original; };
}

test('scoreCandidates: una comparable con pérdida operativa se excluye aunque sea de continuidad', () => {
  const candidatas = [
    { id: 'A', name: 'Continuidad Corp', nameKey: nameKey('Continuidad Corp'), isHolding: false, hasNegativeBalance: false, hasLoss: true, country: 'Colombia' }
  ];
  const priorComps = [{ name: 'Continuidad Corp' }];
  const result = scoreCandidates(candidatas, {}, '', priorComps);
  assert.strictEqual(result.seleccionadas.length, 0, 'la pérdida operativa debe seguir excluyendo incluso a las de continuidad');
  assert.strictEqual(result.rechazadas.length, 1);
  assert.strictEqual(result.rechazadas[0].esContinuidad, true, 'sí debió reconocerse como continuidad');
});

test('curateCandidatesWithGemini: una candidata de continuidad no se descarta aunque la IA diga que no coincide', async () => {
  const restore = mockGeminiRechazandoTodas();
  try {
    const candidatas = [
      { id: 'A', name: 'Continuidad Corp', desc: 'x', esContinuidad: true, descartada: false },
      { id: 'B', name: 'Nueva Corp', desc: 'y', esContinuidad: false, descartada: false }
    ];
    const result = await curateCandidatesWithGemini(candidatas, 'actividad de prueba');
    const a = result.find(c => c.id === 'A');
    const b = result.find(c => c.id === 'B');
    assert.strictEqual(a.descartada, false, 'la candidata de continuidad no debe descartarse aunque la IA diga que no coincide');
    assert.strictEqual(b.descartada, true, 'la candidata sin continuidad sí debe descartarse');
  } finally {
    restore();
  }
});

/* ══════ Lectura del archivo de Capital IQ ══════
   El importador asumía los encabezados en la fila 0. El export real trae el título
   del reporte ahí, la fila 1 vacía y los encabezados en la 2, de modo que todos los
   índices de columna quedaban en -1, el bucle saltaba las 2.990 filas y la función
   devolvía un array vacío SIN lanzar: en pantalla no aparecía ni error ni resultado. */

test('elegirHoja prefiere la hoja de cribado sobre la primera', () => {
  assert.strictEqual(elegirHoja(['Aggregates', 'Screening', 'Screen Criteria']), 'Screening');
  assert.strictEqual(elegirHoja(['Screening', 'Aggregates']), 'Screening');
  assert.strictEqual(elegirHoja(['Hoja1', 'Hoja2']), 'Hoja1', 'sin ninguna reconocible, la primera');
  assert.strictEqual(elegirHoja([]), '');
});

test('encontrarFilaEncabezados salta el título del reporte de Capital IQ', () => {
  const filas = [
    ['Capital IQ Company Screening Report > END GAME 2025', '', '', ''],
    ['', '', '', ''],
    ['Company Name', 'Excel Company ID', 'Total Revenue', 'Operating Income'],
    ['11 bit studios S.A.', 'IQ1', 39.2, 6.23]
  ];
  assert.strictEqual(encontrarFilaEncabezados(filas), 2);
});

test('encontrarFilaEncabezados acepta el caso simple de encabezados arriba', () => {
  assert.strictEqual(encontrarFilaEncabezados([['Company Name', 'Total Revenue'], ['ACME', 100]]), 0);
});

test('las columnas esenciales son las que hacen falta para el rango', () => {
  ['name', 's', 'op'].forEach(k => assert.strictEqual(COLUMNAS_IQ[k].esencial, true, k + ' debe ser esencial'));
  /* las de balance no lo son: el cribado no las trae y se cargan aparte */
  ['ar', 'inv', 'ap'].forEach(k => assert.strictEqual(COLUMNAS_IQ[k].esencial, false, k + ' no debe ser esencial'));
});

test('importCapitalIQExcel explica el fallo en vez de devolver un array vacío', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['algo', 'otra cosa'], [1, 2]]), 'Hoja1');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  await conFileReader(buf, async () => {
    await assert.rejects(
      () => importCapitalIQExcel({ name: 'raro.xlsx', size: buf.length }),
      (err) => {
        assert.match(err.message, /No se encontró la columna de la compañía/);
        assert.match(err.message, /algo \| otra cosa/, 'incluye los encabezados leídos, para poder corregir el export');
        assert.ok(err.meta, 'y adjunta el diagnóstico para la interfaz');
        return true;
      }
    );
  });
});

test('importCapitalIQExcel lee un export con el título arriba, como el real', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['solo agregados']]), 'Aggregates');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Capital IQ Company Screening Report > PRUEBA', '', '', '', ''],
    ['', '', '', '', ''],
    ['Company Name', 'Excel Company ID', 'SIC Codes', 'Total Revenue [FY 2025]', 'Operating Income [FY 2025]'],
    ['ACME Services PLC', 'IQ111', '7372', 1000, 100],
    ['Beta Holdings Ltd', 'IQ222', '6719', 2000, 150],
    ['', '', '', '', ''],
    ['Total', '', '', 3000, 250]
  ]), 'Screening');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

  await conFileReader(buf, async () => {
    const etapas = [];
    const { rows, meta } = await importCapitalIQExcel(
      { name: 'prueba.xlsx', size: buf.length },
      (etapa, hechas, total) => etapas.push({ etapa, hechas, total })
    );

    assert.strictEqual(meta.hoja, 'Screening', 'elige la hoja de cribado y no Aggregates');
    assert.strictEqual(meta.filaEncabezados, 2, 'encuentra los encabezados en la tercera fila');
    assert.strictEqual(rows.length, 3, 'lee las compañías, incluida la fila "Total" que trae nombre');
    assert.strictEqual(rows[0].name, 'ACME Services PLC');
    assert.strictEqual(rows[0].s, 1000);
    assert.strictEqual(rows[0].op, 100);
    assert.strictEqual(rows[0].id, 'IQ111', 'conserva el identificador de la fuente');
    assert.strictEqual(meta.candidatas, rows.length);
    assert.ok(meta.saltadas >= 1, 'cuenta la fila vacía que omitió');
    assert.ok(meta.sinCuentasDeBalance, 'detecta que no vienen cartera, inventarios ni proveedores');
    assert.ok(!meta.faltantes.some(f => f.esencial), 'no falta ninguna columna esencial');
    assert.ok(etapas.length >= 2, 'informa varias etapas de progreso');
  });
});

/* ── el archivo real del cliente, si está en el repo ── */
const RUTA_REAL = path.resolve(
  AQUI, '../../../Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/END GAME 2025.xls'
);

test('importCapitalIQExcel lee el export real de Capital IQ', { skip: !fs.existsSync(RUTA_REAL) }, async () => {
  const buf = fs.readFileSync(RUTA_REAL);
  await conFileReader(buf, async () => {
    const { rows, meta } = await importCapitalIQExcel({ name: 'END GAME 2025.xls', size: buf.length });
    assert.strictEqual(meta.hoja, 'Screening');
    assert.strictEqual(meta.filaEncabezados, 2, 'los encabezados están en la fila 3 del Excel');
    assert.ok(rows.length > 2900, 'lee las ~2.987 compañías y no cero; obtenidas: ' + rows.length);
    const claves = meta.reconocidas.map(r => r.clave);
    ['name', 's', 'c', 'op', 'sic', 'id', 'desc', 'country'].forEach(k => {
      assert.ok(claves.includes(k), 'reconoce la columna ' + k);
    });
    assert.strictEqual(typeof rows[0].s, 'number', 'los ingresos llegan como número');
  });
});

/* ══════ num: los separadores de miles falseaban los márgenes ══════ */
test('num respeta los formatos numéricos que usan los analistas', () => {
  assert.strictEqual(num('2.761.202.249'), 2761202249, 'miles con punto; antes daba 2,761');
  assert.strictEqual(num('27.255.376'), 27255376);
  assert.strictEqual(num('1.234,56'), 1234.56, 'coma decimal');
  assert.strictEqual(num('1,234.56'), 1234.56, 'punto decimal');
  assert.strictEqual(num('(1.500)'), -1500, 'paréntesis es negativo; antes daba +1.500');
  assert.strictEqual(num('-1.500'), -1500);
  assert.strictEqual(num('$ 5.271.105.507'), 5271105507, 'con símbolo de moneda');
  assert.strictEqual(num('0,43'), 0.43, 'decimales pequeños, que son los que mueven el margen');
  assert.strictEqual(num(1234.56), 1234.56, 'un número pasa tal cual');
  assert.strictEqual(num(''), null);
  assert.strictEqual(num(null), null);
  assert.strictEqual(num('abc'), null);
});
