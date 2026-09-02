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

   Desde agosto de 2026 emite ADEMÁS el valor en caché de cada celda derivada, y lo
   pide a `ajusteRangoCapitalTrabajo.js` —el mismo motor que alimenta las tablas del
   .docx—. No es que el libro haya dejado de ser recalculable: la fórmula sigue ahí y
   Excel la recalcula al abrir. Lo que cambia es que el número que el libro publica y
   el que publica el informe son el mismo objeto y no dos cálculos parecidos, y que el
   .xlsx deja de verse vacío en cualquier lector que no recalcule. Si una fórmula y el
   motor discrepan, Excel mueve la celda al abrir y la discrepancia queda a la vista.

   Devuelve la misma estructura { nombre, celdas, cols, merges, autofiltro } que el
   componente MemoriaRangoModal.jsx ya sabe volcar, para no tocar la ruta de descarga.
   ───────────────────────────────────────────────────────────────────────────── */

import {
  analizarRangoAjustado, desgloseAjuste, entraPorAmbito,
} from './ajusteRangoCapitalTrabajo.js';
/* El MISMO conversor que usa el motor (`cifras` lo aplica a cada cifra que recibe). Este
   emisor usaba `Number(...) || 0`, que sobre las cadenas formateadas que escriben los
   analistas y traen los archivos —«5.271.105.507», «(1.500)», «7,37 %»— da `NaN` y cae a
   cero, mientras el motor las lee bien: el libro publicaba un contribuyente en cero y el
   informe el correcto. Dos procedencias para el mismo dato, que es el defecto que el
   diseño de 2026-08-11 retira. */
import { num } from '../utils/calculations.js';
import { traducirCriterio } from './criteriosScreeningEs.js';

/* Métodos y su configuración de fórmulas. `base` indica sobre qué se calcula el
   indicador y se escalan las partidas; `num` el numerador; `dep` si usa el
   denominador depurado (COGS−CxP [+opex]) para NCP y Cost Plus. */
const METODOS = [
  { hoja: 'MO', nombre: 'Margen Operacional', base: 'ventas', num: 'ebit', dep: false, fmt: '0.000%' },
  { hoja: 'MB', nombre: 'Margen Bruto', base: 'ventas', num: 'gp', dep: false, fmt: '0.000%' },
  { hoja: 'Berry', nombre: 'Índice de Berry', base: 'opex', num: 'gp', dep: false, fmt: '0.0000' },
  { hoja: 'CostPlus', nombre: 'Cost Plus', base: 'cogs', num: 'gp', dep: true, fmt: '0.0000' },
  { hoja: 'NCP', nombre: 'Net Cost Plus', base: 'costos', num: 'ebit', dep: true, fmt: '0.000%' },
];

/* Rubros de la parte examinada en la hoja Datos, en el orden en que se escriben.
   La dirección de cada uno se DERIVA de este arreglo y no se escribe a mano en
   ninguna fórmula: al insertar un rubro, las cinco hojas de método siguen apuntando
   al correcto. Una dirección absoluta escrita a mano en una fórmula es un fallo
   silencioso —da un número creíble y falso— y por eso no queda ninguna.

   El comentario evita nombrar una dirección concreta a propósito: el comando de
   verificación del Step 4 busca literales por texto y una mención en prosa se delataría
   a sí misma.

   Los doce rubros que la ingesta sabe leer, en orden de balance. El orden y las
   etiquetas siguen a `RUBROS_ESF` de docxRelleno.js: son el mismo estado financiero
   visto desde el libro y desde el ANEXO A, y si divergen el informe publica un
   balance que su propio soporte no reproduce.

   `av: false` marca los rubros que NO llevan análisis vertical en esta hoja: el total de
   activos, porque un 100 % por definición no informa nada —aunque `filasEsfAnexoA` en
   docxRelleno.js sí lo calcula y lo publica en el ANEXO A, que sale de mapear TODO
   `RUBROS_ESF` incluido el total—, y las cuentas por pagar, porque un pasivo sobre el
   total de activos no significa nada (esa sí coincide con el criterio de
   `filasEsfAnexoA`, que las excluye del `map` y las publica con `SIN_DATO`). Las tres
   cifras del estado de resultados —ventas, costo y gastos— tampoco llevan A.V.: no son
   partidas del balance.

   Las etiquetas son las literales de `RUBROS_ESF`, sin abreviar: quien audite el libro
   contra el ANEXO A tiene que poder mapear cada fila por su texto exacto, sin tener que
   saber cuáles son fieles y cuáles un alias histórico de la hoja. */
export const RUBROS_EXAMINADA = [
  { clave: 't_s', etiqueta: 'Ventas netas', av: false },
  /* `egreso: true` — la hoja los publica con el signo del estado financiero, en negativo,
     que es la convención que el usuario fijó el 2026-08-21 para que la hoja se lea igual que
     el documento radicado. Antes el costo salía negativo y los gastos positivos: dos egresos
     contiguos con convenios distintos.
     Las FÓRMULAS que los usan van todas envueltas en ABS —las referencias del contribuyente
     (`C_s`, `OP_s`), las columnas C y D de cada hoja de método y los chequeos del
     diagnóstico—, así que las restas no se convierten en sumas. */
  { clave: 't_c', etiqueta: 'Costo de ventas', av: false, egreso: true },
  { clave: 't_op', etiqueta: 'Gastos operativos', av: false, egreso: true },
  { clave: 't_cash', etiqueta: 'Efectivo y equivalentes de efectivo', av: true },
  { clave: 't_inv_assoc', etiqueta: 'Inversiones asociadas', av: true },
  { clave: 't_ar', etiqueta: 'Cuentas por cobrar comerciales y otras cuentas por cobrar', av: true },
  { clave: 't_inv', etiqueta: 'Inventarios', av: true },
  { clave: 't_tax', etiqueta: 'Activos por impuestos corrientes', av: true },
  { clave: 't_act_curr', etiqueta: 'Total, Activo corriente', av: true },
  { clave: 't_ppe', etiqueta: 'Propiedades, planta y equipo', av: true },
  { clave: 't_intang', etiqueta: 'Intangibles', av: true },
  { clave: 't_dif', etiqueta: 'Diferidos', av: true },
  { clave: 't_act_nocurr', etiqueta: 'Total, Activos no corrientes', av: true },
  { clave: 't_act_tot', etiqueta: 'Total, Activos', av: false },
  { clave: 't_ap', etiqueta: 'Cuentas por pagar comerciales', av: false },
];

/* Las claves de los quince rubros, en el orden de la hoja. Se exporta para que quien
   arme el payload del libro no vuelva a escribir la lista a mano: cuando esa lista vivía
   duplicada en `MotorComparables.jsx`, los ocho rubros del ESF que se añadieron aquí
   nunca llegaron allá y el libro los publicaba en cero sin que nada lo advirtiera. */
export const CLAVES_RUBROS_EXAMINADA = RUBROS_EXAMINADA.map((r) => r.clave);

/* 1-based: fila 1 título, 2 vacía, 3 «PARTE EXAMINADA», 4 el primer rubro. */
const FILA_RUBRO_0 = 4;
const filaDeRubro = (clave) => FILA_RUBRO_0
  + RUBROS_EXAMINADA.findIndex((r) => r.clave === clave);
/* La tasa va inmediatamente después del último rubro. */
const FILA_TASA = () => FILA_RUBRO_0 + RUBROS_EXAMINADA.length;
/* La fila del ámbito de la muestra, que la hoja de método lee para decidir qué filas
   entran al cuartil. Va detrás de la tasa, que va detrás del último rubro. */
const FILA_AMBITO = () => FILA_TASA() + 1;

/* El orden de este arreglo ES el orden de las columnas S–Y de las hojas de método y
   el de las filas de la hoja Resumen. Reordenarlo cruza los valores en caché con las
   fórmulas sin que nada reviente: el libro saldría con cifras creíbles en el sitio
   errado. Lo sujeta la prueba «cada columna S–Y trae el valor del sabor que le
   corresponde», que repite este orden como literal. */
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
/* Fórmula numérica. `v` es el valor en caché: la fórmula la recalcula Excel, el valor
   lo pone el motor. Se omite cuando no hay valor que poner —una comparable cuyas cifras
   no le permiten al motor construir el ajuste, o una fila que no entra a la serie— y
   entonces la celda sale como salía antes.

   La guarda `Number.isFinite` no es una cortesía: `{ t:'n', v:'' }` emite `<v></v>` en
   una celda numérica, que es XML inválido y manda el libro a modo reparación. Y un cero
   fingiría una observación que no existe y hundiría el rango. */
const cFor = (f, z, v) => {
  const celda = { t: 'n', f, z: z || '0.000%' };
  if (v !== undefined && v !== null && Number.isFinite(v)) celda.v = v;
  return celda;
};
/* Fórmula de texto (la conclusión y la marca de ámbito). Aquí la cadena vacía SÍ es un
   valor legítimo: sale como `t="str"` con `<v></v>`, que es un texto vacío válido. */
const cForT = (f, v) => {
  const celda = { t: 's', f };
  if (v !== undefined && v !== null) celda.v = String(v);
  return celda;
};

/* Referencia a una celda de la hoja Datos. */
const D = (celda) => `Datos!${celda}`;

/* Términos que delatan una sociedad de cartera o de grupo en la razón social. Es el
   mismo criterio que aplica `tieneSemanticaHolding` en filtrosComparablesPatch.js:
   subcadena, sin distinguir mayúsculas, y SOLO sobre el nombre —ni el código SIC ni
   la descripción del negocio intervienen—. Se replican aquí como fórmula para que la
   hoja muestre el criterio en vez de una marca ya decidida; si el vocabulario cambia
   allá, hay que traerlo aquí, y el test de paridad entre ambos lo recuerda. */
export const TERMINOS_HOLDING_HOJA = [
  'holding', 'grupo', 'group', 'holdco', 'hldg', 'groupe', 'gruppo',
  'sociedad de cartera', 'sociedad tenedora', 'sociedad matriz', 'tenedora de acciones',
  'holdingmaatschappij',
];
/* SEARCH no distingue mayúsculas de minúsculas, que es justo lo que se busca. */
const HOLDING_FORMULA = (ref) => 'IF(OR('
  + TERMINOS_HOLDING_HOJA.map((t) => `ISNUMBER(SEARCH("${t}",${ref}))`).join(',')
  + '),"Sí","")';

/**
 * Construye las hojas del libro con fórmulas vivas.
 *
 * @param estudio  el estudio con t_s, t_c, t_op(gastos), t_ar, t_inv, t_ap, t_ppe,
 *                 prime, cmode (ámbito de la muestra: 'nac', 'intl' o cualquier otro
 *                 valor para todas), seg_excluido (ingreso de una operación no
 *                 controlada que se descuenta de t_s) y comparables
 *                 [{name,s,c,op,ar,inv,ap,ppe,amb}], con `amb` en 'Nac' o 'Int'.
 *                 IMPORTANTE: `op` y `t_op` deben ser GASTOS operativos
 *                 (usar el normalizador eeffParserNormalizador.js antes), y `prime`
 *                 es la tasa EN PORCENTAJE (7.37, no 0.0737): esta función la divide
 *                 entre 100 al escribir la celda de la tasa en la hoja Datos (la fila
 *                 la fija `FILA_TASA()`, no un número quemado aquí), así que quien la
 *                 llame no debe hacerlo antes.
 *
 *                 `cmode` y `amb` NO son un dato decorativo de la hoja Datos: el
 *                 filtrado del cuartil por ámbito lo aplica ESTA función. `cmode` se
 *                 escribe en la fila que fija `FILA_AMBITO()` y el `amb` de cada
 *                 comparable en la columna «Ámbito» de la tabla; la hoja de método los
 *                 lee en su columna «Entra por ámbito» (Z), y las siete columnas de
 *                 serie (AA–AG) —las únicas que cuartilan MIN, MAX y QUARTILE— solo
 *                 dejan pasar las filas que entran. Quien llama no tiene que filtrar
 *                 nada antes ni después: pasar la muestra completa es lo correcto.
 * @param seleccion  (opcional) trazabilidad de la selección de comparables:
 *                 { criterios:[{etiqueta,valor,conector,etiquetaEs?,valorEs?}] —el texto
 *                   crudo de Capital IQ, que se traduce al escribir la hoja—,
 *                   umbralControl?:number,
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
  /* El valor de cada rubro. `t_s` es el único que no se escribe tal cual: descuenta el
     segmento excluido con el mismo criterio del motor (`ajusteRangoCapitalTrabajo.js:
     271-276`), solo de las ventas y no de `t_op`, porque aquí `t_op` son GASTOS y
     restarlo también movería la utilidad operacional dos veces. Queda en una función
     para que ampliar la lista de rubros no pueda perder el descuento por el camino.

     Va aquí y no en `motorExcelExport` porque este emisor es el único punto por el que
     pasan las dos rutas de descarga del libro: la del motor y la del modal
     (MemoriaRangoModal.jsx:93).

     El `|| 0` va DESPUÉS de `num`, no en lugar de él: `num` devuelve null en el rubro que
     el estudio no trae, y ahí el cero es lo que corresponde —la hoja publica el balance
     completo y una fila en blanco rompería el análisis vertical—. Lo que cambia es que
     ahora una cifra en cadena formateada llega como la cifra y no como cero. */
  const segExcluido = num(study.seg_excluido) || 0;
  const ES_EGRESO = new Set(RUBROS_EXAMINADA.filter((r) => r.egreso).map((r) => r.clave));
  /* El signo de la celda, no el del cálculo: los egresos se publican en negativo venga el
     dato como venga —la lectura del documento conserva su signo, pero un analista puede
     escribirlo en positivo en el formulario, y Capital IQ da los costos de las comparables
     en positivo—. Así la columna se lee homogénea en lugar de mezclar convenios. */
  const valorDeRubro = (clave) => {
    if (clave === 't_s') return (num(study.t_s) || 0) - segExcluido;
    const v = num(study[clave]) || 0;
    return ES_EGRESO.has(clave) ? -Math.abs(v) : v;
  };

  /* El contribuyente con la forma que espera `desgloseAjuste`. Las ventas salen de
     `valorDeRubro('t_s')` —la misma función que escribe la celda de Datos— y no de
     `study.t_s`, que viene en bruto: tomarlas de ahí dejaría los intermedios calculados
     sobre unas ventas y la celda que los referencia sobre otras. */
  const contribuyenteDelEstudio = {
    s: valorDeRubro('t_s'), c: study.t_c, op: study.t_op,
    ar: study.t_ar, inv: study.t_inv, ap: study.t_ap, ppe: study.t_ppe,
  };

  const filaTot = filaDeRubro('t_act_tot');
  /* El total de activos, calculado una vez: lo escribe la celda de su propio rubro y
     lo divide el A.V. de los otros diez. Leerlo dos veces del estudio abriría la
     puerta a que la celda y el valor en caché partieran de cifras distintas. */
  const totalActivos = valorDeRubro('t_act_tot');
  RUBROS_EXAMINADA.forEach((r) => {
    const celdas = [cTxt(r.etiqueta), cNum(valorDeRubro(r.clave))];
    /* A.V. como fórmula y no como número: es lo que hace que corregir una cifra en
       Datos recalcule el vertical del ANEXO A y de la Tabla 10 sin recalcularlo a
       mano en dos sitios. La guarda IF(total=0,"",…) es la misma que aplica
       `verticalSobreActivos` en docxRelleno.js (ahí devuelve «—» sin total; aquí, con
       el total en cero, la celda queda en blanco en vez de mostrar #DIV/0!): un
       estudio que llegue a esta hoja sin `t_act_tot` no debe romper el libro, sea por
       la ruta del Motor de Comparables o por cualquier otro llamador presente o
       futuro que no traiga el dato.

       Y con su valor en caché, que es el mismo cociente que publica
       `verticalSobreActivos` en el ANEXO A. Sin él las diez celdas del vertical salían
       vacías para cualquier lector que no recalcule, que es justo lo que este libro
       dejó de hacer en el resto de sus hojas. La guarda del valor es la MISMA que la de
       la fórmula: con el total en cero la fórmula devuelve "" y aquí no se escribe
       valor, porque un cero fingiría un vertical calculado sobre un balance que no
       llegó. */
    if (r.av) {
      const fila = filaDeRubro(r.clave);
      celdas.push(cFor(`IF($B$${filaTot}=0,"",B${fila}/$B$${filaTot})`, '0.000%',
        totalActivos ? valorDeRubro(r.clave) / totalActivos : undefined));
    }
    datos.push(celdas);
  });
  /* La tasa del estudio en tanto por uno, calculada UNA vez. La escriben tres sitios —la
     celda de esta hoja, la columna «Tasa» de cada hoja de método y la llamada al motor que
     produce los intermedios del ajuste— y dividir entre 100 por separado en cada uno es lo
     que hace que dos de ellos puedan quedarse atrás de un arreglo del tercero. */
  const tasaDelEstudio = (num(study.prime) || 0) / 100;
  datos.push([
    cTxt('Tasa de interés de referencia (Prime Rate)'),
    cNum(tasaDelEstudio, '0.000%'),
  ]);
  /* El ámbito de la muestra, escrito como dato y no como decisión ya aplicada: la
     hoja de método lo lee para decidir qué filas entran al cuartil. */
  datos.push([cTxt('Ámbito de la muestra'), cTxt(study.cmode || 'all')]);
  datos.push([]);
  datos.push([cTxt('COMPARABLES')]);
  const hdr = ['Compañía', 'Ventas', 'Costo', 'Gastos op.', 'CxC', 'Inventario', 'CxP', 'PP&E', 'Tasa', 'Ámbito'];
  datos.push(hdr.map(cTxt));
  const filaComp0 = datos.length + 1; // 1-based fila de la primera comparable
  comps.forEach((c) => {
    datos.push([
      /* Costo y gastos operativos en negativo, igual que los del contribuyente: es la misma
         convención de egreso, y aquí importa doblemente porque Capital IQ los entrega en
         positivo y el estado financiero de una comparable colombiana en negativo. Las hojas
         de método los leen con ABS. */
      cTxt(c.name), cNum(num(c.s) || 0),
      cNum(-Math.abs(num(c.c) || 0)), cNum(-Math.abs(num(c.op) || 0)),
      cNum(num(c.ar) || 0), cNum(num(c.inv) || 0), cNum(num(c.ap) || 0),
      cNum(num(c.ppe) || 0),
      /* La tasa sigue siendo la REFERENCIA a la celda única —esa es la fuga que este
         libro cierra: la plantilla de Capital IQ traía aquí la tasa del país de cada
         comparable—, y además su valor en caché, que es el de esa misma celda y no uno
         propio. Sin él la columna salía vacía en cualquier lector que no recalcule, y
         de ella cuelga la columna I de las cinco hojas de método. */
      cFor(`$B$${FILA_TASA()}`, '0.000%', tasaDelEstudio),
      cTxt(c.amb === 'Nac' ? 'Nac' : 'Int'),
    ]);
  });

  /* ─── Trazabilidad de la tasa, en las columnas L–N ───
     La tabla de comparables llega hasta la J (con la columna de Ámbito), así que este
     bloque cabe al lado sin estorbar. Deja escrito de dónde sale el número, a qué
     comparables alcanza y con qué convención se aplica: quien audita el libro no
     debería tener que preguntarlo. La celda editable sigue siendo una sola —la fila
     que calcula `FILA_TASA()`—; aquí solo se refleja.
     Los índices de columna son 11 y 12 (antes 10 y 11): la columna J de Ámbito
     desplazó una posición a este bloque, que vivía en K–M. */
  const anotarTasa = (idxFila, etiqueta, valor) => {
    if (!datos[idxFila]) datos[idxFila] = [];
    datos[idxFila][11] = cTxt(etiqueta);
    datos[idxFila][12] = valor;
  };
  const celdaTasa = `B${FILA_TASA()}`;
  anotarTasa(2, 'PARÁMETRO — TASA DE INTERÉS DE LOS AJUSTES DE CAPITAL DE TRABAJO', null);
  /* También con valor: es la celda que un auditor mira primero para saber con qué tasa
     se armaron los ajustes, y refleja la editable en vez de duplicarla. */
  anotarTasa(3, 'Tasa aplicada', cFor(`$B$${FILA_TASA()}`, '0.000%', tasaDelEstudio));
  datos[3][13] = cTxt(`← única celda editable: ${celdaTasa} alimenta a los ` + n + ' comparables');
  anotarTasa(4, 'Fuente', cTxt(
    'Board of Governors of the Federal Reserve System, H.15 Selected Interest Rates — '
    + 'Bank Prime Loan Rate (serie FRED RIFSPBLPNA). Promedio anual de días hábiles: '
    + '2025 = 7,37 %; 2024 = 8,31 %.'));
  anotarTasa(5, 'Aplicación', cTxt(
    'Tasa única para los ' + n + ' comparables: la columna «Tasa» de esta hoja es la '
    + `fórmula =$B$${FILA_TASA()} en todas las filas. La plantilla de Capital IQ traía en su lugar la `
    + 'tasa del país de cada comparable, que es la fuga que este libro cierra.'));
  anotarTasa(6, 'Convención', cTxt(
    'Cuentas por cobrar y cuentas por pagar: r/(1+r). Inventario y propiedad, planta y '
    + 'equipo: r directo. Son dos convenciones dentro del mismo ajuste, heredadas de la '
    + 'plantilla; describir esta asimetría en el anexo metodológico del informe.'));

  hojas.push({
    nombre: 'Datos', celdas: datos,
    cols: [{ wch: 34 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 9 }, { wch: 9 }, { wch: 3 }, { wch: 30 }, { wch: 62 }, { wch: 46 }],
  });

  // Referencias del contribuyente, derivadas del orden de RUBROS_EXAMINADA
  const refDe = (clave) => D(`$B$${filaDeRubro(clave)}`);
  /* El costo y los gastos van envueltos en ABS, y no es cosmética: la hoja `Datos`
     conserva el signo con que el estado financiero los imprime —negativo o entre
     paréntesis— para que el libro se lea igual que el documento radicado, mientras el
     cálculo necesita la magnitud (utilidad bruta = ventas − costo). Es la misma
     frontera que `egreso()` en `utils/calculations.js`, del lado de la fórmula: sin
     ella, un estudio con el costo en negativo publica en el libro una utilidad bruta
     del doble y un margen operacional de tres dígitos, y el recálculo de Excel lo
     confirmaría en lugar de delatarlo. */
  const S_s = refDe('t_s');
  const C_s = `ABS(${refDe('t_c')})`, OP_s = `ABS(${refDe('t_op')})`;
  const AR_s = refDe('t_ar'), INV_s = refDe('t_inv');
  const AP_s = refDe('t_ap'), PPE_s = refDe('t_ppe');

  /* ─── Una hoja por método, con fórmulas por comparable ─── */
  const infoMetodos = [];
  METODOS.forEach((M) => {
    /* El valor de cada celda derivada, pedido al motor una vez por sabor. Siete
       llamadas por método sobre un puñado de comparables: el coste es despreciable y
       lo que compra es que el libro no pueda discrepar del informe.

       Se le pasa `study` tal cual: `analizarRangoAjustado` descuenta el segmento
       excluido y divide `prime` entre 100 por su cuenta (:276 y :285), y `op`/`t_op`
       son GASTOS operativos en los dos lados. Convertir algo aquí sería introducir
       justo la desviación que esta tarea viene a cerrar. */
    const porSabor = AJUSTES.map((aj) => analizarRangoAjustado(study, M.hoja, aj.clave));

    const celdas = [];
    celdas.push([cTxt(`${M.nombre} — fórmulas vivas y trazables`)]);
    // encabezado de columnas
    const cols = ['Compañía', 'Ventas', 'Costo', 'Gastos op.', 'CxC', 'Inv', 'CxP', 'PP&E', 'Tasa',
      'EBIT', 'Util.bruta', 'desc', 'Base', 'Aj.CxC', 'Aj.CxP', 'Aj.Inv', 'Aj.PP&E', 'Denom.',
      'Sin ajuste', 'CxC', 'CxP', 'Inv', 'CxC+CxP+Inv', '+PP&E', 'PP&E',
      'Entra por ámbito',
      'Serie: Sin ajuste', 'Serie: CxC', 'Serie: CxP', 'Serie: Inv',
      'Serie: CxC+CxP+Inv', 'Serie: +PP&E', 'Serie: PP&E'];
    celdas.push(cols.map(cTxt));
    const filaHdr = celdas.length; // 1-based
    const r0 = filaHdr + 1; // primera fila de comparable

    // base_s (contribuyente) según método
    const baseS = M.base === 'ventas' ? S_s : M.base === 'opex' ? OP_s
      : M.base === 'cogs' ? C_s : `(${C_s}+${OP_s})`;

    for (let i = 0; i < n; i++) {
      const c = comps[i];
      const r = r0 + i;
      const src = filaComp0 + i; // fila en Datos
      /* Columnas A..I: referencias a Datos (letras A..I = 1..9). A es texto (nombre),
         el resto numérico. El valor en caché es el literal que el emisor ya tiene en
         `study`, en el mismo orden en que escribió la tabla de la hoja Datos. */
      const nombreRef = { t: 's', f: `${D(`A${src}`)}`, v: String(c.name || '') };
      const cifras = [c.s, c.c, c.op, c.ar, c.inv, c.ap, c.ppe];
      /* Igual que con el contribuyente: las columnas de costo (C) y gastos operativos
         (D) traen la MAGNITUD, aunque la hoja `Datos` guarde el signo del documento.
         Envolver aquí la referencia —y no cada una de las fórmulas J, K, M, R y S–Y que
         la usan— deja un solo sitio donde el convenio cambia, y hace que la propia
         columna del método muestre el número con el que se está calculando. */
      const enMagnitud = new Set(['C', 'D']);
      const numRefs = ['B', 'C', 'D', 'E', 'F', 'G', 'H'].map((L, k) => {
        const ref = D(`${L}${src}`);
        const v = num(cifras[k]) || 0;
        return enMagnitud.has(L)
          ? cFor(`ABS(${ref})`, '#,##0.00', Math.abs(v))
          : cFor(`${ref}`, '#,##0.00', v);
      });
      /* La tasa es la única del estudio y viaja en porcentaje: es el mismo doble que
         escribió la celda de la hoja Datos, porque es literalmente el mismo valor. */
      const tasaRef = cFor(`${D(`I${src}`)}`, '0.0000', tasaDelEstudio);
      // base comparable
      const base = M.base === 'ventas' ? `B${r}` : M.base === 'opex' ? `D${r}`
        : M.base === 'cogs' ? `C${r}` : `(C${r}+D${r})`;
      const denomDep = M.hoja === 'NCP' ? `((C${r}-G${r})+D${r})` : M.hoja === 'CostPlus' ? `(C${r}-G${r})` : null;
      const baseInv = M.dep ? denomDep : `M${r}`;
      /* La celda del numerador del método: la J (EBIT) o la K (utilidad bruta). Se llama
         `celdaNum` y no `num` porque `num` es ahora el conversor de cifras importado
         arriba, y la constante local lo sombreaba dentro de este bucle. */
      const celdaNum = M.num === 'ebit' ? `J${r}` : `K${r}`;
      /* Denominador de los sabores que NO restan el ajuste de CxC del numerador
         («solo CxP», «solo inventario» y «solo PP&E»): la base sin corregir. La
         columna R descuenta ese ajuste y solo corresponde a los sabores que sí lo
         aplican. Para NCP y Cost Plus R es el denominador depurado (COGS−CxP), que
         no tiene nada que ver con el ajuste de CxC, así que ahí se mantiene. */
      const denomSinAR = M.base === 'ventas' ? `M${r}` : `R${r}`;

      /* Los intermedios, del mismo motor. No dependen del sabor: son los cuatro
         ajustes completos, y cada columna S–Y elige cuáles aplica.

         `|| {}` deja los nueve campos en `undefined` cuando el motor no puede construir
         el desglose —comparable sin cifras, base en cero, método sin base—, y entonces
         `cFor` omite el valor y la celda sale como salía antes: fórmula que Excel
         resuelve al abrir. Es el mismo criterio que siguen las columnas S–Y. */
      const dg = desgloseAjuste(comps[i], contribuyenteDelEstudio, M.hoja,
        tasaDelEstudio) || {};

      const fila = [
        nombreRef,                              // A nombre
        ...numRefs,                             // B..H cifras
        tasaRef,                                // I tasa
        cFor(`B${r}-C${r}-D${r}`, '#,##0.00', dg.ebit),  // J EBIT
        cFor(`B${r}-C${r}`, '#,##0.00', dg.utilBruta),    // K util bruta
        cFor(`I${r}/(1+I${r})`, '0.00000', dg.desc),      // L desc
        cFor(`${base}`, '#,##0.00', dg.base),             // M base
        cFor(`((E${r}/M${r})-(${AR_s}/${baseS}))*(M${r}*L${r})`, '#,##0.000', dg.ajusteAR),   // N Aj.CxC
        cFor(`((G${r}/M${r})-(${AP_s}/${baseS}))*(M${r}*L${r})`, '#,##0.000', dg.ajusteAP),   // O Aj.CxP
        cFor(`((F${r}/${baseInv})-(${INV_s}/${baseS}))*(M${r}*I${r})`, '#,##0.000', dg.ajusteINV), // P Aj.Inv
        cFor(`((H${r}/${baseInv})-(${PPE_s}/${baseS}))*(M${r}*I${r})`, '#,##0.000', dg.ajustePPE), // Q Aj.PP&E
        cFor(`${M.dep ? denomDep : (M.base === 'ventas' ? `(B${r}-N${r})` : M.base === 'opex' ? `D${r}` : `M${r}`)}`, '#,##0.00', dg.denomAjustado), // R denom ajustado
        /* S–Y: el indicador de cada sabor. `porSabor[k]` sigue el orden de AJUSTES,
           que es el de estas siete columnas. Y las J–R de arriba llevan los intermedios
           del MISMO motor, no un cálculo propio: son el rastro de auditoría que permite
           seguir de dónde sale cada uno de estos siete números. */
        cFor(`${celdaNum}/M${r}`, M.fmt, porSabor[0].filas[i]?.valor),            // S sin ajuste
        cFor(`(${celdaNum}-N${r})/R${r}`, M.fmt, porSabor[1].filas[i]?.valor),    // T CxC
        cFor(`(${celdaNum}+O${r})/${denomSinAR}`, M.fmt, porSabor[2].filas[i]?.valor),  // U CxP
        cFor(`(${celdaNum}-P${r})/${denomSinAR}`, M.fmt, porSabor[3].filas[i]?.valor),  // V Inv
        cFor(`(${celdaNum}-N${r}+O${r}-P${r})/R${r}`, M.fmt, porSabor[4].filas[i]?.valor),        // W CxC+CxP+Inv
        cFor(`(${celdaNum}-N${r}+O${r}-P${r}-Q${r})/R${r}`, M.fmt, porSabor[5].filas[i]?.valor), // X +PP&E
        cFor(`(${celdaNum}-Q${r})/${denomSinAR}`, M.fmt, porSabor[6].filas[i]?.valor),  // Y PP&E
      ];

      /* Columna Z: el filtro de ámbito, resuelto por fórmula y a la vista. Es el
         mismo criterio de `entraPorAmbito` (ajusteRangoCapitalTrabajo.js:245): con
         'nac' solo las nacionales, con 'intl' solo las internacionales, y con
         cualquier otro valor todas. Se emite como fórmula y no como una marca ya
         decidida, igual que el criterio de holding de la hoja de selección: quien
         audita el libro tiene que poder ver por qué una fila no entró.

         El valor en caché es solo la parte del ámbito: la del valor finito la pone
         ISNUMBER en la propia hoja, y así el criterio queda partido igual en los dos
         lados. La función es la del motor, importada, no una copia. */
      const entraAmbito = entraPorAmbito(porSabor[0].filas[i]?.amb, study.cmode);

      const ambitoRef = D(`$B$${FILA_AMBITO()}`);
      const ambComp = D(`J${src}`);
      fila.push(cForT(
        `IF(OR(${ambitoRef}="all",AND(${ambitoRef}="nac",${ambComp}="Nac"),`
        + `AND(${ambitoRef}="intl",${ambComp}="Int")),"Sí","No")`,
        entraAmbito ? 'Sí' : 'No'));

      /* Columnas AA–AG: la serie que de verdad entra al rango, por sabor. Vacía —no
         cero— cuando la fila no entra o cuando el indicador no es un número: QUARTILE,
         MIN y MAX ignoran las celdas vacías, y un cero fingiría una observación que no
         existe y hundiría el rango.

         Cuando la fila no entra, la fórmula devuelve "" y el valor en caché correcto es
         la cadena vacía, no un número; `cFor` no la escribe porque exige
         `Number.isFinite`, y es lo que corresponde: una celda numérica con `<v></v>` es
         XML inválido. La celda sale como fórmula sin valor y Excel la resuelve a "" al
         abrir. Es la misma razón por la que las filas de estadística sin rango también
         salen sin valor. */
      ['S', 'T', 'U', 'V', 'W', 'X', 'Y'].forEach((L, k) => {
        const v = porSabor[k].filas[i]?.valor;
        const entraSerie = entraAmbito && Number.isFinite(v);
        fila.push(cFor(
          `IF(AND(Z${r}="Sí",ISNUMBER(${L}${r})),${L}${r},"")`,
          M.fmt,
          entraSerie ? v : undefined));
      });

      celdas.push(fila);
    }

    const rN = r0 + n - 1; // última fila de comparable

    /* La estadística se calcula sobre la SERIE FILTRADA (AA–AG), no sobre las
       columnas de indicador (S–Y). Las de indicador se publican íntegras porque las
       tablas del informe listan también las comparables fuera de ámbito con su
       margen; lo que no puede es cuartilarlas. */
    const RES = ['AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG'];

    /* Guarda de muestra mínima: el motor no publica estadística con menos de tres
       observaciones (ajusteRangoCapitalTrabajo.js:312), porque un rango intercuartil
       sobre dos puntos no es un rango. La hoja no puede insinuar lo contrario.
       COUNT solo cuenta números, así que cuenta exactamente las filas que entraron. */
    const conGuarda = (L, expr) => `IF(COUNT(${L}${r0}:${L}${rN})<3,"",${expr})`;

    /* Fila de estadística vacía: índices 0–25 son las columnas A–Z, la etiqueta va en
       R (índice 17) y los siete valores se empujan a partir del índice 26 (AA). */
    const filaEstadistica = (etq) => {
      const fila = new Array(26).fill(cTxt(''));
      fila[17] = cTxt(etq);
      return fila;
    };

    /* Los estadísticos salen del sabor de cada columna. `stats` es null cuando el motor
       no publica rango —menos de tres observaciones—, y entonces la celda va sin valor,
       igual que su fórmula con guarda devolverá "" al abrir. */
    const statRow = (etq, fn, clave) => {
      const fila = filaEstadistica(etq);
      RES.forEach((L, k) => {
        const st = porSabor[k].stats;
        fila.push(cFor(conGuarda(L, `${fn}(${L}${r0}:${L}${rN})`), M.fmt,
          st ? st[clave] : undefined));
      });
      return fila;
    };
    const qRow = (etq, q, clave) => {
      const fila = filaEstadistica(etq);
      RES.forEach((L, k) => {
        const st = porSabor[k].stats;
        fila.push(cFor(conGuarda(L, `QUARTILE(${L}${r0}:${L}${rN},${q})`), M.fmt,
          st ? st[clave] : undefined));
      });
      return fila;
    };
    celdas.push(statRow('Mínimo', 'MIN', 'min'));
    const filaMin = celdas.length; // 1-based
    const filaP25 = celdas.length + 1;
    celdas.push(qRow('P25 (cuartil inferior)', 1, 'p25'));
    celdas.push(qRow('Mediana (P50)', 2, 'med'));
    celdas.push(qRow('P75 (cuartil superior)', 3, 'p75'));
    const filaP75 = celdas.length; // 1-based de P75 (ya empujada)
    celdas.push(statRow('Máximo', 'MAX', 'max'));
    const filaMax = celdas.length; // 1-based
    /* ─── Indicador del contribuyente, sabor por sabor ───
       En MO, MB y Berry es UNA cifra para los siete sabores: los cuatro ajustes del
       contribuyente contra sí mismo se anulan y el denominador es la base en todos.

       En Cost Plus y NCP NO. Es el defecto que la revisión de esta rama encontró
       midiendo el libro: la hoja emitía la fórmula de «sin ajuste» en las siete columnas
       y le adosaba el valor del motor, que no es ese. Dos cosas lo rompen, las dos en
       `desgloseAjuste`:

         · `ajusteINV` y `ajustePPE` no se anulan, porque el ratio del comparable divide
           por el denominador depurado y el del contribuyente por la base. Los de CxC y
           CxP sí, que dividen los dos por la base.
         · `usaDepurado` hace que los seis sabores ajustados dividan por el depurado.

       Así que la fórmula se construye por sabor, replicando lo que hace el motor. El
       número bueno es el del motor —es el que el informe publica y contra el que se
       cuartilan las comparables de estos métodos—, así que es la FÓRMULA la que se
       corrige para alcanzarlo, nunca el valor: al revés se rompería la paridad
       libro↔informe, que es lo único que este libro existe para garantizar. */
    const T_s = D(`$B$${FILA_TASA()}`);
    const baseTested = M.base === 'ventas' ? S_s
      : M.base === 'opex' ? OP_s
      : M.base === 'cogs' ? C_s
      : `(${C_s}+${OP_s})`;
    const numTested = M.num === 'ebit'
      ? `(${S_s}-${C_s}-${OP_s})`
      : `(${S_s}-${C_s})`;
    /* Denominador depurado del contribuyente: el mismo `(COGS−CxP)` de Cost Plus y
       `(COGS−CxP)+opex` de NCP, sobre las celdas de la hoja Datos. */
    const depTested = M.hoja === 'CostPlus' ? `(${C_s}-${AP_s})`
      : M.hoja === 'NCP' ? `((${C_s}-${AP_s})+${OP_s})`
      : null;
    /* Los dos ajustes que sobreviven, en la forma exacta de `desgloseAjuste`:
       ((partida / depurado) − (partida / base)) × (base × tasa). */
    const ajTested = (partida) => `((${partida}/${depTested})-(${partida}/${baseTested}))`
      + `*(${baseTested}*${T_s})`;
    const testedPorSabor = (clave) => {
      if (!M.dep) return `${numTested}/${baseTested}`;
      if (clave === 'ninguno') return `${numTested}/${baseTested}`;
      const restas = [];
      if (clave === 'inv' || clave === 'aar_aap_inv' || clave === 'aar_aap_inv_ppe') {
        restas.push(ajTested(INV_s));
      }
      if (clave === 'aar_aap_inv_ppe' || clave === 'ppe') restas.push(ajTested(PPE_s));
      const numerador = restas.length ? `(${numTested}-${restas.join('-')})` : numTested;
      return `${numerador}/${depTested}`;
    };
    const filaTested = celdas.length + 1;
    {
      const fila = filaEstadistica('Indicador del contribuyente');
      /* `testedFor` no cambia: es la misma fórmula. Lo que cambia es la columna
         donde se escribe.

         El valor sale de `sujeto`, que el motor calcula por la vía general —el
         contribuyente contra sí mismo— y que en Cost Plus y NCP **depende del sabor**.
         Se toma del motor y no de `pliOf`, que solo conoce MO, MB y Berry: por esta vía
         las hojas de esos dos métodos también traen su valor.

         La fórmula la construye `testedPorSabor`, que replica lo que el motor hace para
         ese sabor. Fórmula y valor tienen que decir lo mismo: la prueba de paridad
         recalcula cada fórmula aritmética del libro y compara con el valor publicado, así
         que una discrepancia aquí sale en rojo. */
      RES.forEach((L, k) => fila.push(
        cFor(testedPorSabor(AJUSTES[k].clave), M.fmt, porSabor[k].sujeto)));
      celdas.push(fila);
    }
    // conclusión CUMPLE/NO CUMPLE por ajuste
    {
      /* La conclusión necesita la misma guarda: sin rango, P25 y P75 valen "" y
         compararlos con >= daría #VALUE! en la celda. */
      const fila = filaEstadistica('Conclusión');
      RES.forEach((L, k) => {
        /* Sin rango el motor devuelve 'CUMPLE' por comportamiento heredado
           (rangoIntercuartil.js:81). El libro NO lo repite: un soporte que declara
           CUMPLE sin un rango que lo sustente es peor que uno que deja el hueco. Es la
           única celda donde el libro y el informe difieren a propósito, y la prueba de
           paridad entre ambos la excluye por este motivo. */
        const st = porSabor[k].stats;
        /* EL CRITERIO ES ESTAR POR ENCIMA DEL PRIMER CUARTIL, y la formula del libro tiene que
           ser la misma que aplica el codigo (`cumpleElRango` en utils/calculations.js).
           Antes exigia AND(>=P25, <=P75): con el indicador sobre el tercer cuartil la celda
           decia «NO CUMPLE» mientras el informe —tras el cambio de criterio del 2026-09-02—
           dice «CUMPLE», y el soporte contradeciria al documento que sustenta. El ajuste solo
           procede cuando el contribuyente declaro MENOS utilidad de la que corresponde. */
        fila.push(cForT(conGuarda(L,
          `IF(${L}${filaTested}>=${L}${filaP25},"CUMPLE","NO CUMPLE")`),
          st ? porSabor[k].cumple : ''));
      });
      celdas.push(fila);
    }

    /* `porSabor` viaja a infoMetodos porque la hoja Resumen se arma después de este
       forEach y sus celdas son referencias puras: sin el valor a mano quedarían vacías en
       cualquier lector que no recalcule, que es justo lo que esta tarea viene a cerrar.
       Y el Resumen es la primera hoja del libro, la que se abre sola. */
    infoMetodos.push({ hoja: M.hoja, nombre: M.nombre, fmt: M.fmt, base: M.base, dep: M.dep, r0, rN, filaMin, filaP25, filaP75, filaMax, filaTested, filaConcl: celdas.length, porSabor });

    hojas.push({
      nombre: M.hoja, celdas,
      cols: [{ wch: 28 }].concat(new Array(32).fill({ wch: 11 })),
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
    /* Los cinco chequeos leen los rangos de la hoja «Datos», donde el costo y los gastos van
       con el signo del estado financiero. Se envuelven en ABS: sin él, `COS<0.05*VEN` es
       cierto para toda comparable con el costo en negativo y la hoja publicaría «Revisar: N
       de N» en los cuatro métodos de cualquier estudio, que es un diagnóstico que se deja de
       leer por ruidoso. ABS es vectorizable dentro de SUMPRODUCT, así que la comprobación
       sigue siendo una sola fórmula matricial y sigue recalculándose en Excel. */
    const COS_ABS = `ABS(${COS})`;
    const GAS_ABS = `ABS(${GAS})`;
    const CHEQUEOS = [
      ['Margen Bruto', `SUMPRODUCT(--(${COS_ABS}<0.05*${VEN}))`,
        'Costo de ventas por debajo del 5 % de las ventas: el margen bruto se pega al 100 % y deja de discriminar.'],
      ['Cost Plus', `SUMPRODUCT(--((${COS_ABS}-${CXP})<=0))`,
        'Denominador depurado (Costo − CxP) nulo o negativo: el indicador cambia de signo y no es interpretable.'],
      ['Índice de Berry', `SUMPRODUCT(--(${GAS_ABS}<=0))`,
        'Gastos operativos nulos o negativos: el índice se indefine.'],
      ['Net Cost Plus', `SUMPRODUCT(--(((${COS_ABS}-${CXP})+${GAS_ABS})<=0))`,
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
      ['Cuentas por cobrar', `${AR_s}/${S_s}*365`, '#,##0.0', 'días de venta',
        'Sostiene el ajuste de CxC.'],
      ['Inventarios', `${INV_s}/${C_s}*365`, '#,##0.0', 'días de costo',
        'Sostiene el ajuste de inventario. En cero, el ajuste solo recoge el de las comparables.'],
      ['Cuentas por pagar', `${AP_s}/${C_s}*365`, '#,##0.0', 'días de costo',
        'Si equivalen a muy pocos días, verificar si hay pasivos comerciales clasificados en otras cuentas antes de sostener el ajuste de CxP.'],
      ['Cuentas por pagar / Ventas', `${AP_s}/${S_s}`, '0.000%', 'porcentaje', ''],
      ['PP&E / Ventas', `${PPE_s}/${S_s}`, '0.000%', 'porcentaje',
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
          cFor(`MO!H${rMO}/MO!B${rMO}`, '0.000%'),
          cFor(`MO!Q${rMO}`, '#,##0.000'),
          cFor(`MO!J${rMO}`, '#,##0.00'),
          cForT(`IF(ABS(C${r})>ABS(D${r}),"Sí — el escenario con PP&E no es defendible para esta compañía","")`),
        ]);
      }
      dg.push([]);
      /* CUAL escenario reporta el informe DE VERDAD. Esto afirmaba «CxC+CxP+Inv» sin mirar
         `useadj`, y con el ajuste apagado el informe concluye sobre el rango SIN ajustar: la
         frase mandaba a un auditor a cotejar la conclusión contra una columna que el informe no
         usó. Mismo defecto de fondo que el reportado el 2026-09-02 en la memoria del rango
         —dar por hecho que el ajustado siempre manda— en otro sitio del mismo libro. */
      /* Siempre «CxC+CxP+Inv»: el informe concluye sobre el rango ajustado en todo estudio
         (2026-09-02). La variante que miraba `useadj` duro unas horas y ya no aplica. */
      dg.push([cTxt('El escenario que reporta el informe es «CxC+CxP+Inv» (columna W de las hojas de método),')]);
      dg.push([cTxt('que no incluye PP&E. Esta sección sirve para decidir si los escenarios con PP&E son presentables.')]);
    }

    /* Las correcciones que la verificación de la ingesta aplicó a las cifras leídas del
       estado financiero. Van en el libro y no solo en la pantalla porque el libro es lo
       que se radica como soporte: una cifra que el sistema cambió por su cuenta y que
       nadie puede rastrear es peor que una cifra sin corregir, y quien audite tiene que
       poder ver que la utilidad operacional que sustenta el margen no es la que el
       documento rotula como tal, sino la que se despeja de sus otras cifras. */
    const correcciones = Array.isArray(study.t_correcciones) ? study.t_correcciones : [];
    if (correcciones.length) {
      dg.push([cTxt('5) CIFRAS CORREGIDAS AL LEER EL ESTADO FINANCIERO')]);
      dg.push([cTxt('Rubro'), cTxt('Leído del documento'), cTxt('Aplicado'),
        cTxt('Rótulo de la fila leída'), cTxt('Por qué se cambió')]);
      correcciones.forEach((c) => {
        dg.push([
          cTxt(String(c.etiqueta || c.campo || '')),
          cNum(c.valorLeido),
          cNum(c.valorAplicado),
          cTxt(String(c.rotuloLeido || '—')),
          cTxt(String(c.motivo || '')),
        ]);
      });
      dg.push([]);
    }

    hojas.unshift({
      nombre: 'Diagnóstico de datos', celdas: dg,
      cols: [{ wch: 34 }, { wch: 20 }, { wch: 26 }, { wch: 26 }, { wch: 58 }],
    });
  }

  /* ─── Hoja Resumen: sensibilidad, referenciando las hojas de método ───
     Las referencias siguen siendo referencias —quien audite puede seguirlas hasta la
     celda de la hoja de método—, pero además llevan el valor en caché del motor. Sin él
     esta hoja, que es la primera del libro y la que Excel abre sola, saldría vacía en
     cualquier lector que no recalcule, y la mitad del objetivo de esta tarea quedaría
     sin cumplir. El valor sale del mismo `porSabor` que alimentó la hoja de método, así
     que las dos celdas publican por construcción el mismo número. */
  const resumen = [];
  resumen.push([cTxt('RESUMEN Y SENSIBILIDAD — todo son referencias a las hojas de método')]);
  resumen.push([]);
  resumen.push(['Método', 'Ajuste', 'Contribuyente', 'Mínimo', 'P25', 'Mediana', 'P75', 'Máximo', 'Conclusión'].map(cTxt));
  /* AA–AG, no S–Y: desde que las filas de estadística se mudaron a la serie
     filtrada, S–Y de esas filas quedan en blanco (son las columnas de indicador
     por comparable, no de estadístico). Referenciar S–Y aquí dejaría el Resumen
     —la hoja que un lector abre primero— siempre vacío. */
  const RES = ['AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG'];
  infoMetodos.forEach((M) => {
    AJUSTES.forEach((aj, k) => {
      const L = RES[k];
      /* Cuidado con el orden: esta hoja referencia la mediana como `filaP25 + 1` y el
         P75 como `filaP25 + 2`, así que los valores tienen que ir `med` y luego `p75`,
         en ese mismo orden. Cruzarlos daría cifras creíbles en el sitio errado sin que
         nada reventara, igual que reordenar AJUSTES. */
      const st = M.porSabor[k].stats;
      resumen.push([
        cTxt(M.nombre), cTxt(aj.etiqueta),
        cFor(`${M.hoja}!${L}${M.filaTested}`, M.fmt, M.porSabor[k].sujeto),
        cFor(`${M.hoja}!${L}${M.filaMin}`, M.fmt, st ? st.min : undefined),
        cFor(`${M.hoja}!${L}${M.filaP25}`, M.fmt, st ? st.p25 : undefined),
        cFor(`${M.hoja}!${L}${M.filaP25 + 1}`, M.fmt, st ? st.med : undefined),
        cFor(`${M.hoja}!${L}${M.filaP25 + 2}`, M.fmt, st ? st.p75 : undefined),
        cFor(`${M.hoja}!${L}${M.filaMax}`, M.fmt, st ? st.max : undefined),
        /* Sin rango, la celda de conclusión de la hoja de método queda en '' y esta
           tiene que decir lo mismo: es la única celda donde el libro se aparta del
           motor a propósito (ver la nota de la conclusión más arriba). */
        cForT(`${M.hoja}!${L}${M.filaConcl}`, st ? M.porSabor[k].cumple : ''),
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

    /* Criterios de screening de Capital IQ, traducidos con el mismo módulo que la Tabla 14
       del informe (`criteriosScreeningEs.js`): este libro es un anexo que se entrega, así
       que dejarlo en el inglés crudo de la hoja «Screen Criteria» reproduce aquí el mismo
       defecto que se corrigió allá. */
    sel.push([cTxt('CRITERIOS DE CRIBADO (Capital IQ)')]);
    (seleccion.criterios || []).forEach((cr) => {
      if (!cr) return;
      const es = traducirCriterio(cr);
      const con = es.conector ? `${es.conector}) ` : '';
      sel.push([cTxt(`${con}${es.etiqueta}`), cTxt(es.valor)]);
    });
    sel.push([]);

    /* ─── Política de pérdidas operativas ───
       Va ANTES del embudo y no como una nota al pie, porque es la decisión metodológica que
       explica por qué la muestra tiene comparables en pérdida —o por qué no las tiene—, y es
       lo primero que un fiscalizador va a preguntar al ver un rango con el extremo bajo
       poblado. Se publican las cuatro cifras y la justificación tal como la escribió el
       analista: si no la escribió, se dice que falta, en vez de dejar el hueco en blanco.
       Solo se imprime si el estudio trae la política, para no llenar de filas vacías el libro
       de un estudio corrido antes de que esto existiera. */
    /* ─── Combinación de selección usada ───
       El motor es determinista: mismo cribado y misma configuración dan siempre la misma
       muestra. Cuando el analista recorre combinaciones equivalentes —«Otra combinación» del
       paso 2, que sustituye las de menor puntaje por las siguientes de la reserva— la muestra
       cambia, y entonces el número de combinación es parte de lo que hace falta para
       reconstruirla. Se publica solo si NO es la primera: en la 1 la muestra son directamente
       las de mayor puntaje y una fila que lo dijera solo añadiría ruido al libro. */
    const combinacion = seleccion.combinacion || null;
    if (combinacion && combinacion.usada > 1) {
      sel.push([cTxt('COMBINACIÓN DE SELECCIÓN')]);
      sel.push([
        cTxt('Combinación usada'),
        cTxt(`${combinacion.usada} de ${combinacion.disponibles}`),
      ]);
      sel.push([
        cTxt('Criterio'),
        cTxt('La selección es determinista y se ordena por puntaje de comparabilidad. Esta '
          + 'combinación conserva las de mayor puntaje y sustituye las '
          + `${combinacion.usada - 1} de menor puntaje por las siguientes de la reserva. `
          + 'La misma combinación reproduce siempre la misma muestra a partir del mismo '
          + 'cribado: la selección no es aleatoria.'),
      ]);
      sel.push([]);
    }

    const perdidas = seleccion.perdidas || null;
    if (perdidas && perdidas.politica) {
      sel.push([cTxt('POLÍTICA DE PÉRDIDAS OPERATIVAS (Guías OCDE cap. III, §3.64-3.65)')]);
      sel.push([
        cTxt('Criterio aplicado'),
        cTxt(perdidas.politica === 'excluir'
          ? 'Excluir las comparables en pérdida'
          : 'Admitir comparables en pérdida'),
      ]);
      if (perdidas.politica !== 'excluir') {
        sel.push([cTxt('Comparables en pérdida solicitadas'), cNum(perdidas.objetivo, '0')]);
        sel.push([cTxt('Comparables en pérdida en la muestra'), cNum(perdidas.incluidas, '0')]);
        sel.push([
          cTxt('Disponibles en el universo (misma actividad)'),
          cNum(perdidas.disponibles, '0'),
          cTxt(perdidas.incluidas < perdidas.objetivo
            ? 'Entraron menos de las solicitadas: el universo no tenía más'
            : ''),
        ]);
      } else if (perdidas.excluidasPorFiltro) {
        sel.push([
          cTxt('Comparables en pérdida excluidas por el filtro'),
          cNum(perdidas.excluidasPorFiltro, '0'),
        ]);
      }
      sel.push([
        cTxt('Justificación'),
        cTxt(String(perdidas.justificacion || '').trim()
          || 'PENDIENTE — el estudio no registró la justificación de esta política.'),
      ]);
      sel.push([]);
    }

    /* Embudo con fórmulas COUNTIF sobre la columna «Motivo de rechazo», que es la
       que escribe el motor. Antes se contaba sobre las columnas de flags, que
       replicaban la precedencia de los filtros en fórmulas de Excel: dos
       implementaciones del mismo criterio que se desincronizaban en cuanto el motor
       cambiaba una regla. Ahora la hoja REFLEJA lo que el motor decidió.

       Están TODAS las exclusiones, no solo las de los filtros duros: si faltara
       alguna, la resta «Universo − exclusiones = Válidas» dejaría de cuadrar en
       cuanto la curación por IA descartara a alguien. Son seis filas para siete
       motivos del motor, porque los dos de perfil se presentan juntos. */
    sel.push([cTxt('EMBUDO DE SELECCIÓN (Arts. 260-1 y 260-4 E.T.)')]);
    sel.push([cTxt('Etapa'), cTxt('Empresas'), cTxt('Fórmula / criterio')]);
    const fe = {};
    const etapa = (clave, etiqueta, criterio) => {
      fe[clave] = sel.length + 1;
      sel.push([cTxt(etiqueta), null, cTxt(criterio)]);
    };
    etapa('universo', 'Universo Capital IQ (tras cribado)', 'COUNTA de la columna Compañía');
    etapa('controlada', '(−) Vinculadas o controladas', `Un accionista alcanza o supera el ${umbralControl} % del capital (Art. 260-1)`);
    etapa('holding', '(−) Holdings o grupos', 'Término de holding, grupo o group en la razón social (Art. 260-4)');
    etapa('negativo', '(−) Saldos negativos', 'Dato de balance no verosímil');
    etapa('perdida', '(−) Pérdida operativa', 'Criterio conservador DIAN: comparable rentable');
    /* Una sola fila para todo lo que supera los cuatro filtros objetivos y no integra
       la muestra: la curación no reconoció su actividad, faltaba la descripción del
       negocio, o simplemente no alcanzó el puntaje de las comparables elegidas. Ante
       la DIAN todas responden a lo mismo —no son funcionalmente comparables con la
       parte examinada—, y el desglose por criterio sigue disponible en la columna
       «Motivo de rechazo» de la base de datos. */
    etapa('rigor', '(−) Diferencias funcionales', 'No comparable con la parte examinada (Art. 260-4)');
    etapa('validas', '= Válidas tras todos los criterios', 'Universo − las exclusiones de arriba');
    etapa('seleccionadas', '= Muestra final seleccionada', 'Las válidas son exactamente la muestra');
    sel.push([]);

    /* Suma de control: las exclusiones y las válidas son mutuamente excluyentes —el
       motor asigna un solo motivo por candidata, el primero que aplica— y agotan el
       universo, así que su suma tiene que dar el total exacto. Es la comprobación
       que permite firmar la hoja. */
    sel.push([cTxt('SUMA DE CONTROL (partición del universo — cada empresa cuenta una vez)')]);
    const sc = {};
    const control = (clave, etiqueta, criterio) => {
      sc[clave] = sel.length + 1;
      sel.push([cTxt(etiqueta), null, cTxt(criterio)]);
    };
    control('rechazadas', 'Total rechazadas', 'Suma de las exclusiones del embudo');
    control('validas', 'Total válidas = muestra del estudio', 'Estado = "Válida"');
    control('suma', 'SUMA', 'Rechazadas + válidas');
    control('universo', 'UNIVERSO (Capital IQ)', 'Total de compañías');
    control('check', '¿CUADRA? (suma = universo)', 'Debe decir "SÍ ✓"');
    control('seleccionadas', '   · contadas por «¿Seleccionada?»', '¿Seleccionada? = "Sí"');
    control('checkVal', '¿Coincide con las válidas del embudo?', 'Debe decir "SÍ ✓"');
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
        /* K, L y M son tres hechos independientes y se marcan por separado: una
           compañía puede ser a la vez controlada, holding y estar en pérdida, y las
           tres casillas tienen que decirlo. La precedencia —controlada, luego
           holding, luego pérdida— solo decide cuál queda escrito en el motivo de
           rechazo de la columna N, no cuáles se marcan aquí. */
        cForT(`IF(N(I${r})>=${umbralControl},"Sí","")`),              // K Controlada (fórmula)
        /* L Holding, también por fórmula y solo sobre la razón social: quien audita
           la hoja puede ver el criterio aplicado en vez de tener que fiarse de una
           marca volcada desde el motor. */
        cForT(HOLDING_FORMULA(`B${r}`)),                              // L Holding (fórmula)
        cForT(`IF(N(G${r})<0,"Sí","")`),                             // M Pérdida (fórmula)
        cTxt(c.motivoClave || ''),                                   // N Motivo (del motor)
        cTxt(c.perfilFuncional || 'INDEFINIDO'),                     // O Perfil funcional
        /* P Estado. Válida es solo la que integra la muestra: todo lo que supera los
           filtros objetivos y no se incorpora al rango queda rechazado por diferencias
           funcionales, así que la partición del universo es «las 16 y todo lo demás». */
        cForT(`IF(Q${r}="Sí","Válida","Rechazada")`),
        cTxt(c.seleccionada ? 'Sí' : ''),                            // Q ¿Seleccionada?
        /* R: el estado de comparabilidad dicho en palabras, en cada fila, para que
           quien filtre la tabla no tenga que cruzar el motivo con la selección.

           DICE «Diferencias funcionales» EXACTAMENTE PARA LAS QUE LA MATRIZ CUENTA EN ESA FILA:
           los tres motivos cualitativos y las que no llevan motivo. Antes solo lo decía cuando
           la celda del motivo estaba vacía, así que filtrar por esta columna devolvía una parte
           —en el informe de MONTACHEM, unos cientos de las 2.403— y el resto aparecía como
           «Rechazada (ver motivo)». Quien auditaba el libro comparándolo con la tabla del informe
           no podía cuadrar la cifra sin saberse la fórmula de memoria: reportado el 2026-08-20.
           Con el motivo de la reserva ya escrito, además, la condición vieja no habría marcado
           ninguna. Se conserva `N=""` para los estudios corridos antes de ese cambio. */
        cForT(`IF(Q${r}="Sí","Comparable de la muestra",`
          + `IF(OR(N${r}="rigorFuncional",N${r}="actividadDistinta",N${r}="sinDescripcion",N${r}=""),`
          + `"Diferencias funcionales","Rechazada (ver motivo)"))`),
      ]);
    });
    const rN = r0 + cand.length - 1;

    const cNombre = `B${r0}:B${rN}`;
    const cMotivo = `N${r0}:N${rN}`;
    const cEstado = `P${r0}:P${rN}`;
    const cSel = `Q${r0}:Q${rN}`;

    /* Los motivos, con la MISMA clave que emite `scoreCandidates`: la hoja no
       reclasifica nada, cuenta lo que el motor escribió. */
    const MOTIVOS = [
      ['controlada', 'filtro', ['controlada'], `Vinculadas: un accionista alcanza o supera el ${umbralControl} % (Art. 260-1)`],
      ['holding', 'filtro', ['holding'], 'Holdings o grupos, por la razón social (Art. 260-4)'],
      ['negativo', 'filtro', ['saldoNegativo'], 'Saldo negativo en balances (dato no verosímil)'],
      ['perdida', 'filtro', ['perdidaOperativa'], 'Pérdida operativa (criterio conservador DIAN)'],
      /* Una sola fila para TODO lo que supera los filtros objetivos y no integra la
         muestra. Recoge los motivos cualitativos que escribe el motor —la curación no
         reconoció la actividad, faltaba la descripción del negocio, o el perfil no era
         comparable en los estudios anteriores al retiro de ese filtro— y además las
         que no llevan motivo pero tampoco se incorporaron al rango.

         Todas responden a lo mismo ante la DIAN: no son funcionalmente comparables con
         la parte examinada (Art. 260-4). El desglose fino sigue en la columna «Motivo
         de rechazo» de la base de datos, para quien lo necesite. */
      ['rigor', 'rigor', ['sinDescripcion', 'actividadDistinta', 'rigorFuncional'],
        'Diferencias funcionales: no comparable con la parte examinada (Art. 260-4)',
        true],
    ];

    /* Una fila del embudo puede recoger varios motivos del motor, así que el conteo es
       la suma de sus COUNTIF y no uno solo. Las que llevan `sinMotivo` suman además
       las que pasaron todo y no entraron a la muestra: no traen motivo escrito, pero
       quedan fuera por la misma razón. */
    const contarMotivos = (rango, motivos, sinMotivo, rangoSel) => {
      const partes = motivos.map((m) => `COUNTIF(${rango},"${m}")`);
      if (sinMotivo) partes.push(`COUNTIFS(${rango},"",${rangoSel},"<>Sí")`);
      return partes.join('+');
    };

    sel[fe.universo - 1][1] = cFor(`COUNTA(${cNombre})`, '#,##0');
    MOTIVOS.forEach(([clave, , motivos, , sinMotivo]) => {
      sel[fe[clave] - 1][1] = cFor(contarMotivos(cMotivo, motivos, sinMotivo, cSel), '#,##0');
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
    /* Las válidas son ahora exactamente la muestra, así que el segundo cuadre compara
       las dos formas de contarla: por la columna «¿Seleccionada?» y por el estado que
       de ella se deriva. Si difieren, alguna fila quedó seleccionada llevando motivo
       de rechazo. */
    sel[sc.seleccionadas - 1][1] = cFor(`COUNTIF(${cSel},"Sí")`, '#,##0');
    sel[sc.checkVal - 1][1] = cForT(
      `IF(B${sc.seleccionadas}=B${fe.validas},"SÍ ✓","NO ✗ ("&B${sc.seleccionadas}&" vs "&B${fe.validas}&")")`);

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
    const refSel = `'Selección comparables'!${cSel}`;
    MOTIVOS.forEach(([, categoria, motivos, descripcion, sinMotivo]) => {
      mtz.push([cTxt(categoria), cTxt(sinMotivo ? 'diferenciaFuncional' : motivos.join(' + ')), cTxt(descripcion),
        cFor(contarMotivos(refMotivo, motivos, sinMotivo, refSel), '#,##0')]);
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
    mtz.push([cTxt('(+) Muestra seleccionada'), cTxt(''),
      cTxt('Las comparables que sustentan el rango del informe'),
      cFor(`COUNTIF('Selección comparables'!${cSel},"Sí")`, '#,##0')]);
    const fUniv = mtz.length + 1;
    mtz.push([cTxt('= UNIVERSO (debe igualar el de Capital IQ)'), cTxt(''), cTxt(''),
      cFor(`D${fTotRech}+D${fSel}`, '#,##0')]);
    const fReal = mtz.length + 1;
    mtz.push([cTxt('UNIVERSO real (Capital IQ)'), cTxt(''), cTxt(''),
      cFor(`COUNTA('Selección comparables'!${cNombre})`, '#,##0')]);
    mtz.push([cTxt('¿CUADRA? (rechazadas + muestra = universo)'), cTxt(''), cTxt(''),
      cForT(`IF(D${fUniv}=D${fReal},"SÍ ✓","NO ✗ ("&D${fUniv}&" vs "&D${fReal}&")")`)]);
    mtz.push([]);
    mtz.push([cTxt('Nota: «diferencias funcionales» recoge todo lo que supera los filtros objetivos y no')]);
    mtz.push([cTxt('integra la muestra. El desglose por criterio está en la columna «Motivo de rechazo»')]);
    mtz.push([cTxt('de la hoja Selección comparables, y las que no llevan motivo son las que pasaron')]);
    mtz.push([cTxt('todos los criterios sin alcanzar el puntaje de la muestra final.')]);

    hojas.splice(1, 0, {
      nombre: 'Matriz de rechazo', celdas: mtz,
      cols: [{ wch: 12 }, { wch: 20 }, { wch: 68 }, { wch: 11 }],
    });
  }

  return hojas;
}
