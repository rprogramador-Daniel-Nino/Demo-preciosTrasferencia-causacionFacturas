# Anexo B: EEFF de comparables como imagen, no como tabla transcrita — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar, en el ANEXO B del Informe Local, las dos tablas de cifras transcritas por
OCR de cada comparable por la imagen rasterizada del EEFF que el analista ya sube en el Paso 4 —
mismo patrón que ya usa el ANEXO A.

**Architecture:** Rasterizar con pdf.js (ya usado hoy para el ANEXO A vía `convertPdfToImages`),
persistir las imágenes por comparable en el mismo almacén IndexedDB del ANEXO A (clave distinta),
y en `exactTemplateMapper.js` pintar `<img>` en vez de las tablas 2/3 del bloque de cada
comparable. El OCR de Gemini se conserva sin cambios para cruce y validación contable, y se le
agregan dos campos al prompt de lote para poder recortar, por empresa, el rasterizado de un PDF
que trae varias compañías.

**Tech Stack:** React 19 (frontend/), `pdfjs-dist` (ya en dependencies), IndexedDB vía
`plantillaStore.js`, `node:test` para las pruebas de servicios.

## Global Constraints

- Todo el trabajo es en `frontend/`. No se toca `index.html` (raíz) — CLAUDE.md: "No requiere
  desarrollo nuevo en index.html; todo nuevo va en frontend/".
- Código, comentarios y mensajes de UI en español.
- Las imágenes rasterizadas NUNCA viajan a Firestore (van a `CAMPOS_SOLO_LOCALES` /
  IndexedDB) — mismo límite que ya rompió el ANEXO A: tope de 1 MiB por documento de Firestore.
- Ningún fallo de rasterizado bloquea la carga de cifras/cruce/verificación: siempre se degrada
  con un aviso visible en `resultadoCarga`, nunca en silencio.
- Tests: `node --test` desde la raíz del repo (`npm test`, que ya incluye el glob
  `frontend/src/services/*.test.js`). Los componentes React (`MotorComparables.jsx`, `App.jsx`)
  no tienen suite automatizada (ver CLAUDE.md) — su verificación es manual en el navegador.
- Commits frecuentes, uno por task, mensaje en español siguiendo el estilo ya usado en el repo
  (prefijo `feat:`/`test:`/`fix:` + qué y por qué en una línea).

---

## Task 1: `rasterizarConReintento` y `recortarPorPagina` en `pdfRenderer.js`

**Files:**
- Modify: `frontend/src/services/pdfRenderer.js`
- Test: `frontend/src/services/pdfRenderer.test.js` (nuevo — este archivo no existe hoy)

**Interfaces:**
- Produces: `rasterizarConReintento(file, { intentos, esperaMs, rasterizar } = {})` → `Promise<string[]>`
  (siempre resuelve, nunca relanza; `[]` si se agotan los intentos).
- Produces: `recortarPorPagina(imagenes, paginaInicio, paginaFin)` → `{ imagenes: string[], delimitada: boolean }`.
- Consumes (Task 6): ambas funciones, mismo archivo.

- [ ] **Step 1: Escribir el test que falla, para `recortarPorPagina`**

Crear `frontend/src/services/pdfRenderer.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { rasterizarConReintento, recortarPorPagina } from './pdfRenderer.js';

test('recortarPorPagina recorta el rango 1-indexado', () => {
  const imagenes = ['p1', 'p2', 'p3', 'p4'];
  assert.deepStrictEqual(
    recortarPorPagina(imagenes, 2, 3),
    { imagenes: ['p2', 'p3'], delimitada: true },
  );
});

test('recortarPorPagina cae a las imágenes completas si el rango es null', () => {
  const imagenes = ['p1', 'p2'];
  assert.deepStrictEqual(
    recortarPorPagina(imagenes, null, null),
    { imagenes, delimitada: false },
  );
});

test('recortarPorPagina cae a las imágenes completas si el inicio es mayor que el fin', () => {
  const imagenes = ['p1', 'p2', 'p3'];
  assert.deepStrictEqual(
    recortarPorPagina(imagenes, 3, 1),
    { imagenes, delimitada: false },
  );
});

test('recortarPorPagina cae a las imágenes completas si el fin excede el total de páginas', () => {
  const imagenes = ['p1', 'p2'];
  assert.deepStrictEqual(
    recortarPorPagina(imagenes, 1, 5),
    { imagenes, delimitada: false },
  );
});

test('rasterizarConReintento devuelve las imágenes al primer intento', async () => {
  const falso = async () => ['pagina1'];
  const imagenes = await rasterizarConReintento({ name: 'a.pdf' }, { rasterizar: falso });
  assert.deepStrictEqual(imagenes, ['pagina1']);
});

test('rasterizarConReintento reintenta tras un fallo transitorio y luego tiene éxito', async () => {
  let llamadas = 0;
  const falso = async () => {
    llamadas++;
    if (llamadas < 2) throw new Error('fallo transitorio');
    return ['pagina1'];
  };
  const imagenes = await rasterizarConReintento({ name: 'a.pdf' }, { esperaMs: 0, rasterizar: falso });
  assert.deepStrictEqual(imagenes, ['pagina1']);
  assert.strictEqual(llamadas, 2);
});

test('rasterizarConReintento reintenta si el rasterizador devuelve un arreglo vacío', async () => {
  let llamadas = 0;
  const falso = async () => {
    llamadas++;
    return llamadas < 2 ? [] : ['pagina1'];
  };
  const imagenes = await rasterizarConReintento({ name: 'a.pdf' }, { esperaMs: 0, rasterizar: falso });
  assert.deepStrictEqual(imagenes, ['pagina1']);
});

test('rasterizarConReintento agota los intentos y devuelve un arreglo vacío sin relanzar', async () => {
  const falso = async () => { throw new Error('siempre falla'); };
  const imagenes = await rasterizarConReintento({ name: 'a.pdf' }, { intentos: 2, esperaMs: 0, rasterizar: falso });
  assert.deepStrictEqual(imagenes, []);
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --test frontend/src/services/pdfRenderer.test.js`
Expected: FAIL — `rasterizarConReintento`/`recortarPorPagina` no existen en `pdfRenderer.js`.

- [ ] **Step 3: Implementar en `pdfRenderer.js`**

Agregar al final de `frontend/src/services/pdfRenderer.js` (después de `convertPdfToImages`):

```js
/**
 * Rasteriza un PDF a imágenes, reintentando si falla o devuelve un arreglo vacío.
 *
 * Es trabajo local de CPU (canvas/pdf.js), no una llamada de red: por eso la espera
 * entre intentos es fija y corta, sin el backoff exponencial que sí tiene sentido para
 * errores HTTP transitorios (ver `postGeminiWithRetry` en `eeffParser.js`). No relanza:
 * el llamador siempre recibe un arreglo, posiblemente vacío, y decide el aviso.
 */
export async function rasterizarConReintento(file, { intentos = 3, esperaMs = 1000, rasterizar = convertPdfToImages } = {}) {
  let ultimoError;
  for (let i = 1; i <= intentos; i++) {
    try {
      const imagenes = await rasterizar(file);
      if (imagenes && imagenes.length) return imagenes;
      ultimoError = new Error('el rasterizado devolvió un arreglo vacío');
    } catch (err) {
      ultimoError = err;
    }
    if (i < intentos) await new Promise((r) => setTimeout(r, esperaMs));
  }
  console.error('[rasterizarConReintento] agotados los intentos:', ultimoError);
  return [];
}

/**
 * Recorta un arreglo de páginas rasterizadas al rango (1-indexado) de una empresa dentro
 * de un PDF de lote que trae varias. Si el rango no viene, es inválido, o se sale del
 * total de páginas, se degrada devolviendo el arreglo completo con `delimitada: false` —
 * nunca se descarta la imagen por un rango sospechoso.
 */
export function recortarPorPagina(imagenes, paginaInicio, paginaFin) {
  const total = imagenes.length;
  const inicioValido = Number.isInteger(paginaInicio) && paginaInicio >= 1;
  const finValido = inicioValido && Number.isInteger(paginaFin) && paginaFin >= paginaInicio && paginaFin <= total;
  if (!inicioValido || !finValido) {
    return { imagenes, delimitada: false };
  }
  return { imagenes: imagenes.slice(paginaInicio - 1, paginaFin), delimitada: true };
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --test frontend/src/services/pdfRenderer.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/pdfRenderer.js frontend/src/services/pdfRenderer.test.js
git commit -m "$(cat <<'EOF'
feat: reintento de rasterizado y recorte por página para el Anexo B

rasterizarConReintento reintenta el rasterizado del EEFF antes de degradar,
y recortarPorPagina aisla del PDF de lote solo las páginas de cada empresa.
Ambas puras/inyectables para poder probarlas sin pdf.js real.
EOF
)"
```

---

## Task 2: `pagina_inicio`/`pagina_fin` en el prompt de lote (`eeffParser.js`)

**Files:**
- Modify: `frontend/src/services/eeffParser.js:207-239` (`EEFF_COMPARABLES_LOTE_PROMPT`)
- Test: `frontend/src/services/eeffParser.test.js`

**Interfaces:**
- Produces: `EEFF_COMPARABLES_LOTE_PROMPT` (string) ahora incluye `pagina_inicio`/`pagina_fin`
  en el JSON de ejemplo por empresa. `parseEEFFComparablesLote` no cambia de código — esos dos
  campos llegan dentro de `datos` (el objeto que ya devuelve Gemini) sin tocar la función.
- Consumes (Task 6): `entrada.datos.pagina_inicio` / `entrada.datos.pagina_fin` en
  `MotorComparables.jsx`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `frontend/src/services/eeffParser.test.js` (mismo archivo, mismo estilo que los tests
existentes de campos del prompt):

```js
test('el prompt de lote pide pagina_inicio y pagina_fin por empresa, sobre el PDF completo', () => {
  assert.ok(EEFF_COMPARABLES_LOTE_PROMPT.includes('pagina_inicio'), 'falta "pagina_inicio"');
  assert.ok(EEFF_COMPARABLES_LOTE_PROMPT.includes('pagina_fin'), 'falta "pagina_fin"');
  assert.match(
    EEFF_COMPARABLES_LOTE_PROMPT,
    /pagina_inicio[\s\S]{0,400}null|null[\s\S]{0,400}pagina_inicio/i,
    'debe decir que se devuelve null si no se puede determinar con certeza',
  );
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --test frontend/src/services/eeffParser.test.js`
Expected: FAIL — el prompt actual no menciona `pagina_inicio` ni `pagina_fin`.

- [ ] **Step 3: Extender el prompt**

En `frontend/src/services/eeffParser.js`, dentro de `EEFF_COMPARABLES_LOTE_PROMPT`, el bloque
JSON de ejemplo por empresa (empieza en `"nombre": "Razón social EXACTA...`) agrega, junto a
`"identificador_fuente"`:

```js
      "identificador_fuente": "Company ID de Capital IQ, NIT o tax ID si figura; cadena vacía si no",
      "pagina_inicio": 1,
      "pagina_fin": 1,
```

Y en el párrafo de reglas al final del prompt (el que empieza "Reglas: una entrada por
empresa..."), agregar antes del punto final:

```
`pagina_inicio` y `pagina_fin` son la primera y la última página (1-indexadas) del PDF COMPLETO
tal como se envió donde aparecen los estados financieros de esa empresa — no un conteo relativo
a la empresa. Si el documento no permite determinarlas con certeza, devuelve `null` en ambas: no
estimes.
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --test frontend/src/services/eeffParser.test.js`
Expected: PASS (todos los tests del archivo, incluido el nuevo).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/eeffParser.js frontend/src/services/eeffParser.test.js
git commit -m "$(cat <<'EOF'
feat: pedir rango de página por empresa en el prompt de lote de EEFF

Permite recortar, del PDF de lote que trae varias comparables, solo las
páginas de cada una para el Anexo B, en vez de repetir el documento
completo en el bloque de todas.
EOF
)"
```

---

## Task 3: Persistencia por comparable en `plantillaStore.js`

**Files:**
- Modify: `frontend/src/services/plantillaStore.js`
- Test: `frontend/src/services/plantillaStore.test.js`

**Interfaces:**
- Produces: `guardarAnexoBImagenes(estudioId, mapaPorComparable)` → `Promise<void>`.
- Produces: `leerAnexoBImagenes(estudioId)` → `Promise<Record<string, string[]>>` (objeto vacío
  si no hay nada guardado).
- Produces: `borrarAnexoBImagenes(estudioId)` → `Promise<void>`, y `borrarRecursosDelEstudio`
  la incluye.
- Consumes (Task 5): las tres, desde `App.jsx`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `frontend/src/services/plantillaStore.test.js`, junto al `import` existente agregar
`guardarAnexoBImagenes, leerAnexoBImagenes` a la lista importada de `./plantillaStore.js`, y
agregar estos tests (después del bloque "══════ limpieza al borrar un estudio ══════"):

```js
test('las imágenes del Anexo B se guardan y leen por estudio, como mapa por comparable', async () => {
  await conIndexedDBSimulado(async () => {
    await guardarAnexoBImagenes('study_1', { QUBICGAMES: ['data:image/png;base64,P1', 'data:image/png;base64,P2'] });
    assert.deepStrictEqual(
      await leerAnexoBImagenes('study_1'),
      { QUBICGAMES: ['data:image/png;base64,P1', 'data:image/png;base64,P2'] },
    );
  });
});

test('leer las imágenes del Anexo B de un estudio sin nada guardado da un objeto vacío', async () => {
  await conIndexedDBSimulado(async () => {
    assert.deepStrictEqual(await leerAnexoBImagenes('study_sin_nada'), {});
  });
});

test('la clave del Anexo B no colisiona con la del Anexo A del mismo estudio', async () => {
  await conIndexedDBSimulado(async () => {
    await guardarAnexoEeff('study_1', ['data:image/png;base64,ANEXO_A']);
    await guardarAnexoBImagenes('study_1', { ACME: ['data:image/png;base64,ANEXO_B'] });
    assert.deepStrictEqual(await leerAnexoEeff('study_1'), ['data:image/png;base64,ANEXO_A']);
    assert.deepStrictEqual(await leerAnexoBImagenes('study_1'), { ACME: ['data:image/png;base64,ANEXO_B'] });
  });
});
```

Y actualizar el test existente `'borrar un estudio se lleva sus recursos, su anexo y su
vínculo'` para que también cubra el Anexo B:

```js
test('borrar un estudio se lleva sus recursos, su anexo, sus imágenes de comparables y su vínculo', async () => {
  await conIndexedDBSimulado(async () => {
    await guardarRecursos('study_1', ['data:image/png;base64,LOGO']);
    await guardarAnexoEeff('study_1', ['data:image/png;base64,PAGINA']);
    await guardarAnexoBImagenes('study_1', { ACME: ['data:image/png;base64,CMP'] });
    await guardarVinculo('study_1', 'hash-plantilla');

    const resumen = await borrarRecursosDelEstudio('study_1');

    assert.deepStrictEqual(await leerRecursos('study_1'), []);
    assert.deepStrictEqual(await leerAnexoEeff('study_1'), []);
    assert.deepStrictEqual(await leerAnexoBImagenes('study_1'), {});
    assert.strictEqual(await leerVinculo('study_1'), null);
    assert.strictEqual(resumen.fallidos, 0);
  });
});
```

Y actualizar `'un borrado que falla no impide los demás'`: ahora hay CUATRO operaciones (no
tres), y `borrarAnexoBImagenes` también vive en el almacén `'anexos'`, así que con
`fallarEn: 'anexos'` fallan DOS operaciones, no una:

```js
test('un borrado que falla no impide los demás', async () => {
  await conIndexedDBSimulado(async () => {
    await guardarRecursos('study_1', ['A']);

    const resumen = await borrarRecursosDelEstudio('study_1');

    // 'anexos' guarda tanto el Anexo A (borrarAnexoEeff) como el Anexo B
    // (borrarAnexoBImagenes) de este estudio: con ese almacén caído, las dos fallan.
    assert.strictEqual(resumen.fallidos, 2, 'las dos operaciones sobre el almacén caído cuentan');
    assert.strictEqual(resumen.borrados, 2, 'recursos y vínculo, que no dependen de "anexos", sí se borran');
    assert.deepStrictEqual(await leerRecursos('study_1'), [], 'este no dependía del caído');
  }, { fallarEn: 'anexos' });
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test frontend/src/services/plantillaStore.test.js`
Expected: FAIL — `guardarAnexoBImagenes`/`leerAnexoBImagenes` no existen; los dos tests
actualizados fallan contra el comportamiento viejo (3 operaciones, no 4).

- [ ] **Step 3: Implementar en `plantillaStore.js`**

Después de `borrarAnexoEeff` (justo antes del comentario `/* Vínculo estudio -> plantilla...`):

```js
/* Imágenes del EEFF de cada comparable para el ANEXO B, mismo almacén y mismo motivo de
   tamaño que el ANEXO A (`guardarAnexoEeff`): son data URLs, no caben en Firestore ni en
   localStorage. A diferencia del ANEXO A —un solo arreglo por estudio, un solo EEFF del
   contribuyente— aquí hay una comparable por fila, así que el valor es un mapa
   `{ [nameKey]: string[] }` en vez de un arreglo plano. Clave distinta (":cmpB") para no
   colisionar con la del ANEXO A del mismo estudio. */
export const guardarAnexoBImagenes = (estudioId, mapaPorComparable) =>
  operar('anexos', 'readwrite', (s) => s.put(mapaPorComparable, esc(estudioId) + ':cmpB'));

export const leerAnexoBImagenes = (estudioId) =>
  operar('anexos', 'readonly', (s) => s.get(esc(estudioId) + ':cmpB')).then((r) => r || {});

export const borrarAnexoBImagenes = (estudioId) =>
  operar('anexos', 'readwrite', (s) => s.delete(esc(estudioId) + ':cmpB'));
```

Y en `borrarRecursosDelEstudio`, agregar la nueva operación al `Promise.allSettled`:

```js
export async function borrarRecursosDelEstudio(estudioId) {
  const resultados = await Promise.allSettled([
    borrarRecursos(estudioId),
    borrarAnexoEeff(estudioId),
    borrarAnexoBImagenes(estudioId),
    borrarVinculo(estudioId),
  ]);
  const fallidos = resultados.filter((r) => r.status === 'rejected');
  if (fallidos.length) {
    console.warn('[plantillaStore] no se pudo limpiar todo del estudio ' + estudioId,
      fallidos.map((f) => f.reason));
  }
  return { borrados: resultados.length - fallidos.length, fallidos: fallidos.length };
}
```

- [ ] **Step 4: Ejecutar y verificar que pasan**

Run: `node --test frontend/src/services/plantillaStore.test.js`
Expected: PASS (todos los tests del archivo, viejos y nuevos).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/plantillaStore.js frontend/src/services/plantillaStore.test.js
git commit -m "$(cat <<'EOF'
feat: persistir en IndexedDB las imágenes de EEFF por comparable (Anexo B)

Mismo almacén y mismo motivo de tamaño que ya usa el Anexo A, pero como
mapa por comparable en vez de un arreglo plano por estudio. Se suma a la
limpieza de borrarRecursosDelEstudio.
EOF
)"
```

---

## Task 4: `eeffImagenesComparables` fuera de Firestore (`firestoreModelo.js`)

**Files:**
- Modify: `frontend/src/services/firestoreModelo.js:97`
- Test: `frontend/src/services/firestoreModelo.test.js:71-86,147-152`

**Interfaces:**
- Produces: `CAMPOS_SOLO_LOCALES` incluye `'eeffImagenesComparables'`.
- Consumes (Task 5): `separarEstudio`/`docEstudio` (sin cambios de código en ninguna de las
  dos — ya son genéricas sobre `CAMPOS_SOLO_LOCALES`) dejan `study.eeffImagenesComparables`
  fuera de lo que viaja a Firestore.

- [ ] **Step 1: Escribir los tests que fallan**

Modificar en `frontend/src/services/firestoreModelo.test.js` el test
`'separarEstudio deja fuera de la nube los campos pesados'`:

```js
test('separarEstudio deja fuera de la nube los campos pesados', () => {
  const study = {
    ent: 'Acme', comparables: [],
    universo: [{ id: 1 }, { id: 2 }],
    iaMatch: { porId: { A: {} } },
    eeffImages: ['data:image/png;base64,AAAA'],
    eeffImagenesComparables: { ACME_COMP: ['data:image/png;base64,BBBB'] },
  };
  const { nube, local } = separarEstudio(study);
  assert.deepStrictEqual(Object.keys(nube).sort(), ['comparables', 'ent']);
  assert.deepStrictEqual(
    Object.keys(local).sort(),
    ['eeffImagenesComparables', 'eeffImages', 'iaMatch', 'universo'],
  );
  assert.deepStrictEqual(
    CAMPOS_SOLO_LOCALES,
    ['universo', 'iaMatch', 'eeffImages', 'eeffImagenesComparables', SELLO_ESTUDIO],
  );
});
```

Y agregar, junto al test `'eeffImages no viaja a la nube'`:

```js
test('eeffImagenesComparables no viaja a la nube', () => {
  const study = { ent: 'Acme', eeffImagenesComparables: { QUBICGAMES: ['data:image/png;base64,AAAA'] } };
  const { nube, local } = separarEstudio(study);
  assert.ok(!('eeffImagenesComparables' in nube), 'las imágenes del EEFF de comparables van a IndexedDB, no a Firestore');
  assert.deepStrictEqual(local.eeffImagenesComparables, { QUBICGAMES: ['data:image/png;base64,AAAA'] });
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test frontend/src/services/firestoreModelo.test.js`
Expected: FAIL — `CAMPOS_SOLO_LOCALES` todavía no incluye `'eeffImagenesComparables'`.

- [ ] **Step 3: Implementar**

En `frontend/src/services/firestoreModelo.js:97`:

```js
export const CAMPOS_SOLO_LOCALES = ['universo', 'iaMatch', 'eeffImages', 'eeffImagenesComparables', SELLO_ESTUDIO];
```

Y actualizar el comentario de arriba (líneas 70-82) agregando una cuarta viñeta:

```js
   - `eeffImagenesComparables`: las páginas del EEFF de cada comparable para el ANEXO B,
     mismo motivo de tamaño que `eeffImages` — un mapa por comparable en vez de un arreglo
     plano. Va a IndexedDB junto con el resto de recursos binarios del informe.
```

- [ ] **Step 4: Ejecutar y verificar que pasan**

Run: `node --test frontend/src/services/firestoreModelo.test.js`
Expected: PASS (todos los tests del archivo).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/firestoreModelo.js frontend/src/services/firestoreModelo.test.js
git commit -m "$(cat <<'EOF'
feat: excluir de Firestore las imágenes de EEFF de comparables

Mismo límite de 1 MiB por documento que ya obligó a sacar eeffImages
(Anexo A) a IndexedDB.
EOF
)"
```

---

## Task 5: Cargar/guardar `eeffImagenesComparables` en `App.jsx`

**Files:**
- Modify: `frontend/src/App.jsx:22,137,197-199,234-247`

**Interfaces:**
- Consumes: `guardarAnexoBImagenes`, `leerAnexoBImagenes` (Task 3).
- Produces: `study.eeffImagenesComparables` disponible en memoria tras abrir un estudio, y
  persistido en IndexedDB tras cada autoguardado — mismo ciclo de vida que `study.eeffImages`.

No hay test automatizado para `App.jsx` (componente React, ver CLAUDE.md). Verificación manual
al final de este task.

- [ ] **Step 1: Importar las nuevas funciones**

En `frontend/src/App.jsx:22`, cambiar:

```js
import { guardarAnexoEeff, leerAnexoEeff, borrarRecursosDelEstudio } from './services/plantillaStore';
```

por:

```js
import {
  guardarAnexoEeff, leerAnexoEeff, guardarAnexoBImagenes, leerAnexoBImagenes,
  borrarRecursosDelEstudio,
} from './services/plantillaStore';
```

- [ ] **Step 2: Migración desde localStorage (línea ~137)**

En el efecto de migración, junto a la migración de `eeffImages`:

```js
        const resultado = await migrarDesdeLocalStorage(usuario, {
          guardarLocales: async (id, local) => {
            if (local.eeffImages && local.eeffImages.length) await guardarAnexoEeff(id, local.eeffImages);
            if (local.eeffImagenesComparables && Object.keys(local.eeffImagenesComparables).length) {
              await guardarAnexoBImagenes(id, local.eeffImagenesComparables);
            }
          },
        });
```

- [ ] **Step 3: Autoguardado (línea ~193-199)**

En el efecto de autoguardado, junto a `guardarAnexoEeff`:

```js
        const { local } = separarEstudio(study);
        if (local.iaMatch) guardarJSON(claveIaMatch(activeStudyId), local.iaMatch);
        /* Las páginas del PDF de estados financieros van a IndexedDB: son data URLs de
           varias páginas y no caben ni en el documento de Firestore ni en localStorage. */
        if (local.eeffImages && local.eeffImages.length) {
          await guardarAnexoEeff(activeStudyId, local.eeffImages);
        }
        /* Mismo motivo, pero por comparable: ver CAMPOS_SOLO_LOCALES. */
        if (local.eeffImagenesComparables && Object.keys(local.eeffImagenesComparables).length) {
          await guardarAnexoBImagenes(activeStudyId, local.eeffImagenesComparables);
        }
```

- [ ] **Step 4: Lectura al abrir el estudio (línea ~232-247)**

En `selectStudy`, junto a la lectura de `eeffImages`:

```js
      /* Y las páginas del ANEXO A desde IndexedDB: sin esto el informe saldría sin los
         estados financieros adjuntos, que es lo que consume exactTemplateMapper. */
      let eeffImages = [];
      try {
        eeffImages = await leerAnexoEeff(id);
      } catch (err) {
        console.error('[anexo EEFF] no se pudieron leer las páginas guardadas', err);
      }
      /* Mismo motivo, pero las imágenes del EEFF de cada comparable para el ANEXO B. */
      let eeffImagenesComparables = {};
      try {
        eeffImagenesComparables = await leerAnexoBImagenes(id);
      } catch (err) {
        console.error('[anexo B] no se pudieron leer las imágenes guardadas', err);
      }
      setStudy({
        ...(datos || {}),
        ...(iaMatch ? { iaMatch } : {}),
        ...(eeffImages && eeffImages.length ? { eeffImages } : {}),
        ...(eeffImagenesComparables && Object.keys(eeffImagenesComparables).length ? { eeffImagenesComparables } : {}),
        [SELLO_ESTUDIO]: id,
      });
```

- [ ] **Step 5: Verificación manual**

Con `npm run dev --prefix frontend` corriendo: abrir un estudio existente, recargar la página
(F5), y confirmar en la consola del navegador que no aparece ningún error nuevo relacionado con
`eeffImagenesComparables`/`leerAnexoBImagenes`/`guardarAnexoBImagenes`. (La verificación de que
las imágenes efectivamente se guarden y sobrevivan una recarga se hace en el Task 6, una vez que
`MotorComparables.jsx` las produzca.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "$(cat <<'EOF'
feat: cargar y guardar en IndexedDB las imágenes de EEFF de comparables

Mismo ciclo de vida que ya tienen las páginas del Anexo A: se leen al
abrir el estudio y se escriben en el autoguardado y en la migración
desde localStorage.
EOF
)"
```

---

## Task 6: Rasterizar en el Paso 4 (`MotorComparables.jsx`)

**Files:**
- Modify: `frontend/src/components/MotorComparables.jsx:1-30,82,133-162,741-875`

**Interfaces:**
- Consumes: `rasterizarConReintento`, `recortarPorPagina` (Task 1); `nameKey` (ya importado de
  `comparablesEngine.js`); `entrada.datos.pagina_inicio`/`pagina_fin` (Task 2, ya presentes en
  el JSON que devuelve `parseEEFFComparablesLote` sin cambio de firma).
- Produces: `study.eeffImagenesComparables` poblado tras cargar un EEFF (fila o lote) — lo que
  el Task 7 lee para pintar el Anexo B.

No hay test automatizado para este componente (ver CLAUDE.md). Verificación manual al final.

- [ ] **Step 1: Importar y agregar el estado local**

En los imports de `frontend/src/components/MotorComparables.jsx`, agregar:

```js
import { rasterizarConReintento, recortarPorPagina } from '../services/pdfRenderer';
```

Junto a la declaración de `comparables` (línea 82):

```js
  const [comparables, setComparables] = useState(study.comparables || []);
  /* Imágenes del EEFF de cada comparable para el ANEXO B, por nameKey — ver
     plantillaStore.js (guardarAnexoBImagenes) y exactTemplateMapper.js
     (generarBloqueComparableAnexoB). No es parte de `comparables`: pesa demasiado para
     ir dentro de cada fila del estudio (ver CAMPOS_SOLO_LOCALES). */
  const [eeffImagenesComparables, setEeffImagenesComparables] = useState(study.eeffImagenesComparables || {});
```

Y un helper cerca de `aplicarEeffEnFila` (línea ~602):

```js
  /* Guarda las páginas rasterizadas de esta comparable para el ANEXO B. Se combina con
     lo que ya había: dos cargas sucesivas sobre comparables distintas no deben
     pisarse entre sí. */
  const guardarImagenesComparable = (clave, imagenes) => {
    if (!clave) return;
    setEeffImagenesComparables((prev) => ({ ...prev, [clave]: imagenes }));
  };
```

- [ ] **Step 2: Incluirlo en el efecto que sincroniza con `study`**

En el `useEffect` que llama a `updateStudy` (línea ~133-162), agregar el campo y su dependencia:

```js
  useEffect(() => {
    updateStudy({
      actividad_especifica: actividad === ACTIVIDAD_SIN_EXTRAER ? '' : actividad,
      estudioAnterior: estudioAnteriorInfo,
      motorConfig: engineConfig,
      cribadoIQ,
      comparables,
      cmode,
      criteriosScreening,
      embudoSeleccion: selectionFunnel,
      iaMatch,
      eeffImagenesComparables,
    });
  }, [actividad, estudioAnteriorInfo, engineConfig, universo, comparables, cmode, criteriosScreening, iaMatch, selectionFunnel, cribadoIQ, eeffImagenesComparables]);
```

- [ ] **Step 3: Rasterizar en la carga por fila (`handleComparableEEFFUpload`)**

En `handleComparableEEFFUpload` (línea ~741), después de aplicar las cifras y antes de
`redactarDescripcionesDeFilas` (que no depende de esto y puede seguir en paralelo), agregar la
rasterización. El archivo pertenece 100% a esta fila, así que se adjuntan todas sus páginas sin
recorte:

```js
      const cruceEfectivo = traeNombre
        ? cruce
        : { modo: 'manual', punt: 1, comparable: destino, indice: compIndex };
      const filas = aplicarEeffEnFila(comparables, compIndex, result.data, result.verificacion, result.filename, cruceEfectivo);
      setComparables(filas);

      /* Imagen del EEFF para el Anexo B: no bloquea lo anterior si falla. */
      const clave = nameKey(filas[compIndex].name || '');
      const imagenes = await rasterizarConReintento(file);
      guardarImagenesComparable(clave, imagenes);
      const avisoImagen = imagenes.length
        ? ''
        : ' No se pudieron adjuntar las páginas del EEFF para el ANEXO B (revise que el archivo no esté dañado, o inténtelo de nuevo); las cifras se aplicaron igual.';

      await publicarEeff(filas, [compIndex]);
      redactarDescripcionesDeFilas(filas, [compIndex]).catch((err) =>
        console.error('[MotorComparables] no se pudo redactar la descripción de actividad', err)
      );
      setResultadoCarga({
        aplicadas: [{
          archivo: file.name,
          datos: result.data,
          motivo: (traeNombre
            ? motivoCruce(cruce, result.data, file.name)
            : 'El documento no trae razón social, así que se aplicó a «' + destino.name +
            '» sin poder verificar que le corresponde: confírmalo.') + avisoImagen,
          firme: traeNombre && esCruceFirme(cruce),
          verificacion: result.verificacion,
        }],
        rechazadas: [],
      });
```

(Reemplaza el bloque `setComparables(filas); await publicarEeff(...); redactarDescripcionesDeFilas(...); setResultadoCarga({...})` que ya existe ahí — el `motivo` de la única entrada de `aplicadas` gana el sufijo `avisoImagen` cuando la rasterización falla.)

- [ ] **Step 4: Rasterizar y recortar en la carga masiva (`handleCargaMasivaEEFF`)**

En `handleCargaMasivaEEFF` (línea ~809), dentro del bucle que ya lee cada archivo con
`parseEEFFComparablesLote`, rasterizar una sola vez por archivo y adjuntar la referencia a cada
entrada leída de ese archivo:

```js
      const studyYear = study.anio || 2025;
      for (let i = 0; i < lista.length; i++) {
        const file = lista[i];
        setCargaEeff({ etapa: 'Leyendo ' + file.name + '…', hechas: i, total: lista.length });
        try {
          const leidas = await parseEEFFComparablesLote(file, studyYear);
          if (!leidas.length) {
            fallosLectura.push({
              archivo: file.name,
              motivo: 'No se pudo identificar ninguna empresa con razón social en el documento. ' +
                'Si es el estado financiero de una sola comparable, cárgalo desde su fila.',
            });
          } else {
            /* Una sola rasterización por archivo: el PDF de lote puede traer varias
               empresas, y cada una se recorta de este mismo arreglo (Step 5). */
            const imagenesDelArchivo = await rasterizarConReintento(file);
            entradas.push(...leidas.map((l) => ({ ...l, _imagenesDelArchivo: imagenesDelArchivo })));
          }
        } catch (err) {
          fallosLectura.push({ archivo: file.name, motivo: 'No se pudo leer: ' + (err?.message || err) });
        }
      }
```

- [ ] **Step 5: Recortar por empresa tras el cruce, en el mismo método**

Después de `const { aplicadas, rechazadas } = repartir(entradas, comparables);`, antes de
`setComparables(filas)`:

```js
      setCargaEeff({ etapa: 'Cruzando ' + entradas.length + ' empresa(s) con las comparables…', hechas: lista.length, total: lista.length });
      const { aplicadas, rechazadas } = repartir(entradas, comparables);

      let filas = comparables;
      aplicadas.forEach((a) => {
        filas = aplicarEeffEnFila(filas, a.indice, a.datos, a.verificacion, a.archivo, a.cruce);
      });

      /* Imágenes por empresa, recortadas del PDF de lote al que pertenecen. Se hace
         después de aplicar las cifras: la clave (nameKey) sale del nombre ya asentado
         en la fila, que puede diferir en mayúsculas/acentos del que trajo el documento. */
      aplicadas.forEach((a) => {
        const clave = nameKey(filas[a.indice].name || '');
        const imagenesArchivo = a._imagenesDelArchivo || [];
        if (!imagenesArchivo.length) {
          a.motivo += ' No se pudieron adjuntar las páginas del EEFF para el ANEXO B (revise que el archivo no esté dañado, o inténtelo de nuevo); las cifras se aplicaron igual.';
          return;
        }
        const { imagenes, delimitada } = recortarPorPagina(imagenesArchivo, a.datos.pagina_inicio, a.datos.pagina_fin);
        guardarImagenesComparable(clave, imagenes);
        if (!delimitada) {
          a.motivo += ' No se pudo delimitar la página de esta empresa dentro del documento; se adjuntó el PDF completo — revisa que no incluya páginas de otras comparables.';
        }
      });

      if (aplicadas.length) {
        setComparables(filas);
        await publicarEeff(filas, aplicadas.map(a => a.indice));
        redactarDescripcionesDeFilas(filas, aplicadas.map((a) => a.indice)).catch((err) =>
          console.error('[MotorComparables] no se pudo redactar la descripción de actividad', err)
        );
      }
      setResultadoCarga({ aplicadas, rechazadas: [...rechazadas, ...fallosLectura] });
```

- [ ] **Step 6: Verificación manual**

Con `npm run dev --prefix frontend`:

1. Abrir un estudio con comparables ya seleccionadas (Paso 3 ejecutado).
2. En el Paso 4, subir un EEFF de una sola comparable sobre su fila. Confirmar en el panel de
   resultado que dice "aplicadas" y que no aparece el aviso de imagen fallida (o, si el PDF de
   prueba es inválido, que el aviso aparece y las cifras igual se aplicaron).
3. Subir en carga masiva un único PDF que junte los EEFF de 2-3 comparables. Confirmar que cada
   una queda con su propia entrada en `resultadoCarga.aplicadas` y, si el modelo no delimita
   página, que aparece el aviso correspondiente.
4. Recargar la página (F5) y confirmar que el estudio conserva las comparables cargadas (esto
   verifica que el Task 5 realmente persiste `eeffImagenesComparables` de punta a punta).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/MotorComparables.jsx
git commit -m "$(cat <<'EOF'
feat: rasterizar el EEFF de cada comparable para el Anexo B (Paso 4)

Carga por fila: se adjunta el PDF completo. Carga masiva: se rasteriza
una vez por archivo y se recorta por empresa con el rango de página que
ahora pide el prompt. Ningún fallo de imagen bloquea cifras ni cruce.
EOF
)"
```

---

## Task 7: Pintar imágenes en vez de tablas (`exactTemplateMapper.js`)

**Files:**
- Modify: `frontend/src/services/exactTemplateMapper.js:1-18,485-546,556-565`
- Test: `frontend/src/services/exactTemplateMapper.test.js:614-802`

**Interfaces:**
- Consumes: `study.eeffImagenesComparables` (Task 5/6), `nameKey` de `comparablesEngine.js`.
- Produces: `generarBloqueComparableAnexoB(comp, year, wrap, imagenes)` — firma nueva, cuarto
  parámetro obligatorio. `generarAnexoBHtml(study, year, wrap)` — firma sin cambios.

- [ ] **Step 1: Reescribir los tests existentes que asumen tablas de cifras**

En `frontend/src/services/exactTemplateMapper.test.js`, reemplazar el fixture
`comparableCompleta` (línea 614) y los tests de las líneas 633 a 736 (desde `'genera las tres
tablas de una comparable con EEFF verificado'` hasta `'sin comparables con EEFF cargado, sale el
aviso de pendiente y no el ejemplo estático'`) por:

```js
const comparableCompleta = {
  name: 'AKATSUKI INC.',
  eeffVerificado: true,
  eeffArchivo: 'akatsuki_eeff.pdf',
  desc: 'Akatsuki Inc. is engaged in the game, comic and other businesses.',
  descActividad: 'Akatsuki Inc. se dedica al juego y cómic en Japón.',
};

const IMG_AKATSUKI = ['data:image/png;base64,PAGINA1', 'data:image/png;base64,PAGINA2'];

test('pinta las páginas del EEFF como imagen cuando la comparable las tiene', () => {
  const study = { anio: 2025, comparables: [comparableCompleta], eeffImagenesComparables: { AKATSUKI: IMG_AKATSUKI } };
  const html = generarAnexoBHtml(study, 2025, (v) => v);

  assert.ok(html.includes('<strong>AKATSUKI INC.</strong>'));
  assert.ok(html.includes('Akatsuki Inc. se dedica al juego y cómic en Japón.'));
  assert.ok(html.includes('<img src="data:image/png;base64,PAGINA1"'), 'falta la primera página');
  assert.ok(html.includes('<img src="data:image/png;base64,PAGINA2"'), 'falta la segunda página');
  // Ya no se transcribe ninguna cifra a tabla: sin OCR de por medio en esta sección.
  assert.ok(!html.includes('Ventas netas'), 'no debería sobrevivir la tabla vieja de P&L');
  assert.ok(!html.includes('Activos totales promedio'), 'no debería sobrevivir la tabla vieja de balance');
});

test('sin imágenes para esa comparable, sale un aviso de pendiente por fila, no una tabla', () => {
  const study = { anio: 2025, comparables: [comparableCompleta], eeffImagenesComparables: {} };
  const html = generarAnexoBHtml(study, 2025, (v) => v);

  assert.ok(html.includes('<strong>AKATSUKI INC.</strong>'), 'la tabla de nombre+descripción se conserva');
  assert.ok(html.includes('Akatsuki Inc. se dedica al juego y cómic en Japón.'));
  assert.ok(html.includes('Pendiente: vuelva a cargar el Estado Financiero de esta comparable en el Paso 4'));
  assert.ok(!html.includes('<img'), 'no debería haber ninguna imagen');
});

test('cada comparable pinta solo sus propias imágenes, no las de otra', () => {
  const otra = { ...comparableCompleta, name: 'IGG INC.', descActividad: 'IGG Inc. desarrolla videojuegos móviles.' };
  const study = {
    anio: 2025,
    comparables: [comparableCompleta, otra],
    eeffImagenesComparables: {
      AKATSUKI: ['data:image/png;base64,A'],
      IGG: ['data:image/png;base64,B'],
    },
  };
  const html = generarAnexoBHtml(study, 2025, (v) => v);

  const bloqueAkatsuki = html.slice(0, html.indexOf('IGG INC.'));
  assert.ok(bloqueAkatsuki.includes('data:image/png;base64,A'));
  assert.ok(!bloqueAkatsuki.includes('data:image/png;base64,B'), 'se coló la imagen de otra comparable');
});

test('una comparable con EEFF cargado pero con alertas contables entra igual al Anexo B', () => {
  // Caso real reportado: comparables extranjeras casi nunca cuadran la ecuación
  // patrimonial ni coinciden en año con el estudio, así que exigir eeffVerificado dejaba
  // el Anexo B en "Pendiente" incluso con EEFF real cargado para todas las comparables.
  const conAlertas = {
    ...comparableCompleta,
    name: 'TOSE CO., LTD.',
    eeffVerificado: false,
    eeffHallazgos: ['⚠️ Ecuación patrimonial no cuadra: Activos (7836) ≠ Pasivos (1675) + Patrimonio (0)'],
  };
  const html = generarAnexoBHtml({ anio: 2026, comparables: [conAlertas], eeffImagenesComparables: {} }, 2026, (v) => v);
  assert.ok(html.includes('<strong>TOSE CO., LTD.</strong>'), 'la comparable con alertas debería entrar al Anexo B');
});

test('sin comparables con EEFF cargado, sale el aviso de pendiente y no el ejemplo estático', () => {
  const html = generarAnexoBHtml({ anio: 2025, comparables: [{ name: 'SIN ARCHIVO', eeffVerificado: false }] }, 2025, (v) => v);
  assert.ok(html.includes('Pendiente'));
  assert.ok(!html.includes('AKATSUKI'));
  assert.ok(!html.includes('COLOPL'));
});
```

En el test `'reemplazarAnexoB sustituye el bloque estático completo...'` (línea 740) y en
`'hydrateExactWordTemplate reemplaza el ANEXO B completo...'` (línea 759), quitar los campos
`s, c, op, ar, inv, ap, eeffDatos` de los fixtures (ya no se usan) y agregar
`eeffImagenesComparables` al `study`:

```js
test('reemplazarAnexoB sustituye el bloque estático completo, entre su título y el de ANEXO C', () => {
  const fragmentoConEjemploEstatico =
    '<h1>\n<a id="_Toc208931006"></a>ANEXO B. Descripciones de comparables y Estados Financieros\n</h1>\n' +
    '<table><thead><tr><th>NOMBRE</th></tr></thead><tbody><tr><td>AKATSUKI INC.</td></tr></tbody></table>\n' +
    '<h1>\n<a id="_Toc456190765"></a><a id="_Toc208931007"></a>ANEXO C. Matriz de Rechazo\n</h1>\n<table>otra tabla</table>';

  const study = { anio: 2025, comparables: [comparableCompleta], eeffImagenesComparables: { AKATSUKI: IMG_AKATSUKI } };
  const salida = reemplazarAnexoB(fragmentoConEjemploEstatico, study, 2025, (v) => v);

  assert.ok(salida.includes('Akatsuki Inc. se dedica al juego y cómic en Japón.'));
  assert.ok(!salida.includes('<td>AKATSUKI INC.</td>'), 'sobrevivió la fila estática sin descripción');
  assert.ok(salida.includes('ANEXO C. Matriz de Rechazo'), 'se perdió el título de ANEXO C');
  assert.ok(salida.includes('otra tabla'), 'se perdió contenido de ANEXO C');
});

test('hydrateExactWordTemplate reemplaza el ANEXO B completo con las comparables del estudio activo, no las de End Game', () => {
  const estudio = {
    ent: 'ACME COLOMBIA S.A.S', nit: '800123456-7', anio: 2025,
    comparables: [{
      name: 'DISTRIBUIDORA ANDINA S.A.',
      eeffVerificado: true,
      eeffArchivo: 'distribuidora_andina_eeff.pdf',
      desc: 'Distributes consumer goods across the Andean region.',
      descActividad: 'Distribuidora Andina S.A. distribuye bienes de consumo en la región andina.',
    }],
    eeffImagenesComparables: { 'DISTRIBUIDORA ANDINA SA': ['data:image/png;base64,X'] },
  };

  const salida = hydrateExactWordTemplate(MASTER_WORD_TEMPLATE, estudio);

  const inicioAnexoB = salida.indexOf('id="_Toc208931006"');
  const inicioAnexoC = salida.indexOf('id="_Toc208931007"', inicioAnexoB);
  const bloqueAnexoB = salida.slice(inicioAnexoB, inicioAnexoC);

  assert.ok(!bloqueAnexoB.includes('AKATSUKI'), 'sobrevivió una comparable del informe de referencia en ANEXO B');
  assert.ok(!bloqueAnexoB.includes('COLOPL'), 'sobrevivió una comparable del informe de referencia en ANEXO B');
  assert.ok(!bloqueAnexoB.includes('FUN YOURS'), 'sobrevivió una comparable del informe de referencia en ANEXO B');
  assert.ok(!bloqueAnexoB.includes('IGG INC'), 'sobrevivió una comparable del informe de referencia en ANEXO B');
  assert.ok(!bloqueAnexoB.includes('MAXIMUM ENTERTAINMENT'), 'sobrevivió una comparable del informe de referencia en ANEXO B');
  assert.ok(!bloqueAnexoB.includes('NEPTUNE COMPANY'), 'sobrevivió una comparable del informe de referencia en ANEXO B');
  assert.ok(!bloqueAnexoB.includes('OURPALM'), 'sobrevivió una comparable del informe de referencia en ANEXO B');
  assert.ok(!bloqueAnexoB.includes('PLAYSTUDIOS'), 'sobrevivió una comparable del informe de referencia en ANEXO B');
  assert.ok(!bloqueAnexoB.includes('QUBICGAMES'), 'sobrevivió una comparable del informe de referencia en ANEXO B');
  assert.ok(!bloqueAnexoB.includes('THE DUST'), 'sobrevivió una comparable del informe de referencia en ANEXO B');
  assert.ok(!bloqueAnexoB.includes('TOSE CO'), 'sobrevivió una comparable del informe de referencia en ANEXO B');
  assert.ok(!bloqueAnexoB.includes('WEMADE PLAY'), 'sobrevivió una comparable del informe de referencia en ANEXO B');
  assert.ok(!bloqueAnexoB.includes('YOOZOO'), 'sobrevivió una comparable del informe de referencia en ANEXO B');
  assert.ok(bloqueAnexoB.includes('DISTRIBUIDORA ANDINA S.A.'), 'no entró la comparable del estudio activo en ANEXO B');
  assert.ok(bloqueAnexoB.includes('Distribuidora Andina S.A. distribuye bienes de consumo en la región andina.'));
  assert.ok(bloqueAnexoB.includes('data:image/png;base64,X'), 'no se pintó la imagen de la comparable');
  assert.ok(salida.includes('ANEXO C. Matriz de Rechazo'), 'se perdió el título de ANEXO C tras el reemplazo');
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test frontend/src/services/exactTemplateMapper.test.js`
Expected: FAIL — `generarBloqueComparableAnexoB` todavía pinta tablas de cifras, no imágenes.

- [ ] **Step 3: Implementar**

Agregar el import de `nameKey` en `frontend/src/services/exactTemplateMapper.js:1-18`:

```js
import { fmt, pctf, num, getUvtValue } from '../utils/calculations.js';
import { analizarRango } from './rangoIntercuartil.js';
import { resaltarValor } from './estiloDocumento.js';
import { nameKey } from './comparablesEngine.js';
import {
  DATOS_MACRO,
  ...
```

Reemplazar el bloque completo desde el comentario `/* ══════════════ ANEXO B...` (línea 485)
hasta el cierre de `generarAnexoBHtml` (línea 565) — es decir, `ANEXO_B_ETIQUETAS_PL`,
`ANEXO_B_ETIQUETAS_BALANCE`, `filasOpcionalesPL`, `generarBloqueComparableAnexoB` y
`generarAnexoBHtml` — por:

```js
/* ══════════════ ANEXO B. Descripciones de comparables y Estados Financieros ══════════════
   La tabla 1 (nombre + descripción) se sigue redactando con IA (descripcionComparables.js).
   Las cifras del EEFF de cada comparable ya NO se transcriben a tabla: se pega como imagen
   la página del documento que el analista subió en el Paso 4 (mismo patrón que el ANEXO A,
   ver generarAnexoAHtml), para no arriesgar que el OCR redondee o lea mal una cifra en un
   informe que se radica ante la DIAN. Ver docs/superpowers/specs/2026-08-06-anexo-b-eeff-como-imagen-design.md. */

/* Las tres tablas de una comparable pasan a ser una (nombre+descripción) más las páginas de
   su EEFF como imagen. `imagenes` ya viene resuelto por `generarAnexoBHtml` desde
   `study.eeffImagenesComparables[nameKey(comp.name)]`. */
function generarBloqueComparableAnexoB(comp, year, wrap, imagenes) {
  const descripcion = comp.descActividad || comp.desc || 'Descripción de actividad no disponible.';

  const tablaNombreDescripcion =
    `<table>\n<thead>\n<tr>\n<th>\n<p>\n<strong>NOMBRE DE LA COMPAÑÍA COMPARABLE</strong>\n</p>\n</th>\n<th>\n<p>\n<strong>DESCRIPCIÓN ACTIVIDAD</strong>\n</p>\n</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n${celdaTabla('<strong>' + comp.name + '</strong>')}\n${celdaTabla(descripcion)}\n</tr>\n</tbody>\n</table>`;

  if (imagenes && imagenes.length > 0) {
    const bloqueImagenes = imagenes.map((img, i) => `
<p style="text-align:center;margin:16px 0;">
  <img src="${img}" alt="Página ${i + 1} EEFF ${comp.name}" style="max-width:100%;height:auto;border:1px solid #e2e8f0;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.1);" />
</p>`).join('\n');
    return tablaNombreDescripcion + '\n' + bloqueImagenes;
  }

  return tablaNombreDescripcion +
    '\n<p>\nPendiente: vuelva a cargar el Estado Financiero de esta comparable en el Paso 4 del motor de comparables.\n</p>\n';
}

/* Cuerpo dinámico del ANEXO B. Entra cualquier comparable con un EEFF cargado y cruzado a
   su fila (`eeffArchivo`), tenga o no alertas contables — ver el comentario largo que ya
   traía esta función sobre por qué no se exige `eeffVerificado`. Sin ninguna comparable con
   archivo cargado, sale el aviso de pendiente en vez de las trece compañías de videojuegos
   del informe de referencia. */
export function generarAnexoBHtml(study, year, wrap) {
  const comparables = ((study && study.comparables) || []).filter((c) => c && c.name && c.eeffArchivo);
  const titulo = '<h1>\n<a id="_Toc208931006"></a>ANEXO B. Descripciones de comparables y Estados Financieros\n</h1>\n';

  if (!comparables.length) {
    return titulo + '<p>\nPendiente: cargue los Estados Financieros de las comparables en el Paso 4 del motor de comparables.\n</p>\n';
  }

  const imagenesPorComparable = (study && study.eeffImagenesComparables) || {};
  return titulo + comparables.map((c) =>
    generarBloqueComparableAnexoB(c, year, wrap, imagenesPorComparable[nameKey(c.name)] || [])
  ).join('\n') + '\n';
}
```

`reemplazarAnexoB` (línea 572, justo después de lo reemplazado) no cambia — sigue llamando a
`generarAnexoBHtml(study, year, wrap)` con la misma firma.

- [ ] **Step 4: Ejecutar y verificar que pasan**

Run: `node --test frontend/src/services/exactTemplateMapper.test.js`
Expected: PASS (todos los tests del archivo).

Run también la suite completa para asegurar que no se rompió nada fuera de este archivo:
`npm test` (desde la raíz del repo).
Expected: PASS.

- [ ] **Step 5: Verificación manual end-to-end**

Con `npm run dev --prefix frontend` y un estudio con al menos una comparable con EEFF cargado
(Task 6 ya deja esto operativo): generar el Word desde "Paso 6: Generar Reporte" (o el paso
correspondiente de `ReporteGenerador.jsx`) y confirmar en la vista previa que el ANEXO B muestra
la tabla de nombre+descripción seguida de la imagen del EEFF tal como se subió — no una tabla de
cifras.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/exactTemplateMapper.js frontend/src/services/exactTemplateMapper.test.js
git commit -m "$(cat <<'EOF'
feat: pintar la imagen del EEFF de cada comparable en el Anexo B

Reemplaza las tablas de P&L y balance transcritas por OCR (redondeaban y
podían leer mal el documento) por las páginas originales del EEFF que el
analista subió en el Paso 4, mismo patrón que ya usa el Anexo A.
EOF
)"
```

---

## Self-Review (completado al escribir este plan)

- **Cobertura del spec:** Parte A (rasterizado+reintento: Task 1; prompt de lote: Task 2;
  captura en Paso 4: Task 6) — Parte B (persistencia: Task 3; campo local-only: Task 4; carga en
  `App.jsx`: Task 5) — Parte C (render: Task 7) — Manejo de errores (avisos degradados: Tasks 6
  y 1) — Testing (una tarea de test por pieza automatizable; UI cubierta por verificación manual
  explícita en Tasks 5, 6 y 7). Sin huecos.
- **Placeholders:** ninguno — cada step trae el código real a escribir/ejecutar.
- **Consistencia de tipos/nombres:** `rasterizarConReintento`/`recortarPorPagina` (Task 1) se
  usan con la misma firma en Task 6. `guardarAnexoBImagenes`/`leerAnexoBImagenes` (Task 3) se
  usan igual en Task 5. `eeffImagenesComparables` es el mismo nombre de campo en Tasks 4, 5, 6 y
  7. `generarBloqueComparableAnexoB(comp, year, wrap, imagenes)` — firma nueva usada solo
  internamente por `generarAnexoBHtml`, que sí mantiene su firma pública sin cambios (no rompe a
  `reemplazarAnexoB` ni a `hydrateExactWordTemplate`, que no se tocan).
