/* ─────────────────────────────────────────────────────────────────────────────
   anexoBRubros.js — las filas del ANEXO B, en un solo sitio.

   POR QUÉ EXISTE. El Anexo B se escribe en DOS rutas: `docxRelleno.js` genera las
   tablas en OOXML y `anexoBHtml.js` las reescribe sobre la plantilla marcada del
   cliente, clonando su markup. Cada una mantenía su propia lista de rubros, y el
   2026-08-21 se corrigieron el orden del balance, los decimales y dos filas nuevas
   solo en la primera: quien generaba con plantilla siguió viendo la tabla vieja e
   incompleta hasta que el usuario lo reportó. Dos listas que deben decir lo mismo y
   nadie obliga a que lo digan es un defecto esperando su turno, así que aquí están
   una vez y las dos rutas las leen.

   EL ORDEN ES EL DE LA FICHA que produce la macro de Word, no uno propio: es el
   documento que el analista tiene delante al revisar el anexo, y con las filas
   cruzadas hay que buscar cada rubro en vez de leer las dos en paralelo.

   UNA FILA FALTA SOLO SI SU DATO ESTÁ VACÍO (regla del usuario, 2026-08-21). El
   prompt del parser garantiza `null` para el rubro que no figura y 0 solo para el
   cero reportado, así que la ausencia se distingue del cero y la fila se omite sin
   inventar nada. Es lo que ya hacía la ficha: imprime «-» en depreciación y en otras
   inversiones cuando la compañía no las reporta.

   `campo` es la clave del parser en `eeffDatos`. `patron` reconoce el rótulo en la
   plantilla del cliente para reutilizar SU redacción, y `etiqueta` es la que se
   escribe cuando la plantilla no trae esa fila. `filaEstudio`, cuando está, es la
   clave de la fila del estudio que la ruta de OOXML prefiere: son las cifras que el
   analista puede haber corregido a mano en el paso 4, y leerlas de `eeffDatos`
   descartaría esa corrección.
   ───────────────────────────────────────────────────────────────────────────── */

/** Estado de resultados, en el orden en que la ficha lo imprime. */
export const RUBROS_RESULTADOS = [
  { campo: 'ingresos_operacionales', filaEstudio: 's', etiqueta: 'Ventas netas', patron: /ventas netas|ingresos operacionales/i },
  { campo: 'costo_ventas', filaEstudio: 'c', etiqueta: 'Costo de los bienes vendidos', patron: /costo de los bienes|costo de ventas/i },
  { campo: 'utilidad_bruta', etiqueta: 'Beneficio bruto', patron: /beneficio bruto|utilidad bruta/i },
  { campo: 'gastos_generales_administrativos', etiqueta: 'Gastos generales y administrativos (SG&A)', patron: /gastos generales|sg&a/i },
  { campo: 'depreciacion', etiqueta: 'Depreciación', patron: /depreciaci/i },
  { campo: 'gastos_operacionales', etiqueta: 'Gastos operativos', patron: /gastos operativos|gastos de operaci/i },
  { campo: 'utilidad_operacional', filaEstudio: 'op', etiqueta: 'Utilidad de operación', patron: /utilidad de operaci|utilidad operacional/i },
  /* Los dos últimos no están en la ficha: los traen algunas plantillas del cliente y el
     parser los pide como opcionales, así que van al final y solo si la comparable los
     desglosa. */
  { campo: 'gastos_investigacion_desarrollo', etiqueta: 'Gastos de investigación y desarrollo', patron: /investigaci/i },
  { campo: 'gastos_publicidad', etiqueta: 'Gastos de publicidad', patron: /publicidad/i },
];

/** Balance general, en el orden en que la ficha lo imprime. */
export const RUBROS_BALANCE = [
  { campo: 'efectivo_y_equivalentes', etiqueta: 'Efectivo promedio y equivalentes de efectivo', patron: /efectivo/i },
  { campo: 'otras_inversiones', etiqueta: 'Otras inversiones promedio', patron: /otras inversiones|inversiones/i },
  { campo: 'cuentas_por_cobrar', filaEstudio: 'ar', etiqueta: 'Promedio de cuentas por cobrar netas', patron: /cuentas por cobrar/i },
  { campo: 'inventarios', filaEstudio: 'inv', etiqueta: 'Inventario neto promedio', patron: /inventario/i },
  { campo: 'propiedad_planta_equipo', etiqueta: 'EPP neto promedio', patron: /epp|propiedad, planta|planta y equipo/i },
  { campo: 'total_activos', etiqueta: 'Activos totales promedio', patron: /activos totales/i },
  { campo: 'activos_operativos', etiqueta: 'Activos operativos promedio', patron: /activos operativos/i },
  { campo: 'total_pasivos', etiqueta: 'Total de pasivos promedio', patron: /total de pasivos|pasivos totales|total pasivo/i },
  { campo: 'cuentas_por_pagar', filaEstudio: 'ap', etiqueta: 'Promedio de cuentas por pagar netas', patron: /cuentas por pagar/i },
];

/**
 * El valor de un rubro para una comparable, o `null` si no hay dato.
 *
 * Prefiere la cifra de la fila del estudio cuando el rubro la tiene (`filaEstudio`),
 * porque es la que el analista puede haber corregido; cae a la del documento si la
 * fila no la trae.
 */
export function cifraDeRubro(rubro, comparable) {
  const c = comparable || {};
  const datos = c.eeffDatos || {};
  const candidatos = rubro.filaEstudio ? [c[rubro.filaEstudio], datos[rubro.campo]] : [datos[rubro.campo]];
  for (const v of candidatos) {
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}

/** Los rubros de una tabla que esta comparable SÍ reporta, en orden. */
export function rubrosConDato(rubros, comparable) {
  return rubros.filter((r) => cifraDeRubro(r, comparable) !== null);
}
