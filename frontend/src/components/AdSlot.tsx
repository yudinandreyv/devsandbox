import React from 'react';
import { Github, Sparkles, ExternalLink, Cpu, GitBranch } from 'lucide-react';
import { useI18n } from '../context/I18nContext';

interface AdSlotProps {
  type?: 'leaderboard' | 'card';
  variant?: 'github' | 'upcoming-sync' | 'upcoming-postgres';
  className?: string;
}

export const AdSlot: React.FC<AdSlotProps> = ({
  type = 'leaderboard',
  variant = 'github',
  className = '',
}) => {
  const { t, navigate } = useI18n();

  if (type === 'leaderboard') {
    return (
      <aside
        className={`w-full min-h-[100px] my-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-900/40 p-3 sm:p-4 flex flex-col sm:flex-row items-center justify-between gap-3 overflow-hidden transition-all ${className}`}
        aria-label="Platform Sponsor & Community Slot"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-brand-600 to-indigo-600 flex items-center justify-center text-white shrink-0 shadow-sm">
            <Github className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono tracking-wider uppercase text-slate-400 font-bold">
                {t.ads.sponsored}
              </span>
            </div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {t.ads.githubCardTitle}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
              {t.ads.githubCardDesc}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href="https://github.com/yudinandrey"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold shadow-xs transition-colors"
          >
            <span>{t.ads.githubBtn}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </aside>
    );
  }

  // Card / Rectangle Slot (min-h-[260px])
  return (
    <aside
      className={`w-full min-h-[260px] rounded-xl border border-dashed border-slate-300 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-900/40 p-5 flex flex-col justify-between overflow-hidden ${className}`}
      aria-label="Platform Promotion Slot"
    >
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-mono tracking-wider uppercase text-slate-400 font-bold">
            {t.ads.sponsored}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-brand-100 dark:bg-brand-950 text-brand-700 dark:text-brand-300 border border-brand-300 dark:border-brand-800">
            CLS: 0.000
          </span>
        </div>

        {variant === 'upcoming-sync' ? (
          <div>
            <div className="w-9 h-9 rounded-lg bg-sky-500/10 text-sky-500 flex items-center justify-center mb-2.5">
              <Cpu className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">
              FastAPI: Sync vs Async Visualizer
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
              Launching in Week 2. Profile latency spikes, GIL locks, and thread pool starvation under real concurrency.
            </p>
          </div>
        ) : (
          <div>
            <div className="w-9 h-9 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center mb-2.5">
              <GitBranch className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">
              Zero-Downtime Blue/Green Tracer
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
              Inspect Kubernetes HTTPRoute weighted split and canary traffic shifting with zero dropped packets.
            </p>
          </div>
        )}
      </div>

      <div>
        <button
          onClick={() => navigate('/about')}
          className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-brand-500" />
          <span>{t.ads.learnMore}</span>
        </button>
      </div>
    </aside>
  );
};
