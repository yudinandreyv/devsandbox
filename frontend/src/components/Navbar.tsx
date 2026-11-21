import React, { useState } from 'react';
import { Terminal, Moon, Sun, ShieldCheck } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../context/I18nContext';
import { Stopwatch } from './Stopwatch';
import { TelemetryBadge } from './TelemetryBadge';
import { AuthModal } from './AuthModal';

export const Navbar: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { locale, switchLocale, t, navigate, currentPath } = useI18n();
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 w-full backdrop-blur-md bg-white/80 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800/80 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Left: Branding */}
          <div className="flex items-center space-x-3">
            <button
              onClick={() => navigate('/')}
              className="flex items-center space-x-2.5 text-left group"
            >
              <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-brand-600 to-sky-400 flex items-center justify-center text-white shadow-md shadow-brand-500/20 group-hover:scale-105 transition-transform">
                <Terminal className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-1.5">
                  <span className="font-extrabold text-sm sm:text-base tracking-tight text-slate-900 dark:text-white">
                    {t.brand}
                  </span>
                  <span className="hidden sm:inline px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-800">
                    LAB
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono hidden sm:block">
                  sandbox.gateaway.cloud
                </p>
              </div>
            </button>
          </div>

          {/* Center: Live Session Stopwatch & LocalStorage Telemetry */}
          <div className="hidden md:flex items-center space-x-3">
            <Stopwatch />
            <TelemetryBadge />
          </div>

          {/* Right: Actions, Language, Theme, Guest Auth */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            {/* Nav Links */}
            <nav className="hidden lg:flex items-center space-x-1 mr-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              <button
                onClick={() => navigate('/')}
                className={`px-2.5 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
                  currentPath === '/' ? 'text-brand-600 dark:text-brand-400 font-semibold' : ''
                }`}
              >
                {t.nav.labs}
              </button>
              <button
                onClick={() => navigate('/about')}
                className={`px-2.5 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
                  currentPath === '/about' ? 'text-brand-600 dark:text-brand-400 font-semibold' : ''
                }`}
              >
                {t.nav.about}
              </button>
              <button
                onClick={() => navigate('/contact')}
                className={`px-2.5 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
                  currentPath === '/contact' ? 'text-brand-600 dark:text-brand-400 font-semibold' : ''
                }`}
              >
                {t.nav.contact}
              </button>
            </nav>

            {/* Language Switcher */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-md border border-slate-200 dark:border-slate-700/60 text-xs font-medium">
              <button
                onClick={() => switchLocale('en')}
                className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                  locale === 'en'
                    ? 'bg-white dark:bg-slate-700 text-brand-600 dark:text-sky-300 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                EN
              </button>
              <button
                onClick={() => switchLocale('ru')}
                className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                  locale === 'ru'
                    ? 'bg-white dark:bg-slate-700 text-brand-600 dark:text-sky-300 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                RU
              </button>
            </div>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center backdrop-blur-md bg-slate-200/70 dark:bg-slate-800/70 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300/60 dark:border-slate-700/60 text-slate-700 dark:text-amber-300 transition-all duration-300 shadow-sm hover:scale-105 active:scale-95 cursor-pointer"
              title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              aria-label="Toggle Theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 transition-transform duration-300 rotate-0 hover:rotate-45" /> : <Moon className="w-4 h-4 transition-transform duration-300 -rotate-12 hover:rotate-0" />}
            </button>

            {/* Guest Session Button / Auth Stub */}
            <button
              onClick={() => setIsAuthOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white text-xs font-medium transition-all shadow-xs"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-600" />
              <span className="hidden sm:inline">{t.nav.guestBadge}</span>
              <span className="sm:hidden">{t.nav.signIn}</span>
            </button>
          </div>
        </div>

        {/* Mobile Sub-bar for Stopwatch & Telemetry */}
        <div className="flex md:hidden items-center justify-between px-4 py-1.5 border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/50 text-xs">
          <Stopwatch />
          <TelemetryBadge />
        </div>
      </header>

      {/* Auth / Guest Modal */}
      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />
    </>
  );
};
