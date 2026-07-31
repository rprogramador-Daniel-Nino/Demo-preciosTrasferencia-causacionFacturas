# Continuidad automática de comparables: reconocer la tabla del estudio anterior y no perder candidatas EMPRESARIO por Rigor Funcional

## Contexto

Hoy, al cargar el estudio del año anterior y luego el Excel de Capital IQ (universo de
búsqueda), el motor de selección (`motorEjecutar()`/`moScore()`) rara vez vuelve a proponer las
comparables que ya se usaron el año pasado, aunque sigan existiendo en el universo de este año.
Esto ocurre por tres mecanismos independientes que hoy no se comunican entre sí:

1. **`ptComparablesDelTexto(texto)`** (línea ~7722) extrae nombres de comparables del texto del
   informe anterior con una regex genérica de "línea que termina en sufijo corporativo" (S.A.S.,
   Inc., Ltd., Group, Studios…). No reconoce la tabla específica **"Tabla N. Muestra Compañías
   comparables"** (o su variante sin numerar, "COMPAÑÍAS COMPARABLES") que aparece en todos los
   estudios anteriores con el mismo patrón: número, nombre de la compañía, y una tercera columna
   (Ámbito o Filtro) que se ignora.
2. **`ptComparablesContinuidad()`** (línea 7303) sí sabe cruzar `PT_ANTERIOR.comparables` contra
   `CIQ_UNIVERSO` por nombre normalizado (`nameKey`), pero solo se ejecuta si el analista pulsa a
   mano el botón morado **"Continuidad de comparables…"** (línea 7511), y aunque encuentre
   coincidencias, insertarlas en la tabla (`ptAplicarMantenidas`, línea 7410) no las protege de
   nada: si luego se corre el motor, `moScore()` puede volver a descartarlas.
3. **`moScore()`** (línea 3644) descarta **de forma incondicional** cualquier candidata con
   perfil `EMPRESARIO` (línea 3652: *"Empresario pleno... funciones/activos/riesgos
   incomparables"*), sin importar el control "Rigor funcional" (`mo_act`, Estándar/Estricto/
   Amplio) ni si la candidata viene del año anterior. `moPerfil()` (línea 3570) clasifica como
   `EMPRESARIO` a cualquier empresa cuya Business Description mencione que es dueña de su propio
   producto/IP y lo monetiza/licencia (`publish`, `its own IP/games/products`, `licenses its`,
   `proprietary`…). Cuando el análisis de precios de transferencia corresponde a una operación
   de licenciamiento/regalías (p. ej. videojuegos), las comparables correctas son precisamente
   empresas de ese perfil — y hoy se excluyen siempre, sin excepción.

El resultado observado: al cargar `estudio pasado.pdf` y el universo IQ, el motor propone 16
códigos IQ sin relación con el oficio de la empresa, mientras que las comparables reales del año
anterior (AKATSUKI INC., COLOPL INC., IGG INC., PLAYSTUDIOS INC., QUBICGAMES S.A., etc.,
listadas en la tabla "Muestra Compañías comparables" del estudio anterior) ni siquiera se
evalúan, aunque existan en `END GAME 2025.xls`.

## Objetivo

1. Reconocer automáticamente la tabla "Muestra Compañías comparables" del estudio anterior y
   extraer los nombres de compañía (ignorando la tercera columna, sea Ámbito o Filtro).
2. Cruzar esos nombres, sin intervención manual, contra el universo de Capital IQ ya importado
   (o el que se importe después) y, si aparecen, agregarlas como candidatas.
3. Que esas candidatas no vuelvan a perderse al correr el motor por culpa de la curación por IA,
   del Rigor Funcional, o del filtro estricto de coincidencia de actividad — sin dejar de aplicar
   las exclusiones legales/financieras (holding, independencia, saldos negativos), que no
   dependen de si la empresa fue comparable el año pasado.
4. Que el perfil `EMPRESARIO` deje de excluirse siempre: en Rigor Funcional "Amplio" se permite,
   salvo si el nombre indica que es una holding o un grupo/conglomerado (`Holding(s)`, `Grupo`,
   `Group`, `Groupe`, `Gruppo`), que se siguen excluyendo igual que hoy.
5. Reforzar el prompt que detecta la actividad específica (`extractPriorActivityWithGemini`) con
   los nombres y Business Description reales de esas comparables confirmadas, para que la
   curación por IA del resto del universo (`curarCandidatosConIA`) tenga mejor contexto.

## Flujo de extremo a extremo

```
1. Analista sube el informe del año anterior (PDF/DOCX/JSON) — sin cambio de UI
        │  cargarInformeAnterior() → ptProcesarTextoAnterior(texto, nombre)
        ▼
2. ptComparablesDelTexto(texto)           (sin cambios, sigue siendo el fallback genérico)
   ptTablaComparablesEstudioAnterior(texto)  (NUEVA — reconoce la tabla específica)
        │  se fusionan por nameKey en PT_ANTERIOR.comparables;
        │  la extracción de la tabla también queda aparte en PT_ANTERIOR.comparablesTabla
        ▼
3. Si CIQ_UNIVERSO ya tiene datos (Excel importado antes) → cruce automático inmediato.
   Si no, el cruce se dispara más tarde, al terminar de importar el Excel (paso 5).
        ▼
4. Analista importa el Excel de Capital IQ (Universo IQ) — sin cambio de UI
        │  importCompsFile → readExcelRows → smartMapRows → llena CIQ_UNIVERSO/COMP_META/DESCS
        ▼
5. Cruce automático (NUEVO, reemplaza la dependencia del botón manual):
   por cada nombre de PT_ANTERIOR.comparablesTabla, buscar por nameKey en CIQ_UNIVERSO.
   Encontrada → se inserta como fila en la tabla de comparables (si no está ya) y se marca
   en PT_CONTINUIDAD_TABLA_KEYS. No encontrada → se informa aparte (igual que "perdidas" hoy).
        ▼
6. Analista pulsa "Ejecutar selección" (motorEjecutar, sin cambios de botón)
        │  moRows() marca o.continuidadTabla = true para esas filas
        │  moScore(): las exime de rechazo por IA, por Rigor Funcional (perfil) y por el
        │  filtro estricto de actividad — pero NO de holding/independencia/saldos negativos.
        │  Además, para TODO el universo (no solo continuidad): perfil EMPRESARIO ya no se
        │  excluye siempre — solo en Rigor Funcional Estándar/Estricto, no en Amplio.
        ▼
7. Compiten por el TOP-N igual que cualquier otra candidata (con el bono de continuidad de
   +0.08 que ya existe). Ser candidata protegida no es lo mismo que garantizar un cupo: si el
   analista fija un TOP-N muy bajo, puede seguir sin entrar por puntaje — igual que hoy con
   o.previa. La inclusión incondicional (sin competir por puntaje) es un mecanismo aparte, ya
   existente para comparables locales de SuperSociedades (ptEsComparableLocal), y este cambio
   no lo extiende a estas candidatas.
```

Todo lo nuevo se degrada con gracia: si la tabla no se reconoce en el texto (formato de estudio
distinto, o versión muy antigua), `ptTablaComparablesEstudioAnterior` devuelve `[]` y el flujo
sigue exactamente como hoy (fallback a `ptComparablesDelTexto`). Si el Excel aún no se ha
importado cuando se sube el estudio anterior, el cruce simplemente espera a que se importe.

## Cambios de comportamiento (por función)

### A. `moScore()` (línea 3652) — Rigor Funcional deja de excluir EMPRESARIO de forma incondicional

Cambia de:
```js
if (o.perfil === 'EMPRESARIO') return { out: 'Empresario pleno (IP propia, riesgo de mercado): funciones/activos/riesgos incomparables (Art. 260-4 E.T.)' };
```
a:
```js
if (o.perfil === 'EMPRESARIO' && cfg.act !== 'amplio') return { out: 'Empresario pleno (IP propia, riesgo de mercado): funciones/activos/riesgos incomparables (Art. 260-4 E.T.)' };
```
Esto es un **cambio de comportamiento general**, no limitado a candidatas de continuidad: con
Rigor Funcional en "Amplio", cualquier candidata del universo con perfil EMPRESARIO deja de
excluirse por esa sola razón (sigue sujeta a las demás exclusiones y al puntaje). En "Estándar"
y "Estricto" el comportamiento no cambia.

### B. `moRows()` (línea 3598-3600) — detección de holding por nombre se amplía a grupo/conglomerado

La prueba de nombre pasa de:
```js
|| /\bholdings?\b/i.test(o.name || '');
```
a:
```js
|| /\b(holdings?|grupo|group|groupe|gruppo)\b/i.test(o.name || '');
```
Así, aunque el perfil EMPRESARIO ya no se excluya siempre en modo Amplio (cambio A), una
compañía cuyo nombre indique que es una holding o un grupo/conglomerado (`Holdings`, `Grupo`,
`Group`, `Groupe`, `Gruppo`) se sigue excluyendo por la vía existente del control "Tratamiento
holding" (`cfg.holding`, línea 3645) — sin importar el Rigor Funcional. No se toca la prueba
sobre la Business Description (línea 3598), que ya cubre "investment holding company"/"sociedad
de inversión" en inglés y español.

### C. `ptTablaComparablesEstudioAnterior(texto)` — nueva función

- Busca en el texto del informe anterior un encabezado que calce con el patrón recurrente:
  variantes de `"COMPAÑÍAS COMPARABLES"`, con o sin el prefijo `"Tabla N. Muestra"` delante
  (tolerante a acentos/mayúsculas, y a que "Tabla" y el número puedan faltar — el estudio más
  antiguo revisado no los tenía).
- A partir de ahí, recorre las líneas siguientes buscando filas numeradas
  (`número + nombre de compañía + tercera columna`), tolerando que `pdfjsLib` una todo en una
  sola línea separada por espacios (como hoy pasa con el texto plano extraído en
  `cargarInformeAnterior`, línea 7781: `tc.items.map(x => x.str).join(' ')`) o que el número y el
  nombre queden en líneas separadas.
- Se detiene al encontrar una línea que no calza con el patrón durante dos filas seguidas, o al
  llegar al pie de tabla (`"Fuente: ..."`, visto en el estudio de ejemplo).
- **Ignora por completo la tercera columna** (Ámbito/Filtro): no se usa para decidir si la
  compañía entra o no, tal como se acordó.
- Devuelve un arreglo `[{numero, name}, ...]`. Si no encuentra el encabezado, devuelve `[]` sin
  lanzar error — es un complemento de `ptComparablesDelTexto`, no un reemplazo.

### D. `ptProcesarTextoAnterior()` (línea 7795) — fusión de las dos extracciones

```js
var comps = ptComparablesDelTexto(texto);          // sin cambios
var tabla = ptTablaComparablesEstudioAnterior(texto); // nueva
```
`tabla` se guarda aparte en `PT_ANTERIOR.comparablesTabla` (para trazabilidad/depuración) y
además se fusiona dentro de `comparables` deduplicando por `nameKey` (si un nombre ya vino de la
regex genérica, no se duplica). Esto significa que **todo lo que ya consume
`PT_ANTERIOR.comparables`** (`moPrevias()`, `ptComparablesContinuidad()`, el bono de continuidad
en `moScore`) automáticamente ve también los nombres de la tabla, sin tocar esas funciones.

### E. Cruce automático contra el universo + inclusión protegida (nuevo)

Nueva función `ptCruceContinuidadTablaAuto()`, que reutiliza la misma lógica de indexado por
`nameKey` que ya usa `ptComparablesContinuidad()` (línea 7303) contra `CIQ_UNIVERSO`, pero:

- Se dispara sola, no por botón: al final de `ptProcesarTextoAnterior()` (si `CIQ_UNIVERSO` ya
  tiene datos) y al final de `smartMapRows()` — Bloque 2, línea ~7207 (si
  `PT_ANTERIOR.comparablesTabla` ya tiene datos) — cubre los dos órdenes posibles de carga.
- Para cada nombre de `PT_ANTERIOR.comparablesTabla` encontrado en `CIQ_UNIVERSO` (por
  `nameKey`) que no esté ya como fila en `#cbody`: lo inserta (mismo mecanismo de
  `ptAplicarMantenidas`, línea 7410 — arma la fila con los datos de `CIQ_UNIVERSO`/`COMP_META` y
  llama `calc()`).
- Registra el nombre en `window.PT_CONTINUIDAD_TABLA_KEYS` (mapa `nameKey → {name, id}`,
  persistido con el estudio igual que `AI_MATCH_COMPS`/`MOTOR`, para sobrevivir a guardar/
  recargar sin tener que re-importar el Excel ni re-subir el estudio anterior).
- Los nombres de la tabla que **no** aparecen en `CIQ_UNIVERSO` de este año se informan en un
  mensaje discreto junto a la tabla de comparables (mismo texto que ya usa `ptComparablesContinuidad`
  para "perdidas": *"No aparece en el universo de búsqueda del año corriente (posible fusión,
  deslistamiento o cambio de razón social). Verificar en la fuente antes de descartarla."*).
- El botón manual "Continuidad de comparables…" y `ptComparablesContinuidad()` **no se eliminan**
  ni cambian — siguen sirviendo para el cruce ampliado con scoring de brecha
  (`puntuar`/`ptPerfilNegocio`) contra el resto del universo, que este cambio no toca.

### F. `moRows()` / `moScore()` — nueva marca `o.continuidadTabla`

- `moRows()` (línea 3602, junto a `o.previa`): `o.continuidadTabla = !!PT_CONTINUIDAD_TABLA_KEYS[nameKey(o.name)];`
- `moScore()`: cuando `o.continuidadTabla === true`, se saltan (no se evalúan, se sigue de
  largo hacia el puntaje):
  - El rechazo de la curación por IA (línea 3663-3665, `aiRec.coincide === false`).
  - Las exclusiones de Rigor Funcional por perfil (líneas 3650-3652: estricto-solo-servicio,
    estándar-sin-indefinidos, y el EMPRESARIO del cambio A).
  - El filtro estricto de "sin coincidencia con la actividad específica" (línea 3671-3674).
- **No** se saltan (siguen aplicando siempre, sin excepción): holding/grupo (línea 3645),
  independencia >50% (línea 3648), saldos negativos (línea 3649). Una compañía que fue
  comparable el año pasado pero que hoy es una holding, tiene un accionista concentrado, o
  reporta saldos no verosímiles, se sigue excluyendo — esas exclusiones reflejan su situación
  *actual*, no su historial.
- El motivo (`raz`, línea 3692) incluye una nota adicional cuando aplica esta exención, p. ej.
  *"comparable confirmada en la tabla del estudio anterior"*, para que el embudo de depuración
  distinga este caso del bono de continuidad genérico (`o.previa`, que ya existía y sigue
  sumando su +0.08 igual que hoy).

### G. `extractPriorActivityWithGemini()` (línea 2224) — refuerzo del prompt con comparables confirmadas

Al construir el prompt, si `PT_ANTERIOR.comparablesTabla` tiene entradas y alguna ya fue
cruzada contra el universo (`PT_CONTINUIDAD_TABLA_KEYS`, con su `desc` disponible en
`COMP_META`), se agrega al final del prompt un bloque adicional, por ejemplo:

```
--- COMPARABLES CONFIRMADAS EN EL ESTUDIO ANTERIOR (con su Business Description real de Capital IQ) ---
AKATSUKI INC. — [Business Description real de COMP_META]
COLOPL, INC. — [Business Description real de COMP_META]
...
```

Esto no cambia la forma del JSON de respuesta (`actividad_especifica_corta`,
`perfil_funcional_far`, `justificacion_perfil`), solo le da a Gemini ejemplos reales y
verificados de qué tipo de empresa SÍ es comparable, para anclar mejor la frase que luego usa
`curarCandidatosConIA()` para evaluar al resto del universo. Si el cruce contra el universo
todavía no ocurrió (Excel no importado aún), el bloque simplemente se omite — no bloquea la
detección de actividad.

## Modelo de datos

```js
PT_ANTERIOR = {
  ...                       // sin cambios en los campos existentes
  comparables: [...],       // ahora incluye también, deduplicados, los nombres de la tabla
  comparablesTabla: [{numero, name}, ...]   // NUEVO — extracción cruda de la tabla, sin fusionar
}

window.PT_CONTINUIDAD_TABLA_KEYS = {
  "<nameKey>": { name: "AKATSUKI INC.", id: "IQ..." }   // NUEVO — persiste con el estudio
}
```

`o.continuidadTabla` es un campo calculado en memoria dentro de `moRows()` (como `o.previa`),
no se persiste directamente — se recalcula cada vez a partir de `PT_CONTINUIDAD_TABLA_KEYS`.

## Manejo de errores

| Caso | Comportamiento |
|---|---|
| El estudio anterior no tiene la tabla "Muestra Compañías comparables" (formato distinto/muy antiguo) | `ptTablaComparablesEstudioAnterior` devuelve `[]`; el flujo sigue igual que hoy vía `ptComparablesDelTexto`. |
| Nombre de la tabla no aparece en `CIQ_UNIVERSO` de este año | No se inserta fila; se informa junto a la tabla de comparables con el mismo motivo que ya usa "perdidas" en `ptComparablesContinuidad`. |
| El Excel se importa antes de subir el estudio anterior (orden invertido) | El cruce se dispara al terminar `ptProcesarTextoAnterior()`, que ya encuentra `CIQ_UNIVERSO` lleno. |
| Se re-importa el Excel o se vuelve a subir el estudio anterior | El cruce se recalcula desde cero; la inserción en `#cbody` es idempotente (no duplica si el nombre ya está como fila). |
| Candidata de la tabla SÍ está en el universo pero es holding/grupo, no independiente, o con saldos negativos | Se excluye igual que cualquier otra candidata — `o.continuidadTabla` no exime estas tres reglas. |
| Rigor Funcional en Amplio sin ninguna tabla de continuidad detectada | El cambio A igual aplica (es un cambio general del motor, no depende de la continuidad). |

## Fuera de alcance

- No se cambia `ptComparablesContinuidad()` ni su botón manual, ni el scoring de brecha
  (`puntuar`/`ptPerfilNegocio`) que usa contra el resto del universo cuando faltan comparables
  para llegar a `PT_CRITERIOS.minConjunto`.
- No se garantiza inclusión incondicional en el TOP-N final para las candidatas de continuidad
  (eso es un mecanismo distinto, ya existente para comparables locales de SuperSociedades vía
  `ptEsComparableLocal`/`PT_LOCALES_KEYS`, que este cambio no extiende).
- No se toca `curarCandidatosConIA()` en sí (los lotes/prompt por candidata), solo se le da más
  contexto al prompt de `extractPriorActivityWithGemini()` que la alimenta indirectamente.
- No se modifica el backend (`/api/gemini`, `/api/claude`) ni sus contratos.

## Verificación

- Cargar `estudio pasado.pdf` (con la tabla "Muestra Compañías comparables") y confirmar en
  consola/estado que `PT_ANTERIOR.comparablesTabla` trae los 13 nombres, ignorando la columna
  de Ámbito/Filtro.
- Importar `END GAME 2025.xls` después y confirmar que las compañías de esa tabla que existen en
  el universo (p. ej. AKATSUKI INC., COLOPL INC.) aparecen solas en la tabla de comparables, sin
  pulsar el botón manual de continuidad.
- Invertir el orden (importar el Excel primero, subir el estudio anterior después) y confirmar
  que el cruce igual ocurre.
- Ejecutar el motor con Rigor Funcional en "Amplio" y confirmar en el embudo de depuración que
  ya no aparece el motivo "Empresario pleno..." para esas candidatas, y que si alguna se llama
  p. ej. "XYZ Group" o "XYZ Holdings" sigue excluida por el motivo de holding.
- Ejecutar el motor con Rigor Funcional en "Estándar"/"Estricto" y confirmar que el perfil
  EMPRESARIO se sigue excluyendo igual que hoy (sin cambio de comportamiento en esos modos, salvo
  para las candidatas con `o.continuidadTabla`, que si están protegidas deben verse con el
  motivo "comparable confirmada en la tabla del estudio anterior").
- Con una candidata de la tabla que en Capital IQ resulte ser holding o tener un accionista con
  más del 50 %, confirmar que se sigue excluyendo pese a estar en `PT_CONTINUIDAD_TABLA_KEYS`.
- Guardar el estudio, recargar, y confirmar que `PT_CONTINUIDAD_TABLA_KEYS` y
  `PT_ANTERIOR.comparablesTabla` persisten sin tener que repetir las cargas.
