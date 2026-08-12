# Diseño — Todo porcentaje con tres decimales y separador de es-CO

Fecha: 2026-08-12
Rama: `juandev`

## De dónde sale este diseño

De la observación de que los porcentajes deben imprimirse siempre con tres decimales. Al
inventariar dónde se formatean apareció algo que reencuadra el trabajo: **la convención ya
existe y está en producción**, solo que en la mitad del sistema.

`index.html:2018` formatea así desde antes de este diseño:

```js
const pctf = n => n === null || isNaN(n) ? '—' :
  (n * 100).toLocaleString('es-CO', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + '%';
```

Tres decimales, y la coma decimal que sale sola del locale `es-CO`. El monolito es la
implementación de referencia. `frontend/src/utils/calculations.js:94` es el que se desvió:

```js
export function pctf(v) {
  if (v === null || v === undefined) return '—';
  return (v * 100).toFixed(2) + '%';
}
```

Dos decimales y punto decimal. Así que el mismo informe puede publicar `4,985%` en la ruta
del monolito y `4.98%` en la del gestor para la misma cifra. Esto no inventa una convención:
propaga la que ya está escrita y elimina la divergencia.

## Estado verificado

Cada sitio de la lista se localizó por grep y se leyó. Los números de línea son del árbol en
`83d3deb`; el CLAUDE.md advierte que se mueven, así que al implementar hay que localizar el
texto, no confiar en la línea.

### El formateador y sus consumidores

`pctf` de `calculations.js` ya concentra la mayoría del trabajo. Estos sitios cambian solos
al cambiarlo, sin tocarlos:

| Archivo | Líneas |
|---|---|
| `AuditoriaNorma.jsx` | 94, 95, 118, 122, 164 |
| `IngestaCifras.jsx` | 330 |
| `MemoriaRangoModal.jsx` | 115, 138, 139, 208, 211, 302, 327 |
| `MotorComparables.jsx` | 2015, 2017, 2031, 2217 |
| `docxRelleno.js` | 88, 89, 441 |
| `plantillaVocabulario.js` | 142 |

`plantillaVocabulario.js:142` es el que alimenta los marcadores `{rango.p25}`, `{rango.mediana}`
y `{rango.p75}` del `.docx`, así que de ahí salen los porcentajes del documento que se radica.

### Los seis sitios que duplican el formato a mano

Esta es la razón por la que hoy el cambio son seis ediciones en vez de una:

| Archivo | Línea | Hoy | Qué imprime |
|---|---|---|---|
| `tablasContribuyente.js` | 45 | `((n/total)*100).toFixed(2)+'%'` | A.V. de la Tabla 10 |
| `tablasHtmlInforme.js` | 520 | `(Number(v)*100).toFixed(2)+'%'` | tablas de la ruta HTML |
| `docxRelleno.js` | 534 | `((n/total)*100).toFixed(2)+'%'` | A.V. (`verticalSobreActivos`) |
| `CatalogoHistorico.jsx` | 45-46 | `.toFixed(2).replace('.',',')+' %'` | catálogo (ya con coma) |
| `motorExcelExport.js` | 6 | `(v*100).toFixed(1)+'%'` | puntaje del motor |
| `cruceComparables.js` | 217, 236, 251 | `Math.round(x*100)` | coincidencia y umbral |

Más `MotorComparables.jsx:1975`, que imprime `Math.round(punt*100) + '% de coincidencia'`.

### Los formatos de celda del Excel

`memoriaCalculoRangoOptimo.js` declara el formato numérico por celda, que es un mecanismo
distinto del formateador de JS: Excel lo renderiza con el separador de quien abre el archivo,
así que la coma sale sola y solo hay que cambiar los decimales.

Once sitios con `'0.00%'`: líneas 50, 51 y 54 (los `fmt` de MO, MB y NCP), 139 (el valor por
defecto de `cFor`), 274 (el A.V.), 286, 306 y 328 (las tres celdas de la tasa), 698 y 699 (la
hoja «Diagnóstico de datos») y 746.

### El monolito

`index.html:2018` ya trae los tres decimales y la coma; solo le falta el espacio antes del
signo. Y once sitios formatean a mano sin pasar por él: 3607, 3610 (verificación cruzada),
3706, 8767, 8789 (participación accionaria, con cita al Art. 260-1), 8759 (margen de una
comparable), 9083, 9084, 9095 (diagnósticos de cruce y variación) y 11819, 12161.

Tres sitios más —9893, 9923 y 9924— ya usan `toFixed(3)`, así que tienen los tres decimales
pero con **punto**: al enrutarlos a `pctf` ganan la coma y dejan de contradecir al resto del
mismo documento.

### Las pruebas que fijan el formato actual

Unas quince aserciones en cuatro archivos, que hay que actualizar con el formato nuevo:

- `tablasContribuyente.test.js`: 11 (`'25.00%'`), 77 (`'0.57%'`), 78 (`'100.00%'`), 91 (`'0.00%'`)
- `tablasHtmlInforme.test.js`: 124, 125, 129, 130, 131 (salidas esperadas). Las de 152, 160,
  166 y 183 pasan cadenas de porcentaje como **entrada** a `reescribirFilasHtml`: son datos de
  prueba, no aserciones del formateador, y no hace falta tocarlas.
- `docxRelleno.test.js`: 587 (`'5.00%'`)
- `memoriaCalculoRangoOptimo.test.js`: 324 (`'0.00%'`)

## El diseño

### Un formateador por aplicación, con el mismo comportamiento

`frontend/src/utils/calculations.js` adopta la implementación del monolito, más el espacio:

```js
/* Tres decimales y separador de es-CO, que es la convención del informe y la que
   `index.html` ya aplicaba: un mismo estudio publicaba «4,985%» por la ruta del monolito y
   «4.98%» por la del gestor. `toLocaleString` da la coma sin un `replace` a mano.

   Los tres decimales no son cosmética: los márgenes de este dominio se mueven en centésimas
   de punto, y con dos decimales «4,985 %» y «4,984 %» se imprimen iguales. */
export function pctf(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (v * 100).toLocaleString('es-CO',
    { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' %';
}
```

Se añade la guarda de `isNaN` que el monolito ya tiene y al frontend le falta: hoy
`pctf(NaN)` devuelve `'NaN%'`.

`index.html:2018` recibe solo el espacio. Es corrección puntual sobre lo que ya existe, que
es lo que el CLAUDE.md permite en ese archivo.

### Los sitios duplicados se enrutan al formateador

Los siete del frontend —los seis archivos de la tabla anterior más `MotorComparables.jsx:1975`—
pasan a llamar a `pctf`. Dos merecen nota:

- **`verticalSobreActivos`** (`docxRelleno.js:529`) y **`tablasContribuyente.js:45`** calculan
  el mismo A.V. sobre el total de activos. Su cociente se conserva tal cual; lo único que
  cambia es quién lo imprime.
- **`puntaje`** (`motorExcelExport.js:6`) pasa de un decimal a tres. Es la única cifra cuyo
  aspecto cambia de forma notoria: «87.5%» se convierte en «87,500 %».

**Cuidado con la unidad al enrutar, que es el error más fácil de cometer aquí.** `pctf` recibe
la **fracción** y multiplica por 100 él mismo. Los sitios de `cruceComparables.js` y
`MotorComparables.jsx:1975` ya multiplican: `Math.round((cruce.punt || 0) * 100)`, donde
`punt` es una fracción. Al enrutarlos hay que **quitar ese `* 100`** y pasar la fracción
cruda —`pctf(cruce.punt)`—, no dividir nada. Si se deja el `* 100`, un 0,87 se imprime como
«8.700,000 %». Las pruebas lo cubren con un valor conocido por ese motivo.

### El Excel

Los once `'0.00%'` pasan a `'0.000%'`. El formato de la celda es una cadena literal en once
sitios; el diseño **no** los centraliza en una constante, porque el módulo ya declara el
formato por método en `METODOS` y meter una constante a medias dejaría dos convenciones.

### El monolito

`pctf` gana el espacio y los once sitios que formatean a mano se enrutan a él. Los tres que
ya usan `toFixed(3)` también, para que el punto decimal desaparezca del documento.

## Fuera de alcance

Tres exclusiones confirmadas, cada una con su razón:

### El Formato 1125 y el Formulario 120

`index.html:2697`, `build1125Record()`. Sus campos «Margen o precio sin ajustar», «Margen o
precio ajustado», «Valor mínimo o límite inferior», «Mediana (positiva)» y «Valor máximo» se
formatean con `f2` a dos decimales (`index.html:2704`).

**Ese formato lo dicta la especificación técnica de la DIAN, no la preferencia del proyecto.**
Cambiarlo por gusto propio puede hacer que el archivo se rechace al radicarlo. Si hay que
cambiarlo, primero se lee la resolución vigente, y eso es un spec aparte.

### Las barras de progreso y los anchos de CSS

`MotorComparables.jsx` 1394, 1402, 1452, 1459 y 1847. Tres son valores `width:` de una hoja
de estilo, no texto que alguien lea como dato. Los otros dos son indicadores de progreso,
donde «Cargando 45,000 %» se lee como un defecto y no como precisión.

### Berry y Cost Plus en el Excel

Sus columnas usan `'0.0000'` **sin signo de porcentaje** porque son razones, no porcentajes:
un Berry de 1,25 no es «125 %». Se quedan con sus cuatro decimales.

### Las tablas macro

`tablasInforme.js:274` imprime el valor de las series macro tal como viene de la fuente
(`wrap(v)` = `String(v)`), sin pasar por ningún formateador. Se queda así. El FMI publica
«3,2 %» con un decimal, y escribir «3,200 %» atribuiría a la fuente una precisión que no dio,
en un documento que se radica ante la DIAN.

## Un defecto preexistente que este cambio hace más visible

No se arregla aquí, pero queda nombrado porque conviene decidirlo pronto.

`pctf` se aplica al indicador del estudio **sin mirar cuál es el método**, y `Berry` es uno de
los tres que el sistema ofrece (`PLIN` en `calculations.js:3`). El Índice de Berry es una
**razón** —utilidad bruta sobre gastos operativos, del orden de 1,25—, no una fracción. Así
que un estudio con `pli: 'Berry'` publica hoy «125,00 %» donde debería decir «1,2500», tanto
en el tablero (`MotorComparables.jsx:2015`) como en las tablas del informe
(`docxRelleno.js:441`) y en los marcadores (`plantillaVocabulario.js:142`).

Este diseño lo empeora en apariencia —pasará a decir «125,000 %»— pero no lo causa ni lo
agrava en el fondo. Arreglarlo exige decidir cómo se imprime cada método según su unidad, que
es un cambio de semántica y no de formato.

## Verificación

`npm test` al 100 %. La línea base es **1170** pruebas y no puede bajar.

Pruebas que entran con el cambio:

- `pctf` con tres decimales, coma y espacio: `pctf(0.04985)` → `'4,985 %'`.
- `pctf` conserva los tres decimales cuando el valor no los necesita: `pctf(0.05)` → `'5,000 %'`,
  que es lo que `minimumFractionDigits` garantiza y un `toFixed` mal puesto rompería.
- `pctf(null)`, `pctf(undefined)` y `pctf(NaN)` devuelven `'—'`. El último es la guarda nueva.
- Dos cifras que con dos decimales se imprimían iguales ahora se distinguen: `pctf(0.04985)`
  y `pctf(0.04984)` no son la misma cadena. Es la razón de ser del cambio y hay que fijarla.
- Los seis sitios enrutados devuelven exactamente lo que devuelve `pctf`, comparado contra
  `pctf` y no contra una cadena escrita a mano, para que no puedan divergir otra vez.
- Los sitios de `cruceComparables.js` y `MotorComparables.jsx:1975`: que el valor se
  multiplique por 100 **una sola vez**. Una prueba con un valor conocido —una coincidencia de
  `0.87` debe dar `'87,000 %'` y no `'8.700,000 %'`— cubre el error de dejar el `* 100` puesto
  al enrutar.
- El formato de celda del Excel es `'0.000%'` en los once sitios, y las celdas de Berry y
  Cost Plus **siguen** en `'0.0000'`: la prueba afirma las dos cosas, para que ampliar el
  cambio no se lleve por delante las razones.
- El Formato 1125 sigue emitiendo dos decimales. Es una prueba de que la exclusión se respetó,
  y la única del conjunto que protege algo que se radica ante la DIAN con formato ajeno.

Lo que las pruebas no alcanzan y queda como verificación manual: abrir el `.docx` generado y
comprobar que las tablas de rango, la Tabla 10 y el ANEXO A muestran «4,985 %» y no «4.98%»;
y abrir el `.xlsx` para ver los tres decimales en las celdas de porcentaje.
