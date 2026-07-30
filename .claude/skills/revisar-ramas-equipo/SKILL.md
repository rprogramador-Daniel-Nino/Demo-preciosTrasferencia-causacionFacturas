---
name: revisar-ramas-equipo
description: Usar al empezar a trabajar en este repo o antes de aplicar cambios propios — trae las ramas remotas de los compañeros, reporta qué cambiaron y dónde se solapa con tu trabajo en index.html, y las integra abortando ante cualquier conflicto fuera de public/.
---

# Revisar las ramas del equipo antes de seguir

El equipo trabaja en ramas separadas sobre un `index.html` de ~13 000 líneas que
todos editan. El riesgo no es el conflicto de git —ese avisa— sino descubrir
tarde que alguien ya arregló lo que estás arreglando.

Anunciar al empezar: "Usando revisar-ramas-equipo para ver qué cambiaron tus compañeros."

## Procedimiento

### 1. Escanear

```bash
node scripts/revisar-ramas.js
```

Emite JSON por stdout. **No volcarlo al usuario**: es insumo, no reporte.

### 2. Si `fetch_ok` es `false`, parar

Mostrar `error_fetch` tal cual. Si menciona `desktop.ini`, dar el comando de
limpieza y explicar que Google Drive los recrea en cada sincronización, así que
va a repetirse. No continuar con datos viejos: un reporte de ramas
desactualizadas es peor que ninguno, porque da falsa confianza.

### 3. Si `companeros` está vacío, terminar

No es un error. Informar que no hay ramas de compañeros además de `main`, y
mencionar `atras_de_main` si es mayor que cero.

### 4. Reportar en prosa

Por cada compañero: quién, cuándo, qué hizo (a partir de `commits_que_me_faltan`),
y si `bloques_en_conflicto_potencial` no está vacío, decir explícitamente en qué
bloques de `index.html` chocan. Esa es la información que importa; el resto es
contexto.

Si `atras_de_main` es mayor que cero, mencionarlo también.

### 5. Compuerta: árbol limpio

Si `arbol_limpio` es `false`, **parar** y pedir al usuario que haga commit o
stash de `mis_archivos_sin_commitear`. No integrar sobre trabajo sin guardar.

### 6. Punto de retorno

Antes de tocar nada:

```bash
git rev-parse HEAD
```

Comunicar el SHA al usuario de forma explícita, diciéndole que puede volver con
`git reset --hard <sha>`. Debe quedar en el chat, no solo en memoria de la
sesión.

### 7. Integrar, de menor a mayor solapamiento

`companeros` ya viene ordenado así. Una rama a la vez:

```bash
git merge --no-ff origin/<rama>
```

### 8. Ante conflicto, mirar dónde cayó

```bash
git diff --name-only --diff-filter=U
```

**Si todas las rutas están bajo `public/`:** no es un conflicto real, ese
directorio es 100 % generado. Resolver regenerando:

```bash
git checkout --ours -- public/
npm run build
git add public/
git commit --no-edit
```

**Si alguna ruta está fuera de `public/`:** abortar y parar.

```bash
git merge --abort
```

Reportar qué bloques chocaron y esperar instrucciones. No intentar resolver el
conflicto: no hay tests que atrapen un merge mal hecho en este repo.

### 9. Cerrar

Tras integrar todas las ramas:

```bash
npm run build
git diff --stat
```

Confirmar que `public/index.html` quedó sincronizado. Recordar al usuario que la
verificación funcional es manual en el navegador, porque el repo no tiene tests
de la aplicación.

## Qué no hacer

- No resolver conflictos de lógica automáticamente.
- No integrar con el árbol sucio.
- No editar `public/index.html` a mano: se regenera con `npm run build` desde
  `index.html` de la raíz.
- No seguir si `fetch` falló.
