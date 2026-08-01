# Continuidad de comparables en el gestor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una comparable de continuidad (nombre coincide con el estudio del año anterior)
que pase holding/saldo-negativo/pérdida-operativa quede siempre en el resultado final, sin
competir por curación IA ni por el cupo `nTarget`; y que la tabla de comparables seleccionados
muestre su ID de Capital IQ y una marca visual de continuidad.

**Architecture:** Dos cambios puntuales en `scoreCandidates()`
(`frontend/src/services/comparablesEngine.js`) — ampliar un guardado existente y separar el
cupo de continuidad del cupo `nTarget` — más dos celdas nuevas en la tabla de
`frontend/src/components/MotorComparables.jsx`. No se toca `index.html` (raíz): por decisión
del usuario (2026-07-31) ya no recibe desarrollo nuevo.

**Tech Stack:** React 19 (JSX sin TypeScript), `node:test` + `node:assert` para las pruebas de
`comparablesEngine.js` (se corren con `node --test frontend/src/services/comparablesEngine.test.js`,
no hay runner de Vitest/RTL para componentes en este repo).

## Global Constraints

- No modificar `index.html` (raíz) — todo el cambio vive en `frontend/`.
- Holding, saldo negativo y pérdida operativa siguen excluyendo a cualquier candidata, sea o no
  de continuidad — no se toca esa parte de `scoreCandidates`.
- El cupo `nTarget` sigue aplicando sin cambios a las candidatas que NO son de continuidad.
- Sin campos nuevos en el modelo de datos: `esContinuidad` e `id` ya existen en cada candidata.
- Spec de referencia: `docs/superpowers/specs/2026-07-31-continuidad-comparables-gestor-design.md`.

---

### Task 1: Eximir a las candidatas de continuidad del rechazo por falta de descripción

**Files:**
- Modify: `frontend/src/services/comparablesEngine.js:352-354`
- Test: `frontend/src/services/comparablesEngine.test.js`

**Interfaces:**
- Consumes: `scoreCandidates(candidates, config, companyActivity, priorComps, contexto)` — firma
  ya existente, sin cambios de parámetros.
- Produces: sin cambios de forma en el objeto de retorno; solo cambia cuándo `descartada` es
  `true` para una candidata con `esContinuidad === true`.

- [ ] **Step 1: Escribir la prueba que falla**

Agregar al final de `frontend/src/services/comparablesEngine.test.js` (después del test que
termina en la línea 118, `'una candidata de continuidad no se descarta aunque la IA diga que no
coincide'`):

```js
test('una candidata de continuidad ya no se descarta por falta de descripción', () => {
  const candidatas = [
    { id: 'X', name: 'Continuidad Corp', nameKey: nameKey('Continuidad Corp'), desc: '', s: 100, op: 10 }
  ];
  const priorComps = [{ name: 'Continuidad Corp' }];
  const r = scoreCandidates(candidatas, { nTarget: 10 }, 'desarrollo de software', priorComps,
    { iaMatch: { porId: { OTRO: { coincide: true } } } });
  assert.strictEqual(r.rechazadas.length, 0, 'ya no se descarta por falta de descripción');
  assert.strictEqual(r.seleccionadas.length, 1);
  assert.strictEqual(r.seleccionadas[0].esContinuidad, true);
});
```

- [ ] **Step 2: Confirmar que falla**

Run: `node --test frontend/src/services/comparablesEngine.test.js`
Expected: FAIL en `'una candidata de continuidad ya no se descarta por falta de descripción'`
(hoy `r.rechazadas.length` es `1`, no `0`), el resto de pruebas del archivo sigue en verde.

- [ ] **Step 3: Implementación mínima**

En `frontend/src/services/comparablesEngine.js`, dentro de `scoreCandidates`, el bloque que hoy
dice (línea 352-354):

```js
    if (!descartada && iaPorId && idIQ && !String(cand.desc || '').trim()) {
      descartada = true;
      motivoRechazo = `Sin descripción del negocio para verificar la actividad (ID ${idIQ}).`;
    } else if (!descartada && ia && ia.coincide === false && !esContinuidad) {
```

pasa a:

```js
    if (!descartada && iaPorId && idIQ && !String(cand.desc || '').trim() && !esContinuidad) {
      descartada = true;
      motivoRechazo = `Sin descripción del negocio para verificar la actividad (ID ${idIQ}).`;
    } else if (!descartada && ia && ia.coincide === false && !esContinuidad) {
```

(Único cambio: agregar `&& !esContinuidad` a la condición del primer `if`. `esContinuidad` ya
está calculado más arriba en la misma función, línea 343 — no hace falta moverlo ni recalcularlo.)

- [ ] **Step 4: Confirmar que pasa**

Run: `node --test frontend/src/services/comparablesEngine.test.js`
Expected: PASS — todas las pruebas del archivo en verde, incluida la nueva.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/comparablesEngine.js frontend/src/services/comparablesEngine.test.js
git commit -m "fix: no descartar por falta de descripción a comparables de continuidad"
```

---

### Task 2: Separar el cupo de continuidad del cupo `nTarget`

**Files:**
- Modify: `frontend/src/services/comparablesEngine.js:428-440`
- Test: `frontend/src/services/comparablesEngine.test.js`

**Interfaces:**
- Consumes: la misma `evaluated` (arreglo de candidatas ya puntuadas) que ya construye
  `scoreCandidates` antes de esta sección — sin cambios en su forma.
- Produces: `result.seleccionadas` (`Array`) ahora puede tener más elementos que
  `config.nTarget` cuando hay candidatas de continuidad; `result.reserva` (`Array`) ya no
  incluye candidatas de continuidad (nunca deberían quedar en reserva, porque ya están
  garantizadas); `result.totalValidas` (`number`) no cambia de significado.

- [ ] **Step 1: Escribir las pruebas que fallan (o confirman el invariante)**

Agregar al final de `frontend/src/services/comparablesEngine.test.js`:

```js
test('el cupo nTarget no limita a las candidatas de continuidad: se agregan aparte', () => {
  const candidatas = [
    { id: '1', name: 'Continuidad Uno', nameKey: nameKey('Continuidad Uno'), s: 100, op: 10 },
    { id: '2', name: 'Continuidad Dos', nameKey: nameKey('Continuidad Dos'), s: 100, op: 10 },
    { id: '3', name: 'Nueva Uno', nameKey: nameKey('Nueva Uno'), s: 100, op: 10 },
    { id: '4', name: 'Nueva Dos', nameKey: nameKey('Nueva Dos'), s: 100, op: 10 },
  ];
  const priorComps = [{ name: 'Continuidad Uno' }, { name: 'Continuidad Dos' }];
  const r = scoreCandidates(candidatas, { nTarget: 1 }, '', priorComps);
  assert.strictEqual(r.seleccionadas.length, 3, '2 de continuidad + 1 por cupo, aunque nTarget sea 1');
  const continuidad = r.seleccionadas.filter(c => c.esContinuidad);
  assert.strictEqual(continuidad.length, 2, 'las dos de continuidad entran completas');
  const otras = r.seleccionadas.filter(c => !c.esContinuidad);
  assert.strictEqual(otras.length, 1, 'solo una de las nuevas, por el cupo de 1');
  assert.strictEqual(r.reserva.length, 1, 'la otra nueva queda en reserva, no la de continuidad');
});

test('holding y saldo negativo siguen excluyendo a una candidata de continuidad', () => {
  const priorComps = [{ name: 'Holding Corp' }, { name: 'Saldo Corp' }];
  const candidatas = [
    { id: 'H', name: 'Holding Corp', nameKey: nameKey('Holding Corp'), isHolding: true },
    { id: 'S', name: 'Saldo Corp', nameKey: nameKey('Saldo Corp'), hasNegativeBalance: true },
  ];
  const r = scoreCandidates(candidatas, {}, '', priorComps);
  assert.strictEqual(r.seleccionadas.length, 0, 'ninguna debe pasar pese a ser de continuidad');
  assert.strictEqual(r.rechazadas.length, 2);
});
```

La segunda prueba (`holding y saldo negativo...`) documenta un invariante que **ya se cumple
hoy** (los filtros duros no distinguen `esContinuidad`, líneas 332-341, y este task no los
toca) — no debería fallar antes del Step 3. La primera (`el cupo nTarget no limita...`) sí falla
hoy, porque hoy `seleccionadas = validas.slice(0, nTarget)` corta también a las de continuidad.

- [ ] **Step 2: Confirmar el estado antes del cambio**

Run: `node --test frontend/src/services/comparablesEngine.test.js`
Expected: FAIL solo en `'el cupo nTarget no limita a las candidatas de continuidad...'` (hoy
`r.seleccionadas.length` sería `1`, no `3`, porque `nTarget: 1` corta a las 4 candidatas juntas
ordenadas por score). El resto, incluida la prueba de holding/saldo negativo, en verde.

- [ ] **Step 3: Implementación**

En `frontend/src/services/comparablesEngine.js`, dentro de `scoreCandidates`, el bloque que hoy
dice (línea 428-440):

```js
  const validas = evaluated.filter(c => !c.descartada).sort((a, b) => b.score - a.score);
  const rechazadas = evaluated.filter(c => c.descartada);

  const seleccionadas = validas.slice(0, nTarget);

  return {
    evaluadas: evaluated.length,
    seleccionadas,
    rechazadas,
    totalValidas: validas.length,
    /* reserva: las válidas que no entraron al TOP-N, para poder reponer las que
       la curación por IA descarte sin quedarse corto de comparables */
    reserva: validas.slice(nTarget),
    medianaPool,
    conActividad: !!String(companyActivity || '').trim(),
    ventasParteExaminada: ventasTP,
  };
```

pasa a:

```js
  const validas = evaluated.filter(c => !c.descartada).sort((a, b) => b.score - a.score);
  const rechazadas = evaluated.filter(c => c.descartada);

  /* Las de continuidad ya pasaron los filtros duros (holding/saldo negativo/pérdida
     operativa aplican igual para todas, arriba); a partir de aquí no compiten por el
     cupo nTarget ni por puntaje — se agregan siempre, aparte. */
  const continuidadIncluidas = validas.filter(c => c.esContinuidad);
  const otrasValidas = validas.filter(c => !c.esContinuidad);

  const seleccionadas = [...continuidadIncluidas, ...otrasValidas.slice(0, nTarget)];

  return {
    evaluadas: evaluated.length,
    seleccionadas,
    rechazadas,
    totalValidas: validas.length,
    /* reserva: las válidas que no entraron al TOP-N, para poder reponer las que
       la curación por IA descarte sin quedarse corto de comparables */
    reserva: otrasValidas.slice(nTarget),
    medianaPool,
    conActividad: !!String(companyActivity || '').trim(),
    ventasParteExaminada: ventasTP,
  };
```

- [ ] **Step 4: Confirmar que pasa**

Run: `node --test frontend/src/services/comparablesEngine.test.js`
Expected: PASS — todas las pruebas del archivo en verde, incluidas las dos nuevas.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/comparablesEngine.js frontend/src/services/comparablesEngine.test.js
git commit -m "feat: las comparables de continuidad ya no compiten por el cupo nTarget"
```

---

### Task 3: Columna "ID IQ" y marca de continuidad en la tabla de comparables seleccionados

**Files:**
- Modify: `frontend/src/components/MotorComparables.jsx:944-975`

**Interfaces:**
- Consumes: `row.id` (`string`) y `row.esContinuidad` (`boolean`) — ambos ya presentes en cada
  elemento de `calculatedRows` porque `comparables` (el estado que alimenta `calculatedRows`)
  se llena directamente con `result.seleccionadas` de `scoreCandidates` (ver
  `runEngineSelection`, línea 254 `setComparables(finales)`), que ya trae esos dos campos.
- Produces: nada consumido por otras tareas — es la última tarea del plan.

No hay test automatizado para este archivo (no hay Vitest/RTL configurado en `frontend/`, solo
`oxlint`) — la verificación es lint + prueba manual en el navegador, como indica `CLAUDE.md`
para cambios de UI sin cobertura.

- [ ] **Step 1: Agregar la columna al encabezado**

En `frontend/src/components/MotorComparables.jsx`, el `<thead>` de la tabla de comparables
seleccionados (línea 944-955) hoy empieza:

```jsx
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 w-[18%]">Razón Social</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 w-[8%]">Ámbito</th>
```

Cambia a (se reduce Razón Social de 18% a 10% y se inserta ID IQ con 8%, para que la suma de
anchos siga en 100%):

```jsx
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 w-[10%]">Razón Social</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 w-[8%]">ID IQ</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 w-[8%]">Ámbito</th>
```

- [ ] **Step 2: Agregar la celda de ID y la marca de continuidad en el cuerpo**

La primera `<td>` de cada fila (línea 967-975) hoy es:

```jsx
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={row.name}
                      placeholder="Empresa comparable"
                      onChange={(e) => handleRowChange(idx, 'name', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent hover:border-zinc-300 focus:border-[#0FA3A1] py-1 text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
```

Cambia a:

```jsx
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={row.name}
                      placeholder="Empresa comparable"
                      onChange={(e) => handleRowChange(idx, 'name', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent hover:border-zinc-300 focus:border-[#0FA3A1] py-1 text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                    {row.esContinuidad && (
                      <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400">
                        Continuidad
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-zinc-500 dark:text-zinc-400 text-[11px]">
                    {row.id || '—'}
                  </td>
```

- [ ] **Step 3: Lint**

Run: `npm run lint --prefix frontend`
Expected: sin errores nuevos en `MotorComparables.jsx`.

- [ ] **Step 4: Verificación manual en el navegador**

1. `npm run dev --prefix frontend` (proxy `/api` → necesita `server.js` corriendo en :3000 en
   otra terminal si se va a probar curación IA; para solo ver la tabla no hace falta).
2. Abrir `/gestor-reportes/`, entrar a un estudio, ir al paso "Motor de Comparables".
3. Confirmar que la tabla de comparables seleccionados muestra la columna "ID IQ" con el valor
   de cada fila.
4. Cargar un estudio anterior cuyo nombre de comparable coincida con alguna del universo
   importado, ejecutar la selección, y confirmar que esa fila muestra la insignia
   "Continuidad" junto al nombre.
5. Confirmar que las filas sin continuidad no muestran la insignia.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MotorComparables.jsx
git commit -m "feat: mostrar ID de Capital IQ y marca de continuidad en la tabla de comparables"
```

## Self-Review

**Cobertura del spec:**
- Objetivo 1 (holding/saldo/pérdida siguen excluyendo) → ya se cumple hoy, confirmado por
  prueba de regresión en Task 2 y por la prueba preexistente de pérdida operativa (línea 81-90
  del test file); no requiere cambio de código.
- Objetivo 2 (no se pierde por IA/descripción/cupo) → Task 1 (descripción) + prueba
  preexistente (IA, línea 92-118) + Task 2 (cupo).
- Objetivo 3 (nTarget solo limita a las no-continuidad, sin tope) → Task 2.
- Objetivo 4 (columna ID + marca visual) → Task 3.
- Sección "Fuera de alcance" del spec: ningún task la contradice (no se agrega búsqueda por
  afinidad, no se toca `index.html`, no se dispara nada automático al importar, no se toca
  `priorStudyParser.js`).

**Placeholders:** ninguno — cada step trae el código exacto a escribir.

**Consistencia de tipos/nombres:** `esContinuidad`, `id`, `seleccionadas`, `rechazadas`,
`reserva`, `totalValidas` se usan con el mismo nombre en los tres tasks y coinciden con los ya
existentes en `comparablesEngine.js` y en `MotorComparables.jsx` (`result.seleccionadas` →
`setComparables(finales)` → `comparables` → `calculatedRows` → `row.id`/`row.esContinuidad`).
