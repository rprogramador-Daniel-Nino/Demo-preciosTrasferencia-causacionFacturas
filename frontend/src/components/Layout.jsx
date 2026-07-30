import React, { useState, useEffect } from 'react';
import {
  Sun, Moon, LayoutDashboard, FileText, BarChart3, ShieldAlert, FileDown, Menu, X, BookOpen
} from 'lucide-react';

export default function Layout({ children, activeTab, setActiveTab }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    const root = window.document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  const menuItems = [
    { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
    { id: 'contribuyente', label: '1. Contribuyente', icon: FileText },
    { id: 'Operaciones', label: '2. Ingesta Cifras Operaciones', icon: BookOpen },
    { id: 'Estados financieros', label: '3. Ingesta Estados financieros', icon: BookOpen },
    { id: 'comparables', label: '4. Motor Comparables', icon: BarChart3 },
    { id: 'auditoria', label: '5. Auditoría Norma', icon: ShieldAlert },
    { id: 'informe', label: '6. Generador Word', icon: FileDown },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-50 flex transition-colors duration-200">
      {/* Sidebar */}
      <aside
        className={`${sidebarOpen ? 'w-64' : 'w-16'
          } bg-white dark:bg-[#0c0c0f] border-r border-zinc-200 dark:border-zinc-800 transition-all duration-300 flex flex-col z-20`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="p-2 bg-[#0FA3A1]/10 text-[#0FA3A1] rounded-lg">
              <BarChart3 className="w-5 h-5" />
            </div>
            {sidebarOpen && (
              <div className="flex flex-col">
                <span className="font-bold text-sm leading-tight text-zinc-950 dark:text-zinc-50">Precios de Trans.</span>
                <span className="text-[10px] text-zinc-500 font-mono">GESTOR V4.0</span>
              </div>
            )}
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 hidden md:block"
          >
            {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>

        {/* Menu Items */}
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive
                    ? 'bg-[#0FA3A1]/15 text-[#0FA3A1] dark:bg-[#0FA3A1]/10'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {sidebarOpen && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Footer info */}
        {sidebarOpen && (
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-400 font-mono">
            Conectado a Claude & Gemini
          </div>
        )}
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 md:hidden"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
              {menuItems.find(i => i.id === activeTab)?.label || 'Precios de Transferencia'}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 dark:text-zinc-400 transition-colors"
              title={darkMode ? "Modo Claro" : "Modo Oscuro"}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
