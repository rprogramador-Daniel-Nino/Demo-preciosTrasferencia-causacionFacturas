/* ─────────────────────────────────────────────────────────────────────────────
   tiposOperacionDian.js — los 63 tipos de operación con vinculados de la DIAN.

   Es el catálogo que el propio Excel de operaciones lista en la hoja
   «Op. Vinculados Economicos», bajo el rótulo «Tipos de Operacion según DIAN»
   (filas 56-99 del archivo de referencia). Vive en código y no se lee del Excel
   porque la generación del informe lo necesita aunque el Excel no esté cargado en
   esa sesión: el estudio se abre otro día y las tablas se regeneran igual.

   PARA QUÉ. El informe declara el concepto como «Otros servicios (07)»: nombre y
   código. El Excel trae el nombre en texto libre («Tipo de operación*») y el código
   en una columna «Cod» que es OPCIONAL y suele venir vacía. Cuando falta, el código
   solo se puede recuperar cruzando el nombre contra este catálogo — y si el nombre
   no es ninguno de los 63, no se puede recuperar y hay que decirlo. Antes se ponía
   un '07' fijo, que es afirmar ante la DIAN un código que nadie declaró.

   EL MISMO NOMBRE ESTÁ DOS VECES. El catálogo es simétrico: «Otros servicios» es el
   7 en ingreso y el 36 en egreso, «Servicios administrativos» el 4 y el 33, y así
   con casi todos. Por eso resolver un nombre exige saber si la operación es de
   ingreso o de egreso; sin ese dato no hay respuesta única.
   ───────────────────────────────────────────────────────────────────────────── */

/** Los 63 tipos, en el orden y con los códigos del catálogo. */
export const TIPOS_OPERACION_DIAN = [
  // 1. Operaciones de ingreso — recibidos o abonados en cuenta por concepto de:
  { cod: 1, nombre: 'Netos por venta de inventarios producidos', clase: 'ingreso' },
  { cod: 2, nombre: 'Netos por venta de inventarios no producidos', clase: 'ingreso' },
  { cod: 3, nombre: 'Servicios intermedios de la producción -maquila', clase: 'ingreso' },
  { cod: 4, nombre: 'Servicios administrativos', clase: 'ingreso' },
  { cod: 5, nombre: 'Asistencia técnica', clase: 'ingreso' },
  { cod: 6, nombre: 'Servicios técnicos', clase: 'ingreso' },
  { cod: 7, nombre: 'Otros servicios', clase: 'ingreso' },
  { cod: 8, nombre: 'Honorarios', clase: 'ingreso' },
  { cod: 9, nombre: 'Comisiones', clase: 'ingreso' },
  { cod: 10, nombre: 'Publicidad', clase: 'ingreso' },
  { cod: 11, nombre: 'Seguros y reaseguros', clase: 'ingreso' },
  { cod: 12, nombre: 'Ingresos por Derivados Financieros', clase: 'ingreso' },
  { cod: 13, nombre: 'Intereses sobre préstamos', clase: 'ingreso' },
  { cod: 14, nombre: 'Arrendamientos', clase: 'ingreso' },
  { cod: 15, nombre: 'Arrendamientos financieros', clase: 'ingreso' },
  { cod: 16, nombre: 'Prestación de otros servicios financieros', clase: 'ingreso' },
  { cod: 17, nombre: 'Garantías', clase: 'ingreso' },
  { cod: 18, nombre: 'Enajenación de acciones (inventario)', clase: 'ingreso' },
  { cod: 19, nombre: 'Enajenación de acciones y aportes (activo fijo)', clase: 'ingreso' },
  { cod: 20, nombre: 'Venta de cartera', clase: 'ingreso' },
  { cod: 21, nombre: 'Venta de activos fijos no depreciables', clase: 'ingreso' },
  { cod: 22, nombre: 'Venta de activos fijos depreciables, amortizables y agotables', clase: 'ingreso' },
  { cod: 23, nombre: 'Venta de intangibles o derechos tales como patente; know-how, marcas, entre otros', clase: 'ingreso' },
  { cod: 24, nombre: 'Cesión de intangibles, derechos u obligaciones', clase: 'ingreso' },
  { cod: 25, nombre: 'Licenciamientos o franquicias', clase: 'ingreso' },
  { cod: 26, nombre: 'Regalías', clase: 'ingreso' },
  { cod: 27, nombre: 'Otras inversiones', clase: 'ingreso' },
  { cod: 28, nombre: 'Otros activos', clase: 'ingreso' },
  { cod: 29, nombre: 'Otros ingresos', clase: 'ingreso' },
  // 2. Operaciones de egreso (costos y deducciones) — pago o abono en cuenta por concepto de:
  { cod: 30, nombre: 'Compra neta de inventarios para producción', clase: 'egreso' },
  { cod: 31, nombre: 'Compra neta de inventarios para distribución', clase: 'egreso' },
  { cod: 32, nombre: 'Servicios intermedios de la producción -maquila', clase: 'egreso' },
  { cod: 33, nombre: 'Servicios administrativos', clase: 'egreso' },
  { cod: 34, nombre: 'Asistencia técnica', clase: 'egreso' },
  { cod: 35, nombre: 'Servicios técnicos', clase: 'egreso' },
  { cod: 36, nombre: 'Otros servicios', clase: 'egreso' },
  { cod: 37, nombre: 'Honorarios', clase: 'egreso' },
  { cod: 38, nombre: 'Comisiones', clase: 'egreso' },
  { cod: 39, nombre: 'Publicidad', clase: 'egreso' },
  { cod: 40, nombre: 'Seguros y reaseguros', clase: 'egreso' },
  { cod: 41, nombre: 'Egresos por Derivados financieros', clase: 'egreso' },
  { cod: 42, nombre: 'Intereses sobre préstamos', clase: 'egreso' },
  { cod: 43, nombre: 'Arrendamientos', clase: 'egreso' },
  { cod: 44, nombre: 'Arrendamientos financieros', clase: 'egreso' },
  { cod: 45, nombre: 'Prestación de otros servicios financieros', clase: 'egreso' },
  { cod: 46, nombre: 'Garantías', clase: 'egreso' },
  { cod: 47, nombre: 'Compra de acciones (inventario)', clase: 'egreso' },
  { cod: 48, nombre: 'Compra de acciones y aportes (activo fijo)', clase: 'egreso' },
  { cod: 49, nombre: 'Venta de cartera', clase: 'egreso' },
  { cod: 50, nombre: 'Compra de activos fijos no depreciables', clase: 'egreso' },
  { cod: 51, nombre: 'Compra de activos fijos depreciables, amortizables y agotables', clase: 'egreso' },
  { cod: 52, nombre: 'Compra de intangibles o derechos tales como patentes, know-how, marcas, entre otros', clase: 'egreso' },
  { cod: 53, nombre: 'Cesión de intangibles, derechos u obligaciones', clase: 'egreso' },
  { cod: 54, nombre: 'Licenciamientos o franquicias', clase: 'egreso' },
  { cod: 55, nombre: 'Regalías', clase: 'egreso' },
  { cod: 56, nombre: 'Otras Inversiones', clase: 'egreso' },
  { cod: 57, nombre: 'Otros activos', clase: 'egreso' },
  { cod: 58, nombre: 'Otros egresos', clase: 'egreso' },
  // 3. Otras operaciones
  { cod: 59, nombre: 'Aportes en especie o en industria a sociedades o entidades extranjeras.', clase: 'otras' },
  { cod: 60, nombre: 'Aportes de intangibles a sociedades o entidades extranjeras.', clase: 'otras' },
  // 4. Información adicional — operaciones que no afectan el estado de resultados
  { cod: 61, nombre: 'Préstamos con vinculados que no fueron reflejados en el Estado de Resultados', clase: 'adicional' },
  { cod: 62, nombre: 'Reintegros o reembolsos de gastos con vinculados que no fueron reflejados en el Estado de Resultados', clase: 'adicional' },
  { cod: 63, nombre: 'Operaciones efectuadas a nombre de vinculados que no fueron reflejados en el Estado de Resultados', clase: 'adicional' },
];

/** Clave de comparación de un nombre: sin tildes, sin puntuación y en minúsculas. */
function clave(nombre) {
  return String(nombre || '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* Índice por clase, porque el mismo nombre está en ingreso y en egreso. */
const POR_CLASE = { ingreso: new Map(), egreso: new Map() };
for (const t of TIPOS_OPERACION_DIAN) {
  const mapa = POR_CLASE[t.clase];
  /* Solo el primero de cada nombre: «Venta de cartera» está en las dos columnas y las
     clases 'otras' y 'adicional' no se indexan porque no las declara la Tabla 2. */
  if (mapa && !mapa.has(clave(t.nombre))) mapa.set(clave(t.nombre), t.cod);
}

/**
 * El código DIAN de un tipo de operación escrito en texto, a dos dígitos.
 *
 * Devuelve `null` cuando el texto no es ninguno de los 63 nombres oficiales. Es
 * deliberado y es la razón de existir de este módulo: el Excel admite texto libre en la
 * columna «Tipo de operación», y afirmar un código que el contribuyente no declaró es
 * peor que dejar el hueco visible en un documento que se radica ante la DIAN.
 *
 * @param {string} texto     el nombre tal como venga del Excel o del estudio.
 * @param {boolean} esEgreso si la operación es de egreso (cambia el código del mismo nombre).
 * @returns {string|null} el código a dos dígitos («07»), o null si no se reconoce.
 */
export function codigoDeTipoOperacion(texto, esEgreso) {
  const k = clave(texto);
  if (!k) return null;
  const cod = POR_CLASE[esEgreso ? 'egreso' : 'ingreso'].get(k);
  return cod === undefined ? null : String(cod).padStart(2, '0');
}
