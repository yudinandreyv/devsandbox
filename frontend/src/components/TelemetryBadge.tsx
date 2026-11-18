import React, { useState } from 'react';
import { Activity, Database, Zap, RefreshCw, X } from 'lucide-react';
import { useTelemetry } from '../context/TelemetryContext';
import { useI18n } from '../context/I18nContext';

export const TelemetryBadge: React.FC = () => {
  const { telemetry, measurePing, resetTelemetry } = useTelemetry();
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isPinging, setIsPinging] = useState(false);

  const formatBytes = (kb: number) => {
    if (kb < 1024) return `${kb} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  };

  const handlePing = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPinging(true);
    await measurePing();
    setIsPinging(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/60 text-xs font-mono text-slate-700 dark:text-slate-300 transition-colors"
      >
        <span className="flex items-center space-x-1 text-emerald-600 dark:text-emerald-400">
          <Activity className="w-3.5 h-3.5" />
          <span>{telemetry.probesExecuted}</span>
        </span>
        <span className="text-slate-400">|</span>
        <span className="flex items-center space-x-1 text-sky-600 dark:text-sky-400">
          <Database className="w-3.5 h-3.5" />
          <span>{formatBytes(telemetry.bytesScannedKb)}</span>
        </span>
        {telemetry.lastPingLatencyMs !== null && (
          <>
            <span className="text-slate-400">|</span>
            <span className="flex items-center space-x-1 text-amber-600 dark:text-amber-400">
              <Zap className="w-3.5 h-3.5" />
              <span>{telemetry.lastPingLatencyMs}ms</span>
            </span>
          </>
        )}
      </button>

      {/* Popover */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-4 z-50 text-xs">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100 dark:border-slate-800">
            <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-brand-500" />
              {t.telemetry.badge} (localStorage)
            </span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2.5 font-mono">
            <div className="flex justify-between">
              <span className="text-slate-500">{t.telemetry.probes}:</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {telemetry.probesExecuted}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">{t.telemetry.scanned}:</span>
              <span className="font-semibold text-sky-600 dark:text-sky-400">
                {formatBytes(telemetry.bytesScannedKb)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500">{t.telemetry.latency}:</span>
              <span className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                {telemetry.lastPingLatencyMs ?? '--'} ms
                <button
                  onClick={handlePing}
                  disabled={isPinging}
                  className="p-0.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400"
                  title="Ping API"
                >
                  <RefreshCw className={`w-3 h-3 ${isPinging ? 'animate-spin' : ''}`} />
                </button>
              </span>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="text-[10px] text-slate-400 mb-1">{t.telemetry.guestId}:</div>
              <div className="p-1.5 bg-slate-50 dark:bg-slate-950 rounded border border-slate-200 dark:border-slate-800 text-[10px] truncate select-all text-slate-600 dark:text-slate-400">
                {telemetry.guestSessionId}
              </div>
            </div>
          </div>

          <div className="mt-4 pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center text-[11px]">
            <span className="text-emerald-600 dark:text-emerald-500 flex items-center gap-1">
              ✓ {t.telemetry.synced}
            </span>
            <button
              onClick={() => {
                resetTelemetry();
                setIsOpen(false);
              }}
              className="text-red-500 hover:text-red-600 font-medium"
            >
              {t.telemetry.reset}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
