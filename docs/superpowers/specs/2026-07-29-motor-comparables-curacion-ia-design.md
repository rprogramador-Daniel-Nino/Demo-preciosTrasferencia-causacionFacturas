# Motor de comparables: perfil de actividad automático + curación de candidatas por IA

## Contexto

Hoy el flujo de comparables está partido en dos puntos desconectados:

1. La tarjeta **"Documentación comprobatoria del año anterior"** contiene un sub-panel
   **"🧠 Perfil de actividad de la empresa"** con el botón rojo **"🤖 Analizar empresa con
   IA"** (`extractPriorActivityWithGemini()`), que lee el estudio del año anterior
   (`PT_ANTERIOR.texto`) y extrae con Gemini: resumen de actividad, perfil funcional (FAR),
   productos, keywords de búsqueda y códigos SIC. Todo queda en editable manual (textareas +
   chips) en `actividad_json`.
2. La tarjeta **"Comparables"** contiene el **"⚙ Motor de selección automática (TOP-N)"**
   (`motorEjecutar()`), que importa el Excel de Capital IQ (`importCompsFile` →
   `smartMapRows`, que ya captura Company Name, Business Description e ID IQ vía
   `SYN.desc`/`SYN.id`) y aplica filtros cuantitativos (pérdidas, holding, saldos negativos,
   geografía, rigor funcional, tamaño, rentabilidad). El único cruce con la actividad
   específica es un emparejamiento ingenuo por substring (`moActMatch`, línea ~3618) entre las
   keywords/SIC del perfil y el texto de `DESCS[nombre]`.

Estos dos puntos nunca se pensaron como un solo flujo: el analista puede ejecutar el motor sin
haber extraído la actividad, y la coincidencia de actividad es un simple `indexOf` de texto, no
un juicio real sobre si la empresa candidata hace lo mismo que la parte examinada. Esto puede
dejar pasar comparables que no son funcionalmente comparables, o descartar buenas candidatas
cuya descripción no usa literalmente la misma palabra.

## Objetivo

Unificar todo en la tarjeta **Comparables**, y usar un modelo de lenguaje (Gemini) para que lea
la Business Description real de cada empresa del Excel importado y decida cuáles coinciden de
verdad con la actividad de la parte examinada — en vez de depender de una coincidencia de texto
literal. El motor cuantitativo (pérdidas, holding, tamaño, geografía, etc.) sigue actuando igual
que hoy, pero solo sobre el universo que la IA ya validó como funcionalmente afín.

## Flujo de extremo a extremo

```
1. Analista sube el informe del año anterior (tarjeta "Documentación...", sin cambios de UI)
        │  (automático, sin botón)
        ▼
2. Gemini detecta la actividad específica → UNA frase precisa ("actividad detectada")
        │  se muestra de solo lectura en la tarjeta Comparables, con ✏️ para corregirla
        ▼
3. Analista define los filtros del Motor (igual que hoy) e importa el Excel de Capital IQ
        │  (automático, sin botón, apenas termina de mapear el Excel)
        ▼
4. Gemini lee la Business Description de cada candidata del Excel + la actividad detectada
   → devuelve qué ID IQ coinciden de verdad con la actividad
        │
        ▼
5. Analista pulsa "Ejecutar selección" (sin cambios de botón) → motorEjecutar() aplica los
   filtros cuantitativos de siempre, pero solo sobre los ID IQ que la IA validó en el paso 4
```

Todo lo automático (pasos 2 y 4) se degrada con gracia si Gemini falla o si faltan datos: el
motor sigue funcionando con la lógica actual (heurística de texto) para lo que la IA no pudo
evaluar. Nunca se bloquea el flujo completo por un fallo de IA.

## Cambios de UI

### Se elimina de "Documentación comprobatoria del año anterior"

Todo el sub-panel `🧠 Perfil de actividad de la empresa` (líneas ~1202–1289 de `index.html`):
el `<h4>`, el badge, el tip, el botón `btnExtraerActividad`, el hint de pasos, y el bloque
`activity_spec_card` con sus textareas y chips. Se queda igual la carga del informe del año
anterior (`cargarInformeAnterior`), porque ese archivo también alimenta continuidad de
comparables y estructura del informe.

### Se agrega en "Comparables", antes del Motor

Un bloque compacto, de una sola línea de estado — **nada editable por defecto**:

- **Pendiente** (sin informe del año anterior cargado): *"Suba el informe del año anterior
  (tarjeta de arriba) para que el sistema detecte automáticamente la actividad de la empresa."*
- **Procesando**: *"⏳ Detectando la actividad de la empresa…"*
- **Listo**: *"Actividad detectada: «{frase}»"* + icono **✏️** (abre edición de una sola línea
  de texto; al guardar, vuelve a modo lectura y — si ya hay Excel importado — relanza la
  curación de candidatas en segundo plano con la frase corregida).
- **Error**: *"⚠ No se pudo detectar la actividad automáticamente."* + botón **"↻ Reintentar
  análisis"**.

No hay chips de keywords, no hay campo de SIC, no hay textarea de perfil funcional visibles en
este panel. Ver "Modelo de datos" para qué pasa con esos datos por debajo.

### Estado de la curación, junto al Motor

Una línea de estado (similar a `mo_info`) debajo del bloque de filtros del motor:

- *"🤖 IA curando candidatas… (X de Y evaluadas)"* mientras corre.
- *"✓ N de Y candidatas coinciden con la actividad"* al terminar.
- *"⚠ IA no pudo evaluar M candidatas (error); se aplican los filtros habituales sin
  descartarlas por actividad"* si algún lote falla.

## Modelo de datos

`actividad_json` conserva la misma forma de objeto que ya viaja con el estudio (para no romper
todo lo que ya lo consume — ver más abajo), pero cambia lo que contiene y cómo se llena:

```json
{
  "resumen": "frase precisa de la actividad real (idéntica a keywords[0])",
  "perfil": "perfil funcional FAR (se sigue generando, ya NO se muestra en este panel)",
  "productos": [],
  "keywords": ["frase precisa de la actividad real"],
  "sic": [],
  "justificacion": "explicación breve de la IA",
  "fuente": "nombre del archivo del año anterior",
  "fecha": "ISO timestamp",
  "estado": "procesando" | "listo" | "error"
}
```

**Decisión explícita (revísala si no es lo que quieres):** `resumen`, `perfil`, `productos` y
`sic` no desaparecen del modelo interno porque el informe generado, el Anexo C (matriz de
rechazo), el checklist de comparabilidad y el texto de continuidad con el año anterior ya leen
esos campos en más de diez puntos distintos del archivo (`buildClaudeContext`,
`ptExtraerComparablesEstudioAnteriorWithGemini`, el Anexo B/D, `ptComparablesContinuidad`, el
motor de sugerencia de nicho en la matriz de rechazo). Reescribir todos esos consumidores está
fuera del alcance de este cambio. Lo que sí cambia:

- **`sic` siempre queda `[]`**: el nuevo prompt de extracción ya no pide códigos SIC. Todo el
  código que lee `act.sic` sigue funcionando (arrays vacíos son un caso ya contemplado en cada
  sitio), simplemente ya no aporta nada — que es justo lo que pediste ("sin el SIC").
- **`productos` siempre queda `[]`**: el nuevo prompt tampoco lo pide (mismo razonamiento).
- **`keywords` pasa de ser una lista editable por chips a un arreglo de un solo elemento**,
  igual a `resumen`: la frase precisa que la IA determinó (o que el usuario corrigió con el
  ✏️). Todo el código existente que hace `act.keywords.join(', ')` o revisa
  `act.keywords.length` sigue funcionando sin cambios.
- **`perfil` se sigue extrayendo y usando para el informe** (contexto FAR para Claude, Anexo
  B), pero deja de tener un campo propio visible/editable en la tarjeta Comparables.

## Cambios de comportamiento (funciones existentes)

### `extractPriorActivityWithGemini()` — se auto-invoca, ya no depende del botón

- Se llama automáticamente desde `cargarInformeAnterior()` (las tres ramas: `.json`, `.pdf`,
  texto plano) justo después de fijar `window.PT_ANTERIOR`, sin esperar clic del usuario.
- Ya no manipula `$('btnExtraerActividad')` (el elemento desaparece del DOM). En su lugar,
  actualiza el nuevo bloque de estado de la tarjeta Comparables (`estado`: procesando/listo/
  error) a través de una función de render simplificada.
- El prompt a Gemini se simplifica: sigue pidiendo `actividad_especifica_corta` (la frase
  precisa) y `perfil_funcional_far` (para el informe) y `justificacion_perfil`, pero deja de
  pedir `codigos_sic_sugeridos`, `productos_servicios_clave` y una lista de keywords separada
  — la única keyword de búsqueda ES `actividad_especifica_corta`.
- Sigue siendo invocable manualmente por el botón **"↻ Reintentar análisis"** (visible solo en
  estado de error) y por el ✏️ tras editar manualmente (que no vuelve a llamar a Gemini, solo
  guarda la corrección del usuario).

### `importCompsFile()` / `smartMapRows()` — dispara la curación al terminar

Dentro del callback `done(list)` de `importCompsFile` (línea ~2073), después de insertar las
filas en `#cbody` y llamar a `calc()`, se invoca la nueva función `curarCandidatosConIA(list)`
en segundo plano (no bloquea la importación ni la UI).

### `curarCandidatosConIA(list)` — nueva función

1. Si no hay actividad lista (`estado !== 'listo'`), espera a que termine el análisis en curso
   (o no hace nada si nunca se cargó informe del año anterior — el motor sigue funcionando con
   la heurística de siempre).
2. Filtra de `list` las filas con **ID IQ y Business Description no vacíos** (las que Capital
   IQ trae completas). Las demás no entran a este paso.
3. Agrupa esas filas en **lotes de ~60 candidatas** y llama `/api/gemini` (mismo endpoint que
   ya usan `extractPriorActivityWithGemini` y `ptExtraerComparablesEstudioAnteriorWithGemini`)
   con **concurrencia máxima de 3 lotes simultáneos**.
4. Prompt por lote: la frase de actividad detectada + lista `{id, name, desc (recortada a ~300
   caracteres), country}`. Respuesta esperada: JSON
   `[{"id":"...", "coincide": true|false, "motivo":"..."}]`.
5. Agrega los resultados en `window.AI_MATCH_COMPS = { porId: {...}, fecha, actividadUsada,
   fuenteExcel }` y actualiza la línea de estado junto al Motor.
6. Si un lote falla (red/cuota/JSON inválido), esas candidatas simplemente no quedan en
   `porId` — no se excluyen, quedan igual que cualquier fila no evaluada por IA (ver
   siguiente sección) — y se informa el conteo de fallos en el estado.
7. `AI_MATCH_COMPS` viaja con el estudio (se añade a `readForm()`/`writeForm()`, igual que
   `MOTOR` o `PT_EEFF_IA`), para sobrevivir a guardar/recargar sin tener que re-importar el
   Excel.

### `moScore()` / `moActMatch()` — integración con la curación

- Si `AI_MATCH_COMPS.porId[o.id]` existe y `coincide === false` → **exclusión dura**, mismo
  patrón que ya usa `moScore` para holding o saldo negativo:
  `"Rechazada por IA: la descripción de negocio no coincide con la actividad (<motivo>)"`.
- Si existe y `coincide === true` → el factor de especialidad (`fK`) se fija en `1` en vez de
  recalcularse por conteo de palabras clave (la IA ya validó la coincidencia real).
- Si el ID **no aparece** en `AI_MATCH_COMPS` (fila agregada a mano, sin descripción, Excel no
  importado, lote que falló, o candidata sin ID/Descripción) → se comporta **exactamente como
  hoy**: pasa por la heurística de texto existente en `moActMatch`, usando `act.keywords[0]`
  (la única frase) en vez de una lista de varias keywords — sin cambio de comportamiento para
  quien no tenga la curación disponible.
- Filas con ID IQ pero **sin** Business Description (Excel incompleto) no entran al lote de
  Gemini; en el embudo de depuración se marcan con un motivo propio: *"Sin descripción de
  negocio de Capital IQ para verificar la actividad"* (distinto de "no coincide", para que el
  Anexo C sea auditable y no confunda ambos casos).

### `buildClaudeContext()` — sin cambios de comportamiento

Sigue leyendo `act.resumen` y `act.perfil` tal cual (ambos siguen poblados; `resumen` ahora es
la única frase precisa). El contexto que recibe Claude para redactar no cambia de calidad.

## Manejo de errores

| Fallo | Comportamiento |
|---|---|
| Gemini falla al detectar la actividad (paso 2) | Estado `error`, botón "↻ Reintentar análisis" visible; motor sigue operable sin actividad cargada (como hoy sin perfil). |
| Gemini falla en un lote de curación (paso 4) | Esas candidatas no exclusas por IA; el motor las trata con la heurística existente; se informa el conteo de fallos. |
| Usuario edita manualmente la frase de actividad | Se guarda, se relanza la curación en segundo plano si ya hay Excel importado; no requiere confirmación adicional. |
| Se importa un Excel nuevo | `AI_MATCH_COMPS` se sobrescribe por completo; se relanza la curación desde cero. |
| Estudio guardado antes de este cambio (formato antiguo con múltiples keywords/SIC) | `getActividadEspecifica()` sigue leyendo el objeto tal cual; si falta `estado`, se asume `listo` cuando `resumen` no está vacío. Compatible sin migración. |

## Fuera de alcance

- No se toca el backend (`/api/gemini` se reutiliza tal cual, mismo timeout de 180s).
- No se modifica el flujo de Superintendencia de Sociedades (`ingestSuperFile`/`integrarSuper`)
  ni el de extracción de comparables directamente del estudio anterior
  (`ptExtraerComparablesEstudioAnteriorWithGemini`).
- No se cambia la redacción del informe más allá de que ahora `resumen`/`perfil` provienen de
  un prompt más corto (mismo contenido, menos campos superfluos).

## Verificación

- Cargar un informe del año anterior (PDF/JSON/TXT) y confirmar que la actividad se detecta
  sola, sin pulsar nada, y que el estado pasa pendiente → procesando → listo.
- Editar la frase con el ✏️, confirmar que se guarda y (si ya hay Excel importado) se relanza
  la curación.
- Importar `END GAME 2025.xls` (u otro Excel de Capital IQ con Business Description) y
  confirmar que la curación corre en lotes, se ve el progreso, y termina con un conteo
  coherente de coincidencias.
- Ejecutar el motor y confirmar en el embudo de depuración que aparecen las nuevas categorías
  de rechazo ("Rechazada por IA…", "Sin descripción de negocio…") junto a las existentes.
- Forzar un error de red hacia `/api/gemini` durante la curación y confirmar que el motor
  sigue funcionando con la heurística de texto para las candidatas no evaluadas, sin bloquear
  "Ejecutar selección".
- Guardar el estudio, recargar la página, y confirmar que `AI_MATCH_COMPS` y la actividad
  detectada persisten sin tener que re-importar el Excel.
