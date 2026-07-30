import React, { useState, useEffect } from 'react';
import { Plus, Trash2, ShieldCheck, ShieldAlert, Sparkles, Filter, Calculator } from 'lucide-react';
import { num, pliOf, ratios, quart, pctf, fmt, adjustInfo } from '../utils/calculations';

export default function MotorComparables({ study, updateStudy }) {
  const [comparables, setComparables] = useState(study.comparables || [
    { name: 'Activision Blizzard', amb: 'Int', s: 7500000000, c: 2500000000, op: 1500000000, ar: 800000000, inv: 100000000, ap: 400000000, sic: '5812', id: '1' },
    { name: 'Electronic Arts Inc', amb: 'Int', s: 7400000000, c: 2200000000, op: 1300000000, ar: 900000000, inv: 50000000, ap: 300000000, sic: '5812', id: '2' },
    { name: 'Take-Two Interactive', amb: 'Int', s: 5300000000, c: 1800000000, op: 800000000, ar: 600000000, inv: 20000000, ap: 250000000, sic: '5812', id: '3' },
    { name: 'Ubisoft Entertainment', amb: 'Int', s: 2200000000, c: 900000000, op: 250000000, ar: 350000000, inv: 40000000, ap: 180000000, sic: '5812', id: '4' }
  ]);

  const [cmode, setCmode] = useState(study.cmode || 'all');

  useEffect(() => {
    updateStudy({ comparables, cmode });
  }, [comparables, cmode]);

  const handleRowChange = (index, key, value) => {
    const next = [...comparables];
    next[index][key] = value;
    setComparables(next);
  };

  const addComparable = () => {
    setComparables([...comparables, {
      name: '', amb: 'Int', s: '', c: '', op: '', ar: '', inv: '', ap: '', sic: '', id: Date.now().toString()
    }]);
  };

  const removeComparable = (index) => {
    const next = comparables.filter((_, i) => i !== index);
    setComparables(next);
  };

  // Perform Calculations
  const kind = study.pli || 'MO';
  const useAdj = study.useadj || false;
  const interestRate = (num(study.prime) || 0) / 100;
  
  const T = {
    s: num(study.t_s),
    c: num(study.t_c),
    op: num(study.t_op),
    ar: num(study.t_ar),
    inv: num(study.t_inv),
    ap: num(study.t_ap)
  };
  
  const tPLI = pliOf(T, kind);
  const tR = ratios(T);

  const calculatedRows = comparables.map(c => {
    const rawVal = {
      s: num(c.s),
      c: num(c.c),
      op: num(c.op),
      ar: num(c.ar),
      inv: num(c.inv),
      ap: num(c.ap)
    };
    
    let pliVal = pliOf(rawVal, kind);
    let adj = 0;
    const cR = ratios(rawVal);

    if (useAdj && kind !== 'Berry' && tR && cR && tR.apC !== null && cR.apC !== null) {
      adj = interestRate * ((tR.arS - cR.arS) + (tR.invS - cR.invS) - (tR.apC - cR.apC));
    }

    const adjustedPli = pliVal === null ? null : pliVal + adj;
    
    const isIncluded = cmode === 'all' ? true : (cmode === 'intl' ? c.amb === 'Int' : c.amb === 'Nac');

    return {
      ...c,
      pli: pliVal,
      adjustedPli,
      isIncluded
    };
  });

  const activeSeries = calculatedRows
    .filter(r => r.isIncluded && r.adjustedPli !== null)
    .map(r => r.adjustedPli)
    .sort((a, b) => a - b);

  const stats = activeSeries.length ? {
    p25: quart(activeSeries, .25),
    med: quart(activeSeries, .5),
    p75: quart(activeSeries, .75)
  } : null;

  const adjustment = (stats && tPLI !== null) ? adjustInfo(T, tPLI, stats, T.s || 0, 1, study.egreso) : null;

  return (
    <div className="space-y-6">
      {/* KPIs & Results Panel */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Rango Intercuartil */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Rango Intercuartil</span>
            <Calculator className="w-4 h-4 text-[#0FA3A1]" />
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold tracking-tight">
              {stats ? `${pctf(stats.p25)} - ${pctf(stats.p75)}` : 'N/A'}
            </span>
            <span className="text-xs text-zinc-500 block mt-1">Mediana: {stats ? pctf(stats.med) : '—'}</span>
          </div>
        </div>

        {/* Parte Examinada */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Indicador del Contribuyente</span>
            <Sparkles className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold tracking-tight">
              {tPLI !== null ? pctf(tPLI) : 'N/A'}
            </span>
            <span className="text-xs text-zinc-500 block mt-1">Métrica: {study.pli || 'MO'}</span>
          </div>
        </div>

        {/* Estado de Cumplimiento */}
        <div className="md:col-span-2 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Resultado Cumplimiento</span>
            <div>
              {adjustment ? (
                adjustment.within ? (
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-lg">
                    <ShieldCheck className="w-5 h-5" />
                    CUMPLE (Dentro del rango)
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-red-600 dark:text-rose-400 font-bold text-lg">
                    <ShieldAlert className="w-5 h-5" />
                    NO CUMPLE ({adjustment.dir})
                  </div>
                )
              ) : (
                <span className="text-sm text-zinc-500">Ingrese cifras y comparables para analizar.</span>
              )}
            </div>
          </div>
          {adjustment && !adjustment.within && (
            <div className="text-right">
              <span className="text-xs text-zinc-500 block">Ajuste Sugerido:</span>
              <span className="font-bold text-red-600 dark:text-rose-400 text-sm">
                COP {fmt(adjustment.capped)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        {/* Toolbar */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-zinc-500" />
            <select
              value={cmode}
              onChange={(e) => setCmode(e.target.value)}
              className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[6px] text-xs font-medium focus:outline-none text-zinc-950 dark:text-zinc-100"
            >
              <option value="all">Todas las comparables</option>
              <option value="intl">Solo Internacionales</option>
              <option value="nac">Solo Nacionales</option>
            </select>
          </div>
          <button
            onClick={addComparable}
            className="flex items-center gap-2 bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white rounded-lg px-4 py-2 text-xs font-semibold transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Agregar Comparable
          </button>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-zinc-50 dark:bg-[#0f0f13] text-zinc-500 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-wider">
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 w-[18%]">Razón Social</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 w-[8%]">Ámbito</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right w-[10%]">Ventas</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right w-[10%]">Costos</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right w-[10%]">U. Op.</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right w-[8%]">CxC</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right w-[8%]">Inv.</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right w-[8%]">CxP</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-center w-[12%]">PLI Ajustado</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-center w-[8%]">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
              {calculatedRows.map((row, idx) => (
                <tr 
                  key={row.id || idx}
                  className={`transition-colors ${
                    row.isIncluded 
                      ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40' 
                      : 'opacity-35 bg-zinc-100/50 dark:bg-zinc-950/20'
                  }`}
                >
                  {/* Name */}
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={row.name}
                      placeholder="Empresa comparable"
                      onChange={(e) => handleRowChange(idx, 'name', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent hover:border-zinc-300 focus:border-[#0FA3A1] py-1 text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>

                  {/* Ambito */}
                  <td className="py-2 px-3">
                    <select
                      value={row.amb}
                      onChange={(e) => handleRowChange(idx, 'amb', e.target.value)}
                      className="bg-transparent border-0 border-b border-transparent focus:border-[#0FA3A1] py-1 text-zinc-900 dark:text-zinc-200 focus:outline-none"
                    >
                      <option value="Int">Int</option>
                      <option value="Nac">Nac</option>
                    </select>
                  </td>

                  {/* Ventas */}
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      value={row.s}
                      placeholder="0"
                      onChange={(e) => handleRowChange(idx, 's', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>

                  {/* Costos */}
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      value={row.c}
                      placeholder="0"
                      onChange={(e) => handleRowChange(idx, 'c', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>

                  {/* U. Op */}
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      value={row.op}
                      placeholder="0"
                      onChange={(e) => handleRowChange(idx, 'op', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>

                  {/* CxC */}
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      value={row.ar}
                      placeholder="0"
                      onChange={(e) => handleRowChange(idx, 'ar', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>

                  {/* Inv */}
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      value={row.inv}
                      placeholder="0"
                      onChange={(e) => handleRowChange(idx, 'inv', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>

                  {/* CxP */}
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      value={row.ap}
                      placeholder="0"
                      onChange={(e) => handleRowChange(idx, 'ap', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>

                  {/* PLI Ajustado */}
                  <td className="py-2 px-3 text-center font-bold text-zinc-800 dark:text-zinc-200">
                    {row.adjustedPli !== null ? pctf(row.adjustedPli) : '—'}
                  </td>

                  {/* Actions */}
                  <td className="py-2 px-3 text-center">
                    <button
                      onClick={() => removeComparable(idx)}
                      className="p-1 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg text-zinc-400 hover:text-red-600 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
