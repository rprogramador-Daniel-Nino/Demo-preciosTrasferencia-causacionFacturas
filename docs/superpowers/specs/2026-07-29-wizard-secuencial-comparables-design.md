# Wizard secuencial en la tarjeta Comparables

## Problema

En la tarjeta "Comparables" el botón **"Ejecutar selección"** aparece físicamente *antes* que
**"Importar Excel (Capital IQ)"** en el DOM, aunque el uso real requiere importar primero. El
texto de ayuda ya dice el orden correcto, pero el layout lo contradice — no basta con ponerle un
número a cada bloque si el bloque numerado "3" sigue apareciendo antes que el "2".

## Diseño aprobado

Una sola tarjeta con estilo de wizard corporativo (círculos numerados gris oscuro `#334155`,
número en blanco, sin colores llamativos — coherente con el resto de la app), reordenada
físicamente en el DOM para que el orden visual sea el orden real de uso:

1. **Panel "🧠 Actividad de la empresa"** (existente, sin cambios) — queda arriba, **fuera** de
   la numeración, porque es automático (no requiere un clic en esta secuencia).
2. **① Definir los filtros del motor** — la grilla de filtros existente (N objetivo, pérdidas
   operativas, sociedades holding, saldos negativos, prioridad geográfica, rigor funcional) y
   `mo_justw`, sin cambios de contenido ni de IDs.
3. **② Importar el Excel de Capital IQ** — el bloque `.pi-btns` completo (📥 Importar Excel,
   📎 Adjuntar, 👁️ Ocultar/Mostrar tabla), movido aquí tal cual (sin romper su estructura
   interna), con el estado `#mo_ia_status` ("🤖 IA curando candidatas…") justo debajo.
4. **③ Ejecutar la selección** — los botones "Ejecutar selección" / "+3 más" / "Comparar
   escenarios" y sus resultados (`mo_resultados`, `mo_embudo`, `mo_esc`), movidos al final.

Después de la tarjeta numerada sigue igual que hoy: `compsSummaryBadge`, el campo oculto
`sicexp`, la tabla de comparables (`compsTblWrap`), "+ Agregar comparable" y "⚙️ Otros ajustes".

Cada encabezado de paso usa el mismo patrón visual:

```html
<div style="display:flex;align-items:center;gap:10px;margin:16px 0 10px;padding-top:14px;border-top:1px solid var(--hair)">
  <span style="flex:none;width:24px;height:24px;border-radius:50%;background:#334155;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center">1</span>
  <b style="font-size:12.5px;color:#1E293B">Definir los filtros del motor</b>
</div>
```

El primer paso (①) no lleva `border-top` (es el primero del bloque, no necesita separador
arriba). Sin línea vertical conectora continua (evita CSS frágil con posicionamiento absoluto en
un archivo sin framework de estilos); el separador horizontal entre pasos ya comunica la
secuencia con claridad suficiente para un layout "serio corporativo".

## Alcance

- Solo reordena HTML/CSS inline dentro de la tarjeta Comparables en `index.html`. Ningún ID
  cambia de nombre (`mo_n`, `mo_perd`, `mo_holding`, `mo_saldoneg`, `mo_geo`, `mo_act`,
  `mo_justw`, `mo_just`, `mo_ia_status`, `mo_resultados`, `mo_embudo`, `mo_esc`,
  `mo_esc_cards`, `mo_esc_justw`, `mo_esc_just`, `toggleCompsBtn`, `compsSummaryBadge`,
  `compsBadgeCount`, `sicexp`, `compsTblWrap`, `ctbl`, `cbody`, `ptZonaConfig`,
  `ptZonaConfigInner`, `compalert` conservan exactamente su `id`/comportamiento). Por eso no
  hace falta tocar ningún JavaScript: todo el código existente (`motorEjecutar`, `importCompsFile`,
  `curarCandidatosConIA`, `motorRefreshUI`, `motorPintarEmbudo`, `toggleCompsTable`, etc.) sigue
  funcionando igual, solo cambia dónde vive cada elemento en el DOM.
- No se toca la tarjeta "Ingesta especial · Comparables nacionales (Superintendencia de
  Sociedades)" ni ninguna otra tarjeta.

## Verificación

- Grep de que cada ID mencionado arriba sigue existiendo exactamente una vez tras el reordeno.
- Sanity-check de sintaxis (`node -e "new Function(...)"` sobre los bloques `<script>`, igual que
  en el plan anterior) para confirmar que mover HTML no rompió ningún `<script>` inline.
- Verificación manual en navegador: confirmar que el orden visual de arriba a abajo es
  actividad → ① filtros → ② importar (con el estado de IA debajo) → ③ ejecutar + resultados →
  tabla.
