# Anexo B dinámico: Descripciones de comparables y Estados Financieros

**Fecha:** 2026-08-04
**Estado:** Aprobado, pendiente de plan de implementación

## Problema

El Informe Local generado en Word (`frontend/`, `masterTemplate.js` + `exactTemplateMapper.js`)
trae en la sección **ANEXO B. Descripciones de comparables y Estados Financieros** el bloque
estático del informe de referencia "End Game": cuatro compañías de videojuegos (Akatsuki Inc.,
Colopl Inc., Fun Yours Technology Co., IGG Inc.), cada una con su descripción de actividad y
dos tablas de cifras (P&L y balance). Ningún código en `exactTemplateMapper.js` toca ese bloque
— a diferencia del ANEXO A (`generarAnexoAHtml`), que ya se sustituye dinámicamente.

El motor de comparables (`frontend/src/components/MotorComparables.jsx`) ya:
- Importa el universo de Capital IQ (`comparablesEngine.js`, `importCapitalIQExcel`), que trae
  un campo `desc` (Business Description cruda, normalmente en inglés) por candidata.
- Selecciona comparables (`scoreCandidates` → `comparables`), y el campo `desc` sobrevive en la
  fila seleccionada porque `scoreCandidates` construye cada resultado con `{ ...cand, ... }`
  (`comparablesEngine.js:490-491`) — hoy ese dato no se usa en ningún lugar del informe.
- Ingesta EEFF de comparables ("Paso 4: Ingestar EEFF de Comparables") vía OCR de Gemini
  (`eeffParser.js`, `parseEEFFComparableOCR` / `parseEEFFComparablesLote`), pero
  `aplicarEeffEnFila` (`MotorComparables.jsx:423-442`) solo conserva `s, c, op, ar, inv, ap` +
  metadatos de verificación; descarta `utilidad_bruta`, `gastos_operacionales`, `total_activos`,
  `total_pasivos`, `patrimonio` que el mismo prompt ya pide, y el prompt no pide en absoluto
  `propiedad_planta_equipo` ni `efectivo_y_equivalentes`.

El objetivo de este cambio es que el Anexo B del Word final salga con las compañías realmente
seleccionadas en el motor para el estudio activo, con su descripción de actividad (redactada en
español) y sus cifras, en el mismo formato de tres tablas por compañía que ya trae la plantilla.

## Alcance

Dentro de esta entrega:
- Extender el Paso 4 (ingesta EEFF de comparables) para capturar y conservar todos los rubros
  necesarios para las tres tablas del Anexo B.
- Redacción automática en español de la descripción de actividad de cada comparable, a partir
  del `desc` crudo de Capital IQ, vía IA.
- Generación dinámica del bloque completo del Anexo B (las tres tablas por compañía) en el
  Word final, en reemplazo del bloque estático de End Game.

Fuera de alcance:
- Cálculo de promedios reales de balance (apertura+cierre)/2. Se usa el valor del único
  período que lee el OCR, igual que ya hace el resto del informe con las cifras del
  contribuyente (`t_act_tot`, `t_ppe`, etc. en `exactTemplateMapper.js:634-656`, etiquetadas
  "promedio" pero point-in-time).
- Cambios a `index.html` (raíz). Todo el trabajo es en `frontend/`.

## Parte A — Paso 4 y la fila de cada comparable

### A.1 Extender los prompts de `eeffParser.js`

`EEFF_COMPARABLE_PROMPT` (línea 62) y `EEFF_COMPARABLES_LOTE_PROMPT` (línea 184) agregan al
JSON que ya devuelven:
- `propiedad_planta_equipo` (numérico o `null`)
- `efectivo_y_equivalentes` (numérico o `null`)
- `gastos_investigacion_desarrollo` (numérico o `null` — instrucción explícita: `null` si la
  comparable no desglosa este gasto por separado, no estimarlo restando de gastos operativos)
- `gastos_publicidad` (numérico o `null`, misma regla)

Los campos que el prompt ya pide y hoy se descartan (`utilidad_bruta`, `gastos_operacionales`,
`total_activos`, `total_pasivos`, `patrimonio`) se mantienen sin cambio en el prompt.

### A.2 Conservar el JSON completo en la fila

`aplicarEeffEnFila` (`MotorComparables.jsx:423-442`) agrega un campo nuevo a la fila:

```js
eeffDatos: datos   // el objeto completo que devuelve la IA (línea 66 en adelante de eeffParser.js)
```

No se tocan los escalares existentes (`s, c, op, ar, inv, ap`) ni el resto de metadatos
(`eeffVerificado`, `eeffHallazgos`, `eeffArchivo`, `eeffCruce`, `eeffPorConfirmar`) — otras
partes del motor (`analizarRango`, `moScore`) dependen de esos nombres y no deben cambiar.

### A.3 "Promedio" en las etiquetas de balance

Se usa el valor del único período leído bajo las etiquetas "Activos totales promedio", "EPP
neto promedio", "Efectivo promedio y equivalentes de efectivo" — sin promediar dos años. Mismo
criterio que ya aplica el informe a las cifras del contribuyente.

## Parte B — Redacción de la descripción de actividad con IA

### B.1 Servicio nuevo `frontend/src/services/descripcionComparables.js`

- `redactarDescripcionActividad(nombre, descCruda)`: llama a `/api/claude` (proxy que hace
  passthrough directo a `POST https://api.anthropic.com/v1/messages`, confirmado en
  `server.js:95-116`) con `model: 'claude-haiku-4-5'` (redacción liviana, según el reparto de
  modelos por costo del CLAUDE.md) y `messages: [{ role: 'user', content: prompt }]`. El prompt
  pide un párrafo en español (~80-120 palabras) que traduzca/redacte la descripción de negocio
  cruda de Capital IQ (normalmente en inglés), en el estilo del ejemplo de Akatsuki Inc.: nombre
  de la compañía + qué hace, productos/marcas relevantes, año de constitución y sede si el texto
  crudo los trae.
- Reintento en HTTP 429 con backoff lineal, mismo patrón que `postGeminiWithRetry`
  (`eeffParser.js:87-103`).
- `redactarDescripcionesEnLote(filas, indices)`: aplica `redactarDescripcionActividad` sobre
  varias filas usando el pool de concurrencia `conConcurrencia` ya definido en
  `comparablesEngine.js:603-614` (mismo mecanismo que usa `curateCandidatesWithGemini` para la
  curación por IA), para no disparar N llamadas simultáneas sin control.

### B.2 Disparo automático e idempotencia

Cada vez que `aplicarEeffEnFila` aplica un EEFF a una fila (independientemente de si queda
`eeffVerificado`), si la fila tiene `desc` no vacío y no tiene aún `descActividad`, se dispara
`redactarDescripcionActividad` y el resultado se guarda como campo nuevo `descActividad` en la
fila. Si `descActividad` ya existe, no se repite la llamada.

### B.3 Backfill para estudios existentes

En el panel del Paso 4 de `MotorComparables.jsx` se agrega una acción "Redactar descripciones
pendientes" que recorre las filas con `eeffVerificado === true` y `desc` no vacío pero sin
`descActividad`, y las completa en lote con `redactarDescripcionesEnLote`. Cubre estudios
guardados antes de este cambio.

### B.4 Fallback sin descripción

Si al momento de generar el Word no hay `descActividad` ni `desc` (p. ej. comparable agregada a
mano sin pasar por el universo IQ, ver `MotorComparables.jsx:643`), la tabla 1 de esa compañía
muestra el texto fijo "Descripción de actividad no disponible."

## Parte C — Generación del Anexo B en el Word

Todo en `frontend/src/services/exactTemplateMapper.js`.

### C.1 Estructura exacta a replicar

Confirmado leyendo `masterTemplate.js` directamente (offsets ~110871 a ~141827): el bloque
estático de ANEXO B es

```
<h1><a id="_Toc208931006"></a>ANEXO B. Descripciones de comparables y Estados Financieros</h1>
<table>...</table>   <!-- Tabla 1: NOMBRE DE LA COMPAÑÍA COMPARABLE / DESCRIPCIÓN ACTIVIDAD -->
<table>...</table>   <!-- Tabla 2: Descripción / <año> — P&L -->
<table>...</table>   <!-- Tabla 3: Descripción / <año> — balance -->
<table>...</table>   <!-- Tabla 1 de la siguiente compañía -->
...
<h1><a id="_Toc208931007"></a>ANEXO C. Matriz de Rechazo</h1>
```

Tres `<table>` por compañía, sin separador entre compañías, repetidos tantas veces como
compañías haya. `_Toc208931007` (ANEXO C) es el ancla de cierre.

### C.2 `generarAnexoBHtml(study, wrap)`

- Fuente de comparables: `study.comparables.filter(c => c.name && c.eeffVerificado)` — **no**
  `filasComparablesInforme`/`analizarRango` (esas filas están renombradas a `nombre`/`amb` y no
  traen `desc`, `eeffDatos` ni `descActividad`).
- Solo entran al Anexo B las comparables con `eeffVerificado === true`. Las seleccionadas sin
  EEFF cargado o sin verificar no aparecen (decisión confirmada con el usuario).
- Por cada comparable, genera las tres tablas:
  - **Tabla 1**: nombre en `<strong>` + `descActividad || desc || 'Descripción de actividad no disponible.'`
  - **Tabla 2 (P&L)**: Ventas netas (`s`), Costo de los bienes vendidos (`c`), Beneficio bruto
    (`eeffDatos.utilidad_bruta`), Gastos operativos (`eeffDatos.gastos_operacionales`), Utilidad
    de operación (`op`). Si `eeffDatos.gastos_investigacion_desarrollo` no es `null`, se añade la
    fila "Gastos de investigación y desarrollo"; si `eeffDatos.gastos_publicidad` no es `null`,
    se añade "Gastos de publicidad". Ninguna de las dos es obligatoria (ver ejemplos: Akatsuki
    no trae ninguna, Colopl solo publicidad, Fun Yours solo I+D, IGG ambas).
  - **Tabla 3 (Balance)**: Activos totales promedio (`eeffDatos.total_activos`), Promedio de
    cuentas por pagar netas (`ap`), Promedio de cuentas por cobrar netas (`ar`), EPP neto
    promedio (`eeffDatos.propiedad_planta_equipo`), Inventario neto promedio (`inv`), Efectivo
    promedio y equivalentes de efectivo (`eeffDatos.efectivo_y_equivalentes`).
- Encabezado de columna de las tablas 2 y 3: `eeffDatos.periodo` si vino del OCR; si no, el año
  del estudio (`study.anio`).
- Formato numérico: mismo helper `fmt` que usa el resto del documento (miles con separador).
- **Valor faltante → celda vacía**, no `—` y no `0`. Esta es una decisión específica del Anexo
  B, distinta del criterio "hueco visible con `—`" que usa el resto del informe (`wrap`/`cifra`
  en `exactTemplateMapper.js:479-490`): aquí el usuario pidió explícitamente celda en blanco.
  El resto del documento no cambia.

### C.3 `reemplazarAnexoB(html, study, wrap)`

- Ancla de inicio: `id="_Toc208931006"` (heading de ANEXO B). Ancla de fin: `id="_Toc208931007"`
  (heading de ANEXO C) — se reemplaza todo lo que hay entre el `<h1>` de ANEXO B (inclusive, para
  conservar el título) y el `<h1>` de ANEXO C (exclusive).
- Si `generarAnexoBHtml` no produce ninguna compañía (ninguna comparable con
  `eeffVerificado === true`), **no** se deja el bloque estático de Akatsuki/Colopl/Fun
  Yours/IGG — eso sería peor que un hueco, es la cifra de otro caso. Se reemplaza por un único
  párrafo: *"Pendiente: cargue y verifique los Estados Financieros de las comparables en el
  Paso 4 del motor de comparables."*
- Se invoca desde `hydrateExactWordTemplate`, junto al reemplazo de ANEXO A (línea ~660).

## Riesgos / notas

- El costo de IA de la Parte B es proporcional al número de comparables seleccionadas por
  estudio (una llamada a Haiku por compañía, una sola vez gracias a la idempotencia). Con
  estudios de 8-15 comparables es un costo marginal.
- Los prompts de EEFF de comparables solo existen en `frontend/src/services/eeffParser.js` (no
  hay un duplicado server-side de este prompt específico como sí ocurre con RUT/Cámara de
  Comercio), así que no hace falta sincronizar `server.js`/`functions/index.js`/PHP para la
  Parte A.
