import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Send, Paperclip, Plus, ChevronDown, Loader2, AlertTriangle, Pencil, Trash2, Check,
} from 'lucide-react';
import {
  listarChats, crearChat, agregarMensajesChat, renombrarChat, borrarChat,
} from '../../services/firestoreRepo';
import { construirPeticionGemini, enviarMensajeChat, TOPE_ADJUNTO_BYTES } from '../../services/chatAsistente';
import { TITULO_NUEVO_CHAT } from '../../services/firestoreModelo';
import MensajeMarkdown from './MensajeMarkdown.jsx';

/** Lee un archivo como base64 puro (sin el prefijo `data:...;base64,`). */
function leerBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

/**
 * Ventanita de chat estilo "Facebook antiguo": un hilo por estudio, con memoria real
 * de la conversación dentro de cada hilo y un selector para ver hilos anteriores del
 * mismo estudio. Un hilo nuevo no hereda nada de otro — es justo lo que decide
 * `historialHilo` en `construirPeticionGemini`.
 */
export default function ChatVentana({ study, estudioId, usuario, onCerrar }) {
  const [hilos, setHilos] = useState([]);
  const [hiloActivoId, setHiloActivoId] = useState(null);
  const [mensajes, setMensajes] = useState([]);
  const [mostrarHilos, setMostrarHilos] = useState(false);
  const [texto, setTexto] = useState('');
  const [adjuntos, setAdjuntos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [editandoTitulo, setEditandoTitulo] = useState(false);
  const [tituloEnEdicion, setTituloEnEdicion] = useState('');
  const [hiloAConfirmarBorrado, setHiloAConfirmarBorrado] = useState(null);
  const finRef = useRef(null);
  const inputArchivoRef = useRef(null);
  const inputTituloRef = useRef(null);

  /* Un hilo nuevo por estudio, cargado una vez al abrir la ventana. Cambiar de
     estudio (otra `key` desde ChatFlotante/App.jsx no hace falta: `estudioId` cambia
     de prop y este efecto recarga solo) siempre arranca desde el hilo más reciente de
     ESE estudio, nunca del de otro. */
  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError('');
    listarChats(usuario, estudioId)
      .then((lista) => {
        if (cancelado) return;
        setHilos(lista);
        if (lista.length) {
          setHiloActivoId(lista[0].id);
          setMensajes(lista[0].mensajes || []);
        } else {
          setHiloActivoId(null);
          setMensajes([]);
        }
      })
      .catch((err) => {
        if (cancelado) return;
        console.error('[chat] no se pudo listar el historial', err);
        setError('No se pudo cargar el historial de chats de este estudio.');
      })
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, [usuario, estudioId]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensajes, enviando]);

  const tituloHiloActivo = useMemo(() => {
    const hilo = hilos.find(h => h.id === hiloActivoId);
    return hilo ? hilo.titulo : TITULO_NUEVO_CHAT;
  }, [hilos, hiloActivoId]);

  const abrirHilo = (hilo) => {
    setHiloActivoId(hilo.id);
    setMensajes(hilo.mensajes || []);
    setMostrarHilos(false);
    setError('');
  };

  const empezarHiloNuevo = () => {
    /* No se crea el documento todavía — se crea al mandar el primer mensaje, para no
       llenar el historial de hilos vacíos que nadie usó. */
    setHiloActivoId(null);
    setMensajes([]);
    setMostrarHilos(false);
    setError('');
  };

  const iniciarEdicionTitulo = () => {
    if (!hiloActivoId) return; // un chat sin guardar todavía no tiene qué renombrar
    setTituloEnEdicion(tituloHiloActivo);
    setEditandoTitulo(true);
    setMostrarHilos(false);
    /* El input todavía no existe en el DOM en este mismo render. */
    setTimeout(() => inputTituloRef.current?.select(), 0);
  };

  const cancelarEdicionTitulo = () => setEditandoTitulo(false);

  const guardarTitulo = async () => {
    const limpio = tituloEnEdicion.trim();
    if (!limpio || !hiloActivoId) { setEditandoTitulo(false); return; }
    setEditandoTitulo(false);
    try {
      await renombrarChat(usuario, estudioId, hiloActivoId, limpio);
      setHilos(prev => prev.map(h => (h.id === hiloActivoId ? { ...h, titulo: limpio.slice(0, 60) } : h)));
    } catch (err) {
      console.error('[chat] no se pudo renombrar el hilo', err);
      setError('No se pudo cambiar el título del chat.');
    }
  };

  const alPresionarTeclaEnTitulo = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); guardarTitulo(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelarEdicionTitulo(); }
  };

  const eliminarHilo = async (hiloId) => {
    setHiloAConfirmarBorrado(null);
    try {
      await borrarChat(usuario, estudioId, hiloId);
      setHilos(prev => prev.filter(h => h.id !== hiloId));
      if (hiloId === hiloActivoId) empezarHiloNuevo();
    } catch (err) {
      console.error('[chat] no se pudo borrar el hilo', err);
      setError('No se pudo borrar el chat.');
    }
  };

  const elegirArchivos = async (lista) => {
    const archivos = Array.from(lista || []);
    if (!archivos.length) return;
    const admitidos = [];
    const rechazados = [];
    for (const file of archivos) {
      if (file.size > TOPE_ADJUNTO_BYTES) {
        rechazados.push(file.name);
        continue;
      }
      try {
        const base64 = await leerBase64(file);
        admitidos.push({ nombre: file.name, tipo: file.type, base64 });
      } catch (err) {
        console.error('[chat] no se pudo leer el adjunto', file.name, err);
        rechazados.push(file.name);
      }
    }
    if (admitidos.length) setAdjuntos(prev => [...prev, ...admitidos]);
    if (rechazados.length) {
      const topeMB = Math.round(TOPE_ADJUNTO_BYTES / (1024 * 1024));
      setError(`No se pudo adjuntar: ${rechazados.join(', ')} (máximo ${topeMB} MB por archivo).`);
    }
  };

  const quitarAdjunto = (indice) => {
    setAdjuntos(prev => prev.filter((_, i) => i !== indice));
  };

  const enviar = async () => {
    const textoLimpio = texto.trim();
    if (!textoLimpio || enviando) return;
    setEnviando(true);
    setError('');

    const mensajeUsuario = {
      rol: 'user',
      texto: textoLimpio,
      adjuntos: adjuntos.map(a => ({ nombre: a.nombre, tipo: a.tipo })),
    };
    const historialPrevio = mensajes;
    setMensajes(prev => [...prev, mensajeUsuario]);
    setTexto('');
    const adjuntosDeEsteEnvio = adjuntos;
    setAdjuntos([]);

    try {
      let chatId = hiloActivoId;
      if (!chatId) {
        chatId = await crearChat(usuario, estudioId);
        setHiloActivoId(chatId);
      }

      const peticion = construirPeticionGemini({
        study, estudioId, historialHilo: historialPrevio,
        mensajeNuevo: textoLimpio, adjuntos: adjuntosDeEsteEnvio,
      });
      const respuesta = await enviarMensajeChat(peticion);
      const mensajeModelo = { rol: 'model', texto: respuesta };
      setMensajes(prev => [...prev, mensajeModelo]);

      /* `docChat` (firestoreModelo.js) descarta el base64 de los adjuntos al guardar:
         solo queda nombre y tipo en el hilo persistido. */
      await agregarMensajesChat(usuario, estudioId, chatId, [mensajeUsuario, mensajeModelo]);
      const listaActualizada = await listarChats(usuario, estudioId);
      setHilos(listaActualizada);
    } catch (err) {
      console.error('[chat] no se pudo completar el turno', err);
      setError(
        (err && err.response && err.response.data && err.response.data.error)
        || (err && err.message)
        || 'No se pudo contactar al asistente. Intente de nuevo.'
      );
    } finally {
      setEnviando(false);
    }
  };

  const alPresionarTecla = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  };

  return (
    // Mismo tamaño que el `fallback` de `ChatFlotante.jsx` (ver el comentario de
    // `TAMANO_VENTANA` ahí): responsivo, con un máximo que crece con el viewport.
    <div className="w-[calc(100vw-2rem)] max-w-[26rem] sm:max-w-[30rem] lg:max-w-[34rem] h-[calc(100vh-8rem)] max-h-[30rem] sm:max-h-[36rem] lg:max-h-[42rem] rounded-xl bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40">
        <div className="relative flex-1 min-w-0 flex items-center gap-1">
          {editandoTitulo ? (
            <>
              <input
                ref={inputTituloRef}
                value={tituloEnEdicion}
                onChange={(e) => setTituloEnEdicion(e.target.value)}
                onKeyDown={alPresionarTeclaEnTitulo}
                onBlur={cancelarEdicionTitulo}
                maxLength={60}
                className="flex-1 min-w-0 text-sm font-medium bg-transparent border-b border-[#0FA3A1] focus:outline-none text-zinc-800 dark:text-zinc-100"
              />
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={guardarTitulo} className="p-1 text-[#0FA3A1] flex-shrink-0" title="Guardar título">
                <Check className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setMostrarHilos(v => !v)}
                className="flex items-center gap-1 text-sm font-medium text-zinc-800 dark:text-zinc-100 truncate min-w-0 hover:text-[#0FA3A1]"
                title="Ver chats anteriores de este estudio"
              >
                <span className="truncate">{tituloHiloActivo}</span>
                <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
              </button>
              {hiloActivoId && (
                <button
                  type="button"
                  onClick={iniciarEdicionTitulo}
                  className="p-1 text-zinc-400 hover:text-[#0FA3A1] flex-shrink-0"
                  title="Renombrar chat"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
          {mostrarHilos && !editandoTitulo && (
            <div className="absolute top-7 left-0 w-[min(18rem,90%)] max-h-64 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] shadow-xl z-10">
              <button
                type="button"
                onClick={empezarHiloNuevo}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#0FA3A1] hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-800"
              >
                <Plus className="w-3.5 h-3.5" /> Nuevo chat
              </button>
              {hilos.length === 0 && (
                <p className="px-3 py-2 text-xs text-zinc-400">Todavía no hay chats en este estudio.</p>
              )}
              {hilos.map(hilo => (
                <div key={hilo.id} className="flex items-center group">
                  {hiloAConfirmarBorrado === hilo.id ? (
                    <div className="flex-1 flex items-center justify-between px-3 py-2 text-xs">
                      <span className="text-zinc-500">¿Borrar este chat?</span>
                      <span className="flex items-center gap-2 flex-shrink-0">
                        <button type="button" onClick={() => eliminarHilo(hilo.id)} className="text-red-600 hover:text-red-700 font-medium">Sí</button>
                        <button type="button" onClick={() => setHiloAConfirmarBorrado(null)} className="text-zinc-400 hover:text-zinc-600">No</button>
                      </span>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => abrirHilo(hilo)}
                        className={`flex-1 min-w-0 text-left px-3 py-2 text-xs truncate hover:bg-zinc-50 dark:hover:bg-zinc-800 ${hilo.id === hiloActivoId ? 'bg-[#0FA3A1]/10 text-[#0FA3A1]' : 'text-zinc-600 dark:text-zinc-300'}`}
                      >
                        {hilo.titulo || TITULO_NUEVO_CHAT}
                      </button>
                      <button
                        type="button"
                        onClick={() => setHiloAConfirmarBorrado(hilo.id)}
                        className="p-2 text-zinc-300 hover:text-red-500 flex-shrink-0"
                        title="Borrar chat"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={onCerrar} className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {cargando && <p className="text-xs text-zinc-400 text-center">Cargando…</p>}
        {!cargando && mensajes.length === 0 && (
          <p className="text-xs text-zinc-400 text-center mt-8">
            Pregúntale al asistente sobre precios de transferencia o contabilidad de este estudio.
          </p>
        )}
        {mensajes.map((m, i) => (
          <div key={i} className={`flex ${m.rol === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words ${
                m.rol === 'user'
                  ? 'bg-[#0FA3A1] text-white rounded-br-sm'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 rounded-bl-sm'
              }`}
            >
              <MensajeMarkdown texto={m.texto} />
              {Array.isArray(m.adjuntos) && m.adjuntos.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.adjuntos.map((a, j) => (
                    <span key={j} className="text-[10px] opacity-80 bg-black/10 rounded px-1.5 py-0.5">
                      {a.nombre}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {enviando && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-500 px-3 py-2 text-xs flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> escribiendo…
            </div>
          </div>
        )}
        <div ref={finRef} />
      </div>

      {error && (
        <div className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 flex items-start gap-1.5 border-t border-red-100 dark:border-red-900/40">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {adjuntos.length > 0 && (
        <div className="px-3 pt-2 flex flex-wrap gap-1.5 border-t border-zinc-100 dark:border-zinc-800">
          {adjuntos.map((a, i) => (
            <span key={i} className="flex items-center gap-1 text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-full pl-2 pr-1 py-0.5">
              {a.nombre}
              <button type="button" onClick={() => quitarAdjunto(i)} className="hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex items-end gap-1.5 p-2 border-t border-zinc-200 dark:border-zinc-800">
        <input
          ref={inputArchivoRef}
          type="file"
          multiple
          accept="application/pdf,image/*,.doc,.docx"
          className="hidden"
          onChange={(e) => { elegirArchivos(e.target.files); e.target.value = ''; }}
        />
        <button
          type="button"
          onClick={() => inputArchivoRef.current?.click()}
          className="p-2 text-zinc-400 hover:text-[#0FA3A1] flex-shrink-0"
          title="Adjuntar documento"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={alPresionarTecla}
          placeholder="Escriba su pregunta…"
          rows={1}
          className="flex-1 resize-none rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#0FA3A1] max-h-24"
        />
        <button
          type="button"
          onClick={enviar}
          disabled={enviando || !texto.trim()}
          className="p-2 rounded-lg bg-[#0FA3A1] text-white disabled:opacity-40 flex-shrink-0"
          title="Enviar"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
