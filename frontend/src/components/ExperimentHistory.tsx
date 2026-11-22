import React from 'react';
import { History, TrendingDown, TrendingUp, Trash2 } from 'lucide-react';
import { useTelemetry } from '../context/TelemetryContext';
import { useI18n } from '../context/I18nContext';

export const ExperimentHistory: React.FC = () => {
  const { telemetry, clearHistory } = useTelemetry();
  const { locale } = useI18n();
  const isRu = locale === 'ru';

  const history = telemetry.runsHistory || [];
  const sessionSeconds = Math.max(
    telemetry.sessionDurationSeconds,
    Math.floor((Date.now() - telemetry.sessionStartTime) / 1000),
  );

  if (history.length === 0) {
    return (
      <div className="p-8 text-center rounded-xl border border-dashed border-slate-300 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 text-xs">
        <History className="w-6 h-6 mx-auto mb-2 text-slate-400" />
        <p>{isRu ? 'История опытов пуста. Запустите сценарий для анализа!' : 'No experiments recorded yet. Run a probe to analyze results!'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Session Aggregates Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono">
        <div>
          <span className="text-slate-500 block text-[11px]">{isRu ? 'Всего запусков:' : 'Total Runs:'}</span>
          <span className="text-sm font-bold text-slate-900 dark:text-white">{telemetry.probesExecuted}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[11px]">{isRu ? 'Успешно / Ошибок:' : 'Success / Errors:'}</span>
          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
            {telemetry.successfulRuns} <span className="text-slate-400">/</span> <span className="text-red-500">{telemetry.failedRuns}</span>
          </span>
        </div>
        <div>
          <span className="text-slate-500 block text-[11px]">{isRu ? 'Время в сессии:' : 'Session Time:'}</span>
          <span className="text-sm font-bold text-sky-600 dark:text-sky-400">
            {Math.floor(sessionSeconds / 60)}m {sessionSeconds % 60}s
          </span>
        </div>
        <div>
          <span className="text-slate-500 block text-[11px]">{isRu ? 'Пинг API:' : 'API Ping:'}</span>
          <span className="text-sm font-bold text-amber-600 dark:text-amber-400">
            {telemetry.lastPingLatencyMs ?? '--'} ms
          </span>
        </div>
      </div>

      {/* History Items with Delta & Insights */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <History className="w-4 h-4 text-brand-500" />
          <span>{isRu ? 'История опытов и сравнение' : 'Experiment Log & Delta Comparison'}</span>
          <span className="text-xs font-normal text-slate-500">({history.length})</span>
        </h3>
        <button
          onClick={clearHistory}
          className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{isRu ? 'Очистить историю' : 'Clear Log'}</span>
        </button>
      </div>

      <div className="space-y-3">
        {history.map((run, idx) => (
          <div
            key={run.id}
            className={`p-4 rounded-xl border transition-all text-xs ${
              idx === 0
                ? 'border-brand-500/60 bg-white dark:bg-slate-900 shadow-sm'
                : 'border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-950/50'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 dark:text-white font-mono">
                  #{history.length - idx}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {run.scenarioLabel || run.scenario}
                </span>
                {idx === 0 && (
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-brand-100 dark:bg-brand-950 text-brand-700 dark:text-brand-300 border border-brand-300 dark:border-brand-800">
                    LATEST
                  </span>
                )}
              </div>

              {/* Delta Comparison badge vs previous */}
              {run.deltaPercentVsPrevious !== undefined && (
                <div
                  className={`flex items-center gap-1 font-mono font-bold text-[11px] px-2 py-0.5 rounded ${
                    run.deltaPercentVsPrevious < 0
                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                      : run.deltaPercentVsPrevious > 0
                      ? 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-400'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {run.deltaPercentVsPrevious < 0 ? (
                    <>
                      <TrendingDown className="w-3.5 h-3.5" />
                      <span>{Math.abs(run.deltaPercentVsPrevious)}% {isRu ? 'БЫСТРЕЕ' : 'FASTER'}</span>
                    </>
                  ) : run.deltaPercentVsPrevious > 0 ? (
                    <>
                      <TrendingUp className="w-3.5 h-3.5" />
                      <span>+{run.deltaPercentVsPrevious}% {isRu ? 'МЕДЛЕННЕЕ' : 'SLOWER'}</span>
                    </>
                  ) : (
                    <span>0% delta</span>
                  )}
                </div>
              )}
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] mb-2.5">
              <div>
                <span className="text-slate-500 block">Elapsed:</span>
                <span className="font-bold text-slate-900 dark:text-white">{run.elapsedMs} ms</span>
              </div>
              <div>
                <span className="text-slate-500 block">RPS:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">{run.effectiveRps} req/s</span>
              </div>
              <div>
                <span className="text-slate-500 block">Event Loop Lag:</span>
                <span className={run.eventLoopLagMs > 5 ? 'font-bold text-red-500' : 'text-slate-700 dark:text-slate-300'}>
                  {run.eventLoopLagMs} ms
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Concurrency:</span>
                <span className="text-slate-700 dark:text-slate-300">{run.concurrency} users</span>
              </div>
            </div>

            {/* Intelligent Contextual Insight */}
            {run.insight && (
              <div className="p-2.5 rounded-lg bg-slate-100/80 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                💡 <span className="font-medium">{run.insight}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
