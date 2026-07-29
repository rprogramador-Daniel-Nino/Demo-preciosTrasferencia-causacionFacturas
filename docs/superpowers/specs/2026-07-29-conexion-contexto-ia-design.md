# Conectar el contexto completo del estudio a la IA de redacción

## Origen

Un análisis externo (sin acceso al código real) señaló varias posibles fugas de
contexto entre lo que el usuario diligencia/depura en la aplicación y lo que
realmente recibe la IA al redactar apartados del Informe Local. Antes de tocar
código se verificó cada afirmación línea por línea contra `index.html` (el
archivo raíz — es el que se edita; `npm run build` lo copia a `public/`, nunca
al revés).

Resultado de la verificación:

| # | Afirmación | Veredicto |
|---|---|---|
| 1 | Las comparables seleccionadas llegan a la IA solo con nombre + id, sin actividad ni margen individual | **Confirmado** |
| 2 | El motivo de rechazo llega a la IA solo agregado por categoría, no por compañía | **Confirmado** |
| 3 | La plantilla económica precargada (`window.PT_PLANTILLA`) no llega al contexto de la IA | **Nombre de variable inventado** (no existe `PT_PLANTILLA`). La variable real es `ECON[año]`, aplicada a los campos `e_mundo/e_col/e_sec`. El hallazgo de fondo (esos campos no llegan al contexto) sí es real. |
| 4 | Las fuentes/normativa de internet no se imprimen si el usuario no usó el Motor 2 | **Confirmado, y más específico de lo descrito**: `PT_NORMATIVA_WEB` se puede poblar con el botón «Buscar norma y jurisprudencia» de forma independiente de cualquier motor de redacción, pero solo se imprime si `PT_INFORME_IA.aplicado` existe — quedando huérfana en ese caso. |
| 5 | Lógica de videojuegos hardcodeada en el motor FAR/afinidad | **Confirmado**, pero ya cubierto por el spec `2026-07-29-motor-comparables-unificado-design.md`. Fuera de alcance de este sprint. |

Hallazgo adicional (no estaba en el análisis original): existen tres
definiciones sucesivas de `window.ptContextoCompleto` (líneas ~9966, ~10673,
~13009). **No es un bug**: es una cadena de decoradores (`_ctxPrev`/`_ctxIdx`
guardan la función anterior y la envuelven), así que todo el contenido de la
capa base llega intacto a la capa final. Motor 1 y Motor 2 usan exactamente la
misma función (`contextoBase()` solo llama a `ptContextoCompleto()`), así que
los defectos 1, 2 y 3 afectan a ambos motores por igual.

## Alcance de este sprint

Conectar los puntos 1, 2, 3 y 4. El punto 5 (unificación del motor de
comparables, videojuegos hardcodeado) se resuelve en su propio spec/plan ya
existente y no se toca aquí.

## Diseño

### 1. Comparables con actividad y margen individual

En `ptContextoCompleto()`, dentro del bloque que arma `CONJUNTO DE
COMPARABLES` (dentro del `try` de comparables y rango, dependiente de
`window.MOTOR.activo`), el `.map()` que hoy solo concatena `o.name + ' [' +
(o.id || 's/id') + ']'` se extiende para incluir, por cada comparable:

- SIC (`o.sic`)
- PLI individual ya calculado por `moRows()` (`o.pli`), en porcentaje
- Un recorte corto (1-2 líneas) de `DESCS[o.name]` si existe

Formato por compañía:

```
Company A Inc [SIC 7371] · PLI 8.42% · Desarrollo de software y videojuegos por encargo.
```

Si `DESCS[o.name]` no existe para alguna comparable, esa parte se omite sin
romper el formato de las demás — mismo criterio de "si no consta, se omite"
que ya usa el resto de la función.

### 2. Motivo de rechazo por compañía

En el mismo bloque de `DEPURACIÓN DEL UNIVERSO`, junto al resumen agregado que
ya existe (conteo por motivo), se agrega una lista completa de las
rechazadas tomada de `MATRIX` (que ya trae `{name, motivo}` por fila): una
línea por compañía con su motivo puntual real (no categorías fijas).

```
DEPURACIÓN DEL UNIVERSO
· Universo 84 · aceptadas 12 · rechazadas 72
· Motivos: sin EEFF (30) · pérdidas recurrentes (18) · ...
· Detalle por compañía:
  - Activision Blizzard Inc: posee intangibles valiosos que distorsionan el margen
  - ...
```

Sin tope artificial de filas — es justo el dato que el Decreto 1625 de 2016
(art. 1.2.2.2.1.5 num. 4) exige sustentar completo. El presupuesto de
contexto (sección 5) es lo que absorbe el volumen, no un recorte de la lista.

### 3. Contexto económico ya cargado (`ECON`)

En `ptContextoCompleto()` se agrega un nuevo bloque, junto a los de EEFF/
operaciones, que lee los campos `e_mundo`, `e_col`, `e_sec` con el mismo
helper `g(id)` que ya usa el resto de la función, incluyéndolos solo si
tienen contenido:

```
CONTEXTO ECONÓMICO YA CARGADO EN EL ESTUDIO
· Economía mundial: <texto de e_mundo>
· Economía colombiana: <texto de e_col>
· Sector: <texto de e_sec>
```

Se lee el campo vivo del formulario (no `ECON[año]` directamente), por lo que
cubre tanto la plantilla fija cargada por `ptEconomiaAuto()` como cualquier
edición manual del usuario sobre esos campos.

### 4. `PT_NORMATIVA_WEB` deja de depender de `PT_INFORME_IA.aplicado`

En `ptIntegralInformeHTML()`, se separan las dos condiciones que hoy comparten
un solo `if (!R || !R.aplicado) return ''`:

- La tabla de **fuentes por apartado** (lee `R.campos`) sigue exigiendo
  `R && R.aplicado`, porque sin eso no hay campos redactados que listar.
- El bloque de **referencias normativas incorporadas** (lee
  `window.PT_NORMATIVA_WEB`) pasa a imprimirse siempre que
  `PT_NORMATIVA_WEB.length`, sin importar si el Motor 2 se aplicó.

Cambio de guardia únicamente; no se toca el HTML generado en sí.

### 5. Presupuesto de contexto sin cortes a medias

Las secciones 1-3 alargan el string que arma `ptContextoCompleto()`. Ese
string se trunca más adelante en dos puntos:

- `redaccionIA()` (Motor 1, ~línea 10226): `contexto.slice(0, 45000)`
- `redactarSeccion()` (Motor 2, ~línea 11524): `ctx.slice(0, 30000)`

En el peor caso (universo grande, 30 comparables con descripción, contexto
económico extenso) el contexto total puede rondar ~65.000 caracteres. Los
modelos usados (Sonnet 5 y Haiku 4.5) manejan ventanas de contexto muy por
encima de eso — el tope anterior era conservador sin necesidad real. Cambios:

- `redaccionIA()`: tope sube a `100000`.
- `redactarSeccion()`: tope sube a `70000` (se mantiene algo menor porque se
  invoca una vez por cada apartado — 15 a 19 veces por informe — y multiplicar
  el contexto por esas llamadas sí pesa en costo).

Además, se agrega un helper `ptTruncarContexto(str, max)`: si `str.length` no
excede `max`, se devuelve tal cual; si lo excede, se corta en el último
separador de bloque (`'\n\n────────────────\n\n'`) anterior al límite, nunca a
mitad de un bloque. Se usa en los dos puntos de corte de arriba en vez del
`.slice()` directo, de modo que si el volumen real algún día supera incluso
los nuevos topes, se pierde un bloque completo (p. ej. "otros soportes
transcritos") en vez de cortar una compañía o un párrafo por la mitad.

## Fuera de alcance

- Punto 5 (motor de comparables unificado / videojuegos hardcodeado): spec
  aparte ya existente.
- Reordenar los bloques de `ptContextoCompleto()` (p. ej. mover la
  documentación del año anterior antes de los soportes largos): no hace falta
  con los nuevos topes; si en producción se observa que igual se corta
  contenido importante, se revisita como ajuste posterior, no como parte de
  este sprint.
- Cambiar el modelo usado en `redaccionIA()`/`redactarSeccion()`: no se toca.

## Pruebas

No hay suite automatizada para estas funciones (son JS inline en un HTML sin
framework de test). Verificación manual después de implementar:

1. Cargar un estudio con comparables seleccionadas y universo depurado; llamar
   `ptContextoCompleto()` desde la consola del navegador y confirmar que el
   string resultante incluye SIC/PLI/actividad por comparable y el detalle
   completo de rechazadas.
2. Cargar/editar `e_mundo`, `e_col`, `e_sec` y confirmar que aparecen en el
   contexto.
3. Usar el botón «Buscar norma y jurisprudencia» sin aplicar el Motor 2, y
   confirmar que las referencias sí aparecen en el informe impreso al llamar
   `renderReport()`.
4. Con un universo grande simulado (o bajando manualmente el tope de prueba),
   confirmar que `ptTruncarContexto` corta en un separador de bloque y no a
   mitad de una línea de compañía.
