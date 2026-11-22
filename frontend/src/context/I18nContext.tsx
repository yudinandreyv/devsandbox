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

const LOCALE_STORAGE_KEY = 'dev_sandbox_locale';

// Legacy URLs may still carry a /ru or /en prefix. Strip it so the address
// bar stays clean while the locale is remembered separately.
const splitLocalePrefix = (pathname: string): { locale: SupportedLocale | null; path: string } => {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === 'ru' || segments[0] === 'en') {
    const path = '/' + segments.slice(1).join('/');
    return { locale: segments[0] as SupportedLocale, path: path === '/' ? '' : path };
  }
  return { locale: null, path: pathname === '/' ? '' : pathname };
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const getInitialState = (): { locale: SupportedLocale; path: string } => {
    const { locale: pathLocale, path } = splitLocalePrefix(window.location.pathname);

    if (pathLocale) {
      return { locale: pathLocale, path };
    }

    let detectedLocale: SupportedLocale = 'en';
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'ru' || saved === 'en') {
      detectedLocale = saved;
    } else if (navigator.language.startsWith('ru')) {
      detectedLocale = 'ru';
    }
    return { locale: detectedLocale, path };
  };

  const [state, setState] = useState(getInitialState);

  useEffect(() => {
    // Ensure document lang attribute is set
    document.documentElement.lang = state.locale;
    localStorage.setItem(LOCALE_STORAGE_KEY, state.locale);

    // Keep the URL locale-free (also cleans legacy /ru and /en prefixes).
    const targetUrl = state.path || '/';
    if (window.location.pathname !== targetUrl) {
      window.history.replaceState({}, '', targetUrl);
    }
  }, [state.locale, state.path]);

  useEffect(() => {
    const handlePopState = () => {
      const { locale: pathLocale, path } = splitLocalePrefix(window.location.pathname);
      setState((prev) => ({ locale: pathLocale ?? prev.locale, path }));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const switchLocale = (newLocale: SupportedLocale) => {
    setState((prev) => ({ ...prev, locale: newLocale }));
  };

  const navigate = (path: string) => {
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    const nextPath = cleanPath === '/' ? '' : cleanPath;
    setState((prev) => ({ ...prev, path: nextPath }));
    window.history.pushState({}, '', nextPath || '/');
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
