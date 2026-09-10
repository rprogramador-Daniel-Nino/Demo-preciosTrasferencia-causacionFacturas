# Plan: dejar de mezclar texto viejo con texto nuevo cuando la plantilla es un informe real de otro año

## El problema, en una frase

Cuando alguien sube como "plantilla" un informe YA RADICADO de un año anterior (en vez de la
plantilla en blanco del sistema), el generador **sí redacta el texto nuevo y lo mete en el
documento, pero no siempre borra el texto viejo** — y el resultado son dos años de cifras
conviviendo, contradiciéndose, bajo el mismo título.

## Cómo lo comprobamos

Nos diste dos casos reales para revisar: el informe de **Ferretería Andrés Martínez** (plantilla
2021 → resultado 2025) y el de **Sungrow** (plantilla 2024 → resultado 2025). Abrimos los cuatro
`.docx` y comparamos línea por línea qué escribió el sistema.

### Caso Ferretería: la prueba más clara

En "Análisis del Panorama de la Economía Mundial", el sistema escribió correctamente esto:

> *"El panorama de la economía mundial muestra un comportamiento dinámico... Durante los años
> 2024 y 2025, el PIB global mantuvo... una tasa de variación anual del 3.5%... Para el año
> 2026... 3.0%... Para el año 2027... 3.4%..."*

Y **inmediatamente después, sin borrar nada**, seguía el texto de la plantilla de 2021:

> *"Durante el año 2021, la economía mundial estuvo a la expectativa por la recuperación de las
> condiciones previas a un acontecimiento... tal como lo fue la pandemia del COVID-19..."*

Con su propia tabla de PIB con datos "2016-I / 2021-IV" debajo. Lo mismo pasó en
"Análisis del panorama de la economía colombiana". El informe que se radicaría mezcla 2025-2027
con 2021 en el mismo párrafo.

### Por qué pasa: el sistema es demasiado cauteloso

El generador busca el texto nuevo apoyándose en unos **rótulos internos** que la plantilla en
blanco del sistema sí trae (por ejemplo «PIB Mundial», «Inflación Global», «Tasa Representativa
del Mercado»). Cuando encuentra esos rótulos, borra lo que había entre ellos y pone el párrafo
nuevo en su lugar — eso funciona bien y no lo estamos tocando.

El problema es cuando la plantilla **no trae esos rótulos** porque es un informe real, redactado
en prosa corrida, con subtítulos distintos ("Producto Interno Bruto (PIB)" en vez de «PIB
Mundial», "Inflación:" en vez de «Inflación Global», etc.). Ahí el sistema sí reconoce los
títulos GRANDES de sección ("Análisis del Panorama de la Economía Mundial") pero no los rótulos
de adentro — y por diseño, cuando no puede delimitar con precisión dónde empieza y termina un
tema, **prefiere insertar el texto nuevo al lado sin borrar nada**, para no arriesgarse a borrar
algo que sí debía quedarse. Esa cautela, que tiene sentido en otros casos, es la causante de la
mezcla.

Lo mismo le pasa a **III.C (Análisis del Sector)**, con el agravante adicional de que ahí el
análisis del sector ni siquiera se pudo generar esta vez (ver más abajo).

### Caso Sungrow: confirma que el diagnóstico es correcto y acota el alcance

La plantilla de Sungrow (2024) es distinta: es un informe que el propio sistema generó antes, así
que ya trae los rótulos internos correctos. Por eso ahí **no hay mezcla de texto viejo y nuevo en
Mundial/Colombia** — el mecanismo actual ya funciona bien cuando la plantilla viene del propio
sistema. Confirma que el problema aparece específicamente cuando alguien sube un informe real
"crudo" (de otro sistema, u otro año sin pasar por acá) como punto de partida — que es justamente
lo que tú hiciste con Ferretería, y algo que claramente vuelve a pasar (es un flujo de trabajo
real, no un caso aislado).

Sungrow también nos mostró dos cosas más, que van dentro de este mismo plan por ser del mismo
mecanismo:

1. **Un descuadre concreto y chico**: para el título "Análisis del Sector"/"Análisis en el
   Sector", el sistema lo busca de una forma en el bloque de Colombia y de OTRA forma (más
   flexible) en el bloque de III.C. Sungrow tituló esa sección "Análisis EN el sector de energía
   eléctrica" — pasa la revisión flexible de III.C pero falla la revisión estricta de Colombia,
   así que sale un aviso de "no encontrado" que no debería salir. Se arregla usando la misma
   lista en los dos sitios.
2. **Avisos de tablas de comparables que no son culpa de la plantilla**: "Operaciones de Ingreso",
   "Razones de rechazo", "Muestra Compañías comparables", etc. — estos avisos NO significan que
   la plantilla esté mal escrita. Significan que **el estudio todavía no tiene comparables
   cargadas** (falta correr el motor de comparables en el paso 3). Hoy el mensaje no distingue
   "no encontré dónde poner esto en tu plantilla" de "sé dónde ponerlo pero no tengo con qué" —
   y eso hace pensar que hay que corregir la plantilla cuando en realidad hay que correr el
   motor. Se corrige el texto del aviso para que diga la causa correcta.

## Qué se va a cambiar

### 1. Borrar el texto viejo cuando se reconocen los dos extremos de una sección (decisión tuya, ya confirmada)

Cuando el sistema reconoce el título que ABRE una sección y el título que la CIERRA, pero ninguno
de los rótulos de adentro, en vez de insertar el texto nuevo al lado sin tocar nada, **va a borrar
todo lo que hay entre esos dos títulos reconocidos y poner ahí la narrativa nueva completa**.

Aplica a los tres bloques: Panorama Mundial, Panorama Colombia y Análisis del Sector (III.C) — los
tres tenían el mismo problema.

**Límite de seguridad, confirmado contigo**: el borrado NUNCA se sale de la sección. Por ejemplo,
"TENDENCIAS DE LA ECONOMÍA" (el título general que viene ANTES de "Análisis del Panorama de la
Economía Mundial" en el informe de Ferretería 2021) y la tabla de fuentes que trae debajo jamás se
tocan — el borrado siempre arranca exactamente en el primer título de la sección que se está
procesando, nunca antes. Vamos a agregar una prueba automática específica con el texto real de
Ferretería para dejar esto comprobado, no solo prometido.

**Si dentro de esa zona hay una tabla** (por ejemplo el gráfico viejo de PIB 2016-2021), no se
borra a ciegas junto con el texto: se identifica aparte y se reemplaza por la tabla nueva con los
datos de Firestore (ver punto 2) en vez de desaparecer sin más.

**El riesgo que aceptamos, con los ojos abiertos**: si la plantilla tiene, en esa misma zona,
algún párrafo que no sea sobre el tema esperado (algo que el analista haya agregado a mano y que
no encaje en PIB/inflación/tasa de cambio/etc.), ese párrafo también se borraría, porque el
sistema no tiene forma de distinguirlo del resto del texto viejo. Fue tu decisión aceptar este
riesgo porque el problema que resuelve —informes que salen con años mezclados y contradictorios—
es más grave que este riesgo menor. Lo dejamos escrito aquí para que quede constancia de que se
evaluó y se decidió conscientemente.

*Nota técnica para quien lo lea con ojo de programador: esto generaliza la función
`resolverAnclasDeHuecos` de `docxRelleno.js` (compartida también por la ruta HTML,
`tablasHtmlInforme.js`) para que una racha de rótulos ausentes, cuando está delimitada por dos
rótulos SÍ encontrados, se trate como una sola región reemplazable en vez de varias inserciones
sueltas. Cuando solo hay UN extremo encontrado (o ninguno), el comportamiento de hoy no cambia:
sigue insertando sin borrar, o sigue sin tocar nada si no hay ninguna referencia cercana.*

### 2. Tablas viejas (PIB Mundial, PIB en Colombia, Datos Clave del Sector, etc.): también se reemplazan, no solo el texto

Hoy, si el sistema no encuentra una tabla por su nombre exacto en la plantilla, simplemente la
deja como está — la tabla vieja de 2021 se queda para siempre, sin aviso claro de que sigue
desactualizada. Vamos a hacer que, en esos casos, el sistema **busque la tabla vieja que quedó
"suelta" en la zona que acaba de reescribir y la reemplace por la tabla nueva, construida con los
datos guardados en Firestore** (los mismos datos que ya usa para redactar el texto — no hay que
buscar nada nuevo, solo usarlo también para la tabla).

Si hay más de una tabla candidata en esa zona y no es claro cuál corresponde a cuál, el sistema no
adivina: deja el aviso de siempre en vez de arriesgarse a reemplazar la tabla equivocada.

### 3. Corregir el mensaje "No se encontró en la plantilla" cuando sí se encontró (o sí se generó)

Hoy, CUALQUIER aviso de este tipo aparece con el prefijo "No se encontró en la plantilla: " —
incluso cuando el aviso mismo explica que el contenido SÍ se generó y se insertó (solo que hay que
revisar dónde quedó). Eso es lo que te hizo pensar que el sistema no había hecho nada, cuando en
varios casos sí había hecho algo.

Vamos a que cada aviso traiga su propia frase completa y correcta, y quitar el prefijo genérico.
Con el cambio del punto 1, además, muchos de estos avisos van a dejar de aparecer del todo (porque
ahora sí se reemplaza en vez de solo insertar) — los que queden van a decir exactamente qué pasó:

- Si de verdad no se encontró nada → sigue diciendo que no se encontró.
- Si se reemplazó una sección completa → un mensaje nuevo, tipo "no se encontró el rótulo «X»,
  pero sí los que lo rodean: se reemplazó toda esa zona con la narrativa nueva — revísala antes de
  radicar" (para que sepas que sí hubo cambio, aunque conviene mirarlo).
- Si el problema es que el ESTUDIO no tiene comparables cargadas (el hallazgo de Sungrow) → un
  mensaje que diga eso, no que la plantilla esté mal escrita.

### 4. El descuadre chico de Sungrow: un solo nombre para "Análisis del Sector"

Se unifica la lista de formas aceptadas de ese título (hoy vive duplicada, una vez estricta y otra
vez flexible) para que no dependa de en qué bloque del código se esté buscando.

## Qué NO entra en este plan (y por qué)

- **Redesplegar la función `generarAnalisisSector`** (el error "The default Firebase app does not
  exist" que impide generar III.C esta vez). Confirmamos con los registros reales de producción
  que el código ya trae el arreglo desde el 4 de agosto, pero el último intento de despliegue de
  esa función se canceló el 28 de agosto — así que producción sigue corriendo una versión vieja.
  No es un cambio de código, es volver a desplegar. Se hace aparte, apenas termines de revisar
  este plan.
- **El motor de comparables sin datos** (Operaciones de Ingreso, Razones de rechazo, Muestra de
  comparables, etc. en el caso Sungrow). No es un bug: es que a ese estudio le falta correr el
  motor de comparables (paso 3). Ya corregimos el mensaje para que lo diga claramente (punto 3),
  pero no hay nada que arreglar en el código de plantillas.
- **Frases con cifras que no calzan** ("la frase que comenta el rango se encontró, pero ninguna de
  sus cifras está donde se esperaba", "no se encontró el año del período fiscal", etc.). Es un
  mecanismo totalmente distinto (busca frases de redacción legal fija y luego números/años
  adentro de ellas, en otros archivos: `prosaTablasInforme.js`, `prosaBaseDatos.js`,
  `anioPeriodoOoxml.js`). No tiene relación con el problema de rótulos/plantillas de este plan.
  Si quieres, lo diagnosticamos como plan aparte.

## Archivos que se tocan

- `frontend/src/services/docxRelleno.js` — el motor principal (ruta que edita el `.docx` real del
  cliente en el sitio; es la que usaron tanto Ferretería como Sungrow).
- `frontend/src/services/tablasHtmlInforme.js` — su versión gemela para la otra ruta de generación
  (HTML → Word); según las reglas del proyecto, las dos rutas deben mantenerse sincronizadas.
- `frontend/src/services/tablasInforme.js` — de aquí salen los nombres y datos de las tablas.
- `frontend/src/services/semaforoRadicacion.js` — arma la lista de avisos que ves en pantalla.
- `frontend/src/components/ReporteGenerador.jsx` — tiene su propia versión del mismo mensaje
  (mismo defecto, mismo arreglo).
- Sus archivos de prueba correspondientes (`docxRelleno.test.js`, `tablasHtmlInforme.test.js`,
  `semaforoRadicacion.test.js`).

De las pruebas que ya existen hoy: 3 quieren decir lo contrario de lo que ahora es correcto (hay
que cambiarlas a propósito, porque protegían justo el comportamiento que estamos cambiando), 1
solo tiene un comentario desactualizado, y 2 siguen siendo válidas tal cual porque prueban un caso
distinto (rótulos que sí se encuentran, solo con otra redacción).

## Cómo se va a verificar

1. `npm test` en verde (~2.480 pruebas) incluyendo las nuevas: una construida con el texto real
   de Ferretería 2021 (para comprobar que "TENDENCIAS DE LA ECONOMÍA" nunca se toca), otra para el
   caso mixto de III.C con dos rachas de rótulos ausentes por separado, y otra para el reemplazo
   de tablas.
2. Regenerar en vivo el informe de Ferretería (plantilla 2021) y confirmar a ojo en Word que ya no
   aparece texto ni tablas de 2021 mezcladas con las de este año, y que "TENDENCIAS DE LA
   ECONOMÍA" y su tabla de fuentes siguen intactas.
3. Regenerar en vivo el informe de Sungrow (plantilla 2024) y confirmar que ya no sale el aviso de
   "no se encontró el rótulo «Análisis del Sector»", y que los avisos de comparables ahora dicen
   claramente que falta correr el motor, no que la plantilla esté mal.

## Qué sigue después de que apruebes este plan

1. Implemento los cuatro cambios con pruebas (TDD: primero la prueba que falla, luego el código
   que la pasa).
2. Te aviso cuando `npm test` esté en verde para que decidas si regeneramos los dos informes reales
   antes de dar por cerrado esto.
3. Aparte, y en cuanto quieras, redesplegamos `generarAnalisisSector` para que III.C deje de
   fallar por el error de Firebase.
