import React, { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw, Library, ChevronDown, ChevronRight } from 'lucide-react';
import { listarComparablesHistoricas } from '../services/firestoreRepo';
import { filtrarCatalogo, aniosDelCatalogo } from '../services/firestoreModelo';

/* Catálogo de comparables extraídas de la documentación comprobatoria de años
   anteriores. Lo alimenta el paso de fuente histórica del motor; esta vista es para
   consultarlo: saber si una empresa ya se usó, en qué años, con qué indicador y de qué
   informe salió el dato. */
export default function CatalogoHistorico() {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [texto, setTexto] = useState('');
  const [anio, setAnio] = useState('');
  const [desplegado, setDesplegado] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      setItems(await listarComparablesHistoricas());
    } catch (err) {
      console.error('[catálogo] no se pudo leer', err);
      setError((err && err.message) || 'No se pudo leer el catálogo.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const anios = aniosDelCatalogo(items);
  const filtrados = filtrarCatalogo(items, { texto, anio: anio || null });

  /* El margen puede venir en tanto por uno (0,0725) o en porcentaje (7,25) según cómo
     lo expresara el informe del que se leyó. Se muestra tal cual, con la unidad que
     delata la magnitud, en vez de convertir a ciegas y arriesgar un dato falso. */
  const margenLegible = (valor) => {
    if (valor === null || valor === undefined) return '—';
    const n = Number(valor);
    if (!Number.isFinite(n)) return '—';
    return Math.abs(n) <= 1
      ? (n * 100).toFixed(2).replace('.', ',') + ' %'
      : n.toFixed(2).replace('.', ',') + ' %';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">Catálogo de comparables</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Empresas aceptadas como comparables en estudios anteriores del equipo, con el rastro del informe del que salieron.
          </p>
        </div>
        <button
          onClick={cargar}
          disabled={cargando}
          className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          <RefreshCw className={'w-4 h-4' + (cargando ? ' animate-spin' : '')} />
          Actualizar
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar por razón social, país, actividad o indicador…"
            className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-950 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/40"
          />
        </div>
        <select
          value={anio}
          onChange={(e) => setAnio(e.target.value)}
          className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-950 dark:text-zinc-100 focus:outline-none"
        >
          <option value="">Todos los años</option>
          {anios.map(a => <option key={a} value={a}>Año gravable {a}</option>)}
        </select>
      </div>

      {error && (
        <div className="text-xs bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 rounded-lg p-3">
          {error}
        </div>
      )}

      <div className="text-[11px] text-zinc-500">
        {cargando ? 'Leyendo…' : `${filtrados.length} de ${items.length} empresas`}
      </div>

      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm overflow-x-auto">
        {cargando ? (
          <div className="p-8 text-center text-xs text-zinc-500">Leyendo el catálogo…</div>
        ) : !filtrados.length ? (
          <div className="p-8 text-center text-xs text-zinc-500">
            <Library className="w-6 h-6 mx-auto mb-2 text-zinc-400" />
            {items.length
              ? 'Ninguna empresa coincide con los criterios.'
              : 'El catálogo está vacío. Se llena al cargar la documentación comprobatoria de un año anterior en el motor de comparables.'}
          </div>
        ) : (
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="text-left py-2.5 px-4 font-semibold">Razón social</th>
                <th className="text-left py-2.5 px-4 font-semibold">País</th>
                <th className="text-left py-2.5 px-4 font-semibold">Actividad</th>
                <th className="text-left py-2.5 px-4 font-semibold">Indicador</th>
                <th className="text-right py-2.5 px-4 font-semibold">Margen</th>
                <th className="text-left py-2.5 px-4 font-semibold">Años</th>
                <th className="text-center py-2.5 px-4 font-semibold">Apariciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(item => (
                <React.Fragment key={item.id}>
                  <tr className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <td className="py-3 px-4 font-semibold text-zinc-900 dark:text-zinc-100">{item.nombre}</td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">{item.pais || '—'}</td>
                    <td className="py-3 px-4 text-xs text-zinc-500 max-w-sm truncate" title={item.actividad || ''}>
                      {item.actividad || '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">{item.pli || '—'}</td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-zinc-700 dark:text-zinc-300">
                      {margenLegible(item.margen)}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">
                      {(item.anios || []).join(', ') || '—'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => setDesplegado(desplegado === item.id ? null : item.id)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        {desplegado === item.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        {(item.apariciones || []).length}
                      </button>
                    </td>
                  </tr>
                  {desplegado === item.id && (
                    <tr className="bg-zinc-50 dark:bg-zinc-900/40">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="text-[11px] text-zinc-600 dark:text-zinc-300 space-y-1">
                          {item.actividad ? <div className="mb-2"><span className="font-semibold">Actividad completa:</span> {item.actividad}</div> : null}
                          <div className="font-semibold">De dónde salió este registro:</div>
                          {(item.apariciones || []).length ? (
                            <ul className="space-y-0.5">
                              {item.apariciones.map((a, i) => (
                                <li key={i} className="font-mono text-[10.5px]">
                                  año {a.anio} · {a.archivo || 'sin archivo'}
                                  {a.clienteNit ? ` · NIT ${a.clienteNit}` : ''}
                                  {a.cargadoEn ? ` · ${String(a.cargadoEn).slice(0, 10)}` : ''}
                                </li>
                              ))}
                            </ul>
                          ) : <div>Sin rastro documental registrado.</div>}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
