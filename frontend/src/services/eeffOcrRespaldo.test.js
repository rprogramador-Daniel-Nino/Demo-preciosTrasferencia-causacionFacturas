/* Pruebas del respaldo por OCR.

   Todo con I/O inyectado: no hay red, no hay canvas y no hay PDF real. Lo que se fija es el
   contrato de degradación —cualquier fallo devuelve la lectura que ya había, nunca la pierde—,
   que el caso normal (documento con capa de texto completa) no gasta nada, y el troceado en
   lotes, que existe porque el proxy de Gemini corta a los 50 s y el cuerpo tope en 32 MiB: una
   sola llamada con 25 páginas escaneadas habría fallado siempre. */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  respaldarLecturaConOcr, promptOcrRespaldo, pedirTranscripcionOcr, enLotes,
  MAX_PAGINAS_OCR_RESPALDO, PAGINAS_POR_LOTE,
} from './eeffOcrRespaldo.js';

const ARCHIVO = { name: 'EEFF.pdf', type: 'application/pdf' };
const LECTURA = { textoPdf: '', t_s: 1000, t_c: 700, rotulos: {} };

/* Un arnés que registra cada lote: es lo que permite afirmar «no gastó nada» en vez de solo
   «devolvió lo mismo», que se cumpliría también si hubiera gastado las llamadas en vano. */
function arnes({ paginas = [], texto = null, lectura = LECTURA, falla = null } = {}) {
  const llamadas = { rasterizados: [], ocr: [], avances: [] };
  return {
    llamadas,
    opciones: {
      file: ARCHIVO,
      lectura,
      paginasSinTexto: async () => paginas,
      alAvanzar: (info) => llamadas.avances.push(info),
      rasterizar: async (_f, nums) => {
        llamadas.rasterizados.push([...nums]);
        return nums.map((n) => `data:image/jpeg;base64,pag${n}`);
      },
      pedirOcr: async (imgs, nums) => {
        llamadas.ocr.push([...nums]);
        if (falla && falla(nums)) throw new Error('lote perdido');
        return texto ? texto(nums) : nums.map((n) => `--- Página ${n} ---\n1.23${n}`).join('\n');
      },
    },
  };
}

const rango = (desde, hasta) => Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);

test('un documento con capa de texto completa no gasta nada', async () => {
  /* La inmensa mayoría de las ingestas caen aquí, y una llamada de más por cada una sería un
     costo permanente a cambio de nada. */
  const a = arnes({ paginas: [] });
  const r = await respaldarLecturaConOcr(a.opciones);
  assert.strictEqual(r.lectura, LECTURA, 'devuelve la misma lectura, por identidad');
  assert.strictEqual(r.respaldoOcr, null);
  assert.deepEqual(a.llamadas.rasterizados, []);
  assert.deepEqual(a.llamadas.ocr, []);
});

test('un documento mixto transcribe solo las páginas sin texto', async () => {
  /* Aluminios y Vidrios: 5 de 50 escaneadas, las últimas. Rasterizar las 50 gastaría CPU en
     las 45 que ya se pueden leer y mandaría al modelo un documento del que se salta páginas. */
  const a = arnes({
    paginas: [46, 47, 48, 49, 50],
    lectura: { ...LECTURA, textoPdf: '--- Página 1 ---\nACTIVO | 100' },
  });
  const r = await respaldarLecturaConOcr(a.opciones);
  assert.deepEqual(a.llamadas.rasterizados.flat(), [46, 47, 48, 49, 50], 'se rasterizan esas');
  assert.deepEqual(a.llamadas.ocr.flat(), [46, 47, 48, 49, 50], 'y el OCR recibe sus números');
  assert.match(r.lectura.textoPdf, /ACTIVO \| 100/, 'la capa nativa se conserva');
  assert.match(r.lectura.textoPdf, /Página 46/, 'y se le suma la transcripción');
  assert.strictEqual(r.lectura.t_s, 1000, 'el resto de la lectura queda intacto');
  assert.strictEqual(r.respaldoOcr.paginasTranscritas, 5);
  assert.strictEqual(r.respaldoOcr.paginasOmitidas, 0);
});

test('las páginas van en lotes cortos, no en una sola llamada', async () => {
  /* El defecto que esto cierra: el proxy de Gemini corta a los 50 s y el cuerpo tope en 32 MiB.
     Doce páginas escaneadas en una petición exceden las dos cosas. */
  const a = arnes({ paginas: rango(1, 12) });
  const r = await respaldarLecturaConOcr(a.opciones);
  assert.strictEqual(a.llamadas.ocr.length, 3, '12 páginas en lotes de 4 son tres llamadas');
  a.llamadas.ocr.forEach((lote) => {
    assert.ok(lote.length <= PAGINAS_POR_LOTE, `ningún lote pasa de ${PAGINAS_POR_LOTE}`);
  });
  assert.deepEqual(a.llamadas.ocr.flat(), rango(1, 12), 'y entre todos cubren todas, en orden');
  assert.strictEqual(r.respaldoOcr.lotes, 3);
});

test('un lote perdido no cancela los demás', async () => {
  /* Media transcripción verifica la mitad de las cifras, y eso es más que nada: cancelar todo
     por un 504 en el segundo lote devolvería el documento a «sin verificación». */
  const a = arnes({ paginas: rango(1, 12), falla: (nums) => nums.includes(5) });
  const r = await respaldarLecturaConOcr(a.opciones);
  assert.strictEqual(a.llamadas.ocr.length, 3, 'se intentan los tres');
  assert.match(r.lectura.textoPdf, /Página 1 ---/, 'lo del primer lote entra');
  assert.match(r.lectura.textoPdf, /Página 9 ---/, 'y lo del tercero también');
  assert.doesNotMatch(r.lectura.textoPdf, /Página 5 ---/, 'lo del lote perdido no');
  assert.deepEqual(r.respaldoOcr.paginas, [...rango(1, 4), ...rango(9, 12)],
    'y se registra exactamente lo que sí se transcribió');
  assert.strictEqual(r.respaldoOcr.paginasTranscritas, 8);
});

test('si TODOS los lotes fallan, la lectura queda intacta', async () => {
  const a = arnes({ paginas: rango(1, 8), falla: () => true });
  const r = await respaldarLecturaConOcr(a.opciones);
  assert.strictEqual(r.lectura, LECTURA, 'la ingesta no se queda sin cifras por un refuerzo');
  assert.strictEqual(r.respaldoOcr, null);
});

test('un documento escaneado por completo se acota a las primeras páginas y lo dice', async () => {
  /* Robertet: 25 de 25 sin capa de texto. El tope no es técnico sino de fricción —cada lote es
     una llamada de segundos y el analista espera—, y cuesta poco porque el balance y el estado
     de resultados van al principio del documento; lo que queda fuera son notas. */
  const a = arnes({ paginas: rango(1, 25) });
  const r = await respaldarLecturaConOcr(a.opciones);
  assert.strictEqual(r.respaldoOcr.paginasTranscritas, MAX_PAGINAS_OCR_RESPALDO);
  assert.strictEqual(r.respaldoOcr.paginasOmitidas, 25 - MAX_PAGINAS_OCR_RESPALDO,
    'y se nombra lo que quedó sin transcribir, en vez de insinuar que se cubrió todo');
  assert.deepEqual(a.llamadas.ocr.flat(), rango(1, MAX_PAGINAS_OCR_RESPALDO),
    'las primeras, en orden de documento: ahí están los dos estados');
});

test('las páginas salteadas conservan su número real', async () => {
  /* Inoxpa salta de la 19 a la 23. Si el modelo tuviera que deducir el número contando
     imágenes, un solo desliz desplazaría todos los encabezados. */
  const a = arnes({ paginas: [3, 4, 18, 19, 23, 24] });
  await respaldarLecturaConOcr(a.opciones);
  assert.deepEqual(a.llamadas.ocr, [[3, 4, 18, 19], [23, 24]]);
});

test('el avance se reporta lote por lote', async () => {
  /* Sin esto la pantalla queda muda un minuto y el analista no sabe si se colgó. */
  const a = arnes({ paginas: rango(1, 12) });
  await respaldarLecturaConOcr(a.opciones);
  assert.strictEqual(a.llamadas.avances.length, 3);
  assert.deepEqual(a.llamadas.avances[0], { lote: 1, lotes: 3, paginas: [1, 2, 3, 4] });
  assert.deepEqual(a.llamadas.avances[2].lote, 3);
});

test('si el rasterizado no devuelve nada, no se llama al modelo', async () => {
  const a = arnes({ paginas: [1, 2] });
  a.opciones.rasterizar = async () => [];
  const r = await respaldarLecturaConOcr(a.opciones);
  assert.strictEqual(r.lectura, LECTURA);
  assert.deepEqual(a.llamadas.ocr, []);
});

test('una transcripción vacía o en blanco no se funde', async () => {
  /* Fundir una cadena en blanco no aportaría nada y dejaría `respaldoOcr` afirmando que hubo
     transcripción, que es peor que no haberla intentado. */
  for (const vacio of ['', '   \n  ']) {
    const a = arnes({ paginas: [1], texto: () => vacio });
    const r = await respaldarLecturaConOcr(a.opciones);
    assert.strictEqual(r.lectura, LECTURA);
    assert.strictEqual(r.respaldoOcr, null);
  }
});

test('si no se puede saber qué páginas faltan, no se intenta nada', async () => {
  const a = arnes({ paginas: [1] });
  a.opciones.paginasSinTexto = async () => { throw new Error('PDF ilegible'); };
  const r = await respaldarLecturaConOcr(a.opciones);
  assert.strictEqual(r.lectura, LECTURA);
  assert.deepEqual(a.llamadas.ocr, []);
});

test('sin archivo o sin lectura no hace nada', async () => {
  const a = arnes({ paginas: [1] });
  assert.strictEqual((await respaldarLecturaConOcr({ ...a.opciones, file: null })).respaldoOcr, null);
  assert.strictEqual((await respaldarLecturaConOcr({ ...a.opciones, lectura: null })).lectura, null);
  assert.deepEqual(a.llamadas.ocr, []);
});

test('con el tope en cero el respaldo no corre', async () => {
  const a = arnes({ paginas: rango(1, 5) });
  const r = await respaldarLecturaConOcr({ ...a.opciones, maxPaginas: 0 });
  assert.strictEqual(r.respaldoOcr, null);
  assert.deepEqual(a.llamadas.ocr, []);
});

/* ══════════════ El troceado ══════════════ */

test('enLotes conserva el orden y no pierde elementos', () => {
  assert.deepEqual(enLotes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(enLotes([1, 2, 3], 5), [[1, 2, 3]], 'menos elementos que el tamaño: un lote');
  assert.deepEqual(enLotes([], 4), []);
});

test('enLotes no se cuelga con un tamaño inválido', () => {
  /* Un `porLote` de 0 haría `i += 0`: bucle infinito con el navegador congelado. */
  assert.deepEqual(enLotes([1, 2], 0), [[1], [2]]);
  assert.deepEqual(enLotes([1, 2], -3), [[1], [2]]);
});

/* ══════════════ El prompt ══════════════ */

test('el prompt pide transcribir y prohíbe interpretar', () => {
  /* Es lo que mantiene esto como verificación: si el prompt clasificara rubros, sería una
     segunda opinión del mismo modelo sobre los mismos campos, y dos lecturas que se equivocan
     igual se confirmarían entre sí. */
  const p = promptOcrRespaldo([3, 4]);
  assert.match(p, /transcrib/i);
  assert.match(p, /sin interpretar/i);
  assert.match(p, /sin clasificar/i);
  assert.match(p, /NO conviertas unidades/);
  assert.match(p, /NO redondees/);
});

test('el prompt exige marcar lo ilegible en vez de adivinar', () => {
  const p = promptOcrRespaldo([1]);
  assert.match(p, /\[ilegible\]/);
  assert.match(p, /Nunca adivines/i);
});

test('el prompt nombra las páginas del lote y fija el encabezado que se va a buscar', () => {
  const p = promptOcrRespaldo([7, 8, 9]);
  assert.match(p, /páginas 7, 8, 9/);
  assert.match(p, /--- Página <N> ---/);
});

test('el prompt conserva la forma de las cifras, que es lo que la verificación coteja', () => {
  /* `cifrasDelTexto` interpreta las dos convenciones de separadores, pero no puede recuperar
     un número que el transcriptor ya normalizó a su manera. */
  const p = promptOcrRespaldo([1]);
  assert.match(p, /separadores de miles/i);
  assert.match(p, /par[eé]ntesis/i);
});

/* ══════════════ El armado de la petición ══════════════ */

test('cada imagen va precedida por su número de página real', async () => {
  let enviado = null;
  await pedirTranscripcionOcr(
    ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB'],
    [12, 27],
    { post: async (payload) => { enviado = payload; return { data: { candidates: [] } }; } },
  );
  const parts = enviado.contents[0].parts;
  assert.match(parts[0].text, /transcriptor/i, 'el prompt va primero');
  assert.match(parts[1].text, /Página 12 del documento/);
  assert.strictEqual(parts[2].inline_data.data, 'AAA', 'sin el prefijo del dataURL');
  assert.strictEqual(parts[2].inline_data.mime_type, 'image/jpeg');
  assert.match(parts[3].text, /Página 27 del documento/);
  assert.strictEqual(parts[4].inline_data.data, 'BBB');
});

test('el tipo de la imagen se lee del dataURL y no se fija a mano', async () => {
  /* `rasterizarPaginas` emite JPEG para este camino y PNG para el ANEXO A: declarar el tipo
     equivocado haría que el modelo rechazara la imagen. */
  let enviado = null;
  await pedirTranscripcionOcr(
    ['data:image/png;base64,ZZZ'], [1],
    { post: async (payload) => { enviado = payload; return { data: { candidates: [] } }; } },
  );
  assert.strictEqual(enviado.contents[0].parts[2].inline_data.mime_type, 'image/png');
});

test('la respuesta se une de todas las partes que devuelva el modelo', async () => {
  const texto = await pedirTranscripcionOcr(['data:image/jpeg;base64,A'], [1], {
    post: async () => ({
      data: { candidates: [{ content: { parts: [{ text: '--- Página 1 ---\n' }, { text: '1.234' }] } }] },
    }),
  });
  assert.strictEqual(texto, '--- Página 1 ---\n1.234');
});

test('una respuesta sin candidatos devuelve cadena vacía en vez de estallar', async () => {
  const texto = await pedirTranscripcionOcr(['data:image/jpeg;base64,A'], [1], {
    post: async () => ({ data: {} }),
  });
  assert.strictEqual(texto, '');
});

test('sin imágenes no se llama al modelo', async () => {
  let llamado = false;
  const texto = await pedirTranscripcionOcr([], [], { post: async () => { llamado = true; } });
  assert.strictEqual(texto, '');
  assert.strictEqual(llamado, false);
});
