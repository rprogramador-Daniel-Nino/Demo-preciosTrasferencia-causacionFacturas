import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actualizarProsaRango, PARRAFO_OOXML } from './prosaRangoInforme.js';
import { filasRangoIntercuartil } from './tablasInforme.js';

/* Un estudio con muestra, para que el rango tenga percentiles de verdad. Mismo patrón que
   `tablasInforme.test.js`: las cifras no se escriben a mano, se le preguntan al motor, así que la
   prueba sigue valiendo si el cálculo cambia. */
const estudio = {
  pli: 'MO', useadj: true, cmode: 'nac', prime: 7.37, ent: 'END GAME', anio: 2025,
  t_s: 1000, t_c: 600, t_op: 200, t_ar: 100, t_inv: 50, t_ap: 80, t_ppe: 300,
  comparables: [
    { name: 'A', amb: 'Nac', s: 500, c: 300, op: 120, ar: 50, inv: 20, ap: 40, ppe: 100 },
    { name: 'B', amb: 'Nac', s: 800, c: 500, op: 180, ar: 70, inv: 30, ap: 50, ppe: 120 },
    { name: 'C', amb: 'Nac', s: 600, c: 350, op: 150, ar: 60, inv: 25, ap: 45, ppe: 110 },
  ],
};

/* Lo que la TABLA del informe publica para este estudio. La frase tiene que decir lo mismo. */
const deLaTabla = (() => {
  const r = filasRangoIntercuartil(estudio);
  const ajustado = (etiqueta) => r.filas.find((f) => f.etiqueta === etiqueta).ajustado;
  const pct = (v) => (v * 100).toLocaleString('es-CO',
    { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' %';
  return {
    tpli: pct(r.tPLI),
    med: pct(ajustado('Mediana')),
    p75: pct(ajustado('Percentil 75')),
    p25: pct(ajustado('Percentil 25')),
  };
})();

const plano = (s) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/* La frase tal como la trae el informe de END GAME leído desde su PDF: el indicador primero, la
   mediana después y el percentil 75 al final. */
const FRASE_PDF = '<p> De acuerdo a los resultados obtenidos dentro del estudio de Precios de '
  + 'Transferencia para la compañía END GAME INTERACTIVE COLOMBIA SAS, se logró verificar y '
  + 'concluir que el comportamiento del Margen Operacional se sitúa en 4.985%, el cual se '
  + 'encuentra entre la mediana (-1.075%) y el percentil 75 (6.418%), del margen operacional '
  + 'ajustado durante el 2024, demostrando un comportamiento de acuerdo a los valores del rango '
  + 'Intercuartil del promedio de entidades comparables del mismo sector.</p>';

test('la frase del rango publica las cifras de la tabla, no las de la plantilla', () => {
  /* Es el defecto que se reportó: la tabla se rehacía con el estudio y la frase de debajo seguía
     con las cifras del informe de referencia, contradiciéndola en el mismo documento. */
  const salida = plano(actualizarProsaRango(FRASE_PDF, estudio, []));

  assert.ok(salida.includes('se sitúa en ' + deLaTabla.tpli),
    'el indicador del contribuyente no es el de la tabla: ' + salida);
  assert.ok(salida.includes('la mediana (' + deLaTabla.med + ')'),
    'la mediana no es la de la tabla: ' + salida);
  assert.ok(salida.includes('el percentil 75 (' + deLaTabla.p75 + ')'),
    'el percentil 75 no es el de la tabla: ' + salida);

  /* Y no queda ni una cifra del informe de referencia. */
  for (const vieja of ['4.985%', '-1.075%', '6.418%']) {
    assert.ok(!salida.includes(vieja), 'sobrevive una cifra de la plantilla: ' + vieja);
  }
});

test('el año de la frase es el del estudio', () => {
  /* «…del margen operacional ajustado durante el 2024» salía con el año del contribuyente
     anterior al lado de las cifras del actual. */
  const salida = plano(actualizarProsaRango(FRASE_PDF, estudio, []));
  assert.ok(salida.includes('ajustado durante el 2025'), 'el año no se actualizó: ' + salida);
  assert.ok(!salida.includes('durante el 2024'), 'quedó el año de la plantilla');
});

test('la redacción no se toca, sólo las cifras y el año', () => {
  /* Lo que se radica tiene que seguir leyéndose igual: si la frase se reescribiera, cualquier
     matiz que el cliente haya pactado con su asesor se perdería sin avisar. */
  const salida = plano(actualizarProsaRango(FRASE_PDF, estudio, []));
  const esqueleto = (s) => s.replace(/-?\d+(?:[.,]\d+)?\s*%/g, '#').replace(/20\d{2}/g, 'AAAA');
  assert.equal(esqueleto(salida), esqueleto(plano(FRASE_PDF)),
    'cambió algo más que las cifras y el año');
});

test('la misma función atiende la plantilla .docx, con el texto partido en runs', () => {
  /* Word parte una frase en varios `<w:r><w:t>` por el corrector o por un cambio de formato, así
     que cada cifra suele vivir en su propio fragmento, separada de las palabras que la
     introducen. Es lo que exige que el anclaje tolere etiquetas por el medio, y lo que permite
     que el informe diga lo mismo venga la plantilla de un PDF o de un .docx. */
  const ooxml = '<w:p><w:r><w:t xml:space="preserve">…se sitúa en </w:t></w:r>'
    + '<w:r><w:t>4.985%</w:t></w:r>'
    + '<w:r><w:t xml:space="preserve">, el cual se encuentra entre la mediana (</w:t></w:r>'
    + '<w:r><w:t>-1.075%</w:t></w:r>'
    + '<w:r><w:t xml:space="preserve">) y el percentil 75 (</w:t></w:r>'
    + '<w:r><w:t>6.418%</w:t></w:r>'
    + '<w:r><w:t xml:space="preserve">), del margen operacional ajustado durante el 2024.</w:t>'
    + '</w:r></w:p>';
  const salida = actualizarProsaRango(ooxml, estudio, [], { rxParrafo: PARRAFO_OOXML });

  assert.ok(plano(salida).includes('se sitúa en ' + deLaTabla.tpli), 'el indicador no entró');
  assert.ok(plano(salida).includes('la mediana (' + deLaTabla.med + ')'), 'la mediana no entró');
  assert.ok(plano(salida).includes('el percentil 75 (' + deLaTabla.p75 + ')'), 'el p75 no entró');
  assert.ok(plano(salida).includes('durante el 2025'), 'el año no entró');
  /* Los runs siguen siendo runs: no se fundieron ni se perdió el `xml:space`. */
  assert.equal((salida.match(/<w:r>/g) || []).length, (ooxml.match(/<w:r>/g) || []).length,
    'cambió el número de runs, así que se tocó el formato');
  assert.ok(salida.includes('xml:space="preserve"'), 'se perdió el xml:space de algún run');
});

test('las cifras se anclan en sus palabras, así que el orden de la redacción no importa', () => {
  /* Ésta es la razón de ser del módulo. La plantilla .docx de este cliente escribe «…se ubica
     entre el percentil 25 (X) y (Y) percentil 75, la mediana con (Z)» —el paréntesis delante del
     rótulo en un caso y una palabra de enlace en otro—, mientras la del PDF pone el indicador
     primero. Identificar las cifras por su posición pone cada una en el sitio de otra, y una
     cifra creíble en el lugar equivocado ya no se nota al revisar. */
  const ooxml = '<w:p><w:r><w:t>…se ubica entre el percentil 25 (1.780%) y (8.800%) percentil 75,'
    + ' la mediana con (5.100%).</w:t></w:r></w:p>';
  const salida = plano(actualizarProsaRango(ooxml, estudio, [], { rxParrafo: PARRAFO_OOXML }));

  assert.ok(salida.includes('percentil 25 (' + deLaTabla.p25 + ')'), 'el p25 no entró: ' + salida);
  assert.ok(salida.includes('(' + deLaTabla.p75 + ') percentil 75'), 'el p75 no entró: ' + salida);
  assert.ok(salida.includes('la mediana con (' + deLaTabla.med + ')'),
    'la mediana no entró: ' + salida);
});

test('la mediana sin paréntesis propio no se lleva la cifra del percentil 75', () => {
  /* Sin el veto a los rótulos ajenos, «entre la mediana y el percentil 75 (X)» daba el valor del
     percentil 75 por mediana. */
  const html = '<p>…está entre la mediana y el percentil 75 (6.418%) del rango.</p>';
  const salida = plano(actualizarProsaRango(html, estudio, []));
  assert.ok(salida.includes('el percentil 75 (' + deLaTabla.p75 + ')'), 'el p75 no entró');
  assert.ok(!salida.includes('la mediana y el percentil 75 (' + deLaTabla.med + ')'),
    'la mediana se colocó donde va el percentil 75');
});

test('una celda de la tabla del rango no se confunde con la frase', () => {
  /* La tabla dice «Mediana» y «Percentil 75» en sus rótulos, y sus celdas llevan cifras en tanto
     por ciento. Tomarlas por la frase reescribiría la tabla por segunda vez y por otra vía. */
  const tabla = '<table><tr><th><p>Mediana</p></th><td><p>5,519 %</p></td></tr>'
    + '<tr><th><p>Percentil 75</p></th><td><p>9,032 %</p></td></tr></table>';
  const salida = actualizarProsaRango(tabla, estudio, []);
  assert.ok(salida.includes('5,519 %'), 'se tocó una celda de la tabla');
  assert.ok(salida.includes('9,032 %'), 'se tocó una celda de la tabla');
});

test('si la frase no está, se avisa en vez de callar', () => {
  /* Callar deja el informe con las cifras del informe de referencia y el panel de avisos limpio,
     que es indistinguible de haberlo actualizado. */
  const avisos = [];
  actualizarProsaRango('<p>Un párrafo que no comenta ningún rango.</p>', estudio, avisos);
  assert.equal(avisos.length, 1, 'no avisó: ' + JSON.stringify(avisos));
  assert.match(avisos[0], /no se encontró/);
});

test('si el indicador no cae en el tramo que la frase afirma, se avisa', () => {
  /* Las cifras ya cuadran con la tabla, pero la redacción dice «entre la mediana y el percentil
     75» y el indicador de este estudio está por debajo de la mediana. No se reescribe la frase
     —eso es criterio del asesor—, pero tiene que quedar dicho. */
  const avisos = [];
  actualizarProsaRango(FRASE_PDF, estudio, avisos);
  assert.ok(avisos.some((a) => /la redacción hay que ajustarla a mano/.test(a)),
    'no avisó del tramo: ' + JSON.stringify(avisos));
});

test('un año ilegible deja el de la plantilla y lo dice', () => {
  const avisos = [];
  const salida = plano(actualizarProsaRango(FRASE_PDF, { ...estudio, anio: null }, avisos));
  assert.ok(salida.includes('durante el 2024'), 'se inventó un año');
  assert.ok(avisos.some((a) => /no se pudo leer el año gravable/.test(a)),
    'no avisó del año: ' + JSON.stringify(avisos));
});

test('sin muestra no se inventan percentiles', () => {
  /* Un estudio sin comparables no tiene rango. Escribir «—» donde la plantilla tenía una cifra
     sería peor que dejarla: el hueco visible es para los campos del vocabulario, no para una
     frase de prosa. */
  const salida = plano(actualizarProsaRango(FRASE_PDF, { anio: 2025, pli: 'MO' }, []));
  assert.ok(salida.includes('la mediana (-1.075%)'), 'se tocó la mediana sin tener rango');
  assert.ok(salida.includes('el percentil 75 (6.418%)'), 'se tocó el p75 sin tener rango');
  /* El año sí, que no depende de la muestra. */
  assert.ok(salida.includes('durante el 2025'), 'el año no se actualizó');
});

/* ══════ el indicador del contribuyente sale con cuatro redacciones ══════ */

/* Las cuatro, tal como las trae el informe de referencia. La primera es la que se reportó: la
   frase del rango de arriba ya salía con las cifras del estudio y ésta seguía con la de la
   plantilla, en la página siguiente. */
const REDACCIONES_INDICADOR = [
  ['el rótulo en negrita y la cifra entre paréntesis',
    '<p>Los resultados representan que la empresa obtuvo una rentabilidad para el '
    + '<strong>Margen Operacional (MO) </strong>dentro de los <strong>Márgenes Transaccionales '
    + 'de Utilidad de Operación (TU)</strong>, de (4.985%) en las operaciones con sus '
    + 'vinculados económicos del exterior.</p>'],
  ['«generó una rentabilidad operacional de X»',
    '<p>Al realizar la comparación con el margen operacional de la compañía END GAME, generó '
    + 'una rentabilidad operacional de 4.985%, en la operación de otros servicios (07).</p>'],
  ['«de X, en su operación»',
    '<p>END GAME genero una rentabilidad operacional relacionada con videojuegos para '
    + 'dispositivos móviles de 4.985%, en su operación, ubicándose entre la mediana (-1.075%) '
    + 'y el percentil 75 (6.418%).</p>'],
  ['«se sitúa en X»',
    '<p>el comportamiento del Margen Operacional se sitúa en 4.985%, el cual se encuentra entre '
    + 'la mediana (-1.075%) y el percentil 75 (6.418%).</p>'],
];

for (const [nombre, html] of REDACCIONES_INDICADOR) {
  test('el indicador se actualiza con ' + nombre, () => {
    const salida = plano(actualizarProsaRango(html, estudio, []));
    assert.ok(salida.includes(deLaTabla.tpli),
      'el indicador no es el de la tabla: ' + salida);
    assert.ok(!salida.includes('4.985%'), 'sobrevive la cifra de la plantilla: ' + salida);
  });
}

test('la negrita del rótulo no impide llegar a la cifra', () => {
  /* En el informe el rótulo va en negrita y la coma queda fuera: «<strong>…(TU)</strong>, de
     (4.985 %)». Con un ancla que solo admitiera espacios entre los dos, el párrafo salía sin
     actualizar aunque en una prueba con el texto plano pareciera funcionar. Ése fue el defecto:
     se corrigió en aislado y seguía mal en el documento. */
  const html = REDACCIONES_INDICADOR[0][1];
  assert.match(html, /<\/strong>,\s*de/, 'la fixture perdió la etiqueta que causaba el fallo');
  const salida = plano(actualizarProsaRango(html, estudio, []));
  assert.ok(salida.includes('(TU), de (' + deLaTabla.tpli + ')'), 'no llegó a la cifra: ' + salida);
});

test('el 25 % que describe el método no es el indicador de nadie', () => {
  /* «…se eliminó el 25 % superior e inferior de las observaciones…» describe cómo se recorta el
     rango. Es la razón por la que el indicador se ancla en giros concretos y no en «la única
     cifra del párrafo». */
  const html = '<p>El rango de los indicadores de rentabilidad fue reducido para incrementar el '
    + 'nivel de confianza; se eliminó el 25% superior e inferior de las observaciones.</p>';
  const salida = plano(actualizarProsaRango(html, estudio, []));
  assert.ok(salida.includes('el 25% superior e inferior'),
    'se reescribió el 25 % del método: ' + salida);
});

test('aplicarlo dos veces sobre el mismo texto da el mismo resultado', () => {
  /* La vista previa se re-renderiza a cada cambio del estudio, así que la función corre muchas
     veces sobre su propia salida. */
  const una = actualizarProsaRango(FRASE_PDF, estudio, []);
  const dos = actualizarProsaRango(una, estudio, []);
  assert.equal(dos, una, 'la segunda pasada cambia el resultado');
});

/* ══════ la cifra que cada rótulo tiene al lado, sin paréntesis y en cualquier orden ══════ */

/* La redacción que se reportó, literal. Ninguna de las ocho anclas la reconoce: todas exigen un
   paréntesis junto a la cifra, y aquí no hay ninguno y además la cifra va DELANTE del rótulo en
   dos de los tres casos. El informe salía con las cifras del informe de referencia mientras la
   tabla de encima publicaba las del estudio, en la misma página. */
const FRASE_SHANDONG = 'Como se observa en el cuadro anterior, el rango Intercuartil obtenido por '
  + 'las compañías comparables seleccionadas por la producción, manufactura, compra, venta, '
  + 'alquiler, distribución, importación, exportación de productos, equipos, maquinaria para la '
  + 'industria petrolera, se ubica entre 10.925% percentil 25 y 17.258% percentil 75 y la mediana '
  + 'con 15.356%';

const RUTAS = [
  ['leída de un .docx', (s) => '<w:p><w:r><w:t>' + s + '</w:t></w:r></w:p>', PARRAFO_OOXML],
  ['leída de un PDF', (s) => '<p>' + s + '</p>', undefined],
];

for (const [ruta, envolver, rxParrafo] of RUTAS) {
  test('la frase sin paréntesis y con la cifra delante del rótulo se actualiza, ' + ruta, () => {
    /* Que las dos rutas se prueben por separado no es redundancia: tener la lógica dos veces es
       lo que dejó a la del PDF sin el arreglo que la del .docx ya tenía. */
    const avisos = [];
    const salida = plano(actualizarProsaRango(envolver(FRASE_SHANDONG), estudio, avisos,
      { rxParrafo }));

    assert.ok(salida.includes(deLaTabla.p25 + ' percentil 25'), 'el p25 no entró: ' + salida);
    assert.ok(salida.includes(deLaTabla.p75 + ' percentil 75'), 'el p75 no entró: ' + salida);
    assert.ok(salida.includes('la mediana con ' + deLaTabla.med),
      'la mediana no entró: ' + salida);
    for (const vieja of ['10.925%', '17.258%', '15.356%']) {
      assert.ok(!salida.includes(vieja), 'sobrevive una cifra de la plantilla: ' + vieja);
    }
    assert.deepEqual(avisos, [], 'avisó de algo pese a haber colocado las tres cifras');
  });
}

test('emparejar por cercanía no reordena las cifras', () => {
  /* La aserción fuerte: no basta con que las tres cifras del estudio aparezcan, tienen que
     aparecer cada una donde va. Una cifra creíble en el sitio de otra ya no se nota al revisar,
     y es el defecto que este módulo existe para no cometer. */
  const salida = plano(actualizarProsaRango('<p>' + FRASE_SHANDONG + '</p>', estudio, []));
  const esperado = plano(FRASE_SHANDONG)
    .replace('10.925%', deLaTabla.p25)
    .replace('17.258%', deLaTabla.p75)
    .replace('15.356%', deLaTabla.med);
  assert.equal(salida, esperado);
});

test('en la frase sin paréntesis tampoco se toca nada más que las cifras', () => {
  const salida = plano(actualizarProsaRango('<p>' + FRASE_SHANDONG + '</p>', estudio, []));
  const esqueleto = (s) => s.replace(/-?\d+(?:[.,]\d+)*\s*%/g, '#').replace(/20\d{2}/g, 'AAAA');
  assert.equal(esqueleto(salida), esqueleto(plano(FRASE_SHANDONG)),
    'cambió algo más que las cifras');
});

test('aplicarlo dos veces sobre la frase sin paréntesis da el mismo resultado', () => {
  const una = actualizarProsaRango('<p>' + FRASE_SHANDONG + '</p>', estudio, []);
  const dos = actualizarProsaRango(una, estudio, []);
  assert.equal(dos, una, 'la segunda pasada cambia el resultado');
});

test('la frase sin paréntesis partida en runs por Word también se actualiza', () => {
  /* Word parte «10.925%» dejando el número en un run y el signo en el siguiente. El tramo nuevo
     se escribe entero en el primero y los demás quedan vacíos: borrar un run se llevaría su
     `<w:rPr>` y con él el formato de lo que venga después. */
  const ooxml = '<w:p><w:r><w:t xml:space="preserve">…se ubica entre </w:t></w:r>'
    + '<w:r><w:t>10.925</w:t></w:r>'
    + '<w:r><w:t xml:space="preserve">% percentil 25 y </w:t></w:r>'
    + '<w:r><w:t>17.258%</w:t></w:r>'
    + '<w:r><w:t xml:space="preserve"> percentil 75 y la mediana con </w:t></w:r>'
    + '<w:r><w:t>15.356%</w:t></w:r>'
    + '<w:r><w:t> para el ejercicio analizado.</w:t></w:r></w:p>';
  const salida = actualizarProsaRango(ooxml, estudio, [], { rxParrafo: PARRAFO_OOXML });

  assert.ok(plano(salida).includes(deLaTabla.p25 + ' percentil 25'), 'el p25 no entró');
  assert.ok(plano(salida).includes(deLaTabla.p75 + ' percentil 75'), 'el p75 no entró');
  assert.ok(plano(salida).includes('la mediana con ' + deLaTabla.med), 'la mediana no entró');
  assert.equal((salida.match(/<w:r>/g) || []).length, (ooxml.match(/<w:r>/g) || []).length,
    'cambió el número de runs, así que se tocó el formato');
  assert.ok(salida.includes('xml:space="preserve"'), 'se perdió el xml:space de algún run');
});

test('cada rótulo se queda con la cifra que lo acompaña y no con la que está más cerca', () => {
  /* «la mediana con X y el percentil 75 con Y»: la « y » que separa la X del percentil 75 es más
     corta que el « con » que la une a su propia mediana, así que por distancia sola el percentil
     75 se llevaba la cifra de la mediana. Cruzar un separador de enumeración cuesta más que
     cualquier hueco. */
  const html = '<p>Como se observa en el cuadro anterior, el rango intercuartil de las compañías '
    + 'comparables tiene la mediana con 1.234,567 % y el percentil 75 con 2.000,111 % para el '
    + 'ejercicio analizado.</p>';
  const salida = plano(actualizarProsaRango(html, estudio, []));
  assert.ok(salida.includes('la mediana con ' + deLaTabla.med), 'la mediana no entró: ' + salida);
  assert.ok(salida.includes('el percentil 75 con ' + deLaTabla.p75), 'el p75 no entró: ' + salida);
});

test('una cifra con separador de miles se sustituye entera, no por la mitad', () => {
  /* El `RX_PCT` de las anclas casa «234,567 %» dentro de «1.234,567 %»; sustituir ese tramo
     dejaría «1.24,074 %» en un documento que se radica ante la DIAN. */
  const html = '<p>Como se observa en el cuadro anterior, el rango intercuartil de las compañías '
    + 'comparables tiene la mediana con 1.234,567 % para el ejercicio analizado.</p>';
  const salida = plano(actualizarProsaRango(html, estudio, []));
  assert.ok(salida.includes('la mediana con ' + deLaTabla.med), 'la mediana no entró: ' + salida);
  assert.ok(!/\d\.\d{1,2},\d/.test(salida), 'quedó un trozo de la cifra vieja: ' + salida);
});

test('si un rótulo se queda sin cifra, no se toca ninguna del párrafo', () => {
  /* «el percentil 25 y el percentil 75 son X y Y» enumera primero los rótulos y después las
     cifras. Nada impide que el percentil 75 se lleve la X —entre los dos sólo hay « son »— y
     colocada ahí ya nadie la distingue de la buena. Que un rótulo se quede sin pareja es la
     señal de que la redacción no lista cifra por rótulo, y entonces no se toca nada. */
  const avisos = [];
  const html = '<p>Como se observa en el cuadro anterior, el percentil 25 y el percentil 75 del '
    + 'rango intercuartil de las comparables son 10.925 % y 17.258 % respectivamente.</p>';
  const salida = plano(actualizarProsaRango(html, estudio, avisos));
  assert.ok(salida.includes('son 10.925 % y 17.258 %'),
    'se colocó una cifra sin saber de quién era: ' + salida);
  assert.ok(avisos.some((a) => /no se pudo decidir qué cifra/.test(a)),
    'no avisó de lo que dejó sin resolver: ' + JSON.stringify(avisos));
});

test('entre dos rótulos equidistantes no se elige: se avisa', () => {
  const avisos = [];
  const html = '<p>Como se observa en el cuadro anterior, el rango de las comparables va del '
    + 'percentil 25 6.418 % percentil 75 según lo calculado para el ejercicio.</p>';
  const salida = plano(actualizarProsaRango(html, estudio, avisos));
  assert.ok(salida.includes('percentil 25 6.418 % percentil 75'),
    'se eligió a cara o cruz: ' + salida);
  assert.ok(avisos.some((a) => /no se pudo decidir qué cifra/.test(a)), 'no avisó');
});

test('una cifra que ya colocó un ancla no se reasigna a otro rótulo', () => {
  /* El percentil 75 entra por su ancla; la mediana, que no tiene cifra propia en la frase, no
     puede llevarse la que acaba de colocarse. */
  const html = '<p>Como se observa en el cuadro anterior, el indicador está sobre el percentil 75 '
    + '(6.418%) y la mediana del sector se comportó de manera similar durante el ejercicio.</p>';
  const salida = plano(actualizarProsaRango(html, estudio, []));
  assert.ok(salida.includes('el percentil 75 (' + deLaTabla.p75 + ')'), 'el p75 no entró');
  assert.equal((salida.match(/%/g) || []).length, 1, 'se escribió una cifra de más: ' + salida);
});

test('una celda que lleva el rótulo y la cifra juntos no se confunde con la frase', () => {
  /* La prueba de la celda de arriba las tiene en párrafos distintos. Cuando comparten celda, lo
     que las separa de la frase es que una frase de prosa no tiene diez palabras. */
  for (const celda of ['<p>Mediana 5,519 %</p>',
    '<w:p><w:r><w:t>Percentil 75 9,032 %</w:t></w:r></w:p>']) {
    const rxParrafo = celda.startsWith('<w:p') ? PARRAFO_OOXML : undefined;
    const salida = actualizarProsaRango(celda, estudio, [], { rxParrafo });
    assert.equal(salida, celda, 'se tocó una celda de la tabla: ' + salida);
  }
});

test('el 25 % que describe el método tampoco lo toca la vecindad', () => {
  /* «…se eliminó el 25 % superior e inferior de las observaciones…» describe cómo se recorta el
     rango. La cifra está vetada como candidata, pero sigue contando como barrera para que un
     rótulo de más allá no salte por encima de ella a buscarse una cifra. */
  const html = '<p>El rango de los indicadores de rentabilidad de las comparables fue reducido '
    + 'para incrementar el nivel de confianza; se eliminó el 25 % superior e inferior de las '
    + 'observaciones, de modo que la mediana quedó en 3,400 % para el ejercicio.</p>';
  const salida = plano(actualizarProsaRango(html, estudio, []));
  assert.ok(salida.includes('el 25 % superior e inferior'),
    'se reescribió el 25 % del método: ' + salida);
  assert.ok(salida.includes('la mediana quedó en ' + deLaTabla.med),
    'la mediana no entró: ' + salida);
});

test('la vecindad no inventa el indicador del contribuyente', () => {
  /* El «rótulo» del indicador sería «margen operacional» o «rentabilidad», que aparecen por todo
     el informe: bastaría un número suelto cerca para publicar el resultado del cliente en mitad
     de otra frase. Ése sólo entra por sus cuatro anclas. */
  const html = '<p>Para el análisis del método TU se consideró que el indicador financiero de '
    + 'rentabilidad operacional más apropiado para las comparables es aquel cuyo peso relativo '
    + 'supera el 60 % del total, según la metodología aplicada.</p>';
  const salida = plano(actualizarProsaRango(html, estudio, []));
  assert.ok(salida.includes('supera el 60 % del total'), 'se inventó un indicador: ' + salida);
});

test('un párrafo del tamaño de una página no se empareja por cercanía', () => {
  /* El lector de PDF puede entregar una página entera como un solo `<p>` cuando el árbol
     etiquetado no rinde texto. Eso no es una frase: dentro hay tablas aplanadas. */
  const relleno = 'Relleno con cifras sueltas 1,111 % y 2,222 % que no son del rango. '.repeat(20);
  const salida = plano(actualizarProsaRango('<p>' + relleno + FRASE_SHANDONG + '</p>',
    estudio, []));
  assert.ok(salida.includes('10.925% percentil 25'), 'se emparejó dentro de una página entera');
});

test('sin muestra la vecindad tampoco escribe', () => {
  const salida = plano(actualizarProsaRango('<p>' + FRASE_SHANDONG + '</p>',
    { anio: 2025, pli: 'MO' }, []));
  for (const vieja of ['10.925%', '17.258%', '15.356%']) {
    assert.ok(salida.includes(vieja), 'se tocó una cifra sin tener rango: ' + vieja);
  }
});

test('el año se actualiza también cuando la frase dice «en el año»', () => {
  const salida = plano(actualizarProsaRango('<p>' + FRASE_SHANDONG + ' en el año 2023.</p>',
    estudio, []));
  assert.ok(salida.includes('en el año 2025'), 'el año no se actualizó: ' + salida);
  assert.ok(!salida.includes('2023'), 'quedó el año de la plantilla: ' + salida);
});

test('«en el año» no se toca en un párrafo cuyas cifras no se reconocieron', () => {
  /* «en el año 20XX» sale por todo el informe —la macro, las fuentes citadas, el ANEXO B—, así
     que lo que hace seguro sustituirlo no es la frase: es haber acertado el rango ahí mismo. */
  const html = '<p>Los criterios para calcular el percentil 25 y el percentil 75 de la muestra '
    + 'de comparables fueron los publicados en el año 2019 por la OCDE en sus directrices.</p>';
  const salida = plano(actualizarProsaRango(html, estudio, []));
  assert.ok(salida.includes('en el año 2019'), 'se tocó un año que no era el del rango: ' + salida);
});
