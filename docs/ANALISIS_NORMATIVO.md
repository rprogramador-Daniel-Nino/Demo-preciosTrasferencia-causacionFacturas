# Análisis normativo: ¿el sistema cumple lo que exige la norma de precios de transferencia?

Este documento contrasta lo que hace el sistema (selección de comparables, rangos y ajustes) contra la normatividad, la jurisprudencia y la doctrina aplicables en Colombia. Marco de referencia: artículos 260-1 a 260-11 del Estatuto Tributario, el Decreto 1625 de 2016 (que compiló el Decreto 3030 de 2013), la Resolución 71 de 2018 de la DIAN, la doctrina de la DIAN (Concepto 1212 de 2024), la jurisprudencia de la Sección Cuarta del Consejo de Estado, y las Directrices de Precios de Transferencia de la OCDE (Colombia es miembro desde 2020).

> Nota: el usuario mencionó "la UTE". En el contexto colombiano de precios de transferencia el marco lo fijan la DIAN (autoridad tributaria) y las Directrices OCDE. Este análisis cubre ambos; si "UTE" se refería a otra entidad específica, puedo reorientarlo.

---

## 1. Selección de comparables

**Qué exige la norma.** El artículo 260-4 del E.T. establece los cinco factores de comparabilidad: características de los bienes/servicios, análisis funcional (funciones, activos y riesgos — FAR), términos contractuales, circunstancias económicas y estrategias de negocio. La doctrina de la DIAN (Concepto 1212 de 2024, citando al Consejo de Estado) insiste en que no basta comparar precios: hay que comparar circunstancias, y las diferencias significativas deben eliminarse con ajustes o descartar la comparable. El artículo 260-1 exige que las comparables sean independientes.

**Qué hace el sistema.** Sobre el universo real de Capital IQ (2.987 empresas para END GAME 2025), el motor aplica en cascada:

| Filtro del sistema | Fundamento normativo | Resultado |
|---|---|---|
| Participación de un accionista < 50% | Independencia (Art. 260-1) | criterio de cribado |
| Actividad "games" + SIC 7371/7372 | Características y actividad (Art. 260-4) | criterio de cribado |
| Exclusión de holdings | Análisis funcional (Art. 260-4) | −433 |
| Exclusión de pérdida operativa | Criterio conservador DIAN | −993 |
| Exclusión de saldos negativos | Fiabilidad del dato | −0 |
| Análisis funcional (perfil servicio/empresario) | FAR (Art. 260-4) | descarta perfiles incompatibles |
| Curación por IA de la descripción de negocio | Circunstancias económicas | refina la muestra |

Del universo de 2.987 quedan 1.561 válidas tras filtros duros, y de ahí se llega a la muestra final de 16. **Las 16 comparables del usuario están todas en el universo y sobreviven los filtros.**

**Valoración.** El motor implementa los factores del 260-4 de forma trazable, y su exclusión de empresas con pérdida operativa es coherente con la práctica conservadora que la DIAN suele exigir a los contribuyentes. El punto de atención normativo: la exclusión automática de empresas con pérdidas **no es un mandato legal absoluto** —la OCDE (¶3.64-3.65) advierte que descartar comparables con pérdidas de forma automática puede sesgar el rango—, aunque en la práctica colombiana es defendible como criterio conservador. El sistema la aplica como filtro configurable, lo cual es correcto: permite justificar la decisión.

---

## 2. Rangos (rango de plena competencia)

**Qué exige la norma.** El artículo 260-3, parágrafo 2°, dispone que cuando hay dos o más comparables se obtiene un rango de plena competencia, que "se ajustará mediante la aplicación de métodos estadísticos, en particular el rango intercuartil que consagra la ciencia económica". Y fija la consecuencia: si el indicador del contribuyente está **dentro** del rango, cumple; si está **fuera**, la **mediana** se toma como valor de plena competencia. Los cinco métodos admitidos son los del 260-3 (PC, precio de reventa, costo adicionado, márgenes transaccionales de utilidad operacional, y partición de utilidades), alineados con las Directrices OCDE.

**Qué hace el sistema.** Calcula el rango intercuartil (P25, mediana, P75) por método, determina si el contribuyente está dentro (CUMPLE) o fuera (NO CUMPLE), y en caso de estar fuera propone el ajuste a la mediana. El parche añade el cálculo para los cinco métodos (MO, MB, Berry, Cost Plus, NCP).

**Valoración.** Correcto y alineado con el 260-3. El cuartil se calcula por interpolación (método inclusivo, equivalente a QUARTILE.INC), que es el estándar de la "ciencia económica" al que remite la norma y el que usa el consultor. La conclusión CUMPLE/NO-CUMPLE y el ajuste a la mediana replican exactamente el mandato legal. Para END GAME, el margen operacional del contribuyente (5,58%) cae dentro del rango en los siete escenarios de ajuste → CUMPLE de forma robusta.

---

## 3. Ajustes de capital de trabajo

**Qué exige la norma.** El artículo 260-4 permite eliminar diferencias significativas entre comparables y parte examinada mediante ajustes "suficientemente confiables". El ajuste de capital de trabajo está **expresamente reconocido** en la práctica colombiana (debe justificarse técnicamente) y desarrollado en el **Anexo del Capítulo III de las Directrices OCDE**, que da el ejemplo metodológico: ajustar por las diferencias en cuentas por cobrar, cuentas por pagar e inventario, medidas relativas a una base (ventas, costos o activos), reflejando el **valor temporal del dinero** mediante una tasa de interés.

**Qué hace el sistema (con el parche).** Exactamente esa metodología:
- Ajusta cuentas por cobrar, cuentas por pagar, inventario y PP&E (este último, un refinamiento adicional).
- Cada partida se lleva a la proporción de la parte examinada relativa a la base del método (ventas para MO/MB, gastos para Berry, costos para NCP/Cost Plus).
- Aplica el costo financiero de la diferencia con una tasa de interés (el valor temporal del dinero que pide la OCDE): factor `t/(1+t)` para CxC y CxP, factor `t` para inventario y PP&E.

**Valoración.** El ajuste implementado **corresponde a la metodología OCDE del Anexo del Capítulo III**, que es la doctrina que la DIAN reconoce como referencia. Es más completo que el mínimo (añade PP&E y separa cada partida), lo que fortalece la justificación técnica que exige el 260-4. Dos matices normativos que el sistema debe cuidar:
1. La OCDE (¶3.49) subraya que estos ajustes **no son rutinarios ni obligatorios**: hay que demostrar que *mejoran* la comparabilidad. El sistema acierta al ofrecer el análisis de sensibilidad (rango con y sin cada ajuste), porque permite mostrar si el ajuste cambia la conclusión y por tanto justificar su uso.
2. La tasa de interés usada debe estar sustentada. El sistema la toma como parámetro por comparable; el estudio debe documentar su origen (tasa de mercado, del período).

---

## 4. Conclusión normativa

En lo que toca al cálculo, el sistema **con los parches aplicados está alineado con la norma**: los comparables se filtran por los factores del Art. 260-4, el rango es el intercuartil del Art. 260-3, y el ajuste de capital de trabajo sigue la metodología OCDE del Anexo del Capítulo III que la DIAN reconoce. La simulación confirma que reproduce al 100% los rangos del estudio real.

La reserva es la ya documentada en las verificaciones anteriores: **sin los parches**, el sistema (a) no calculaba el rango ajustado completo, y (b) leía mal los estados financieros (confundía gastos con utilidad operacional), lo que produciría un estudio numéricamente incorrecto —y por tanto expuesto a rechazo por la DIAN— aunque la estructura metodológica fuera correcta. Con los parches, esa exposición se cierra.
