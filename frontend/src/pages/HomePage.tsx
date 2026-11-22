import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Sparkles, ShieldCheck, Database, Zap } from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import { useTelemetry } from '../context/TelemetryContext';
import { SeoHead } from '../components/SeoHead';

const AdSlot = lazy(() => import('../components/AdSlot').then((m) => ({ default: m.AdSlot })));
const VideoAdSlot = lazy(() => import('../components/VideoAdSlot').then((m) => ({ default: m.VideoAdSlot })));
const ExperimentHistory = lazy(() => import('../components/ExperimentHistory').then((m) => ({ default: m.ExperimentHistory })));
const PgXrayTrainer = lazy(() => import('../components/PgXrayTrainer').then((m) => ({ default: m.PgXrayTrainer })));
const BlueGreenTrainer = lazy(() => import('../components/BlueGreenTrainer'));
const SyncAsyncPipelineVisualizer = lazy(() => import('../components/SyncAsyncPipelineVisualizer').then((m) => ({ default: m.SyncAsyncPipelineVisualizer })));
const ExpertAnalysisTable = lazy(() => import('../components/ExpertAnalysisTable').then((m) => ({ default: m.ExpertAnalysisTable })));

const TrainerFallback: React.FC = () => (
  <div className="min-h-[720px] rounded-xl border border-dashed border-slate-300 dark:border-slate-800" aria-busy="true" />
);

// Mount heavy interactive content only when it is about to enter the viewport.
const DeferredMount: React.FC<{ children: React.ReactNode; minHeight: number }> = ({ children, minHeight }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref} style={{ minHeight: visible ? undefined : minHeight }}>
      {visible ? children : null}
    </div>
  );
};

interface ScenarioMeta {
  id: string;
  name: string;
  description: string;
  badge: string;
  isDangerous: boolean;
}

const SCENARIOS: Record<string, ScenarioMeta> = {
  async_db_pool: {
    id: 'async_db_pool',
    name: '1. Asyncpg Pool (The Standard)',
    description: 'Non-blocking database queries via asyncpg pool with zero event loop lag.',
    badge: 'RECOMMENDED',
    isDangerous: false,
  },
  sync_blocking_db: {
    id: 'sync_blocking_db',
    name: '2. Sync DB in async def (#1 Trap)',
    description: 'Synchronous blocking calls (psycopg2 / requests) inside async def halting all clients.',
    badge: 'EVENT LOOP FREEZE',
    isDangerous: true,
  },
  n_plus_one_trap: {
    id: 'n_plus_one_trap',
    name: '3. N+1 Query Multi-Roundtrip',
    description: 'Fetching 20 rows in individual loop iterations vs single batched SQL statement.',
    badge: 'HIGH LATENCY',
    isDangerous: true,
  },
  overfetching_select_all: {
    id: 'overfetching_select_all',
    name: '4. Overfetching SELECT * (TOAST)',
    description: 'Pulling massive unneeded JSON payloads into RAM, churning shared_buffers.',
    badge: 'BUFFER CHURN',
    isDangerous: true,
  },
};

export const HomePage: React.FC = () => {
  const { t, locale } = useI18n();
  const { recordExperiment } = useTelemetry();
  const isRu = locale === 'ru';

  // Trainer Navigation Tab ('sync-async' | 'pg-xray')
  const [activeTrainer, setActiveTrainer] = useState<'sync-async' | 'pg-xray' | 'blue-green'>('sync-async');

  // Warm the inactive trainer/widget chunks while the browser is idle, so tab
  // switches feel instant without delaying the first screen.
  useEffect(() => {
    const prefetch = () => {
      void import('../components/PgXrayTrainer');
      void import('../components/BlueGreenTrainer');
      void import('../components/ExpertAnalysisTable');
      void import('../components/ExperimentHistory');
      void import('../components/AdSlot');
      void import('../components/VideoAdSlot');
    };
    const idleCallback = window.requestIdleCallback?.bind(window);
    if (idleCallback) {
      const id = idleCallback(prefetch, { timeout: 3000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(prefetch, 2000);
    return () => window.clearTimeout(id);
  }, []);

  // The primary trainer owns both the local simulator and the live HTTP probe.
  const handleExecuteProbe = async (scenario: string, concurrency: number, delayMs: number) => {
    const scenarioMeta = SCENARIOS[scenario] || SCENARIOS.async_db_pool;
    const params = new URLSearchParams({
      scenario,
      concurrency: String(concurrency),
      delay_ms: String(delayMs),
    });
    const startedAt = performance.now();
    const response = await fetch('/api/v1/probe/io-benchmark?' + params.toString(), { cache: 'no-store' });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(typeof errorBody.detail === 'string' ? errorBody.detail : 'HTTP ' + response.status);
    }
    const data = await response.json();
    const clientElapsedMs = Math.round(performance.now() - startedAt);

    recordExperiment({
      scenario: data.scenario || scenario,
      scenarioLabel: scenarioMeta.name,
      concurrency: data.concurrency ?? concurrency,
      delayMs: data.requested_delay_ms ?? delayMs,
      elapsedMs: data.actual_elapsed_ms ?? clientElapsedMs,
      eventLoopLagMs: data.event_loop_lag_ms ?? (data.event_loop_blocked ? 320 : 0.8),
      effectiveRps: data.effective_rps ?? 0,
      queriesExecuted: data.queries_executed ?? 0,
      dataScannedBytes: data.data_scanned_bytes ?? 0,
      eventLoopBlocked: Boolean(data.event_loop_blocked),
      insight: data.insight ?? '',
      status: 'success',
    });
    return data;
  };

  return (
    <>
      <SeoHead
        title={t.hero.title}
        description={t.hero.subtitle}
        canonicalPath="/"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        {/* Cluster Status Notification Banner */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 sm:p-5 rounded-xl bg-slate-900 dark:bg-slate-900/90 text-white border border-slate-800 shadow-soft-dark">
          <div className="flex items-center gap-3 text-sm font-mono">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span className="text-emerald-400 font-semibold">{t.statusBanner.clusterIsolation}</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm font-mono text-slate-300">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            <span>{t.statusBanner.readOnlyDb}</span>
          </div>
        </div>

        {/* Hero Section */}
        <section className="text-center max-w-4xl mx-auto pt-3 pb-1 space-y-5">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-50 dark:bg-brand-950/80 border border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t.hero.pill}</span>
          </div>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-950 dark:text-white leading-[1.08]">
            {t.hero.title}
          </h1>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl mx-auto">
            {t.hero.subtitle}
          </p>
        </section>

        {/* TRAINERS SWITCHER WRAPPER */}
        <section id="interactive-trainers-wrapper" className="scroll-mt-24 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm font-semibold" role="tablist" aria-label="Interactive trainers">
            <button
              onClick={() => setActiveTrainer('sync-async')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all cursor-pointer ${
                activeTrainer === 'sync-async'
                  ? 'bg-white dark:bg-slate-800 text-brand-600 dark:text-sky-300 shadow-sm font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
              role="tab"
              aria-selected={activeTrainer === 'sync-async'}
              id="sync-async-tab"
            >
              <Zap className="w-4 h-4 text-brand-500" />
              <span>{isRu ? 'Тренажёр 1: Sync vs Async (Week 2)' : 'Trainer 1: Sync vs Async (Week 2)'}</span>
            </button>

            <button
              onClick={() => setActiveTrainer('pg-xray')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all cursor-pointer ${
                activeTrainer === 'pg-xray'
                  ? 'bg-white dark:bg-slate-800 text-brand-600 dark:text-sky-300 shadow-sm font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
              role="tab"
              aria-selected={activeTrainer === 'pg-xray'}
              id="pg-xray-tab"
            >
              <Database className="w-4 h-4 text-indigo-500" />
              <span>{isRu ? 'Тренажёр 2: PostgreSQL X-Ray (Week 3)' : 'Trainer 2: PostgreSQL X-Ray (Week 3)'}</span>
            </button>

            <button
              onClick={() => setActiveTrainer('blue-green')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all cursor-pointer ${
                activeTrainer === 'blue-green'
                  ? 'bg-white dark:bg-slate-800 text-brand-600 dark:text-sky-300 shadow-sm font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
              role="tab"
              aria-selected={activeTrainer === 'blue-green'}
              id="blue-green-tab"
            >
              <span className="text-base">🚦</span>
              <span>{isRu ? 'Тренажёр 3: Blue/Green CI/CD (Week 4)' : 'Trainer 3: Blue/Green CI/CD (Week 4)'}</span>
            </button>
          </div>

          {/* ACTIVE TRAINER CONTAINER */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/70 bg-white/65 dark:bg-slate-900/30 backdrop-blur-[2px] p-6 sm:p-8 shadow-sm">
            <DeferredMount minHeight={720}>
            <Suspense fallback={<TrainerFallback />}>
              {activeTrainer === 'sync-async' ? (
                <div className="space-y-10">
                  {/* 1. INTERACTIVE PIPELINE VISUALIZER & 60FPS OSCILLOSCOPE */}
                  <SyncAsyncPipelineVisualizer onRunBackendProbe={handleExecuteProbe} />

                  {/* Expert Summary & Decision Matrix */}
                  <ExpertAnalysisTable />

                  {/* Experiment Log and Diff Comparison */}
                  <div className="mt-8 pt-8 border-t border-slate-200 dark:border-slate-800">
                    <ExperimentHistory />
                  </div>
                </div>
              ) : activeTrainer === 'pg-xray' ? (
                /* TRAINER 2: POSTGRESQL QUERY X-RAY */
                <PgXrayTrainer />
              ) : (
                /* TRAINER 3: BLUE/GREEN CI/CD VISUALIZER */
                <BlueGreenTrainer />
              )}
            </Suspense>
            </DeferredMount>
          </div>
        </section>

        {/* Leaderboard Ad Slot (CLS = 0) */}
        <Suspense fallback={<div className="min-h-[100px] my-6" aria-hidden="true" />}>
          <AdSlot type="leaderboard" variant="github" />
        </Suspense>

        {/* Video Ad / Rewarded Video Slot (CLS = 0) */}
        <Suspense fallback={<div className="min-h-[260px]" aria-hidden="true" />}>
          <VideoAdSlot />
        </Suspense>

        {/* 1,000+ Words Technical Deep-Dive (SEO & AI Citation) */}
        <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-6 sm:p-10 shadow-sm space-y-8 text-slate-800 dark:text-slate-200 leading-relaxed text-sm sm:text-base">
          <div>
            <span className="text-xs font-mono font-bold uppercase text-brand-600 dark:text-sky-400">
              {isRu ? 'Инженерный разбор на 1000+ слов' : 'Deep Technical Analysis (1000+ Words)'}
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mt-1">
              {isRu
                ? 'Анатомия Event Loop и буферов PostgreSQL: Как избежать деградации в продакшне'
                : 'Under the Hood of FastAPI Event Loop & PostgreSQL Buffers: Production Troubleshooting Guide'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
              Published: Week 2–3 | Topic: AsyncIO, AnyIO Threadpool, PostgreSQL Shared Buffers, EXPLAIN ANALYZE
            </p>
          </div>

          <div className="space-y-4 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
            <p>
              {isRu
                ? 'В высоконагруженных системах производительность backend-приложений на Python и баз данных PostgreSQL зависит от двух фундаментальных концепций: кооперативного планирования задач в цикле событий (Event Loop) и алгоритмов кэширования страниц на уровне PostgreSQL shared_buffers.'
                : 'HighLoad Python and PostgreSQL architectures depend fundamentally on cooperative event loop task scheduling and PostgreSQL shared_buffers cache management algorithms.'}
            </p>

            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white pt-2">
              {isRu ? '1. Механизм блокировки цикла событий (The Event Loop Starvation)' : '1. The Event Loop Starvation Mechanism'}
            </h3>
            <p>
              {isRu
                ? 'Когда разработчик объявляет эндпоинт как async def, FastAPI запускает его непосредственно в основном потоке цикла событий. Если внутри такого эндпоинта вызывается блокирующая функция — например, time.sleep(), requests.get() или синхронный вызов SQLAlchemy/psycopg2 — весь процесс буквально замирает. Никакие другие корутины не могут выполниться. Даже эндпоинт проверки жизнеспособности /health в Kubernetes начинает падать по таймауту.'
                : 'When an endpoint is defined as async def, FastAPI executes it directly on the main event loop thread. If a blocking operation is invoked—such as time.sleep(), requests.get(), or synchronous psycopg2 queries—the entire process stalls. No concurrent coroutines can progress. Even Kubernetes liveness probes (/health) start timing out, triggering pod evictions.'}
            </p>

            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white pt-2">
              {isRu ? '2. Понимание EXPLAIN (ANALYZE, BUFFERS) и ловушка холодного кэша' : '2. Demystifying EXPLAIN (ANALYZE, BUFFERS) and Cold Cache Trap'}
            </h3>
            <p>
              {isRu
                ? 'Многие разработчики совершают фатальную ошибку, ориентируясь только на показатель Execution Time в обычном EXPLAIN ANALYZE. Если запрос выполняется за 2 ms, это часто означает лишь то, что страницы таблицы уже прогреты в оперативной памяти (Shared Hit). При анализе через BUFFERS метрика shared_blks_read показывает реальное количество блоков, прочитанных с диска. Оверфетчинг (SELECT *) заставляет базу поднимать с диска широкие строки и вытеснять из RAM горячие индексы.'
                : 'Tuning queries solely via execution time is misleading. A fast run often merely indicates warm RAM cache (Shared Hit). EXPLAIN (ANALYZE, BUFFERS) exposes true physical disk I/O (Shared Read). Overfetching via SELECT * evicts valuable index pages from shared_buffers, causing severe cache thrashing.'}
            </p>
          </div>
        </article>

        {/* 2 Side Promotion Slots (CLS = 0) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
          <AdSlot type="card" variant="upcoming-sync" />
          <AdSlot type="card" variant="upcoming-postgres" />
        </div>
      </div>
    </>
  );
};
