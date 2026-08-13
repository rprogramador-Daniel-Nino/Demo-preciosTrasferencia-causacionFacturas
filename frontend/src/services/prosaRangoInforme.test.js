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
