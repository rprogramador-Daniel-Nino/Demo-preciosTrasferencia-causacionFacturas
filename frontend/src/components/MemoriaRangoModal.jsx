import React, { useEffect, useMemo, useState } from 'react';
import { X, FileSpreadsheet, AlertTriangle, ChevronDown } from 'lucide-react';
import XLSX from 'xlsx-js-style';
import { pctf, fmt } from '../utils/calculations.js';
import {
  construirMemoriaRango, hojasMemoriaRango, nombreArchivoMemoria,
} from '../services/memoriaCalculoRango.js';

/* Cómo se llegó al rango intercuartil que muestra la tarjeta del panel: la fórmula del
   indicador, el margen de cada comparable, el ajuste de capital de trabajo y la posición
   exacta de la que sale cada cuartil.

   Va en pestañas y no en cinco bloques apilados porque apilado obligaba a recorrer todo
   el cálculo para llegar a cualquier dato. Aquí el modal cabe en una pantalla y cada
   pestaña es un paso del cálculo. Lo completo, en orden y sin recortes, está en el
   Excel. */

const CLASES = {
  marco: 'border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-x-auto',
  tabla: 'w-full text-left border-collapse',
  cabecera: 'bg-zinc-50 dark:bg-[#09090b] text-[9.5px] uppercase tracking-wider text-zinc-500',
  th: 'px-2 py-1 font-semibold whitespace-nowrap',
  fila: 'border-t border-zinc-100 dark:border-zinc-800',
  td: 'px-2 py-1 text-[10.5px] align-top',
  concepto: 'px-2 py-1 text-[10.5px] text-zinc-500 align-top whitespace-nowrap',
  valor: 'px-2 py-1 text-[10.5px] text-zinc-900 dark:text-zinc-100 align-top',
  cifra: 'px-2 py-1 text-[10.5px] font-mono text-right tabular-nums whitespace-nowrap',
};

/** Tabla «concepto → valor», que es la forma de casi todo este desglose. */
function TablaDatos({ filas }) {
  return (
    <div className={CLASES.marco}>
      <table className={CLASES.tabla}>
        <tbody>
          {filas.map(([concepto, valor, mono], i) => (
            <tr key={i} className={i ? CLASES.fila : ''}>
              <th scope="row" className={CLASES.concepto + ' font-normal w-[42%]'}>{concepto}</th>
              <td className={mono ? CLASES.valor + ' font-mono tabular-nums' : CLASES.valor}>{valor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PESTANAS = [
  ['resumen', 'Resumen'],
  ['comparables', 'Comparables'],
  ['cuartiles', 'Cuartiles'],
  ['detalle', 'Parte examinada'],
];

export default function MemoriaRangoModal({ estudio, alCerrar }) {
  const memoria = useMemo(() => construirMemoriaRango(estudio), [estudio]);
  const [pestana, setPestana] = useState('resumen');
  /* Las advertencias arrancan plegadas: son la razón por la que el modal crecía sin
     control, y en una línea siguen estando a la vista sin empujar el contenido. */
  const [avisosAbiertos, setAvisosAbiertos] = useState(false);

  useEffect(() => {
    const alTeclear = (e) => { if (e.key === 'Escape') alCerrar(); };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [alCerrar]);

  /* Se arma el libro en memoria y se descarga con un Blob, en vez de `XLSX.writeFile`:
     esa función depende de que SheetJS detecte el entorno y en el build ESM no siempre
     está. Con Blob la descarga es la misma en cualquier navegador. */
  const descargar = () => {
    const libro = XLSX.utils.book_new();
    hojasMemoriaRango(memoria, estudio).forEach(({ nombre, filas, cols, rows, merges, autofiltro }) => {
      /* Las celdas llegan del servicio con su formato ya puesto. Aquí solo se cuelgan las
         propiedades que son de la hoja y no de la celda.

         No se intenta congelar el encabezado: el escritor de SheetJS descarta `!freeze`
         —lo comprobé inspeccionando el XML, la hoja sale sin `<pane>`—, así que ponerlo
         sería código que no hace nada. */
      const hoja = XLSX.utils.aoa_to_sheet(filas);
      if (cols) hoja['!cols'] = cols;
      if (rows) hoja['!rows'] = rows;
      if (merges && merges.length) hoja['!merges'] = merges;
      if (autofiltro) hoja['!autofilter'] = { ref: autofiltro };
      XLSX.utils.book_append_sheet(libro, hoja, nombre);
    });
    const bytes = XLSX.write(libro, { bookType: 'xlsx', type: 'array' });
    const url = URL.createObjectURL(
      new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    );
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreArchivoMemoria(estudio);
    enlace.click();
    URL.revokeObjectURL(url);
  };

  const pct = (v) => (v === null || v === undefined ? '—' : pctf(v));
  const money = (v) => (v === null || v === undefined ? '—' : fmt(v));
  const cifras = memoria.parteExaminada.cifras;
  const razones = memoria.parteExaminada.razones;
  const cuartiles = memoria.cuartiles;
  const r = memoria.resultado;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={alCerrar}
    >
      <div
        className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ══════ Cabecera: el resultado a la vista, sin gastar alto ══════ */}
        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
          <div className="min-w-0">
            <h3 className="text-[12px] font-bold text-zinc-900 dark:text-zinc-100 truncate">
              Memoria del rango intercuartil
            </h3>
            <p className="text-[10px] text-zinc-500 truncate">
              {memoria.stats ? `${pctf(memoria.stats.p25)} – ${pctf(memoria.stats.p75)}` : 'sin rango'}
              {' · '}mediana {memoria.stats ? pctf(memoria.stats.med) : '—'}
              {' · '}{memoria.indicador.clave} del contribuyente {pct(r.pli)}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={descargar}
              title="Descargar la memoria completa en Excel"
              className="flex items-center gap-1 text-[10.5px] font-bold px-2 py-1 rounded-lg bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Excel
            </button>
            <button onClick={alCerrar} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ══════ Pestañas ══════ */}
        <div className="flex gap-1 px-3 pt-2 border-b border-zinc-200 dark:border-zinc-800">
          {PESTANAS.map(([clave, etiqueta]) => (
            <button
              key={clave}
              onClick={() => setPestana(clave)}
              className={'text-[10.5px] font-semibold px-2.5 py-1 rounded-t-md border-b-2 -mb-px transition-colors ' + (
                pestana === clave
                  ? 'border-[#0FA3A1] text-[#0B7C7A] dark:text-[#0FA3A1]'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
              )}
            >
              {etiqueta}
              {clave === 'comparables' && memoria.comparables.length
                ? <span className="text-zinc-400 font-normal"> ({memoria.comparables.length})</span>
                : null}
            </button>
          ))}
        </div>

        {/* ══════ Cuerpo: lo único que hace scroll ══════ */}
        <div className="p-3 space-y-2.5 overflow-y-auto">
          {/* Advertencias plegadas en una línea. */}
          {memoria.advertencias.length > 0 && (
            <div className="text-[10.5px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg">
              <button
                onClick={() => setAvisosAbiertos(!avisosAbiertos)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left font-medium"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {memoria.advertencias.length} advertencia(s) sobre este rango
                <ChevronDown className={'w-3.5 h-3.5 ml-auto transition-transform ' + (avisosAbiertos ? 'rotate-180' : '')} />
              </button>
              {avisosAbiertos && (
                <ul className="px-2 pb-2 space-y-1 list-disc list-inside">
                  {memoria.advertencias.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              )}
            </div>
          )}

          {pestana === 'resumen' && (
            <TablaDatos
              filas={[
                ['Indicador', memoria.indicador.etiqueta],
                ['Fórmula', <code key="f" className="font-mono text-[10px]">{memoria.indicador.formula}</code>],
                ['Comparables consideradas', memoria.ambito.etiqueta],
                ['Indicador del contribuyente', pct(r.pli), true],
                [
                  'Rango intercuartil',
                  memoria.stats ? `${pctf(memoria.stats.p25)} – ${pctf(memoria.stats.p75)}` : '—',
                  true,
                ],
                ['Mediana', memoria.stats ? pctf(memoria.stats.med) : '—', true],
                [
                  'Conclusión',
                  r.dentro === null ? (
                    <span key="c" className="text-zinc-500">Falta el indicador o el rango para concluir.</span>
                  ) : r.dentro ? (
                    <b key="c" className="text-emerald-600 dark:text-emerald-400">CUMPLE — dentro del rango</b>
                  ) : (
                    <b key="c" className="text-red-600 dark:text-rose-400">NO CUMPLE — {r.dir} del rango</b>
                  ),
                ],
                [
                  'Ajuste propuesto',
                  r.dentro === false ? money(r.ajustePropuesto) : '— (no procede)',
                  true,
                ],
                ['Fórmula del ajuste', <code key="f" className="font-mono text-[10px]">{r.formulaAjuste}</code>],
              ]}
            />
          )}

          {pestana === 'comparables' && (
            <div className={CLASES.marco}>
              <table className={CLASES.tabla}>
                <thead className={CLASES.cabecera}>
                  <tr>
                    <th className={CLASES.th}>#</th>
                    <th className={CLASES.th}>Compañía</th>
                    <th className={CLASES.th}>Ámb.</th>
                    <th className={CLASES.th + ' text-right'}>Sin aj.</th>
                    <th className={CLASES.th + ' text-right'}>Ajuste</th>
                    <th className={CLASES.th + ' text-right'}>Ajustado</th>
                    <th className={CLASES.th}>Rango</th>
                  </tr>
                </thead>
                <tbody>
                  {memoria.comparables.map((c, i) => (
                    <tr key={i} className={CLASES.fila + (c.incluida ? '' : ' opacity-50')}>
                      <td className={CLASES.td + ' text-zinc-400'}>{i + 1}</td>
                      <td className={CLASES.td + ' font-medium text-zinc-900 dark:text-zinc-100'}>{c.nombre}</td>
                      <td className={CLASES.td + ' text-zinc-500'}>{c.amb === 'Nac' ? 'Nac.' : 'Int.'}</td>
                      <td className={CLASES.cifra}>{pct(c.noAjustado)}</td>
                      <td className={CLASES.cifra + ' text-zinc-500'}>{pct(c.ajuste)}</td>
                      <td className={CLASES.cifra + ' font-bold'}>{pct(c.ajustado)}</td>
                      <td className={CLASES.td}>
                        {c.incluida
                          ? <span className="text-emerald-600 dark:text-emerald-400">Sí</span>
                          : <span className="text-zinc-500 cursor-help" title={c.excluida}>No*</span>}
                      </td>
                    </tr>
                  ))}
                  {!memoria.comparables.length && (
                    <tr>
                      <td className={CLASES.td + ' text-zinc-500'} colSpan={7}>
                        No hay comparables cargadas en el estudio.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {memoria.comparables.some((c) => !c.incluida) && (
                <p className="text-[9.5px] text-zinc-500 px-2 py-1 border-t border-zinc-100 dark:border-zinc-800">
                  * pase el cursor sobre «No» para ver por qué queda fuera del rango
                </p>
              )}
            </div>
          )}

          {pestana === 'cuartiles' && (
            cuartiles ? (
              <div className="space-y-2.5">
                <div className={CLASES.marco}>
                  <table className={CLASES.tabla}>
                    <thead className={CLASES.cabecera}>
                      <tr>
                        <th className={CLASES.th}>Cuartil</th>
                        <th className={CLASES.th}>Posición</th>
                        <th className={CLASES.th + ' text-right'}>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['Cuartil inferior (P25)', cuartiles.p25],
                        ['Mediana (P50)', cuartiles.mediana],
                        ['Cuartil superior (P75)', cuartiles.p75],
                      ].map(([etiqueta, c]) => (
                        <tr key={etiqueta} className={CLASES.fila}>
                          <td className={CLASES.td + ' text-zinc-900 dark:text-zinc-100'}>{etiqueta}</td>
                          <td className={CLASES.td + ' text-zinc-500'}>
                            {c.posicion} de {memoria.serie.length - 1}
                          </td>
                          <td className={CLASES.cifra + ' font-bold'}>{pctf(c.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-[9.5px] text-zinc-500 font-mono">{memoria.cuartilFormula}</p>

                {/* La serie es la columna sobre la que se aplica la fórmula: va entera y
                    con la posición a la vista, pero en fichas para no gastar alto. */}
                <div className="flex flex-wrap gap-1">
                  {memoria.serie.map((v, i) => {
                    const esCuartil = [
                      cuartiles.p25.posicion, cuartiles.mediana.posicion, cuartiles.p75.posicion,
                    ].includes(i);
                    const duena = memoria.comparables.find((c) => c.incluida && c.ajustado === v);
                    return (
                      <span
                        key={i}
                        title={(duena ? duena.nombre + ' · ' : '') + 'posición ' + i}
                        className={'text-[10px] font-mono px-1.5 py-0.5 rounded border ' + (esCuartil
                          ? 'border-[#0FA3A1] bg-[#0FA3A1]/10 text-[#0B7C7A] dark:text-[#0FA3A1] font-bold'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-500')}
                      >
                        {i}: {pctf(v)}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : (
              <TablaDatos filas={[['Rango', 'Ninguna comparable tiene margen calculable, así que no hay rango.']]} />
            )
          )}

          {pestana === 'detalle' && (
            <TablaDatos
              filas={[
                ['Ingresos operacionales', money(cifras.s), true],
                ['Costo de ventas', money(cifras.c), true],
                ['Utilidad operacional', money(cifras.op), true],
                ['Cuentas por cobrar', money(cifras.ar), true],
                ['Inventarios', money(cifras.inv), true],
                ['Cuentas por pagar', money(cifras.ap), true],
                ['CxC / Ventas', razones ? pct(razones.arS) : 'no calculable', true],
                ['Inventario / Ventas', razones ? pct(razones.invS) : 'no calculable', true],
                ['CxP / Costos', razones && razones.apC !== null ? pct(razones.apC) : 'no calculable', true],
                ['Ajuste de capital de trabajo', memoria.ajuste.aplicado ? 'aplicado' : 'no aplicado'],
                ['Tasa de interés', memoria.ajuste.aplicado ? pct(memoria.ajuste.tasa) : '—', true],
                ...(memoria.ajuste.aplicado
                  ? [['Fórmula del ajuste', <code key="f" className="font-mono text-[10px]">{memoria.ajuste.formula}</code>]]
                  : []),
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}
