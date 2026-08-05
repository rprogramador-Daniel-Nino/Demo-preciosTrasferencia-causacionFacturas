# Excel de soporte del Motor de Comparables

## Origen

`frontend/src/components/MotorComparables.jsx` calcula el rango intercuartil, el PLI de la
parte examinada y el ajuste de capital de trabajo, y muestra en pantalla el resultado final
(rango, cumplimiento, tabla de comparables). Pero no hay forma de exportar ese cálculo: si el
usuario necesita sustentar ante la DIAN cómo se filtraron las candidatas, cómo se comparó el
rango o cómo se ajustó cada comparable, tiene que reconstruirlo a mano leyendo la pantalla.

Además, `runEngineSelection` (línea ~352 de `MotorComparables.jsx`) calcula
`result.rechazadas` y `result.reserva` —cada candidata con su motivo de descarte, categoría,
score y factores— pero solo guarda los **conteos agregados** en `selectionFunnel`; el detalle
por candidata se descarta después de armar el embudo.

## Alcance

**Dentro de este spec:**
- Un botón en `MotorComparables.jsx`, al final del componente, que genera un archivo `.xlsx`
  de soporte con el cálculo completo: filtros aplicados, comparables (seleccionadas,
  rechazadas y en reserva), el rango intercuartil y el desglose del ajuste de capital de
  trabajo por comparable.
- Capturar en un estado nuevo del componente (`motorAuditoria`) el detalle de rechazadas y
  reserva que hoy se descarta en `runEngineSelection`.
- Un servicio nuevo, `frontend/src/services/motorExcelExport.js`, con la lógica de armar el
  libro (función pura, testeable) separada de la de disparar la descarga.

**Fuera de alcance:**
- Tocar `index.html` (Sistema PT) — no recibe desarrollo nuevo, por decisión ya registrada en
  `CLAUDE.md` (2026-07-31).
- Persistir `motorAuditoria` con el estudio (ver decisión de persistencia abajo).
- Cambiar el cálculo del motor (`scoreCandidates`, `prefiltrar`, `adjustInfo`, etc.) — este
  spec solo expone en Excel lo que esas funciones ya calculan.
- Exportar a otros formatos (PDF, Word) — ya existen otros flujos de exportación para el
  informe; esto es específicamente un Excel de auditoría del motor.

## Decisiones tomadas

| Decisión | Elegido | Descartado | Por qué |
|---|---|---|---|
| Persistencia de rechazadas/reserva | Solo en memoria (estado de React), se pierde al recargar | Persistir con el estudio (`updateStudy`) | Mismo problema que ya tiene `universo`: un cribado real trae miles de filas y guardarlas en cada estudio revienta la cuota de `localStorage` (`QuotaExceededError` sin capturar). Se recalcula corriendo el motor otra vez. |
| Dónde vive la lógica de armar el libro | Servicio nuevo (`motorExcelExport.js`), función pura que recibe datos ya calculados | Inline dentro del componente | `MotorComparables.jsx` ya tiene 1634 líneas; sigue el patrón existente del repo (`comparablesEngine.js`, `eeffParser.js`) de separar lógica de negocio de la UI, y permite testear el armado del libro sin renderizar React. |
| Formato de porcentajes en el Excel | Texto formateado (`"12.34%"`, vía `pctf`) | Número decimal crudo (0.1234) con formato de celda `%` | Coherente con lo que ya se ve en pantalla; evita depender de que quien abra el archivo tenga el formato de celda correcto para interpretarlo. Los montos en pesos sí quedan como número, para poder sumarlos. |
| Alcance de "rechazadas" en el Excel | Detalle completo por candidata (nombre, motivo, categoría) | Solo el conteo del embudo | Es precisamente lo que hoy falta para sustentar ante la DIAN *cómo* se aplicó cada filtro, no solo cuántas cayeron en cada etapa. |
| Candidatas en reserva | Hoja propia con detalle (mismas columnas que seleccionadas) | Solo contarlas en el resumen | Ya pasaron todos los filtros; que no hayan entrado es una decisión de cupo (`nTarget`), no de exclusión — vale la pena verlas con su puntaje. |

## Diseño

### 1. Estado nuevo en `MotorComparables.jsx`

```js
const [motorAuditoria, setMotorAuditoria] = useState(null); // { rechazadas, reserva }
```

- Se llena en `runEngineSelection`, justo donde hoy se arma `selectionFunnel`, con
  `result.rechazadas` y `result.reserva` (ya vienen de `scoreCandidates`, no hay que
  recalcular nada).
- Se resetea a `null` en los mismos puntos donde ya se resetea `selectionFunnel`:
  `cambiarConfig`, al guardar una actividad nueva editada y al reimportar el Excel de Capital
  IQ (`handleImportExcel`) — un resultado de auditoría de la corrida anterior no debe quedar
  en pantalla como si describiera los filtros actuales.
- **No entra** al payload de `updateStudy` (el `useEffect` que persiste el estudio): mismo
  criterio que `universo`.

### 2. Servicio `frontend/src/services/motorExcelExport.js`

Dos funciones exportadas:

- `construirLibroSoporte(datos) → XLSX.WorkBook` — pura, sin acceso al DOM. Recibe un objeto
  plano (no el estado de React directamente) para poder testearla con `node --test` igual que
  `comparablesEngine.test.js`.
- `exportarSoporteMotor(datos, nombreArchivo)` — llama a `construirLibroSoporte` y dispara la
  descarga con `XLSX.writeFile` (o `XLSX.write` + Blob + link temporal, siguiendo lo que ya
  use el resto del repo para descargas de archivo binario en el navegador).

Forma de `datos` (todo ya calculado en `MotorComparables.jsx`, ninguna lógica nueva de
cálculo):

```js
{
  estudio: { entidad, anio, pli /* MO|MB|Berry */, useAdj, interestRate },
  examinada: { T /* {s,c,op,ar,inv,ap} */, tPLI, tR /* ratios */ },
  rango: { stats /* {p25,med,p75} | null */, activeCount, adjustment /* adjustInfo() | null */ },
  filtros: { engineConfig, selectionFunnel /* | null */ },
  comparables: calculatedRowsConDesglose /* ver nota abajo */,
  auditoria: motorAuditoria /* {rechazadas, reserva} | null */
}
```

**Nota sobre `calculatedRowsConDesglose`:** hoy `calculatedRows` (la variable que ya existe en
`MotorComparables.jsx`, línea ~647) calcula `adj` y `cR` (los ratios de la comparable) como
variables **locales** dentro del `.map()`, y el objeto que retorna solo conserva `pli`,
`adjustedPli` e `isIncluded` — `adj` y `cR` se descartan. Para que el Excel pueda mostrar el
desglose del ajuste (razón por razón), ese mismo `.map()` debe extenderse para conservarlos
también en el objeto de salida (agregar `adj` y `cR` al `return`), no recalcularlos aparte en
el servicio de exportación — sería la misma fórmula duplicada en dos sitios. El nombre
`calculatedRowsConDesglose` es solo indicativo en este spec; en la implementación puede seguir
llamándose `calculatedRows` una vez extendido.

### 3. Hojas del libro (en este orden)

1. **Resumen** — entidad, año, PLI usado, si aplica ajuste de capital de trabajo y la tasa;
   cifras de la parte examinada; su PLI (`tPLI`); el rango intercuartil (P25/Mediana/P75) y
   cuántas comparables activas lo alimentan (`activeSeries.length`); resultado de cumplimiento
   (dentro/fuera, dirección, ajuste bruto `raw`, ajuste topado `capped`, si se topó por el
   egreso `flag`, si es improcedente por ser negativo `improcedente`).
2. **Metodología** — texto en español explicando las fórmulas reales usadas (no un resumen
   genérico de precios de transferencia): la fórmula de cada PLI (MO = UO/Ventas, MB =
   (Ventas-Costo)/Ventas, Berry = Ventas/(Costo+Gastos Operativos)), la fórmula del ajuste de
   capital de trabajo (`tasa × [(CxC/Ventas examinada − CxC/Ventas comparable) +
   (Inv/Ventas examinada − Inv/Ventas comparable) − (CxP/Costo examinada − CxP/Costo
   comparable)]`), cómo se calcula el rango intercuartil (percentil por posición, no
   interpolado — la fórmula exacta de `quart()`), y la regla de ajuste (dentro del rango no se
   ajusta; fuera, se mueve a la mediana, se topa por el monto del egreso si lo excede, y nunca
   es negativo).
3. **Filtros del motor** — `engineConfig` completo (nTarget, pérdida operativa, holding,
   saldo negativo, geografía, rigor funcional, justificación de pérdida) + `selectionFunnel`
   si existe (universo evaluado, descartadas por filtros/IA/rigor, curadas, válidas,
   seleccionadas vs. objetivo, reserva). Si `selectionFunnel` es `null` (no se corrió el motor
   automático), la hoja solo trae `engineConfig` con una nota indicando que no se ejecutó
   selección automática.
4. **Comparables seleccionadas** — una fila por `calculatedRows`: nombre, ID, ámbito, SIC,
   ventas, costos, utilidad operacional, CxC, inventarios, CxP, PLI crudo, y si `useAdj` está
   activo (y el PLI no es Berry, que no se ajusta) el desglose completo del ajuste — las tres
   razones que usa la fórmula: CxC/Ventas, Inventarios/Ventas y CxP/Costo, cada una de la
   comparable y de la examinada, más la tasa aplicada y el ajuste resultante —, PLI ajustado,
   si quedó incluida en el rango según el filtro Todas/Internacionales/Nacionales, y si viene
   de `scoreCandidates` también score, factores (perfil, especialidad, geografía, tamaño,
   rentabilidad), razones y si es de continuidad.
5. **Candidatas rechazadas** — solo si `auditoria.rechazadas` no está vacío: nombre, ID, SIC,
   país, categoría de rechazo (filtro/IA/rigor), motivo exacto.
6. **Candidatas en reserva** — solo si `auditoria.reserva` no está vacío: mismas columnas que
   la hoja 4 (ya pasaron todos los filtros, solo no entraron por el tope `nTarget`).

Las hojas 5 y 6 se omiten limpiamente (sin fila vacía ni error) cuando no hay corrida del
motor automático — el botón debe funcionar igual con comparables cargadas a mano.

### 4. UI en `MotorComparables.jsx`

- Botón al final del componente (después de la tabla de comparables), mismo estilo que los
  botones primarios existentes (`bg-[#0FA3A1] hover:bg-[#0B7C7A]`), con ícono y texto
  "Exportar Excel de Soporte del Motor".
- Si `comparables.length === 0`, no genera nada y usa `alert(...)` para avisar — mismo patrón
  que ya usa `runEngineSelection` en este archivo para guardas simples.
- Nombre de archivo: `Soporte_Motor_Comparables_<entidad-slug>_<anio>.xlsx`, con *fallback* a
  `estudio` si `study.nombre`/`study.entidad` no está definido.

### 5. Testing

- `frontend/src/services/motorExcelExport.test.js`, siguiendo el patrón de
  `comparablesEngine.test.js`: construir un libro con `construirLibroSoporte()` sobre datos de
  prueba y verificar con `XLSX.utils.sheet_to_json` que las hojas esperadas existen y traen
  las columnas/valores correctos, incluyendo el caso sin corrida de motor (hojas 5 y 6
  ausentes) y el caso sin ajuste de capital de trabajo (`useAdj = false`, sin columnas de
  desglose).
- Verificación manual en el navegador: correr el motor con datos de prueba, exportar, abrir el
  `.xlsx` resultante y confirmar que las cifras coinciden con lo que muestra la pantalla
  (rango, PLI, ajuste). El proyecto no tiene tests de UI (`CLAUDE.md`), así que esto reemplaza
  esa verificación.
