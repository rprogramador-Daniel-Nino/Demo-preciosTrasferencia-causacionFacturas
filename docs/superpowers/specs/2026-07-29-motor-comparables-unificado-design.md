# Unificar el motor de selección de comparables y eliminar la lógica quemada a videojuegos

## 1. Problema

La tarjeta "Comparables" tiene, hoy, **tres mecanismos de selección/depuración distintos y desconectados** conviviendo sobre la misma tabla (`#cbody`):

1. **Motor TOP-N** (`motorEjecutar`/`moScore`/`moCfg`, `index.html:~3583-3899` y el panel "⚙ Motor de selección automática" en la tarjeta) — ya usa la actividad específica extraída con Gemini (`getActividadEspecifica()`, poblada por `extractPriorActivityWithGemini()`, `index.html:2252`) de forma genérica, sin nada quemado a ninguna industria.
2. **Motor FAR / Conjunto** (Bloques 5 y 6: `ptDerivarFAR`, `ptClasificarFAR`, `ptCribarUniverso`, `ptSeleccionarConjunto`, `ptAplicarSeleccion`) — clasifica candidatas por un sistema de roles hardcodeado a la industria de videojuegos (`ROLES`, `RX`, `COMPAT`), con un tamaño de conjunto fijo (`PT_CONJUNTO_CFG = {min:8, max:15, objetivo:10}`), y un panel propio ("Depuración Funcional de Comparables (FAR)") que se autoinyecta en la tarjeta 1.5s después de cargar la página.
3. **Afinidad de negocio por videojuegos** (Bloque 17 · Parte C: `construirPerfilNegocio`, `BASE_JUEGOS`, `ptAfinidadNegocio`, `ptPerfilNegocioInformeHTML`) — reordena el conjunto por afinidad textual usando un diccionario de términos de videojuegos que se mezcla siempre, y escribe una frase fija en el informe final afirmando que se privilegiaron candidatas de "desarrollo de videojuegos", sin importar la industria real del cliente.

### Consecuencias observadas

- **Bug reproducido:** el botón "Solucionar todo automáticamente en 1 clic" (`ptCorregirTablaAutomaticamente`, `index.html:13127`) ejecuta la cadena `ptCribarUniverso → ptSeleccionarConjunto → ptAplicarSeleccion`, que casi nunca deja más de 50 filas (su objetivo fijo es 10), por lo que **nunca llega a invocar `motorEjecutar()`**. La configuración del panel Motor TOP-N (N objetivo, excluir holding, geografía, etc.) se ignora por completo. Confirmado con captura: N=20 y "excluir holding" configurados, resultado final con 10 empresas incluyendo 3 con SIC 6719 (holdings).
- **Detección de holding poco confiable en ambos motores:** solo mira una regex de texto libre sobre la descripción de negocio; no usa el SIC 6719 (código estándar de EE.UU. para holdings) ni el nombre de la compañía.
- **Informe con secciones duplicadas y contradictorias:** "B. Resultado de la depuración" (categorías fijas de videojuegos, de `ptFARInformeHTML`) coexiste con "Anexo D — Matriz de aceptación y rechazo" (`annexRechazoD`, ya agnóstico y ya conectado al informe, `index.html:14270` y `14402`).
- **Frase falsa en el informe para cualquier cliente no-videojuegos:** `ptPerfilNegocioInformeHTML()` escribe siempre *"se privilegiaron las candidatas cuya actividad [...] hace referencia al desarrollo de videojuegos..."*, esté o no relacionado el estudio con esa industria.
- **Piezas legales genéricas mal ancladas:** el test de independencia societaria (Art. 260-1 E.T., accionista único >50%) y la tabla de "Verificación de los factores de comparabilidad (Art. 260-4 E.T.)" (Bloque 7) son funcionalidad real y necesaria, pero dependen hoy exclusivamente del motor FAR (`PT_CRIBA`), que se está eliminando.

## 2. Objetivo del cambio

Un solo motor de selección (el Motor TOP-N, ya agnóstico vía Gemini) gobierna toda la tabla de comparables — tanto la ejecución manual ("Ejecutar selección") como la corrección automática — de modo que no puedan existir dos filtros contradictorios. Se elimina toda la lógica de clasificación quemada a una industria. La funcionalidad legal genuinamente genérica que hoy vive, por error de ubicación, dentro del motor viejo, se traslada al motor unificado en vez de perderse.

## 3. Diseño

### 3.1 Extensiones a `moRows()` / `moScore()` (motor único)

- **Independencia societaria (Art. 260-1 E.T.):** `moRows()` añade `o.holders` leyendo `COMP_META[o.name].holders` (columna ya mapeada del Excel vía `SYN.holders`). `moScore()` excluye si `maxParticipacion(o.holders) > PT_CRITERIOS.independenciaTope` (hoy 50), reutilizando `maxParticipacion` (se traslada desde el motor viejo, `index.html:7954` en la numeración actual, sin reescribirla).
- **Holding reforzado:** `o.holding` pasa a ser `regex_descripción(desc) || /^6719/.test(o.sic) || /\bholdings?\b/i.test(o.name)`.
- **Bono de continuidad:** `moRows()` marca `o.previa` cruzando `(PT_ANTERIOR.comparables||[])` por `nameKey`. `moScore()` suma un bono fijo (+0.08) al puntaje final si `o.previa`, anotado en `raz` ("continuidad con el año anterior"). Es un plus aparte, no resta peso a los demás factores.

### 3.2 Flujo unificado de corrección automática

`ptCorregirTablaAutomaticamente()` se reescribe:

```js
window.ptCorregirTablaAutomaticamente = function () {
  if (!$('cbody').children.length) { moToast('No hay comparables cargadas.', 'red'); return false; }
  motorEjecutar(false);                    // usa moCfg() = la configuración real del panel
  if (!motorAplicarSeleccion()) { return false; }
  try { ptVerificarIndustriaTabla_yAplicar(); } catch (e) {}   // ver 3.3
  try { ptFiltrarAtipicos(); } catch (e) {}                    // genérico, no se toca
  moToast('Tabla corregida: ' + $('cbody').children.length + ' comparable(s) en el conjunto final.', 'green');
  return true;
};
```

Como el import (`importCompsFile`) ya vuelca todas las filas del Excel a `#cbody`, `motorEjecutar`/`moRows()` puntúan directamente sobre lo ya visible — no hace falta el universo paralelo (`CIQ_UNIVERSO`/`PT_CRIBA`) para esto.

### 3.3 Generalizar (no borrar) el guardián de industria

- `ptIndustriaExaminada()` / `ptPerteneceIndustria()` (`index.html:12941,12962`): en vez de `IND_DEFECTO` (videojuegos), construyen `positivas`/`sicAfines` a partir de `getActividadEspecifica().keywords/productos/sic`. Sin actividad cargada, se comportan igual que hoy (verificación manual, no bloqueante).
- `ptVerificarIndustriaTabla()` (`index.html:12979`) **no cambia** — ya opera sobre `#cbody` de forma agnóstica.
- La lógica del envoltorio hoy en `ptAplicarSeleccion` (`index.html:13003-13037`: remover filas ajenas a la industria sin bajar del mínimo `PT_CRITERIOS.minConjunto`) se traslada a una función `ptVerificarIndustriaTabla_yAplicar()` invocada justo después de `motorAplicarSeleccion()` en el flujo de 3.2.

### 3.4 Repuntar el Bloque 7 (factores de comparabilidad Art. 260-4)

`ptFactores260_4()` y `ptTestSuficienciaHTML()` (`index.html:9184,9276`) dejan de leer `PT_CRIBA`/`PT_SELECCION`/`PT_CONJUNTO_CFG` y pasan a leer `MOTOR`/`moCfg()`/`MATRIX`/`moRows()`. El ejemplo ilustrativo de 9 pasos (`index.html:9490-9502`) toma su compañía de ejemplo de `MATRIX`/`MOTOR.universo` y elimina el fallback literal "Desarrollador de videojuegos" (usa `getActividadEspecifica().resumen` o un texto neutro si no hay actividad cargada).

### 3.5 Repuntar `ptContextoCompleto()` (contexto para redacción con IA)

`index.html:10561`: los bloques "DEPURACIÓN DEL UNIVERSO" y "CONJUNTO DE COMPARABLES" (`10609-10615`) dejan de leer `PT_CRIBA`/`PT_SELECCION` y se arman desde `MATRIX` (universo/aceptadas/rechazadas/motivos) y `MOTOR.sel`/`moRows()` (lista de comparables finales, `o.previa`). El bloque "ANÁLISIS FUNCIONAL" (`10578-10590`) deja de leer `PT_FAR` y usa `getActividadEspecifica()`.

### 3.6 Informe: eliminar duplicados y la frase falsa

- `ptFARInformeHTML()` (`index.html:8549`): se borran las secciones "B. Resultado de la depuración" (duplica `annexRechazoD`, ya conectado) y "C. Verificación en fuentes públicas" (dependía de `ptVerificarEnWeb`, que se borra sin reemplazo — no existe hoy equivalente en el motor moderno; si se quiere esa función a futuro es una conversación aparte). La tabla de fundamento normativo (260-4, 260-1, OCDE, C.E.) se conserva, fusionada como introducción de la sección Art. 260-4 (Bloque 7). La sección "A. Perfil funcional de la parte examinada" se conserva como función pequeña independiente, repuntada a `getActividadEspecifica()`.
- **Bloque 17 · Parte C completo se elimina:** `PT_PERFIL_NEGOCIO`, `BASE_JUEGOS`, `TERMINOS`, `construirPerfilNegocio`, `ptConstruirPerfilNegocio`, `ptAfinidadNegocio`, el envoltorio de `ptSeleccionarConjunto` (`13852-13877`), y `ptPerfilNegocioInformeHTML` junto con su uso en el hook de `renderReport` (`13984-13999` — se retira solo `s6`, se conserva `s7 = ptOrigenCifrasComparablesHTML()`, que es genérica).

### 3.7 Limpieza de configuración huérfana

- `PT_CONJUNTO_CFG` y su sync en `ptGuardarCriterios` (`index.html:9162`) se eliminan.
- `PT_CRITERIOS.objetivoConjunto`/`maxConjunto` y sus inputs `ptc_objetivoConjunto`/`ptc_maxConjunto` (`index.html:9535-9536`) se eliminan (el tamaño ya lo gobierna `mo_n`).
- `PT_CRITERIOS.minConjunto` e input `ptc_minConjunto` (`9534`) **se conservan**, redefinidos como "tamaño mínimo defendible" — es el piso que usa `ptVerificarIndustriaTabla_yAplicar()` (3.3), ya no ligado a ningún tamaño objetivo.
- El panel autoinyectado "Depuración Funcional de Comparables (FAR)" (función `_ui()` en `index.html:8613` y su contenedor `ptFarPanel`) se elimina. Otros paneles que usan `ptFarPanel` como ancla de posicionamiento (`document.getElementById('ptFarPanel') || document.getElementById('compalert') || ...`, varios bloques) ya tienen su propio fallback (`compalert`, `cbody`, `ptConectorPanel`, `ptSelPanel`) y no requieren cambios — se verifica en pruebas que cada uno sigue apareciendo en su fallback correcto.

### 3.8 `ptGuardaInforme()` (el modal de la imagen 1)

El aviso "no consta la depuración del universo" deja de mirar `PT_CRIBA` y mira solo `MATRIX.length` (ya la llena `motorEjecutar`). La falla bloqueante "empresas fuera de industria" sigue igual, usando la versión generalizada de 3.3.

## 4. Inventario de símbolos (borrar / repuntar / no tocar)

**Se borran por completo** (sin reemplazo, código y toda referencia): `ptDerivarFAR`, `ptClasificarFAR`, `ROLES`, `COMPAT`, `gradoDe`/`ptGradoFAR`, el set `RX` (regex de videojuegos, Bloque 5), `PT_FAR` (el objeto y su derivación por regex — se sustituye conceptualmente por `getActividadEspecifica()`), `IND_DEFECTO` (el objeto literal; las funciones que lo usaban se generalizan, no se borran), `PT_CRIBA`, `PT_SELECCION`, `PT_CONJUNTO_CFG`, `ptCribarUniverso` (+ envoltorio Bloque 7), `ptSeleccionarConjunto` (+ envoltorio Bloque 17-C), `ptAplicarSeleccion` (la lógica de su envoltorio se traslada, ver 3.3), `ptVerificarEnWeb`, `ptAplicarCriba`, `ptFARInformeHTML` (secciones B y C; A y la tabla normativa se rescatan), el panel `_ui()`/`ptFarPanel` de Bloque 5, `PT_PERFIL_NEGOCIO`, `BASE_JUEGOS`, `TERMINOS` (Bloque 17-C), `construirPerfilNegocio`, `ptConstruirPerfilNegocio`, `ptAfinidadNegocio`, `ptPerfilNegocioInformeHTML`.

**Se repuntan** (la función se conserva, cambia su fuente de datos): `ptIndustriaExaminada`, `ptPerteneceIndustria` (→ `getActividadEspecifica()`), `ptFactores260_4`, `ptTestSuficienciaHTML` (→ `MOTOR`/`moCfg()`/`MATRIX`), `ptContextoCompleto` (→ `MATRIX`/`MOTOR`/`getActividadEspecifica()`), `ptGuardaInforme` (→ `MATRIX.length`), "A. Perfil funcional" (→ `getActividadEspecifica()`).

**Se trasladan** (funcionalidad real, cambia de ubicación): `maxParticipacion` (independencia societaria, ahora en `moScore`), la protección de piso mínimo + doble prueba de industria de `ptAplicarSeleccion` (ahora `ptVerificarIndustriaTabla_yAplicar`, invocada tras `motorAplicarSeleccion`).

**No se tocan** (ya genéricas, verificadas): `motorEjecutar`, `moScore`, `moActMatch`, `moRows` (solo se extiende), `moCfg`, la población de `MATRIX`, `annexRechazoD` (Anexo D), `ptVerificarIndustriaTabla`, `ptFiltrarAtipicos`, `ptOrigenCifrasComparablesHTML`, `ptTraducirKeyword` (decisión ya tomada: se deja como está), el cruce EEFF de `index.html:10324` (ya blindado con `&&`, seguirá sin hacer nada una vez `PT_CRIBA` no exista, sin necesidad de cambio).

## 5. Plan de pruebas (manual, sin suite automatizada en el proyecto)

1. Importar un Excel de Capital IQ con >50 filas, incluyendo compañías con SIC 6719 y/o "Holding(s)" en el nombre.
2. Configurar el Motor TOP-N con N y criterios distintos del default (p. ej. N=20, excluir holding, prioridad geográfica LATAM).
3. Pulsar "Solucionar todo automáticamente en 1 clic" → confirmar que respeta exactamente esa configuración (el bug original) y que ninguna holding (por SIC o nombre) sobrevive.
4. Confirmar el test de independencia: una fila con accionista único >50% se excluye con motivo explícito.
5. Cargar un estudio del año anterior con comparables aceptadas; confirmar el bono de continuidad (se reflejan como tal en `raz`/motivo) y que el conteo "se mantienen N del año anterior" en Anexo D es coherente.
6. Generar el informe completo → confirmar que Anexo D aparece una sola vez, que no existe la sección "B. Resultado de la depuración" vieja, que no aparece la frase de "desarrollo de videojuegos" en ningún estudio no relacionado con esa industria, que "A. Perfil funcional" muestra la actividad real (Gemini) y que el Bloque 7 (factores 260-4) ya no dice "Pendiente" en todo.
7. Repetir el punto 6 con un estudio de una industria distinta a videojuegos (p. ej. distribución de agroquímicos), para confirmar que nada quedó agnóstico solo de nombre.
8. Verificar que los paneles que usaban `ptFarPanel` como ancla siguen apareciendo correctamente en su fallback (`compalert`/`cbody`/`ptConectorPanel`/`ptSelPanel`).
9. Confirmar que "Ejecutar selección" manual (sin pasar por "corrección automática") sigue funcionando igual que antes.

## 6. Riesgo de implementación

`ptCribarUniverso`, `ptSeleccionarConjunto` y `ptAplicarSeleccion` tienen exactamente un envoltorio cada uno (Bloque 7, Bloque 17-C y Bloque 16 respectivamente) — confirmado por auditoría `grep` completa de cada símbolo, no por inspección parcial. `PT_FAR`, `PT_CRIBA` y `PT_SELECCION` tienen consumidores adicionales fuera del motor FAR (Bloque 7, Bloque 11 `ptContextoCompleto`), todos ya identificados y con destino de repunte definido en este documento. La implementación debe re-ejecutar el mismo grep de símbolos antes de borrar cada uno, para detectar cualquier referencia nueva introducida entre el diseño y la implementación.
