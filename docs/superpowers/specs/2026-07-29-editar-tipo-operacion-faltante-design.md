# Edición en pantalla del "Tipo de operación" faltante

## Problema

Al analizar el Excel de operaciones (`pt36AnalizarOperaciones`, definido en `index.html`, bloque `PARCHE PT — Bloque 1 de 4`), algunas filas llegan sin «Tipo de operación» diligenciado en la fuente. El sistema ya las clasifica automáticamente por Formato + Concepto de medios magnéticos (1001/1007) cuando puede, y muestra un aviso ámbar/rojo pidiendo verificar contra el catálogo DIAN o completar el Excel. Hoy la única forma de corregirlas es editar el archivo Excel fuente y volver a cargarlo.

## Objetivo

Permitir confirmar o corregir el «Tipo de operación» de esas filas **directamente en pantalla**, sin tocar el Excel, y garantizar que ese valor corregido llegue al mismo contexto que usa el informe final (declaración 1125, campo `oper`, secciones del informe), no solo a la tabla de resumen visual.

## Alcance

- Cubre únicamente las filas con «Tipo de operación» faltante o clasificado por concepto (`f.origenTipo === 'concepto'` o `!f.tipo`).
- No cubre la unificación de NIT duplicados (aviso separado, fuera de alcance de este cambio).
- Los 3 campos de EEFF (t_s, t_inv, ingbrutos) ya son editables en el formulario; no requieren cambios.

## Diseño

### 1. Persistencia de la corrección (override)

- Nuevo storage `pt36TipoOverrides`: mapa `"<hoja>#<fila>" → tipo` guardado con `stSet`/`stGet` (mismo mecanismo que `opsAnalisis`), por lo que sobrevive a recargar la página y a re-analizar el mismo archivo.
- Clave estable: número de hoja + número de fila del Excel (`f.hoja`, `f.fila`), ya calculados en `analizarHoja()`.

### 2. Aplicación del override — punto único de verdad

Dentro de `window.pt36AnalizarOperaciones`, inmediatamente después de construir el arreglo `filas` (todas las hojas ya leídas, antes de calcular `nitAmbiguo`, `agrupar()`, `porConcepto/sinTipo` y antes de construir `PT36.ops`):

```js
await ptCargarTipoOverrides();
filas.forEach(function (f) {
  var ov = _tipoOverrides[f.hoja + '#' + f.fila];
  if (ov) { f.tipo = ov; f.origenTipo = 'manual'; }
});
```

Como este es el único lugar donde se construyen `filas` (fuente de la que salen `PT36.ops.grupos`, `PT36.ops.filas`, y —vía `ptRegistrosDeclaracion()`— `PT_DECLARACION`, el Formato 1125 y el campo `oper` del formulario a través de `ptFijarCampo`), aplicar el override aquí garantiza que se propaga a **todo** lo que consume esos datos, sin tocar cada consumidor por separado.

### 3. Recalculado tras cada corrección

Guardar un override y volver a invocar `window.pt36AnalizarOperaciones()` (la versión ya envuelta por los parches de declaración de líneas posteriores) hace que se re-ejecute toda la cadena:
`pt36AnalizarOperaciones → ptRegistrosDeclaracion/ptPintarDeclaracion → ptFijarCampo('oper'/'monto'/'vinc'/'cod', ..., 'ingesta')`.

Esto es exactamente el mecanismo que hoy siembra el campo `oper` (y por tanto el análisis económico del informe) desde la operación documentable de mayor cuantía. Al re-disparar el pipeline completo, la corrección de tipo llega al mismo lugar que llegaría si se hubiera corregido en el Excel y se hubiera vuelto a cargar — no hace falta ninguna sincronización adicional.

`ptFijarCampo` respeta la prelación existente (`usuario` > `ingesta` > `anterior`): si el usuario ya escribió algo distinto a mano en el campo `oper`, la corrección de tipo no lo sobreescribe. Esto ya está resuelto por el código existente (bloque de prelación, línea ~12608) y no requiere cambios.

### 4. Interfaz — tabla editable dentro del panel de operaciones

Dentro de `window.pt36Pintar`, si `PT36.ops.pendientesTipo.length > 0`, se añade una tabla justo debajo de la tabla de grupos existente:

- Columnas: Vinculado, NIT, Formato/Concepto, Monto, y una celda con el control de edición.
- Control: `<select>` con los tipos de operación que aparecen escritos directamente en el mismo archivo (`origenTipo === 'directo'`, deduplicados y ordenados) + opción "Otro (escribir)". Si la fila ya tenía un tipo auto-asignado por concepto y coincide con una opción conocida, viene preseleccionada. Si no coincide con ninguna, se preselecciona "Otro" con el valor auto-asignado precargado en el `<input>` de texto (el usuario solo debe confirmar/editar y confirmar con Enter o al salir del campo).
- Al confirmar un valor (`onchange` del select con valor directo, o `blur`/Enter del input de texto), se guarda el override y se vuelve a llamar `pt36AnalizarOperaciones()`; la fila corregida desaparece de la tabla de pendientes porque ya no cumple `!tipo || origenTipo==='concepto'`.

### 5. Claridad visual

- El aviso ámbar/rojo existente mantiene su texto (es el mismo que se imprime en el informe como registro de auditoría) pero dejará de aparecer solo cuando las filas queden confirmadas, porque los contadores (`porConcepto`, `sinTipo`) se recalculan sobre `filas` ya con los overrides aplicados.
- Se añade un encabezado visible sobre la tabla editable: "⚠ N operación(es) requieren confirmar el Tipo de operación — selecciónelo abajo para corregirlo sin editar el Excel".
- Cuando no quedan pendientes, se muestra una línea de confirmación: "✅ Todas las operaciones tienen Tipo de operación confirmado".

## Fuera de alcance / no se modifica

- La unificación de NIT duplicados (`nombreMultiNit`) sigue siendo solo informativa.
- La lectura de EEFF no cambia.
- No se modifica el archivo Excel fuente ni se ofrece descarga de un Excel corregido.

## Riesgos / notas

- Volver a llamar `pt36AnalizarOperaciones()` re-lee el Excel adjunto completo (ya resuelto por `ptResolverExcel('ops')`); no requiere que el usuario vuelva a adjuntar el archivo, pero sí que siga adjunto en la sesión (comportamiento ya existente, sin cambios).
- El override se guarda por hoja+fila del archivo. Si el usuario carga un Excel distinto que por coincidencia tenga el mismo nombre de hoja y número de fila, podría heredar un override que no le corresponde. Se acepta este riesgo menor porque el flujo típico es analizar un archivo, corregir, y generar el informe de esa misma operación en la misma sesión.
