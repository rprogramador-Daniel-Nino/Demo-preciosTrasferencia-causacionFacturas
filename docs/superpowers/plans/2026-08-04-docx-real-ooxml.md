# El .docx real en OOXML — Plan de implementación

> **Para quien lo ejecute con agentes:** SUB-SKILL REQUERIDA: usar
> `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans`
> para implementar tarea por tarea. Los pasos van con casilla (`- [ ]`) para seguimiento.

**Objetivo:** generar el informe como `.docx` real (OOXML) desde el HTML que produce el
extractor, con paridad de hoja, márgenes, tipografía, tamaños de imagen y saltos de página
respecto de la vista previa.

**Arquitectura:** un módulo nuevo, `docxWriter.js`, recibe el HTML final y los recursos y
devuelve un `.docx`. No conoce el PDF ni precios de transferencia, así que se prueba entero con
`node --test` sin navegador. Las medidas y el estilo los lee de `estiloDocumento.js`, que ya es
la fuente única de la vista previa y del `.doc`. El HTML se recorre con un árbol propio, no con
DOM, porque en los tests no hay navegador.

**Stack:** `docx` 9.7.1 (recién instalado, escribe el OOXML), `pizzip` 3.2.0 (ya estaba, relee
el zip en los tests), `node --test`.

**Spec:** [`docs/superpowers/specs/2026-08-04-docx-real-ooxml-design.md`](../specs/2026-08-04-docx-real-ooxml-design.md),
que revisa [`2026-08-01-calco-docx-desde-pdf-design.md`](../specs/2026-08-01-calco-docx-desde-pdf-design.md).

## Restricciones globales

Se aplican a todas las tareas.

- **Todo en español**: código, comentarios, nombres de test, mensajes de la interfaz.
  `CLAUDE.md` lo exige.
- **No se toca `index.html`.** Todo el desarrollo nuevo va en `frontend/`.
- **El `.doc` actual no se retira.** El `.docx` es un botón nuevo al lado. Decisión del usuario.
- **Nada de placeholders visibles al usuario en español roto.** Los avisos van redactados.
- `npm test` debe quedar en verde tras cada tarea. Hoy son **425** tests.
- `npm run lint --prefix frontend` debe quedar con **0 errores** (los *warnings* preexistentes
  se dejan).
- **Unidades, medidas contra el PDF real** (`Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf`):
  - 1 cm = **566,929** twips. Hoja carta = **12240 × 15840** twips.
  - `transformation` de `ImageRun` va en **píxeles a 96 ppp**: 1 cm = **37,795** px.
    Comprobado: 100 unidades → 952500 EMU → 9525 EMU/unidad.
  - Tamaño de fuente en `docx` va en **medios puntos**: Arial 12 → `size: 24`.
  - Márgenes del informe: superior/izquierdo/derecho 2,5 cm, inferior 2 cm, encabezado y pie a
    1,25 cm del borde.
- **Trampas de `docx` que la skill documenta y hay que respetar:**
  - Las tablas necesitan `columnWidths` en la tabla **y** `width` en cada celda, las dos en
    `WidthType.DXA`. Los anchos de columna deben sumar el ancho de la tabla.
  - Sombreado de celda con `ShadingType.CLEAR`, nunca `SOLID` (sale negro).
  - Listas: jamás un `•` literal; `numbering` con `LevelFormat.BULLET`.
  - `ImageRun` exige `type` (`'png'`, `'jpeg'`…).
  - `PageBreak` va **dentro** de un `Paragraph`.
  - Nunca `\n` en un texto: un `Paragraph` por párrafo.
  - Para el índice, `PositionalTab` con `leader: DOT`, no puntos literales.
  - Los encabezados deben usar `HeadingLevel.*` de serie o el índice de Word no los ve.

---

### Tarea 1: Medidas compartidas en twips y píxeles

`estiloDocumento.js` ya es la fuente única de la hoja para el previo y el `.doc`. El `.docx`
necesita las mismas medidas en las unidades de OOXML. Van aquí y no en el writer para que no
pueda haber dos hojas distintas.

**Archivos:**
- Modificar: `frontend/src/services/estiloDocumento.js`
- Test: `frontend/src/services/estiloDocumento.test.js`

**Interfaces:**
- Consume y **ajusta**: `HOJA` (ya existe: `{ancho:'21.6cm', alto:'27.9cm', margen:'2.5cm', pie:'2cm', borde:'1.25cm', altoEncabezado:'1.5cm', conEncabezado:'3.4cm'}`).
  `ancho` pasa a `'21.59cm'` y `alto` a `'27.94cm'`, que es carta **exacta** (8,5 × 11 pulgadas).
  Hace falta: con 21,6 cm los twips salen 12246 y la restricción global exige 12240. Los
  valores que había eran un redondeo. El ajuste **se comenta en el código**, porque `HOJA` la
  consumen también la vista previa y el `.doc`: leerla y no entender por qué son 21,59 y no
  21,6 es exactamente lo que no debe pasar.
- Produce:
  - `cmATwips(cm: number): number`
  - `cmAPixeles(cm: number): number`
  - `medidaEnCm(valor: string): number` — `'2.5cm'` → `2.5`
  - `HOJA_TWIPS: { ancho, alto, margen, pie, borde }` — todos `number`

- [ ] **Paso 1: escribir el test que falla**

Añadir al final de `frontend/src/services/estiloDocumento.test.js`:

```js
test('la hoja en twips describe la misma hoja que la del previo', () => {
  /* El previo va en centímetros y OOXML en twips. Si las dos descripciones se separan, el
     .docx sale con otra hoja que la que se revisó en pantalla, y los saltos caen donde no
     van. Este test es el que lo impide. */
  assert.equal(cmATwips(2.54), 1440, 'una pulgada son 1440 twips');
  assert.equal(HOJA_TWIPS.ancho, 12240, 'carta: 8,5 pulgadas');
  assert.equal(HOJA_TWIPS.alto, 15840, 'carta: 11 pulgadas');
  /* Y salen de HOJA, no escritos a mano otra vez. */
  assert.equal(HOJA_TWIPS.margen, cmATwips(medidaEnCm(HOJA.margen)));
  assert.equal(HOJA_TWIPS.pie, cmATwips(medidaEnCm(HOJA.pie)));
  assert.equal(HOJA_TWIPS.borde, cmATwips(medidaEnCm(HOJA.borde)));
});

test('el tamaño de imagen se convierte a píxeles de 96 ppp, que es lo que quiere docx', () => {
  /* Comprobado contra docx 9.7.1: `transformation` produce 9525 EMU por unidad, es decir un
     píxel a 96 ppp. Con puntos (12700 EMU) las imágenes saldrían un 33 % más grandes, que es
     la clase de error que ya costó un documento de 834 páginas. */
  assert.equal(cmAPixeles(2.54), 96);
  assert.equal(cmAPixeles(5.53), 209, 'el logo del informe de referencia');
});

test('medidaEnCm lee las medidas del previo', () => {
  assert.equal(medidaEnCm('2.5cm'), 2.5);
  assert.equal(medidaEnCm('21.6cm'), 21.6);
  /* Sin unidad o con basura devuelve 0 y no NaN: un NaN en un twip produce un .docx que Word
     no abre, y el fallo aparecería lejos de aquí. */
  assert.equal(medidaEnCm('abc'), 0);
  assert.equal(medidaEnCm(undefined), 0);
});
```

Y ampliar el `import` de la cabecera del archivo para incluir
`cmATwips, cmAPixeles, medidaEnCm, HOJA_TWIPS`.

- [ ] **Paso 2: correr el test y ver que falla**

```bash
cd "D:/G/Juan-Mendez/Documents/Desarrollo/Demo-preciosTrasferencia-causacionFacturas"
npx --yes node --test frontend/src/services/estiloDocumento.test.js
```

Esperado: FALLA con `SyntaxError: The requested module './estiloDocumento.js' does not provide an export named 'cmATwips'`.

- [ ] **Paso 3: implementar**

En `frontend/src/services/estiloDocumento.js`, justo debajo de la constante `HOJA`:

```js
/* OOXML mide en twips: 1/20 de punto, 1440 por pulgada, 566,929 por centímetro. La hoja del
   previo y la del .docx tienen que ser la misma, así que las dos salen de `HOJA`. */
const TWIPS_POR_CM = 1440 / 2.54;

/* `docx` mide las imágenes en píxeles de 96 ppp: comprobado contra la versión 9.7.1, que
   emite 9525 EMU por unidad, y 9525 × 96 = 914400 EMU = una pulgada. Con puntos las imágenes
   saldrían un 33 % más grandes. */
const PIXELES_POR_CM = 96 / 2.54;

export const cmATwips = (cm) => Math.round((Number(cm) || 0) * TWIPS_POR_CM);
export const cmAPixeles = (cm) => Math.round((Number(cm) || 0) * PIXELES_POR_CM);

/* `'2.5cm'` → `2.5`. Devuelve 0 y no NaN ante cualquier cosa que no sepa leer: un NaN metido
   en un twip produce un .docx que Word no abre, y el fallo aparecería muy lejos de aquí. */
export const medidaEnCm = (valor) => {
  const m = /^([\d.]+)\s*cm$/.exec(String(valor || '').trim());
  return m ? Number(m[1]) : 0;
};

export const HOJA_TWIPS = {
  ancho: cmATwips(medidaEnCm(HOJA.ancho)),
  alto: cmATwips(medidaEnCm(HOJA.alto)),
  margen: cmATwips(medidaEnCm(HOJA.margen)),
  pie: cmATwips(medidaEnCm(HOJA.pie)),
  borde: cmATwips(medidaEnCm(HOJA.borde)),
};
```

- [ ] **Paso 4: correr los tests**

```bash
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `fail 0`, y el total sube de 425 a 428.

- [ ] **Paso 5: commit**

```bash
git add frontend/src/services/estiloDocumento.js frontend/src/services/estiloDocumento.test.js
git commit -m "feat: las medidas de la hoja también en twips y en píxeles de 96 ppp

Las necesita OOXML, y salen de la misma constante HOJA que ya usan la vista previa y el
.doc, con un test que afirma que las dos descripciones son la misma hoja. El factor de
píxeles va comprobado contra docx 9.7.1: 9525 EMU por unidad, es decir 96 ppp. Con puntos
las imágenes saldrían un 33 % más grandes."
```

---

### Tarea 2: Recorrer el HTML sin navegador

El writer tiene que recorrer el HTML final. En el navegador habría `DOMParser`; en `node --test`
no hay DOM, y meter `jsdom` sería una dependencia grande para leer un HTML que nosotros mismos
generamos. El extractor emite un conjunto cerrado de etiquetas (`MAPA_ETIQUETAS` en
`pdfReferenceExtractor.js`), así que un recorrido propio basta — y es lo que permite probar el
writer entero con `node --test`.

Tiene que ser **tolerante**: el HTML también puede venir de `mammoth` (un `.docx` subido) o del
`contentEditable` del previo, donde el navegador mete etiquetas que no controlamos. Una etiqueta
desconocida no se pierde: se vuelve transparente y sus hijos siguen.

**Archivos:**
- Crear: `frontend/src/services/htmlAArbol.js`
- Test: `frontend/src/services/htmlAArbol.test.js`

**Interfaces:**
- Produce:
  - `htmlAArbol(html: string): Nodo` — devuelve la raíz, `{ etiqueta: '#raiz', atributos: {}, hijos: [] }`
  - Nodo elemento: `{ etiqueta: string, atributos: Record<string,string>, hijos: Nodo[] }`
  - Nodo texto: `{ texto: string }`
  - `textoDe(nodo: Nodo): string` — todo el texto de un subárbol, concatenado

- [ ] **Paso 1: escribir el test que falla**

Crear `frontend/src/services/htmlAArbol.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlAArbol, textoDe } from './htmlAArbol.js';

test('lee elementos, atributos y texto', () => {
  const r = htmlAArbol('<p class="x">hola <strong>mundo</strong></p>');
  assert.equal(r.hijos.length, 1);
  const p = r.hijos[0];
  assert.equal(p.etiqueta, 'p');
  assert.equal(p.atributos.class, 'x');
  assert.equal(p.hijos[0].texto, 'hola ');
  assert.equal(p.hijos[1].etiqueta, 'strong');
  assert.equal(textoDe(p), 'hola mundo');
});

test('las etiquetas vacías no se tragan lo que viene detrás', () => {
  /* `<img>` y `<br>` no cierran. Tratarlas como abiertas dejaba todo el resto del documento
     colgando dentro de la imagen. */
  const r = htmlAArbol('<p><img data-recurso="a" style="width:1cm;height:2cm" />después</p>');
  const p = r.hijos[0];
  assert.equal(p.hijos[0].etiqueta, 'img');
  assert.equal(p.hijos[0].atributos['data-recurso'], 'a');
  assert.equal(p.hijos[0].atributos.style, 'width:1cm;height:2cm');
  assert.equal(p.hijos[0].hijos.length, 0);
  assert.equal(p.hijos[1].texto, 'después');
});

test('desanida bien varios niveles', () => {
  const r = htmlAArbol('<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>');
  const tabla = r.hijos[0];
  assert.equal(tabla.etiqueta, 'table');
  assert.equal(tabla.hijos[0].etiqueta, 'tr');
  assert.equal(tabla.hijos[0].hijos.length, 2);
  assert.equal(textoDe(tabla), 'ab');
});

test('una etiqueta desconocida se vuelve transparente y no pierde su contenido', () => {
  /* El previo es contentEditable: el navegador mete `<font>`, `<b>`, `<div>` al editar. Que
     una etiqueta que no conocemos borre el texto que lleva dentro sería perder contenido de un
     documento que se radica. */
  const r = htmlAArbol('<p>a<font color="red">b</font>c</p>');
  assert.equal(textoDe(r), 'abc');
});

test('una etiqueta sin cerrar no rompe el árbol', () => {
  /* Cierra sola al terminar el HTML en vez de lanzar. Un HTML editado a mano puede llegar
     mal formado, y un throw aquí dejaría al usuario sin documento y sin explicación. */
  const r = htmlAArbol('<p>a<strong>b');
  assert.equal(textoDe(r), 'ab');
});

test('los comentarios y las entidades no se cuelan como texto', () => {
  const r = htmlAArbol('<p><!--FIG:1:0-->a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;</p>');
  assert.equal(textoDe(r), 'a & b <c> "d" \'e\'');
});

test('cierra las etiquetas mal anidadas sin perder texto', () => {
  const r = htmlAArbol('<p><strong>a</p><p>b</p>');
  assert.equal(textoDe(r), 'ab');
  assert.equal(r.hijos.length, 2);
});
```

- [ ] **Paso 2: correr el test y ver que falla**

```bash
npx --yes node --test frontend/src/services/htmlAArbol.test.js
```

Esperado: FALLA con `Cannot find module ... htmlAArbol.js`.

- [ ] **Paso 3: implementar**

Crear `frontend/src/services/htmlAArbol.js`:

```js
/* Recorrido del HTML sin DOM.

   El writer del .docx tiene que recorrer el HTML final, y en `node --test` no hay navegador.
   Meter `jsdom` sería una dependencia grande para leer un HTML que produce este mismo
   proyecto: el extractor emite un conjunto cerrado de etiquetas. Con esto el writer se prueba
   entero sin navegador, que es la lección de los cuatro fallos que sólo se veían abriendo Word.

   Es tolerante a propósito. El HTML también llega de `mammoth` y del `contentEditable` del
   previo, donde el navegador mete etiquetas que no controlamos: una etiqueta desconocida se
   vuelve transparente y sus hijos siguen, en vez de perderse. Perder texto de un documento que
   se radica ante la DIAN es el peor resultado posible. */

/* No cierran, así que no abren ámbito. Tratarlas como abiertas dejaba todo el resto del
   documento colgando dentro de la imagen. */
const VACIAS = new Set(['img', 'br', 'hr', 'meta', 'link', 'input', 'col']);

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '—', ndash: '–',
};

const desescapar = (s) =>
  s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (todo, cuerpo) => {
    if (cuerpo[0] === '#') {
      const n = cuerpo[1] === 'x' || cuerpo[1] === 'X'
        ? parseInt(cuerpo.slice(2), 16) : parseInt(cuerpo.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : todo;
    }
    const v = ENTIDADES[cuerpo.toLowerCase()];
    return v === undefined ? todo : v;
  });

const leerAtributos = (texto) => {
  const attrs = {};
  const rx = /([a-zA-Z_:][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = rx.exec(texto))) {
    attrs[m[1].toLowerCase()] = desescapar(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return attrs;
};

export function htmlAArbol(html) {
  const raiz = { etiqueta: '#raiz', atributos: {}, hijos: [] };
  const pila = [raiz];
  const cima = () => pila[pila.length - 1];

  /* Un solo recorrido: etiqueta de cierre, comentario, etiqueta de apertura, o texto. */
  const rx = /<\/([a-zA-Z][-\w:]*)\s*>|<!--[\s\S]*?-->|<([a-zA-Z][-\w:]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|<[^>]*>/g;
  let ultimo = 0;
  let m;

  const empujarTexto = (bruto) => {
    if (!bruto) return;
    const texto = desescapar(bruto);
    if (texto) cima().hijos.push({ texto });
  };

  while ((m = rx.exec(html))) {
    empujarTexto(html.slice(ultimo, m.index));
    ultimo = rx.lastIndex;

    if (m[1]) {
      /* Cierre. Se busca hacia arriba en vez de exigir que sea la cima: así un
         `<p><strong>a</p>` cierra el `strong` de paso en vez de descuadrar el resto. */
      const etiqueta = m[1].toLowerCase();
      const i = pila.map((n) => n.etiqueta).lastIndexOf(etiqueta);
      if (i > 0) pila.length = i;
      continue;
    }
    if (m[2]) {
      const etiqueta = m[2].toLowerCase();
      const nodo = { etiqueta, atributos: leerAtributos(m[3] || ''), hijos: [] };
      cima().hijos.push(nodo);
      const cierraSola = /\/\s*$/.test(m[3] || '');
      if (!VACIAS.has(etiqueta) && !cierraSola) pila.push(nodo);
      continue;
    }
    /* Comentario o etiqueta ilegible: se descarta sin tocar la pila. */
  }
  empujarTexto(html.slice(ultimo));
  return raiz;
}

/* Todo el texto de un subárbol. Es lo que permite decidir si un bloque está vacío. */
export function textoDe(nodo) {
  if (!nodo) return '';
  if (nodo.texto !== undefined) return nodo.texto;
  return (nodo.hijos || []).map(textoDe).join('');
}
```

- [ ] **Paso 4: correr los tests**

```bash
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `fail 0`, total 435.

- [ ] **Paso 5: commit**

```bash
git add frontend/src/services/htmlAArbol.js frontend/src/services/htmlAArbol.test.js
git commit -m "feat: recorrido del HTML sin DOM, para poder probar el writer sin navegador

El writer del .docx tiene que recorrer el HTML final y en node --test no hay DOM. jsdom
sería una dependencia grande para leer un HTML que produce este mismo proyecto. Con esto el
writer se prueba entero sin navegador, que es justo lo que faltaba: los cuatro fallos de
formato de esta sesión vivían en el único trozo sin tests porque necesitaba Word.

Tolerante a propósito: el HTML también llega de mammoth y del contentEditable del previo.
Una etiqueta desconocida se vuelve transparente y sus hijos siguen, y una sin cerrar cierra
sola al terminar, en vez de lanzar. Perder texto de un documento que se radica ante la DIAN
es el peor resultado posible."
```

---

### Tarea 3: El esqueleto del writer — hoja, estilo base y pie con el campo PAGE

Primer `.docx` que abre en Word: una sección carta con los márgenes del informe, la tipografía
que anotó el extractor y el pie con el campo `PAGE`. Sin contenido todavía.

**Archivos:**
- Crear: `frontend/src/services/docxWriter.js`
- Test: `frontend/src/services/docxWriter.test.js`

**Interfaces:**
- Consume: `HOJA_TWIPS`, `cmATwips`, `cmAPixeles`, `medidaEnCm` (tarea 1); `htmlAArbol`, `textoDe` (tarea 2); `estiloBaseDe` de `pdfReferenceExtractor.js` (ya existe, devuelve `{familia, tamano}` o `null`)
- Produce:
  - `construirDocumento({ html, recursos, anexo }): Document` — el objeto de `docx`, para poder probarlo sin empaquetar
  - `aDocxBuffer({ html, recursos, anexo }): Promise<Buffer>` — para los tests
  - `aDocxBlob({ html, recursos, anexo }): Promise<Blob>` — para el navegador

- [ ] **Paso 1: escribir el test que falla**

Crear `frontend/src/services/docxWriter.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import PizZip from 'pizzip';
import { aDocxBuffer } from './docxWriter.js';
import { HOJA_TWIPS } from './estiloDocumento.js';

/* Relee el .docx generado. Es lo que hace que todo esto se pueda probar sin Word. */
const abrir = async (html, recursos = [], anexo = []) => {
  const zip = new PizZip(await aDocxBuffer({ html, recursos, anexo }));
  const leer = (p) => (zip.file(p) ? zip.file(p).asText() : null);
  return { zip, leer, doc: leer('word/document.xml') };
};

test('el .docx trae las partes que Word necesita', async () => {
  const { zip } = await abrir('<div class="pagina" data-pagina="1"><p>hola</p></div>');
  for (const parte of [
    '[Content_Types].xml', '_rels/.rels', 'word/document.xml',
    'word/_rels/document.xml.rels', 'word/styles.xml', 'word/footer1.xml',
  ]) {
    assert.ok(zip.file(parte), 'falta ' + parte);
  }
});

test('la hoja del .docx es la misma que la del previo', async () => {
  /* Si se separan, los saltos que se ven en pantalla caen donde no van. */
  const { doc } = await abrir('<p>hola</p>');
  assert.match(doc, new RegExp('w:w="' + HOJA_TWIPS.ancho + '"'));
  assert.match(doc, new RegExp('w:h="' + HOJA_TWIPS.alto + '"'));
  assert.match(doc, new RegExp('w:top="' + HOJA_TWIPS.margen + '"'));
  assert.match(doc, new RegExp('w:bottom="' + HOJA_TWIPS.pie + '"'));
  assert.match(doc, new RegExp('w:footer="' + HOJA_TWIPS.borde + '"'));
});

test('la tipografía sale del informe, no de un gusto propio', async () => {
  /* El extractor la anota en el HTML al leer las fuentes del PDF. En medios puntos: 10 pt son
     20. Se usa a propósito una tipografía DISTINTA de la de reserva (Arial 12): con Arial 12
     el test pasaría igual si el writer ignorara el HTML y escribiera Arial a mano, y entonces
     no demostraría nada. Junto con el test siguiente, el par distingue los dos casos. */
  const { leer } = await abrir(
    '<div data-extractor="7" data-estilo-base="Times New Roman|10"></div><p>hola</p>');
  const estilos = leer('word/styles.xml');
  assert.match(estilos, /w:ascii="Times New Roman"/);
  assert.match(estilos, /w:sz w:val="20"/);
});

test('sin marca de tipografía cae en Arial 12, no en una serif de pantalla', async () => {
  const { leer } = await abrir('<p>hola</p>');
  assert.match(leer('word/styles.xml'), /w:ascii="Arial"/);
  assert.match(leer('word/styles.xml'), /w:sz w:val="24"/);
});

test('el pie lleva el campo PAGE de Word, no un número literal', async () => {
  /* Un número literal miente en cuanto Word repagina. */
  const { leer } = await abrir('<p>hola</p>');
  assert.match(leer('word/footer1.xml'), /PAGE/);
});

test('el texto del documento llega', async () => {
  const { doc } = await abrir('<p>informe local de precios de transferencia</p>');
  assert.match(doc, /informe local de precios de transferencia/);
});
```

- [ ] **Paso 2: correr el test y ver que falla**

```bash
npx --yes node --test frontend/src/services/docxWriter.test.js
```

Esperado: FALLA con `Cannot find module ... docxWriter.js`.

- [ ] **Paso 3: implementar**

Crear `frontend/src/services/docxWriter.js`:

```js
/* HTML final + recursos → .docx real (OOXML).

   No conoce el PDF ni precios de transferencia: recibe HTML y devuelve un zip. Esa frontera es
   lo que lo hace probable con `node --test` sin navegador, y es la lección de los cuatro
   fallos de formato que sólo se veían abriendo Word —834 páginas, una hoja por párrafo, los
   dos logos encimados, el resaltado colándose—: todos vivían en el único trozo sin tests.

   Las medidas y el estilo NO se deciden aquí. Salen de `estiloDocumento.js`, que es la misma
   fuente que pinta la vista previa. Es lo que da la paridad que se pidió. */

import {
  Document, Packer, Paragraph, TextRun, Footer, PageNumber, AlignmentType,
} from 'docx';
import { HOJA_TWIPS } from './estiloDocumento.js';
import { estiloBaseDe } from './pdfReferenceExtractor.js';
import { htmlAArbol } from './htmlAArbol.js';

/* `docx` mide las fuentes en medios puntos: Arial 12 son 24. */
const mediosPuntos = (pt) => Math.round((Number(pt) || 12) * 2);

const PAGINA = {
  size: { width: HOJA_TWIPS.ancho, height: HOJA_TWIPS.alto },
  margin: {
    top: HOJA_TWIPS.margen, right: HOJA_TWIPS.margen,
    bottom: HOJA_TWIPS.pie, left: HOJA_TWIPS.margen,
    header: HOJA_TWIPS.borde, footer: HOJA_TWIPS.borde,
  },
};

/* El pie es la numeración, y va con el campo PAGE de Word. El número literal que traía el PDF
   mentiría en cuanto Word repagine. */
const pieConNumero = () => new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '666666' })],
  })],
});

export function construirDocumento({ html = '', recursos = [], anexo = [] } = {}) {
  const base = estiloBaseDe(html) || { familia: 'Arial', tamano: 12 };
  const arbol = htmlAArbol(html);

  /* Provisional en esta tarea: un párrafo por el texto que haya. Las tareas siguientes
     sustituyen esto por la traducción completa. */
  const hijos = cuerpoProvisional(arbol);

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: base.familia || 'Arial', size: mediosPuntos(base.tamano) },
          paragraph: { spacing: { line: 276 } },
        },
      },
    },
    sections: [{
      properties: { page: PAGINA },
      footers: { default: pieConNumero() },
      children: hijos.length ? hijos : [new Paragraph('')],
    }],
  });
}

/* Se retira en la tarea 4. */
function cuerpoProvisional(nodo, salida = []) {
  for (const h of nodo.hijos || []) {
    if (h.texto !== undefined) {
      if (h.texto.trim()) salida.push(new Paragraph(h.texto));
    } else {
      cuerpoProvisional(h, salida);
    }
  }
  return salida;
}

export const aDocxBuffer = (args) => Packer.toBuffer(construirDocumento(args));
export const aDocxBlob = (args) => Packer.toBlob(construirDocumento(args));
```

**Nota para quien implemente:** `recursos` y `anexo` todavía no se usan. Están en la firma desde
el principio para que las tareas siguientes no cambien la interfaz que ya consume la 11.

- [ ] **Paso 4: correr los tests**

```bash
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `fail 0`, total 441.

- [ ] **Paso 5: commit**

```bash
git add frontend/src/services/docxWriter.js frontend/src/services/docxWriter.test.js frontend/package.json frontend/package-lock.json
git commit -m "feat: esqueleto del writer de .docx — hoja, tipografía del informe y pie con PAGE

Primer .docx real que abre en Word: sección carta con los márgenes del informe, la
tipografía que anotó el extractor al leer las fuentes del PDF, y el pie con el campo PAGE de
Word en vez del número literal del PDF, que mentiría al repaginar.

La hoja no se decide aquí: sale de las mismas constantes que pinta la vista previa, con un
test que afirma que las dos son la misma hoja.

Entra la dependencia docx 9.7.1, decidida en el spec. pizzip, que ya estaba, se usa en los
tests para releer el zip: es lo que permite probar todo esto sin Word."
```

---

### Tarea 4: Párrafos, encabezados y runs con estilo

**Archivos:**
- Modificar: `frontend/src/services/docxWriter.js`
- Test: `frontend/src/services/docxWriter.test.js`

**Interfaces:**
- Produce (internas del módulo, no exportadas): `runsDe(nodo, heredado)`, `parrafoDe(nodo, nivel)`

- [ ] **Paso 1: escribir el test que falla**

Añadir a `frontend/src/services/docxWriter.test.js`:

```js
test('la negrita y la cursiva del informe llegan al .docx', async () => {
  const { doc } = await abrir(
    '<p>normal <strong>negrita</strong> <em>cursiva</em></p>');
  assert.match(doc, /<w:b\/>/, 'no hay negrita');
  assert.match(doc, /<w:i\/>/, 'no hay cursiva');
});

test('la negrita anidada en un span con familia propia no se pierde', async () => {
  /* Es la forma exacta que emite el extractor, y en el .doc hubo que forzarla con CSS. */
  const { doc } = await abrir(
    '<p><strong><span style="font-family:\'Britannic\'">TÍTULO</span></strong></p>');
  assert.match(doc, /<w:b\/>/);
  assert.match(doc, /w:ascii="Britannic"/);
  assert.match(doc, /TÍTULO/);
});

test('los encabezados usan los estilos de serie, o el índice de Word no los ve', async () => {
  const { doc } = await abrir('<h1>UNO</h1><h2>DOS</h2><h3>TRES</h3><h4>CUATRO</h4>');
  for (const estilo of ['Heading1', 'Heading2', 'Heading3', 'Heading4']) {
    assert.match(doc, new RegExp('w:val="' + estilo + '"'), 'falta ' + estilo);
  }
});

test('los párrafos van justificados, como el informe', async () => {
  const { doc } = await abrir('<p>texto</p>');
  assert.match(doc, /w:val="both"/);
});

test('el resaltado de pantalla no llega al documento', async () => {
  /* En el .doc se colaba y cada dato sustituido salía más negrita y con aire a los lados. */
  const { doc } = await abrir('<p>NIT <span class="pt-valor">900123456-7</span></p>');
  assert.match(doc, /900123456-7/);
  assert.doesNotMatch(doc, /pt-valor/);
  assert.doesNotMatch(doc, /F0FDF4/);
});

test('un párrafo vacío sigue siendo un párrafo', async () => {
  /* El informe centra la portada con párrafos vacíos: 35 seguidos. Descartarlos movería la
     portada entera. */
  const { doc } = await abrir('<p></p><p></p><p>algo</p>');
  assert.equal((doc.match(/<w:p[ >]/g) || []).length >= 3, true);
});
```

- [ ] **Paso 2: correr y ver que falla**

```bash
npx --yes node --test frontend/src/services/docxWriter.test.js
```

Esperado: FALLA en el primero, `no hay negrita`.

- [ ] **Paso 3: implementar**

En `docxWriter.js`, ampliar el `import` de `docx` con `HeadingLevel`, y sustituir
`cuerpoProvisional` por:

```js
const NIVELES = {
  h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3, h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6,
};

/* La familia que declara un `<span style="font-family:'X'">`. El extractor sólo la declara
   cuando se desvía del cuerpo del documento. */
const familiaDeEstilo = (estilo) => {
  const m = /font-family:\s*'?([^;'"]+)'?/.exec(estilo || '');
  return m ? m[1].trim() : null;
};

/* Texto del subárbol convertido a runs, arrastrando el estilo heredado. `<strong>` y `<em>`
   son las dos etiquetas que el extractor emite para el estilo de fuente; una familia propia
   llega en el `style` de un `<span>`.

   `pt-valor` no se mira a propósito: el resaltado del valor sustituido es de pantalla. En el
   .doc se colaba y cada dato sustituido salía más negrita y con aire a los lados. */
function runsDe(nodo, heredado = {}) {
  const salida = [];
  for (const h of nodo.hijos || []) {
    if (h.texto !== undefined) {
      if (h.texto) salida.push(new TextRun({ text: h.texto, ...heredado }));
      continue;
    }
    if (h.etiqueta === 'img') { salida.push(...runDeImagen(h)); continue; }
    if (h.etiqueta === 'br') continue;
    const propio = { ...heredado };
    if (h.etiqueta === 'strong' || h.etiqueta === 'b') propio.bold = true;
    if (h.etiqueta === 'em' || h.etiqueta === 'i') propio.italics = true;
    const familia = familiaDeEstilo(h.atributos && h.atributos.style);
    if (familia) propio.font = familia;
    salida.push(...runsDe(h, propio));
  }
  return salida;
}

/* Se completa en la tarea 7. */
function runDeImagen() { return []; }

function parrafoDe(nodo) {
  const nivel = NIVELES[nodo.etiqueta];
  const hijos = runsDe(nodo);
  return new Paragraph({
    ...(nivel ? { heading: nivel } : { alignment: AlignmentType.JUSTIFIED }),
    children: hijos,
  });
}

/* Recorre el HTML y emite bloques. Las etiquetas que no son bloque se atraviesan, que es lo
   que permite que un `<div>` del contentEditable no pierda su contenido. */
function bloquesDe(nodo, salida = []) {
  for (const h of nodo.hijos || []) {
    if (h.texto !== undefined) {
      if (h.texto.trim()) salida.push(new Paragraph({ children: [new TextRun(h.texto)] }));
      continue;
    }
    if (h.etiqueta === 'p' || NIVELES[h.etiqueta]) { salida.push(parrafoDe(h)); continue; }
    bloquesDe(h, salida);
  }
  return salida;
}
```

y en `construirDocumento` cambiar `const hijos = cuerpoProvisional(arbol);` por
`const hijos = bloquesDe(arbol);`.

- [ ] **Paso 4: correr los tests**

```bash
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `fail 0`, total 447.

- [ ] **Paso 5: commit**

```bash
git add frontend/src/services/docxWriter.js frontend/src/services/docxWriter.test.js
git commit -m "feat: párrafos, encabezados y runs con la negrita y la cursiva del informe

Los encabezados usan los estilos de serie de Word (Heading1-4): con estilos propios el
índice de Word no los ve. La negrita anidada en un span con familia propia —que es la forma
exacta que emite el extractor— llega intacta, sin necesidad de forzarla con CSS como hacía
falta en el .doc.

El resaltado de pantalla del valor sustituido no se mira: es de pantalla, y en el .doc se
colaba. Hay un test que lo fija.

Los párrafos vacíos se conservan: el informe centra la portada con 35 seguidos, y
descartarlos movería la portada entera."
```

---

### Tarea 5: Las entradas del índice con guía de puntos

Las 89 entradas del índice traen el título, una fila de puntos y el número de página. Emitir los
puntos como texto es lo que hacía que el índice se viera desordenado: al cambiar la métrica de
la fuente, la fila de puntos deja de terminar donde debe. Word tiene un tabulador para esto.

**Archivos:**
- Modificar: `frontend/src/services/docxWriter.js`
- Test: `frontend/src/services/docxWriter.test.js`

- [ ] **Paso 1: escribir el test que falla**

```js
test('las entradas del índice llevan la guía de puntos de Word, no puntos de texto', async () => {
  /* Con puntos literales, la fila deja de terminar donde debe en cuanto cambia la métrica de
     la fuente: es lo que hacía que el índice se viera desordenado. */
  const { doc } = await abrir(
    '<p>1.2. Derechos y Obligaciones ........................ 25</p>');
  assert.match(doc, /w:leader="dot"/, 'no hay guía de puntos');
  assert.match(doc, /1\.2\. Derechos y Obligaciones/);
  assert.match(doc, /25/);
  /* Y los puntos literales desaparecen. */
  assert.doesNotMatch(doc, /\.{8}/);
});

test('un párrafo con puntos suspensivos normales no se confunde con el índice', async () => {
  /* Hacen falta muchos puntos seguidos y un número al final para que sea una entrada. */
  const { doc } = await abrir('<p>y así sucesivamente... hasta el final</p>');
  assert.doesNotMatch(doc, /w:leader="dot"/);
  assert.match(doc, /hasta el final/);
});
```

- [ ] **Paso 2: correr y ver que falla**

Esperado: FALLA con `no hay guía de puntos`.

- [ ] **Paso 3: implementar**

Ampliar el `import` de `docx` con `PositionalTab, PositionalTabAlignment, PositionalTabLeader`,
y añadir antes de `parrafoDe`:

```js
/* Una entrada del índice: título, un espacio, uno o más puntos, y el número de página al final
   de la línea.

   Basta UN punto, y esto es una decisión medida, no un descuido. Con cuatro —que es lo que se
   pidió primero— la entrada «1.5 Razones de rechazo (Filtros Cuantitativos – Filtros
   Cualitativos) . 33» del informe de referencia se quedaba sin detectar y salía sin alinear,
   con el punto y el número pegados al texto.

   Lo que impide el falso positivo no es la cantidad de puntos, es exigir **espacio antes del
   punto y sólo cifras hasta el final de la línea**. Comprobado contra los casos reales del
   informe: «El margen fue de 3.5 puntos porcentuales en 2024» no encaja porque no hay punto
   justo antes del número; «Ver anexo A ....... y también el B» tampoco, porque no acaba en
   cifra; y unos puntos suspensivos sin número al final tampoco. Queda un caso ambiguo de
   verdad —una frase que acabe en punto seguido de una cifra, «según la norma. 2024»— que es
   raro y se ve al revisar. */
const RX_ENTRADA_INDICE = /^(.*?\S)\s+\.+\s*(\d+)\s*$/;

/* El título y el número, con el tabulador de Word en medio. Es lo que mantiene la fila de
   puntos pegada al margen derecho cuando la métrica de la fuente cambia. */
const parrafoDeIndice = (titulo, numero, runs) => new Paragraph({
  children: [new TextRun({
    ...(runs[0] && runs[0].constructor ? {} : {}),
    children: [
      titulo,
      new PositionalTab({
        alignment: PositionalTabAlignment.RIGHT,
        leader: PositionalTabLeader.DOT,
        relativeTo: 'margin',
      }),
      numero,
    ],
    bold: true,
  })],
});
```

y en `parrafoDe`, antes de construir el párrafo normal:

```js
function parrafoDe(nodo) {
  const nivel = NIVELES[nodo.etiqueta];
  const hijos = runsDe(nodo);

  /* Entrada del índice: se detecta sobre el texto plano del bloque. El extractor ya pone cada
     entrada en su propio párrafo (rol TOCI), así que el texto del bloque es la entrada
     completa. */
  if (!nivel) {
    const m = RX_ENTRADA_INDICE.exec(textoDe(nodo));
    if (m && m[1].trim()) return parrafoDeIndice(m[1].trim(), m[2], hijos);
  }

  return new Paragraph({
    ...(nivel ? { heading: nivel } : { alignment: AlignmentType.JUSTIFIED }),
    children: hijos,
  });
}
```

Añadir `textoDe` al `import` de `./htmlAArbol.js`.

**Nota:** en `parrafoDeIndice`, quitar el `...(runs[0] && ...)` — es ruido; el párrafo del
índice se construye desde el texto, no desde los runs, porque la guía de puntos sustituye los
puntos que venían dentro. Dejar la firma como `parrafoDeIndice(titulo, numero)` y ajustar la
llamada.

- [ ] **Paso 4: correr los tests**

```bash
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `fail 0`, total 449.

- [ ] **Paso 5: commit**

```bash
git add frontend/src/services/docxWriter.js frontend/src/services/docxWriter.test.js
git commit -m "feat: el índice con la guía de puntos de Word en vez de puntos de texto

Las 89 entradas traen título, una fila de puntos y el número de página. Con puntos literales
la fila deja de terminar donde debe en cuanto cambia la métrica de la fuente, que es lo que
hacía que el índice se viera desordenado. Word tiene un tabulador para esto (PositionalTab
con guía de puntos), y mantiene el número pegado al margen.

Se exige un número al final para no confundir unos puntos suspensivos con una entrada."
```

---

### Tarea 6: Tablas

**Archivos:**
- Modificar: `frontend/src/services/docxWriter.js`
- Test: `frontend/src/services/docxWriter.test.js`

- [ ] **Paso 1: escribir el test que falla**

```js
test('las tablas salen como tablas de Word, con anchos en DXA', async () => {
  /* La skill de docx lo marca como trampa: hacen falta columnWidths en la tabla Y width en
     cada celda, las dos en DXA. Con porcentajes, Google Docs rompe. */
  const { doc } = await abrir(
    '<table><tr><th>Concepto</th><th>Valor</th></tr>' +
    '<tr><td>Activo</td><td>1.000</td></tr></table>');
  assert.match(doc, /<w:tbl>/);
  assert.match(doc, /<w:tblGrid>/);
  assert.match(doc, /w:type="dxa"/);
  assert.match(doc, /Concepto/);
  assert.match(doc, /1\.000/);
  assert.equal((doc.match(/<w:tr[ >]/g) || []).length, 2, 'deben ser dos filas');
});

test('los anchos de columna suman el ancho de la caja de texto', async () => {
  /* Si no suman, Word recalcula y las columnas salen donde quiera. La caja del informe mide
     21,6 − 2 × 2,5 = 16,6 cm. */
  const { doc } = await abrir('<table><tr><td>a</td><td>b</td><td>c</td></tr></table>');
  const grid = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(doc)[1];
  const anchos = [...grid.matchAll(/w:w="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(anchos.length, 3);
  const caja = HOJA_TWIPS.ancho - 2 * HOJA_TWIPS.margen;
  assert.ok(Math.abs(anchos.reduce((a, b) => a + b, 0) - caja) <= 3,
    'los anchos suman ' + anchos.reduce((a, b) => a + b, 0) + ' y la caja mide ' + caja);
});

test('una fila sin celdas no produce una tabla inválida', async () => {
  /* El PDF cuelga un `P` vacío de cada `TR`. En el .doc eso fue un documento de 834 páginas
     porque Word sacaba el párrafo de la tabla. Aquí una fila que se queda sin celdas
     simplemente no se emite. */
  const { doc } = await abrir('<table><tr><p></p></tr><tr><td>a</td></tr></table>');
  assert.equal((doc.match(/<w:tr[ >]/g) || []).length, 1);
  assert.match(doc, /<w:tbl>/);
});

test('una tabla sin ninguna fila válida no se emite', async () => {
  const { doc } = await abrir('<table><tr><p></p></tr></table><p>después</p>');
  assert.doesNotMatch(doc, /<w:tbl>/);
  assert.match(doc, /después/);
});
```

- [ ] **Paso 2: correr y ver que falla**

Esperado: FALLA, no hay `<w:tbl>`.

- [ ] **Paso 3: implementar**

Ampliar el `import` de `docx` con `Table, TableRow, TableCell, WidthType, ShadingType,
BorderStyle`, y añadir:

```js
/* Ancho de la caja de texto: la hoja menos los dos márgenes. Las tablas del informe la ocupan
   entera. */
const CAJA_TEXTO = HOJA_TWIPS.ancho - 2 * HOJA_TWIPS.margen;

const BORDE = { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' };

/* Celdas de una fila. Un hijo que no es celda se descarta: el PDF cuelga un `P` vacío de cada
   `TR`, y en el .doc eso costó un documento de 834 páginas porque Word sacaba el párrafo de la
   tabla y la partía. Aquí no hay importador que lo interprete, pero tampoco hay razón para
   emitirlo. */
const celdasDe = (fila) =>
  (fila.hijos || []).filter((c) => c.etiqueta === 'td' || c.etiqueta === 'th');

function tablaDe(nodo) {
  const filas = [];
  /* Las filas pueden venir envueltas en `<thead>`/`<tbody>` si el HTML pasó por el navegador. */
  const recogerFilas = (n) => {
    for (const h of n.hijos || []) {
      if (h.texto !== undefined) continue;
      if (h.etiqueta === 'tr') filas.push(h);
      else recogerFilas(h);
    }
  };
  recogerFilas(nodo);

  const conCeldas = filas.filter((f) => celdasDe(f).length > 0);
  if (!conCeldas.length) return null;

  /* Los anchos tienen que sumar el ancho de la tabla o Word recalcula. Se reparte a partes
     iguales sobre el número máximo de celdas: el árbol del PDF no expone ColSpan ni RowSpan
     —está medido en el spec— así que no hay geometría de columna que respetar. El último
     absorbe el resto de la división. */
  const columnas = Math.max(...conCeldas.map((f) => celdasDe(f).length));
  const ancho = Math.floor(CAJA_TEXTO / columnas);
  const anchos = Array.from({ length: columnas }, (_, i) =>
    (i === columnas - 1 ? CAJA_TEXTO - ancho * (columnas - 1) : ancho));

  return new Table({
    columnWidths: anchos,
    width: { size: CAJA_TEXTO, type: WidthType.DXA },
    rows: conCeldas.map((f) => new TableRow({
      children: celdasDe(f).map((c, i) => new TableCell({
        width: { size: anchos[i] ?? ancho, type: WidthType.DXA },
        /* CLEAR y no SOLID: la skill lo marca porque SOLID sale negro. */
        ...(c.etiqueta === 'th'
          ? { shading: { type: ShadingType.CLEAR, fill: '0E1726' } } : {}),
        borders: { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE },
        children: bloquesDe(c).length ? bloquesDe(c)
          : [new Paragraph({ children: runsDe(c) })],
      })),
    })),
  });
}
```

y en `bloquesDe`, antes de la recursión final:

```js
    if (h.etiqueta === 'table') {
      const t = tablaDe(h);
      if (t) salida.push(t);
      continue;
    }
```

**Nota sobre la celda de encabezado:** el fondo `0E1726` con letra blanca es el estilo de la
casa que ya usan el previo y el `.doc` (`REGLAS_DOCUMENTO` en `estiloDocumento.js`). Para que la
letra salga blanca hay que pasar `color: 'FFFFFF'` a los runs de una celda `th`: añadirlo en la
llamada a `runsDe(c, { color: 'FFFFFF' })` cuando `c.etiqueta === 'th'`, y en `bloquesDe` no
aplica porque los `th` del informe llevan texto directo.

- [ ] **Paso 4: correr los tests**

```bash
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `fail 0`, total 453.

- [ ] **Paso 5: commit**

```bash
git add frontend/src/services/docxWriter.js frontend/src/services/docxWriter.test.js
git commit -m "feat: las tablas del informe como tablas de Word

Con columnWidths en la tabla y width en cada celda, las dos en DXA: la skill de docx lo
marca como trampa porque con porcentajes Google Docs rompe. Los anchos suman exactamente el
ancho de la caja de texto, o Word los recalcula y las columnas salen donde quiera. Hay un
test que comprueba la suma.

Una fila sin celdas no se emite y una tabla sin filas válidas tampoco. El PDF cuelga un P
vacío de cada TR, y en el .doc eso costó un documento de 834 páginas porque Word lo sacaba
de la tabla y la partía en pedazos.

Sin colspan ni rowspan: el árbol del PDF no los expone. Es la pérdida declarada en el spec."
```

---

### Tarea 7: Imágenes con el tamaño del PDF, y listas

**Archivos:**
- Modificar: `frontend/src/services/docxWriter.js`
- Test: `frontend/src/services/docxWriter.test.js`

- [ ] **Paso 1: escribir el test que falla**

```js
/* PNG de 1×1 válido, para no depender del PDF real en los tests de unidad. */
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
  'AAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

test('las imágenes van como binario en word/media, no en base64', async () => {
  /* En el .doc iban en base64 dentro del propio archivo y pesaba 3,3 MB. */
  const { zip } = await abrir(
    '<p><img data-recurso="logo" style="width:5.53cm;height:1.23cm" /></p>',
    [{ id: 'logo', dataUrl: PNG_1x1 }]);
  const media = Object.keys(zip.files).filter((f) => /^word\/media\/.+\./.test(f));
  assert.equal(media.length, 1, 'debe haber un archivo por imagen');
  assert.match(zip.file('word/_rels/document.xml.rels').asText(), /media\//);
});

test('la imagen sale con el tamaño que le da el PDF, no con el natural del PNG', async () => {
  /* Este es el fallo que produjo "una página por cada separación entre párrafos": sin tamaño,
     la figura de la página 11 medía 29,9 cm sobre papel de 21,6 y Word repartía el desborde
     en hojas nuevas. 5,53 cm × 37,795 px/cm = 209 px, y docx emite 9525 EMU por px. */
  const { doc } = await abrir(
    '<p><img data-recurso="logo" style="width:5.53cm;height:1.23cm" /></p>',
    [{ id: 'logo', dataUrl: PNG_1x1 }]);
  const m = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(doc);
  assert.ok(m, 'la imagen no se emitió');
  assert.equal(Number(m[1]), 209 * 9525);
  assert.equal(Number(m[2]), 47 * 9525);
});

test('una imagen cuyo recurso no está en el catálogo no rompe el documento', async () => {
  /* Pasa si el catálogo y la plantilla se desincronizan. Mejor un hueco que un throw que deja
     al usuario sin documento. */
  const { doc } = await abrir(
    '<p>antes<img data-recurso="fantasma" style="width:1cm;height:1cm" />después</p>');
  assert.match(doc, /antes/);
  assert.match(doc, /después/);
});

test('las listas usan viñetas de Word, no un punto escrito a mano', async () => {
  /* La skill lo marca: un `•` literal no es una lista y no se puede renumerar. */
  const { doc } = await abrir('<ul><li>uno</li><li>dos</li></ul>');
  assert.match(doc, /<w:numPr>/, 'no hay numeración de lista');
  assert.match(doc, /uno/);
  assert.match(doc, /dos/);
  assert.doesNotMatch(doc, /•/);
});
```

- [ ] **Paso 2: correr y ver que falla**

Esperado: FALLA con `debe haber un archivo por imagen`.

- [ ] **Paso 3: implementar**

Ampliar el `import` de `docx` con `ImageRun, LevelFormat`, e importar
`cmAPixeles, medidaEnCm` de `./estiloDocumento.js`. Añadir:

```js
/* De data URL a bytes. Las imágenes van como binario en `word/media/`: en el .doc iban en
   base64 dentro del propio archivo y pesaba 3,3 MB. */
function bytesDeDataUrl(dataUrl) {
  const m = /^data:image\/([a-z+]+);base64,(.*)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const tipo = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
  const b64 = m[2];
  /* `atob` en el navegador, `Buffer` en Node. */
  const bytes = typeof Buffer !== 'undefined'
    ? Buffer.from(b64, 'base64')
    : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return { tipo, bytes };
}

/* El tamaño del `style` de la marca, que es el que el PDF le da. `transformation` va en
   píxeles de 96 ppp: comprobado contra docx 9.7.1, que emite 9525 EMU por unidad. */
function tamanoDeImagen(estilo) {
  const ancho = medidaEnCm((/width:\s*([\d.]+cm)/.exec(estilo || '') || [])[1]);
  const alto = medidaEnCm((/height:\s*([\d.]+cm)/.exec(estilo || '') || [])[1]);
  if (!ancho || !alto) return null;
  return { width: cmAPixeles(ancho), height: cmAPixeles(alto) };
}
```

Sustituir el `runDeImagen` provisional. Como necesita el catálogo, se pasa por un cierre: en
`construirDocumento`, antes de `bloquesDe`, definir

```js
  const porId = new Map((recursos || []).map((r) => [r.id, r.dataUrl]));
```

y hacer que `runsDe`, `parrafoDe`, `bloquesDe` y `tablaDe` reciban `porId` como último
parámetro, o —más simple y sin hilar el parámetro por cinco funciones— construir el cuerpo
dentro de una función que cierre sobre `porId`. Se recomienda lo segundo: mover `runsDe`,
`parrafoDe`, `bloquesDe`, `tablaDe` y `runDeImagen` dentro de una función
`traductor(porId, base)` que las devuelva, y llamarla desde `construirDocumento`. El
`runDeImagen` real:

```js
  /* Una imagen cuyo recurso no está en el catálogo no rompe el documento: se emite nada y el
     texto de alrededor sigue. Pasa si el catálogo y la plantilla se desincronizan, y un throw
     dejaría al usuario sin documento y sin explicación. */
  const runDeImagen = (nodo) => {
    const id = nodo.atributos['data-recurso'];
    const dataUrl = porId.get(id) || nodo.atributos.src;
    const datos = bytesDeDataUrl(dataUrl);
    const tamano = tamanoDeImagen(nodo.atributos.style);
    if (!datos || !tamano) {
      if (id) console.warn('[docxWriter] imagen sin recurso o sin tamaño: ' + id);
      return [];
    }
    return [new ImageRun({ type: datos.tipo, data: datos.bytes, transformation: tamano })];
  };
```

Para las listas, en `bloquesDe`:

```js
    if (h.etiqueta === 'ul' || h.etiqueta === 'ol') {
      for (const li of h.hijos || []) {
        if (li.etiqueta !== 'li') continue;
        salida.push(new Paragraph({
          numbering: { reference: 'vinetas', level: 0 },
          children: runsDe(li),
        }));
      }
      continue;
    }
```

y declarar la numeración en `construirDocumento`, dentro del `new Document({...})`:

```js
    /* Viñeta de Word, no un `•` escrito a mano: un carácter literal no es una lista y no se
       puede renumerar ni sangrar. */
    numbering: {
      config: [{
        reference: 'vinetas',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '\u2022',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      }],
    },
```

- [ ] **Paso 4: correr los tests**

```bash
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `fail 0`, total 457.

- [ ] **Paso 5: commit**

```bash
git add frontend/src/services/docxWriter.js frontend/src/services/docxWriter.test.js
git commit -m "feat: imágenes con el tamaño del PDF y como binario, y listas con viñeta de Word

El tamaño sale del style de la marca, que es el que el PDF le da. Es el fallo que produjo
\"una página por cada separación entre párrafos\": sin tamaño, la figura de la página 11
medía 29,9 cm sobre papel de 21,6 y Word repartía el desborde en hojas nuevas. La conversión
va comprobada: 1 cm son 37,795 px de 96 ppp y docx emite 9525 EMU por px.

Van como binario en word/media con una relación cada una. En el .doc iban en base64 dentro
del archivo y pesaba 3,3 MB.

Una imagen cuyo recurso no está en el catálogo no rompe el documento: hueco y aviso por
consola, en vez de un throw que deja al usuario sin nada.

Las listas con numbering y LevelFormat.BULLET: un punto literal no es una lista."
```

---

### Tarea 8: Páginas, saltos duros y la sección apaisada

El extractor envuelve cada página del original en `<div class="pagina" data-pagina="N">` pero
**no emite la orientación**, y el spec anterior midió que 1 de las 112 es apaisada. Esta tarea
la añade (versión 8 del lector) y el writer la usa para abrir sección nueva.

**Archivos:**
- Modificar: `frontend/src/services/pdfReferenceExtractor.js`
- Modificar: `frontend/src/services/docxWriter.js`
- Test: `frontend/src/services/pdfReferenceExtractor.test.js`, `frontend/src/services/docxWriter.test.js`

- [ ] **Paso 1: escribir los tests que fallan**

En `pdfReferenceExtractor.test.js`:

```js
test('cada página dice su orientación, y hay una apaisada', async () => {
  const r = await extraer();
  const orientaciones = [...r.html.matchAll(/data-orientacion="(\w+)"/g)].map((m) => m[1]);
  assert.equal(orientaciones.length, 112, 'todas las páginas deben decir su orientación');
  const apaisadas = orientaciones.filter((o) => o === 'apaisada').length;
  /* Medido sobre el PDF real: 111 verticales y 1 apaisada. Sin esto, esa página sale vertical
     y su contenido no cabe. */
  assert.equal(apaisadas, 1, 'debe haber exactamente una apaisada');
});
```

En `docxWriter.test.js`:

```js
test('cada página del original empieza en una hoja nueva', async () => {
  const html = '<div class="pagina" data-pagina="1" data-orientacion="vertical"><p>una</p></div>' +
    '<div class="pagina" data-pagina="2" data-orientacion="vertical"><p>dos</p></div>' +
    '<div class="pagina" data-pagina="3" data-orientacion="vertical"><p>tres</p></div>';
  const { doc } = await abrir(html);
  /* Dos saltos para tres páginas: la primera no lleva salto delante. */
  assert.equal((doc.match(/<w:br w:type="page"\/>/g) || []).length, 2);
});

test('la página apaisada abre su propia sección', async () => {
  const html = '<div class="pagina" data-pagina="1" data-orientacion="vertical"><p>a</p></div>' +
    '<div class="pagina" data-pagina="2" data-orientacion="apaisada"><p>b</p></div>' +
    '<div class="pagina" data-pagina="3" data-orientacion="vertical"><p>c</p></div>';
  const { doc } = await abrir(html);
  assert.match(doc, /w:orient="landscape"/, 'no hay página apaisada');
  /* Tres secciones: vertical, apaisada, vertical. */
  assert.equal((doc.match(/<w:sectPr/g) || []).length, 3);
});

test('sin páginas marcadas se emite una sola sección', async () => {
  /* La plantilla maestra y un .docx por mammoth no traen páginas. Mejor un documento corrido
     que una paginación inventada. */
  const { doc } = await abrir('<p>a</p><p>b</p>');
  assert.equal((doc.match(/<w:sectPr/g) || []).length, 1);
  assert.doesNotMatch(doc, /<w:br w:type="page"\/>/);
});
```

- [ ] **Paso 2: correr y ver que fallan**

Esperado: el del extractor FALLA con `todas las páginas deben decir su orientación` (0 ≠ 112).

- [ ] **Paso 3: implementar**

En `pdfReferenceExtractor.js`:

1. En el bucle de páginas, guardar la orientación junto a lo leído. Donde hoy dice
   `leidas.push({ pagina: n, arbol, porId, textoPlano });`, pasar a:

```js
    /* Orientación de la página. El informe de referencia trae una apaisada de 112, y sin
       decirlo esa página sale vertical y su contenido no cabe. */
    const orientacion = dimPagina.ancho > dimPagina.alto ? 'apaisada' : 'vertical';
    leidas.push({ pagina: n, arbol, porId, textoPlano, orientacion });
```

2. Donde se envuelve cada página (el `'<div class="pagina" data-pagina="' + b.pagina + '">'`),
   añadir el atributo. El bloque `b` tiene que arrastrar la orientación: al construir `bloques`
   desde `leidas`, incluir `orientacion` en el objeto devuelto, y luego:

```js
      '<div class="pagina" data-pagina="' + b.pagina +
      '" data-orientacion="' + b.orientacion + '">'
```

3. Subir la versión:

```js
     8 — la orientación de cada página, para la sección apaisada */
export const VERSION_EXTRACTOR = 8;
```

4. Añadir el aviso en `loQueFaltaPorVersion`, antes del `if (version < 7)`:

```js
  if (version < 8) {
    falta.push('las páginas no dicen su orientación, así que la página apaisada del ' +
               'informe sale vertical y su contenido no cabe');
  }
```

En `docxWriter.js`, sustituir la construcción de una sección única por secciones agrupadas:

```js
/* Las páginas del original, agrupadas en tandas de la misma orientación. Cada tanda es una
   sección de Word, porque la orientación es una propiedad de la sección. Dentro de una tanda,
   un salto de página duro entre página y página: es lo que hace que la página N empiece donde
   debe. Word repagina, así que si el contenido de una no cabe desborda a una hoja extra —eso
   no lo evita nada—, pero ya no hay un importador de HTML añadiendo desbordes propios. */
function paginasDe(arbol) {
  const paginas = [];
  const buscar = (n) => {
    for (const h of n.hijos || []) {
      if (h.texto !== undefined) continue;
      const clase = (h.atributos && h.atributos.class) || '';
      if (/\bpagina\b/.test(clase)) {
        paginas.push({
          nodo: h,
          orientacion: (h.atributos['data-orientacion'] === 'apaisada')
            ? 'apaisada' : 'vertical',
        });
        continue;
      }
      buscar(h);
    }
  };
  buscar(arbol);
  return paginas;
}

const tandasDe = (paginas) => paginas.reduce((tandas, p) => {
  const ultima = tandas[tandas.length - 1];
  if (ultima && ultima.orientacion === p.orientacion) ultima.paginas.push(p.nodo);
  else tandas.push({ orientacion: p.orientacion, paginas: [p.nodo] });
  return tandas;
}, []);
```

y en `construirDocumento`:

```js
  const paginas = paginasDe(arbol);

  /* Sin páginas marcadas —la plantilla maestra, o un .docx por mammoth— se emite una sola
     sección corrida. Mejor eso que inventar una paginación que el original no tiene. */
  const secciones = paginas.length
    ? tandasDe(paginas).map((t, iTanda) => ({
      properties: {
        page: t.orientacion === 'apaisada'
          ? { ...PAGINA, size: { ...PAGINA.size, orientation: PageOrientation.LANDSCAPE } }
          : PAGINA,
      },
      footers: { default: pieConNumero() },
      children: t.paginas.flatMap((nodo, i) => [
        /* Salto delante de cada página menos de la primera de todas: la primera tanda ya
           empieza en la hoja 1, y una tanda nueva ya empieza en hoja nueva por ser sección. */
        ...(i === 0 ? [] : [new Paragraph({ children: [new PageBreak()] })]),
        ...bloquesDe(nodo),
      ]),
    }))
    : [{
      properties: { page: PAGINA },
      footers: { default: pieConNumero() },
      children: bloquesDe(arbol).length ? bloquesDe(arbol) : [new Paragraph('')],
    }];
```

Ampliar el `import` de `docx` con `PageBreak, PageOrientation`.

- [ ] **Paso 4: correr los tests**

```bash
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `fail 0`, total 461.

- [ ] **Paso 5: commit**

```bash
git add frontend/src/services/pdfReferenceExtractor.js frontend/src/services/docxWriter.js frontend/src/services/pdfReferenceExtractor.test.js frontend/src/services/docxWriter.test.js
git commit -m "feat: cada página del original empieza donde debe, y la apaisada abre su sección

El extractor pasa a decir la orientación de cada página (versión 8). El informe de
referencia trae una apaisada de 112, y sin decirlo esa página sale vertical y su contenido
no cabe.

El writer agrupa las páginas en tandas de la misma orientación —una sección de Word cada
tanda, porque la orientación es propiedad de la sección— y mete un salto duro entre página y
página. Es el calco página por página que se pidió.

Word repagina: si el contenido de una página no cabe, desborda a una hoja extra, y eso no lo
evita nada. Lo que cambia es que ya no hay un importador de HTML añadiendo desbordes propios,
que es de donde salían las 834 páginas.

Sin páginas marcadas se emite una sola sección corrida: mejor eso que inventar una
paginación que el original no tiene."
```

---

### Tarea 9: Encabezado con el logo, y la portada sin él

**Archivos:**
- Modificar: `frontend/src/services/docxWriter.js`
- Test: `frontend/src/services/docxWriter.test.js`

- [ ] **Paso 1: escribir el test que falla**

```js
const ENCABEZADO = '<div data-encabezado="1" data-lado="derecha" data-desde-pagina="5">' +
  '<img data-recurso="logo" style="width:5.53cm;height:1.23cm" /></div>';

test('el logo va en el encabezado de página, una sola vez', async () => {
  /* En el .doc llegó a repetirse 96 veces dentro del cuerpo. */
  const { zip, doc } = await abrir(
    ENCABEZADO + '<div class="pagina" data-pagina="1"><p>a</p></div>',
    [{ id: 'logo', dataUrl: PNG_1x1 }]);
  assert.ok(zip.file('word/header1.xml'), 'no hay encabezado');
  assert.match(zip.file('word/header1.xml').asText(), /<w:drawing>/);
  /* Y no se queda además en el cuerpo. */
  assert.doesNotMatch(doc, /data-encabezado/);
  assert.equal((doc.match(/<w:drawing>/g) || []).length, 0,
    'el logo del encabezado no debe estar también en el cuerpo');
});

test('el encabezado va al lado que dice el PDF', async () => {
  const { zip } = await abrir(ENCABEZADO + '<p>a</p>', [{ id: 'logo', dataUrl: PNG_1x1 }]);
  assert.match(zip.file('word/header1.xml').asText(), /w:val="right"/);
});

test('si el informe no lleva encabezado en la portada, la portada va sin él', async () => {
  /* Ponerlo en la primera lo superponía con el logo grande de la portada: son los dos logos
     encimados que se veían en el .doc. */
  const { doc } = await abrir(ENCABEZADO + '<p>a</p>', [{ id: 'logo', dataUrl: PNG_1x1 }]);
  assert.match(doc, /<w:titlePg\/>/);
});

test('si el encabezado empieza en la página 1, no se activa la primera distinta', async () => {
  const enc = '<div data-encabezado="1" data-lado="centro" data-desde-pagina="1">' +
    '<img data-recurso="logo" style="width:2cm;height:1cm" /></div>';
  const { doc } = await abrir(enc + '<p>a</p>', [{ id: 'logo', dataUrl: PNG_1x1 }]);
  assert.doesNotMatch(doc, /<w:titlePg\/>/);
});

test('un documento sin encabezado no declara uno vacío', async () => {
  const { zip } = await abrir('<p>a</p>');
  assert.equal(zip.file('word/header1.xml'), null);
});
```

- [ ] **Paso 2: correr y ver que falla**

Esperado: FALLA con `no hay encabezado`.

- [ ] **Paso 3: implementar**

Ampliar el `import` de `docx` con `Header`. En `docxWriter.js`, añadir:

```js
/* El logo que el extractor apartó como encabezado, con su lado y su primera página. Los tres
   datos los midió el extractor sobre el PDF (versión 7): el del informe de referencia va a la
   derecha y empieza en la página 5. Una plantilla anterior no los trae y se cae a centrado y a
   imprimirlo también en la portada, que es lo que se hacía antes. */
function encabezadoDe(html) {
  const m = /<div data-encabezado="1"([^>]*)>([\s\S]*?)<\/div>/.exec(html);
  if (!m) return null;
  const lado = (/data-lado="([^"]+)"/.exec(m[1]) || [])[1] || 'centro';
  const desde = Number((/data-desde-pagina="(\d+)"/.exec(m[1]) || [])[1] || 1);
  return { bloque: m[0], contenido: m[2], lado, enLaPortada: desde <= 1 };
}

const ALINEACION = {
  derecha: AlignmentType.RIGHT,
  izquierda: AlignmentType.LEFT,
  centro: AlignmentType.CENTER,
};
```

En `construirDocumento`, antes de armar el árbol:

```js
  const enc = encabezadoDe(html);
  /* El encabezado se saca del cuerpo: si se queda, el logo sale además como primera imagen
     del documento. En el .doc llegó a repetirse 96 veces. */
  const cuerpo = enc ? html.replace(enc.bloque, '') : html;
  const arbol = htmlAArbol(cuerpo);
```

(y usar `cuerpo` en lugar de `html` en `estiloBaseDe`… **no**: `estiloBaseDe` lee la marca
`data-extractor`, que está en otro div, así que puede seguir leyendo `html`. Dejarlo en `html`.)

Construir el encabezado y pasarlo a cada sección:

```js
  const cabecera = enc
    ? new Header({
      children: [new Paragraph({
        alignment: ALINEACION[enc.lado] || AlignmentType.CENTER,
        children: runsDe(htmlAArbol(enc.contenido)),
      })],
    })
    : null;
```

y en cada objeto de sección, sustituir
`footers: { default: pieConNumero() },` por

```js
      ...(cabecera ? { headers: { default: cabecera } } : {}),
      footers: { default: pieConNumero() },
```

y en `properties` de la **primera** sección añadir `titlePage` cuando corresponda:

```js
      properties: {
        page: ...,
        /* `titlePage` deja la primera página sin encabezado: Word sólo sabe distinguir la
           primera de las demás. El informe de referencia no lo lleva hasta la página 5, así
           que las páginas 2 a 4 seguirán llevándolo. Para eso harían falta más secciones, y
           esto ya quita el solape con el logo grande de la portada. */
        ...(iTanda === 0 && cabecera && !enc.enLaPortada ? { titlePage: true } : {}),
      },
```

- [ ] **Paso 4: correr los tests**

```bash
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `fail 0`, total 466.

- [ ] **Paso 5: commit**

```bash
git add frontend/src/services/docxWriter.js frontend/src/services/docxWriter.test.js
git commit -m "feat: el logo en el encabezado de página, a su lado, y la portada sin él

El encabezado se declara una vez en header1.xml y se saca del cuerpo: si se queda, el logo
sale además como primera imagen del documento, y en el .doc llegó a repetirse 96 veces.

El lado sale del PDF (el del informe va a la derecha) y la portada va sin encabezado, porque
el informe no lo lleva hasta la página 5. Ponerlo en la primera lo superponía con el logo
grande de la portada: son los dos logos encimados que se veían.

Word sólo distingue la primera página de las demás, así que las páginas 2 a 4 seguirán
llevándolo aunque el original no lo tenga. Queda dicho en el código."
```

---

### Tarea 10: El anexo de estados financieros

**Archivos:**
- Modificar: `frontend/src/services/docxWriter.js`
- Test: `frontend/src/services/docxWriter.test.js`

- [ ] **Paso 1: escribir el test que falla**

```js
const HUECO = '<div class="pagina" data-pagina="98">' +
  '<div data-hueco="anexo_eeff" data-id="hueco_98">' +
  '<p>[Falta el anexo de estados financieros firmados — corresponde a la página 98 del ' +
  'informe de referencia. Adjúntelo antes de radicar.]</p></div></div>';

test('con el anexo subido, sus páginas entran en el sitio del hueco', async () => {
  const { doc } = await abrir(HUECO, [], [PNG_1x1]);
  assert.match(doc, /<w:drawing>/, 'la página del anexo no entró');
  /* Y el texto del hueco desaparece: ya no falta nada. */
  assert.doesNotMatch(doc, /Falta el anexo/);
});

test('sin anexo subido, el hueco se ve y dice qué falta', async () => {
  /* Un div vacío no se ve ni en pantalla ni en Word, y las 15 páginas del anexo desaparecían
     sin dejar rastro. El informe se radica ante la DIAN: que diga qué falta es lo mínimo. */
  const { doc } = await abrir(HUECO, [], []);
  assert.match(doc, /Falta el anexo de estados financieros firmados/);
});

test('las páginas del anexo se reparten en orden entre los huecos', async () => {
  const dos = HUECO + HUECO.replace(/98/g, '99');
  const { doc } = await abrir(dos, [], [PNG_1x1, PNG_1x1]);
  assert.equal((doc.match(/<w:drawing>/g) || []).length, 2);
});

test('con menos páginas de anexo que huecos, los que sobran siguen avisando', async () => {
  const dos = HUECO + HUECO.replace(/98/g, '99');
  const { doc } = await abrir(dos, [], [PNG_1x1]);
  assert.equal((doc.match(/<w:drawing>/g) || []).length, 1);
  assert.match(doc, /Falta el anexo/);
});
```

- [ ] **Paso 2: correr y ver que falla**

Esperado: FALLA con `la página del anexo no entró`.

- [ ] **Paso 3: implementar**

En `docxWriter.js`, dentro de la función que cierra sobre `porId`, añadir un contador de huecos
consumidos y el manejo del bloque de hueco en `bloquesDe`:

```js
  /* Las páginas del anexo se reparten en orden entre los huecos que dejó el extractor. Si hay
     menos que huecos, los que sobran siguen avisando de lo que falta.

     No se copian las páginas escaneadas del año anterior: el informe se radica ante la DIAN, y
     un calco perfecto con los estados financieros firmados del año equivocado dentro es peor
     que un hueco evidente. */
  let siguienteAnexo = 0;

  const bloqueDeHueco = (nodo) => {
    const pagina = anexo[siguienteAnexo];
    if (!pagina) return bloquesDe(nodo);
    siguienteAnexo += 1;
    const datos = bytesDeDataUrl(pagina);
    if (!datos) return bloquesDe(nodo);
    /* La página del anexo ocupa la caja de texto entera, manteniendo su proporción no se puede
       saber sin decodificar el PNG: se usa el ancho de la caja y el alto proporcional a una
       hoja carta, que es de lo que son estos escaneos. */
    const anchoPx = cmAPixeles(medidaEnCm(HOJA.ancho) - 2 * medidaEnCm(HOJA.margen));
    return [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({
        type: datos.tipo, data: datos.bytes,
        transformation: { width: anchoPx, height: Math.round(anchoPx * 11 / 8.5) },
      })],
    })];
  };
```

y en `bloquesDe`, antes de la recursión final:

```js
    if (h.atributos && h.atributos['data-hueco'] === 'anexo_eeff') {
      salida.push(...bloqueDeHueco(h));
      continue;
    }
```

Importar `HOJA` de `./estiloDocumento.js`.

- [ ] **Paso 4: correr los tests**

```bash
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `fail 0`, total 470.

- [ ] **Paso 5: commit**

```bash
git add frontend/src/services/docxWriter.js frontend/src/services/docxWriter.test.js
git commit -m "feat: el anexo de estados financieros entra en el sitio de su hueco

Las páginas subidas se reparten en orden entre los quince huecos que deja el extractor. Si
hay menos que huecos, los que sobran siguen avisando de lo que falta: un div vacío no se ve
ni en pantalla ni en Word, y las quince páginas desaparecían sin dejar rastro.

No se copian las páginas escaneadas del año anterior. El informe se radica ante la DIAN, y
un calco perfecto con los estados financieros firmados del año equivocado dentro es peor que
un hueco evidente."
```

---

### Tarea 11: El botón en la interfaz

**Archivos:**
- Modificar: `frontend/src/components/ReporteGenerador.jsx`

**Interfaces:**
- Consume: `aDocxBlob({ html, recursos, anexo })` de `docxWriter.js`

- [ ] **Paso 1: añadir el botón y la descarga**

En los `import` de `ReporteGenerador.jsx`:

```js
import { aDocxBlob } from '../services/docxWriter.js';
```

Junto a `handleDownload`, añadir:

```js
  /* Descarga en .docx real (OOXML). Convive con el .doc y no lo reemplaza: el equipo toca este
     flujo, y tener los dos permite comparar el mismo estudio en los dos formatos.

     A diferencia del .doc, aquí no hay importador de HTML de Word interpretando nada: lo que
     el writer escribe es lo que Word abre. Los cuatro fallos de formato que costó el .doc
     —834 páginas por párrafos colgando de una fila, una hoja por párrafo por imágenes sin
     tamaño, los dos logos encimados y el resaltado de pantalla colándose— eran todos ese
     importador. */
  const [generandoDocx, setGenerandoDocx] = useState(false);

  const descargarDocx = async () => {
    setGenerandoDocx(true);
    try {
      const blob = await aDocxBlob({
        html: htmlContent,
        recursos: recursosCargados,
        anexo: study.eeffImages || [],
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Informe_Local_PT_' + (study.ent || 'Empresa') + '_' +
        (study.anio || '') + '.docx';
      a.click();
      URL.revokeObjectURL(a.href);

      /* Cuántas hojas produce Word sólo se sabe abriéndolo, así que no se afirma un número:
         se dice cuántas declara el documento. Prometer una cuenta que no se ha medido es
         justamente lo que hay que no hacer aquí. */
      const declaradas = (htmlContent.match(/class="pagina"/g) || []).length;
      if (declaradas) {
        setAvisos((previos) => [...previos, {
          nivel: 'aviso',
          texto: 'El documento declara ' + declaradas + ' páginas, una por cada página del ' +
            'informe de referencia. Word repagina al abrirlo: si el contenido de alguna no ' +
            'cabe, desborda a una hoja extra. Compara el total con el original antes de radicar.',
        }]);
      }
    } catch (err) {
      console.error('No se pudo generar el .docx:', err);
      alert('No se pudo generar el .docx: ' + err.message +
        '\n\nEl botón de .doc sigue disponible.');
    } finally {
      setGenerandoDocx(false);
    }
  };
```

Y el botón, justo antes del de `.doc` (el que dice `Descargar Word (.doc)`):

```jsx
          <button
            onClick={descargarDocx}
            disabled={generandoDocx}
            title="Word real (OOXML): saltos de página, encabezado y tablas exactos"
            className="flex items-center gap-2 bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white rounded-lg px-4 py-2 text-xs font-semibold transition-colors shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileDown className="w-3.5 h-3.5" />
            {generandoDocx ? 'Generando…' : 'Descargar Word (.docx)'}
          </button>
```

Y cambiar el texto del botón existente de `Descargar Word (.doc)` a
`Descargar .doc (anterior)`, con `className` en gris para que el `.docx` sea el principal:
sustituir `bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white` por
`bg-white dark:bg-[#262626] text-[#334155] dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 hover:bg-[#f8fafc] dark:hover:bg-zinc-800`.

- [ ] **Paso 2: comprobar que compila y que el lint pasa**

```bash
npm run lint --prefix frontend 2>&1 | grep -cE " error "
npm run build --prefix frontend 2>&1 | tail -2
```

Esperado: 0 errores de lint, `✓ built`.

- [ ] **Paso 3: prueba manual en el navegador**

```bash
npm start
```

Abrir `http://localhost:3000/gestor-reportes/`, entrar en un estudio con plantilla, y comprobar:
- Los dos botones están, el `.docx` en verde y el `.doc` en gris.
- Al pulsar `.docx` se descarga un archivo que Word abre sin avisos de reparación.
- Sale el aviso con el número de páginas declaradas.

- [ ] **Paso 4: commit**

```bash
git add frontend/src/components/ReporteGenerador.jsx
git commit -m "feat: botón de descarga en .docx real, junto al .doc

Conviven a propósito: el equipo toca este flujo y tener los dos permite comparar el mismo
estudio en los dos formatos. El .docx pasa a ser el botón principal y el .doc queda en gris
como anterior.

El aviso posterior dice cuántas páginas DECLARA el documento, no cuántas va a producir Word:
eso sólo se sabe abriéndolo, y prometer una cuenta sin medirla es justo lo que no hay que
hacer aquí."
```

---

### Tarea 12: Extremo a extremo desde el PDF real, y validación del OOXML

Es el test que ha atrapado todos los fallos de esta sesión: el que usa el PDF de verdad.

**Archivos:**
- Test: `frontend/src/services/docxWriter.test.js`

- [ ] **Paso 1: escribir el test que falla**

```js
import { readFileSync } from 'node:fs';
import { extraerReferencia } from './pdfReferenceExtractor.js';

const RUTA_PDF = 'Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf';
let cacheRef = null;
const referencia = async () => {
  if (!cacheRef) cacheRef = await extraerReferencia(new Uint8Array(readFileSync(RUTA_PDF)));
  return cacheRef;
};

test('extremo a extremo: el informe real sale como .docx', async () => {
  const ref = await referencia();
  const zip = new PizZip(await aDocxBuffer({
    html: ref.html, recursos: ref.imagenes, anexo: [],
  }));
  const doc = zip.file('word/document.xml').asText();

  /* Declara las 112 páginas del original. */
  /* Con S secciones y P páginas, los saltos son P - S (uno entre página y página dentro de
     cada sección, ninguno delante de la primera de cada una). Así que saltos + secciones = P,
     exactamente 112, sea cuantas secciones haya salido de la orientación. */
  assert.equal((doc.match(/<w:br w:type="page"\/>/g) || []).length +
    (doc.match(/<w:sectPr/g) || []).length, 112,
    'los saltos más las secciones deben cubrir las 112 páginas');

  /* El texto del informe está. */
  assert.match(doc, /INTRODUCCIÓN/);
  assert.match(doc, /END GAME/);

  /* La negrita del informe llegó: el PDF trae 931 fragmentos en negrita. */
  assert.ok((doc.match(/<w:b\/>/g) || []).length > 500,
    'se perdió la negrita del informe');

  /* Una imagen por recurso en word/media, y ninguna más ancha que la caja de texto. */
  const media = Object.keys(zip.files).filter((f) => /^word\/media\/.+\./.test(f));
  assert.ok(media.length >= 3, 'faltan imágenes: ' + media.length);
  const anchos = [...doc.matchAll(/<wp:extent cx="(\d+)"/g)].map((m) => Number(m[1]));
  const cajaEmu = (21.6 - 5) * 360000;
  for (const cx of anchos) {
    assert.ok(cx <= cajaEmu, 'una imagen mide más que la caja de texto: ' + cx);
  }

  /* La página apaisada abrió su sección. */
  assert.match(doc, /w:orient="landscape"/);

  /* El encabezado va una vez, a la derecha, y la portada sin él. */
  assert.ok(zip.file('word/header1.xml'));
  assert.match(zip.file('word/header1.xml').asText(), /w:val="right"/);
  assert.match(doc, /<w:titlePg\/>/);

  /* Y nada del resaltado de pantalla. */
  assert.doesNotMatch(doc, /pt-valor/);
});

test('el .docx del informe real es XML bien formado', async () => {
  /* Un XML mal formado hace que Word ofrezca "reparar" el documento, y ahí el usuario ya
     perdió la confianza en la herramienta. */
  const ref = await referencia();
  const zip = new PizZip(await aDocxBuffer({ html: ref.html, recursos: ref.imagenes }));
  for (const parte of ['word/document.xml', 'word/styles.xml', 'word/header1.xml',
    'word/footer1.xml', '[Content_Types].xml']) {
    const xml = zip.file(parte);
    assert.ok(xml, 'falta ' + parte);
    const texto = xml.asText();
    /* Comprobación de equilibrio de etiquetas, que es lo que se puede hacer sin parser XML. */
    const abiertas = (texto.match(/<[a-zA-Z][^>/]*(?<!\/)>/g) || []).length;
    const cerradas = (texto.match(/<\/[a-zA-Z][^>]*>/g) || []).length;
    assert.equal(abiertas, cerradas, parte + ': etiquetas descompensadas');
  }
});
```

- [ ] **Paso 2: correr y ver qué falla**

```bash
npx --yes node --test frontend/src/services/docxWriter.test.js 2>&1 | grep -E "^✖|Assertion|not ok"
```

Ajustar los umbrales a lo que **se mida**, no al revés: si la negrita sale en 700 y no en 500,
el umbral era conservador y está bien; si sale en 12, hay un fallo real que arreglar. Documentar
en el test el número medido.

- [ ] **Paso 3: validar el OOXML con la herramienta de la skill**

```bash
pip install defusedxml
cd .agents/skills/docx/scripts/office
python validate.py "<ruta al .docx generado>"
```

Para tener un `.docx` en disco, añadir un script temporal que escriba
`Packer.toBuffer` a un archivo, correrlo, validar, y **borrar el script**. Si `validate.py`
reporta errores de esquema, son bugs: arreglarlos antes de cerrar la tarea.

- [ ] **Paso 4: correr toda la suite**

```bash
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npm run lint --prefix frontend 2>&1 | grep -cE " error "
npm run build 2>&1 | grep -E "✓ built"
```

Esperado: `fail 0`, 0 errores de lint, build hecho.

- [ ] **Paso 5: commit**

```bash
git add frontend/src/services/docxWriter.test.js
git commit -m "test: extremo a extremo del .docx desde el PDF real, y XML bien formado

Es el test que ha atrapado todos los fallos de esta sesión: el que usa el informe de verdad.
Afirma que el documento declara las 112 páginas, que la negrita del informe llegó, que hay
una imagen por recurso y ninguna más ancha que la caja de texto, que la página apaisada abrió
su sección, que el encabezado va una vez y a la derecha, que la portada va sin él, y que el
resaltado de pantalla no se colO.

Y que las partes del zip son XML equilibrado: un XML mal formado hace que Word ofrezca
reparar el documento, y ahí el usuario ya perdió la confianza en la herramienta."
```

---

## Cierre

Tras la última tarea:

- [ ] Correr `/revisar-ramas-equipo` — es la segunda vez que toca, al cerrar. Está en `CLAUDE.md`
      y en las notas del usuario.
- [ ] Avisar al equipo del formato nuevo. `firestore.rules`, `MotorComparables.jsx` y
      `ReporteGenerador.jsx` los tocan Daniel y Pablo; el riesgo 5 del spec es justamente que se
      enteren por sorpresa.
- [ ] Anotar en el spec qué quedó fuera y se comprobó: las celdas combinadas (el árbol no
      expone `ColSpan`/`RowSpan`), las páginas 2 a 4 con encabezado que el original no tiene
      (Word sólo distingue la primera), y que no se pudo renderizar para contar hojas.

## Autorrevisión de este plan

**Cobertura del spec.** §1 piezas → tareas 1, 3, 8, 11. §2 paridad → tarea 1 (medidas
compartidas y su test). §3 traducción, fila por fila de su tabla → estilo base y pie (3),
páginas y saltos (8), orientación (8), h1–h4 (4), párrafos (4), negrita/cursiva/familia (4),
tablas (6), listas (7), imágenes (7), índice con guía de puntos (5), hueco del anexo (10),
`pt-valor` (4). §4 anexo → tarea 10. §5 verificación → tareas 3 a 12, y la validación XSD en la
12. Decisión de los dos botones → tarea 11. Decisión del salto duro → tarea 8. Riesgo 5 (avisar
al equipo) → cierre.

**Huecos que encontré y cerré al revisar:** faltaba el aviso de las páginas declaradas que pide
la corrección del spec sobre el conteo — está en la tarea 11. Faltaba decir de dónde sale
`anexo` en la interfaz — es `study.eeffImages`, y quedó explícito en la tarea 11.

**Consistencia de nombres.** `construirDocumento`, `aDocxBuffer`, `aDocxBlob` en la tarea 3 son
los mismos que consumen la 11 y la 12. `htmlAArbol` y `textoDe` de la tarea 2 son los que usan
la 3, la 4 y la 5. `cmATwips`, `cmAPixeles`, `medidaEnCm`, `HOJA_TWIPS` de la tarea 1 son los
que usan la 3, la 6, la 7 y la 10.

**Una advertencia para quien lo ejecute.** En la tarea 7 hay una decisión de estructura:
`runsDe`, `parrafoDe`, `bloquesDe`, `tablaDe` y `runDeImagen` pasan a necesitar el catálogo de
recursos y el contador del anexo. El plan recomienda moverlas dentro de una función que cierre
sobre esos datos, en vez de hilar dos parámetros por cinco funciones. Hacerlo **en la tarea 7**,
no antes ni después: antes es refactor sin motivo, después son cinco firmas que cambiar dos
veces.
