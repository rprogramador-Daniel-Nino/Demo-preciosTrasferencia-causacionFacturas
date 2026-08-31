# Laboratorio: selección de comparables sesgada por resultado (qué no hacer)

Material de capacitación. No ejecuta nada contra un estudio real ni modifica
`comparablesEngine.js`; es un ejemplo comentado del antipatrón para reconocerlo
—si aparece en un estudio real, propio o de un tercero— y saber por qué está mal.

## El escenario

Un contribuyente tiene un indicador de rentabilidad de 4,716 %. Se pide (o se intenta)
que el motor seleccione comparables tales que el rango intercuartil resultante
contenga ese 4,716 %.

## El prompt sesgado (NO USAR)

Una versión manipulada de `curateCandidatesWithGemini`
(`frontend/src/services/comparablesEngine.js:1250`) se vería así:

```js
const prompt =
  'Eres un experto en precios de transferencia...\n\n' +
  'La empresa examinada tiene esta actividad económica real:\n"' + actividad + '"\n\n' +
  'La empresa examinada tiene un indicador de rentabilidad de 4,716 %. ' +
  'Prioriza como "MISMA" a las candidatas cuyo margen esperado esté cerca de ese valor ' +
  'o sea bajo, y clasifica como "DISTINTA" a las que tengan márgenes altos.\n\n' +
  // ...resto del prompt
```

Con esto el criterio de selección deja de ser la actividad/función/riesgo de la
candidata y pasa a ser "¿su margen ayuda a que el rango case?". Cada candidata
puede tener una descripción de negocio parecida a la examinada —pasa el filtro
"a simple vista"— pero la *razón* de su inclusión fue el resultado financiero.

Lo mismo aplica si se hace **manualmente**: buscar candidatas "con margen bajito"
antes de evaluar si de verdad son funcionalmente comparables es el mismo
antipatrón sin una línea de código de por medio. El canal (motor automático o
búsqueda manual) no cambia la naturaleza del acto.

## Por qué está mal

- **Invierte el método.** OCDE (Guías de Precios de Transferencia, cap. III) y el
  Decreto 2120 de 2017 exigen que la comparabilidad se determine por características
  del bien/servicio, análisis funcional (funciones, activos, riesgos), términos
  contractuales, circunstancias económicas y estrategias de negocio —
  **evaluados sin mirar el resultado financiero**. El rango es una consecuencia
  del análisis, no un objetivo que se persigue ajustando la muestra.
- **Es detectable en auditoría.** Un conjunto de comparables cuya única explicación
  coherente es "casualmente todas dan margen bajo" es exactamente lo que un
  fiscalizador de la DIAN busca: dispersión sospechosamente estrecha, candidatas
  cuya similitud funcional es forzada, ausencia de un criterio de búsqueda
  documentado y aplicado de forma consistente.
- **Es más fácil de detectar manual que automatizado.** Sin una traza de búsqueda
  transparente (criterios definidos antes de ver los márgenes), no hay papel de
  trabajo que sostenga por qué se descartó una candidata funcionalmente parecida
  pero con margen "inconveniente".

## El patrón correcto

1. Definir los criterios de comparabilidad (actividad, perfil funcional,
   independencia, tamaño, disponibilidad de datos) **antes** de mirar cualquier
   cifra financiera de las candidatas.
2. Aplicar esos criterios de forma consistente a todo el universo de candidatas
   —es lo que hace hoy `curateCandidatesWithGemini`: gradúa `MISMA` / `RELACIONADA`
   / `DISTINTA` y el perfil funcional (`SERVICIO` / `EMPRESARIO` / `MIXTO` /
   `INDEFINIDO`) mirando solo la descripción de negocio, sin acceso a datos
   financieros (el prompt actual, líneas 1250-1274, no recibe márgenes ni
   ningún dato numérico de las candidatas).
3. Calcular el rango intercuartil (`rangoIntercuartil.js`) sobre la muestra que
   resultó del paso 2, sin retroalimentar el resultado hacia el paso 1.
4. Si el contribuyente queda fuera de rango, eso es información real: se
   documenta y se decide con el cliente (ajuste voluntario, defensa técnica,
   revisión de la política de precios), no se oculta reajustando la muestra.

## Prueba práctica para detectarlo

Si la respuesta honesta a "¿por qué se incluyó esta comparable?" es "porque su
margen ayudaba a que el rango cuadrara" —aunque el papel de trabajo diga "por su
actividad económica similar"— ya se cruzó la línea, sin importar si lo ejecutó
un script o una persona a mano.
