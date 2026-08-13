# Narrativa Específica por Hueco Intermedio de III.A/III.B/III.C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los 7 huecos intermedios de III.A/III.B (inflación mundial, proyección mundial,
inflación Colombia, política monetaria, tasa de cambio, mercado laboral, conclusiones) y el hueco
de entrada de III.C reciban su propio párrafo redactado por Claude con su fuente citada, en vez
del marcador genérico "este párrafo se retiró" que hoy los deja todos en blanco.

**Architecture:** Ningún mecanismo nuevo. Las 8 series macro (`SERIES_MACRO`) ya se buscan con
Gemini+grounding y ya están confiables en Firestore (`analisisMercado/actual`, verificado en vivo
el 2026-08-13). Se extiende el contrato de redacción de Claude (`construirPromptRedaccion`/
`construirPromptRedaccionSector`) para que produzca un párrafo corto por tema además de los
apartados grandes que ya redacta, y se cablea cada hueco de `docxRelleno.js`/
`tablasHtmlInforme.js` a su tema específico (mismo patrón `bloque()` que ya usa
`actualizarApartadoSectorialOoxml` para sus 4 bloques), en vez de a la función genérica que solo
sabe borrar.

**Tech Stack:** JavaScript (ESM en `frontend/src/services/`, CommonJS en `functions/`),
`node:test`/`node:assert` en `functions/`, Vitest en `frontend/`, manipulación de OOXML/HTML crudo.

**Spec:** `docs/superpowers/specs/2026-08-13-huecos-macro-narrativa-especifica-design.md`

## Global Constraints

- Código, comentarios, UI y mensajes en español.
- `npm test` debe quedar en 100 % verde tras cada tarea.
- No se toca la búsqueda de Gemini (`construirPromptBusqueda`/`construirPromptBusquedaSector`,
  `tools:[{google_search:{}}]`, el criterio de `confiable`): las 8 series ya se buscan y ya vienen
  confiables. Este plan es solo redacción (Claude) + cableado.
- `mundial`/`colombia` (macro) y `comportamiento`/`comercioExterior`/`proyeccion`/`conclusiones`
  (sector) siguen siendo los únicos campos de narrativa OBLIGATORIOS — si faltan, la corrida se
  aborta y se conserva el documento anterior, igual que hoy. Los campos nuevos de este plan son
  "mejor si están, no bloqueantes": si Claude no los trae, el documento se guarda igual sin ellos.
- Las dos rutas de generación (`.docx` vía `docxRelleno.js`, HTML/PDF vía `tablasHtmlInforme.js`)
  quedan con el mismo comportamiento — es el mismo documento en dos formatos.
- Ninguna cifra ni frase del informe de referencia puede sobrevivir sin marcador visible: si un
  tema no tiene narrativa lista, se reemplaza por un marcador de "Actualizar con..." — nunca se
  deja el genérico "este párrafo se retiró" ni el texto viejo.

---

## Grupo A — Redacción (Claude, sin tocar la búsqueda)

### Task 1: Redacción por tema en `analisisMercadoPrompts.js`

**Files:**
- Modify: `functions/analisisMercadoPrompts.js` (`construirPromptRedaccion:103-132`,
  `parsearRespuestaRedaccion:147-161`, `armarDocumentoFirestore:165-191`)
- Test: `functions/analisisMercadoPrompts.test.js`

**Interfaces:**
- Consumes: nada nuevo — mismos `series`/`anioActual` que ya recibe `construirPromptRedaccion`.
- Produces: `parsearRespuestaRedaccion(texto)` devuelve `{ mundial, colombia, fuentesCitadas,
  inflacionMundial?, proyeccionMundial?, inflacionColombia?, politicaMonetaria?, tasaCambio?,
  mercadoLaboral?, conclusiones? }` — los 7 campos con `?` están AUSENTES del objeto (no
  `undefined` explícito, no incluidos) si Claude no los trajo o vinieron demasiado cortos.
  `armarDocumentoFirestore` copia solo los campos de tema que sí vinieron dentro de
  `documento.narrativa`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Añadir al final de `functions/analisisMercadoPrompts.test.js` (antes de la última línea si el
archivo termina en algo distinto, si no, al final):

```javascript
const TEMA_OK = '<p>La inflación mundial se moderó al 4,1 % en el período, según el FMI.</p>';

test('construirPromptRedaccion pide los 7 apartados por tema, no solo mundial/colombia', () => {
  const prompt = construirPromptRedaccion({}, 2026);
  ['inflacionMundial', 'proyeccionMundial', 'inflacionColombia', 'politicaMonetaria',
    'tasaCambio', 'mercadoLaboral', 'conclusiones'].forEach((campo) => {
    assert.ok(prompt.includes(campo), 'el prompt no pide el campo ' + campo);
  });
});

test('parsearRespuestaRedaccion incluye un tema cuando Claude lo trae con contenido suficiente', () => {
  const texto = JSON.stringify({
    mundial: MUNDIAL_OK, colombia: COLOMBIA_OK, inflacionMundial: TEMA_OK,
  });
  const r = parsearRespuestaRedaccion(texto);
  assert.strictEqual(r.inflacionMundial, TEMA_OK);
});

test('parsearRespuestaRedaccion omite un tema ausente sin lanzar ni afectar mundial/colombia', () => {
  const texto = JSON.stringify({ mundial: MUNDIAL_OK, colombia: COLOMBIA_OK });
  const r = parsearRespuestaRedaccion(texto);
  assert.strictEqual(r.mundial, MUNDIAL_OK);
  assert.strictEqual('inflacionMundial' in r, false);
});

test('parsearRespuestaRedaccion omite un tema demasiado corto para ser un párrafo real', () => {
  const texto = JSON.stringify({
    mundial: MUNDIAL_OK, colombia: COLOMBIA_OK, politicaMonetaria: '<p>Sí.</p>',
  });
  const r = parsearRespuestaRedaccion(texto);
  assert.strictEqual('politicaMonetaria' in r, false);
});

test('armarDocumentoFirestore guarda solo los temas que sí vinieron, sin claves undefined', () => {
  const doc = armarDocumentoFirestore({
    series: { pib_mundial: { valores: { 2026: '3' }, fuente: 'FMI', fuenteUrl: 'https://fmi.org', confiable: true } },
    narrativa: { mundial: MUNDIAL_OK, colombia: COLOMBIA_OK, fuentesCitadas: [], tasaCambio: TEMA_OK },
    ahora: new Date('2026-08-13T00:00:00Z'),
  });
  assert.strictEqual(doc.narrativa.tasaCambio, TEMA_OK);
  assert.strictEqual('inflacionMundial' in doc.narrativa, false);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npm test --prefix functions -- --test-name-pattern="tema|apartados por tema"` (o
`node --test functions/analisisMercadoPrompts.test.js` si el proyecto no expone ese filtro —
verificar con `cat functions/package.json` cuál es el script real antes de correrlo).
Expected: FAIL — los campos nuevos no existen todavía en `construirPromptRedaccion` ni en
`parsearRespuestaRedaccion`.

- [ ] **Step 3: Implementar `construirPromptRedaccion` con los 7 apartados por tema**

Reemplazar la función completa en `functions/analisisMercadoPrompts.js:103-132`:

```javascript
function construirPromptRedaccion(series, anioActual) {
  const resumen = Object.keys(series).map((clave) => {
    const s = series[clave];
    return '- ' + clave + ': ' + JSON.stringify(s.valores) + ' (fuente: ' + s.fuente + (s.fuenteUrl ? ', ' + s.fuenteUrl : '') + ')';
  }).join('\n');

  return (
    'Eres economista y redactas la Sección III ("TENDENCIAS DE LA ECONOMÍA") de un informe local de ' +
    'precios de transferencia para Colombia, año gravable ' + anioActual + '. Tienes ÚNICAMENTE estos ' +
    'datos ya verificados, con su fuente:\n\n' + resumen + '\n\n' +
    'Redacta lo siguiente, en español, tono técnico-formal. Los apartados 1 y 2 son extensos (mínimo ' +
    '3 párrafos); los apartados 3 a 9 son un solo párrafo corto y específico cada uno — no repitas en ' +
    'ellos lo que ya dijiste en 1 o 2, cada uno cubre SOLO su propio tema:\n' +
    '1. "mundial": Análisis del Panorama de la Economía Mundial — crecimiento del PIB mundial y su ' +
    'tendencia general (sin entrar en inflación ni proyecciones por región, eso va en 3 y 4).\n' +
    '2. "colombia": Análisis del panorama de la economía colombiana — PIB de Colombia y su efecto ' +
    'general sobre empresas que operan en el país (sin entrar en inflación, política monetaria, TRM, ' +
    'desempleo ni conclusiones, eso va en 5 a 9).\n' +
    '3. "inflacionMundial": un párrafo sobre la inflación global y su tendencia.\n' +
    '4. "proyeccionMundial": un párrafo sobre las proyecciones de crecimiento del PIB por región/país.\n' +
    '5. "inflacionColombia": un párrafo sobre la inflación de Colombia (IPC/DANE).\n' +
    '6. "politicaMonetaria": un párrafo sobre la tasa de intervención del Banco de la República y su ' +
    'evolución reciente.\n' +
    '7. "tasaCambio": un párrafo sobre la TRM promedio y su evolución.\n' +
    '8. "mercadoLaboral": un párrafo sobre la tasa de desempleo de Colombia.\n' +
    '9. "conclusiones": un párrafo que cierre el panorama económico de III.A/III.B, sintetizando el ' +
    'efecto conjunto de estas variables sobre empresas que operan en Colombia — no repitas cifras, ' +
    'esto es síntesis, no una fuente nueva.\n' +
    '10. "fuentesCitadas": la lista de las fuentes que efectivamente usaste para redactar cualquiera de ' +
    'los apartados de arriba, cada una con su título y su URL.\n\n' +
    'Reglas estrictas:\n' +
    '- NO menciones ninguna cifra que no esté en los datos de arriba. Si te falta un dato para algo que ' +
    'quieras afirmar, no lo afirmes.\n' +
    '- Si no tienes datos verificados para alguno de los apartados 3 a 8, omite esa clave del JSON por ' +
    'completo — no inventes el párrafo ni lo dejes vacío.\n' +
    '- Cada apartado en HTML, como uno o más párrafos <p>...</p>, sin encabezados ni tablas.\n' +
    '- En "fuentesCitadas" no inventes ninguna fuente ni ninguna URL: usa únicamente las que aparecen ' +
    'en los datos de arriba. Si una serie no trae URL, omítela de la lista.\n' +
    '- Responde ÚNICAMENTE con un objeto JSON (sin marcas markdown) con esta forma exacta:\n' +
    '{ "mundial": "<p>...</p><p>...</p>", "colombia": "<p>...</p><p>...</p>", ' +
    '"inflacionMundial": "<p>...</p>", "proyeccionMundial": "<p>...</p>", ' +
    '"inflacionColombia": "<p>...</p>", "politicaMonetaria": "<p>...</p>", ' +
    '"tasaCambio": "<p>...</p>", "mercadoLaboral": "<p>...</p>", "conclusiones": "<p>...</p>", ' +
    '"fuentesCitadas": [{"titulo":"...","url":"..."}] }'
  );
}
```

- [ ] **Step 4: Implementar los campos opcionales en `parsearRespuestaRedaccion`**

Reemplazar `functions/analisisMercadoPrompts.js:147-161`:

```javascript
/** Campos de tema que son "mejor si están, no bloqueantes" — a diferencia de
 *  "mundial"/"colombia", que siguen siendo obligatorios. Cada uno alimenta un hueco
 *  intermedio específico de III.A/III.B en docxRelleno.js/tablasHtmlInforme.js. */
const CAMPOS_TEMA_OPCIONALES = [
  'inflacionMundial', 'proyeccionMundial', 'inflacionColombia', 'politicaMonetaria',
  'tasaCambio', 'mercadoLaboral', 'conclusiones',
];

function parsearRespuestaRedaccion(texto) {
  const bruto = extraerJSON(texto);
  if (typeof bruto.mundial !== 'string' || typeof bruto.colombia !== 'string') {
    throw new Error('La redacción no trajo "mundial" y "colombia" como texto.');
  }
  if (bruto.mundial.trim().length < MIN_LARGO_APARTADO || bruto.colombia.trim().length < MIN_LARGO_APARTADO) {
    throw new Error('La redacción trajo "mundial" o "colombia" vacío o demasiado corto para ser un apartado.');
  }
  const fuentesCitadas = Array.isArray(bruto.fuentesCitadas)
    ? bruto.fuentesCitadas.filter(
        (f) => f && typeof f.titulo === 'string' && typeof f.url === 'string' && f.titulo && f.url
      ).map((f) => ({ titulo: f.titulo, url: f.url }))
    : [];

  const resultado = { mundial: bruto.mundial, colombia: bruto.colombia, fuentesCitadas };
  CAMPOS_TEMA_OPCIONALES.forEach((campo) => {
    if (typeof bruto[campo] === 'string' && bruto[campo].trim().length >= MIN_LARGO_APARTADO) {
      resultado[campo] = bruto[campo];
    }
  });
  return resultado;
}
```

- [ ] **Step 5: Implementar el paso de campos opcionales en `armarDocumentoFirestore`**

Reemplazar `functions/analisisMercadoPrompts.js:165-191`:

```javascript
function armarDocumentoFirestore({ series, narrativa, ahora }) {
  if (!series || !Object.keys(series).length) {
    throw new Error('No hay ninguna serie verificada: no se arma el documento.');
  }
  if (!narrativa || typeof narrativa.mundial !== 'string' || typeof narrativa.colombia !== 'string') {
    throw new Error('Falta la narrativa redactada: no se arma el documento.');
  }

  const seriesConFecha = {};
  Object.keys(series).forEach((clave) => {
    seriesConFecha[clave] = { ...series[clave], fechaConsulta: ahora };
  });

  const narrativaDoc = {
    mundial: narrativa.mundial,
    colombia: narrativa.colombia,
    fuentesCitadas: narrativa.fuentesCitadas || [],
  };
  CAMPOS_TEMA_OPCIONALES.forEach((campo) => {
    if (typeof narrativa[campo] === 'string') narrativaDoc[campo] = narrativa[campo];
  });

  return {
    actualizadoEn: ahora,
    series: seriesConFecha,
    narrativa: narrativaDoc,
  };
}
```

- [ ] **Step 6: Exportar `CAMPOS_TEMA_OPCIONALES`**

En `functions/analisisMercadoPrompts.js`, agregar `CAMPOS_TEMA_OPCIONALES` al `module.exports` al
final del archivo (junto a `SERIES_MACRO` y las demás).

- [ ] **Step 7: Correr las pruebas y verificar que pasan**

Run: `node --test functions/analisisMercadoPrompts.test.js`
Expected: PASS, todas las pruebas del archivo (viejas y nuevas).

- [ ] **Step 8: Commit**

```bash
git add functions/analisisMercadoPrompts.js functions/analisisMercadoPrompts.test.js
git commit -m "feat: Claude redacta un parrafo por tema para los huecos intermedios de III.A/III.B"
```

---

### Task 2: Campo `introduccion` en `analisisSectorPrompts.js`

**Files:**
- Modify: `functions/analisisSectorPrompts.js` (`construirPromptRedaccionSector:196-238`,
  `parsearRespuestaRedaccionSector:242-263`, `armarEntradaAnio:268-284`)
- Test: `functions/analisisSectorPrompts.test.js`

**Interfaces:**
- Produces: `parsearRespuestaRedaccionSector(texto)` devuelve el mismo objeto de hoy más
  `introduccion?` (ausente si Claude no la trae o viene demasiado corta — mismo criterio que
  Task 1). `armarEntradaAnio` copia `introduccion` a `narrativa.introduccion` solo si vino.

- [ ] **Step 1: Escribir las pruebas que fallan**

Añadir a `functions/analisisSectorPrompts.test.js`:

```javascript
test('construirPromptRedaccionSector pide el apartado "introduccion"', () => {
  const prompt = construirPromptRedaccionSector({
    datosClaveTabla: [], datosComportamiento: [], datosComercioExterior: [], datosProyeccion: [],
  }, 'desarrollo de videojuegos', 2025);
  assert.ok(prompt.includes('introduccion'), 'el prompt no pide "introduccion"');
});

test('parsearRespuestaRedaccionSector incluye "introduccion" cuando viene con contenido', () => {
  const texto = JSON.stringify({
    tituloSector: 'de los videojuegos',
    introduccion: '<p>El sector de videojuegos en Colombia mostró dinamismo en 2025.</p>',
    comportamiento: '<p>Creció un 11 % frente a 2024, según 6Wresearch.</p>',
    comercioExterior: '<p>Las exportaciones subieron 419 % en 2024, según ProColombia.</p>',
    proyeccion: '<p>Se proyecta un CAGR del 11 % para 2026.</p>',
    conclusiones: '<p>El segmento móvil concentra el mayor dinamismo del sector.</p>',
  });
  const r = parsearRespuestaRedaccionSector(texto);
  assert.ok(r.introduccion.includes('dinamismo'));
});

test('parsearRespuestaRedaccionSector no exige "introduccion" para aceptar la redacción', () => {
  const texto = JSON.stringify({
    tituloSector: 'de los videojuegos',
    comportamiento: '<p>Creció un 11 % frente a 2024, según 6Wresearch.</p>',
    comercioExterior: '<p>Las exportaciones subieron 419 % en 2024, según ProColombia.</p>',
    proyeccion: '<p>Se proyecta un CAGR del 11 % para 2026.</p>',
    conclusiones: '<p>El segmento móvil concentra el mayor dinamismo del sector.</p>',
  });
  const r = parsearRespuestaRedaccionSector(texto);
  assert.strictEqual('introduccion' in r, false);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `node --test functions/analisisSectorPrompts.test.js`
Expected: FAIL — `construirPromptRedaccionSector` no menciona "introduccion" todavía.

- [ ] **Step 3: Agregar el apartado al prompt de redacción**

En `functions/analisisSectorPrompts.js:196-238`, dentro de la lista numerada de
`construirPromptRedaccionSector` (justo antes del punto 2, "comportamiento"), insertar:

```javascript
    '2. "introduccion": 1-2 frases de contexto general que sitúen el sector antes de entrar en el ' +
    'detalle de comportamiento, comercio exterior y proyección — puede ser cualitativo, sin cifra ' +
    'nueva si los datos de arriba no traen una que sirva para esto.\n' +
```

Y renumerar los puntos siguientes (el "comportamiento" actual pasa a ser el 3, etc.) y actualizar
la forma exacta del JSON al final de la función para incluir `"introduccion": "<p>...</p>",` justo
después de `"tituloSector"`.

- [ ] **Step 4: Aceptar el campo opcional en `parsearRespuestaRedaccionSector`**

Reemplazar `functions/analisisSectorPrompts.js:242-263`:

```javascript
function parsearRespuestaRedaccionSector(texto) {
  const bruto = extraerJSON(texto);
  if (typeof bruto.tituloSector !== 'string' || !bruto.tituloSector.trim()) {
    throw new Error('La redacción del sector no trajo "tituloSector".');
  }
  for (const campo of ['comportamiento', 'comercioExterior', 'proyeccion', 'conclusiones']) {
    if (typeof bruto[campo] !== 'string' || bruto[campo].replace(/<[^>]*>/g, '').trim().length < MIN_LARGO_APARTADO) {
      throw new Error('La redacción del sector no trajo "' + campo + '" con contenido suficiente.');
    }
  }
  const fuentesCitadas = (Array.isArray(bruto.fuentesCitadas) ? bruto.fuentesCitadas : [])
    .filter((f) => f && typeof f.titulo === 'string' && f.titulo.trim() && typeof f.url === 'string' && f.url.trim());

  const resultado = {
    tituloSector: bruto.tituloSector.trim(),
    comportamiento: bruto.comportamiento,
    comercioExterior: bruto.comercioExterior,
    proyeccion: bruto.proyeccion,
    conclusiones: bruto.conclusiones,
    fuentesCitadas,
  };
  if (typeof bruto.introduccion === 'string'
    && bruto.introduccion.replace(/<[^>]*>/g, '').trim().length >= MIN_LARGO_APARTADO) {
    resultado.introduccion = bruto.introduccion;
  }
  return resultado;
}
```

- [ ] **Step 5: Pasar `introduccion` a la entrada del año**

Reemplazar `functions/analisisSectorPrompts.js:268-284`:

```javascript
function armarEntradaAnio({ datosVerificados, narrativa, ahora }) {
  if (!narrativa) {
    throw new Error('Falta la narrativa redactada: no se arma la entrada del año.');
  }
  const narrativaEntrada = {
    comportamiento: narrativa.comportamiento,
    comercioExterior: narrativa.comercioExterior,
    proyeccion: narrativa.proyeccion,
    conclusiones: narrativa.conclusiones,
    fuentesCitadas: narrativa.fuentesCitadas,
  };
  if (typeof narrativa.introduccion === 'string') narrativaEntrada.introduccion = narrativa.introduccion;

  return {
    actualizadoEn: ahora,
    tituloSector: narrativa.tituloSector,
    datosClaveTabla: datosVerificados.datosClaveTabla,
    narrativa: narrativaEntrada,
  };
}
```

- [ ] **Step 6: Correr las pruebas y verificar que pasan**

Run: `node --test functions/analisisSectorPrompts.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/analisisSectorPrompts.js functions/analisisSectorPrompts.test.js
git commit -m "feat: analisis de sector redacta una introduccion para el hueco de entrada de III.C"
```

---

## Grupo B — Cableado (docxRelleno.js / tablasHtmlInforme.js)

### Task 3: Ruta `.docx` — conectar los 8 huecos a su tema en `docxRelleno.js`

**Files:**
- Modify: `frontend/src/services/docxRelleno.js`
  (`actualizarApartadosMacroOoxml:219-270`, `actualizarApartadoSectorialOoxml:303-356`)
- Test: `frontend/src/services/docxRelleno.test.js`

**Interfaces:**
- Consumes: `narrativa.{inflacionMundial,proyeccionMundial,inflacionColombia,politicaMonetaria,
  tasaCambio,mercadoLaboral,conclusiones}` y `narrativa.introduccion` (de Task 1/2, vía
  `datosMacro`/`analisisSector`), `datosMacro.series.{inflacion_global,crecimiento_por_region,
  inflacion_colombia,tasa_intervencion,trm_promedio,desempleo_colombia}.{fuente,fuenteUrl}`.
- Produces: `parrafoFuenteOoxml(fuente, fuenteUrl)`, `marcadorTemaMacroPendiente(tema, year)` —
  nuevas funciones internas del módulo, no exportadas (mismo patrón que
  `marcadorApartadoPendiente`).

- [ ] **Step 1: Escribir las pruebas que fallan**

Añadir a `frontend/src/services/docxRelleno.test.js`, junto a las pruebas existentes de
`actualizarApartadosMacroOoxml`/`actualizarApartadoSectorialOoxml`:

```javascript
test('actualizarApartadosMacroOoxml reemplaza el hueco de política monetaria con su propio párrafo y fuente', () => {
  const xml = [
    parrafoXml('B. Análisis del panorama de la economía colombiana'),
    parrafoXml('Texto real de Colombia.'),
    parrafoXml('Crecimiento del PIB en Colombia (2024-2026)'),
    parrafoXml('Texto de END GAME sobre inflación en Colombia, 2024.'),
    parrafoXml('Inflación en Colombia (2025 vs. Meta 2026)'),
    parrafoXml('Texto de END GAME sobre política monetaria, 2024.'),
    parrafoXml('Tasa de Intervención del Banco de la República'),
    parrafoXml('Texto de END GAME sobre TRM, 2024.'),
    parrafoXml('Tasa Representativa del Mercado (TRM) Promedio'),
    parrafoXml('Texto de END GAME sobre desempleo, 2024.'),
    parrafoXml('Tasa de Desempleo en Colombia'),
    parrafoXml('Texto de END GAME sobre conclusiones, 2024.'),
    parrafoXml('Análisis del Sector'),
  ].join('');

  const datosMacro = {
    narrativa: {
      mundial: '<p>Mundial.</p>', colombia: '<p>Colombia.</p>',
      politicaMonetaria: '<p>La tasa de intervención cerró en 12,00 % en julio de 2026.</p>',
    },
    series: {
      tasa_intervencion: { fuente: 'Banco de la República', fuenteUrl: 'https://banrep.gov.co/tasa' },
    },
  };
  const avisos = [];
  const salida = actualizarApartadosMacroOoxml(xml, datosMacro, 2026, avisos);

  assert.match(salida, /tasa de intervención cerró en 12,00/);
  assert.match(salida, /FUENTE: Banco de la República, https:\/\/banrep\.gov\.co\/tasa/);
  assert.doesNotMatch(salida, /Texto de END GAME sobre política monetaria/);
});

test('actualizarApartadosMacroOoxml deja el marcador especifico de tema (no el generico) cuando falta narrativa', () => {
  const xml = [
    parrafoXml('B. Análisis del panorama de la economía colombiana'),
    parrafoXml('Texto real de Colombia.'),
    parrafoXml('Crecimiento del PIB en Colombia (2024-2026)'),
    parrafoXml('Texto de END GAME sobre inflación en Colombia, 2024, con contenido suficientemente largo.'),
    parrafoXml('Inflación en Colombia (2025 vs. Meta 2026)'),
    parrafoXml('Análisis del Sector'),
  ].join('');

  const datosMacro = { narrativa: { mundial: '<p>Mundial.</p>', colombia: '<p>Colombia.</p>' } };
  const salida = actualizarApartadosMacroOoxml(xml, datosMacro, 2026, []);

  assert.match(salida, /Actualizar con datos verificados sobre la inflación en Colombia/);
  assert.doesNotMatch(salida, /este párrafo del informe de referencia se retiró/i);
});

test('actualizarApartadoSectorialOoxml reemplaza el hueco de entrada con la introduccion y sin fuente', () => {
  const xml = [
    parrafoXml('Análisis del Sector de la industria del software y los videojuegos'),
    parrafoXml('Texto de END GAME de introducción al sector, con contenido suficientemente largo para no ser un hueco vacío.'),
    parrafoXml('Comportamiento del Sector'),
    parrafoXml('Texto real de comportamiento.'),
    parrafoXml('Datos Clave del Sector'),
  ].join('');

  const analisisSector = {
    porAnio: { '2025': { narrativa: {
      introduccion: '<p>El sector de videojuegos mostró dinamismo en 2025.</p>',
      comportamiento: '<p>Texto real de comportamiento.</p>',
    } } },
  };
  const salida = actualizarApartadoSectorialOoxml(xml, analisisSector, { anio: 2025 }, 2025, []);

  assert.match(salida, /mostró dinamismo en 2025/);
  assert.doesNotMatch(salida, /Texto de END GAME de introducción/);
});
```

Si `parrafoXml` no existe ya como helper en el archivo de pruebas, revisar cómo se construyen los
`xml` de las pruebas existentes de `actualizarApartadosMacroOoxml` (buscar `parrafoXml(` en el
archivo) y reusar exactamente esa función — no crear una nueva.

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npm test --prefix frontend -- docxRelleno`
Expected: FAIL — los tres casos nuevos, porque el cableado todavía usa
`contenidoHuecoIntermedio` para estos huecos.

- [ ] **Step 3: Agregar `parrafoFuenteOoxml` y `marcadorTemaMacroPendiente`**

En `frontend/src/services/docxRelleno.js`, cerca de `marcadorApartadoPendiente` (línea ~171),
agregar:

```javascript
/** Línea "FUENTE: <fuente>, <url>" para un párrafo de narrativa con tema propio —
 *  misma convención que ya usa el resumen que se le pasa a Claude en
 *  `construirPromptRedaccion` (`functions/analisisMercadoPrompts.js`). Vacío si no hay
 *  URL: no se cita una fuente que no vino de una búsqueda real (`conclusiones`, que es
 *  síntesis y no cita una serie nueva, no lleva esta línea). */
function parrafoFuenteOoxml(fuente, fuenteUrl) {
  if (!fuenteUrl) return '';
  const texto = 'FUENTE: ' + (fuente ? fuente + ', ' : '') + fuenteUrl;
  return `<w:p><w:pPr><w:pStyle w:val="Normal"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:b/></w:rPr><w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r></w:p>`;
}

/** Marcador para un hueco intermedio de III.A/III.B con tema propio (inflación
 *  mundial, política monetaria, TRM, etc.) sin narrativa lista para ESE tema —
 *  distinto de `marcadorApartadoPendiente`, que es solo para los dos apartados
 *  líderes ("mundial"/"colombiana") y usa otra redacción legal ya fijada. */
function marcadorTemaMacroPendiente(tema, year) {
  return '[Actualizar con datos verificados sobre ' + tema + ' para el año gravable ' + year +
    ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]';
}
```

- [ ] **Step 4: Reescribir `actualizarApartadosMacroOoxml`**

Reemplazar la función completa, `frontend/src/services/docxRelleno.js:219-270`:

```javascript
export function actualizarApartadosMacroOoxml(xml, datosMacro, year, avisos) {
  const doc = sustituidorDeTablas(xml, null);

  const tituloMundial = 'Análisis del Panorama de la Economía Mundial';
  const tituloColombia = 'Análisis del panorama de la economía colombiana';
  const narrativa = (datosMacro && datosMacro.narrativa) || {};
  const series = (datosMacro && datosMacro.series) || {};
  console.log('[docxRelleno] actualizarApartadosMacroOoxml: año ' + year
    + ', narrativa mundial: ' + (narrativa.mundial ? 'sí' : 'no (marcador)')
    + ', narrativa colombia: ' + (narrativa.colombia ? 'sí' : 'no (marcador)'));

  const primerHueco = (narrativaHtml, tema) => () => (
    narrativaHtml
      ? parrafosOoxmlDesdeHtml(narrativaHtml)
      : `<w:p><w:r><w:t xml:space="preserve">${escaparXml(marcadorApartadoPendiente(tema, year))}</w:t></w:r></w:p>`
  );

  /** Hueco intermedio con tema propio: párrafo + FUENTE si hay narrativa para ese
   *  tema; marcador específico (no el genérico) si no. `serieClave` es la clave en
   *  `datosMacro.series` cuya `fuente`/`fuenteUrl` acompaña al párrafo — `null` para
   *  "conclusiones", que sintetiza y no cita una serie nueva. */
  const temaHueco = (narrativaHtml, tema, serieClave) => () => {
    if (narrativaHtml) {
      const serie = serieClave ? series[serieClave] : null;
      const fuente = serie ? parrafoFuenteOoxml(serie.fuente, serie.fuenteUrl) : '';
      return parrafosOoxmlDesdeHtml(narrativaHtml) + fuente;
    }
    return `<w:p><w:r><w:t xml:space="preserve">${escaparXml(marcadorTemaMacroPendiente(tema, year))}</w:t></w:r></w:p>`;
  };

  reemplazarPorHitos(
    doc,
    [tituloMundial, 'PIB Mundial', 'Inflación Global', 'por Región/País', tituloColombia],
    [
      primerHueco(narrativa.mundial, 'mundial'),
      temaHueco(narrativa.inflacionMundial, 'la inflación mundial', 'inflacion_global'),
      temaHueco(narrativa.proyeccionMundial, 'la proyección de crecimiento mundial', 'crecimiento_por_region'),
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
      primerHueco(narrativa.colombia, 'colombiana'),
      temaHueco(narrativa.inflacionColombia, 'la inflación en Colombia', 'inflacion_colombia'),
      temaHueco(narrativa.politicaMonetaria, 'la política monetaria', 'tasa_intervencion'),
      temaHueco(narrativa.tasaCambio, 'la tasa de cambio (TRM)', 'trm_promedio'),
      temaHueco(narrativa.mercadoLaboral, 'el mercado laboral en Colombia', 'desempleo_colombia'),
      temaHueco(narrativa.conclusiones, 'las conclusiones del panorama económico', null),
    ],
    avisos,
    tituloColombia
  );

  if (!narrativa.mundial && Array.isArray(avisos)) avisos.push('narrativa de ' + tituloMundial);
  if (!narrativa.colombia && Array.isArray(avisos)) avisos.push('narrativa de ' + tituloColombia);

  return doc.xml;
}
```

- [ ] **Step 5: Conectar el hueco de entrada de III.C a `introduccion`**

En `actualizarApartadoSectorialOoxml` (`frontend/src/services/docxRelleno.js:303-356`), dentro del
arreglo de `contenidos` que se pasa a `reemplazarPorHitos` (línea ~328), cambiar la primera entrada:

```javascript
  reemplazarPorHitos(
    doc,
    titulos,
    [
      bloque(entrada && entrada.narrativa.introduccion, 'contexto introductorio'),
      bloque(entrada && entrada.narrativa.comportamiento, 'comportamiento del sector'),
      () => null,
      bloque(entrada && entrada.narrativa.comercioExterior, 'comercio exterior del sector'),
      bloque(entrada && entrada.narrativa.proyeccion, 'proyección del sector'),
      bloque(entrada && entrada.narrativa.conclusiones, 'conclusiones del sector'),
    ],
    avisos,
    'Análisis del Sector'
  );
```

(La única línea que cambia es la primera: de `contenidoHuecoIntermedio` a
`bloque(entrada && entrada.narrativa.introduccion, 'contexto introductorio')` — `bloque` ya existe
en esa misma función, dos líneas arriba.)

- [ ] **Step 6: Correr las pruebas y verificar que pasan**

Run: `npm test --prefix frontend -- docxRelleno`
Expected: PASS, todas (viejas y las tres nuevas de Step 1).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/services/docxRelleno.js frontend/src/services/docxRelleno.test.js
git commit -m "feat: cablear los 8 huecos intermedios a su narrativa por tema en la ruta .docx"
```

---

### Task 4: Ruta HTML/PDF — mismo cableado en `tablasHtmlInforme.js`

**Files:**
- Modify: `frontend/src/services/tablasHtmlInforme.js`
  (`actualizarApartadosMacroHtml:657-692`, `actualizarApartadoSectorialHtml:698-729`)
- Test: `frontend/src/services/tablasHtmlInforme.test.js`

**Interfaces:**
- Mismo contrato que Task 3, versión HTML: `parrafoFuenteHtml(fuente, fuenteUrl)`,
  `marcadorTemaMacroPendienteHtml(tema, year)` — usando `escaparHtml` (ya existe en este archivo,
  línea 54) en vez de `escaparXml`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Añadir a `frontend/src/services/tablasHtmlInforme.test.js`, junto a las pruebas existentes de
`actualizarApartadosMacroHtml`/`actualizarApartadoSectorialHtml` (mismo estilo de fixture: arreglo
de strings HTML con `.join('')`, visto en las pruebas de las líneas 518-636):

```javascript
test('actualizarApartadosMacroHtml reemplaza el hueco de política monetaria con su propio párrafo y fuente', () => {
  const html = [
    '<h2>B. Análisis del panorama de la economía colombiana</h2>',
    '<p>Texto real de Colombia.</p>',
    '<h3>Crecimiento del PIB en Colombia (2024-2026)</h3>',
    '<p>Texto de END GAME sobre inflación en Colombia, 2024, con contenido suficientemente largo.</p>',
    '<h3>Inflación en Colombia (2025 vs. Meta 2026)</h3>',
    '<p>Texto de END GAME sobre política monetaria, 2024, con contenido suficientemente largo.</p>',
    '<h3>Tasa de Intervención del Banco de la República</h3>',
    '<p>Texto de END GAME sobre TRM, 2024, con contenido suficientemente largo para el umbral.</p>',
    '<h3>Tasa Representativa del Mercado (TRM) Promedio</h3>',
    '<p>Texto de END GAME sobre desempleo, 2024, con contenido suficientemente largo para el umbral.</p>',
    '<h3>Tasa de Desempleo en Colombia</h3>',
    '<p>Texto de END GAME sobre conclusiones, 2024, con contenido suficientemente largo.</p>',
    '<h2>Análisis del Sector</h2>',
  ].join('');

  const datosMacro = {
    narrativa: {
      mundial: '<p>Mundial.</p>', colombia: '<p>Colombia.</p>',
      politicaMonetaria: '<p>La tasa de intervención cerró en 12,00 % en julio de 2026.</p>',
    },
    series: {
      tasa_intervencion: { fuente: 'Banco de la República', fuenteUrl: 'https://banrep.gov.co/tasa' },
    },
  };
  const salida = actualizarApartadosMacroHtml(html, datosMacro, 2026, []);

  assert.match(salida, /tasa de intervención cerró en 12,00/);
  assert.match(salida, /FUENTE: Banco de la República, https:\/\/banrep\.gov\.co\/tasa/);
  assert.doesNotMatch(salida, /Texto de END GAME sobre política monetaria/);
});

test('actualizarApartadosMacroHtml deja el marcador especifico de tema (no el generico) cuando falta narrativa', () => {
  const html = [
    '<h2>B. Análisis del panorama de la economía colombiana</h2>',
    '<p>Texto real de Colombia.</p>',
    '<h3>Crecimiento del PIB en Colombia (2024-2026)</h3>',
    '<p>Texto de END GAME sobre inflación en Colombia, 2024, con contenido suficientemente largo.</p>',
    '<h3>Inflación en Colombia (2025 vs. Meta 2026)</h3>',
    '<h2>Análisis del Sector</h2>',
  ].join('');

  const datosMacro = { narrativa: { mundial: '<p>Mundial.</p>', colombia: '<p>Colombia.</p>' } };
  const salida = actualizarApartadosMacroHtml(html, datosMacro, 2026, []);

  assert.match(salida, /Actualizar con datos verificados sobre la inflación en Colombia/);
  assert.doesNotMatch(salida, /este párrafo del informe de referencia se retiró/i);
});

test('actualizarApartadoSectorialHtml reemplaza el hueco de entrada con la introduccion, sin fuente', () => {
  const html = [
    '<h2>Análisis del Sector de la industria del software y los videojuegos</h2>',
    '<p>Texto de END GAME de introducción al sector, con contenido suficientemente largo para no ser un hueco vacío.</p>',
    '<h3>Comportamiento del Sector</h3>',
    '<p>Texto real de comportamiento.</p>',
    '<h3>Datos Clave del Sector</h3>',
  ].join('');

  const analisisSector = {
    porAnio: { 2025: { narrativa: {
      introduccion: '<p>El sector de videojuegos mostró dinamismo en 2025.</p>',
      comportamiento: '<p>Texto real de comportamiento.</p>',
    } } },
  };
  const salida = actualizarApartadoSectorialHtml(html, analisisSector, { anio: 2025 }, 2025, []);

  assert.match(salida, /mostró dinamismo en 2025/);
  assert.doesNotMatch(salida, /Texto de END GAME de introducción/);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npm test --prefix frontend -- tablasHtmlInforme`
Expected: FAIL.

- [ ] **Step 3: Agregar `parrafoFuenteHtml` y `marcadorTemaMacroPendienteHtml`**

En `frontend/src/services/tablasHtmlInforme.js`, cerca de `marcadorApartadoPendienteHtml`
(usada en `actualizarApartadosMacroHtml`, buscar su definición en el archivo):

```javascript
/** Equivalente HTML de `parrafoFuenteOoxml` (docxRelleno.js): misma convención
 *  "FUENTE: <fuente>, <url>", vacío si no hay URL. */
function parrafoFuenteHtml(fuente, fuenteUrl) {
  if (!fuenteUrl) return '';
  const texto = 'FUENTE: ' + (fuente ? fuente + ', ' : '') + fuenteUrl;
  return '<p><strong>' + escaparHtml(texto) + '</strong></p>';
}

/** Equivalente HTML de `marcadorTemaMacroPendiente` (docxRelleno.js). */
function marcadorTemaMacroPendienteHtml(tema, year) {
  return '[Actualizar con datos verificados sobre ' + tema + ' para el año gravable ' + year +
    ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo ' +
    '1.2.2.2.1.5 del Decreto 1625 de 2016.]';
}
```

- [ ] **Step 4: Reescribir `actualizarApartadosMacroHtml`**

Reemplazar la función completa, `frontend/src/services/tablasHtmlInforme.js:657-692`:

```javascript
export function actualizarApartadosMacroHtml(html, datosMacro, year, avisos) {
  const tituloMundial = 'Análisis del Panorama de la Economía Mundial';
  const tituloColombia = 'Análisis del panorama de la economía colombiana';
  const narrativa = (datosMacro && datosMacro.narrativa) || {};
  const series = (datosMacro && datosMacro.series) || {};
  console.log('[tablasHtmlInforme] actualizarApartadosMacroHtml: año ' + year
    + ', narrativa mundial: ' + (narrativa.mundial ? 'sí' : 'no (marcador)')
    + ', narrativa colombia: ' + (narrativa.colombia ? 'sí' : 'no (marcador)'));

  const primerHueco = (narrativaHtml, tema) => () => (narrativaHtml || marcadorApartadoPendienteHtml(tema, year));

  const temaHueco = (narrativaHtml, tema, serieClave) => () => {
    if (narrativaHtml) {
      const serie = serieClave ? series[serieClave] : null;
      const fuente = serie ? parrafoFuenteHtml(serie.fuente, serie.fuenteUrl) : '';
      return narrativaHtml + fuente;
    }
    return '<p>' + escaparHtml(marcadorTemaMacroPendienteHtml(tema, year)) + '</p>';
  };

  let salida = reemplazarHuecosHtml(
    html,
    [tituloMundial, 'PIB Mundial', 'Inflación Global', 'por Región/País', tituloColombia],
    [
      primerHueco(narrativa.mundial, 'mundial'),
      temaHueco(narrativa.inflacionMundial, 'la inflación mundial', 'inflacion_global'),
      temaHueco(narrativa.proyeccionMundial, 'la proyección de crecimiento mundial', 'crecimiento_por_region'),
    ],
    avisos, tituloMundial
  );
  salida = reemplazarHuecosHtml(
    salida,
    [
      tituloColombia, 'PIB en Colombia', 'Inflación en Colombia', 'Intervención del Banco',
      'Tasa Representativa del Mercado', 'Desempleo en Colombia', 'Análisis del Sector',
    ],
    [
      primerHueco(narrativa.colombia, 'colombiana'),
      temaHueco(narrativa.inflacionColombia, 'la inflación en Colombia', 'inflacion_colombia'),
      temaHueco(narrativa.politicaMonetaria, 'la política monetaria', 'tasa_intervencion'),
      temaHueco(narrativa.tasaCambio, 'la tasa de cambio (TRM)', 'trm_promedio'),
      temaHueco(narrativa.mercadoLaboral, 'el mercado laboral en Colombia', 'desempleo_colombia'),
      temaHueco(narrativa.conclusiones, 'las conclusiones del panorama económico', null),
    ],
    avisos, tituloColombia
  );

  if (!narrativa.mundial && Array.isArray(avisos)) avisos.push('narrativa de ' + tituloMundial);
  if (!narrativa.colombia && Array.isArray(avisos)) avisos.push('narrativa de ' + tituloColombia);

  return salida;
}
```

- [ ] **Step 5: Conectar el hueco de entrada de III.C a `introduccion`**

En `actualizarApartadoSectorialHtml` (`frontend/src/services/tablasHtmlInforme.js:698-729`),
cambiar la primera entrada del arreglo de contenidos (línea ~716) de
`contenidoHuecoIntermedioHtml` a `bloque(entrada && entrada.narrativa.introduccion, 'contexto
introductorio')` — mismo cambio que Task 3 Step 5, `bloque` ya existe en esta función.

- [ ] **Step 6: Correr las pruebas y verificar que pasan**

Run: `npm test --prefix frontend -- tablasHtmlInforme`
Expected: PASS.

- [ ] **Step 7: Correr toda la suite del proyecto**

Run: `npm test`
Expected: PASS, 100 % verde (los ~895 casos existentes más los nuevos de este plan).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/services/tablasHtmlInforme.js frontend/src/services/tablasHtmlInforme.test.js
git commit -m "feat: cablear los 8 huecos intermedios a su narrativa por tema en la ruta HTML/PDF"
```

---

## Grupo C — Verificación manual

### Task 5: Confirmar en Word real y decidir sobre el backfill de datos existentes

**Files:** ninguno (verificación, no código).

- [ ] **Step 1: Generar el `.docx` real**

Usar el flujo normal del Gestor de Reportes sobre `Archivos Prueba/Informe Local End Game _
2024_v2.docx` con un estudio cuyo `datosMacro`/`analisisSector` tengan los campos nuevos (si
`analisisMercado/actual` en Firestore todavía no los tiene —fue generado antes de este plan—, agregar
manualmente esos campos al documento de prueba local, o esperar la próxima corrida de
`actualizarAnalisisMercado` con el prompt nuevo, antes de dar la tarea por verificada en producción).

- [ ] **Step 2: Abrir el `.docx` en Word**

Confirmar que abre sin queja de "contenido no legible" (limitación conocida: las pruebas
unitarias con XML sintético no atrapan todo lo que Word sí, documentado en `docxRelleno.js:24-27`
y en el spec de este plan).

- [ ] **Step 3: Revisar los 8 huecos en el documento abierto**

Confirmar visualmente que cada uno de los 8 puntos listados en el spec (política monetaria, TRM,
mercado laboral, conclusiones, inflación mundial, proyección mundial, inflación Colombia, entrada
de III.C) trae su párrafo específico y su línea `FUENTE:` cuando corresponde (todos menos
"conclusiones" y "contexto introductorio"), y que ninguno quedó con el marcador genérico
"este párrafo del informe de referencia se retiró" — si `analisisMercado/actual` no tiene todavía
los campos nuevos, deben verse los marcadores específicos ("Actualizar con datos verificados
sobre..."), nunca el genérico ni el texto viejo de END GAME.

- [ ] **Step 4: Reportar al usuario**

Confirmar por escrito en el chat qué se vio (marcador específico vs. narrativa real por hueco) y
si `analisisMercado/actual` necesita una corrida nueva para poblar los 7 campos de tema —no forma
parte de este plan disparar esa corrida (no hay trigger manual hoy, ver "Fuera de alcance" del
spec), solo confirmar el estado.
