import React, { useEffect, useRef, useState } from 'react';
import { UserCheck, Copy, Check, X, Shield, Lock } from 'lucide-react';
import { useTelemetry } from '../context/TelemetryContext';
import { useI18n } from '../context/I18nContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { telemetry } = useTelemetry();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

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

  const handleCopy = () => {
    void navigator.clipboard.writeText(telemetry.guestSessionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-lg">
            <UserCheck aria-hidden="true" className="w-6 h-6" />
          </div>
          <div>
            <h2 id="auth-modal-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t.authModal.title}
            </h2>
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-mono">
              <Shield aria-hidden="true" className="w-3 h-3" /> Read-Only Sandbox Mode Active
            </span>
          </div>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-400 mb-5 leading-relaxed">
          {t.authModal.desc}
        </p>

        <div className="mb-5 p-3.5 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
          <span className="block text-xs font-medium text-slate-500 mb-1.5">
            {t.authModal.uuidLabel}
          </span>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono text-slate-800 dark:text-slate-200 truncate flex-1 select-all">
              {telemetry.guestSessionId}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-brand-500 hover:bg-brand-600 text-white rounded font-medium transition-colors"
            >
              {copied ? <Check aria-hidden="true" className="w-3.5 h-3.5" /> : <Copy aria-hidden="true" className="w-3.5 h-3.5" />}
              <span aria-live="polite">{copied ? t.authModal.copied : t.authModal.copyBtn}</span>
            </button>
          </div>
        </div>

        <div className="mb-6 flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-300">
          <Lock aria-hidden="true" className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t.authModal.authNote}</span>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 font-medium text-sm rounded-lg transition-colors"
          >
            {t.authModal.closeBtn}
          </button>
        </div>
      </div>
    </div>
  );
};
