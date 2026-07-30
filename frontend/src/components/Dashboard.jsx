import React, { useState, useEffect } from 'react';
import { Search, Plus, Trash2, Copy, FileText, Calendar, Sparkles, AlertTriangle } from 'lucide-react';
import { fmt } from '../utils/calculations';

export default function Dashboard({ selectStudy, newStudy, deleteStudy, duplicateStudy }) {
  const [studies, setStudies] = useState([]);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => {
    loadStudies();
  }, []);

  const loadStudies = () => {
    try {
      const idxKey = 'pt:study:index';
      const raw = localStorage.getItem(idxKey);
      const ix = raw ? JSON.parse(raw) : {};

      const arr = Object.keys(ix).map(k => {
        const detailRaw = localStorage.getItem(`pt:study:${k}`);
        let parsedDetail = {};
        if (detailRaw) {
          try { parsedDetail = JSON.parse(detailRaw); } catch(e) {}
        }
        return {
          id: k,
          ent: ix[k].ent || parsedDetail.ent || 'Sin Razón Social',
          nit: ix[k].nit || parsedDetail.nit || '—',
          anio: ix[k].anio || parsedDetail.anio || '—',
          updated: ix[k].updated || Date.now(),
          monto: parsedDetail.t_s || ix[k].monto || 0
        };
      });
      
      setStudies(arr.sort((a, b) => b.updated - a.updated));
    } catch (e) {
      console.error("Error loading studies index:", e);
    }
  };

  const filteredStudies = studies.filter(s => 
    s.ent.toLowerCase().includes(search.toLowerCase()) ||
    s.nit.toLowerCase().includes(search.toLowerCase()) ||
    s.anio.toString().includes(search)
  );

  const totalMonto = studies.reduce((acc, curr) => acc + (curr.monto || 0), 0);

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">Gestor de Informes de Precios de Transferencia</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Seleccione un estudio existente o cree uno nuevo para comenzar.</p>
        </div>
        <button
          onClick={() => {
            newStudy();
            loadStudies();
          }}
          className="flex items-center gap-2 bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors shadow-sm cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Nuevo Estudio
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Total Estudios</span>
            <FileText className="w-4 h-4 text-[#0FA3A1]" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight">{studies.length}</span>
            <span className="text-xs text-zinc-500">Registrados</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Monto Analizado</span>
            <Sparkles className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight">COP {fmt(totalMonto)}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Última Modificación</span>
            <Calendar className="w-4 h-4 text-[#0FA3A1]" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              {studies.length > 0 ? new Date(studies[0].updated).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        {/* Toolbar */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por Empresa, NIT o Año..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] pl-9 pr-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100 transition-all"
            />
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 dark:bg-[#0f0f13] text-zinc-500 dark:text-zinc-400 text-xs font-semibold uppercase tracking-wider">
                <th className="py-3 px-4 border-b border-zinc-200 dark:border-zinc-800">Empresa (Contribuyente)</th>
                <th className="py-3 px-4 border-b border-zinc-200 dark:border-zinc-800">NIT</th>
                <th className="py-3 px-4 border-b border-zinc-200 dark:border-zinc-800">Año Fiscal</th>
                <th className="py-3 px-4 border-b border-zinc-200 dark:border-zinc-800 text-right">Monto Analizado (COP)</th>
                <th className="py-3 px-4 border-b border-zinc-200 dark:border-zinc-800 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
              {filteredStudies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500 dark:text-zinc-400">
                    No se encontraron estudios registrados.
                  </td>
                </tr>
              ) : (
                filteredStudies.map((study) => (
                  <tr 
                    key={study.id}
                    onClick={() => selectStudy(study.id)}
                    className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-medium text-zinc-900 dark:text-zinc-100">{study.ent}</td>
                    <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400 font-mono text-xs">{study.nit}</td>
                    <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400">{study.anio}</td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-zinc-700 dark:text-zinc-300">
                      {study.monto ? fmt(study.monto) : '0'}
                    </td>
                    <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => {
                            duplicateStudy(study.id);
                            loadStudies();
                          }}
                          title="Duplicar"
                          className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-700 transition-colors"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setPendingDelete(study)}
                          title="Eliminar"
                          className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg text-zinc-500 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm Delete Modal */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg max-w-sm w-full p-6">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-50 dark:bg-red-950/20 text-red-600 rounded-lg shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Eliminar estudio</h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  ¿Eliminar permanentemente el estudio de <strong>{pendingDelete.ent}</strong>? Esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setPendingDelete(null)}
                className="px-4 py-2 text-sm font-semibold rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  deleteStudy(pendingDelete.id);
                  loadStudies();
                  setPendingDelete(null);
                }}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
