import React, { useState, useMemo, useEffect } from 'react';
import {
  Database,
  Play,
  FileCode,
  Zap,
  HardDrive,
  Copy,
  Check,
  AlertTriangle,
  Info,
  Sliders,
  Sparkles,
  TrendingDown,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import { useTelemetry } from '../context/TelemetryContext';

interface PlanSummary {
  node_type: string;
  relation: string;
  index_name: string | null;
  execution_time_ms: number;
  planning_time_ms: number;
  actual_rows: number;
  shared_hit: number;
  shared_read: number;
  shared_hit_kb: number;
  shared_read_kb: number;
  total_buffers_kb: number;
  startup_cost: number;
  total_cost: number;
  raw_plan: Record<string, any>;
}

interface PgXrayExperimentResponse {
  status: string;
  scenario_label: string;
  plan_a: PlanSummary;
  plan_b: PlanSummary;
  speedup_factor: number;
  buffer_savings_pct: number;
  sql_used: string;
  insight: string;
  version: string;
}

interface PresetScenario {
  id: string;
  title: string;
  description: string;
  samplePct: number;
  months: number;
  columns: 'narrow' | 'star';
  jsonbFilter: boolean;
  badge: string;
}

const PRESETS: PresetScenario[] = [
  {
    id: 'standard',
    title: 'Типовая выборка',
    description: '50% таблицы, 6 месяцев, узкий набор колонок. Идеальный сценарий для проверки B-Tree.',
    samplePct: 50,
    months: 6,
    columns: 'narrow',
    jsonbFilter: false,
    badge: 'Сбалансированный',
  },
  {
    id: 'overfetching',
    title: 'TOAST Overfetching (SELECT *)',
    description: 'Полная выгрузка таблицы с тяжелыми JSONB payload. Провоцирует вымывание кэша.',
    samplePct: 100,
    months: 12,
    columns: 'star',
    jsonbFilter: false,
    badge: 'Антипаттерн',
  },
  {
    id: 'point_lookup',
    title: 'Точечная выборка (1 мес)',
    description: '10% таблицы за 1 месяц. Высокая селективность индекса с максимальным отрывом от Seq Scan.',
    samplePct: 10,
    months: 1,
    columns: 'narrow',
    jsonbFilter: false,
    badge: 'Высокая селективность',
  },
  {
    id: 'jsonb_gin',
    title: 'JSONB containment (@>)',
    description: 'Фильтрация по JSONB атрибутам. Сравнение GIN-индекса против полного разбора JSON.',
    samplePct: 60,
    months: 12,
    columns: 'narrow',
    jsonbFilter: true,
    badge: 'GIN индекс',
  },
];

export const PgXrayTrainer: React.FC = () => {
  const { locale } = useI18n();
  const isRu = locale === 'ru';
  const { recordExperiment } = useTelemetry();

  // 4 Core Parameters (Strictly No Freeform SQL from User)
  const [samplePct, setSamplePct] = useState<number>(50);
  const [months, setMonths] = useState<number>(6);
  const [columns, setColumns] = useState<'narrow' | 'star'>('narrow');
  const [jsonbFilter, setJsonbFilter] = useState<boolean>(false);

  const [activePreset, setActivePreset] = useState<string>('standard');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [result, setResult] = useState<PgXrayExperimentResponse | null>(null);
  const [previousResult, setPreviousResult] = useState<PgXrayExperimentResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);
  const [codeTab, setCodeTab] = useState<'python' | 'sql'>('python');

  // Compute live SQL preview based on server template rules
  const generatedSql = useMemo(() => {
    const cols = columns === 'star' ? '*' : 'id, query_name, buffer_cost, created_at';
    const whereParts = [`created_at >= NOW() - INTERVAL '${months} months'`];
    if (jsonbFilter) {
      whereParts.push(`payload @> '{"labels": {"region": "eu-central"}}'`);
    }
    const sampleClause = samplePct < 100 ? ` TABLESAMPLE SYSTEM (${samplePct})` : '';
    return `SELECT ${cols}\nFROM probe_queries${sampleClause}\nWHERE ${whereParts.join(' AND ')}\nLIMIT 5000;`;
  }, [samplePct, months, columns, jsonbFilter]);

  const handleApplyPreset = (preset: PresetScenario) => {
    setActivePreset(preset.id);
    setSamplePct(preset.samplePct);
    setMonths(preset.months);
    setColumns(preset.columns);
    setJsonbFilter(preset.jsonbFilter);
    setErrorMessage(null);
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(generatedSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const handleExecuteXray = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    const start = performance.now();

    try {
      const resp = await fetch('/api/v1/probe/pg-xray', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sample_pct: samplePct,
          months: months,
          columns: columns,
          jsonb_filter: jsonbFilter,
        }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.detail || 'Ошибка выполнения EXPLAIN ANALYZE');
      }

      const data: PgXrayExperimentResponse = await resp.json();
      const clientElapsed = Math.round(performance.now() - start);

      if (result) {
        setPreviousResult(result);
      }
      setResult(data);

      // Record in local telemetry (Zero PII, updates session totals)
      const totalScanned = (data.plan_a.total_buffers_kb + data.plan_b.total_buffers_kb) * 1024;
      recordExperiment({
        scenario: `pg_xray_${columns}_${months}m_${samplePct}pct`,
        scenarioLabel: data.scenario_label,
        concurrency: 1,
        delayMs: Math.round(data.plan_b.execution_time_ms),
        elapsedMs: clientElapsed,
        eventLoopLagMs: 0.1,
        effectiveRps: Math.round(1000 / Math.max(data.plan_b.execution_time_ms, 0.2)),
        queriesExecuted: 2, // 2 plans per experiment
        dataScannedBytes: totalScanned,
        eventLoopBlocked: false,
        insight: data.insight,
        status: 'success',
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Ошибка соединения с API');
    } finally {
      setIsLoading(false);
    }
  };

  // Run initial experiment on component mount if no result
  useEffect(() => {
    if (!result && !isLoading) {
      handleExecuteXray();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-8">
      {/* 1. SECTION HEADER */}
      <div className="border-b border-slate-200 dark:border-slate-800 pb-5">
        <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase text-brand-600 dark:text-sky-400 mb-2">
          <Database className="w-4 h-4" />
          <span>{isRu ? 'Тренажёр №2 · PostgreSQL / EXPLAIN ANALYZE' : 'Trainer #2 · PostgreSQL / EXPLAIN ANALYZE'}</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          {isRu ? 'PostgreSQL Query X-Ray: Seq Scan vs Index Scan' : 'PostgreSQL Query X-Ray: Seq Scan vs Index Scan'}
        </h2>
        <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 mt-1 max-w-4xl leading-relaxed">
          {isRu
            ? 'Интерактивный разбор планов запросов PostgreSQL. Задавайте параметры выборки, запускайте стенд и сравнивайте реальные показатели shared buffers между последовательным сканированием и B-Tree/GIN индексом.'
            : 'Interactive PostgreSQL query planner sandbox. Adjust query selectivity, execute double-pass EXPLAIN BUFFERS, and contrast shared buffers cache reads between Seq Scan and B-Tree/GIN indexes.'}
        </p>

        {/* STAND RULES (4 Badges) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 text-xs">
            <span className="font-mono font-bold text-brand-600 dark:text-sky-400 block mb-0.5">01 · Безопасный SQL</span>
            <span className="text-slate-600 dark:text-slate-300">Серверный генератор из 4 параметров с pglast AST защитой.</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 text-xs">
            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 block mb-0.5">02 · Dual-Plan замер</span>
            <span className="text-slate-600 dark:text-slate-300">Plan A (Seq Scan через SET LOCAL) против Plan B (Index Scan).</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 text-xs">
            <span className="font-mono font-bold text-amber-600 dark:text-amber-400 block mb-0.5">03 · Shared Buffers</span>
            <span className="text-slate-600 dark:text-slate-300">Данные страниц RAM-кэша PostgreSQL, а не гарантированный SSD I/O.</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 text-xs">
            <span className="font-mono font-bold text-purple-600 dark:text-purple-400 block mb-0.5">04 · TOAST и SELECT *</span>
            <span className="text-slate-600 dark:text-slate-300">Наглядная демонстрация вымывания кэша тяжелыми объектами.</span>
          </div>
        </div>
      </div>

      {/* 2. PRESETS BAR */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-brand-500" />
            <span>{isRu ? 'Готовые сценарии нагрузки:' : 'Quick Presets:'}</span>
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {PRESETS.map((preset) => {
            const isSelected = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleApplyPreset(preset)}
                className={`p-3 rounded-xl text-left border transition-all cursor-pointer ${
                  isSelected
                    ? 'border-brand-500 bg-brand-50/70 dark:bg-brand-950/40 text-brand-900 dark:text-brand-100 shadow-sm ring-1 ring-brand-500/30'
                    : 'border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                    {preset.title}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {preset.badge}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug line-clamp-2">
                  {preset.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. WORKSPACE: CONTROLS & SQL PREVIEW */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: 4 Interactive Parameter Controls (6 cols) */}
        <div className="lg:col-span-6 space-y-5 bg-slate-50 dark:bg-slate-950/60 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800/80">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-brand-500" />
              <span>{isRu ? 'Параметры эксперимента' : 'Experiment Parameters'}</span>
            </span>
            <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded">
              Zero User SQL
            </span>
          </div>

          {/* Control 1: Sample Percentage */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                1. {isRu ? 'Размер выборки (TABLESAMPLE):' : 'Sample Size (TABLESAMPLE):'}
              </span>
              <span className="font-mono font-bold text-brand-600 dark:text-sky-400">
                {samplePct}% {samplePct === 100 ? (isRu ? '(Вся таблица)' : '(Full Table)') : ''}
              </span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              step="10"
              value={samplePct}
              onChange={(e) => {
                setSamplePct(Number(e.target.value));
                setActivePreset('');
              }}
              className="w-full accent-brand-500 cursor-pointer h-2 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>10% (быстрый срез)</span>
              <span>50%</span>
              <span>100% (500K строк)</span>
            </div>
          </div>

          {/* Control 2: Months Horizon */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                2. {isRu ? 'Период данных (created_at):' : 'Time Window (created_at):'}
              </span>
              <span className="font-mono font-bold text-brand-600 dark:text-sky-400">
                {months} {isRu ? (months === 1 ? 'месяц' : months < 5 ? 'месяца' : 'месяцев') : 'months'}
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="24"
              step="1"
              value={months}
              onChange={(e) => {
                setMonths(Number(e.target.value));
                setActivePreset('');
              }}
              className="w-full accent-brand-500 cursor-pointer h-2 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>1 мес (селективный индекс)</span>
              <span>12 мес</span>
              <span>24 мес (глубокий скан)</span>
            </div>
          </div>

          {/* Control 3: Columns Projection */}
          <div className="space-y-2 pt-1">
            <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              3. {isRu ? 'Проекция колонок (SELECT):' : 'Column Projection (SELECT):'}
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setColumns('narrow');
                  setActivePreset('');
                }}
                className={`p-2.5 rounded-xl text-left border text-xs font-semibold transition-all cursor-pointer ${
                  columns === 'narrow'
                    ? 'border-brand-500 bg-brand-50/70 dark:bg-brand-950/40 text-brand-900 dark:text-brand-100 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span>Только нужные</span>
                  <CheckCircle2 className={`w-3.5 h-3.5 ${columns === 'narrow' ? 'text-brand-500' : 'opacity-0'}`} />
                </div>
                <p className="text-[10px] font-mono text-slate-400 font-normal">
                  id, query_name, buffer_cost
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setColumns('star');
                  setActivePreset('');
                }}
                className={`p-2.5 rounded-xl text-left border text-xs font-semibold transition-all cursor-pointer ${
                  columns === 'star'
                    ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="flex items-center gap-1">
                    <span>SELECT *</span>
                    <span className="text-[9px] px-1 py-0.2 bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 rounded font-mono">
                      TOAST
                    </span>
                  </span>
                  <CheckCircle2 className={`w-3.5 h-3.5 ${columns === 'star' ? 'text-amber-500' : 'opacity-0'}`} />
                </div>
                <p className="text-[10px] font-mono text-slate-400 font-normal">
                  Все поля + тяжелый JSONB
                </p>
              </button>
            </div>
          </div>

          {/* Control 4: JSONB Filter Switch */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
            <div>
              <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                4. {isRu ? 'JSONB-фильтр containment (@>):' : 'JSONB Filter (@>):'}
              </span>
              <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                payload @&gt; &#123;&quot;labels&quot;: &#123;&quot;region&quot;: &quot;eu-central&quot;&#125;&#125;
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setJsonbFilter(!jsonbFilter);
                setActivePreset('');
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                jsonbFilter ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  jsonbFilter ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Run Button */}
          <button
            onClick={handleExecuteXray}
            disabled={isLoading}
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-sky-600 hover:from-brand-500 hover:to-sky-500 disabled:opacity-50 text-white font-bold text-xs sm:text-sm shadow-md shadow-brand-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer mt-4"
          >
            <Play className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>
              {isLoading
                ? (isRu ? 'Выполняем параллельный EXPLAIN ANALYZE BUFFERS...' : 'Profiling dual plans in PostgreSQL...')
                : (isRu ? 'Запустить сравнение планов (Dual EXPLAIN BUFFERS)' : 'Run Dual EXPLAIN (ANALYZE, BUFFERS)')}
            </span>
          </button>
        </div>

        {/* Right Column: SQL Preview & Active Query Inspector (6 cols) */}
        <div className="lg:col-span-6 bg-slate-950 text-slate-200 p-5 rounded-2xl border border-slate-800 font-mono text-xs shadow-md space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <span className="flex items-center gap-2 text-slate-400 font-semibold">
              <FileCode className="w-4 h-4 text-brand-400" />
              <span>{isRu ? 'Серверный SQL-шаблон (Строго Read-Only)' : 'Server SQL Template (Read-Only)'}</span>
            </span>
            <button
              onClick={handleCopySql}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-all text-[11px] cursor-pointer"
            >
              {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSql ? 'Скопировано' : 'Копировать SQL'}</span>
            </button>
          </div>

          <pre className="p-4 rounded-xl bg-slate-900/90 text-emerald-400 border border-slate-800/80 overflow-x-auto leading-relaxed text-[11px] font-mono">
            <code>{generatedSql}</code>
          </pre>

          <div className="grid grid-cols-2 gap-3 text-[11px] pt-1">
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-slate-400 block text-[10px] uppercase">Plan A механизм</span>
              <span className="font-bold text-amber-400">SET LOCAL enable_indexscan=off</span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-slate-400 block text-[10px] uppercase">Plan B механизм</span>
              <span className="font-bold text-emerald-400">RESET + B-Tree/GIN Index Scan</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-900">
            <span className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-yellow-500" />
              <span>pglast: AST Parsed &amp; Validated</span>
            </span>
            <span>statement_timeout: 1500ms</span>
          </div>
        </div>
      </div>

      {/* ERROR BANNER */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-red-950/60 border border-red-900 text-red-200 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 4. DUAL-PLAN COMPARISON CARDS (PLAN A vs PLAN B) */}
      {result && (
        <div className="space-y-5 pt-4">
          {/* Summary Metric Header */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border border-slate-800 text-white flex flex-wrap items-center justify-between gap-4 shadow-md">
            <div className="flex items-center gap-3">
              <span className="p-2.5 rounded-xl bg-brand-500/20 text-brand-400 border border-brand-500/30">
                <Zap className="w-5 h-5" />
              </span>
              <div>
                <span className="text-xs uppercase tracking-wider text-slate-400 font-mono">
                  {isRu ? 'Итоговая дельта сравнения' : 'Experiment Delta Comparison'}
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <h3 className="text-lg sm:text-xl font-extrabold text-white">
                    {result.scenario_label}
                  </h3>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-mono font-bold flex items-center gap-1.5">
                <Zap className="w-4 h-4" />
                <span>В {result.speedup_factor}x быстрее</span>
              </div>
              <div className="px-3 py-1.5 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400 text-xs font-mono font-bold flex items-center gap-1.5">
                <TrendingDown className="w-4 h-4" />
                <span>-{result.buffer_savings_pct}% shared read</span>
              </div>
              <div className="px-3 py-1.5 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-400 text-xs font-mono font-bold flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                <span>Δ {Math.abs(result.plan_a.execution_time_ms - result.plan_b.execution_time_ms).toFixed(2)} ms</span>
              </div>
            </div>

            {previousResult && (
              <div className="w-full pt-2.5 mt-1 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>
                  Предыдущий запуск: <strong className="text-slate-300">{previousResult.scenario_label}</strong> ({previousResult.plan_b.execution_time_ms.toFixed(2)} ms)
                </span>
                <span className={result.plan_b.execution_time_ms <= previousResult.plan_b.execution_time_ms ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {result.plan_b.execution_time_ms <= previousResult.plan_b.execution_time_ms
                    ? `↓ ${Math.round(((previousResult.plan_b.execution_time_ms - result.plan_b.execution_time_ms) / previousResult.plan_b.execution_time_ms) * 100)}% быстрее`
                    : `↑ ${Math.round(((result.plan_b.execution_time_ms - previousResult.plan_b.execution_time_ms) / previousResult.plan_b.execution_time_ms) * 100)}% дольше`}
                </span>
              </div>
            )}
          </div>

          {/* Side-by-Side Dual Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* PLAN A CARD (Sequential Scan - Red/Amber) */}
            <div className="rounded-2xl border-2 border-rose-500/30 dark:border-rose-900/60 bg-white dark:bg-slate-950 p-6 shadow-sm space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-rose-100 dark:border-rose-950">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-rose-500" />
                  <span className="font-mono font-bold text-xs uppercase tracking-wider text-rose-600 dark:text-rose-400">
                    Plan A: Без индекса (Forced Seq Scan)
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                  {result.plan_a.node_type}
                </span>
              </div>

              {/* Execution Time & Rows */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3.5 rounded-xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/50">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">Время выполнения:</span>
                  <span className="text-2xl font-mono font-extrabold text-rose-600 dark:text-rose-400">
                    {result.plan_a.execution_time_ms.toFixed(2)} ms
                  </span>
                  <span className="text-[10px] text-slate-400 block font-mono mt-0.5">
                    Планирование: {result.plan_a.planning_time_ms.toFixed(2)} ms
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">Строк обработано:</span>
                  <span className="text-2xl font-mono font-extrabold text-slate-800 dark:text-white">
                    {result.plan_a.actual_rows.toLocaleString()}
                  </span>
                  <span className="text-[10px] text-slate-400 block font-mono mt-0.5">
                    Стоимость: {result.plan_a.total_cost.toFixed(1)} cost
                  </span>
                </div>
              </div>

              {/* Shared Buffers Breakdown */}
              <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800/80">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-rose-500" />
                    <span>Карта shared_buffers (PostgreSQL RAM):</span>
                  </span>
                  <span className="font-mono text-rose-600 dark:text-rose-400 font-bold">
                    {result.plan_a.total_buffers_kb.toLocaleString()} KB
                  </span>
                </div>

                {/* Progress bar of Hit vs Read */}
                <div className="w-full h-3 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden flex">
                  <div
                    style={{
                      width: `${(result.plan_a.shared_hit / Math.max(result.plan_a.shared_hit + result.plan_a.shared_read, 1)) * 100}%`,
                    }}
                    className="bg-emerald-500 h-full"
                    title={`Shared Hit (RAM): ${result.plan_a.shared_hit} блоков`}
                  />
                  <div
                    style={{
                      width: `${(result.plan_a.shared_read / Math.max(result.plan_a.shared_hit + result.plan_a.shared_read, 1)) * 100}%`,
                    }}
                    className="bg-rose-500 h-full"
                    title={`Shared Read: ${result.plan_a.shared_read} блоков`}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Shared Hit (из RAM):</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      {result.plan_a.shared_hit} бл. ({result.plan_a.shared_hit_kb} KB)
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Shared Read (в буфер):</span>
                    <span className="font-bold text-rose-600 dark:text-rose-400">
                      {result.plan_a.shared_read} бл. ({result.plan_a.shared_read_kb} KB)
                    </span>
                  </div>
                </div>
              </div>

              {/* Status Note */}
              <div className="p-3 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2 font-mono">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
                <span>Индекс отсутствует: сканирует всю таблицу блок за блоком.</span>
              </div>
            </div>

            {/* PLAN B CARD (Index Scan - Emerald) */}
            <div className="rounded-2xl border-2 border-emerald-500/30 dark:border-emerald-900/60 bg-white dark:bg-slate-950 p-6 shadow-sm space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-emerald-100 dark:border-emerald-950">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-emerald-500" />
                  <span className="font-mono font-bold text-xs uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    Plan B: С индексом ({result.plan_b.node_type})
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  {result.plan_b.index_name || 'B-Tree / GIN'}
                </span>
              </div>

              {/* Execution Time & Rows */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">Время выполнения:</span>
                  <span className="text-2xl font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                    {result.plan_b.execution_time_ms.toFixed(2)} ms
                  </span>
                  <span className="text-[10px] text-slate-400 block font-mono mt-0.5">
                    Планирование: {result.plan_b.planning_time_ms.toFixed(2)} ms
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">Строк обработано:</span>
                  <span className="text-2xl font-mono font-extrabold text-slate-800 dark:text-white">
                    {result.plan_b.actual_rows.toLocaleString()}
                  </span>
                  <span className="text-[10px] text-slate-400 block font-mono mt-0.5">
                    Стоимость: {result.plan_b.total_cost.toFixed(1)} cost
                  </span>
                </div>
              </div>

              {/* Shared Buffers Breakdown */}
              <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800/80">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Карта shared_buffers (PostgreSQL RAM):</span>
                  </span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                    {result.plan_b.total_buffers_kb.toLocaleString()} KB
                  </span>
                </div>

                {/* Progress bar of Hit vs Read */}
                <div className="w-full h-3 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden flex">
                  <div
                    style={{
                      width: `${(result.plan_b.shared_hit / Math.max(result.plan_b.shared_hit + result.plan_b.shared_read, 1)) * 100}%`,
                    }}
                    className="bg-emerald-500 h-full"
                    title={`Shared Hit (RAM): ${result.plan_b.shared_hit} блоков`}
                  />
                  <div
                    style={{
                      width: `${(result.plan_b.shared_read / Math.max(result.plan_b.shared_hit + result.plan_b.shared_read, 1)) * 100}%`,
                    }}
                    className="bg-sky-500 h-full"
                    title={`Shared Read: ${result.plan_b.shared_read} блоков`}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Shared Hit (из RAM):</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      {result.plan_b.shared_hit} бл. ({result.plan_b.shared_hit_kb} KB)
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Shared Read (в буфер):</span>
                    <span className="font-bold text-sky-600 dark:text-sky-400">
                      {result.plan_b.shared_read} бл. ({result.plan_b.shared_read_kb} KB)
                    </span>
                  </div>
                </div>
              </div>

              {/* Status Note */}
              <div className="p-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2 font-mono">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                <span>Индекс задействован: точечный O(log N) обход нужных страниц.</span>
              </div>
            </div>
          </div>

          {/* SHARED BUFFERS CAVEAT DISCLAIMER */}
          <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex items-start gap-3">
            <Info className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-bold text-slate-900 dark:text-white mr-1">
                *Важная специфика shared_buffers:
              </span>
              Метрики <code className="px-1 py-0.2 bg-slate-200 dark:bg-slate-800 rounded font-mono text-[11px]">shared hit</code> и <code className="px-1 py-0.2 bg-slate-200 dark:bg-slate-800 rounded font-mono text-[11px]">shared read</code> показывают статистику страниц памяти СУБД (по 8 КБ), а не гарантированное физическое чтение с диска. Данные, попавшие в <code className="px-1 py-0.2 bg-slate-200 dark:bg-slate-800 rounded font-mono text-[11px]">shared read</code>, могут браться напрямую из Linux Page Cache без обращения к физическому NVMe/SSD.
            </div>
          </div>

          {/* 5. INSIGHT ANALYSIS BOX */}
          <div className="p-5 rounded-2xl bg-brand-50/60 dark:bg-brand-950/30 border border-brand-200 dark:border-brand-900/60 text-slate-800 dark:text-slate-200 space-y-2">
            <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase text-brand-700 dark:text-brand-300">
              <Sparkles className="w-4 h-4 text-brand-500" />
              <span>{isRu ? 'Инженерный разбор: почему изменился план?' : 'Planner Insight & Root Cause'}</span>
            </div>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {result.insight}
            </p>
          </div>
        </div>
      )}

      {/* 6. DECISION MATRIX: SEQ SCAN vs INDEX SCAN vs BITMAP SCAN */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-6 shadow-sm space-y-4">
        <div>
          <span className="text-xs font-mono font-bold uppercase text-brand-600 dark:text-sky-400">
            {isRu ? 'Инженерная матрица решений' : 'Architecture Decision Matrix'}
          </span>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white mt-1">
            {isRu ? 'Сводка: Seq Scan vs Index Scan vs Bitmap Scan' : 'Summary: Seq Scan vs Index Scan vs Bitmap Scan'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isRu
              ? 'Как планировщик PostgreSQL выбирает стратегию чтения и когда индекс начинает вредить'
              : 'How the PostgreSQL cost-based optimizer decides scan nodes and when indexes hurt'}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
                <th className="p-3 font-semibold text-slate-700 dark:text-slate-300">Параметр</th>
                <th className="p-3 font-semibold text-rose-600 dark:text-rose-400">Seq Scan (Последовательный)</th>
                <th className="p-3 font-semibold text-emerald-600 dark:text-emerald-400">Index Scan (Точечный B-Tree)</th>
                <th className="p-3 font-semibold text-sky-600 dark:text-sky-400">Bitmap Heap Scan (Битовая карта)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-600 dark:text-slate-300">
              <tr>
                <td className="p-3 font-medium text-slate-900 dark:text-white">Объём чтения буферов</td>
                <td className="p-3">Вся таблица (все страницы до единой)</td>
                <td className="p-3">Только страницы индекса + точечные строки</td>
                <td className="p-3">Групповое пакетное чтение страниц по битовой карте</td>
              </tr>
              <tr>
                <td className="p-3 font-medium text-slate-900 dark:text-white">Когда выигрывает</td>
                <td className="p-3">&gt;15–20% строк или таблицы &lt;1 000 строк</td>
                <td className="p-3">&lt;5–10% выборки, точечные WHERE id = $1</td>
                <td className="p-3">10–25% строк, объединение нескольких индексов (OR)</td>
              </tr>
              <tr>
                <td className="p-3 font-medium text-slate-900 dark:text-white">Влияние SELECT *</td>
                <td className="p-3 font-bold text-rose-500">Катастрофическое: TOAST и вымывание RAM</td>
                <td className="p-3">Дорогое: переходы на диск за широкими строками</td>
                <td className="p-3">Умеренное: страницы читаются последовательно</td>
              </tr>
              <tr>
                <td className="p-3 font-medium text-slate-900 dark:text-white">Потребление shared_buffers</td>
                <td className="p-3">Вытесняет чужие кэшированные таблицы</td>
                <td className="p-3">Минимальное (дерево индекса держится в RAM)</td>
                <td className="p-3">Временная битовая карта в work_mem</td>
              </tr>
              <tr>
                <td className="p-3 font-medium text-slate-900 dark:text-white">Рекомендация в проде</td>
                <td className="p-3">Изолировать в реплику для аналитики</td>
                <td className="p-3">Основной стандарт для OLTP API</td>
                <td className="p-3">Идеально для сложных фильтров и GIN-индексов</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 7. LESSON: "ЧТО ЗАПОМНИТЬ" + CODE SNIPPET (EXACT PHOTO MATCH) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: 5 Key Principles (6 cols) */}
        <div className="lg:col-span-6 space-y-3 bg-slate-50 dark:bg-slate-950/60 p-5 rounded-2xl border border-slate-200 dark:border-slate-800">
          <div className="text-xs font-mono font-bold uppercase text-brand-600 dark:text-sky-400 mb-3">
            {isRu ? 'Памятка разработчику: что запомнить' : 'Core Principles to Remember'}
          </div>

          <div className="space-y-2.5 text-xs text-slate-700 dark:text-slate-300">
            <div className="flex gap-2.5 items-start">
              <span className="px-1.5 py-0.5 rounded bg-brand-100 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-mono font-bold text-[11px] shrink-0">
                01
              </span>
              <span>
                <strong>Индекс не гарантирует ускорение:</strong> Если условие WHERE отбирает более ~15% строк, Seq Scan почти всегда быстрее из-за последовательного чтения блоков вместо случайного I/O.
              </span>
            </div>

            <div className="flex gap-2.5 items-start">
              <span className="px-1.5 py-0.5 rounded bg-brand-100 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-mono font-bold text-[11px] shrink-0">
                02
              </span>
              <span>
                <strong>Токсичность SELECT *:</strong> Запрос широких колонок и JSONB заставляет PostgreSQL лезть в TOAST-хранилище, увеличивая shared_read в разы даже при наличии индекса.
              </span>
            </div>

            <div className="flex gap-2.5 items-start">
              <span className="px-1.5 py-0.5 rounded bg-brand-100 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-mono font-bold text-[11px] shrink-0">
                03
              </span>
              <span>
                <strong>Разница shared hit vs read:</strong> <code className="font-mono text-[10px] bg-slate-200 dark:bg-slate-800 px-1 py-0.2 rounded">hit</code> означает чтение из RAM СУБД (микросекунды). <code className="font-mono text-[10px] bg-slate-200 dark:bg-slate-800 px-1 py-0.2 rounded">read</code> — обращение к ядру ОС за страницей 8 КБ.
              </span>
            </div>

            <div className="flex gap-2.5 items-start">
              <span className="px-1.5 py-0.5 rounded bg-brand-100 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-mono font-bold text-[11px] shrink-0">
                04
              </span>
              <span>
                <strong>GIN для JSONB:</strong> Обычный B-Tree не умеет искать по внутренним полям JSONB. Оператор <code className="font-mono text-[10px] bg-slate-200 dark:bg-slate-800 px-1 py-0.2 rounded">@&gt;</code> требует <code className="font-mono text-[10px] bg-slate-200 dark:bg-slate-800 px-1 py-0.2 rounded">USING gin(payload)</code>.
              </span>
            </div>

            <div className="flex gap-2.5 items-start">
              <span className="px-1.5 py-0.5 rounded bg-brand-100 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-mono font-bold text-[11px] shrink-0">
                05
              </span>
              <span>
                <strong>Контроль задержки в коде:</strong> Всегда проставляйте <code className="font-mono text-[10px] bg-slate-200 dark:bg-slate-800 px-1 py-0.2 rounded">statement_timeout</code> (например 1500ms) на уровне пула соединений, чтобы плохой Seq Scan не замораживал воркеры.
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Code Snippet with Tab Switcher (6 cols) */}
        <div className="lg:col-span-6 bg-slate-950 text-slate-200 p-5 rounded-2xl border border-slate-800 font-mono text-xs shadow-md space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCodeTab('python')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                  codeTab === 'python'
                    ? 'bg-brand-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Python (FastAPI + asyncpg)
              </button>
              <button
                type="button"
                onClick={() => setCodeTab('sql')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                  codeTab === 'sql'
                    ? 'bg-brand-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                PostgreSQL (DDL + EXPLAIN)
              </button>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">PROD PATTERN</span>
          </div>

          {codeTab === 'python' ? (
            <pre className="p-3 rounded-xl bg-slate-900/90 text-slate-300 overflow-x-auto text-[11px] leading-relaxed">
              <code>{`# ✅ Безопасный асинхронный замер в FastAPI
async with db_pool.acquire() as conn:
    # 1. Защита от долгого Seq Scan
    await conn.execute("SET statement_timeout = '1500ms'")
    
    # 2. Получение JSON плана с буферами
    plan_json = await conn.fetchval(
        """EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
           SELECT id, query_name, buffer_cost 
           FROM probe_queries 
           WHERE created_at >= NOW() - INTERVAL '6 months'
           LIMIT 5000"""
    )
    
    root_node = json.loads(plan_json)[0]["Plan"]
    shared_hit = root_node.get("Shared Hit Blocks", 0)
    shared_read = root_node.get("Shared Read Blocks", 0)`}</code>
            </pre>
          ) : (
            <pre className="p-3 rounded-xl bg-slate-900/90 text-slate-300 overflow-x-auto text-[11px] leading-relaxed">
              <code>{`-- 1. Создание B-Tree индекса под диапазон дат
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_probe_created
ON probe_queries (created_at DESC);

-- 2. GIN индекс для мгновенного поиска по JSONB
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_probe_payload_gin
ON probe_queries USING gin (payload);

-- 3. Профилирование с реальным замером I/O
EXPLAIN (ANALYZE, BUFFERS, COSTS, TIMING)
SELECT id, query_name, buffer_cost
FROM probe_queries
WHERE created_at >= NOW() - INTERVAL '6 months'
  AND payload @> '{"labels": {"region": "eu-central"}}'
LIMIT 5000;`}</code>
            </pre>
          )}

          <div className="pt-2 text-[10px] text-slate-500 flex justify-between border-t border-slate-900">
            <span>Timeout: 1500 ms</span>
            <span>Isolation: Read Committed</span>
          </div>
        </div>
      </div>

      {/* 8. PARTNER / CLOUD POSTGRESQL SLOT (CLS = 0 with min-height) */}
      <div className="min-h-[220px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 p-6 text-white flex flex-col sm:flex-row items-center justify-between gap-6 shadow-sm">
        <div className="space-y-2 max-w-xl">
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-amber-400">
            <span>⭐ ПАРТНЁРСКИЙ БЛОК</span>
            <span>·</span>
            <span className="text-slate-400 font-normal">Cloud PostgreSQL</span>
          </div>
          <h4 className="text-xl font-extrabold text-white">
            Выделенный PostgreSQL 16 с pgvector и автонастройкой shared_buffers
          </h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            Автоматическое профилирование медленных запросов, превентивное обнаружение деградации Seq Scan и zero-downtime масштабирование дискового IOPS.
          </p>
        </div>

        <div className="shrink-0 text-center sm:text-right space-y-2">
          <div className="text-2xl font-mono font-extrabold text-emerald-400">
            от $15 <span className="text-xs font-normal text-slate-400">/ мес</span>
          </div>
          <button
            type="button"
            className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs transition-all shadow-md shadow-brand-500/20 cursor-pointer"
          >
            Развернуть песочницу
          </button>
        </div>
      </div>
    </div>
  );
};
