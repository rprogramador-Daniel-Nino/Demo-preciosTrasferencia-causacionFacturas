# Nota técnica — Ampliar límite de estudios conservados

**Archivo:** `index.html` (Sistema PT · Producción 1.0)
**Función afectada:** auto-limpieza de estudios (`autoLimpiarDatosViejos`)
**Config afectada:** objeto `autoSaveConfig`, propiedad `keepOldStudies`

## Problema

El módulo de auto-guardado incluye una auto-limpieza que corre cada 24 h
(`cleanInterval: 86400000`). Esa rutina conserva únicamente los estudios más
recientes y **elimina el resto**, con un tope fijado en:

```js
keepOldStudies: 10,   // Guardar máximo 10 estudios
```

Es decir, a partir del estudio n.º 11 los más antiguos se van borrando solos.
El usuario necesita elaborar y conservar **muchos** estudios, por lo que este
tope de 10 es demasiado bajo.

La lógica que aplica el tope está en `autoLimpiarDatosViejos()`:

```js
if (allKeys.length <= autoSaveConfig.keepOldStudies) { ...return; }   // ~línea 3954
...
const toDelete = studies.slice(autoSaveConfig.keepOldStudies);        // ~línea 3983
```

## Cambio propuesto (parche adjunto)

Subir el tope a 500 (línea 3867). Es un cambio de una sola línea, sin efectos
colaterales: la rutina de limpieza sigue existiendo pero solo actuaría si se
superan los 500 estudios.

```diff
-      keepOldStudies: 10,       // Guardar máximo 10 estudios
+      keepOldStudies: 500,      // Guardar máximo 500 estudios (antes 10). Para no borrar nunca, usar Infinity.
```

Ver `parche_keepOldStudies.patch`.

## Variantes según se prefiera

- **Conservar un número alto pero acotado:** dejar `keepOldStudies` en el valor
  deseado (100, 500, 1000…). Recomendado; mantiene una salvaguarda por si el
  almacenamiento crece sin control.
- **No borrar nunca:** `keepOldStudies: Infinity` (o desactivar la limpieza con
  `enabled: false`, aunque eso también apaga el auto-guardado, así que no se
  recomienda esa vía).

## Notas de aplicación

- El parche está en formato diff unificado; se aplica con `git apply` o `patch`.
  Las líneas de contexto coinciden con la versión auditada 2026-07-16.
- No cambia el esquema de almacenamiento ni las claves `pt:study:*`, por lo que
  los estudios ya guardados se conservan.
- Recordatorio de respaldo: la persistencia vía `window.storage` / `localStorage`
  es local al entorno de ejecución. Se recomienda seguir usando el botón
  **"Exportar portafolio"** para respaldo fuera de la aplicación.
