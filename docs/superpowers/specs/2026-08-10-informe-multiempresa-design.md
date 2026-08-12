# El informe para cualquier empresa: retirar la sustitución por literales

## Origen

El usuario lo planteó así: *"no estamos dando resultados… el avance se ve frenado por la
generación de los documentos"*, y pidió que el flujo *"sea compatible con estudios de
múltiples empresas y funcione con cualquier informe de precios de transferencia"*, con
autorización explícita para borrar lo que no sirva.

El freno tiene una causa concreta y verificable, no de acabado.

## Hallazgos verificados contra el código

### 1. El informe se produce reemplazando literales de END GAME 2024

- `frontend/src/services/masterTemplate.js` — 299.754 bytes en **una sola línea**. Es el
  informe de End Game 2024 completo serializado como cadena JS. 68 apariciones de `END GAME`.
- `frontend/src/services/exactTemplateMapper.js:557-866` — `hydrateExactWordTemplate`, 310
  líneas y ~30 `String.replace` en orden estricto. Sustituye el NIT `901.337.576-x` (`:685`),
  el Tax ID del vinculado `604477955` (`:672`), el monto `3.435.357.400` (`:674`), la fila de
  accionista con `200.000 / 200.000.000 / 100%` (`:639-645`), y seis rubros de balance
  (`:753-758`).
- Las secciones se anclan a los IDs del .docx de End Game: `_Toc208930977`…`_Toc208931007`
  (`:42-48`, `:463`, `:522`, `:540`, `:545`, `:858`).
- Las 13 expresiones de `ANIOS_DEL_ESTUDIO` (`:70-90`) están amarradas al literal `2024` con
  lookbehind de frases exactas del informe.

**Consecuencia:** si una expresión no casa, el dato de End Game se radica ante la DIAN bajo el
nombre de otro cliente. El fallo es silencioso. `plantillaGuardas.js` y `faltaSustitucion`
(`ReporteGenerador.jsx:102`) existen para avisar del riesgo, no para eliminarlo.

### 2. La salida correcta ya existe

Commit `e9b9ddd` — *"la plantilla .docx del cliente se rellena, ya no se reconstruye"*.
`docxRelleno.js:324-356` usa docxtemplater sobre el OOXML del propio cliente y conserva
encabezado, pie, estilos, márgenes e índice. Las imágenes se insertan a mano
(`insertarImagenes:414`, `insertarImagenesAnexoB:490`) porque el módulo de imágenes de
docxtemplater es de pago.

Su límite: `plantillaVocabulario.js:29-57` tiene ~40 campos y no cubre narrativa, comparables
ni operaciones.

### 3. `exactTemplateMapper.js` no se puede borrar entero

`docxRelleno.js:33` importa de ahí `filasComparablesInforme` y `filasRazonesRechazo`, y los
generadores de `TABLAS_MACRO` (`:26-35`) los usa la ruta buena. Hay que **partirlo**, no
eliminarlo. Esta afirmación corrige la versión inicial del diseño, que daba por hecho que el
archivo entero era desechable.

### 4. Las 25 auditorías del cliente

Extraídas de `word/comments.xml` de `Informe Local End Game _ 2024_v2.docx`, todas de Cindy
Gomez (2026-07-29). Se agrupan en:

| Grupo | Nº | Estado |
|---|---|---|
| Montos de la plantilla "Información Operaciones PT 2025" | 5 | pendiente |
| "Actualizar con la IA con cifras 2025, misma estructura" | 9 | pendiente |
| Prime Rate 2025 = 7,37 % | 3 | **resuelto** en `83f033f` |
| UVT 2025 | 2 | calculable, falta exponerlo como campo |
| Insertar el PDF tal cual de los EEFF | 1 | **resuelto** en `6adc3eb` |
| Composición accionaria / base de datos única / matriz de rechazo | 5 | pendiente |

### 5. El Excel ya está hecho, y va por delante del archivo de referencia

`memoriaCalculoRangoOptimo.js` genera el libro objetivo: `Datos` editable, cinco hojas
`MO/MB/Berry/CostPlus/NCP` con fórmulas vivas (`QUARTILE`, `=(J3-N3)/R3`, factor `L=I/(1+I)`),
`Resumen` con 35 combinaciones método × ajuste, `Selección comparables` y `Matriz de rechazo`.

Contrastado contra `EXCEL_OPTIMO_DEL_SISTEMA_ajustado.xlsx` que aportó el usuario:

| Punto | Excel de referencia | Código |
|---|---|---|
| Tasa única | corregida a mano en `Datos!L4` | `Datos!B11`, commit `83f033f` |
| PP&E escalado por la base `*(M*I)` | corregido a mano, 80 celdas | commit `81adb5a` |
| Denominador descuenta CxC en sabores que no lo aplican | **advertencia sin corregir** | corregido: `AJUSTAN_AR`, `ajusteRangoCapitalTrabajo.js:58,222` |

La hoja "Control de cambios" del archivo de referencia no se genera ni debe generarse.

### 6. Tres inconsistencias en el cálculo del rango (riesgo de radicación)

1. `memoriaCalculoRango.js:178` publicaba *"sin interpolar"* mientras `:100-104` interpola. Ese
   texto se imprime en el modal y en el Excel que se radica ante la DIAN.
2. Berry tenía dos definiciones: `calculations.js:152` (`ventas/costos totales`) y
   `ajusteRangoCapitalTrabajo.js:70-76` (`utilidad bruta/gastos operativos`). Además Berry
   usaba cuartil truncado (`quart`) y MO/MB interpolado, así que modal e informe podían
   mostrar rangos distintos para el mismo estudio.
3. `AuditoriaNorma.jsx:79-97` es una tercera implementación, sin ajuste de capital de trabajo,
   sin filtro de ámbito y sin tests.

### 7. El modelo guarda una sola operación

`excelOperationsParser.js:181-189` lo dice en su propio comentario: el estudio guarda un
vinculado, y con varias contrapartes se suman los montos y se atribuyen a la primera.
`:86,94-95,115` **solo suma `OPERACIONES DE INGRESO`; los egresos se descartan**.

Verificado en los datos del cliente: la misma razón social `END GAME INTERACTIVE INC` aparece
con identificación `444444001` en la sección de ingreso, `444444031` en la de egreso, y
`604477955` en el informe 2024. El sistema no puede ver ninguna de las dos discrepancias.

## Decisiones

| Decisión | Elegido | Descartado | Por qué |
|---|---|---|---|
| Ruta de generación del Word | Solo la plantilla `.docx` del cliente | Conservar el mapper por literales como respaldo | Es la única que sirve para otra empresa. Mantener las dos sostiene el modo de falla silencioso |
| Definición de Berry | Utilidad bruta / gastos operativos | Ventas / costos totales | Es la del Anexo del Cap. III de las Guías OCDE y la que replica el Excel validado por el consultor |
| Método de cuartil | Interpolación lineal (`QUARTILE.INC`) para todos | Mantener `quart` truncado en alguna ruta | Dos algoritmos producían dos rangos para el mismo estudio |
| Multi-operación | Spec aparte | Resolverlo aquí | Toca ingesta, modelo, Firestore, motor e informe; mezclarlo retrasa el desbloqueo del documento |
| Celda del parámetro de tasa | Se mantiene `Datos!B11` | Mover a `L4` como el archivo de referencia | Diferencia cosmética; el código ya tiene tests sobre `B11` |

## Alcance

**Entra:** unificar el cálculo del rango (Fase 0), partir `exactTemplateMapper.js` y retirar la
sustitución por literales (Fase 1), ampliar `plantillaVocabulario.js` para cubrir las
auditorías (Fase 2), y advertir de las discrepancias de identificación y de los egresos
descartados.

**No entra:** el modelo multi-operación, `index.html` (no recibe desarrollo nuevo por decisión
de 2026-07-31), y renderizar el `.docx` para verificarlo — no hay LibreOffice en la máquina,
así que la comprobación final sigue siendo manual en Word.

## Consecuencia visible para el usuario

Berry pasa a admitir el ajuste de capital de trabajo, que antes no recibía, y su margen cambia
de fórmula. Los estudios existentes que usen Berry verán un rango distinto al de ayer. Es el
efecto buscado —hoy ese rango no coincide con el del Excel de soporte—, pero hay que avisarlo
al equipo antes del merge.

## Verificación

El repo no tiene tests de UI ni de `index.html`. `npm test` cubre `scripts/lib/`,
`frontend/src/services/`, `frontend/src/utils/` y `functions/`.

1. `npm test` en verde, reportando cuántos casos se borran con el código muerto.
2. `npm run lint --prefix frontend` con exit 0.
3. `grep` de cada símbolo eliminado (`MASTER_WORD_TEMPLATE`, `hydrateExactWordTemplate`,
   `hojasMemoriaRango`, `quart`) para confirmar cero referencias vivas.
4. **Prueba de fuego multiempresa**, manual en el navegador: generar con los archivos de
   `Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/`, subir el informe 2024 como
   plantilla, y buscar en el `.docx` resultante `901.337.576`, `604477955`, `3.435.357.400` y
   `END GAME`. Cero apariciones no explicadas.
5. Repetir con un contribuyente inventado distinto.
6. Contrastar el Excel del motor contra `EXCEL_OPTIMO_DEL_SISTEMA_ajustado.xlsx`. El escenario
   que reporta el informe es **W (CxC + CxP + Inventario)**, no X ni Y.
7. `/revisar-ramas-equipo` antes del merge: Daniel y Pablo tocan estos mismos archivos.
