import React from 'react';
import { Timer } from 'lucide-react';
import { useTelemetry } from '../context/TelemetryContext';
import { useI18n } from '../context/I18nContext';

export const Stopwatch: React.FC = () => {
  const { elapsedSeconds } = useTelemetry();
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
    <div
      className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-xs font-mono font-medium text-slate-700 dark:text-slate-300"
      title={`${t.stopwatch.title} (${t.stopwatch.running})`}
    >
      <Timer className="w-3.5 h-3.5 text-brand-500 animate-pulse" />
      <span>{formatTime(elapsedSeconds)}</span>
    </div>
  );
};
