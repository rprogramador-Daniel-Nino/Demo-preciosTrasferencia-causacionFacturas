import React, { useState } from 'react';
import { ShieldCheck, LogIn, AlertTriangle } from 'lucide-react';
import { iniciarSesionGoogle } from '../services/sesion';
import { DOMINIO } from '../services/firebase';

/* Puerta de entrada. Antes no había ninguna: los estudios vivían en el navegador de
   cada uno, así que no hacía falta identificarse. Con la base compartida sí, y el
   correo de quien entra es además el rastro de quién modificó cada estudio. */
export default function Acceso() {
  const [entrando, setEntrando] = useState(false);
  const [error, setError] = useState('');

  const entrar = async () => {
    setError('');
    setEntrando(true);
    try {
      await iniciarSesionGoogle();
      /* No hace falta navegar: el observador de sesión de App.jsx monta la aplicación
         en cuanto la credencial llega. */
    } catch (err) {
      const codigo = err && err.code;
      if (codigo === 'auth/popup-closed-by-user' || codigo === 'auth/cancelled-popup-request') {
        setError('Se cerró la ventana de Google antes de terminar. Inténtelo de nuevo.');
      } else if (codigo === 'auth/popup-blocked') {
        setError('El navegador bloqueó la ventana de Google. Permita las ventanas emergentes para este sitio.');
      } else if (codigo === 'auth/operation-not-allowed' || codigo === 'auth/configuration-not-found') {
        setError('El acceso con Google todavía no está habilitado en el proyecto de Firebase. ' +
          'Actívelo en Authentication → Sign-in method → Google.');
      } else {
        setError((err && err.message) || 'No se pudo iniciar la sesión.');
      }
    } finally {
      setEntrando(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#09090b] px-4">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <ShieldCheck className="w-6 h-6 text-[#0FA3A1]" />
          <div>
            <h1 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Sistema PT</h1>
            <p className="text-[11px] text-zinc-500">Precios de transferencia · CR Consultores</p>
          </div>
        </div>

        <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-5">
          Los estudios y el catálogo de comparables son compartidos por el equipo. Entre con su
          cuenta corporativa <b>@{DOMINIO}</b> para acceder.
        </p>

        <button
          onClick={entrar}
          disabled={entrando}
          className={'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold text-white transition-colors ' +
            (entrando ? 'bg-zinc-400 cursor-not-allowed' : 'bg-[#0FA3A1] hover:bg-[#0B7C7A] cursor-pointer')}
        >
          <LogIn className="w-4 h-4" />
          {entrando ? 'Abriendo Google…' : 'Entrar con Google'}
        </button>

        {error && (
          <div className="mt-4 flex gap-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
