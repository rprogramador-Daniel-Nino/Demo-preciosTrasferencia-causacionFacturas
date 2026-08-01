# Continuidad de comparables en el gestor: no perder por cupo ni curación IA las que ya venían del año anterior

## Contexto

El gestor de reportes (`frontend/`) ya reconoce comparables "de continuidad": `scoreCandidates()`
en `frontend/src/services/comparablesEngine.js` (línea 314, 343) marca `esContinuidad = true`
cuando el nombre normalizado (`nameKey`) de una candidata del universo de Capital IQ recién
importado coincide con un nombre del estudio del año anterior (`estudioAnteriorInfo.comparables`,
extraído por `parsePriorStudyFile()` en `frontend/src/services/priorStudyParser.js` — que solo
produce `{ name }`, nunca un ID de Capital IQ, porque la fuente es un documento del año pasado
subido por el analista, no el historial propio de la app).

Hoy esa marca solo produce dos efectos (líneas 343-404):
- Exime del rechazo por curación IA cuando `ia.coincide === false` (línea 355, ya guardado con
  `&& !esContinuidad`).
- Suma un bono de +0.08 al puntaje (línea 404).

Pero sigue sujeta a lo mismo que cualquier otra candidata para lo demás:
- Los tres filtros duros (holding, saldo negativo, pérdida operativa — líneas 332-341) la pueden
  descartar igual que a cualquiera.
- El rechazo por "sin descripción del negocio para verificar la actividad" (líneas 352-354) no
  está guardado con `!esContinuidad` y puede descartarla igual.
- Compite por los cupos de `nTarget` igual que las demás (`seleccionadas = validas.slice(0,
  nTarget)`, línea 431): si su puntaje no alcanza el TOP-N, no aparece en el resultado final
  aunque haya "pasado" los filtros.

Además, la tabla de comparables seleccionados en `frontend/src/components/MotorComparables.jsx`
(línea 942) no muestra el ID de Capital IQ de cada fila, aunque el dato ya existe en cada objeto
(`id`, definido en `comparablesEngine.js` líneas 62/170, propagado por el spread `...cand` en la
línea 417) — ni indica visualmente cuáles filas son de continuidad.

Existe un spec previo del mismo día (`2026-07-31-continuidad-automatica-comparables-design.md`)
para el mismo problema en `index.html` (la app monolítica). **Este spec es independiente y no lo
reemplaza ni lo toca**: por decisión explícita del usuario (2026-07-31), `index.html` (raíz) no
recibe desarrollo nuevo — todo el trabajo activo, incluido este, va en `frontend/`. Nótese además
una diferencia deliberada frente a ese spec anterior: allí se decidió explícitamente **no**
garantizar cupo incondicional en el TOP-N para las candidatas de continuidad; aquí sí se decide
garantizarlo (ver Objetivo, punto 3) — es una decisión distinta para este mismo tipo de
candidatas, tomada a propósito para el gestor.

## Objetivo

1. Una candidata de continuidad (`esContinuidad === true`) que sea holding, tenga saldo negativo
   o pérdida operativa (según la configuración vigente de esos tres filtros) se sigue excluyendo
   igual que cualquier otra candidata — estas tres reglas no dependen de si fue comparable el año
   pasado, sino de su situación actual.
2. Una candidata de continuidad que pase esos tres filtros ya no puede quedar fuera del resultado
   final por curación IA, por falta de descripción del negocio, ni por no alcanzar el TOP-N de
   puntaje.
3. El cupo `nTarget` sigue limitando únicamente a las candidatas que **no** son de continuidad:
   estas se agregan siempre al resultado, además de las `nTarget` mejores puntuadas del resto —
   sin tope, aunque eso haga que el total final supere `nTarget`.
4. La tabla de comparables seleccionados en `MotorComparables.jsx` muestra el ID de Capital IQ de
   cada fila y marca visualmente cuáles son de continuidad.

## Cambios por archivo

### A. `frontend/src/services/comparablesEngine.js` — `scoreCandidates()`

**Ampliar el guardado `!esContinuidad`** (línea 352-354) al rechazo por falta de descripción, para
que quede simétrico con el de curación IA (línea 355):

```js
// Antes (línea 352-354):
if (!descartada && iaPorId && idIQ && !String(cand.desc || '').trim()) {
  descartada = true;
  motivoRechazo = `Sin descripción del negocio para verificar la actividad (ID ${idIQ}).`;
}
// Después:
if (!descartada && iaPorId && idIQ && !String(cand.desc || '').trim() && !esContinuidad) {
  descartada = true;
  motivoRechazo = `Sin descripción del negocio para verificar la actividad (ID ${idIQ}).`;
}
```

No se toca nada de los filtros duros (líneas 332-341): siguen aplicando a todas las candidatas
por igual, continuidad incluida.

**Separar el cupo de continuidad del cupo de `nTarget`** (líneas 428-431):

```js
// Antes:
const validas = evaluated.filter(c => !c.descartada).sort((a, b) => b.score - a.score);
const rechazadas = evaluated.filter(c => c.descartada);

const seleccionadas = validas.slice(0, nTarget);

// Después:
const validas = evaluated.filter(c => !c.descartada).sort((a, b) => b.score - a.score);
const rechazadas = evaluated.filter(c => c.descartada);

const continuidadIncluidas = validas.filter(c => c.esContinuidad);
const otrasValidas = validas.filter(c => !c.esContinuidad);

const seleccionadas = [...continuidadIncluidas, ...otrasValidas.slice(0, nTarget)];
```

Y el `reserva` del `return` (línea 440) pasa de `validas.slice(nTarget)` a
`otrasValidas.slice(nTarget)` — las de continuidad nunca quedan en reserva, porque ya están
garantizadas dentro de `seleccionadas`. `totalValidas` (línea 437) no cambia: sigue siendo
`validas.length`, el total de candidatas que pasaron los filtros duros (continuidad y no
continuidad juntas), que es lo que ya consume el panel de embudo en `MotorComparables.jsx`.

No se toca el bono de puntaje (+0.08, línea 404) ni la razón textual "continuidad con el año
anterior" (línea 413): siguen calculándose igual, ahora solo con efecto informativo/de orden
dentro de `continuidadIncluidas`, ya no para competir por el TOP-N.

### B. `frontend/src/components/MotorComparables.jsx` — tabla de comparables seleccionados

Sin cambios en la llamada a `scoreCandidates()` (línea 237) ni en el resto del flujo: el efecto
aparece solo porque el motor ahora incluye más filas.

En la tabla (línea 942 en adelante):
- Nuevo `<th>` "ID IQ" en el `<thead>`, junto a "Razón Social" (tras la línea 945).
- Nueva `<td>{row.id}</td>` en cada fila del `<tbody>`, junto a la celda de nombre (tras la
  celda que empieza en la línea 967).
- Insignia visual junto al nombre cuando `row.esContinuidad` sea `true` (el campo ya viene en el
  objeto desde `scoreCandidates`, hoy no se renderiza en ningún lado del gestor): un `<span>`
  pequeño con texto "Continuidad", mismo estilo de badge que ya usa el resto del componente
  (colores del tema, ver otros badges existentes en el archivo para mantener consistencia).

## Modelo de datos

Sin campos nuevos. `esContinuidad` y `id` ya existen en cada objeto candidata; este cambio solo
altera *cuándo* `esContinuidad` garantiza inclusión y *qué tan visible* es `id` en la UI.

## Manejo de errores

| Caso | Comportamiento |
|---|---|
| Candidata de continuidad es holding, tiene saldo negativo o pérdida operativa (según config) | Se excluye igual que cualquier otra candidata — cae en `rechazadas` con el mismo `motivoRechazo` de hoy. |
| Candidata de continuidad sin descripción del negocio, o con veredicto IA `coincide === false` | Ya no se descarta por esas razones — queda en `seleccionadas` vía `continuidadIncluidas`. |
| Candidata de continuidad con puntaje bajo (fuera del TOP-N por score) | Igual entra en `seleccionadas`: no compite por `nTarget`, se agrega aparte. |
| No hay estudio anterior cargado (`estudioAnteriorInfo` es `null`) | `priorComps` queda `[]`, `esContinuidad` es `false` para todas, comportamiento idéntico al actual. |
| El nombre del estudio anterior no calza (tras normalizar con `nameKey`) con ninguna candidata del universo | Esa comparable del año anterior simplemente no aparece — no hay candidata a la que adjuntarle datos; no se informa nada nuevo (fuera de alcance, ver abajo). |
| El total de `seleccionadas` supera `nTarget` por incluir varias de continuidad | Es el comportamiento esperado (objetivo 3), no un error; el panel de embudo (`selectionFunnel.seleccionadas`) simplemente refleja el conteo real. |

## Fuera de alcance

- No se busca reemplazo por afinidad (SIC/descripción) cuando una comparable del año anterior no
  aparece en el universo actual — no hay "propuestas" ni mensaje de "perdidas" como en
  `index.html`. Si no se encuentra por nombre, simplemente no hay nada que adjuntar.
- No se dispara nada automáticamente al importar el Excel: el cruce ocurre como parte de
  `runEngineSelection()` (botón "Ejecutar selección"), igual que hoy.
- No se toca `index.html` (raíz) en absoluto — decisión del usuario, ver Contexto.
- No se agrega cruce por ID de Capital IQ del lado del estudio anterior: esa fuente nunca trae ID
  (ver Contexto), así que el único cruce posible y el que cubre este spec es por nombre
  normalizado.
- No se cambia `priorStudyParser.js` ni la extracción de nombres del documento anterior.

## Verificación

- Con un estudio anterior cargado que incluya un nombre presente en el universo importado, y
  configurando esa candidata para que tenga pérdida operativa con "Pérdida operativa: excluir":
  confirmar que queda en `rechazadas`, no en `seleccionadas`.
- Con la misma candidata pero sin pérdida/holding/saldo negativo, y con un veredicto de curación
  IA `coincide: false`: confirmar que aparece en `seleccionadas` (dentro de `continuidadIncluidas`).
- Con `nTarget` bajo (p. ej. 3) y más de 3 candidatas de continuidad que pasan los filtros duros:
  confirmar que las 3 (o más) de continuidad aparecen todas en `seleccionadas`, además de hasta 3
  candidatas normales por score — el total puede superar `nTarget`.
- Confirmar en la tabla de `MotorComparables.jsx` que cada fila muestra su `id` de Capital IQ y
  que las filas de continuidad muestran la insignia.
- Sin estudio anterior cargado: confirmar que el comportamiento es idéntico al actual (ninguna
  candidata como continuidad, cupo se comporta como hoy).
