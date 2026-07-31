import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import * as XLSX from 'xlsx';
import {
  scoreCandidates, curateCandidatesWithGemini, nameKey,
  elegirHoja, encontrarFilaEncabezados, COLUMNAS_IQ, importCapitalIQExcel,
  regionDe, perfilDe, tokensSignificativos, coincidenciaActividad, extraerJSON
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

/** Responde a cada lote con el veredicto que dicte `decidir(candidato)`. */
function mockGemini(decidir, opciones = {}) {
  const original = axios.post;
  const llamadas = [];
  axios.post = async (url, body) => {
    llamadas.push(body);
    if (opciones.fallarLlamada && opciones.fallarLlamada(llamadas.length)) {
      throw new Error('límite de la API');
    }
    const texto = body.contents[0].parts[0].text;
    const lista = JSON.parse(texto.slice(texto.indexOf('Candidatas:\n') + 12, texto.lastIndexOf('\n\nResponde')));
    return {
      data: {
        candidates: [{
          content: {
            parts: [{
              text: (opciones.envolver || (s => s))(JSON.stringify({
                resultados: lista.map(c => ({ id: c.id, coincide: decidir(c), motivo: 'motivo breve' }))
              }))
            }]
          }
        }]
      }
    };
  };
  return { restore: () => { axios.post = original; }, llamadas };
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

test('una candidata de continuidad no se descarta aunque la IA diga que no coincide', async () => {
  /* La curación ya no devuelve las candidatas marcadas: devuelve un veredicto por
     identificador, y el descarte lo decide el motor, que es quien conoce las
     excepciones. La intención de la comprobación no cambia: la comparable que
     venía del estudio anterior sobrevive al «no coincide» de la IA, porque su
     inclusión se sustentó en su momento. */
  const restore = mockGeminiRechazandoTodas();
  try {
    const candidatas = [
      { id: 'A', name: 'Continuidad Corp', nameKey: nameKey('Continuidad Corp'), desc: 'x', s: 100, op: 10 },
      { id: 'B', name: 'Nueva Corp', nameKey: nameKey('Nueva Corp'), desc: 'y', s: 100, op: 10 }
    ];
    const veredicto = await curateCandidatesWithGemini(candidatas, 'actividad de prueba');
    assert.strictEqual(veredicto.porId.A.coincide, false, 'la IA rechazó a A');
    assert.strictEqual(veredicto.porId.B.coincide, false, 'y a B');

    const r = scoreCandidates(candidatas, { nTarget: 10 }, 'actividad de prueba',
      [{ name: 'Continuidad Corp' }], { iaMatch: veredicto });
    const a = [...r.seleccionadas, ...r.rechazadas].find(c => c.id === 'A');
    const b = [...r.seleccionadas, ...r.rechazadas].find(c => c.id === 'B');
    assert.strictEqual(a.descartada, false, 'la de continuidad no debe descartarse');
    assert.strictEqual(b.descartada, true, 'la que no viene de continuidad sí');
    assert.match(b.motivoRechazo, /Curación IA/);
  } finally {
    restore();
  }
});

/* ══════ Curación por IA: comportamiento completo migrado del monolito ══════ */

test('la curación solo evalúa candidatas con identificador y descripción', async () => {
  const { restore, llamadas } = mockGemini(() => true);
  try {
    const veredicto = await curateCandidatesWithGemini([
      { id: 'CON', name: 'Con datos', desc: 'software development services' },
      { id: '', name: 'Sin id', desc: 'algo' },
      { id: 'SINDESC', name: 'Sin descripción', desc: '' },
    ], 'desarrollo de software');
    assert.strictEqual(veredicto.total, 1, 'solo una es evaluable');
    assert.ok(veredicto.porId.CON, 'y es la que trae ambos datos');
    assert.strictEqual(veredicto.porId.SINDESC, undefined, 'la que no tiene descripción no se juzga');
    const enviado = llamadas[0].contents[0].parts[0].text;
    assert.ok(!enviado.includes('Sin id'), 'no se manda a la IA lo que no puede evaluar');
  } finally {
    restore();
  }
});

test('la curación se omite sin actividad detectada, sin descartar a nadie', async () => {
  const { restore, llamadas } = mockGemini(() => false);
  try {
    const veredicto = await curateCandidatesWithGemini(
      [{ id: 'A', name: 'A', desc: 'x' }], '   '
    );
    assert.strictEqual(llamadas.length, 0, 'no debe gastar ninguna consulta');
    assert.ok(veredicto.omitida, 'y debe decir por qué se omitió');
    assert.deepStrictEqual(veredicto.porId, {}, 'sin veredictos: nadie queda descartado por omisión');
  } finally {
    restore();
  }
});

test('la curación trocea el universo en lotes de 60', async () => {
  const { restore, llamadas } = mockGemini(() => true);
  try {
    const candidatas = Array.from({ length: 130 }, (_, i) => ({ id: 'C' + i, name: 'Comp ' + i, desc: 'software development services' }));
    const veredicto = await curateCandidatesWithGemini(candidatas, 'desarrollo de software');
    assert.strictEqual(llamadas.length, 3, '130 candidatas son 3 lotes de 60, 60 y 10');
    assert.strictEqual(Object.keys(veredicto.porId).length, 130, 'y todas quedan con veredicto');
    assert.strictEqual(veredicto.evaluadas, 130);
    assert.strictEqual(veredicto.fallidas, 0);
  } finally {
    restore();
  }
});

test('un lote que falla no descarta a sus candidatas', async () => {
  /* Un problema de red no puede traducirse en excluir comparables del estudio. */
  const { restore } = mockGemini(() => true, { fallarLlamada: (n) => n === 1 });
  try {
    const candidatas = Array.from({ length: 90 }, (_, i) => ({ id: 'C' + i, name: 'Comp ' + i, desc: 'software development services' }));
    const veredicto = await curateCandidatesWithGemini(candidatas, 'desarrollo de software');
    assert.strictEqual(veredicto.fallidas, 60, 'el lote caído se cuenta como no evaluado');
    assert.strictEqual(veredicto.evaluadas, 30, 'el otro sí se evaluó');
    /* las del lote caído no tienen veredicto, así que el motor no las descarta */
    const sinVeredicto = candidatas.filter(c => !veredicto.porId[c.id]);
    assert.strictEqual(sinVeredicto.length, 60);
    const r = scoreCandidates(candidatas, { nTarget: 100 }, 'desarrollo de software', [], { iaMatch: veredicto });
    const descartadasPorIA = r.rechazadas.filter(c => /Curación IA/.test(c.motivoRechazo || ''));
    assert.strictEqual(descartadasPorIA.length, 0, 'ninguna se descarta por un fallo de la API');
  } finally {
    restore();
  }
});

test('la curación informa el avance y una estimación de espera', async () => {
  const { restore } = mockGemini(() => true);
  try {
    const avisos = [];
    const candidatas = Array.from({ length: 70 }, (_, i) => ({ id: 'C' + i, name: 'C' + i, desc: 'software development services' }));
    await curateCandidatesWithGemini(candidatas, 'desarrollo de software', { onProgress: (i) => avisos.push(i) });
    const inicio = avisos.find(a => a.etapa === 'inicio');
    assert.ok(inicio, 'avisa al empezar');
    assert.ok(inicio.etaMinutos >= 1, 'con una estimación de minutos');
    assert.ok(inicio.mensaje.includes('No cierre la pestaña'));
    assert.ok(avisos.some(a => a.etapa === 'lote'), 'informa por lote');
    const fin = avisos.find(a => a.etapa === 'fin');
    assert.ok(fin && fin.coinciden === 70, 'y cierra con el total que coincide');
  } finally {
    restore();
  }
});

test('la curación aguanta que el modelo envuelva el JSON en prosa', async () => {
  const { restore } = mockGemini(() => true, {
    envolver: (s) => 'Claro, aquí va el análisis:\n```json\n' + s + '\n```\nEspero que sea útil.',
  });
  try {
    const veredicto = await curateCandidatesWithGemini(
      [{ id: 'A', name: 'A', desc: 'software development services' }], 'desarrollo de software'
    );
    assert.strictEqual(veredicto.porId.A.coincide, true, 'antes esto perdía el lote entero');
  } finally {
    restore();
  }
});

test('el veredicto de la IA sube el factor de especialidad al máximo', async () => {
  const { restore } = mockGemini(() => true);
  try {
    const cand = { id: 'A', name: 'Ajena SA', nameKey: nameKey('Ajena SA'), desc: 'iron ore mining', s: 1000, op: 100 };
    const veredicto = await curateCandidatesWithGemini([cand], 'desarrollo de software');
    const sinIA = scoreCandidates([cand], { nTarget: 1 }, 'desarrollo de software', [], {});
    const conIA = scoreCandidates([cand], { nTarget: 1 }, 'desarrollo de software', [], { iaMatch: veredicto });
    assert.strictEqual(sinIA.seleccionadas[0].factores.especialidad, 0.15, 'por palabras clave no coincide');
    assert.strictEqual(conIA.seleccionadas[0].factores.especialidad, 1, 'pero la IA leyó la descripción real y confirmó');
  } finally {
    restore();
  }
});

test('con curación hecha, una candidata sin descripción se descarta explicándolo', () => {
  const candidatas = [{ id: 'X', name: 'Sin desc SA', nameKey: nameKey('Sin desc SA'), desc: '', s: 100, op: 10 }];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, 'desarrollo de software', [],
    { iaMatch: { porId: { OTRO: { coincide: true } } } });
  assert.strictEqual(r.rechazadas.length, 1);
  assert.match(r.rechazadas[0].motivoRechazo, /Sin descripción del negocio/);
  assert.match(r.rechazadas[0].motivoRechazo, /ID X/, 'dice de qué identificador se trata');
});

test('sin curación, una candidata sin descripción no se descarta', () => {
  /* Las agregadas a mano o de otras fuentes no tienen descripción y no deben
     quedar fuera por omisión. */
  const candidatas = [{ id: 'X', name: 'Sin desc SA', nameKey: nameKey('Sin desc SA'), desc: '', s: 100, op: 10 }];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, 'desarrollo de software', [], {});
  assert.strictEqual(r.rechazadas.length, 0);
  assert.strictEqual(r.seleccionadas.length, 1);
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

/* ══════ Los cinco factores de la puntuación ══════
   Antes la puntuación era 0,5 + bono de continuidad + 0,1 si el país era LATAM, de
   modo que con miles de candidatas casi todas empataban y quedarse con las
   primeras nTarget equivalía a tomar las primeras del archivo. */

test('regionDe reconoce las cinco regiones, no solo LATAM', () => {
  assert.strictEqual(regionDe('Colombia'), 'LATAM');
  assert.strictEqual(regionDe('Japan'), 'ASIA');
  assert.strictEqual(regionDe('Poland'), 'EUROPA');
  assert.strictEqual(regionDe('United States'), 'NORTEAM');
  assert.strictEqual(regionDe('Nigeria'), 'OTRA');
  assert.strictEqual(regionDe(''), 'OTRA');
});

test('perfilDe clasifica por la descripción del negocio, no por la utilidad', () => {
  assert.strictEqual(perfilDe('Provides custom software development services for clients'), 'SERVICIO');
  assert.strictEqual(perfilDe('Publishes its own free-to-play games and monetizes them'), 'EMPRESARIO');
  assert.strictEqual(perfilDe('Offers IT services and also publishes its own titles'), 'MIXTO');
  assert.strictEqual(perfilDe('Manufactures industrial valves'), 'INDEFINIDO');
  assert.strictEqual(perfilDe(''), 'INDEFINIDO');
});

test('tokensSignificativos deja fuera las palabras vacías y las cortas', () => {
  const t = tokensSignificativos('Desarrollo de software para la industria del videojuego');
  assert.ok(t.includes('desarrollo') && t.includes('software') && t.includes('videojuego'));
  assert.ok(!t.includes('de') && !t.includes('la') && !t.includes('del'));
  assert.deepStrictEqual(tokensSignificativos('casa casa casa'), ['casa'], 'sin repetir');
});

test('coincidenciaActividad puntúa según cuántas palabras del perfil aparecen', () => {
  const actividad = 'desarrollo de software interactivo y diseño digital';
  const buena = coincidenciaActividad({ name: 'X', desc: 'software development and digital design studio, interactivo', sic: '7372' }, actividad);
  const mala = coincidenciaActividad({ name: 'Y', desc: 'mining of iron ore', sic: '1011' }, actividad);
  assert.ok(buena.factor > mala.factor, 'la del sector debe puntuar más alto');
  assert.strictEqual(mala.factor, 0.15, 'la que no coincide baja al piso, no a cero');
  assert.strictEqual(buena.hayActividad, true);
  const sinActividad = coincidenciaActividad({ name: 'Z', desc: 'algo' }, '');
  assert.strictEqual(sinActividad.factor, 1, 'sin actividad detectada el factor es neutro');
  assert.strictEqual(sinActividad.hayActividad, false);
  const porIA = coincidenciaActividad({ name: 'W', desc: '', iaCoincide: true }, actividad);
  assert.strictEqual(porIA.factor, 1, 'si la IA ya confirmó la coincidencia, factor máximo');
});

test('scoreCandidates ordena por mérito y no deja a todas empatadas', () => {
  const actividad = 'desarrollo de software interactivo';
  const candidatas = [
    { id: 'A', name: 'Alfa Mining', desc: 'iron ore mining', country: 'Nigeria', s: 1000, op: 100 },
    /* coincide en las tres palabras del perfil: desarrollo, software e interactivo */
    { id: 'B', name: 'Beta Software', desc: 'desarrollo de software interactivo a la medida para terceros', country: 'Colombia', s: 1000, op: 100 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 2, geo: 'LATAM' }, actividad, [], { ventasParteExaminada: 1000 });
  assert.strictEqual(r.seleccionadas[0].id, 'B', 'la que coincide con la actividad y la región va primero');
  assert.ok(r.seleccionadas[0].score > r.seleccionadas[1].score, 'los puntajes deben diferir');
  assert.ok(r.seleccionadas[0].razones.includes('coincide con la actividad'), 'explica por qué: ' + r.seleccionadas[0].razones);
  assert.ok(r.seleccionadas[0].razones.includes('región prioritaria'), 'y menciona la región');
  /* una sola palabra coincidente se reporta como parcial, no como coincidencia */
  const parcial = scoreCandidates(
    [{ id: 'C', name: 'Gamma', desc: 'custom software development services', s: 1000, op: 100 }],
    { nTarget: 1 }, actividad, [], {}
  );
  assert.ok(parcial.seleccionadas[0].razones.includes('coincidencia parcial'), 'con un solo acierto, parcial');
});

test('scoreCandidates: el factor de tamaño premia la cercanía a la parte examinada', () => {
  const candidatas = [
    { id: 'CERCA', name: 'Cerca', desc: '', country: '', s: 1100, op: 110 },
    { id: 'LEJOS', name: 'Lejos', desc: '', country: '', s: 11000000, op: 1100000 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 2 }, '', [], { ventasParteExaminada: 1000 });
  assert.strictEqual(r.seleccionadas[0].id, 'CERCA', 'la de tamaño próximo debe ir primero');
  assert.ok(r.seleccionadas[0].factores.tamano > r.seleccionadas[1].factores.tamano);
});

test('scoreCandidates: sin ventas de la parte examinada el tamaño queda neutro y se avisa', () => {
  const r = scoreCandidates([{ id: 'A', name: 'A', s: 500, op: 50 }], { nTarget: 1 }, '', [], {});
  assert.strictEqual(r.ventasParteExaminada, null);
  assert.strictEqual(r.seleccionadas[0].factores.tamano, 0.5, 'neutro, no cero: no se penaliza por un dato que falta');
});

test('scoreCandidates: la especialidad pesa 40 % con actividad y 15 % sin ella', () => {
  const candidata = { id: 'A', name: 'Beta Software', desc: 'custom software development services', country: '', s: 1000, op: 100 };
  const con = scoreCandidates([candidata], { nTarget: 1 }, 'desarrollo de software', [], {});
  const sin = scoreCandidates([candidata], { nTarget: 1 }, '', [], {});
  assert.strictEqual(con.conActividad, true);
  assert.strictEqual(sin.conActividad, false);
  /* el mismo candidato puntúa distinto según el reparto de pesos */
  assert.notStrictEqual(con.seleccionadas[0].score, sin.seleccionadas[0].score);
});

test('scoreCandidates devuelve reserva para poder reponer lo que la IA descarte', () => {
  const candidatas = Array.from({ length: 10 }, (_, i) => ({ id: 'C' + i, name: 'Comp ' + i, desc: '', s: 1000, op: 100 }));
  const r = scoreCandidates(candidatas, { nTarget: 3 }, '', [], {});
  assert.strictEqual(r.seleccionadas.length, 3);
  assert.strictEqual(r.reserva.length, 7, 'las válidas que no entraron al TOP-N quedan disponibles');
});

test('scoreCandidates: los descartes por filtro siguen operando', () => {
  const candidatas = [
    { id: 'H', name: 'Holding SA', isHolding: true, s: 100, op: 10 },
    { id: 'N', name: 'Negativa SA', hasNegativeBalance: true, s: 100, op: 10 },
    { id: 'P', name: 'Perdida SA', hasLoss: true, s: 100, op: -10 },
    { id: 'OK', name: 'Buena SA', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, '', [], {});
  assert.strictEqual(r.seleccionadas.length, 1);
  assert.strictEqual(r.seleccionadas[0].id, 'OK');
  assert.strictEqual(r.rechazadas.length, 3);
  r.rechazadas.forEach(c => assert.ok(c.motivoRechazo, 'cada descarte debe traer motivo: ' + c.id));
});

/* ══════ extraerJSON: la curación se perdía por una frase de más ══════ */
test('extraerJSON aguanta prosa alrededor y vallas de markdown', () => {
  const esperado = { evaluacion: [{ id: 'A', coincide: true, motivo: 'ok' }] };
  assert.deepStrictEqual(extraerJSON('```json\n' + JSON.stringify(esperado) + '\n```'), esperado);
  assert.deepStrictEqual(extraerJSON('Claro, aquí tienes: ' + JSON.stringify(esperado) + ' Espero que sirva.'), esperado);
  assert.deepStrictEqual(extraerJSON(JSON.stringify({ a: '{ no es una llave }' })), { a: '{ no es una llave }' },
    'las llaves dentro de una cadena no cuentan');
  assert.throws(() => extraerJSON('sin json aquí'), /no contiene ningún objeto JSON/);
  assert.throws(() => extraerJSON('{"a": 1'), /incompleto/);
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
