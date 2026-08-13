# Redacción de la Narrativa Macro en Vivo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los 7 huecos intermedios de III.A/III.B dejen de depender del cron mensual: si
`analisisMercado/actual` no trae la narrativa por tema para el año del estudio, se dispara una
redacción en vivo (Claude, vía `/api/claude`, reusando las series ya verificadas — sin repetir la
búsqueda de Gemini), una sola vez por estudio, cacheada localmente.

**Architecture:** Un archivo nuevo (`frontend/src/services/analisisMercadoRedaccion.js`) porta el
prompt de redacción de 9 apartados que ya usa `functions/analisisMercadoPrompts.js` (mismo texto,
mismo criterio de "mundial"/"colombia" obligatorios y 7 temas opcionales) y llama a `/api/claude`
directo desde el navegador, mismo patrón que ya usa `descripcionComparables.js`. `ReporteGenerador.jsx`
dispara esa redacción cuando hace falta y cachea el resultado en `localStorage`, por `estudioId`.
`docxRelleno.js`/`tablasHtmlInforme.js` no cambian — siguen recibiendo `datosMacro.narrativa.*`
igual que hoy.

**Refinamiento sobre el spec:** el spec (`docs/superpowers/specs/2026-08-13-redaccion-macro-en-vivo-design.md`)
proponía cachear el resultado en el propio documento del estudio (`estudio.narrativaMacroCache`,
vía `guardarEstudio`). Verificado antes de escribir este plan: `ReporteGenerador.jsx` recibe
`{ study, estudioId, usuario }` sin ningún callback para persistir cambios al estudio —
`guardarEstudio` solo se llama hoy desde `App.jsx`. Escribir directo a Firestore tampoco sirve sin
más: `analisisMercado`/`analisisSector` tienary `allow write: if false` en `firestore.rules` (solo
la Cloud Function con Admin SDK escribe ahí) — un documento nuevo escrito desde el navegador
necesitaría una regla de seguridad nueva. Se cachea en `localStorage`, clave `pt:narrativaMacro:<estudioId>`,
mismo mecanismo que ya usa el resto de los datos del estudio (`pt:study:<id>`) — sin tocar
`firestore.rules` ni `App.jsx`.

**Tech Stack:** JavaScript (ESM), Vitest/node:test para las pruebas del servicio nuevo, React
(componente existente), `axios` (ya es dependencia del proyecto, usado por `descripcionComparables.js`).

**Spec:** `docs/superpowers/specs/2026-08-13-redaccion-macro-en-vivo-design.md`

## Global Constraints

- Código, comentarios, UI y mensajes en español.
- `npm test` (o los archivos de prueba puntuales, dado el problema de glob preexistente en el
  script raíz — ver nota de la sesión) debe quedar en 100 % verde.
- No se toca la búsqueda de Gemini (`construirPromptBusqueda`/`actualizarAnalisisMercadoScheduled`)
  ni el análisis de sector (III.C) — solo la redacción macro.
- `docxRelleno.js`/`tablasHtmlInforme.js` no cambian ni una línea.
- La redacción en vivo nunca bloquea la descarga del informe: si falla (red, Claude y Gemini
  caídos, JSON malformado), el informe se genera igual con los marcadores específicos de tema.
- `mundial`/`colombia` siguen siendo los únicos campos obligatorios de la redacción; los 7 de tema
  son "mejor si están, no bloqueantes" — mismo criterio que ya implementa
  `functions/analisisMercadoPrompts.js:parsearRespuestaRedaccion`.

---

## Task 1: `frontend/src/services/analisisMercadoRedaccion.js`

**Files:**
- Create: `frontend/src/services/analisisMercadoRedaccion.js`
- Test: `frontend/src/services/analisisMercadoRedaccion.test.js`

**Interfaces:**
- Consumes: `extraerJSON` de `./comparablesEngine.js` (ya existe y ya está exportado, línea 794).
- Produces:
  - `necesitaRedaccion(estudioId, analisisMercado)` → `boolean`.
  - `redactarNarrativaMacroEnVivo(series, anioActual)` → `Promise<object|null>` (mismo shape que
    `parsearRespuestaRedaccion` de `functions/analisisMercadoPrompts.js`: `{ mundial, colombia,
    fuentesCitadas, inflacionMundial?, proyeccionMundial?, inflacionColombia?, politicaMonetaria?,
    tasaCambio?, mercadoLaboral?, conclusiones? }`, o `null` si falló).
  - `guardarNarrativaMacroCache(estudioId, seriesActualizadoEnMs, narrativa)` → `void`.
  - `leerNarrativaMacroCache(estudioId)` → `{ seriesActualizadoEnMs: number, narrativa: object } | null`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  necesitaRedaccion, guardarNarrativaMacroCache, leerNarrativaMacroCache,
  construirPromptRedaccionMacro, parsearRespuestaRedaccionMacro,
} from './analisisMercadoRedaccion.js';

/* localStorage no existe en node:test — se simula con un Map, suficiente para
   getItem/setItem/removeItem, que es todo lo que este módulo usa. */
function fakeLocalStorage() {
  const datos = new Map();
  return {
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => datos.set(k, String(v)),
    removeItem: (k) => datos.delete(k),
  };
}

test('necesitaRedaccion es true si no hay caché para este estudio', () => {
  globalThis.localStorage = fakeLocalStorage();
  assert.equal(necesitaRedaccion('estudio_1', { actualizadoEn: { toMillis: () => 1000 } }), true);
});

test('necesitaRedaccion es false si el caché es de la misma corrida de series o más nueva', () => {
  globalThis.localStorage = fakeLocalStorage();
  guardarNarrativaMacroCache('estudio_1', 1000, { mundial: '<p>x</p>', colombia: '<p>y</p>' });
  assert.equal(necesitaRedaccion('estudio_1', { actualizadoEn: { toMillis: () => 1000 } }), false);
});

test('necesitaRedaccion es true si el caché es de una corrida de series más vieja', () => {
  globalThis.localStorage = fakeLocalStorage();
  guardarNarrativaMacroCache('estudio_1', 1000, { mundial: '<p>x</p>', colombia: '<p>y</p>' });
  assert.equal(necesitaRedaccion('estudio_1', { actualizadoEn: { toMillis: () => 2000 } }), true);
});

test('necesitaRedaccion es false si no hay analisisMercado todavia (nada que redactar)', () => {
  globalThis.localStorage = fakeLocalStorage();
  assert.equal(necesitaRedaccion('estudio_1', null), false);
});

test('leerNarrativaMacroCache devuelve null si nunca se guardó nada para ese estudio', () => {
  globalThis.localStorage = fakeLocalStorage();
  assert.equal(leerNarrativaMacroCache('estudio_nuevo'), null);
});

test('guardarNarrativaMacroCache y leerNarrativaMacroCache son simetricos, por estudioId', () => {
  globalThis.localStorage = fakeLocalStorage();
  guardarNarrativaMacroCache('estudio_A', 1234, { mundial: '<p>a</p>', colombia: '<p>b</p>' });
  guardarNarrativaMacroCache('estudio_B', 5678, { mundial: '<p>c</p>', colombia: '<p>d</p>' });
  const a = leerNarrativaMacroCache('estudio_A');
  assert.equal(a.seriesActualizadoEnMs, 1234);
  assert.equal(a.narrativa.mundial, '<p>a</p>');
  const b = leerNarrativaMacroCache('estudio_B');
  assert.equal(b.seriesActualizadoEnMs, 5678);
  assert.equal(b.narrativa.mundial, '<p>c</p>');
});

test('construirPromptRedaccionMacro pide los 9 apartados y solo las series recibidas', () => {
  const prompt = construirPromptRedaccionMacro(
    { pib_mundial: { valores: { 2025: '3.2' }, fuente: 'FMI', fuenteUrl: 'https://fmi.org' } },
    2025
  );
  ['mundial', 'colombia', 'inflacionMundial', 'proyeccionMundial', 'inflacionColombia',
    'politicaMonetaria', 'tasaCambio', 'mercadoLaboral', 'conclusiones', 'fuentesCitadas']
    .forEach((campo) => assert.ok(prompt.includes(campo), 'falta el campo ' + campo));
  assert.ok(prompt.includes('pib_mundial'));
});

test('parsearRespuestaRedaccionMacro exige mundial/colombia y admite temas parciales', () => {
  const texto = JSON.stringify({
    mundial: '<p>La economía mundial mostró un crecimiento moderado en el período.</p>',
    colombia: '<p>La economía colombiana registró una recuperación en el período.</p>',
    politicaMonetaria: '<p>La tasa de intervención se mantuvo estable en el período.</p>',
  });
  const r = parsearRespuestaRedaccionMacro(texto);
  assert.ok(r.mundial.includes('mundial'));
  assert.ok(r.politicaMonetaria.includes('tasa de intervención'));
  assert.equal('tasaCambio' in r, false);
});

test('parsearRespuestaRedaccionMacro lanza si falta mundial o colombia', () => {
  assert.throws(() => parsearRespuestaRedaccionMacro(JSON.stringify({ colombia: '<p>x</p>' })));
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `node --test frontend/src/services/analisisMercadoRedaccion.test.js`
Expected: FAIL — el módulo no existe todavía.

- [ ] **Step 3: Implementar el módulo**

Crear `frontend/src/services/analisisMercadoRedaccion.js`:

```javascript
import axios from 'axios';
import { extraerJSON } from './comparablesEngine.js';

const MODELO_REDACCION = 'claude-haiku-4-5-20251001';
const PREFIJO_CACHE = 'pt:narrativaMacro:';

/** Campos de tema "mejor si están, no bloqueantes" — mismo contrato que
 *  functions/analisisMercadoPrompts.js:CAMPOS_TEMA_OPCIONALES. Duplicado a propósito:
 *  frontend/src/ y functions/ no comparten código (ver CLAUDE.md). */
const CAMPOS_TEMA_OPCIONALES = [
  'inflacionMundial', 'proyeccionMundial', 'inflacionColombia', 'politicaMonetaria',
  'tasaCambio', 'mercadoLaboral', 'conclusiones',
];

const MIN_LARGO_APARTADO = 20;

/** Mismo prompt de 9 apartados que ya usa el batch mensual
 *  (functions/analisisMercadoPrompts.js:construirPromptRedaccion) — se porta aquí
 *  en vez de importarlo porque functions/ es CommonJS y no comparte código con
 *  frontend/src/ (ver CLAUDE.md). Si cambia la redacción legal o los apartados
 *  allá, cambiar aquí también a propósito. */
export function construirPromptRedaccionMacro(series, anioActual) {
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

/** Mismo criterio que functions/analisisMercadoPrompts.js:parsearRespuestaRedaccion —
 *  "mundial"/"colombia" obligatorios, los 7 temas "mejor si están". */
export function parsearRespuestaRedaccionMacro(texto) {
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

/** true si hace falta redactar en vivo: hay series de `analisisMercado` (si no hay
 *  ni siquiera eso, nada que redactar, el batch mensual tampoco ha corrido nunca) y
 *  o no hay caché para este estudio, o el caché es de una corrida de series más
 *  vieja que la vigente. */
export function necesitaRedaccion(estudioId, analisisMercado) {
  if (!analisisMercado || !analisisMercado.actualizadoEn) return false;
  const cache = leerNarrativaMacroCache(estudioId);
  if (!cache) return true;
  const vigente = analisisMercado.actualizadoEn.toMillis
    ? analisisMercado.actualizadoEn.toMillis()
    : Number(analisisMercado.actualizadoEn);
  return cache.seriesActualizadoEnMs < vigente;
}

export function leerNarrativaMacroCache(estudioId) {
  if (!estudioId) return null;
  const crudo = localStorage.getItem(PREFIJO_CACHE + estudioId);
  if (!crudo) return null;
  try {
    return JSON.parse(crudo);
  } catch {
    return null;
  }
}

export function guardarNarrativaMacroCache(estudioId, seriesActualizadoEnMs, narrativa) {
  if (!estudioId) return;
  localStorage.setItem(
    PREFIJO_CACHE + estudioId,
    JSON.stringify({ seriesActualizadoEnMs, narrativa })
  );
}

/* Mismo patrón de reintento en 429 que descripcionComparables.js:postClaudeWithRetry. */
async function postClaudeConReintento(payload, maxIntentos = 3) {
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      return await axios.post('/api/claude', payload);
    } catch (err) {
      const es429 = err.response && err.response.status === 429;
      if (es429 && intento < maxIntentos) {
        await new Promise((r) => setTimeout(r, intento * 3000));
      } else {
        throw err;
      }
    }
  }
}

/** Redacta los 9 apartados en vivo a partir de series YA verificadas (no busca
 *  nada nuevo). Nunca lanza: cualquier fallo (red, 4xx/5xx tras reintentar,
 *  respuesta sin JSON válido, "mundial"/"colombia" ausentes) devuelve `null` — el
 *  llamador cae a los marcadores específicos de tema, igual que si no hubiera
 *  narrativa. `/api/claude` ya cae a Gemini del lado del servidor si Anthropic no
 *  puede atender (functions/fallbackGemini.js) — no hay nada que replicar aquí
 *  para ese caso. */
export async function redactarNarrativaMacroEnVivo(series, anioActual) {
  try {
    const respuesta = await postClaudeConReintento({
      model: MODELO_REDACCION,
      max_tokens: 4000,
      messages: [{ role: 'user', content: construirPromptRedaccionMacro(series, anioActual) }],
    });
    const bloques = (respuesta.data && respuesta.data.content) || [];
    const texto = bloques.map((b) => b.text || '').join('');
    return parsearRespuestaRedaccionMacro(texto);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `node --test frontend/src/services/analisisMercadoRedaccion.test.js`
Expected: PASS, las 9 pruebas del Step 1.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/analisisMercadoRedaccion.js frontend/src/services/analisisMercadoRedaccion.test.js
git commit -m "feat: redaccion en vivo de la narrativa macro por estudio, cacheada en localStorage"
```

---

## Task 2: Cablear en `ReporteGenerador.jsx`

**Files:**
- Modify: `frontend/src/components/ReporteGenerador.jsx`

**Interfaces:**
- Consumes: `necesitaRedaccion`, `redactarNarrativaMacroEnVivo`, `guardarNarrativaMacroCache`,
  `leerNarrativaMacroCache` de `../services/analisisMercadoRedaccion.js`.
- Produces: el `datosMacro` que ya se pasa a `renderizar`/`renderizarDocx` (línea ~308, ~886) gana
  los campos de tema cuando la redacción en vivo los completó — mismo shape que consumen
  `actualizarApartadosMacroOoxml`/`Html`, sin cambiar esas funciones.

- [ ] **Step 1: Agregar el estado y el efecto de redacción en vivo**

En `frontend/src/components/ReporteGenerador.jsx`, cerca de la declaración de `analisisMercado`
(línea ~51), agregar:

```javascript
/* true mientras la redacción en vivo de la narrativa macro está en curso — mismo
   propósito que sectorEnCurso más abajo, pero mucho más corta (un solo round-trip
   a Claude/Gemini, sin búsqueda: segundos, no minutos). */
const [redactandoMacro, setRedactandoMacro] = useState(false);
```

Hay dos usos de `leerAnalisisMercado()` en el archivo: uno en un `useEffect` (línea ~104, carga
inicial al montar) y otro en el handler `actualizarInformacion` (línea ~1087, botón de refrescar a
mano). Se agrega la misma lógica en ambos, extraída a una función local para no duplicar el cuerpo.

Junto a la declaración de `redactandoMacro` (Step 1 de arriba), agregar esta función auxiliar
(usa `estudioId`, `study` y `setAnalisisMercado`, que ya están en el ámbito del componente):

```javascript
/* Dispara la redacción en vivo si hace falta, o aplica el caché de localStorage si ya
   existe uno vigente — mismo criterio en la carga inicial y en "Actualizar información".
   `datos` es lo que acaba de devolver leerAnalisisMercado() (puede ser null). */
function aplicarNarrativaMacro(datos) {
  if (!datos) return;
  if (necesitaRedaccion(estudioId, datos)) {
    setRedactandoMacro(true);
    redactarNarrativaMacroEnVivo(datos.series || {}, Number(study && study.anio) || 2025)
      .then((narrativaEnVivo) => {
        if (!narrativaEnVivo) return; // se queda con el marcador especifico, no bloquea nada
        const seriesActualizadoEnMs = datos.actualizadoEn && datos.actualizadoEn.toMillis
          ? datos.actualizadoEn.toMillis() : Date.now();
        guardarNarrativaMacroCache(estudioId, seriesActualizadoEnMs, narrativaEnVivo);
        setAnalisisMercado((actual) => ({
          ...actual,
          narrativa: { ...(actual && actual.narrativa), ...narrativaEnVivo },
        }));
      })
      .finally(() => setRedactandoMacro(false));
  } else {
    const cache = leerNarrativaMacroCache(estudioId);
    if (cache) {
      setAnalisisMercado((actual) => ({
        ...actual,
        narrativa: { ...(actual && actual.narrativa), ...cache.narrativa },
      }));
    }
  }
}
```

Sitio 1 — el `useEffect` de la línea ~102-111, cambiar:

```javascript
    leerAnalisisMercado()
      .then((datos) => { if (vivo) setAnalisisMercado(datos); })
```

por:

```javascript
    leerAnalisisMercado()
      .then((datos) => { if (vivo) { setAnalisisMercado(datos); aplicarNarrativaMacro(datos); } })
```

Sitio 2 — el handler `actualizarInformacion`, línea ~1087-1088, cambiar:

```javascript
      const macro = await leerAnalisisMercado();
      setAnalisisMercado(macro);
```

por:

```javascript
      const macro = await leerAnalisisMercado();
      setAnalisisMercado(macro);
      aplicarNarrativaMacro(macro);
```

Agregar el import al principio del archivo, junto a los demás imports de `../services/`:

```javascript
import {
  necesitaRedaccion, redactarNarrativaMacroEnVivo, guardarNarrativaMacroCache, leerNarrativaMacroCache,
} from '../services/analisisMercadoRedaccion';
```

- [ ] **Step 2: Agregar el aviso no bloqueante**

Cerca del banner existente de `sectorEnCurso` (buscar `{sectorEnCurso && (` en el archivo,
alrededor de la línea 1471), agregar uno análogo, mostrado ANTES de ese (el de macro es más rápido
y aparece primero en el documento):

```jsx
{redactandoMacro && (
  <div className="bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900 text-sky-800 dark:text-sky-300 rounded-xl px-5 py-3 text-xs leading-relaxed flex items-center gap-2">
    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
    Redactando el panorama económico (III.A/III.B) para este estudio — puede tardar unos segundos.
  </div>
)}
```

(`Loader2` ya está importado en este archivo — lo usa el banner de `sectorEnCurso`.)

- [ ] **Step 3: Verificación manual**

No hay pruebas de componentes React en este repo (verificado: no existe ningún
`frontend/src/components/*.test.*`) — igual que el resto de `ReporteGenerador.jsx`, esta tarea se
verifica manualmente en el navegador:
1. `npm run dev --prefix frontend`.
2. Abrir un estudio cuyo `estudioId` NO tenga todavía `pt:narrativaMacro:<estudioId>` en
   `localStorage` (DevTools → Application → Local Storage, o simplemente un estudio nuevo).
3. Confirmar que aparece el aviso azul "Redactando el panorama económico...".
4. Confirmar en la consola del navegador que aparece la llamada a `/api/claude` (Network tab).
5. Confirmar que `localStorage` queda con la clave `pt:narrativaMacro:<estudioId>`.
6. Recargar la página (mismo estudio): confirmar que el aviso NO vuelve a aparecer (no se repite la
   llamada) y que el informe generado ya trae los 7 temas con contenido real en vez del marcador
   específico.
7. Confirmar que un estudio DISTINTO (otro `estudioId`) sí dispara su propia redacción la primera
   vez — el caché es por estudio, no global.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ReporteGenerador.jsx
git commit -m "feat: disparar la redaccion macro en vivo al abrir un estudio que la necesite"
```

---

## Task 3: Verificación de la suite completa

**Files:** ninguno (verificación).

- [ ] **Step 1: Correr la suite completa del proyecto**

Run: `node --test scripts/lib/*.test.js frontend/src/services/*.test.js frontend/src/utils/*.test.js functions/*.test.js`
Expected: PASS, 100 % (incluye las 9 pruebas nuevas de Task 1; Task 2 no tiene pruebas
automatizadas, solo la verificación manual ya hecha).

- [ ] **Step 2: Reportar al usuario**

Confirmar que la suite quedó verde y recordar que la verificación de Task 2 (Step 3) requiere que
el usuario mismo pruebe en el navegador con un estudio real — no se puede automatizar en este repo.
