import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actualizarProsaMuestra, actualizarProsaOperaciones, actualizarProsaMargenes,
  actualizarProsaTablas,
} from './prosaTablasInforme.js';
import { PARRAFO_OOXML } from './prosaVecindad.js';
import { filasMuestraComparables, filasRazonesRechazo } from './tablasInforme.js';

/* Un estudio con muestra y con embudo, para que los conteos existan de verdad. Como en el resto
   de las pruebas del informe, las cifras no se escriben a mano: se le preguntan al motor, así
   que la prueba sigue valiendo si el cálculo cambia. */
const estudio = {
  pli: 'MO', useadj: true, cmode: 'nac', prime: 7.37, ent: 'END GAME', anio: 2025,
  monto_operacion: 5230114900,
  vinc_tipo: 'Otros servicios (07)',
  t_s: 1000, t_c: 600, t_op: 200, t_ar: 100, t_inv: 50, t_ap: 80, t_ppe: 300,
  comparables: [
    { name: 'A', amb: 'Nac', s: 500, c: 300, op: 120, ar: 50, inv: 20, ap: 40, ppe: 100 },
    { name: 'B', amb: 'Nac', s: 800, c: 500, op: 180, ar: 70, inv: 30, ap: 50, ppe: 120 },
    { name: 'C', amb: 'Nac', s: 600, c: 350, op: 150, ar: 60, inv: 25, ap: 45, ppe: 110 },
  ],
  embudoSeleccion: {
    evaluadas: 500, seleccionadas: 3, reserva: 0,
    porMotivo: { actividad: 300, tamano: 100, perdidas: 97 },
  },
};

const UNIVERSO = String(filasRazonesRechazo(estudio.embudoSeleccion).total);
const ACEPTADAS = String(filasMuestraComparables(estudio).length);
const MONTO = '5.230.114.900';

const plano = (s) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/* ══════════════════ muestra y razones de rechazo ══════════════════ */

test('el universo de comparables potenciales es el del estudio', () => {
  /* Literal del informe de referencia. El conteo se radicaba con el del cliente anterior
     mientras la tabla de razones de rechazo de al lado ya traía el del estudio. */
  const html = '<p>A partir del anterior criterio de búsqueda se identificó un total de 442 '
    + 'Compañías comparables potenciales.</p>';
  const salida = plano(actualizarProsaMuestra(html, estudio, []));
  assert.ok(salida.includes('un total de ' + UNIVERSO + ' Compañías comparables potenciales'),
    'el universo no entró: ' + salida);
  assert.ok(!salida.includes('442'), 'sobrevive el conteo de la plantilla');
});

test('las comparables que quedaron son las de la muestra final', () => {
  /* El conteo va resaltado en la plantilla, así que entre «quedaron» y la cifra hay una
     etiqueta. Es el mismo motivo por el que el anclaje tolera etiquetas en el rango. */
  const html = '<p>De esta manera, después de aplicar dichos criterios, quedaron '
    + '<strong>13</strong> compañías comparables.</p>';
  const salida = actualizarProsaMuestra(html, estudio, []);
  assert.ok(plano(salida).includes('quedaron ' + ACEPTADAS + ' compañías comparables'),
    'el conteo no entró: ' + plano(salida));
  assert.ok(salida.includes('<strong>'), 'se perdió el resaltado de la plantilla');
});

test('la muestra final dice cuántas compañías la conforman', () => {
  const html = '<p>La muestra final de comparables a End Game Colombia SAS, quedó conformada por '
    + '<strong>13</strong> compañías, los cuales se señalan a continuación:</p>';
  const salida = plano(actualizarProsaMuestra(html, estudio, []));
  assert.ok(salida.includes('conformada por ' + ACEPTADAS + ' compañías'),
    'el conteo no entró: ' + salida);
});

test('un «total de» que no cuenta comparables potenciales no se toca', () => {
  /* El informe dice «total de» en cada tabla de estados financieros. Lo que distingue al bueno
     es lo que va DETRÁS de la cifra, y por eso el ancla lo exige sin capturarlo. */
  const html = '<p>El total de 442 millones corresponde a los activos corrientes registrados '
    + 'en el estado de situación financiera del contribuyente.</p>';
  assert.equal(actualizarProsaMuestra(html, estudio, []), html);
});

test('sin embudo no se inventa un universo', () => {
  const html = '<p>A partir del anterior criterio de búsqueda se identificó un total de 442 '
    + 'Compañías comparables potenciales.</p>';
  const avisos = [];
  const salida = actualizarProsaMuestra(html, { ...estudio, embudoSeleccion: null }, avisos);
  assert.ok(salida.includes('442'), 'se tocó el universo sin tener embudo');
  assert.ok(avisos.some((a) => /no está donde se esperaba/.test(a)),
    'no avisó: ' + JSON.stringify(avisos));
});

test('la misma función atiende el .docx', () => {
  const ooxml = '<w:p><w:r><w:t xml:space="preserve">De esta manera, quedaron </w:t></w:r>'
    + '<w:r><w:t>13</w:t></w:r>'
    + '<w:r><w:t> compañías comparables.</w:t></w:r></w:p>';
  const salida = actualizarProsaMuestra(ooxml, estudio, [], { rxParrafo: PARRAFO_OOXML });
  assert.ok(plano(salida).includes('quedaron ' + ACEPTADAS + ' compañías comparables'),
    'el conteo no entró: ' + plano(salida));
  assert.equal((salida.match(/<w:r>/g) || []).length, (ooxml.match(/<w:r>/g) || []).length,
    'cambió el número de runs');
});

/* ══════════════════ operaciones con el vinculado ══════════════════ */

test('el monto de la operación es el del estudio, y el año con él', () => {
  /* Literal del informe de referencia, con el año y el monto en la misma frase. */
  const html = '<p>En el año 2024, END GAME INTERACTIVE COLOMBIA S.A.S, tuvo operaciones de '
    + 'ingreso con sus vinculados económicos por Otros servicios (07), por un valor total de '
    + '$ 3.435.357.400</p>';
  const salida = plano(actualizarProsaOperaciones(html, estudio, []));
  assert.ok(salida.includes('por un valor total de $ ' + MONTO), 'el monto no entró: ' + salida);
  assert.ok(salida.includes('En el año 2025'), 'el año no entró: ' + salida);
  assert.ok(!salida.includes('3.435.357.400'), 'sobrevive el monto de la plantilla');
});

test('el año del ejercicio fiscal también se actualiza', () => {
  const html = '<p>La transacción efectuada por la compañía con su empresa vinculada residentes '
    + 'en el exterior durante el ejercicio fiscal finalizado el 31 de diciembre de 2024. fue el '
    + 'Ingreso por Otros servicios (07), por un valor de $ 3.435.357.400, detalladas a '
    + 'continuación:</p>';
  const salida = plano(actualizarProsaOperaciones(html, estudio, []));
  assert.ok(salida.includes('31 de diciembre de 2025'), 'el año no entró: ' + salida);
  assert.ok(salida.includes('por un valor de $ ' + MONTO), 'el monto no entró: ' + salida);
});

test('«en el año» no se toca en un párrafo donde no se colocó el monto', () => {
  /* «en el año 20XX» sale por todo el informe. Lo que hace seguro sustituirlo aquí no es la
     frase: es haber acertado el monto en ese mismo párrafo. */
  const html = '<p>Las operaciones de ingreso se rigen por las directrices publicadas en el año '
    + '2019 por la OCDE, que no fijan un valor de referencia.</p>';
  const salida = plano(actualizarProsaOperaciones(html, estudio, []));
  assert.ok(salida.includes('en el año 2019'), 'se tocó un año ajeno: ' + salida);
});

test('sin monto en el estudio no se escribe nada', () => {
  const html = '<p>Tuvo operaciones de ingreso con sus vinculados económicos por un valor total '
    + 'de $ 3.435.357.400 durante el ejercicio.</p>';
  const salida = actualizarProsaOperaciones(html, { ...estudio, monto_operacion: null }, []);
  assert.ok(salida.includes('3.435.357.400'), 'se tocó el monto sin tenerlo');
});

/* ══════════════════ márgenes de las comparables ══════════════════ */

test('el año de los estados financieros de las comparables es el del estudio', () => {
  const html = '<p>El siguiente cuadro presenta las utilidades operacionales sobre ventas para '
    + 'el conjunto de compañías comparables para los estados financieros correspondientes al '
    + 'año 2024:</p>';
  const salida = plano(actualizarProsaMargenes(html, estudio, []));
  assert.ok(salida.includes('correspondientes al año 2025'), 'el año no entró: ' + salida);
});

test('si la frase de márgenes nombra otro indicador se avisa, pero no se reescribe', () => {
  /* Cambiar «Margen Bruto» por «Margen Operacional» es reescribir la redacción, no corregir una
     cifra: el matiz que el cliente haya pactado con su asesor se perdería sin avisar. */
  const avisos = [];
  const html = '<p>El siguiente cuadro presenta las utilidades operacionales sobre ventas para '
    + 'el conjunto de compañías comparables, calculadas con el Margen Bruto.</p>';
  const salida = actualizarProsaMargenes(html, estudio, avisos);
  assert.ok(salida.includes('Margen Bruto'), 'se reescribió el nombre del indicador');
  assert.ok(avisos.some((a) => /la redacción hay que ajustarla a mano/.test(a)),
    'no avisó del indicador: ' + JSON.stringify(avisos));
});

test('si la frase nombra el indicador del estudio no se avisa', () => {
  const avisos = [];
  const html = '<p>El siguiente cuadro presenta las utilidades operacionales sobre ventas para '
    + 'el conjunto de compañías comparables, calculadas con el Margen Operacional.</p>';
  actualizarProsaMargenes(html, estudio, avisos);
  assert.deepEqual(avisos, [], 'avisó de un indicador que sí es el del estudio');
});

/* ══════════════════ las tres juntas ══════════════════ */

test('las tres familias corren sobre el mismo documento sin pisarse', () => {
  const html = '<p>En el año 2024, END GAME tuvo operaciones de ingreso con sus vinculados '
    + 'económicos por un valor total de $ 3.435.357.400</p>'
    + '<p>A partir del anterior criterio de búsqueda se identificó un total de 442 Compañías '
    + 'comparables potenciales.</p>'
    + '<p>De esta manera, quedaron 13 compañías comparables.</p>'
    + '<p>El siguiente cuadro presenta las utilidades operacionales sobre ventas para el '
    + 'conjunto de compañías comparables para los estados financieros correspondientes al '
    + 'año 2024:</p>';
  const salida = plano(actualizarProsaTablas(html, estudio, []));

  assert.ok(salida.includes('valor total de $ ' + MONTO), 'el monto no entró');
  assert.ok(salida.includes('En el año 2025'), 'el año de la operación no entró');
  assert.ok(salida.includes('total de ' + UNIVERSO + ' Compañías'), 'el universo no entró');
  assert.ok(salida.includes('quedaron ' + ACEPTADAS + ' compañías'), 'las aceptadas no entraron');
  assert.ok(salida.includes('correspondientes al año 2025'), 'el año de márgenes no entró');
});

test('aplicarlo dos veces da el mismo resultado', () => {
  /* La vista previa se re-renderiza a cada cambio del estudio, así que corre muchas veces sobre
     su propia salida. */
  const html = '<p>En el año 2024, END GAME tuvo operaciones de ingreso con sus vinculados '
    + 'económicos por un valor total de $ 3.435.357.400</p>'
    + '<p>De esta manera, quedaron 13 compañías comparables.</p>';
  const una = actualizarProsaTablas(html, estudio, []);
  assert.equal(actualizarProsaTablas(una, estudio, []), una);
});

test('un documento sin ninguna de las tres frases se devuelve intacto', () => {
  const html = '<p>Un párrafo cualquiera del informe que no cita ninguna tabla.</p>';
  assert.equal(actualizarProsaTablas(html, estudio, []), html);
});

/* ══════════════════ la muestra, con el sustantivo que cada plantilla use ══════════════════ */

/* Cada plantilla llama de una forma a lo que cuenta. Estas son las que se han visto; la lista
   está para que la siguiente no obligue a tocar el ancla, y para que si alguna deja de
   reconocerse se sepa cuál. */
const REDACCIONES_MUESTRA = [
  ['«conformada por N comparables», sin el sustantivo delante',
    'La muestra final de compañías comparables a la Compañía en su operación de — (31) quedó '
    + 'conformada por 8 comparables, los cuales se señalan a continuación:'],
  ['«conformada por N compañías»',
    'La muestra final de comparables a End Game Colombia SAS, quedó conformada por 13 compañías, '
    + 'los cuales se señalan a continuación:'],
  ['«quedaron N compañías comparables»',
    'De esta manera, después de aplicar dichos criterios, quedaron 13 compañías comparables.'],
  ['«quedaron N comparables»',
    'De esta manera, después de aplicar dichos criterios, quedaron 13 comparables.'],
  ['«conformado por N empresas comparables»',
    'El conjunto quedó conformado por 13 empresas comparables, las cuales se señalan enseguida.'],
];

for (const [nombre, frase] of REDACCIONES_MUESTRA) {
  test('el conteo de la muestra se actualiza con ' + nombre, () => {
    const salida = plano(actualizarProsaMuestra('<p>' + frase + '</p>', estudio, []));
    assert.ok(new RegExp('(?:por|quedaron)\\s+' + ACEPTADAS + '\\b').test(salida),
      'el conteo no entró: ' + salida);
    for (const vieja of ['8 comparables', '13 compañías', '13 comparables', '13 empresas']) {
      assert.ok(!salida.includes(vieja), 'sobrevive el conteo de la plantilla: ' + vieja);
    }
  });
}

test('el conteo de la muestra es el número de filas que la tabla lista', () => {
  /* Es el defecto que se reportó: la tabla listaba doce comparables y la frase de encima decía
     ocho. El conteo tiene que ser el que el lector puede contar en la tabla que tiene delante. */
  const doce = {
    ...estudio,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      name: 'Comparable ' + (i + 1), amb: 'Int', s: 500 + i * 10, c: 300, op: 120,
      ar: 50, inv: 20, ap: 40, ppe: 100,
    })),
  };
  const html = '<p>La muestra final de compañías comparables a la Compañía quedó conformada por '
    + '8 comparables, los cuales se señalan a continuación:</p>';
  const salida = plano(actualizarProsaMuestra(html, doce, []));

  assert.equal(String(filasMuestraComparables(doce).length), '12', 'la fixture no lista doce');
  assert.ok(salida.includes('conformada por 12 comparables'), 'el conteo no es el de la tabla: '
    + salida);
});

test('un «total de N millones» de los estados financieros no es un conteo de comparables', () => {
  /* Admitir palabras de relleno entre la cifra y lo que se cuenta abre la puerta a «un total de
     442 millones de compañías», que es una frase de estados financieros. Las unidades de
     magnitud quedan fuera por eso. */
  const html = '<p>El total de 442 millones de compañías del sector corresponde al agregado '
    + 'publicado por la fuente consultada.</p>';
  assert.equal(actualizarProsaMuestra(html, estudio, []), html);
});

/* Lo que distingue el universo de la muestra final no es la cifra ni la palabra que la sigue
   —las dos frases cuentan «compañías comparables»—, sino el verbo: si las están buscando o si
   ya las eligieron. */
const REDACCIONES_UNIVERSO = [
  ['«un total de N»',
    'A partir del criterio de búsqueda se identificó un total de 442 Compañías comparables '
    + 'potenciales.'],
  ['«se identificaron N»',
    'Con los criterios descritos se identificaron 442 compañías comparables en la base.'],
  ['«un universo de N»',
    'La búsqueda arrojó un universo de 442 empresas comparables sobre el que se aplicaron los '
    + 'filtros.'],
];

for (const [nombre, frase] of REDACCIONES_UNIVERSO) {
  test('el universo se actualiza con ' + nombre, () => {
    const salida = plano(actualizarProsaMuestra('<p>' + frase + '</p>', estudio, []));
    assert.ok(salida.includes(UNIVERSO), 'el universo no entró: ' + salida);
    assert.ok(!salida.includes('442'), 'sobrevive el conteo de la plantilla: ' + salida);
  });
}

const REDACCIONES_ACEPTADAS = [
  ['«quedó integrada por N»',
    'La muestra final quedó integrada por 8 comparables, que se señalan a continuación:'],
  ['«se seleccionaron N»',
    'Aplicados los criterios se seleccionaron 8 compañías comparables para el análisis.'],
  ['«quedó compuesta por N»',
    'La muestra quedó compuesta por 8 empresas comparables del mismo sector.'],
  ['«resultaron N»',
    'Del proceso de descarte resultaron 8 comparables aceptadas para el estudio.'],
];

for (const [nombre, frase] of REDACCIONES_ACEPTADAS) {
  test('el conteo de la muestra se actualiza con ' + nombre, () => {
    const salida = plano(actualizarProsaMuestra('<p>' + frase + '</p>', estudio, []));
    assert.ok(new RegExp('\\b' + ACEPTADAS + '\\b').test(salida),
      'el conteo no entró: ' + salida);
    assert.ok(!/\b8\b/.test(salida), 'sobrevive el conteo de la plantilla: ' + salida);
  });
}

test('el universo y la muestra final no se confunden aunque compartan párrafo', () => {
  /* Las dos cifras cuentan lo mismo y van seguidas; sólo el verbo dice cuál es cuál. Ponerlas
     al revés dejaría el informe declarando que se evaluaron menos compañías de las que
     aceptó, y eso lo ve quien lo revise. */
  const html = '<p>Con los criterios descritos se identificaron 442 compañías comparables '
    + 'potenciales, de las cuales quedaron 8 comparables tras aplicar los filtros.</p>';
  const salida = plano(actualizarProsaMuestra(html, estudio, []));
  assert.ok(salida.includes('se identificaron ' + UNIVERSO + ' compañías'),
    'el universo no entró donde va: ' + salida);
  assert.ok(salida.includes('quedaron ' + ACEPTADAS + ' comparables'),
    'la muestra final no entró donde va: ' + salida);
});

test('una frase de la muestra final no se toma por el universo', () => {
  const html = '<p>La muestra final de comparables a la Compañía quedó conformada por 8 '
    + 'comparables, los cuales se señalan a continuación:</p>';
  const salida = plano(actualizarProsaMuestra(html, estudio, []));
  assert.ok(salida.includes('conformada por ' + ACEPTADAS), 'no entró el conteo: ' + salida);
  assert.ok(!salida.includes(UNIVERSO), 'se escribió el universo donde va la muestra: ' + salida);
});
