import React, { useEffect, useRef, useState } from 'react';
import { UserCheck, X } from 'lucide-react';
import { useI18n } from '../context/I18nContext';

export interface AuthSession {
  username: string;
  accessToken: string;
  refreshToken: string;
}

export const AUTH_STORAGE_KEY = 'dev_sandbox_auth';

export const readAuthSession = (): AuthSession | null => {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.username && parsed.accessToken && parsed.refreshToken) return parsed;
  } catch {
    return null;
  }
  return null;
};

export const clearAuthSession = () => {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
};

type AuthMode = 'login' | 'register';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: AuthSession | null;
  onAuthenticated: (session: AuthSession) => void;
  onSignedOut: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  session,
  onAuthenticated,
  onSignedOut,
}) => {
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const tabs: AuthMode[] = ['login', 'register'];

  useEffect(() => {
    if (!isOpen) return;
    setMode('login');
    setError('');
    setNotice('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="dialog"] button:not([disabled]), [role="dialog"] [href], [role="dialog"] input:not([disabled]), [role="dialog"] select:not([disabled]), [role="dialog"] textarea:not([disabled])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError('');
    setNotice('');
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = tabs.indexOf(mode);
    const nextIndex =
      event.key === 'ArrowRight'
        ? (currentIndex + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : tabs.length - 1;
    const nextMode = tabs[nextIndex];
    switchMode(nextMode);
    requestAnimationFrame(() => document.getElementById(`auth-tab-${nextMode}`)?.focus());
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password }),
      });
      if (!response.ok) throw new Error('login failed');
      const data = await response.json();
      const nextSession: AuthSession = {
        username,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
      };
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession));
      onAuthenticated(nextSession);
      setPassword('');
      onClose();
    } catch {
      setError(t.authModal.signInError);
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });
      if (!response.ok) throw new Error('register failed');
      setPassword('');
      setNotice(t.authModal.registerSuccess);
      setMode('login');
    } catch {
      setError(t.authModal.registerError);
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = () => {
    clearAuthSession();
    onSignedOut();
    setNotice(t.authModal.signedOut);
    setMode('login');
  };

  const tabLabels: Record<AuthMode, string> = {
    login: t.authModal.signIn,
    register: t.authModal.register,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" className="relative w-full max-w-md p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl">
        <button
          ref={closeButtonRef}
          onClick={onClose}
          type="button"
          className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
          aria-label={t.authModal.closeBtn}
        >
          <X aria-hidden="true" className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-5">
          <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-lg">
            <UserCheck aria-hidden="true" className="w-6 h-6" />
          </div>
          <h2 id="auth-modal-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {t.authModal.title}
          </h2>
        </div>

        {notice && <p role="status" className="mb-4 text-xs font-medium text-emerald-600 dark:text-emerald-400">{notice}</p>}
        {error && <p role="alert" className="mb-4 text-xs font-medium text-red-500">{error}</p>}

        {session ? (
          <div className="mb-5 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200 mb-3">
              {t.authModal.signedInAs} <span className="font-mono text-brand-600 dark:text-sky-300">{session.username}</span>
            </p>
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full py-2 px-4 text-xs font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
            >
              {t.authModal.signOut}
            </button>
          </div>
        ) : (
          <>
            <div role="tablist" aria-label={t.authModal.tabsLabel} className="flex gap-1 p-1 mb-5 rounded-lg bg-slate-100 dark:bg-slate-800">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  id={`auth-tab-${tab}`}
                  aria-controls="auth-panel"
                  aria-selected={mode === tab}
                  tabIndex={mode === tab ? 0 : -1}
                  onClick={() => switchMode(tab)}
                  onKeyDown={handleTabKeyDown}
                  className={`flex-1 px-3 py-2 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                    mode === tab
                      ? 'bg-white dark:bg-slate-700 text-brand-600 dark:text-sky-300 shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tabLabels[tab]}
                </button>
              ))}
            </div>

            <div role="tabpanel" id="auth-panel" aria-labelledby={`auth-tab-${mode}`} tabIndex={0} className="focus:outline-none">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-4">
                {mode === 'login' ? t.authModal.loginTitle : t.authModal.registerTitle}
              </h3>
              <form id="auth-form" onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-4">
                <div>
                  <label htmlFor="auth-username" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t.authModal.username}
                  </label>
                  <input
                    id="auth-username"
                    type="text"
                    required
                    minLength={3}
                    maxLength={50}
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-brand-500 focus:outline-none"
                  />
                </div>

                {mode === 'register' && (
                  <div>
                    <label htmlFor="auth-email" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {t.authModal.email}
                    </label>
                    <input
                      id="auth-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-brand-500 focus:outline-none"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="auth-password" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t.authModal.password}
                  </label>
                  <input
                    id="auth-password"
                    type="password"
                    required
                    minLength={6}
                    maxLength={72}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-brand-500 focus:outline-none"
                  />
                </div>
              </form>
            </div>

            <button
              type="submit"
              form="auth-form"
              disabled={busy}
              className="w-full mt-5 py-2.5 px-4 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white font-semibold text-sm rounded-lg transition-colors cursor-pointer"
            >
              {mode === 'login' ? t.authModal.signInSubmit : t.authModal.registerSubmit}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full mt-5 py-2 px-4 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
        >
          {t.authModal.closeBtn}
        </button>
      </div>
    </div>
  );
};
