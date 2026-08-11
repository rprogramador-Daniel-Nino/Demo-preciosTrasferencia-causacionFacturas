# Diseño — Una sola fuente para el libro de soporte y las tablas del informe

Fecha: 2026-08-11
Rama: `juandev`

## De dónde sale este diseño

Del libro `Soporte_Motor_Comparables_end_game_interactive_colombia_sociedad_por_acciones_simplificada_2025 (12).xlsx`,
descargado el 2026-08-11 para END GAME INTERACTIVE COLOMBIA S.A.S. (año gravable 2025).
Se descomprimió, se leyó su XML crudo hoja por hoja y se cotejó cada fórmula contra el
código que la emite y contra el motor que alimenta el `.docx`. Cada afirmación de la
sección siguiente está verificada contra ese archivo o contra el código.

El punto de partida fue la observación de que de ese libro salen los datos de las tablas
del informe. Es cierto para el bloque de comparables —el de mayor riesgo ante la DIAN— y
no para el resto; la cobertura real se documenta abajo.

## Estado verificado

### El libro no contiene ni un solo número calculado

`docProps/app.xml` declara `<Application>SheetJS</Application>`, y las celdas numéricas de
`Resumen`, `MO`, `MB`, `Berry`, `CostPlus` y `NCP` salen sin valor en caché:

```xml
<c r="C4" s="7"><f>MO!S24</f></c>
<c r="S20" s="7"><f>QUARTILE(S3:S18,1)</f></c>
```

Ningún `<v>`. Los únicos números literales del libro están en la hoja `Datos` —las 8 cifras
de la parte examinada en `B4:B11` y las 16 comparables en `A15:I30`— y en las hojas de
selección y rechazo. Todo lo demás existe únicamente cuando Excel abre el archivo y
recalcula.

Consecuencia práctica: cualquier lector que no recalcule —un visor, un convertidor a PDF,
`openpyxl` con `data_only=True`, la propia librería del sistema al releerlo— ve el libro
vacío. Y el número que el informe publica no es, en ningún momento, el mismo objeto que el
número que el libro publica: son dos cálculos que se parecen.

### Dos implementaciones de la misma matemática, sin nada que las coteje

`memoriaCalculoRangoOptimo.js` **no importa** `ajusteRangoCapitalTrabajo.js`. Lo cita en un
comentario (`memoriaCalculoRangoOptimo.js:20`, «La metodología de ajuste es la del parche
`ajusteRangoCapitalTrabajo.js`») y reexpresa esa metodología como cadenas de fórmula de
Excel. El único test de paridad que existe entre los dos módulos es el del vocabulario de
holdings (`TERMINOS_HOLDING_HOJA`), no el de los cálculos.

El informe, en cambio, sí pasa por el motor: `rangoIntercuartil.js:41` importa
`analizarRangoAjustado`, y de ahí salen `tablasInforme.js`, `plantillaVocabulario.js` y
`docxRelleno.js`.

### Un tercer camino, dentro del propio informe

`docxRelleno.js:568-576` calcula sus **propios** mínimo, máximo y cuartiles para la columna
«NO AJUSTADO»: filtra la serie, la ordena a mano y llama `cuartilInterpolado` directo. La
columna «AJUSTADO» sí toma `stats` del motor (`:584-586`). Media tabla por una vía y media
por otra.

### El motor sí cubre los cinco métodos del libro

`ajusteRangoCapitalTrabajo.js:70` define `BASES` para `MO`, `MB`, `Berry`, `NCP` y
`CostPlus`, con los denominadores depurados de NCP y Cost Plus incluidos (`:147-149`). La
limitación está en `pliOf` (`utils/calculations.js:152`), que solo conoce `MO`, `MB` y
`Berry` y es lo que se usa para el indicador del contribuyente.

No hace falta tocar `pliOf`: `indicadorAjustado(contribuyente, contribuyente, metodo,
'ninguno', tasa)` devuelve el indicador propio del contribuyente para cualquiera de los
cinco métodos, porque con `comp === contribuyente` los cuatro ratios de ajuste se anulan y
la rama `'ninguno'` (`:202-207`) devuelve `numBase / baseC`. Eso cubre las filas 24
(«Indicador del contribuyente») y 25 («Conclusión») de las cinco hojas de método.

### Qué tablas del informe puede alimentar el libro

El inventario real de `docxRelleno.js` son 8 tablas macro (`actualizarTablasMacroOoxml`) y
13 operativas (`actualizarTablasOperacionesOoxml`, una de ellas sustituida en dos
ocurrencias). De ellas, el libro alcanza:

| | Tablas |
|---|---|
| **Sí, y este diseño las unifica** | Rango Intercuartil horizontal (#5), Muestra de comparables (#11), Rango vertical / Tabla de rangos (#12), Margen Operacional Comparables (#13), y los campos `rango.*` de la prosa |
| **Con el Bloque 4** | Activos a 31 de diciembre / Tabla 10 (#9) y el ESF del ANEXO A |
| **Sí, pero sin auditar** | Razones de rechazo (#10). Ver la advertencia siguiente |
| **No** | Las 8 macro (vienen de `datosMacro`), operación y transacciones (#1–#4), composición accionaria (#6), vinculadas y criterios (#7–#8) |

**Advertencia sobre la tabla de razones de rechazo (#10).** Es el mismo dato en los dos
lados, pero por caminos que no se cotejaron al escribir este diseño y que pueden divergir
igual que divergió el rango: el informe lee los conteos ya hechos
(`filasRazonesRechazo(estudio.embudoSeleccion)`, con `porMotivo` y `reserva`), mientras que
el libro los **recuenta por fórmula** sobre las candidatas que le pasa
`motorExcelExport.js:66-74`, armadas de `filtros.selectionFunnel` y de
`auditoria.rechazadas`/`auditoria.reserva`. No se auditó si los siete motivos del embudo y
los que cuenta la hoja son el mismo conjunto ni si la reserva se suma igual en ambos.
Queda como trabajo siguiente con su propio spec, no dentro de este: afirmarlo aquí sin
haberlo verificado sería exactamente el error que este diseño corrige.

### Los seis sabores de ajuste coinciden; el universo del cuartil no

Se cotejó celda contra código para la hoja `MO`. Los seis sabores son idénticos:

| Columna | Fórmula del libro | Rama de `indicadorAjustado` |
|---|---|---|
| `T3` (CxC) | `(J3-N3)/R3`, con `R3=(B3-N3)` | `numBase - ajusteAR` sobre `baseAjustada` |
| `U3` (CxP) | `(J3+O3)/M3` | `numBase + ajusteAP` sobre `baseC` |
| `V3` (Inv) | `(J3-P3)/M3` | `numBase - ajusteINV` sobre `baseC` |
| `W3` (CxC+CxP+Inv) | `(J3-N3+O3-P3)/R3` | `numBase - ajusteAR + ajusteAP - ajusteINV` sobre `baseAjustada` |
| `X3` (+PP&E) | `(J3-N3+O3-P3-Q3)/R3` | idem menos `ajustePPE` |
| `Y3` (PP&E) | `(J3-Q3)/M3` | `numBase - ajustePPE` sobre `baseC` |

`QUARTILE` de Excel es `QUARTILE.INC`, que interpola igual que `cuartilInterpolado`
(`:231-240`). La fórmula del cuartil, por tanto, tampoco es el problema.

Lo que difiere es **sobre qué serie se aplica**:

| Divergencia | El libro | El motor del informe |
|---|---|---|
| **Universo del cuartil** | `QUARTILE(S3:S18,1)`: las 16 filas, siempre | solo las filas con `incluida`, que exige el ámbito `cmode` y valor finito (`:302`) |
| **Muestra insuficiente** | calcula igual con 1 o 2 comparables | `stats = null` si `serie.length < 3` (`:312`) |
| **Segmento excluido** | `Datos!B4` sale de `examinada?.T?.s ?? estudio?.t_s` (`motorExcelExport.js:35`), que puede venir ya descontado o no | descuenta `seg_excluido` de `t_s` siempre (`:276-281`) |

La primera es la grave. Un estudio con `cmode` en `intl` o `nac`, o con una comparable sin
cifras, publica **hoy** un rango en el libro calculado sobre un universo distinto del que
usó el informe, y nada lo advierte. Es un libro que se radica como soporte de un informe al
que no sustenta.

## Los cuatro bloques

El orden es el de implementación. El Bloque 1 y el Bloque 4 son independientes del resto y
pueden entregarse primero; el Bloque 3 depende de que el 1 y el 2 estén hechos.

### Bloque 1 — Un solo cuartil en el informe

`docxRelleno.js:568-576` deja de calcular su serie «NO AJUSTADO». La columna sale de
`analizarRangoAjustado(estudio, estudio.pli, 'ninguno')`, que es exactamente lo que el libro
publica en su columna `S`. Las dos mitades de la tabla pasan a venir del mismo sitio.

Con esto el informe queda con una sola fuente para el rango: las tablas del `.docx` y los
campos `rango.*` salen todos del motor. El libro sigue con la suya hasta el Bloque 3, que es
el que las une.

### Bloque 2 — Cerrar las tres divergencias

- **Universo del cuartil.** La hoja de método marca qué filas entran —por ámbito y por
  cifras completas— y `QUARTILE` se aplica sobre ese rango filtrado, no sobre `S3:S18`. El
  criterio es el de `entraPorAmbito` (`:245-247`), replicado como fórmula igual que ya se
  replicó el criterio de holding, y con el mismo test de paridad que recuerda mantenerlos
  juntos.
- **Muestra insuficiente.** La guarda de `serie.length < 3` se replica en la hoja: con menos
  de tres comparables incluidas, las celdas de estadística no publican un número. Un rango
  intercuartil sobre dos observaciones no es un rango, y el libro no debe insinuar que lo es.
- **Segmento excluido.** Una sola procedencia para `t_s`. `motorExcelExport.js:35` deja de
  elegir entre `examinada?.T?.s` y `estudio?.t_s`: recibe el estudio en bruto y descuenta
  `seg_excluido` él mismo, con el mismo criterio del motor —de las ventas y no de `t_op`,
  porque en el convenio del libro `t_op` son gastos, tal como razona
  `ajusteRangoCapitalTrabajo.js:271-276`—. Se descarta la variante de recibir la cifra ya
  descontada: es la que dejó abierta la ambigüedad, porque ningún llamador puede saber si
  quien le pasó el dato ya la aplicó.

### Bloque 3 — El valor en caché y la prueba de paridad

`memoriaCalculoRangoOptimo.js` pasa a emitir `{ t:'n', f:'…', v:<valor> }` en las celdas
numéricas derivadas. El valor lo pide al motor: `analizarRangoAjustado` una vez por método y
sabor —35 llamadas sobre ≤16 comparables, coste despreciable— y de ahí salen las columnas
`S`–`Y` de las filas de comparable y las filas 19 a 23 de estadística. La fila 24 y la 25
salen de `indicadorAjustado(contribuyente, contribuyente, …)` según lo verificado arriba.

El emisor no gana matemática propia. Sigue emitiendo la fórmula —que es lo que hace el libro
auditable y recalculable— y añade el número que el informe va a publicar. Consecuencias:

- El libro y el informe traen el mismo número por construcción, no por coincidencia.
- El `.xlsx` deja de verse vacío en cualquier lector que no recalcule.
- El recalculo de Excel se convierte en una auditoría de terceros sobre las fórmulas: si
  una fórmula y el motor discrepan, la celda cambia de valor al abrir el archivo y la
  discrepancia queda a la vista de quien lo revisa.

La prueba de paridad es la aserción directa: para un fixture dado, el `v` de cada celda del
libro es igual al valor que el motor entrega a la tabla del informe.

### Bloque 4 — La hoja `Datos` con el ESF completo

`Datos` pasa de 7 rubros a los 11 de `RUBROS_ESF` (`docxRelleno.js:1068`) más `t_ap`:
`t_cash`, `t_inv_assoc`, `t_ar`, `t_inv`, `t_tax`, `t_act_curr`, `t_ppe`, `t_intang`,
`t_dif`, `t_act_nocurr`, `t_act_tot`, `t_ap`.

Con `t_act_tot` en el libro, el análisis vertical pasa a ser **fórmula viva** —el rubro sobre
la celda del total de activos— en vez de un porcentaje ya calculado. `verticalSobreActivos`
(`docxRelleno.js:529`), que es la única definición compartida por la Tabla 10 y el ESF del
ANEXO A, se convierte en el valor en caché de esa misma celda. El libro pasa a sustentar la
Tabla 10 y el ANEXO A, no solo el rango.

**Riesgo que este bloque introduce, y su mitigación.** Insertar filas en `Datos` desplaza las
referencias absolutas que las cinco hojas de método ya usan: `Datos!$B$4` (ventas),
`$B$7` (CxC), `$B$8` (inventario), `$B$9` (CxP), `$B$10` (PP&E) y `$B$11` (tasa). Las
direcciones se calculan a partir del orden de los rubros y no se escriben a mano en ninguna
fórmula, y entra una prueba que afirma que las celdas de ajuste de cada hoja de método
siguen apuntando al rubro correcto después del cambio.

## Verificación

`npm test` al 100 % en verde por bloque. Hoy son 954 pruebas y no puede bajar. Cada defecto
de la sección «Estado verificado» entra con su prueba antes del arreglo:

- Fixture con el estudio de END GAME 2025 —16 comparables— y aserción celda por celda entre
  el `v` del libro y el valor que consume la tabla del informe, para los 5 métodos y los 7
  sabores.
- Un caso con `cmode: 'nac'` y otro con `cmode: 'intl'`: el cuartil del libro y el del
  informe coinciden.
- Un caso con una comparable sin cifras: no entra en ninguno de los dos.
- Un caso con 2 comparables incluidas: ni el libro ni el informe publican estadística.
- Un caso con `seg_excluido` distinto de cero: `Datos!B4` y el contribuyente del informe
  parten de la misma cifra.
- Un caso que afirma que las referencias de ajuste de cada hoja de método apuntan al rubro
  correcto tras ampliar `Datos`.

Lo que las pruebas no alcanzan y queda como verificación manual: abrir el `.xlsx` en Excel y
confirmar que el recalculo no mueve ninguna celda, y que Word abre el `.docx` resultante sin
quejarse. Es la misma limitación que ya documenta `docxRelleno.js`.

## Fuera de alcance

- Las 8 tablas macro, la operación y las transacciones, la composición accionaria y las
  compañías vinculadas: no existen en el libro y no entran por esta vía.
- Publicar en el informe las 35 combinaciones de sensibilidad que el libro calcula. Se
  consideró y se descartó: expone ante la DIAN los escenarios en que el contribuyente no
  cumpliría, y esa es una decisión de estrategia del informe, no de arquitectura.
- Reescribir el motor de comparables o el de rango, unificados en la Fase 0.
- `index.html`: no participa de esta ruta.
