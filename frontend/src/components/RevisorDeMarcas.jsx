import React, { useState } from 'react';
import { Check, X, Trash2 } from 'lucide-react';
import { VOCABULARIO } from '../services/plantillaVocabulario.js';

/* Confirmación humana antes de guardar la plantilla marcada. Es el mismo patrón
   que el repositorio ya usa en la curación de comparables: la IA propone, la
   persona decide. Sin esta pantalla, una marca mal asignada se propagaría a
   todos los informes que usen esta plantilla. */
export default function RevisorDeMarcas({ marcas, onConfirmar, onCancelar }) {
  const [lista, setLista] = useState(marcas || []);

  const cambiarCampo = (i, campo) =>
    setLista(lista.map((m, j) => (j === i ? { ...m, campo } : m)));

  const quitar = (i) => setLista(lista.filter((_, j) => j !== i));

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
        {lista.map((m, i) => (
          <div key={i} className="flex items-center gap-3 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2">
            <span className="flex-1 text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate">
              {m.fragmento}
            </span>
            <select
              value={m.campo}
              onChange={(e) => cambiarCampo(i, e.target.value)}
              className="text-xs border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 bg-white dark:bg-[#262626]"
            >
              {VOCABULARIO.map((v) => (
                <option key={v.campo} value={v.campo}>{v.grupo} — {v.etiqueta}</option>
              ))}
            </select>
            <button onClick={() => quitar(i)} className="text-zinc-400 hover:text-red-500" title="Eliminar">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {lista.length === 0 && (
          <p className="text-xs text-zinc-500">No quedan marcas. La plantilla se guardará sin sustituciones.</p>
        )}
      </div>

      <div className="flex gap-3 mt-5">
        <button
          onClick={() => onConfirmar(lista)}
          className="flex items-center gap-2 bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white rounded-lg px-4 py-2 text-xs font-semibold"
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
