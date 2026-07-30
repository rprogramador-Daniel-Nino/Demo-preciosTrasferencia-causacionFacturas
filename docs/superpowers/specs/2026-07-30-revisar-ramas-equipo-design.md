# Verificar las ramas de los compañeros antes de aplicar cambios propios

## Origen

El equipo trabaja en ramas separadas (`juandev` para Juan; los demás según el nombre que
cada quien elija) sobre un repositorio cuyo archivo principal, `index.html`, tiene ~13 000
líneas y lo edita todo el mundo. El commit `0f8143e "integracion de juan y antonio"` muestra
que la integración hoy es manual y a posteriori.

El riesgo concreto no es el conflicto de git —ese avisa— sino el trabajo duplicado o pisado:
dos personas corrigiendo la misma función de `index.html` sin enterarse hasta el merge.

### Hallazgos de la exploración previa

| # | Hallazgo | Efecto sobre el diseño |
|---|---|---|
| 1 | `git fetch` falla: `fatal: bad object refs/desktop.ini` | **Bloqueante.** Google Drive File Stream crea `desktop.ini` en cada carpeta, incluidas las de `.git/refs/`. Git los lee como refs corruptas. Sin `fetch` no hay comparación posible. |
| 2 | `.gitignore` línea 3 ignora `.claude` completo | Una skill del proyecto en `.claude/skills/` no llegaría a los compañeros por `git pull`. |
| 3 | Solo existen `main` y `origin/main` | La skill debe degradar limpiamente cuando no hay ramas de compañeros, y descubrirlas solas cuando aparezcan. |
| 4 | `public/` es 100 % generado desde `index.html` + `frontend/` | Un conflicto ahí no es un conflicto real: se resuelve regenerando. |
| 5 | No hay suite de tests | La verificación es manual; el diseño debe hacerla barata y explícita. |
| 6 | El patrón `api/config.php` de `.gitignore` nunca aplicó | Lleva barra, así que git lo ancla a la raíz. El archivo real vive en `Cpanel/public_html/api/`, quedó trackeado desde `318d187` (2026-07-21) y contiene una API key de Anthropic. Corregir el patrón entra en alcance. |

## Alcance

Entra: limpieza de `desktop.ini`, corrección de `.gitignore` —incluido el patrón roto de
`config.php`—, un script de escaneo determinista, una skill que lo consume e integra, y la
documentación en `CLAUDE.md`.

No entra: CI, hooks de sesión, política de ramas o de PRs, resolución automática de
conflictos de lógica, y **la purga de la API key de la historia de git**. Esto último exige
reescribir SHAs con `git filter-repo` o BFG, coordinado con los demás miembros del equipo,
y merece su propio spec. La mitigación real —revocar la key y emitir otra— es una acción
manual del usuario, ya en curso al momento de escribir esto.

## Decisiones tomadas

| Decisión | Elegido | Descartado |
|---|---|---|
| Alcance de la skill | Informar **e integrar** automáticamente | Solo informar |
| Ante conflicto | Abortar y dejar el árbol intacto | Dejar marcadores; resolver con IA |
| Distribución | Versionar `.claude/skills/` | Instalación manual; solo texto en CLAUDE.md |
| Forma | Skill + script auxiliar determinista | Skill sola; skill + hook `SessionStart` |
| Conflictos en `public/**` | Excepción: regenerar con `npm run build` | Abortar también ahí |

---

## Diseño

### 1. Higiene del repositorio (prerequisito)

**`.gitignore`.** Agregar el patrón global de Google Drive y acotar la regla de `.claude`:

```gitignore
# Google Drive File Stream
desktop.ini
Desktop.ini

# Claude Code — se versiona .claude/skills/; lo demás es local
.claude/*
!.claude/skills/
```

Y corregir los dos patrones anclados que nunca aplicaron. Hoy dicen `api/config.php` y
`api/usage_data.json`; al llevar barra, git los ancla a la raíz del repositorio y no
alcanzan a `Cpanel/public_html/api/`, que es donde los archivos existen de verdad:

```gitignore
# cPanel — configuración con secretos y datos de uso
**/api/config.php
**/api/usage_data.json
```

Corregir el patrón evita la próxima filtración, pero **no** desprotege la actual: el archivo
ya está trackeado, y git ignora las reglas de `.gitignore` para archivos que ya siguen. Hace
falta además `git rm --cached Cpanel/public_html/api/config.php` para sacarlo del índice
conservándolo en disco, ya que el despliegue en cPanel lo necesita.

`desktop.ini` sin barra inicial aplica en todo el árbol. Se incluye `Desktop.ini` porque
NTFS no distingue mayúsculas pero git sí. La regla `.claude/*` + `!.claude/skills/` es
necesaria en ese orden: git no desciende a un directorio excluido, así que hay que
re-incluir el subdirectorio explícitamente. La línea `.claude` suelta actual se elimina.

**Limpieza del árbol de trabajo.** Ninguno de los 27 `desktop.ini` está trackeado (aparecen
como `??` en `git status`), así que basta con ignorarlos; no hace falta `git rm --cached`.

**Limpieza de `.git/`.** Borrar del disco los 17 `desktop.ini` que quedaron dentro de
`.git/`. Su contenido es metadato de icono de Google Drive:

```
[.ShellClassInfo]
IconResource=C:\Program Files\Google\Drive File Stream\...
```

`.gitignore` no cubre `.git/`, así que esto **se va a repetir** cada vez que Google Drive
sincronice. Por eso el script lo detecta y el mensaje de error trae el comando de limpieza,
en lugar de tratarlo como una falla única.

### 2. `scripts/revisar-ramas.js`

Node ≥18 (ya es requisito del repo), sin dependencias, sin escribir nada en disco. Emite un
único objeto JSON por stdout. Es el componente determinista: toda decisión mecánica vive
acá, para que no varíe entre corridas.

**Interfaz.** `node scripts/revisar-ramas.js` → JSON por stdout. Código de salida `0` siempre
que el script haya podido emitir su JSON —**incluido el caso de `fetch` fallido**, que se
reporta como `fetch_ok: false` y no como código de error—. Se sale con código `1` solo si no
se pudo producir JSON (por ejemplo, el directorio no es un repositorio git). Los diagnósticos
van dentro del JSON, no por stderr.

**Descubrimiento de ramas.** Todas las `origin/*` excepto `origin/HEAD`, `origin/main` y la
rama actual. Sin lista fija de nombres: una rama nueva aparece sola.

**Cálculo por rama de compañero**, contra `git merge-base <rama-actual> origin/<rama>`:

- `commits_que_me_faltan`: `git log <base>..origin/<rama>` con sha corto, autor, fecha y asunto.
- `archivos_tocados`: `git diff --name-only <base>..origin/<rama>`.
- `solapamiento`: intersección de `archivos_tocados` con los archivos que tocó el usuario
  —tanto en commits (`<base>..HEAD`) como sin commitear (`git diff --name-only HEAD`)—.

**Mapeo de líneas a bloques en `index.html`.** Es lo que hace útil el reporte en un monolito:
decir "conflicto en `index.html`" no informa nada.

Anclas reconocidas, en orden de prioridad:

1. Líneas que contienen `PARCHE PT — Bloque N` → etiqueta = esa línea, normalizada.
2. Banners de una línea `/* ===… ETIQUETA ===… */` → etiqueta = el texto interno.
3. Líneas que contienen `MÓDULO …` dentro de comentario.
4. Respaldo: la declaración `function NOMBRE(` o `window.NOMBRE =` inmediatamente anterior.

Procedimiento: para cada lado se obtiene el archivo **en la punta de ese lado**
(`git show origin/<rama>:index.html` para el compañero; la copia de trabajo para el usuario)
y se construye su tabla de anclas con la numeración de líneas de *esa* versión. Luego se toman
los rangos de `git diff -U0 <base>..origin/<rama> -- index.html` —cuyos `@@ -a,b +c,d @@`
están en la numeración de la punta— y cada rango se atribuye al ancla más cercana hacia
arriba.

El solapamiento se calcula sobre **conjuntos de etiquetas**, nunca sobre números de línea.
Las etiquetas son estables entre versiones; los números de línea de este archivo se mueven
constantemente (ya documentado en `CLAUDE.md` y en specs anteriores).

**Salida.**

```json
{
  "rama_actual": "juandev",
  "fetch_ok": true,
  "error_fetch": null,
  "arbol_limpio": false,
  "mis_archivos_sin_commitear": ["index.html"],
  "mis_bloques_tocados": ["PARCHE PT — Bloque 9: MÁRGENES ATÍPICOS"],
  "atras_de_main": 3,
  "companeros": [
    {
      "rama": "origin/antonio",
      "ultimo": { "autor": "Antonio", "fecha": "2026-07-29", "asunto": "..." },
      "commits_que_me_faltan": [{ "sha": "a1b2c3d", "autor": "Antonio", "asunto": "..." }],
      "archivos_tocados": ["index.html", "functions/index.js"],
      "solapamiento": ["index.html"],
      "bloques_en_conflicto_potencial": ["PARCHE PT — Bloque 9: MÁRGENES ATÍPICOS"]
    }
  ]
}
```

**Casos límite.** Cada uno se reporta dentro del JSON y no aborta el escaneo de las demás
ramas:

- `fetch` falla → `fetch_ok: false` y `error_fetch` con el texto de git. Si además se detectan
  `desktop.ini` dentro de `.git/`, `error_fetch` lo señala como causa probable.
- Sin ramas de compañeros → `companeros: []`.
- HEAD desacoplado → `rama_actual: null`; se compara contra `origin/main`.
- Rama sin `merge-base` con la actual (historias no relacionadas) → se incluye con
  `commits_que_me_faltan: []` y una nota; no se propone integrarla.
- `index.html` ausente en una punta (renombrado o borrado) → se omite el mapeo de bloques de
  esa rama y se reporta el archivo a secas.

### 3. Skill `.claude/skills/revisar-ramas-equipo/SKILL.md`

Frontmatter:

```yaml
---
name: revisar-ramas-equipo
description: Usar al empezar a trabajar en este repo o antes de aplicar cambios propios — trae las ramas remotas de los compañeros, reporta qué cambiaron y dónde se solapa con tu trabajo en index.html, y las integra abortando ante cualquier conflicto.
---
```

Procedimiento, en orden:

1. Correr `node scripts/revisar-ramas.js`.
2. Si `fetch_ok` es `false`: parar y mostrar el diagnóstico junto con el comando de limpieza
   de `desktop.ini`. No continuar con datos viejos.
3. Si `companeros` está vacío: informarlo y terminar. No es un error.
4. Reportar **en prosa**, sin volcar el JSON: qué hizo cada compañero, en qué bloques de
   `index.html` se solapa contigo, y si tu rama quedó atrás de `origin/main`.
5. **Compuerta de árbol limpio.** Si `arbol_limpio` es `false`, parar y pedir commit o stash.
   No se integra sobre trabajo sin guardar.
6. **Punto de retorno.** Registrar el SHA actual de la rama y comunicárselo al usuario de
   forma explícita, para que pueda volver con `git reset --hard <sha>` aunque la sesión se
   pierda.
7. **Integrar** con `git merge --no-ff origin/<rama>`, una rama a la vez, en orden ascendente
   de solapamiento (primero la que menos choca). Así el riesgo se acumula lo más tarde posible.
8. **Ante conflicto**, mirar las rutas en conflicto:
   - Si **todas** caen bajo `public/`, no es un conflicto real: ese directorio se regenera.
     Resolver con `git checkout --ours -- public/`, correr `npm run build` (que sobrescribe
     `public/` desde `index.html` y `frontend/`, dejando irrelevante cuál lado se tomó),
     luego `git add public/` y completar el merge con `git commit --no-edit`.
   - Si **alguna** cae fuera de `public/`: `git merge --abort`, reportar los bloques que
     chocaron y parar. No intentar resolver.
9. Al terminar todas las integraciones: `npm run build` y confirmar que `public/index.html`
   quedó idéntico a `index.html`. Recordar que la verificación funcional es manual en
   navegador, porque el repo no tiene tests.

### 4. Sección en `CLAUDE.md`

Breve, bajo un encabezado propio: qué hace la skill, cuándo correrla (al empezar, no al
terminar), que no requiere instalación porque `.claude/skills/` va versionado, y que un
`git fetch` que falle casi siempre es Google Drive otra vez.

---

## Verificación

No hay suite automatizada. La verificación es manual, en este orden:

1. **Degradación limpia.** Correr el script hoy, con solo `main` en el remoto: debe reportar
   `companeros: []` y salir con código `0`, sin excepciones.
2. **Precisión del mapeo.** Crear una rama local de prueba que modifique un bloque conocido
   de `index.html` (por ejemplo `PARCHE PT — Bloque 9`) y confirmar que el script nombra ese
   bloque y no uno vecino.
3. **El abort no deja rastro.** Provocar un conflicto a propósito fuera de `public/` y
   confirmar que, tras el abort, `git status` queda limpio y el SHA de la rama es el mismo de
   antes. Es el criterio más importante: si el abort no deja el árbol intacto, la skill es
   peligrosa y no debe usarse.
4. **La excepción de `public/`.** Provocar un conflicto que caiga solo en `public/index.html`
   y confirmar que el merge se completa y que `public/index.html` termina idéntico a la raíz.

## Riesgos conocidos

- **Google Drive vuelve a romper `.git/`.** Mitigado con detección y mensaje accionable, no
  resuelto. La solución de fondo —sacar el repo de la carpeta sincronizada— queda fuera de
  alcance.
- **El mapeo de bloques es heurístico.** Si alguien agrega un bloque sin banner de comentario,
  cae al respaldo de `function NOMBRE(`, que es más grueso. Degrada la precisión del reporte,
  no su corrección: el solapamiento a nivel de archivo se sigue detectando.
- **`git merge --no-ff` genera commits de merge en tu rama.** Es intencional: deja rastro de
  qué se integró y cuándo, que es justo lo que faltaba en `0f8143e`.
