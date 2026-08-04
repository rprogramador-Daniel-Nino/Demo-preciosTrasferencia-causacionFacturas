# El .docx real: OOXML en vez del dialecto HTML de Word

Revisa [`2026-08-01-calco-docx-desde-pdf-design.md`](2026-08-01-calco-docx-desde-pdf-design.md).
Sustituye sus secciones §4, §5, §7 y §8, y su decisión sobre `pizzip`. Todo lo demás de
aquel spec sigue vigente y no se repite aquí.

## Origen

Aquel spec eligió `.docx` real como formato de salida. Lo que se implementó fue el paso
intermedio: un `.doc` que es HTML con el dialecto de Office. Sirvió para llegar al contenido
correcto —texto, estructura, tipografía, imágenes en su sitio, mutación por campos con
nombre— pero la forma se quedó a merced del importador de HTML de Word, y ahí se pagaron
cuatro fallos seguidos que sólo se veían abriendo el archivo:

| Síntoma que reportó el usuario | Causa medida |
|---|---|
| "hay como mil hojas" (834) | 889 `<p>` colgando dentro de un `<tr>`. Word no puede tener un párrafo como hijo de una fila: lo saca, corta la tabla y abre otra. |
| "una página por cada separación entre párrafos" | Ninguna imagen llevaba tamaño y el CSS del `.doc` no tenía ni una regla de imagen. La figura de la página 11 medía 29,9 cm sobre papel de 21,6. |
| "los dos logos encimados" | El encabezado se imprimía en la portada, donde el informe no lo lleva, sobre el logo grande de la portada. |
| "difiere mucho del previsualizado" | El resaltado de pantalla se colaba en el archivo, y el `body` llevaba una caja de página web que peleaba con `@page`. |

Los cuatro están arreglados. El patrón es el que importa: **cada uno era el importador de HTML
de Word interpretando algo a su manera**, y ninguno se podía ver sin abrir Word. Con OOXML no
hay intérprete en medio: lo que se escribe es lo que hay.

El usuario lo pidió con esas palabras: *"vamos con el .docx real porque ya me tiene mamado ese
error de tener casi mil páginas"*.

## Hallazgos nuevos

| # | Hallazgo | Efecto |
|---|---|---|
| 1 | `pizzip` genera **sincrónicamente**: `generate({type:'blob'\|'nodebuffer'})`, y relee con `new PizZip(buf).file(p).asText()`. Es API de JSZip 2, no 3 | Sirve para *releer* el zip en los tests sin navegador |
| 2 | `docx` (npm) **no** está instalado | Añadirlo es una dependencia nueva, ~500 KB |
| 3 | No hay LibreOffice, ni poppler, ni pandoc en la máquina | **No se puede renderizar el `.docx` para mirarlo ni para contar sus páginas** |
| 4 | `lxml` sí está; el `validate.py` de la skill `docx` necesita además `defusedxml` | La validación XSD del OOXML sí es alcanzable |
| 5 | El extractor **no** emite orientación (0 referencias a `data-orientacion`), y el spec anterior midió 1 página apaisada de 112 | Falta para la sección apaisada |
| 6 | El almacén `anexos` existe y la subida de EEFF ya funciona (`study.eeffImages`, usado por `IngestaCifras` y `App`) | Las páginas del anexo ya se pueden insertar |

## Decisiones

| Decisión | Elegido | Descartado | Por qué |
|---|---|---|---|
| Cómo se escribe el OOXML | `docx` (npm) | OOXML a mano con `pizzip` | Ver abajo |
| Convivencia | **Dos botones**: `.docx` nuevo junto al `.doc` actual | Reemplazar el `.doc` | Decisión del usuario. Daniel y Pablo tocan este flujo, y permite comparar los dos con el mismo estudio |
| Saltos de página | **Salto duro** donde el PDF cambia de página | Dejar que Word reparta; fijar alturas | Decisión del usuario. Es el calco página por página que pidió desde el principio |
| Celdas combinadas | Pérdida declarada | Reconstruirlas por geometría | Ya decidido: el árbol no expone `ColSpan`/`RowSpan` |

**Sobre `docx` en vez de OOXML a mano.** El spec anterior eligió `pizzip` para no añadir
dependencias, y era razonable antes de tener la lista de trampas. A mano hay que escribir
`[Content_Types].xml`, los cuatro ficheros de relaciones, `styles.xml`, el `sectPr` de cada
sección, un `tblGrid` cuyos anchos sumen exactamente el ancho de la tabla, la guía de puntos
del índice y el intercambio de ancho/alto de la página apaisada. La skill `docx` documenta
esas seis como trampas conocidas —y otras seis—, que es una forma de decir que son donde
viven los errores. El coste es una dependencia de ~500 KB, isomorfa (`Packer.toBlob()` en el
navegador, `Packer.toBuffer()` en los tests). `pizzip` se queda, pero para releer el zip en
los tests, no para escribirlo.

**Sobre el conteo de páginas, que corrige una promesa mía.** Al presentar el diseño dije que
al generar se contarían las páginas resultantes contra las 112 y se avisaría de la diferencia.
**No se puede**: cuántas hojas produce un `.docx` sólo se sabe renderizándolo, y en esta
máquina no hay con qué. Lo que sí se afirma, y con un test, es que **el documento declara 112
saltos de página**. El aviso al usuario dirá eso —"el documento declara 112 páginas; si algún
contenido no cabe, Word desborda a hojas extra"—, no un número que no se ha medido.

---

## Diseño

### 1. Piezas

| Archivo | Estado | Responsabilidad |
|---|---|---|
| `docxWriter.js` | nuevo | HTML enriquecido + recursos → `.docx`. No conoce el PDF ni precios de transferencia |
| `estiloDocumento.js` | se extiende | Sigue siendo la fuente única de medidas y estilo. Gana las medidas en twips que necesita OOXML |
| `pdfReferenceExtractor.js` | se extiende | Emite `data-orientacion` por página. Sube a versión 8 |
| `ReporteGenerador.jsx` | se ajusta | Botón nuevo `.docx`, junto al `.doc` |

```
HTML final + recursos + anexo ──► docxWriter ──► informe.docx
                                      ▲
                     estiloDocumento (HOJA, reglas)
                                      │
                       la misma fuente que pinta el previo
```

Que `docxWriter` reciba HTML y devuelva un zip sin saber de dónde vino es lo que lo hace
probable con `node --test`, y es la lección de esta sesión: los cuatro fallos de arriba vivían
en el único trozo que no tenía tests porque necesitaba Word.

### 2. La paridad, que es lo pedido

El previo ya dibuja hoja carta con los márgenes del informe, la tipografía del PDF y el tamaño
real de cada imagen. El writer no vuelve a decidir ninguna de esas cosas: las lee de
`estiloDocumento` y del propio HTML.

`estiloDocumento` gana las mismas medidas en la unidad de OOXML (1 cm = 566,93 twips):

| | previo (CSS) | `.docx` (twips) |
|---|---|---|
| Hoja | 21,6 × 27,9 cm | 12240 × 15840 |
| Margen | 2,5 cm | 1417 |
| Pie | 2 cm | 1134 |
| Borde de encabezado | 1,25 cm | 709 |

Un test afirma que las dos descripciones son la misma hoja, igual que el que ya compara previo
↔ `.doc` regla por regla. Si alguien cambia una, cae.

### 3. Traducción del HTML

| HTML del extractor | OOXML |
|---|---|
| `data-estilo-base="Arial\|12"` | estilo por defecto del documento |
| `<div class="pagina" data-pagina="N">` | contenido + `PageBreak` entre páginas |
| `data-orientacion="apaisada"` | **sección nueva** con `PageOrientation.LANDSCAPE` |
| `<h1>`…`<h4>` | `HeadingLevel.HEADING_1`…`4` (los de serie: sin ellos el índice no los ve) |
| `<p>` | `Paragraph`, justificado |
| `<strong>` / `<em>` | `TextRun` con `bold` / `italics` |
| `<span style="font-family:X">` | `TextRun` con `font` |
| `<table>`/`<tr>`/`<td>`/`<th>` | `Table` con `columnWidths` **y** `width` por celda, las dos en `WidthType.DXA` |
| `<ul>`/`<li>` | `numbering` con `LevelFormat.BULLET` (nunca un `•` literal) |
| `<img data-recurso style="width:Xcm;height:Ycm">` | `ImageRun` con `type` y el tamaño del PDF |
| entrada del índice | `PositionalTab` con `leader: DOT`, no puntos literales |
| `<div data-hueco="anexo_eeff">` | la página del anexo subida, o el hueco marcado |
| `<span class="pt-valor">` | un run normal: el resaltado es de pantalla |

Encabezado en `header1.xml`, alineado al lado que dice `data-lado`. Si `data-desde-pagina` es
mayor que 1, `titlePg` y la portada sin encabezado. Pie con el campo `PAGE`.

### 4. Anexo

Los 15 huecos que ya deja el extractor se resuelven contra `study.eeffImages`. Si están
subidos, cada página del anexo entra en el sitio de su hueco. Si no, sale el hueco marcado con
su texto y el aviso previo, que ya existe. No se copian las páginas escaneadas del año
anterior: el informe se radica ante la DIAN, y un calco perfecto con los estados financieros
firmados del año equivocado dentro es peor que un hueco evidente.

### 5. Verificación

Con `node --test`, sin navegador, releyendo el zip con `pizzip`:

- El zip trae las partes esperadas y `document.xml` es XML parseable.
- El texto del informe está, y hay `w:b` donde el PDF tenía negrita.
- Una relación por imagen, y un archivo por imagen en `word/media/`.
- El `sectPr` describe la misma hoja que `HOJA`.
- El documento declara 112 saltos de página.
- La página apaisada abre su propia sección.
- Ninguna imagen declara un ancho mayor que la caja de texto.
- Extremo a extremo desde el PDF real, que es el test que ha atrapado todo esta sesión.

Validación XSD del OOXML con el `validate.py` de la skill `docx` (requiere `pip install
defusedxml`; `lxml` ya está).

**Lo que no se puede verificar aquí, y hay que decirlo:** no hay LibreOffice ni poppler, así
que el `.docx` no se puede renderizar ni contar sus hojas. Quien lo abre en Word sigue siendo
el usuario. Instalar LibreOffice cambiaría eso —permitiría renderizar, contar y comparar
contra el PDF antes de entregar— y está ofrecido, sin hacer.

## Riesgos

1. **La repaginación de Word desplaza el calco.** Es el riesgo de fondo del diseño y no
   desaparece con OOXML: el salto duro garantiza dónde empieza cada página, no que su
   contenido quepa. Lo que cambia es que ya no hay un importador de HTML añadiendo desbordes
   propios.
2. **Fuentes ausentes.** El PDF usa `Britannic` y `CenturyGothic`, que no están instaladas.
   Word sustituye, la métrica cambia y agrava el punto 1. No hay mitigación: incrustar fuentes
   de un PDF de un cliente no es viable ni legalmente claro.
3. **Celdas combinadas**, ya declarado.
4. **Dependencia nueva.** `docx` entra en el bundle del gestor.
5. **Cambio para el equipo.** Se resuelve con los dos botones, pero hay que avisarlo.

## Alcance

Entra: `docxWriter.js`, las medidas en twips en `estiloDocumento`, la orientación en el
extractor (versión 8), el botón nuevo, la inserción del anexo subido.

No entra: retirar el `.doc`, las celdas combinadas, incrustar fuentes, la paridad con el
monolito `index.html`, renderizar para verificar (depende de instalar LibreOffice).
