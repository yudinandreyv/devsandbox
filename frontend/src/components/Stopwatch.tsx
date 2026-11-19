import React from 'react';
import { RotateCcw, Timer } from 'lucide-react';
import { useTelemetry } from '../context/TelemetryContext';
import { useI18n } from '../context/I18nContext';

export const Stopwatch: React.FC = () => {
  const { elapsedSeconds, resetSessionTimer } = useTelemetry();
  const { t } = useI18n();

  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');

    if (hours > 0) {
      return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
  };

  return (
    <button
      type="button"
      onClick={resetSessionTimer}
      className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-xs font-mono font-medium text-slate-700 dark:text-slate-300 hover:border-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      title={t.stopwatch.resetTimer}
      aria-label={t.stopwatch.resetTimer}
    >
      <Timer aria-hidden="true" className="w-3.5 h-3.5 text-brand-500 animate-pulse" />
      <span>{formatTime(elapsedSeconds)}</span>
      <RotateCcw aria-hidden="true" className="w-3 h-3 text-slate-400" />
    </button>
  );
};
