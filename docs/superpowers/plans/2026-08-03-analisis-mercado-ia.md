# Análisis de mercado con IA (III.A/III.B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redactar con IA (Gemini busca, Claude redacta) los párrafos de III.A (economía
mundial) y III.B (economía colombiana), y mantener frescas las 8 series de `DATOS_MACRO`,
refrescando ambos mensualmente en segundo plano vía una Cloud Function programada que escribe
en Firestore.

**Architecture:** Una Cloud Function nueva (`onSchedule`, mensual) hace una búsqueda con Google
Search grounding vía Gemini, redacta con Claude Sonnet a partir de esas cifras verificadas, y
guarda el resultado en una colección nueva de Firestore (`analisisMercado`). El frontend lee esa
colección una vez por sesión y la pasa a los generadores existentes de `analisisMercado.js` y
`exactTemplateMapper.js`, que caen de vuelta al `DATOS_MACRO` embebido en el código si Firestore
no responde o el cron aún no ha corrido.

**Tech Stack:** Firebase Functions v2 (`onSchedule`, `onRequest` ya existentes), Firestore
(Admin SDK en backend, SDK web en frontend), React 19 (`frontend/`), `node --test` como único
runner de pruebas del repo.

**Spec:** `docs/superpowers/specs/2026-08-03-analisis-mercado-ia-design.md`

## Global Constraints

- Todo el desarrollo nuevo va en `frontend/` y `functions/` — **no** se toca `index.html` ni
  `public/index.html` (decisión ya registrada en `CLAUDE.md`, 2026-07-31).
- El apartado sectorial III.C queda **fuera de alcance**: sigue con su reemplazo genérico actual
  (`generarApartadoSectorial`, `reemplazarApartadoSectorial`). No se toca en este plan.
- `npm test` (raíz) corre `node --test "scripts/lib/*.test.js" "frontend/src/services/*.test.js"`
  — cualquier test nuevo en `frontend/src/services/` entra automáticamente; los de `functions/`
  necesitan agregarse al patrón (Task 1).
- Reutilizar los secretos ya definidos en `functions/index.js` (`ANTHROPIC_API_KEY`,
  `GEMINI_API_KEY`) — no crear ningún secreto nuevo.
- Modelos: `gemini-3-flash-preview` para la búsqueda (ya es el `GEMINI_MODEL_DEFAULT` del
  proyecto), `claude-sonnet-5` para la redacción (ya es el modelo de "redacción pesada" según
  `CLAUDE.md`).
- Nunca inventar una cifra ni una URL de fuente: si Gemini no encuentra un dato confiable para
  una serie, esa serie se omite (no se rellena); si Claude redacta sin cifras verificadas, no se
  guarda nada (ver Task 2).
- `functions/` es CommonJS (`require`/`module.exports`, sin `"type": "module"` en su
  `package.json`) — no usar `import`/`export` ahí. `frontend/src/services/` es ESM.

---

### Task 1: Módulo puro de prompts y parseo (`functions/analisisMercadoPrompts.js`)

**Files:**
- Create: `functions/analisisMercadoPrompts.js`
- Create: `functions/analisisMercadoPrompts.test.js`
- Modify: `package.json:10` (raíz) — agregar `functions/*.test.js` al patrón de `npm test`

**Interfaces:**
- Produces: `SERIES_MACRO` (array de `{ clave, pregunta }`, 8 entradas), `extraerJSON(texto)`,
  `construirPromptBusqueda(anioActual)`, `parsearRespuestaBusqueda(texto, groundingChunks)`,
  `construirPromptRedaccion(series, anioActual)`, `parsearRespuestaRedaccion(texto)`,
  `armarDocumentoFirestore({ series, narrativa, ahora })`. Task 2 consume las seis últimas.

- [ ] **Step 1: Escribir los tests que fallan**

```js
// functions/analisisMercadoPrompts.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  SERIES_MACRO,
  extraerJSON,
  construirPromptBusqueda,
  parsearRespuestaBusqueda,
  construirPromptRedaccion,
  parsearRespuestaRedaccion,
  armarDocumentoFirestore,
} = require('./analisisMercadoPrompts');

test('extraerJSON encuentra el objeto aunque venga envuelto en prosa y marcas markdown', () => {
  const texto = 'Aquí está el resultado:\n```json\n{"a": 1, "b": {"c": "x}y"}}\n```\nListo.';
  const obj = extraerJSON(texto);
  assert.deepStrictEqual(obj, { a: 1, b: { c: 'x}y' } });
});

test('extraerJSON lanza si no hay ninguna llave de apertura', () => {
  assert.throws(() => extraerJSON('sin json aquí'), /no contiene un objeto JSON/);
});

test('construirPromptBusqueda pide las 8 series y la ventana de 4 años', () => {
  const prompt = construirPromptBusqueda(2026);
  SERIES_MACRO.forEach((s) => assert.ok(prompt.includes(s.clave), 'falta la serie ' + s.clave));
  ['2024', '2025', '2026', '2027'].forEach((a) => assert.ok(prompt.includes(a), 'falta el año ' + a));
});

test('parsearRespuestaBusqueda solo confía en una fuenteUrl si aparece en los grounding chunks', () => {
  const texto = JSON.stringify({
    pib_mundial: { valores: { '2026': '3.2' }, fuente: 'FMI', fuenteUrl: 'https://fmi.example/weo' },
    inflacion_colombia: { valores: { '2026': '3.8' }, fuente: 'DANE', fuenteUrl: 'https://dane.example/inventada' },
  });
  const chunks = [{ web: { uri: 'https://fmi.example/weo', title: 'WEO' } }];
  const series = parsearRespuestaBusqueda(texto, chunks);

  assert.strictEqual(series.pib_mundial.confiable, true);
  assert.strictEqual(series.pib_mundial.fuenteUrl, 'https://fmi.example/weo');
  assert.strictEqual(series.inflacion_colombia.confiable, false);
  assert.strictEqual(series.inflacion_colombia.fuenteUrl, null);
});

test('parsearRespuestaBusqueda ignora claves que no están en SERIES_MACRO', () => {
  const texto = JSON.stringify({ serie_inventada: { valores: { '2026': '1' }, fuente: 'x', fuenteUrl: 'https://x' } });
  const series = parsearRespuestaBusqueda(texto, []);
  assert.deepStrictEqual(series, {});
});

test('parsearRespuestaBusqueda descarta una serie sin "valores"', () => {
  const texto = JSON.stringify({ pib_mundial: { fuente: 'FMI', fuenteUrl: 'https://fmi.example' } });
  const series = parsearRespuestaBusqueda(texto, []);
  assert.deepStrictEqual(series, {});
});

test('construirPromptRedaccion solo incluye las series verificadas, con su fuente', () => {
  const series = { pib_mundial: { valores: { '2026': '3.2' }, fuente: 'FMI', fuenteUrl: 'https://fmi.example' } };
  const prompt = construirPromptRedaccion(series, 2026);
  assert.ok(prompt.includes('pib_mundial'));
  assert.ok(prompt.includes('FMI'));
  assert.ok(prompt.includes('https://fmi.example'));
  assert.ok(prompt.includes('"mundial"') && prompt.includes('"colombia"'));
});

test('parsearRespuestaRedaccion exige mundial y colombia como texto', () => {
  const ok = parsearRespuestaRedaccion('{"mundial": "<p>A</p>", "colombia": "<p>B</p>"}');
  assert.deepStrictEqual(ok, { mundial: '<p>A</p>', colombia: '<p>B</p>' });
  assert.throws(() => parsearRespuestaRedaccion('{"mundial": "<p>A</p>"}'), /mundial.*colombia/);
});

test('armarDocumentoFirestore rechaza guardar sin series o sin narrativa', () => {
  assert.throws(() => armarDocumentoFirestore({ series: {}, narrativa: { mundial: 'x', colombia: 'y' }, ahora: new Date() }), /ninguna serie/);
  assert.throws(() => armarDocumentoFirestore({ series: { pib_mundial: {} }, narrativa: null, ahora: new Date() }), /narrativa/);
});

test('armarDocumentoFirestore adjunta la fecha de consulta a cada serie', () => {
  const ahora = new Date('2026-08-01T06:00:00Z');
  const doc = armarDocumentoFirestore({
    series: { pib_mundial: { valores: { '2026': '3.2' }, fuente: 'FMI', fuenteUrl: 'https://fmi.example', confiable: true } },
    narrativa: { mundial: '<p>A</p>', colombia: '<p>B</p>' },
    ahora,
  });
  assert.strictEqual(doc.series.pib_mundial.fechaConsulta, ahora);
  assert.strictEqual(doc.narrativa.mundial, '<p>A</p>');
  assert.strictEqual(doc.actualizadoEn, ahora);
});
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `node --test functions/analisisMercadoPrompts.test.js`
Expected: FAIL — `Cannot find module './analisisMercadoPrompts'`

- [ ] **Step 3: Implementar el módulo**

```js
// functions/analisisMercadoPrompts.js

/* Puerto de extraerJSONDeRespuestaIA (index.html:1994-2012): escanea llaves
   balanceadas respetando cadenas, porque los modelos casi siempre envuelven el JSON
   en prosa o marcas markdown y JSON.parse(texto.trim()) falla apenas sobra una
   palabra. functions/ no comparte código con index.html ni con frontend/src (son
   entornos y formatos de módulo distintos), así que se porta aquí en vez de
   importarlo. */
function extraerJSON(texto) {
  const s = String(texto || '');
  const inicio = s.indexOf('{');
  if (inicio < 0) throw new Error('La respuesta no contiene un objeto JSON.');
  let profundidad = 0, enCadena = false, escapado = false;
  for (let i = inicio; i < s.length; i++) {
    const c = s[i];
    if (enCadena) {
      if (escapado) escapado = false;
      else if (c === '\\') escapado = true;
      else if (c === '"') enCadena = false;
      continue;
    }
    if (c === '"') { enCadena = true; continue; }
    if (c === '{') profundidad++;
    else if (c === '}') { profundidad--; if (profundidad === 0) return JSON.parse(s.slice(inicio, i + 1)); }
  }
  throw new Error('El JSON de la respuesta de la IA quedó incompleto (llaves sin cerrar).');
}

/* Las 8 series de DATOS_MACRO (frontend/src/services/analisisMercado.js), sin
   meta_inflacion_banrep porque es una meta de política fija, no una serie que buscar. */
const SERIES_MACRO = [
  { clave: 'pib_mundial', pregunta: 'crecimiento porcentual del PIB mundial (FMI, World Economic Outlook)' },
  { clave: 'pib_colombia', pregunta: 'crecimiento porcentual del PIB de Colombia (DANE / FMI)' },
  { clave: 'inflacion_global', pregunta: 'inflación global promedio (OCDE / FMI)' },
  { clave: 'inflacion_colombia', pregunta: 'inflación anual de Colombia, variación del IPC (DANE)' },
  { clave: 'tasa_intervencion', pregunta: 'tasa de intervención del Banco de la República de Colombia, con la fecha de cada decisión relevante' },
  { clave: 'trm_promedio', pregunta: 'TRM promedio anual de Colombia (Banco de la República)' },
  { clave: 'desempleo_colombia', pregunta: 'tasa de desempleo de Colombia (DANE, GEIH)' },
  { clave: 'crecimiento_por_region', pregunta: 'proyecciones de crecimiento del PIB por región/país: Mundial, Estados Unidos, China, América Latina, Colombia (FMI/OCDE)' },
];

function construirPromptBusqueda(anioActual) {
  const anios = [anioActual - 2, anioActual - 1, anioActual, anioActual + 1];
  const lista = SERIES_MACRO.map((s) => '- "' + s.clave + '": ' + s.pregunta + '.').join('\n');

  return (
    'Usa la búsqueda de Google para encontrar el valor más reciente y verificable de estas series ' +
    'macroeconómicas, para los años ' + anios.join(', ') + ':\n\n' + lista + '\n\n' +
    'Responde ÚNICAMENTE con un objeto JSON (sin texto adicional, sin marcas markdown) con esta forma:\n' +
    '{\n' +
    '  "pib_mundial": { "valores": { "2025": "3.2", "2026": "3.2" }, "fuente": "Fondo Monetario Internacional, WEO", "fuenteUrl": "https://..." },\n' +
    '  "tasa_intervencion": { "valores": { "2026": { "etiqueta": "Agosto 2026", "valor": "12.00" } }, "fuente": "...", "fuenteUrl": "..." },\n' +
    '  "crecimiento_por_region": { "valores": { "2026": [["Mundial","3.0"],["Estados Unidos","2.0"]] }, "fuente": "...", "fuenteUrl": "..." }\n' +
    '}\n\n' +
    'Reglas estrictas:\n' +
    '1. Cada "valores" es un mapa de año (string) a la cifra encontrada. No inventes un año que no verificaste.\n' +
    '2. "fuenteUrl" debe ser la URL real de la página que consultaste con la búsqueda, nunca una que ' +
    'recuerdes de memoria.\n' +
    '3. Si no encuentras un dato confiable para una serie, omite esa clave del JSON por completo — no la ' +
    'rellenes con un valor inventado ni con un guion.\n' +
    '4. No agregues ninguna clave que no esté en la lista de arriba.'
  );
}

/** Solo se confía en la fuenteUrl que el propio grounding de Gemini reporta haber
 *  consultado — no en una URL que el modelo redacte de memoria dentro del JSON,
 *  que sí puede inventar o recordar mal. */
function parsearRespuestaBusqueda(texto, groundingChunks) {
  const bruto = extraerJSON(texto);
  const urlsVerificadas = new Set(
    (groundingChunks || []).map((g) => g && g.web && g.web.uri).filter(Boolean)
  );
  const clavesValidas = new Set(SERIES_MACRO.map((s) => s.clave));

  const series = {};
  Object.keys(bruto).forEach((clave) => {
    if (!clavesValidas.has(clave)) return;
    const entrada = bruto[clave];
    if (!entrada || typeof entrada.valores !== 'object' || entrada.valores === null) return;

    const urlConfiable = urlsVerificadas.has(entrada.fuenteUrl);
    series[clave] = {
      valores: entrada.valores,
      fuente: entrada.fuente || 'Fuente sin especificar',
      fuenteUrl: urlConfiable ? entrada.fuenteUrl : null,
      confiable: urlConfiable,
    };
  });
  return series;
}

function construirPromptRedaccion(series, anioActual) {
  const resumen = Object.keys(series).map((clave) => {
    const s = series[clave];
    return '- ' + clave + ': ' + JSON.stringify(s.valores) + ' (fuente: ' + s.fuente + (s.fuenteUrl ? ', ' + s.fuenteUrl : '') + ')';
  }).join('\n');

  return (
    'Eres economista y redactas la Sección III ("TENDENCIAS DE LA ECONOMÍA") de un informe local de ' +
    'precios de transferencia para Colombia, año gravable ' + anioActual + '. Tienes ÚNICAMENTE estos ' +
    'datos ya verificados, con su fuente:\n\n' + resumen + '\n\n' +
    'Redacta dos apartados extensos (mínimo 3 párrafos cada uno, tono técnico-formal, en español):\n' +
    '1. "mundial": Análisis del Panorama de la Economía Mundial — crecimiento del PIB mundial, ' +
    'inflación global y su tendencia, riesgos y factores relevantes del período.\n' +
    '2. "colombia": Análisis del panorama de la economía colombiana — PIB, inflación, tasa de ' +
    'intervención del Banco de la República, TRM, desempleo, y su efecto sobre empresas que operan en ' +
    'el país.\n\n' +
    'Reglas estrictas:\n' +
    '- NO menciones ninguna cifra que no esté en los datos de arriba. Si te falta un dato para algo que ' +
    'quieras afirmar, no lo afirmes.\n' +
    '- Cada apartado en HTML, como una serie de párrafos <p>...</p>, sin encabezados ni tablas.\n' +
    '- Responde ÚNICAMENTE con un objeto JSON (sin marcas markdown) con esta forma exacta:\n' +
    '{ "mundial": "<p>...</p><p>...</p>", "colombia": "<p>...</p><p>...</p>" }'
  );
}

function parsearRespuestaRedaccion(texto) {
  const bruto = extraerJSON(texto);
  if (typeof bruto.mundial !== 'string' || typeof bruto.colombia !== 'string') {
    throw new Error('La redacción no trajo "mundial" y "colombia" como texto.');
  }
  return { mundial: bruto.mundial, colombia: bruto.colombia };
}

/** Documento final para `analisisMercado/actual`. No escribe nada por sí mismo —
 *  eso lo hace la capa impura (Task 2) — solo decide la forma. */
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

  return {
    actualizadoEn: ahora,
    series: seriesConFecha,
    narrativa: { mundial: narrativa.mundial, colombia: narrativa.colombia },
  };
}

module.exports = {
  SERIES_MACRO,
  extraerJSON,
  construirPromptBusqueda,
  parsearRespuestaBusqueda,
  construirPromptRedaccion,
  parsearRespuestaRedaccion,
  armarDocumentoFirestore,
};
```

- [ ] **Step 4: Agregar `functions/*.test.js` al runner de la raíz**

En `package.json` (raíz), línea 10:

```diff
-    "test": "node --test \"scripts/lib/*.test.js\" \"frontend/src/services/*.test.js\""
+    "test": "node --test \"scripts/lib/*.test.js\" \"frontend/src/services/*.test.js\" \"functions/*.test.js\""
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `npm test`
Expected: PASS — incluidos los 9 tests nuevos de `functions/analisisMercadoPrompts.test.js`

- [ ] **Step 6: Commit**

```bash
git add functions/analisisMercadoPrompts.js functions/analisisMercadoPrompts.test.js package.json
git commit -m "feat: modulo puro de prompts y parseo para el analisis de mercado con IA"
```

---

### Task 2: Orquestación (`functions/analisisMercadoActualizar.js`)

**Files:**
- Create: `functions/analisisMercadoActualizar.js`
- Modify: `functions/package.json:8-10` — agregar dependencia `firebase-admin`

**Interfaces:**
- Consumes: `construirPromptBusqueda`, `parsearRespuestaBusqueda`, `construirPromptRedaccion`,
  `parsearRespuestaRedaccion`, `armarDocumentoFirestore` (Task 1, `./analisisMercadoPrompts`).
- Produces: `actualizarAnalisisMercado({ geminiApiKey, claudeApiKey, anioActual }) -> Promise<object>`
  (el documento guardado). Task 3 lo invoca.

Sin test automatizado: hace llamadas de red reales a Gemini, Claude y Firestore — mismo criterio
que ya rige `frontend/src/services/firestoreRepo.js` ("aquí no hay reglas de negocio", ver su
comentario de cabecera). La lógica de negocio (parseo, armado del documento) ya quedó bajo test
en Task 1; aquí solo se verifica manualmente en el Step final.

- [ ] **Step 1: Agregar `firebase-admin` a `functions/package.json`**

```diff
   "dependencies": {
-    "firebase-functions": "^5.1.1"
+    "firebase-functions": "^5.1.1",
+    "firebase-admin": "^12.6.0"
   },
```

Run: `npm install --prefix functions`
Expected: se agrega `firebase-admin` a `functions/node_modules` y a `functions/package-lock.json`

- [ ] **Step 2: Escribir el módulo de orquestación**

```js
// functions/analisisMercadoActualizar.js
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const {
  construirPromptBusqueda,
  parsearRespuestaBusqueda,
  construirPromptRedaccion,
  parsearRespuestaRedaccion,
  armarDocumentoFirestore,
} = require('./analisisMercadoPrompts');

if (!getApps().length) initializeApp();

const GEMINI_MODEL = 'gemini-3-flash-preview';
const CLAUDE_MODEL = 'claude-sonnet-5';

async function buscarCifras(geminiApiKey, anioActual) {
  const prompt = construirPromptBusqueda(anioActual);
  const respuesta = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
    }
  );
  const data = await respuesta.json();
  const candidato = data && data.candidates && data.candidates[0];
  if (!respuesta.ok || !candidato) {
    throw new Error('Gemini no devolvió una respuesta usable: ' + JSON.stringify(data).slice(0, 500));
  }
  const texto = (candidato.content.parts || []).map((p) => p.text || '').join('');
  const groundingChunks = (candidato.groundingMetadata && candidato.groundingMetadata.groundingChunks) || [];
  return parsearRespuestaBusqueda(texto, groundingChunks);
}

async function redactarNarrativa(claudeApiKey, series, anioActual) {
  const prompt = construirPromptRedaccion(series, anioActual);
  const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await respuesta.json();
  if (!respuesta.ok || !data.content || !data.content[0]) {
    throw new Error('Claude no devolvió una respuesta usable: ' + JSON.stringify(data).slice(0, 500));
  }
  const texto = data.content.map((b) => b.text || '').join('');
  return parsearRespuestaRedaccion(texto);
}

/** Corrida completa: busca, redacta y guarda. Si Gemini o Claude fallan, la
 *  excepción se propaga sin escribir nada — se prefiere conservar el mes
 *  anterior en Firestore a guardar un documento a medias. */
async function actualizarAnalisisMercado({ geminiApiKey, claudeApiKey, anioActual }) {
  const series = await buscarCifras(geminiApiKey, anioActual);
  if (!Object.keys(series).length) {
    throw new Error('Ninguna serie trajo un dato confiable esta corrida; se conserva la anterior.');
  }
  const narrativa = await redactarNarrativa(claudeApiKey, series, anioActual);

  const ahora = Timestamp.now();
  const documento = armarDocumentoFirestore({ series, narrativa, ahora });

  const db = getFirestore();
  const claveMes = ahora.toDate().toISOString().slice(0, 7); // "2026-08"
  await db.doc('analisisMercado/actual').set(documento);
  await db.doc(`analisisMercado/actual/historial/${claveMes}`).set(documento);

  return documento;
}

module.exports = { actualizarAnalisisMercado };
```

- [ ] **Step 3: Verificación manual**

No hay test automatizado (red real). Antes de conectar el cron (Task 3):

1. En una terminal de Node con acceso a las mismas variables (`GEMINI_API_KEY`,
   `ANTHROPIC_API_KEY` en el entorno, y credenciales de Firebase Admin vía
   `GOOGLE_APPLICATION_CREDENTIALS` o `firebase functions:shell`), correr:
   ```js
   require('./functions/analisisMercadoActualizar')
     .actualizarAnalisisMercado({
       geminiApiKey: process.env.GEMINI_API_KEY,
       claudeApiKey: process.env.ANTHROPIC_API_KEY,
       anioActual: 2026,
     })
     .then((doc) => console.log(JSON.stringify(doc, null, 2)))
     .catch((err) => console.error(err));
   ```
2. Confirmar en la consola de Firebase (Firestore) que `analisisMercado/actual` y
   `analisisMercado/actual/historial/2026-08` quedaron con `series` (con `fuente`/`fuenteUrl`
   reales) y `narrativa.mundial`/`narrativa.colombia` con texto extenso y coherente.
3. Confirmar que ninguna cifra de `series` corresponde a una serie que Gemini no pudo verificar
   (no debe haber claves con `confiable: false` guardadas con su `fuenteUrl` — deben venir con
   `fuenteUrl: null`).

- [ ] **Step 4: Commit**

```bash
git add functions/analisisMercadoActualizar.js functions/package.json functions/package-lock.json
git commit -m "feat: orquestacion Gemini->Claude->Firestore del analisis de mercado"
```

---

### Task 3: Cloud Function programada (`functions/index.js`)

**Files:**
- Modify: `functions/index.js:1-6` (imports/constantes) y agregar export al final del archivo

**Interfaces:**
- Consumes: `actualizarAnalisisMercado` (Task 2, `./analisisMercadoActualizar`).
- Produces: `exports.actualizarAnalisisMercadoScheduled` — Cloud Function desplegable.

- [ ] **Step 1: Agregar el import y la función programada**

En `functions/index.js`, después de la línea 6 (`const GEMINI_MODEL_DEFAULT = ...`):

```js
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { actualizarAnalisisMercado } = require('./analisisMercadoActualizar');
```

Al final del archivo (después de `exports.extraerCamara`):

```js
// Refresca mensualmente las cifras y la narrativa de la Sección III (III.A/III.B)
// en Firestore. No se ejecuta en cada informe: ver spec
// docs/superpowers/specs/2026-08-03-analisis-mercado-ia-design.md.
exports.actualizarAnalisisMercadoScheduled = onSchedule(
  {
    schedule: '0 6 1 * *',
    timeZone: 'America/Bogota',
    region: 'us-central1',
    secrets: [GEMINI_API_KEY, ANTHROPIC_API_KEY],
    timeoutSeconds: 300,
  },
  async () => {
    const anioActual = new Date().getFullYear();
    await actualizarAnalisisMercado({
      geminiApiKey: GEMINI_API_KEY.value(),
      claudeApiKey: ANTHROPIC_API_KEY.value(),
      anioActual,
    });
  }
);
```

- [ ] **Step 2: Verificación manual (sin automatizar — cron real de Firebase)**

1. `firebase deploy --only functions:actualizarAnalisisMercadoScheduled`
2. Disparar la corrida una vez sin esperar al día 1:
   ```
   gcloud scheduler jobs run firebase-schedule-actualizarAnalisisMercadoScheduled-us-central1 --location=us-central1
   ```
3. Revisar los logs: `firebase functions:log --only actualizarAnalisisMercadoScheduled`
4. Confirmar en Firestore que `analisisMercado/actual` quedó escrito (mismo criterio del Step 3
   de Task 2).

- [ ] **Step 3: Commit**

```bash
git add functions/index.js
git commit -m "feat: cron mensual que refresca el analisis de mercado en Firestore"
```

---

### Task 4: Reglas de Firestore para `analisisMercado`

**Files:**
- Modify: `firestore.rules:277-319` (agregar bloque antes del catch-all)
- Modify: `frontend/src/services/firestoreModelo.js:58-68` (documentar la colección nueva, mismo
  formato que las otras)

**Interfaces:**
- Produces: acceso de lectura a `analisisMercado/{docId}` y
  `analisisMercado/{docId}/historial/{mes}` para miembros del dominio; escritura denegada a
  todos los clientes (solo la Cloud Function, vía Admin SDK, que no pasa por estas reglas).

- [ ] **Step 1: Agregar el bloque de reglas**

En `firestore.rules`, inmediatamente antes de la línea 317 (`// Nada más existe...`):

```
    // =============================================================
    // analisisMercado — cifras y narrativa de la Sección III (Tendencias
    // de la Economía), refrescadas mensualmente por una Cloud Function.
    // Solo la Cloud Function escribe (Admin SDK, no pasa por estas reglas);
    // los miembros del dominio solo leen.
    // =============================================================

    match /analisisMercado/{docId} {
      allow read: if esMiembro();
      allow write: if false;
    }

    match /analisisMercado/{docId}/historial/{mes} {
      allow read: if esMiembro();
      allow write: if false;
    }

```

- [ ] **Step 2: Documentar la colección en `firestoreModelo.js`**

En el comentario de cabecera de `frontend/src/services/firestoreModelo.js`, después de la
descripción de `eeffComparables` (antes de la sección "Limitaciones conocidas"):

```
//
// Colección: analisisMercado
// ID del documento: "actual" (uno solo, más la subcolección "historial")
// Escrito exclusivamente por la Cloud Function programada `actualizarAnalisisMercadoScheduled`
// (Admin SDK); los miembros del dominio solo leen.
// Campos:
//   - actualizadoEn: timestamp
//   - series: map de clave de serie -> { valores, fuente, fuenteUrl, fechaConsulta, confiable }
//   - narrativa: { mundial: string (HTML), colombia: string (HTML) }
//
// Subcolección: analisisMercado/actual/historial
// ID del documento: "YYYY-MM" — una copia congelada de cada corrida, para poder responder
// con qué cifra y fuente se radicó un informe de una fecha dada.
```

- [ ] **Step 3: Verificación manual (sin harness de reglas en el repo)**

1. `firebase deploy --only firestore:rules`
2. En la consola del navegador con sesión iniciada (`@crconsultorescolombia.com`), confirmar
   lectura exitosa:
   ```js
   import { doc, getDoc } from 'firebase/firestore';
   import { db } from './services/firebase';
   await getDoc(doc(db, 'analisisMercado', 'actual')); // no debe lanzar permission-denied
   ```
3. Confirmar que un intento de escritura desde el cliente falla:
   ```js
   import { setDoc } from 'firebase/firestore';
   await setDoc(doc(db, 'analisisMercado', 'actual'), { x: 1 }); // debe lanzar permission-denied
   ```

- [ ] **Step 4: Commit**

```bash
git add firestore.rules frontend/src/services/firestoreModelo.js
git commit -m "feat: reglas de Firestore para la coleccion analisisMercado (solo lectura)"
```

---

### Task 5: Lectura desde el frontend (`firestoreRepo.js`)

**Files:**
- Modify: `frontend/src/services/firestoreRepo.js:27-33` (constantes de colección) y agregar la
  función al final del bloque de `estudios` o en una sección nueva

**Interfaces:**
- Produces: `leerAnalisisMercado() -> Promise<object|null>` — Task 8 lo consume.

Sin test: es una lectura directa del SDK, mismo criterio que el resto de `firestoreRepo.js` (sin
`firestoreRepo.test.js` en el repo — la lógica de negocio que sí se testea vive en
`firestoreModelo.js`, y aquí no hay ninguna).

- [ ] **Step 1: Agregar la constante de colección**

En `frontend/src/services/firestoreRepo.js`, junto a las otras (línea 27-30):

```diff
 const ESTUDIOS = 'estudios';
 const CLIENTES = 'clientes';
 const COMPARABLES = 'comparablesHistoricas';
 const EEFF = 'eeffComparables';
+const ANALISIS_MERCADO = 'analisisMercado';
```

- [ ] **Step 2: Agregar la función de lectura**

Al final del archivo, antes de la sección de migración (línea 265):

```js
/* ══════════════════════ análisis de mercado (Sección III) ══════════════════════ */

/** Cifras y narrativa vigentes de la Sección III (III.A/III.B), o null si el cron
 *  programado (`actualizarAnalisisMercadoScheduled`) todavía no ha corrido. */
export async function leerAnalisisMercado() {
  const instantanea = await getDoc(doc(db, ANALISIS_MERCADO, 'actual'));
  return instantanea.exists() ? instantanea.data() : null;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/firestoreRepo.js
git commit -m "feat: leer el analisis de mercado (Seccion III) desde Firestore"
```

---

### Task 6: Generadores de `analisisMercado.js` reciben los datos por parámetro

**Files:**
- Modify: `frontend/src/services/analisisMercado.js:175-294` (las 8 funciones generadoras de
  tabla) y agregar `generarApartadoMundial`/`generarApartadoColombia` después de
  `generarApartadoSectorial` (línea 352)
- Modify: `frontend/src/services/analisisMercado.test.js:114,121` (los dos call-sites que rompe
  el cambio de firma) y agregar tests nuevos

**Interfaces:**
- Consumes: nada nuevo (sigue usando `DATOS_MACRO`/`FUENTES_MACRO` del propio módulo como
  respaldo).
- Produces: las 8 generadoras de tabla ahora son `generarTablaX(datosMacro, year, wrap)` (antes
  `generarTablaX(year, wrap)`); nuevas `generarApartadoMundial(datosMacro, year, wrap)` y
  `generarApartadoColombia(datosMacro, year, wrap)`. `datosMacro` es el documento de
  `analisisMercado/actual` (forma: `{ series: { <clave>: { valores, fuente, fuenteUrl,
  fechaConsulta } }, narrativa: { mundial, colombia } }`) o `null`/`undefined`. Tasks 7 y 8 lo
  consumen.

- [ ] **Step 1: Escribir los tests que fallan**

En `frontend/src/services/analisisMercado.test.js`, junto a los tests existentes de
`generarApartadoSectorial` (después de la línea 168):

```js
test('un año sin datos deja el marcador aunque se le pase datosMacro vacío', () => {
  const salida = generarTablaTRM({ series: {} }, 2031, (v) => String(v));
  assert.ok(salida.includes('[Completar con la TRM promedio de 2031'), 'no se marcó el dato ausente');
});

test('con datosMacro de Firestore, la tabla usa esas cifras y esa fuente, no el respaldo local', () => {
  const datosMacro = {
    series: {
      pib_mundial: { valores: { '2026': '9.9' }, fuente: 'Fuente de prueba', fuenteUrl: 'https://prueba.example' },
    },
  };
  const salida = generarTablaPibMundial(datosMacro, 2026, (v) => String(v));
  assert.ok(salida.includes('9.9'), 'no usó la cifra de Firestore');
  assert.ok(!salida.includes('3.2'), 'usó la cifra del respaldo local en vez de la de Firestore');
  assert.ok(salida.includes('Fuente de prueba'), 'no citó la fuente de Firestore');
});

test('sin datosMacro (null), la tabla cae al respaldo DATOS_MACRO embebido', () => {
  const salida = generarTablaPibMundial(null, 2025, (v) => String(v));
  assert.ok(salida.includes('3.2'), 'no cayó al valor del respaldo local para 2025');
});

test('generarApartadoMundial usa la narrativa de Firestore cuando existe', () => {
  const datosMacro = { narrativa: { mundial: '<p>Texto redactado por IA sobre la economía mundial.</p>' } };
  const salida = generarApartadoMundial(datosMacro, 2026, (v) => String(v));
  assert.strictEqual(salida, '<p>Texto redactado por IA sobre la economía mundial.</p>');
});

test('generarApartadoMundial deja marcador si no hay narrativa todavía', () => {
  const salida = generarApartadoMundial(null, 2026, (v) => String(v));
  assert.ok(salida.includes('Actualizar con el análisis del panorama de la economía mundial'));
  assert.ok(salida.includes('Decreto 1625 de 2016'));
});

test('generarApartadoColombia usa la narrativa de Firestore cuando existe', () => {
  const datosMacro = { narrativa: { colombia: '<p>Texto redactado por IA sobre Colombia.</p>' } };
  const salida = generarApartadoColombia(datosMacro, 2026, (v) => String(v));
  assert.strictEqual(salida, '<p>Texto redactado por IA sobre Colombia.</p>');
});

test('generarApartadoColombia deja marcador si no hay narrativa todavía', () => {
  const salida = generarApartadoColombia(undefined, 2025, (v) => String(v));
  assert.ok(salida.includes('Actualizar con el análisis del panorama de la economía colombiana'));
});
```

Y actualizar los dos call-sites rotos por el cambio de firma:

```diff
 test('un año sin datos deja un marcador que exige la fuente, no un guion mudo', () => {
-  const salida = generarTablaTRM(2031, (v) => String(v));
+  const salida = generarTablaTRM(null, 2031, (v) => String(v));
```

```diff
 test('el desempleo del año siguiente sale como proyección y no repite el del año en curso', () => {
-  const salida = generarTablaDesempleo(2024, (v) => String(v));
+  const salida = generarTablaDesempleo(null, 2024, (v) => String(v));
```

Y el import, para traer las funciones nuevas:

```diff
 import {
   DATOS_MACRO,
   FUENTES_MACRO,
   generarApartadoSectorial,
+  generarApartadoMundial,
+  generarApartadoColombia,
+  generarTablaPibMundial,
   generarTablaDesempleo,
   generarTablaTRM,
   tituloSectorial,
 } from './analisisMercado.js';
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `node --test frontend/src/services/analisisMercado.test.js`
Expected: FAIL — `generarApartadoMundial is not a function` (y las firmas viejas de
`generarTablaTRM`/`generarTablaDesempleo`/`generarTablaPibMundial` no aceptan `datosMacro`)

- [ ] **Step 3: Cambiar la firma de las 8 generadoras de tabla**

Cada una gana un primer parámetro `datosMacro` y resuelve `S`/la fuente desde ahí si está
disponible, cayendo al `DATOS_MACRO`/`FUENTES_MACRO` del módulo si no. Reemplazar el bloque
completo (líneas 175-294) por:

```js
/** Serie y fuente para una clave: prioriza datosMacro (de Firestore) sobre el
 *  respaldo local embebido en el código. */
function resolverSerie(datosMacro, clave) {
  const remota = datosMacro && datosMacro.series && datosMacro.series[clave];
  if (remota && remota.valores) {
    let fuenteTexto = remota.fuente || FUENTES_MACRO[clave];
    if (remota.fuenteUrl) fuenteTexto += ' (' + remota.fuenteUrl + ')';
    return { valores: remota.valores, fuente: fuenteTexto };
  }
  return { valores: DATOS_MACRO[clave], fuente: FUENTES_MACRO[clave] };
}

export function generarTablaPibMundial(datosMacro, year, wrap) {
  const y1 = year - 1, y2 = year, y3 = year + 1;
  const { valores: S, fuente } = resolverSerie(datosMacro, 'pib_mundial');
  return tablaHTML(
    'Crecimiento del PIB Mundial (' + y1 + '-' + y3 + ')',
    ['Año', 'Crecimiento Mundial (%)'],
    [
      [wrap(y1), wrap(valorODisponible(S, y1, 'el crecimiento del PIB mundial'))],
      [wrap(y2), wrap(valorODisponible(S, y2, 'el crecimiento del PIB mundial'))],
      [wrap(y3) + ' (Proyección)', wrap(valorODisponible(S, y3, 'la proyección de crecimiento del PIB mundial'))],
    ],
    fuente
  );
}

export function generarTablaPibColombia(datosMacro, year, wrap) {
  const y1 = year - 1, y2 = year, y3 = year + 1;
  const { valores: S, fuente } = resolverSerie(datosMacro, 'pib_colombia');
  return tablaHTML(
    'Crecimiento del PIB en Colombia (' + y1 + '-' + y3 + ')',
    ['Año', 'Crecimiento del PIB (%)'],
    [
      [wrap(y1), wrap(valorODisponible(S, y1, 'el crecimiento del PIB de Colombia'))],
      [wrap(y2), wrap(valorODisponible(S, y2, 'el crecimiento del PIB de Colombia'))],
      [wrap(y3) + ' (Proyección OCDE)', wrap(valorODisponible(S, y3, 'la proyección de crecimiento del PIB de Colombia'))],
    ],
    fuente
  );
}

export function generarTablaInflacionGlobal(datosMacro, year, wrap) {
  const y1 = year - 1, y2 = year, y3 = year + 1;
  const { valores: S, fuente } = resolverSerie(datosMacro, 'inflacion_global');
  return tablaHTML(
    'Tasas de Inflación Global (' + y1 + '-' + y3 + ')',
    ['Año', 'Tasa de Inflación (%)'],
    [
      [wrap(y1), wrap(valorODisponible(S, y1, 'la inflación global'))],
      [wrap(y2), wrap(valorODisponible(S, y2, 'la inflación global'))],
      [wrap(y3) + ' (Proyección)', wrap(valorODisponible(S, y3, 'la proyección de inflación global'))],
    ],
    fuente
  );
}

export function generarTablaCrecimientoPorRegion(datosMacro, year, wrap) {
  const { valores: porAnio, fuente } = resolverSerie(datosMacro, 'crecimiento_por_region');
  const porRegion = porAnio[year];
  const titulo = 'Proyecciones de Crecimiento del PIB por Región/País (' + year + ')';
  if (!porRegion || !porRegion.length) {
    const regiones = ['Mundial', 'Estados Unidos', 'China', 'América Latina', 'Colombia (OCDE)'];
    return tablaHTML(titulo, ['Región/País', 'Crecimiento Proyectado (%)'],
      regiones.map((r) => [r, wrap(marcadorPendiente(year, 'la proyección de crecimiento de ' + r))]),
      fuente);
  }
  return tablaHTML(titulo, ['Región/País', 'Crecimiento Proyectado (%)'],
    porRegion.map(([region, valor]) => [region, wrap(valor)]),
    fuente);
}

export function generarTablaInflacionColombia(datosMacro, year, wrap) {
  const { valores: S, fuente } = resolverSerie(datosMacro, 'inflacion_colombia');
  return tablaHTML(
    'Inflación en Colombia (' + year + ' vs. Meta ' + (year + 1) + ')',
    ['Indicador', 'Valor (%)'],
    [
      ['Inflación ' + wrap(year), wrap(valorODisponible(S, year, 'la inflación de Colombia'))],
      ['Meta Inflación ' + wrap(year + 1), wrap(DATOS_MACRO.meta_inflacion_banrep)],
    ],
    fuente
  );
}

export function generarTablaTasaIntervencion(datosMacro, year, wrap) {
  const { valores: S, fuente } = resolverSerie(datosMacro, 'tasa_intervencion');
  const y1 = year - 1, y2 = year;
  const filas = [y1, y2].map((y) => {
    const obs = S[y];
    return obs
      ? [obs.etiqueta, wrap(obs.valor)]
      : ['Diciembre ' + y, wrap(marcadorPendiente(y, 'la tasa de intervención del Banco de la República'))];
  });
  const etiquetas = filas.map((f) => f[0]);
  return tablaHTML(
    'Tasa de Intervención del Banco de la República (' + etiquetas[0] + ' - ' + etiquetas[1] + ')',
    ['Fecha', 'Tasa de Intervención (%)'],
    filas,
    fuente
  );
}

export function generarTablaTRM(datosMacro, year, wrap) {
  const y1 = year - 1, y2 = year;
  const { valores: S, fuente } = resolverSerie(datosMacro, 'trm_promedio');
  return tablaHTML(
    'Tasa Representativa del Mercado (TRM) Promedio (' + y1 + '-' + y2 + ')',
    ['Año', 'TRM Promedio ($)'],
    [
      [wrap(y1), wrap(valorODisponible(S, y1, 'la TRM promedio'))],
      [wrap(y2), wrap(valorODisponible(S, y2, 'la TRM promedio'))],
    ],
    fuente
  );
}

export function generarTablaDesempleo(datosMacro, year, wrap) {
  const { valores: S, fuente } = resolverSerie(datosMacro, 'desempleo_colombia');
  return tablaHTML(
    'Tasa de Desempleo en Colombia (' + year + ' vs. Proyección ' + (year + 1) + ')',
    ['Indicador', 'Valor (%)'],
    [
      ['Desempleo ' + wrap(year), wrap(valorODisponible(S, year, 'la tasa de desempleo'))],
      ['Desempleo Proyectado ' + wrap(year + 1), wrap(valorODisponible(S, year + 1, 'la proyección de desempleo'))],
    ],
    fuente
  );
}
```

- [ ] **Step 4: Agregar `generarApartadoMundial`/`generarApartadoColombia`**

Después de `generarApartadoSectorial` (línea 352 del archivo original), antes del final:

```js
/* ─────────────────────────────────────────────────────────────────────────────
   6. APARTADOS III.A Y III.B
   Narrativa ya redactada por functions/analisisMercadoActualizar.js (Gemini busca,
   Claude redacta), o un marcador de pendiente si Firestore todavía no tiene una
   corrida guardada. A diferencia del apartado sectorial, el título de estos dos
   no depende del cliente, así que no hace falta una función de título aparte.
   ───────────────────────────────────────────────────────────────────────────── */

export function generarApartadoMundial(datosMacro, year, wrap) {
  const marca = typeof wrap === 'function' ? wrap : (v) => v;
  const narrativa = datosMacro && datosMacro.narrativa && datosMacro.narrativa.mundial;
  if (narrativa) return narrativa;
  return '<p>\n' + marca(
    '[Actualizar con el análisis del panorama de la economía mundial del año gravable ' + year +
    ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo 1.2.2.2.1.5 del Decreto 1625 de 2016.]'
  ) + '\n</p>\n';
}

export function generarApartadoColombia(datosMacro, year, wrap) {
  const marca = typeof wrap === 'function' ? wrap : (v) => v;
  const narrativa = datosMacro && datosMacro.narrativa && datosMacro.narrativa.colombia;
  if (narrativa) return narrativa;
  return '<p>\n' + marca(
    '[Actualizar con el análisis del panorama de la economía colombiana del año gravable ' + year +
    ' e indicar fuente y fecha de consulta, conforme al numeral 4 del artículo 1.2.2.2.1.5 del Decreto 1625 de 2016.]'
  ) + '\n</p>\n';
}
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `node --test frontend/src/services/analisisMercado.test.js`
Expected: PASS — los 16 tests existentes más los 7 nuevos

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/analisisMercado.js frontend/src/services/analisisMercado.test.js
git commit -m "feat: los generadores de la Seccion III reciben datos de Firestore por parametro"
```

---

### Task 7: Anclas y reemplazo de III.A/III.B en `exactTemplateMapper.js`

**Files:**
- Modify: `frontend/src/services/exactTemplateMapper.js:1-31` (imports, `TABLAS_MACRO`), `:38-39`
  (anclas), `:131-155` (`diagnosticarCobertura`), `:195-373` (`hydrateExactWordTemplate`)
- Modify: `frontend/src/services/exactTemplateMapper.test.js` (agregar tests nuevos; los
  existentes no cambian de firma porque `datosMacro` es un parámetro opcional)

**Interfaces:**
- Consumes: `generarApartadoMundial`, `generarApartadoColombia` (Task 6,
  `./analisisMercado.js`).
- Produces: `hydrateExactWordTemplate(rawHtml, study, datosMacro)` (antes
  `hydrateExactWordTemplate(rawHtml, study)` — `datosMacro` opcional, `undefined` conserva el
  comportamiento de hoy); `diagnosticarCobertura(rawHtml, study, datosMacro)` (mismo criterio).
  Task 8 pasa `datosMacro` en ambas.

- [ ] **Step 1: Escribir los tests que fallan**

En `frontend/src/services/exactTemplateMapper.test.js`, agregar:

```js
test('el apartado mundial (III.A) usa la narrativa de datosMacro cuando existe', () => {
  const html =
    '<ol>\n<li>\n<a id="_Toc208930977"></a><strong>Análisis del Panorama de la Economía Mundial</strong>\n</li>\n</ol>\n' +
    '<p>Texto original de End Game sobre 2023-2024 y Ucrania-Rusia.</p>\n' +
    '<ol>\n<li>\n<a id="_Toc208930978"></a><strong>Análisis del panorama de la economía colombiana</strong>\n</li>\n</ol>';
  const datosMacro = { narrativa: { mundial: '<p>Narrativa nueva de la economía mundial.</p>' } };
  const salida = hydrateExactWordTemplate(html, { anio: 2026 }, datosMacro);

  assert.ok(salida.includes('Narrativa nueva de la economía mundial.'), 'no se insertó la narrativa nueva');
  assert.ok(!salida.includes('Ucrania-Rusia'), 'quedó el texto viejo de End Game');
  assert.ok(salida.includes('id="_Toc208930977"'), 'se borró el ancla de III.A');
  assert.ok(salida.includes('id="_Toc208930978"'), 'el reemplazo se comió el ancla de III.B');
});

test('el apartado colombiano (III.B) usa la narrativa de datosMacro cuando existe', () => {
  const html =
    '<ol>\n<li>\n<a id="_Toc208930978"></a><strong>Análisis del panorama de la economía colombiana</strong>\n</li>\n</ol>\n' +
    '<p>Texto original de End Game.</p>\n' +
    '<ol>\n<li>\n<a id="_Toc208930979"></a><strong>Análisis del Sector</strong>\n</li>\n</ol>';
  const datosMacro = { narrativa: { colombia: '<p>Narrativa nueva de Colombia.</p>' } };
  const salida = hydrateExactWordTemplate(html, { anio: 2026 }, datosMacro);

  assert.ok(salida.includes('Narrativa nueva de Colombia.'), 'no se insertó la narrativa nueva');
  assert.ok(!salida.includes('Texto original de End Game'), 'quedó el texto viejo');
});

test('sin datosMacro, III.A y III.B quedan con el marcador de pendiente, no con el texto de End Game', () => {
  const html =
    '<ol>\n<li>\n<a id="_Toc208930977"></a><strong>Análisis del Panorama de la Economía Mundial</strong>\n</li>\n</ol>\n' +
    '<p>Texto original de End Game.</p>\n' +
    '<ol>\n<li>\n<a id="_Toc208930978"></a><strong>Análisis del panorama de la economía colombiana</strong>\n</li>\n</ol>\n' +
    '<p>Texto original de End Game.</p>\n' +
    '<ol>\n<li>\n<a id="_Toc208930979"></a><strong>Análisis del Sector</strong>\n</li>\n</ol>';
  const salida = hydrateExactWordTemplate(html, { anio: 2026 });

  assert.ok(!salida.includes('Texto original de End Game'), 'quedó el texto de End Game sin datosMacro');
  assert.ok(salida.includes('Actualizar con el análisis del panorama de la economía mundial'), 'falta el marcador de III.A');
  assert.ok(salida.includes('Actualizar con el análisis del panorama de la economía colombiana'), 'falta el marcador de III.B');
});

test('las 8 tablas macro usan las cifras de datosMacro cuando están disponibles', () => {
  const html = '<p>\n<strong>Crecimiento del PIB Mundial (2023-2025)</strong>\n</p>\n<table>\n<tr>\n<td>\n<p>\n3.2\n</p>\n</td>\n</tr>\n</table>';
  const datosMacro = {
    series: { pib_mundial: { valores: { '2026': '9.9' }, fuente: 'Fuente de prueba' } },
  };
  const salida = hydrateExactWordTemplate(html, { anio: 2026 }, datosMacro);
  assert.ok(salida.includes('9.9'), 'la tabla no usó la cifra de datosMacro');
  assert.ok(salida.includes('Fuente de prueba'), 'la tabla no citó la fuente de datosMacro');
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `node --test frontend/src/services/exactTemplateMapper.test.js`
Expected: FAIL — el HTML todavía sale con "Texto original de End Game" y sin las cifras nuevas
(no existen anclas/reemplazo para III.A/III.B ni el parámetro `datosMacro`)

- [ ] **Step 3: Agregar las anclas y el import**

```diff
 import {
   DATOS_MACRO,
   generarTablaPibMundial,
   generarTablaPibColombia,
   generarTablaInflacionGlobal,
   generarTablaCrecimientoPorRegion,
   generarTablaInflacionColombia,
   generarTablaTasaIntervencion,
   generarTablaTRM,
   generarTablaDesempleo,
   generarApartadoSectorial,
+  generarApartadoMundial,
+  generarApartadoColombia,
   tituloSectorial,
 } from './analisisMercado.js';
```

```diff
 const ANCLA_SECTORIAL = '_Toc208930979';
 const ANCLA_SIGUIENTE = '_Toc208930980';
+/* III.A y III.B: mismo documento de Word, anclas ya presentes en la plantilla
+   (confirmadas en el índice de masterTemplate.js). El orden es
+   Mundial(977) -> Colombia(978) -> Sectorial(979) -> IV(980). */
+const ANCLA_MUNDIAL = '_Toc208930977';
+const ANCLA_COLOMBIA = '_Toc208930978';
```

- [ ] **Step 4: Agregar la función de reemplazo de cuerpo**

Después de `reponerEnlaces` (línea 101), antes de `reemplazarApartadoSectorial`:

```js
/** Sustituye el cuerpo de III.A o III.B entre su ancla y la del apartado
 *  siguiente, conservando el título original (a diferencia del sectorial, este
 *  título no depende del cliente y no hace falta tocarlo). Si el HTML no trae la
 *  ancla —una plantilla que el usuario subió— no toca nada. */
function reemplazarCuerpoApartado(html, anclaInicio, anclaFin, contenidoNuevo) {
  const rx = new RegExp(
    '(<a id="' + anclaInicio + '"></a><strong>[\\s\\S]*?</strong>\\s*</li>\\s*</ol>)' +
    '[\\s\\S]*?(?=<ol>\\s*<li>\\s*<a id="' + anclaFin + '">)'
  );
  return html.replace(rx, (completo, tituloCompleto) => tituloCompleto + '\n' + contenidoNuevo);
}
```

- [ ] **Step 5: Actualizar `diagnosticarCobertura`**

Reemplazar la función completa (líneas 131-155) por:

```js
export function diagnosticarCobertura(rawHtml, study, datosMacro) {
  const year = Number(study && study.anio) || 2025;
  const html = String(rawHtml || '');

  const seriesFaltantes = [];
  const porAnio = [
    ['el crecimiento del PIB mundial', 'pib_mundial'],
    ['el crecimiento del PIB de Colombia', 'pib_colombia'],
    ['la inflación global', 'inflacion_global'],
    ['la inflación de Colombia', 'inflacion_colombia'],
    ['la TRM promedio', 'trm_promedio'],
    ['la tasa de desempleo', 'desempleo_colombia'],
    ['la tasa de intervención del Banco de la República', 'tasa_intervencion'],
    ['las proyecciones de crecimiento por región', 'crecimiento_por_region'],
  ];
  porAnio.forEach(([concepto, clave]) => {
    const remota = datosMacro && datosMacro.series && datosMacro.series[clave];
    const serie = (remota && remota.valores) || DATOS_MACRO[clave];
    if (!serie || serie[year] === undefined) seriesFaltantes.push(concepto);
  });

  return {
    year,
    sectorialCubierto: html.includes('id="' + ANCLA_SECTORIAL + '"'),
    seriesFaltantes,
    narrativaCubierta: !!(datosMacro && datosMacro.narrativa && datosMacro.narrativa.mundial && datosMacro.narrativa.colombia),
  };
}
```

- [ ] **Step 6: Wirear en `hydrateExactWordTemplate` y en `TABLAS_MACRO`**

```diff
-export function hydrateExactWordTemplate(rawHtml, study) {
+export function hydrateExactWordTemplate(rawHtml, study, datosMacro) {
```

```diff
   html = reemplazarApartadoSectorial(html, study, year, wrap);
+
+  /* III.A y III.B, con la misma narrativa (o el mismo marcador) que use
+     datosMacro — van antes de apartarEnlaces por la misma razón que el
+     sectorial: se delimitan con las anclas <a id="_Toc…">. */
+  html = reemplazarCuerpoApartado(html, ANCLA_MUNDIAL, ANCLA_COLOMBIA, generarApartadoMundial(datosMacro, year, wrap));
+  html = reemplazarCuerpoApartado(html, ANCLA_COLOMBIA, ANCLA_SECTORIAL, generarApartadoColombia(datosMacro, year, wrap));
```

```diff
   TABLAS_MACRO.forEach(({ rx, gen }) => {
-    html = html.replace(rx, () => gen(year, wrap));
+    html = html.replace(rx, () => gen(datosMacro, year, wrap));
   });
```

- [ ] **Step 7: Correr los tests y confirmar que pasan**

Run: `node --test frontend/src/services/exactTemplateMapper.test.js frontend/src/services/analisisMercado.test.js`
Expected: PASS — todos los existentes más los 4 nuevos de este task

- [ ] **Step 8: Commit**

```bash
git add frontend/src/services/exactTemplateMapper.js frontend/src/services/exactTemplateMapper.test.js
git commit -m "feat: reemplazar III.A y III.B con la narrativa de Firestore, con marcador de respaldo"
```

---

### Task 8: `ReporteGenerador.jsx` lee, pasa y avisa

**Files:**
- Modify: `frontend/src/components/ReporteGenerador.jsx:1-114` (import, estado, efecto nuevo,
  `avisosDeMercado`, los tres call-sites de `hydrateExactWordTemplate`)

**Interfaces:**
- Consumes: `leerAnalisisMercado` (Task 5, `../services/firestoreRepo`).

Sin test automatizado: es un componente React que ya no tiene test propio en el repo (no hay
`ReporteGenerador.test.jsx`). Se verifica manualmente en el Step final, igual que ya se verificó
`fc0ca45` ("Verificado contra la plantilla real de 270 KB").

- [ ] **Step 1: Importar `leerAnalisisMercado` y agregar el estado**

```diff
 import { extraerReferencia } from '../services/pdfReferenceExtractor';
 import { guardarRecursos, leerRecursos, hashPlantilla, guardarPlantilla, leerPlantilla, guardarVinculo, leerVinculo } from '../services/plantillaStore';
+import { leerAnalisisMercado } from '../services/firestoreRepo';

 export default function ReporteGenerador({ study, estudioId }) {
   const [htmlContent, setHtmlContent] = useState('');
   const [loading, setLoading] = useState(false);
   const [customTemplateLoaded, setCustomTemplateLoaded] = useState(false);
   const [recursosCargados, setRecursosCargados] = useState([]);
+  /* Cifras y narrativa de la Sección III, refrescadas mensualmente por
+     `actualizarAnalisisMercadoScheduled`. null mientras carga o si Firestore no
+     responde — los generadores de analisisMercado.js caen al respaldo local
+     embebido en el código cuando reciben null. */
+  const [analisisMercado, setAnalisisMercado] = useState(null);
   const [avisoHidratacion, setAvisoHidratacion] = useState('');
```

- [ ] **Step 2: Agregar el efecto que lee Firestore una vez**

Después de la declaración de `faltaSustitucion` (línea 27), antes de `avisosDeMercado`:

```js
  /* Documento global (no depende de estudioId): una lectura por sesión basta,
     el cron que lo refresca corre una vez al mes. Si falla, se deja null: los
     generadores de la Sección III ya saben caer al respaldo local. */
  useEffect(() => {
    let vivo = true;
    leerAnalisisMercado()
      .then((datos) => { if (vivo) setAnalisisMercado(datos); })
      .catch((err) => {
        console.error('No se pudo leer el análisis de mercado de Firestore:', err);
        if (vivo) setAnalisisMercado(null);
      });
    return () => { vivo = false; };
  }, []);
```

- [ ] **Step 3: Extender `avisosDeMercado`**

```diff
   const avisosDeMercado = (htmlBase) => {
-    const d = diagnosticarCobertura(htmlBase, study);
+    const d = diagnosticarCobertura(htmlBase, study, analisisMercado);
     const avisos = [];
     if (!d.sectorialCubierto) {
       avisos.push(
         'esta plantilla no trae la sección del análisis del sector, así que no se ' +
         'reemplazó por la actividad de la compañía: revísala a mano'
       );
     }
     if (d.seriesFaltantes.length) {
       avisos.push(
         'no hay datos de ' + d.year + ' para ' + d.seriesFaltantes.join(', ') +
         '; esas tablas quedaron con un marcador que hay que completar'
       );
     }
+    if (!analisisMercado) {
+      avisos.push(
+        'no se pudo leer el análisis de mercado actualizado; se está usando el respaldo local del código'
+      );
+    } else if (analisisMercado.actualizadoEn) {
+      const dias = (Date.now() - analisisMercado.actualizadoEn.toMillis()) / 86400000;
+      if (dias > 62) {
+        avisos.push(
+          'los datos macro de la Sección III no se han refrescado en más de dos meses (última ' +
+          'actualización: ' + new Date(analisisMercado.actualizadoEn.toMillis()).toLocaleDateString('es-CO') + ')'
+        );
+      }
+    }
     return avisos;
   };
```

- [ ] **Step 4: Pasar `analisisMercado` en los tres call-sites de `hydrateExactWordTemplate`**

Línea 89 (efecto de rehidratación al recargar):

```diff
-        const hidratado = hydrateExactWordTemplate(html, study);
+        const hidratado = hydrateExactWordTemplate(html, study, analisisMercado);
```

y agregar `analisisMercado` a las dependencias de ese efecto (línea 101):

```diff
     return () => { vivo = false; };
-  }, [estudioId]);
+  }, [estudioId, analisisMercado]);
```

Línea 105 (`loadExactMasterTemplate`):

```diff
   const loadExactMasterTemplate = () => {
-    const hydrated = hydrateExactWordTemplate(MASTER_WORD_TEMPLATE, study);
+    const hydrated = hydrateExactWordTemplate(MASTER_WORD_TEMPLATE, study, analisisMercado);
     setHtmlContent(hydrated);
     setAvisoHidratacion(componerAviso(MASTER_WORD_TEMPLATE, hydrated));
   };

   useEffect(() => {
     if (!customTemplateLoaded) {
       loadExactMasterTemplate();
     }
-  }, [study, customTemplateLoaded]);
+  }, [study, customTemplateLoaded, analisisMercado]);
```

Línea 154 (`handleTemplateUpload`, carga manual de plantilla):

```diff
-        const hydrated = hydrateExactWordTemplate(html, study);
+        const hydrated = hydrateExactWordTemplate(html, study, analisisMercado);
```

- [ ] **Step 5: Verificación manual**

1. `npm run dev --prefix frontend`, abrir el Gestor de Reportes en un estudio existente.
2. Con Firestore sin ninguna corrida todavía (`analisisMercado/actual` inexistente): el informe
   debe mostrar el marcador `[Actualizar con el análisis del panorama...]` en III.A/III.B, no el
   texto de End Game sobre 2023-2024/Ucrania-Rusia, y el aviso ámbar debe decir que no se pudo
   leer el análisis de mercado actualizado.
3. Tras correr manualmente `actualizarAnalisisMercadoScheduled` (Task 3, Step 2) al menos una
   vez: recargar el estudio y confirmar que III.A/III.B muestran la narrativa redactada por
   Claude, con cifras y fuentes reales, y que el aviso ámbar de "no se pudo leer" desaparece.
4. Confirmar que las 8 tablas de la Sección III muestran las cifras de Firestore (no las
   hardcodeadas del código) cuando `analisisMercado` cargó a tiempo.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ReporteGenerador.jsx
git commit -m "feat: ReporteGenerador lee el analisis de mercado de Firestore y avisa su estado"
```

---

## Self-Review

**1. Cobertura del spec:** origen/evidencia (contexto, no requiere tarea) — alcance III.A/III.B
+ 8 series (Tasks 1-8) — cadencia mensual en segundo plano (Task 3) — Firestore con historial
(Tasks 2, 4) — Gemini grounding + Claude redacción (Tasks 1-2) — fallback sin Firestore (Tasks
6-8) — testing (Task 1 automatizado; Tasks 2-5, 8 manuales por ser red/UI real, igual que el
resto del repo). Sin huecos frente al spec.

**2. Placeholders:** ninguno — cada paso trae código completo o el comando exacto a correr.

**3. Consistencia de tipos:** `datosMacro` tiene la misma forma en las Tasks 1 (`armarDocumentoFirestore`
produce `{ actualizadoEn, series: { <clave>: { valores, fuente, fuenteUrl, fechaConsulta,
confiable } }, narrativa: { mundial, colombia } }`), 6 (`resolverSerie`/`generarApartadoX` leen
exactamente esa forma) y 7 (`diagnosticarCobertura` lee `datosMacro.series[clave].valores` y
`datosMacro.narrativa`). `hydrateExactWordTemplate(rawHtml, study, datosMacro)` tiene la misma
firma en Tasks 7 y 8.
