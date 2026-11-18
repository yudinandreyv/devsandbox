import React, { createContext, useContext, useState, useEffect } from 'react';
import { en } from '../locales/en';
import { ru } from '../locales/ru';
import { SupportedLocale } from '../types/telemetry';

interface I18nContextType {
  locale: SupportedLocale;
  t: typeof en;
  switchLocale: (newLocale: SupportedLocale) => void;
  currentPath: string;
  navigate: (path: string) => void;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Determine locale from URL path e.g. /ru/about or default to 'en'
  const getInitialState = (): { locale: SupportedLocale; path: string } => {
    const pathname = window.location.pathname;
    const segments = pathname.split('/').filter(Boolean);
    let detectedLocale: SupportedLocale = 'en';
    let subpath = '';

    if (segments[0] === 'ru' || segments[0] === 'en') {
      detectedLocale = segments[0] as SupportedLocale;
      subpath = '/' + segments.slice(1).join('/');
    } else {
      // Check saved preference or browser language
      const saved = localStorage.getItem('dev_sandbox_locale');
      if (saved === 'ru' || saved === 'en') {
        detectedLocale = saved;
      } else if (navigator.language.startsWith('ru')) {
        detectedLocale = 'ru';
      }
      subpath = pathname === '/' ? '' : pathname;
    }
    return { locale: detectedLocale, path: subpath };
  };

  const [state, setState] = useState(getInitialState);

  useEffect(() => {
    // Ensure document lang attribute is set
    document.documentElement.lang = state.locale;
    localStorage.setItem('dev_sandbox_locale', state.locale);

    // Sync window history URL if necessary
    const targetUrl = `/${state.locale}${state.path === '/' ? '' : state.path}`;
    if (window.location.pathname !== targetUrl) {
      window.history.replaceState({}, '', targetUrl);
    }
  }, [state.locale, state.path]);

  const switchLocale = (newLocale: SupportedLocale) => {
    setState((prev) => ({ ...prev, locale: newLocale }));
  };

  const navigate = (path: string) => {
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    setState((prev) => ({ ...prev, path: cleanPath === '/' ? '' : cleanPath }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const t = state.locale === 'ru' ? ru : en;

  return (
    <I18nContext.Provider
      value={{
        locale: state.locale,
        t,
        switchLocale,
        currentPath: state.path || '/',
        navigate,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
};
