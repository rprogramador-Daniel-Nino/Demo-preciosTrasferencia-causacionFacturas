/* Las ecuaciones de ajuste de capital, en un solo sitio.

   El informe lleva dos: el ajuste de las cuentas por cobrar (AR) y el de las cuentas por pagar
   (AP). Las emiten DOS rutas distintas —`docxRelleno.js` como cadena OOXML cruda sobre el .docx
   del cliente, `docxWriter.js` como objetos de la librería `docx` sobre el calco del PDF— y
   hasta ahora cada una llevaba su propia copia, que ya habían divergido.

   Compartir el markup no es posible: `ImportedXmlComponent.fromXmlString` de `docx@9.7.1`
   envuelve lo que se le pasa en un elemento `<undefined>`. Así que se comparte la DESCRIPCIÓN
   —el árbol de aquí abajo— y cada ruta la renderiza a su formato. `formulasOmml.test.js`
   compara byte a byte lo que sale por las dos, que es lo que impide que vuelvan a separarse.

   Por qué el .docx no lleva `Cambria Math` en un `w:rFonts` ni `xml:space="preserve"` en los
   `<m:t>`: `MathRun` de la librería sólo acepta `text`, así que ponerlos aquí rompería esa
   paridad sin que la otra ruta pudiera igualarla, y Word ya usa Cambria Math por defecto
   mientras `settings.xml` no declare otra en `m:mathFont`. Si algún día se comen los espacios
   alrededor de `=`, `∗` y `−`, lo que hay que escribir es `<m:mathPr>` en `word/settings.xml`,
   no un `rPr` por run. */

/* Nodos del árbol. `par` es un paréntesis que escala con su contenido (`m:d`), `frac` una
   fracción vertical (`m:f`) y `sub` un subíndice (`m:sSub`). */
const txt = (v) => ({ t: 'txt', v });
const sub = (base, indice) => ({ t: 'sub', base, indice });
const frac = (num, den) => ({ t: 'frac', num, den });
const par = (...hijos) => ({ t: 'par', hijos });

/* Los operadores son los que trae el PDF de referencia: `∗` U+2217 y `−` U+2212, no el
   asterisco ni el guion del teclado. */
const POR = ' ∗ ';
const MENOS = ' − ';

/* AR y AP son la misma ecuación: sólo cambia la cuenta que se promedia —ANC (cuentas por
   cobrar netas) o ANP (cuentas por pagar netas)— y la etiqueta.

   La forma es la de la plantilla:
     AP Adjustment = ( ( (ANP_TP / TNS_TP) ∗ (TNS_Comp) ) − ANP_COMP ) ∗ ( R / (1+R) )

   El `(1+R)` del denominador va como texto y no como `par`: en la plantilla esos paréntesis son
   de cuerpo normal, mientras que un `m:d` los estiraría al alto de la fracción. */
const formulaAjuste = (etiqueta, cuenta) => [
  txt(`${etiqueta} Adjustment = `),
  par(
    par(
      par(frac([sub(cuenta, 'TP')], [sub('TNS', 'TP')])),
      txt(POR),
      par(sub('TNS', 'Comp')),
    ),
    txt(MENOS),
    sub(cuenta, 'COMP'),
  ),
  txt(POR),
  par(frac([txt('R')], [txt('(1+R)')])),
];

export const FORMULA_AR = formulaAjuste('AR', 'ANC');
export const FORMULA_AP = formulaAjuste('AP', 'ANP');

export const FORMULAS = { AR: FORMULA_AR, AP: FORMULA_AP };

/* El rótulo que precede a cada ecuación en el informe. Se queda visible: en la plantilla se lee
   como un renglón más. Es una lista para poder admitir variantes sin tocar al que las busca. */
export const ROTULOS_FORMULA = {
  AR: ['FORMULA AJUSTE CUENTAS POR COBRAR'],
  AP: ['FORMULA AJUSTE CUENTAS POR PAGAR'],
};

/* La ecuación escrita en una línea. Es lo que se ve en la vista previa y en el HTML guardado;
   el .docx la sustituye por la ecuación de verdad. */
export const TEXTOS_PLANOS_FORMULA = {
  AR: 'AR Adjustment = (((ANC_TP / TNS_TP) * (TNS_Comp)) - ANC_COMP) * (R / (1+R))',
  AP: 'AP Adjustment = (((ANP_TP / TNS_TP) * (TNS_Comp)) - ANP_COMP) * (R / (1+R))',
};

/* Prefijo por el que se reconoce el texto lineal ya escrito en una plantilla guardada. Es más
   corto que el texto completo a propósito: las plantillas extraídas entre el 2026-08-13 y el
   lector 10 llevan la variante vieja (`* TNS_comp) - ANC_comp`), y este trozo es el que ambas
   comparten. */
export const PREFIJOS_PLANOS_FORMULA = {
  AR: 'AR Adjustment = (((ANC_TP / TNS_TP)',
  AP: 'AP Adjustment = (((ANP_TP / TNS_TP)',
};

const RX_ROTULO = /FORMULA\s+AJUSTE\s+CUENTAS\s+POR\s+(COBRAR|PAGAR)/i;

/* AR o AP según el rótulo, `null` si el texto no es uno. Sólo el rótulo decide: el informe
   menciona «cuentas por cobrar» en decenas de párrafos y ninguno abre una ecuación. */
export function tipoDeAjusteDe(texto) {
  const m = RX_ROTULO.exec(String(texto || ''));
  if (!m) return null;
  return m[1].toUpperCase() === 'COBRAR' ? 'AR' : 'AP';
}

/* Un párrafo que salió del editor de ecuaciones del PDF de referencia.

   El PDF usa una fuente matemática sin tabla `ToUnicode`, así que todas las letras de un mismo
   estilo llegan colapsadas al mismo code point del bloque matemático de Unicode —«AP Adjustment»
   sale como veinticuatro `𝐴`— y las barras de fracción y los paréntesis extensibles llegan como
   U+FFFD. Lo que se perdió no se puede recuperar leyendo: hay que reconocer el párrafo y volver
   a escribir la ecuación.

   Se reconoce por esa FIRMA y no por la racha de letras que salga al normalizar. Contar «AAAA
   seguido de veinte A» sólo vale para el informe con el que se escribió: qué letra colapsa
   depende del subconjunto de fuente que incruste cada PDF, y con otro subconjunto la
   comprobación falla en silencio y la basura llega al informe. Medido sobre las 112 páginas del
   informe de referencia, exactamente dos nodos pasan esta prueba y son las dos ecuaciones: 84
   caracteres sin contar espacios, 66 matemáticos, 8 de reemplazo y ni una letra ASCII. Los otros
   ~3900 nodos dan cero, así que el umbral va con cinco veces de margen.

   Mirar el rango crudo y no el resultado de `normalizarCaracteresMatematicos` cubre además los
   bloques que esa función no traduce —sans-serif itálico, fraktur, double-struck—, que son
   justamente los que se colarían enteros. */
export function esFormulaCorrupta(texto) {
  const s = String(texto || '');
  let matematicos = 0;
  let reemplazos = 0;
  let noEspacio = 0;
  for (const car of s) {
    if (/\s/.test(car)) continue;
    noEspacio++;
    const code = car.codePointAt(0);
    if (code >= 0x1D400 && code <= 0x1D7FF) matematicos++;
    else if (code === 0xFFFD) reemplazos++;
  }
  if (matematicos < 12) return false;
  return (matematicos + reemplazos) / noEspacio >= 0.5;
}

const escapar = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const mt = (v) => `<m:r><m:t>${escapar(v)}</m:t></m:r>`;

/* Recorre el árbol emitiendo OOXML. La forma de cada elemento —incluido el `<m:dPr/>` y el
   `<m:sSubPr/>` vacíos— es la que emite la librería `docx`, para que el test de paridad pueda
   comparar byte a byte. */
function nodosAOoxml(nodos) {
  return nodos.map((n) => {
    if (n.t === 'txt') return mt(n.v);
    if (n.t === 'sub') {
      return '<m:sSub><m:sSubPr/><m:e>' + mt(n.base) + '</m:e><m:sub>' + mt(n.indice) + '</m:sub></m:sSub>';
    }
    if (n.t === 'frac') {
      return '<m:f><m:num>' + nodosAOoxml(n.num) + '</m:num><m:den>' + nodosAOoxml(n.den) + '</m:den></m:f>';
    }
    if (n.t === 'par') {
      return '<m:d><m:dPr/><m:e>' + nodosAOoxml(n.hijos) + '</m:e></m:d>';
    }
    throw new Error(`nodo de fórmula desconocido: ${n && n.t}`);
  }).join('');
}

/* El párrafo completo, listo para insertarlo en `word/document.xml`. El orden de los atributos
   de `w:spacing` —`after` antes que `before`— también es el de la librería. */
export function ooxmlDeFormula(arbol) {
  return '<w:p><w:pPr><w:spacing w:after="120" w:before="120"/><w:jc w:val="center"/></w:pPr>'
    + '<m:oMath>' + nodosAOoxml(arbol) + '</m:oMath></w:p>';
}
