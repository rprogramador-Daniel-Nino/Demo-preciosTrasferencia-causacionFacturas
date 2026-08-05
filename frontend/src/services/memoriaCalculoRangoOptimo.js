/* ─────────────────────────────────────────────────────────────────────────────
   memoriaCalculoRangoOptimo.js — Generador de la memoria del rango en Excel,
   OPTIMIZADO para ser rastreable y auditable.

   Reemplaza a `hojasMemoriaRango` de memoriaCalculoRango.js. La diferencia de
   fondo: el generador anterior escribía VALORES ya calculados en JavaScript
   (aoa_to_sheet con números), de modo que el Excel no se podía recalcular ni
   auditar. Este emite FÓRMULAS NATIVAS con la misma librería que el sistema ya
   usa (xlsx-js-style, celdas `{ t:'n', f:'…' }`), de forma que:

     · toda cifra del libro se deriva de las celdas de entrada por fórmula;
     · el usuario puede editar un dato y ver recalcular márgenes, ajustes,
       cuartiles y la conclusión;
     · cada ajuste queda desglosado por partida (CxC, CxP, inventario, PP&E),
       con las columnas intermedias visibles, para poder rastrear de dónde sale
       cada número;
     · se muestran los cinco métodos (MO, MB, Berry, Cost Plus, NCP) con sus
       ajustes, no uno solo.

   La metodología de ajuste es la del parche `ajusteRangoCapitalTrabajo.js`
   (Anexo Cap. III de las Directrices OCDE), traducida a fórmulas de Excel.

   No calcula nada en JS salvo el layout: los números los pone Excel. Devuelve la
   misma estructura { nombre, celdas, cols, merges, autofiltro } que el componente
   MemoriaRangoModal.jsx ya sabe volcar, para no tocar la ruta de descarga.
   ───────────────────────────────────────────────────────────────────────────── */

/* Métodos y su configuración de fórmulas. `base` indica sobre qué se calcula el
   indicador y se escalan las partidas; `num` el numerador; `dep` si usa el
   denominador depurado (COGS−CxP [+opex]) para NCP y Cost Plus. */
const METODOS = [
  { hoja: 'MO', nombre: 'Margen Operacional', base: 'ventas', num: 'ebit', dep: false, fmt: '0.00%' },
  { hoja: 'MB', nombre: 'Margen Bruto', base: 'ventas', num: 'gp', dep: false, fmt: '0.00%' },
  { hoja: 'Berry', nombre: 'Índice de Berry', base: 'opex', num: 'gp', dep: false, fmt: '0.0000' },
  { hoja: 'CostPlus', nombre: 'Cost Plus', base: 'cogs', num: 'gp', dep: true, fmt: '0.0000' },
  { hoja: 'NCP', nombre: 'Net Cost Plus', base: 'costos', num: 'ebit', dep: true, fmt: '0.00%' },
];

const AJUSTES = [
  { clave: 'ninguno', etiqueta: 'Sin ajuste' },
  { clave: 'aar', etiqueta: 'CxC' },
  { clave: 'aap', etiqueta: 'CxP' },
  { clave: 'inv', etiqueta: 'Inventario' },
  { clave: 'aar_aap_inv', etiqueta: 'CxC+CxP+Inv' },
  { clave: 'aar_aap_inv_ppe', etiqueta: '+PP&E' },
  { clave: 'ppe', etiqueta: 'PP&E' },
];

/* Celdas tipadas para xlsx-js-style. */
const cNum = (v, z) => ({ v, t: 'n', z: z || '#,##0.00' });
const cTxt = (v) => ({ v: v == null ? '' : String(v), t: 's' });
const cFor = (f, z) => ({ t: 'n', f, z: z || '0.00%' }); // fórmula numérica
const cForT = (f) => ({ t: 's', f }); // fórmula de texto (conclusión)

/* Referencia a una celda de la hoja Datos. */
const D = (celda) => `Datos!${celda}`;

/**
 * Construye las hojas del libro con fórmulas vivas.
 *
 * @param estudio  el estudio con t_s, t_c, t_op(gastos), t_ar, t_inv, t_ap, t_ppe,
 *                 prime y comparables [{name,s,c,op,ar,inv,ap,ppe,tasaEfectiva}].
 *                 IMPORTANTE: `op` y `t_op` deben ser GASTOS operativos
 *                 (usar el normalizador eeffParserNormalizador.js antes).
 * @param seleccion  (opcional) trazabilidad de la selección de comparables:
 *                 { criterios:[{etiqueta,valor,conector}], candidatas:[{name,ticker,
 *                 sic,country,s,op,c,holderPct,isHolding,hasLoss,hasNegativeBalance,seleccionada}] }.
 *                 Si se entrega, se antepone la hoja «Selección comparables» con el
 *                 universo de Capital IQ, los filtros y el embudo, todo por fórmula.
 * @returns arreglo de { nombre, celdas, cols, merges, autofiltro }.
 */
export function hojasMemoriaRangoOptimo(estudio, seleccion) {
  const study = estudio || {};
  const comps = study.comparables || [];
  const n = comps.length;

  const hojas = [];

  /* ─── Hoja Datos: entradas editables ─── */
  const datos = [];
  datos.push([cTxt('DATOS DE ENTRADA — editar aquí recalcula todo el libro')]);
  datos.push([]);
  datos.push([cTxt('PARTE EXAMINADA')]);
  const tp = [
    ['Ventas netas', study.t_s], ['Costo de ventas', study.t_c],
    ['Gastos operativos', study.t_op], ['Cuentas por cobrar', study.t_ar],
    ['Inventarios', study.t_inv], ['Cuentas por pagar', study.t_ap],
    ['Propiedad, planta y equipo', study.t_ppe],
  ];
  tp.forEach(([k, v]) => datos.push([cTxt(k), cNum(Number(v) || 0)]));
  // filas Datos: 4=Ventas B4, 5=Costo B5, 6=Gastos B6, 7=CxC B7, 8=Inv B8, 9=CxP B9, 10=PPE B10
  datos.push([]);
  datos.push([cTxt('COMPARABLES')]);
  const hdr = ['Compañía', 'Ventas', 'Costo', 'Gastos op.', 'CxC', 'Inventario', 'CxP', 'PP&E', 'Tasa'];
  datos.push(hdr.map(cTxt));
  const filaComp0 = datos.length + 1; // 1-based fila de la primera comparable
  comps.forEach((c) => {
    datos.push([
      cTxt(c.name), cNum(Number(c.s) || 0), cNum(Number(c.c) || 0), cNum(Number(c.op) || 0),
      cNum(Number(c.ar) || 0), cNum(Number(c.inv) || 0), cNum(Number(c.ap) || 0),
      cNum(Number(c.ppe) || 0), cNum(Number(c.tasaEfectiva) || 0, '0.0000'),
    ]);
  });
  hojas.push({
    nombre: 'Datos', celdas: datos,
    cols: [{ wch: 34 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 9 }],
  });

  // Referencias del contribuyente (celdas fijas en Datos)
  const S_s = D('$B$4'), C_s = D('$B$5'), OP_s = D('$B$6');
  const AR_s = D('$B$7'), INV_s = D('$B$8'), AP_s = D('$B$9'), PPE_s = D('$B$10');

  /* ─── Una hoja por método, con fórmulas por comparable ─── */
  const infoMetodos = [];
  METODOS.forEach((M) => {
    const celdas = [];
    celdas.push([cTxt(`${M.nombre} — fórmulas vivas y trazables`)]);
    // encabezado de columnas
    const cols = ['Compañía', 'Ventas', 'Costo', 'Gastos op.', 'CxC', 'Inv', 'CxP', 'PP&E', 'Tasa',
      'EBIT', 'Util.bruta', 'desc', 'Base', 'Aj.CxC', 'Aj.CxP', 'Aj.Inv', 'Aj.PP&E', 'Denom.',
      'Sin ajuste', 'CxC', 'CxP', 'Inv', 'CxC+CxP+Inv', '+PP&E', 'PP&E'];
    celdas.push(cols.map(cTxt));
    const filaHdr = celdas.length; // 1-based
    const r0 = filaHdr + 1; // primera fila de comparable

    // base_s (contribuyente) según método
    const baseS = M.base === 'ventas' ? S_s : M.base === 'opex' ? OP_s
      : M.base === 'cogs' ? C_s : `(${C_s}+${OP_s})`;

    for (let i = 0; i < n; i++) {
      const r = r0 + i;
      const src = filaComp0 + i; // fila en Datos
      // columnas A..I: referencias a Datos (letras A..I = 1..9)
      const refs = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((L) => cForT(`${D(`${L}${src}`)}`));
      // A es texto (nombre), el resto numérico → re-tipar
      const nombreRef = { t: 's', f: `${D(`A${src}`)}` };
      const numRefs = ['B', 'C', 'D', 'E', 'F', 'G', 'H'].map((L, k) => cFor(`${D(`${L}${src}`)}`, '#,##0.00'));
      const tasaRef = cFor(`${D(`I${src}`)}`, '0.0000');
      // base comparable
      const base = M.base === 'ventas' ? `B${r}` : M.base === 'opex' ? `D${r}`
        : M.base === 'cogs' ? `C${r}` : `(C${r}+D${r})`;
      const denomDep = M.hoja === 'NCP' ? `((C${r}-G${r})+D${r})` : M.hoja === 'CostPlus' ? `(C${r}-G${r})` : null;
      const baseInv = M.dep ? denomDep : `M${r}`;
      const num = M.num === 'ebit' ? `J${r}` : `K${r}`;

      const fila = [
        nombreRef,                              // A nombre
        ...numRefs,                             // B..H cifras
        tasaRef,                                // I tasa
        cFor(`B${r}-C${r}-D${r}`, '#,##0.00'),  // J EBIT
        cFor(`B${r}-C${r}`, '#,##0.00'),        // K util bruta
        cFor(`I${r}/(1+I${r})`, '0.00000'),     // L desc
        cFor(`${base}`, '#,##0.00'),            // M base
        cFor(`((E${r}/M${r})-(${AR_s}/${baseS}))*(M${r}*L${r})`, '#,##0.000'),   // N Aj.CxC
        cFor(`((G${r}/M${r})-(${AP_s}/${baseS}))*(M${r}*L${r})`, '#,##0.000'),   // O Aj.CxP
        cFor(`((F${r}/${baseInv})-(${INV_s}/${baseS}))*(M${r}*I${r})`, '#,##0.000'), // P Aj.Inv
        cFor(`((H${r}/${baseInv})-(${PPE_s}/${baseS}))*I${r}`, '#,##0.000'),     // Q Aj.PP&E
        cFor(`${M.dep ? denomDep : (M.base === 'ventas' ? `(B${r}-N${r})` : M.base === 'opex' ? `D${r}` : `M${r}`)}`, '#,##0.00'), // R denom ajustado
        cFor(`${num}/M${r}`, M.fmt),            // S sin ajuste
        cFor(`(${num}-N${r})/R${r}`, M.fmt),    // T CxC
        cFor(`(${num}+O${r})/R${r}`, M.fmt),    // U CxP
        cFor(`(${num}-P${r})/R${r}`, M.fmt),    // V Inv
        cFor(`(${num}-N${r}+O${r}-P${r})/R${r}`, M.fmt),        // W CxC+CxP+Inv
        cFor(`(${num}-N${r}+O${r}-P${r}-Q${r})/R${r}`, M.fmt), // X +PP&E
        cFor(`(${num}-Q${r})/R${r}`, M.fmt),    // Y PP&E
      ];
      celdas.push(fila);
    }

    const rN = r0 + n - 1; // última fila de comparable
    // filas de estadísticos del rango (MIN, cuartiles inclusivos, MAX)
    const RES = ['S', 'T', 'U', 'V', 'W', 'X', 'Y'];
    const statRow = (etq, fn) => {
      const fila = new Array(17).fill(cTxt(''));
      fila[17] = cTxt(etq); // columna R (índice 17)
      RES.forEach((L) => fila.push(cFor(`${fn}(${L}${r0}:${L}${rN})`, M.fmt)));
      return fila;
    };
    const qRow = (etq, q) => {
      const fila = new Array(17).fill(cTxt(''));
      fila[17] = cTxt(etq); // columna R (índice 17)
      RES.forEach((L) => fila.push(cFor(`QUARTILE(${L}${r0}:${L}${rN},${q})`, M.fmt)));
      return fila;
    };
    celdas.push(statRow('Mínimo', 'MIN'));
    const filaMin = celdas.length; // 1-based
    const filaP25 = celdas.length + 1;
    celdas.push(qRow('P25 (cuartil inferior)', 1));
    celdas.push(qRow('Mediana (P50)', 2));
    celdas.push(qRow('P75 (cuartil superior)', 3));
    const filaP75 = celdas.length; // 1-based de P75 (ya empujada)
    celdas.push(statRow('Máximo', 'MAX'));
    const filaMax = celdas.length; // 1-based
    // indicador del contribuyente (mismo con cualquier ajuste)
    const testedFor = M.base === 'ventas'
      ? (M.num === 'ebit' ? `(${S_s}-${C_s}-${OP_s})/${S_s}` : `(${S_s}-${C_s})/${S_s}`)
      : M.base === 'opex' ? `(${S_s}-${C_s})/${OP_s}`
      : M.base === 'cogs' ? `(${S_s}-${C_s})/${C_s}`
      : `(${S_s}-${C_s}-${OP_s})/(${C_s}+${OP_s})`;
    const filaTested = celdas.length + 1;
    {
      const fila = new Array(17).fill(cTxt(''));
      fila[17] = cTxt('Indicador del contribuyente');
      RES.forEach(() => fila.push(cFor(testedFor, M.fmt)));
      celdas.push(fila);
    }
    // conclusión CUMPLE/NO CUMPLE por ajuste
    {
      const fila = new Array(17).fill(cTxt(''));
      fila[17] = cTxt('Conclusión');
      RES.forEach((L) => fila.push(cForT(
        `IF(AND(${L}${filaTested}>=${L}${filaP25},${L}${filaTested}<=${L}${filaP75}),"CUMPLE","NO CUMPLE")`
      )));
      celdas.push(fila);
    }

    infoMetodos.push({ hoja: M.hoja, nombre: M.nombre, fmt: M.fmt, filaMin, filaP25, filaP75, filaMax, filaTested, filaConcl: celdas.length });

    hojas.push({
      nombre: M.hoja, celdas,
      cols: [{ wch: 28 }].concat(new Array(24).fill({ wch: 11 })),
    });
  });

  /* ─── Hoja Resumen: sensibilidad, referenciando las hojas de método ─── */
  const resumen = [];
  resumen.push([cTxt('RESUMEN Y SENSIBILIDAD — todo son referencias a las hojas de método')]);
  resumen.push([]);
  resumen.push(['Método', 'Ajuste', 'Contribuyente', 'Mínimo', 'P25', 'Mediana', 'P75', 'Máximo', 'Conclusión'].map(cTxt));
  const RES = ['S', 'T', 'U', 'V', 'W', 'X', 'Y'];
  infoMetodos.forEach((M) => {
    AJUSTES.forEach((aj, k) => {
      const L = RES[k];
      resumen.push([
        cTxt(M.nombre), cTxt(aj.etiqueta),
        cFor(`${M.hoja}!${L}${M.filaTested}`, M.fmt),
        cFor(`${M.hoja}!${L}${M.filaMin}`, M.fmt),
        cFor(`${M.hoja}!${L}${M.filaP25}`, M.fmt),
        cFor(`${M.hoja}!${L}${M.filaP25 + 1}`, M.fmt),
        cFor(`${M.hoja}!${L}${M.filaP25 + 2}`, M.fmt),
        cFor(`${M.hoja}!${L}${M.filaMax}`, M.fmt),
        cForT(`${M.hoja}!${L}${M.filaConcl}`),
      ]);
    });
  });
  hojas.unshift({
    nombre: 'Resumen', celdas: resumen,
    cols: [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 13 }],
  });

  /* ─── Hoja Selección de comparables: universo Capital IQ + filtros + embudo ───
     Se antepone (si se entrega `seleccion`) para que el usuario pueda rastrear de
     dónde salieron los 16 comparables. El estado de cada candidata y los conteos
     del embudo son FÓRMULAS, no valores: quien audita ve por qué se excluyó cada
     empresa y puede recomputar el embudo. */
  if (seleccion && Array.isArray(seleccion.candidatas) && seleccion.candidatas.length) {
    const cand = seleccion.candidatas;
    const sel = [];
    sel.push([cTxt('SELECCIÓN DE COMPARABLES — trazabilidad completa del cribado')]);
    sel.push([]);

    // Criterios de screening de Capital IQ
    sel.push([cTxt('CRITERIOS DE CRIBADO (Capital IQ)')]);
    (seleccion.criterios || []).forEach((cr) => {
      const con = cr.conector ? `${cr.conector}) ` : '';
      sel.push([cTxt(`${con}${cr.etiqueta}`), cTxt(cr.valor)]);
    });
    sel.push([]);

    /* Embudo con fórmulas COUNTIF sobre la columna «Estado» de la base de datos
       (que está más abajo). Las filas de datos van de `filaCand0` a `filaCandN`. */
    const filaEmbudoTitulo = sel.length + 1;
    sel.push([cTxt('EMBUDO DE SELECCIÓN (Art. 260-4 E.T.)')]);
    const filaEnc = sel.length + 1;
    sel.push([cTxt('Etapa'), cTxt('Empresas'), cTxt('Criterio')]);
    // se rellenan las fórmulas cuando se conozca el rango de la base (abajo)
    const filasEmbudo = {
      universo: sel.length + 1, holding: null, perdida: null, negativo: null,
      validas: null, seleccionadas: null,
    };
    sel.push([cTxt('Universo Capital IQ (tras cribado)'), null, cTxt('Resultado del screening con los criterios de arriba')]);
    filasEmbudo.holding = sel.length + 1;
    sel.push([cTxt('(−) Holdings'), null, cTxt('SIC 6719 / sin operación directa (Art. 260-4)')]);
    filasEmbudo.perdida = sel.length + 1;
    sel.push([cTxt('(−) Pérdida operativa'), null, cTxt('Criterio conservador DIAN: comparable rentable')]);
    filasEmbudo.negativo = sel.length + 1;
    sel.push([cTxt('(−) Saldos negativos'), null, cTxt('Dato no verosímil')]);
    filasEmbudo.validas = sel.length + 1;
    sel.push([cTxt('= Válidas tras filtros duros'), null, cTxt('Pool para análisis funcional y selección')]);
    filasEmbudo.seleccionadas = sel.length + 1;
    sel.push([cTxt('= Muestra final seleccionada'), null, cTxt('Comparables usadas en el rango')]);
    sel.push([]);

    // Base de datos: encabezado + una fila por candidata
    sel.push([cTxt('BASE DE DATOS — UNIVERSO CAPITAL IQ')]);
    const filaHdrBase = sel.length + 1;
    const hcols = ['#', 'Compañía', 'Ticker', 'SIC', 'País', 'Ingresos', 'Utilidad op.', 'Costo',
      '% mayor accionista', 'Holding', 'Pérdida', 'Saldo neg.', 'Estado', '¿Seleccionada?'];
    sel.push(hcols.map(cTxt));
    const filaCand0 = sel.length + 1;
    cand.forEach((c, i) => {
      const r = filaCand0 + i;
      // Estado por precedencia, leyendo las columnas de flags (J,K,L) de esta misma fila.
      const estado = `IF(J${r}="Sí","Holding",IF(K${r}="Sí","Pérdida operativa",IF(L${r}="Sí","Saldo negativo","Válida")))`;
      sel.push([
        cNum(i + 1, '0'),
        cTxt(c.name), cTxt(c.ticker || ''), cTxt(c.sic || ''), cTxt(c.country || ''),
        c.s == null ? cTxt('') : cNum(c.s, '#,##0.00'),
        c.op == null ? cTxt('') : cNum(c.op, '#,##0.00'),
        c.c == null ? cTxt('') : cNum(c.c, '#,##0.00'),
        c.holderPct == null ? cTxt('') : cNum(c.holderPct, '0.0'),
        cTxt(c.isHolding ? 'Sí' : ''),
        cTxt(c.hasLoss ? 'Sí' : ''),
        cTxt(c.hasNegativeBalance ? 'Sí' : ''),
        cForT(estado),                         // M Estado (fórmula)
        cTxt(c.seleccionada ? 'Sí' : ''),      // N ¿Seleccionada?
      ]);
    });
    const filaCandN = filaCand0 + cand.length - 1;

    // Rellenar las fórmulas del embudo (COUNTIF sobre la columna Estado M y Selección N)
    const rangoEstado = `M${filaCand0}:M${filaCandN}`;
    const rangoSel = `N${filaCand0}:N${filaCandN}`;
    const rangoNombre = `B${filaCand0}:B${filaCandN}`;
    sel[filasEmbudo.universo - 1][1] = cFor(`COUNTA(${rangoNombre})`, '#,##0');
    sel[filasEmbudo.holding - 1][1] = cFor(`COUNTIF(J${filaCand0}:J${filaCandN},"Sí")`, '#,##0');
    sel[filasEmbudo.perdida - 1][1] = cFor(`COUNTIF(${rangoEstado},"Pérdida operativa")`, '#,##0');
    sel[filasEmbudo.negativo - 1][1] = cFor(`COUNTIF(${rangoEstado},"Saldo negativo")`, '#,##0');
    sel[filasEmbudo.validas - 1][1] = cFor(`COUNTIF(${rangoEstado},"Válida")`, '#,##0');
    sel[filasEmbudo.seleccionadas - 1][1] = cFor(`COUNTIF(${rangoSel},"Sí")`, '#,##0');

    hojas.unshift({
      nombre: 'Selección comparables', celdas: sel,
      cols: [{ wch: 5 }, { wch: 34 }, { wch: 14 }, { wch: 40 }, { wch: 16 }, { wch: 12 }, { wch: 12 },
        { wch: 12 }, { wch: 16 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 18 }, { wch: 14 }],
      autofiltro: `A${filaHdrBase}:N${filaCandN}`,
    });
  }

  return hojas;
}
