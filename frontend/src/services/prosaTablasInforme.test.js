import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actualizarProsaMuestra, actualizarProsaOperaciones, actualizarProsaMargenes,
  actualizarProsaAjustes, actualizarProsaTablas,
} from './prosaTablasInforme.js';
import { PARRAFO_OOXML } from './prosaVecindad.js';
import { filasMuestraComparables, filasRazonesRechazo } from './tablasInforme.js';
import { umbralOperacionAdicional } from './tablasOperaciones.js';
import { fmt } from '../utils/calculations.js';

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

/* ══════ el monto de la información adicional del formato (códigos 61 a 63) ══════ */

/* El mismo estudio, con la sección «4. Información adicional» del Formato 1125 por encima del
   umbral del año gravable. El monto se deriva del umbral y no se escribe a mano: así la prueba
   sigue midiendo lo que debe cuando cambie el UVT. */
const MONTO_ADICIONAL = umbralOperacionAdicional(estudio.anio) * 2;
const ADICIONAL = fmt(MONTO_ADICIONAL);
const conAdicional = {
  ...estudio,
  operacionAdicional: {
    monto: MONTO_ADICIONAL,
    filas: [{
      vinculado: 'MONTACHEM INTERNATIONAL S.A.', nit: '900123456', pais: 'Panamá',
      tipo: 'Reintegros o reembolsos de gastos con vinculados que no fueron reflejados en el '
        + 'Estado de Resultados (62)',
      monto: MONTO_ADICIONAL,
    }],
  },
};

/* Literal de la plantilla del cliente: el análisis de la operación cita los DOS montos con el
   mismo giro, separados por un punto y coma. */
const HTML_DOS_MONTOS = '<p>En el año 2024, MONTACHEM INTERNATIONAL S.A. realizo operaciones con '
  + 'su vinculado por <strong>compra neta de inventarios para distribución (31)</strong> por un '
  + 'valor total de $ 18.836.847.464; adicionalmente se realizó un contrato de mandato entre la '
  + 'sucursal y su vinculado en el exterior por <strong>reintegros o reembolsos de gastos con '
  + 'vinculados que no fueron reflejados en el Estado de Resultados (62)</strong> por valor total '
  + 'de $ 13.425.408.220.</p>';

test('el monto de la información adicional entra sin pisar el de la operación analizada', () => {
  /* El ancla del monto se llevaba el primero y el segundo se radicaba ante la DIAN con la cifra
     del informe del año anterior. */
  const salida = plano(actualizarProsaOperaciones(HTML_DOS_MONTOS, conAdicional, []));
  assert.ok(salida.includes('por un valor total de $ ' + MONTO),
    'el monto de la operación analizada no entró: ' + salida);
  assert.ok(salida.includes('(62) por valor total de $ ' + ADICIONAL),
    'el monto de la información adicional no entró: ' + salida);
  assert.ok(!salida.includes('13.425.408.220'), 'sobrevive el monto adicional de la plantilla');
  assert.ok(!salida.includes('18.836.847.464'), 'sobrevive el monto principal de la plantilla');
});

test('los dos montos también entran en la ruta del .docx', () => {
  /* Word parte la frase en varios runs y la cifra puede quedar cortada por el medio. */
  const ooxml = '<w:p><w:r><w:t xml:space="preserve">En el año 2024, MONTACHEM realizo '
    + 'operaciones con su vinculado por compra neta de inventarios para distribución (31) por un '
    + 'valor total de $ </w:t></w:r><w:r><w:t>18.836.847.464</w:t></w:r>'
    + '<w:r><w:t xml:space="preserve">; adicionalmente se realizó un contrato de mandato por '
    + 'reintegros o reembolsos de gastos con vinculados que no fueron reflejados en el Estado de '
    + 'Resultados (62) por valor total de $ </w:t></w:r>'
    + '<w:r><w:t>13.425.408.2</w:t></w:r><w:r><w:t>20</w:t></w:r></w:p>';
  const salida = actualizarProsaOperaciones(ooxml, conAdicional, [], {
    rxParrafo: PARRAFO_OOXML,
  });
  assert.ok(plano(salida).includes('(62) por valor total de $ ' + ADICIONAL),
    'el monto adicional no entró: ' + plano(salida));
  assert.ok(plano(salida).includes('por un valor total de $ ' + MONTO),
    'el monto de la operación analizada no entró: ' + plano(salida));
  assert.equal((salida.match(/<w:r>/g) || []).length, (ooxml.match(/<w:r>/g) || []).length,
    'cambió el número de runs');
});

test('sin información adicional en el estudio, ese monto no se toca y se avisa', () => {
  /* La plantilla es el informe del año anterior: su cifra es de aquel contribuyente. Escribir
     ahí el monto de la operación analizada sería peor que dejarla, así que se avisa. */
  const avisos = [];
  const salida = plano(actualizarProsaOperaciones(HTML_DOS_MONTOS, estudio, avisos));
  assert.ok(salida.includes('por valor total de $ 13.425.408.220'),
    'se tocó el monto adicional sin tenerlo: ' + salida);
  assert.ok(salida.includes('por un valor total de $ ' + MONTO),
    'el monto de la operación analizada no entró: ' + salida);
  assert.ok(avisos.some((a) => /cita un monto de información adicional/.test(a)),
    'no avisó: ' + JSON.stringify(avisos));
});

test('un párrafo que sólo habla de la información adicional no recibe el monto analizado', () => {
  /* La plantilla presenta esa tabla en su propio párrafo. El ancla del monto de la operación
     analizada casaba ahí y colocaba una cifra creíble en el lugar de otra. */
  const html = '<p>Adicionalmente, se realizó un contrato de mandato entre la sucursal y su '
    + 'vinculado en el exterior por reintegros o reembolsos de gastos con vinculados que no '
    + 'fueron reflejados en el Estado de Resultados (62) por valor total de $ 13.425.408.220, '
    + 'detallado a continuación:</p>';
  const salida = plano(actualizarProsaOperaciones(html, estudio, []));
  assert.ok(salida.includes('$ 13.425.408.220'), 'se escribió el monto analizado ahí: ' + salida);
  assert.ok(!salida.includes(MONTO), 'se escribió el monto analizado ahí: ' + salida);
});

test('la información adicional que no supera el umbral no se declara en la prosa', () => {
  /* Misma condición que la tabla: el formato la trajo, pero por debajo de los 45.000 UVT no
     entra al informe, así que la frase tampoco puede declararla. */
  const avisos = [];
  const bajoUmbral = {
    ...estudio,
    operacionAdicional: { monto: 1000000, filas: [{ tipo: 'Préstamos (61)', monto: 1000000 }] },
  };
  const salida = plano(actualizarProsaOperaciones(HTML_DOS_MONTOS, bajoUmbral, avisos));
  assert.ok(salida.includes('$ 13.425.408.220'), 'se declaró por debajo del umbral: ' + salida);
  assert.ok(avisos.some((a) => /cita un monto de información adicional/.test(a)),
    'no avisó: ' + JSON.stringify(avisos));
});

test('si el estudio declara información adicional y el informe no la cita, se avisa', () => {
  const avisos = [];
  const html = '<p>En el año 2024, MONTACHEM tuvo operaciones de ingreso con sus vinculados '
    + 'económicos por un valor total de $ 18.836.847.464.</p>';
  actualizarProsaOperaciones(html, conAdicional, avisos);
  assert.ok(avisos.some((a) => /no la menciona/.test(a)), 'no avisó: ' + JSON.stringify(avisos));
});

test('con los dos montos, aplicarlo dos veces da el mismo resultado', () => {
  const una = actualizarProsaOperaciones(HTML_DOS_MONTOS, conAdicional, []);
  assert.equal(actualizarProsaOperaciones(una, conAdicional, []), una);
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

/* ════════ Ajustes a las comparables: la tasa de interés (Prime Rate) ════════ */

/* Literal del informe, con el salto de línea de la cita de la FED. La tasa que declara es la
   del informe del que salió la plantilla; el motor calcula el ajuste con `estudio.prime`, así
   que el documento afirmaba una tasa que no es la que sustenta sus propios números. */
const FRASE_PRIME = 'La tasa de interés que se utiliza para los ajustes de los comparables es '
  + '‘’Tasa Prime Rate Promedio” definida por la Reserva Federal de los Estados '
  + 'Unidos de Norteamérica (FED) como la "Average majority prime rate charged by banks on '
  + 'short-term loans to business. quoted on an investment basis". Esta tasa durante el 2024 '
  + 'fue de 8.31% EA.';

test('la tasa de los ajustes es la del estudio, no la del informe de referencia', () => {
  const salida = plano(actualizarProsaAjustes('<p>' + FRASE_PRIME + '</p>', estudio, []));
  assert.ok(salida.includes('fue de 7,37% EA'), 'la tasa no entró: ' + salida);
  assert.ok(!salida.includes('8.31'), 'sobrevive la tasa de la plantilla: ' + salida);
});

test('el año de esa frase se actualiza con la tasa', () => {
  const salida = plano(actualizarProsaAjustes('<p>' + FRASE_PRIME + '</p>', estudio, []));
  assert.ok(salida.includes('durante el 2025'), 'el año no se actualizó: ' + salida);
});

test('el «% EA» de la plantilla se conserva tal cual', () => {
  /* El grupo del ancla es SOLO el número: el signo y la unidad son redacción del cliente y
     cambiarlos por «7,370 %» haría que la frase cambiara de aspecto sin necesidad. */
  for (const [frase, esperado] of [
    ['Esta tasa durante el 2024 fue de 8.31% EA.', 'fue de 7,37% EA'],
    ['Esta tasa durante el año 2024 fue del 8.31 % E.A. según la FED.', 'fue del 7,37 % E.A.'],
  ]) {
    const salida = plano(actualizarProsaAjustes('<p>' + frase + '</p>', estudio, []));
    assert.ok(salida.includes(esperado), 'no se conservó la unidad: ' + salida);
  }
});

test('la frase partida por el salto de página también se actualiza', () => {
  /* La cita de la FED ocupa varias líneas y el extractor puede dejar la frase de la tasa en un
     párrafo que ya no dice «prime». */
  const suelta = 'short-term loans to business. quoted on an investment basis". Esta tasa '
    + 'durante el 2024 fue de 8.31% EA.';
  const salida = plano(actualizarProsaAjustes('<p>' + suelta + '</p>', estudio, []));
  assert.ok(salida.includes('fue de 7,37% EA'), 'la tasa no entró: ' + salida);
});

test('un párrafo que no habla de la tasa no se toca aunque diga «fue de X%»', () => {
  /* «fue de» seguido de un porcentaje aparece por todo el informe; lo que acota el ancla es
     que el párrafo hable de la tasa de los ajustes. */
  const ajeno = '<p>El margen operacional de la compañía fue de 4.985% en la operación de '
    + 'compra neta de inventarios para distribución.</p>';
  assert.equal(actualizarProsaAjustes(ajeno, estudio, []), ajeno);
});

test('sin tasa en el estudio no se escribe nada', () => {
  /* Pasa cuando el estudio no aplica ajuste por capital de trabajo: la plantilla conserva su
     frase, que es lo que corresponde. Un «—» donde había un número sería peor. */
  const html = '<p>Tasa Prime Rate. Esta tasa durante el 2024 fue de 8.31% EA.</p>';
  const salida = actualizarProsaAjustes(html, { anio: 2025 }, []);
  assert.ok(salida.includes('8.31'), 'se tocó la tasa sin tenerla');
  assert.ok(salida.includes('2024'), 'se tocó el año sin haber colocado la tasa');
});

test('la misma función atiende el .docx', () => {
  const ooxml = '<w:p><w:r><w:t xml:space="preserve">Tasa Prime Rate. Esta tasa durante el 2024 '
    + 'fue de </w:t></w:r><w:r><w:t>8.31</w:t></w:r><w:r><w:t>% EA.</w:t></w:r></w:p>';
  const salida = actualizarProsaAjustes(ooxml, estudio, [], { rxParrafo: PARRAFO_OOXML });
  assert.ok(plano(salida).includes('fue de 7,37% EA'), 'la tasa no entró: ' + plano(salida));
  assert.equal((salida.match(/<w:r>/g) || []).length, (ooxml.match(/<w:r>/g) || []).length,
    'cambió el número de runs');
});

test('aplicar dos veces la tasa da el mismo resultado', () => {
  const una = actualizarProsaAjustes('<p>' + FRASE_PRIME + '</p>', estudio, []);
  assert.equal(actualizarProsaAjustes(una, estudio, []), una);
});

test('la tasa entra también por la función que corre las cuatro familias', () => {
  const salida = plano(actualizarProsaTablas('<p>' + FRASE_PRIME + '</p>', estudio, []));
  assert.ok(salida.includes('fue de 7,37% EA'), 'la tasa no entró por actualizarProsaTablas');
});

/* ════════ Multiempresa: cada firma redacta lo mismo de otra manera ════════ */

/* El sistema no genera el informe desde cero: rellena la plantilla del cliente, y esa
   plantilla la redactó otra firma. Anclar en el giro exacto de un informe concreto es
   garantizar que el siguiente cliente vuelva a radicar los datos del anterior. Lo que se
   ancla es la palabra que NOMBRA el dato —valor, monto, importe— y lo que va alrededor se
   admite en sus variantes. */

const REDACCIONES_MONTO = [
  ['«por un valor total de $ X»',
    'En el año 2019, ACME tuvo operaciones de ingreso con sus vinculados económicos por un '
    + 'valor total de $ 3.435.357.400'],
  ['«por valor de $X», sin el artículo',
    'La transacción con el vinculado se realizó por valor de $3.435.357.400 durante el '
    + 'ejercicio fiscal.'],
  ['«por un monto de X»',
    'Las operaciones de ingreso con vinculados se hicieron por un monto de 3.435.357.400 '
    + 'pesos colombianos.'],
  ['«cuyo importe asciende a X»',
    'Operaciones con vinculados económicos cuyo importe asciende a $ 3.435.357.400.'],
  ['«la suma total de X»',
    'La suma total de 3.435.357.400 corresponde a las operaciones de ingreso del período.'],
];

for (const [nombre, frase] of REDACCIONES_MONTO) {
  test('el monto se actualiza con ' + nombre, () => {
    const salida = plano(actualizarProsaOperaciones('<p>' + frase + '</p>', estudio, []));
    assert.ok(salida.includes(MONTO), 'el monto no entró: ' + salida);
    assert.ok(!salida.includes('3.435.357.400'), 'sobrevive el de la plantilla: ' + salida);
  });
}

const REDACCIONES_ANIO_MARGENES = [
  ['«correspondientes al año»',
    'El siguiente cuadro presenta las utilidades operacionales sobre ventas de las compañías '
    + 'comparables para los estados financieros correspondientes al año 2019:'],
  ['«relativos al año»',
    'Márgenes obtenidos por las compañías comparables, relativos al año 2019.'],
  ['«del año»',
    'Estados financieros de las compañías comparables del año 2019, según la base consultada.'],
];

for (const [nombre, frase] of REDACCIONES_ANIO_MARGENES) {
  test('el año de los márgenes se actualiza con ' + nombre, () => {
    const salida = plano(actualizarProsaMargenes('<p>' + frase + '</p>', estudio, []));
    assert.ok(salida.includes('año 2025'), 'el año no entró: ' + salida);
    assert.ok(!salida.includes('2019'), 'sobrevive el año de la plantilla: ' + salida);
  });
}

test('el ejercicio fiscal se reconoce con cualquier participio', () => {
  for (const participio of ['finalizado', 'terminado', 'cerrado', 'concluido']) {
    const frase = 'La transacción efectuada durante el ejercicio fiscal ' + participio
      + ' el 31 de diciembre de 2019 fue el ingreso por un valor de $ 3.435.357.400.';
    const salida = plano(actualizarProsaOperaciones('<p>' + frase + '</p>', estudio, []));
    assert.ok(salida.includes('31 de diciembre de 2025'),
      'no se actualizó con «' + participio + '»: ' + salida);
  }
});
