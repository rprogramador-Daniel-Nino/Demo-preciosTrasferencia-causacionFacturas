# Calco del informe de referencia en un .docx real

## Origen

El generador del gestor produce hoy un `.doc` que es HTML con namespaces de Office. Tras
arreglar la extracción del PDF (texto e imágenes, commit `3ceab95`), el documento sale con el
contenido correcto pero no se parece al informe de referencia: sin negritas, sin fuentes, con
el logo repetido noventa y seis veces al final de cada bloque de página, sin encabezado ni
pie, sin saltos de página y con el anexo como divs vacíos.

El objetivo pedido es que el documento generado quede **calcado página por página** respecto
del informe que se carga, mutando solo los datos que deben cambiar.

Este spec entrega **la forma**. El contenido —qué valores mutan y de dónde salen— es el plan 2
de [`2026-07-31-plantilla-marcada-e-imagenes-design.md`](2026-07-31-plantilla-marcada-e-imagenes-design.md),
ya aprobado y todavía sin implementar.

### Hallazgos de la exploración

Todos medidos contra `Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf`.

| # | Hallazgo | Efecto sobre el diseño |
|---|---|---|
| 1 | Los objetos de fuente traen `{name:'Arial-BoldItalicMT', bold:true, italic:true}` vía `page.commonObjs.get(item.fontName)` | Negrita, cursiva, familia y tamaño **sí** son recuperables desde el PDF. No están en el árbol de etiquetado, pero sí en las fuentes. |
| 2 | El árbol expone `children, role, lang, type, id, bbox, alt`. No expone `ColSpan` ni `RowSpan` | Las celdas combinadas son la única pérdida irrecuperable por esta vía. |
| 3 | Hay **18 nodos `Figure`** con `bbox` frente a **126 dibujos** | Los 108 dibujos sin `Figure` son artefactos de encabezado. Da un criterio verificable para separar el logo del contenido. |
| 4 | El único texto fuera del árbol es el número de página (`"1"`, `"10"`) | El pie es la numeración; el encabezado es solo el logo. |
| 5 | 111 páginas son carta vertical (612×792 pt) y **1 es apaisada** (792×612 pt) | Obliga a una sección propia con cambio de orientación. |
| 6 | `pizzip` y `docxtemplater` ya son dependencias de `frontend/` | El `.docx` se arma sin agregar nada al proyecto. |
| 7 | Roles presentes: 4713 `P`, 1292 `TD`, 999 `TH`, 890 `TR`, 103 `Table`, 141 `L`, 137 `LI`, 89 `TOCI`, 42 `Note`, 18 `Figure`, 41 `H3`, 24 `H2`, 16 `H1`, 9 `H4` | `Note` permite identificar notas al pie; `TOCI` la tabla de contenido. Ninguno de los dos se mapea hoy. |
| 8 | La ingesta captura **15 campos de EEFF**, más `ciiu`, `objeto` y `representante` | El vocabulario del spec aprobado lista 6 campos de EEFF y un `direccion` que no existe. Hay que corregirlo antes del plan 2. |

## Decisiones tomadas

| Decisión | Elegido | Descartado |
|---|---|---|
| Origen de la plantilla | El PDF que se carga | El `.docx` original del informe |
| Grado de paridad | Calco página por página | Solo contenido y jerarquía; por fases |
| Formato de salida | `.docx` real (OOXML) | HTML con dialecto de Word; MHTML |
| Formato de intercambio interno | HTML enriquecido | Documento intermedio estructurado |
| Anexo escaneado (15 págs) | Hueco marcado + subir los EEFF del año en curso | Rasterizar los del año anterior; omitirlo |
| Numeración del pie | Campo `PAGE` de Word | El número literal del PDF |
| Celdas combinadas | Pérdida declarada | Reconstruirlas por geometría |

**Sobre el origen.** Se evaluó usar el `.docx` original —está en el repo, es el mismo informe, y
daría paridad por construcción sin reconstruir nada—. Se descartó a favor del PDF porque la
herramienta debe funcionar con el informe que cada cliente entregue, que en general será un PDF.
Queda registrado porque es la alternativa a la que volver si el calco desde PDF no alcanza.

**Sobre el formato de intercambio.** El HTML se mantiene porque el spec aprobado construye la
mutación sobre HTML: la plantilla marcada guarda `<span data-campo="X">`, la hidratación
sustituye sobre HTML, la vista previa es `contentEditable` sobre HTML y `plantillaStore`
guarda HTML. Un documento intermedio obligaría a rehacer las cuatro cosas sin ganar nada: el
`.docx` se genera igual de bien desde un HTML que lleve el estilo de cada fragmento.

---

## Diseño

### 1. Piezas

| Archivo | Estado | Responsabilidad |
|---|---|---|
| `pdfReferenceExtractor.js` | se extiende | Runs con estilo, figuras en su posición, artefactos separados del cuerpo, límites y orientación de página. Sigue sin conocer precios de transferencia ni Word. |
| `docxWriter.js` | nuevo | HTML enriquecido + recursos → `.docx` OOXML con `pizzip`. No conoce el PDF ni el dominio. |
| `ReporteGenerador.jsx` | se ajusta | El botón de descarga pasa de `.doc` a `.docx`. |
| `exactTemplateMapper.js` | sin tocar | La mutación es del plan 2. |

Flujo:

```
estudio pasado.pdf
      │  pdfReferenceExtractor  (runs, figuras, artefactos, páginas)
      ▼
HTML enriquecido ──► plantillaStore (IndexedDB)   ──► vista previa (igual que hoy)
      │
      │  hidratación / marcado por campos  (plan 2, sin cambios)
      ▼
HTML final + recursos ──► docxWriter ──► informe.docx
```

`docxWriter` recibe HTML y devuelve un zip sin saber de dónde vino. Esa frontera es lo que lo
hace probable con `node --test` sin navegador.

### 2. Runs con estilo

`textoPorId` pasa de `Map<id, string>` a `Map<id, Run[]>`, con
`Run = { texto, negrita, cursiva, familia, tamaño }`.

El estilo sale de `page.commonObjs.get(item.fontName)`. Dos detalles obligatorios:

- Hay que llamar `getOperatorList()` **antes** de resolver fuentes. Hoy el orden es el inverso
  y las fuentes se registran al construir la lista de operadores.
- El nombre trae prefijo de subconjunto de seis letras (`VXFCPX+BritannicBold`): se recorta.

Los runs contiguos con el mismo estilo se funden. Sin eso el XML sale lleno de fragmentos de
una letra, porque el PDF corta el texto en cada cambio de fuente.

El salto de línea pendiente que ya resuelve `textoPorId` sigue igual, ahora dentro del run.

### 3. Figuras en su posición

Se emparejan los 18 nodos `Figure` (que traen `bbox`) contra los 126 dibujos (que traen su
matriz acumulada) por solapamiento de rectángulo. La imagen se emite en el punto del árbol
donde está el `Figure`, con su `alt`.

Un dibujo que no empareja con ningún `Figure` es artefacto. Un `Figure` que se queda sin
dibujo emite el hueco y **se reporta**. Nada se descarta en silencio: el silencio en esta ruta
ya costó dos fallos invisibles —imágenes sin píxeles y objetos globales pedidos al almacén
equivocado— que los tests en verde no delataron.

### 4. Encabezado, pie y portada

El encabezado se arma con los dibujos artefacto de una página y se emite **una sola vez** como
`word/header1.xml`. Con esto desaparecen las noventa y seis copias del logo.

El pie lleva el **campo `PAGE` de Word**, no el número literal del PDF. Emitir el literal
dejaría números que mienten en cuanto Word repagine.

La portada normalmente no lleva encabezado: se comparan los artefactos de la página 1 contra
los de las siguientes y, si difieren, se activa `titlePg` con un `header2` propio.

### 5. Páginas y orientación

Cada bloque se marca `<div class="pagina" data-pagina="N" data-orientacion="vertical|apaisada">`.
El writer mete salto de página entre bloques y abre **sección nueva** cuando cambia la
orientación, que es lo que necesita la página apaisada. El `sectPr` va con `pgSz` de carta
(12240×15840 twips) y márgenes derivados del bbox del contenido.

**Word repagina.** El salto duro garantiza que la página N empiece donde debe, pero si su
contenido no cabe, Word desborda a una página extra y a partir de ahí el calco se desplaza.
Sin fijar alturas no hay techo mejor, y fijarlas dejaría el documento imposible de editar.

### 6. Anexo

Los 15 huecos pasan a ser una página marcada cada uno. Se estrena el almacén `anexos` de
`plantillaStore`, que el spec anterior creó y nadie usa todavía: ahí van los EEFF firmados del
año en curso. Al generar, si hay anexo sus páginas se insertan en el sitio del hueco; si no,
salen las 15 páginas marcadas y el aviso previo.

No se copian las páginas escaneadas del año anterior. El informe se radica ante la DIAN, y un
calco perfecto con los estados financieros firmados del año equivocado dentro es peor que un
hueco evidente.

### 7. Tablas

`Table` / `TR` / `TD` / `TH` → tabla OOXML con bordes y anchos derivados de los `bbox` de las
celdas. Sin `colspan` ni `rowspan`: una celda combinada sale como celdas separadas.

### 8. El zip

`[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `word/_rels/document.xml.rels`,
`word/styles.xml`, `word/header1.xml`, `word/footer1.xml` y `word/media/*`.

Las imágenes van como binario en `word/media/`, no en base64. El archivo baja de los 3,3 MB de
hoy a alrededor de 1 MB.

---

## Corrección al vocabulario del plan 2

El plan 2 sustituye por nombre de campo. Su vocabulario, escrito antes que la ingesta actual,
está desalineado con lo que el estudio contiene hoy:

| Grupo | Campos reales |
|---|---|
| Contribuyente | `ent`, `nit`, `ciiu`, `objeto`, `representante`, `anio` |
| Vinculada | `vinc`, `vinc_id`, `vinc_tipo`, `pais_vinc` |
| Accionistas | `accionistas[]` (`nombre`, `pais`, `acciones`, `valor_capital`) |
| EEFF | `t_cash`, `t_ar`, `t_inv`, `t_tax`, `t_ppe`, `t_act_curr`, `t_act_nocurr`, `t_act_tot`, `t_inv_assoc`, `t_intang`, `t_dif`, `t_ap`, `t_c`, `t_op`, `t_s` |
| Método | `pli`, `useadj`, `prime`, `egreso`, `comparables[]` |
| Derivados | rango intercuartil (`p25`, `mediana`, `p75`), ajuste, cumple/no cumple, topes UVT del año |

El spec anterior lista 6 campos de EEFF y un `direccion` que no existe en ningún componente de
ingesta; `objeto` y `representante` sí existen y no figuran. Corregirlo es requisito del plan 2,
no de este spec, pero queda anotado aquí porque se descubrió midiendo.

## Verificación

El repo no tiene tests de aplicación. `npm test` cubre `scripts/lib/` y
`frontend/src/services/`.

Con `node --test`, extendiendo los 8 tests que ya existen sobre el PDF real:

- Los encabezados que en el PDF van en negrita salen con `negrita: true`.
- El cuerpo lleva 18 figuras, no 96 imágenes.
- Los artefactos quedan fuera del cuerpo.
- La página apaisada se marca como apaisada.

Sobre `docxWriter`, con HTML controlado de entrada:

- El zip trae las partes esperadas.
- `document.xml` es XML bien formado y parseable.
- El texto está, y hay `w:b` donde corresponde.
- Existe una relación por imagen.
- Extremo a extremo desde el PDF real: el zip trae 18 archivos en `word/media/`.

Manual, sin alternativa: abrir el `.docx` en Word junto al PDF y comparar portada, tabla de
contenido, sección apaisada, encabezado con el logo una sola vez, numeración y negritas.
Contar las páginas del `.docx` contra las 112 del PDF y **reportar la diferencia**, en lugar de
suponer que cuadra.

## Riesgos conocidos

En orden de probabilidad:

1. **La repaginación de Word desplaza el calco.** Es el riesgo real de este diseño y no tiene
   mitigación completa. Lo que sí se puede es medirlo y reportarlo.
2. **Fuentes ausentes.** El propio PDF avisa que `CenturyGothic` no está instalada. Se nombra
   la fuente y Word sustituye si falta, lo que cambia la métrica y agrava el punto 1.
3. **Emparejamiento figura↔dibujo por `bbox`** puede fallar con figuras superpuestas. Los no
   emparejados se reportan.
4. **Celdas combinadas**, ya declarado.
5. **Cambio de formato para el equipo.** Daniel y Pablo tocan este flujo. Pasar de `.doc` a
   `.docx` hay que avisarlo, no que lo descubran.

## Alcance

Entra: extractor enriquecido, `docxWriter`, cambio del botón de descarga, puesta en uso del
almacén de anexos.

No entra: el marcado por campos con nombre (plan 2 del spec anterior), las celdas combinadas,
la paridad con el monolito `index.html`, MHTML.

## Orden de ejecución

**El plan 2 va primero.** Este spec entrega la forma; mientras el plan 2 no esté hecho, el
documento sigue mutando por literales de End Game. Un calco impecable sobre datos que se
filtran del cliente anterior es un documento peor, no mejor: se vuelve más convincente sin ser
más correcto, y se radica ante la DIAN.
