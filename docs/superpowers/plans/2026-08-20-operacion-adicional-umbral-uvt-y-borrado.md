# Operación adicional: umbral en UVT y borrado de la tabla — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el umbral de la operación adicional se derive de los 45.000 UVT del año
gravable en vez de una constante fija, y que la tabla del informe se elimine cuando no hay
operación adicional declarable, en vez de quedarse con los datos del informe anterior.

**Architecture:** la operación adicional (sección «4. Información adicional» del formato,
códigos DIAN 61 a 63) ya está implementada de punta a punta por Pablo Barreto en `72a3163`:
el parser la lee con los índices de columna de su propia cabecera, `tablasOperaciones.js`
define la tabla en sus dos formas —ficha y columnas—, las dos rutas de generación la
publican y el paso 2 la previsualiza. Este plan cambia solo dos decisiones de ese trabajo.

**Tech Stack:** ESM puro en `frontend/src/services/`, React 19 en `frontend/src/components/`,
pruebas con `node:test` + `node:assert` vía `npm test`.

**Reemplaza a:** `docs/superpowers/plans/2026-08-19-operacion-adicional-informacion-adicional.md`,
que quedó obsoleto al integrar `origin/main` y `origin/antoniodev`: sus siete tareas
construían lo que `72a3163` ya construyó.

**Spec:** `docs/superpowers/specs/2026-08-19-operacion-adicional-informacion-adicional-design.md`
— vigente en el criterio (45.000 UVT derivados, tabla eliminada cuando no aplica) y obsoleto
en la implementación que propone, porque describe un árbol anterior a `72a3163`.

## Contexto: qué existe hoy y no hay que rehacer

| Pieza | Dónde |
|---|---|
| Lectura de la sección 4 con su propia cabecera | `excelOperationsParser.js:33` (`indicesDeEncabezado`), `:176` (sección `ADICIONAL`), `:372` (campo `operacionAdicional`) |
| Umbral y predicado | `tablasOperaciones.js:136` (`UMBRAL_OPERACION_ADICIONAL`), `:171` (`tieneOperacionAdicional`), `:178` (`montoOperacionAdicional`) |
| Rótulos que reconoce | `tablasOperaciones.js:146` (`NOMBRES_TABLA_ADICIONAL`, seis redacciones) |
| La tabla, en columnas y en ficha | `tablasOperaciones.js:197` y `:228` |
| Veto para que la Tabla 3 no la pise | `docxRelleno.js:1612` (`soloTx`), `tablasOperacionesHtml.js:57` (`excluir`) |
| Ruta OOXML | `docxRelleno.js:1628` |
| Ruta HTML de plantilla | `tablasOperacionesHtml.js:205` |
| Previsualización del paso 2 | `IngestaOperaciones.jsx:84` (avisos) y `:231` (tarjeta) |

## Global Constraints

- **Todo en español**: código, comentarios, identificadores de dominio, UI y mensajes.
- **El umbral son 45.000 UVT del año gravable del estudio.** Para 2025,
  `45.000 × 49.799 = 2.240.955.000`. **Nunca escribir el número como constante:** en 2026 el
  UVT es 52.300 y el umbral 2.353.500.000.
- **La comparación es estricta** (`>`): exactamente el umbral NO supera. Es lo que ya hace
  `tieneOperacionAdicional` (`tablasOperaciones.js:174`) y no cambia.
- **El umbral se mide sobre la SUMA** de todas las filas de la sección 4, no fila a fila.
  Criterio ya implementado, no cambia.
- **No se toca** `monto`, `monto_operacion`, `t_s` ni `egresosDescartados` del estudio: la
  operación adicional no afecta el estado de resultados y no sustenta el rango.
- **No se renumera** ninguna tabla del informe, ni al publicar ni al eliminar.
- **Celda sin dato = `'—'`** (guion largo U+2014).
- **`npm test` al 100 %** antes de cada commit (1607 pruebas hoy). Lint limpio con
  `npm run lint --prefix frontend`.
- **Sin `Co-Authored-By`** en los mensajes de commit.
- **No reescribir el trabajo de `72a3163`** más allá de lo que estas dos tareas piden. En
  particular: se conservan las seis redacciones de `NOMBRES_TABLA_ADICIONAL`, la detección
  ficha-vs-columnas y el detalle fila por fila de la tabla.

---

### Task 1: El umbral se deriva de los 45.000 UVT del año gravable

**Files:**
- Modify: `frontend/src/services/tablasOperaciones.js:15` (imports), `:130-136` (la constante),
  `:171-175` (`tieneOperacionAdicional`)
- Modify: `frontend/src/components/IngestaOperaciones.jsx:7` (import), `:84`, `:94`, `:241`
- Test: `frontend/src/services/tablasOperaciones.test.js`,
  `frontend/src/services/tablasOperacionesHtml.test.js:388`

**Interfaces:**
- Consumes: `getUvtValue(anio)` de `frontend/src/utils/calculations.js:16` — devuelve el UVT
  del año (2023: 42412, 2024: 47065, 2025: 49799, 2026: 52300) y **47065** para cualquier
  año desconocido o ausente.
- Produces, exportado de `tablasOperaciones.js`:
  - `UVT_UMBRAL_OPERACION_ADICIONAL` → `45000` (number)
  - `umbralOperacionAdicional(anio: number|string|undefined) → number`
  - `UMBRAL_OPERACION_ADICIONAL` **desaparece**. Es un cambio de contrato: hay que actualizar
    sus cuatro llamadores (uno en `tablasOperaciones.js`, tres en `IngestaOperaciones.jsx`).
  - `tieneOperacionAdicional(estudio)` conserva su firma y su semántica; solo cambia el
    número contra el que compara.

**Por qué.** El umbral vigente es `2.500.000.000` fijo (`tablasOperaciones.js:136`),
atribuido en su comentario y en el mensaje de `72a3163` a «criterio del usuario
(2026-08-19)». El usuario confirmó el 2026-08-20 que el criterio son los **45.000 UVT** del
art. 260-5 E.T. y del art. 1.2.2.3.2 del Decreto 2120 —2.240.955.000 en 2025—, y que se
recalcula por año gravable. Una constante fija hace que el estudio de 2026 mida contra el
umbral de 2025 sin que nadie lo note.

- [ ] **Step 1: Escribir las pruebas que fallan**

Añadir a `frontend/src/services/tablasOperaciones.test.js`. Importar
`UVT_UMBRAL_OPERACION_ADICIONAL`, `umbralOperacionAdicional` y `tieneOperacionAdicional`.

```js
/* ── El umbral de la operación adicional, en UVT del año gravable ───────────── */

const conAdicional = (monto, anio) => ({
  anio,
  operacionAdicional: {
    monto,
    filas: [{ vinculado: 'BETA GMBH', nit: '900222', pais: 'ALEMANIA',
      tipo: 'Reintegros o reembolsos de gastos con vinculados (62)', monto }],
  },
});

test('el umbral son 45.000 UVT del año gravable, no un número escrito a mano', () => {
  assert.strictEqual(UVT_UMBRAL_OPERACION_ADICIONAL, 45000);
  /* 2.240.955.000 es el umbral de 2025 y el único que la gente tiene en la cabeza. Escrito
     como constante, el estudio de 2026 mediría contra él sin avisar. */
  assert.strictEqual(umbralOperacionAdicional(2025), 2240955000);
  assert.strictEqual(umbralOperacionAdicional(2024), 2117925000);
  assert.strictEqual(umbralOperacionAdicional(2026), 2353500000);
});

test('el año llega como cadena desde el estudio y también resuelve', () => {
  assert.strictEqual(umbralOperacionAdicional('2025'), 2240955000);
});

test('un año ausente o desconocido cae en el mismo respaldo que getUvtValue', () => {
  assert.strictEqual(umbralOperacionAdicional(undefined), 45000 * 47065);
  assert.strictEqual(umbralOperacionAdicional(1999), 45000 * 47065);
});

test('el mismo monto declara o no según el año gravable del estudio', () => {
  /* Es el defecto que este cambio cierra: con la constante fija de 2.500.000.000 los tres
     años daban el mismo veredicto, y el umbral de cada uno es distinto. */
  const monto = 2300000000;
  assert.strictEqual(tieneOperacionAdicional(conAdicional(monto, 2025)), true,
    '2.300 millones superan los 2.240.955.000 de 2025');
  assert.strictEqual(tieneOperacionAdicional(conAdicional(monto, 2026)), false,
    '2.300 millones NO superan los 2.353.500.000 de 2026');
});

test('exactamente en el umbral no se declara', () => {
  /* La norma habla de operaciones que SUPEREN 45.000 UVT. */
  assert.strictEqual(tieneOperacionAdicional(conAdicional(2240955000, 2025)), false);
  assert.strictEqual(tieneOperacionAdicional(conAdicional(2240955001, 2025)), true);
});

test('el umbral viejo de 2.500 millones ya no manda', () => {
  /* Un monto entre el umbral nuevo y el viejo tiene que declararse: con la constante
     anterior no lo hacía. */
  assert.strictEqual(tieneOperacionAdicional(conAdicional(2400000000, 2025)), true);
});

test('sin sección 4 en el formato no hay nada que declarar, sea cual sea el umbral', () => {
  assert.strictEqual(tieneOperacionAdicional({ anio: 2025 }), false);
  assert.strictEqual(tieneOperacionAdicional({ anio: 2025, operacionAdicional: null }), false);
  assert.strictEqual(
    tieneOperacionAdicional({ anio: 2025, operacionAdicional: { monto: 9e9, filas: [] } }),
    false, 'la sección sin filas no declara aunque traiga un monto');
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `node --test frontend/src/services/tablasOperaciones.test.js`
Expected: FAIL — `UVT_UMBRAL_OPERACION_ADICIONAL` y `umbralOperacionAdicional` no existen.

- [ ] **Step 3: Derivar el umbral en `tablasOperaciones.js`**

En el import de `:15`, añadir `getUvtValue`:

```js
import { fmt, num, getUvtValue } from '../utils/calculations.js';
```

Reemplazar el bloque `:130-136` —el comentario de la constante y la constante— por:

```js
/* Desde cuánto la información adicional del formato entra al informe.
   Son operaciones que NO se reflejan en el Estado de Resultados —préstamos con vinculados,
   reintegros de gastos, operaciones a nombre de vinculados—, así que no sustentan el rango
   ni el monto de la operación analizada; se declaran aparte y solo cuando pesan.

   El umbral son los 45.000 UVT del art. 260-5 E.T. y del art. 1.2.2.3.2 del Decreto 2120 de
   2017, medidos sobre la SUMA de todas las filas de la sección y no fila a fila.

   SE DERIVA del UVT del año gravable y no se escribe. Antes era la constante 2.500.000.000
   —2.240.955.000 es el valor de 2025, que es el número que la gente tiene en la cabeza y el
   que pediría escribir—, pero en 2026 el UVT es 52.300 y el umbral 2.353.500.000: un número
   fijo hace que el estudio de cada año nuevo mida contra el umbral del anterior sin que
   nadie lo note. */
export const UVT_UMBRAL_OPERACION_ADICIONAL = 45000;

/**
 * El umbral en pesos del año gravable.
 *
 * @param {number|string} [anio] año gravable del estudio. Lo que `getUvtValue` no conozca
 *        cae en su propio respaldo, que es el UVT de 2024.
 * @returns {number} pesos colombianos.
 */
export function umbralOperacionAdicional(anio) {
  return UVT_UMBRAL_OPERACION_ADICIONAL * getUvtValue(anio);
}
```

En `tieneOperacionAdicional` (`:171-175`), la comparación pasa a leer el año del estudio.
Reemplazar la línea `:174`:

```js
  return montoOperacionAdicional(estudio) > umbralOperacionAdicional(estudio.anio);
```

Y en su JSDoc, sustituir la mención al umbral fijo por: `que su total SUPERE el umbral del
año gravable (45.000 UVT)`.

- [ ] **Step 4: Actualizar los tres llamadores de la UI**

En `frontend/src/components/IngestaOperaciones.jsx:7`, cambiar el nombre importado:

```js
  umbralOperacionAdicional, tieneOperacionAdicional, montoOperacionAdicional,
```

En `:84`, la condición del aviso pasa a usar el umbral del año del estudio. **No dupliques
la comparación**: usa el predicado que ya existe, que es el mismo que decide si la tabla se
publica y no puede discrepar de él:

```js
        if (ad && ad.monto > umbralOperacionAdicional(study.anio)) {
```

En `:94` y en `:241`, sustituir `fmt(UMBRAL_OPERACION_ADICIONAL)` por
`fmt(umbralOperacionAdicional(study.anio))`.

Nota para el implementador: `study` es una prop del componente y está en el ámbito de
`handleExcelUpload`. Si el estudio no trae `anio` todavía, `getUvtValue` cae en 47065 y el
aviso mide contra el umbral de 2024 — es el mismo respaldo que usa el resto del sistema y no
se inventa otro aquí.

- [ ] **Step 5: Actualizar la prueba de frontera existente**

`frontend/src/services/tablasOperacionesHtml.test.js:388` fija la frontera en el umbral
viejo:

```js
  const justo = { filas: ADICIONAL.filas, monto: 2500000000 };
```

Es una prueba de Pablo y sigue siendo válida — solo cambia el número. Ponerla en el umbral
nuevo y asegurar que el estudio de ese caso declara `anio: 2025`, para que la frontera sea la
del año que la prueba dice medir:

```js
  /* Exactamente en el umbral de 45.000 UVT de 2025: la norma habla de operaciones que lo
     SUPEREN, así que este monto no se declara. */
  const justo = { filas: ADICIONAL.filas, monto: 2240955000 };
```

Revisar el resto de ese archivo y de `docxRelleno.test.js`: cualquier caso que use un monto
entre 2.240.955.000 y 2.500.000.000 cambia de veredicto con este cambio. Los que usen montos
muy por encima o muy por debajo no se tocan. Si alguno de esos estudios de prueba no declara
`anio`, añadírselo: sin año el umbral es el de 2024 y la prueba mediría contra otra cosa que
la que dice.

- [ ] **Step 6: Correr las pruebas y verificar que pasan**

Run: `node --test frontend/src/services/tablasOperaciones.test.js frontend/src/services/tablasOperacionesHtml.test.js frontend/src/services/docxRelleno.test.js`
Expected: PASS — las 7 nuevas y todas las anteriores.

- [ ] **Step 7: Correr la suite completa y el lint**

Run: `npm test`
Expected: 100 % en verde. Presta atención a fallos en archivos que no tocaste: significarían
un estudio de prueba con un monto en la franja que cambió de veredicto.

Run: `npm run lint --prefix frontend`
Expected: sin hallazgos. Si oxlint marca `UMBRAL_OPERACION_ADICIONAL` como import sin uso en
algún sitio, es un llamador que se te quedó.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/services/tablasOperaciones.js frontend/src/services/tablasOperaciones.test.js frontend/src/services/tablasOperacionesHtml.test.js frontend/src/services/docxRelleno.test.js frontend/src/components/IngestaOperaciones.jsx
git commit -m "fix: el umbral de la operacion adicional son 45.000 UVT del anio gravable"
```

---

### Task 2: La tabla se elimina del informe cuando no hay nada que declarar

**Files:**
- Modify: `frontend/src/services/tablasHtmlInforme.js` — nueva primitiva `borrarTablaHtml`
- Modify: `frontend/src/services/docxRelleno.js:1421-1449` (`sustituidorDeTablas`, método
  `borrar`) y `:1628-1638` (la rama de la tabla adicional)
- Modify: `frontend/src/services/tablasOperacionesHtml.js:22-28` (imports), `:205-216`
- Test: `frontend/src/services/tablasOperacionesHtml.test.js`,
  `frontend/src/services/docxRelleno.test.js`

**Interfaces:**
- Consumes: `tieneOperacionAdicional(estudio)` y `NOMBRES_TABLA_ADICIONAL` de
  `tablasOperaciones.js` (ya existen); `localizarTablaHtml(html, nombres, opciones)` y
  `localizarBloqueTabla(xml, nombres, opciones)` (ya aceptan `opciones`); `textoPlanoHtml`
  (`tablasHtmlInforme.js:53`) y `textoPlanoOoxml` + `parrafoHermanoSiguiente`
  (`docxRelleno.js:998`, privadas del módulo).
- Produces:
  - `borrarTablaHtml(html, bloque) → string`, exportada de `tablasHtmlInforme.js`.
  - `sustituidorDeTablas(...).borrar(nombres, opciones) → boolean` en `docxRelleno.js`.

**Por qué.** Hoy la publicación de la tabla vive dentro de `if (tieneOperacionAdicional(...))`
en las dos rutas (`docxRelleno.js:1628`, `tablasOperacionesHtml.js:205`). Cuando el predicado
es falso **no se toca nada**, que es una decisión deliberada de `72a3163`: *«CUANDO NO APLICA,
NADA CAMBIA… el informe sale exactamente como salía antes: sin tabla vacía, sin rótulo
huérfano y sin un aviso de tabla ausente»*.

Ese razonamiento se sostiene si la plantilla **no** trae la tabla. Con una plantilla que sí la
trae —el informe del año anterior del mismo cliente, que es lo que esta ruta consume— la tabla
sobrevive con los datos anteriores. Verificado corriendo el motor real contra una plantilla
con la tabla llena:

```
FUGA   | sin sección 4 en el Excel
FUGA   | sección 4 por debajo del umbral
```

En los dos casos el informe sale con `CLIENTE ANTERIOR S.A.` y `9.999.999.999`. Es la misma
clase de fuga que el encabezado de `tablasOperaciones.js:10-12` declara como razón de existir
del módulo, en un documento que se radica ante la DIAN.

**Qué NO cambia.** La matriz completa después de esta tarea:

| Tabla en la plantilla | Operación adicional declarable | Qué pasa |
|---|---|---|
| sí | sí | se publica con los datos del estudio, sin aviso — **ya funciona así** |
| sí | no | **se elimina** con su rótulo y su línea FUENTE, sin aviso — lo nuevo |
| no | sí | aviso «no se encontró en la plantilla», sin insertar nada — **ya funciona así** |
| no | no | nada, sin aviso — **ya funciona así** |

**El borrado no genera aviso, y es a propósito.** El arreglo `avisos` se publica como «No se
encontró en la plantilla: X» (`semaforoRadicacion.js:60`) y alimenta el semáforo de
radicación. Un borrado intencionado no es una tabla que no se encontró. Que la tabla no va a
salir se dice en el paso 2, que es donde el usuario puede hacer algo al respecto.

**La línea FUENTE.** El bloque que devuelven los dos localizadores va del rótulo al cierre de
la tabla; la línea `FUENTE: …` que la plantilla trae **detrás** queda fuera. Al sustituir da
igual, porque el generador emite la suya. Al borrar, no: queda huérfana bajo la tabla
siguiente y le atribuye un origen que no es el suyo.

- [ ] **Step 1: Escribir las pruebas que fallan (ruta HTML)**

Añadir a `frontend/src/services/tablasOperacionesHtml.test.js`. Reutilizar los helpers y
constantes que ya tiene el archivo; importar `borrarTablaHtml` y `localizarTablaHtml` de
`./tablasHtmlInforme.js` si no están ya importados.

```js
/* ── La tabla de operación adicional se va cuando no hay nada que declarar ──── */

/* Plantilla = informe del año anterior, con SU tabla de operación adicional llena. Es el
   caso que importa: mientras el borrado no existía, estas dos cifras viajaban al informe
   de cualquier cliente. */
const PLANTILLA_CON_ADICIONAL =
  '<p> Prosa anterior a la tabla.</p>' +
  '<p><strong> Tabla 4. Operación adicional Transacciones Intercompañía</strong></p>' +
  '<table>' +
  '<tr><th><p><strong> Compañía vinculada</strong></p></th>' +
  '<th><p><strong> Monto en pesos</strong></p></th></tr>' +
  '<tr><td><p> CLIENTE ANTERIOR S.A.</p></td><td><p> 9.999.999.999</p></td></tr>' +
  '</table>' +
  '<p><strong>FUENTE: Información de CLIENTE ANTERIOR S.A.</strong></p>' +
  '<p> Prosa posterior a la tabla.</p>';

test('sin sección 4 en el formato, la tabla de la plantilla se elimina', () => {
  const avisos = [];
  const salida = actualizarTablasOperacionesHtml(PLANTILLA_CON_ADICIONAL, { anio: 2025, ent: 'ACME' }, avisos);

  assert.ok(!salida.includes('CLIENTE ANTERIOR'), 'sobrevivió el vinculado del informe anterior');
  assert.ok(!salida.includes('9.999.999.999'), 'sobrevivió el monto del informe anterior');
  assert.ok(!salida.includes('Operación adicional'), 'sobrevivió el rótulo');
  assert.ok(!salida.includes('FUENTE: Información de CLIENTE ANTERIOR'), 'quedó la fuente huérfana');
  /* Y lo de alrededor intacto: se borra la tabla, no el informe. */
  assert.match(salida, /Prosa anterior a la tabla/);
  assert.match(salida, /Prosa posterior a la tabla/);
  assert.ok(!avisos.some((a) => a.toLowerCase().includes('adicional')),
    'un borrado deliberado no es «no se encontró en la plantilla»');
});

test('con sección 4 por debajo del umbral, la tabla también se elimina', () => {
  const estudio = {
    anio: 2025, ent: 'ACME',
    operacionAdicional: {
      monto: 500000000,
      filas: [{ vinculado: 'BETA GMBH', nit: '900222', pais: 'ALEMANIA',
        tipo: 'Préstamos con vinculados (61)', monto: 500000000 }],
    },
  };
  const salida = actualizarTablasOperacionesHtml(PLANTILLA_CON_ADICIONAL, estudio, []);

  assert.ok(!salida.includes('CLIENTE ANTERIOR'));
  assert.ok(!salida.includes('Operación adicional'));
  /* Y tampoco se cuela la operación que no llegó al umbral. */
  assert.ok(!salida.includes('BETA GMBH'), 'se publicó una operación que no supera el umbral');
});

test('sobre el umbral la tabla se publica, no se borra', () => {
  /* La regresión que este cambio podría causar: borrar de más. */
  const estudio = {
    anio: 2025, ent: 'ACME',
    operacionAdicional: {
      monto: 14516485850,
      filas: [{ vinculado: 'MONTACHEM INTERNATIONAL INC', nit: '760575817', pais: 'EEUU',
        tipo: 'Reintegros o reembolsos de gastos con vinculados (62)', monto: 14516485850 }],
    },
  };
  const salida = actualizarTablasOperacionesHtml(PLANTILLA_CON_ADICIONAL, estudio, []);

  assert.match(salida, /Operación adicional/, 'se borró una tabla que sí había que publicar');
  assert.match(salida, /MONTACHEM INTERNATIONAL INC/);
  assert.ok(!salida.includes('CLIENTE ANTERIOR'), 'sobrevivió el vinculado anterior');
});

test('plantilla sin la tabla y sin nada que declarar: no se toca ni se avisa', () => {
  const avisos = [];
  const sinTabla = '<p> Un informe sin tabla de operación adicional.</p>';
  const salida = actualizarTablasOperacionesHtml(sinTabla, { anio: 2025, ent: 'ACME' }, avisos);

  assert.strictEqual(salida, sinTabla, 'no había nada que borrar');
  assert.ok(!avisos.some((a) => a.toLowerCase().includes('adicional')));
});

test('borrarTablaHtml no se lleva un párrafo que no sea la fuente', () => {
  const html =
    '<p><strong> Tabla 4. Operación adicional Transacciones Intercompañía</strong></p>' +
    '<table><tr><th><p> BORRAR</p></th></tr></table>' +
    '<p> Las anteriores operaciones fueron realizadas con intercompañías.</p>';

  const bloque = localizarTablaHtml(html, 'Operación adicional Transacciones Intercompañía');
  const salida = borrarTablaHtml(html, bloque);

  assert.ok(!salida.includes('BORRAR'));
  assert.match(salida, /Las anteriores operaciones/, 'se llevó prosa del informe');
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `node --test frontend/src/services/tablasOperacionesHtml.test.js`
Expected: FAIL — la primera falla en `assert.ok(!salida.includes('CLIENTE ANTERIOR'))`: hoy
la tabla se queda como está.

- [ ] **Step 3: La primitiva de borrado en `tablasHtmlInforme.js`**

Junto a las otras primitivas del módulo:

```js
/* El primer elemento que sigue a un bloque, para poder mirar si es su línea de fuente.
   Regex local y no compartida: las de este módulo llevan `g` y arrastran `lastIndex`. */
const RX_ELEMENTO_SIGUIENTE = /^\s*<p(?:\s[^>]*)?>[\s\S]*?<\/p\s*>/i;

/**
 * Quita del informe una tabla completa: su rótulo, la tabla y la línea de fuente que la
 * sigue.
 *
 * La fuente hay que llevársela a mano porque no está dentro del bloque que devuelve
 * `localizarTablasHtml` —el bloque acaba en `</table>`—. Al sustituir da igual, porque la
 * tabla nueva emite la suya; al borrar, una fuente huérfana queda bajo la tabla siguiente y
 * le atribuye un origen que no es el suyo.
 *
 * @param {string} html
 * @param {{inicio:number, fin:number, rotulo:{inicio:number, fin:number}|null}} bloque
 * @returns {string}
 */
export function borrarTablaHtml(html, bloque) {
  const texto = String(html || '');
  if (!bloque) return texto;

  let fin = bloque.fin;
  const siguiente = RX_ELEMENTO_SIGUIENTE.exec(texto.slice(fin));
  if (siguiente && /^\s*fuente\s*:/i.test(textoPlanoHtml(siguiente[0]))) {
    fin += siguiente[0].length;
  }

  /* El rótulo va ANTES que la tabla, así que se recorta el tramo entero en un solo corte:
     borrar primero el rótulo desplazaría los offsets sobre los que se calculó el bloque.
     `rotulo` es null cuando el título vive dentro de la propia tabla, y entonces ya está
     dentro del tramo. */
  const desde = (bloque.rotulo && bloque.rotulo.inicio < bloque.inicio)
    ? bloque.rotulo.inicio
    : bloque.inicio;
  return texto.slice(0, desde) + texto.slice(fin);
}
```

- [ ] **Step 4: Borrar en la ruta HTML**

En los imports de `tablasOperacionesHtml.js` (`:22-28`), añadir `borrarTablaHtml` a los que
vienen de `./tablasHtmlInforme.js`.

En el bloque de `:205-216`, añadir la rama del borrado. El `if` existente no se toca; solo
gana su `else`, y el comentario de arriba hay que corregirlo porque hoy afirma lo contrario:

```js
  /* «Operación adicional Transacciones Intercompañía» va fuera del bucle porque es la única
     tabla que puede NO corresponder: se publica solo si el formato trajo la sección «4.
     Información adicional» y su total supera el umbral del año gravable.

     Y cuando NO corresponde no basta con dejarla quieta. La plantilla es el informe del año
     anterior, así que la tabla que ya está ahí trae las operaciones de ese informe: no
     tocarla las publica como si fueran de este contribuyente. Se elimina con su rótulo y su
     línea de fuente. Sin aviso: `avisos` se publica como «no se encontró en la plantilla» y
     alimenta el semáforo de radicación, y un borrado intencionado no es eso. Que la tabla no
     va a salir se dice en el paso 2 de la ingesta, donde el usuario puede actuar.

     La plantilla puede traerla en ficha vertical o en columnas, igual que el rango, así que
     se mira la forma de la que ya está en vez de imponer una. */
  if (tieneOperacionAdicional(estudio)) {
    const bloque = localizarTablaHtml(out, NOMBRES_TABLA_ADICIONAL);
    if (bloque) {
      const tabla = bloque.columnas > 0 && bloque.columnas <= 2
        ? filasOperacionAdicionalFicha(estudio)
        : filasOperacionAdicional(estudio);
      out = sustituir(out, bloque, tabla, false, 0);
    } else if (Array.isArray(avisos)) {
      avisos.push(NOMBRES_TABLA_ADICIONAL[0]);
    }
  } else {
    const bloque = localizarTablaHtml(out, NOMBRES_TABLA_ADICIONAL);
    if (bloque) out = borrarTablaHtml(out, bloque);
  }
```

- [ ] **Step 5: Escribir las pruebas que fallan (ruta OOXML)**

Añadir a `frontend/src/services/docxRelleno.test.js`:

```js
test('sin operación adicional declarable, la tabla del .docx se elimina con su fuente', () => {
  /* La plantilla es el informe del año anterior. Dejar su tabla quieta publica las
     operaciones de ese informe como si fueran de este contribuyente. */
  const xml =
    '<w:p><w:t>Tabla 3. Transacciones Inter compañía</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>Old 3</w:t></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:t>Tabla 4. Operación adicional Transacciones Intercompañía</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>CLIENTE ANTERIOR S.A.</w:t></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:t>FUENTE: Información de CLIENTE ANTERIOR S.A.</w:t></w:p>' +
    '<w:p><w:t>Tabla 5. Método de Precios de Transferencia</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>Old 5</w:t></w:p></w:tc></w:tr></w:tbl>';
  const avisos = [];

  const salida = actualizarTablasOperacionesOoxml(xml, { anio: 2025, ent: 'ACME' }, avisos);

  assert.ok(!salida.includes('CLIENTE ANTERIOR S.A.'), 'sobrevivió el vinculado anterior');
  assert.ok(!salida.includes('Operación adicional'), 'sobrevivió el rótulo');
  /* La numeración de lo que sigue NO se toca: la fija la plantilla. */
  assert.ok(salida.includes('Tabla 5. Método de Precios de Transferencia'),
    'se renumeró o se perdió la tabla siguiente');
  assert.ok(!avisos.some((a) => String(a).toLowerCase().includes('adicional')),
    'un borrado deliberado no es «no se encontró en la plantilla»');
});

test('por debajo del umbral la tabla del .docx también se elimina', () => {
  const xml =
    '<w:p><w:t>Tabla 4. Operación adicional Transacciones Intercompañía</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>CLIENTE ANTERIOR S.A.</w:t></w:p></w:tc></w:tr></w:tbl>';
  const estudio = {
    anio: 2025, ent: 'ACME',
    operacionAdicional: {
      monto: 500000000,
      filas: [{ vinculado: 'BETA GMBH', nit: '900222', pais: 'ALEMANIA',
        tipo: 'Préstamos con vinculados (61)', monto: 500000000 }],
    },
  };

  const salida = actualizarTablasOperacionesOoxml(xml, estudio, []);

  assert.ok(!salida.includes('CLIENTE ANTERIOR S.A.'));
  assert.ok(!salida.includes('BETA GMBH'), 'se publicó una operación que no supera el umbral');
});

test('sobre el umbral la tabla del .docx se publica, no se borra', () => {
  const xml =
    '<w:p><w:t>Tabla 4. Operación adicional Transacciones Intercompañía</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>CLIENTE ANTERIOR S.A.</w:t></w:p></w:tc></w:tr></w:tbl>';
  const estudio = {
    anio: 2025, ent: 'ACME',
    operacionAdicional: {
      monto: 14516485850,
      filas: [{ vinculado: 'MONTACHEM INTERNATIONAL INC', nit: '760575817', pais: 'EEUU',
        tipo: 'Reintegros o reembolsos de gastos con vinculados (62)', monto: 14516485850 }],
    },
  };

  const salida = actualizarTablasOperacionesOoxml(xml, estudio, []);

  assert.ok(salida.includes('Operación adicional'), 'se borró una tabla que sí había que publicar');
  assert.ok(salida.includes('MONTACHEM INTERNATIONAL INC'));
  assert.ok(!salida.includes('CLIENTE ANTERIOR S.A.'));
});
```

- [ ] **Step 6: Borrar en la ruta OOXML**

En `sustituidorDeTablas` (`:1421-1449`), añadir el método junto a `reemplazar`:

```js
    /** Quita la tabla, su rótulo y la línea FUENTE que la sigue. `true` si estaba.
     *
     *  NO anota en `avisos` cuando no la encuentra: ese arreglo se publica como «No se
     *  encontró en la plantilla: X» y alimenta el semáforo de radicación. Una tabla que se
     *  quiere borrar y no está es el resultado buscado, no un hallazgo. */
    borrar(nombres, opciones) {
      const bloque = localizarBloqueTabla(out, nombres, opciones);
      if (!bloque) return false;
      /* La fuente vive detrás del cierre de la tabla, fuera del bloque. Al sustituir no
         importa —el generador emite la suya—, pero al borrar quedaría huérfana bajo la tabla
         siguiente, atribuyéndole un origen que no es el suyo. */
      let fin = bloque.fin;
      const hermano = parrafoHermanoSiguiente(out, fin);
      if (hermano && hermano.xml && /^\s*fuente\s*:/i.test(textoPlanoOoxml(hermano.xml))) {
        fin = hermano.fin;
      }
      out = out.slice(0, bloque.inicio) + out.slice(fin);
      return true;
    },
```

Nota: `parrafoHermanoSiguiente` (`:998`) devuelve `{inicio, fin, xml}` si lo que sigue es un
párrafo hermano, o `{bloqueado}` si es una tabla, un control de contenido o el final del
cuerpo — por eso se comprueba `hermano.xml` antes de leerlo.

En la rama de la tabla adicional (`:1628-1638`), añadir el `else` y corregir el comentario que
hoy afirma que no se toca nada:

```js
  /* 3-bis. Operación adicional Transacciones Intercompañía — la sección «4. Información
     adicional» del formato (códigos DIAN 61 a 63: préstamos, reintegros y operaciones a
     nombre de vinculados que no se reflejan en el Estado de Resultados).

     Se publica SOLO si el formato la trajo y su total supera el umbral del año gravable. Si
     no, la tabla que la plantilla trae hay que ELIMINARLA: la plantilla es el informe del
     año anterior, así que sus filas son las operaciones de ese informe y dejarlas quietas
     las declara como de este contribuyente. Se va con su rótulo y su línea de fuente, y sin
     aviso —un borrado intencionado no es una tabla que no se encontró—.

     La plantilla puede traerla en columnas o en ficha vertical, como pasa con el rango: se
     mira cuántas columnas declara la que ya está ahí en vez de imponer una forma. */
  if (tieneOperacionAdicional(estudio)) {
    reemplazar(NOMBRES_TABLA_ADICIONAL, (b, xmlBloque) => {
      const columnas = (String(xmlBloque || '').match(/<w:gridCol\b/g) || []).length;
      const t = columnas > 0 && columnas <= 2
        ? filasOperacionAdicionalFicha(estudio)
        : filasOperacionAdicional(estudio);
      return generarTablaOoxml(
        tituloDe(b, t.nombre), t.encabezados, t.filas, escaparXml(t.fuente)
      );
    });
  } else {
    doc.borrar(NOMBRES_TABLA_ADICIONAL);
  }
```

Nota: `doc` es el objeto que devuelve `sustituidorDeTablas` y ya está en el ámbito de
`actualizarTablasOperacionesOoxml`; `reemplazar` es su método envuelto (`:1542-1543`).

- [ ] **Step 7: Correr las pruebas y verificar que pasan**

Run: `node --test frontend/src/services/tablasOperacionesHtml.test.js frontend/src/services/docxRelleno.test.js`
Expected: PASS — las 8 nuevas y todas las anteriores. En particular, las pruebas de `72a3163`
que comprueban «cuando no aplica, nada cambia» pueden fallar ahora: **son la afirmación que
este cambio corrige**. Si alguna falla porque asegura que la tabla sobrevive, actualízala
para que asegure lo contrario, conservando su comentario y su intención. Si falla por
cualquier otro motivo, es una regresión tuya.

- [ ] **Step 8: Correr la suite completa y el lint**

Run: `npm test` && `npm run lint --prefix frontend`
Expected: 100 % en verde y sin hallazgos.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/services/tablasHtmlInforme.js frontend/src/services/tablasOperacionesHtml.js frontend/src/services/tablasOperacionesHtml.test.js frontend/src/services/docxRelleno.js frontend/src/services/docxRelleno.test.js
git commit -m "fix: la tabla de operacion adicional se elimina cuando no hay nada que declarar"
```

---

## Verificación final

- [ ] `npm test` — 100 % en verde, con ~15 pruebas más que al empezar (1607 → ~1622).
- [ ] `npm run lint --prefix frontend` — sin hallazgos.
- [ ] `npm run build` — limpio, y `public/gestor-reportes/` comiteado.
- [ ] `umbralOperacionAdicional(2025) === 2240955000` y `(2026) === 2353500000`.
- [ ] Un monto de 2.300.000.000 declara en un estudio de 2025 y no en uno de 2026.
- [ ] Con una plantilla que trae la tabla llena y un estudio sin operación adicional
      declarable, ni `CLIENTE ANTERIOR` ni su monto aparecen en la salida de ninguna de las
      dos rutas.
- [ ] Ninguna tabla del informe cambió de número.
- [ ] Verificación manual en el navegador del paso 2 con
      `D:\G\Juan-Mendez\Downloads\Informacion Operaciones PT 2025-1 (1).xlsx`: la tarjeta de
      operación adicional cita `COP $ 2.240.955.000` como umbral, no `2.500.000.000`.
