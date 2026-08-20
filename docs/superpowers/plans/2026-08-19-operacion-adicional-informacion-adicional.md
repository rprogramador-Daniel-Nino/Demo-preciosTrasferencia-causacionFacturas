# Operación adicional (sección 4 del Excel de operaciones) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la sección «4. INFORMACIÓN ADICIONAL» del Excel de Operaciones PT se lea, se
previsualice en el paso 2 y se publique en la tabla «Operación adicional Transacciones
Intercompañía» del informe cuando supera los 45.000 UVT del año gravable.

**Architecture:** el motor de ingesta (`excelOperationsParser.js`) redetecta los índices de
columna en cada cabecera de sección y devuelve un agregado nuevo, `adicional`. Un servicio
nuevo, `umbralDocumentacion.js`, deriva el umbral del UVT del año en vez de escribirlo como
constante. `tablasOperaciones.js` gana la definición de la tabla, que las DOS rutas de
generación —OOXML en `docxRelleno.js` y HTML de plantilla en `tablasOperacionesHtml.js`—
consumen sin duplicarla, y que se elimina del documento cuando no hay nada declarable.

**Tech Stack:** React 19 + Vite + Tailwind 4, `xlsx-js-style` para leer el Excel, ESM puro
en `frontend/src/services/`, pruebas con el runner nativo (`node:test` + `node:assert`).

**Spec:** `docs/superpowers/specs/2026-08-19-operacion-adicional-informacion-adicional-design.md`

## Global Constraints

- **Todo en español**: código, comentarios, identificadores de dominio, UI y mensajes.
  Es la regla del repo (`CLAUDE.md`).
- **Umbral**: `45.000 UVT × getUvtValue(anio)`. Para 2025 son exactamente
  `2.240.955.000`. **Nunca escribir el número como constante.**
- **Etiqueta literal de la fila del concepto** en la tabla del informe:
  `Tipo de operaciones (Información adicional)` — con tilde y con paréntesis.
- **Rótulo literal de la tabla**: `Operación adicional Transacciones Intercompañía`.
- **Tipo de vinculación por omisión** de la tabla: `Articulo 260-1 numeral 2` — sin tilde en
  «Articulo», tal como lo trae el informe de referencia.
- **Los códigos de la sección 4 son 61, 62 y 63** (clase `adicional` en
  `tiposOperacionDian.js:89-91`). El 31 NO es uno de ellos.
- **Celda sin dato = `'—'`** (guion largo U+2014), nunca vacío ni un valor por defecto
  inventado: la plantilla es el informe del año anterior.
- **No se toca** `monto`, `monto_operacion`, `t_s` ni `egresosDescartados` del estudio.
- **No se renumera** ninguna tabla del informe, ni al regenerar ni al eliminar.
- **Correr las pruebas con** `npm test` (desde la raíz del repo). Deben quedar al 100 % en
  verde antes de cada commit. Para una sola:
  `node --test frontend/src/services/<archivo>.test.js`
- **Lint:** `npm run lint --prefix frontend` (oxlint) debe quedar limpio.
- **Sin `Co-Authored-By`** en los mensajes de commit.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `frontend/src/services/umbralDocumentacion.js` | **nuevo.** La regla normativa de los 45.000 UVT y nada más. |
| `frontend/src/services/umbralDocumentacion.test.js` | **nuevo.** |
| `frontend/src/services/excelOperationsParser.js` | leer las cuatro secciones del Excel; índices de columna por sección. |
| `frontend/src/services/tablasOperaciones.js` | QUÉ dice cada celda de la tabla nueva. Sin formato. |
| `frontend/src/services/tablasHtmlInforme.js` | primitiva compartida: excluir candidatos al localizar, y borrar una tabla con su rótulo y su fuente. |
| `frontend/src/services/tablasOperacionesHtml.js` | registrar la tabla en la ruta HTML; borrarla cuando no aplica. |
| `frontend/src/services/docxRelleno.js` | lo mismo en la ruta OOXML. |
| `frontend/src/components/IngestaOperaciones.jsx` | escribir los campos en el estudio y previsualizarlos. |
| `frontend/src/components/DatosContribuyente.jsx` | dejar editable el criterio de vinculación de la operación adicional, junto al que ya existe para la principal. |

Orden de las tareas: **1 → 2 → 3 → 4 → 5 → 6 → 7**. La 4 (primitivas de los localizadores)
va antes de la 5 y la 6, que la consumen. La 7 es la única con verificación visual.

---

### Task 1: El umbral de 45.000 UVT

**Files:**
- Create: `frontend/src/services/umbralDocumentacion.js`
- Test: `frontend/src/services/umbralDocumentacion.test.js`

**Interfaces:**
- Consumes: `getUvtValue(anio)` de `frontend/src/utils/calculations.js` — devuelve el UVT del
  año (2023: 42412, 2024: 47065, 2025: 49799, 2026: 52300) y **47065** para cualquier año
  desconocido o ausente.
- Produces:
  - `UVT_UMBRAL_OPERACION` → `45000` (number)
  - `umbralOperacion(anio: number|string|undefined) → number`
  - `superaUmbral(monto: any, anio: number|string|undefined) → boolean` — comparación
    **estricta** (`>`), `false` cuando `monto` no es un número finito. Acepta el monto como
    número o como cadena numérica, así que **ningún llamador debe coercionar antes**: si uno
    lo hiciera y otro no, la previsualización del paso 2 y la generación del informe darían
    veredictos distintos sobre el mismo estudio.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `frontend/src/services/umbralDocumentacion.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { UVT_UMBRAL_OPERACION, umbralOperacion, superaUmbral } from './umbralDocumentacion.js';

test('el umbral son 45.000 UVT del año gravable, no un número escrito a mano', () => {
  assert.strictEqual(UVT_UMBRAL_OPERACION, 45000);
  /* 2.240.955.000 es el umbral de 2025 y el único que la gente tiene en la cabeza. Si
     estuviera escrito como constante, el estudio de 2026 mediría contra él sin avisar. */
  assert.strictEqual(umbralOperacion(2025), 2240955000);
  assert.strictEqual(umbralOperacion(2024), 2117925000);
  assert.strictEqual(umbralOperacion(2026), 2353500000);
});

test('el año llega como cadena desde el estudio y también resuelve', () => {
  assert.strictEqual(umbralOperacion('2025'), 2240955000);
});

test('un año ausente o desconocido cae en el mismo respaldo que getUvtValue', () => {
  // getUvtValue devuelve 47065 (el UVT de 2024) para lo que no conoce.
  assert.strictEqual(umbralOperacion(undefined), 45000 * 47065);
  assert.strictEqual(umbralOperacion(1999), 45000 * 47065);
});

test('el límite es estricto: el monto tiene que SUPERAR el umbral', () => {
  /* La norma habla de operaciones que superen 45.000 UVT. Exactamente el umbral no
     supera, y esa frontera es la que decide si la tabla se publica o se borra. */
  assert.strictEqual(superaUmbral(2240955001, 2025), true);
  assert.strictEqual(superaUmbral(2240955000, 2025), false);
  assert.strictEqual(superaUmbral(2240954999, 2025), false);
});

test('un monto que no es un número no supera nada', () => {
  assert.strictEqual(superaUmbral(null, 2025), false);
  assert.strictEqual(superaUmbral(undefined, 2025), false);
  assert.strictEqual(superaUmbral(0, 2025), false);
  assert.strictEqual(superaUmbral(NaN, 2025), false);
  assert.strictEqual(superaUmbral('no es un monto', 2025), false);
});

test('el monto en cadena numérica resuelve igual que el número', () => {
  /* La coerción vive AQUÍ y no en cada llamador: la previsualización del paso 2 y las dos
     rutas de generación tienen que dar el mismo veredicto sobre el mismo estudio, y un
     estudio que vuelve del localStorage puede traer el monto como cadena. */
  assert.strictEqual(superaUmbral('14516485850', 2025), true);
  assert.strictEqual(superaUmbral('500000000', 2025), false);
});

test('un monto con separadores de miles no se lee como un número truncado', () => {
  /* `parseFloat('2.240.955.001')` da 2.24: un monto de miles de millones se convertiría en
     calderilla y la tabla se borraría en silencio. `Number` da NaN, que es la respuesta
     honesta: eso no es un monto. */
  assert.strictEqual(superaUmbral('2.240.955.001', 2025), false);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `node --test frontend/src/services/umbralDocumentacion.test.js`
Expected: FAIL — `Cannot find module '.../umbralDocumentacion.js'`

- [ ] **Step 3: Escribir la implementación mínima**

Crear `frontend/src/services/umbralDocumentacion.js`:

```js
/* ─────────────────────────────────────────────────────────────────────────────
   umbralDocumentacion.js — cuándo una operación con vinculados hay que documentarla.

   Archivo propio y no una función más en `calculations.js` porque esto no es una cuenta,
   es una regla normativa: art. 260-5 E.T. y art. 1.2.2.3.2 del Decreto 2120 de 2017 fijan
   el umbral en 45.000 UVT por tipo de operación. Quien la busque la encuentra por el
   nombre del archivo.

   El umbral SE DERIVA del UVT del año gravable y no se escribe. Para 2025 son
   2.240.955.000 —el número que la gente tiene en la cabeza y el que pediría escribir—,
   pero en 2026 el UVT es 52.300 y el umbral 2.353.500.000: una constante fija haría que el
   estudio de 2026 midiera contra el umbral del año anterior sin que nadie lo notara.
   ───────────────────────────────────────────────────────────────────────────── */

import { getUvtValue } from '../utils/calculations.js';

/** UVT que fija la norma. Es el dato normativo; el peso es del año. */
export const UVT_UMBRAL_OPERACION = 45000;

/**
 * El umbral en pesos del año gravable.
 *
 * @param {number|string} [anio] año gravable del estudio. Lo que `getUvtValue` no conozca
 *        cae en su propio respaldo, que es el UVT de 2024.
 * @returns {number} pesos colombianos.
 */
export function umbralOperacion(anio) {
  return UVT_UMBRAL_OPERACION * getUvtValue(anio);
}

/**
 * Si un monto obliga a documentar la operación.
 *
 * Estricto a propósito: la norma habla de operaciones que SUPEREN el umbral, así que
 * exactamente 45.000 UVT no lo supera. Esa frontera decide si la tabla del informe se
 * publica o se borra, y dejarla ambigua es publicar o borrar por azar.
 *
 * La coerción del monto vive aquí y no en los llamadores: la previsualización del paso 2 y
 * las dos rutas de generación tienen que dar el MISMO veredicto sobre el mismo estudio, y
 * si cada una convirtiera a su manera acabarían discrepando.
 *
 * `Number` y no `parseFloat`: sobre '2.240.955.001' `parseFloat` devuelve 2.24 —un monto de
 * miles de millones convertido en calderilla, y la tabla se borraría en silencio— mientras
 * `Number` devuelve NaN, que es la respuesta honesta.
 *
 * @param {*} monto número o cadena numérica.
 * @param {number|string} [anio]
 * @returns {boolean}
 */
export function superaUmbral(monto, anio) {
  const n = Number(monto);
  if (!Number.isFinite(n)) return false;
  return n > umbralOperacion(anio);
}
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `node --test frontend/src/services/umbralDocumentacion.test.js`
Expected: PASS — 6 pruebas.

- [ ] **Step 5: Correr la suite completa y el lint**

Run: `npm test`
Expected: todo en verde, con 6 pruebas más que antes.

Run: `npm run lint --prefix frontend`
Expected: sin hallazgos.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/umbralDocumentacion.js frontend/src/services/umbralDocumentacion.test.js
git commit -m "feat: umbral de documentacion de 45.000 UVT derivado del anio gravable"
```

---

### Task 2: El motor lee la sección «4. INFORMACIÓN ADICIONAL»

**Files:**
- Modify: `frontend/src/services/excelOperationsParser.js:60-215` (detección de cabecera,
  índices de columna, máquina de secciones, filtro de `Cod`) y `:281-296` (el retorno)
- Test: `frontend/src/services/excelOperationsParser.test.js`

**Interfaces:**
- Consumes: nada de las tareas anteriores.
- Produces: `parseExcelOperations(file)` devuelve un campo nuevo:

```js
adicional: {
  vinc: string,          // razón social de la primera fila con dato
  vinc_id: string,       // identificación fiscal, solo dígitos
  pais_vinc: string,     // país ya traducido con PAIS_DIAN
  tipo: string,          // tipo dominante por monto, con su código: 'Reintegros … (62)'
  monto: number,         // suma de TODAS las filas de la sección
  filas: number,         // cuántas filas sumaron
  contrapartes: number,  // NITs (o razones sociales) distintos
  tipos: number          // tipos distintos
} | null
```

`null` cuando la sección no existe o no suma nada. Todos los demás campos del retorno
quedan **idénticos**.

**Contexto que el implementador necesita.** Así está hoy el recorrido, y por qué hay que
cambiarlo:

- `:68-87` busca UNA fila de cabecera en las 25 primeras filas de la hoja y `:88-104`
  calcula de ella `iNom`, `iNit`, `iPais`, `iTipo`, `iMonto`, `iCod` **una sola vez para
  toda la hoja**.
- Pero cada sección trae su propia cabecera con columnas distintas. Medido en
  `Downloads/Informacion Operaciones PT 2025-1 (1).xlsx`, hoja `Op. Vinculados Economicos`:

| | Sección 1 (fila 10) | Sección 4 (fila 91) |
|---|---|---|
| Vinculado | 1 | 1 |
| Identificación | 2 | 2 |
| País | 3 | 3 |
| Tipo de operación | 5 | 5 |
| Cod | 6 | 6 |
| **Monto** | **11** — `Monto operación (valor en pesos)**` | **12** — `Monto operación 2025` |
| Saldo 2025 | — | 11 |

  Leer la sección 4 con `iMonto = 11` toma `Saldo 2025` (2.926.256.260) en vez de
  `Monto operación 2025` (14.516.485.850). Es un número plausible, y por eso peligroso.
- `:118` declara `currentSeccion = 'INGRESO'` y `:126-131` la mueve a `EGRESO` y `OTRAS`.
  La sección 4 no se reconoce: cae en `OTRAS` por arrastre de la 3.
- `:198-206` aplica el filtro de la columna `Cod` **por sección y por hoja**: solo filtra si
  alguna fila de esa sección trae código. Hay que reproducir ese patrón, no inventar otro.

- [ ] **Step 1: Escribir las pruebas que fallan**

Añadir al final de `frontend/src/services/excelOperationsParser.test.js`. Los helpers
`workbookToFakeFile` y `workbookConHoja` ya están al principio de ese archivo (`:6-15`);
reutilizarlos.

```js
/* ── Sección «4. INFORMACIÓN ADICIONAL» ──────────────────────────────────────────
   La sección 4 son las operaciones que no afectan el estado de resultados: préstamos
   (61), reintegros o reembolsos de gastos (62) y operaciones a nombre de vinculados (63).
   Su cabecera de columnas NO es la de la sección 1: el monto está una columna más a la
   derecha y justo antes viene «Saldo 2025», que es lo que se leía por error. */

/* Hoja con las cuatro secciones, con las cabeceras y las posiciones de columna del
   archivo real. Las secciones 3 y 4 tienen 13 columnas y la 1 y la 2 tienen 12. */
function hojaConLasCuatroSecciones({ filasAdicional = [], filaIngreso = null } = {}) {
  const filas = [];
  for (let i = 0; i < 7; i++) filas.push(['(portada)']);
  // Sección 1
  filas.push(['1.', 'OPERACIONES DE INGRESO']);
  filas.push(['']);
  filas.push(['', 'Vinculado (razón social)', 'Número de Identificación fiscal del país de origen',
    'País de origen', 'Ciudad', 'Tipo de operación*', 'Cod', '', 'Formato', 'Concepto', '',
    'Monto operación (valor en pesos)**']);
  if (filaIngreso) filas.push(filaIngreso);
  // Sección 2
  filas.push(['2.', 'OPERACIONES DE EGRESO']);
  filas.push(['']);
  filas.push(['', 'Vinculado (razón social)', 'Número de Identificación fiscal del país de origen',
    'País de origen', 'Ciudad', 'Tipo de operación*', 'Cod', '', 'Formato', 'Concepto', '',
    'Monto operación (valor en pesos)***', 'Valor Deducible y No deducible']);
  filas.push(['', 'MONTACHEM INTERNATIONAL INC', '760575817', 'EEUU', 'FORTLAUDERDALE',
    'Compra neta de inventarios para distribución', '31', '', '1001', '5007', '', 18836847464]);
  // Sección 3
  filas.push(['3.', 'OTRAS OPERACIONES']);
  filas.push(['']);
  filas.push(['', 'Vinculado (razón social)', 'Número de Identificación fiscal del país de origen',
    'Pais de origen', 'Ciudad', 'Tipo de operación*', 'Cod', 'Movimiento Débito 2025', '',
    'Movimiento crédito 2025', '', 'Saldo 2025', 'Monto operación 2025']);
  // Sección 4
  filas.push(['4.', 'INFORMACIÓN ADICIONAL']);
  filas.push(['']);
  filas.push(['', 'Vinculado (razón social)', 'Número de Identificación fiscal del país de origen',
    'País de origen', 'Ciudad', 'Tipo de operación*', 'Cod', 'Movimiento Débito 2025', '',
    'Movimiento crédito 2025', '', 'Saldo 2025', 'Monto operación 2025']);
  filas.push(...filasAdicional);
  filas.push(['Tipos de Operacion según DIAN']);
  return workbookConHoja('Op. Vinculados Economicos', filas);
}

/* La fila 93 del archivo real, verbatim. Índice 11 = Saldo, índice 12 = Monto operación. */
const FILA_ADICIONAL_REAL = ['', 'MONTACHEM INTERNATIONAL INC', '760575817', 'EEUU',
  'FORTLAUDERDALE',
  'Reintegros o reembolsos de gastos con vinculados que no fueron reflejados en el Estado de Resultados',
  '62', 14516485849.8, '', 12726260000, '', 2926256259.66, 14516485849.8];

test('la sección 4 se lee con SU cabecera de columnas: el monto, no el saldo', async () => {
  /* Con los índices de la sección 1 (iMonto = 11) esto devolvía 2.926.256.260 —el saldo—,
     un número plausible y por eso peligroso. */
  const wb = hojaConLasCuatroSecciones({ filasAdicional: [FILA_ADICIONAL_REAL] });

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.ok(res.adicional, 'la sección 4 tiene datos y debe devolverse');
  assert.strictEqual(Math.round(res.adicional.monto), 14516485850);
  assert.notStrictEqual(Math.round(res.adicional.monto), 2926256260, 'leyó el saldo, no el monto');
  assert.strictEqual(res.adicional.vinc, 'MONTACHEM INTERNATIONAL INC');
  assert.strictEqual(res.adicional.vinc_id, '760575817');
  assert.strictEqual(res.adicional.pais_vinc, 'EEUU');
  assert.match(res.adicional.tipo, /^Reintegros o reembolsos de gastos/);
  assert.match(res.adicional.tipo, /\(62\)$/, 'el código va pegado al nombre');
  assert.strictEqual(res.adicional.filas, 1);
  assert.strictEqual(res.adicional.contrapartes, 1);
  assert.strictEqual(res.adicional.tipos, 1);
});

test('la sección 4 no contamina el monto de la operación principal', async () => {
  /* El estudio declara la operación principal. Si la sección 4 se sumara ahí, el informe
     declararía ante la DIAN 33.353.333.314 donde hay 18.836.847.464. */
  const wb = hojaConLasCuatroSecciones({ filasAdicional: [FILA_ADICIONAL_REAL] });

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(Math.round(res.monto), 18836847464);
  assert.strictEqual(Math.round(res.monto_operacion), 18836847464);
  assert.strictEqual(Math.round(res.t_s), 18836847464);
  assert.strictEqual(res.egreso, true, 'sin ingresos, la principal es el egreso');
});

test('la sección 4 no entra en los egresos descartados', async () => {
  /* El aviso de egresos descartados existe para que no se pierda plata del formato 1001.
     La sección 4 no es un egreso: contarla ahí infla el aviso y confunde a quien lo lee. */
  const wb = hojaConLasCuatroSecciones({
    filasAdicional: [FILA_ADICIONAL_REAL],
    filaIngreso: ['', 'MONTACHEM INTERNATIONAL INC', '760575817', 'EEUU', 'FORTLAUDERDALE',
      'Otros servicios', '07', '', '1007', '4001', '', 5000000000],
  });

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(Math.round(res.monto), 5000000000, 'la principal es el ingreso');
  assert.strictEqual(res.egresosDescartados.filas, 1, 'solo la fila de la sección 2');
  assert.strictEqual(Math.round(res.egresosDescartados.monto), 18836847464);
});

test('sin sección 4 el campo es null y no un cero disfrazado', async () => {
  /* `null` y `0` no dicen lo mismo: cero es «hubo operaciones y suman cero», null es «no
     hubo». La previsualización del paso 2 y el borrado de la tabla dependen de la
     diferencia. */
  const wb = hojaConLasCuatroSecciones({ filasAdicional: [] });

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.adicional, null);
});

test('varias filas del mismo código se suman en un solo tipo', async () => {
  const wb = hojaConLasCuatroSecciones({
    filasAdicional: [
      ['', 'ACME LLC', '900111', 'EEUU', 'MIAMI', 'Reintegros o reembolsos de gastos', '62',
        '', '', '', '', 1, 8000000000],
      ['', 'ACME LLC', '900111', 'EEUU', 'MIAMI', 'Reintegros o reembolsos de gastos', '62',
        '', '', '', '', 2, 6516485850],
    ],
  });

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.adicional.monto, 14516485850);
  assert.strictEqual(res.adicional.filas, 2);
  assert.strictEqual(res.adicional.tipos, 1);
  assert.strictEqual(res.adicional.contrapartes, 1);
});

test('con códigos 61 y 62 gana el tipo dominante por monto y se cuenta la divergencia', async () => {
  /* El estudio guarda UN tipo. Cuando la sección trae dos, el informe declara el
     dominante y `tipos` es lo que permite avisarlo en el paso 2. */
  const wb = hojaConLasCuatroSecciones({
    filasAdicional: [
      ['', 'ACME LLC', '900111', 'EEUU', 'MIAMI', 'Préstamos con vinculados', '61',
        '', '', '', '', 1, 1000000000],
      ['', 'ACME LLC', '900111', 'EEUU', 'MIAMI', 'Reintegros o reembolsos de gastos', '62',
        '', '', '', '', 2, 9000000000],
    ],
  });

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.adicional.monto, 10000000000, 'se suma todo, no solo el dominante');
  assert.strictEqual(res.adicional.tipos, 2);
  assert.match(res.adicional.tipo, /\(62\)$/, 'el dominante por monto es el 62');
});

test('dos contrapartes en la sección 4: se cuentan y se guarda la primera', async () => {
  const wb = hojaConLasCuatroSecciones({
    filasAdicional: [
      ['', 'ACME LLC', '900111', 'EEUU', 'MIAMI', 'Reintegros o reembolsos de gastos', '62',
        '', '', '', '', 1, 3000000000],
      ['', 'BETA GMBH', '900222', 'ALEMANIA', 'BERLIN', 'Reintegros o reembolsos de gastos', '62',
        '', '', '', '', 2, 4000000000],
    ],
  });

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.adicional.contrapartes, 2);
  assert.strictEqual(res.adicional.vinc, 'ACME LLC', 'la primera del archivo');
  assert.strictEqual(res.adicional.monto, 7000000000, 'la suma de las dos');
});

test('la columna Cod vacía en toda la sección 4 no descarta sus filas', async () => {
  /* Mismo criterio que en ingresos y egresos: `Cod` es opcional en el formato. Si nadie la
     diligenció no distingue nada, así que no puede filtrar; exigirla vaciaba la sección
     entera sin ninguna señal de por qué. */
  const wb = hojaConLasCuatroSecciones({
    filasAdicional: [
      ['', 'ACME LLC', '900111', 'EEUU', 'MIAMI', 'Reintegros o reembolsos de gastos', '',
        '', '', '', '', 1, 3000000000],
    ],
  });

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.adicional.monto, 3000000000);
  assert.strictEqual(res.adicional.tipo, 'Reintegros o reembolsos de gastos',
    'sin código, el tipo va tal cual y sin paréntesis inventado');
});

test('con Cod diligenciada en parte de la sección 4, las filas sin código son auxiliares', async () => {
  /* Es el mismo filtro calibrado por sección que ya usan ingresos y egresos: cuando
     alguien SÍ usa la columna, las filas sin código son renglones auxiliares. */
  const wb = hojaConLasCuatroSecciones({
    filasAdicional: [
      ['', 'ACME LLC', '900111', 'EEUU', 'MIAMI', 'Reintegros o reembolsos de gastos', '62',
        '', '', '', '', 1, 3000000000],
      ['', 'ACME LLC', '900111', 'EEUU', 'MIAMI', '', '', '', '', '', '', 2, 500000000],
    ],
  });

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.adicional.monto, 3000000000, 'la fila sin código no suma');
  assert.strictEqual(res.adicional.filas, 1);
});

test('el país de la sección 4 se traduce con la misma tabla que la operación principal', async () => {
  /* El formato trae el país como código numérico. Si la sección 4 no lo tradujera, el
     informe publicaría «484» donde la Tabla 3 publica «MEXICO». */
  const wb = hojaConLasCuatroSecciones({
    filasAdicional: [
      ['', 'ACME MEXICO', '900111', '484', 'CDMX', 'Reintegros o reembolsos de gastos', '62',
        '', '', '', '', 1, 3000000000],
    ],
  });

  const res = await parseExcelOperations(workbookToFakeFile(wb));

  assert.strictEqual(res.adicional.pais_vinc, 'MEXICO');
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `node --test frontend/src/services/excelOperationsParser.test.js`
Expected: FAIL. La primera falla en `assert.ok(res.adicional)` — el campo no existe todavía.

- [ ] **Step 3: Redetectar los índices de columna por sección**

En `excelOperationsParser.js`, la detección de `:88-104` se saca a una función y se vuelve a
llamar cada vez que aparece una cabecera dentro del recorrido. Reemplazar el bloque
`:88-104` por:

```js
      /* Los índices de columna de UNA cabecera. Antes esto se calculaba una sola vez por
         hoja, con la cabecera de la sección 1, y las secciones 3 y 4 se leían con columnas
         ajenas: su monto está una columna más a la derecha y justo antes viene «Saldo
         2025», así que la sección 4 devolvía el saldo por monto —un número plausible, y
         por eso peligroso—. */
      const indicesDeCabecera = (enc) => ({
        iNom: enc.findIndex(x => String(x).toLowerCase().includes('vinculado') || String(x).toLowerCase().includes('razón social')),
        iNit: enc.findIndex(x => String(x).toLowerCase().includes('identificaci')),
        // Excluye la columna de identificación: su encabezado ("Número de
        // Identificación fiscal del país de origen") también contiene 'país',
        // y sin este filtro ganaba por estar antes que "País de origen".
        iPais: enc.findIndex(x => {
          const s = String(x).toLowerCase();
          return (s.includes('país') || s.includes('pais')) && !s.includes('identificaci');
        }),
        iTipo: enc.findIndex(x => String(x).toLowerCase().includes('tipo de operaci')),
        /* «monto» y no «movimiento»: en las secciones 3 y 4 los índices 7 y 9 son
           «Movimiento Débito/crédito 2025», que no contienen la palabra. */
        iMonto: enc.findIndex(x => String(x).toLowerCase().includes('monto')),
        // Columna 'Cod' (código de operación DIAN). Cuando existe, solo cuentan
        // como operación real las filas que la tengan diligenciada: filas sin
        // código son renglones auxiliares del mismo formato/concepto (ej.
        // retención, IVA) que no son la operación de ingreso en sí.
        iCod: enc.findIndex(x => String(x).trim().toLowerCase() === 'cod'),
      });

      /* Una fila es cabecera de sección si nombra la identificación fiscal y el vinculado.
         Es la misma señal que usa la detección inicial (`identificaci`), reforzada con
         'vinculado' para no confundirla con una fila de datos. */
      const esFilaDeCabecera = (f) => {
        const s = (f || []).join(' ').toLowerCase();
        return s.includes('identificaci') && s.includes('vinculado');
      };

      let { iNom, iNit, iPais, iTipo, iMonto, iCod } = indicesDeCabecera(d[encIdx] || []);
```

Y dentro del bucle `for` de `:120`, justo después de `const rowJoined = f.join(' ').toUpperCase();`
(hoy `:125`), añadir:

```js
        /* Cada sección trae su propia cabecera y sus propias columnas. Redetectar aquí es
           lo que hace que la sección 4 lea «Monto operación 2025» y no «Saldo 2025». */
        if (esFilaDeCabecera(f)) {
          ({ iNom, iNit, iPais, iTipo, iMonto, iCod } = indicesDeCabecera(f));
          currentTipo = '';
          continue;
        }
```

Nota para el implementador: `iNom`…`iCod` pasan de `const` a `let` (van en el
destructuring reasignable de arriba). `currentTipo` se limpia porque el tipo se arrastra
entre filas de la misma sección (`:141`) y arrastrarlo de una sección a otra atribuiría el
concepto de la sección 2 a la primera fila de la 4.

- [ ] **Step 4: Añadir la sección `ADICIONAL` a la máquina de secciones**

Justo antes de la línea de `OTRAS OPERACIONES` (hoy `:131`), añadir:

```js
        /* «4. INFORMACIÓN ADICIONAL»: préstamos (61), reintegros o reembolsos de gastos
           (62) y operaciones a nombre de vinculados (63). No afectan el estado de
           resultados, así que no son ni ingreso ni egreso, pero por encima de 45.000 UVT
           hay que documentarlas en el informe. Antes caían en 'OTRAS' por arrastre de la
           sección 3 y no salían a ninguna parte.
           Se compara sin tildes: `rowJoined` está en mayúsculas pero conserva la Ó. */
        if (rowJoined.normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes('INFORMACION ADICIONAL')) {
          currentSeccion = 'ADICIONAL';
          continue;
        }
```

Declarar el acumulador de la hoja junto a `candidatasIngreso`/`candidatasEgreso` (hoy
`:113-115`):

```js
      const candidatasAdicional = [];
```

Y la rama de acumulación, junto a las de ingreso y egreso (tras el bloque de `:186-195`):

```js
        if (monto > 0 && currentSeccion === 'ADICIONAL') {
          candidatasAdicional.push({
            vinculado: nom,
            nit,
            pais,
            tipo: tipoConCodigo(currentTipo, cod),
            monto,
            cod
          });
        }
```

El filtro de `Cod`, junto a los otros dos (tras `:208`):

```js
      /* Mismo filtro calibrado por sección que ingresos y egresos: solo filtra si alguien
         diligenció la columna en esta sección de esta hoja. */
      const codEnUsoAdicional = candidatasAdicional.some(c => c.cod !== '');
      candidatasAdicional.forEach(({ cod, ...operacion }) => {
        if (!codEnUsoAdicional || cod !== '') rowsParsedAdicional.push(operacion);
      });
```

Declarar `rowsParsedAdicional` junto a `rowsParsedIngreso`/`rowsParsedEgreso` (hoy
`:39-40`), fuera del `forEach` de hojas:

```js
    const rowsParsedAdicional = [];
```

- [ ] **Step 5: Sacar el agregado a una función y devolverlo**

La traducción de país de `:255-268` y la elección del tipo dominante de `:228-243` se
necesitan dos veces. Sacarlas a funciones de módulo, arriba del `export`, y usarlas en los
dos sitios para que no haya dos copias que divergan:

```js
/* Nombre de país a partir de un código numérico, con la tabla que ya usa el resto del
   sistema. El 249 se conserva aparte porque no está en `PAIS_DIAN` y es el que trae el
   formato de operaciones. OJO: la tabla dice que Estados Unidos es 840, así que las dos
   codificaciones no son la misma y hay que decidir cuál exige la DIAN antes de radicar. */
const nombrePorCodigo = Object.fromEntries(
  Object.entries(PAIS_DIAN).map(([nombre, codigo]) => [codigo, nombre])
);

function traducirPais(pais) {
  const codigo = String(pais || '').trim();
  if (!/^\d+$/.test(codigo)) return pais;
  return nombrePorCodigo[codigo] || nombrePorCodigo[codigo.padStart(3, '0')]
    || (codigo === '249' ? 'ESTADOS UNIDOS' : pais);
}

/* El tipo que más monto acumula. Las filas sin tipo no aportan concepto y se ignoran:
   agruparlas bajo un nombre inventado hacía que ese nombre ganara por monto y se
   declarara como el concepto del estudio. Devuelve `{tipo, tipos}` porque quien llama
   necesita las dos cosas: cuál declarar y cuántos había para poder avisar. */
function tipoDominante(filas) {
  const porTipo = {};
  filas.forEach(r => {
    if (!r.tipo) return;
    porTipo[r.tipo] = (porTipo[r.tipo] || 0) + r.monto;
  });
  let tipo = null;
  let max = 0;
  Object.keys(porTipo).forEach(k => {
    if (porTipo[k] > max) { max = porTipo[k]; tipo = k; }
  });
  return { tipo, tipos: Object.keys(porTipo).length };
}

/* Contrapartes distintas: se agrupa por NIT y se cae al nombre cuando el NIT falta. */
const contarContrapartes = (filas) => new Set(
  filas.map(r => (r.nit || r.vinculado || '').trim().toUpperCase()).filter(Boolean)
).size;
```

Reescribir `:228-243` (`tipoMap` / `mainTipo`) y `:255-268` (`paisNombre`) para que usen
esas funciones, sin cambiar su resultado. Después, antes del `return`, armar el agregado:

```js
    /* El agregado de la sección 4. La sección se resuelve en UN registro porque la tabla
       del informe es una ficha vertical de un vinculado: se suma todo, se declara el tipo
       dominante y se cuentan las divergencias para poder avisarlas en el paso 2.
       `null` y no un cero: cero significaría «hubo operaciones y suman cero». */
    let adicional = null;
    if (rowsParsedAdicional.length > 0) {
      const montoAdicional = rowsParsedAdicional.reduce((acc, r) => acc + r.monto, 0);
      const { tipo, tipos } = tipoDominante(rowsParsedAdicional);
      adicional = {
        vinc: rowsParsedAdicional.find(r => r.vinculado)?.vinculado || null,
        vinc_id: rowsParsedAdicional.find(r => r.nit)?.nit || null,
        pais_vinc: traducirPais(rowsParsedAdicional.find(r => r.pais)?.pais || '') || null,
        tipo,
        monto: montoAdicional,
        filas: rowsParsedAdicional.length,
        contrapartes: contarContrapartes(rowsParsedAdicional),
        tipos,
      };
    }
```

Y añadirlo al objeto que se devuelve (`:281-296`), sin tocar ningún campo existente:

```js
      adicional,
```

- [ ] **Step 6: Correr las pruebas y verificar que pasan**

Run: `node --test frontend/src/services/excelOperationsParser.test.js`
Expected: PASS — las 10 nuevas y todas las que ya había.

- [ ] **Step 7: Verificar contra el archivo real**

Las pruebas usan una hoja sintética. Verificar contra el archivo del que salió el caso:

```bash
node -e "const X=require('./frontend/node_modules/xlsx-js-style');const wb=X.readFile('D:/G/Juan-Mendez/Downloads/Informacion Operaciones PT 2025-1 (1).xlsx');const d=X.utils.sheet_to_json(wb.Sheets['Op. Vinculados Economicos'],{header:1,defval:''});console.log('fila 93 col 11 (saldo):',d[92][11]);console.log('fila 93 col 12 (monto):',d[92][12]);"
```

Expected: `saldo: 2926256259.6560993` y `monto: 14516485849.8`. El motor debe devolver el
segundo.

- [ ] **Step 8: Correr la suite completa y el lint**

Run: `npm test`
Expected: todo en verde.

Run: `npm run lint --prefix frontend`
Expected: sin hallazgos. Si oxlint marca el destructuring con `let`, ajustar a asignaciones
sueltas — no cambiar la lógica.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/services/excelOperationsParser.js frontend/src/services/excelOperationsParser.test.js
git commit -m "feat: el motor lee la seccion 4 (informacion adicional) con sus propias columnas"
```

---

### Task 3: La tabla «Operación adicional Transacciones Intercompañía»

**Files:**
- Modify: `frontend/src/services/tablasOperaciones.js` (nueva función tras
  `filasTransaccionesIntercompania`, que hoy acaba en `:118`)
- Test: `frontend/src/services/tablasOperaciones.test.js`

**Interfaces:**
- Consumes: nada de las tareas anteriores. Lee del estudio los campos `adic_vinc`,
  `adic_vinc_id`, `adic_pais`, `adic_tipo`, `adic_monto`, `adic_tipo_vinculacion` y `ent`.
  Los escribe la Task 7; aquí solo se leen, así que no hay dependencia de orden.
- Produces:
  `filasOperacionAdicional(estudio) → {nombre, encabezados, filas, fuente}`
  con `nombre === 'Operación adicional Transacciones Intercompañía'`, dos encabezados
  (`['Compañía vinculada', '']`) y **seis** filas de `[etiqueta, valor]`.

**Contexto.** Es la gemela de `filasTransaccionesIntercompania` (`:103-118`). Las
diferencias, tomadas del informe del cliente: la etiqueta del concepto es
`Tipo de operaciones (Información adicional)` (fija, no varía con `egreso` como sí hace la
Tabla 3 en `:114`) y el tipo de vinculación por omisión es `Articulo 260-1 numeral 2`.

`wrap` y `SIN_DATO` ya existen en el archivo (`:19-21`); `montoDeLaOperacion` está en
`:50-54` y hay que escribir su gemelo para `adic_monto`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Añadir a `frontend/src/services/tablasOperaciones.test.js`:

```js
/* ── Operación adicional Transacciones Intercompañía ────────────────────────── */

const ESTUDIO_CON_ADICIONAL = {
  ent: 'MONTACHEM COLOMBIA S.A.S',
  vinc: 'OTRO VINCULADO QUE NO ES EL DE LA SECCIÓN 4',
  vinc_tipo: 'Compra neta de inventarios para distribución (31)',
  monto_operacion: 18836847464,
  adic_vinc: 'MONTACHEM INTERNATIONAL INC',
  adic_vinc_id: '760575817',
  adic_pais: 'EEUU',
  adic_tipo: 'Reintegros o reembolsos de gastos con vinculados que no fueron reflejados en el Estado de Resultados (62)',
  adic_monto: 14516485850,
};

test('la tabla de operación adicional publica las seis filas de la ficha del vinculado', () => {
  const t = filasOperacionAdicional(ESTUDIO_CON_ADICIONAL);

  assert.strictEqual(t.nombre, 'Operación adicional Transacciones Intercompañía');
  assert.deepStrictEqual(t.encabezados, ['Compañía vinculada', '']);
  assert.strictEqual(t.filas.length, 6);
  assert.deepStrictEqual(t.filas[0], ['Razón social', 'MONTACHEM INTERNATIONAL INC']);
  assert.deepStrictEqual(t.filas[1], ['Identificación fiscal', '760575817']);
  assert.deepStrictEqual(t.filas[2], ['País - Residencia fiscal', 'EEUU']);
  assert.deepStrictEqual(t.filas[3], ['Tipo de vinculación', 'Articulo 260-1 numeral 2']);
  assert.strictEqual(t.filas[4][0], 'Tipo de operaciones (Información adicional)');
  assert.match(t.filas[4][1], /\(62\)$/);
  assert.deepStrictEqual(t.filas[5], ['Monto en pesos', '14.516.485.850']);
  assert.strictEqual(t.fuente, 'Información de MONTACHEM COLOMBIA S.A.S.');
});

test('la etiqueta del concepto es fija y no cambia con el sentido de la operación principal', () => {
  /* La Tabla 3 rotula «Tipo de operaciones (Ingreso)» o «(Egreso)» según el estudio. Esta
     no: la sección 4 no es ingreso ni egreso, no afecta el estado de resultados. */
  const conEgreso = filasOperacionAdicional({ ...ESTUDIO_CON_ADICIONAL, egreso: true });
  const conIngreso = filasOperacionAdicional({ ...ESTUDIO_CON_ADICIONAL, egreso: false });

  assert.strictEqual(conEgreso.filas[4][0], 'Tipo de operaciones (Información adicional)');
  assert.strictEqual(conIngreso.filas[4][0], 'Tipo de operaciones (Información adicional)');
});

test('no toma los datos de la operación principal cuando la adicional falta', () => {
  /* Es el defecto que trae el informe de referencia, llenado a mano: su Tabla 4 publica el
     tipo y el monto de la sección 2 (código 31, que no existe en la clase «adicional»).
     Un motor que se cayera al vinculado principal repetiría ese error en cada informe. */
  const t = filasOperacionAdicional({
    ent: 'MONTACHEM COLOMBIA S.A.S',
    vinc: 'MONTACHEM INTERNATIONAL INC',
    vinc_id: '760575817',
    pais_vinc: 'EEUU',
    vinc_tipo: 'Compra neta de inventarios para distribución (31)',
    monto_operacion: 18836847464,
  });

  assert.deepStrictEqual(t.filas[0], ['Razón social', '—']);
  assert.deepStrictEqual(t.filas[4], ['Tipo de operaciones (Información adicional)', '—']);
  assert.deepStrictEqual(t.filas[5], ['Monto en pesos', '—']);
  assert.ok(!JSON.stringify(t.filas).includes('18.836.847.464'), 'se colaron los datos de la principal');
  assert.ok(!JSON.stringify(t.filas).includes('(31)'), 'se coló el concepto de la principal');
});

test('un estudio vacío no deja ninguna celda en blanco', () => {
  /* La plantilla es el informe del año anterior: un hueco silencioso no queda vacío, queda
     con el dato del cliente anterior. El tipo de vinculación es la excepción: no se puede
     dejar sin sustentar. */
  const t = filasOperacionAdicional({});
  assert.strictEqual(t.filas.length, 6);
  t.filas.forEach(([etiqueta, valor]) => {
    assert.ok(String(valor).length > 0, 'celda vacía en ' + etiqueta);
  });
  assert.deepStrictEqual(t.filas[3], ['Tipo de vinculación', 'Articulo 260-1 numeral 2']);
  assert.strictEqual(t.fuente, 'Información de la Compañía.');
});

test('el tipo de vinculación del estudio gana al valor por omisión', () => {
  const t = filasOperacionAdicional({
    ...ESTUDIO_CON_ADICIONAL,
    adic_tipo_vinculacion: 'Articulo 260-1 numeral 5',
  });
  assert.deepStrictEqual(t.filas[3], ['Tipo de vinculación', 'Articulo 260-1 numeral 5']);
});

test('un monto adicional que no es número sale como «—» y no como NaN', () => {
  assert.deepStrictEqual(
    filasOperacionAdicional({ adic_monto: 'no es un monto' }).filas[5],
    ['Monto en pesos', '—']
  );
  assert.deepStrictEqual(
    filasOperacionAdicional({ adic_monto: null }).filas[5],
    ['Monto en pesos', '—']
  );
});
```

Añadir `filasOperacionAdicional` al `import` que ya tiene ese archivo de pruebas.

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `node --test frontend/src/services/tablasOperaciones.test.js`
Expected: FAIL — `filasOperacionAdicional is not a function`.

- [ ] **Step 3: Escribir la implementación mínima**

En `frontend/src/services/tablasOperaciones.js`, tras `filasTransaccionesIntercompania`
(`:118`):

```js
/** El monto de la operación adicional ya formateado, o «—». Gemelo de
 *  `montoDeLaOperacion`: campo propio porque la sección 4 no es la operación principal y
 *  caerse a `monto_operacion` publicaría la cifra de la Tabla 3 en la Tabla 4, que es
 *  justo el error que trae el informe de referencia llenado a mano. */
function montoDeLaOperacionAdicional(estudio) {
  const n = num(estudio && estudio.adic_monto);
  return n === null ? SIN_DATO : fmt(n);
}

/**
 * Tabla «Operación adicional Transacciones Intercompañía»: la ficha del vinculado de la
 * sección «4. INFORMACIÓN ADICIONAL» del Excel de operaciones.
 *
 * Misma forma que `filasTransaccionesIntercompania` y campos DISTINTOS: la contraparte de
 * la sección 4 puede no ser la de la operación principal, y confundirlas es el error que
 * trae el informe de referencia (publica el tipo 31 —de egreso— bajo el rótulo de
 * información adicional).
 *
 * La etiqueta del concepto es fija y no alterna Ingreso/Egreso como la Tabla 3: estas
 * operaciones —préstamos (61), reintegros (62), operaciones a nombre de vinculados (63)—
 * no afectan el estado de resultados, así que no son ni lo uno ni lo otro.
 *
 * @returns {{nombre:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasOperacionAdicional(estudio) {
  const e = estudio || {};
  return {
    nombre: 'Operación adicional Transacciones Intercompañía',
    encabezados: ['Compañía vinculada', ''],
    filas: [
      ['Razón social', wrap(e.adic_vinc)],
      ['Identificación fiscal', wrap(e.adic_vinc_id)],
      ['País - Residencia fiscal', wrap(e.adic_pais)],
      /* Como en la Tabla 3, no es un dato que se pueda dejar en blanco: la vinculación hay
         que sustentarla. El numeral 2 es el del caso más común en esta tabla y el estudio
         puede corregirlo. */
      ['Tipo de vinculación', wrap(e.adic_tipo_vinculacion || 'Articulo 260-1 numeral 2')],
      ['Tipo de operaciones (Información adicional)', wrap(e.adic_tipo)],
      ['Monto en pesos', montoDeLaOperacionAdicional(e)],
    ],
    fuente: 'Información de ' + (e.ent || 'la Compañía') + '.',
  };
}
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `node --test frontend/src/services/tablasOperaciones.test.js`
Expected: PASS — las 6 nuevas y todas las anteriores.

- [ ] **Step 5: Correr la suite completa y el lint**

Run: `npm test` && `npm run lint --prefix frontend`
Expected: verde y limpio.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/tablasOperaciones.js frontend/src/services/tablasOperaciones.test.js
git commit -m "feat: definicion de la tabla Operacion adicional Transacciones Intercompania"
```

---

### Task 4: Primitivas de los localizadores — excluir candidatos y borrar una tabla

**Files:**
- Modify: `frontend/src/services/docxRelleno.js:743-794` (`localizarBloqueTabla`) y
  `:1220-1244` (`sustituidorDeTablas`)
- Modify: `frontend/src/services/tablasHtmlInforme.js:113-192` (`localizarTablasHtml`) y
  `:97-99` (`localizarTablaHtml`)
- Test: `frontend/src/services/docxRelleno.test.js`,
  `frontend/src/services/tablasOperacionesHtml.test.js`

**Interfaces:**
- Consumes: nada de las tareas anteriores.
- Produces:
  - `localizarBloqueTabla(xml, nombres, opciones)` acepta `opciones.excluir: string[]` —
    nombres cuya clave descarta un candidato.
  - `localizarTablasHtml(html, nombres, opciones)` y
    `localizarTablaHtml(html, nombres, opciones)` aceptan el mismo `opciones.excluir`.
  - `sustituidorDeTablas(...).borrar(nombres, opciones) → boolean` — quita el bloque
    (rótulo + tabla) y la línea `FUENTE:` que le sigue. `false` si la tabla no estaba, y en
    ese caso **no** anota nada en `avisos`.
  - `borrarTablaHtml(html, bloque) → string` exportada de `tablasHtmlInforme.js` — quita
    `bloque.rotulo`, el tramo `bloque.inicio..fin` y el párrafo `FUENTE:` siguiente.

**Por qué hace falta el `excluir`.** Las dos rutas localizan por inclusión de clave
(`docxRelleno.js:754`, `tablasHtmlInforme.js:142`). `claveTitulo`
(`docxRelleno.js:599-608`) normaliza sin tildes y sin puntuación:

| Rótulo | Clave |
|---|---|
| `Tabla 3. Transacciones Inter compañía` | `transacciones inter compania` |
| `Tabla 4. Operación adicional Transacciones Intercompañía` | `operacion adicional transacciones intercompania` |

La segunda no contiene a la primera **solo porque el informe de referencia escribe
«Intercompañía» junto y «Inter compañía» separado**. Es una casualidad de un carácter: si
la plantilla de un cliente la escribe separada, el buscador de la Tabla 3 captura la Tabla 4
y la sobrescribe con los datos de la operación principal. Es el mismo defecto que ya
documenta `tablasOperacionesHtml.js:10-12` con «Otros servicios» dentro de «Otros servicios
(07)».

**Por qué el borrado tiene que llevarse la línea FUENTE.** El bloque localizado va del
párrafo del rótulo al cierre de la tabla (`docxRelleno.js:773-775`); la línea
`FUENTE: …` que la plantilla trae **detrás** de la tabla queda fuera. Al sustituir no
importa, porque `generarTablaOoxml` emite su propia línea (`:202-203`). Al borrar sí: la
fuente queda huérfana bajo la tabla siguiente, atribuyéndole un origen que no es el suyo.

- [ ] **Step 1: Escribir las pruebas que fallan**

En `frontend/src/services/docxRelleno.test.js`, añadir (importar `localizarBloqueTabla` si
no está ya en el `import`):

```js
test('localizarBloqueTabla descarta los candidatos que excluir nombra', () => {
  /* Sin esta guarda, «Transacciones Inter compañía» captura «Operación adicional
     Transacciones Inter compañía» —la clave de la segunda contiene a la de la primera— y
     la Tabla 4 se sobrescribe con los datos de la operación principal. Que hoy no pase es
     una casualidad ortográfica de un carácter: «Intercompañía» junto vs separado. */
  const xml =
    '<w:p><w:t>Tabla 4. Operación adicional Transacciones Inter compañía</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>ADICIONAL</w:t></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:t>Tabla 12. Transacciones Inter compañía</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>PRINCIPAL</w:t></w:p></w:tc></w:tr></w:tbl>';

  const sinGuarda = localizarBloqueTabla(xml, 'Transacciones Inter compañía');
  assert.strictEqual(sinGuarda.numero, 4, 'sin guarda gana la Tabla 4, que es la de antes');

  const conGuarda = localizarBloqueTabla(xml, 'Transacciones Inter compañía', {
    excluir: ['Operación adicional'],
  });
  assert.strictEqual(conGuarda.numero, 12, 'con guarda solo queda la Tabla 12');
});

test('excluir no estorba cuando ninguna tabla coincide con la exclusión', () => {
  const xml =
    '<w:p><w:t>Tabla 3. Transacciones Inter compañía</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>x</w:t></w:p></w:tc></w:tr></w:tbl>';
  const b = localizarBloqueTabla(xml, 'Transacciones Inter compañía', {
    excluir: ['Operación adicional'],
  });
  assert.strictEqual(b.numero, 3);
});
```

En `frontend/src/services/tablasOperacionesHtml.test.js`, añadir (importando de
`./tablasHtmlInforme.js`):

```js
import { localizarTablaHtml, borrarTablaHtml } from './tablasHtmlInforme.js';

test('localizarTablaHtml descarta los candidatos que excluir nombra', () => {
  const html =
    '<p><strong> Tabla 4. Operación adicional Transacciones Inter compañía</strong></p>' +
    '<table><tr><th><p> ADICIONAL</p></th></tr></table>' +
    '<p><strong> Tabla 12. Transacciones Inter compañía</strong></p>' +
    '<table><tr><th><p> PRINCIPAL</p></th></tr></table>';

  const sinGuarda = localizarTablaHtml(html, 'Transacciones Inter compañía');
  assert.match(html.slice(sinGuarda.inicio, sinGuarda.fin), /ADICIONAL/);

  const conGuarda = localizarTablaHtml(html, 'Transacciones Inter compañía', {
    excluir: ['Operación adicional'],
  });
  assert.match(html.slice(conGuarda.inicio, conGuarda.fin), /PRINCIPAL/);
});

test('borrarTablaHtml se lleva el rótulo, la tabla y su línea FUENTE', () => {
  /* La línea de fuente vive DETRÁS de la tabla, fuera del bloque localizado. Dejarla
     huérfana le atribuye su origen a la tabla siguiente. */
  const html =
    '<p> antes</p>' +
    '<p><strong> Tabla 4. Operación adicional Transacciones Intercompañía</strong></p>' +
    '<table><tr><th><p> BORRAR ESTO</p></th></tr></table>' +
    '<p><strong>FUENTE: Información de MONTACHEM COLOMBIA S.A.S.</strong></p>' +
    '<p> después</p>';

  const bloque = localizarTablaHtml(html, 'Operación adicional Transacciones Intercompañía');
  const salida = borrarTablaHtml(html, bloque);

  assert.ok(!salida.includes('BORRAR ESTO'), 'sobrevivió la tabla');
  assert.ok(!salida.includes('Tabla 4.'), 'sobrevivió el rótulo');
  assert.ok(!salida.includes('FUENTE:'), 'sobrevivió la fuente huérfana');
  assert.match(salida, /antes/);
  assert.match(salida, /después/);
});

test('borrarTablaHtml no toca un párrafo que no sea la fuente', () => {
  const html =
    '<p><strong> Tabla 4. Operación adicional Transacciones Intercompañía</strong></p>' +
    '<table><tr><th><p> BORRAR ESTO</p></th></tr></table>' +
    '<p> Las anteriores operaciones fueron realizadas con intercompañías.</p>';

  const bloque = localizarTablaHtml(html, 'Operación adicional Transacciones Intercompañía');
  const salida = borrarTablaHtml(html, bloque);

  assert.ok(!salida.includes('BORRAR ESTO'));
  assert.match(salida, /Las anteriores operaciones/, 'se llevó prosa del informe');
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `node --test frontend/src/services/docxRelleno.test.js frontend/src/services/tablasOperacionesHtml.test.js`
Expected: FAIL — la primera por `numero` 4 donde se espera 12; las de HTML por
`borrarTablaHtml is not a function`.

- [ ] **Step 3: Añadir `excluir` a los dos localizadores**

En `docxRelleno.js`, dentro de `localizarBloqueTabla`, tras calcular `claves` (`:745`):

```js
  /* Nombres que DESCARTAN un candidato. La comparación es por inclusión, así que un rótulo
     más largo que contenga al buscado gana por estar antes en el documento: «Operación
     adicional Transacciones Inter compañía» se lleva lo que pedía la Tabla 3. Que hoy no
     colisionen es una casualidad de un carácter —«Intercompañía» junto en la plantilla de
     referencia—, y no se puede depender de cómo escriba cada cliente. */
  const excluidas = (Array.isArray(opciones.excluir) ? opciones.excluir : [])
    .map(claveTitulo).filter(Boolean);
```

Y en la comparación de `:754`:

```js
    if (!clave || !claves.some((c) => clave.includes(c))) continue;
    if (excluidas.some((c) => clave.includes(c))) continue;
```

`candidatosPorFilaTitulo` (`:783`) también aporta candidatos por rótulo embebido. Filtrar su
resultado igual, justo después de esa línea:

```js
  candidatos.push(...candidatosPorFilaTitulo(texto, claves)
    .filter((c) => !excluidas.some((e) => claveTitulo(c.titulo).includes(e))));
```

En `tablasHtmlInforme.js`, cambiar las dos firmas y aplicar lo mismo:

```js
export function localizarTablaHtml(html, nombres, opciones = {}) {
  return localizarTablasHtml(html, nombres, opciones)[0] || null;
}
```

```js
export function localizarTablasHtml(html, nombres, opciones = {}) {
  const texto = String(html || '');
  const claves = (Array.isArray(nombres) ? nombres : [nombres]).map(claveTitulo).filter(Boolean);
  if (!claves.length) return [];
  /* Igual que en la ruta OOXML: un rótulo más largo que contenga al buscado lo captura. */
  const excluidas = (Array.isArray(opciones.excluir) ? opciones.excluir : [])
    .map(claveTitulo).filter(Boolean);
```

y en la comparación de `:142`:

```js
    if (!clave || !claves.some((c) => clave.includes(c))) continue;
    if (excluidas.some((c) => clave.includes(c))) continue;
```

Nota: `claveTitulo` ya está importada en `tablasHtmlInforme.js`. Si no lo estuviera,
importarla de `./docxRelleno.js`, que es donde se exporta (`:599`).

- [ ] **Step 4: Añadir el borrado a las dos rutas**

En `tablasHtmlInforme.js`, junto a las otras primitivas:

```js
/* Un párrafo cuyo texto plano abre con «FUENTE:» o «Fuente:». Es la línea que la plantilla
   pone DEBAJO de la tabla, fuera del bloque que devuelve `localizarTablasHtml`. */
const RX_PARRAFO_SIGUIENTE = /^\s*<p(?:\s[^>]*)?>[\s\S]*?<\/p\s*>/i;

/**
 * Quita del informe una tabla completa: su rótulo, la tabla y la línea de fuente que la
 * sigue.
 *
 * La fuente hay que llevársela a mano porque no está dentro del bloque localizado —el
 * bloque acaba en `</table>`—. Al sustituir da igual, porque la tabla nueva emite la suya;
 * al borrar, una fuente huérfana queda bajo la tabla siguiente y le atribuye un origen que
 * no es el suyo.
 *
 * @param {string} html
 * @param {{inicio:number, fin:number, rotulo:{inicio:number, fin:number}|null}} bloque
 * @returns {string}
 */
export function borrarTablaHtml(html, bloque) {
  if (!bloque) return String(html || '');
  const texto = String(html || '');

  /* De atrás hacia adelante: borrar el rótulo primero desplazaría los offsets de la tabla,
     que es sobre lo que se calculó el bloque. */
  let fin = bloque.fin;
  const siguiente = RX_PARRAFO_SIGUIENTE.exec(texto.slice(fin));
  if (siguiente && /^\s*fuente\s*:/i.test(textoPlanoHtml(siguiente[0]))) {
    fin += siguiente[0].length;
  }

  /* El rótulo va antes que la tabla en el documento, así que se recorta el tramo entero
     desde el rótulo (si lo hay y es externo) hasta el final de la fuente, en un solo corte. */
  const desde = (bloque.rotulo && bloque.rotulo.inicio < bloque.inicio)
    ? bloque.rotulo.inicio
    : bloque.inicio;
  return texto.slice(0, desde) + texto.slice(fin);
}
```

En `docxRelleno.js`, añadir el método al objeto que devuelve `sustituidorDeTablas`
(`:1222-1243`), junto a `reemplazar`:

```js
    /** Quita la tabla, su rótulo y la línea FUENTE que la sigue. `true` si estaba.
     *
     *  NO anota en `avisos` cuando no la encuentra: ese arreglo se publica como «No se
     *  encontró en la plantilla: X» y alimenta el semáforo de radicación. Una tabla que se
     *  quiere borrar y no está es el resultado deseado, no un hallazgo. */
    borrar(nombres, opciones) {
      const bloque = localizarBloqueTabla(out, nombres, opciones);
      if (!bloque) return false;
      /* La fuente vive detrás del cierre de la tabla, fuera del bloque. Al sustituir no
         importa —`generarTablaOoxml` emite la suya—, pero al borrar quedaría huérfana bajo
         la tabla siguiente, atribuyéndole un origen que no es el suyo. */
      let fin = bloque.fin;
      const hermano = parrafoHermanoSiguiente(out, fin);
      if (hermano && hermano.xml && /^\s*fuente\s*:/i.test(textoPlanoOoxml(hermano.xml))) {
        fin = hermano.fin;
      }
      out = out.slice(0, bloque.inicio) + out.slice(fin);
      return true;
    },
```

`parrafoHermanoSiguiente` (`:827`) y `textoPlanoOoxml` ya existen en ese archivo y no se
exportan; el método vive en el mismo módulo, así que los ve.

- [ ] **Step 5: Correr las pruebas y verificar que pasan**

Run: `node --test frontend/src/services/docxRelleno.test.js frontend/src/services/tablasOperacionesHtml.test.js`
Expected: PASS.

- [ ] **Step 6: Correr la suite completa y el lint**

Run: `npm test`
Expected: verde. Presta atención a las pruebas de OTROS módulos que llaman
`localizarTablasHtml` o `localizarTablaHtml`: la firma ganó un tercer parámetro opcional,
así que las llamadas de dos argumentos siguen valiendo, pero si alguna pasaba un tercero por
otro motivo el cambio la rompería.

Run: `npm run lint --prefix frontend`
Expected: sin hallazgos.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/services/docxRelleno.js frontend/src/services/docxRelleno.test.js frontend/src/services/tablasHtmlInforme.js frontend/src/services/tablasOperacionesHtml.test.js
git commit -m "feat: excluir candidatos al localizar tablas y borrarlas con su fuente"
```

---

### Task 5: La tabla en la ruta HTML de plantilla

**Files:**
- Modify: `frontend/src/services/tablasOperacionesHtml.js:22-28` (imports), `:47-63`
  (`OBJETIVOS`), `:150-200` (`actualizarTablasOperacionesHtml`)
- Test: `frontend/src/services/tablasOperacionesHtml.test.js`

**Interfaces:**
- Consumes: `superaUmbral(monto, anio)` (Task 1), `filasOperacionAdicional(estudio)`
  (Task 3), `localizarTablaHtml(html, nombres, {excluir})` y `borrarTablaHtml(html, bloque)`
  (Task 4).
- Produces: nada nuevo hacia fuera. `actualizarTablasOperacionesHtml(html, estudio, avisos)`
  mantiene su firma.

**Contexto.** `OBJETIVOS` (`:47`) es una lista de `{nombres, filas, todas?, rotulo?,
anioEnEncabezado?}` que el bucle de `:169-197` recorre. Hay que darle dos banderas nuevas:
`excluir` (que se pasa al localizador) y `omitirSi(estudio)` (que cuando devuelve `true`
borra en vez de sustituir).

- [ ] **Step 1: Escribir las pruebas que fallan**

Añadir a `frontend/src/services/tablasOperacionesHtml.test.js`:

```js
/* ── Tabla de operación adicional en la ruta de plantilla PDF ────────────────── */

const TABLA_ADICIONAL_PLANTILLA =
  '<p><strong> Tabla 4. Operación adicional Transacciones Intercompañía</strong></p>' +
  '<table>' +
  '<tr><th colspan="2"><p><strong> Compañía vinculada</strong></p></th></tr>' +
  '<tr><th><p><strong> Razón social</strong></p></th><td><p> END GAME INTERACTIVE INC</p></td></tr>' +
  '<tr><th><p><strong> Identificación fiscal</strong></p></th><td><p> 604477955</p></td></tr>' +
  '<tr><th><p><strong> País - Residencia fiscal</strong></p></th><td><p> ESTADOS UNIDOS</p></td></tr>' +
  '<tr><th><p><strong> Tipo de vinculación</strong></p></th><td><p> Articulo 260-1 numeral 2</p></td></tr>' +
  '<tr><th><p><strong> Tipo de operaciones (Información adicional)</strong></p></th><td><p> Otros servicios (07)</p></td></tr>' +
  '<tr><th><p><strong> Monto en pesos</strong></p></th><td><p> 3.435.357.400</p></td></tr>' +
  '</table>' +
  '<p><strong>FUENTE: Información de END GAME INTERACTIVE COLOMBIA S.A.S.</strong></p>';

const TABLA_TX_PLANTILLA =
  '<p><strong> Tabla 3. Transacciones Inter compañía</strong></p>' +
  '<table>' +
  '<tr><th colspan="2"><p><strong> Compañía vinculada</strong></p></th></tr>' +
  '<tr><th><p><strong> Razón social</strong></p></th><td><p> END GAME INTERACTIVE INC</p></td></tr>' +
  '<tr><th><p><strong> Identificación fiscal</strong></p></th><td><p> 604477955</p></td></tr>' +
  '<tr><th><p><strong> País - Residencia fiscal</strong></p></th><td><p> ESTADOS UNIDOS</p></td></tr>' +
  '<tr><th><p><strong> Tipo de vinculación</strong></p></th><td><p> Art 260-1 E-T Inciso 1</p></td></tr>' +
  '<tr><th><p><strong> Tipo de operaciones (Ingreso)</strong></p></th><td><p> Otros servicios (07)</p></td></tr>' +
  '<tr><th><p><strong> Monto en pesos</strong></p></th><td><p> 3.435.357.400</p></td></tr>' +
  '</table>';

const ESTUDIO_ADICIONAL = {
  ...ESTUDIO,
  anio: 2025,
  ent: 'MONTACHEM COLOMBIA S.A.S',
  vinc_id: '111222333',
  adic_vinc: 'MONTACHEM INTERNATIONAL INC',
  adic_vinc_id: '760575817',
  adic_pais: 'EEUU',
  adic_tipo: 'Reintegros o reembolsos de gastos con vinculados (62)',
  adic_monto: 14516485850,
};

test('sobre el umbral, la tabla de operación adicional se llena con los datos de la sección 4', () => {
  const informe = INFORME + TABLA_TX_PLANTILLA + TABLA_ADICIONAL_PLANTILLA;
  const texto = sinEtiquetas(actualizarTablasOperacionesHtml(informe, ESTUDIO_ADICIONAL));

  assert.match(texto, /MONTACHEM INTERNATIONAL INC/);
  assert.match(texto, /760575817/);
  assert.match(texto, /14\.516\.485\.850/);
  assert.ok(!texto.includes('604477955'), 'sobrevivió el ID del cliente anterior');
  assert.ok(!texto.includes('3.435.357.400'), 'sobrevivió el monto del cliente anterior');
});

test('el motor de la Tabla 3 no toca la tabla de operación adicional', () => {
  /* La clave de «Operación adicional Transacciones Inter compañía» CONTIENE la de
     «Transacciones Inter compañía». Sin la guarda, la Tabla 3 se escribe encima de la 4 y
     el informe declara la operación principal como si fuera la adicional. Aquí la
     plantilla la escribe SEPARADA a propósito, que es el caso que colisiona. */
  const adicionalSeparada = TABLA_ADICIONAL_PLANTILLA
    .replace('Operación adicional Transacciones Intercompañía',
             'Operación adicional Transacciones Inter compañía');
  const informe = INFORME + TABLA_TX_PLANTILLA + adicionalSeparada;

  const salida = actualizarTablasOperacionesHtml(informe, ESTUDIO_ADICIONAL);

  /* La Tabla 4 tiene que quedar con el vinculado de la sección 4 y su etiqueta propia. */
  const desde = salida.indexOf('Operación adicional');
  assert.ok(desde > -1, 'desapareció la Tabla 4');
  const tabla4 = sinEtiquetas(salida.slice(desde));
  assert.match(tabla4, /Tipo de operaciones \(Información adicional\)/);
  assert.match(tabla4, /760575817/, 'la Tabla 4 quedó con el ID de la principal');
  assert.ok(!tabla4.includes('111222333'), 'la Tabla 3 se escribió sobre la Tabla 4');
});

test('bajo el umbral, la tabla desaparece con su rótulo y su fuente', () => {
  const informe = INFORME + TABLA_TX_PLANTILLA + TABLA_ADICIONAL_PLANTILLA;
  const estudio = { ...ESTUDIO_ADICIONAL, adic_monto: 500000000 };

  const salida = actualizarTablasOperacionesHtml(informe, estudio);

  assert.ok(!salida.includes('Operación adicional'), 'sobrevivió el rótulo');
  assert.ok(!salida.includes('Información adicional'), 'sobrevivió la etiqueta de la fila');
  assert.ok(!salida.includes('FUENTE: Información de END GAME'), 'quedó la fuente huérfana');
  /* Y el resto del informe intacto, con la numeración que traía la plantilla. */
  assert.match(salida, /Tabla 1\. Operaciones de Ingreso/);
  assert.match(salida, /Tabla 3\. Transacciones Inter compañía/);
});

test('exactamente en el umbral la tabla también desaparece', () => {
  /* 45.000 UVT de 2025 son 2.240.955.000 y la norma habla de operaciones que lo SUPEREN. */
  const informe = INFORME + TABLA_ADICIONAL_PLANTILLA;
  const salida = actualizarTablasOperacionesHtml(informe,
    { ...ESTUDIO_ADICIONAL, adic_monto: 2240955000 });
  assert.ok(!salida.includes('Operación adicional'));
});

test('sin operación adicional en el estudio la tabla desaparece y NO se avisa', () => {
  /* `avisos` se publica como «No se encontró en la plantilla: X» y alimenta el semáforo de
     radicación. Un borrado intencionado no es una tabla que no se encontró. */
  const informe = INFORME + TABLA_ADICIONAL_PLANTILLA;
  const avisos = [];

  const salida = actualizarTablasOperacionesHtml(informe, ESTUDIO, avisos);

  assert.ok(!salida.includes('Operación adicional'));
  assert.ok(!avisos.some((a) => a.includes('Operación adicional')),
    'un borrado deliberado no es un aviso');
});

test('plantilla sin la tabla y con operación declarable: se avisa y no se inserta nada', () => {
  const avisos = [];
  const salida = actualizarTablasOperacionesHtml(INFORME, ESTUDIO_ADICIONAL, avisos);

  assert.ok(avisos.some((a) => a.includes('Operación adicional')), 'hay que avisar');
  assert.ok(!salida.includes('Operación adicional'), 'no se inserta una tabla nueva');
});

test('plantilla sin la tabla y sin operación declarable: silencio', () => {
  /* Avisar de algo que no hacía falta cubrir es un falso «no cubierto», y es así como se
     enseña a la gente a no leer el banner. Mismo criterio que la Tabla 11. */
  const avisos = [];
  actualizarTablasOperacionesHtml(INFORME, ESTUDIO, avisos);
  assert.ok(!avisos.some((a) => a.includes('Operación adicional')));
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `node --test frontend/src/services/tablasOperacionesHtml.test.js`
Expected: FAIL — la tabla no está registrada, así que no se llena ni se borra.

- [ ] **Step 3: Registrar la tabla y el borrado**

En los imports de `tablasOperacionesHtml.js` (`:22-28`), añadir:

```js
import {
  localizarTablaHtml, localizarTablasHtml, reescribirFilasHtml, reescribirRotuloHtml, filasDe,
  borrarTablaHtml,
} from './tablasHtmlInforme.js';
import {
  filasOperacionesDeIngreso, filasOperacionAnalizar, filasTransaccionesIntercompania,
  filasMetodoAplicable, filasCompaniasVinculadas, filasCriteriosVinculacion,
  filasOperacionAdicional,
} from './tablasOperaciones.js';
import { superaUmbral } from './umbralDocumentacion.js';
```

En `OBJETIVOS`, añadir la guarda a la entrada de la Tabla 3 (`:50`) y la entrada nueva justo
después:

```js
  /* `excluir`: la clave de «Operación adicional Transacciones Inter compañía» CONTIENE la
     de «Transacciones Inter compañía», y la comparación es por inclusión. Sin esto la
     Tabla 3 se escribe sobre la Tabla 4 y el informe declara la operación principal bajo
     el rótulo de la adicional. Que hoy no colisione depende de que la plantilla de
     referencia escriba «Intercompañía» junto: un carácter. */
  {
    nombres: 'Transacciones Inter compañía',
    filas: filasTransaccionesIntercompania,
    todas: true,
    excluir: ['Operación adicional'],
  },
  /* `omitirSi`: la operación adicional solo se documenta por encima de 45.000 UVT del año
     gravable. Por debajo, o sin sección 4 en el Excel, la tabla se BORRA en vez de
     rellenarse: la plantilla es el informe del año anterior y dejarla —aunque fuera con
     «—»— publica una tabla que este informe no tiene por qué traer. */
  {
    nombres: 'Operación adicional Transacciones Intercompañía',
    filas: filasOperacionAdicional,
    omitirSi: (e) => !superaUmbral(e.adic_monto, e.anio),
  },
```

En el bucle de `actualizarTablasOperacionesHtml` (`:169-197`), pasar `excluir` a los dos
localizadores y añadir la rama de borrado. La rama `objetivo.todas` queda:

```js
    if (objetivo.todas) {
      /* De atrás hacia adelante: sustituir una desplaza los offsets de las que van después.
         Es la misma razón por la que la ruta OOXML recorre sus dos ocurrencias al revés. */
      const bloques = localizarTablasHtml(out, objetivo.nombres, { excluir: objetivo.excluir });
      if (!bloques.length) {
        if (Array.isArray(avisos)) avisos.push(tabla.nombre);
        continue;
      }
      for (const bloque of [...bloques].reverse()) {
        out = sustituir(out, bloque, tabla, objetivo.rotulo,
          objetivo.anioEnEncabezado ? (Number(estudio.anio) || 2025) : 0);
      }
      continue;
    }

    const omitir = typeof objetivo.omitirSi === 'function' && objetivo.omitirSi(estudio);
    const bloque = localizarTablaHtml(out, objetivo.nombres, { excluir: objetivo.excluir });
    if (!bloque) {
      /* No se avisa de una tabla que además queríamos borrar: sería un falso «no cubierto»,
         y el aviso se publica como «No se encontró en la plantilla: X». */
      if (Array.isArray(avisos) && !omitir) avisos.push(tabla.nombre);
      continue;
    }
    if (omitir) {
      out = borrarTablaHtml(out, bloque);
      continue;
    }
    out = sustituir(out, bloque, tabla, objetivo.rotulo,
          objetivo.anioEnEncabezado ? (Number(estudio.anio) || 2025) : 0);
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `node --test frontend/src/services/tablasOperacionesHtml.test.js`
Expected: PASS — las 7 nuevas y todas las anteriores.

- [ ] **Step 5: Correr la suite completa y el lint**

Run: `npm test` && `npm run lint --prefix frontend`
Expected: verde y limpio.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/tablasOperacionesHtml.js frontend/src/services/tablasOperacionesHtml.test.js
git commit -m "feat: operacion adicional en la ruta de plantilla HTML, con borrado bajo el umbral"
```

---

### Task 6: La tabla en la ruta OOXML (.docx)

**Files:**
- Modify: `frontend/src/services/docxRelleno.js:1391-1404` (bloque de la Tabla 3) y las
  importaciones de `tablasOperaciones.js` en la cabecera del archivo
- Test: `frontend/src/services/docxRelleno.test.js`

**Interfaces:**
- Consumes: `superaUmbral` (Task 1), `filasOperacionAdicional` (Task 3), `excluir` y
  `doc.borrar` (Task 4).
- Produces: nada nuevo. `actualizarTablasOperacionesOoxml(xml, estudio, avisos)` mantiene su
  firma.

- [ ] **Step 1: Escribir las pruebas que fallan**

Añadir a `frontend/src/services/docxRelleno.test.js`:

```js
test('la tabla de operación adicional se llena con la sección 4 y no con la operación principal', () => {
  const estudio = {
    anio: 2025,
    ent: 'MONTACHEM COLOMBIA S.A.S',
    vinc: 'MONTACHEM INTERNATIONAL INC',
    vinc_id: '111222333',
    pais_vinc: 'EEUU',
    vinc_tipo: 'Compra neta de inventarios para distribución (31)',
    monto_operacion: 18836847464,
    adic_vinc: 'BETA HOLDINGS GMBH',
    adic_vinc_id: '760575817',
    adic_pais: 'ALEMANIA',
    adic_tipo: 'Reintegros o reembolsos de gastos con vinculados (62)',
    adic_monto: 14516485850,
  };

  /* La Tabla 4 se escribe SEPARADA («Inter compañía»), que es el caso que colisiona con el
     buscador de la Tabla 3. Con «Intercompañía» junto no colisiona por casualidad. */
  const xml =
    '<w:p><w:t>Tabla 3. Transacciones Inter compañía</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>Old 3</w:t></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:t>Tabla 4. Operación adicional Transacciones Inter compañía</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>Old 4</w:t></w:p></w:tc></w:tr></w:tbl>';

  const salida = actualizarTablasOperacionesOoxml(xml, estudio);

  assert.ok(salida.includes('Tabla 4. Operación adicional Transacciones Intercompañía'),
    'falta el rótulo de la Tabla 4');
  assert.ok(salida.includes('Tipo de operaciones (Información adicional)'),
    'falta la etiqueta propia de la fila del concepto');
  assert.ok(salida.includes('BETA HOLDINGS GMBH'), 'falta el vinculado de la sección 4');
  assert.ok(salida.includes('14.516.485.850'), 'falta el monto de la sección 4');
  assert.ok(!salida.includes('Old 4'), 'no se sustituyó la Tabla 4');

  /* Y la Tabla 3 con lo suyo, sin que ninguna se haya escrito sobre la otra. */
  assert.ok(salida.includes('111222333'), 'falta el ID de la Tabla 3');
  assert.ok(!salida.includes('Old 3'), 'no se sustituyó la Tabla 3');
  const tabla4 = salida.slice(salida.indexOf('Operación adicional'));
  assert.ok(!tabla4.includes('111222333'), 'la Tabla 3 se escribió sobre la Tabla 4');
});

test('bajo el umbral la tabla de operación adicional se borra con su rótulo y su fuente', () => {
  const xml =
    '<w:p><w:t>Tabla 3. Transacciones Inter compañía</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>Old 3</w:t></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:t>Tabla 4. Operación adicional Transacciones Intercompañía</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>BORRAR</w:t></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:t>FUENTE: Información de END GAME INTERACTIVE COLOMBIA S.A.S.</w:t></w:p>' +
    '<w:p><w:t>Tabla 5. Método de Precios de Transferencia</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>Old 5</w:t></w:p></w:tc></w:tr></w:tbl>';

  const salida = actualizarTablasOperacionesOoxml(xml, {
    anio: 2025, ent: 'ACME', adic_monto: 500000000,
    adic_vinc: 'BETA HOLDINGS GMBH', adic_tipo: 'Préstamos con vinculados (61)',
  });

  assert.ok(!salida.includes('Operación adicional'), 'sobrevivió el rótulo');
  assert.ok(!salida.includes('BORRAR'), 'sobrevivió la tabla');
  assert.ok(!salida.includes('FUENTE: Información de END GAME'), 'quedó la fuente huérfana');
  /* La numeración de lo que sigue NO se toca: la fija la plantilla. */
  assert.ok(salida.includes('Tabla 5. Método de Precios de Transferencia'),
    'se renumeró o se perdió la tabla siguiente');
});

test('sin datos de la sección 4 la tabla se borra y no se anota en avisos', () => {
  const xml =
    '<w:p><w:t>Tabla 4. Operación adicional Transacciones Intercompañía</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>BORRAR</w:t></w:p></w:tc></w:tr></w:tbl>';
  const avisos = [];

  const salida = actualizarTablasOperacionesOoxml(xml, { anio: 2025 }, avisos);

  assert.ok(!salida.includes('Operación adicional'));
  assert.ok(!avisos.some((a) => a.includes('Operación adicional')),
    'un borrado deliberado no es «no se encontró en la plantilla»');
});

test('plantilla sin la tabla: se avisa solo si había algo que declarar', () => {
  const xml = '<w:p><w:t>Tabla 3. Transacciones Inter compañía</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>Old 3</w:t></w:p></w:tc></w:tr></w:tbl>';

  const conDato = [];
  actualizarTablasOperacionesOoxml(xml, {
    anio: 2025, adic_monto: 14516485850, adic_vinc: 'BETA HOLDINGS GMBH',
  }, conDato);
  assert.ok(conDato.some((a) => a.includes('Operación adicional')));

  const sinDato = [];
  actualizarTablasOperacionesOoxml(xml, { anio: 2025 }, sinDato);
  assert.ok(!sinDato.some((a) => a.includes('Operación adicional')));
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `node --test frontend/src/services/docxRelleno.test.js`
Expected: FAIL — falta el rótulo de la Tabla 4.

- [ ] **Step 3: Escribir la implementación**

En los imports de `docxRelleno.js`, añadir `filasOperacionAdicional` a los que ya vienen de
`./tablasOperaciones.js` y `superaUmbral` de `./umbralDocumentacion.js`.

Reemplazar el bloque de la Tabla 3 (`:1391-1404`) por:

```js
  /* 3. Transacciones Inter compañía. La plantilla la trae dos veces —una en la
     descripción del vinculado y otra en el análisis— con la misma cabecera y números
     que cambian según el informe (3 y 12 en la del cliente). Se sustituyen las dos
     por ocurrencia, sin depender de esos números.

     `excluir`: la clave de «Operación adicional Transacciones Inter compañía» CONTIENE la
     de esta tabla y la comparación es por inclusión, así que sin la guarda la ficha de la
     operación principal se escribe sobre la de la adicional. Que hoy no colisione depende
     de que la plantilla de referencia escriba «Intercompañía» junto: un carácter. */
  {
    const t3 = filasTransaccionesIntercompania(estudio);
    const tablaTx = (b) => generarTablaOoxml(
      tituloDe(b, t3.nombre), t3.encabezados, t3.filas, escaparXml(t3.fuente)
    );
    const guarda = { excluir: ['Operación adicional'] };
    /* De atrás hacia adelante: sustituir la primera desplaza los índices de la
       segunda, y el localizador trabaja sobre posiciones del XML. */
    reemplazar('Transacciones Inter compañía', tablaTx, { ...guarda, ocurrencia: 1 });
    reemplazar('Transacciones Inter compañía', tablaTx, { ...guarda, ocurrencia: 0 });
  }

  /* 3-bis. Operación adicional Transacciones Intercompañía: la ficha del vinculado de la
     sección «4. INFORMACIÓN ADICIONAL» del Excel.

     Solo se documenta por encima de 45.000 UVT del año gravable. Por debajo, o sin datos,
     la tabla se BORRA: la plantilla es el informe del año anterior y dejarla —aunque fuera
     con «—»— publica una tabla que este informe no tiene por qué traer.

     El borrado no se anota en `avisos`: ese arreglo se publica como «No se encontró en la
     plantilla: X» y alimenta el semáforo de radicación. Que la tabla se haya ido se dice en
     el paso 2 de la ingesta, en ámbar, donde el usuario puede hacer algo al respecto. */
  {
    const nombreAdicional = 'Operación adicional Transacciones Intercompañía';
    if (superaUmbral(estudio.adic_monto, estudio.anio)) {
      const t = filasOperacionAdicional(estudio);
      reemplazar(nombreAdicional, (b) => generarTablaOoxml(
        tituloDe(b, t.nombre), t.encabezados, t.filas, escaparXml(t.fuente)
      ));
    } else {
      doc.borrar(nombreAdicional);
    }
  }
```

Nota: `doc` es el objeto que devuelve `sustituidorDeTablas` y ya está en el ámbito
(`:1333-1334`); `reemplazar` es su método envuelto. `borrar` se llama sobre `doc` porque no
hay atajo local.

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `node --test frontend/src/services/docxRelleno.test.js`
Expected: PASS — las 4 nuevas y todas las anteriores. La prueba grande de `:580` que
comprueba las Tablas 1, 2, 3, 6 y 10 sigue en verde: su XML no trae la Tabla 4, así que
`doc.borrar` devuelve `false` sin anotar nada.

- [ ] **Step 5: Correr la suite completa y el lint**

Run: `npm test` && `npm run lint --prefix frontend`
Expected: verde y limpio.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/docxRelleno.js frontend/src/services/docxRelleno.test.js
git commit -m "feat: operacion adicional en la ruta OOXML, con borrado bajo el umbral"
```

---

### Task 7: Ingesta y previsualización en el paso 2

**Files:**
- Modify: `frontend/src/components/IngestaOperaciones.jsx` — imports (`:1-5`),
  `handleExcelUpload` (`:12-79`), y un bloque nuevo al final del `return` (tras `:190`)
- Modify: `frontend/src/components/DatosContribuyente.jsx:240-251` — el selector del
  criterio de vinculación de la operación adicional

**Interfaces:**
- Consumes: `res.adicional` de `parseExcelOperations` (Task 2), `umbralOperacion` y
  `superaUmbral` (Task 1).
- Produces: los campos `adic_vinc`, `adic_vinc_id`, `adic_pais`, `adic_tipo`, `adic_monto`
  en el estudio, que consume `filasOperacionAdicional` (Task 3).

**Contexto.** El componente escribe el estudio con `updateStudy({...})` (`:19-28`) y arma un
arreglo `avisos` que se concatena al mensaje de éxito (`:29-68`). El recuadro «Resumen de
Operación Extraída» está en `:150-190`; el bloque nuevo va después, con la misma envoltura
(`bg-white dark:bg-[#0c0c0f] border … rounded-xl p-6 shadow-sm`) y la misma rejilla
`grid-cols-1 md:grid-cols-2 gap-4`.

Esta tarea **no lleva pruebas unitarias**: el repo verifica los cambios visuales a mano en
el navegador (`CLAUDE.md`). Lo que sí se prueba es la escritura de los campos, y eso ya
quedó cubierto por las tareas 2 y 3.

- [ ] **Step 1: Escribir los campos en el estudio**

En los imports (`:1-5`), añadir:

```js
import { fmt, montoOperacion } from '../utils/calculations';
import { umbralOperacion, superaUmbral } from '../services/umbralDocumentacion';
```

y a la lista de iconos de `lucide-react` (`:2`) añadir `Info`.

Dentro de `handleExcelUpload`, en el objeto de `updateStudy` (`:19-28`), añadir los campos.
Se escriben SIEMPRE —también en `null`— para que recargar un Excel sin sección 4 borre lo
que dejó el anterior; si solo se escribieran cuando hay dato, el estudio se quedaría con la
operación adicional del archivo previo:

```js
        const adic = res.adicional;
        updateStudy({
          vinc: res.vinc,
          vinc_id: res.vinc_id,
          pais_vinc: res.pais_vinc,
          vinc_tipo: res.vinc_tipo,
          monto: valMonto,
          monto_operacion: valMonto,
          egreso: res.egreso || false,
          /* Los campos de la sección 4 se escriben siempre, también en null: cargar un
             Excel sin información adicional tiene que BORRAR la del archivo anterior. Si
             solo se escribieran cuando hay dato, el informe declararía una operación
             adicional que este archivo no trae. */
          adic_vinc: adic ? adic.vinc : null,
          adic_vinc_id: adic ? adic.vinc_id : null,
          adic_pais: adic ? adic.pais_vinc : null,
          adic_tipo: adic ? adic.tipo : null,
          adic_monto: adic ? adic.monto : null,
        });
```

- [ ] **Step 2: Añadir los avisos de la sección 4**

Tras el aviso de `!res.vinc_tipo` (`:57-64`), antes de `const aviso = …`:

```js
        /* Mismas divergencias que en la operación principal, pero de la sección 4. El
           estudio guarda un vinculado y un tipo, así que con varios el informe declara uno
           y hay que decir cuál y por qué. */
        if (adic && adic.contrapartes > 1) {
          avisos.push(
            `⚠ la información adicional trae ${adic.contrapartes} contrapartes y el estudio guarda una ` +
            `(${adic.vinc}): el monto es la suma de todas`
          );
        }
        if (adic && adic.tipos > 1) {
          avisos.push(
            `⚠ la información adicional trae ${adic.tipos} tipos de operación distintos: ` +
            `el informe declara «${adic.tipo}», el de mayor monto`
          );
        }
        if (adic && !adic.tipo) {
          avisos.push(
            '⚠ la información adicional no trae el tipo de operación: el concepto de la ' +
            'tabla de operación adicional saldrá en blanco'
          );
        }
```

- [ ] **Step 3: Añadir el recuadro de previsualización**

Al final del `return`, después del recuadro «Resumen de Operación Extraída» y antes del
`</div>` que cierra (hoy tras `:190`):

```jsx
      {/* Previsualización de la sección «4. INFORMACIÓN ADICIONAL» del Excel: préstamos
          (61), reintegros o reembolsos de gastos (62) y operaciones a nombre de vinculados
          (63). No afectan el estado de resultados y no se suman a la operación principal,
          pero por encima de 45.000 UVT del año gravable hay que documentarlas en su propia
          tabla del informe.

          El veredicto del umbral se muestra AQUÍ y no al generar: es el único momento en
          que el usuario puede hacer algo al respecto —revisar el Excel, corregir el año
          gravable— antes de que el informe salga sin esa tabla. */}
      {study.adic_monto != null && (
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2">
            Operación Adicional <span className="font-normal text-zinc-500">· sección 4 del Excel</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wider block">Concepto (Información Adicional)</span>
              <span className="text-base font-bold text-zinc-900 dark:text-zinc-100">{study.adic_tipo || '—'}</span>
            </div>

            <div className="p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-200 dark:border-emerald-900/30 space-y-1">
              <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold uppercase tracking-wider block">Monto de Operación</span>
              <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                COP $ {fmt(study.adic_monto)}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wider block">Compañía Vinculada</span>
              <span className="text-base font-bold text-zinc-900 dark:text-zinc-100">{study.adic_vinc || '—'}</span>
            </div>

            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wider block">País e ID Fiscal</span>
              <span className="text-base font-bold text-zinc-900 dark:text-zinc-100">{study.adic_pais || '—'} ({study.adic_vinc_id || '—'})</span>
            </div>
          </div>

          {/* El veredicto del umbral. Los dos estados dicen qué va a pasar con la tabla del
              informe, no solo si la cifra es grande: es la consecuencia lo que el usuario
              necesita saber antes de generar. */}
          {superaUmbral(study.adic_monto, study.anio) ? (
            <div className="p-4 rounded-xl text-sm flex gap-2 items-start bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium">
                Supera el umbral de 45.000 UVT (COP $ {fmt(umbralOperacion(study.anio))}):
                se declara en la tabla «Operación adicional Transacciones Intercompañía» del informe.
              </span>
            </div>
          ) : (
            <div className="p-4 rounded-xl text-sm flex gap-2 items-start bg-amber-50 dark:bg-amber-950/20 border border-amber-200 text-amber-800 dark:text-amber-300">
              <Info className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium">
                No supera el umbral de 45.000 UVT (COP $ {fmt(umbralOperacion(study.anio))}):
                la tabla «Operación adicional Transacciones Intercompañía» se eliminará del informe.
              </span>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 4: Hacer editable el criterio de vinculación de la operación adicional**

El spec pide que `adic_tipo_vinculacion` sea editable. Su gemelo `tipo_vinculacion` ya tiene
un `<select>` en `frontend/src/components/DatosContribuyente.jsx:240-251`; sin el suyo, la
tabla del informe se quedaría siempre con el valor por omisión y nadie podría corregirlo.

En `DatosContribuyente.jsx`, justo después del bloque de «Criterio de Vinculación» (`:251`),
añadir el gemelo. Las opciones son las del artículo 260-1 tal como las escribe la tabla del
informe de referencia («Articulo», sin tilde), y hay una vacía que deja actuar al valor por
omisión de `filasOperacionAdicional`:

```jsx
            {/* Solo la operación adicional. La sección 4 del Excel puede ser con OTRA
                contraparte que la principal, y entonces su criterio de vinculación es otro:
                un solo campo para las dos publicaría en la Tabla 4 la vinculación que se
                sustentó para la Tabla 3. */}
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Criterio de Vinculación (Operación Adicional)</label>
              <select
                value={study.adic_tipo_vinculacion || ''}
                onChange={(e) => handleFieldChange('adic_tipo_vinculacion', e.target.value)}
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              >
                <option value="">Articulo 260-1 numeral 2 (por omisión)</option>
                <option value="Articulo 260-1 numeral 1">Articulo 260-1 numeral 1</option>
                <option value="Articulo 260-1 numeral 2">Articulo 260-1 numeral 2</option>
                <option value="Articulo 260-1 numeral 5">Articulo 260-1 numeral 5</option>
              </select>
            </div>
```

`handleFieldChange` ya existe en ese componente y es lo que usa el campo de al lado.

- [ ] **Step 5: Verificar el lint y el build**

Run: `npm run lint --prefix frontend`
Expected: sin hallazgos.

Run: `npm run build`
Expected: build limpio, sin errores de Vite.

- [ ] **Step 6: Correr la suite completa**

Run: `npm test`
Expected: verde. Este componente no tiene pruebas unitarias, pero el build y la suite
confirman que no se rompió ningún import.

- [ ] **Step 7: Verificación manual en el navegador**

```bash
npm start
```

Abrir `http://localhost:3000`, crear un estudio e ir al paso 2.

Caso A — con sección 4. Cargar `D:\G\Juan-Mendez\Downloads\Informacion Operaciones PT 2025-1 (1).xlsx`.
Comprobar:
- el recuadro «Operación Adicional · sección 4 del Excel» aparece;
- concepto: `Reintegros o reembolsos de gastos con vinculados que no fueron reflejados en el Estado de Resultados (62)`;
- **Monto de Operación: `COP $ 14.516.485.850`** — si dice `2.926.256.260` está leyendo la
  columna «Saldo 2025» y la Task 2 no quedó bien;
- vinculada `MONTACHEM INTERNATIONAL INC`, país `EEUU`, ID `760575817`;
- franja verde: «Supera el umbral de 45.000 UVT (COP $ 2.240.955.000)».

Caso B — sin sección 4. Cargar
`frontend\Archivos Prueba\Información Operaciones PT 2025-2 modificado cr.xlsx`.
Comprobar que el recuadro **no** aparece (esa sección está vacía en ese archivo) y que el
recuadro de la operación principal sigue igual que antes.

Caso C — bajo el umbral. Volver al caso A y cambiar el año gravable del estudio a uno cuyo
UVT haga que 14.516.485.850 no supere el umbral no es posible (ningún UVT de la tabla lo
consigue), así que para ver la franja ámbar: en la consola del navegador,
`JSON.parse(localStorage.getItem('pt:study:<id>'))`, bajar `adic_monto` a `500000000`,
volver a guardar y recargar. Comprobar la franja ámbar con «se eliminará del informe».

Comprobar los tres casos en **tema claro y oscuro** (el conmutador de la app).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/IngestaOperaciones.jsx frontend/src/components/DatosContribuyente.jsx
git commit -m "feat: previsualizacion de la operacion adicional en el paso 2 de la ingesta"
```

- [ ] **Step 9: Regenerar el compilado y cerrar**

`public/gestor-reportes/` es el artefacto que `npm run build` regenera y el único que puede
entrar en conflicto sin bloquear una integración (`CLAUDE.md`).

```bash
npm run build
git add public/gestor-reportes
git commit -m "chore: regenerar public/gestor-reportes"
```

Después, correr `/revisar-ramas-equipo` antes del merge: es el segundo de los dos momentos
que pide el flujo del repo.

---

## Verificación final

- [ ] `npm test` — 100 % en verde, con ~27 pruebas más que al empezar.
- [ ] `npm run lint --prefix frontend` — sin hallazgos.
- [ ] `npm run build` — limpio.
- [ ] Los tres casos manuales del paso 2, en tema claro y oscuro.
- [ ] El monto de la sección 4 del archivo real es `14.516.485.850` y **no**
      `2.926.256.260`.
- [ ] Ninguna tabla del informe cambió de número.
- [ ] El selector «Criterio de Vinculación (Operación Adicional)» del paso de datos del
      contribuyente cambia la fila «Tipo de vinculación» de la tabla generada.
- [ ] `superaUmbral` se llama sin coercionar el monto en ningún llamador: la
      previsualización y las dos rutas de generación tienen que coincidir.
