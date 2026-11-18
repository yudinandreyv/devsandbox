import React from 'react';
import { Terminal, Shield, Github } from 'lucide-react';
import { useI18n } from '../context/I18nContext';

export const Footer: React.FC = () => {
  const { t, navigate } = useI18n();

  return (
    <footer className="w-full mt-20 border-t border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-950/50 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Col 1: Platform & Mission */}
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 rounded-md bg-brand-600 flex items-center justify-center text-white">
                <Terminal className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-base text-slate-900 dark:text-white">
                {t.brand}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">
              {t.footer.desc}
            </p>
            <div className="flex items-center gap-2 pt-2 text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
              <Shield className="w-3.5 h-3.5" />
              <span>Kubernetes Isolation: namespace sandbox (ResourceQuota active)</span>
            </div>
          </div>

          {/* Col 2: Navigation Links */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-200">
              {t.footer.links}
            </h4>
            <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
              <li>
                <button
                  onClick={() => navigate('/')}
                  className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                >
                  {t.nav.labs}
                </button>
              </li>
              <li>
                <button
                  onClick={() => navigate('/about')}
                  className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                >
                  {t.footer.about}
                </button>
              </li>
              <li>
                <button
                  onClick={() => navigate('/contact')}
                  className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                >
                  {t.footer.contact}
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Legal & Privacy */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-200">
              {t.footer.legal}
            </h4>
            <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
              <li>
                <button
                  onClick={() => navigate('/privacy-policy')}
                  className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                >
                  {t.footer.privacy}
                </button>
              </li>
              <li>
                <button
                  onClick={() => navigate('/terms-of-service')}
                  className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                >
                  {t.footer.terms}
                </button>
              </li>
              <li>
                <a
                  href="https://github.com/yudinandrey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                >
                  <Github className="w-3.5 h-3.5" />
                  <span>GitHub Repository</span>
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800/80 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-slate-500 dark:text-slate-500">
          <div>
            © {new Date().getFullYear()} {t.brand}. {t.footer.allRightsReserved}
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px]">
            <span>FastAPI 0.119</span>
            <span>•</span>
            <span>React 18 + TS</span>
            <span>•</span>
            <span>CLS: 0.000</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
