# Diseño — Exactitud del reemplazo de datos en el .docx, ANEXO A desde la ingesta y fallback Claude → Gemini

Fecha: 2026-08-10
Rama: `juandev`

## De dónde sale este diseño

Del informe realmente generado el 2026-08-10 a las 16:54 para END GAME INTERACTIVE
COLOMBIA S.A.S. (año gravable 2025). Se descomprimió el `.docx`, se volcaron sus 103
tablas a texto y se corrió el localizador de tablas del propio código contra su
`word/document.xml`. Cada afirmación de la sección siguiente está verificada contra ese
archivo o contra el código; las que no se sostuvieron están marcadas como tal.

## Estado verificado

### Las 22 tablas del motor OOXML no se aplicaron en esa corrida

El `.docx` no contiene ninguna firma de `generarTablaOoxml`: cero ocurrencias de
`outlineLvl w:val="9"`, de `w:w="9405"`, de `insideV w:val="none"` y de `FUENTE:`
emitido por esa función (las dos apariciones de `FUENTE:` del documento son texto de la
plantilla). Sin embargo, `localizarBloqueTabla` acierta **14 de 14** tablas operativas
contra ese mismo `document.xml` cuando se le pasan las opciones reales del código
(números 1, 2, 3, 12, 4, 5, 6, 8, 9, 10, 16, 17, 18, 19).

Conclusión: el archivo salió con un bundle anterior a la Fase 3, no con un fallo de
localización. **No es un defecto a corregir.** Lo que se ve en ese `.docx` son las tablas
de la plantilla con marcadores rellenados. Antes de tocar las tablas operativas hay que
re-exportar con el build actual.

Sí es un defecto que el fallo pueda pasar inadvertido: ver Bloque 1, punto de `avisos`.

### Defectos confirmados en el código

1. **`plantillaVocabulario.js:137` formatea porcentajes con el formateador de pesos.**
   `rango.p25`, `rango.mediana` y `rango.p75` devuelven `fmt(v)`, y `fmt` es
   `Math.round(v).toLocaleString('es-CO')`. Los percentiles son fracciones: `fmt(0.0432)`
   da `"0"`. Es la causa de todos los ceros del informe — Tabla 5, Tabla 18 y Tabla 20 con
   Percentil 25 / Mediana / Percentil 75 en `0`, y las narrativas que los citan («se ubica
   entre el percentil 25 (0) y (0), la mediana con (0)»). Corresponde `pctf`.

2. **La extensión a todas las apariciones es ciega** (`plantillaMarcador.js`, bloque
   «Extensión a todas las apariciones del mismo texto»). Cuando el modelo marca un
   fragmento una vez, el código lo marca en todas sus apariciones literales del documento.
   Consecuencias presentes en el informe generado:

   - `2024` → `{anio}`: las series históricas quedaron falseadas. «En 2023 el crecimiento
     mundial fue del 3,2 %. Para **2025** el crecimiento se mantuvo en 3,2 %. En **2025**
     el FMI prevé una desaceleración a 2,8 %». Igual en la bibliografía.
   - `Estados Unidos` → `{pais_vinc}`: «aranceles comerciales por parte de los **ESTADOS
     UNIDOS**» en plena prosa, en mayúsculas porque así viene el dato.
   - `cumple` → `{rango.cumple}`: «**CUMPLE**n con el propósito fundamental» — el
     fragmento cayó dentro de la palabra «cumplen».
   - El objeto social completo repetido tres veces en I.1 (como literales a] y b]) e
     incrustado en la conclusión: «generó una rentabilidad operacional relacionada con el
     **El objeto social, de la Saciedad consiste en…** de 4.985%».
   - Márgenes de comparables convertidos en `{rango.*}` y por tanto en `0`: MAXIMUM
     ENTERTAINMENT AB, NEPTUNE COMPANY y YOOZOO INTERACTIVE aparecen con MO = `0`.

3. **No hay noción de zonas del documento, y eso ya cruzó datos entre clientes.** En el
   ANEXO B, la ficha de estados financieros de **COLOPL, INC.** salió con las cifras del
   contribuyente: ventas netas 5.271.105.507, costo de los bienes vendidos 2.761.202.249,
   gastos operativos 294.255.770, activos totales promedio 2.179.479.687, cuentas por
   cobrar 578.289.605, EPP 114.783.610, efectivo 12.417.756 — mezcladas con valores reales
   de COLOPL que sobrevivieron (beneficio bruto 6.759.000.000, utilidad de operación
   −1.207.000.000). El ANEXO B es de las comparables: ningún campo del contribuyente
   debería poder marcarse ahí.

4. **El ANEXO A sale vacío porque depende de un centinela que la plantilla no trae.**
   `insertarImagenes` busca `@@ANEXO_EEFF@@`; el documento tiene cero ocurrencias. Las
   páginas ya ingestadas (`study.eeffImages`) nunca entran. El ANEXO B sí se ancla por su
   encabezado (`insertarImagenesAnexoB`); el A no tiene equivalente.

5. **Los fallos del sustituidor de tablas son mudos.** `renderizarDocx` llama a
   `actualizarTablasMacroOoxml` y a `actualizarTablasOperacionesOoxml` sin pasarles el
   arreglo `avisos`, que es exactamente el mecanismo que `sustituidorDeTablas` documenta
   para que una tabla no se quede con los datos del informe anterior en silencio.

6. **La Tabla 20 «Tabla de rangos» es inalcanzable.** Verificado: `localizarBloqueTabla`
   devuelve `null` para ese nombre. Su título vive dentro de la primera fila de la tabla, y
   el localizador exige un párrafo de título seguido de `<w:tbl>`. El código cae al camino
   alterno («Rango Intercuartil» nº 18), así que la Tabla 20 del final del informe se
   radica con los datos viejos.

7. Menores, del mismo informe: la fila «Total» de la Tabla 6 sale con 4 celdas contra una
   cabecera de 5, desalineada; las viñetas de «Obligaciones de contratista / de contratante
   / Derechos» del contrato están vacías; falta el Gráfico 1 (organigrama).

8. Desajuste de nombre detectado al revisar: el vocabulario etiqueta `t_op` como «Gastos
   operacionales», mientras `eeffParser.js:173` lo llena con `utilidad_operacional`. El
   dato es la utilidad operacional; la etiqueta miente.

## Los cuatro bloques

El orden es el de implementación. El Bloque 1 y el Bloque 4 son independientes entre sí y
del resto, y pueden entregarse primero.

### Bloque 1 — Correcciones de exactitud

- `fmt` → `pctf` en `rango.p25`, `rango.mediana`, `rango.p75`. Además, auditar el
  vocabulario completo en busca del mismo error de formateador cruzado: una fracción
  formateada como pesos o un monto formateado como porcentaje.
- Corregir la etiqueta de `t_op` para que diga lo que el dato es.
- `renderizarDocx` pasa un arreglo `avisos` a los dos actualizadores y `rellenarDocx` lo
  devuelve, para que `ReporteGenerador` pueda listar «estas tablas no se encontraron en tu
  plantilla». Sin esto, una tabla no sustituida se radica con datos del año anterior sin
  que nadie lo note, que es el fallo que el propio módulo dice querer evitar.
- `localizarBloqueTabla` aprende el caso «el título es la primera fila de la tabla», que es
  como la plantilla trae la Tabla 20. El `document.xml` del informe de End Game sirve de
  fixture.
- Fila «Total» de la Tabla 6 con las cinco celdas que exige su cabecera.

### Bloque 2 — Zonas del documento y guardas de extensión

**Zonas.** Se derivan de los encabezados que el informe ya trae, sobre la lista ordenada de
párrafos que produce `htmlParaMarcar`:

| Zona | Regla de marcado |
|---|---|
| I, II, IV, V, VI, VII (cuerpo) | normal |
| III. Tendencias de la economía | prohibido: lo regenera `actualizarTablasMacroOoxml` y la prosa viene de `ia.economia_*` |
| ANEXO A | prohibido: lo regenera el Bloque 3 |
| ANEXO B y ANEXO C | prohibido para campos del contribuyente: son de las comparables |
| ANEXO D y ANEXO E | prohibido: metodología y legislación, texto fijo |
| Párrafos de cita (`^\d+\s` + autor + URL) | prohibido |

**Guardas de extensión.** La extensión se conserva —resuelve un problema real y medido: la
razón social sobrevivía 31 veces sin marcar— pero deja de ser ciega:

- Coincidencia con límites de palabra. Esto solo ya elimina `CUMPLEn`.
- No se extiende un fragmento que sea un año de cuatro dígitos ni un número suelto. El año
  se marca únicamente donde el modelo lo pidió y con contexto que lo respalde («31 de
  diciembre de», «año gravable», «periodo fiscal»).
- No se extiende un fragmento corto y poco distintivo: hace falta longitud mínima, o tres
  palabras o más, o un identificador reconocible (NIT, dígitos largos, mayúsculas
  internas).
- La extensión respeta las zonas: nunca cruza a una prohibida.
- Todo lo que una guarda bloquea se cuenta y se publica junto a `descartadas`, con el mismo
  criterio que el módulo ya aplica: un bloqueo silencioso es peor que uno visible.

**Las tablas de datos dejan de llevar marcadores.** Se regeneran completas desde el estudio
—la Fase 3 ya lo hace—, así que marcar sus celdas solo abre la puerta a que un número del
ANEXO B se convierta en `{t_s}`. El marcado queda limitado a la prosa.

> **Corrección al implementar (2026-08-10).** No hizo falta ningún mecanismo nuevo para esto,
> y añadirlo habría hecho daño. Las 22 tablas del motor se sustituyen **enteras y antes** de
> que docxtemplater resuelva los marcadores, así que lo que hubiera dentro de ellas
> desaparece con la tabla: la regla ya se cumple sin código. Y las tablas que el motor no
> regenera —Competencia nacional, Fuentes de Información, Códigos SIC— **necesitan** sus
> marcadores, porque son la única vía por la que se actualizan; prohibir el marcado dentro
> de toda tabla las habría congelado con los datos del cliente anterior. Los dos riesgos que
> este punto perseguía quedan cubiertos por lo demás del bloque: las cifras del contribuyente
> dentro del ANEXO B, por las zonas; los años de las ventanas de búsqueda de los Códigos
> SIC, por la guarda de contexto del año.

### Bloque 3 — ANEXO A desde la ingesta

- `insertarAnexoA(zip, estudio)`, con el mismo anclaje por encabezado que ya funciona en
  `insertarImagenesAnexoB`: localizar «ANEXO A», cerrar en «ANEXO B». Deja de depender del
  centinela `@@ANEXO_EEFF@@`, que se mantiene como camino alterno si la plantilla lo trae.
- **ESF nativo** con los rubros que la ingesta ya parsea: `t_cash`, `t_inv_assoc`, `t_ar`,
  `t_tax`, `t_act_curr`, `t_ppe`, `t_intang`, `t_dif`, `t_act_nocurr`, `t_act_tot`, más
  `t_inv` y `t_ap`. El A.V. se calcula sobre `t_act_tot` con **la misma función** que usa la
  Tabla 10, en un solo sitio, para que no puedan divergir.
- **ERI nativo** con `t_s`, `t_c`, la utilidad bruta derivada, los gastos operativos y
  `t_op`, y la línea del ajuste excluido (`seg_excluido`) explícita: es lo que sostiene el
  margen que el informe declara.
- Debajo, las páginas del PDF (`study.eeffImages`) como soporte. Sin cifras parseadas, va
  el párrafo «Pendiente» en rojo que el ANEXO B ya usa; sin imágenes, las tablas salen
  igual.

### Bloque 4 — Fallback Claude → Gemini

Va en el proxy, no en el frontend: hay 14 llamadas a `/api/claude` (13 en `index.html`, 1
en `descripcionComparables.js`) y todas se benefician sin tocarlas. Los payloads son
simples —`model`, `max_tokens`, `messages`— sin `system`, sin `tools` y sin streaming, así
que la traducción es corta y completa.

- Se dispara cuando Anthropic responde crédito agotado (400 o 402 con `credit balance`) y,
  configurable, en 429 y 529.
- Traduce la petición a Gemini (`messages` → `contents`, `max_tokens` →
  `generationConfig.maxOutputTokens`) y devuelve la respuesta **con forma de Anthropic**
  (`{content:[{type:'text',text}]}`), para que ningún llamador note el cambio.
- Señala qué proveedor atendió, en la respuesta y en el log. Un informe redactado por otro
  modelo sin que nadie lo sepa no es aceptable en un documento que se radica ante la DIAN.
- Se implementa en las **tres** implementaciones paralelas del proxy, como exige el
  CLAUDE.md: `server.js`, `functions/index.js` y `Cpanel/public_html/api/*.php`.

## Verificación

`npm test` al 100 % en verde por bloque; la suite cubre `frontend/src/services/`,
`frontend/src/utils/`, `scripts/lib/` y `functions/`. Cada defecto de la lista anterior
entra con su prueba antes del arreglo.

Lo que las pruebas no alcanzan y queda como verificación manual: que Word abra el `.docx`
resultante sin quejarse, y el cotejo visual del informe exportado. Es la misma limitación
que ya documenta `docxRelleno.js`.

## Fuera de alcance

- Las viñetas vacías del contrato y el Gráfico 1 (organigrama): son datos que hoy no se
  capturan en ningún punto de ingesta. Requieren decidir primero dónde se cargan.
- Reescribir el motor de comparables o el de rango, que quedaron unificados en la Fase 0.
- `index.html`, salvo el fallback del Bloque 4, que es del lado del servidor y no toca ese
  archivo.
