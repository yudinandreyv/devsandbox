import React from 'react';
import { ArrowUp, Zap, Server } from 'lucide-react';

interface ExpertAnalysisTableProps {
  onSelectCase?: (scenarioId: string) => void;
}

export const ExpertAnalysisTable: React.FC<ExpertAnalysisTableProps> = () => {
  const handleScrollToVisualizer = () => {
    const el = document.getElementById('pipeline-visualizer');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="space-y-6 pt-6" id="expert-analysis-table">
      {/* SECTION HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <span className="text-xs font-mono font-bold uppercase text-brand-600 dark:text-sky-400">
            Инженерная матрица решений
          </span>
          <h3 className="text-xl font-extrabold text-slate-900 dark:text-white mt-0.5">
            Сводка: Синхронная vs Асинхронная модель в продакшне
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Краткое руководство для архитекторов и бэкенд-разработчиков: когда переходить на Event Loop, 
            а когда достаточно классического пула процессов Gunicorn.
          </p>
        </div>

        <button
          type="button"
          onClick={handleScrollToVisualizer}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer w-fit"
        >
          <ArrowUp aria-hidden="true" className="w-3.5 h-3.5" />
          <span>К интерактивному стенду</span>
        </button>
      </div>

      {/* MATRIX TABLE */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 shadow-xs">
        <table className="w-full text-left border-collapse text-xs sm:text-sm">
          <caption className="sr-only">Сводная матрица: синхронная и асинхронная модели в продакшне</caption>
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 font-mono text-xs uppercase tracking-wider">
              <th scope="col" className="py-3 px-4 w-1/4">Параметр архитектуры</th>
              <th scope="col" className="py-3 px-4 w-3/8 text-amber-700 dark:text-amber-400">
                <div className="flex items-center gap-1.5">
                  <Server aria-hidden="true" className="w-4 h-4" />
                  <span>Синхронно (Gunicorn / WSGI)</span>
                </div>
              </th>
              <th scope="col" className="py-3 px-4 w-3/8 text-cyan-700 dark:text-cyan-400">
                <div className="flex items-center gap-1.5">
                  <Zap aria-hidden="true" className="w-4 h-4" />
                  <span>Асинхронно (FastAPI / Uvicorn / asyncio)</span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-sans">
            <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition-colors">
              <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                Одновременных запросов на воркер
              </td>
              <td className="py-3.5 px-4 font-mono text-slate-700 dark:text-slate-300">
                <strong className="text-amber-600 dark:text-amber-400">Ровно 1 запрос</strong> на 1 физический процесс ОС
              </td>
              <td className="py-3.5 px-4 font-mono text-slate-700 dark:text-slate-300">
                <strong className="text-cyan-600 dark:text-cyan-400">Десятки — тысячи</strong> корутин на 1 процесс
              </td>
            </tr>

            <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition-colors">
              <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                Пропускная способность (Throughput)
              </td>
              <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                <code className="text-[11px] font-mono bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded">
                  RPS = Воркеры / Задержка I/O
                </code>
                <div className="text-[11px] text-slate-500 mt-1">4 воркера при задержке 200мс = макс. 20 RPS</div>
              </td>
              <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                <code className="text-[11px] font-mono bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded">
                  RPS = 1 / (Время CPU между await)
                </code>
                <div className="text-[11px] text-slate-500 mt-1">Ограничено только вычислительной мощностью CPU</div>
              </td>
            </tr>

            <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition-colors">
              <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                Что происходит при перегрузке
              </td>
              <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                Очередь сокета переполняется, запросы падают с ошибкой <strong className="text-red-500">504 Gateway Timeout</strong>.
              </td>
              <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                Плавно растет P99 задержка и потребление RAM, но соединения продолжают удерживаться.
              </td>
            </tr>

            <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition-colors">
              <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                Главная точка отказа (Trap #1)
              </td>
              <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                Любой медленный сторонний вызов (банковский эквайринг, долгий SQL) блокирует весь воркер.
              </td>
              <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                <strong className="text-red-500 font-semibold">time.sleep() или requests.get()</strong> внутри <code className="text-[11px] font-mono">async def</code> наглухо вешает весь Event Loop!
              </td>
            </tr>

            <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition-colors">
              <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                Когда выбирать
              </td>
              <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                CPU-bound задачи, ML-инференс, классический Django без WebSockets, legacy синхронные библиотеки.
              </td>
              <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                I/O-bound сервисы, WebSockets, чаты, API шлюзы, сотни интеграций с микросервисами и БД.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* QUICK RULES BANNER */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-amber-600 dark:text-amber-400">
            <span>01</span>
            <span>1 воркер = 1 запрос</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            В синхронном Python воркер не берет следующий запрос, пока спит на сетевом сокете.
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-red-600 dark:text-red-400">
            <span>02</span>
            <span>Очередь = 4 × воркеры</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Превышение лимита бэклога сокета мгновенно выбрасывает 504 клиенту.
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-cyan-600 dark:text-cyan-400">
            <span>03</span>
            <span>await = отдать управление</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Event Loop переключает контекст мгновенно, не дожидаясь ответа от БД.
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-purple-600 dark:text-purple-400">
            <span>04</span>
            <span>time.sleep = стоп-кран</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Один синхронный вызов блокирует системный поток ядра для всех сотен корутин.
          </p>
        </div>
      </div>
    </div>
  );
};
