---
name: revisar-ramas-equipo
description: Usar al empezar a trabajar en este repo, antes de aplicar cambios propios, y otra vez al cerrar cada spec o feature antes del merge — trae main y las ramas remotas de los compañeros, reporta qué cambiaron y dónde se solapa con tu trabajo en index.html, y las integra todas (main primero) abortando ante cualquier conflicto fuera de public/index.html y public/gestor-reportes/.
---

# Revisar las ramas del equipo antes de seguir

El equipo trabaja en ramas separadas sobre un `index.html` de ~13 000 líneas que
todos editan. El riesgo no es el conflicto de git —ese avisa— sino descubrir
tarde que alguien ya arregló lo que estás arreglando.

**`main` cuenta como una rama más.** Es el tronco al que todos convergen, y
quedarse atrás de él ensucia la siguiente integración exactamente igual que
quedarse atrás de un compañero: el trabajo que otro ya mergeó a `main` llega
tarde y con más líneas de por medio. Por eso el script la analiza con el mismo
detalle y va primero en el orden de integración.

Anunciar al empezar: "Usando revisar-ramas-equipo para ver qué cambiaron en main y en las ramas de tus compañeros."

## Cuándo correrla

**Dos momentos, no uno:**

1. **Al empezar** un spec, feature o corrección, antes de tocar código.
2. **Al cerrarlo**, antes del merge o del PR.

Correrla solo al arrancar deja una ventana abierta: lo que un compañero publique
mientras dura tu trabajo no se ve hasta el siguiente arranque, y para entonces la
integración ya llega sucia. El objetivo es que el equipo avance hacia el mismo
punto, no que cada quien descubra al final lo que hicieron los demás.

## Lo que esta skill NO detecta

El script mira **commits ya publicados**. No puede ver un choque que todavía no
existe en git.

Si el trabajo que vas a empezar **retira, renombra o reescribe** un archivo que
un compañero viene tocando, eso no aparece en ningún escaneo: su trabajo aún no
está publicado, o el conflicto no es de líneas sino de que su código se queda sin
sitio donde vivir. Ese aviso es hacia adelante y va por fuera de la herramienta —
hay que hablarlo antes de empezar.

Al reportar (paso 4), si notas que el trabajo planeado toca archivos que un
compañero editó recientemente, dilo aunque el solapamiento salga vacío.

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

### 3. Si `orden_integracion` está vacío, terminar

No es un error: significa que no hay nada que traer, ni de `main` ni de ningún
compañero. Informarlo y terminar.

**Mirar `orden_integracion`, no `companeros`.** Que `companeros` esté vacío no
autoriza a cerrar: puede no haber ramas de compañeros y sí haber commits en
`main` esperando. Al revés también pasa — hay compañeros pero sin nada nuevo.
`orden_integracion` ya resuelve las dos cosas: contiene solo las ramas que
tienen algo que traer y son integrables, `main` primero.

### 4. Reportar en prosa

Empezar por **`principal`**, que es el análisis de `origin/main`, y seguir con
cada compañero. Los dos traen los mismos campos, así que se reportan igual:
quién, cuándo, qué hizo (a partir de `commits_que_me_faltan`, que trae sha
corto, autor, fecha y asunto), y si `bloques_en_conflicto_potencial` no está
vacío, decir explícitamente en qué bloques de `index.html` chocan. Esa es la
información que importa; el resto es contexto.

Si una rama trae `nota`, mencionarla también: indica que falta contexto para
evaluarla bien —sin ancestro común con mi rama, `index.html` ausente en su
punta, o que la rama de trabajo es `main` y no se integra sobre sí misma— y por
eso el resto de sus campos puede venir vacío.

`atras_de_main` sigue siendo el número que se cita para decir cuánto falta del
tronco, pero **el qué está en `principal.commits_que_me_faltan`**: reportarlo con
el mismo detalle que el de un compañero, no como un contador suelto.

### 5. Compuerta: árbol limpio

Si `arbol_limpio` es `false`, **parar** y pedir al usuario que haga commit de
`mis_archivos_sin_commitear`, o `git stash -u`. No basta `git stash` a secas:
ese campo incluye archivos sin trackear (el script los junta con
`git ls-files --others --exclude-standard`), y un stash sin `-u` los deja
fuera, así que el usuario seguiría bloqueado en el siguiente intento. No
integrar sobre trabajo sin guardar.

### 6. Punto de retorno

Antes de tocar nada:

```bash
git rev-parse HEAD
```

Comunicar el SHA al usuario de forma explícita, diciéndole que puede volver con
`git reset --hard <sha>`. Debe quedar en el chat, no solo en memoria de la
sesión.

### 7. Integrar en el orden de `orden_integracion`

**Recorrer `orden_integracion` tal como viene, sin reordenarlo.** Ya trae
`origin/main` primero y después los compañeros de menor a mayor solapamiento.

`main` va al frente por una razón práctica: las ramas de los compañeros suelen
tenerlo ya mergeado, así que integrarlo antes deja menos que resolver en las
siguientes. Al revés se resuelve el mismo cambio dos veces.

Una rama a la vez:

```bash
git merge --no-ff <rama>
```

Los nombres de `orden_integracion` ya vienen con el prefijo `origin/` (por
ejemplo `"origin/main"`, `"origin/antoniodev"`); usar el valor tal cual.
Anteponer `origin/` de nuevo produce `origin/origin/main`, que no existe, y el
merge no corre.

Las ramas sin ancestro común no aparecen en `orden_integracion` —tienen
`integrable: false`—, así que no hay que filtrarlas a mano. Si alguna quedó
fuera, reportarla al usuario con su `nota` en lugar de intentar mergearla.

Tras cada merge, **verificar antes de seguir con la siguiente**: `npm run build`
y comprobar que el árbol quedó como se espera. Encadenar merges sin mirar
convierte dos conflictos separados en uno solo, imposible de atribuir.

### 8. Ante conflicto, mirar dónde cayó

```bash
git diff --name-only --diff-filter=U
```

**Si TODAS las rutas en conflicto están bajo `public/index.html` o
`public/gestor-reportes/`:** no es un conflicto real, esos dos son los únicos
artefactos que `npm run build` regenera (sync-index.js copia
`index.html` → `public/index.html`; Vite compila `frontend/` a
`public/gestor-reportes/`). Resolver regenerando:

```bash
git checkout --ours -- public/index.html public/gestor-reportes
npm run build
git add public/index.html public/gestor-reportes
git commit --no-edit
```

**Cualquier otra ruta en conflicto —incluidas las de `public/vendor/`— cae en
el caso general: abortar y parar.** `public/vendor/` (por ejemplo
`pdfjs/pdf.min.js` y `pdfjs/pdf.worker.min.js`) está trackeado directamente y
nada lo regenera: `scripts/sync-index.js` solo copiaría `vendor/` →
`public/vendor/` si existiera una carpeta `vendor/` en la raíz del repo, y no
existe. Tratar `public/` entero como "generado" y resolver con `--ours`
descartaría en silencio el trabajo de un compañero sobre esos archivos. Por
eso la excepción cubre solo esas dos rutas y no `public/` completo — no la
ensanches sin volver a verificar qué regenera realmente `npm run build`.

```bash
git merge --abort
```

Reportar qué bloques chocaron y esperar instrucciones. No intentar resolver el
conflicto: no hay tests que atrapen un merge mal hecho en este repo.

### 9. Cerrar

Tras integrar todas las ramas:

```bash
npm run build
git status --porcelain
```

Si `public/index.html` o `public/gestor-reportes/` quedaron con cambios sin
commitear, comitearlos ahora —igual que en el paso 8—, no dejarlos sueltos:

```bash
git add public/index.html public/gestor-reportes
git commit -m "chore: regenerar public/ tras integrar ramas del equipo"
```

Si se omite este paso, cualquier merge que haya tocado `index.html` o
`frontend/` deja el árbol sucio, y la siguiente vez que se corra esta skill se
detiene en su propia compuerta del paso 5. Confirmar que `public/index.html`
quedó sincronizado. Recordar al usuario que la verificación funcional es
manual en el navegador, porque el repo no tiene tests de la aplicación.

## Qué no hacer

- No resolver conflictos de lógica automáticamente.
- No integrar con el árbol sucio.
- **No integrar solo las ramas de compañeros y dejar `main` atrás.** Es el error
  que esta versión de la skill viene a cerrar: antes `main` solo se contaba en
  `atras_de_main` y se mencionaba de pasada, así que la rama quedaba integrada
  con los compañeros pero divergiendo del tronco.
- No dar por cerrado el escaneo porque `companeros` esté vacío: mirar
  `orden_integracion`.
- No editar `public/index.html` a mano: se regenera con `npm run build` desde
  `index.html` de la raíz.
- No seguir si `fetch` falló.
