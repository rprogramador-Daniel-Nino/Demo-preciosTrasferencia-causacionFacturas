# Narrativa III.A/III.B por Encabezado y Semáforo de Radicación Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la prosa de III.A/III.B (Panorama de la Economía Mundial/Colombiana) se reemplace localizándola por su encabezado —igual que ya se hace con las tablas—, sin depender de que el marcado con IA la haya marcado; y que los avisos de cobertura que hoy son informativos se conviertan en un semáforo de "listo para radicar" antes de descargar el informe.

**Architecture:** Dos piezas independientes que comparten el mismo objetivo (que nada del informe de referencia sobreviva sin marcar). La primera extiende el patrón de localización por encabezado que ya usa `docxRelleno.js`/`tablasHtmlInforme.js` para tablas, aplicándolo a un bloque de párrafos. La segunda consolida diagnósticos que ya existen (`diagnosticarCobertura`, `revisarSalidaRenderizada`) en un veredicto único que se muestra antes de exportar.

**Tech Stack:** JavaScript (ESM), Vitest/node:test, manipulación de OOXML crudo (docxtemplater no aplica aquí porque no hay marcador `{campo}` de por medio), React (frontend/src/components).

## Global Constraints

- Código, comentarios, UI y mensajes en español.
- No usar `window.confirm`/`window.alert` en ningún punto nuevo — el gate del ítem 4 es un componente visual, no un diálogo bloqueante del navegador.
- `npm test` debe quedar en 100 % verde tras cada tarea.
- Ninguna cifra ni frase del informe de referencia puede sobrevivir sin marcador visible: si no hay narrativa real, se reemplaza por el marcador `[Actualizar con...]` — nunca se deja intacto el texto que trajera la plantilla.
- Las dos rutas de generación (`.docx` vía `docxRelleno.js`, HTML/PDF vía `plantillaRenderer.js`) deben quedar con el mismo comportamiento: es el mismo documento en dos formatos.
- La verificación de las tareas que tocan OOXML crudo requiere además una prueba manual generando el `.docx` real (`Archivos Prueba/Informe Local End Game _ 2024_v2.docx`) y abriéndolo — las pruebas unitarias no pueden comprobar que Word lo abra sin quejarse (limitación ya documentada en `docxRelleno.js:24-27`).

---

## Grupo A — Ítem 3: narrativa de III.A/III.B localizada por encabezado

### Contexto verificado antes de escribir este plan

- `frontend/src/services/analisisMercado.js:216-336` (`generarApartadoMundial`, `generarApartadoColombia`) ya arman la prosa + tablas en HTML a partir de `datosMacro` (Firestore) — con fallback al marcador `[Actualizar con...]` si no hay narrativa. **Estas funciones no las llama nadie en `docxRelleno.js` ni en `plantillaRenderer.js`.**
- Lo único que ambas rutas de render hacen hoy con `datosMacro` es regenerar las 8 TABLAS macro (`docxRelleno.js:168` `actualizarTablasMacroOoxml`, `tablasHtmlInforme.js:509` `actualizarTablasMacroHtml`), vía `tablasMacroInforme()` en `tablasInforme.js:275`. La prosa que las antecede depende hoy de que el marcado con IA haya puesto `data-campo="ia.economia_mundial"`/`"ia.economia_colombia"` (`plantillaVocabulario.js:67-68,171-176`) — y, según confirmó Antonio, ese marcado no ocurre en esta plantilla.
- `docxRelleno.js:332` (`localizarBloqueTabla`) ya localiza un bloque por el texto de su encabezado (normalizado con `claveTitulo`, `docxRelleno.js:228`), pero exige que justo después venga un `<w:tbl>`. No sirve tal cual para un bloque de puros párrafos.
- `docxRelleno.js:482` (`sustituidorDeTablas`) ya expone `.aplicar(transformar)` —pensado explícitamente para "la prosa que describe la tabla"— además de `.reemplazar(...)`. Está sin usar.
- `tablasMacroInforme(datosMacro, year)` (`tablasInforme.js:275`) da el `nombre` corto de cada tabla en el orden en que aparecen: `'PIB Mundial'` es la primera tabla de III.A, `'PIB en Colombia'` la primera de III.B. Sirven como frontera de fin del bloque de prosa: no hay que tocar las tablas, solo el texto que las antecede.

### Task 1: Localizar un bloque de párrafos por encabezado de inicio y de fin (OOXML)

**Files:**
- Modify: `frontend/src/services/docxRelleno.js` (agregar función nueva, cerca de `localizarBloqueTabla:332`)
- Test: `frontend/src/services/docxRelleno.test.js`

**Interfaces:**
- Produces: `localizarBloqueProsa(xml, tituloInicio, titulosFin)` → `{inicio:number, fin:number} | null`. `inicio` es el índice donde empieza el párrafo de `tituloInicio` (se conserva, no se borra el título); `fin` es el índice justo antes del párrafo cuyo título coincide con alguno de `titulosFin`. Si no se encuentra `tituloInicio`, o no aparece ningún `tituloFin` después, devuelve `null`.

- [ ] **Step 1: Escribir la prueba que falla**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localizarBloqueProsa } from './docxRelleno.js';

const parrafo = (texto) => `<w:p><w:r><w:t>${texto}</w:t></w:r></w:p>`;

test('localizarBloqueProsa delimita desde el encabezado de inicio hasta el de fin, sin incluirlo', () => {
  const xml = [
    parrafo('Preámbulo'),
    parrafo('A. Análisis del Panorama de la Economía Mundial'),
    parrafo('CRECIMIENTO MUNDIAL'),
    parrafo('La economía mundial transitó durante el bienio 2024-2025...'),
    parrafo('Crecimiento del PIB Mundial (2024-2026)'),
    parrafo('Cierre'),
  ].join('');

  const bloque = localizarBloqueProsa(
    xml, 'Análisis del Panorama de la Economía Mundial', ['PIB Mundial']
  );

  assert.ok(bloque);
  const dentro = xml.slice(bloque.inicio, bloque.fin);
  assert.match(dentro, /A\. Análisis del Panorama/);
  assert.match(dentro, /CRECIMIENTO MUNDIAL/);
  assert.match(dentro, /bienio 2024-2025/);
  assert.doesNotMatch(dentro, /Crecimiento del PIB Mundial \(2024-2026\)/);
});

test('localizarBloqueProsa devuelve null si no encuentra el encabezado de inicio', () => {
  const xml = parrafo('Algo que no es el encabezado buscado');
  assert.equal(localizarBloqueProsa(xml, 'Análisis del Panorama de la Economía Mundial', ['PIB Mundial']), null);
});

test('localizarBloqueProsa devuelve null si el encabezado de inicio existe pero ningún tituloFin aparece después', () => {
  const xml = parrafo('A. Análisis del Panorama de la Economía Mundial') + parrafo('Cierre sin tabla');
  assert.equal(localizarBloqueProsa(xml, 'Análisis del Panorama de la Economía Mundial', ['PIB Mundial']), null);
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `node --test frontend/src/services/docxRelleno.test.js`
Expected: FAIL — `localizarBloqueProsa is not a function`.

- [ ] **Step 3: Implementación mínima**

Agregar en `docxRelleno.js`, después de `localizarBloqueTabla` (usa `claveTitulo` y `textoPlanoOoxml`, ya definidas arriba en el archivo):

```javascript
/**
 * Delimita un bloque de párrafos entre un encabezado de inicio y el primero de una
 * lista de encabezados de fin — pensado para reemplazar la PROSA de un apartado sin
 * tocar las tablas que le siguen (esas ya las localiza `localizarBloqueTabla`).
 *
 * `inicio` cae en el propio párrafo de `tituloInicio` (se conserva su encabezado en el
 * reemplazo) y `fin` justo antes del párrafo de fin encontrado, que queda intacto.
 *
 * @param {string} xml
 * @param {string} tituloInicio
 * @param {string[]} titulosFin
 * @returns {{inicio:number, fin:number}|null}
 */
export function localizarBloqueProsa(xml, tituloInicio, titulosFin) {
  const texto = String(xml || '');
  const claveInicio = claveTitulo(tituloInicio);
  const clavesFin = (titulosFin || []).map(claveTitulo).filter(Boolean);
  if (!claveInicio || !clavesFin.length) return null;

  const rxParrafo = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let p;
  let inicio = null;
  while ((p = rxParrafo.exec(texto)) !== null) {
    const clave = claveTitulo(textoPlanoOoxml(p[0]));
    if (inicio === null) {
      if (clave.includes(claveInicio)) inicio = p.index;
      continue;
    }
    if (clavesFin.some((c) => clave.includes(c))) {
      return { inicio, fin: p.index };
    }
  }
  return null;
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node --test frontend/src/services/docxRelleno.test.js`
Expected: PASS en las tres pruebas nuevas.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/docxRelleno.js frontend/src/services/docxRelleno.test.js
git commit -m "feat: localizar un bloque de prosa por encabezado de inicio y de fin en OOXML"
```

---

### Task 2: Convertir la narrativa HTML de Claude a párrafos OOXML

**Files:**
- Modify: `frontend/src/services/docxRelleno.js`
- Test: `frontend/src/services/docxRelleno.test.js`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `parrafosOoxmlDesdeHtml(html)` → string OOXML (uno o más `<w:p>`). Cada `<p>` de la narrativa se vuelve un párrafo; `<strong>` se vuelve negrita; cualquier otra etiqueta (`<a>`, `<em>`, etc.) se aplana a su texto visible.

- [ ] **Step 1: Escribir la prueba que falla**

```javascript
import { parrafosOoxmlDesdeHtml } from './docxRelleno.js';

test('parrafosOoxmlDesdeHtml convierte cada <p> en un párrafo y <strong> en negrita', () => {
  const html = '<p>Primer párrafo con <strong>énfasis</strong> normal.</p><p>Segundo párrafo.</p>';
  const xml = parrafosOoxmlDesdeHtml(html);

  assert.equal((xml.match(/<w:p>/g) || []).length, 2);
  assert.match(xml, /<w:rPr><w:b\/><\/w:rPr><w:t>énfasis<\/w:t>/);
  assert.match(xml, /<w:t>Primer párrafo con <\/w:t>/);
  assert.match(xml, /<w:t> normal\.<\/w:t>/);
  assert.match(xml, /<w:t>Segundo párrafo\.<\/w:t>/);
});

test('parrafosOoxmlDesdeHtml aplana enlaces a su texto visible, sin dejar el <a>', () => {
  const html = '<p>Fuente: <a href="https://dane.gov.co">DANE</a>.</p>';
  const xml = parrafosOoxmlDesdeHtml(html);
  assert.match(xml, /<w:t>DANE<\/w:t>/);
  assert.doesNotMatch(xml, /<a /);
});

test('parrafosOoxmlDesdeHtml devuelve un único párrafo vacío-seguro si el HTML no trae <p>', () => {
  assert.equal(parrafosOoxmlDesdeHtml(''), '');
  assert.equal(parrafosOoxmlDesdeHtml(null), '');
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `node --test frontend/src/services/docxRelleno.test.js`
Expected: FAIL — `parrafosOoxmlDesdeHtml is not a function`.

- [ ] **Step 3: Implementación mínima**

```javascript
/** Texto de un fragmento de HTML de narrativa (sin sus etiquetas), con las entidades
 *  básicas deshechas — misma lista que `escaparXml` invierte, porque este texto vuelve
 *  a pasar por `escaparXml` al escribirse en el run. */
function textoPlanoDeNarrativa(fragmento) {
  return String(fragmento || '')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * La narrativa de III.A/III.B que redacta Claude (HTML simple: `<p>`, `<strong>`, `<a>`)
 * convertida a párrafos OOXML, para insertarla en el `.docx` sin depender del marcado.
 *
 * Solo entiende `<strong>` (negrita) y `<a>` (se aplana a su texto): es lo único que el
 * prompt de redacción produce (`functions/analisisMercadoPrompts.js`, "Cada apartado en
 * HTML, como una serie de párrafos <p>...</p>, sin encabezados ni tablas").
 *
 * @param {string} html
 * @returns {string} OOXML, una cadena vacía si `html` no trae ningún `<p>`.
 */
export function parrafosOoxmlDesdeHtml(html) {
  const bloques = String(html || '').match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
  return bloques.map((bloque) => {
    const interior = bloque.replace(/^<p\b[^>]*>/i, '').replace(/<\/p>\s*$/i, '');
    const runs = [];
    const rx = /<strong>([\s\S]*?)<\/strong>|([^<]+(?:<a\b[^>]*>[\s\S]*?<\/a>[^<]*)*)/gi;
    let m;
    while ((m = rx.exec(interior)) !== null) {
      if (m[1] !== undefined) {
        const texto = textoPlanoDeNarrativa(m[1]);
        if (texto) runs.push(`<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r>`);
      } else if (m[2] !== undefined) {
        const texto = textoPlanoDeNarrativa(m[2]);
        if (texto) runs.push(`<w:r><w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r>`);
      }
    }
    return `<w:p>${runs.join('')}</w:p>`;
  }).join('');
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node --test frontend/src/services/docxRelleno.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/docxRelleno.js frontend/src/services/docxRelleno.test.js
git commit -m "feat: convertir la narrativa HTML de III.A/III.B a párrafos OOXML"
```

---

### Task 3: Reemplazar la prosa de III.A/III.B en la ruta .docx, sin depender del marcado

**Files:**
- Modify: `frontend/src/services/docxRelleno.js` (nueva función + wiring en `renderizarDocx:780`)
- Test: `frontend/src/services/docxRelleno.test.js`

**Interfaces:**
- Consumes: `localizarBloqueProsa` (Task 1), `parrafosOoxmlDesdeHtml` (Task 2), `sustituidorDeTablas` (ya existe, `.aplicar`), `marcadorPendiente`-equivalente propio (no se importa de `analisisMercado.js` para no acoplar frontend/services entre sí más de lo necesario — se redacta el mismo texto aquí, igual que `analisisMercado.js:141-146`).
- Produces: `actualizarApartadosMacroOoxml(xml, datosMacro, year, avisos)` → xml. Se llama desde `renderizarDocx` ANTES de `actualizarTablasMacroOoxml` (para que, si el bloque de prosa no se encuentra, las tablas de todas formas se sigan actualizando después — son independientes).

- [ ] **Step 1: Escribir la prueba que falla**

```javascript
import { actualizarApartadosMacroOoxml } from './docxRelleno.js';

test('actualizarApartadosMacroOoxml reemplaza la prosa de mundial y colombia con la narrativa de Firestore', () => {
  const xml = [
    parrafo('A. Análisis del Panorama de la Economía Mundial'),
    parrafo('Texto de END GAME sobre el mundo, 2024.'),
    parrafo('Crecimiento del PIB Mundial (2024-2026)'),
    parrafo('B. Análisis del panorama de la economía colombiana'),
    parrafo('Texto de END GAME sobre Colombia, 2024.'),
    parrafo('Crecimiento del PIB en Colombia (2024-2026)'),
  ].join('');

  const datosMacro = {
    narrativa: {
      mundial: '<p>Narrativa real del mundo para este cliente.</p>',
      colombia: '<p>Narrativa real de Colombia para este cliente.</p>',
    },
  };

  const avisos = [];
  const salida = actualizarApartadosMacroOoxml(xml, datosMacro, 2026, avisos);

  assert.match(salida, /Narrativa real del mundo para este cliente\./);
  assert.match(salida, /Narrativa real de Colombia para este cliente\./);
  assert.doesNotMatch(salida, /Texto de END GAME/);
  assert.equal(avisos.length, 0);
});

test('actualizarApartadosMacroOoxml usa el marcador de pendiente si no hay narrativa, y avisa', () => {
  const xml = [
    parrafo('A. Análisis del Panorama de la Economía Mundial'),
    parrafo('Texto de END GAME sobre el mundo, 2024.'),
    parrafo('Crecimiento del PIB Mundial (2024-2026)'),
  ].join('');

  const avisos = [];
  const salida = actualizarApartadosMacroOoxml(xml, null, 2026, avisos);

  assert.doesNotMatch(salida, /Texto de END GAME/);
  assert.match(salida, /\[Actualizar con el análisis del panorama de la economía mundial/);
  assert.ok(avisos.length >= 1);
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `node --test frontend/src/services/docxRelleno.test.js`
Expected: FAIL — `actualizarApartadosMacroOoxml is not a function`.

- [ ] **Step 3: Implementación mínima**

```javascript
/** Mismo texto y misma referencia normativa que `marcadorPendiente` de
 *  `analisisMercado.js` — no se importa de ahí para no acoplar la ruta .docx a la
 *  ruta HTML por un solo texto; si cambia la redacción legal, cambia en los dos sitios
 *  a propósito. */
function marcadorApartadoPendiente(tema, year) {
  return '[Actualizar con el análisis del panorama de la economía ' + tema + ' del año gravable ' +
    year + ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]';
}

/**
 * Reemplaza la PROSA (no las tablas) de III.A y III.B, localizándola por su encabezado,
 * para que deje de depender de que el marcado con IA la haya marcado como
 * `ia.economia_mundial`/`ia.economia_colombia` (`plantillaVocabulario.js`).
 *
 * Las tablas de cada apartado quedan intactas aquí — las sigue actualizando
 * `actualizarTablasMacroOoxml` después, por su propio encabezado.
 *
 * @param {string} xml
 * @param {object|null} datosMacro  el documento `analisisMercado/actual` de Firestore.
 * @param {number} year
 * @param {string[]} [avisos]  nombres de apartado que no se pudieron localizar o que
 *        quedaron con el marcador de pendiente por falta de narrativa.
 * @returns {string}
 */
export function actualizarApartadosMacroOoxml(xml, datosMacro, year, avisos) {
  const doc = sustituidorDeTablas(xml, null);
  const apartados = [
    { inicio: 'Análisis del Panorama de la Economía Mundial', fin: ['PIB Mundial'], tema: 'mundial', clave: 'mundial' },
    { inicio: 'Análisis del panorama de la economía colombiana', fin: ['PIB en Colombia'], tema: 'colombiana', clave: 'colombia' },
  ];

  apartados.forEach((a) => {
    const narrativaHtml = datosMacro && datosMacro.narrativa && datosMacro.narrativa[a.clave];
    doc.aplicar((actual) => {
      const bloque = localizarBloqueProsa(actual, a.inicio, a.fin);
      if (!bloque) {
        if (Array.isArray(avisos)) avisos.push('prosa de ' + a.inicio);
        return actual;
      }
      const tituloParrafo = actual.slice(bloque.inicio, actual.indexOf('</w:p>', bloque.inicio) + '</w:p>'.length);
      const cuerpo = narrativaHtml
        ? parrafosOoxmlDesdeHtml(narrativaHtml)
        : `<w:p><w:r><w:t xml:space="preserve">${escaparXml(marcadorApartadoPendiente(a.tema, year))}</w:t></w:r></w:p>`;
      if (!narrativaHtml && Array.isArray(avisos)) avisos.push('narrativa de ' + a.inicio);
      return actual.slice(0, bloque.inicio) + tituloParrafo + cuerpo + actual.slice(bloque.fin);
    });
  });

  return doc.xml;
}
```

Y en `renderizarDocx` (`docxRelleno.js:780-796`), agregar la línea ANTES de `actualizarTablasMacroOoxml`:

```javascript
  let xml = zip.file(RUTA_DOC).asText();
  const year = Number(estudio && estudio.anio) || 2025;
  xml = actualizarApartadosMacroOoxml(xml, datosMacro, year, avisosTablas);
  xml = actualizarTablasMacroOoxml(xml, datosMacro, year, avisosTablas);
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node --test frontend/src/services/docxRelleno.test.js`
Expected: PASS.

- [ ] **Step 5: Prueba manual sobre el .docx real**

Generar el informe completo desde la app con el estudio de End Game (`Archivos Prueba/Información Operaciones PT 2025-2 modificado cr.xlsx` + `Archivos Prueba/Informe Local End Game _ 2024_v2.docx` como plantilla) y abrir el `.docx` resultante en Word: confirmar que III.A y III.B ya no traen el texto de End Game 2024, que el título del apartado se conserva, y que las tablas siguen apareciendo justo después, sin duplicarse ni desaparecer.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/docxRelleno.js frontend/src/services/docxRelleno.test.js
git commit -m "feat: la prosa de III.A/III.B se reemplaza por encabezado, sin depender del marcado"
```

---

### Task 4: Mismo reemplazo en la ruta HTML/PDF

**Files:**
- Modify: `frontend/src/services/tablasHtmlInforme.js`
- Modify: `frontend/src/services/plantillaRenderer.js:44-65` (wiring en `renderizar`)
- Test: `frontend/src/services/tablasHtmlInforme.test.js`

**Interfaces:**
- Consumes: `claveTitulo`, `numeroDeTabla` (ya importados de `docxRelleno.js` en este archivo, `tablasHtmlInforme.js:40`); no requiere el conversor de Task 2 — el HTML de la narrativa se inserta directo, es el mismo formato.
- Produces: `actualizarApartadosMacroHtml(html, datosMacro, year, avisos)` → html.

- [ ] **Step 1: Escribir la prueba que falla**

```javascript
import { actualizarApartadosMacroHtml } from './tablasHtmlInforme.js';

test('actualizarApartadosMacroHtml reemplaza la prosa localizándola por encabezado', () => {
  const html = [
    '<h2>A. Análisis del Panorama de la Economía Mundial</h2>',
    '<p>Texto de END GAME sobre el mundo, 2024.</p>',
    '<h3>Crecimiento del PIB Mundial (2024-2026)</h3>',
  ].join('');

  const datosMacro = { narrativa: { mundial: '<p>Narrativa real del mundo.</p>' } };
  const avisos = [];
  const salida = actualizarApartadosMacroHtml(html, datosMacro, 2026, avisos);

  assert.match(salida, /Narrativa real del mundo\./);
  assert.doesNotMatch(salida, /Texto de END GAME/);
  assert.match(salida, /Crecimiento del PIB Mundial/); // la tabla que sigue no se toca
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `node --test frontend/src/services/tablasHtmlInforme.test.js`
Expected: FAIL — `actualizarApartadosMacroHtml is not a function`.

- [ ] **Step 3: Implementación mínima**

Reutiliza `RX_BLOQUE` (bloques `<p>`/`<h1-6>`, ya definido en `tablasHtmlInforme.js:74`) para localizar por encabezado, análogo a `localizarBloqueProsa` pero sobre HTML:

```javascript
/** Igual que `localizarBloqueProsa` de `docxRelleno.js`, pero sobre el HTML de la ruta
 *  de plantilla PDF: delimita desde el bloque cuyo texto coincide con `tituloInicio`
 *  hasta el bloque cuyo texto coincide con alguno de `titulosFin` (sin incluirlo). */
function localizarBloqueProsaHtml(html, tituloInicio, titulosFin) {
  const claveInicio = claveTitulo(tituloInicio);
  const clavesFin = (titulosFin || []).map(claveTitulo).filter(Boolean);
  if (!claveInicio || !clavesFin.length) return null;

  RX_BLOQUE.lastIndex = 0;
  let m;
  let inicio = null;
  while ((m = RX_BLOQUE.exec(html)) !== null) {
    const clave = claveTitulo(textoPlanoHtml(m[2]));
    if (inicio === null) {
      if (clave.includes(claveInicio)) inicio = m.index;
      continue;
    }
    if (clavesFin.some((c) => clave.includes(c))) return { inicio, fin: m.index };
  }
  return null;
}

function marcadorApartadoPendienteHtml(tema, year) {
  return '<p>[Actualizar con el análisis del panorama de la economía ' + tema + ' del año gravable ' +
    year + ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]</p>';
}

/** Ruta HTML/PDF de `actualizarApartadosMacroOoxml` (ver `docxRelleno.js`): misma
 *  intención, sin conversor porque la narrativa ya llega en HTML. */
export function actualizarApartadosMacroHtml(html, datosMacro, year, avisos) {
  let out = String(html || '');
  const apartados = [
    { inicio: 'Análisis del Panorama de la Economía Mundial', fin: ['PIB Mundial'], tema: 'mundial', clave: 'mundial' },
    { inicio: 'Análisis del panorama de la economía colombiana', fin: ['PIB en Colombia'], tema: 'colombiana', clave: 'colombia' },
  ];

  apartados.forEach((a) => {
    const bloque = localizarBloqueProsaHtml(out, a.inicio, a.fin);
    if (!bloque) {
      if (Array.isArray(avisos)) avisos.push('prosa de ' + a.inicio);
      return;
    }
    const narrativaHtml = datosMacro && datosMacro.narrativa && datosMacro.narrativa[a.clave];
    const finEncabezado = out.indexOf('>', bloque.inicio) + 1;
    const encabezado = out.slice(bloque.inicio, finEncabezado);
    const cuerpo = narrativaHtml || marcadorApartadoPendienteHtml(a.tema, year);
    if (!narrativaHtml && Array.isArray(avisos)) avisos.push('narrativa de ' + a.inicio);
    out = out.slice(0, bloque.inicio) + encabezado + cuerpo + out.slice(bloque.fin);
  });

  return out;
}
```

Y en `plantillaRenderer.js`, dentro de `renderizar` (línea 61, antes de `actualizarTablasMacroHtml`):

```javascript
  html = actualizarApartadosMacroHtml(html, opciones.datosMacro || null, Number(estudio && estudio.anio) || 2025, avisosTablas);
  html = actualizarTablasMacroHtml(
    html, opciones.datosMacro || null, Number(estudio && estudio.anio) || 2025, avisosTablas);
```

(agregar el import correspondiente de `tablasHtmlInforme.js` al inicio de `plantillaRenderer.js`).

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node --test frontend/src/services/tablasHtmlInforme.test.js`
Expected: PASS.

- [ ] **Step 5: Prueba manual en la vista previa**

Abrir un estudio con plantilla PDF marcada en el Gestor de Reportes y confirmar en la vista previa que III.A/III.B muestran la narrativa nueva (o el marcador), no el texto de la plantilla.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/tablasHtmlInforme.js frontend/src/services/tablasHtmlInforme.test.js frontend/src/services/plantillaRenderer.js
git commit -m "feat: la prosa de III.A/III.B en la ruta HTML/PDF también se localiza por encabezado"
```

---

## Grupo B — Ítem 4: semáforo antes de radicar

### Contexto verificado antes de escribir este plan

- `frontend/src/services/tablasInforme.js:426` (`diagnosticarCobertura`) ya calcula: `sectorialCubierto`, `seriesFaltantes`, `narrativaCubierta`, `sectorNarrativaCubierta`, `razonesRechazoCubiertas`, `razonesRechazoDescuadradas`, `comparablesCubiertas`, `comparablesSinCifras`.
- `frontend/src/services/plantillaGuardas.js:38,64` (`valoresDeReferencia`, `revisarSalidaRenderizada`) ya cuentan cuántas veces sobrevive sin marcar un valor del informe de referencia (NIT, vinculado, país, etc.) en la salida renderizada — es el mecanismo que dio el número de 69 apariciones que citó Antonio.
- `frontend/src/components/ReporteGenerador.jsx:170-278` ya arma con lo anterior un arreglo de `avisos` (texto) y lo pinta como un banner (`avisoCobertura`) — informativo, no bloqueante, y no incluye lo que calcula `revisarSalidaRenderizada`.
- Memoria del proyecto: no usar `window.confirm`/`window.alert` — el semáforo tiene que ser un componente visual propio.

### Task 5: Un veredicto único de "listo para radicar"

**Files:**
- Create: `frontend/src/services/semaforoRadicacion.js`
- Test: `frontend/src/services/semaforoRadicacion.test.js`

**Interfaces:**
- Consumes: `diagnosticarCobertura` (de `tablasInforme.js`), `revisarSalidaRenderizada`/`valoresDeReferencia` (de `plantillaGuardas.js`).
- Produces: `evaluarRadicacion({ diagnostico, fugasReferencia, avisosTablas, camposVacios })` → `{ listo: boolean, bloqueantes: string[], advertencias: string[] }`. `bloqueantes` son huecos que dejan datos de OTRO cliente en el documento (fugas de referencia, tablas 16/17/19 sin cubrir); `advertencias` son huecos que dejan un marcador visible pero no datos ajenos (series macro faltantes, sector sin generar).

- [ ] **Step 1: Escribir la prueba que falla**

```javascript
import { evaluarRadicacion } from './semaforoRadicacion.js';

test('evaluarRadicacion bloquea si hay fugas del informe de referencia', () => {
  const veredicto = evaluarRadicacion({
    diagnostico: { seriesFaltantes: [], narrativaCubierta: true, sectorNarrativaCubierta: true, razonesRechazoCubiertas: true, razonesRechazoDescuadradas: false, comparablesCubiertas: true, comparablesSinCifras: 0, sectorialCubierto: true },
    fugasReferencia: [{ campo: 'vinc', valor: 'END GAME INTERACTIVE', cuenta: 69 }],
    avisosTablas: [],
    camposVacios: [],
  });
  assert.equal(veredicto.listo, false);
  assert.match(veredicto.bloqueantes.join(' '), /END GAME INTERACTIVE.*69/);
});

test('evaluarRadicacion queda listo si no hay bloqueantes, aunque haya advertencias', () => {
  const veredicto = evaluarRadicacion({
    diagnostico: { seriesFaltantes: ['la TRM promedio'], narrativaCubierta: true, sectorNarrativaCubierta: true, razonesRechazoCubiertas: true, razonesRechazoDescuadradas: false, comparablesCubiertas: true, comparablesSinCifras: 0, sectorialCubierto: true },
    fugasReferencia: [],
    avisosTablas: [],
    camposVacios: [],
  });
  assert.equal(veredicto.listo, true);
  assert.ok(veredicto.advertencias.length >= 1);
  assert.equal(veredicto.bloqueantes.length, 0);
});

test('evaluarRadicacion bloquea si las tablas de comparables no están cubiertas', () => {
  const veredicto = evaluarRadicacion({
    diagnostico: { seriesFaltantes: [], narrativaCubierta: true, sectorNarrativaCubierta: true, razonesRechazoCubiertas: true, razonesRechazoDescuadradas: false, comparablesCubiertas: false, comparablesSinCifras: 0, sectorialCubierto: true },
    fugasReferencia: [],
    avisosTablas: [],
    camposVacios: [],
  });
  assert.equal(veredicto.listo, false);
  assert.match(veredicto.bloqueantes.join(' '), /comparables/i);
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `node --test frontend/src/services/semaforoRadicacion.test.js`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementación mínima**

```javascript
/* ─────────────────────────────────────────────────────────────────────────────
   semaforoRadicacion.js — un solo veredicto de "¿está listo para radicar?".

   Junta lo que ya calculan `diagnosticarCobertura` (tablasInforme.js) y
   `revisarSalidaRenderizada`/`valoresDeReferencia` (plantillaGuardas.js), hoy
   dispersos en avisos de texto sueltos (ReporteGenerador.jsx). La distinción que
   importa es DE QUÉ CLASE es cada hueco:

     - BLOQUEANTE: el documento tiene un dato de OTRO contribuyente con aspecto de
       estar completo (una fuga de referencia, o una tabla de comparables con la
       muestra de la plantilla). Eso no se radica.
     - ADVERTENCIA: el documento tiene un marcador visible de "falta esto" (series
       macro sin dato, sector sin generar). Se ve, se completa, no engaña a nadie
       mientras tanto.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * @param {object} args
 * @param {object} args.diagnostico        salida de `diagnosticarCobertura`.
 * @param {Array<{campo:string, valor:string, cuenta:number}>} [args.fugasReferencia]
 *        salida de `revisarSalidaRenderizada` (avisos con `campo`, `valor`, `cuenta`).
 * @param {string[]} [args.avisosTablas]   tablas que no se encontraron en la plantilla.
 * @param {string[]} [args.camposVacios]   campos marcados sin dato del estudio.
 * @returns {{listo:boolean, bloqueantes:string[], advertencias:string[]}}
 */
export function evaluarRadicacion({ diagnostico, fugasReferencia, avisosTablas, camposVacios } = {}) {
  const d = diagnostico || {};
  const bloqueantes = [];
  const advertencias = [];

  (fugasReferencia || []).forEach((f) => {
    bloqueantes.push(
      'El valor "' + f.valor + '" del informe de referencia (campo "' + f.campo + '") sobrevive ' +
      f.cuenta + ' vez/veces sin marcar en el documento.'
    );
  });

  if (!d.comparablesCubiertas) {
    bloqueantes.push('Las tablas de comparables conservan la muestra del informe de referencia.');
  }
  if (!d.razonesRechazoCubiertas) {
    bloqueantes.push('La tabla de razones de rechazo conserva las cifras del informe de referencia.');
  }

  if (d.seriesFaltantes && d.seriesFaltantes.length) {
    advertencias.push('Faltan datos de ' + d.seriesFaltantes.join(', ') + ' en las tablas macro.');
  }
  if (!d.sectorialCubierto) {
    advertencias.push('La plantilla no trae la sección del análisis del sector.');
  } else if (!d.sectorNarrativaCubierta) {
    advertencias.push('El análisis del sector (III.C) todavía no está generado para esta actividad y año.');
  }
  if (!d.narrativaCubierta) {
    advertencias.push('La narrativa de III.A/III.B todavía no está disponible.');
  }
  if (d.razonesRechazoDescuadradas) {
    advertencias.push('Los conteos de la tabla de razones de rechazo no cuadran con el universo evaluado.');
  }
  if (d.comparablesSinCifras) {
    advertencias.push(d.comparablesSinCifras + ' comparable(s) sin estados financieros cargados.');
  }
  (avisosTablas || []).forEach((t) => advertencias.push('No se encontró en la plantilla: ' + t + '.'));
  (camposVacios || []).forEach((c) => advertencias.push('Campo sin dato: ' + c + '.'));

  return { listo: bloqueantes.length === 0, bloqueantes, advertencias };
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node --test frontend/src/services/semaforoRadicacion.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/semaforoRadicacion.js frontend/src/services/semaforoRadicacion.test.js
git commit -m "feat: veredicto único de listo-para-radicar, separando bloqueantes de advertencias"
```

---

### Task 6: Reemplazar el banner informativo por el semáforo en la UI

**Files:**
- Modify: `frontend/src/components/ReporteGenerador.jsx:170-278` (usar `evaluarRadicacion` en vez de solo acumular texto en `avisos`)

**Interfaces:**
- Consumes: `evaluarRadicacion` (Task 5), `revisarSalidaRenderizada`/`valoresDeReferencia` ya importados de `plantillaGuardas.js` en este archivo.
- Produces: estado `veredictoRadicacion` (`{listo, bloqueantes, advertencias}`) sustituyendo a `avisoCobertura` (string).

- [ ] **Step 1: Cambiar `revisarCobertura` para construir el veredicto**

En `ReporteGenerador.jsx`, sustituir el cuerpo de `avisosDeMercado`/`revisarCobertura` (líneas 170-278) para que, en vez de devolver un arreglo de frases sueltas, calcule `diagnostico` con `diagnosticarCobertura(...)`, `fugasReferencia` con `revisarSalidaRenderizada({ estudio: study, htmlRenderizado: htmlDelInforme, valores: valoresDeReferencia(htmlMarcado) })`, y guarde `setVeredictoRadicacion(evaluarRadicacion({ diagnostico, fugasReferencia, avisosTablas, camposVacios }))` en vez de `setAvisoCobertura(...)`.

- [ ] **Step 2: Pintar el semáforo**

Reemplazar el banner que lee `avisoCobertura` por un componente con tres estados visuales:
- Rojo, con la lista de `bloqueantes`, si `!listo`.
- Ámbar, con la lista de `advertencias`, si `listo` pero `advertencias.length > 0`.
- Verde ("Listo para radicar"), si `listo` y sin advertencias.

No es un `window.confirm`: es un banner igual de visible que el actual, con color y encabezado según el estado — la decisión de descargar igual queda en manos de quien usa la app, pero ya no puede no verlo.

- [ ] **Step 3: Verificación manual**

Levantar `npm run dev --prefix frontend`, abrir el estudio de End Game, generar el informe y confirmar: con el estado actual del código (fugas de referencia sin resolver) el semáforo sale en rojo listando el campo y el conteo; tras aplicar el Grupo A, algunas advertencias relacionadas con III.A/III.B deberían desaparecer.

- [ ] **Step 4: Ejecutar el resto de la suite**

Run: `npm test`
Expected: 100 % verde (no debería haber pruebas rotas por este cambio, que es solo de presentación).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ReporteGenerador.jsx
git commit -m "feat: banner de cobertura se convierte en semáforo de listo-para-radicar"
```
