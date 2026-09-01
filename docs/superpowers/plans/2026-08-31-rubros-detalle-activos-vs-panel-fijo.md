# Derivar los seis rubros adicionales del ESF desde "Detalle de Activos" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar la casilla manual redundante que el 2026-08-28 se agregó para `t_cash`,
`t_inv_assoc`, `t_tax`, `t_intang`, `t_dif` y `t_act_nocurr`, y en su lugar derivarlos
automáticamente del panel "Detalle de Activos" (`t_activos_detalle`) — que ya es la fuente
real de la Tabla 10 / ANEXO A y suele traer ya esas seis partidas — para que el Excel Soporte
Motor (hoja Datos, Análisis Vertical) los lea correctos sin que el analista tenga que
escribir la misma cifra dos veces en dos paneles distintos.

**Architecture:** Una función pura nueva, `derivarRubrosDesdeDetalleActivos(detalle)`, en
`frontend/src/services/rubrosDesdeDetalleActivos.js`, reconoce cada uno de los seis rubros
por el texto de su rótulo dentro de `t_activos_detalle` (matchers por patrón, no por lista de
sinónimos de empresa). Se invoca en los dos puntos donde `t_activos_detalle` cambia:
`eeffVerificacion.js` (lectura OCR) e `IngestaCifras.jsx` (edición manual del detalle). El
panel de casillas del 28-ago se retira, junto con el import y las dos constantes que solo él
usaba; `motorExcelExport.js` no cambia, porque ya lee `study.t_cash` etc. tal cual — solo
cambia quién los mantiene actualizados.

**Tech Stack:** JS puro (`frontend/src/services/`), React 19 (`frontend/src/components/IngestaCifras.jsx`),
`node:test`/`node:assert`.

**Spec:** `docs/superpowers/specs/2026-08-31-rubros-detalle-activos-vs-panel-fijo-design.md`

## Global Constraints

- No sumar subtotales a partir de sus componentes (`t_act_nocurr` no se calcula como
  `t_ppe + t_intang + t_dif`): se toma la fila del propio documento, tal cual la reconoce el
  matcher.
- No tocar `t_ar`, `t_inv`, `t_ap`, `t_act_curr`, `t_ppe`, `t_act_tot`, `CAMPO_POR_RUBRO` ni
  ninguna otra extracción OCR existente — fuera de alcance de este cambio.
- No tocar `motorExcelExport.js` ni `tablasContribuyente.js`/`docxRelleno.js`: ya leen
  `study.t_cash` etc. correctamente: el problema era solo quién los llenaba.
- El reconocimiento de rótulos es por patrón (substrings genéricos: "efectivo", "intangible",
  "diferido"…), nunca por el nombre de una compañía puntual — si un EEFF real no calza,
  se amplía el patrón, no se agrega una excepción por cliente.
- Código, comentarios y UI en español.
- `npm test` debe quedar en verde tras cada tarea.

---

### Task 1: Crear `derivarRubrosDesdeDetalleActivos` con sus matchers por patrón

**Files:**
- Create: `frontend/src/services/rubrosDesdeDetalleActivos.js`
- Test: `frontend/src/services/rubrosDesdeDetalleActivos.test.js`

**Interfaces:**
- Produces: `export function derivarRubrosDesdeDetalleActivos(detalle: Array<{etiqueta?: string, valor?: number|string, esSubtotal?: boolean}>): {t_cash: number, t_inv_assoc: number, t_tax: number, t_intang: number, t_dif: number, t_act_nocurr: number}` — siempre las seis claves, nunca `null`/`undefined` (0 cuando no hay fila reconocible).

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `frontend/src/services/rubrosDesdeDetalleActivos.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { derivarRubrosDesdeDetalleActivos } from './rubrosDesdeDetalleActivos.js';

test('sin detalle, los seis rubros quedan en 0 (no null, no undefined)', () => {
  assert.deepStrictEqual(derivarRubrosDesdeDetalleActivos([]), {
    t_cash: 0, t_inv_assoc: 0, t_tax: 0, t_intang: 0, t_dif: 0, t_act_nocurr: 0,
  });
  assert.deepStrictEqual(derivarRubrosDesdeDetalleActivos(undefined), {
    t_cash: 0, t_inv_assoc: 0, t_tax: 0, t_intang: 0, t_dif: 0, t_act_nocurr: 0,
  });
});

test('reconoce los seis rótulos canónicos, tal como los imprime RUBROS_ACTIVO', () => {
  const detalle = [
    { etiqueta: 'Efectivo y equivalentes de efectivo', valor: 100, esSubtotal: false },
    { etiqueta: 'Inversiones asociadas', valor: 200, esSubtotal: false },
    { etiqueta: 'Activos por impuestos corrientes', valor: 300, esSubtotal: false },
    { etiqueta: 'Intangibles', valor: 400, esSubtotal: false },
    { etiqueta: 'Diferidos', valor: 500, esSubtotal: false },
    { etiqueta: 'Total, Activos no corrientes', valor: 600, esSubtotal: true },
  ];
  assert.deepStrictEqual(derivarRubrosDesdeDetalleActivos(detalle), {
    t_cash: 100, t_inv_assoc: 200, t_tax: 300, t_intang: 400, t_dif: 500, t_act_nocurr: 600,
  });
});

test('reconoce rótulos reales en mayúsculas y con variaciones de redacción', () => {
  const detalle = [
    { etiqueta: 'EFECTIVO Y EQUIVALENTES DE EFECTIVO', valor: 337546138, esSubtotal: false },
    { etiqueta: 'INVERSIÓN EN COMPAÑÍAS ASOCIADAS Y NEGOCIOS CONJUNTOS', valor: 50000, esSubtotal: false },
    { etiqueta: 'IMPUESTOS POR COBRAR', valor: 70000, esSubtotal: false },
    { etiqueta: 'ACTIVOS INTANGIBLES, NETO', valor: 90000, esSubtotal: false },
    { etiqueta: 'CARGOS DIFERIDOS', valor: 110000, esSubtotal: false },
    { etiqueta: 'TOTAL ACTIVOS NO CORRIENTES', valor: 130000, esSubtotal: true },
  ];
  assert.deepStrictEqual(derivarRubrosDesdeDetalleActivos(detalle), {
    t_cash: 337546138, t_inv_assoc: 50000, t_tax: 70000, t_intang: 90000, t_dif: 110000,
    t_act_nocurr: 130000,
  });
});

test('las filas del fixture real de Montachem, que no traen estos seis rubros, no producen falsos positivos', () => {
  const detalle = [
    { etiqueta: 'DEUDORES COMERCIALES Y OTRAS CUENTAS POR COBRAR', valor: 6032337879, esSubtotal: false },
    { etiqueta: 'CUENTAS POR COBRAR A PARTES RELACIONADAS', valor: 2926256259, esSubtotal: false },
    { etiqueta: 'INVENTARIOS', valor: 4734795891, esSubtotal: false },
    { etiqueta: 'ACTIVOS FINANCIEROS', valor: 20005897, esSubtotal: false },
    { etiqueta: 'TOTAL ACTIVO CORRIENTE', valor: 14050942064, esSubtotal: true },
  ];
  assert.deepStrictEqual(derivarRubrosDesdeDetalleActivos(detalle), {
    t_cash: 0, t_inv_assoc: 0, t_tax: 0, t_intang: 0, t_dif: 0, t_act_nocurr: 0,
  });
});

test('«Total, Activo corriente» no se confunde con «Total, Activos no corrientes»', () => {
  const detalle = [{ etiqueta: 'Total, Activo corriente', valor: 999, esSubtotal: true }];
  assert.strictEqual(derivarRubrosDesdeDetalleActivos(detalle).t_act_nocurr, 0);
});

test('«Total, Activos no corrientes» sin esSubtotal no se toma como el subtotal', () => {
  const detalle = [{ etiqueta: 'Nota sobre activos no corrientes', valor: 999, esSubtotal: false }];
  assert.strictEqual(derivarRubrosDesdeDetalleActivos(detalle).t_act_nocurr, 0);
});

test('«Impuesto diferido activo» no cae en t_tax ni en t_dif: es ambiguo y se deja en 0', () => {
  const detalle = [{ etiqueta: 'Impuesto diferido activo', valor: 999, esSubtotal: false }];
  const r = derivarRubrosDesdeDetalleActivos(detalle);
  assert.strictEqual(r.t_tax, 0);
  assert.strictEqual(r.t_dif, 0);
});

test('una fila que calza dos patrones se asigna solo al de mayor prioridad, no se reutiliza', () => {
  const detalle = [
    { etiqueta: 'Efectivo e inversiones en asociadas', valor: 999, esSubtotal: false },
  ];
  const r = derivarRubrosDesdeDetalleActivos(detalle);
  assert.strictEqual(r.t_cash, 999, 'se la queda t_cash, que se evalúa primero');
  assert.strictEqual(r.t_inv_assoc, 0, 'la fila ya se usó y no se reasigna a otro rubro');
});

test('el valor se parsea con las mismas reglas de num() que usa el resto del sistema', () => {
  const detalle = [{ etiqueta: 'Efectivo y equivalentes de efectivo', valor: '1.234.567', esSubtotal: false }];
  assert.strictEqual(derivarRubrosDesdeDetalleActivos(detalle).t_cash, 1234567);
});
```

- [ ] **Step 2: Correr las pruebas y confirmar que fallan**

Run: `node --test frontend/src/services/rubrosDesdeDetalleActivos.test.js`
Expected: FAIL — el módulo `rubrosDesdeDetalleActivos.js` no existe todavía.

- [ ] **Step 3: Implementar el módulo**

Crear `frontend/src/services/rubrosDesdeDetalleActivos.js`:

```js
import { num } from '../utils/calculations.js';

/* Reconoce, dentro de `t_activos_detalle` (la sección ACTIVOS completa tal como la
   transcribe la ingesta, ver `eeffParser.js`), los seis rubros que el Excel Soporte Motor
   publica en su Análisis Vertical (`CLAVES_RUBROS_EXAMINADA` en
   `memoriaCalculoRangoOptimo.js`) pero que ningún campo con nombre propio de la OCR llena:
   `CAMPO_POR_RUBRO` no los incluye a propósito (alcance fijado el 2026-08-21/28), y el
   detalle dinámico es la única fuente que sí los trae, bajo el rótulo que use cada compañía.

   Coincidencia por patrón (substrings genéricos), no por el nombre de una compañía puntual:
   si un EEFF real no calza con ninguno, la corrección es ampliar el patrón de esa clave, no
   agregar una excepción ad hoc — mismo criterio que ya usa `TERMINOS_HOLDING` en
   `filtrosComparablesPatch.js`.

   `t_tax`/`t_dif` se excluyen mutuamente: un rótulo como «Impuesto diferido activo» no es
   ni un impuesto corriente por cobrar ni un diferido no tributario, y clasificarlo mal sería
   peor que dejarlo en 0. `t_act_nocurr` exige `esSubtotal` para no confundir una fila de
   línea que mencione "activos no corrientes" en su texto con el subtotal real del grupo. */
const MATCHERS = [
  { clave: 't_cash', test: (e) => e.includes('efectivo') || e.includes('disponible') },
  { clave: 't_inv_assoc', test: (e) => e.includes('invers') && e.includes('asociad') },
  { clave: 't_tax', test: (e) => e.includes('impuesto') && !e.includes('diferido') },
  { clave: 't_intang', test: (e) => e.includes('intangible') },
  { clave: 't_dif', test: (e) => e.includes('diferido') && !e.includes('impuesto') },
  {
    clave: 't_act_nocurr',
    test: (e, fila) => Boolean(fila && fila.esSubtotal) && e.includes('activ') && e.includes('no corriente'),
  },
];

const normalizarEtiqueta = (s) => String(s || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Deriva `t_cash`, `t_inv_assoc`, `t_tax`, `t_intang`, `t_dif` y `t_act_nocurr` de
 * `t_activos_detalle`. Siempre devuelve las seis claves con un número (0 cuando ninguna fila
 * calza), nunca `null`/`undefined`, para que se pueda mezclar directo en `campos`/`updateStudy`
 * sin que `camposAplicables()` lo descarte.
 *
 * @param {Array<{etiqueta?: string, valor?: number|string, esSubtotal?: boolean}>} detalle
 * @returns {{t_cash: number, t_inv_assoc: number, t_tax: number, t_intang: number, t_dif: number, t_act_nocurr: number}}
 */
export function derivarRubrosDesdeDetalleActivos(detalle) {
  const filas = Array.isArray(detalle) ? detalle : [];
  const usadas = new Set();
  const resultado = {};
  MATCHERS.forEach(({ clave, test }) => {
    const idx = filas.findIndex((fila, i) => {
      if (usadas.has(i)) return false;
      return test(normalizarEtiqueta(fila && fila.etiqueta), fila);
    });
    if (idx === -1) {
      resultado[clave] = 0;
      return;
    }
    usadas.add(idx);
    resultado[clave] = num(filas[idx].valor) || 0;
  });
  return resultado;
}
```

- [ ] **Step 4: Correr las pruebas y confirmar que pasan**

Run: `node --test frontend/src/services/rubrosDesdeDetalleActivos.test.js`
Expected: PASS — los 9 casos en verde.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/rubrosDesdeDetalleActivos.js frontend/src/services/rubrosDesdeDetalleActivos.test.js
git commit -m "feat: derivar los seis rubros adicionales del ESF desde el detalle de activos"
```

---

### Task 2: Enganchar la derivación en la lectura OCR (`eeffVerificacion.js`)

**Files:**
- Modify: `frontend/src/services/eeffVerificacion.js:398`
- Test: `frontend/src/services/eeffVerificacion.test.js`

**Interfaces:**
- Consumes: `derivarRubrosDesdeDetalleActivos(detalle)` de la Task 1.
- Produces: `verificarEeff(...).campos` ahora incluye, además de `t_activos_detalle`,
  `t_cash`, `t_inv_assoc`, `t_tax`, `t_intang`, `t_dif`, `t_act_nocurr` (siempre numéricos,
  nunca `null`) cuando `detalle` no está vacío.

- [ ] **Step 1: Escribir la prueba que falla**

Agregar a `frontend/src/services/eeffVerificacion.test.js`, cerca de las pruebas de
`t_activos_detalle` (línea ~168):

```js
test('la verificación deriva los seis rubros adicionales del detalle de activos leído', () => {
  const r = verificar({
    activosDetalle: [
      { etiqueta: 'EFECTIVO Y EQUIVALENTES DE EFECTIVO', valor: 337546138, esSubtotal: false },
      { etiqueta: 'INTANGIBLES', valor: 90000, esSubtotal: false },
    ],
  });
  assert.strictEqual(r.campos.t_cash, 337546138);
  assert.strictEqual(r.campos.t_intang, 90000);
  assert.strictEqual(r.campos.t_inv_assoc, 0);
});

test('sin detalle de activos, los seis rubros adicionales no se escriben (quedan en blanco, no en 0 forzado)', () => {
  const aplicables = camposAplicables(verificar({ activosDetalle: [] }).campos);
  assert.ok(!('t_cash' in aplicables));
});
```

Revisar primero cómo arma `verificar(...)` el resto del archivo (helper local que envuelve
`verificarEeff` con la lectura base) para llamar con la misma forma que las pruebas vecinas.

- [ ] **Step 2: Correr las pruebas y confirmar que fallan**

Run: `node --test frontend/src/services/eeffVerificacion.test.js`
Expected: FAIL en la primera prueba nueva (`campos.t_cash` es `undefined`).

- [ ] **Step 3: Enganchar la derivación**

En `frontend/src/services/eeffVerificacion.js`, agregar el import junto a los demás del
archivo:

```js
import { derivarRubrosDesdeDetalleActivos } from './rubrosDesdeDetalleActivos.js';
```

Y en la línea 398, cambiar:

```js
  if (detalle.some((fila) => fila.valor !== null)) campos.t_activos_detalle = detalle;
```

por:

```js
  if (detalle.some((fila) => fila.valor !== null)) {
    campos.t_activos_detalle = detalle;
    /* Los seis rubros que solo vive el detalle dinámico (ver `rubrosDesdeDetalleActivos.js`):
       sin nombre de campo propio en `CAMPO_POR_RUBRO`, es la única forma de que lleguen al
       Análisis Vertical de la hoja Datos del Excel Soporte Motor. */
    Object.assign(campos, derivarRubrosDesdeDetalleActivos(detalle));
  }
```

Nota: la segunda prueba nueva (sin detalle) espera que `t_cash` no aparezca en absoluto en
`campos` cuando no hay ninguna fila válida — eso ya lo garantiza el `if` existente, que no
entra en absoluto cuando `detalle` está vacío o todas sus filas tienen `valor: null`.

- [ ] **Step 4: Correr las pruebas y confirmar que pasan**

Run: `node --test frontend/src/services/eeffVerificacion.test.js`
Expected: PASS, incluidas las pruebas ya existentes del archivo (no deben romperse).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/eeffVerificacion.js frontend/src/services/eeffVerificacion.test.js
git commit -m "feat: la lectura OCR deriva los seis rubros adicionales del detalle de activos"
```

---

### Task 3: Enganchar la derivación en la edición manual y retirar el panel redundante

**Files:**
- Modify: `frontend/src/components/IngestaCifras.jsx:16` (import), `:44-56` (constantes del
  28-ago a retirar), `:131-146` (los tres manejadores de "Detalle de Activos"), `:661-682`
  (el panel de casillas del 28-ago a retirar; el rango exacto puede haberse corrido con la
  Task 2 — ubicarlo por el comentario `Estos rubros no cambian la utilidad...`)

**Interfaces:**
- Consumes: `derivarRubrosDesdeDetalleActivos(detalle)` de la Task 1.
- Produces: nada que otro archivo consuma — los seis campos siguen siendo `study.t_cash` etc.,
  el mismo nombre que ya lee `motorExcelExport.js`.

- [ ] **Step 1: Retirar el import y las constantes del panel del 28-ago**

En `frontend/src/components/IngestaCifras.jsx`, quitar la línea 16:

```js
import { RUBROS_EXAMINADA } from '../services/memoriaCalculoRangoOptimo.js';
```

y agregar en su lugar:

```js
import { derivarRubrosDesdeDetalleActivos } from '../services/rubrosDesdeDetalleActivos.js';
```

Quitar el bloque completo (comentario incluido) que define `CLAVES_BALANCE_ADICIONALES` y
`RUBROS_BALANCE_ADICIONALES` (líneas 44-56, justo antes de `CLASE_CASILLA`):

```js
/* Los seis rubros que el Excel Soporte Motor ya publica (hoja Datos, columna A.V.) pero
   ... */
const CLAVES_BALANCE_ADICIONALES = [...];
const RUBROS_BALANCE_ADICIONALES = CLAVES_BALANCE_ADICIONALES.map(...);
```

- [ ] **Step 2: Derivar los seis rubros en los tres manejadores de "Detalle de Activos"**

Reemplazar el bloque actual (líneas 128-146):

```js
  const detalleActivos = study.t_activos_detalle || [];

  const handleActivoDetalleChange = (index, campo, valor) => {
    const detalle = detalleActivos.map((fila, i) => (i === index ? { ...fila, [campo]: valor } : fila));
    updateStudy({ t_activos_detalle: detalle });
  };

  const handleAgregarActivoDetalle = () => {
    updateStudy({
      t_activos_detalle: [...detalleActivos, { etiqueta: '', valor: '', esSubtotal: false }],
    });
  };

  const handleEliminarActivoDetalle = (index) => {
    updateStudy({ t_activos_detalle: detalleActivos.filter((_, i) => i !== index) });
  };
```

por:

```js
  const detalleActivos = study.t_activos_detalle || [];

  /* Los seis rubros que solo vive este detalle (ver `rubrosDesdeDetalleActivos.js`): se
     recalculan en la MISMA llamada a `updateStudy`, igual que `handleFieldChange` ya deriva
     `t_op` de `t_s`/`t_c`/`t_gastos` — así `study.t_cash` etc. nunca queda un paso atrás de
     lo que el analista acaba de escribir aquí. */
  const actualizarDetalleActivos = (detalle) => {
    updateStudy({ t_activos_detalle: detalle, ...derivarRubrosDesdeDetalleActivos(detalle) });
  };

  const handleActivoDetalleChange = (index, campo, valor) => {
    const detalle = detalleActivos.map((fila, i) => (i === index ? { ...fila, [campo]: valor } : fila));
    actualizarDetalleActivos(detalle);
  };

  const handleAgregarActivoDetalle = () => {
    actualizarDetalleActivos([...detalleActivos, { etiqueta: '', valor: '', esSubtotal: false }]);
  };

  const handleEliminarActivoDetalle = (index) => {
    actualizarDetalleActivos(detalleActivos.filter((_, i) => i !== index));
  };
```

- [ ] **Step 3: Retirar el panel de casillas del 28-ago**

Ubicar y borrar el bloque completo que arranca en el comentario `Estos rubros no cambian la
utilidad ni los ajustes de capital de trabajo` (agregado por el commit `9ac0f69`, dentro de
la sección "Cifras del Estado de Situación Financiera"):

```jsx
          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <p className="text-xs text-zinc-500 leading-relaxed mb-3">
              Estos rubros no cambian la utilidad ni los ajustes de capital de trabajo: solo
              alimentan el Análisis Vertical de la hoja Datos del Excel de soporte y del
              ANEXO A / Tabla 10. La lectura del documento no los completa todavía —
              escríbalos a mano si el balance los trae.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {RUBROS_BALANCE_ADICIONALES.map(({ clave, etiqueta }) => (
                <div key={clave} className="flex flex-col">
                  <label className="text-xs font-semibold text-zinc-500 mb-1.5">{etiqueta}</label>
                  <CampoMoneda
                    value={study[clave] ?? ''}
                    onChange={(v) => handleFieldChange(clave, v)}
                    placeholder="COP"
                    className={CLASE_CASILLA}
                  />
                </div>
              ))}
            </div>
          </div>
```

Dejar intacto el resto de la tarjeta "Cifras del Estado de Situación Financiera" (el `<div>`
que lo envolvía queda cerrado igual que antes, solo sin este bloque adentro).

- [ ] **Step 4: Verificación manual en el navegador**

Run: `npm run dev --prefix frontend`

1. Abrir un estudio con un EEFF ya cargado (o cargar uno) y entrar a "3. Ingesta Estados
   financieros".
2. Confirmar que el panel de seis casillas del 28-ago ya NO aparece — solo queda "Detalle de
   Activos (Estado de Situación Financiera)".
3. En "Detalle de Activos", editar o agregar una fila con rótulo "Efectivo y equivalentes de
   efectivo" y un valor; confirmar con React DevTools (o un `console.log(study.t_cash)`
   temporal) que `study.t_cash` toma ese valor de inmediato.
4. Borrar esa fila y confirmar que `study.t_cash` vuelve a 0.
5. Descargar el Excel Soporte Motor (Motor de Comparables) y confirmar que la hoja Datos
   muestra la cifra de esa fila en "Efectivo y equivalentes de efectivo" (no 0,00) y que su
   columna de Análisis Vertical se recalcula.
6. Confirmar que la utilidad operacional y el margen mostrados en la ingesta no cambian al
   editar estas filas (siguen sin intervenir en el margen).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/IngestaCifras.jsx
git commit -m "fix: retirar el panel redundante y derivar los seis rubros desde Detalle de Activos"
```

---

### Task 4: Revertir la exportación de `RUBROS_EXAMINADA` que solo usaba el panel retirado

**Files:**
- Modify: `frontend/src/services/memoriaCalculoRangoOptimo.js` (quitar el `export` que agregó `f7dcb4a`)
- Modify: `frontend/src/services/memoriaCalculoRangoOptimo.test.js` (quitar la prueba que agregó `f7dcb4a`, que probaba exactamente las etiquetas del panel retirado)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: nada — `RUBROS_EXAMINADA` vuelve a ser privada del módulo, como antes del 28-ago.

- [ ] **Step 1: Confirmar que ya no queda ningún import externo**

Run: `grep -rn "import.*RUBROS_EXAMINADA" frontend/src --include=*.js --include=*.jsx | grep -v "CLAVES_RUBROS_EXAMINADA\|memoriaCalculoRangoOptimo.js:"`

Expected: sin resultados fuera del propio `memoriaCalculoRangoOptimo.test.js` (que se edita
en este mismo task). Si aparece algo más, detenerse — significa que otro archivo pasó a
depender de la exportación entre el 28-ago y hoy, y hay que revisarlo antes de revertir.

- [ ] **Step 2: Quitar el `export`**

En `frontend/src/services/memoriaCalculoRangoOptimo.js`, cambiar:

```js
export const RUBROS_EXAMINADA = [
```

por:

```js
const RUBROS_EXAMINADA = [
```

- [ ] **Step 3: Quitar la prueba que probaba la exportación**

En `frontend/src/services/memoriaCalculoRangoOptimo.test.js`, quitar del import:

```js
import { hojasMemoriaRangoOptimo, TERMINOS_HOLDING_HOJA, RUBROS_EXAMINADA } from './memoriaCalculoRangoOptimo.js';
```

dejando:

```js
import { hojasMemoriaRangoOptimo, TERMINOS_HOLDING_HOJA } from './memoriaCalculoRangoOptimo.js';
```

y quitar, al final del archivo, el test agregado por `f7dcb4a`:

```js
test('RUBROS_EXAMINADA expone clave y etiqueta de los seis rubros que la ingesta aún no permite editar', () => {
  ...
});
```

- [ ] **Step 4: Correr la suite del archivo y confirmar que sigue en verde**

Run: `node --test frontend/src/services/memoriaCalculoRangoOptimo.test.js`
Expected: PASS — mismas pruebas de siempre, menos la que se acaba de quitar.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/memoriaCalculoRangoOptimo.js frontend/src/services/memoriaCalculoRangoOptimo.test.js
git commit -m "chore: revertir la exportación de RUBROS_EXAMINADA que solo usaba el panel retirado"
```

---

### Task 5: Regresión completa

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Correr toda la suite**

Run: `npm test`
Expected: todos los casos en verde (la suite completa de `scripts/lib/`,
`frontend/src/services/`, `frontend/src/utils/` y `functions/`), sin nuevos fallos frente al
estado previo a este plan.

- [ ] **Step 2: Lint del frontend**

Run: `npm run lint --prefix frontend`
Expected: sin errores (en particular, sin imports no usados — `RUBROS_EXAMINADA` y
`handleFieldChange` para las seis claves retiradas ya no deberían aparecer sueltos).

- [ ] **Step 3: Confirmar en el navegador el flujo completo, de punta a punta**

Run: `npm run dev --prefix frontend`

1. Cargar un EEFF real que SÍ traiga alguno de los seis rubros en su sección ACTIVOS (o
   editar el detalle a mano para simularlo).
2. Confirmar que "Detalle de Activos" trae esa fila y que el Excel Soporte Motor descargado
   ya no la muestra en 0,00 — sin haber tocado ningún panel aparte.
3. Confirmar que el ANEXO A / Tabla 10 del informe (o el HTML de vista previa) también
   refleja la misma cifra, ya que sale de la misma fuente (`t_activos_detalle`).
