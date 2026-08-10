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
 *                 prime y comparables [{name,s,c,op,ar,inv,ap,ppe}].
 *                 IMPORTANTE: `op` y `t_op` deben ser GASTOS operativos
 *                 (usar el normalizador eeffParserNormalizador.js antes), y `prime`
 *                 es la tasa EN PORCENTAJE (7.37, no 0.0737): esta función la divide
 *                 entre 100 al escribir Datos!B11, así que quien la llame no debe
 *                 hacerlo antes.
 * @param seleccion  (opcional) trazabilidad de la selección de comparables:
 *                 { criterios:[{etiqueta,valor,conector}], umbralControl?:number,
 *                   candidatas:[{name,ticker,sic,country,s,op,c,holderPct,holdersText,
 *                   sospechaHolding,motivoClave,perfilFuncional,seleccionada}] }.
 *                 Si se entrega, se anteponen las hojas «Selección comparables»
 *                 —universo de Capital IQ, embudo y suma de control— y «Matriz de
 *                 rechazo», todo por fórmula.
 *
 *                 `motivoClave` y `perfilFuncional` los produce `scoreCandidates`, no
 *                 la importación: hay que pasar las candidatas por
 *                 `enriquecerUniverso` antes de llamar aquí, o el embudo contará cero
 *                 en todos los motivos y dará por válido el universo entero.
 *                 Se aceptan también los nombres `rev`/`cogs`/`maxpct` como
 *                 sinónimos de `s`/`c`/`holderPct`.
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
    ['Tasa de interés de referencia (Prime Rate)', (Number(study.prime) || 0) / 100],
  ];
  tp.forEach(([k, v], idx) => {
    if (idx === 7) {
      datos.push([cTxt(k), cNum(v, '0.00%')]);
    } else {
      datos.push([cTxt(k), cNum(Number(v) || 0)]);
    }
  });
  // filas Datos: 4=Ventas B4, 5=Costo B5, 6=Gastos B6, 7=CxC B7, 8=Inv B8, 9=CxP B9, 10=PPE B10, 11=Prime B11
  datos.push([]);
  datos.push([cTxt('COMPARABLES')]);
  const hdr = ['Compañía', 'Ventas', 'Costo', 'Gastos op.', 'CxC', 'Inventario', 'CxP', 'PP&E', 'Tasa'];
  datos.push(hdr.map(cTxt));
  const filaComp0 = datos.length + 1; // 1-based fila de la primera comparable
  comps.forEach((c) => {
    datos.push([
      cTxt(c.name), cNum(Number(c.s) || 0), cNum(Number(c.c) || 0), cNum(Number(c.op) || 0),
      cNum(Number(c.ar) || 0), cNum(Number(c.inv) || 0), cNum(Number(c.ap) || 0),
      cNum(Number(c.ppe) || 0), cFor('$B$11', '0.00%'),
    ]);
  });

  /* ─── Trazabilidad de la tasa, en las columnas K–M ───
     La tabla de comparables llega hasta la I, así que este bloque cabe al lado sin
     estorbar. Deja escrito de dónde sale el número, a qué comparables alcanza y con
     qué convención se aplica: quien audita el libro no debería tener que preguntarlo.
     La celda editable sigue siendo B11 —una sola—; aquí solo se refleja. */
  const anotarTasa = (idxFila, etiqueta, valor) => {
    if (!datos[idxFila]) datos[idxFila] = [];
    datos[idxFila][10] = cTxt(etiqueta);
    datos[idxFila][11] = valor;
  };
  anotarTasa(2, 'PARÁMETRO — TASA DE INTERÉS DE LOS AJUSTES DE CAPITAL DE TRABAJO', null);
  anotarTasa(3, 'Tasa aplicada', cFor('$B$11', '0.00%'));
  datos[3][12] = cTxt('← única celda editable: B11 alimenta a los ' + n + ' comparables');
  anotarTasa(4, 'Fuente', cTxt(
    'Board of Governors of the Federal Reserve System, H.15 Selected Interest Rates — '
    + 'Bank Prime Loan Rate (serie FRED RIFSPBLPNA). Promedio anual de días hábiles: '
    + '2025 = 7,37 %; 2024 = 8,31 %.'));
  anotarTasa(5, 'Aplicación', cTxt(
    'Tasa única para los ' + n + ' comparables: la columna «Tasa» de esta hoja es la '
    + 'fórmula =$B$11 en todas las filas. La plantilla de Capital IQ traía en su lugar la '
    + 'tasa del país de cada comparable, que es la fuga que este libro cierra.'));
  anotarTasa(6, 'Convención', cTxt(
    'Cuentas por cobrar y cuentas por pagar: r/(1+r). Inventario y propiedad, planta y '
    + 'equipo: r directo. Son dos convenciones dentro del mismo ajuste, heredadas de la '
    + 'plantilla; describir esta asimetría en el anexo metodológico del informe.'));

  hojas.push({
    nombre: 'Datos', celdas: datos,
    cols: [{ wch: 34 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 9 }, { wch: 3 }, { wch: 30 }, { wch: 62 }, { wch: 46 }],
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
      // A es texto (nombre), el resto numérico
      const nombreRef = { t: 's', f: `${D(`A${src}`)}` };
      const numRefs = ['B', 'C', 'D', 'E', 'F', 'G', 'H'].map((L) => cFor(`${D(`${L}${src}`)}`, '#,##0.00'));
      const tasaRef = cFor(`${D(`I${src}`)}`, '0.0000');
      // base comparable
      const base = M.base === 'ventas' ? `B${r}` : M.base === 'opex' ? `D${r}`
        : M.base === 'cogs' ? `C${r}` : `(C${r}+D${r})`;
      const denomDep = M.hoja === 'NCP' ? `((C${r}-G${r})+D${r})` : M.hoja === 'CostPlus' ? `(C${r}-G${r})` : null;
      const baseInv = M.dep ? denomDep : `M${r}`;
      const num = M.num === 'ebit' ? `J${r}` : `K${r}`;
      /* Denominador de los sabores que NO restan el ajuste de CxC del numerador
         («solo CxP», «solo inventario» y «solo PP&E»): la base sin corregir. La
         columna R descuenta ese ajuste y solo corresponde a los sabores que sí lo
         aplican. Para NCP y Cost Plus R es el denominador depurado (COGS−CxP), que
         no tiene nada que ver con el ajuste de CxC, así que ahí se mantiene. */
      const denomSinAR = M.base === 'ventas' ? `M${r}` : `R${r}`;

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
        cFor(`((H${r}/${baseInv})-(${PPE_s}/${baseS}))*(M${r}*I${r})`, '#,##0.000'), // Q Aj.PP&E
        cFor(`${M.dep ? denomDep : (M.base === 'ventas' ? `(B${r}-N${r})` : M.base === 'opex' ? `D${r}` : `M${r}`)}`, '#,##0.00'), // R denom ajustado
        cFor(`${num}/M${r}`, M.fmt),            // S sin ajuste
        cFor(`(${num}-N${r})/R${r}`, M.fmt),    // T CxC
        cFor(`(${num}+O${r})/${denomSinAR}`, M.fmt),  // U CxP
        cFor(`(${num}-P${r})/${denomSinAR}`, M.fmt),  // V Inv
        cFor(`(${num}-N${r}+O${r}-P${r})/R${r}`, M.fmt),        // W CxC+CxP+Inv
        cFor(`(${num}-N${r}+O${r}-P${r}-Q${r})/R${r}`, M.fmt), // X +PP&E
        cFor(`(${num}-Q${r})/${denomSinAR}`, M.fmt),  // Y PP&E
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

    infoMetodos.push({ hoja: M.hoja, nombre: M.nombre, fmt: M.fmt, base: M.base, dep: M.dep, r0, rN, filaMin, filaP25, filaP75, filaMax, filaTested, filaConcl: celdas.length });

    hojas.push({
      nombre: M.hoja, celdas,
      cols: [{ wch: 28 }].concat(new Array(24).fill({ wch: 11 })),
    });
  });

  /* ─── Hoja «Diagnóstico de datos» ───
     Las condiciones que invalidan un método o vuelven sospechoso un ajuste no se ven
     mirando el rango: hay que ir comparable por comparable. Esta hoja las cuenta por
     fórmula sobre «Datos», así que se actualiza sola cuando se corrige una cifra.

     Cubre las tres observaciones que salieron de la auditoría del libro: métodos
     inutilizables por costo de ventas casi nulo o denominador depurado negativo,
     cuentas por pagar de la parte examinada demasiado pequeñas para sostener el
     ajuste de CxP, y comparables cuyo PP&E desborda su propia utilidad. */
  if (n > 0) {
    const filaCompN = filaComp0 + n - 1;
    const cd = (L) => `Datos!$${L}$${filaComp0}:$${L}$${filaCompN}`;
    const VEN = cd('B'), COS = cd('C'), GAS = cd('D');
    const CXC = cd('E'), INV = cd('F'), CXP = cd('G'), PPE = cd('H');

    const dg = [];
    dg.push([cTxt('DIAGNÓSTICO DE DATOS — comprobaciones por fórmula sobre la hoja «Datos»')]);
    dg.push([cTxt('Nada está quemado: al corregir una cifra de entrada, estas comprobaciones se recalculan solas.')]);
    dg.push([]);

    dg.push([cTxt('1) ¿ES UTILIZABLE CADA MÉTODO CON ESTOS DATOS?')]);
    dg.push([cTxt('Método'), cTxt('Comparables afectados'), cTxt('Veredicto'), cTxt('Criterio')]);
    const CHEQUEOS = [
      ['Margen Bruto', `SUMPRODUCT(--(${COS}<0.05*${VEN}))`,
        'Costo de ventas por debajo del 5 % de las ventas: el margen bruto se pega al 100 % y deja de discriminar.'],
      ['Cost Plus', `SUMPRODUCT(--((${COS}-${CXP})<=0))`,
        'Denominador depurado (Costo − CxP) nulo o negativo: el indicador cambia de signo y no es interpretable.'],
      ['Índice de Berry', `SUMPRODUCT(--(${GAS}<=0))`,
        'Gastos operativos nulos o negativos: el índice se indefine.'],
      ['Net Cost Plus', `SUMPRODUCT(--(((${COS}-${CXP})+${GAS})<=0))`,
        'Denominador depurado ((Costo − CxP) + Gastos) nulo o negativo.'],
      ['Margen Operacional', `SUMPRODUCT(--(${VEN}<=0))`,
        'Ventas nulas o negativas: no hay base sobre la que calcular el margen.'],
    ];
    const filaCheq0 = dg.length + 1;
    CHEQUEOS.forEach(([nombre, formula, criterio], i) => {
      const r = filaCheq0 + i;
      dg.push([
        cTxt(nombre),
        cFor(formula, '#,##0'),
        cForT(`IF(B${r}=0,"Utilizable","Revisar: "&B${r}&" de ${n}")`),
        cTxt(criterio),
      ]);
    });
    dg.push([]);

    dg.push([cTxt('2) PARTE EXAMINADA — tamaño de las partidas de capital de trabajo')]);
    dg.push([cTxt('Partida'), cTxt('Valor'), cTxt('Unidad'), cTxt('Por qué importa')]);
    [
      ['Cuentas por cobrar', 'Datos!$B$7/Datos!$B$4*365', '#,##0.0', 'días de venta',
        'Sostiene el ajuste de CxC.'],
      ['Inventarios', 'Datos!$B$8/Datos!$B$5*365', '#,##0.0', 'días de costo',
        'Sostiene el ajuste de inventario. En cero, el ajuste solo recoge el de las comparables.'],
      ['Cuentas por pagar', 'Datos!$B$9/Datos!$B$5*365', '#,##0.0', 'días de costo',
        'Si equivalen a muy pocos días, verificar si hay pasivos comerciales clasificados en otras cuentas antes de sostener el ajuste de CxP.'],
      ['Cuentas por pagar / Ventas', 'Datos!$B$9/Datos!$B$4', '0.00%', 'porcentaje', ''],
      ['PP&E / Ventas', 'Datos!$B$10/Datos!$B$4', '0.00%', 'porcentaje',
        'Se contrasta contra la columna PP&E/Ventas de cada comparable, más abajo.'],
    ].forEach(([etq, f, z, uni, nota]) => {
      dg.push([cTxt(etq), cFor(f, z), cTxt(uni), cTxt(nota)]);
    });
    dg.push([]);

    /* Una comparable sin cartera, inventario, proveedores ni activo fijo entra al
       ajuste como si de verdad no tuviera ninguna de esas partidas —no como si
       faltara el dato—, y arrastra el rango hacia el margen sin ajustar. Es lo que
       pasa cuando el cribado de Capital IQ no trae las columnas de balance y no se
       cargaron los estados financieros de esa empresa. */
    const CERO = [
      ['Sin ninguna partida de capital de trabajo', `SUMPRODUCT(--((${CXC}=0)*(${INV}=0)*(${CXP}=0)))`,
        'Ni cartera, ni inventario, ni proveedores: su ajuste será cero por falta de datos, no por su operación.'],
      ['Sin cuentas por cobrar', `SUMPRODUCT(--(${CXC}=0))`, 'El ajuste de CxC no las mueve.'],
      ['Sin propiedad, planta y equipo', `SUMPRODUCT(--(${PPE}=0))`,
        'Los escenarios con PP&E las tratan como empresas sin activo fijo.'],
    ];
    dg.push([cTxt('3) COMPARABLES CON PARTIDAS DE BALANCE EN CERO')]);
    dg.push([cTxt('Situación'), cTxt('Comparables'), cTxt('Veredicto'), cTxt('Qué implica')]);
    const filaCero0 = dg.length + 1;
    CERO.forEach(([etq, formula, nota], i) => {
      const r = filaCero0 + i;
      dg.push([
        cTxt(etq),
        cFor(formula, '#,##0'),
        cForT(`IF(B${r}=0,"Todas con dato","Revisar: "&B${r}&" de ${n}")`),
        cTxt(nota),
      ]);
    });
    dg.push([]);

    /* PP&E comparable por comparable. Las referencias van contra la hoja MO porque
       ahí ya están calculados el ajuste (columna Q) y la utilidad operacional
       (columna J): repetir esas fórmulas aquí sería una segunda implementación que
       se desincroniza en cuanto cambie una. */
    const mo = infoMetodos.find((M) => M.hoja === 'MO');
    if (mo) {
      dg.push([cTxt('4) PP&E POR COMPARABLE — dónde el ajuste de PP&E desborda el resultado')]);
      dg.push([cTxt('Compañía'), cTxt('PP&E / Ventas'), cTxt('Ajuste PP&E (MO)'), cTxt('Utilidad operacional (MO)'),
        cTxt('¿El ajuste supera la utilidad?')]);
      for (let i = 0; i < n; i++) {
        const rMO = mo.r0 + i;
        const r = dg.length + 1;
        dg.push([
          cForT(`MO!A${rMO}`),
          cFor(`MO!H${rMO}/MO!B${rMO}`, '0.00%'),
          cFor(`MO!Q${rMO}`, '#,##0.000'),
          cFor(`MO!J${rMO}`, '#,##0.00'),
          cForT(`IF(ABS(C${r})>ABS(D${r}),"Sí — el escenario con PP&E no es defendible para esta compañía","")`),
        ]);
      }
      dg.push([]);
      dg.push([cTxt('El escenario que reporta el informe es «CxC+CxP+Inv» (columna W de las hojas de método),')]);
      dg.push([cTxt('que no incluye PP&E. Esta sección sirve para decidir si los escenarios con PP&E son presentables.')]);
    }

    hojas.unshift({
      nombre: 'Diagnóstico de datos', celdas: dg,
      cols: [{ wch: 34 }, { wch: 20 }, { wch: 26 }, { wch: 26 }, { wch: 58 }],
    });
  }

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
    /* Capital IQ cierra la hoja «Screening» con una nota legal
       («*Denotes proprietary information.») escrita en la columna del nombre. No es
       una compañía y contarla desnivela el universo contra el motor, que ya la
       descarta al importar. */
    const cand = seleccion.candidatas.filter(
      (c) => c && c.name && !String(c.name).startsWith('*') && !String(c.name).startsWith('Capital IQ'),
    );
    const umbralControl = seleccion.umbralControl != null ? seleccion.umbralControl : 50;
    const sel = [];
    sel.push([cTxt('SELECCIÓN DE COMPARABLES — trazabilidad completa del cribado')]);
    sel.push([cTxt('Cada estado y cada conteo del embudo es una fórmula sobre la base de datos de abajo. Nada está quemado.')]);
    sel.push([]);

    // Criterios de screening de Capital IQ
    sel.push([cTxt('CRITERIOS DE CRIBADO (Capital IQ)')]);
    (seleccion.criterios || []).forEach((cr) => {
      const con = cr.conector ? `${cr.conector}) ` : '';
      sel.push([cTxt(`${con}${cr.etiqueta}`), cTxt(cr.valor)]);
    });
    sel.push([]);

    /* Embudo con fórmulas COUNTIF sobre la columna «Motivo de rechazo», que es la
       que escribe el motor. Antes se contaba sobre las columnas de flags, que
       replicaban la precedencia de los filtros en fórmulas de Excel: dos
       implementaciones del mismo criterio que se desincronizaban en cuanto el motor
       cambiaba una regla. Ahora la hoja REFLEJA lo que el motor decidió.

       Están las SIETE exclusiones, no solo las de los filtros duros: si faltara
       alguna, la resta «Universo − exclusiones = Válidas» dejaría de cuadrar en
       cuanto la curación por IA descartara a alguien. */
    sel.push([cTxt('EMBUDO DE SELECCIÓN (Arts. 260-1 y 260-4 E.T.)')]);
    sel.push([cTxt('Etapa'), cTxt('Empresas'), cTxt('Fórmula / criterio')]);
    const fe = {};
    const etapa = (clave, etiqueta, criterio) => {
      fe[clave] = sel.length + 1;
      sel.push([cTxt(etiqueta), null, cTxt(criterio)]);
    };
    etapa('universo', 'Universo Capital IQ (tras cribado)', 'COUNTA de la columna Compañía');
    etapa('controlada', '(−) Vinculadas o controladas', `Un accionista supera el ${umbralControl} % del capital (Art. 260-1)`);
    etapa('holding', '(−) Holdings o grupos', 'Sociedad de cartera o grupo, sin operación directa (Art. 260-4)');
    etapa('negativo', '(−) Saldos negativos', 'Dato de balance no verosímil');
    etapa('perdida', '(−) Pérdida operativa', 'Criterio conservador DIAN: comparable rentable');
    etapa('sinDesc', '(−) Sin descripción del negocio', 'No hay con qué verificar la actividad');
    etapa('actividad', '(−) Actividad distinta', 'Curación IA: la descripción no coincide con la actividad');
    etapa('rigor', '(−) Diferencias funcionales', 'Perfil no comparable con la parte examinada (Art. 260-4)');
    etapa('validas', '= Válidas tras todos los criterios', 'Universo − las siete exclusiones de arriba');
    etapa('seleccionadas', '= Muestra final seleccionada', 'Comparables usadas en el rango (⊂ válidas)');
    sel.push([]);

    /* Suma de control: los siete motivos y las válidas son mutuamente excluyentes
       —el motor asigna un solo motivo por candidata, el primero que aplica— y agotan
       el universo, así que su suma tiene que dar el total exacto. Es la comprobación
       que permite firmar la hoja. */
    sel.push([cTxt('SUMA DE CONTROL (partición del universo — cada empresa cuenta una vez)')]);
    const sc = {};
    const control = (clave, etiqueta, criterio) => {
      sc[clave] = sel.length + 1;
      sel.push([cTxt(etiqueta), null, cTxt(criterio)]);
    };
    control('rechazadas', 'Total rechazadas', 'Suma de los siete motivos');
    control('validas', 'Total válidas', 'Estado = "Válida"');
    control('suma', 'SUMA', 'Rechazadas + válidas');
    control('universo', 'UNIVERSO (Capital IQ)', 'Total de compañías');
    control('check', '¿CUADRA? (suma = universo)', 'Debe decir "SÍ ✓"');
    control('seleccionadas', '   · de las válidas, la muestra del estudio', '¿Seleccionada? = "Sí"');
    control('difFuncional', '   · de las válidas, con diferencias funcionales', 'Superan los criterios pero no integran la muestra');
    control('checkVal', '¿Muestra + diferencias = válidas?', 'Debe decir "SÍ ✓"');
    sel.push([]);

    // Base de datos: encabezado + una fila por candidata
    sel.push([cTxt('BASE DE DATOS — UNIVERSO CAPITAL IQ')]);
    const filaHdrBase = sel.length + 1;
    const hcols = ['#', 'Compañía', 'Ticker', 'SIC', 'País', 'Ingresos', 'Utilidad op.', 'Costo',
      '% mayor accionista', 'Accionistas (dato original)', 'Controlada', 'Holding', 'Pérdida',
      'Motivo de rechazo', 'Perfil funcional', 'Estado', '¿Seleccionada?', 'Comparabilidad'];
    sel.push(hcols.map(cTxt));
    const r0 = sel.length + 1;
    /* A #, B Compañía, C Ticker, D SIC, E País, F Ingresos, G Utilidad op., H Costo,
       I % accionista, J Accionistas (texto), K Controlada, L Holding, M Pérdida,
       N Motivo, O Perfil, P Estado, Q ¿Seleccionada?, R Comparabilidad. */
    cand.forEach((c, i) => {
      const r = r0 + i;
      /* Se aceptan los dos juegos de nombres de campo: los del motor de este repo
         (`s`, `c`, `holderPct`) y los del paquete de parches (`rev`, `cogs`,
         `maxpct`), para no depender de un renombrado global que rompería a los otros
         consumidores de esta función. */
      const ingresos = c.rev != null ? c.rev : c.s;
      const costo = c.cogs != null ? c.cogs : c.c;
      const pct = c.maxpct != null ? c.maxpct : c.holderPct;
      sel.push([
        cNum(i + 1, '0'),
        cTxt(c.name), cTxt(c.ticker || ''), cTxt(c.sic || ''), cTxt(c.country || ''),
        ingresos == null ? cTxt('') : cNum(ingresos, '#,##0.00'),
        c.op == null ? cTxt('') : cNum(c.op, '#,##0.00'),
        costo == null ? cTxt('') : cNum(costo, '#,##0.00'),
        pct == null ? cTxt('') : cNum(pct, '0.00'),
        cTxt(c.holdersText || ''),                                  // J dato original, auditable
        cForT(`IF(N(I${r})>${umbralControl},"Sí","")`),              // K Controlada (fórmula)
        /* L Holding: la señal que trae la candidata y, si no viniera, el veredicto
           del motor. Una fila rechazada por holding con esta columna en blanco se
           lee como una contradicción de la hoja consigo misma. */
        cTxt(c.sospechaHolding === 'revisar' || c.isHolding || c.motivoClave === 'holding' || c.motivoClave === 'holdingDescripcion' ? 'Sí' : ''),
        cForT(`IF(N(G${r})<0,"Sí","")`),                             // M Pérdida (fórmula)
        cTxt(c.motivoClave || ''),                                   // N Motivo (del motor)
        cTxt(c.perfilFuncional || 'INDEFINIDO'),                     // O Perfil funcional
        cForT(`IF(N${r}="","Válida","Rechazada")`),                  // P Estado (fórmula)
        cTxt(c.seleccionada ? 'Sí' : ''),                            // Q ¿Seleccionada?
        /* R: el estado de comparabilidad dicho en palabras, en cada fila, para que
           quien filtre la tabla no tenga que cruzar el motivo con la selección. */
        cForT(`IF(P${r}<>"Válida","Rechazada (ver motivo)",IF(Q${r}="Sí","Sin diferencias funcionales","Con diferencias funcionales"))`),
      ]);
    });
    const rN = r0 + cand.length - 1;

    const cNombre = `B${r0}:B${rN}`;
    const cMotivo = `N${r0}:N${rN}`;
    const cEstado = `P${r0}:P${rN}`;
    const cSel = `Q${r0}:Q${rN}`;
    const cComp = `R${r0}:R${rN}`;

    /* Los siete motivos, con la MISMA clave que emite `scoreCandidates`: la hoja no
       reclasifica nada, cuenta lo que el motor escribió. */
    const MOTIVOS = [
      ['controlada', 'filtro', 'controlada', `Vinculadas: un accionista supera el ${umbralControl} % (Art. 260-1)`],
      ['holding', 'filtro', 'holding', 'Holdings o grupos, sin actividad operativa directa (Art. 260-4)'],
      ['negativo', 'filtro', 'saldoNegativo', 'Saldo negativo en balances (dato no verosímil)'],
      ['perdida', 'filtro', 'perdidaOperativa', 'Pérdida operativa (criterio conservador DIAN)'],
      ['sinDesc', 'ia', 'sinDescripcion', 'Sin descripción del negocio para verificar la actividad'],
      ['actividad', 'ia', 'actividadDistinta', 'Curación IA: la descripción no coincide con la actividad'],
      ['rigor', 'rigor', 'rigorFuncional', 'Diferencias funcionales: perfil no comparable (Art. 260-4)'],
    ];

    sel[fe.universo - 1][1] = cFor(`COUNTA(${cNombre})`, '#,##0');
    MOTIVOS.forEach(([clave, , motivo]) => {
      sel[fe[clave] - 1][1] = cFor(`COUNTIF(${cMotivo},"${motivo}")`, '#,##0');
    });
    sel[fe.validas - 1][1] = cFor(
      `B${fe.universo}-` + MOTIVOS.map(([clave]) => `B${fe[clave]}`).join('-'), '#,##0');
    sel[fe.seleccionadas - 1][1] = cFor(`COUNTIF(${cSel},"Sí")`, '#,##0');

    sel[sc.rechazadas - 1][1] = cFor(MOTIVOS.map(([clave]) => `B${fe[clave]}`).join('+'), '#,##0');
    sel[sc.validas - 1][1] = cFor(`COUNTIF(${cEstado},"Válida")`, '#,##0');
    sel[sc.suma - 1][1] = cFor(`B${sc.rechazadas}+B${sc.validas}`, '#,##0');
    sel[sc.universo - 1][1] = cFor(`COUNTA(${cNombre})`, '#,##0');
    sel[sc.check - 1][1] = cForT(
      `IF(B${sc.suma}=B${sc.universo},"SÍ ✓","NO ✗ ("&B${sc.suma}&" vs "&B${sc.universo}&")")`);
    sel[sc.seleccionadas - 1][1] = cFor(`COUNTIF(${cSel},"Sí")`, '#,##0');
    sel[sc.difFuncional - 1][1] = cFor(`COUNTIF(${cComp},"Con diferencias funcionales")`, '#,##0');
    sel[sc.checkVal - 1][1] = cForT(
      `IF(B${sc.seleccionadas}+B${sc.difFuncional}=B${sc.validas},"SÍ ✓","NO ✗")`);

    hojas.unshift({
      nombre: 'Selección comparables', celdas: sel,
      cols: [{ wch: 5 }, { wch: 36 }, { wch: 14 }, { wch: 38 }, { wch: 16 }, { wch: 13 }, { wch: 13 },
        { wch: 13 }, { wch: 16 }, { wch: 60 }, { wch: 10 }, { wch: 9 }, { wch: 9 }, { wch: 18 },
        { wch: 15 }, { wch: 11 }, { wch: 14 }, { wch: 26 }],
      autofiltro: `A${filaHdrBase}:R${rN}`,
    });

    /* ─── Hoja «Matriz de rechazo» ───
       La misma matriz que el informe lleva en su tabla de razones de rechazo, pero
       por fórmula contra la hoja de al lado. Sirve para dos cosas: cuadrar el
       informe contra el universo antes de radicarlo, y poder decir ante la DIAN
       cuántas compañías cayeron por cada criterio sin recontar a mano. */
    const mtz = [];
    mtz.push([cTxt('MATRIZ DE RECHAZO — coherente con el motor del sistema')]);
    mtz.push([cTxt('Conteos por fórmula sobre la columna «Motivo de rechazo» de la hoja Selección comparables.')]);
    mtz.push([]);
    mtz.push([cTxt('Categoría'), cTxt('Motivo'), cTxt('Descripción'), cTxt('Empresas')]);
    const refMotivo = `'Selección comparables'!${cMotivo}`;
    const mFila0 = mtz.length + 1;
    MOTIVOS.forEach(([, categoria, motivo, descripcion]) => {
      mtz.push([cTxt(categoria), cTxt(motivo), cTxt(descripcion),
        cFor(`COUNTIF(${refMotivo},"${motivo}")`, '#,##0')]);
    });
    const mFilaN = mFila0 + MOTIVOS.length - 1;
    mtz.push([]);

    const colCat = `A${mFila0}:A${mFilaN}`, colCant = `D${mFila0}:D${mFilaN}`;
    const sub = {};
    ['filtro', 'ia', 'rigor'].forEach((categoria) => {
      sub[categoria] = mtz.length + 1;
      mtz.push([cTxt('SUBTOTAL ' + categoria), cTxt(''), cTxt(''),
        cFor(`SUMIF(${colCat},"${categoria}",${colCant})`, '#,##0')]);
    });
    const fTotRech = mtz.length + 1;
    mtz.push([cTxt('TOTAL RECHAZADAS'), cTxt(''), cTxt(''),
      cFor(`SUM(${colCant})`, '#,##0')]);
    const fSel = mtz.length + 1;
    mtz.push([cTxt('(+) Válidas — muestra seleccionada'), cTxt(''),
      cTxt('Sin diferencias funcionales relevantes: las comparables del estudio'),
      cFor(`COUNTIF('Selección comparables'!${cSel},"Sí")`, '#,##0')]);
    const fDif = mtz.length + 1;
    mtz.push([cTxt('(+) Válidas — con diferencias funcionales'), cTxt(''),
      cTxt('Superan los criterios pero no integran la muestra'),
      cFor(`COUNTIF('Selección comparables'!${cComp},"Con diferencias funcionales")`, '#,##0')]);
    const fUniv = mtz.length + 1;
    mtz.push([cTxt('= UNIVERSO (debe igualar el de Capital IQ)'), cTxt(''), cTxt(''),
      cFor(`D${fTotRech}+D${fSel}+D${fDif}`, '#,##0')]);
    const fReal = mtz.length + 1;
    mtz.push([cTxt('UNIVERSO real (Capital IQ)'), cTxt(''), cTxt(''),
      cFor(`COUNTA('Selección comparables'!${cNombre})`, '#,##0')]);
    mtz.push([cTxt('¿CUADRA? (rechazadas + válidas = universo)'), cTxt(''), cTxt(''),
      cForT(`IF(D${fUniv}=D${fReal},"SÍ ✓","NO ✗ ("&D${fUniv}&" vs "&D${fReal}&")")`)]);
    mtz.push([]);
    mtz.push([cTxt('Nota: los motivos «ia» y «rigor» los asigna el motor sobre la descripción del negocio')]);
    mtz.push([cTxt('y el perfil funcional. Si la selección no se ha ejecutado, llegan en cero.')]);

    hojas.splice(1, 0, {
      nombre: 'Matriz de rechazo', celdas: mtz,
      cols: [{ wch: 12 }, { wch: 20 }, { wch: 68 }, { wch: 11 }],
    });
  }

  return hojas;
}
