import React, { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Users, RefreshCw, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { listarClientes, estudiosDelCliente } from '../services/firestoreRepo';

/* Catálogo de contribuyentes. La colección se llena sola —cada guardado de estudio
   escribe su cliente—, pero hasta ahora no había dónde verla, así que crear el estudio
   del año siguiente obligaba a volver a digitar los datos o a recargar el RUT. */
export default function Clientes({ usuario, nuevoEstudioDesdeCliente, selectStudy }) {
  const [clientes, setClientes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');
  /* Estudios por cliente, cargados solo al desplegar: traerlos todos de entrada serían
     tantas consultas como clientes, y casi ninguna se miraría. */
  const [desplegado, setDesplegado] = useState(null);
  const [estudios, setEstudios] = useState({});

  const cargar = useCallback(async () => {
    if (!usuario) return;
    setCargando(true);
    setError('');
    try {
      setClientes(await listarClientes(usuario));
    } catch (err) {
      console.error('[clientes] no se pudo leer el catálogo', err);
      setError((err && err.message) || 'No se pudo leer el catálogo de clientes.');
    } finally {
      setCargando(false);
    }
  }, [usuario]);

  useEffect(() => { cargar(); }, [cargar]);

  const desplegar = async (nit) => {
    if (desplegado === nit) { setDesplegado(null); return; }
    setDesplegado(nit);
    if (estudios[nit]) return;
    try {
      /* El await va fuera del actualizador de estado: dentro no se puede esperar, y
         React invoca ese callback de forma sincrónica. */
      const lista = await estudiosDelCliente(nit, usuario);
      setEstudios(prev => ({ ...prev, [nit]: lista }));
    } catch (err) {
      console.error('[clientes] no se pudieron leer los estudios de ' + nit, err);
      setEstudios(prev => ({ ...prev, [nit]: [] }));
    }
  };

  const aguja = busqueda.trim().toLowerCase();
  const filtrados = clientes.filter(c => !aguja
    || String(c.razonSocial || '').toLowerCase().includes(aguja)
    || String(c.nit || '').includes(aguja)
    || String(c.ciiu || '').includes(aguja));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">Clientes</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Sus contribuyentes, reutilizables entre años gravables. Se alimentan solos al guardar cada estudio.
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

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por razón social, NIT o CIIU…"
          className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-950 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/40"
        />
      </div>

      {error && (
        <div className="text-xs bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 rounded-lg p-3">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm overflow-hidden">
        {cargando ? (
          <div className="p-8 text-center text-xs text-zinc-500">Leyendo el catálogo…</div>
        ) : !filtrados.length ? (
          <div className="p-8 text-center text-xs text-zinc-500">
            <Users className="w-6 h-6 mx-auto mb-2 text-zinc-400" />
            {clientes.length
              ? 'Ningún cliente coincide con la búsqueda.'
              : 'Todavía no hay clientes. Se registran automáticamente al guardar un estudio con NIT.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="text-left py-2.5 px-4 font-semibold">Razón social</th>
                <th className="text-left py-2.5 px-4 font-semibold">NIT</th>
                <th className="text-left py-2.5 px-4 font-semibold">CIIU</th>
                <th className="text-left py-2.5 px-4 font-semibold">Representante</th>
                <th className="text-left py-2.5 px-4 font-semibold">Actividad</th>
                <th className="text-center py-2.5 px-4 font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(cliente => (
                <React.Fragment key={cliente.id}>
                  <tr className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <td className="py-3 px-4">
                      <button onClick={() => desplegar(cliente.id)} className="flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-zinc-100 text-left">
                        {desplegado === cliente.id ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />}
                        {cliente.razonSocial}
                      </button>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-600 dark:text-zinc-400">{cliente.nit}</td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">{cliente.ciiu || '—'}</td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">{cliente.representante || '—'}</td>
                    <td className="py-3 px-4 text-xs text-zinc-500 max-w-xs truncate" title={cliente.actividadEspecifica || ''}>
                      {cliente.actividadEspecifica || '—'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => nuevoEstudioDesdeCliente(cliente)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white"
                        title="Crea un estudio nuevo con los datos de este cliente ya diligenciados"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Nuevo estudio
                      </button>
                    </td>
                  </tr>
                  {desplegado === cliente.id && (
                    <tr className="bg-zinc-50 dark:bg-zinc-900/40">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="text-[11px] text-zinc-600 dark:text-zinc-300 space-y-2">
                          {cliente.objeto ? (
                            <div><span className="font-semibold">Objeto social:</span> {cliente.objeto}</div>
                          ) : null}
                          <div>
                            <span className="font-semibold">Estudios de este cliente:</span>{' '}
                            {!estudios[cliente.id] ? 'consultando…'
                              : estudios[cliente.id].length ? (
                                <span className="inline-flex flex-wrap gap-2 align-middle">
                                  {estudios[cliente.id].map(e => (
                                    <button
                                      key={e.id}
                                      onClick={() => selectStudy(e.id)}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-800"
                                      title="Abrir este estudio"
                                    >
                                      <FileText className="w-3 h-3" />
                                      {e.anio}
                                    </button>
                                  ))}
                                </span>
                              ) : 'ninguno registrado todavía'}
                          </div>
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
