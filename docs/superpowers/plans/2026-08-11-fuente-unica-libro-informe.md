# Una sola fuente para el libro de soporte y las tablas del informe — Plan de implementación

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan sintaxis de casilla (`- [ ]`) para el seguimiento.

**Goal:** Que el libro de soporte del Motor de Comparables y las tablas del Informe Local publiquen el mismo número por construcción, y que el `.xlsx` deje de salir sin un solo valor calculado.

**Architecture:** `ajusteRangoCapitalTrabajo.js` es el único motor. `memoriaCalculoRangoOptimo.js` sigue emitiendo fórmulas nativas de Excel —eso es lo que hace el libro auditable— pero además le pide a ese motor el valor de cada celda derivada y lo escribe como valor en caché (`{t:'n', f:'…', v:…}`). `docxRelleno.js` deja de calcular cuartiles propios. Las divergencias de universo entre el libro y el informe se cierran pasando al libro los tres datos que hoy no recibe: `cmode`, `seg_excluido` y el `amb` de cada comparable.

**Tech Stack:** JavaScript ESM, `xlsx-js-style`, `node:test` + `node:assert`. Sin framework de pruebas externo.

## Global Constraints

- Todo el código, los comentarios y los mensajes de commit van **en español**.
- `npm test` al 100 % en verde al cerrar cada tarea. Hoy son **954** pruebas y ese número no puede bajar.
- Convenio de `op` y `t_op` en este subsistema: son **GASTOS operativos**, no utilidad operacional. Tanto `hojasMemoriaRangoOptimo` como `analizarRangoAjustado` esperan esa convención. El resto del sistema usa la contraria; la traducción la hace `obtenerEstudioNormalizadoParaParche`.
- Convenio de `prime`: **en porcentaje** (`7.37`, no `0.0737`). `hojasMemoriaRangoOptimo` la divide entre 100 al escribir la celda; `analizarRangoAjustado` la divide entre 100 en `:285`. Ninguna de las dos debe recibirla ya dividida.
- No se toca `index.html`. No recibe desarrollo nuevo.
- No se toca `public/`: lo regenera `npm run build`.
- Verificado empíricamente antes de escribir este plan: `xlsx-js-style` sí emite el valor en caché junto a la fórmula. `{t:'n', f:'1+1', v:2}` produce `<c r="A2"><f>1+1</f><v>2</v></c>`, y `{t:'s', f:'IF(…)', v:'CUMPLE'}` produce `<c t="str"><f>…</f><v>CUMPLE</v></c>`. `aoa_to_sheet` conserva el objeto de celda tal cual.

---

## File Structure

| Archivo | Responsabilidad | Tareas |
|---|---|---|
| `frontend/src/services/docxRelleno.js` | Retirar el tercer camino del cuartil | 1 |
| `frontend/src/services/rangoIntercuartil.js` | Publicar la estadística sin ajuste, con la conversión de convenio en un solo sitio | 1 |
| `frontend/src/services/motorExcelExport.js` | Pasar al libro el ámbito, el segmento excluido y el `amb` de cada comparable | 2 |
| `frontend/src/services/memoriaCalculoRangoOptimo.js` | Direcciones calculadas, ESF completo, universo filtrado del cuartil, valor en caché | 3, 4, 5, 6, 7, 8 |

Los tests van junto a cada servicio, como todo el repo: `<servicio>.test.js`.

---

### Task 1: Un solo cuartil en el informe

Hoy `docxRelleno.js:568-576` construye su propia serie «NO AJUSTADO» —la ordena y llama `cuartilInterpolado` directo— mientras la columna «AJUSTADO» toma `stats` del motor (`:584-586`). Con `cmode` en `'nac'` o `'intl'`, la mitad ajustada de la tabla excluye las comparables fuera de ámbito y la mitad no ajustada las incluye: **la misma tabla, dos universos**.

El motor ya sabe dar esa estadística: `analizarRangoAjustado(estudio, metodo, 'ninguno')`. Pero `docxRelleno` no puede llamarlo directo, porque antes hay que traducir `t_op` de utilidad a gastos, y eso lo hace `rangoIntercuartil.js` en `aConvenioOCDE`. Así que la estadística sin ajuste se publica desde ahí.

**Files:**
- Modify: `frontend/src/services/rangoIntercuartil.js:60-108`
- Modify: `frontend/src/services/docxRelleno.js:552-586`
- Test: `frontend/src/services/rangoIntercuartil.test.js`

**Interfaces:**
- Produces: `analizarRango(estudio)` devuelve un campo más, `statsNoAjustado`, con la misma forma que `stats` (`{p25, med, p75, min, max, n}` o `null`). Las Tasks siguientes no dependen de esto.

- [ ] **Step 1: Escribir la prueba que falla**

En `frontend/src/services/rangoIntercuartil.test.js`, al final:

```js
test('la estadística sin ajuste respeta el filtro de ámbito, igual que la ajustada', () => {
  /* Con cmode 'nac' el rango ajustado excluye las internacionales. La estadística
     sin ajuste tiene que excluirlas también: son las dos columnas de la MISMA
     tabla del informe, y publicar cada una sobre un universo distinto es la fuga
     que esta prueba cierra. */
  const estudio = {
    pli: 'MO', useadj: true, cmode: 'nac', prime: 7.37,
    t_s: 1000, t_c: 600, t_op: 200, t_ar: 100, t_inv: 50, t_ap: 80, t_ppe: 300,
    comparables: [
      { name: 'Nacional A', amb: 'Nac', s: 500, c: 300, op: 120, ar: 50, inv: 20, ap: 40, ppe: 100 },
      { name: 'Nacional B', amb: 'Nac', s: 800, c: 500, op: 180, ar: 70, inv: 30, ap: 50, ppe: 120 },
      { name: 'Nacional C', amb: 'Nac', s: 600, c: 350, op: 150, ar: 60, inv: 25, ap: 45, ppe: 110 },
      /* Margen deliberadamente extremo: si entra, mueve el mínimo y el máximo. */
      { name: 'Internacional X', amb: 'Int', s: 900, c: 100, op: 100, ar: 10, inv: 5, ap: 5, ppe: 10 },
    ],
  };

  const r = analizarRango(estudio);
  assert.ok(r.statsNoAjustado, 'se publica la estadística sin ajuste');

  const nacionales = estudio.comparables.filter((c) => c.amb === 'Nac').length;
  assert.strictEqual(r.statsNoAjustado.n, nacionales,
    'la serie sin ajuste cuenta solo las nacionales');
  assert.strictEqual(r.stats.n, r.statsNoAjustado.n,
    'las dos columnas de la tabla se calculan sobre el mismo universo');
});
```

- [ ] **Step 2: Correr la prueba y confirmar que falla**

Run: `node --test frontend/src/services/rangoIntercuartil.test.js`
Expected: FAIL — `r.statsNoAjustado` es `undefined`, así que revienta el primer `assert.ok`.

- [ ] **Step 3: Publicar la estadística sin ajuste desde `rangoIntercuartil.js`**

En `porMetodologiaOCDE`, devolver también la estadística del escenario sin ajuste. Reemplazar la función entera:

```js
function porMetodologiaOCDE(study, kind) {
  const ajuste = study.useadj ? SABOR_INFORME : 'ninguno';
  const preparado = {
    ...study,
    t_op: aConvenioOCDE({ s: study.t_s, c: study.t_c, op: study.t_op }).op,
    comparables: (study.comparables || []).map(aConvenioOCDE),
  };
  const r = analizarRangoAjustado(preparado, kind, ajuste);

  /* La estadística del escenario SIN ajuste, que es la columna «NO AJUSTADO» de las
     tablas del informe y la columna S del libro de soporte. Se pide al motor en vez
     de recalcularla: `docxRelleno.js` la ordenaba y la cuartilaba por su cuenta, sin
     el filtro de ámbito, de modo que las dos columnas de una misma tabla salían sobre
     universos distintos. Cuando el escenario reportado ya es «ninguno» no hace falta
     una segunda pasada. */
  const statsNoAjustado = ajuste === 'ninguno'
    ? r.stats
    : analizarRangoAjustado(preparado, kind, 'ninguno').stats;

  return {
    stats: r.stats,
    statsNoAjustado,
    filas: r.filas.map((f) => ({
      nombre: f.nombre,
      amb: f.amb,
      noAjustado: f.noAjustado,
      ajustado: f.valor,
    })),
  };
}
```

Y en `analizarRango`, propagarlo:

```js
  const { filas, stats, statsNoAjustado } = porMetodologiaOCDE(study, kind);
```

```js
  return { stats, statsNoAjustado, adj, cumple, filas };
```

- [ ] **Step 4: Correr la prueba y confirmar que pasa**

Run: `node --test frontend/src/services/rangoIntercuartil.test.js`
Expected: PASS

- [ ] **Step 5: Consumirla en `docxRelleno.js`**

> **Corrección al implementar (2026-08-11).** Este paso decía solo «el bloque de NO
> AJUSTADO», y con eso el arreglo quedaba a medias. El bloque de justo debajo
> (`:576-584`) tiene el mismo defecto **dentro de una sola columna**: `minAjustado` y
> `maxAjustado` salen de `compFilas` ordenado a mano —y `porMetodologiaOCDE` no propaga
> `incluida`, así que recorre todas las comparables— mientras `p25Ajustado`,
> `medAjustado` y `p75Ajustado` vienen de `stats`, que sí filtra por ámbito. Con `cmode`
> en `'nac'` o `'intl'`, la columna «AJUSTADO» publica su mínimo y su máximo sobre un
> universo y sus percentiles sobre otro. Lo encontró la revisión de la tarea; el paso
> ahora cubre los dos bloques.

Borrar el bloque `:567-576` completo —las seis constantes `activeSeriesNoAjustado`, `minNoAjustado`, `maxNoAjustado`, `p25NoAjustado`, `medNoAjustado`, `p75NoAjustado`— y sustituirlo por:

```js
  /* Estadística de las dos columnas, del mismo sitio. Aquí vivía una serie ordenada a
     mano con `cuartilInterpolado`: era el tercer cálculo del cuartil del sistema y el
     único que no aplicaba el filtro de ámbito. */
  const sinAj = rResult.statsNoAjustado || {};
  const minNoAjustado = sinAj.min !== undefined ? sinAj.min : null;
  const maxNoAjustado = sinAj.max !== undefined ? sinAj.max : null;
  const p25NoAjustado = sinAj.p25 !== undefined ? sinAj.p25 : null;
  const medNoAjustado = sinAj.med !== undefined ? sinAj.med : null;
  const p75NoAjustado = sinAj.p75 !== undefined ? sinAj.p75 : null;
```

Y el bloque de `AJUSTADO` (`:576-584`) pierde también su serie ordenada a mano. `stats` ya
trae `.min` y `.max` (`ajusteRangoCapitalTrabajo.js:317-318`), así que las cinco cifras de
la columna salen del mismo objeto:

```js
  const minAjustado = stats.min !== undefined ? stats.min : null;
  const maxAjustado = stats.max !== undefined ? stats.max : null;
  const p25Ajustado = stats.p25 !== undefined ? stats.p25 : null;
  const medAjustado = stats.med !== undefined ? stats.med : null;
  const p75Ajustado = stats.p75 !== undefined ? stats.p75 : null;
```

`activeSeriesAjustado` queda sin usos: borrarlo y confirmar con
`npm run lint --prefix frontend` que no queda ningún identificador muerto nuevo.

Retirar `cuartilInterpolado` del `import` de la línea 37 **solo si no queda ningún otro uso** en el archivo. Preguntárselo al linter del repo, que es quien sabe distinguir un uso de una mención:

Run: `npm run lint --prefix frontend 2>&1 | grep "docxRelleno.*cuartilInterpolado"`
Si sale `Identifier 'cuartilInterpolado' is imported but never used`, quitar el import.

No contar apariciones del identificador con `grep` ni con `match`: el comentario que este mismo paso añade lo nombra, así que el conteo da un uso de más y deja el import muerto en el archivo. Y **no** limpiar el `FUENTES_MACRO` de la línea 39, que el linter marca igual: ese ya estaba muerto antes de esta tarea y no es de su alcance.

- [ ] **Step 6: Correr la suite completa**

Run: `npm test`
Expected: PASS, 955 pruebas o más. Si alguna prueba de `docxRelleno.test.js` cambia de resultado, es un caso donde el informe publicaba dos universos: hay que actualizar la expectativa y dejar escrito en el propio test por qué el número anterior estaba mal.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/services/rangoIntercuartil.js frontend/src/services/rangoIntercuartil.test.js frontend/src/services/docxRelleno.js
git commit -m "fix: una sola estadistica para las dos columnas de la tabla de rango"
```

---

### Task 2: El libro recibe el ámbito, el segmento excluido y el `amb`

Origen verificado de dos de las tres divergencias del spec: `motorExcelExport.js:34-58` arma `estudioBase` con una lista explícita de campos que **omite** `cmode`, `seg_excluido` y el `amb` de cada comparable. `obtenerEstudioNormalizadoParaParche` clona y conserva todo lo demás (`estudioNormalizado.js:23`), así que basta con incluirlos para que lleguen al emisor.

Esta tarea solo los hace llegar. Quien los usa es la Task 5.

**Precisión sobre el spec.** El spec dice que `motorExcelExport` descuente `seg_excluido`. No
puede vivir ahí: `MemoriaRangoModal.jsx:93` llama a `hojasMemoriaRangoOptimo` **directo**, sin
pasar por `motorExcelExport`, y el libro que se descarga del modal quedaría con las ventas sin
descontar mientras el que se descarga del motor las trae descontadas. El descuento va en
`hojasMemoriaRangoOptimo`, que es el único punto por el que pasan las dos rutas. `t_s` viaja
**en bruto** con `seg_excluido` al lado, igual que ya lo espera `analizarRangoAjustado`
(`:276-281`). El principio del spec —una sola procedencia— se cumple mejor así.

**Files:**
- Modify: `frontend/src/services/motorExcelExport.js:31-58`
- Test: `frontend/src/services/motorExcelExport.test.js`

**Interfaces:**
- Produces: el `estudioNorm` que recibe `hojasMemoriaRangoOptimo` trae `cmode` (string), `seg_excluido` (número) y `comparables[].amb` (`'Nac'` o `'Int'`).

- [ ] **Step 1: Escribir la prueba que falla**

En `frontend/src/services/motorExcelExport.test.js`:

```js
test('el libro recibe el ámbito, el segmento excluido y el amb de cada comparable', () => {
  /* Sin estos tres campos el libro calcula su rango sobre las 16 filas y sobre unas
     ventas sin descontar, mientras el informe filtra por ámbito y descuenta: dos
     rangos distintos para el mismo estudio, y el libro se radica como su soporte. */
  const wb = construirLibroSoporte({
    estudio: {
      t_s: 1000, t_c: 600, t_op: 200, t_ar: 100, t_inv: 50, t_ap: 80, t_ppe: 300,
      prime: 7.37, cmode: 'nac', seg_excluido: 120,
    },
    comparables: [
      { name: 'Nacional A', amb: 'Nac', s: 500, c: 300, op: 380 },
      { name: 'Internacional X', amb: 'Int', s: 900, c: 100, op: 700 },
    ],
  });

  const datos = XLSX.utils.sheet_to_json(wb.Sheets.Datos, { header: 1, raw: true });
  /* B4 son las ventas de la parte examinada: 1000 − 120 de segmento excluido. */
  const filaVentas = datos.find((f) => f && f[0] === 'Ventas netas');
  assert.strictEqual(filaVentas[1], 880, 'las ventas del libro descuentan seg_excluido');

  const filaAmbito = datos.find((f) => f && f[0] === 'Ámbito de la muestra');
  assert.ok(filaAmbito, 'el libro declara el ámbito de la muestra');
  assert.strictEqual(filaAmbito[1], 'nac');

  /* La columna J de cada comparable lleva su ámbito. */
  const hdr = datos.find((f) => f && f[0] === 'Compañía');
  assert.strictEqual(hdr[9], 'Ámbito');
  const filaNac = datos.find((f) => f && f[0] === 'Nacional A');
  assert.strictEqual(filaNac[9], 'Nac');
  const filaInt = datos.find((f) => f && f[0] === 'Internacional X');
  assert.strictEqual(filaInt[9], 'Int');
});
```

Asegurar que el archivo importe lo que usa. Al principio del test:

```js
import XLSX from 'xlsx-js-style';
import { construirLibroSoporte } from './motorExcelExport.js';
```

Y en `frontend/src/services/memoriaCalculoRangoOptimo.test.js`, la otra punta: el libro que
se descarga del modal pasa por el emisor y no por `motorExcelExport`, así que el descuento
tiene que verse también llamando al emisor directo.

```js
test('el emisor descuenta el segmento excluido, no el llamador', () => {
  /* MemoriaRangoModal.jsx:93 llama aquí directo. Si el descuento viviera en
     motorExcelExport, el libro del modal saldría con las ventas sin descontar y el del
     motor con ellas descontadas: dos libros distintos para el mismo estudio. */
  const datos = hojasMemoriaRangoOptimo(
    { ...ESTUDIO, t_s: 1000, seg_excluido: 120 }, null,
  ).find((h) => h.nombre === 'Datos');
  const ventas = datos.celdas.find((f) => f && f[0] && f[0].v === 'Ventas netas');
  assert.strictEqual(ventas[1].v, 880);
});
```

- [ ] **Step 2: Correr la prueba y confirmar que falla**

Run: `node --test frontend/src/services/motorExcelExport.test.js`
Expected: FAIL — `filaVentas[1]` es `1000` y no `880`, y no existe la fila «Ámbito de la muestra».

- [ ] **Step 3: Pasar los tres campos en `motorExcelExport.js`**

En `construirLibroSoporte`, dentro de `estudioBase`, añadir los tres campos. La línea de
`t_s` **no cambia**: sigue entregando la cifra en bruto.

```js
  const estudioBase = {
    t_s: datos.examinada?.T?.s ?? datos.estudio?.t_s ?? datos.estudio?.s,
    /* Viaja al lado de `t_s` en bruto y lo descuenta `hojasMemoriaRangoOptimo`, que es
       por donde pasan las DOS rutas de descarga del libro —esta y la del modal, que
       llama al emisor directo (MemoriaRangoModal.jsx:93)—. Descontarlo aquí dejaría al
       modal publicando unas ventas y al motor otras. */
    seg_excluido: Number(datos.estudio?.seg_excluido) || 0,
    /* El filtro de ámbito del tablero. Sin él el libro cuartilaba las 16 filas
       mientras el informe cuartilaba solo las del ámbito elegido. */
    cmode: datos.estudio?.cmode || 'all',
```

y en el `map` de `comparables`, añadir el ámbito:

```js
    comparables: (datos.comparables || []).map((c) => ({
      name: c.name || c.razonSocial || '',
      /* Mismo criterio que `analizarRangoAjustado:296`: lo que no está marcado como
         nacional es internacional. */
      amb: c.amb === 'Nac' ? 'Nac' : 'Int',
      s: c.s,
```

- [ ] **Step 4: Descontar el segmento excluido en el emisor**

En `memoriaCalculoRangoOptimo.js`, en el arreglo `tp` (`:112-118`), la primera entrada pasa a
descontar el segmento:

```js
  /* Las ventas del libro descuentan el segmento excluido, con el mismo criterio del
     motor (`ajusteRangoCapitalTrabajo.js:271-276`): solo de las ventas y no de `t_op`,
     porque aquí `t_op` son GASTOS y restarlo también movería la utilidad operacional
     dos veces.

     Va aquí y no en `motorExcelExport` porque este emisor es el único punto por el que
     pasan las dos rutas de descarga del libro: la del motor y la del modal
     (MemoriaRangoModal.jsx:93). */
  const segExcluido = Number(study.seg_excluido) || 0;
  const ventasNetas = (Number(study.t_s) || 0) - segExcluido;

  const tp = [
    ['Ventas netas', ventasNetas], ['Costo de ventas', study.t_c],
```

conservando el resto del arreglo tal cual.

- [ ] **Step 5: Escribir el ámbito y la columna en la hoja `Datos`**

En `memoriaCalculoRangoOptimo.js`, después de la fila de la tasa (`tp.forEach`, `:119-125`), añadir la fila del ámbito:

```js
  /* El ámbito de la muestra, escrito como dato y no como decisión ya aplicada: la
     hoja de método lo lee para decidir qué filas entran al cuartil. */
  datos.push([cTxt('Ámbito de la muestra'), cTxt(study.cmode || 'all')]);
```

Y en la cabecera de comparables y en cada fila, la columna J:

```js
  const hdr = ['Compañía', 'Ventas', 'Costo', 'Gastos op.', 'CxC', 'Inventario', 'CxP', 'PP&E', 'Tasa', 'Ámbito'];
```

```js
      cNum(Number(c.ppe) || 0), cFor('$B$11', '0.00%'),
      cTxt(c.amb === 'Nac' ? 'Nac' : 'Int'),
    ]);
```

**Atención:** la fila del ámbito se inserta *después* de la tasa, así que la tasa sigue en `B11` y `filaComp0` se recalcula solo (`:131` la deriva de `datos.length`). El `cFor('$B$11', …)` de la columna Tasa sigue siendo correcto en esta tarea; la Task 3 lo deja de escribir a mano.

Ampliar también el arreglo `cols` de la hoja `Datos` (`:168-169`) con un ancho más para la columna J:

```js
    cols: [{ wch: 34 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 9 }, { wch: 9 }, { wch: 3 }, { wch: 30 }, { wch: 62 }, { wch: 46 }],
```

y correr las anotaciones de la tasa una columna a la derecha: en `anotarTasa` (`:145-149`), cambiar los índices `10` y `11` por `11` y `12`, y el `datos[3][12]` de `:152` por `datos[3][13]`.

- [ ] **Step 6: Correr las pruebas**

Run: `node --test frontend/src/services/motorExcelExport.test.js frontend/src/services/memoriaCalculoRangoOptimo.test.js`
Expected: PASS. Si alguna prueba de `memoriaCalculoRangoOptimo.test.js` fijaba el índice de columna de la trazabilidad de la tasa, actualizar el índice esperado.

- [ ] **Step 7: Correr la suite completa y commit**

Run: `npm test`
Expected: PASS

```bash
git add frontend/src/services/motorExcelExport.js frontend/src/services/motorExcelExport.test.js frontend/src/services/memoriaCalculoRangoOptimo.js
git commit -m "fix: el libro de soporte recibe el ambito y el segmento excluido del estudio"
```

---

### Task 3: Direcciones calculadas en lugar de `$B$4` escrito a mano

`memoriaCalculoRangoOptimo.js:173-174` fija las referencias del contribuyente como literales: `Datos!$B$4` … `Datos!$B$10`. La Task 4 inserta rubros en medio de esas filas, y con literales las cinco hojas de método apuntarían al rubro equivocado sin que nada falle.

Esta tarea es un **refactor sin cambio de comportamiento**: las direcciones que salen son las mismas.

> **Esta tarea NO tiene fase roja, y es a propósito.** Su prueba pasa antes y después del
> cambio: es una prueba de caracterización, la red que hace segura la Task 4. No hay defecto
> que reproducir todavía —el desalineamiento lo *introduciría* la Task 4 si nadie lo sujeta—,
> así que exigir un test que falle aquí obligaría a inventar uno. Quien revise esta tarea debe
> tratar la ausencia de fase roja como cumplimiento del plan, no como defecto; lo que sí debe
> exigir es que la prueba falle si se rompe la derivación (comprobable revirtiendo el Step 4 a
> mano). Dejarlo claro también en el mensaje de commit.

**Files:**
- Modify: `frontend/src/services/memoriaCalculoRangoOptimo.js:107-135, 172-174`
- Test: `frontend/src/services/memoriaCalculoRangoOptimo.test.js`

**Interfaces:**
- Produces: dentro del módulo, `RUBROS_EXAMINADA` (arreglo de `{clave, etiqueta, fmt?}`), `FILA_RUBRO_0` (número, 1-based) y `refDe(clave)` → string como `'Datos!$B$7'`. Las Tasks 4 a 8 los usan.

- [ ] **Step 1: Escribir la prueba de caracterización**

```js
test('las referencias del contribuyente apuntan al rubro, no a una fila fija', () => {
  /* Esta prueba pasa antes y después del refactor: es la red que impide que ampliar
     la hoja Datos deje las hojas de método apuntando al rubro equivocado, que es un
     fallo que no revienta —da un número creíble y falso—. */
  const hojas = hojasMemoriaRangoOptimo(ESTUDIO, null);
  const datos = hojas.find((h) => h.nombre === 'Datos');
  const mo = hojas.find((h) => h.nombre === 'MO');

  const filaDe = (etiqueta) => datos.celdas.findIndex(
    (f) => f && f[0] && f[0].v === etiqueta) + 1;

  /* Fila 3 de la hoja MO = primera comparable; índice 13 = columna N = Aj.CxC. */
  const ajCxC = mo.celdas[2][13].f;
  const ajInv = mo.celdas[2][15].f;
  const ajPpe = mo.celdas[2][16].f;

  assert.ok(ajCxC.includes(`Datos!$B$${filaDe('Cuentas por cobrar')}`),
    `Aj.CxC apunta al rubro de CxC: ${ajCxC}`);
  assert.ok(ajInv.includes(`Datos!$B$${filaDe('Inventarios')}`),
    `Aj.Inv apunta al rubro de inventarios: ${ajInv}`);
  assert.ok(ajPpe.includes(`Datos!$B$${filaDe('Propiedad, planta y equipo')}`),
    `Aj.PP&E apunta al rubro de PP&E: ${ajPpe}`);

  /* La columna Tasa de cada comparable apunta a la fila de la tasa. */
  const filaTasa = filaDe('Tasa de interés de referencia (Prime Rate)');
  const primeraComp = datos.celdas.findIndex((f) => f && f[0] && f[0].v === 'Buena SA');
  assert.strictEqual(datos.celdas[primeraComp][8].f, `$B$${filaTasa}`);
});
```

- [ ] **Step 2: Correr la prueba y confirmar que pasa ya**

Run: `node --test frontend/src/services/memoriaCalculoRangoOptimo.test.js`
Expected: PASS. Si falla, el refactor no es el problema: hay ya un desalineamiento y hay que arreglarlo antes de seguir.

- [ ] **Step 3: Declarar los rubros y derivar las direcciones**

Encima de `hojasMemoriaRangoOptimo`, junto a `METODOS` y `AJUSTES`:

```js
/* Rubros de la parte examinada en la hoja Datos, en el orden en que se escriben.
   La dirección de cada uno se DERIVA de este arreglo y no se escribe a mano en
   ninguna fórmula: al insertar un rubro, las cinco hojas de método siguen apuntando
   al correcto. Una dirección absoluta escrita a mano en una fórmula es un fallo
   silencioso —da un número creíble y falso— y por eso no queda ninguna.

   El comentario evita nombrar una dirección concreta a propósito: el comando de
   verificación del Step 4 busca literales por texto y una mención en prosa se delataría
   a sí misma. */
const RUBROS_EXAMINADA = [
  { clave: 't_s', etiqueta: 'Ventas netas' },
  { clave: 't_c', etiqueta: 'Costo de ventas' },
  { clave: 't_op', etiqueta: 'Gastos operativos' },
  { clave: 't_ar', etiqueta: 'Cuentas por cobrar' },
  { clave: 't_inv', etiqueta: 'Inventarios' },
  { clave: 't_ap', etiqueta: 'Cuentas por pagar' },
  { clave: 't_ppe', etiqueta: 'Propiedad, planta y equipo' },
];

/* 1-based: fila 1 título, 2 vacía, 3 «PARTE EXAMINADA», 4 el primer rubro. */
const FILA_RUBRO_0 = 4;
const filaDeRubro = (clave) => FILA_RUBRO_0
  + RUBROS_EXAMINADA.findIndex((r) => r.clave === clave);
/* La tasa va inmediatamente después del último rubro. */
const FILA_TASA = () => FILA_RUBRO_0 + RUBROS_EXAMINADA.length;
```

**No declares aquí `FILA_AMBITO`.** La fila del ámbito de la muestra existe desde la Task 2,
pero ninguna fórmula la referencia todavía: declararla ahora deja un identificador sin usar y
el linter lo marca, que las restricciones del proyecto prohíben. La declara la **Task 5**,
que es la primera que la necesita.

- [ ] **Step 4: Usarlas en la escritura de `Datos` y en las referencias**

Reemplazar el `const tp = [...]` y su `forEach` (`:112-125`), incluido el descuento que
introdujo la Task 2, por:

```js
  /* El valor de cada rubro. `t_s` es el único que no se escribe tal cual: descuenta el
     segmento excluido con el mismo criterio del motor (Task 2). Queda en una función
     para que ampliar la lista de rubros no pueda perder el descuento por el camino. */
  const segExcluido = Number(study.seg_excluido) || 0;
  const valorDeRubro = (clave) => (clave === 't_s'
    ? (Number(study.t_s) || 0) - segExcluido
    : Number(study[clave]) || 0);

  RUBROS_EXAMINADA.forEach((r) => {
    datos.push([cTxt(r.etiqueta), cNum(valorDeRubro(r.clave))]);
  });
  datos.push([
    cTxt('Tasa de interés de referencia (Prime Rate)'),
    cNum((Number(study.prime) || 0) / 100, '0.00%'),
  ]);
```

Reemplazar `:173-174` por:

```js
  // Referencias del contribuyente, derivadas del orden de RUBROS_EXAMINADA
  const refDe = (clave) => D(`$B$${filaDeRubro(clave)}`);
  const S_s = refDe('t_s'), C_s = refDe('t_c'), OP_s = refDe('t_op');
  const AR_s = refDe('t_ar'), INV_s = refDe('t_inv');
  const AP_s = refDe('t_ap'), PPE_s = refDe('t_ppe');
```

Y en la fila de cada comparable, la columna Tasa deja de escribir `$B$11` a mano:

```js
      cNum(Number(c.ppe) || 0), cFor(`$B$${FILA_TASA()}`, '0.00%'),
```

Lo mismo en `anotarTasa(3, 'Tasa aplicada', cFor('$B$11', '0.00%'))` → `cFor(\`$B$${FILA_TASA()}\`, '0.00%')`, y en la fila del ámbito de la Task 2, que ahora se escribe sola detrás de la tasa.

Buscar cualquier `$B$11` o `$B$4`…`$B$10` que quede escrito a mano:

Run: `node -e "const s=require('fs').readFileSync('frontend/src/services/memoriaCalculoRangoOptimo.js','utf8');console.log(s.match(/\\$B\\$(4|5|6|7|8|9|10|11)\\b/g))"`
Expected: `null`. Si imprime algo, esa referencia se rompe en la Task 4.

- [ ] **Step 5: Correr la suite completa y commit**

Run: `npm test`
Expected: PASS, sin cambios de conteo.

```bash
git add frontend/src/services/memoriaCalculoRangoOptimo.js frontend/src/services/memoriaCalculoRangoOptimo.test.js
git commit -m "refactor: derivar las direcciones de la hoja Datos del orden de los rubros"
```

---

### Task 4: La hoja `Datos` con el ESF completo y el A.V. como fórmula viva

`Datos` lleva 7 rubros. Los estados financieros que la ingesta parsea son los 11 de `RUBROS_ESF` (`docxRelleno.js:1068`) más `t_ap`. Con `t_act_tot` en el libro, el análisis vertical —hoy un porcentaje ya calculado por `verticalSobreActivos` (`docxRelleno.js:529`)— pasa a ser fórmula, y el libro sustenta la Tabla 10 y el ESF del ANEXO A.

**Files:**
- Modify: `frontend/src/services/memoriaCalculoRangoOptimo.js` (`RUBROS_EXAMINADA` y la escritura de `Datos`)
- Test: `frontend/src/services/memoriaCalculoRangoOptimo.test.js`

**Interfaces:**
- Consumes: `RUBROS_EXAMINADA`, `filaDeRubro`, `refDe` de la Task 3.
- Produces: `RUBROS_EXAMINADA` con 12 entradas. La columna C de las filas de rubro lleva el A.V. como fórmula.

- [ ] **Step 1: Escribir la prueba que falla**

```js
test('la hoja Datos trae el ESF completo con el A.V. como fórmula viva', () => {
  const estudio = {
    ...ESTUDIO,
    t_cash: 10, t_inv_assoc: 20, t_tax: 30, t_act_curr: 200,
    t_intang: 40, t_dif: 50, t_act_nocurr: 400, t_act_tot: 600,
  };
  const datos = hojasMemoriaRangoOptimo(estudio, null).find((h) => h.nombre === 'Datos');
  const fila = (etiqueta) => datos.celdas.find((f) => f && f[0] && f[0].v === etiqueta);

  /* Los doce rubros que la ingesta sabe leer. */
  ['Efectivo y equivalentes de efectivo', 'Inversiones asociadas',
    'Cuentas por cobrar', 'Inventarios', 'Activos por impuestos corrientes',
    'Total, Activo corriente', 'Propiedad, planta y equipo', 'Intangibles',
    'Diferidos', 'Total, Activos no corrientes', 'Total, Activos',
    'Cuentas por pagar'].forEach((r) => {
    assert.ok(fila(r), `falta el rubro «${r}» en la hoja Datos`);
  });

  /* El A.V. es fórmula sobre el total de activos, no un número ya cocinado. */
  const filaTot = datos.celdas.findIndex((f) => f && f[0] && f[0].v === 'Total, Activos') + 1;
  const av = fila('Efectivo y equivalentes de efectivo')[2];
  assert.ok(av && av.f, 'el A.V. se emite como fórmula');
  assert.ok(av.f.includes(`$B$${filaTot}`),
    `el A.V. divide sobre el total de activos: ${av.f}`);

  /* El total de activos no lleva A.V.: sería 100 % por definición y no informa. */
  assert.strictEqual(fila('Total, Activos')[2], undefined);

  /* Las cuentas por pagar tampoco: un pasivo sobre el total de activos no significa
     nada, y es el mismo criterio que aplica filasEsfAnexoA en docxRelleno.js. */
  assert.strictEqual(fila('Cuentas por pagar')[2], undefined);
});
```

- [ ] **Step 2: Correr la prueba y confirmar que falla**

Run: `node --test frontend/src/services/memoriaCalculoRangoOptimo.test.js`
Expected: FAIL — «falta el rubro «Efectivo y equivalentes de efectivo» en la hoja Datos».

- [ ] **Step 3: Ampliar `RUBROS_EXAMINADA` a los doce rubros**

Sustituir el arreglo de la Task 3 por este. El orden es el de balance y **tiene que coincidir** con `RUBROS_ESF` de `docxRelleno.js:1068`, porque las dos listas describen el mismo estado financiero:

```js
/* Los doce rubros que la ingesta sabe leer, en orden de balance. El orden y las
   etiquetas siguen a `RUBROS_ESF` de docxRelleno.js: son el mismo estado financiero
   visto desde el libro y desde el ANEXO A, y si divergen el informe publica un
   balance que su propio soporte no reproduce.

   `av: false` marca los rubros que NO llevan análisis vertical:

   - Las cuentas por pagar, porque un pasivo sobre el total de activos no significa nada.
     Esta sí es la exclusión que aplica `filasEsfAnexoA`: las añade fuera del `map`, con
     `SIN_DATO` en la columna del vertical.
   - El total de activos, porque su vertical es 100 % por definición y no informa. **Ojo:
     esto NO lo hace `filasEsfAnexoA`**, que mapea `RUBROS_ESF` completo y sí publica ese
     100 % en el ANEXO A y en la Tabla 10. Es una decisión propia del libro, defendible por
     sí misma, y no hay que atribuirla a código ajeno: quien lea el comentario para auditar
     confiaría en una premisa falsa.
   - Las tres cifras del estado de resultados —ventas, costo y gastos—, que no son
     partidas del balance. */
const RUBROS_EXAMINADA = [
  { clave: 't_s', etiqueta: 'Ventas netas', av: false },
  { clave: 't_c', etiqueta: 'Costo de ventas', av: false },
  { clave: 't_op', etiqueta: 'Gastos operativos', av: false },
  { clave: 't_cash', etiqueta: 'Efectivo y equivalentes de efectivo', av: true },
  { clave: 't_inv_assoc', etiqueta: 'Inversiones asociadas', av: true },
  { clave: 't_ar', etiqueta: 'Cuentas por cobrar comerciales y otras cuentas por cobrar', av: true },
  { clave: 't_inv', etiqueta: 'Inventarios', av: true },
  { clave: 't_tax', etiqueta: 'Activos por impuestos corrientes', av: true },
  { clave: 't_act_curr', etiqueta: 'Total, Activo corriente', av: true },
  { clave: 't_ppe', etiqueta: 'Propiedades, planta y equipo', av: true },
  { clave: 't_intang', etiqueta: 'Intangibles', av: true },
  { clave: 't_dif', etiqueta: 'Diferidos', av: true },
  { clave: 't_act_nocurr', etiqueta: 'Total, Activos no corrientes', av: true },
  { clave: 't_act_tot', etiqueta: 'Total, Activos', av: false },
  { clave: 't_ap', etiqueta: 'Cuentas por pagar comerciales', av: false },
];
```

Las etiquetas de `t_ar`, `t_ppe` y `t_ap` son las **literales de `RUBROS_ESF`** —incluido el
plural de «Propiedades»—, no las formas cortas que traía el emisor. Mezclar unas y otras en la
misma hoja es peor que cualquiera de las dos opciones consistente: quien audita el libro contra
el ANEXO A no puede mapear por etiqueta si no sabe de antemano cuáles filas son fieles y cuáles
un alias histórico. Cambiarlas obliga a revisar las pruebas que localizan la fila por su texto.

- [ ] **Step 4: Escribir el A.V. en la columna C**

Sustituir el `forEach` de la Task 3 por este. `valorDeRubro` se conserva tal como quedó ahí:

```js
  const filaTot = filaDeRubro('t_act_tot');
  RUBROS_EXAMINADA.forEach((r) => {
    const celdas = [cTxt(r.etiqueta), cNum(valorDeRubro(r.clave))];
    /* A.V. como fórmula y no como número: es lo que hace que corregir una cifra en
       Datos recalcule el vertical del ANEXO A y de la Tabla 10 sin recalcularlo a
       mano en dos sitios.

       Con guarda de divisor cero. Sin ella, un estudio sin `t_act_tot` —y son la mayoría:
       ver el Step 5— deja las diez celdas del vertical en `#DIV/0!`. Es la misma guarda
       que ya aplica `verticalSobreActivos` en docxRelleno.js (`if (!total) return '—'`),
       traducida a fórmula, y el mismo patrón de `IF(...=0,"",...)` que este archivo ya
       usa en otras celdas. Un hueco visible es preferible a un error de Excel en un
       documento que se radica. */
    if (r.av) {
      const fila = filaDeRubro(r.clave);
      celdas.push(cFor(`IF($B$${filaTot}=0,"",B${fila}/$B$${filaTot})`, '0.00%'));
    }
    datos.push(celdas);
  });
```

- [ ] **Step 5: `motorExcelExport` tiene que ENTREGAR los ocho rubros nuevos**

Sin esto la tarea no entrega nada por su ruta principal. `construirLibroSoporte` arma
`estudioBase` con una **lista explícita de claves** (`motorExcelExport.js:34-56`) que no
incluye ninguno de los ocho rubros nuevos, así que `valorDeRubro('t_act_tot')` devuelve
`Number(undefined) || 0` = `0` en **toda** exportación por el Motor de Comparables: los once
rubros del ESF saldrían en cero y el vertical entero en `#DIV/0!` (o en blanco, con la guarda
del Step 4). El libro no sustentaría ni la Tabla 10 ni el ANEXO A, que es el objetivo
declarado de esta tarea.

Añadir las ocho claves con el mismo patrón de respaldo que ya usan las demás:

```js
    t_cash: datos.examinada?.T?.cash ?? datos.estudio?.t_cash,
    t_inv_assoc: datos.examinada?.T?.inv_assoc ?? datos.estudio?.t_inv_assoc,
    t_tax: datos.examinada?.T?.tax ?? datos.estudio?.t_tax,
    t_act_curr: datos.examinada?.T?.act_curr ?? datos.estudio?.t_act_curr,
    t_intang: datos.examinada?.T?.intang ?? datos.estudio?.t_intang,
    t_dif: datos.examinada?.T?.dif ?? datos.estudio?.t_dif,
    t_act_nocurr: datos.examinada?.T?.act_nocurr ?? datos.estudio?.t_act_nocurr,
    t_act_tot: datos.examinada?.T?.act_tot ?? datos.estudio?.t_act_tot,
```

Con una prueba que lo cubra: `construirLibroSoporte` con un estudio que traiga los doce
rubros los escribe todos en la hoja `Datos`, y el vertical sale como fórmula con su valor.
Y otra con `t_act_tot` ausente que confirme que las celdas del vertical quedan en blanco y
no en `#DIV/0!`.

- [ ] **Step 6: Actualizar la prosa que nombra filas concretas**

Ampliar `RUBROS_EXAMINADA` mueve la fila de la tasa de la 11 a la 16, y hay texto que la
nombra a mano y quedaría mintiendo. Estos sitios **no** son fórmulas, así que la guarda de
literales del Step 4 de la Task 3 no los ve:

- El comentario que resume el mapa de filas de `Datos` (nombra `B4`…`B11` en prosa).
- La docstring de `hojasMemoriaRangoOptimo`, que menciona `Datos!B11` como la celda donde se
  escribe la tasa.
- Cualquier otro texto de la hoja o del código que diga `B11`.

Buscarlos y corregirlos para que nombren la fila derivada o dejen de nombrar una fila
concreta. Un texto de trazabilidad que describe mal su propia mecánica es un defecto en un
documento que se radica ante la DIAN, y este es exactamente el momento en que se vuelve falso.

Run: `npm run lint --prefix frontend` y una búsqueda de `B11` en el archivo; no debe quedar
ninguna mención que afirme una fila que ya no es.

- [ ] **Step 6: Correr la prueba y confirmar que pasa**

Run: `node --test frontend/src/services/memoriaCalculoRangoOptimo.test.js`
Expected: PASS, incluida la prueba de caracterización de la Task 3 — que ahora demuestra su valor: las referencias de `Aj.CxC`, `Aj.Inv` y `Aj.PP&E` apuntan a las filas nuevas sin que se haya tocado ninguna hoja de método.

- [ ] **Step 7: Correr la suite completa y commit**

Run: `npm test`
Expected: PASS

```bash
git add frontend/src/services/memoriaCalculoRangoOptimo.js frontend/src/services/memoriaCalculoRangoOptimo.test.js
git commit -m "feat: la hoja Datos trae el ESF completo con el análisis vertical por fórmula"
```

---

### Task 5: `QUARTILE` sobre el universo filtrado y guarda de muestra mínima

Las filas de estadística (`memoriaCalculoRangoOptimo.js:241-252`) aplican `MIN`, `MAX` y `QUARTILE` sobre `S{r0}:S{rN}` — todas las comparables, siempre. El motor del informe aplica el filtro de ámbito y exige valor finito (`ajusteRangoCapitalTrabajo.js:302`), y no publica estadística con menos de tres observaciones (`:312`).

La hoja gana dos cosas: una columna `Z` con el ámbito resuelto y siete columnas `AA`–`AG` con la serie que de verdad entra al rango por cada sabor. `QUARTILE` ignora celdas vacías y texto, así que basta con que las excluidas queden en `""` — sin fórmulas de matriz, que `xlsx-js-style` no marca como tales.

**Files:**
- Modify: `frontend/src/services/memoriaCalculoRangoOptimo.js:178-291`
- Test: `frontend/src/services/memoriaCalculoRangoOptimo.test.js`

**Interfaces:**
- Consumes: la columna `Ámbito` de `Datos` (Task 2) y `FILA_TASA()` / `filaDeRubro` (Task 3).
- **Declara aquí `FILA_AMBITO`**, que la Task 3 deliberadamente no dejó: hasta esta tarea
  ninguna fórmula referenciaba la fila del ámbito y un identificador sin usar hace fallar el
  linter. La fila va inmediatamente después de la tasa:

```js
/* La fila del ámbito de la muestra, que la hoja de método lee para decidir qué filas
   entran al cuartil. Va detrás de la tasa, que va detrás del último rubro. */
const FILA_AMBITO = () => FILA_TASA() + 1;
```
- Produces: en cada hoja de método, columna `Z` = «Entra por ámbito», columnas `AA`–`AG` = «Serie del rango» por sabor. Las filas de estadística leen `AA`–`AG`. La Task 6 escribe el valor en caché de todas ellas.

- [ ] **Step 1: Escribir la prueba que falla**

```js
test('el cuartil del libro se calcula sobre el universo filtrado, no sobre todas las filas', () => {
  const estudio = {
    ...ESTUDIO, cmode: 'nac',
    comparables: [
      { name: 'Nacional A', amb: 'Nac', s: 500, c: 300, op: 100, ar: 50, inv: 20, ap: 40, ppe: 100 },
      { name: 'Internacional X', amb: 'Int', s: 900, c: 100, op: 100, ar: 10, inv: 5, ap: 5, ppe: 10 },
    ],
  };
  const mo = hojasMemoriaRangoOptimo(estudio, null).find((h) => h.nombre === 'MO');
  const filaCon = (etq) => mo.celdas.find((f) => f && f[17] && f[17].v === etq);

  const p25 = filaCon('P25 (cuartil inferior)')[18].f;
  assert.ok(!/QUARTILE\(S\d+:S\d+/.test(p25),
    `el cuartil no puede leer la columna S en bruto: ${p25}`);
  assert.ok(/AA\d+:AA\d+/.test(p25),
    `el cuartil lee la serie filtrada: ${p25}`);

  /* La guarda de muestra mínima, la misma que aplica el motor en :312. */
  assert.ok(p25.includes('COUNT('), `falta la guarda de muestra mínima: ${p25}`);
  assert.ok(p25.includes('<3'), `la guarda tiene que ser de tres observaciones: ${p25}`);

  /* La columna Z resuelve el ámbito leyendo el de la comparable y el de la muestra. */
  const z = mo.celdas[2][25].f;
  assert.ok(z && z.includes('Datos!'), `la columna Z lee el ámbito de Datos: ${z}`);

  /* La serie del rango vacía la fila que no entra. */
  const aa = mo.celdas[2][26].f;
  assert.ok(aa.includes('Z3') && aa.includes('S3'),
    `la serie del rango depende del ámbito y del valor: ${aa}`);
});
```

- [ ] **Step 2: Correr la prueba y confirmar que falla**

Run: `node --test frontend/src/services/memoriaCalculoRangoOptimo.test.js`
Expected: FAIL — «el cuartil no puede leer la columna S en bruto: QUARTILE(S3:S4,1)».

- [ ] **Step 3: Añadir las columnas `Z` y `AA`–`AG` a cada fila de comparable**

En el `for` de comparables (`:193-236`), ampliar la cabecera y la fila. Primero la cabecera (`:182-184`):

```js
    const cols = ['Compañía', 'Ventas', 'Costo', 'Gastos op.', 'CxC', 'Inv', 'CxP', 'PP&E', 'Tasa',
      'EBIT', 'Util.bruta', 'desc', 'Base', 'Aj.CxC', 'Aj.CxP', 'Aj.Inv', 'Aj.PP&E', 'Denom.',
      'Sin ajuste', 'CxC', 'CxP', 'Inv', 'CxC+CxP+Inv', '+PP&E', 'PP&E',
      'Entra por ámbito',
      'Serie: Sin ajuste', 'Serie: CxC', 'Serie: CxP', 'Serie: Inv',
      'Serie: CxC+CxP+Inv', 'Serie: +PP&E', 'Serie: PP&E'];
```

Y al final de la construcción de `fila`, antes del `celdas.push(fila)`:

```js
      /* Columna Z: el filtro de ámbito, resuelto por fórmula y a la vista. Es el
         mismo criterio de `entraPorAmbito` (ajusteRangoCapitalTrabajo.js:245): con
         'nac' solo las nacionales, con 'intl' solo las internacionales, y con
         cualquier otro valor todas. Se emite como fórmula y no como una marca ya
         decidida, igual que el criterio de holding de la hoja de selección: quien
         audita el libro tiene que poder ver por qué una fila no entró. */
      const ambitoRef = D(`$B$${FILA_AMBITO()}`);
      const ambComp = D(`J${src}`);
      fila.push(cForT(
        `IF(OR(${ambitoRef}="all",AND(${ambitoRef}="nac",${ambComp}="Nac"),`
        + `AND(${ambitoRef}="intl",${ambComp}="Int")),"Sí","No")`));

      /* Columnas AA–AG: la serie que de verdad entra al rango, por sabor. Vacía —no
         cero— cuando la fila no entra o cuando el indicador no es un número: QUARTILE,
         MIN y MAX ignoran las celdas vacías, y un cero fingiría una observación que no
         existe y hundiría el rango. */
      ['S', 'T', 'U', 'V', 'W', 'X', 'Y'].forEach((L) => {
        fila.push(cFor(`IF(AND(Z${r}="Sí",ISNUMBER(${L}${r})),${L}${r},"")`, M.fmt));
      });
```

- [ ] **Step 4: Mover la estadística a `AA`–`AG` y añadir la guarda**

Las filas de estadística dejan de escribirse en las columnas `S`–`Y` y pasan a las
`AA`–`AG`, así que su relleno inicial crece: los índices 0 a 25 (columnas `A` a `Z`) van
vacíos, la etiqueta sigue en `R` (índice 17) y los valores empiezan en el índice 26.

Reemplazar `RES`, `statRow` y `qRow` (`:240-252`) por este bloque completo:

```js
    /* La estadística se calcula sobre la SERIE FILTRADA (AA–AG), no sobre las
       columnas de indicador (S–Y). Las de indicador se publican íntegras porque las
       tablas del informe listan también las comparables fuera de ámbito con su
       margen; lo que no puede es cuartilarlas. */
    const RES = ['AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG'];

    /* Guarda de muestra mínima: el motor no publica estadística con menos de tres
       observaciones (ajusteRangoCapitalTrabajo.js:312), porque un rango intercuartil
       sobre dos puntos no es un rango. La hoja no puede insinuar lo contrario.
       COUNT solo cuenta números, así que cuenta exactamente las filas que entraron. */
    const conGuarda = (L, expr) => `IF(COUNT(${L}${r0}:${L}${rN})<3,"",${expr})`;

    /* Fila de estadística vacía: índices 0–25 son las columnas A–Z, la etiqueta va en
       R (índice 17) y los siete valores se empujan a partir del índice 26 (AA). */
    const filaEstadistica = (etq) => {
      const fila = new Array(26).fill(cTxt(''));
      fila[17] = cTxt(etq);
      return fila;
    };

    const statRow = (etq, fn) => {
      const fila = filaEstadistica(etq);
      RES.forEach((L) => fila.push(
        cFor(conGuarda(L, `${fn}(${L}${r0}:${L}${rN})`), M.fmt)));
      return fila;
    };
    const qRow = (etq, q) => {
      const fila = filaEstadistica(etq);
      RES.forEach((L) => fila.push(
        cFor(conGuarda(L, `QUARTILE(${L}${r0}:${L}${rN},${q})`), M.fmt)));
      return fila;
    };
```

La fila del indicador del contribuyente (`:268-274`) y la de la conclusión (`:276-283`)
también se escriben ahora en `AA`–`AG`. Sustituir los dos bloques por:

```js
    const filaTested = celdas.length + 1;
    {
      const fila = filaEstadistica('Indicador del contribuyente');
      /* `testedFor` (:263-267) no cambia: es la misma fórmula. Lo que cambia es la
         columna donde se escribe. */
      RES.forEach(() => fila.push(cFor(testedFor, M.fmt)));
      celdas.push(fila);
    }
    {
      /* La conclusión necesita la misma guarda: sin rango, P25 y P75 valen "" y
         compararlos con >= daría #VALUE! en la celda. */
      const fila = filaEstadistica('Conclusión');
      RES.forEach((L) => fila.push(cForT(conGuarda(L,
        `IF(AND(${L}${filaTested}>=${L}${filaP25},`
        + `${L}${filaTested}<=${L}${filaP75}),"CUMPLE","NO CUMPLE")`))));
      celdas.push(fila);
    }
```

**Atención:** `filaP25` y `filaP75` son números de fila y no cambian; lo que cambia es que
la conclusión los referencia sobre las columnas `AA`–`AG`, que es donde ahora viven los
cuartiles.

- [ ] **Step 5: Ampliar los anchos de columna de las hojas de método**

`:289` fija `[{wch:28}].concat(new Array(24).fill({wch:11}))` — 25 columnas. Ahora son 33:

```js
      cols: [{ wch: 28 }].concat(new Array(32).fill({ wch: 11 })),
```

- [ ] **Step 6: Correr la prueba y confirmar que pasa**

Run: `node --test frontend/src/services/memoriaCalculoRangoOptimo.test.js`
Expected: PASS

- [ ] **Step 7: Correr la suite completa y commit**

Run: `npm test`
Expected: PASS

```bash
git add frontend/src/services/memoriaCalculoRangoOptimo.js frontend/src/services/memoriaCalculoRangoOptimo.test.js
git commit -m "fix: el cuartil del libro respeta el ámbito y la muestra mínima del motor"
```

---

### Task 6: El valor en caché desde el motor

El libro no trae ni un número: todas sus celdas derivadas son fórmula sin `<v>`. `memoriaCalculoRangoOptimo.js` pasa a pedirle a `analizarRangoAjustado` el valor de cada celda y a escribirlo junto a la fórmula.

Qué se llena y qué no:

| Columnas | Valor | De dónde |
|---|---|---|
| `A`–`I` | sí | literales que el emisor ya tiene en `study` |
| `J`–`R` | **no** | intermedios del ajuste. Calcularlos aquí sería una segunda implementación de la matemática que este plan retira. Excel los deriva al abrir. La Task 8 los cubre si se quiere |
| `S`–`Y` | sí | `analizarRangoAjustado(study, metodo, sabor).filas[i].valor` |
| `Z` | sí | el criterio de ámbito, resuelto en JS |
| `AA`–`AG` | sí | el valor, o `''` si la fila no entra |
| Mín/P25/Mediana/P75/Máx | sí | `stats.min` / `p25` / `med` / `p75` / `max`, o `''` si `stats` es `null` |
| Indicador del contribuyente | sí | `sujeto` |
| Conclusión | sí | `cumple`, o `''` si `stats` es `null` |

**Files:**
- Modify: `frontend/src/services/memoriaCalculoRangoOptimo.js`
- Test: `frontend/src/services/memoriaCalculoRangoOptimo.test.js`

**Interfaces:**
- Consumes: `analizarRangoAjustado(estudio, metodo, ajuste)` de `ajusteRangoCapitalTrabajo.js`, que devuelve `{stats, filas, cumple, sujeto, metodo, ajuste}`. `stats` es `{p25, med, p75, min, max, n}` o `null`. `filas[i]` es `{nombre, amb, valor, noAjustado, incluida}`.
- Produces: las celdas de las hojas de método llevan `v` además de `f`.

- [ ] **Step 1: Escribir la prueba que falla**

```js
test('las celdas derivadas del libro traen el valor calculado junto a la fórmula', () => {
  const mo = hojasMemoriaRangoOptimo(ESTUDIO_4, null).find((h) => h.nombre === 'MO');
  const filaCon = (etq) => mo.celdas.find((f) => f && f[17] && f[17].v === etq);

  /* Indicador por comparable: fila 3, columna S (índice 18). */
  const sinAjuste = mo.celdas[2][18];
  assert.ok(sinAjuste.f, 'sigue siendo fórmula: el libro tiene que poder recalcularse');
  assert.strictEqual(typeof sinAjuste.v, 'number',
    'y trae el valor, para que no salga vacío en un lector que no recalcule');

  /* Estadística. */
  const p25 = filaCon('P25 (cuartil inferior)')[26];
  assert.ok(p25.f && typeof p25.v === 'number', 'el P25 trae fórmula y valor');

  /* Y el valor es el del motor, no otro. */
  const esperado = analizarRangoAjustado(ESTUDIO_4, 'MO', 'ninguno');
  assert.strictEqual(p25.v, esperado.stats.p25);
  assert.strictEqual(mo.celdas[2][18].v, esperado.filas[0].valor);

  /* Conclusión: fórmula de texto con su valor. */
  const concl = filaCon('Conclusión')[26];
  assert.ok(concl.f, 'la conclusión sigue siendo fórmula');
  assert.strictEqual(concl.v, esperado.cumple);
});

test('sin muestra suficiente el libro no publica estadística ni conclusión', () => {
  const dos = { ...ESTUDIO_4, comparables: ESTUDIO_4.comparables.slice(0, 2) };
  const mo = hojasMemoriaRangoOptimo(dos, null).find((h) => h.nombre === 'MO');
  const filaCon = (etq) => mo.celdas.find((f) => f && f[17] && f[17].v === etq);
  assert.strictEqual(filaCon('P25 (cuartil inferior)')[26].v, '');
  assert.strictEqual(filaCon('Conclusión')[26].v, '');
});
```

Y arriba, el fixture de cuatro comparables —tres nacionales y una internacional, para que el ámbito importe y haya muestra suficiente:

```js
/* Cuatro comparables: tres nacionales y una internacional de margen extremo, para
   que el filtro de ámbito cambie el resultado de forma observable. */
const ESTUDIO_4 = {
  t_s: 1000, t_c: 600, t_op: 200, t_ar: 100, t_inv: 50, t_ap: 80, t_ppe: 300,
  prime: 7.37, cmode: 'all', seg_excluido: 0,
  comparables: [
    { name: 'Nacional A', amb: 'Nac', s: 500, c: 300, op: 100, ar: 50, inv: 20, ap: 40, ppe: 100 },
    { name: 'Nacional B', amb: 'Nac', s: 800, c: 500, op: 180, ar: 70, inv: 30, ap: 50, ppe: 120 },
    { name: 'Nacional C', amb: 'Nac', s: 600, c: 350, op: 150, ar: 60, inv: 25, ap: 45, ppe: 110 },
    { name: 'Internacional X', amb: 'Int', s: 900, c: 100, op: 100, ar: 10, inv: 5, ap: 5, ppe: 10 },
  ],
};
```

Añadir el import del motor al principio del test:

```js
import { analizarRangoAjustado } from './ajusteRangoCapitalTrabajo.js';
```

- [ ] **Step 2: Correr la prueba y confirmar que falla**

Run: `node --test frontend/src/services/memoriaCalculoRangoOptimo.test.js`
Expected: FAIL — `typeof sinAjuste.v` es `'undefined'`.

- [ ] **Step 3: Pedir los valores al motor, una vez por método y sabor**

Importar el motor en `memoriaCalculoRangoOptimo.js`:

```js
import { analizarRangoAjustado } from './ajusteRangoCapitalTrabajo.js';
```

Y actualizar la cabecera del módulo, que hoy afirma lo contrario (`:23`, «No calcula nada en JS salvo el layout: los números los pone Excel»):

```js
   Desde agosto de 2026 emite ADEMÁS el valor en caché de cada celda derivada, y lo
   pide a `ajusteRangoCapitalTrabajo.js` —el mismo motor que alimenta las tablas del
   .docx—. No es que el libro haya dejado de ser recalculable: la fórmula sigue ahí y
   Excel la recalcula al abrir. Lo que cambia es que el número que el libro publica y
   el que publica el informe son el mismo objeto y no dos cálculos parecidos, y que el
   .xlsx deja de verse vacío en cualquier lector que no recalcule. Si una fórmula y el
   motor discrepan, Excel mueve la celda al abrir y la discrepancia queda a la vista.
```

Dentro de `METODOS.forEach((M) => {`, antes del bucle de comparables:

```js
    /* El valor de cada celda derivada, pedido al motor una vez por sabor. Siete
       llamadas por método sobre un puñado de comparables: el coste es despreciable y
       lo que compra es que el libro no pueda discrepar del informe. */
    const porSabor = AJUSTES.map((aj) => analizarRangoAjustado(study, M.hoja, aj.clave));
```

- [ ] **Step 4: Escribir el valor en las celdas de comparable**

En la construcción de `fila`, sustituir las siete celdas `S`–`Y` por versiones con valor. `cFor` gana un tercer parámetro:

```js
/* Fórmula numérica. `v` es el valor en caché: la fórmula la recalcula Excel, el valor
   lo pone el motor. Se omite cuando no hay valor que poner (un intermedio del ajuste
   que el motor no expone) y entonces la celda sale como salía antes. */
const cFor = (f, z, v) => {
  const celda = { t: 'n', f, z: z || '0.00%' };
  if (v !== undefined && v !== null && Number.isFinite(v)) celda.v = v;
  return celda;
};
/* Fórmula de texto (la conclusión y la marca de ámbito). */
const cForT = (f, v) => {
  const celda = { t: 's', f };
  if (v !== undefined && v !== null) celda.v = String(v);
  return celda;
};
```

Y en la fila, con `i` el índice de la comparable:

```js
        cFor(`${num}/M${r}`, M.fmt, porSabor[0].filas[i]?.valor),            // S sin ajuste
        cFor(`(${num}-N${r})/R${r}`, M.fmt, porSabor[1].filas[i]?.valor),    // T CxC
        cFor(`(${num}+O${r})/${denomSinAR}`, M.fmt, porSabor[2].filas[i]?.valor), // U CxP
        cFor(`(${num}-P${r})/${denomSinAR}`, M.fmt, porSabor[3].filas[i]?.valor), // V Inv
        cFor(`(${num}-N${r}+O${r}-P${r})/R${r}`, M.fmt, porSabor[4].filas[i]?.valor),    // W
        cFor(`(${num}-N${r}+O${r}-P${r}-Q${r})/R${r}`, M.fmt, porSabor[5].filas[i]?.valor), // X
        cFor(`(${num}-Q${r})/${denomSinAR}`, M.fmt, porSabor[6].filas[i]?.valor),  // Y PP&E
```

El orden de `AJUSTES` (`:39-47`) es `ninguno, aar, aap, inv, aar_aap_inv, aar_aap_inv_ppe, ppe`, que es exactamente el de las columnas `S`–`Y`. Dejarlo escrito ahí como comentario, porque si alguien reordena `AJUSTES` las columnas se cruzan sin que nada falle:

```js
/* El orden de este arreglo ES el orden de las columnas S–Y de las hojas de método y
   el de las filas de la hoja Resumen. Reordenarlo cruza los valores en caché con las
   fórmulas sin que nada reviente. */
```

Las columnas `Z` y `AA`–`AG` que añadió la Task 5 pasan a llevar valor. Sustituir el
bloque que las empuja por este —es el mismo, con el tercer argumento de `cFor`/`cForT`:

```js
      /* Solo la parte del ámbito: la del valor finito la pone ISNUMBER en la propia
         hoja, y así el criterio queda partido igual en los dos lados. La función es la
         del motor, importada: ver el Step siguiente. */
      const entraAmbito = entraPorAmbito(porSabor[0].filas[i]?.amb, study.cmode);

      const ambitoRef = D(`$B$${FILA_AMBITO()}`);
      const ambComp = D(`J${src}`);
      fila.push(cForT(
        `IF(OR(${ambitoRef}="all",AND(${ambitoRef}="nac",${ambComp}="Nac"),`
        + `AND(${ambitoRef}="intl",${ambComp}="Int")),"Sí","No")`,
        entraAmbito ? 'Sí' : 'No'));

      ['S', 'T', 'U', 'V', 'W', 'X', 'Y'].forEach((L, k) => {
        const v = porSabor[k].filas[i]?.valor;
        const entraSerie = entraAmbito && Number.isFinite(v);
        fila.push(cFor(
          `IF(AND(Z${r}="Sí",ISNUMBER(${L}${r})),${L}${r},"")`,
          M.fmt,
          entraSerie ? v : undefined));
      });
```

El criterio de ámbito **no se replica en JS**. `entraPorAmbito` ya existe en
`ajusteRangoCapitalTrabajo.js:245` como `const` de módulo sin exportar. Exportarlo:

```js
/* Se exporta porque el emisor del libro necesita el mismo criterio para poner el valor
   en caché de su columna de ámbito. Replicarlo allá habría dejado tres copias del
   criterio —esta, la del libro y la fórmula de Excel— y la fórmula ya es una copia
   irreducible: está en otro lenguaje. Dos son el mínimo; tres eran una de más. */
export const entraPorAmbito = (amb, modo) => (
  modo === 'intl' ? amb === 'Int' : modo === 'nac' ? amb === 'Nac' : true
);
```

e importarlo en `memoriaCalculoRangoOptimo.js` junto a `analizarRangoAjustado`:

```js
import { analizarRangoAjustado, entraPorAmbito } from './ajusteRangoCapitalTrabajo.js';
```

En el bloque anterior, `entraPorAmbitoLibro(...)` pasa a ser `entraPorAmbito(...)`.

**Nota sobre las celdas de serie vacías:** cuando la fila no entra, la fórmula devuelve `""` y el valor en caché correcto es la cadena vacía, no un número. `cFor` no la escribe porque exige `Number.isFinite`. Es lo correcto: una celda numérica con `<v></v>` es inválida. La celda sale como fórmula sin valor y Excel la resuelve a `""` al abrir. Dejarlo comentado en el código.

- [ ] **Step 5: Escribir el valor en las filas de estadística, contribuyente y conclusión**

```js
    /* Los estadísticos salen del sabor de cada columna. `stats` es null cuando el
       motor no publica rango —menos de tres observaciones—, y entonces la celda va sin
       valor, igual que su fórmula con guarda devolverá "". */
    const statRow = (etq, fn, clave) => {
      const fila = filaEstadistica(etq);
      RES.forEach((L, k) => {
        const st = porSabor[k].stats;
        fila.push(cFor(conGuarda(L, `${fn}(${L}${r0}:${L}${rN})`), M.fmt,
          st ? st[clave] : undefined));
      });
      return fila;
    };
    const qRow = (etq, q, clave) => {
      const fila = filaEstadistica(etq);
      RES.forEach((L, k) => {
        const st = porSabor[k].stats;
        fila.push(cFor(conGuarda(L, `QUARTILE(${L}${r0}:${L}${rN},${q})`), M.fmt,
          st ? st[clave] : undefined));
      });
      return fila;
    };
```

Y las llamadas:

```js
    celdas.push(statRow('Mínimo', 'MIN', 'min'));
    const filaMin = celdas.length;
    const filaP25 = celdas.length + 1;
    celdas.push(qRow('P25 (cuartil inferior)', 1, 'p25'));
    celdas.push(qRow('Mediana (P50)', 2, 'med'));
    celdas.push(qRow('P75 (cuartil superior)', 3, 'p75'));
    const filaP75 = celdas.length;
    celdas.push(statRow('Máximo', 'MAX', 'max'));
    const filaMax = celdas.length;
```

El indicador del contribuyente y la conclusión:

```js
    const filaTested = celdas.length + 1;
    {
      const fila = filaEstadistica('Indicador del contribuyente');
      /* `sujeto` es el indicador del contribuyente contra sí mismo, que es el mismo
         para los siete sabores porque sus ratios de ajuste se anulan. Se toma del
         motor y no de `pliOf`, que solo conoce MO, MB y Berry: por esta vía las hojas
         de Cost Plus y NCP también traen su valor. */
      RES.forEach((L, k) => fila.push(cFor(testedFor, M.fmt, porSabor[k].sujeto)));
      celdas.push(fila);
    }
    {
      const fila = filaEstadistica('Conclusión');
      RES.forEach((L, k) => {
        /* Sin rango el motor devuelve 'CUMPLE' por comportamiento heredado
           (rangoIntercuartil.js:81). El libro NO lo repite: un soporte que declara
           CUMPLE sin un rango que lo sustente es peor que uno que deja el hueco. Es
           la única celda donde el libro y el informe difieren a propósito, y el test
           de paridad de la Task 7 la excluye por eso. */
        const st = porSabor[k].stats;
        fila.push(cForT(conGuarda(L,
          `IF(AND(${L}${filaTested}>=${L}${filaP25},`
          + `${L}${filaTested}<=${L}${filaP75}),"CUMPLE","NO CUMPLE")`),
          st ? porSabor[k].cumple : ''));
      });
      celdas.push(fila);
    }
```

- [ ] **Step 6: Llenar también las columnas `A`–`I`**

Son referencias a `Datos`, cuyos valores el emisor ya tiene:

```js
      const nombreRef = { t: 's', f: `${D(`A${src}`)}`, v: String(c.name || '') };
      const cifras = [c.s, c.c, c.op, c.ar, c.inv, c.ap, c.ppe];
      const numRefs = ['B', 'C', 'D', 'E', 'F', 'G', 'H'].map((L, k) => cFor(
        `${D(`${L}${src}`)}`, '#,##0.00', Number(cifras[k]) || 0));
      const tasaRef = cFor(`${D(`I${src}`)}`, '0.0000', (Number(study.prime) || 0) / 100);
```

Para lo cual el bucle necesita la comparable. Cambiar `for (let i = 0; i < n; i++) {` por:

```js
    for (let i = 0; i < n; i++) {
      const c = comps[i];
```

- [ ] **Step 7: Correr las pruebas y confirmar que pasan**

Run: `node --test frontend/src/services/memoriaCalculoRangoOptimo.test.js`
Expected: PASS

- [ ] **Step 8: Correr la suite completa y commit**

Run: `npm test`
Expected: PASS

```bash
git add frontend/src/services/memoriaCalculoRangoOptimo.js frontend/src/services/memoriaCalculoRangoOptimo.test.js
git commit -m "feat: el libro de soporte emite el valor calculado junto a cada fórmula"
```

---

### Task 7: La prueba de paridad

Las tareas anteriores hacen que el libro y el informe compartan la fuente. Esta escribe la prueba que lo afirma y que falla si alguien los separa otra vez.

**Files:**
- Create: `frontend/src/services/paridadLibroInforme.test.js`

**Interfaces:**
- Consumes: `hojasMemoriaRangoOptimo`, `analizarRango` (`rangoIntercuartil.js`), `analizarRangoAjustado`, `obtenerEstudioNormalizadoParaParche`.

- [ ] **Step 1: Escribir la prueba de paridad**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { hojasMemoriaRangoOptimo } from './memoriaCalculoRangoOptimo.js';
import { analizarRangoAjustado } from './ajusteRangoCapitalTrabajo.js';
import { analizarRango } from './rangoIntercuartil.js';
import { obtenerEstudioNormalizadoParaParche } from './estudioNormalizado.js';

/* El libro de soporte se radica ante la DIAN como respaldo del informe. Si publica un
   rango distinto del que publica el informe, no lo respalda: lo contradice. Estas
   pruebas afirman que las dos rutas devuelven el mismo número.

   Nótese la convención: el LIBRO y el MOTOR esperan `t_op` y `op` como GASTOS
   operativos; el resto del sistema los guarda como UTILIDAD operacional. El estudio
   del informe se escribe con la convención del sistema y se normaliza. */

const ESTUDIO_INFORME = {
  ent: 'END GAME INTERACTIVE COLOMBIA S.A.S.', anio: 2025,
  pli: 'MO', useadj: true, cmode: 'all', prime: 7.37, seg_excluido: 0,
  t_s: 5271105507, t_c: 2761202249, t_op: 294255770,
  t_ar: 578289605, t_inv: 0, t_ap: 27255376, t_ppe: 114783610,
  t_act_tot: 2179479687, t_cash: 12417756,
  comparables: [
    { name: 'QubicGames S.A.', amb: 'Int', s: 28.81, c: 0.15, op: 0.43, ar: 5.94, inv: 0.06, ap: 5.88, ppe: 0.42 },
    { name: 'Tose Co., Ltd.', amb: 'Int', s: 6636, c: 4844, op: 690, ar: 2508, inv: 7, ap: 189, ppe: 1395 },
    { name: 'Akatsuki Inc.', amb: 'Int', s: 23652, c: 9954, op: 3916, ar: 4252, inv: 0, ap: 763, ppe: 403 },
    { name: 'Marvelous Inc.', amb: 'Int', s: 186.7, c: 100.4, op: 11.7, ar: 0, inv: 0, ap: 0, ppe: 0 },
    { name: 'Drecom Co.,Ltd.', amb: 'Nac', s: 84.5, c: 61.3, op: 0.748, ar: 0, inv: 0, ap: 0, ppe: 0 },
  ],
};

/** Los estadísticos del libro para un método y una columna de sabor. */
function estadisticaDelLibro(estudioNorm, hoja, idxSabor) {
  const h = hojasMemoriaRangoOptimo(estudioNorm, null).find((x) => x.nombre === hoja);
  const col = 26 + idxSabor; // AA = 26
  const buscar = (etq) => h.celdas.find((f) => f && f[17] && f[17].v === etq);
  const v = (etq) => {
    const celda = buscar(etq)[col];
    return celda && celda.v !== undefined ? celda.v : null;
  };
  return {
    min: v('Mínimo'), p25: v('P25 (cuartil inferior)'), med: v('Mediana (P50)'),
    p75: v('P75 (cuartil superior)'), max: v('Máximo'),
    sujeto: v('Indicador del contribuyente'),
  };
}

const SABORES = ['ninguno', 'aar', 'aap', 'inv', 'aar_aap_inv', 'aar_aap_inv_ppe', 'ppe'];
const METODOS = ['MO', 'MB', 'Berry', 'CostPlus', 'NCP'];

test('el libro y el motor publican el mismo rango en los cinco métodos y los siete sabores', () => {
  const norm = obtenerEstudioNormalizadoParaParche(ESTUDIO_INFORME);
  METODOS.forEach((metodo) => {
    SABORES.forEach((sabor, i) => {
      const delMotor = analizarRangoAjustado(norm, metodo, sabor);
      const delLibro = estadisticaDelLibro(norm, metodo, i);
      const donde = `${metodo}/${sabor}`;
      if (!delMotor.stats) {
        assert.strictEqual(delLibro.p25, null, `${donde}: sin rango, el libro no publica`);
        return;
      }
      ['min', 'p25', 'med', 'p75', 'max'].forEach((k) => {
        assert.strictEqual(delLibro[k], delMotor.stats[k], `${donde}: ${k} no coincide`);
      });
      assert.strictEqual(delLibro.sujeto, delMotor.sujeto,
        `${donde}: el indicador del contribuyente no coincide`);
    });
  });
});

test('lo que el informe publica en su tabla de rango es lo que trae el libro', () => {
  /* La ruta del informe: analizarRango normaliza por su cuenta (aConvenioOCDE) y
     reporta el sabor SABOR_INFORME. Aquí se cotejan las dos puntas reales, no dos
     llamadas al mismo motor. */
  const delInforme = analizarRango(ESTUDIO_INFORME);
  const norm = obtenerEstudioNormalizadoParaParche(ESTUDIO_INFORME);
  const idxReportado = SABORES.indexOf('aar_aap_inv');
  const delLibro = estadisticaDelLibro(norm, 'MO', idxReportado);

  assert.strictEqual(delLibro.p25, delInforme.stats.p25, 'el P25 de la Tabla 18');
  assert.strictEqual(delLibro.med, delInforme.stats.med, 'la mediana de la Tabla 18');
  assert.strictEqual(delLibro.p75, delInforme.stats.p75, 'el P75 de la Tabla 18');

  /* Y la columna NO AJUSTADO de la misma tabla, contra la columna «Sin ajuste». */
  const sinAjusteLibro = estadisticaDelLibro(norm, 'MO', SABORES.indexOf('ninguno'));
  assert.strictEqual(sinAjusteLibro.p25, delInforme.statsNoAjustado.p25,
    'el P25 sin ajuste de la Tabla 18');
});

test('el filtro de ámbito mueve el rango en el libro igual que en el informe', () => {
  const soloNac = { ...ESTUDIO_INFORME, cmode: 'nac' };
  const norm = obtenerEstudioNormalizadoParaParche(soloNac);
  const delMotor = analizarRangoAjustado(norm, 'MO', 'ninguno');
  const delLibro = estadisticaDelLibro(norm, 'MO', SABORES.indexOf('ninguno'));
  /* Una sola nacional en el fixture: ni el motor ni el libro publican rango. */
  assert.strictEqual(delMotor.stats, null);
  assert.strictEqual(delLibro.p25, null,
    'el libro tampoco publica rango cuando el ámbito deja menos de tres');
});

test('con ámbito internacional el libro cuartila el mismo subconjunto que el informe', () => {
  /* El fixture trae cuatro internacionales y una nacional, así que con 'intl' sí hay
     muestra suficiente y el rango se calcula sobre un subconjunto propio. Es el caso
     que de verdad distingue «filtra» de «no filtra»: con 'all' los dos coincidirían
     por accidente. */
  const soloIntl = { ...ESTUDIO_INFORME, cmode: 'intl' };
  const norm = obtenerEstudioNormalizadoParaParche(soloIntl);
  const delMotor = analizarRangoAjustado(norm, 'MO', 'ninguno');
  const delLibro = estadisticaDelLibro(norm, 'MO', SABORES.indexOf('ninguno'));

  assert.ok(delMotor.stats, 'con cuatro internacionales hay rango');
  assert.strictEqual(delMotor.stats.n, 4, 'la nacional queda fuera');
  ['min', 'p25', 'med', 'p75', 'max'].forEach((k) => {
    assert.strictEqual(delLibro[k], delMotor.stats[k], `${k} con ámbito internacional`);
  });

  /* Y el resultado tiene que diferir del de 'all': si coincide, el filtro no se aplicó
     en ninguno de los dos y la prueba anterior no demuestra nada. */
  const conTodas = analizarRangoAjustado(
    obtenerEstudioNormalizadoParaParche(ESTUDIO_INFORME), 'MO', 'ninguno');
  assert.notStrictEqual(delMotor.stats.n, conTodas.stats.n,
    'el filtro de ámbito cambia el universo de forma observable');
});

test('una comparable sin cifras no entra en el libro ni en el informe', () => {
  const conHueco = {
    ...ESTUDIO_INFORME,
    comparables: [
      ...ESTUDIO_INFORME.comparables,
      /* Sin ventas ni costo: `indicadorAjustado` devuelve null (:113) y la fórmula de
         la hoja la descarta por ISNUMBER. */
      { name: 'Sin Cifras SA', amb: 'Int' },
    ],
  };
  const norm = obtenerEstudioNormalizadoParaParche(conHueco);
  const delMotor = analizarRangoAjustado(norm, 'MO', 'ninguno');
  const delLibro = estadisticaDelLibro(norm, 'MO', SABORES.indexOf('ninguno'));

  const completas = ESTUDIO_INFORME.comparables.length;
  assert.strictEqual(delMotor.stats.n, completas,
    'la comparable sin cifras no entra a la serie del motor');
  ['min', 'p25', 'med', 'p75', 'max'].forEach((k) => {
    assert.strictEqual(delLibro[k], delMotor.stats[k],
      `${k} no se mueve por una comparable sin cifras`);
  });

  /* Y su celda de serie sale vacía, no en cero: un cero fingiría una observación. */
  const mo = hojasMemoriaRangoOptimo(norm, null).find((h) => h.nombre === 'MO');
  const filaHueco = mo.celdas.find((f) => f && f[0] && f[0].v === 'Sin Cifras SA');
  assert.strictEqual(filaHueco[26].v, undefined,
    'la serie del rango deja la celda sin valor, no en cero');
});

test('el segmento excluido sale de un solo sitio', () => {
  const conSeg = { ...ESTUDIO_INFORME, seg_excluido: 271105507 };
  const norm = obtenerEstudioNormalizadoParaParche(conSeg);
  const delMotor = analizarRangoAjustado(norm, 'MO', 'aar_aap_inv');
  const delLibro = estadisticaDelLibro(norm, 'MO', SABORES.indexOf('aar_aap_inv'));
  assert.strictEqual(delLibro.sujeto, delMotor.sujeto,
    'el indicador del contribuyente parte de las mismas ventas en las dos rutas');
});
```

- [ ] **Step 2: Correr las pruebas**

Run: `node --test frontend/src/services/paridadLibroInforme.test.js`
Expected: PASS.

Si alguna falla, **no ajustar la expectativa**: es una divergencia real y hay que encontrar de qué lado está el error. Empezar por comparar la fórmula emitida en esa celda con la rama de `indicadorAjustado` que le corresponde, con la tabla de equivalencias del spec (`docs/superpowers/specs/2026-08-11-fuente-unica-libro-informe-design.md`, sección «Los seis sabores de ajuste coinciden»).

- [ ] **Step 3: Correr la suite completa y commit**

Run: `npm test`
Expected: PASS

```bash
git add frontend/src/services/paridadLibroInforme.test.js
git commit -m "test: paridad entre el libro de soporte y las tablas del informe"
```

- [ ] **Step 4: Verificación manual, que las pruebas no alcanzan**

1. `npm run dev --prefix frontend`
2. Abrir el Gestor de Reportes, cargar un estudio con comparables y descargar el Excel de soporte del Motor de Comparables.
3. Abrir el `.xlsx` en Excel. **Antes** de que recalcule, comprobar que las celdas de `MO` y de `Resumen` traen número —hoy salen en blanco—.
4. Confirmar que al recalcular (`Ctrl+Alt+F9`) **ningún valor cambia**. Un valor que se mueve es una fórmula que no coincide con el motor: anotar la celda y tratarlo como defecto, no como ruido.
5. Generar el informe `.docx` y cotejar el P25, la mediana y el P75 de la Tabla 18 contra la hoja `MO` del libro, columna `AE` (`CxC+CxP+Inv`).

---

### Task 8 (opcional): Las columnas intermedias `J`–`R` con valor

**No la pide el spec.** Después de la Task 6, las columnas `A`–`I` y `S`–`AG` traen valor, pero los intermedios del ajuste (`J` EBIT, `K` utilidad bruta, `L` desc, `M` base, `N`–`Q` los cuatro ajustes, `R` denominador) siguen sin él, porque viven dentro de `indicadorAjustado` y el motor no los expone. En un lector que no recalcule, esas nueve columnas —que son justamente el rastro de auditoría— salen vacías.

Hacerla o no es una decisión de producto: el libro ya cumple el objetivo del spec sin ella.

**Files:**
- Modify: `frontend/src/services/ajusteRangoCapitalTrabajo.js`
- Modify: `frontend/src/services/memoriaCalculoRangoOptimo.js`
- Test: `frontend/src/services/ajusteRangoCapitalTrabajo.test.js`

**Interfaces:**
- Produces: `desgloseAjuste(comp, contribuyente, metodo, tasa)` → `{ebit, utilBruta, desc, base, ajusteAR, ajusteAP, ajusteINV, ajustePPE, denomAjustado}`, o `null` si faltan cifras.

- [ ] **Step 1: Escribir la prueba que falla**

```js
test('el desglose del ajuste expone los intermedios que el libro publica', () => {
  const contribuyente = { s: 1000, c: 600, op: 200, ar: 100, inv: 50, ap: 80, ppe: 300 };
  const comp = { s: 500, c: 300, op: 100, ar: 50, inv: 20, ap: 40, ppe: 100 };
  const d = desgloseAjuste(comp, contribuyente, 'MO', 0.0737);

  assert.strictEqual(d.ebit, 100, 'EBIT = ventas − costo − gastos');
  assert.strictEqual(d.utilBruta, 200, 'utilidad bruta = ventas − costo');
  assert.strictEqual(d.desc, 0.0737 / 1.0737, 'factor r/(1+r)');
  assert.strictEqual(d.base, 500, 'la base de MO son las ventas del comparable');

  /* Los intermedios tienen que reproducir el indicador que ya publica el motor: si el
     desglose y el resultado no cuadran, uno de los dos está mal. */
  const reconstruido = (d.ebit - d.ajusteAR + d.ajusteAP - d.ajusteINV) / d.denomAjustado;
  const delMotor = indicadorAjustado(comp, contribuyente, 'MO', 'aar_aap_inv', 0.0737);
  assert.ok(Math.abs(reconstruido - delMotor) < 1e-12,
    `el desglose reconstruye el indicador: ${reconstruido} vs ${delMotor}`);
});
```

- [ ] **Step 2: Correr la prueba y confirmar que falla**

Run: `node --test frontend/src/services/ajusteRangoCapitalTrabajo.test.js`
Expected: FAIL — `desgloseAjuste is not defined`.

- [ ] **Step 3: Extraer el desglose de `indicadorAjustado`**

`indicadorAjustado` (`:110-225`) ya calcula todos esos valores. Extraer el tramo de `:111` a `:173` a una función propia y hacer que `indicadorAjustado` la use, para que no queden dos cálculos:

```js
/**
 * Los intermedios del ajuste de capital de trabajo, que son el rastro de auditoría que
 * publica el libro de soporte en sus columnas J–R.
 *
 * Se extrajo de `indicadorAjustado`, que ahora lo consume: calcularlos aparte habría
 * creado una segunda implementación de la misma aritmética, que es exactamente lo que
 * el diseño de 2026-08-11 retira del sistema.
 *
 * @returns {null|{ebit:number, utilBruta:number, desc:number, base:number,
 *   ajusteAR:number, ajusteAP:number, ajusteINV:number, ajustePPE:number,
 *   denomAjustado:number}}
 */
export function desgloseAjuste(comp, contribuyente, metodo, tasa) {
  const c = cifras(comp);
  const s = cifras(contribuyente);
  if (c.s === null || c.ebit === null || !s.s) return null;
  if (!BASES[metodo]) return null;

  const base = BASES[metodo];
  const t = num(tasa) || 0;
  const desc = t / (1 + t);

  const baseC = base === 'ventas' ? c.s
    : base === 'opex' ? c.op
    : base === 'cogs' ? c.c
    : c.c + c.op;
  const baseS = base === 'ventas' ? s.s
    : base === 'opex' ? s.op
    : base === 'cogs' ? s.c
    : s.c + s.op;
  if (!baseC || !baseS) return null;

  const denomDep = metodo === 'NCP' ? (c.c - c.ap) + c.op
    : metodo === 'CostPlus' ? c.c - c.ap
    : null;
  const usaDepurado = metodo === 'NCP' || metodo === 'CostPlus';
  const baseInvC = usaDepurado ? denomDep : baseC;

  const ajusteAR = ((c.ar / baseC) - (s.ar / baseS)) * (baseC * desc);
  const ajusteAP = ((c.ap / baseC) - (s.ap / baseS)) * (baseC * desc);
  const ajusteINV = ((c.inv / baseInvC) - (s.inv / baseS)) * (baseC * t);
  const ajustePPE = ((c.ppe / baseInvC) - (s.ppe / baseS)) * (baseC * t);

  const baseAjustada = base === 'ventas' ? c.s - ajusteAR : baseC;

  return {
    ebit: c.ebit, utilBruta: c.gp, desc, base: baseC,
    ajusteAR, ajusteAP, ajusteINV, ajustePPE,
    /* El denominador de la columna R del libro: para NCP y Cost Plus el depurado,
       para las bases de ventas la venta ajustada, y la base a secas en Berry. */
    denomAjustado: usaDepurado ? denomDep : baseAjustada,
    /* Internos, para que indicadorAjustado no los recalcule. */
    _baseAjustada: baseAjustada, _denomDep: denomDep, _usaDepurado: usaDepurado,
    _numBase: (metodo === 'MB' || metodo === 'Berry' || metodo === 'CostPlus') ? c.gp : c.ebit,
  };
}
```

Y `indicadorAjustado` arranca con:

```js
export function indicadorAjustado(comp, contribuyente, metodo, ajuste, tasa) {
  const d = desgloseAjuste(comp, contribuyente, metodo, tasa);
  if (!d) return null;
  const { ajusteAR, ajusteAP, ajusteINV, ajustePPE } = d;
  const baseC = d.base;
  const numBase = d._numBase;
  if (numBase === null) return null;
  const base = BASES[metodo];
```

conservando desde `let numerador;` (`:182`) hacia abajo sin cambios, y sustituyendo la línea del `denom` (`:221-223`) por:

```js
  const denom = d._usaDepurado ? d._denomDep
    : base === 'ventas' ? (AJUSTAN_AR.has(ajuste) ? d._baseAjustada : baseC)
    : baseC;
```

- [ ] **Step 4: Correr las pruebas del motor**

Run: `node --test frontend/src/services/ajusteRangoCapitalTrabajo.test.js`
Expected: PASS, y **sin un solo cambio de expectativa** en las pruebas que ya existían: es un refactor y el resultado de `indicadorAjustado` no se mueve.

- [ ] **Step 5: Llenar `J`–`R` en el libro**

En `memoriaCalculoRangoOptimo.js`, dentro del bucle de comparables:

```js
      /* Los intermedios, del mismo motor. No dependen del sabor: son los cuatro
         ajustes completos, y cada columna S–Y elige cuáles aplica. */
      const dg = desgloseAjuste(comps[i], contribuyenteDelEstudio, M.hoja,
        (Number(study.prime) || 0) / 100) || {};
```

donde `contribuyenteDelEstudio` se arma una vez por libro, con el mismo criterio del motor:

```js
  /* El contribuyente con la forma que espera `desgloseAjuste`. Las ventas salen de
     `valorDeRubro('t_s')` —la misma función que escribe la celda de Datos— y no de
     `study.t_s`, que viene en bruto: tomarlas de ahí dejaría los intermedios calculados
     sobre unas ventas y la celda que los referencia sobre otras. */
  const contribuyenteDelEstudio = {
    s: valorDeRubro('t_s'), c: study.t_c, op: study.t_op,
    ar: study.t_ar, inv: study.t_inv, ap: study.t_ap, ppe: study.t_ppe,
  };
```

Y las nueve celdas pasan a llevar su valor:

```js
        cFor(`B${r}-C${r}-D${r}`, '#,##0.00', dg.ebit),        // J EBIT
        cFor(`B${r}-C${r}`, '#,##0.00', dg.utilBruta),         // K util bruta
        cFor(`I${r}/(1+I${r})`, '0.00000', dg.desc),           // L desc
        cFor(`${base}`, '#,##0.00', dg.base),                  // M base
        cFor(`((E${r}/M${r})-(${AR_s}/${baseS}))*(M${r}*L${r})`, '#,##0.000', dg.ajusteAR),
        cFor(`((G${r}/M${r})-(${AP_s}/${baseS}))*(M${r}*L${r})`, '#,##0.000', dg.ajusteAP),
        cFor(`((F${r}/${baseInv})-(${INV_s}/${baseS}))*(M${r}*I${r})`, '#,##0.000', dg.ajusteINV),
        cFor(`((H${r}/${baseInv})-(${PPE_s}/${baseS}))*(M${r}*I${r})`, '#,##0.000', dg.ajustePPE),
        cFor(`${M.dep ? denomDep : (M.base === 'ventas' ? `(B${r}-N${r})` : M.base === 'opex' ? `D${r}` : `M${r}`)}`, '#,##0.00', dg.denomAjustado), // R
```

Importar `desgloseAjuste` junto a `analizarRangoAjustado`.

- [ ] **Step 6: Añadir la paridad de los intermedios al test de la Task 7**

```js
test('los intermedios del libro reproducen el indicador que publica', () => {
  const norm = obtenerEstudioNormalizadoParaParche(ESTUDIO_INFORME);
  const mo = hojasMemoriaRangoOptimo(norm, null).find((h) => h.nombre === 'MO');
  /* Fila 3 = primera comparable. J=9, N=13, O=14, P=15, R=17, W=22. */
  const f = mo.celdas[2];
  const reconstruido = (f[9].v - f[13].v + f[14].v - f[15].v) / f[17].v;
  assert.ok(Math.abs(reconstruido - f[22].v) < 1e-12,
    `las columnas intermedias reproducen la W: ${reconstruido} vs ${f[22].v}`);
});
```

- [ ] **Step 7: Correr la suite completa y commit**

Run: `npm test`
Expected: PASS

```bash
git add frontend/src/services/ajusteRangoCapitalTrabajo.js frontend/src/services/ajusteRangoCapitalTrabajo.test.js frontend/src/services/memoriaCalculoRangoOptimo.js frontend/src/services/paridadLibroInforme.test.js
git commit -m "feat: el libro publica los intermedios del ajuste con su valor"
```

---

## Al cerrar

Antes del merge, correr `/revisar-ramas-equipo`: integra `main` y las ramas de los compañeros y aborta ante conflictos fuera de `public/`. Los cuatro archivos que este plan toca están todos en `frontend/src/services/`, que es zona compartida con el resto del equipo.

## Lo que este plan NO hace, y conviene tener presente

- **La tabla de Razones de rechazo (#10) queda sin auditar.** El spec lo advierte: el informe lee `embudoSeleccion.porMotivo` y el libro recuenta por fórmula sobre las candidatas de `motorExcelExport.js:66-74`. Puede tener la misma clase de divergencia que tenía el rango. Necesita su propio spec.
- **Las tablas del informe siguen listando comparables fuera de ámbito.** Las tablas #11 y #13 listan todas las comparables con su margen, incluidas las que el filtro `cmode` excluye del rango. Después de la Task 1 los cuartiles ya no las cuentan, pero las filas siguen ahí. Que sea correcto o no es una pregunta de contenido del informe, no de arquitectura, y no se resuelve aquí.
- Las 8 tablas macro, la operación, las transacciones, la composición accionaria y las vinculadas: no existen en el libro.
