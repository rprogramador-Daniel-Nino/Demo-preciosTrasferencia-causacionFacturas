import React, { useState, useEffect, useCallback } from 'react';
import { Users, X, Plus, Lock } from 'lucide-react';
import { leerAccesos, cambiarCompartido } from '../services/firestoreRepo';
import { ROL_LECTOR, ROL_EDITOR } from '../services/firestoreModelo';

/* Acceso de un estudio. Privado mientras nadie más esté en la lista: compartir es una
   decisión explícita por estudio, no el estado por omisión.

   Se concede en dos niveles, consulta o edición. Quien edita escribe sobre el estudio
   del dueño —no sobre una copia—, así que el guardado comprueba antes que nadie se haya
   adelantado y avisa en vez de pisar: sin eso volvería el problema que motivó separar
   los espacios, un estudio modificado por otro sin que ninguno lo supiera.

   Gestionar los accesos sigue siendo solo del dueño, y las reglas lo imponen: un editor
   que intente cambiar estas listas ve su escritura rechazada entera. */
export default function CompartirEstudio({ estudioId, usuario }) {
  const [abierto, setAbierto] = useState(false);
  const [accesos, setAccesos] = useState([]);
  const [correo, setCorreo] = useState('');
  const [rolNuevo, setRolNuevo] = useState(ROL_LECTOR);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    if (!estudioId || !usuario) return;
    try {
      setAccesos(await leerAccesos(estudioId, usuario));
    } catch (err) {
      console.error('[compartir] no se pudo leer la lista', err);
    }
  }, [estudioId, usuario]);

  useEffect(() => { cargar(); }, [cargar]);

  const aplicar = async (valor, { quitar = false, rol = ROL_LECTOR } = {}) => {
    setCargando(true);
    setError('');
    try {
      const resultado = await cambiarCompartido(estudioId, valor, usuario, { quitar, rol });
      if (resultado.error) setError(resultado.error);
      else {
        setAccesos(resultado.accesos);
        setCorreo('');
      }
    } finally {
      setCargando(false);
    }
  };

  const editores = accesos.filter(a => a.rol === ROL_EDITOR).length;
  const claseSelector = 'bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 ' +
    'rounded-lg px-1.5 py-1 text-[10.5px] text-zinc-700 dark:text-zinc-300 ' +
    'focus:outline-none focus:ring-1 focus:ring-[#0FA3A1]/50 disabled:opacity-50';

  return (
    <div className="relative">
      <button
        onClick={() => setAbierto(!abierto)}
        className={'flex items-center gap-1.5 text-[10.5px] px-2 py-0.5 rounded border transition-colors ' +
          (accesos.length
            ? 'border-[#0FA3A1]/50 text-[#0FA3A1] hover:bg-[#0FA3A1]/10'
            : 'border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800')}
        title={accesos.length
          ? `Compartido con ${accesos.length} persona(s)` +
            (editores ? `, ${editores} con permiso de edición` : ', todas de solo consulta')
          : 'Este estudio es privado. Puede darle acceso a un compañero, para consultarlo o para editarlo.'}
      >
        {accesos.length ? <Users className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
        {accesos.length ? `compartido (${accesos.length})` : 'privado'}
      </button>

      {abierto && (
        <div className="absolute right-0 top-full mt-1 z-30 w-96 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-900 dark:text-zinc-100">Acceso a este estudio</span>
            <button onClick={() => setAbierto(false)} className="text-zinc-400 hover:text-zinc-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-[10.5px] text-zinc-500">
            Elija qué puede hacer cada persona: <b>consultarlo</b> sin modificar nada, o
            también <b>editarlo</b>. Quien edita trabaja sobre este mismo estudio, no sobre
            una copia. Dar y retirar accesos es solo suyo, y borrarlo también.
          </p>

          <div className="flex gap-1.5">
            <input
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && correo.trim()) aplicar(correo, { rol: rolNuevo }); }}
              placeholder="correo de Google de la persona"
              className="flex-1 min-w-0 bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-zinc-950 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-[#0FA3A1]/50"
            />
            <select
              value={rolNuevo}
              onChange={(e) => setRolNuevo(e.target.value)}
              className={claseSelector}
              title="Qué podrá hacer con el estudio"
            >
              <option value={ROL_LECTOR}>consultar</option>
              <option value={ROL_EDITOR}>editar</option>
            </select>
            <button
              onClick={() => aplicar(correo, { rol: rolNuevo })}
              disabled={cargando || !correo.trim()}
              className="flex items-center gap-1 text-[10.5px] font-bold px-2 py-1 rounded-lg bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-3 h-3" />
              Dar acceso
            </button>
          </div>

          {error && <div className="text-[10.5px] text-amber-600 dark:text-amber-400">{error}</div>}

          {accesos.length ? (
            <ul className="space-y-1 pt-1 border-t border-zinc-100 dark:border-zinc-800">
              {accesos.map(({ correo: c, rol }) => (
                <li key={c} className="flex items-center justify-between gap-2 text-[11px] text-zinc-700 dark:text-zinc-300">
                  <span className="truncate font-mono text-[10.5px] flex-1 min-w-0">{c}</span>
                  {/* Cambiar el nivel de alguien que ya está es la operación normal de
                      pasarlo de consulta a edición, así que se hace aquí mismo y no
                      retirándolo para volver a agregarlo. */}
                  <select
                    value={rol}
                    onChange={(e) => aplicar(c, { rol: e.target.value })}
                    disabled={cargando}
                    className={claseSelector}
                    title="Nivel de acceso de esta persona"
                  >
                    <option value={ROL_LECTOR}>consultar</option>
                    <option value={ROL_EDITOR}>editar</option>
                  </select>
                  <button
                    onClick={() => aplicar(c, { quitar: true })}
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

          {editores > 0 && (
            <p className="text-[10.5px] text-zinc-400 pt-1 border-t border-zinc-100 dark:border-zinc-800">
              Si dos personas editan a la vez, quien guarde después recibe un aviso y no pisa
              el trabajo del otro. Las imágenes del ANEXO A y B se quedan en el navegador de
              quien las cargó.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
