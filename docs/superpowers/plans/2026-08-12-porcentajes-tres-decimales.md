# Porcentajes con tres decimales — Plan de implementación

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usa superpowers:subagent-driven-development o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan casilla (`- [ ]`).

**Goal:** Que todo porcentaje que el sistema calcule se imprima con tres decimales y el separador de `es-CO`, con un solo formateador por aplicación.

**Architecture:** `frontend/src/utils/calculations.js` adopta la implementación que `index.html:2018` ya tenía (`toLocaleString('es-CO')`, tres decimales) más el espacio antes del signo. Los sitios que hoy escriben el formato a mano se enrutan a ese formateador. Los formatos de celda del Excel pasan de `'0.00%'` a `'0.000%'`, que es un mecanismo aparte porque lo renderiza Excel.

**Tech Stack:** JavaScript ESM, `node:test` + `node:assert`, `xlsx-js-style`.

## Global Constraints

- Todo el código, los comentarios y los mensajes de commit **en español, con tildes correctas**.
- **Sin trailer `Co-Authored-By`** en los commits.
- `npm test` al 100 % en verde. La línea base es **1170** pruebas y no puede bajar.
- `npm run lint --prefix frontend` sin advertencias nuevas. Hay deuda preexistente ajena.
- **`pctf` recibe la FRACCIÓN** (`0.04985`) y multiplica por 100 él mismo. Enrutar un sitio que ya multiplica sin quitarle el `* 100` imprime `8.700,000 %` en vez de `87,000 %`.
- Formato de salida exacto: `pctf(0.04985)` → `'4,985 %'`. Coma decimal, tres decimales siempre, espacio antes del signo.
- **No se toca** `build1125Record()` de `index.html` (Formato 1125, formato dictado por la DIAN), ni las barras de progreso y anchos CSS de `MotorComparables.jsx`, ni las columnas `'0.0000'` de Berry y Cost Plus, ni las tablas macro de `tablasInforme.js`.
- Los números de línea de este plan son del árbol en `883c6ab` y **se mueven**: localizar el texto con Grep al editar.

---

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `frontend/src/utils/calculations.js` | El formateador `pctf` | 1 |
| `frontend/src/services/tablasContribuyente.js` | A.V. de la Tabla 10 y del ANEXO A | 2 |
| `frontend/src/services/tablasHtmlInforme.js` | porcentajes de la ruta HTML | 2 |
| `frontend/src/services/motorExcelExport.js` | puntaje del motor | 2 |
| `frontend/src/services/cruceComparables.js` | coincidencia y umbral | 2 |
| `frontend/src/components/CatalogoHistorico.jsx` | catálogo (UI) | 2 |
| `frontend/src/components/MotorComparables.jsx` | «% de coincidencia» | 2 |
| `frontend/src/services/memoriaCalculoRangoOptimo.js` | formatos de celda del Excel | 3 |
| `index.html` | `pctf` del monolito y sus llamadores | 4 |

---

### Task 1: El formateador

`pctf` es el único sitio del frontend que hay que cambiar para que los veinte llamadores que ya
lo usan —incluidos los marcadores `{rango.p25}` del `.docx` vía `plantillaVocabulario.js:142`—
pasen a tres decimales.

**Files:**
- Modify: `frontend/src/utils/calculations.js` (la función `pctf`)
- Test: `frontend/src/utils/calculations.test.js`

**Interfaces:**
- Produces: `pctf(v)` → `string`. Recibe la **fracción**; devuelve `'4,985 %'` o `'—'`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Añadir al final de `frontend/src/utils/calculations.test.js`:

```js
/* ── pctf: tres decimales y separador de es-CO ──
   La convención no es nueva: `index.html` ya formateaba así con
   toLocaleString('es-CO') y tres decimales, mientras este `pctf` daba dos decimales con
   punto. El mismo estudio publicaba «4,985%» por la ruta del monolito y «4.98%» por la del
   gestor. */

test('pctf imprime tres decimales con coma y espacio antes del signo', () => {
  assert.strictEqual(pctf(0.04985), '4,985 %');
});

test('pctf conserva los tres decimales cuando el valor no los necesita', () => {
  /* `minimumFractionDigits` es lo que lo garantiza. Un toFixed mal puesto daría «5 %». */
  assert.strictEqual(pctf(0.05), '5,000 %');
  assert.strictEqual(pctf(1), '100,000 %');
});

test('pctf distingue dos cifras que con dos decimales se imprimían iguales', () => {
  /* La razón de ser del cambio: los márgenes de este dominio se mueven en centésimas de
     punto, y con dos decimales estas dos son la misma cadena. */
  assert.notStrictEqual(pctf(0.04985), pctf(0.04984));
});

test('pctf devuelve el hueco visible sin dato, incluido NaN', () => {
  /* NaN es la guarda que el monolito ya tenía y a esta versión le faltaba: `pctf(NaN)`
     devolvía la cadena «NaN%», que se radicaba tal cual. */
  assert.strictEqual(pctf(null), '—');
  assert.strictEqual(pctf(undefined), '—');
  assert.strictEqual(pctf(NaN), '—');
});

test('pctf formatea los negativos con su signo y los tres decimales', () => {
  assert.strictEqual(pctf(-0.0432), '-4,320 %');
});
```

Si el archivo no importa `pctf`, añadirlo al `import` existente de `./calculations.js`.

- [ ] **Step 2: Correr las pruebas y confirmar que fallan**

Run: `node --test frontend/src/utils/calculations.test.js`
Expected: FAIL. La primera da `'4.98%'` frente a `'4,985 %'` esperado, y la de `NaN` da `'NaN%'`.

- [ ] **Step 3: Cambiar el formateador**

En `frontend/src/utils/calculations.js`, sustituir `pctf` completa:

```js
/* Tres decimales y separador de es-CO. Es la convención del informe y la que
   `index.html` ya aplicaba: antes de unificarlo, un mismo estudio publicaba «4,985%» por la
   ruta del monolito y «4.98%» por la del gestor para la misma cifra.

   Los tres decimales no son cosmética. Los márgenes de este dominio se mueven en centésimas
   de punto, y con dos decimales «4,985 %» y «4,984 %» se imprimen iguales.

   `toLocaleString` da la coma sola; un `replace('.', ',')` a mano se rompe en cuanto el
   número lleva separador de miles. */
export function pctf(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (v * 100).toLocaleString('es-CO',
    { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' %';
}
```

- [ ] **Step 4: Correr las pruebas del formateador**

Run: `node --test frontend/src/utils/calculations.test.js`
Expected: PASS

- [ ] **Step 5: Correr la suite completa y actualizar las expectativas que fija el formato**

Run: `npm test`

Van a caer las pruebas que afirman el formato viejo. Actualizarlas al nuevo, **una por una y
leyendo qué afirma cada una**, no con un reemplazo global:

- `frontend/src/services/tablasContribuyente.test.js`: `'25.00%'` → `'25,000 %'`, `'0.57%'` →
  `'0,570 %'`, `'100.00%'` → `'100,000 %'`, `'0.00%'` → `'0,000 %'`.
- `frontend/src/services/tablasHtmlInforme.test.js`: las salidas esperadas de las líneas 124,
  125, 129, 130 y 131. Las de 152, 160, 166 y 183 pasan porcentajes como **entrada** a
  `reescribirFilasHtml`: son datos de prueba, no aserciones del formateador, y no se tocan.
- `frontend/src/services/docxRelleno.test.js`: `'5.00%'` → `'5,000 %'`.

Si cae alguna que no está en esta lista, **leerla antes de tocarla**: puede estar afirmando
algo que el cambio rompió de verdad.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/utils/calculations.js frontend/src/utils/calculations.test.js frontend/src/services/tablasContribuyente.test.js frontend/src/services/tablasHtmlInforme.test.js frontend/src/services/docxRelleno.test.js
git commit -m "feat: pctf imprime tres decimales con el separador de es-CO"
```

---

### Task 2: Los seis sitios que formatean a mano

**Files:**
- Modify: `frontend/src/services/tablasContribuyente.js` (`verticalSobreActivos`)
- Modify: `frontend/src/services/tablasHtmlInforme.js` (la función `pct`)
- Modify: `frontend/src/services/motorExcelExport.js` (`puntaje`)
- Modify: `frontend/src/services/cruceComparables.js` (tres sitios)
- Modify: `frontend/src/components/CatalogoHistorico.jsx`
- Modify: `frontend/src/components/MotorComparables.jsx` (el «% de coincidencia»)
- Test: `frontend/src/services/tablasContribuyente.test.js`, `frontend/src/services/cruceComparables.test.js`

**Interfaces:**
- Consumes: `pctf(v)` de la Task 1.

> **Nota del inventario.** `verticalSobreActivos` tiene **una sola** definición, en
> `tablasContribuyente.js:40`; `docxRelleno.js:43` solo la reexporta para quien la importaba de
> ahí. El spec la contaba en los dos sitios: es uno.

- [ ] **Step 1: Escribir las pruebas que fallan**

En `frontend/src/services/tablasContribuyente.test.js`:

```js
test('el A.V. usa el formateador único y no su propia copia del formato', () => {
  /* Se compara contra `pctf` y no contra una cadena escrita a mano: así los dos no pueden
     volver a divergir, que es lo que pasó cuando cada sitio se formateaba solo. */
  const av = verticalSobreActivos({ t_act_tot: 2000 });
  assert.strictEqual(av(500), pctf(0.25));
});
```

En `frontend/src/services/cruceComparables.test.js`:

```js
test('la coincidencia se multiplica por 100 una sola vez y no duplica el signo', () => {
  /* Dos errores que este enrutado puede introducir, y los dos dan una cadena creíble:
     dejar el `* 100` puesto imprime «8.700,000 %», y dejar el ` %` del literal imprime
     «87,000 % %». */
  const texto = motivoRechazoEnFila({ nombre: 'ALFA SA' }, { name: 'ALFA SA' }, 'x.pdf');
  assert.ok(texto.includes('100,000 % de coincidencia'),
    `esperaba «100,000 % de coincidencia» y salió: ${texto}`);
  assert.ok(!texto.includes('% %'), `el signo se duplicó: ${texto}`);
  assert.ok(!texto.includes('10.000'), `se multiplicó dos veces: ${texto}`);
});

test('el umbral del cruce también sale con tres decimales', () => {
  const texto = motivoCruce(
    { modo: 'sin-cruce', punt: 0.42, masCercana: { name: 'BETA SA' } },
    { nombre: 'ALFA SA' }, 'x.pdf');
  assert.ok(texto.includes('42,000 % de coincidencia'), texto);
  assert.ok(!texto.includes('% %'), `el signo se duplicó: ${texto}`);
});
```

`motivoCruce` y `motivoRechazoEnFila` son los nombres que exporta el módulo; comprobar en el
`import` del archivo de prueba, que ya usa varios de ellos. Añadir `pctf` al `import` en los dos
archivos de prueba.

- [ ] **Step 2: Correr las pruebas y confirmar que fallan**

Run: `node --test frontend/src/services/tablasContribuyente.test.js frontend/src/services/cruceComparables.test.js`
Expected: FAIL

- [ ] **Step 3: Enrutar los seis sitios**

`tablasContribuyente.js`, en `verticalSobreActivos`:

```js
    return pctf(n / total);
```

`tablasHtmlInforme.js`, en `pct`:

```js
/* El formato lo pone `pctf`: mismo separador y mismos decimales que la ruta .docx. Un hueco
   visible —y no un cero— cuando la comparable no tiene margen calculable. */
function pct(v) {
  return (v === null || v === undefined || !Number.isFinite(Number(v)))
    ? '—'
    : pctf(Number(v));
}
```

`motorExcelExport.js`, en `puntaje`:

```js
const puntaje = (v) => (typeof v === 'number' ? pctf(v) : '—');
```

`cruceComparables.js`, en `motivoCruce` y `motivoRechazoEnFila`. **`pctf` ya devuelve el signo,
y los literales que rodean a `pct` también lo traen**: enrutar sin quitarlo imprime
`87,000 % %`. Hay que tocar las dos cosas a la vez:

```js
  const pct = pctf(cruce.punt || 0);            // era Math.round((cruce.punt || 0) * 100)
```

y en los literales, quitar el ` %` que sigue a `pct`:

- `pct + ' % de coincidencia — por debajo del '` → `pct + ' de coincidencia — por debajo del '`
- `Math.round(UMBRAL_TOKENS * 100) + ' % que se exige.'` → `pctf(UMBRAL_TOKENS) + ' que se exige.'`
- `' (' + pct + ' %). Se leyó «'` → `' (' + pct + '). Se leyó «'`

En `motivoRechazoEnFila`, igual: `const pct = pctf(parecido(leido, destino));` y el literal
`' % de coincidencia)'` pasa a `' de coincidencia)'`.

`CatalogoHistorico.jsx`, en `margenLegible`. Sus dos ramas reciben **unidades distintas**, y el
comentario de encima explica por qué: el valor se muestra con la unidad en que lo expresó el
informe del que se leyó. Hay que respetarlo:

```js
    return Math.abs(n) <= 1
      ? pctf(n)        // fracción: 0,1803 → «18,030 %»
      : pctf(n / 100); // ya viene en porcentaje: 18,03 → «18,030 %»
```

`MotorComparables.jsx`, el «% de coincidencia». Su literal tampoco lleva espacio antes del
signo (`+ '% de coincidencia'`), así que también cambia:

```js
                            : ' · ' + pctf(comp.eeffCruce.punt || 0) + ' de coincidencia'}
```

Añadir el `import { pctf }` donde falte. En los componentes ya suele estar importado desde
`../utils/calculations`; comprobarlo.

- [ ] **Step 4: Correr las pruebas y la suite**

Run: `node --test frontend/src/services/tablasContribuyente.test.js frontend/src/services/cruceComparables.test.js`
Expected: PASS

Run: `npm test`
Expected: PASS. Si cae algo de `motorExcelExport.test.js` por el puntaje, actualizar la
expectativa: el paso de un decimal a tres es intencional.

- [ ] **Step 5: Comprobar que no quedó ningún sitio suelto**

Run: `npm run lint --prefix frontend` (sin advertencias nuevas)

Y una búsqueda del patrón viejo, que debe devolver solo lo excluido a propósito —las barras de
progreso, los anchos CSS, los tamaños en MB y los segundos—:

Run: `grep -rn "toFixed([12]) *+ *' *%'\|toFixed([12]) *+ *\"%\"" frontend/src/`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services frontend/src/components
git commit -m "refactor: un solo formateador de porcentajes en el frontend"
```

---

### Task 3: Los formatos de celda del Excel

**Files:**
- Modify: `frontend/src/services/memoriaCalculoRangoOptimo.js` (once cadenas `'0.00%'`)
- Test: `frontend/src/services/memoriaCalculoRangoOptimo.test.js`

**Interfaces:**
- Consumes: nada de las tareas anteriores. El formato de celda es una cadena que interpreta
  Excel, no el formateador de JS.

- [ ] **Step 1: Escribir la prueba que falla**

En `frontend/src/services/memoriaCalculoRangoOptimo.test.js`:

```js
test('las celdas de porcentaje llevan tres decimales y las de razón se quedan en cuatro', () => {
  /* Las dos cosas en la misma prueba a propósito: Berry y Cost Plus son RAZONES sin signo de
     porcentaje —un Berry de 1,25 no es «125 %»— y ampliar el cambio no debe llevárselas por
     delante. */
  const hojas = hojasMemoriaRangoOptimo(ESTUDIO_4, null);
  const conFormato = (hoja, z) => hojas.find((h) => h.nombre === hoja)
    .celdas.flat().filter((c) => c && c.z === z).length;

  ['MO', 'MB', 'NCP'].forEach((m) => {
    assert.ok(conFormato(m, '0.000%') > 0, `${m} debería traer celdas con formato 0.000%`);
    assert.strictEqual(conFormato(m, '0.00%'), 0, `${m} no debería traer ninguna con 0.00%`);
  });

  ['Berry', 'CostPlus'].forEach((m) => {
    assert.ok(conFormato(m, '0.0000') > 0, `${m} conserva sus cuatro decimales sin signo %`);
  });
});
```

- [ ] **Step 2: Correr la prueba y confirmar que falla**

Run: `node --test frontend/src/services/memoriaCalculoRangoOptimo.test.js`
Expected: FAIL — «MO debería traer celdas con formato 0.000%».

- [ ] **Step 3: Cambiar las once cadenas**

En `memoriaCalculoRangoOptimo.js`, `'0.00%'` → `'0.000%'` en: los `fmt` de `METODOS` para
`MO`, `MB` y `NCP`; el valor por defecto de `cFor`; la celda del A.V.; las tres celdas de la
tasa; las dos filas de «Diagnóstico de datos» que son porcentajes; y la de la hoja de
diagnóstico que divide `H` entre `B`.

**No tocar** los `'0.0000'` de `Berry` y `CostPlus` ni los `'#,##0.00'` de los montos ni el
`'0.00000'` del factor de descuento.

Comprobar que no queda ninguna:

Run: `grep -c "0\.00%" frontend/src/services/memoriaCalculoRangoOptimo.js`
Expected: `0`

- [ ] **Step 4: Correr la prueba y la suite**

Run: `node --test frontend/src/services/memoriaCalculoRangoOptimo.test.js`
Expected: PASS. Actualizar la aserción preexistente que fija `celda.z === '0.00%'`.

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/memoriaCalculoRangoOptimo.js frontend/src/services/memoriaCalculoRangoOptimo.test.js
git commit -m "feat: las celdas de porcentaje del libro llevan tres decimales"
```

---

### Task 4: El monolito

`index.html` ya trae los tres decimales y la coma en su `pctf`; le falta el espacio. Y once
sitios formatean a mano sin pasar por él.

**Files:**
- Modify: `index.html` (la definición de `pctf` y los sitios que formatean a mano)

**Interfaces:**
- Consumes: nada. `index.html` no importa nada del frontend: es un monolito sin módulos.

> **Este archivo no recibe desarrollo nuevo** (CLAUDE.md). Esto entra como corrección puntual
> sobre lo que ya existe: el formateador ya está escrito y solo se le añade el espacio, y los
> once sitios pasan a usarlo en vez de repetirlo. La verificación es manual en el navegador,
> porque `index.html` no tiene pruebas.

- [ ] **Step 1: Añadir el espacio al formateador**

Localizar la definición de `pctf` (una sola línea, con `toLocaleString('es-CO'`) y cambiar el
final de `+ '%'` a `+ ' %'`.

- [ ] **Step 2: Enrutar los sitios que formatean a mano**

Once sitios, cada uno con su cifra. Localizarlos por su texto:

| Qué imprime | Hoy |
|---|---|
| verificación cruzada, dos avisos | `pct.toFixed(2)` y `pct.toFixed(1)` sobre un valor **ya en porcentaje** |
| participación accionaria, tres sitios | `socioMax.toFixed(2)`, `maxParticipacion(...).toFixed(2)` — **ya en porcentaje** |
| margen de una comparable | `((elPerdida.op / elPerdida.s) * 100).toFixed(2)` |
| diagnósticos de cruce, dos sitios | `(razon * 100).toFixed(1)` |
| variación de ingresos | `(varr * 100).toFixed(1)` |
| monto sobre tope | `((r.monto / r.topeCOP) * 100).toFixed(1)` |
| variación del catálogo | `c.variacion.toFixed(1)` — **ya en porcentaje** |

**La mitad de estos valores ya viene multiplicada por 100.** Al enrutarlos a `pctf`, que
multiplica, hay que pasar la fracción: quitar el `* 100` donde esté, y dividir entre 100 donde
el valor llegue ya en porcentaje. Es el error más fácil de cometer en esta tarea; revisar cada
sitio leyendo de dónde sale su valor.

Los tres sitios que ya usan `toFixed(3)` —el indicador aplicado y el P25/mediana/P75 del
resumen— también se enrutan: tienen los decimales pero con punto.

- [ ] **Step 3: Sincronizar el artefacto y verificar en el navegador**

Run: `npm run build`

Confirmar que `public/index.html` quedó regenerado desde la raíz y no al contrario.

Verificación manual, que es la única disponible en este archivo: abrir la app, cargar un
estudio con comparables y comprobar que el indicador, el rango y la participación accionaria
muestran `4,985 %` con coma, tres decimales y espacio; y que ninguno muestra un número
inflado cien veces, que es el síntoma del `* 100` de más.

- [ ] **Step 4: Confirmar que el Formato 1125 sigue intacto**

Run: `grep -n "toFixed(2)" index.html`

Entre los resultados tiene que seguir apareciendo el `f2` de `build1125Record()`. **Ese es el
que NO se toca**: su formato lo dicta la especificación técnica de la DIAN.

- [ ] **Step 5: Commit**

```bash
git add index.html public/index.html
git commit -m "fix: un solo formateador de porcentajes en el monolito"
```

---

## Al cerrar

`npm test` al 100 % (piso 1170), `npm run lint --prefix frontend` sin advertencias nuevas, y
la verificación manual del `.docx` y del `.xlsx`: que las tablas de rango, la Tabla 10 y el
ANEXO A muestren `4,985 %`, y que las celdas de porcentaje del libro traigan tres decimales.

Antes del merge, `/revisar-ramas-equipo`: hay dos compañeros publicando en este repo y esta
rama toca `frontend/src/services/`, que es zona compartida.

## Lo que este plan NO hace

- El **Formato 1125 y el Formulario 120** se quedan en dos decimales. Formato de la DIAN.
- Las **barras de progreso y los anchos CSS** de `MotorComparables.jsx`, que no son datos.
- Las columnas de **Berry y Cost Plus** del Excel, que son razones sin signo de porcentaje.
- Las **tablas macro**, que imprimen el valor tal como lo publica la fuente.
- El **defecto preexistente de Berry**: `pctf` se aplica al indicador sin mirar el método, así
  que un estudio con `pli: 'Berry'` publica «125,000 %» donde debería decir «1,2500». Este
  plan lo hace más visible sin causarlo. Necesita su propio spec, porque es semántica y no
  formato.
