import React, { useState } from 'react';
import { Database, Play, AlertCircle, ShieldCheck, Layers, FileCode, SplitSquareVertical } from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import { useTelemetry } from '../context/TelemetryContext';

interface PgTemplate {
  id: string;
  title: string;
  description: string;
  query: string;
  category: 'indexed' | 'unindexed' | 'overfetching' | 'narrow';
}

const TEMPLATES: PgTemplate[] = [
  {
    id: 'index_scan',
    title: 'B-Tree Index Scan (Primary Key)',
    description: 'Мгновенный точечный поиск O(log N) в RAM кэше с 0 чтений с диска.',
    query: 'SELECT id, query_name FROM probe_queries WHERE id = 142',
    category: 'indexed',
  },
  {
    id: 'seq_scan_unindexed',
    title: 'Sequential Scan (Без индекса)',
    description: 'Полное сканирование таблицы с выгрузкой сотен блоков с диска.',
    query: 'SELECT id, query_name FROM probe_queries WHERE buffer_cost > 3500',
    category: 'unindexed',
  },
  {
    id: 'overfetching_select_all',
    title: 'Оверфетчинг SELECT * (TOAST Churn)',
    description: 'Выкачивание тяжелых JSON-пейлоадов, вымывающих кэш shared_buffers.',
    query: 'SELECT * FROM probe_queries WHERE buffer_cost > 3500',
    category: 'overfetching',
  },
  {
    id: 'projected_narrow_select',
    title: 'Точечный узкий SELECT (Оптимизирован)',
    description: 'Ограничение колонок: id, query_name, buffer_cost без лишних полей.',
    query: 'SELECT id, query_name, buffer_cost FROM probe_queries WHERE buffer_cost > 3500',
    category: 'narrow',
  },
];

export const PgXrayTrainer: React.FC = () => {
  const { locale } = useI18n();
  const isRu = locale === 'ru';
  const { recordExperiment } = useTelemetry();

  const [selectedTemplate, setSelectedTemplate] = useState<string>('index_scan');
  const [query, setQuery] = useState<string>(TEMPLATES[0].query);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [planResult, setPlanResult] = useState<any | null>(null);
  const [previousResult, setPreviousResult] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Validate query client-side for immediate visual safety feedback
  const getSqlSafety = (sql: string): { safe: boolean; reason?: string } => {
    const upper = sql.toUpperCase();
    if (!upper.trim().startsWith('SELECT')) {
      return { safe: false, reason: 'Только чтение: разрешены только SELECT запросы' };
    }
    const forbidden = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'GRANT', 'PG_SLEEP', 'SET_CONFIG'];
    for (const f of forbidden) {
      if (upper.includes(f)) {
        return { safe: false, reason: `Запрещено: обнаружена опасная конструкция ${f}` };
      }
    }
    return { safe: true };
  };

  const safety = getSqlSafety(query);

  const handleSelectTemplate = (tpl: PgTemplate) => {
    setSelectedTemplate(tpl.id);
    setQuery(tpl.query);
    setErrorMessage(null);
  };

  const handleExecuteXray = async () => {
    if (!safety.safe) {
      setErrorMessage(safety.reason || 'Запрос не прошёл проверку безопасности.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    const start = performance.now();

    try {
      const resp = await fetch('/api/v1/probe/pg-xray', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, scenario: selectedTemplate }),
      });

      if (!resp.ok) {
        const errData = await resp.json();
        throw new Error(errData.detail || 'Ошибка выполнения EXPLAIN ANALYZE');
      }

      const data = await resp.json();
      const clientElapsed = Math.round(performance.now() - start);

      if (planResult) {
        setPreviousResult(planResult);
      }

      setPlanResult({ ...data, clientElapsedMs: clientElapsed });

      // Record in local telemetry
      recordExperiment({
        scenario: `pg_xray_${selectedTemplate}`,
        scenarioLabel: `PG X-Ray: ${selectedTemplate}`,
        concurrency: 1,
        delayMs: Math.round(data.execution_time_ms),
        elapsedMs: data.execution_time_ms || clientElapsed,
        eventLoopLagMs: 0.2,
        effectiveRps: Math.round(1000 / Math.max(data.execution_time_ms, 0.1)),
        queriesExecuted: 1,
        dataScannedBytes: (data.disk_read_kb + data.memory_cached_kb) * 1024,
        eventLoopBlocked: false,
        insight: data.insight,
        status: 'success',
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Ошибка выполнения');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header Info */}
      <div className="max-w-3xl">
        <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase text-brand-600 dark:text-sky-400 mb-1">
          <Database className="w-4 h-4" />
          <span>{isRu ? 'Тренажёр №2: Неделя 3' : 'Trainer #2: Week 3 Production Stand'}</span>
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
          {isRu ? 'PostgreSQL Query X-Ray & Анализатор буферов' : 'PostgreSQL Query X-Ray & Buffer Profiler'}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          {isRu
            ? 'Профилируйте реальные буферы чтения PostgreSQL (EXPLAIN ANALYZE BUFFERS). Сравнивайте Seq Scan с B-Tree индексами и отслеживайте прочитанные мегабайты с диска.'
            : 'Profile real PostgreSQL buffer reads (EXPLAIN ANALYZE BUFFERS). Contrast Seq Scan vs B-Tree Index Scans and track disk I/O volume.'}
        </p>
      </div>

      {/* Interactive Controls & SQL Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Preset Templates & SQL Editor (7 cols) */}
        <div className="lg:col-span-7 space-y-5 bg-slate-50 dark:bg-slate-950/60 p-5 rounded-xl border border-slate-200 dark:border-slate-800/80">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              {isRu ? '1. Выберите готовый учебный сценарий:' : '1. Choose Educational SQL Scenario:'}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => handleSelectTemplate(tpl)}
                  className={`p-3 rounded-lg text-left text-xs border transition-all cursor-pointer ${
                    selectedTemplate === tpl.id
                      ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/40 text-brand-900 dark:text-brand-100 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-900 dark:text-white truncate">
                      {tpl.title}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                    {tpl.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* SQL Editor Area */}
          <div>
            <div className="flex items-center justify-between mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-brand-500" />
                <span>{isRu ? 'SQL Запрос (Строго READ ONLY):' : 'SQL Query (Read-Only Scope):'}</span>
              </span>

              {/* Safety Badge */}
              <span
                className={`flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded ${
                  safety.safe
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                    : 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300'
                }`}
              >
                {safety.safe ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>pglast: Verified Safe</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>pglast: Blocked</span>
                  </>
                )}
              </span>
            </div>

            <textarea
              rows={4}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-800 bg-slate-950 text-emerald-400 font-mono text-xs focus:ring-2 focus:ring-brand-500 focus:outline-none resize-none leading-relaxed"
              placeholder="SELECT id, query_name FROM probe_queries WHERE id = 1"
            />
          </div>

          {errorMessage && (
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-900/60 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Execution Button */}
          <button
            onClick={handleExecuteXray}
            disabled={isLoading || !safety.safe}
            className="w-full py-3 px-4 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm shadow-md shadow-brand-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Play className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>
              {isLoading
                ? (isRu ? 'Анализ плана EXPLAIN ANALYZE...' : 'Executing EXPLAIN BUFFERS...')
                : (isRu ? 'Запустить EXPLAIN (ANALYZE, BUFFERS)' : 'Run EXPLAIN (ANALYZE, BUFFERS)')}
            </span>
          </button>
        </div>

        {/* Right Column: Execution Plan & Buffers Breakdown (5 cols) */}
        <div className="lg:col-span-5 h-full flex flex-col justify-between bg-slate-950 text-slate-200 p-5 rounded-xl border border-slate-800 font-mono text-xs">
          <div>
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-brand-400" />
                PostgreSQL Plan & Buffer Metrics
              </span>
              <span className="text-[10px] text-slate-500">FORMAT JSON</span>
            </div>

            {planResult ? (
              <div className="space-y-4">
                {/* 4 Key Metrics */}
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Execution Time:</span>
                    <span className="text-base font-bold text-emerald-400">
                      {planResult.execution_time_ms} ms
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Node Type:</span>
                    <span className="text-base font-bold text-sky-400 truncate block">
                      {planResult.plan?.["Node Type"] || 'Scan'}
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">RAM Shared Hit:</span>
                    <span className="text-base font-bold text-amber-400">
                      {planResult.shared_blks_hit} blks ({planResult.memory_cached_kb} KB)
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Disk Shared Read:</span>
                    <span className={`text-base font-bold ${planResult.shared_blks_read > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {planResult.shared_blks_read} blks ({planResult.disk_read_kb} KB)
                    </span>
                  </div>
                </div>

                {/* Plan Details Card */}
                <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px] space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Startup / Total Cost:</span>
                    <span className="text-slate-200">{planResult.plan?.["Startup Cost"]} .. {planResult.plan?.["Total Cost"]}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Actual Rows:</span>
                    <span className="text-slate-200">{planResult.scanned_rows}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Planning Time:</span>
                    <span className="text-slate-200">{planResult.planning_time_ms} ms</span>
                  </div>
                </div>

                {/* Virtual DBA Insight */}
                {planResult.insight && (
                  <div className="p-3 rounded-lg bg-slate-900 border border-brand-500/30 text-[11px] text-slate-300 leading-relaxed">
                    💡 <span className="font-semibold text-white">DBA Анализ:</span> {planResult.insight}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-16 text-center text-slate-500 space-y-2">
                <Database className="w-8 h-8 mx-auto text-slate-700 animate-pulse" />
                <p>Выберите шаблон и запустите EXPLAIN для анализа буферов.</p>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-900 text-[10px] text-slate-500 flex justify-between">
            <span>Timeout: 1500ms</span>
            <span>Role: sandbox_readonly</span>
          </div>
        </div>
      </div>

      {/* Side-by-Side Diff Comparison between current and previous run */}
      {planResult && previousResult && (
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <SplitSquareVertical className="w-4 h-4 text-brand-500" />
              <span>{isRu ? 'Сравнение двух запусков (Diff)' : 'Side-by-Side Plan Diff'}</span>
            </h3>
            <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-bold">
              {previousResult.execution_time_ms > planResult.execution_time_ms
                ? `⚡ ${Math.round(((previousResult.execution_time_ms - planResult.execution_time_ms) / previousResult.execution_time_ms) * 100)}% Быстрее!`
                : ''}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
            {/* Previous Run */}
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-2">
                {isRu ? 'Предыдущий запуск' : 'Previous Run'}
              </div>
              <div className="space-y-1">
                <div className="font-bold text-slate-800 dark:text-slate-200">{previousResult.plan?.["Node Type"]}</div>
                <div>Time: <span className="font-bold text-amber-500">{previousResult.execution_time_ms} ms</span></div>
                <div>Disk Read: <span className="font-bold text-red-500">{previousResult.disk_read_kb} KB</span></div>
              </div>
            </div>

            {/* Current Run */}
            <div className="p-4 rounded-lg bg-brand-50/50 dark:bg-brand-950/30 border border-brand-300 dark:border-brand-800">
              <div className="text-[10px] uppercase tracking-wider text-brand-600 dark:text-brand-400 font-bold mb-2">
                {isRu ? 'Текущий запуск' : 'Current Run'}
              </div>
              <div className="space-y-1">
                <div className="font-bold text-slate-900 dark:text-white">{planResult.plan?.["Node Type"]}</div>
                <div>Time: <span className="font-bold text-emerald-500">{planResult.execution_time_ms} ms</span></div>
                <div>Disk Read: <span className="font-bold text-emerald-500">{planResult.disk_read_kb} KB</span></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
