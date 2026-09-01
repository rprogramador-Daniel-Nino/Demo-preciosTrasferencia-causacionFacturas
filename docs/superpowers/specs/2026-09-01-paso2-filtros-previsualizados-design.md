# Diseño — El paso 2 deja de configurarse a ciegas

Fecha: 2026-09-01

## De dónde sale

El usuario pidió mejorar la experiencia de la búsqueda de comparables. Preguntado por el dolor
concreto, nombró **los cuatro** que se le ofrecieron:

1. **Configurar a ciegas y pagar para enterarse.** Se fijaban cuatro filtros sin saber su efecto
   y solo se descubría después de correr la curación con IA, que se paga por candidata. En un
   cribado real de 2.987 compañías eran ~1.359 evaluaciones tiradas, casi la mitad del gasto.
2. **No saber qué hace cada filtro.** «Prioridad Geográfica» parecía descartar y solo pondera;
   «Rigor Funcional» no hacía nada desde el 2026-08-10; poner las pérdidas en «Incluir» no mete
   ninguna negativa sin la cuota.
3. **No saber qué configuración hace cumplir.** Con el contribuyente en margen negativo, nada
   decía que el estudio no puede cumplir.
4. **Demasiados controles juntos.** Seis selectores en una parrilla plana, sin jerarquía.

No son cuatro problemas: son uno. **Ningún control decía lo que cuesta.**

## Dos decisiones del usuario

- **`Rigor Funcional` se retira del panel.** Dejó de descartar en agosto de 2026; el perfil sigue
  pesando en el puntaje y publicándose en la trazabilidad. Un control que no hace nada enseña a
  desconfiar de los que sí. La clave `rigor` **permanece** en `engineConfig` y en el payload del
  Excel: retirar el control no debe alterar los estudios guardados.
- **El panel avisa, no configura.** Nada se aplica solo. Una configuración elegida por su
  resultado es difícil de defender ante un revisor; cada cambio queda como decisión del analista,
  con su justificación.

## Lo que hace posible todo esto

Dos hechos verificados antes de diseñar:

- El universo se carga en el **paso 1**, antes de los filtros, y la importación deja `hasLoss` y
  `hasNegativeBalance` calculados en cada fila. Los cuatro filtros duros son **JavaScript puro
  sobre datos en memoria**: previsualizarlos no cuesta ninguna llamada al modelo. Medido sobre el
  cribado real de Makita (1.632 filas): **0,59 ms por recálculo**, así que se puede recalcular con
  cada tecla.
- Con el contribuyente en margen negativo, el incumplimiento es **demostrable**: toda comparable
  con utilidad ≥ 0 tiene indicador ≥ 0, luego el primer cuartil de una muestra sin negativas queda
  siempre por encima. Se puede afirmar sin correr nada.

## Un defecto que había que cerrar primero

`prefiltrar` decide **a quién se le paga la curación** y `scoreCandidates` decide **quién entra en
la muestra**. El código afirmaba que la segunda «vuelve a aplicar estos mismos filtros — es
idempotente», y no era cierto:

| | `prefiltrar` | `scoreCandidates` |
|---|---|---|
| Holding | `tieneSemanticaHolding(cand)` | `... && !esContinuidad` |
| Pérdida | `cand.hasLoss` | `enPerdida(cand)` — también `op < 0` |

Consecuencias reales: una comparable del estudio anterior con «Group» en la razón social se caía
**antes de curarse**, aunque el motor la habría conservado, y sin un aviso; y una con utilidad
negativa sin el flag **se curaba pagando** para que el motor la descartara después.

Construir la previsualización sobre esos predicados habría hecho que el panel enseñara números que
el motor no respeta. Se unifican en `FILTROS_DUROS` + `filtroQueDescarta`, importados por las dos
funciones, y `prefiltrar` gana el parámetro `previas` y devuelve `porMotivo`.

## El servicio

`previsualizarFiltros(universo, config, { estudio, iaMatch, estudioAnterior })` — puro, sin React
ni red, mismo patrón que `semaforoRadicacion.js` y `diagnosticoRango.js`. Devuelve:

| Campo | Qué es |
|---|---|
| `pasos[]` | Por filtro: `etiqueta`, `queHace`, `activo`, `saca`, `ejemplos` (5), `masSinNombrar` |
| `quedan` / `entran` / `reserva` | El reencuadre: casi nunca manda el filtro, manda el cupo |
| `curacion` | `aCurar`, `reutilizadas`, `sinDatosParaCurar`, `lotes`, `etaMinutos` |
| `continuidad` | `total` y `caen[]` con el motivo de cada una |
| `enPerdidaEnUniverso` | El techo real de negativas disponibles |
| `indicador` | El margen del contribuyente, o `null` sin cifras |
| `geografia` | `descarta: false` y el texto que lo dice |
| `avisos[]` | Solo lo demostrable — ver abajo |

El estimado de la curación usa las **mismas constantes del motor** (`CURACION_LOTE = 20`,
`CURACION_CONCURRENCIA = 3`, `SEGUNDOS_POR_LOTE = 15`) y el mismo criterio de qué es curable
(identificador **y** descripción del negocio), para que el «antes» y el «durante» coincidan.

## Los avisos

Cada uno aparece **solo cuando lo que dice es cierto y comprobable**. Un panel que avisa de todo
enseña a ignorar los avisos, que es lo que ya le pasó a los del generador.

| Clave | Cuándo | Severidad |
|---|---|---|
| `imposibleCumplir` | Contribuyente en pérdida y (pérdidas excluidas **o** cero negativas en el universo) | bloqueo |
| `cuotaEnCero` | Pérdidas admitidas, cuota en 0 y hay negativas | aviso |
| `cuotaContradictoria` | Cuota > 0 con el filtro que las excluye | aviso |
| `sinJustificacion` | Cuota > 0 sin justificación escrita | aviso |
| `negativasInsuficientes` | Cuota > negativas del universo | aviso |
| `universoCorto` | Quedan menos que el N objetivo | bloqueo bajo el piso de 10, aviso si no |
| `continuidadRota` | La configuración retira comparables del año anterior | aviso |

**`imposibleCumplir` tiene dos salidas distintas**, y esa distinción la destapó el cribado real de
Makita: 1.632 compañías y **cero** en pérdida operativa —el screening de Capital IQ ya las había
excluido— con el contribuyente en −1,356 %. Ahí la demostración no depende del filtro sino de si
la muestra **puede** contener una negativa. Mandar al analista a «cambie la política» sería
mandarlo a una vía que no existe: el aviso apunta al cribado del paso 1, o a asumir que el estudio
no cumple y declarar el ajuste.

## El panel

**Decisiones de método**, arriba y siempre visibles: pérdidas + cuota + justificación,
independencia + umbral. **Afinaciones**, plegadas: N objetivo, holding, saldos negativos,
geografía — con **su costo en la propia barra del pliegue**, para que esconderlas no pueda ocultar
un descarte.

Cada control que descarta lleva su costo al lado (`CostoDelFiltro`) y un «ver» que despliega cinco
razones sociales (`EjemplosDelFiltro`). Cinco y no todas: la lista sirve para **verificar** que el
filtro no se equivocó —el de holding se presume del nombre y a veces acierta de más—, no para
leerla entera.

El cierre publica `universo → pasan los filtros → entran`, lo que se va a pagar, y una línea que
dice **dónde termina la certeza**: de ahí en adelante decide la curación.

## Fuera de alcance, a propósito

- **No se previsualiza la curación.** El grado de actividad —MISMA/RELACIONADA/DISTINTA— solo lo
  sabe el modelo. Fingir un número ahí sería peor que no darlo.
- **No se cuentan negativas «de la misma actividad»** antes de curar, por lo mismo. Se dice cuántas
  hay en pérdida, que es el techo.
- **Ningún botón que configure por el analista** (decisión del usuario, compartida).
- **No se toca `scoreCandidates` ni el motor**, salvo la unificación de predicados, que es
  corrección de un defecto.

## Cómo se verificó

- `previsualizarFiltros.test.js` (31 pruebas) y las nuevas de `comparablesEngine.test.js` para la
  unificación: continuidad con nombre de holding, `hasLoss` ausente con `op < 0`, atribución por
  motivo y precedencia del primer motivo.
- **La prueba que impide que el panel vuelva a mentir**: los `saca` de cada paso deben coincidir
  con lo que `scoreCandidates` rechaza por ese mismo motivo. Verificada además contra el universo
  real de Capital IQ de Makita, donde el resultado **reproduce el embudo publicado en el informe
  del año anterior**: 1.632 universo · 238 vinculadas · 144 holding.
- `npm test` completo, `npm run build`, `npm run lint --prefix frontend`.
- Verificación manual en el navegador, que en esta aplicación es la única funcional.

## Pendiente

- El selector `Rigor Funcional` se retiró de la pantalla; la clave `rigor` sigue en la
  configuración. Si se decide que no vuelve, hay que limpiar `rigorFuncional` de los conteos de
  rechazo y de la hoja de trazabilidad, que hoy siempre reportan cero por ese motivo.
