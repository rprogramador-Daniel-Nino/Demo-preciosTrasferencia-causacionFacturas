import { test } from 'node:test';
import assert from 'node:assert/strict';
import PizZip from 'pizzip';
import { Document, Packer } from 'docx';
import {
  FORMULA_AR, FORMULA_AP, ooxmlDeFormula, esFormulaCorrupta, tipoDeAjusteDe,
} from './formulasOmml.js';
import { docxDeFormula } from './docxWriter.js';

const cuenta = (xml, etiqueta) => (xml.match(new RegExp(etiqueta, 'g')) || []).length;

test('la ecuación tiene la forma de la plantilla', () => {
  /* ( ( (ANP_TP / TNS_TP) ∗ (TNS_Comp) ) − ANP_COMP ) ∗ ( R / (1+R) ): cinco paréntesis que
     escalan, dos fracciones verticales y cuatro subíndices. La versión anterior emitía cuatro
     paréntesis —le faltaban el de la fracción izquierda y el de TNS_Comp— y por eso no se
     parecía a la plantilla. */
  const xml = ooxmlDeFormula(FORMULA_AP);
  assert.equal(cuenta(xml, '<m:d>'), 5, 'no son cinco paréntesis');
  assert.equal(cuenta(xml, '<m:f>'), 2, 'no son dos fracciones');
  assert.equal(cuenta(xml, '<m:sSub>'), 4, 'no son cuatro subíndices');

  assert.match(xml, /<m:t>AP Adjustment = <\/m:t>/);
  assert.match(xml, /<m:t>TP<\/m:t>/);
  assert.match(xml, /<m:t>Comp<\/m:t>/);
  assert.match(xml, /<m:t>COMP<\/m:t>/);
  /* El (1+R) del denominador va como texto: en la plantilla esos paréntesis son de cuerpo
     normal, no estirados al alto de la fracción. */
  assert.match(xml, /<m:den><m:r><m:t>\(1\+R\)<\/m:t><\/m:r><\/m:den>/);

  assert.ok(xml.includes('<m:t>ANP</m:t>'), 'la de pagar debe promediar ANP');
  assert.ok(!xml.includes('<m:t>ANC</m:t>'), 'se coló la cuenta de la de cobrar');
});

test('los términos van en el orden de la ecuación', () => {
  const xml = ooxmlDeFormula(FORMULA_AR);
  const orden = ['AR Adjustment = ', 'ANC', 'TNS', 'Comp', 'COMP', '(1+R)']
    .map((t) => xml.indexOf('<m:t>' + t));
  for (let i = 1; i < orden.length; i++) {
    assert.ok(orden[i] > orden[i - 1] && orden[i - 1] >= 0,
      `«${['AR Adjustment = ', 'ANC', 'TNS', 'Comp', 'COMP', '(1+R)'][i]}» está fuera de sitio`);
  }
});

test('cobrar y pagar sólo se diferencian en la cuenta que promedian', () => {
  const ar = ooxmlDeFormula(FORMULA_AR);
  const ap = ooxmlDeFormula(FORMULA_AP);
  assert.equal(ar.replaceAll('ANC', 'ANP').replaceAll('AR Adjustment', 'AP Adjustment'), ap);
});

test('las dos rutas emiten exactamente el mismo OOXML', async () => {
  /* El contrato que impide que vuelvan a divergir: `docxRelleno.js` inserta la cadena de
     `ooxmlDeFormula` en el .docx del cliente y `docxWriter.js` construye el mismo párrafo con
     las clases de la librería `docx`. Si alguien toca una y no la otra, este test lo dice.
     Cualquiera de las dos formas de escribirlo es válida para Word; lo que no vale es que el
     informe salga distinto según por qué puerta entró la plantilla. */
  for (const [tipo, arbol] of [['AR', FORMULA_AR], ['AP', FORMULA_AP]]) {
    const doc = new Document({ sections: [{ children: [docxDeFormula(arbol)] }] });
    const xml = new PizZip(await Packer.toBuffer(doc)).file('word/document.xml').asText();
    const parrafo = /<w:p>.*?<\/w:p>/s.exec(xml);
    assert.ok(parrafo, `no se encontró el párrafo de ${tipo}`);
    assert.equal(parrafo[0], ooxmlDeFormula(arbol),
      `la ruta del .docx del cliente y la del calco del PDF no coinciden en ${tipo}`);
  }
});

test('el rótulo dice de qué ajuste es la ecuación, y sólo el rótulo', () => {
  assert.equal(tipoDeAjusteDe('FORMULA AJUSTE CUENTAS POR COBRAR'), 'AR');
  assert.equal(tipoDeAjusteDe('FORMULA AJUSTE CUENTAS POR PAGAR'), 'AP');
  /* Con tilde y en minúsculas, que es como puede quedar en el .docx del cliente. */
  assert.equal(tipoDeAjusteDe('Formula ajuste cuentas por pagar'), 'AP');
  /* El informe habla de cuentas por cobrar en decenas de párrafos y ninguno abre una ecuación. */
  assert.equal(tipoDeAjusteDe('2. Ajustes realizados a las Cuentas por Cobrar'), null);
  assert.equal(tipoDeAjusteDe(''), null);
});

test('la ecuación corrupta se reconoce por su firma, no por la racha de letras', () => {
  /* Lo que trae el PDF de referencia: «AP Adjustment» colapsado a `𝐴` U+1D434 y las barras y
     paréntesis extensibles como U+FFFD. */
  const real = '𝐴'.repeat(4) + ' ' + '𝐴'.repeat(20) + ' = ' + '�'.repeat(3)
    + '𝐴'.repeat(6) + '𝑇'.repeat(4) + ' (' + '𝑇'.repeat(4) + '𝐶'.repeat(8) + ')�';
  assert.ok(esFormulaCorrupta(real));

  /* Otro PDF, otro subconjunto de fuente: colapsa a la minúscula `𝑐` U+1D450 y a `𝑧` U+1D467.
     Contar «AAAA seguido de veinte A» no lo vería. */
  assert.ok(esFormulaCorrupta('𝑐'.repeat(30) + '�'.repeat(6) + ' = ' + '𝑧'.repeat(30)));

  /* Un bloque que `normalizarCaracteresMatematicos` ni siquiera sabe traducir: sans-serif
     itálico, U+1D608. Mirar el rango crudo es lo que lo cubre. */
  assert.ok(esFormulaCorrupta('\u{1D608}'.repeat(30) + '�'.repeat(6)));
});

test('la prosa del informe no se confunde con una ecuación', () => {
  assert.ok(!esFormulaCorrupta(
    'El monto nominal de las ventas netas de cada una de las empresas comparables'));
  /* Una letra matemática suelta en un párrafo de prosa: es lo que justifica que
     `normalizarCaracteresMatematicos` siga existiendo en vez de borrar el párrafo entero. */
  assert.ok(!esFormulaCorrupta('La tasa 𝐴 durante el año 2024 fue de 8,31 % EA'));
  assert.ok(!esFormulaCorrupta(''));
  assert.ok(!esFormulaCorrupta('2024'));
  assert.ok(!esFormulaCorrupta(null));
});
