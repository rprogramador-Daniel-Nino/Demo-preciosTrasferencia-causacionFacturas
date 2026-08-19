# Operación adicional: la sección «4. INFORMACIÓN ADICIONAL» del Excel de operaciones

**Fecha:** 2026-08-19
**Estado:** diseño aprobado, pendiente de plan de implementación

## Problema

El Excel de Operaciones PT trae cuatro secciones por hoja. El motor de ingesta
(`frontend/src/services/excelOperationsParser.js`) lee las dos primeras —ingresos y
egresos—, reconoce la tercera solo para no contaminar el conteo de egresos (`:131`), y
**no reconoce la cuarta en absoluto**. La sección 4 son las operaciones que no afectan el
estado de resultados: préstamos (código 61), reintegros o reembolsos de gastos (62) y
operaciones efectuadas a nombre de vinculados (63), los tres únicos tipos de clase
`adicional` del catálogo (`tiposOperacionDian.js:89-91`).

Medido sobre `Downloads/Informacion Operaciones PT 2025-1 (1).xlsx`, hoja
`Op. Vinculados Economicos`:

| Sección | Fila | Vinculado | Tipo de operación | Cod | Monto |
|---|---|---|---|---|---|
| 1. OPERACIONES DE INGRESO | — | *(vacía)* | | | |
| 2. OPERACIONES DE EGRESO | 34 | MONTACHEM INTERNATIONAL INC | Compra neta de inventarios para distribución | 31 | 18.836.847.464 |
| 3. OTRAS OPERACIONES | — | *(vacía)* | | | |
| 4. INFORMACIÓN ADICIONAL | 93 | MONTACHEM INTERNATIONAL INC | Reintegros o reembolsos de gastos con vinculados que no fueron reflejados en el Estado de Resultados | 62 | 14.516.485.850 |

Los 14.516.485.850 de la fila 93 hoy no salen a ninguna parte: ni al estudio, ni a la
previsualización del paso 2, ni al informe. Superan los 45.000 UVT del año gravable
(45.000 × 49.799 = 2.240.955.000), así que son una operación que hay que documentar.

El informe del cliente la publica en una tabla que el sistema tampoco conoce:

```
Tabla 4. Operación adicional Transacciones Intercompañía
+-----------------------------------+--------------------------------------------------+
|              Compañía vinculada                                                      |
+-----------------------------------+--------------------------------------------------+
| Razón social                      | MONTACHEM INTERNATIONAL INC                      |
| Identificación fiscal             | 760575817                                        |
| País - Residencia fiscal          | EEUU                                             |
| Tipo de vinculación               | Articulo 260-1 numeral 2                         |
| Tipo de operaciones               | Compra neta de inventarios para distribución (31)|
| (Información adicional)           |                                                  |
| Monto en pesos                    | 18.836.847.464                                   |
+-----------------------------------+--------------------------------------------------+
```

**Ese ejemplar está mal llenado y no se toma como referencia de contenido.** El tipo
(`31`, «Compra neta de inventarios para distribución») y el monto (18.836.847.464) son los
de la sección 2, no los de la sección 4; el código 31 es de egreso y no existe en la clase
`adicional`. Quien armó el informe copió la Tabla 3 y solo cambió el rótulo —lo confirma
que el `Tipo de vinculación` también quedó en «Articulo 260-1 numeral 2» frente al «Art
260-1 E-T Inciso 1» de la Tabla 3. **Se toma como referencia su ESTRUCTURA** (las mismas
seis filas de la Tabla 3, con la etiqueta «Tipo de operaciones (Información adicional)») y
se llena con la sección 4.

## Alcance

Lo que entra:

1. El motor lee la sección 4 y devuelve su agregado.
2. El umbral de 45.000 UVT, derivado del año gravable, en un servicio propio.
3. El estudio guarda la operación adicional en campos planos propios.
4. El paso 2 previsualiza esos datos, con el monto de operación y el veredicto del umbral.
5. La tabla «Operación adicional Transacciones Intercompañía» se regenera en las dos rutas
   del informe (.docx y HTML de plantilla), o se elimina si no hay nada declarable.

Lo que NO entra, por decisión explícita:

- **Renumerar las tablas siguientes cuando la Tabla 4 se elimina.** La numeración del
  informe la fija la plantilla y el sistema la conserva tal cual
  (`docxRelleno.js:1337-1342`), porque no es fiable entre informes (`:563-567`). Al borrar
  la tabla, las demás mantienen el número que traían; el hueco se avisa y se corrige a
  mano si molesta. Renumerar exigiría reescribir el prefijo de cada tabla posterior, la
  Tabla de Contenido y las referencias en prosa, en contra del criterio vigente.
- **Una tabla por cada tipo de operación adicional.** La sección 4 se resuelve en una sola
  tabla: se suman todos sus montos y se declara el tipo dominante, con aviso cuando hay más
  de un tipo o más de una contraparte. Es el mismo criterio que el motor ya aplica a la
  operación principal (`excelOperationsParser.js:224-243`).
- **Tocar `monto` / `monto_operacion` del estudio.** La operación principal no cambia.
- **Insertar la tabla cuando la plantilla no la trae.** Se avisa por el canal existente.

## Diseño

### 1. Motor — índices de columna por sección

Hoy los índices se calculan **una vez por hoja** (`excelOperationsParser.js:88-104`), desde
la única fila de cabecera que se busca en las 25 primeras filas (`:68-87`). Las cuatro
secciones tienen cabeceras distintas: en el archivo de referencia
`Monto operación (valor en pesos)` está en el índice 11 en la sección 1 y
`Monto operación 2025` en el índice 12 en las secciones 3 y 4, que además traen
`Movimiento Débito 2025` (7), `Movimiento crédito 2025` (9) y `Saldo 2025` (11).

Leer la sección 4 con los índices de la sección 1 tomaría `Saldo 2025` por monto
—2.926.256.260 en vez de 14.516.485.850—, que es un número plausible y por eso peligroso.

**Cambio:** los índices se redetectan dentro del recorrido de filas cada vez que una fila
*es* una fila de cabecera (contiene `identificaci` y `vinculado`). La detección inicial de
`:68-87` se conserva como arranque. Esto corrige de paso la sección 3, que hoy se recorre
con índices ajenos.

La regla de detección de columna se mantiene igual: `includes('monto')` toma
`Monto operación 2025` en el índice 12 y no `Movimiento Débito 2025`, que no contiene
«monto».

### 2. Motor — la sección `ADICIONAL`

`currentSeccion` (`:118`) gana un cuarto valor. La marca se reconoce sin tildes sobre
`rowJoined`, que ya está en mayúsculas (`:125`): `INFORMACION ADICIONAL` tras normalizar
NFD, porque el archivo escribe «INFORMACIÓN ADICIONAL» con tilde y `rowJoined` no la
quita.

Sus filas se acumulan en `candidatasAdicional` y pasan por el mismo filtro de columna `Cod`
calibrado por hoja que ya usan ingresos y egresos (`:198-206`): el filtro solo se aplica si
alguna fila de esa sección trae código. En el archivo de referencia la fila 93 trae `62`,
así que no descarta nada.

El retorno de `parseExcelOperations` (`:281`) gana un campo:

```js
adicional: {
  vinc, vinc_id, pais_vinc,   // primer valor no vacío de la sección
  tipo,                        // dominante por monto, vía tipoConCodigo
  monto,                       // suma de todas las filas
  filas,                       // cuántas filas sumaron
  contrapartes,                // NITs (o razones sociales) distintos
  tipos                        // tipos distintos
}
```

`null` cuando la sección no existe o no suma nada. El país se traduce con la misma tabla
`PAIS_DIAN` que la operación principal (`:255-268`), no con una segunda copia de esa
lógica.

Los egresos ya descartados no cambian: la sección 4 no es un egreso y no entra en
`egresosDescartados`.

### 3. Umbral — `frontend/src/services/umbralDocumentacion.js` (nuevo)

```js
export const UVT_UMBRAL_OPERACION = 45000;
export function umbralOperacion(anio) { return UVT_UMBRAL_OPERACION * getUvtValue(anio); }
export function superaUmbral(monto, anio) { /* estricto: > umbral */ }
```

`getUvtValue` ya existe en `frontend/src/utils/calculations.js:16-19` con la tabla
`UVT_VALUES` (`:9-14`): 2025 → 49.799, y 45.000 × 49.799 = 2.240.955.000 exacto.

El número **no se escribe como constante**. En 2026 el UVT es 52.300 y el umbral
2.353.500.000; una constante fija haría que el estudio de 2026 midiera contra el umbral de
2025 sin que nadie lo note.

Servicio propio y no una función más en `calculations.js` porque es una regla normativa
—art. 260-5 E.T. y art. 1.2.2.3.2 del Decreto 2120— y no una cuenta: quien la busque la
encuentra por el nombre del archivo.

### 4. Modelo del estudio

Campos planos, como el resto del modelo (`vinc`, `vinc_id`, `pais_vinc`, `vinc_tipo`):

| Campo | Contenido |
|---|---|
| `adic_vinc` | razón social de la contraparte de la sección 4 |
| `adic_vinc_id` | identificación fiscal |
| `adic_pais` | país de residencia fiscal, ya traducido |
| `adic_tipo` | tipo dominante con su código, p. ej. `Reintegros o reembolsos … (62)` |
| `adic_monto` | suma de la sección 4 |
| `adic_tipo_vinculacion` | «Articulo 260-1 numeral 2» por omisión, editable |

`adic_tipo_vinculacion` lleva valor por omisión por la misma razón que `tipo_vinculacion`
en `tablasOperaciones.js:110-112`: la vinculación hay que sustentarla y no puede salir en
blanco.

No se guarda el detalle fila por fila. El estudio no tiene dónde publicarlo —la tabla es
una ficha vertical de un vinculado— y guardar lo que nadie lee es lo que después diverge.

### 5. Previsualización en el paso 2

`IngestaOperaciones.jsx` gana un bloque debajo de «Resumen de Operación Extraída», visible
solo cuando `adic_monto` existe:

```
+- Operación adicional (sección 4 del Excel) ------------------------------+
|                                                                          |
|  CONCEPTO (INFORMACIÓN ADICIONAL)      MONTO DE OPERACIÓN                |
|  Reintegros o reembolsos de gastos     COP $ 14.516.485.850              |
|  con vinculados que no fueron          -------------------------         |
|  reflejados en el Estado de            ✓ Supera 45.000 UVT               |
|  Resultados (62)                         (2.240.955.000): se declara     |
|                                          en el informe                   |
|  COMPAÑÍA VINCULADA                    PAÍS E ID FISCAL                  |
|  MONTACHEM INTERNATIONAL INC           EEUU (760575817)                  |
+--------------------------------------------------------------------------+
```

El veredicto del umbral es la única celda con dos estados: verde y «se declara en el
informe» cuando supera; ámbar y «no supera 45.000 UVT: la tabla se elimina del informe»
cuando no. Decirlo aquí es lo que evita la sorpresa al generar.

Avisos, en el mismo formato de los que ya emite `handleExcelUpload` (`:26-64`):

- más de una contraparte en la sección 4 → el estudio guarda una y el monto es la suma;
- más de un tipo → el informe declara el dominante;
- la sección trae filas pero el tipo viene vacío → la tabla saldrá con el concepto en
  blanco.

Cuando `adic_monto` no existe el bloque no se dibuja: un recuadro con seis «—» dice que
falta algo, y no falta nada.

### 6. La tabla en el informe

`filasOperacionAdicional(estudio)` en `tablasOperaciones.js`, junto a
`filasTransaccionesIntercompania` (`:103`) y con su misma forma:

```js
{
  nombre: 'Operación adicional Transacciones Intercompañía',
  encabezados: ['Compañía vinculada', ''],
  filas: [
    ['Razón social',                                wrap(e.adic_vinc)],
    ['Identificación fiscal',                       wrap(e.adic_vinc_id)],
    ['País - Residencia fiscal',                    wrap(e.adic_pais)],
    ['Tipo de vinculación',                         wrap(e.adic_tipo_vinculacion || 'Articulo 260-1 numeral 2')],
    ['Tipo de operaciones (Información adicional)', wrap(e.adic_tipo)],
    ['Monto en pesos',                              montoAdicional(e)],
  ],
  fuente: 'Información de ' + (e.ent || 'la Compañía') + '.',
}
```

`montoAdicional` es el formateador de `adic_monto`, gemelo del `montoDeLaOperacion` que ya
vive en ese archivo (`:50-54`): devuelve «—» cuando el valor no es numérico.

Se registra en `OBJETIVOS` de `tablasOperacionesHtml.js:47` y en
`actualizarTablasOperacionesOoxml` de `docxRelleno.js`, junto a la Tabla 3.

**Colisión de localizadores.** Las dos rutas localizan por inclusión de clave
(`clave.includes(c)`, `docxRelleno.js:754`). Que el buscador de la Tabla 3 no capture hoy a
la Tabla 4 es una casualidad ortográfica: `claveTitulo` (`:599-608`) da
`transacciones inter compania` para la Tabla 3 y
`operacion adicional transacciones intercompania` para la Tabla 4 —«Intercompañía» junto
frente a «Inter compañía» separado—, y la segunda no contiene a la primera. Si la plantilla
de un cliente la escribe separada, el motor de la Tabla 3 la captura y la sobrescribe con
los datos de la operación principal. Es el mismo tipo de defecto que ya documenta
`tablasOperacionesHtml.js:10-12` con «Otros servicios» dentro de «Otros servicios (07)».

**Guarda:** el localizador de la Tabla 3 descarta los candidatos cuya clave contenga
`operacion adicional`. Se implementa como opción del localizador (`excluir`) y no como
filtro suelto en cada llamador, para que las dos rutas compartan la regla.

**Eliminación cuando no hay nada declarable** —`adic_monto` ausente, o presente y por
debajo del umbral del año gravable—:

- .docx: `reemplazar(nombre, () => '', …)`. El recorte ya va del párrafo del rótulo al
  cierre de `<w:tbl>` (`docxRelleno.js:1232`), así que devolver cadena vacía borra el
  bloque completo.
- HTML: se quitan `bloque.rotulo` y el tramo `bloque.inicio..fin`.
- En las dos rutas hay que llevarse además la línea «FUENTE:» que queda detrás: no está
  dentro del bloque localizado, y sin esto queda huérfana bajo la tabla siguiente.
- Aviso al banner de generación: «se eliminó la Tabla N · Operación adicional Transacciones
  Intercompañía: el Excel no trae operaciones de la sección 4 que superen los 45.000 UVT».
- **La numeración de las demás tablas no se toca**, ni al eliminar ni al regenerar: sigue
  siendo la de la plantilla, igual que para todas las otras tablas del informe.

## Pruebas

`npm test` debe quedar en verde al 100 %. Casos nuevos:

**`excelOperationsParser.test.js`**
- una hoja con las cuatro secciones y cabeceras de columna distintas: `adicional.monto`
  toma `Monto operación 2025` y no `Saldo 2025`;
- sección 4 ausente → `adicional` es `null`;
- sección 4 con varias filas del mismo código → suma, un solo tipo, `tipos: 1`;
- sección 4 con códigos 61 y 62 → suma, tipo dominante por monto, `tipos: 2`;
- sección 4 con dos contrapartes → `contrapartes: 2`, primer vinculado;
- sección 4 con columna `Cod` vacía en todas sus filas → no se descarta nada;
- la sección 4 no altera `monto`, `monto_operacion` ni `egresosDescartados`.

**`umbralDocumentacion.test.js`**
- 2025 → 2.240.955.000; 2024 → 2.117.925.000; 2026 → 2.353.500.000;
- año ausente o desconocido → el mismo respaldo que `getUvtValue`;
- el límite es estricto: exactamente 2.240.955.000 **no** supera.

**`tablasOperaciones.test.js`**
- las seis filas y la etiqueta «Tipo de operaciones (Información adicional)»;
- estudio sin datos adicionales → todas las celdas en «—»;
- `adic_tipo_vinculacion` propio del estudio gana al valor por omisión.

**`tablasOperacionesHtml.test.js` y `docxRelleno.test.js`**
- con operación adicional sobre el umbral, la tabla se regenera con sus datos;
- el motor de la Tabla 3 **no** toca la Tabla 4, ni con «Intercompañía» junto ni con «Inter
  compañía» separado;
- por debajo del umbral, la tabla, su rótulo y su línea «FUENTE:» desaparecen, y el resto
  del documento queda intacto —incluidos los números de las tablas siguientes, que no se
  renumeran;
- sin operación adicional en el estudio, mismo resultado y un aviso en `avisos`;
- plantilla sin la tabla → aviso, sin insertar nada.

La previsualización del paso 2 es visual: verificación manual en el navegador con los dos
archivos disponibles —`Downloads/Informacion Operaciones PT 2025-1 (1).xlsx` (sección 4 con
datos) y `frontend/Archivos Prueba/Información Operaciones PT 2025-2 modificado cr.xlsx`
(sección 4 vacía)—, en tema claro y oscuro.

## Archivos que se tocan

| Archivo | Qué |
|---|---|
| `frontend/src/services/excelOperationsParser.js` | índices por sección, sección `ADICIONAL`, campo `adicional` |
| `frontend/src/services/umbralDocumentacion.js` | **nuevo** — 45.000 UVT por año gravable |
| `frontend/src/services/tablasOperaciones.js` | `filasOperacionAdicional` |
| `frontend/src/services/tablasOperacionesHtml.js` | registro en `OBJETIVOS`, borrado, guarda de la Tabla 3 |
| `frontend/src/services/docxRelleno.js` | idem en la ruta OOXML; opción `excluir` del localizador |
| `frontend/src/services/tablasHtmlInforme.js` | opción `excluir` en `localizarTablasHtml` |
| `frontend/src/components/IngestaOperaciones.jsx` | escritura de los campos y previsualización |
| pruebas de todos los anteriores | casos listados arriba |

Ninguna de las tres implementaciones del proxy cambia: no hay prompts ni contratos de API
en juego.
