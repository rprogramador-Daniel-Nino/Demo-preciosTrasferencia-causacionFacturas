# Diseño — Ingesta de estados financieros verificada

Fecha: 2026-08-21
Rama: `antoniodev`

## De dónde sale este diseño

Del PDF `1.2 EEFF Montachem - 2025.pdf` (MONTACHEM INTERNATIONAL S.A., NIT 900.213.910-7,
cuatro páginas, con capa de texto) y de la hoja `DATOS DE ENTRADA` del libro que produjo
al cargarlo en el paso de estados financieros. Se leyó el documento completo y se cotejó
cada cifra contra el código que la emite. Cada afirmación de la sección siguiente está
verificada contra ese archivo o contra el código; las aritméticas están comprobadas al
peso.

El síntoma reportado fue «no está tomando todos los datos del formato que se carga, salen
datos en 0 en el Excel». Resultaron ser seis defectos independientes, y **tres de ellos no
tienen nada que ver con la lectura por IA**.

## Estado verificado

### Lo que salió, y lo que dice el documento

| Rubro (hoja `Datos`) | Salió | El PDF, columna 2025 |
|---|---|---|
| Ventas netas | 23.741.367.744 | igual |
| Costo de ventas | −21.850.187.494 | igual (pero envenena el motor, D1) |
| Gastos operativos | 4.877.416.281 | 2.986.236.031 |
| Efectivo y equivalentes | 0,00 | 337.546.138 |
| Inversiones asociadas | 0,00 | no reportado (`ACTIVOS FINANCIEROS` 20.005.897 sin asignar) |
| CxC comerciales y otras | 6.032.337.879 | igual (queda fuera `CxC A PARTES RELACIONADAS` 2.926.256.259) |
| Inventarios | 4.734.795.891 | igual |
| Activos por impuestos corrientes | 0,00 | no reportado (el diferido 907.195.040 es no corriente) |
| Total, Activo corriente | 0,00 | 14.050.942.064 |
| Propiedades, planta y equipo | 0,00 | 0 — correcto por casualidad (`EQUIPO NETO` = 49.408.567 − 49.408.567) |
| Intangibles | 0,00 | no reportado |
| Diferidos | 0,00 | 45.975.242 (`GASTOS PAGADOS POR ANTICIPADO`) |
| Total, Activos no corrientes | 0,00 | 953.170.282 |
| Total, Activos | 0,00 | 15.004.112.346 |
| Cuentas por pagar comerciales | 44.177.669 | **esa cifra no existe en ninguna página** |

### D1 — El signo del costo desbocaba todo el motor

`eeffParser.js` ordenaba devolver el costo con el signo impreso, y el motor lo esperaba
positivo: `cifras()` calculaba `gp = s − c` (`ajusteRangoCapitalTrabajo.js:94`) y `pliEbit`
`s − c − op` (`:105-108`); `pliOf` lo mismo para MB y Berry
(`utils/calculations.js:168-184`). Con `t_c = −21.850.187.494` la utilidad bruta salía
45.591.555.238 en vez de 1.891.180.250 y el margen operacional 171 %. Nadie normalizaba el
signo: `normalizarEeff` hacía `c: num(d.costo_ventas)`, y solo la tercera rama de
`gastosOperativosDe` usaba `Math.abs` — inconsistencia dentro del mismo archivo.

**Afecta a cualquier cliente**: los estados de resultados colombianos imprimen el costo
entre paréntesis o con menos casi sin excepción.

### D2 — Una fila mal rotulada decidía la utilidad operacional, sin nada que la cotejara

En este PDF `RESULTADO DE ACTIVIDADES DE LA OPERACIÓN` (−2.986.236.031) **no** es la
utilidad operacional: es el total de los gastos operativos netos. El propio documento lo
demuestra:

```
utilidad bruta             1.891.180.250
− esa fila                −2.986.236.031
+ costos financieros netos   −71.162.144
= utilidad antes de imp.  −1.166.217.925   ← la que el estado imprime
```

La utilidad operacional real es **−1.095.055.781**. `EEFF_PROMPT` no pedía utilidad bruta,
gastos operativos, utilidad antes de impuestos, pasivos ni patrimonio, así que ninguna
identidad podía desmentir el rótulo. `gastosOperativosDe` caía a su tercera rama y emitía
`(23.741.367.744 − 21.850.187.494) − (−2.986.236.031) = 4.877.416.281`: el número de la
captura, inflado exactamente en la utilidad bruta.

`verifyAccountingEqualities` existía desde el principio pero **solo corría para
comparables**. La parte examinada no se verificaba nunca.

### D3 — Los ocho rubros del ESF no llegaban al libro por la ruta del Motor

`MotorComparables.jsx` armaba `T` con siete campos y `datos.estudio` con seis, ninguno
`t_*`. `motorExcelExport.js` los buscaba en los dos sitios, recibía `undefined`, y
`memoriaCalculoRangoOptimo.js:239-241` escribía `0`. **Esta causa sola explica los nueve
ceros aunque la lectura fuera perfecta.** El test que la cubría
(`motorExcelExport.test.js`) pasaba `examinada.T.cash`, una forma que el componente no
producía nunca: verde sobre una ruta inexistente. Por el mismo camino, `cmode` tampoco
viajaba, así que el libro cuartilaba sobre un universo distinto del del informe. La ruta
del modal sí lo transportaba todo: dos libros del mismo estudio diferían.

### D4 — `extractVal` descartaba en silencio todo lo que no fuera `number`

Exigía `typeof obj.valor === 'number'`. Con `{"valor": "337.546.138"}` o el número plano,
el rubro se perdía sin aviso y la celda quedaba en 0. La ruta de comparables no tenía el
problema porque pasaba el valor crudo y `num()` lo rescataba después.

### D5 — El vocabulario del prompt era el de un solo cliente

Citaba «Fiducuenta», «Licencias» y «Anticipos de impuestos», y no contemplaba
`DEUDORES COMERCIALES Y OTRAS CUENTAS POR COBRAR`, `ACTIVOS FINANCIEROS`, `GASTOS PAGADOS
POR ANTICIPADO`, `ACTIVOS POR IMPUESTO DIFERIDO`, `EQUIPO` + `DEPRECIACION ACUMULADA`,
`CUENTAS POR PAGAR A PARTES RELACIONADAS`. Tampoco pedía la columna del año del estudio:
decía «del ejercicio más reciente que aparezca», y el documento es comparativo a dos años.

### D6 — Sin red de seguridad manual

`estudioEnBlanco()` no declaraba `t_ppe` ni los ocho rubros del ESF, e `IngestaCifras.jsx`
no ofrecía casilla para ninguno de los ocho: si la lectura falla, la única vía era editar
el Excel.

## Decisiones tomadas

| Decisión | Elegido | Descartado | Por qué |
|---|---|---|---|
| Signo del costo | Conservarlo en `t_c` y aplicar la magnitud en el motor y en las fórmulas (`ABS`) | Guardar `t_c` en positivo | La hoja del libro y el ANEXO A se leen igual que el estado radicado. Con `ABS` en la fórmula, el recálculo de Excel también audita el convenio. |
| Dónde se normaliza el egreso | Un helper único, `egreso()`, junto a `num()` | `Math.abs` en cada punto de cálculo | Ocho sitios que pueden desincronizarse contra uno que se prueba. Se aplica solo a costo y gastos: la utilidad operacional conserva su signo, porque una pérdida es real. |
| Identidades que no cuadran | Corregir el rubro despejable y dejar constancia en pantalla y en el libro | Solo advertir | Petición explícita del usuario. La constancia no es opcional: una corrección sin rastro hace que el analista firme una cifra que no leyó. |
| De dónde sale la utilidad operacional | `utilidad antes de impuestos − resultado financiero neto`, y si no, `utilidad bruta − gastos` | La fila rotulada | Los dos términos de la primera son cifras acumuladas que el estado imprime abajo, y no dependen de qué filas de gasto reconoció la lectura. Es la que resuelve el rótulo engañoso. |
| Anti-alucinación | Comprobar que cada cifra esté impresa en la capa de texto del PDF | Confiar en el prompt | Es mecánico y determinista. Habría frenado el 44.177.669 sin depender de que el modelo obedezca. |
| Escala en miles o millones | Advertir, no reescalar | Multiplicar al vuelo | El ANEXO A adjunta las páginas del propio PDF: reescalar dejaría el texto del informe diciendo una cifra y su anexo mostrando otra. Primer consumidor de `unidad_origen`, que se pedía sin que nadie la leyera. |
| Qué explica un faltante de subtotal | El subconjunto de rubros sin asignar cuya suma da exactamente el faltante | Listar todos los sin asignar | Listarlos todos metía cuentas por pagar en el aviso de un subtotal del activo. Un aviso ruidoso deja de leerse. |

## Lo que quedó construido

| Archivo | Papel |
|---|---|
| `utils/calculations.js` | `egreso()`, la frontera única entre el signo del documento y el convenio del cálculo. Aplicado en `pliOf` y `ratios`. |
| `services/ajusteRangoCapitalTrabajo.js` | `cifras()` y `pliEbit` pasan costo y gastos por `egreso`. |
| `services/memoriaCalculoRangoOptimo.js` | `ABS` en las referencias de fórmula al costo y a los gastos, del contribuyente y de cada comparable. `CLAVES_RUBROS_EXAMINADA` exportada. Nueva sección «5) CIFRAS CORREGIDAS» en la hoja de diagnóstico. |
| `services/motorExcelExport.js` | `construirPayloadSoporte()`, función pura: el payload se deriva de `CLAVES_RUBROS_EXAMINADA` y del estudio en bruto. `estudioBase` invierte la precedencia (el estudio manda, `T` es respaldo), con lo que el segmento excluido deja de descontarse dos veces. |
| `services/eeffTextoPdf.js` (nuevo) | La capa de texto del PDF y las cifras que contiene, para la comprobación de presencia literal. |
| `services/eeffVerificacion.js` (nuevo) | Las identidades, la corrección automática con constancia y las advertencias. Puro. |
| `services/eeffParser.js` | `EEFF_PROMPT` reescrito; `promptEeffContribuyente(anio)`; el mapeo por `num()` y `CAMPO_POR_RUBRO`. |
| `components/IngestaCifras.jsx` | Las doce casillas del balance con las etiquetas del libro, el cotejo de subtotales en vivo y el panel de correcciones y advertencias. |
| `App.jsx` | `estudioEnBlanco()` declara los quince rubros. |

## Verificación

`npm test` en verde: **1906 pruebas** (partía de 1833). `npm run lint --prefix frontend`
sin errores y sin warnings nuevos (29, dos menos que antes). `npm run build` compila.

Cada defecto entró con su prueba:

- `calculations.test.js`, `ajusteRangoCapitalTrabajo.test.js`: MB, Berry, EBIT, `apC` y el
  rango completo dan lo mismo con el costo en −21.850.187.494 que en positivo; y una
  pérdida operativa sigue siendo negativa.
- `memoriaCalculoRangoOptimo.test.js`: las fórmulas llevan `ABS`; con el costo negativo del
  documento, la utilidad bruta de la comparable es `ventas − costo` y no `ventas + costo`.
- `paridadLibroInforme.test.js`: el evaluador de fórmulas aprendió `ABS` para no perder de
  vista las 35 celdas del indicador del contribuyente, y la paridad libro↔informe se
  mantiene.
- `motorExcelExport.test.js`: los quince rubros, el `cmode` y las correcciones llegan
  partiendo del estudio crudo — la ruta que el componente sí produce.
- `eeffVerificacion.test.js`: 25 pruebas sobre el fixture de Montachem 2025. La utilidad
  operacional corregida es −1.095.055.781, los gastos 2.986.236.031, el faltante del activo
  corriente 2.946.262.156 atribuido a sus dos rubros exactos, y el 44.177.669 rechazado.
- `eeffTextoPdf.test.js`: la agrupación en líneas, las dos convenciones de separador y la
  degradación limpia ante un escaneo.
- `eeffParser.test.js`: el prompt pide los rubros de cotejo, el rótulo, los rubros sin
  asignar y la columna del año; el mapeo acepta objeto, número plano y cadena colombiana.

**Ensayo contra el documento real**, fuera de la suite: se extrajo la capa de texto del PDF
de Montachem (4 páginas, 8.228 caracteres, 143 cifras reconocidas), se le pasó la lectura
con sus dos errores originales y se emitió el libro. La hoja `DATOS DE ENTRADA` sale con los
quince rubros, los gastos operativos en 2.986.236.031 y la cuenta por pagar inventada
descartada con su aviso.

Lo que las pruebas no alcanzan y queda como verificación manual en el navegador: la lectura
real contra la API (aquí se ensayó con la lectura simulada), el formulario —
`frontend/src/components/` no entra en `npm test` — y abrir el `.xlsx` en Excel para
confirmar que el recálculo no mueve ninguna celda.

## Fuera de alcance

- Reescalar los estados en miles o millones: se advierte y decide el analista.
- Decidir si las cuentas con partes relacionadas entran en el ajuste de capital de trabajo:
  se muestran como rubros sin asignar con su cifra.
- Los prompts de comparables (`EEFF_COMPARABLE_PROMPT`, `EEFF_COMPARABLES_LOTE_PROMPT`) y
  su ruta: no tenían el defecto del `extractVal` ni el del vocabulario de un cliente, y
  Juan trabajó sobre el ANEXO B de comparables el 2026-08-20.
- Los tres backends: los EEFF no tienen endpoint propio, van por el proxy genérico
  `/api/gemini`, así que este cambio es solo de cliente.

---

# Anexo — Justificación de todo el cuerpo del informe

Petición del mismo día: «todo el texto del informe justificado, TODO EL INFORME».

## Estado verificado

De las tres vías por las que sale texto, **dos ya justificaban** y una no:

| Vía | Antes | Cómo se comprobó |
|---|---|---|
| HTML de pantalla y del `.doc` | Sí — `estiloDocumento.js:148`, `p,li{text-align:justify}` | `estiloDocumento.test.js:373` |
| HTML → `.docx` real (`docxWriter.js`) | Sí — `AlignmentType.JUSTIFIED` por defecto en `parrafoDe` y `bloquesDe` | `docxWriter.test.js:88` |
| Plantilla `.docx` del cliente (`rellenarDocx`) | **No** — los párrafos salen con la alineación que traiga la plantilla | medido sobre las dos plantillas del repo |

La medición, fuera de tablas, es la que fija el problema y demuestra que no basta con mirar
el párrafo ni con mirar el estilo:

| Plantilla | `both` | sin `w:jc` | `center` | `left` | estilo `Normal` |
|---|---|---|---|---|---|
| Informe Local END GAME 2024 | 928 | 339 | 35 | 0 | sin `jc` → esos 339 salían a la izquierda |
| Informe local MC INTERNACIONAL 2024 | 0 | 1.361 | 35 | 30 | `jc=both` → los 30 explícitos salían a la izquierda |

Los dos defectos son reales y de causa distinta: uno por ausencia de declaración con un
estilo que tampoco la aporta, otro por un `left` escrito a mano que gana al estilo.

## Decisiones

| Decisión | Elegido | Por qué |
|---|---|---|
| Cómo se justifica | `w:jc="both"` EXPLÍCITO en cada párrafo de cuerpo | Idempotente, y no obliga a resolver la cadena de herencia de estilos de cada plantilla — que es lo que hace que el mismo código acierte en una y falle en otra. |
| Cuándo se aplica | Sobre el XML de la plantilla, antes de todo relleno | La justificación normaliza la PLANTILLA; los párrafos que el generador inserta después traen formato deliberado (pies «FUENTE:» a la izquierda, títulos de tabla e imágenes centrados). Al ir antes, ese formato manda sobre ella en lugar de ser barrido. |
| Índice | No se toca | Sus párrafos llevan tabuladores de relleno y un campo PAGEREF; justificarlos separa el título de sus puntos y descuadra la columna de números de página. |
| Títulos | No se tocan | Se reconocen por el `w:outlineLvl` de su estilo, que es el dato con el que Word los identifica y por eso independiente de que la plantilla los llame `Ttulo1`, `Heading1` o `T1XMAY`. |
| `center` y `right` | Se respetan | Portada, pies de tabla, firmas e imágenes. Una alineación explícita distinta de la izquierda es decisión de quien hizo la plantilla. |
| Tablas | Se respetan (centradas) | Decisión del usuario del 2026-08-19, ya vigente en las dos rutas. |
| Detección del índice | Campo PAGEREF **y** nombre interno «toc N» | El `w:styleId` cambia con el idioma de Word (TDC1 / TOC1); el `w:name` es siempre «toc N». |

## Resultado, medido

| Plantilla | Párrafos justificados | Quedan sin justificar | Qué son |
|---|---|---|---|
| END GAME 2024 | 239 | 98 | 89 entradas de índice + 9 títulos |
| MC INTERNACIONAL 2024 | 1.299 | 91 | 82 entradas de índice + 9 títulos |

**Ni un solo párrafo de prosa queda sin justificar en ninguna de las dos**, y no queda
ningún párrafo de más de 150 caracteres fuera del índice. Comprobado además que el XML
sigue bien formado, que ningún `w:jc` queda fuera del orden que exige la secuencia CT_PPr
—un `w:jc` detrás del `w:rPr` o del `w:sectPr` hace que Word abra el archivo con el aviso
de contenido ilegible—, que el número de párrafos no cambia, que el texto es idéntico y
que las tablas salen byte a byte iguales.

## Lo construido

- `services/justificarOoxml.js` (nuevo): `justificarCuerpoOoxml(documentXml, stylesXml)` y
  `estilosNoJustificables(stylesXml)`. Puro, sin dependencias.
- `services/docxRelleno.js`: la pasada se aplica en `renderizarDocx`, sobre el XML recién
  leído de la plantilla y antes de `actualizarApartadosMacroOoxml`.
- `services/justificarOoxml.test.js`: 31 pruebas — 23 sobre casos aislados (cada regla, el
  orden del esquema, la idempotencia, las tablas anidadas) y 8 sobre las dos plantillas
  reales, con `skip` si el archivo no está en el clon, igual que
  `comparablesEngine.test.js` con el export de Capital IQ.

`npm test` en verde: 1938 pruebas. Lint sin errores ni warnings nuevos. Build compila.

## Fuera de alcance

- La vista previa de la ruta `.docx` en pantalla, que pasa el resultado por mammoth y
  descarta el formato (ya documentado en `ReporteGenerador.jsx`): el `.docx` descargado sí
  sale justificado, la previa no lo refleja porque no refleja ningún formato.
- Los encabezados y pies de página del documento (`header*.xml`, `footer*.xml`): no son
  texto del informe.
