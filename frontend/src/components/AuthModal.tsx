import React, { useState } from 'react';
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

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(telemetry.guestSessionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" className="relative w-full max-w-md p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl">
        <button
          onClick={onClose}
          type="button"
          className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
          aria-label={t.authModal.closeBtn}
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-lg">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <h3 id="auth-modal-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t.authModal.title}
            </h3>
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-mono">
              <Shield className="w-3 h-3" /> Read-Only Sandbox Mode Active
            </span>
          </div>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-400 mb-5 leading-relaxed">
          {t.authModal.desc}
        </p>

        <div className="mb-5 p-3.5 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            {t.authModal.uuidLabel}
          </label>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono text-slate-800 dark:text-slate-200 truncate flex-1 select-all">
              {telemetry.guestSessionId}
            </code>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-brand-500 hover:bg-brand-600 text-white rounded font-medium transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? t.authModal.copied : t.authModal.copyBtn}</span>
            </button>
          </div>
        </div>

        <div className="mb-6 flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-300">
          <Lock className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t.authModal.authNote}</span>
        </div>

        <div className="flex justify-end">
          <button
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
