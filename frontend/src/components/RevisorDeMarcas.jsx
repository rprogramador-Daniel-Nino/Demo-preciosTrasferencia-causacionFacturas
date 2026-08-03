import React, { useState } from 'react';
import { Check, X, Trash2 } from 'lucide-react';
import { VOCABULARIO } from '../services/plantillaVocabulario.js';

/* Confirmación humana antes de guardar la plantilla marcada. Es el mismo patrón
   que el repositorio ya usa en la curación de comparables: la IA propone, la
   persona decide. Sin esta pantalla, una marca mal asignada se propagaría a
   todos los informes que usen esta plantilla. */
export default function RevisorDeMarcas({ marcas, onConfirmar, onCancelar }) {
  /* Identidad sintética asignada una sola vez al inicializar.
     Permite editar marcas sin remontarlas, y evita colisiones entre fragmentos
     que se repiten en diferentes trozos del documento. */
  const [lista, setLista] = useState(() =>
    (marcas || []).map((m, i) => ({
      ...m,
      _id: `${Date.now()}-${i}`,
    }))
  );

  const cambiarCampo = (id, campo) =>
    setLista(prevLista => prevLista.map(m => (m._id === id ? { ...m, campo } : m)));

  const quitar = (id) => setLista(prevLista => prevLista.filter(m => m._id !== id));

  /* Remover identificadores sintéticos antes de confirmar */
  const confirmar = () => {
    const listaSinId = lista.map(({ _id, ...m }) => m);
    onConfirmar(listaSinId);
  };

  /* Truncar solo cuando sea necesario */
  const truncar = (str, max) => (str.length > max ? str.slice(0, max) + '...' : str);

  return (
    <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
      <h3 className="text-md font-bold text-zinc-950 dark:text-zinc-50">
        Revisar marcas propuestas
      </h3>
      <p className="text-xs text-zinc-500 mt-1 mb-4">
        La IA propuso {lista.length} marca(s). Corrige el campo asignado o elimina las que no
        correspondan. Nada se guarda hasta que confirmes.
      </p>

      <div className="max-h-[420px] overflow-y-auto space-y-2">
        {lista.map((m) => {
          const ocurrencia = m.ocurrencia || 1;
          const etiquetaOcurrencia = ocurrencia > 1 ? ` (${ocurrencia}.ª aparición)` : '';
          return (
            <div key={m._id} className="flex items-start gap-3 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0">
                <span
                  className="text-xs font-mono text-zinc-700 dark:text-zinc-300 block max-h-[100px] overflow-y-auto whitespace-pre-wrap"
                  title={m.fragmento}
                >
                  {m.fragmento}
                </span>
                {etiquetaOcurrencia && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 block">
                    {etiquetaOcurrencia}
                  </span>
                )}
              </div>
              <div className="flex items-start gap-2">
                <div>
                  <label htmlFor={`marca-${m._id}`} className="text-xs text-zinc-600 dark:text-zinc-400 block mb-1">
                    Campo
                  </label>
                  <select
                    id={`marca-${m._id}`}
                    value={m.campo}
                    onChange={(e) => cambiarCampo(m._id, e.target.value)}
                    className="text-xs border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 bg-white dark:bg-[#262626]"
                    aria-label={`Campo para fragmento: ${truncar(m.fragmento, 30)}`}
                  >
                    {VOCABULARIO.map((v) => (
                      <option key={v.campo} value={v.campo}>{v.grupo} — {v.etiqueta}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => quitar(m._id)}
                  className="text-zinc-400 hover:text-red-500 mt-6"
                  title={`Eliminar marca: ${truncar(m.fragmento, 30)}`}
                  aria-label={`Eliminar marca: ${m.fragmento}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
        {lista.length === 0 && (
          <p className="text-xs text-zinc-500">No quedan marcas. La plantilla se guardará sin sustituciones.</p>
        )}
      </div>

      <div className="flex gap-3 mt-5">
        <button
          onClick={confirmar}
          disabled={lista.length === 0}
          className="flex items-center gap-2 bg-[#0FA3A1] hover:bg-[#0B7C7A] disabled:bg-zinc-300 disabled:text-zinc-500 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 text-xs font-semibold"
        >
          <Check className="w-3.5 h-3.5" /> Confirmar y guardar plantilla
        </button>
        <button
          onClick={onCancelar}
          className="flex items-center gap-2 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2 text-xs font-semibold"
        >
          <X className="w-3.5 h-3.5" /> Cancelar
        </button>
      </div>
    </div>
  );
}
