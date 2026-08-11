# Tablas 1 y 2 de operaciones en la ruta HTML

**Fecha:** 2026-08-11
**Estado:** implementado e integrado con `origin/antoniodev` (1055 pruebas en verde, sin
errores de lint, build limpio)

## Problema

El Informe Local generado a partir de una plantilla **PDF** sale con la Tabla 1
(«Operaciones de Ingreso») y la Tabla 2 («Operación analizar») del informe del año
anterior, no con los datos ingeridos. Medido sobre los archivos de prueba del repo:

| | Excel 2025 (`parseExcelOperations`) | Lo que sale en el informe |
|---|---|---|
| Concepto | `VENTA SERVICIOS` | `Otros servicios (07)` |
| Monto | `3.433.542.684` | `3.435.357.400` |
| Vinculado | END GAME INTERACTIVE INC | igual |
| País | ESTADOS UNIDOS | igual |

Los valores publicados son los de `Archivos Prueba/estudio pasado.pdf` (el informe 2024),
verbatim. Es una fuga de datos del cliente anterior en un documento que se radica ante
la DIAN.

## Causa raíz, verificada

`zonasDelDocumento` (`frontend/src/services/plantillaMarcador.js:204`) decide la zona de
cada tramo con el texto de una **corrida** — el tramo de texto entre dos etiquetas
cualesquiera. La guarda que debe descartar las entradas del índice es
`RX_ENTRADA_INDICE = /\d\s*$/` (`:178`), y su comentario declara la premisa: «toda entrada
del índice sí [termina en dígito]».

**Esa premisa es falsa con el HTML que produce `pdfReferenceExtractor.js`.** La entrada del
índice sale así:

```html
<p><strong> ANEXO E. Legislación Colombiana en materia de Precios de Transferencia </strong><strong><span style="font-family:'Times New Roman'">83</span></strong></p>
```

El `83` vive en un `<span>` aparte, es decir en **otra corrida**. La corrida del título
termina en espacio, no en dígito, la guarda no dispara y `zonaQueAbre` abre zona `anexoE`
en el offset 12725 — dentro del índice. Los anexos no se cierran, así que esa zona se
arrastra hasta `I. INFORMACIÓN GENERAL` en el offset 31096.

Mapa de zonas real del PDF de referencia (301.139 caracteres de HTML extraído):

```
@  12725  anexoE   ← entrada del ÍNDICE «ANEXO E. Legislación Colombiana…»
@  31096  cuerpo   ← «I. INFORMACIÓN GENERAL»
```

Entre esos dos offsets está el resto del índice y **todo el RESUMEN EJECUTIVO**, donde
viven las Tablas 1, 2 y 3. Las seis celdas caen ahí:

| Celda | Offset | Zona |
|---|---|---|
| `Otros servicios (07)` | 25347 | **anexoE** |
| `END GAME INTERACTIVE INC` | 25384 | **anexoE** |
| `ESTADOS UNIDOS` | 25425 | **anexoE** |
| `3.435.357.400` | 25456 | **anexoE** |
| `Ingreso (07)` | 25873 | **anexoE** |

`anexoE` está en `ZONAS_PROHIBIDAS`, así que `motivoDeRechazo` (`:484`) bloquea toda marca
ahí — la que propone el modelo y la de la extensión. Las celdas nunca se marcan y sobreviven
con los datos de 2024. Es exactamente el fallo que ese comentario decía estar evitando.

El test que cubría esto (`plantillaMarcador.test.js:495`) pega el número al título en el
mismo nodo de texto (`…Estados Financieros55`), forma que el extractor no produce, y por eso
pasaba.

Esa entrada de índice concreta no lleva puntos guía —las demás sí—, así que una heurística
por puntos tampoco la atraparía.

## Dos huecos más, independientes de la zona

1. **El vocabulario no tiene campo para las celdas de la Tabla 2.** `Ingreso (07)` y
   `Otros servicios` no corresponden a ningún campo de `VOCABULARIO`
   (`plantillaVocabulario.js:32-74`). Aunque la zona se arregle, esas dos celdas no se
   pueden marcar.
2. **El `(07)` es inventado.** `'Otros servicios (07)'` está hardcodeado como valor por
   defecto en `excelOperationsParser.js:155,183,188,237`. En el Excel de referencia la
   columna `Cod` viene vacía y `Tipo de operación*` dice `VENTA SERVICIOS`, que no está
   entre los 63 nombres del catálogo oficial. El catálogo sí viaja en el Excel —filas 56-99
   de la misma hoja, `7 → Otros servicios`, `36 → Otros servicios` (egreso)— pero el parser
   hace `break` justo en esa fila (`:104`) y nunca lo lee.

## Enfoque elegido

Corregir la zona **y** regenerar las dos tablas determinísticamente, en vez de confiar en
que el modelo marque seis celdas. Es el mismo razonamiento por el que ya existe
`actualizarTablasOperacionesOoxml`: marcar tablas con un LLM es frágil. Aquí además
`Otros servicios` es subcadena de `Otros servicios (07)`, así que la primera se marcaría
dentro de la segunda y la segunda quedaría descartada por solape: el orden decidiría el
resultado.

Alternativas descartadas: (B) solo corregir la zona y añadir dos campos al vocabulario
—depende del modelo y del orden de las subcadenas—; (C) solo corregir la zona —el concepto
y toda la Tabla 2 se quedarían con los datos de 2024.

## Diseño

### 1. Corrección de zona — `plantillaMarcador.js`

`zonasDelDocumento` deja de iterar corridas y pasa a iterar **bloques**. Un bloque es el
texto entre dos etiquetas **no inline**; `span`, `strong`, `b`, `em`, `i`, `u`, `a`, `sub`,
`sup`, `br`, `small` y `font` no cortan. Así el texto del bloque de la entrada de índice es
`" ANEXO E. Legislación… 83"`, termina en dígito, y `RX_ENTRADA_INDICE` la descarta como se
diseñó.

`zonaQueAbre`, `RX_ANEXO`, `RX_MACRO`, `RX_CAPITULO`, `RX_CITA` y `RX_ENTRADA_INDICE` no
cambian: solo cambia el texto que se les pasa. Los tramos llevan los offsets del bloque, y
`zonaEnOffset` sigue funcionando porque los offsets de corrida caen dentro de su bloque.

### 2. Generador único de filas — nuevo `frontend/src/services/tablasOperaciones.js`

Saca de `docxRelleno.js:584-617` los datos, no el formato:

- `conceptoDeOperacion(estudio)` → `{ desc, cod }`, con `cod` **`null`** cuando no se puede
  resolver. Reemplaza a `extraerCodigoYDesc`, que devolvía `'07'` fijo.
- `filasOperacionesDeIngreso(estudio)` → título, encabezados, filas y fuente de la Tabla 1.
- `filasOperacionAnalizar(estudio)` → lo mismo para la Tabla 2.

`docxRelleno.js` los consume y sigue emitiendo OOXML con `generarTablaOoxml`. Una sola
definición de qué dice cada celda: así la ruta OOXML y la ruta HTML no pueden divergir.

### 3. Catálogo DIAN — nuevo `frontend/src/services/tiposOperacionDian.js`

Los 63 tipos con su código, tal como los lista el Excel (ingreso 1-29, egreso 30-58, otras
59-60, información adicional 61-63). Va en código y no se lee del Excel porque la generación
del informe lo necesita aunque el Excel no esté cargado en esa sesión. Lo importan el parser
y `conceptoDeOperacion`.

### 4. Sustituidor HTML — `actualizarTablasOperacionesHtml(html, estudio, avisos)`

Nuevo `frontend/src/services/tablasOperacionesHtml.js`. Localiza
`<p><strong> Tabla N. <nombre></strong></p>` seguido de `<table>`, con respaldo por fila de
encabezados, reusando `claveTitulo` y `numeroDeTabla` de `docxRelleno.js` (ya exportadas y
agnósticas del formato). Reemplaza **solo las filas de datos** y conserva la fila de
encabezados de la plantilla. Emite `<tr><th><p>…</p></th><td><p>…</p></td></tr>`, que es la
forma que trae la plantilla y la que `docxWriter.js:260-296` sabe convertir, y envuelve cada
valor con `resaltarValor` para que el previo lo muestre como sustituido.

Se engancha en `ReporteGenerador.jsx:288`, dentro de `renderizarYAvisar`, **después** de
`renderizar()`: así pisa también lo que el marcado haya acertado a medias en esas tablas.
Las tablas que no aparezcan se acumulan en un arreglo que alimenta el banner que ya existe.

### 5. Parser — `excelOperationsParser.js`

Se quitan los cuatro `'Otros servicios (07)'`. Cuando la columna `Cod` está diligenciada,
`vinc_tipo` se compone como `<texto> (<cod a dos dígitos>)`, de modo que el parseo de `(NN)`
que ya existe lo recoge sin añadir ningún campo nuevo al estudio. Sin `Cod` y sin
coincidencia en el catálogo, `vinc_tipo` queda como el texto crudo del Excel y la Tabla 2
sale `Ingreso (—)` con aviso.

### 5 bis. La Tabla 4 compartía el defecto (hallado al implementar)

`extraerCodigoYDesc` no lo usaban solo las Tablas 1 y 2: la Tabla 4 («Método de Precios de
Transferencia Aplicable», `docxRelleno.js`) publica el código de operación en su propia
columna «Código de Operación» y salía con el mismo `07` inventado. Pasa a resolverlo con
`conceptoDeOperacion`, y sin código publica «—».

Lo delató `npm run lint`, no las pruebas: al borrar el helper quedó una referencia viva que
ninguna prueba cubría, así que esa ruta habría lanzado `ReferenceError` en tiempo de
ejecución. Se le añadió prueba.

### 6. Manejo de ausencias

- Tabla que no aparece en la plantilla → aviso, y la tabla conserva lo que traía (el banner
  ya existente lo dice).
- Código no resoluble → `Ingreso (—)` y aviso nombrando el texto que no se pudo mapear.
- Estudio sin `vinc_tipo` / `vinc` / monto → celdas en `—`, nunca heredar.

### 7. Pruebas

- `plantillaMarcador.test.js`: la entrada de índice con el número en `<span>` aparte no abre
  zona; el `<h1>` real del anexo sí; un offset del RESUMEN EJECUTIVO posterior al índice es
  `cuerpo`.
- Nuevos `tablasOperaciones.test.js` y `tiposOperacionDian.test.js`.
- Nuevo `tablasOperacionesHtml.test.js`: localización por rótulo, por número, ausencia →
  aviso, y forma `td`/`th` que `docxWriter` sabe leer.
- `excelOperationsParser.test.js`: sin `(07)` fingido; `Cod` diligenciada compone el código.
- `npm test` al 100 %.

## Cómo quedó tras integrar con `origin/antoniodev`

`pablo-barreto` construyó en paralelo el mismo mecanismo: `tablasHtmlInforme.js`, con la
misma arquitectura y los mismos nombres (`textoPlanoHtml`, `localizarTablaHtml`,
`reescribirFilasHtml`), para la tabla de márgenes, las cuatro del motor y las ocho de
macroeconomía. Lo detectó `/revisar-ramas-equipo` al cerrar, no al empezar: cuando se corrió
al arrancar, esos commits todavía no estaban publicados.

Se resolvió plegando estas dos tablas a **su** motor, no dejando los dos conviviendo:

- `tablasOperacionesHtml.js` pierde su localizador —duplicaba el suyo— y usa
  `localizarTablaHtml` y `reescribirFilasHtml`. Con eso gana lo que su versión hace mejor:
  copia etiqueta, atributos y envoltura de énfasis de la fila molde de la plantilla, así que
  conserva el formato del cliente en vez de imponer un `<th><p><span class="pt-valor">`. Y
  localiza por nombre y no por número del rótulo (criterio del usuario, 2026-08-11).
- Las dos tablas se registran dentro de `renderizar()` en `plantillaRenderer.js`, junto a los
  otros dos motores y compartiendo su arreglo `avisosTablas`. El enganche en
  `ReporteGenerador.jsx` que describe el punto 4 sobra: su banner ya reporta por un solo canal
  las tablas que la plantilla no trae.
- `docxRelleno.js` toma su versión del rango, que unifica el cálculo en `tablasInforme.js`.

El resto se conserva entero porque no se solapa: la corrección de zona —que su trabajo
también necesitaba, porque el RESUMEN EJECUTIVO estaba bloqueado para ellos igual—,
`tablasOperaciones.js` y `tiposOperacionDian.js`.

## Fuera de alcance

La corrección de zona también destraba la **Tabla 3** y el resto del RESUMEN EJECUTIVO, que
hoy se radican con los datos de 2024 por la misma causa. No se regenera la Tabla 3: pasará a
sustituirse por marcado como el resto del cuerpo.

El estudio guarda un solo vinculado y un solo tipo de operación, así que la Tabla 1 sigue
saliendo con una fila. `parseExcelOperations` ya avisa cuando el Excel trae varias
contrapartes.
