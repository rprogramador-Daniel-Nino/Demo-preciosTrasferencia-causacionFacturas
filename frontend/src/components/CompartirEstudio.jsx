import React, { useState, useEffect, useCallback } from 'react';
import { Users, X, Plus, Lock } from 'lucide-react';
import { leerCompartidoCon, cambiarCompartido } from '../services/firestoreRepo';

/* Acceso de un estudio. Privado mientras nadie más esté en la lista: compartir es una
   decisión explícita por estudio, no el estado por omisión.

   Lo que se concede es LECTURA. Si dos personas pudieran guardar el mismo estudio
   volvería el problema que motivó separar los espacios —un estudio creado por alguien y
   modificado por otro sin que ninguno lo supiera. */
export default function CompartirEstudio({ estudioId, usuario }) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState([]);
  const [correo, setCorreo] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    if (!estudioId || !usuario) return;
    try {
      setLista(await leerCompartidoCon(estudioId, usuario));
    } catch (err) {
      console.error('[compartir] no se pudo leer la lista', err);
    }
  }, [estudioId, usuario]);

  useEffect(() => { cargar(); }, [cargar]);

  const aplicar = async (valor, quitar) => {
    setCargando(true);
    setError('');
    try {
      const resultado = await cambiarCompartido(estudioId, valor, usuario, { quitar });
      if (resultado.error) setError(resultado.error);
      else {
        setLista(resultado.lista);
        setCorreo('');
      }
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setAbierto(!abierto)}
        className={'flex items-center gap-1.5 text-[10.5px] px-2 py-0.5 rounded border transition-colors ' +
          (lista.length
            ? 'border-[#0FA3A1]/50 text-[#0FA3A1] hover:bg-[#0FA3A1]/10'
            : 'border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800')}
        title={lista.length
          ? `Compartido con ${lista.length} persona(s)`
          : 'Este estudio es privado. Puede darle acceso de lectura a un compañero.'}
      >
        {lista.length ? <Users className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
        {lista.length ? `compartido (${lista.length})` : 'privado'}
      </button>

      {abierto && (
        <div className="absolute right-0 top-full mt-1 z-30 w-80 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-900 dark:text-zinc-100">Acceso a este estudio</span>
            <button onClick={() => setAbierto(false)} className="text-zinc-400 hover:text-zinc-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-[10.5px] text-zinc-500">
            Solo usted puede editarlo. Quien agregue aquí podrá <b>consultarlo</b>, no modificarlo.
          </p>

          <div className="flex gap-1.5">
            <input
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && correo.trim()) aplicar(correo, false); }}
              placeholder="correo de Google de la persona"
              className="flex-1 bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-zinc-950 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-[#0FA3A1]/50"
            />
            <button
              onClick={() => aplicar(correo, false)}
              disabled={cargando || !correo.trim()}
              className="flex items-center gap-1 text-[10.5px] font-bold px-2 py-1 rounded-lg bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-3 h-3" />
              Dar acceso
            </button>
          </div>

          {error && <div className="text-[10.5px] text-amber-600 dark:text-amber-400">{error}</div>}

          {lista.length ? (
            <ul className="space-y-1 pt-1 border-t border-zinc-100 dark:border-zinc-800">
              {lista.map(c => (
                <li key={c} className="flex items-center justify-between gap-2 text-[11px] text-zinc-700 dark:text-zinc-300">
                  <span className="truncate font-mono text-[10.5px]">{c}</span>
                  <button
                    onClick={() => aplicar(c, true)}
                    disabled={cargando}
                    className="text-zinc-400 hover:text-red-600 disabled:opacity-50"
                    title="Retirar el acceso"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[10.5px] text-zinc-400 pt-1 border-t border-zinc-100 dark:border-zinc-800">
              Nadie más tiene acceso.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
