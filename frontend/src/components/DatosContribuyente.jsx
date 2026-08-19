import React, { useState } from 'react';
import { Upload, FileText, CheckCircle, AlertTriangle, Loader2, Users, FileCheck } from 'lucide-react';
import axios from 'axios';
import { parseAccionistasWithGeminiOCR } from '../services/accionistasParser';
import { resolverComposicionAccionaria } from '../services/tablasContribuyente';
import { fmt } from '../utils/calculations';

export default function DatosContribuyente({ study, updateStudy }) {
  const [loadingRut, setLoadingRut] = useState(false);
  const [loadingCamara, setLoadingCamara] = useState(false);
  const [loadingAccionistas, setLoadingAccionistas] = useState(false);
  const [extractionMsg, setExtractionMsg] = useState('');
  const [accionistasMsg, setAccionistasMsg] = useState('');

  /* El certificado cargado en este estudio tiene prioridad; sin él, se hereda la
     composición accionaria del informe del año anterior (ver resolverComposicionAccionaria). */
  const { accionistas: accionistasEfectivos } = resolverComposicionAccionaria(study);

  const handleFieldChange = (key, value) => {
    updateStudy({ [key]: value });
  };

  const processFile = (file, apiEndpoint, loadingSetter) => {
    loadingSetter(true);
    setExtractionMsg('Analizando documento con Inteligencia Artificial...');

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const base64Data = reader.result.split(',')[1];
        const response = await axios.post(apiEndpoint, {
          archivo_base64: base64Data,
          tipo: file.type
        });

        const data = response.data;
        if (data) {
          const updates = {};
          if (apiEndpoint.includes('rut')) {
            if (data.razon_social) updates.ent = data.razon_social;
            if (data.nit) updates.nit = data.nit;
            if (data.ciiu) updates.ciiu = data.ciiu;
            if (data.direccion) updates.direccion = data.direccion;
            if (data.representante_legal) updates.representante = data.representante_legal;
            setExtractionMsg('✅ RUT extraído con éxito.');
          } else {
            if (data.razon_social) updates.ent = data.razon_social;
            if (data.nit) updates.nit = data.nit;
            if (data.objeto_social) updates.objeto = data.objeto_social;
            if (data.representante_legal) updates.representante = data.representante_legal;
            setExtractionMsg('✅ Cámara de Comercio extraída con éxito.');
          }
          updateStudy(updates);
        }
      } catch (err) {
        console.error("Error extracting document:", err);
        setExtractionMsg('⚠ Error al procesar el archivo. Por favor ingrese los datos manualmente.');
      } finally {
        loadingSetter(false);
      }
    };
  };

  // Carga de Certificado de Composición Accionaria con Gemini OCR
  const handleAccionistasUpload = async (file) => {
    if (!file) return;
    setLoadingAccionistas(true);
    setAccionistasMsg('🤖 Leyendo Certificado de Composición Accionaria con Gemini Vision OCR…');

    try {
      const data = await parseAccionistasWithGeminiOCR(file);
      if (data && data.accionistas && data.accionistas.length > 0) {
        updateStudy({
          accionistas: data.accionistas,
          capital_pagado: data.capital_pagado,
          total_acciones: data.total_acciones
        });
        setAccionistasMsg(`✅ ${data.accionistas.length} accionista(s) extraído(s) con éxito.`);
      }
    } catch (err) {
      console.error("Error al extraer composición accionaria:", err);
      setAccionistasMsg('⚠ No se pudo procesar el certificado con OCR.');
    } finally {
      setLoadingAccionistas(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Columna Izquierda: Formulario Contribuyente */}
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2">
            Datos del Contribuyente Principal
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Razón Social</label>
              <input
                type="text"
                value={study.ent || ''}
                onChange={(e) => handleFieldChange('ent', e.target.value)}
                placeholder="Razón Social Completa"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">NIT (con dígito de verificación)</label>
              <input
                type="text"
                value={study.nit || ''}
                onChange={(e) => handleFieldChange('nit', e.target.value)}
                placeholder="Ej: 900.123.456-7"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Año Gravable</label>
              <input
                type="number"
                value={study.anio || ''}
                onChange={(e) => handleFieldChange('anio', e.target.value)}
                placeholder="Ej: 2025"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Actividad Económica (CIIU)</label>
              <input
                type="text"
                value={study.ciiu || ''}
                onChange={(e) => handleFieldChange('ciiu', e.target.value)}
                placeholder="Código CIIU"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>
          </div>

          <div className="flex flex-col">
            <label className="text-xs font-semibold text-zinc-500 mb-1.5">Representante Legal</label>
            <input
              type="text"
              value={study.representante || ''}
              onChange={(e) => handleFieldChange('representante', e.target.value)}
              placeholder="Nombre del Representante Legal"
              className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-xs font-semibold text-zinc-500 mb-1.5">Objeto Social / Actividad de la Compañía</label>
            <textarea
              rows={3}
              value={study.objeto || ''}
              onChange={(e) => handleFieldChange('objeto', e.target.value)}
              placeholder="Describa el objeto social principal de la empresa..."
              className="w-full bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
            />
          </div>
        </div>

        {/* Tabla de Composición Accionaria Extraída */}
        {accionistasEfectivos.length > 0 && (
          <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
            <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2 flex items-center gap-2">
              <Users className="w-5 h-5 text-[#0FA3A1]" />
              Tabla 6. Composición Accionaria Extraída
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-zinc-50 dark:bg-zinc-900/50 text-zinc-500 uppercase font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Accionista</th>
                    <th className="py-2.5 px-3">País</th>
                    <th className="py-2.5 px-3 text-right">N° Acciones</th>
                    <th className="py-2.5 px-3 text-right">Valor Capital</th>
                    <th className="py-2.5 px-3 text-right">% Participación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-mono">
                  {accionistasEfectivos.map((acc, idx) => (
                    <tr key={idx} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30">
                      <td className="py-2.5 px-3 font-semibold text-zinc-900 dark:text-zinc-100 font-sans">{acc.nombre}</td>
                      {/* Hueco visible, no un país por defecto: «ESTADOS UNIDOS» era el
                          del accionista del informe de referencia, y verlo en la tabla
                          hacía pasar por dato la falta de dato. */}
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 font-sans">{acc.pais || '—'}</td>
                      <td className="py-2.5 px-3 text-right text-zinc-900 dark:text-zinc-100">{acc.acciones ? fmt(acc.acciones) : '200.000'}</td>
                      <td className="py-2.5 px-3 text-right text-zinc-900 dark:text-zinc-100">$ {acc.valor_capital ? fmt(acc.valor_capital) : '200.000.000'}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-[#0FA3A1]">{acc.participacion_pct || 100}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Datos Vinculado */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2">
            Datos de la Parte Vinculada (Sujeta a Estudio)
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Nombre del Vinculado</label>
              <input
                type="text"
                value={study.vinc || ''}
                onChange={(e) => handleFieldChange('vinc', e.target.value)}
                placeholder="Razón Social Vinculado"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">País del Vinculado</label>
              <input
                type="text"
                value={study.pais_vinc || ''}
                onChange={(e) => handleFieldChange('pais_vinc', e.target.value)}
                placeholder="Ej: ESTADOS UNIDOS"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Identificación Fiscal Vinculada</label>
              <input
                type="text"
                value={study.vinc_id || ''}
                onChange={(e) => handleFieldChange('vinc_id', e.target.value)}
                placeholder="Ej: Tax ID / RIF"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Criterio de Vinculación</label>
              <select
                value={study.tipo_vinculacion || ''}
                onChange={(e) => handleFieldChange('tipo_vinculacion', e.target.value)}
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              >
                <option value="">Seleccione un tipo</option>
                <option value="Art 260-1 E-T Inciso 1">Subordinación (Filial/Subsidiaria)</option>
                <option value="Art 260-1 E-T Inciso 2">Control Común (Matrices/Consorcios)</option>
                <option value="Jurisdicciones no cooperantes">Jurisdicción No Cooperante / Paraíso Fiscal</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Columna Derecha: Carga de Archivos e IA */}
      <div className="space-y-6">
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2">
            Ingesta Inteligente de Documentos (OCR)
          </h3>
          <p className="text-xs text-zinc-500">Suba el RUT, Cámara de Comercio o Certificado de Composición Accionaria para extraer la información con Gemini Vision.</p>



          {/* Carga de RUT */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Cargar RUT (PDF/Imagen)</span>
            <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex flex-col items-center justify-center text-center hover:border-[#0FA3A1] transition-colors relative cursor-pointer">
              <input
                type="file"
                accept="application/pdf,image/*"
                disabled={loadingRut}
                onChange={(e) => {
                  if (e.target.files[0]) {
                    processFile(e.target.files[0], '/api/extraer-rut', setLoadingRut);
                  }
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              {loadingRut ? (
                <Loader2 className="w-8 h-8 text-[#0FA3A1] animate-spin" />
              ) : (
                <Upload className="w-8 h-8 text-zinc-400 mb-2" />
              )}
              <span className="text-xs text-zinc-500 font-medium">Arrastre o seleccione un archivo</span>
            </div>
          </div>

          {/* Carga de Cámara de Comercio */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Cargar Cámara de Comercio (PDF/Imagen)</span>
            <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex flex-col items-center justify-center text-center hover:border-[#0FA3A1] transition-colors relative cursor-pointer">
              <input
                type="file"
                accept="application/pdf,image/*"
                disabled={loadingCamara}
                onChange={(e) => {
                  if (e.target.files[0]) {
                    processFile(e.target.files[0], '/api/extraer-camara', setLoadingCamara);
                  }
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              {loadingCamara ? (
                <Loader2 className="w-8 h-8 text-[#0FA3A1] animate-spin" />
              ) : (
                <Upload className="w-8 h-8 text-zinc-400 mb-2" />
              )}
              <span className="text-xs text-zinc-500 font-medium">Arrastre o seleccione un archivo</span>
            </div>
          </div>

          {/* Cargar Composición Accionaria */}
          <div className="space-y-2 pt-2 border-b border-zinc-100 dark:border-zinc-800 pb-4">
            <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-[#0FA3A1]" />
              Certificado Composición Accionaria (PDF/Imagen)
            </span>
            <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex flex-col items-center justify-center text-center hover:border-[#0FA3A1] transition-colors relative cursor-pointer bg-zinc-50/50 dark:bg-zinc-900/30">
              <input
                type="file"
                accept="application/pdf,image/*"
                disabled={loadingAccionistas}
                onChange={(e) => {
                  if (e.target.files[0]) {
                    handleAccionistasUpload(e.target.files[0]);
                  }
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              {loadingAccionistas ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <Loader2 className="w-6 h-6 text-[#0FA3A1] animate-spin" />
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Leyendo composición accionaria...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1 py-1">
                  <Upload className="w-6 h-6 text-zinc-400 mb-1" />
                  <span className="text-xs text-zinc-700 dark:text-zinc-300 font-semibold">Cargar Certificado de Accionistas</span>
                  <span className="text-[11px] text-zinc-400">PDFs escaneados o imágenes</span>
                </div>
              )}
            </div>
            {accionistasMsg && (
              <div className="text-[11px] font-medium text-[#0FA3A1] bg-[#0FA3A1]/10 p-2 rounded-lg flex items-center gap-1.5">
                <FileCheck className="w-3.5 h-3.5" />
                {accionistasMsg}
              </div>
            )}
          </div>

          {/* Mensajes de Estado del Procesamiento */}
          {extractionMsg && (
            <div className={`p-3 rounded-lg text-xs flex gap-2 items-center ${extractionMsg.includes('✅')
              ? 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 text-emerald-800 dark:text-emerald-300'
              : extractionMsg.includes('⚠')
                ? 'bg-rose-50 dark:bg-rose-950/20 border border-rose-200 text-rose-800 dark:text-rose-300'
                : 'bg-blue-50 dark:bg-blue-950/20 border border-blue-200 text-blue-800 dark:text-blue-300'
              }`}>
              {extractionMsg.includes('✅') ? (
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              ) : extractionMsg.includes('⚠') ? (
                <AlertTriangle className="w-4 h-4 text-rose-500" />
              ) : (
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
              )}
              <span>{extractionMsg}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
