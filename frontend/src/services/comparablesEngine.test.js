
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import * as XLSX from 'xlsx';
import {
  scoreCandidates, curateCandidatesWithGemini, nameKey, prefiltrar,
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

/**
 * Responde a cada lote con el veredicto que dicte `decidir(candidato)`.
 * `opciones.perfil(candidato)` dicta el perfil funcional devuelto; si no se pasa, la
 * respuesta no trae perfil, como la de un modelo que ignora ese campo.
 */
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
                resultados: lista.map(c => ({
                  id: c.id,
                  coincide: decidir(c),
                  motivo: 'motivo breve',
                  ...(opciones.perfil ? { perfil: opciones.perfil(c) } : {}),
                }))
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

test('una candidata de continuidad ya no se descarta por falta de descripción', () => {
  const candidatas = [
    { id: 'X', name: 'Continuidad Corp', nameKey: nameKey('Continuidad Corp'), desc: '', s: 100, op: 10 }
  ];
  const priorComps = [{ name: 'Continuidad Corp' }];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, 'desarrollo de software', priorComps,
    { iaMatch: { porId: { OTRO: { coincide: true } } } });
  assert.strictEqual(r.rechazadas.length, 0, 'ya no se descarta por falta de descripción');
  assert.strictEqual(r.seleccionadas.length, 1);
  assert.strictEqual(r.seleccionadas[0].esContinuidad, true);
});

test('el cupo nTarget no limita a las candidatas de continuidad: se agregan aparte', () => {
  const candidatas = [
    { id: '1', name: 'Continuidad Uno', nameKey: nameKey('Continuidad Uno'), s: 100, op: 10 },
    { id: '2', name: 'Continuidad Dos', nameKey: nameKey('Continuidad Dos'), s: 100, op: 10 },
    { id: '3', name: 'Nueva Uno', nameKey: nameKey('Nueva Uno'), s: 100, op: 10 },
    { id: '4', name: 'Nueva Dos', nameKey: nameKey('Nueva Dos'), s: 100, op: 10 },
  ];
  const priorComps = [{ name: 'Continuidad Uno' }, { name: 'Continuidad Dos' }];
  const r = scoreCandidates(candidatas, { nTarget: 1 }, '', priorComps);
  assert.strictEqual(r.seleccionadas.length, 3, '2 de continuidad + 1 por cupo, aunque nTarget sea 1');
  const continuidad = r.seleccionadas.filter(c => c.esContinuidad);
  assert.strictEqual(continuidad.length, 2, 'las dos de continuidad entran completas');
  const otras = r.seleccionadas.filter(c => !c.esContinuidad);
  assert.strictEqual(otras.length, 1, 'solo una de las nuevas, por el cupo de 1');
  assert.strictEqual(r.reserva.length, 1, 'la otra nueva queda en reserva, no la de continuidad');
});

test('nameKey ignora el sufijo de bolsa/ticker entre paréntesis de Capital IQ', () => {
  assert.strictEqual(nameKey('Akatsuki Inc. (TSE:3932)'), nameKey('AKATSUKI INC.'));
  assert.strictEqual(nameKey('COLOPL, Inc. (TSE:3668)'), nameKey('COLOPL, INC.'));
  assert.strictEqual(nameKey('QubicGames S.A. (WSE:QUB)'), nameKey('QUBICGAMES S.A.'));
});

test('holding y saldo negativo siguen excluyendo a una candidata de continuidad', () => {
  const priorComps = [{ name: 'Holding Corp' }, { name: 'Saldo Corp' }];
  const candidatas = [
    { id: 'H', name: 'Holding Corp', nameKey: nameKey('Holding Corp'), isHolding: true },
    { id: 'S', name: 'Saldo Corp', nameKey: nameKey('Saldo Corp'), hasNegativeBalance: true },
  ];
  const r = scoreCandidates(candidatas, {}, '', priorComps);
  assert.strictEqual(r.seleccionadas.length, 0, 'ninguna debe pasar pese a ser de continuidad');
  assert.strictEqual(r.rechazadas.length, 2);
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
    assert.strictEqual(rows[1].name, 'Beta Holdings Ltd');
    assert.strictEqual(rows[1].isHolding, true, 'Holdings en plural también debe reconocerse como holding');
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

/* ══════ Rigor funcional y perfil dictaminado por la IA ══════
   El paso 2 ofrecía «Rigor Funcional» y el motor no lo leía: elegir «Estricto» daba
   el mismo resultado que «Amplio». Y el perfil se calculaba solo con las regex de
   perfilDe, que contradecían a la curación: una candidata que la IA aprobaba por
   actividad caía a factor 0,35 de perfil y salía del TOP-N por puntaje. */

test('prefiltrar aplica los filtros duros y deja pasar el resto, sin tocar el rigor', () => {
  const candidatas = [
    { id: 'H', name: 'Holding SA', isHolding: true },
    { id: 'N', name: 'Negativa SA', hasNegativeBalance: true },
    { id: 'P', name: 'Perdida SA', hasLoss: true },
    { id: 'E', name: 'Empresario SA', desc: 'publishes its own games' },
    { id: 'OK', name: 'Buena SA', desc: 'software development services' },
  ];
  const { validas, rechazadas } = prefiltrar(candidatas, { rigor: 'estricto' });
  assert.deepStrictEqual(validas.map(c => c.id), ['E', 'OK'],
    'el rigor no se evalúa aquí: depende del perfil, que lo dictamina la curación');
  assert.strictEqual(rechazadas.length, 3);
});

test('prefiltrar respeta los filtros puestos en «incluir»', () => {
  const candidatas = [{ id: 'P', name: 'Perdida SA', hasLoss: true }];
  assert.strictEqual(prefiltrar(candidatas, { perdidaOp: 'incluir' }).validas.length, 1);
  assert.strictEqual(prefiltrar(candidatas, {}).validas.length, 0, 'excluir es el criterio por defecto');
});

test('el rigor estricto deja solo prestadores de servicios', () => {
  const candidatas = [
    { id: 'S', name: 'Servicio SA', desc: 'software development services', s: 100, op: 10 },
    { id: 'M', name: 'Mixta SA', desc: 'software development services and publishes its own games', s: 100, op: 10 },
    { id: 'E', name: 'Empresario SA', desc: 'publishes its own titles and monetizes them', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 10, rigor: 'estricto' }, '', [], {});
  assert.deepStrictEqual(r.seleccionadas.map(c => c.id), ['S']);
  assert.strictEqual(r.rechazadasPorCategoria.rigor, 2, 'mixto y empresario se caen por rigor');
  assert.match(r.rechazadas.find(c => c.id === 'M').motivoRechazo, /rigor estricto/);
});

test('el rigor estándar admite servicios y mixtos, y descarta al empresario pleno', () => {
  const candidatas = [
    { id: 'S', name: 'Servicio SA', desc: 'software development services', s: 100, op: 10 },
    { id: 'M', name: 'Mixta SA', desc: 'software development services and publishes its own games', s: 100, op: 10 },
    { id: 'E', name: 'Empresario SA', desc: 'publishes its own titles and monetizes them', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 10, rigor: 'estandar' }, '', [], {});
  assert.deepStrictEqual(r.seleccionadas.map(c => c.id).sort(), ['M', 'S']);
  assert.strictEqual(r.rechazadasPorCategoria.rigor, 1);
  assert.match(r.rechazadas[0].motivoRechazo, /260-4/, 'el motivo cita la norma que sustenta el descarte');
});

test('el rigor amplio no descarta a nadie por su perfil', () => {
  const candidatas = [
    { id: 'E', name: 'Empresario SA', desc: 'publishes its own titles and monetizes them', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 10, rigor: 'amplio' }, '', [], {});
  assert.strictEqual(r.seleccionadas.length, 1);
  assert.strictEqual(r.rechazadasPorCategoria.rigor, 0);
});

test('el perfil INDEFINIDO nunca se descarta por rigor', () => {
  /* Es ausencia de información, no un perfil incompatible: así llegan las candidatas
     agregadas a mano o venidas de otra fuente. */
  const candidatas = [{ id: 'X', name: 'Sin pistas SA', desc: 'iron ore mining', s: 100, op: 10 }];
  const r = scoreCandidates(candidatas, { nTarget: 10, rigor: 'estricto' }, '', [], {});
  assert.strictEqual(r.seleccionadas[0].perfilFuncional, 'INDEFINIDO');
  assert.strictEqual(r.rechazadasPorCategoria.rigor, 0);
});

test('una comparable de continuidad no se descarta por el rigor funcional', () => {
  const candidatas = [
    { id: 'E', name: 'Empresario SA', nameKey: nameKey('Empresario SA'), desc: 'publishes its own titles', s: 100, op: 10 },
  ];
  const r = scoreCandidates(candidatas, { nTarget: 10, rigor: 'estricto' }, '', [{ name: 'Empresario SA' }], {});
  assert.strictEqual(r.seleccionadas.length, 1, 'su inclusión ya se sustentó en el estudio anterior');
  assert.strictEqual(r.rechazadasPorCategoria.rigor, 0);
});

test('el perfil dictaminado por la IA manda sobre las palabras clave', async () => {
  /* La descripción real está en un sector que perfilDe no reconoce, así que la
     heurística la dejaba en INDEFINIDO (factor 0,35) aunque la IA la hubiera
     aprobado. Ahora el dictamen de la IA fija el perfil y el factor. */
  const { restore } = mockGemini(() => true, { perfil: () => 'SERVICIO' });
  try {
    const cand = { id: 'A', name: 'Maquila SA', desc: 'contract manufacturing of auto parts for third parties', s: 1000, op: 100 };
    assert.strictEqual(perfilDe(cand.desc), 'INDEFINIDO', 'la heurística no reconoce este sector');
    const veredicto = await curateCandidatesWithGemini([cand], 'fabricación por encargo');
    assert.strictEqual(veredicto.porId.A.perfil, 'SERVICIO', 'la IA dictaminó el perfil');

    const r = scoreCandidates([cand], { nTarget: 1, rigor: 'estricto' }, 'fabricación por encargo', [], { iaMatch: veredicto });
    assert.strictEqual(r.seleccionadas.length, 1, 'con el perfil de la IA sobrevive al rigor estricto');
    assert.strictEqual(r.seleccionadas[0].perfilFuncional, 'SERVICIO');
    assert.strictEqual(r.seleccionadas[0].perfilOrigen, 'ia');
    assert.strictEqual(r.seleccionadas[0].factores.perfil, 1, 'y con el factor máximo, no con 0,35');
  } finally {
    restore();
  }
});

test('un perfil que la IA no logra decidir cae en la heurística', async () => {
  const { restore } = mockGemini(() => true, { perfil: () => 'INDEFINIDO' });
  try {
    const cand = { id: 'A', name: 'Servicios SA', desc: 'software development services', s: 1000, op: 100 };
    const veredicto = await curateCandidatesWithGemini([cand], 'desarrollo de software');
    const r = scoreCandidates([cand], { nTarget: 1 }, 'desarrollo de software', [], { iaMatch: veredicto });
    assert.strictEqual(r.seleccionadas[0].perfilFuncional, 'SERVICIO', 'lo resuelve perfilDe');
    assert.strictEqual(r.seleccionadas[0].perfilOrigen, 'heuristica');
  } finally {
    restore();
  }
});

test('un perfil inventado por la IA se ignora en lugar de provocar un descarte', async () => {
  const { restore } = mockGemini(() => true, { perfil: () => 'ALGO RARO' });
  try {
    const cand = { id: 'A', name: 'Servicios SA', desc: 'software development services', s: 1000, op: 100 };
    const veredicto = await curateCandidatesWithGemini([cand], 'desarrollo de software');
    assert.strictEqual(veredicto.porId.A.perfil, '', 'no se guarda un perfil fuera de la lista');
    const r = scoreCandidates([cand], { nTarget: 1, rigor: 'estricto' }, 'desarrollo de software', [], { iaMatch: veredicto });
    assert.strictEqual(r.seleccionadas.length, 1);
    assert.strictEqual(r.seleccionadas[0].perfilOrigen, 'heuristica');
  } finally {
    restore();
  }
});

test('el desglose por motivo cuenta cada criterio por separado', () => {
  /* La tabla 16 del informe no puede decir «descartadas por los filtros»: tiene que
     decir cuántas por holding, cuántas por pérdidas y cuántas por actividad. */
  const candidatas = [
    { id: 'H1', name: 'Holding Uno', isHolding: true },
    { id: 'H2', name: 'Holding Dos', isHolding: true },
    { id: 'N1', name: 'Negativa', hasNegativeBalance: true },
    { id: 'P1', name: 'Perdida', hasLoss: true, op: -5 },
    { id: 'E1', name: 'Empresario', desc: 'publishes its own titles', s: 100, op: 10 },
    { id: 'R1', name: 'Otra actividad', desc: 'iron ore mining', s: 100, op: 10 },
    { id: 'S1', name: 'Sin desc', desc: '', s: 100, op: 10 },
    { id: 'OK', name: 'Buena', desc: 'software development services', s: 100, op: 10 },
  ];
  const veredicto = { porId: { R1: { coincide: false }, OK: { coincide: true }, E1: { coincide: true } } };
  const r = scoreCandidates(candidatas, { nTarget: 10, rigor: 'estandar' }, 'desarrollo de software', [], { iaMatch: veredicto });

  assert.deepStrictEqual(r.rechazadasPorMotivo, {
    holding: 2,
    saldoNegativo: 1,
    perdidaOperativa: 1,
    sinDescripcion: 1,
    actividadDistinta: 1,
    rigorFuncional: 1,
  });
});

test('el desglose por motivo suma lo mismo que las categorías', () => {
  const candidatas = [
    { id: 'H', name: 'Holding', isHolding: true },
    { id: 'R', name: 'Otra', desc: 'iron ore mining', s: 100, op: 10 },
    { id: 'E', name: 'Empresario', desc: 'publishes its own titles', s: 100, op: 10 },
    { id: 'OK', name: 'Buena', desc: 'software development services', s: 100, op: 10 },
  ];
  const veredicto = { porId: { R: { coincide: false }, OK: { coincide: true }, E: { coincide: true } } };
  const r = scoreCandidates(candidatas, { nTarget: 10, rigor: 'estandar' }, 'desarrollo de software', [], { iaMatch: veredicto });

  const porMotivo = Object.values(r.rechazadasPorMotivo).reduce((a, b) => a + b, 0);
  const porCategoria = Object.values(r.rechazadasPorCategoria).reduce((a, b) => a + b, 0);
  assert.strictEqual(porMotivo, porCategoria, 'los dos desgloses cuentan los mismos descartes');
  assert.strictEqual(porMotivo, r.rechazadas.length);
});

test('las categorías de rechazo cubren cada descarte una sola vez', () => {
  /* El embudo deducía «rechazadas por la IA» con una expresión regular sobre el
     motivo y las «descartadas por los filtros» por resta, así que un descarte podía
     caer en las dos casillas. Ahora las tres categorías más las válidas suman el
     universo evaluado. */
  const candidatas = [
    { id: 'H', name: 'Holding SA', isHolding: true, desc: 'software development services' },
    { id: 'E', name: 'Empresario SA', desc: 'publishes its own titles', s: 100, op: 10 },
    { id: 'R', name: 'Rechazada IA', desc: 'iron ore mining', s: 100, op: 10 },
    { id: 'OK', name: 'Buena SA', desc: 'software development services', s: 100, op: 10 },
  ];
  const veredicto = { porId: { R: { coincide: false, motivo: 'otra actividad' }, OK: { coincide: true }, E: { coincide: true } } };
  const r = scoreCandidates(candidatas, { nTarget: 10, rigor: 'estandar' }, 'desarrollo de software', [], { iaMatch: veredicto });
  const cat = r.rechazadasPorCategoria;
  assert.deepStrictEqual(cat, { filtro: 1, ia: 1, rigor: 1 });
  assert.strictEqual(cat.filtro + cat.ia + cat.rigor + r.totalValidas, r.evaluadas,
    'nada se cuenta dos veces ni se pierde');
});

/* ══════ Reutilización del veredicto: la curación corre en el paso 3 ══════ */

test('la curación reutiliza el veredicto previo si la actividad no cambió', async () => {
  const { restore, llamadas } = mockGemini(() => true);
  try {
    const candidatas = [
      { id: 'A', name: 'A SA', desc: 'software development services' },
      { id: 'B', name: 'B SA', desc: 'software development services' },
    ];
    const primero = await curateCandidatesWithGemini(candidatas, 'desarrollo de software');
    assert.strictEqual(llamadas.length, 1);

    /* misma actividad y una candidata nueva: solo se consulta la que falta */
    const conNueva = [...candidatas, { id: 'C', name: 'C SA', desc: 'software development services' }];
    const segundo = await curateCandidatesWithGemini(conNueva, 'desarrollo de software', { veredictoPrevio: primero });
    assert.strictEqual(llamadas.length, 2, 'una sola consulta más');
    const enviado = llamadas[1].contents[0].parts[0].text;
    assert.ok(enviado.includes('"C"') && !enviado.includes('"A"'), 'y solo lleva la candidata sin veredicto');
    assert.strictEqual(segundo.reutilizadas, 2);
    assert.strictEqual(segundo.total, 3);
    assert.strictEqual(segundo.coinciden, 3, 'el conteo suma reutilizadas y nuevas');
  } finally {
    restore();
  }
});

test('sin candidatas nuevas la curación no gasta ninguna consulta', async () => {
  const { restore, llamadas } = mockGemini(() => true);
  try {
    const candidatas = [{ id: 'A', name: 'A SA', desc: 'software development services' }];
    const primero = await curateCandidatesWithGemini(candidatas, 'desarrollo de software');
    const segundo = await curateCandidatesWithGemini(candidatas, 'desarrollo de software', { veredictoPrevio: primero });
    assert.strictEqual(llamadas.length, 1, 'reejecutar el paso 3 tras cambiar un filtro no vuelve a pagar');
    assert.strictEqual(segundo.reutilizadas, 1);
    assert.strictEqual(segundo.coinciden, 1);
  } finally {
    restore();
  }
});

test('si la actividad cambió, el veredicto previo se descarta y se cura de nuevo', async () => {
  const { restore, llamadas } = mockGemini(() => true);
  try {
    const candidatas = [{ id: 'A', name: 'A SA', desc: 'software development services' }];
    const primero = await curateCandidatesWithGemini(candidatas, 'desarrollo de software');
    const segundo = await curateCandidatesWithGemini(candidatas, 'minería de carbón', { veredictoPrevio: primero });
    assert.strictEqual(llamadas.length, 2, 'el veredicto anterior se evaluó contra otra actividad');
    assert.strictEqual(segundo.reutilizadas, 0);
    assert.strictEqual(segundo.actividadUsada, 'minería de carbón');
  } finally {
    restore();
  }
});

test('el veredicto reutilizado no arrastra candidatas que ya no están en el universo', async () => {
  const { restore } = mockGemini(() => true);
  try {
    const primero = await curateCandidatesWithGemini(
      [{ id: 'A', name: 'A SA', desc: 'software development services' },
       { id: 'VIEJA', name: 'Vieja SA', desc: 'software development services' }],
      'desarrollo de software'
    );
    const segundo = await curateCandidatesWithGemini(
      [{ id: 'A', name: 'A SA', desc: 'software development services' }],
      'desarrollo de software', { veredictoPrevio: primero }
    );
    assert.deepStrictEqual(Object.keys(segundo.porId), ['A'],
      'el estudio no debe guardar dictámenes de candidatas fuera del universo actual');
  } finally {
    restore();
  }
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
