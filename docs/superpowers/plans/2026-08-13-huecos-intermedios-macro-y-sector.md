# Huecos Intermedios de III.A/III.B y Conexión de III.C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que ningún párrafo de prosa de la Sección III (Tendencias de la Economía) del informe sobreviva del cliente de referencia — no solo el primer bloque de cada apartado (ya resuelto), sino los bloques intermedios entre tablas (Política Monetaria, Tasa de Cambio, Mercado Laboral, Conclusiones) y la totalidad de III.C (Análisis del Sector), que hoy no se toca en absoluto.

**Architecture:** Se generaliza el localizador de un solo hueco de prosa (`localizarBloqueProsa`, ya existente) a una lista ORDENADA de encabezados ("hitos") que deben aparecer en secuencia en el documento; el contenido entre cada par de hitos consecutivos se reemplaza según una regla propia de ese hueco — la narrativa real de Firestore cuando existe una específica para ese tema (III.C), un marcador genérico cuando el hueco tiene prosa sustancial pero no hay narrativa específica para él (huecos intermedios de III.A/III.B), o se deja intacto cuando ahí vive una tabla que otro mecanismo ya actualiza (la de "Datos Clave del Sector").

**Tech Stack:** JavaScript (ESM), `node:test`, manipulación de OOXML/HTML crudo — mismo stack que el resto de `docxRelleno.js`/`tablasHtmlInforme.js`.

**Spec:** Este plan no parte de un spec formal separado — la investigación que lo sustenta (mapeo completo de la plantilla real de End Game, confirmación de qué se actualiza y qué no) está en la conversación que lo originó; los hallazgos relevantes se citan verbatim en cada tarea.

## Global Constraints

- Código, comentarios, UI y mensajes en español.
- `npm test` debe quedar en 100 % verde tras cada tarea.
- Ninguna cifra ni frase del informe de referencia puede sobrevivir sin marcador visible.
- Las dos rutas de generación (`.docx` vía `docxRelleno.js`, HTML/PDF vía `tablasHtmlInforme.js`/`plantillaRenderer.js`) deben quedar con el mismo comportamiento.
- Las tareas que tocan OOXML crudo requieren además una prueba manual generando el `.docx` real (`Archivos Prueba/Informe Local End Game _ 2024_v2.docx`) — las pruebas unitarias con XML sintético no pueden atrapar todo (ya pasó una vez con el bug del TOC).
- No usar `window.confirm`/`window.alert`.
- Cada función nueva deja rastro en consola (`console.log`/`console.warn`, prefijo `[docxRelleno]` o `[tablasHtmlInforme]` según el archivo) de qué hito encontró, cuál no, y si reemplazó un hueco con narrativa real o con marcador — para poder diagnosticar en logs de producción (Cloud Functions) o en la consola del navegador sin tener que releer el código. Ya incorporado en el código de cada tarea de este plan.

## Contexto verificado (mapeo real de la plantilla de End Game)

Estructura real de III.A/III.B, extraída del `.docx` de referencia (heading → contenido → siguiente heading):

```
A. Análisis del Panorama de la Economía Mundial   ← YA SE REEMPLAZA (narrativa real)
  [prosa REAL ya insertada]
Tabla: Crecimiento del PIB Mundial (...)            ← tabla, ya se actualiza (mecanismo previo)
[INFLACIÓN MUNDIAL — sin prosa, va directo a la tabla]
Tabla: Tasas de Inflación Global (...)              ← tabla, ya se actualiza
[Pronóstico Año 2025 (Economía Mundial) — sin prosa]
Tabla: Proyecciones de Crecimiento del PIB por Región/País (...)  ← tabla, ya se actualiza
B. Análisis del panorama de la economía colombiana.  ← YA SE REEMPLAZA (narrativa real)
  [prosa REAL ya insertada]
Tabla: Crecimiento del PIB en Colombia (...)        ← tabla, ya se actualiza
INFLACIÓN COLOMBIA 
[prosa]  ← NO SE TOCA
Tabla: Inflación en Colombia (...)                  ← tabla, ya se actualiza
Política Monetaria
[prosa]  ← NO SE TOCA
  "La tasa de intervención... descendió desde el 13,25 %... hasta el 9,50 %..."  ← NO SE TOCA (cifras de 2023-2024)
Tabla: Tasa de Intervención del Banco de la República (...)  ← tabla, ya se actualiza
Tasa de Cambio (TRM)
  "...la TRM promedió $4.062... apreciación del 6 %..."  ← NO SE TOCA
Tabla: Tasa Representativa del Mercado (TRM) Promedio (...)  ← tabla, ya se actualiza
Mercado Laboral
  [prosa]  ← NO SE TOCA
Tabla: Tasa de Desempleo en Colombia (...)          ← tabla, ya se actualiza
CONCLUSIONES
  [prosa que cierra III.A y III.B]  ← NO SE TOCA
Análisis del Sector de la industria del software y de los videojuegos  ← III.C: NUNCA SE TOCA, ni prosa ni tabla
  Comportamiento del Sector de la Industria del Software y de los Videojuegos en 2024 y Comparación con 2023
    [prosa]  ← NO SE TOCA
  Datos Clave del Sector de la Industria del Software y de los Videojuegos en Colombia (2023 vs. 2024)  ← tabla, NUNCA se actualiza
  Importaciones y exportaciones del sector de la industria del software y de los videojuegos
    [prosa]  ← NO SE TOCA
  ¿Qué se proyecta para el sector de la industria del software y de los videojuegos en 2025?
    [prosa]  ← NO SE TOCA
  Conclusiones y Perspectivas
    [prosa]  ← NO SE TOCA
ANÁLISIS ECONÓMICO  ← fin de III.C, empieza la siguiente sección del informe
```

Los nombres de tabla (`nombre`) que ya reconoce `tablasMacroInforme` (`frontend/src/services/tablasInforme.js:295-391`), en el orden en que aparecen: `'PIB Mundial'`, `'Inflación Global'`, `'por Región/País'` (mundial); `'PIB en Colombia'`, `'Inflación en Colombia'`, `'Intervención del Banco'`, `'Tasa Representativa del Mercado'`, `'Desempleo en Colombia'` (colombia).

La estructura de III.C que ya arma `generarApartadoSectorial` (`frontend/src/services/analisisMercado.js:411-478`), en HTML, coincide palabra por palabra con los encabezados reales: `'Comportamiento del Sector de la Industria ' + nombreSector + ...`, la tabla `'Datos Clave del Sector de la Industria ' + nombreSector + ...'`, `'Importaciones y exportaciones del sector de la industria ' + nombreSector`, `'¿Qué se proyecta para el sector de la industria ' + nombreSector + ...'`, `'Conclusiones y Perspectivas'`. Los campos de origen son `entrada.narrativa.comportamiento`, `.comercioExterior`, `.proyeccion`, `.conclusiones` y `entrada.datosClaveTabla` (array de `{indicador, valorAnterior, valorActual}`), donde `entrada = analisisSector.porAnio[String(year)]`.

---

## Grupo C — Generalizar el reemplazo a TODOS los huecos de III.A/III.B (OOXML)

### Task 1: `localizarHitos` y `reemplazarPorHitos`, el mecanismo genérico

**Files:**
- Modify: `frontend/src/services/docxRelleno.js` (agregar, cerca de `localizarBloqueProsa`)
- Test: `frontend/src/services/docxRelleno.test.js`

**Interfaces:**
- Produces:
  - `localizarHitos(xml, titulos)` → `Array<{inicio:number, finPropio:number}|null>`, un elemento por cada título de `titulos`, en el mismo orden. `null` en la posición `i` si ese título no se encontró (después de haber encontrado, en orden, todos los anteriores).
  - `reemplazarPorHitos(doc, titulos, contenidos, avisos, nombreParaAvisos)` — `doc` es un `sustituidorDeTablas` (ya existente); `contenidos` es un arreglo de funciones `(textoPlanoDelHueco:string) => string|null`, uno por cada hueco entre `titulos[i]` y `titulos[i+1]` (longitud `titulos.length - 1`); devolver `null` dice "no tocar este hueco". No devuelve nada — opera con `doc.aplicar(...)`.

- [ ] **Step 1: Escribir la prueba que falla**

```javascript
import { localizarHitos, reemplazarPorHitos } from './docxRelleno.js';

test('localizarHitos encuentra los encabezados en orden y da el fin de cada uno', () => {
  const xml = [
    parrafoXml('Uno'),
    parrafoXml('Dos'),
    parrafoXml('Tres'),
  ].join('');
  const hitos = localizarHitos(xml, ['Uno', 'Tres']);
  assert.equal(hitos.length, 2);
  assert.ok(hitos[0]);
  assert.ok(hitos[1]);
  assert.ok(hitos[0].inicio < hitos[0].finPropio);
  assert.ok(hitos[0].finPropio <= hitos[1].inicio);
});

test('localizarHitos devuelve null en las posiciones que no encuentra, sin lanzar', () => {
  const xml = parrafoXml('Uno') + parrafoXml('Tres');
  const hitos = localizarHitos(xml, ['Uno', 'Dos', 'Tres']);
  assert.ok(hitos[0]);
  assert.equal(hitos[1], null);
});

test('localizarHitos ignora las entradas de la Tabla de Contenido (PAGEREF)', () => {
  const entradaToc = '<w:p><w:r><w:t>Uno</w:t></w:r><w:r><w:instrText xml:space="preserve"> PAGEREF _Toc1 \\h </w:instrText></w:r></w:p>';
  const xml = entradaToc + parrafoXml('Uno') + parrafoXml('Dos');
  const hitos = localizarHitos(xml, ['Uno', 'Dos']);
  assert.ok(hitos[0].inicio > entradaToc.length - 1);
});

test('reemplazarPorHitos reemplaza el hueco cuando la función de contenido devuelve texto', () => {
  const xml = [
    parrafoXml('Encabezado A'),
    parrafoXml('Prosa vieja que debe irse.'),
    parrafoXml('Encabezado B'),
  ].join('');
  const doc = { xmlInterno: xml, aplicar(t) { this.xmlInterno = t(this.xmlInterno); }, get xml() { return this.xmlInterno; } };
  reemplazarPorHitos(doc, ['Encabezado A', 'Encabezado B'], [() => parrafoXml('Prosa nueva.')], []);
  assert.match(doc.xml, /Prosa nueva\./);
  assert.doesNotMatch(doc.xml, /Prosa vieja/);
  assert.match(doc.xml, /Encabezado A/); // el propio hito no se toca
  assert.match(doc.xml, /Encabezado B/);
});

test('reemplazarPorHitos no toca el hueco cuando la función de contenido devuelve null', () => {
  const xml = [
    parrafoXml('Encabezado A'),
    parrafoXml('Tabla que no hay que tocar.'),
    parrafoXml('Encabezado B'),
  ].join('');
  const doc = { xmlInterno: xml, aplicar(t) { this.xmlInterno = t(this.xmlInterno); }, get xml() { return this.xmlInterno; } };
  reemplazarPorHitos(doc, ['Encabezado A', 'Encabezado B'], [() => null], []);
  assert.match(doc.xml, /Tabla que no hay que tocar\./);
});

test('reemplazarPorHitos avisa cuando un hito no se encuentra, sin lanzar', () => {
  const xml = parrafoXml('Encabezado A');
  const doc = { xmlInterno: xml, aplicar(t) { this.xmlInterno = t(this.xmlInterno); }, get xml() { return this.xmlInterno; } };
  const avisos = [];
  reemplazarPorHitos(doc, ['Encabezado A', 'Encabezado B'], [() => 'nunca se usa'], avisos, 'III.A');
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /III\.A/);
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `node --test frontend/src/services/docxRelleno.test.js`
Expected: FAIL — `localizarHitos is not a function`.

- [ ] **Step 3: Implementación mínima**

Agregar en `docxRelleno.js`, después de `localizarBloqueProsa`:

```javascript
/**
 * Los `titulos`, en el orden en que deben aparecer en el documento, con dónde empieza
 * y dónde termina el párrafo de cada uno. Sirve para delimitar TODOS los huecos entre
 * un encabezado y el siguiente en un solo recorrido — `localizarBloqueProsa` resuelve
 * un único hueco; esta es su generalización a una cadena de encabezados.
 *
 * Se exige que aparezcan en ESE orden: en cuanto se encuentra el título `i`, la
 * búsqueda del título `i+1` empieza después de él, nunca antes ni desde el principio
 * del documento — así una tabla que se llame igual que un encabezado posterior no se
 * confunde con él.
 *
 * @param {string} xml
 * @param {string[]} titulos
 * @returns {Array<{inicio:number, finPropio:number}|null>}
 */
export function localizarHitos(xml, titulos) {
  const texto = String(xml || '');
  const claves = (titulos || []).map(claveTitulo);
  const resultado = new Array(claves.length).fill(null);
  if (!claves.length) return resultado;

  const rxParrafo = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let objetivo = 0;
  let m;
  while (objetivo < claves.length && (m = rxParrafo.exec(texto)) !== null) {
    if (m[0].includes('PAGEREF')) continue;
    const clave = claveTitulo(textoPlanoOoxml(m[0]));
    if (clave.includes(claves[objetivo])) {
      resultado[objetivo] = { inicio: m.index, finPropio: m.index + m[0].length };
      objetivo++;
    }
  }
  return resultado;
}

/**
 * Reemplaza, uno por uno, los huecos entre una lista ordenada de encabezados. Cada
 * hueco es el texto entre el final del párrafo de un hito y el inicio del párrafo del
 * siguiente — el propio encabezado nunca se toca.
 *
 * @param {{aplicar:(f:(s:string)=>string)=>void}} doc  un `sustituidorDeTablas`.
 * @param {string[]} titulos
 * @param {Array<(textoHueco:string)=>(string|null)>} contenidos  longitud
 *        `titulos.length - 1`; recibe el texto plano ya existente en ese hueco (para
 *        decidir si hace falta tocarlo) y devuelve el OOXML nuevo, o `null` para
 *        dejarlo como está.
 * @param {string[]} [avisos]
 * @param {string} [nombreParaAvisos]
 */
export function reemplazarPorHitos(doc, titulos, contenidos, avisos, nombreParaAvisos) {
  doc.aplicar((actual) => {
    const hitos = localizarHitos(actual, titulos);
    console.log('[docxRelleno] ' + (nombreParaAvisos || '') + ': hitos encontrados '
      + hitos.filter(Boolean).length + '/' + titulos.length + ' (' + titulos.join(' → ') + ')');
    let salida = actual;
    for (let i = contenidos.length - 1; i >= 0; i -= 1) {
      const hitoActual = hitos[i];
      const hitoSiguiente = hitos[i + 1];
      if (!hitoActual || !hitoSiguiente) {
        const aviso = (nombreParaAvisos || '') + ': no se encontró "' + titulos[i] + '" o "' + titulos[i + 1] + '"';
        console.warn('[docxRelleno] ' + aviso);
        if (Array.isArray(avisos)) avisos.push(aviso);
        continue;
      }
      const textoHueco = textoPlanoOoxml(salida.slice(hitoActual.finPropio, hitoSiguiente.inicio));
      const nuevo = contenidos[i](textoHueco);
      if (nuevo === null) {
        console.log('[docxRelleno] hueco "' + titulos[i] + '" → "' + titulos[i + 1] + '": sin tocar');
        continue;
      }
      console.log('[docxRelleno] hueco "' + titulos[i] + '" → "' + titulos[i + 1] + '": reemplazado ('
        + textoHueco.length + ' caracteres viejos → ' + nuevo.length + ' nuevos)');
      salida = salida.slice(0, hitoActual.finPropio) + nuevo + salida.slice(hitoSiguiente.inicio);
    }
    return salida;
  });
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node --test frontend/src/services/docxRelleno.test.js`
Expected: PASS en las seis pruebas nuevas y en todas las anteriores (no se tocó ninguna función existente).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/docxRelleno.js frontend/src/services/docxRelleno.test.js
git commit -m "feat: localizar y reemplazar una cadena de encabezados, no solo un hueco de prosa"
```

---

### Task 2: `actualizarApartadosMacroOoxml` cubre TODOS los huecos, no solo el primero

**Files:**
- Modify: `frontend/src/services/docxRelleno.js` (reescribir el cuerpo de `actualizarApartadosMacroOoxml`, mismo nombre — nada más la llama por nombre distinto)
- Test: `frontend/src/services/docxRelleno.test.js`

**Interfaces:**
- Consumes: `localizarHitos`, `reemplazarPorHitos` (Task 1); `parrafosOoxmlDesdeHtml` (ya existente).
- Produces: mismo `actualizarApartadosMacroOoxml(xml, datosMacro, year, avisos)` de siempre — la firma no cambia, así que `renderizarDocx` no necesita tocarse.

- [ ] **Step 1: Escribir la prueba que falla**

```javascript
test('actualizarApartadosMacroOoxml reemplaza también los huecos intermedios entre tablas', () => {
  const xml = [
    parrafoXml('A. Análisis del Panorama de la Economía Mundial'),
    parrafoXml('Texto de END GAME sobre el mundo, 2024.'),
    parrafoXml('Crecimiento del PIB Mundial (2024-2026)'),
    parrafoXml('Tasas de Inflación Global (2024-2026)'),
    parrafoXml('Proyecciones de Crecimiento del PIB por Región/País (2026)'),
    parrafoXml('B. Análisis del panorama de la economía colombiana'),
    parrafoXml('Texto de END GAME sobre Colombia, 2024.'),
    parrafoXml('Crecimiento del PIB en Colombia (2024-2026)'),
    parrafoXml('Inflación en Colombia (2024 vs. Meta 2025)'),
    parrafoXml('Política Monetaria'),
    parrafoXml('La tasa de intervención descendió desde el 13,25 % hasta el 9,50 % en 2024, texto viejo de referencia.'),
    parrafoXml('Tasa de Intervención del Banco de la República (Marzo 2023 - Diciembre 2024)'),
    parrafoXml('Tasa de Cambio (TRM)'),
    parrafoXml('La TRM promedió $4.062 en 2024, texto viejo de referencia.'),
    parrafoXml('Tasa Representativa del Mercado (TRM) Promedio (2023-2024)'),
    parrafoXml('Mercado Laboral'),
    parrafoXml('El desempleo bajó a 9,7 % en 2024, texto viejo de referencia.'),
    parrafoXml('Tasa de Desempleo en Colombia (2024 vs. Proyección 2025)'),
    parrafoXml('CONCLUSIONES'),
    parrafoXml('La economía mundial se encuentra en desaceleración, texto viejo de referencia.'),
    parrafoXml('Análisis del Sector de la industria del software'),
  ].join('');

  const datosMacro = {
    narrativa: {
      mundial: '<p>Narrativa real del mundo.</p>',
      colombia: '<p>Narrativa real de Colombia.</p>',
    },
  };

  const avisos = [];
  const salida = actualizarApartadosMacroOoxml(xml, datosMacro, 2026, avisos);

  assert.match(salida, /Narrativa real del mundo\./);
  assert.match(salida, /Narrativa real de Colombia\./);
  assert.doesNotMatch(salida, /texto viejo de referencia/);
  assert.doesNotMatch(salida, /13,25 %/);
  // los encabezados intermedios y las tablas sobreviven intactos
  assert.match(salida, /Política Monetaria/);
  assert.match(salida, /Tasa de Intervención del Banco de la República/);
  assert.match(salida, /CONCLUSIONES/);
});

test('actualizarApartadosMacroOoxml no toca un hueco intermedio corto (sin prosa real)', () => {
  const xml = [
    parrafoXml('A. Análisis del Panorama de la Economía Mundial'),
    parrafoXml('Narrativa que sí se reemplaza.'),
    parrafoXml('Crecimiento del PIB Mundial (2024-2026)'),
    parrafoXml('INFLACIÓN MUNDIAL'), // hueco corto: sin prosa entre esto y la tabla
    parrafoXml('Tasas de Inflación Global (2024-2026)'),
    parrafoXml('Proyecciones de Crecimiento del PIB por Región/País (2026)'),
    parrafoXml('B. Análisis del panorama de la economía colombiana'),
  ].join('');

  const datosMacro = { narrativa: { mundial: '<p>Narrativa real.</p>' } };
  const salida = actualizarApartadosMacroOoxml(xml, datosMacro, 2026, []);
  // el encabezado corto sigue ahí, sin marcador de pendiente pegado encima
  assert.match(salida, /INFLACIÓN MUNDIAL/);
  assert.doesNotMatch(salida, /\[Este párrafo del informe de referencia/);
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `node --test frontend/src/services/docxRelleno.test.js`
Expected: FAIL — la implementación actual solo reemplaza el primer hueco; `texto viejo de referencia` y `13,25 %` siguen presentes.

- [ ] **Step 3: Implementación**

Reemplazar el cuerpo de `actualizarApartadosMacroOoxml` (la versión de una sola tarea, en `docxRelleno.js`) por esta versión, que cubre todos los huecos:

```javascript
/** Marcador genérico para un hueco intermedio (entre dos tablas) que tenía prosa
 *  sustancial del informe de referencia y no hay una narrativa específica de ese
 *  tema para reemplazarla — a diferencia del hueco líder de cada apartado, que sí
 *  tiene la narrativa completa de Firestore. */
function marcadorContenidoRetirado() {
  return '[Este párrafo del informe de referencia se retiró porque describía cifras y ' +
    'hechos de otro contribuyente. Redáctelo con información propia de este año antes ' +
    'de radicar.]';
}

/** Longitud de texto plano a partir de la cual un hueco intermedio se considera
 *  "con prosa real" y se reemplaza. Los huecos vacíos de la plantilla —un
 *  subtítulo sin narrativa antes de la tabla— quedan bajo este umbral y no se
 *  tocan: no hay nada del cliente de referencia que retirar ahí. */
const UMBRAL_HUECO_CON_PROSA = 50;

/** Contenido para un hueco intermedio: el marcador SOLO si había prosa sustancial
 *  que retirar; si el hueco ya estaba vacío o casi vacío, no se toca. */
function contenidoHuecoIntermedio(textoHueco) {
  return textoHueco.trim().length >= UMBRAL_HUECO_CON_PROSA ? marcadorContenidoRetirado() : null;
}

export function actualizarApartadosMacroOoxml(xml, datosMacro, year, avisos) {
  const doc = sustituidorDeTablas(xml, null);

  const tituloMundial = 'Análisis del Panorama de la Economía Mundial';
  const tituloColombia = 'Análisis del panorama de la economía colombiana';
  const narrativaMundial = datosMacro && datosMacro.narrativa && datosMacro.narrativa.mundial;
  const narrativaColombia = datosMacro && datosMacro.narrativa && datosMacro.narrativa.colombia;
  console.log('[docxRelleno] actualizarApartadosMacroOoxml: año ' + year
    + ', narrativa mundial: ' + (narrativaMundial ? 'sí' : 'no (marcador)')
    + ', narrativa colombia: ' + (narrativaColombia ? 'sí' : 'no (marcador)'));

  const primerHueco = (narrativaHtml, tema) => () => (
    narrativaHtml
      ? parrafosOoxmlDesdeHtml(narrativaHtml)
      : `<w:p><w:r><w:t xml:space="preserve">${escaparXml(marcadorApartadoPendiente(tema, year))}</w:t></w:r></w:p>`
  );

  reemplazarPorHitos(
    doc,
    [tituloMundial, 'PIB Mundial', 'Inflación Global', 'por Región/País', tituloColombia],
    [
      primerHueco(narrativaMundial, 'mundial'),
      contenidoHuecoIntermedio,
      contenidoHuecoIntermedio,
    ],
    avisos,
    tituloMundial
  );

  reemplazarPorHitos(
    doc,
    [
      tituloColombia, 'PIB en Colombia', 'Inflación en Colombia', 'Intervención del Banco',
      'Tasa Representativa del Mercado', 'Desempleo en Colombia', 'Análisis del Sector',
    ],
    [
      primerHueco(narrativaColombia, 'colombiana'),
      contenidoHuecoIntermedio,
      contenidoHuecoIntermedio,
      contenidoHuecoIntermedio,
      contenidoHuecoIntermedio,
      contenidoHuecoIntermedio,
    ],
    avisos,
    tituloColombia
  );

  if (!narrativaMundial && Array.isArray(avisos)) avisos.push('narrativa de ' + tituloMundial);
  if (!narrativaColombia && Array.isArray(avisos)) avisos.push('narrativa de ' + tituloColombia);

  return doc.xml;
}
```

Nota: el último hito de la lista de colombia (`'Análisis del Sector'`) es el límite de cierre para el hueco de "CONCLUSIONES" — coincide, como substring, con las dos formas posibles del título de III.C (`'Análisis del Sector de la industria ' + nombre` y el respaldo `'Análisis del Sector económico de la Compañía'`), así que sirve sin depender de la actividad del cliente.

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node --test frontend/src/services/docxRelleno.test.js`
Expected: PASS en las dos pruebas nuevas y en las de la tarea anterior (mismo comportamiento para el primer hueco de cada apartado).

- [ ] **Step 5: Ejecutar toda la suite**

Run: `node --test scripts/lib/*.test.js frontend/src/services/*.test.js frontend/src/utils/*.test.js functions/*.test.js`
Expected: 100 % verde.

- [ ] **Step 6: Prueba manual sobre el .docx real**

```bash
cd frontend
node -e "
const fs = require('fs');
async function main() {
  const { renderizarDocx } = await import('./src/services/docxRelleno.js');
  const binario = fs.readFileSync('Archivos Prueba/Informe Local End Game _ 2024_v2.docx');
  const datosMacro = {
    narrativa: {
      mundial: '<p>Narrativa de prueba del mundo.</p>',
      colombia: '<p>Narrativa de prueba de Colombia.</p>',
    },
  };
  const { zip } = renderizarDocx(binario, { anio: 2025, ent: 'PRUEBA S.A.S' }, { datosMacro });
  const xml = zip.file('word/document.xml').asText();
  console.log('queda 13,25:', xml.includes('13,25'));
  console.log('queda 4.062:', xml.includes('4.062') || xml.includes('4,062'));
  console.log('queda texto de desaceleración estructural (CONCLUSIONES vieja):', xml.includes('desaceleración estructural'));
  console.log('sigue el encabezado Política Monetaria:', xml.includes('Política Monetaria'));
  console.log('sigue el encabezado CONCLUSIONES:', xml.includes('CONCLUSIONES'));
}
main();
"
```

Expected: las tres primeras impresiones en `false` (las cifras y la prosa vieja se fueron), las dos últimas en `true` (los encabezados de estructura sobreviven). Si alguna cifra vieja sigue apareciendo, revisar contra el mapeo de la plantilla real en este mismo plan — puede que la plantilla del cliente use un rótulo ligeramente distinto y el hito no la esté encontrando (se anota en `avisos`, revisar esa lista primero).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/services/docxRelleno.js frontend/src/services/docxRelleno.test.js
git commit -m "fix: la prosa de los huecos intermedios de III.A/III.B tambien se retira"
```

---

### Task 3: Conectar III.C (Análisis del Sector) al documento, por sus cuatro encabezados internos

**Files:**
- Modify: `frontend/src/services/docxRelleno.js` (nueva función + wiring en `renderizarDocx`)
- Test: `frontend/src/services/docxRelleno.test.js`

**Interfaces:**
- Consumes: `reemplazarPorHitos`, `localizarHitos` (Task 1); `parrafosOoxmlDesdeHtml`, `generarTablaOoxml` (ya existentes).
- Produces: `actualizarApartadoSectorialOoxml(xml, analisisSector, estudio, year, avisos)` → xml. Se llama desde `renderizarDocx` junto a `actualizarApartadosMacroOoxml`.

- [ ] **Step 1: Escribir la prueba que falla**

```javascript
test('actualizarApartadoSectorialOoxml reemplaza los cuatro bloques de prosa y la tabla de datos clave', () => {
  const xml = [
    parrafoXml('Análisis del Sector de la industria del software y de los videojuegos'),
    parrafoXml('Comportamiento del Sector de la Industria del Software y de los Videojuegos en 2024 y Comparación con 2023'),
    parrafoXml('Texto viejo de comportamiento, referencia 2024.'),
    parrafoXml('Datos Clave del Sector de la Industria del Software y de los Videojuegos en Colombia (2023 vs. 2024)'),
    parrafoXml('Fila vieja de la tabla de datos clave.'),
    parrafoXml('Importaciones y exportaciones del sector de la industria del software y de los videojuegos'),
    parrafoXml('Texto viejo de comercio exterior, referencia 2024.'),
    parrafoXml('¿Qué se proyecta para el sector de la industria del software y de los videojuegos en 2025?'),
    parrafoXml('Texto viejo de proyección, referencia 2024.'),
    parrafoXml('Conclusiones y Perspectivas'),
    parrafoXml('Texto viejo de conclusiones, referencia 2024.'),
    parrafoXml('ANÁLISIS ECONÓMICO'),
  ].join('');

  const analisisSector = {
    porAnio: {
      2026: {
        tituloSector: 'Software y Videojuegos',
        narrativa: {
          comportamiento: '<p>Comportamiento real 2026.</p>',
          comercioExterior: '<p>Comercio exterior real 2026.</p>',
          proyeccion: '<p>Proyección real 2026.</p>',
          conclusiones: '<p>Conclusiones reales 2026.</p>',
        },
        datosClaveTabla: [
          { indicador: 'Empleo', valorAnterior: '250.000', valorActual: '260.000' },
        ],
      },
    },
  };

  const avisos = [];
  const salida = actualizarApartadoSectorialOoxml(xml, analisisSector, { anio: 2026 }, 2026, avisos);

  assert.match(salida, /Comportamiento real 2026\./);
  assert.match(salida, /Comercio exterior real 2026\./);
  assert.match(salida, /Proyección real 2026\./);
  assert.match(salida, /Conclusiones reales 2026\./);
  assert.doesNotMatch(salida, /Texto viejo/);
  assert.match(salida, /260\.000/); // la tabla de datos clave se regeneró con la cifra nueva
});

test('actualizarApartadoSectorialOoxml usa el marcador de pendiente si no hay corrida para ese año', () => {
  const xml = [
    parrafoXml('Análisis del Sector de la industria del software y de los videojuegos'),
    parrafoXml('Comportamiento del Sector de la Industria del Software y de los Videojuegos en 2024 y Comparación con 2023'),
    parrafoXml('Texto viejo de comportamiento, referencia 2024.'),
    parrafoXml('Datos Clave del Sector de la Industria del Software y de los Videojuegos en Colombia (2023 vs. 2024)'),
    parrafoXml('Fila vieja.'),
    parrafoXml('Importaciones y exportaciones del sector de la industria del software y de los videojuegos'),
    parrafoXml('Texto viejo de comercio, referencia 2024.'),
    parrafoXml('¿Qué se proyecta para el sector de la industria del software y de los videojuegos en 2025?'),
    parrafoXml('Texto viejo de proyección, referencia 2024.'),
    parrafoXml('Conclusiones y Perspectivas'),
    parrafoXml('Texto viejo de conclusiones, referencia 2024.'),
    parrafoXml('ANÁLISIS ECONÓMICO'),
  ].join('');

  const avisos = [];
  const salida = actualizarApartadoSectorialOoxml(xml, null, { anio: 2026 }, 2026, avisos);

  assert.doesNotMatch(salida, /Texto viejo/);
  assert.match(salida, /\[Actualizar con el análisis del comportamiento del sector/);
  assert.ok(avisos.length >= 1);
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `node --test frontend/src/services/docxRelleno.test.js`
Expected: FAIL — `actualizarApartadoSectorialOoxml is not a function`.

- [ ] **Step 3: Implementación**

Agregar en `docxRelleno.js`, después de `actualizarApartadosMacroOoxml`:

```javascript
/** Mismo texto que `marcadorApartadoPendiente`, pero para un tema puntual de III.C
 *  en vez de todo el apartado de III.A/III.B. */
function marcadorTemaSectorPendiente(tema, year) {
  return '[Actualizar con el análisis del ' + tema + ' del sector para el año gravable ' +
    year + ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]';
}

/** Fila de la tabla "Datos Clave del Sector", en la forma que espera `generarTablaOoxml`. */
function filasDatosClaveSector(datosClaveTabla) {
  return (datosClaveTabla || []).map((f) => [
    String(f.indicador || ''),
    f.valorAnterior ? String(f.valorAnterior) : '—',
    String(f.valorActual || ''),
  ]);
}

/**
 * Reemplaza los cuatro bloques de prosa de III.C (Comportamiento, Importaciones y
 * exportaciones, Proyección, Conclusiones y Perspectivas) y la tabla "Datos Clave del
 * Sector", localizándolos por sus encabezados — mismo mecanismo de
 * `actualizarApartadosMacroOoxml`, aplicado a III.C, que hoy no se toca en absoluto:
 * depende enteramente del marcado con IA, y esta plantilla no lo trajo marcado.
 *
 * @param {string} xml
 * @param {object|null} analisisSector  el documento `analisisSector/{claveActividad}`.
 * @param {object} estudio
 * @param {number} year
 * @param {string[]} [avisos]
 * @returns {string}
 */
export function actualizarApartadoSectorialOoxml(xml, analisisSector, estudio, year, avisos) {
  const entrada = analisisSector && analisisSector.porAnio && analisisSector.porAnio[String(year)];
  console.log('[docxRelleno] actualizarApartadoSectorialOoxml: año ' + year
    + ', corrida de sector para este año: ' + (entrada ? 'sí (' + (entrada.tituloSector || 'sin título') + ')' : 'no (marcador)'));
  const doc = sustituidorDeTablas(xml, null);

  const titulos = [
    'Análisis del Sector',
    'Comportamiento del Sector',
    'Datos Clave del Sector',
    'Importaciones y exportaciones del sector',
    '¿Qué se proyecta para el sector',
    'Conclusiones y Perspectivas',
    'ANÁLISIS ECONÓMICO',
  ];

  const bloque = (narrativaHtml, tema) => () => (
    narrativaHtml
      ? parrafosOoxmlDesdeHtml(narrativaHtml)
      : `<w:p><w:r><w:t xml:space="preserve">${escaparXml(marcadorTemaSectorPendiente(tema, year))}</w:t></w:r></w:p>`
  );

  reemplazarPorHitos(
    doc,
    titulos,
    [
      contenidoHuecoIntermedio, // entre el encabezado principal y "Comportamiento del Sector": normalmente vacío
      bloque(entrada && entrada.narrativa.comportamiento, 'comportamiento del sector'),
      () => null, // entre "Datos Clave del Sector" y "Importaciones...": ahí vive la tabla, se regenera aparte
      bloque(entrada && entrada.narrativa.comercioExterior, 'comercio exterior del sector'),
      bloque(entrada && entrada.narrativa.proyeccion, 'proyección del sector'),
      bloque(entrada && entrada.narrativa.conclusiones, 'conclusiones del sector'),
    ],
    avisos,
    'Análisis del Sector'
  );

  if (entrada && entrada.datosClaveTabla && entrada.datosClaveTabla.length) {
    const encontrada = doc.reemplazar('Datos Clave del Sector', (b) => generarTablaOoxml(
      'Datos Clave del Sector de la Industria ' + (entrada.tituloSector || '') + ' en Colombia (' +
        (year - 1) + ' vs. ' + year + ')',
      ['Indicador Clave', String(year - 1), String(year)],
      filasDatosClaveSector(entrada.datosClaveTabla),
      null
    ));
    console.log('[docxRelleno] tabla "Datos Clave del Sector": '
      + (encontrada ? 'regenerada con ' + entrada.datosClaveTabla.length + ' fila(s)' : 'NO se encontró en la plantilla'));
  } else {
    console.log('[docxRelleno] tabla "Datos Clave del Sector": sin datos de la corrida de este año, se deja como está');
    if (Array.isArray(avisos)) avisos.push('tabla de Datos Clave del Sector');
  }

  return doc.xml;
}
```

Y en `renderizarDocx` (`docxRelleno.js`, cerca de `xml = actualizarApartadosMacroOoxml(...)`), agregar justo después:

```javascript
  xml = actualizarApartadosMacroOoxml(xml, datosMacro, year, avisosTablas);
  xml = actualizarApartadoSectorialOoxml(xml, analisisSector, estudio, year, avisosTablas);
  xml = actualizarTablasMacroOoxml(xml, datosMacro, year, avisosTablas);
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node --test frontend/src/services/docxRelleno.test.js`
Expected: PASS.

- [ ] **Step 5: Ejecutar toda la suite**

Run: `node --test scripts/lib/*.test.js frontend/src/services/*.test.js frontend/src/utils/*.test.js functions/*.test.js`
Expected: 100 % verde.

- [ ] **Step 6: Prueba manual sobre el .docx real**

Igual que en la Task 2, generar el `.docx` real con un `analisisSector` de prueba (o `null`, para confirmar que cae al marcador) y verificar en el XML que ninguno de los cuatro textos viejos del sector sobrevive, y que la tabla de Datos Clave, si hay `entrada`, trae las cifras nuevas.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/services/docxRelleno.js frontend/src/services/docxRelleno.test.js
git commit -m "feat: III.C (Análisis del Sector) se reemplaza por encabezado, igual que III.A/III.B"
```

---

## Grupo D — Mismo mecanismo en la ruta HTML/PDF

### Task 4: `localizarHitosHtml` y `reemplazarPorHitosHtml`

**Files:**
- Modify: `frontend/src/services/tablasHtmlInforme.js`
- Test: `frontend/src/services/tablasHtmlInforme.test.js`

**Interfaces:**
- Consumes: `claveTitulo` (ya importado de `docxRelleno.js` en este archivo), `textoPlanoHtml`, `RX_BLOQUE` (ya existentes en el archivo), `pareceEntradaDeToc` (de la tarea de III.A/III.B ya hecha).
- Produces: `localizarHitosHtml(html, titulos)` → mismo contrato que `localizarHitos` pero sobre HTML; `reemplazarHuecosHtml(html, titulos, contenidos, avisos, nombreParaAvisos)` → `string` (a diferencia de la versión OOXML, esta SÍ devuelve el html nuevo directamente — no hay un `doc.aplicar`, `tablasHtmlInforme.js` trabaja con `let salida` reasignada).

- [ ] **Step 1: Escribir la prueba que falla**

```javascript
import { localizarHitosHtml, reemplazarHuecosHtml } from './tablasHtmlInforme.js';

test('localizarHitosHtml encuentra los encabezados en orden, ignorando entradas de TOC', () => {
  const html = [
    '<p>A. Análisis del Panorama de la Economía Mundial ... 13</p>', // TOC
    '<h2>A. Análisis del Panorama de la Economía Mundial</h2>',
    '<p>Prosa.</p>',
    '<h3>Crecimiento del PIB Mundial (2024-2026)</h3>',
  ].join('');
  const hitos = localizarHitosHtml(html, ['Análisis del Panorama de la Economía Mundial', 'PIB Mundial']);
  assert.ok(hitos[0]);
  assert.ok(hitos[1]);
  assert.ok(hitos[0].inicio > html.indexOf('<h2>')); // no la entrada de TOC
});

test('reemplazarHuecosHtml reemplaza el hueco cuando la función de contenido devuelve texto', () => {
  const html = '<h2>Encabezado A</h2><p>Prosa vieja.</p><h2>Encabezado B</h2>';
  const salida = reemplazarHuecosHtml(html, ['Encabezado A', 'Encabezado B'], [() => '<p>Prosa nueva.</p>'], []);
  assert.match(salida, /Prosa nueva\./);
  assert.doesNotMatch(salida, /Prosa vieja/);
});

test('reemplazarHuecosHtml no toca el hueco cuando la función de contenido devuelve null', () => {
  const html = '<h2>Encabezado A</h2><table><tr><td>dato</td></tr></table><h2>Encabezado B</h2>';
  const salida = reemplazarHuecosHtml(html, ['Encabezado A', 'Encabezado B'], [() => null], []);
  assert.match(salida, /<table>/);
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `node --test frontend/src/services/tablasHtmlInforme.test.js`
Expected: FAIL — funciones no existen.

- [ ] **Step 3: Implementación**

Agregar en `tablasHtmlInforme.js`, junto a `localizarBloqueProsaHtml` (ya existente de la tarea anterior):

```javascript
/** Igual que `localizarHitos` de `docxRelleno.js`, pero sobre el HTML de la ruta de
 *  plantilla PDF. */
export function localizarHitosHtml(html, titulos) {
  const texto = String(html || '');
  const claves = (titulos || []).map(claveTitulo);
  const resultado = new Array(claves.length).fill(null);
  if (!claves.length) return resultado;

  RX_BLOQUE.lastIndex = 0;
  let objetivo = 0;
  let m;
  while (objetivo < claves.length && (m = RX_BLOQUE.exec(texto)) !== null) {
    const plano = textoPlanoHtml(m[2]);
    if (pareceEntradaDeToc(plano)) continue;
    const clave = claveTitulo(plano);
    if (clave.includes(claves[objetivo])) {
      resultado[objetivo] = { inicio: m.index, finPropio: m.index + m[0].length };
      objetivo += 1;
    }
  }
  return resultado;
}

/** Igual que `reemplazarPorHitos` de `docxRelleno.js`, pero devuelve el HTML nuevo en
 *  vez de operar sobre un `sustituidorDeTablas` (esta ruta no tiene ese envoltorio). */
export function reemplazarHuecosHtml(html, titulos, contenidos, avisos, nombreParaAvisos) {
  let salida = String(html || '');
  const hitos = localizarHitosHtml(salida, titulos);
  console.log('[tablasHtmlInforme] ' + (nombreParaAvisos || '') + ': hitos encontrados '
    + hitos.filter(Boolean).length + '/' + titulos.length + ' (' + titulos.join(' → ') + ')');
  for (let i = contenidos.length - 1; i >= 0; i -= 1) {
    const hitoActual = hitos[i];
    const hitoSiguiente = hitos[i + 1];
    if (!hitoActual || !hitoSiguiente) {
      const aviso = (nombreParaAvisos || '') + ': no se encontró "' + titulos[i] + '" o "' + titulos[i + 1] + '"';
      console.warn('[tablasHtmlInforme] ' + aviso);
      if (Array.isArray(avisos)) avisos.push(aviso);
      continue;
    }
    const textoHueco = textoPlanoHtml(salida.slice(hitoActual.finPropio, hitoSiguiente.inicio));
    const nuevo = contenidos[i](textoHueco);
    if (nuevo === null) {
      console.log('[tablasHtmlInforme] hueco "' + titulos[i] + '" → "' + titulos[i + 1] + '": sin tocar');
      continue;
    }
    console.log('[tablasHtmlInforme] hueco "' + titulos[i] + '" → "' + titulos[i + 1] + '": reemplazado');
    salida = salida.slice(0, hitoActual.finPropio) + nuevo + salida.slice(hitoSiguiente.inicio);
  }
  return salida;
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node --test frontend/src/services/tablasHtmlInforme.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/tablasHtmlInforme.js frontend/src/services/tablasHtmlInforme.test.js
git commit -m "feat: mismo mecanismo de cadena de encabezados para la ruta HTML/PDF"
```

---

### Task 5: `actualizarApartadosMacroHtml` y nueva `actualizarApartadoSectorialHtml` cubren todos los huecos

**Files:**
- Modify: `frontend/src/services/tablasHtmlInforme.js`
- Modify: `frontend/src/services/plantillaRenderer.js` (wiring)
- Test: `frontend/src/services/tablasHtmlInforme.test.js`

**Interfaces:**
- Consumes: `reemplazarHuecosHtml` (Task 4).
- Produces: `actualizarApartadosMacroHtml` (mismo nombre, cuerpo reescrito); nueva `actualizarApartadoSectorialHtml(html, analisisSector, estudio, year, avisos)`.

- [ ] **Step 1: Escribir la prueba que falla**

```javascript
test('actualizarApartadosMacroHtml reemplaza también los huecos intermedios entre tablas', () => {
  const html = [
    '<h2>A. Análisis del Panorama de la Economía Mundial</h2>',
    '<p>Texto de END GAME sobre el mundo, 2024.</p>',
    '<h3>Crecimiento del PIB Mundial (2024-2026)</h3>',
    '<h2>B. Análisis del panorama de la economía colombiana</h2>',
    '<p>Texto de END GAME sobre Colombia, 2024.</p>',
    '<h3>Crecimiento del PIB en Colombia (2024-2026)</h3>',
    '<h3>Inflación en Colombia (2024 vs. Meta 2025)</h3>',
    '<h4>Política Monetaria</h4>',
    '<p>La tasa de intervención descendió al 9,50 %, texto viejo de referencia.</p>',
    '<h3>Tasa de Intervención del Banco de la República (Marzo 2023 - Diciembre 2024)</h3>',
    '<h2>Análisis del Sector de la industria del software</h2>',
  ].join('');

  const datosMacro = {
    narrativa: { mundial: '<p>Narrativa real del mundo.</p>', colombia: '<p>Narrativa real de Colombia.</p>' },
  };
  const salida = actualizarApartadosMacroHtml(html, datosMacro, 2026, []);

  assert.match(salida, /Narrativa real del mundo\./);
  assert.match(salida, /Narrativa real de Colombia\./);
  assert.doesNotMatch(salida, /texto viejo de referencia/);
  assert.match(salida, /Política Monetaria/); // el encabezado intermedio sobrevive
});

test('actualizarApartadoSectorialHtml reemplaza los cuatro bloques y la tabla de datos clave', () => {
  const html = [
    '<h2>Análisis del Sector de la industria del software y de los videojuegos</h2>',
    '<h3>Comportamiento del Sector de la Industria del Software y de los Videojuegos en 2024 y Comparación con 2023</h3>',
    '<p>Texto viejo de comportamiento.</p>',
    '<h3>Datos Clave del Sector de la Industria del Software y de los Videojuegos en Colombia (2023 vs. 2024)</h3>',
    '<table><tr><td>fila vieja</td></tr></table>',
    '<h3>Importaciones y exportaciones del sector de la industria del software y de los videojuegos</h3>',
    '<p>Texto viejo de comercio.</p>',
    '<h3>¿Qué se proyecta para el sector de la industria del software y de los videojuegos en 2025?</h3>',
    '<p>Texto viejo de proyección.</p>',
    '<h3>Conclusiones y Perspectivas</h3>',
    '<p>Texto viejo de conclusiones.</p>',
    '<h2>ANÁLISIS ECONÓMICO</h2>',
  ].join('');

  const analisisSector = {
    porAnio: {
      2026: {
        tituloSector: 'Software y Videojuegos',
        narrativa: {
          comportamiento: '<p>Comportamiento real 2026.</p>',
          comercioExterior: '<p>Comercio exterior real 2026.</p>',
          proyeccion: '<p>Proyección real 2026.</p>',
          conclusiones: '<p>Conclusiones reales 2026.</p>',
        },
        datosClaveTabla: [{ indicador: 'Empleo', valorAnterior: '250.000', valorActual: '260.000' }],
      },
    },
  };

  const salida = actualizarApartadoSectorialHtml(html, analisisSector, { anio: 2026 }, 2026, []);
  assert.match(salida, /Comportamiento real 2026\./);
  assert.match(salida, /Comercio exterior real 2026\./);
  assert.match(salida, /Proyección real 2026\./);
  assert.match(salida, /Conclusiones reales 2026\./);
  assert.doesNotMatch(salida, /Texto viejo/);
  assert.match(salida, /<table>/); // la tabla vieja de datos clave, sin tocar (otro mecanismo la regenera aparte)
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `node --test frontend/src/services/tablasHtmlInforme.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementación**

Reemplazar el cuerpo de `actualizarApartadosMacroHtml` por:

```javascript
export function actualizarApartadosMacroHtml(html, datosMacro, year, avisos) {
  const tituloMundial = 'Análisis del Panorama de la Economía Mundial';
  const tituloColombia = 'Análisis del panorama de la economía colombiana';
  const narrativaMundial = datosMacro && datosMacro.narrativa && datosMacro.narrativa.mundial;
  const narrativaColombia = datosMacro && datosMacro.narrativa && datosMacro.narrativa.colombia;
  console.log('[tablasHtmlInforme] actualizarApartadosMacroHtml: año ' + year
    + ', narrativa mundial: ' + (narrativaMundial ? 'sí' : 'no (marcador)')
    + ', narrativa colombia: ' + (narrativaColombia ? 'sí' : 'no (marcador)'));

  const primerHueco = (narrativaHtml, tema) => () => (
    narrativaHtml || marcadorApartadoPendienteHtml(tema, year)
  );
  const huecoIntermedio = (textoHueco) => (
    textoHueco.trim().length >= 50 ? '<p>' + marcadorApartadoPendienteHtml('', year).replace(/^<p>|<\/p>$/g, '') + '</p>' : null
  );

  let salida = reemplazarHuecosHtml(
    html,
    [tituloMundial, 'PIB Mundial', 'Inflación Global', 'por Región/País', tituloColombia],
    [primerHueco(narrativaMundial, 'mundial'), huecoIntermedio, huecoIntermedio],
    avisos, tituloMundial
  );
  salida = reemplazarHuecosHtml(
    salida,
    [
      tituloColombia, 'PIB en Colombia', 'Inflación en Colombia', 'Intervención del Banco',
      'Tasa Representativa del Mercado', 'Desempleo en Colombia', 'Análisis del Sector',
    ],
    [primerHueco(narrativaColombia, 'colombiana'), huecoIntermedio, huecoIntermedio, huecoIntermedio, huecoIntermedio, huecoIntermedio],
    avisos, tituloColombia
  );

  if (!narrativaMundial && Array.isArray(avisos)) avisos.push('narrativa de ' + tituloMundial);
  if (!narrativaColombia && Array.isArray(avisos)) avisos.push('narrativa de ' + tituloColombia);

  return salida;
}

/** Ruta HTML/PDF de `actualizarApartadoSectorialOoxml` (docxRelleno.js). */
export function actualizarApartadoSectorialHtml(html, analisisSector, estudio, year, avisos) {
  const entrada = analisisSector && analisisSector.porAnio && analisisSector.porAnio[String(year)];
  console.log('[tablasHtmlInforme] actualizarApartadoSectorialHtml: año ' + year
    + ', corrida de sector para este año: ' + (entrada ? 'sí (' + (entrada.tituloSector || 'sin título') + ')' : 'no (marcador)'));
  const marcador = (tema) => '<p>[Actualizar con el análisis del ' + tema + ' del sector para el año gravable ' +
    year + ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]</p>';
  const bloque = (narrativaHtml, tema) => () => (narrativaHtml || marcador(tema));
  const huecoIntermedio = (textoHueco) => (textoHueco.trim().length >= 50 ? marcador('') : null);

  return reemplazarHuecosHtml(
    html,
    [
      'Análisis del Sector', 'Comportamiento del Sector', 'Datos Clave del Sector',
      'Importaciones y exportaciones del sector', '¿Qué se proyecta para el sector', 'Conclusiones y Perspectivas',
      'ANÁLISIS ECONÓMICO',
    ],
    [
      huecoIntermedio,
      bloque(entrada && entrada.narrativa.comportamiento, 'comportamiento del sector'),
      () => null, // la tabla de Datos Clave la regenera actualizarTablasMotorHtml/otro mecanismo de tabla, no esta función
      bloque(entrada && entrada.narrativa.comercioExterior, 'comercio exterior del sector'),
      bloque(entrada && entrada.narrativa.proyeccion, 'proyección del sector'),
      bloque(entrada && entrada.narrativa.conclusiones, 'conclusiones del sector'),
    ],
    avisos, 'Análisis del Sector'
  );
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node --test frontend/src/services/tablasHtmlInforme.test.js`
Expected: PASS.

- [ ] **Step 5: Wiring en `plantillaRenderer.js`**

```javascript
import {
  actualizarTablasMotorHtml, actualizarTablasMacroHtml, actualizarApartadosMacroHtml,
  actualizarApartadoSectorialHtml,
} from './tablasHtmlInforme.js';
```

Y en `renderizar`, después de `actualizarApartadosMacroHtml(...)`:

```javascript
  html = actualizarApartadosMacroHtml(
    html, opciones.datosMacro || null, Number(estudio && estudio.anio) || 2025, avisosTablas);
  html = actualizarApartadoSectorialHtml(
    html, opciones.analisisSector || null, estudio, Number(estudio && estudio.anio) || 2025, avisosTablas);
```

`renderizar` necesita recibir `analisisSector` en `opciones` — revisar su firma (`plantillaRenderer.js:44`) y el JSDoc, y actualizar el único llamador real, `ReporteGenerador.jsx` (`renderizar(htmlMarcado, study, recursos, { datosMacro: analisisMercado })`), para que también pase `analisisSector: analisisSector` (la variable de estado ya existe en ese componente — se usa para `construirDocxDelEstudio`).

- [ ] **Step 6: Ejecutar toda la suite**

Run: `node --test scripts/lib/*.test.js frontend/src/services/*.test.js frontend/src/utils/*.test.js functions/*.test.js`
Expected: 100 % verde.

- [ ] **Step 7: `npm run build` y verificación manual en el navegador**

Levantar `npm run dev --prefix frontend`, abrir el estudio de End Game con plantilla PDF marcada, y confirmar en la vista previa que III.A, III.B y III.C ya no muestran texto ni cifras de End Game en ningún bloque intermedio.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/services/tablasHtmlInforme.js frontend/src/services/plantillaRenderer.js frontend/src/components/ReporteGenerador.jsx
git commit -m "fix: los huecos intermedios de III.A/III.B y todo III.C tambien se reemplazan en la ruta HTML/PDF"
```

## Self-Review

**Cobertura:** los cinco huecos intermedios de III.B (Inflación Colombia, Política Monetaria, TRM, Mercado Laboral, Conclusiones) y los dos de III.A detectados sin prosa real quedan cubiertos por Task 2; los cuatro bloques + la tabla de III.C por Task 3; ambas rutas de generación por Tasks 4-5. El hallazgo original del usuario (todo lo posterior a "Inflación Colombia", más las dos secciones de III.C que nombró) queda explícitamente probado en las Tasks 2 y 3.

**Riesgo abierto, a verificar en la Task 2/Task 3 manual:** el umbral de 50 caracteres (`UMBRAL_HUECO_CON_PROSA`) es una heurística basada en la plantilla de End Game — si algún cliente tiene un hueco intermedio con menos de 50 caracteres de prosa real (poco probable, pero posible), no se marcaría. Si la prueba manual del Step 6 (Task 2) muestra una cifra vieja que sobrevivió, bajar el umbral antes de dar la tarea por cerrada, no ignorarlo.
