# Redacción de la Narrativa Macro en Vivo — Design

## Contexto

El feature de hoy (`docs/superpowers/specs/2026-08-13-huecos-macro-narrativa-especifica-design.md`)
dejó los 7 huecos intermedios de III.A/III.B dependiendo de que `analisisMercado/actual` en
Firestore traiga los campos nuevos de narrativa (`inflacionMundial`, `politicaMonetaria`, etc.).
Esos campos solo se llenan cuando corre `actualizarAnalisisMercado` — hoy solo por el cron mensual
(`actualizarAnalisisMercadoScheduled`, `0 6 1 * *`, próxima vez 2026-09-01) o por una invocación
manual fuera de la UI. Probado en vivo el mismo día: mientras esa corrida no pase, los 7 huecos
muestran el marcador específico en vez de contenido real — comportamiento correcto por diseño,
pero frustrante para quien quiere ver el informe completo hoy.

**Decisión del usuario:** separar las dos mitades del pipeline. La búsqueda (Gemini +
`google_search`, la parte cara y lenta — 60-100+ s, factura por búsqueda) sigue siendo mensual y
compartida, sin cambios. La redacción (Claude, a partir de series que YA están verificadas) deja de
depender de esa corrida por lotes: se dispara en vivo, una vez por estudio, la primera vez que hace
falta.

## Alcance

Solo el lado **macro** (III.A/III.B, `analisisMercado/actual`). El análisis de sector (III.C) no
se toca — ya tiene su propio caché por actividad (`analisisSector/{claveActividad}`) con 12
corridas reales y contenido en la mayoría de sus bloques; no es el que causó el dolor de hoy.

## Arquitectura

**`docxRelleno.js`/`tablasHtmlInforme.js` no cambian.** Siguen recibiendo `datosMacro.narrativa.*`
como cualquier otro dato — no saben ni les importa si ese dato vino de un documento pre-horneado en
Firestore o de una llamada en vivo. Todo el cambio vive en la capa que arma `datosMacro` antes de
renderizar, en `frontend/src/components/ReporteGenerador.jsx`.

**Nueva pieza: `frontend/src/services/analisisMercadoRedaccion.js`.**
- `necesitaRedaccion(estudio, analisisMercado)`: compara `estudio.narrativaMacroCache?.seriesActualizadoEn`
  (un timestamp que el estudio guarda) contra `analisisMercado.actualizadoEn` (el de la corrida de
  series vigente). Si no hay caché, o el caché es de una corrida de series más vieja, hace falta
  redactar.
- `redactarNarrativaMacroEnVivo(series, anioActual)`: arma el mismo prompt de 9 apartados que ya
  redacta `functions/analisisMercadoPrompts.js:construirPromptRedaccion` (se porta la función a
  este archivo — `functions/` y `frontend/src/` no comparten código, mismo patrón ya usado para los
  prompts de RUT/Cámara, ver CLAUDE.md), llama a `/api/claude` **vía `axios.post('/api/claude', …)`
  directo desde el navegador** (mismo patrón que ya usa `descripcionComparables.js:33`, que ya
  reintenta en 429), y parsea la respuesta con la misma lógica de
  `parsearRespuestaRedaccion` (portada igual). Nunca lanza: un fallo devuelve `null`.

**Por qué llamar `/api/claude` directo y no re-usar `functions/analisisMercadoActualizar.js`:**
esa función vive en `functions/` (Cloud Functions, Node/CommonJS, sin acceso de red desde el
navegador) y además hace la BÚSQUEDA con Gemini, que no queremos repetir. Lo que hace falta aquí es
solo el paso de redacción, que ya es exactamente lo que hace el proxy `/api/claude` — con su
fallback a Gemini ya incluido (`functions/fallbackGemini.js`, sin código nuevo que escribir para
eso).

**Flujo en `ReporteGenerador.jsx`:**
1. Al cargar el estudio (mismo `useEffect` que hoy llama `leerAnalisisMercado()`), si
   `necesitaRedaccion(estudio, analisisMercado)` es verdadero, llama
   `redactarNarrativaMacroEnVivo(analisisMercado.series, estudio.anio)`.
2. Si devuelve una narrativa (aunque sea parcial — algunos de los 9 campos, no todos): se combina
   con la narrativa ya presente en `analisisMercado.narrativa` (si Firestore ya tenía `mundial`/
   `colombia` del batch mensual, esos se preservan; los campos que sí devolvió la redacción en vivo
   los completan o los actualizan), se guarda en el estudio
   (`estudio.narrativaMacroCache = { seriesActualizadoEn: analisisMercado.actualizadoEn, narrativa }`,
   vía `guardarEstudio(id, estudio, usuario)`, igual que cualquier otro campo del estudio), y se usa
   para el render de esa sesión en adelante.
3. Si devuelve `null` (Claude y Gemini fallaron los dos): no se guarda nada: `datosMacro.narrativa`
   sigue como estaba (posiblemente solo `mundial`/`colombia` del batch, o vacío), los 7 huecos caen
   al marcador específico de tema — mismo comportamiento seguro de hoy, nunca bloquea la descarga.
   La próxima vez que se abra el estudio se reintenta (no se guarda un "ya lo intenté y falló"
   permanente).
4. Igual que con el análisis de sector hoy, mientras la redacción en vivo está en curso se muestra
   un aviso no bloqueante ("Redactando el panorama económico... puede tardar unos segundos") — MUCHO
   más corto que el de sector (sin búsqueda, un solo round-trip a Claude/Gemini, segundos, no
   minutos).

## Manejo de errores

- `/api/claude` ya reintenta en 429 (patrón de `descripcionComparables.js`) y ya cae a Gemini en el
  servidor si Anthropic no puede atender — nada nuevo que construir para esos dos casos.
- Si la respuesta no trae JSON parseable, o los campos vienen vacíos/cortos: mismo criterio que ya
  implementa `parsearRespuestaRedaccion` (Tarea 1 del feature de hoy) — se omite el campo, no se
  aborta todo.
- Nunca se bloquea la descarga del informe por esto: si la redacción en vivo no está lista (en
  curso, o falló), se genera igual con los marcadores específicos donde falte.

## Qué NO cambia

- La búsqueda de Gemini (mensual, compartida, cara) sigue igual.
- El análisis de sector (III.C) sigue con su mecanismo actual, sin tocar.
- `docxRelleno.js`/`tablasHtmlInforme.js` no cambian ni una línea.
- `functions/analisisMercadoActualizar.js`/`analisisMercadoPrompts.js` (el batch mensual) siguen
  existiendo tal cual — la redacción en vivo es un camino *adicional*, no un reemplazo: si el batch
  mensual ya redactó todo, `necesitaRedaccion` da `false` y no se llama a Claude en vivo para nada.

## Pruebas

- `analisisMercadoRedaccion.test.js`: `necesitaRedaccion` con caché ausente, caché vigente, caché
  de una corrida de series más vieja; `redactarNarrativaMacroEnVivo` con respuesta completa,
  parcial, vacía, y con el mock de `axios.post` fallando (debe devolver `null`, nunca lanzar).
- Prueba de integración liviana en `ReporteGenerador` (si el patrón de pruebas de componentes del
  repo lo permite) o, si no, verificación manual: abrir un estudio sin `narrativaMacroCache`,
  confirmar que aparece el aviso, que se guarda el caché, y que reabrir el mismo estudio no vuelve a
  llamar a Claude.
