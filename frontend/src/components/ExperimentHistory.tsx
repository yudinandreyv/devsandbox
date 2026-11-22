import React from 'react';
import { History, TrendingDown, TrendingUp, Trash2 } from 'lucide-react';
import { useTelemetry } from '../context/TelemetryContext';
import { useI18n } from '../context/I18nContext';

export const ExperimentHistory: React.FC = () => {
  const { telemetry, clearHistory } = useTelemetry();
  const { locale } = useI18n();
  const isRu = locale === 'ru';

  const history = telemetry.runsHistory || [];
  if (history.length === 0) {
    return (
      <div className="p-8 text-center rounded-xl border border-dashed border-slate-300 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 text-xs">
        <History aria-hidden="true" className="w-6 h-6 mx-auto mb-2 text-slate-400" />
        <p role="status">{isRu ? 'История опытов пуста. Запустите сценарий для анализа!' : 'No experiments recorded yet. Run a probe to analyze results!'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Session Aggregates Summary Bar */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono">
        <div>
          <dt className="text-slate-500 block text-[11px]">{isRu ? 'Пинг API:' : 'API Ping:'}</dt>
          <dd className="text-sm font-bold text-amber-600 dark:text-amber-400">
            {telemetry.lastPingLatencyMs ?? '--'} ms
          </dd>
        </div>
      </dl>

      {/* History Items with Delta & Insights */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <History aria-hidden="true" className="w-4 h-4 text-brand-500" />
          <span>{isRu ? 'История опытов и сравнение' : 'Experiment Log & Delta Comparison'}</span>
          <span className="text-xs font-normal text-slate-500">({history.length})</span>
        </h3>
        <button
          type="button"
          onClick={clearHistory}
          className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors"
        >
          <Trash2 aria-hidden="true" className="w-3.5 h-3.5" />
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
                      <TrendingDown aria-hidden="true" className="w-3.5 h-3.5" />
                      <span>{Math.abs(run.deltaPercentVsPrevious)}% {isRu ? 'БЫСТРЕЕ' : 'FASTER'}</span>
                    </>
                  ) : run.deltaPercentVsPrevious > 0 ? (
                    <>
                      <TrendingUp aria-hidden="true" className="w-3.5 h-3.5" />
                      <span>+{run.deltaPercentVsPrevious}% {isRu ? 'МЕДЛЕННЕЕ' : 'SLOWER'}</span>
                    </>
                  ) : (
                    <span>0% delta</span>
                  )}
                </div>
              )}
            </div>

            {/* Metrics Grid */}
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] mb-2.5">
              <div>
                <dt className="text-slate-500 block">Elapsed:</dt>
                <dd className="font-bold text-slate-900 dark:text-white">{run.elapsedMs} ms</dd>
              </div>
              <div>
                <dt className="text-slate-500 block">RPS:</dt>
                <dd className="font-bold text-emerald-600 dark:text-emerald-400">{run.effectiveRps} req/s</dd>
              </div>
              <div>
                <dt className="text-slate-500 block">Event Loop Lag:</dt>
                <dd className={run.eventLoopLagMs > 5 ? 'font-bold text-red-500' : 'text-slate-700 dark:text-slate-300'}>
                  {run.eventLoopLagMs} ms
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 block">Concurrency:</dt>
                <dd className="text-slate-700 dark:text-slate-300">{run.concurrency} users</dd>
              </div>
            </dl>

            {/* Intelligent Contextual Insight */}
            {run.insight && (
              <div className="p-2.5 rounded-lg bg-slate-100/80 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                <span aria-hidden="true">💡</span> <span className="font-medium">{run.insight}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
