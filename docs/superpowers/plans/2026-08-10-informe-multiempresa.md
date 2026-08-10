# Informe para cualquier empresa — Plan de implementación

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usa
> `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos usan
> casillas (`- [ ]`) para seguimiento.

**Objetivo:** que el Informe Local se genere rellenando la plantilla `.docx` del propio
cliente, y retirar la sustitución por literales de END GAME 2024, que hace imposible servir a
otra empresa.

**Arquitectura:** se conserva la ruta docxtemplater sobre el OOXML del cliente
(`docxRelleno.js` + `docxPlantilla.js`, commit `e9b9ddd`), que preserva encabezado, pie,
estilos, márgenes e índice. `exactTemplateMapper.js` se parte en dos: los generadores de tabla
—que la ruta buena consume— sobreviven en un módulo propio; el motor de reemplazo por literales
se borra junto con `masterTemplate.js`.

**Stack:** React 19 + Vite, `docxtemplater` + `pizzip`, `xlsx-js-style`, `node --test`.

## Restricciones globales

- Código, comentarios y UI en **español**. Los comentarios explican el *por qué*, no el *qué*.
- `index.html` **no recibe desarrollo nuevo** (decisión de 2026-07-31, `CLAUDE.md`).
  `public/index.html` y `public/gestor-reportes/` son artefactos de `npm run build`.
- El repo **no tiene tests de componentes React ni de `index.html`**. No afirmar que un cambio
  de UI "pasa los tests": describir qué se verificó y cómo.
- Línea base al escribir este plan: **`npm test` = 919 pass, 0 fail**;
  `npm run lint --prefix frontend` = exit 0.
- Sin trailer `Co-Authored-By` en los commits.

## Estado al escribir el plan

Ya hecho y verificado (Fase 0.1 a 0.4):

- Corregidos los dos textos publicados que no describían el cálculo (`cuartilFormula` y
  `ajuste.formula` en `memoriaCalculoRango.js`), con tests que los fijan.
- Berry unificado en `utilidad bruta / gastos operativos` (`calculations.js:pliOf`), enrutado
  al motor OCDE, y admitiendo ajuste de capital de trabajo.
- `heredado()` borrado de `rangoIntercuartil.js` y `quart` borrado de `calculations.js`: ya no
  hay dos algoritmos de cuartil.
- `AuditoriaNorma.jsx` usa `analizarRango(study)`.

## Estructura de archivos

| Archivo | Responsabilidad tras el plan |
|---|---|
| `frontend/src/services/estudioNormalizado.js` | **nuevo**. Única copia de `obtenerEstudioNormalizadoParaParche` |
| `frontend/src/services/tablasInforme.js` | **nuevo**. Generadores de tabla y filas que consume la ruta docxtemplater |
| `frontend/src/services/exactTemplateMapper.js` | **se borra** una vez vaciado |
| `frontend/src/services/masterTemplate.js` | **se borra** |
| `frontend/src/components/ReporteGenerador.jsx` | exige plantilla del cliente; sin respaldo embebido |
| `frontend/src/services/memoriaCalculoRango.js` | pierde `hojasMemoriaRango`; gana advertencias de calidad |

---

### Tarea 1: Una sola copia del normalizador del estudio

**Archivos:**
- Crear: `frontend/src/services/estudioNormalizado.js`
- Modificar: `frontend/src/services/motorExcelExport.js:12-57` (borrar la función, importarla)
- Modificar: `frontend/src/components/MemoriaRangoModal.jsx:17-73` (borrar la copia, importarla)
- Test: `frontend/src/services/estudioNormalizado.test.js`

**Interfaces:**
- Produce: `obtenerEstudioNormalizadoParaParche(estudioOriginal) → Object`. Devuelve `{}` si
  la entrada es falsy. Convierte `t_op` de utilidad operacional a **gastos operativos** vía
  `normalizarEeff`, hace lo mismo por comparable, y normaliza `t_ppe`/`ppe`. No muta la
  entrada: trabaja sobre `JSON.parse(JSON.stringify(...))`.
- Consume: `normalizarEeff` de `./eeffParserNormalizador.js`.

- [ ] **Paso 1: Escribir el test que falla**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { obtenerEstudioNormalizadoParaParche } from './estudioNormalizado.js';

test('no muta el estudio original', () => {
  const original = { t_s: 1000, t_c: 600, t_op: 100, comparables: [{ name: 'A', s: 10, c: 6, op: 1 }] };
  const copia = obtenerEstudioNormalizadoParaParche(original);
  assert.strictEqual(original.t_op, 100, 'la utilidad operacional original no se toca');
  assert.notStrictEqual(copia, original);
});

test('traduce utilidad operacional a gastos operativos', () => {
  const c = obtenerEstudioNormalizadoParaParche({ t_s: 1000, t_c: 600, t_op: 100 });
  assert.strictEqual(c.t_op, 300, 'opex = 1000 − 600 − 100');
});

test('sin estudio devuelve objeto vacío', () => {
  assert.deepStrictEqual(obtenerEstudioNormalizadoParaParche(null), {});
});
```

- [ ] **Paso 2: Correr el test y ver que falla**

`node --test frontend/src/services/estudioNormalizado.test.js`
Esperado: FAIL, `Cannot find module './estudioNormalizado.js'`.

- [ ] **Paso 3: Crear el módulo**

Mover el cuerpo íntegro de `motorExcelExport.js:12-57` al archivo nuevo, con `export function`.
Conservar el comentario de cabecera que ya tiene y añadir por qué vive aparte: estaba copiado
en dos sitios y solo uno tenía test, de modo que podían divergir sin que nada lo detectara.

- [ ] **Paso 4: Correr el test y ver que pasa**

- [ ] **Paso 5: Reemplazar las dos copias por el import**

En `motorExcelExport.js` y en `MemoriaRangoModal.jsx`, borrar la función local y añadir
`import { obtenerEstudioNormalizadoParaParche } from './estudioNormalizado.js';`
(en el modal, `'../services/estudioNormalizado.js'`).

- [ ] **Paso 6: Verificar**

`npm test` (≥ 919 pass, 0 fail) y `npm run lint --prefix frontend` (exit 0).
`grep -rn "function obtenerEstudioNormalizadoParaParche" frontend/src` → una sola definición.

- [ ] **Paso 7: Commit**

```bash
git add frontend/src/services/estudioNormalizado.js frontend/src/services/estudioNormalizado.test.js frontend/src/services/motorExcelExport.js frontend/src/components/MemoriaRangoModal.jsx
git commit -m "refactor: una sola copia del normalizador del estudio para el Excel de soporte"
```

---

### Tarea 2: Borrar `hojasMemoriaRango`, que no la llama nadie

**Archivos:**
- Modificar: `frontend/src/services/memoriaCalculoRango.js:351-503` (borrar la función)
- Modificar: `frontend/src/services/memoriaCalculoRango.test.js:183-403` (borrar sus ~23 tests)

**Interfaces:**
- `construirMemoriaRango`, `nombreArchivoMemoria` e `INDICADORES` **se conservan**: son lo que
  importa `MemoriaRangoModal.jsx:6-8`. La descarga usa `hojasMemoriaRangoOptimo`, de otro módulo.

- [ ] **Paso 1: Confirmar que está muerta**

`grep -rn "hojasMemoriaRango\b" frontend/src` — debe aparecer solo en su definición y en su
test. Si aparece en cualquier otro sitio, **parar y reportar**: el diagnóstico estaría mal.

- [ ] **Paso 2: Borrar la función y las constantes que solo ella usaba**

Borrar `hojasMemoriaRango` y revisar si `ESTILOS`, `cPct`, `cNum`, `cEnt` quedan sin uso; si
alguno lo usa `construirMemoriaRango`, se queda.

- [ ] **Paso 3: Borrar sus tests**

Todo el bloque bajo el separador `══ Hojas del Excel ══`.

- [ ] **Paso 4: Verificar y contar**

`npm test`. **Reportar el número exacto de casos que bajan** — no dejarlo implícito.
`npm run lint --prefix frontend` exit 0.

- [ ] **Paso 5: Commit**

```bash
git add frontend/src/services/memoriaCalculoRango.js frontend/src/services/memoriaCalculoRango.test.js
git commit -m "chore: retirar hojasMemoriaRango, sustituida por hojasMemoriaRangoOptimo"
```

---

### Tarea 3: Advertencias de calidad de dato en la memoria

**Archivos:**
- Modificar: `frontend/src/services/memoriaCalculoRango.js` (bloque `advertencias`, ~:119-149)
- Test: `frontend/src/services/memoriaCalculoRango.test.js`

**Interfaces:**
- Produce: `construirMemoriaRango(estudio).advertencias` — array de strings, ya existente.
  Se le añaden cuatro casos nuevos. No cambia la forma del retorno.

Las cuatro salen de la auditoría del Excel del cliente y hoy no se detectan:

1. Una comparable con PP&E desproporcionado frente a la parte examinada (en los datos reales,
   Oriental Pearl con PP&E = 124,8 % de sus ventas contra 2,18 % de la examinada). Umbral: la
   razón PP&E/base de la comparable supera en más de 10× la de la examinada.
2. Comparables con costo de ventas casi nulo (< 5 % de las ventas), que invalidan MB, CostPlus
   y Berry.
3. Denominador de Cost Plus negativo (`costo − CxP < 0`).
4. CxP de la parte examinada por debajo del 1 % de las ventas: pocos días de costo, posible
   pasivo comercial clasificado en otra cuenta.

- [ ] **Paso 1: Escribir los tests que fallan**

```js
test('avisa de la comparable con PP&E desproporcionado', () => {
  const m = construirMemoriaRango({
    ...estudio, t_ppe: 40,
    comparables: [...estudio.comparables, { name: 'PESADA S.A.', amb: 'Int', s: 1000, c: 800, op: 100, ppe: 1300 }],
  });
  assert.ok(m.advertencias.some((a) => /PESADA S\.A\./.test(a) && /PP&E/.test(a)));
});

test('avisa de comparables sin costo de ventas relevante', () => {
  const m = construirMemoriaRango({
    ...estudio,
    comparables: [...estudio.comparables, { name: 'SIN COSTO LTD', amb: 'Int', s: 1000, c: 5, op: 100 }],
  });
  assert.ok(m.advertencias.some((a) => /SIN COSTO LTD/.test(a) && /Margen Bruto|Cost Plus|Berry/.test(a)));
});

test('el estudio limpio no emite ninguna de las advertencias de calidad', () => {
  const m = construirMemoriaRango(estudio);
  assert.ok(!m.advertencias.some((a) => /PP&E|costo de ventas/.test(a)));
});
```

- [ ] **Paso 2: Correr y ver que fallan**
- [ ] **Paso 3: Implementar las cuatro comprobaciones** en el bloque `advertencias`, cada una
      con un comentario que diga de dónde sale el umbral.
- [ ] **Paso 4: Correr y ver que pasan**
- [ ] **Paso 5: Commit**

```bash
git add frontend/src/services/memoriaCalculoRango.js frontend/src/services/memoriaCalculoRango.test.js
git commit -m "feat: advertir de comparables que invalidan el método o desbordan el ajuste"
```

---

### Tarea 4: Partir `exactTemplateMapper.js`

**Archivos:**
- Crear: `frontend/src/services/tablasInforme.js`
- Modificar: `frontend/src/services/docxRelleno.js:33` (cambiar el origen del import)
- Test: mover a `frontend/src/services/tablasInforme.test.js` los casos de
  `exactTemplateMapper.test.js` que prueban generadores

**Interfaces:**
- Produce, con las mismas firmas que hoy: `filasComparablesInforme`, `filasRazonesRechazo`,
  `generarTablaCriteriosScreeningHtml`, `generarAnexoAHtml(study, year, wrap)`,
  `generarAnexoBHtml(study, year, wrap)`, y los 8 generadores de `TABLAS_MACRO`.
- **No** se mueve: `hydrateExactWordTemplate`, `ANIOS_DEL_ESTUDIO`, `diagnosticarCobertura`,
  `reemplazarAnexoB`, `reemplazarTablaRazonesRechazo`, `reemplazarTablaMuestraComparables`,
  `reemplazarTablaMargenComparables` — todos ellos operan sobre el HTML de End Game y mueren
  en la Tarea 5.

- [ ] **Paso 1: Inventariar quién importa qué**

`grep -rn "from '.*exactTemplateMapper'" frontend/src` y anotar cada símbolo. Hoy son
`docxRelleno.js:33` (2 símbolos), `ReporteGenerador.jsx:8` (2), y los dos archivos de test.

- [ ] **Paso 2: Mover los supervivientes** a `tablasInforme.js` sin cambiarles el cuerpo.
- [ ] **Paso 3: Reapuntar `docxRelleno.js`** al módulo nuevo.
- [ ] **Paso 4: Partir el archivo de test** en dos, moviendo los casos de generadores.
- [ ] **Paso 5: Verificar** `npm test` y lint.
- [ ] **Paso 6: Commit**

```bash
git add frontend/src/services/tablasInforme.js frontend/src/services/tablasInforme.test.js frontend/src/services/exactTemplateMapper.js frontend/src/services/exactTemplateMapper.test.js frontend/src/services/docxRelleno.js
git commit -m "refactor: separar los generadores de tabla del mapper por literales"
```

---

### Tarea 5: Borrar la sustitución por literales

**Archivos:**
- Borrar: `frontend/src/services/masterTemplate.js`, `frontend/src/services/exactTemplateMapper.js`
- Borrar: lo que quede de `frontend/src/services/exactTemplateMapper.test.js`
- Modificar: `frontend/src/components/ReporteGenerador.jsx:7-8`, `:430`, `:483-488`
- Modificar: `frontend/src/services/analisisMercado.test.js` (usa `hydrateExactWordTemplate`)

- [ ] **Paso 1: Retirar la ruta maestra de `ReporteGenerador.jsx`**

Borrar los dos imports, `loadExactMasterTemplate` y la llamada de `:430`. Donde hoy se cae al
respaldo embebido, mostrar el aviso de que hace falta subir la plantilla `.docx` del cliente.
El texto debe decir por qué, no solo qué falta: sin plantilla no hay informe, porque el
respaldo embebido era el documento de otro contribuyente.

- [ ] **Paso 2: Borrar los dos archivos y sus tests**

- [ ] **Paso 3: Reencaminar `analisisMercado.test.js`**

Sus casos comprueban que las tablas macro se generan bien. Reescribirlos contra los
generadores de `tablasInforme.js` en vez de contra `hydrateExactWordTemplate`. Los casos que
solo comprobaban la sustitución de literales se borran con el código que probaban.

- [ ] **Paso 4: Confirmar que no queda nada vivo**

```bash
grep -rn "MASTER_WORD_TEMPLATE\|hydrateExactWordTemplate\|exactTemplateMapper" frontend/src
```
Cero resultados fuera de comentarios históricos.

- [ ] **Paso 5: Verificar** `npm test` (reportar cuántos casos bajan y por qué), lint exit 0,
      y `npm run build` sin errores.

- [ ] **Paso 6: Commit**

```bash
git add -A frontend/src
git commit -m "feat!: el informe se genera solo desde la plantilla .docx del cliente"
```

---

### Tarea 6: Prueba de fuego multiempresa (manual, obligatoria)

No hay tests de UI: esta es la verificación real y no se puede saltar.

- [ ] `npm start` y abrir `/gestor-reportes/`.
- [ ] Crear un estudio con los archivos de
      `Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/`: RUT, Cámara de
      Comercio, composición accionaria, EEFF, `Información Operaciones PT 2025-2 modificado
      cr.xlsx` y `END GAME 2025.xls`.
- [ ] Subir `Informe Local End Game _ 2024_v2.docx` como plantilla y generar el `.docx`.
- [ ] Abrir el resultado y **buscar `901.337.576`, `604477955`, `3.435.357.400` y `END GAME`**.
      Cero apariciones no explicadas.
- [ ] Repetir con un contribuyente inventado distinto, para confirmar que no quedó nada atado
      a End Game.
- [ ] Descargar el Excel del motor y contrastarlo con `EXCEL_OPTIMO_DEL_SISTEMA_ajustado.xlsx`:
      mismas hojas, `QUARTILE` vivo, tasa única, PP&E escalado por la base. El escenario que
      reporta el informe es **W (CxC + CxP + Inventario)**.
- [ ] Correr `/revisar-ramas-equipo` antes del merge: Daniel y Pablo tocan estos archivos.

---

## Fuera de este plan

- **Fase 2, ampliar `plantillaVocabulario.js`** para cubrir las 25 auditorías: plan propio,
  depende de que la Tarea 5 esté cerrada.
- **Modelo multi-operación** (`study.operaciones[]`, egresos, un rango por operación): spec
  propio. Ver §7 del diseño.
