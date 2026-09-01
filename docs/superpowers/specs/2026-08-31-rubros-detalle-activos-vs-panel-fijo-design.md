# Diseño — Derivar los seis rubros adicionales del ESF desde "Detalle de Activos", no de un panel aparte

Fecha: 2026-08-31

## De dónde sale este diseño

El 2026-08-28 (`docs/superpowers/plans/2026-08-28-ingesta-rubros-adicionales-balance.md`,
commits `f7dcb4a` y `9ac0f69`) se agregó a "3. Ingesta Estados financieros" un panel con seis
casillas nuevas — Efectivo y equivalentes de efectivo, Inversiones asociadas, Activos por
impuestos corrientes, Intangibles, Diferidos, Total Activos no corrientes — porque esos seis
rubros ya existían como columnas del Análisis Vertical en la hoja Datos del Excel Soporte
Motor (`motorExcelExport.js` vía `CLAVES_RUBROS_EXAMINADA`) pero ningún punto de la interfaz
permitía escribirlos: la lectura OCR no los toma (`CAMPO_POR_RUBRO` en `eeffParser.js` no los
incluye), así que llegaban siempre en 0,00.

El 2026-08-31 el usuario reportó, mirando la pantalla, que ese panel es redundante: ya existe
"Detalle de Activos (Estado de Situación Financiera)" (`t_activos_detalle`,
`IngestaCifras.jsx:582-658`), que la ingesta llena sola al leer el PDF con la sección ACTIVOS
completa tal como la imprime el documento, fila por fila, editable a mano. Ese panel SÍ suele
traer ya las seis partidas — bajo el rótulo que use cada compañía —, y es lo que arma la
Tabla 10 / ANEXO A (`tablasContribuyente.js:200-212`, `filasActivos()`) cuando
`t_activos_detalle` no está vacío: la lista fija (`RUBROS_ACTIVO`, que incluye los mismos seis
campos con nombre) es solo el *fallback* para estudios sin detalle dinámico.

Consecuencia verificada en el código: con `t_activos_detalle` poblado (el caso normal), un
valor escrito en el panel nuevo del 28-ago **no llega a la Tabla 10 ni al ANEXO A** —
`filasActivos()` ignora `RUBROS_ACTIVO`/los campos sueltos en cuanto `detalle.length > 0` — y
si la fila ya está en el detalle con la cifra correcta, escribirla también en el panel nuevo
es información duplicada que puede desincronizarse (se corrige en un lado y no en el otro).
El caso real que motivó el panel del 28-ago —el Excel Soporte Motor mostrando 0,00— ocurre
precisamente cuando el detalle SÍ trae la fila (con el rótulo propio de la compañía) pero
nadie la traduce a los campos sueltos `t_cash`/`t_inv_assoc`/`t_tax`/`t_intang`/`t_dif`/
`t_act_nocurr` que lee `motorExcelExport.js`.

## Qué NO es este diseño

- ❌ Ampliar `CAMPO_POR_RUBRO` en `eeffParser.js` para que Gemini extraiga estos seis rubros
  como campos con nombre propio. Ya existe una fuente completa y confiable de esos datos —el
  detalle dinámico— y pedirle al modelo una segunda extracción paralela de las mismas cifras
  duplicaría trabajo y podría divergir de lo que el analista ya corrigió en el detalle.
- ❌ Sumar automáticamente subtotales a partir de sus componentes (p. ej. `t_act_nocurr =
  t_ppe + t_intang + t_dif`). Eso lo prohibía explícitamente el plan del 28-ago y sigue sin
  pedirse: `t_act_nocurr` se toma tal cual la fila «Total, Activos no corrientes» que el
  documento imprime, no de una suma que el sistema invente.
- ❌ Tocar `t_ar`, `t_inv`, `t_ap`, `t_act_curr`, `t_ppe`, `t_act_tot` (los rubros que sí
  tenían casilla desde antes del 28-ago). Esos SÍ tienen extracción OCR dedicada
  (`CAMPO_POR_RUBRO`) y alimentan los ajustes de capital de trabajo y la utilidad — no son el
  problema que reportó el usuario, y no está pedido tocarlos.

## Decisión

Los seis rubros dejan de tener casilla propia. Se calculan con una función pura,
`derivarRubrosDesdeDetalleActivos(detalle)`, que recorre `t_activos_detalle` y reconoce cada
concepto por el TEXTO de su rótulo — no por su posición ni por una lista de sinónimos por
empresa (ver memoria del usuario: "generalizar, no ajustar por empresa" — matchers por
forma/patrón, como ya hace `TERMINOS_HOLDING` en `filtrosComparablesPatch.js`).

Esa función corre en los DOS puntos donde `t_activos_detalle` cambia:

1. **Lectura OCR** — `eeffVerificacion.js`, justo después de armar `campos.t_activos_detalle`
   (línea 398): se agregan los seis campos derivados al mismo `campos` que ya devuelve la
   verificación, así viajan por la misma ruta (`camposAplicables` → `updateStudy`) sin tocar
   `IngestaCifras.jsx` para este caso.
2. **Edición manual** — los tres manejadores de "Detalle de Activos" en `IngestaCifras.jsx`
   (`handleActivoDetalleChange`, `handleAgregarActivoDetalle`, `handleEliminarActivoDetalle`):
   cada uno ya llama a `updateStudy({ t_activos_detalle: ... })`; se agrega el resultado de
   `derivarRubrosDesdeDetalleActivos` al mismo objeto, igual que `handleFieldChange` ya deriva
   `t_op` de `t_s`/`t_c`/`t_gastos` en la misma llamada (mismo patrón existente, no uno nuevo).

Con eso, `study.t_cash`/`t_inv_assoc`/`t_tax`/`t_intang`/`t_dif`/`t_act_nocurr` quedan
siempre sincronizados con lo que el analista ve y edita en "Detalle de Activos", sin que
`motorExcelExport.js` (que ya los lee de `study[clave]` vía `CLAVES_RUBROS_EXAMINADA`) tenga
que cambiar: sigue leyendo el mismo campo, solo que ahora alguien más lo mantiene al día.

Una fila sin equivalente reconocible dentro de `t_activos_detalle` produce 0 para ese rubro
— igual que si el documento no trajera esa partida —, y no rompe nada más: estos seis rubros
no intervienen en la utilidad operacional ni en los ajustes de capital de trabajo (verificado
el 28-ago, sigue vigente).

### Reconocimiento de rótulos

Coincidencia por substring, sobre el rótulo normalizado (minúsculas, sin tildes, espacios
colapsados), en este orden de prioridad — una fila ya asignada a un rubro no se reutiliza en
otro:

| Clave | Reconoce si el rótulo contiene | Requiere `esSubtotal` |
|---|---|---|
| `t_cash` | «efectivo» o «disponible» | no |
| `t_inv_assoc` | «invers» y «asociad» | no |
| `t_tax` | «impuesto» y NO «diferido» | no |
| `t_intang` | «intangible» | no |
| `t_dif` | «diferido» y NO «impuesto» | no |
| `t_act_nocurr` | «activ» y «no corriente» | sí |

`t_tax`/`t_dif` se excluyen mutuamente a propósito: un rótulo como «Impuesto diferido
activo» no es ninguno de los dos conceptos que estas casillas describían (ni impuesto
corriente por cobrar, ni un diferido no tributario) y clasificarlo mal sería peor que dejarlo
en 0 — el mismo criterio que ya aplicó `filtrosComparablesPatch.js` al preferir un falso
negativo ocasional sobre inventar sinónimos ad hoc. `t_act_nocurr` exige `esSubtotal` para no
confundir una fila de línea que mencione "activos no corrientes" en su descripción con el
subtotal real del grupo.

## Riesgo aceptado

Un EEFF cuyo rótulo real no contenga ninguno de estos términos (p. ej. "Cuentas corrientes
bancarias" en vez de "Efectivo…", visto ya en el fixture de Montachem para otra partida)
queda en 0 para ese rubro, igual que antes del 28-ago. La corrección, si hace falta, es
ampliar el patrón de esa clave (agregar el término, no el nombre de la compañía) — no reabrir
una casilla manual paralela.
