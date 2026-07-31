# Plantilla marcada e imágenes persistentes desde el informe de referencia

## Origen

Al generar el Informe Local de Precios de Transferencia, la aplicación React parte de una
plantilla y sustituye los datos del cliente activo. Hoy eso tiene tres fallas encadenadas:
las imágenes del documento de referencia se pierden, la sustitución es por valor literal y
filtra datos del cliente anterior, y la plantilla es un archivo fijo que no se puede derivar
del informe real de cada cliente.

### Hallazgos de la exploración previa

Todos verificados contra el repositorio y contra el PDF de referencia
`Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf`.

| # | Hallazgo | Efecto sobre el diseño |
|---|---|---|
| 1 | Las imágenes se pierden **al recargar la página**, no al leerlas | `ReporteGenerador.jsx` guarda el HTML en `useState`; no hay persistencia. Confirmado por un compañero del equipo: en Word **sí se ven**, así que el formato de exportación actual sirve y no hace falta MHTML. |
| 2 | El PDF de referencia trae **20 imágenes**: 2 logos (~11 KB), 16 páginas escaneadas del anexo EEFF firmado (3.6 MB) y 3 sin identificar (225 KB) | Los dos grupos tienen ciclos de vida opuestos. El anexo es específico del año 2024 y no debe arrastrarse a un informe de 2025. |
| 3 | `exactTemplateMapper.js` sustituye **por valor literal**, no por marcador | De 16 cifras de siete o más dígitos en la plantilla, 10 tienen regla y **6 no**. Un informe generado para otro cliente sale hoy con el NIT de End Game y cinco cifras financieras suyas. Detalle en la fase 0. |
| 4 | El PDF de referencia está **etiquetado** (`/StructTreeRoot`, `/Marked true`) | Lleva estructura semántica, así que reconstruir la plantilla desde él es viable vía `getStructTree()`. Para PDFs sin etiquetar habrá que degradar. |
| 5 | `pdf.js 3.11.174` está vendorizado en `public/vendor/` pero **no es dependencia de `frontend/`** | Hay que agregarlo al proyecto React. Expone `getStructTree` y `paintImageXObject`, que es lo que hace falta. |
| 6 | `masterTemplate.js` ya contiene `<img src="IMAGE_PLACEHOLDER" />` | Alguien se topó antes con este problema y dejó el hueco marcado. |
| 7 | `frontend/src/services/exactTemplateMapper.js` lo extendió Daniel el 2026-07-30 (bloque de composición accionaria, commit `0ffdab2`) | Este spec lo retira. Requiere avisarle antes de empezar y absorber su lógica de accionistas en el vocabulario de campos. |

## Alcance

Entra: extracción de PDF de referencia (estructura e imágenes), marcado asistido por IA con
confirmación humana, persistencia en IndexedDB, y un renderizador que sustituye por nombre de
campo en reemplazo de `exactTemplateMapper.js`.

No entra: paridad con el monolito `index.html`, que mantiene su propia ruta de generación.
Tampoco la purga de datos de End Game ya presentes en informes generados anteriormente.

## Decisiones tomadas

| Decisión | Elegido | Descartado |
|---|---|---|
| Aplicación destino | App React (`frontend/`) | Monolito; ambas |
| Anexo EEFF del año anterior | Conservar como **hueco marcado** con aviso si no se rellena | Reinyectarlo tal cual; ignorarlo |
| Alcance de la estructura | Plantilla completa desde el PDF | Solo posición de imágenes; solo índice de secciones |
| Fuga de datos entre clientes | Se arregla **primero**, antes que lo demás | Después; en otro spec |
| Técnica de sustitución | Marcado asistido por IA, confirmado por el usuario | Anclas por valor conocido; heurística manual |
| NIT de referencia distinto al del estudio | **Avisar** y dejar continuar | Bloquear; no comprobar |
| Almacenamiento | IndexedDB | localStorage (tope ~5 MB, ya ocupado por los estudios) |
| Ciclo de vida de los recursos | Viven mientras viva el estudio | Borrado tras generar |
| Formato de exportación | Se mantiene HTML con namespaces de Office como `.doc` | MHTML — descartado tras confirmarse que las imágenes sí se ven |

---

## Diseño

### 0. Cierre inmediato de la fuga

**Va antes que todo lo demás y se entrega por separado.** El resto del diseño cierra la fuga
por construcción, pero solo cuando `plantillaRenderer.js` sustituya al mapper viejo, es decir
al final. Hasta entonces cada informe generado para un cliente distinto de End Game seguiría
saliendo con su NIT.

Se agregan a `exactTemplateMapper.js` reglas para las seis cifras hoy huérfanas:

| Cifra | Apariciones | Qué es | Campo del estudio |
|---|---|---|---|
| `901.337.576` | 1 | NIT de End Game, escrito como `901.337.576-6` | `nit` |
| `983.180.000` | 2 | Monto del ajuste de plena competencia | calculado por `adjustInfo` |
| `1.247.447.456` | 1 | Inversiones asociadas | `t_inv_assoc` |
| `4.703.375` | 1 | Intangibles | `t_intang` |
| `83.801.656` | 1 | Diferidos | `t_dif` |
| `206.129.230` | 1 | Total activos no corrientes | `t_act_nocurr` |

Los cuatro campos de EEFF **ya los captura `IngestaCifras.jsx`**; el mapper simplemente nunca
los consulta. No hay que tocar la ingesta.

**Los patrones deben delimitarse para no partir números más largos.** `247.447.456` y
`435.357.400` *parecen* cifras huérfanas si se busca sin delimitar, pero son la cola de
`1.247.447.456` y de `3.435.357.400`; reemplazarlas por separado corrompería ambas. Usar
`(?<![\d.])` y `(?![\d.])` alrededor de cada patrón. El NIT lleva además dígito de
verificación pegado (`-6`), que debe conservarse o recalcularse.

Es un cambio acotado sobre código existente.

No es la solución buena: sigue siendo sustitución por valor literal, y el próximo dato de End
Game que alguien agregue a la plantilla volverá a filtrarse. Es una contención mientras se
construye lo demás, y se retira junto con el archivo.

Verificación: generar un informe con un estudio cuyo NIT no sea el de End Game y comprobar por
búsqueda de texto que `901.337.576` no aparece en la salida.

### 1. Piezas

Todas en `frontend/src/services/`, siguiendo el patrón de `eeffParser.js` y
`excelOperationsParser.js`.

| Archivo | Responsabilidad |
|---|---|
| `pdfReferenceExtractor.js` | PDF → `{ html, imagenes[] }`. No conoce el dominio de PT. |
| `plantillaMarcador.js` | HTML → lista de marcas propuestas por IA. No escribe en disco. |
| `plantillaStore.js` | Persistencia en IndexedDB de plantilla y recursos. No conoce IA ni PDF. |
| `plantillaRenderer.js` | Plantilla marcada + estudio + recursos → HTML final. Reemplaza a `exactTemplateMapper.js`. |
| `RevisorDeMarcas.jsx` (componente) | Pantalla de confirmación de marcas. |

El marcado se paga **una vez por plantilla**, no por informe generado.

### 2. Extracción del PDF

`extraerReferencia(file) => Promise<{ html, imagenes }>`

Se agrega `pdfjs-dist` como dependencia de `frontend/`.

**Estructura.** Se recorre `page.getStructTree()` para obtener títulos, párrafos y tablas, y
se emite HTML con esa jerarquía. Si el PDF no está etiquetado (`getStructTree()` devuelve
`null`), se degrada a extracción de texto por `getTextContent()` y se informa al usuario que
la plantilla saldrá sin estructura de secciones.

**Imágenes.** Se obtienen de `page.getOperatorList()`, filtrando `OPS.paintImageXObject`. El
operador viene acompañado de la matriz de transformación, que da el **tamaño renderizado** de
la imagen sobre la página.

La clasificación usa esa superficie renderizada, no las dimensiones en píxeles:

- Cubre ≥ 80 % del área de la página → **página escaneada** → no se guarda; se emite un hueco
  `<div data-hueco="anexo_eeff" data-paginas="N">` en su posición.
- Cubre < 80 % → **recurso reutilizable** (logo, gráfico) → se guarda como imagen con su
  posición.

El criterio es la superficie y no los píxeles porque un logo en alta resolución puede tener
más píxeles que un escaneo mediocre, pero en la página ocupa una esquina. Sobre el PDF de
referencia esta regla separa correctamente los 2 logos de las 16 páginas del anexo.

Cada imagen conservada se emite como `{ id, dataUrl, anchoRenderizado, altoRenderizado,
pagina, orden }`.

### 3. Marcado asistido por IA

`proponerMarcas(htmlSeccion, vocabulario) => Promise<Marca[]>`
donde `Marca = { fragmento: string, campo: string, ocurrencia: number }`.

**El modelo no devuelve HTML.** Devuelve una lista de pares fragmento→campo, y las marcas las
aplica el código. Pedirle a un modelo que reescriba 112 páginas de HTML insertando `<span>`
garantiza que altere texto por el camino —una tilde, una cifra, un párrafo resumido—, y este
documento se radica ante la DIAN. Con la lista de pares, cada `fragmento` se verifica que
exista **literalmente** en el HTML antes de marcarlo; el que no exista se descarta y se
reporta. El documento original es intocable por construcción.

Las respuestas se parsean con el mismo criterio defensivo que usa el monolito: extraer el
primer objeto JSON balanceado, ignorando prosa o markdown alrededor.

**Vocabulario cerrado.** El modelo elige de una lista fija; no inventa nombres. Cubre
identidad (`ent`, `nit`, `direccion`, `ciiu`), vinculada (`vinc`, `pais_vinc`, `vinc_id`,
`vinc_tipo`), periodo (`anio`), operación (`operacion.monto`, `operacion.tipo`), estados
financieros (`eeff.efectivo`, `eeff.cxc`, `eeff.impuestos`, `eeff.ppe`,
`eeff.total_activo_corriente`, `eeff.total_activos`), rango (`rango.p25`, `rango.mediana`,
`rango.p75`, `rango.cumple`) y composición accionaria (`accionista.nombre`, `accionista.pais`,
`accionista.acciones`, `accionista.valor_capital`) — estos últimos absorben la lógica que hoy
vive en `exactTemplateMapper.js` y que Daniel añadió.

**Troceado.** El documento se marca por secciones, no en una sola llamada: 112 páginas no
caben en una petición. Las marcas se acumulan y los desplazamientos se resuelven contra el
HTML completo.

### 4. Revisión humana

`RevisorDeMarcas.jsx` muestra el documento con las marcas propuestas resaltadas y permite
confirmar, corregir el campo asignado, o eliminar una marca. Nada se guarda como plantilla
hasta que el usuario confirma.

Es el mismo patrón que el repositorio ya usa en la curación de comparables por IA: propuesta
automática, decisión humana.

### 5. Almacenamiento

`plantillaStore.js` sobre IndexedDB, base `pt-plantillas`.

| Almacén | Clave | Contenido | Tamaño típico |
|---|---|---|---|
| `plantillas` | `plantillaId` | HTML marcado + vocabulario usado | ~300 KB |

| `recursos` | `estudioId + ':' + recursoId` | Imágenes conservadas (logo, gráficos) | ~11 KB |
| `anexos` | `estudioId + ':' + anio` | EEFF del año en curso que rellena el hueco | MB |

`plantillaId` se deriva del PDF de referencia del que salió la plantilla (hash de su contenido),
no del estudio: como la plantilla es muy parecida entre clientes, dos estudios que carguen el
mismo documento de referencia comparten la plantilla marcada y no se vuelve a pagar el marcado.
Los recursos y el anexo, en cambio, van por estudio, porque son lo que cambia de un cliente a
otro.

Los datos del estudio siguen en `localStorage` bajo `pt:study:*`, sin cambios.

**Por qué IndexedDB y no localStorage:** el tope de localStorage ronda los 5 MB por origen y
ya lo ocupan los estudios. El anexo del PDF de referencia, solo, pesa 5.25 MB en base64.
Además `setItem` no falla limpio: lanza `QuotaExceededError` a mitad de la escritura y puede
dejar el estudio a medias.

**Ciclo de vida.** Los recursos viven mientras viva el estudio. Se borran cuando se borra el
estudio, o cuando se reemplaza la referencia de la que salieron. No se borran al generar: un
segundo intento —corregir una cifra y regenerar— obligaría a volver a subir el anexo.

### 6. Generación y guardas

`renderizar(plantilla, estudio, recursos) => string`

Sustituye cada `<span data-campo="X">` por el valor de `X` en el estudio, e inserta las
imágenes en sus posiciones. Tres guardas antes de entregar el archivo:

1. **NIT discrepante.** Se compara el NIT extraído de la referencia con el del estudio activo.
   Si difieren, aviso visible; la generación continúa.
2. **Hueco del anexo vacío.** Si no se ha subido el EEFF del año en curso, se avisa antes de
   generar. El informe sale igual.
3. **Campos marcados sin dato.** El valor se sustituye por un marcador visible y **se listan
   todos los campos vacíos** antes de generar. No se conserva el valor de la referencia:
   publicar la cifra del año anterior como si fuera la del año en curso es peor que dejar un
   hueco evidente.

---

## Verificación

El repositorio no tiene tests de la aplicación. `npm test` cubre solo `scripts/lib/`. Para
este trabajo:

- **Unitario, con `node --test`:** la clasificación de imágenes por superficie renderizada, la
  verificación de que un fragmento existe literalmente antes de marcarlo, y el renderizador
  con campos presentes, ausentes y repetidos. Son funciones puras y se prueban sin navegador.
- **Manual, contra el PDF real:** cargar `estudio pasado.pdf` y comprobar que se conservan los
  2 logos, que las 16 páginas del anexo producen un hueco y no se guardan, y que el HTML
  resultante conserva las secciones.
- **Manual, el criterio que motiva todo:** generar el informe, **recargar la página**, generar
  de nuevo y confirmar que las imágenes siguen ahí. Es el fallo original reportado.
- **Manual, en Word:** abrir el `.doc` generado y confirmar que las imágenes se ven. Ya
  verificado con el formato actual por un compañero del equipo; se repite tras el cambio.

## Riesgos conocidos

- **PDFs sin etiquetar.** La plantilla saldrá sin estructura de secciones. Se degrada y se
  avisa; no se intenta inferir jerarquía por tamaño de fuente.
- **Coste de la primera llamada.** Marcar un documento de 112 páginas por secciones tiene un
  coste real en tokens y tiempo. Se paga una vez por plantilla y queda guardado.
- **Marcas mal asignadas.** El modelo puede etiquetar una cifra con el campo equivocado. Por
  eso existe la revisión humana antes de guardar; sin ella el error se propagaría a todos los
  informes que usen esa plantilla.
- **Retirada de `exactTemplateMapper.js`.** Daniel lo extendió el 2026-07-30. Hay que avisarle
  antes de empezar. Mitigación posible durante la transición: conservarlo como ruta de
  respaldo cuando no exista plantilla marcada.
