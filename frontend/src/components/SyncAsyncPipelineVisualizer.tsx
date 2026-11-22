import React, { useState, useEffect, useRef } from 'react';
import { Play, Flame, RotateCcw, Activity, Zap, Server, ArrowRight, Pause } from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import { RangeSlider } from './RangeSlider';
import { ParamWithTooltip, SpotlightCard } from './SpotlightCard';

interface VisualizerProps {
  onRunBackendProbe?: (scenario: string, concurrency: number, delayMs: number) => Promise<any>;
}

type ExecutionMode = 'sync' | 'async';
type TrafficProfile = 'steady' | 'ramp' | 'burst';

interface RequestPacket {
  id: number;
  createdAt: number;
  status: 'queue' | 'processing' | 'completed' | 'dropped';
  workerId?: number;
  startedAt?: number;
  durationMs: number;
  isBlocked?: boolean;
}

interface PerformancePoint {
  time: number;
  rps: number;
  latencyMs: number;
  eventLoopLagMs: number;
  droppedCount: number;
}

export const SyncAsyncPipelineVisualizer: React.FC<VisualizerProps> = ({ onRunBackendProbe }) => {
  const { locale } = useI18n();
  const isRu = locale === 'ru';
  // Mode configuration
  const [mode, setMode] = useState<ExecutionMode>('sync');
  const [trafficProfile, setTrafficProfile] = useState<TrafficProfile>('steady');
  const workerCount = 4;
  const [concurrency, setConcurrency] = useState<number>(20);
  const [ioDelayMs, setIoDelayMs] = useState<number>(180);
  const [isBrokenEventLoop, setIsBrokenEventLoop] = useState<boolean>(false);
  
  // Simulation runtime state
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [activePackets, setActivePackets] = useState<RequestPacket[]>([]);
  const [processedCount, setProcessedCount] = useState<number>(0);
  const [dropped504Count, setDropped504Count] = useState<number>(0);
  const [currentRps, setCurrentRps] = useState<number>(0);
  const [currentLatency, setCurrentLatency] = useState<number>(0);
  const [eventLoopLag, setEventLoopLag] = useState<number>(0.4);
  const [history, setHistory] = useState<PerformancePoint[]>([]);
  const [liveScenario, setLiveScenario] = useState('async_db_pool');
  const [isProbeRunning, setIsProbeRunning] = useState(false);
  const [probeResult, setProbeResult] = useState<any | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  // Worker occupancy: map worker index -> remaining busy time ms
  const workersBusyRef = useRef<number[]>(new Array(4).fill(0));
  const queueMaxCapacity = workerCount * 4; // Bounded backlog: Gunicorn/Uvicorn backlog
  const nextIdRef = useRef<number>(1);
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleLiveProbe = async () => {
    if (!onRunBackendProbe || isProbeRunning) return;
    setIsProbeRunning(true);
    setProbeError(null);
    try {
      const result = await onRunBackendProbe(liveScenario, concurrency, ioDelayMs);
      setProbeResult(result);
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : (isRu ? 'Не удалось связаться с API.' : 'Could not reach the API.'));
    } finally {
      setIsProbeRunning(false);
    }
  };

  // Reset counters
  const handleReset = () => {
    setIsRunning(false);
    setActivePackets([]);
    setProcessedCount(0);
    setDropped504Count(0);
    setCurrentRps(0);
    setCurrentLatency(0);
    setEventLoopLag(mode === 'async' && isBrokenEventLoop ? 320 : 0.5);
    setHistory([]);
    workersBusyRef.current = new Array(workerCount).fill(0);
  };

  // Simulation tick loop
  useEffect(() => {
    if (!isRunning) return;

    const intervalMs = 100;
    const interval = setInterval(() => {
      const now = Date.now();
      
      // Calculate effective incoming rate based on concurrency & profile
      let targetIncomingRate = concurrency;
      if (trafficProfile === 'ramp') {
        targetIncomingRate = Math.min(concurrency, Math.floor((now % 10000) / 10000 * concurrency) + 5);
      } else if (trafficProfile === 'burst') {
        targetIncomingRate = (now % 4000 < 1000) ? concurrency * 2 : Math.max(4, Math.floor(concurrency * 0.3));
      }

      // Generate incoming packets if queue space allows
      const packetsToAdd: RequestPacket[] = [];
      const currentQueueCount = activePackets.filter(p => p.status === 'queue').length;
      const packetsToSpawn = Math.max(1, Math.round(targetIncomingRate / 10));

      let newDropped = 0;
      for (let i = 0; i < packetsToSpawn; i++) {
        if (currentQueueCount + i >= queueMaxCapacity) {
          // 504 Gateway Timeout! Backlog saturated
          newDropped++;
        } else {
          packetsToAdd.push({
            id: nextIdRef.current++,
            createdAt: now,
            status: 'queue',
            durationMs: ioDelayMs,
            isBlocked: isBrokenEventLoop,
          });
        }
      }

      // Update worker allocations
      const updatedPackets = [...activePackets, ...packetsToAdd];
      let newlyFinished = 0;
      let totalLatencySum = 0;

      if (mode === 'sync') {
        // GUNICORN SYNC MODEL: 1 request per worker process at a time.
        // If worker is busy with I/O (time.sleep or DB), it completely halts until finished.
        for (let w = 0; w < workerCount; w++) {
          if (workersBusyRef.current[w] > 0) {
            workersBusyRef.current[w] -= intervalMs;
          }
          if (workersBusyRef.current[w] <= 0) {
            // Find next queued request
            const nextIdx = updatedPackets.findIndex(p => p.status === 'queue');
            if (nextIdx !== -1) {
              updatedPackets[nextIdx].status = 'processing';
              updatedPackets[nextIdx].workerId = w;
              updatedPackets[nextIdx].startedAt = now;
              workersBusyRef.current[w] = ioDelayMs;
            }
          }
        }

        // Check for finished packets
        updatedPackets.forEach((p) => {
          if (p.status === 'processing' && p.startedAt && (now - p.startedAt >= p.durationMs)) {
            p.status = 'completed';
            newlyFinished++;
            totalLatencySum += (now - p.createdAt);
          }
        });
      } else {
        // ASYNC UVICORN MODEL: Single process event loop handles hundreds of concurrent I/O coroutines!
        // UNLESS isBrokenEventLoop is true (blocking time.sleep in async def halts entire loop)
        if (isBrokenEventLoop) {
          // Event Loop blocked! Only 1 request gets CPU, everything freezes
          if (workersBusyRef.current[0] > 0) {
            workersBusyRef.current[0] -= intervalMs;
          } else {
            const nextIdx = updatedPackets.findIndex(p => p.status === 'queue');
            if (nextIdx !== -1) {
              updatedPackets[nextIdx].status = 'processing';
              updatedPackets[nextIdx].startedAt = now;
              // Synchronous blocking call locks whole event loop
              workersBusyRef.current[0] = ioDelayMs * 2.5;
            }
          }

          updatedPackets.forEach((p) => {
            if (p.status === 'processing' && p.startedAt && (now - p.startedAt >= ioDelayMs * 2.5)) {
              p.status = 'completed';
              newlyFinished++;
              totalLatencySum += (now - p.createdAt);
            }
          });
        } else {
          // Healthy Event Loop: All queued coroutines instantly transition to I/O await!
          updatedPackets.forEach((p) => {
            if (p.status === 'queue') {
              p.status = 'processing';
              p.startedAt = now;
            } else if (p.status === 'processing' && p.startedAt && (now - p.startedAt >= p.durationMs)) {
              p.status = 'completed';
              newlyFinished++;
              totalLatencySum += (now - p.createdAt);
            }
          });
        }
      }

      // Filter out completed packets older than 2 seconds to keep DOM fast
      const remainingPackets = updatedPackets.filter(p => !(p.status === 'completed' && (now - (p.startedAt || 0) > 1500)));
      setActivePackets(remainingPackets);

      if (newDropped > 0) {
        setDropped504Count(prev => prev + newDropped);
      }
      if (newlyFinished > 0) {
        setProcessedCount(prev => prev + newlyFinished);
      }

      // Compute instant metrics
      const calculatedRps = Math.round(newlyFinished * (1000 / intervalMs));
      const calculatedLatency = newlyFinished > 0 ? Math.round(totalLatencySum / newlyFinished) : ioDelayMs;
      const calculatedLag = mode === 'async' && isBrokenEventLoop 
        ? Math.min(850, Math.round(ioDelayMs * 2.8 + Math.random() * 20)) 
        : Number((Math.random() * 0.4 + 0.3).toFixed(1));

      setCurrentRps(calculatedRps);
      setCurrentLatency(calculatedLatency);
      setEventLoopLag(calculatedLag);

      // Record point for live canvas chart
      setHistory(prev => {
        const next = [...prev, {
          time: now,
          rps: calculatedRps,
          latencyMs: calculatedLatency,
          eventLoopLagMs: calculatedLag,
          droppedCount: newDropped,
        }];
        return next.slice(-40); // keep last 40 ticks
      });

    }, intervalMs);

    return () => clearInterval(interval);
  }, [isRunning, mode, concurrency, ioDelayMs, workerCount, trafficProfile, isBrokenEventLoop, activePackets, queueMaxCapacity]);

  // Render 60fps Canvas Chart (Smooth real-time wave graph)
  useEffect(() => {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear background
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, width, height);

    // Explicit latency scale and recent time marks.
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    [0, 200, 400, 600].forEach((value) => {
      const y = height - 18 - (value / 600) * (height - 30);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(42, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.fillText(String(value), 6, y + 3);
    });
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i += 1) {
      const x = 42 + ((width - 42) * i) / 4;
      ctx.fillStyle = '#64748b';
      ctx.fillText(i === 4 ? (isRu ? 'сейчас' : 'now') : '−' + (4 - i) + 's', x, height - 2);
    }

    if (history.length < 2) {
      ctx.fillStyle = '#475569';
      ctx.font = '11px monospace';
      ctx.fillText('⚡ Ожидание запуска симуляции потока...', 15, height / 2);
      return;
    }

    const plotBottom = height - 18;
    const plotHeight = height - 30;
    const plotWidth = width - 42;
    const scaleY = (value: number, max: number) => plotBottom - Math.min(1, Math.max(0, value / max)) * plotHeight;
    const stepX = plotWidth / Math.max(10, history.length - 1);

    // 1. Draw Latency Area (Amber / Red)
    ctx.beginPath();
    ctx.moveTo(42, plotBottom);
    history.forEach((pt, i) => {
      const x = 42 + i * stepX;
      // Latency scale: 0 - 600ms
      const y = scaleY(pt.latencyMs, 600);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(42 + (history.length - 1) * stepX, plotBottom);
    ctx.closePath();
    ctx.fillStyle = isBrokenEventLoop ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.12)';
    ctx.fill();

    // 2. Draw Latency Line
    ctx.beginPath();
    history.forEach((pt, i) => {
      const x = 42 + i * stepX;
      const y = scaleY(pt.latencyMs, 600);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = isBrokenEventLoop ? '#ef4444' : '#f59e0b';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 3. Draw {isRu ? "Пропускная способность" : "Throughput"} · 0–250 req/s Line (Cyan / Emerald)
    ctx.beginPath();
    history.forEach((pt, i) => {
      const x = 42 + i * stepX;
      // RPS scale: 0 - 250 RPS
      const y = scaleY(pt.rps, 250);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 4. Draw Event Loop Lag Pulse Line (Purple)
    if (mode === 'async') {
      ctx.beginPath();
      history.forEach((pt, i) => {
        const x = 42 + i * stepX;
        const y = scaleY(pt.eventLoopLagMs, 500);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

  }, [history, isBrokenEventLoop, mode]);

  const queuePackets = activePackets.filter(p => p.status === 'queue');
  const processingPackets = activePackets.filter(p => p.status === 'processing');

  return (
    <div className="space-y-6 text-slate-100 font-sans" id="pipeline-visualizer">
      {/* SECTION 1: HEADER & DESCRIPTIVE PURPOSE */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-sky-950 text-sky-400 border border-sky-800">
              Interactive Hardware & Concurrency Stand
            </span>
            <span className="text-slate-500 text-xs font-mono">v1.2.0</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>Sync vs Async: как запрос проходит через сервер</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-2xl mt-1 leading-relaxed">
            Наглядная визуализация физических процессов сервера под нагрузкой. Посмотрите, как ведут себя 
            синхронные процессы Gunicorn в сравнении с асинхронным циклом Uvicorn при блокировках I/O.
          </p>
        </div>

        {/* Anchor Quick Navigation Link */}
        <div className="flex items-center gap-2 shrink-0">
          <a
            href="#expert-analysis-table"
            className="text-xs font-medium text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1 bg-sky-950/60 border border-sky-900 px-3 py-1.5 rounded-lg"
          >
            <span>Сводная таблица выбора</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>


      {/* One settings panel and one live pipeline */}
      <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-4">
        <SpotlightCard className="h-full border border-slate-700/80 bg-black backdrop-blur-sm">
        <aside className="relative z-10 p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">{isRu ? 'Настройки опыта' : 'Experiment settings'}</h3>
            <span className={'text-[10px] font-mono px-2 py-1 rounded-full ' + (isRunning ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400')}>
              {isRunning ? (isRu ? 'ИДЁТ' : 'RUNNING') : (isRu ? 'ПАУЗА' : 'PAUSED')}
            </span>
          </div>
          <ParamWithTooltip
            label={isRu ? 'Модель выполнения' : 'Execution model'}
            description={isRu ? 'Sync занимает процесс на всё время одного запроса. Async освобождает цикл событий, пока корутина ждёт ввод-вывод.' : 'Sync occupies one process for a whole request. Async lets the event loop run other coroutines while I/O is pending.'}
          >
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setMode('sync'); setIsBrokenEventLoop(false); }}
                title={isRu ? 'Один worker выполняет один запрос за раз' : 'Each worker handles one request at a time'}
                className={'rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors ' + (mode === 'sync' ? 'border-amber-400/60 bg-amber-500/15 text-amber-200' : 'border-slate-700 bg-slate-950/50 text-slate-400 hover:text-slate-200')}>
                <Server className="w-3.5 h-3.5 mx-auto mb-1" />Sync · 4
              </button>
              <button type="button" onClick={() => setMode('async')}
                title={isRu ? 'await освобождает цикл событий на время I/O' : 'await lets the event loop handle other I/O tasks'}
                className={'rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors ' + (mode === 'async' ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200' : 'border-slate-700 bg-slate-950/50 text-slate-400 hover:text-slate-200')}>
                <Zap className="w-3.5 h-3.5 mx-auto mb-1" />Async · I/O
              </button>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-500">
              {mode === 'sync' ? (isRu ? 'Занятый worker ждёт завершения запроса.' : 'A busy worker waits for its request to finish.') : (isRu ? 'На await Event Loop запускает другие корутины.' : 'At await, the event loop runs other coroutines.')}
            </p>
          </ParamWithTooltip>
          <div className="border-t border-slate-800 pt-3">
          <ParamWithTooltip
            label={isRu ? 'Входящая нагрузка' : 'Incoming load'}
            value={<span className="font-mono text-cyan-300">{concurrency} req/s</span>}
            description={isRu ? 'Задаёт скорость поступления запросов в симулятор и число конкурентных запросов для реального API-замера.' : 'Sets the request arrival rate in the simulator and the concurrency value sent with a live API probe.'}
          >
            <RangeSlider id="traffic-rate" label={isRu ? 'Входящие запросы в секунду' : 'Incoming requests per second'} min={4} max={50} step={2} value={concurrency} onChange={setConcurrency} className="accent-cyan-400 cursor-pointer" />
            <p className="text-[10px] text-slate-500">{isRu ? 'Сколько запросов поступает каждую секунду.' : 'Requests entering the system each second.'}</p>
          </ParamWithTooltip>
          </div>
          <div className="border-t border-slate-800 pt-3">
          <ParamWithTooltip
            label={isRu ? 'Ожидание I/O' : 'I/O wait'}
            value={<span className="font-mono text-amber-300">{ioDelayMs} ms</span>}
            description={isRu ? 'Моделирует время ожидания ответа базы данных или сети для каждого запроса.' : 'Models how long each request waits for a database or network response.'}
          >
            <RangeSlider id="io-delay" label={isRu ? 'Задержка ввода-вывода' : 'I/O delay'} min={20} max={400} step={20} value={ioDelayMs} onChange={setIoDelayMs} className="accent-amber-400 cursor-pointer" />
            <p className="text-[10px] text-slate-500">{isRu ? 'Время ожидания БД или сети для одного запроса.' : 'Database or network wait time per request.'}</p>
          </ParamWithTooltip>
          </div>
          <div className="border-t border-slate-800 pt-3">
          <ParamWithTooltip
            label={isRu ? 'Профиль поступления' : 'Traffic pattern'}
            description={isRu ? 'Ровно распределяет запросы, постепенно увеличивает нагрузку или создаёт короткие всплески.' : 'Distributes requests steadily, ramps load up, or creates short bursts.'}
          >
            <div className="grid grid-cols-3 gap-1">
              {(['steady', 'ramp', 'burst'] as TrafficProfile[]).map((profile) => (
                <button key={profile} type="button" onClick={() => setTrafficProfile(profile)}
                  className={'rounded-md px-1.5 py-1.5 text-[10px] font-medium transition-colors ' + (trafficProfile === profile ? 'bg-slate-700 text-white' : 'bg-slate-950/60 text-slate-400 hover:text-slate-200')}>
                  {profile === 'steady' ? (isRu ? 'Ровно' : 'Steady') : profile === 'ramp' ? (isRu ? 'Разгон' : 'Ramp') : (isRu ? 'Пики' : 'Bursts')}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500">{isRu ? 'Меняет равномерность входящего потока.' : 'Changes how evenly requests arrive.'}</p>
          </ParamWithTooltip>
          </div>
          <div className="border-t border-slate-800 pt-3">
            <button type="button" onClick={() => setIsBrokenEventLoop((previous) => !previous)} disabled={mode !== 'async'}
              title={isRu ? 'Показывает эффект блокирующего time.sleep() внутри async def' : 'Shows blocking time.sleep() inside async def'}
              className={'w-full rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' + (isBrokenEventLoop ? 'border-red-500/60 bg-red-500/15 text-red-200' : 'border-slate-700 bg-slate-950/50 text-slate-300 hover:border-red-500/50')}>
              <span className="flex items-center gap-2 text-[11px] font-semibold"><Flame className="w-3.5 h-3.5 text-amber-400" />{isRu ? 'Блокирующий time.sleep()' : 'Blocking time.sleep()'}<span className="ml-auto">{isBrokenEventLoop ? 'ON' : 'OFF'}</span></span>
              <span className="mt-1 block pl-5 text-[10px] text-slate-500">{isRu ? 'Замораживает Event Loop во время ожидания.' : 'Freezes the event loop during the wait.'}</span>
            </button>
          </div>
          <div className="space-y-2 border-t border-slate-800 pt-3">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="live-api-scenario" className="text-[10px] font-mono uppercase tracking-wide text-slate-500">{isRu ? 'Реальный API-замер' : 'Live API probe'}</label>
              <span className="text-[9px] text-emerald-300">{isRu ? 'сервер' : 'server'}</span>
            </div>
            <select id="live-api-scenario" value={liveScenario} onChange={(event) => setLiveScenario(event.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-[10px] text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500">
              <option value="async_db_pool">Async DB pool</option>
              <option value="sync_blocking_db">Blocking call in async</option>
              <option value="n_plus_one_trap">N+1 database calls</option>
              <option value="overfetching_select_all">SELECT * / overfetching</option>
            </select>
            <p className="text-[10px] text-slate-500">{isRu ? 'Использует значения нагрузки и I/O выше; это настоящий HTTP-запрос.' : 'Uses the load and I/O settings above; sends a real HTTP request.'}</p>
            <button type="button" onClick={handleLiveProbe} disabled={!onRunBackendProbe || isProbeRunning}
              className="w-full rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-2 text-[11px] font-semibold text-white transition-colors">
              {isProbeRunning ? (isRu ? 'Измеряю API…' : 'Probing API…') : (isRu ? 'Запустить реальный замер' : 'Run live API probe')}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-slate-800 pt-3">
            <button type="button" onClick={() => setIsRunning((running) => !running)}
              className={'rounded-lg px-3 py-2.5 text-xs font-bold text-white transition-colors ' + (isRunning ? 'bg-amber-600 hover:bg-amber-500' : 'bg-cyan-600 hover:bg-cyan-500')}>
              {isRunning ? <Pause className="w-4 h-4 inline mr-1" /> : <Play className="w-4 h-4 inline mr-1" />}
              {isRunning ? (isRu ? 'Пауза' : 'Pause') : (isRu ? 'Запустить' : 'Run')}
            </button>
            <button type="button" onClick={handleReset} className="rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors">
              <RotateCcw className="w-3.5 h-3.5 inline mr-1" />{isRu ? 'Сброс' : 'Reset'}
            </button>
          </div>
        </aside>
        </SpotlightCard>

        <SpotlightCard className="min-w-0 border border-slate-700/80 bg-black backdrop-blur-sm">
        <section className="relative z-10 min-w-0 p-4 sm:p-5 space-y-4" aria-label={isRu ? 'Визуализация задач' : 'Task visualization'}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white">{isRu ? 'Путь запроса' : 'Request path'}</h3>
              <p className="text-[10px] text-slate-500">{isRu ? 'Карточки показывают задачи текущей симуляции' : 'Tiles show tasks in this live simulation'}</p>
            </div>
            <div className="flex gap-3 text-[10px] font-mono text-slate-400">
              <span>{isRu ? 'очередь' : 'queued'} <b className="text-amber-300">{queuePackets.length}</b></span>
              <span>{isRu ? 'в работе' : 'running'} <b className="text-cyan-300">{processingPackets.length}</b></span>
              <span>{isRu ? 'ответы' : 'done'} <b className="text-emerald-300">{processedCount}</b></span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[0.8fr_1.1fr_2fr_0.8fr] gap-2 items-stretch">
            <div className="rounded-xl border border-cyan-500/25 bg-cyan-950/15 p-3 min-w-0">
              <div className="flex justify-between items-center text-[10px] font-mono uppercase text-cyan-200"><span>{isRu ? 'Вход' : 'Ingress'}</span><span>{concurrency}/s</span></div>
              <div className="mt-3 flex h-9 items-center gap-1 overflow-hidden" aria-label={isRu ? 'Поступающие запросы' : 'Incoming requests'}>
                {Array.from({ length: Math.min(12, Math.max(4, Math.round(concurrency / 5))) }, (_, index) => (
                  <span key={index} className="packet-enter h-5 w-3 shrink-0 rounded-sm bg-cyan-400/80 shadow-sm shadow-cyan-400/30" style={{ animationDelay: String(index * 35) + 'ms' }} />
                ))}
              </div>
              <div className="text-[10px] text-slate-500">{isRu ? 'запросов в секунду' : 'requests per second'}</div>
            </div>
            <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-3 min-w-0">
              <div className="flex justify-between items-center text-[10px] font-mono uppercase text-amber-200"><span>{isRu ? 'Очередь' : 'Queue'}</span><span>{queuePackets.length}/{queueMaxCapacity}</span></div>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {queuePackets.slice(0, queueMaxCapacity).map((packet) => (
                  <span key={packet.id} className="packet-enter flex h-7 items-center justify-center rounded border border-amber-400/40 bg-amber-500/25 text-[9px] font-mono text-amber-100" title={isRu ? 'Задача ждёт свободный worker' : 'Task waiting for a free worker'}>{packet.id}</span>
                ))}
                {queuePackets.length === 0 && <span className="col-span-4 py-2 text-center text-[10px] text-slate-600">{isRu ? 'пусто' : 'empty'}</span>}
              </div>
              <div className="mt-2 text-[10px] text-slate-500">{isRu ? 'ждут свободного исполнителя' : 'waiting for capacity'}</div>
            </div>
            <div className={'rounded-xl border p-3 min-w-0 transition-colors ' + (mode === 'sync' ? 'border-amber-500/25 bg-amber-950/10' : isBrokenEventLoop ? 'border-red-500/40 bg-red-950/20' : 'border-cyan-500/25 bg-cyan-950/10')}>
              <div className="flex justify-between items-center text-[10px] font-mono uppercase text-slate-300"><span>{mode === 'sync' ? (isRu ? 'Workers · 1 задача на процесс' : 'Workers · 1 task each') : 'Event Loop · coroutines'}</span><span>{mode === 'sync' ? workerCount : processingPackets.length}</span></div>
              {mode === 'sync' ? (
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {Array.from({ length: workerCount }, (_, workerIndex) => {
                    const packet = processingPackets.find((task) => task.workerId === workerIndex);
                    const isBusy = workersBusyRef.current[workerIndex] > 0;
                    return <div key={workerIndex} className="packet-enter min-h-12 rounded-lg border border-slate-700/70 bg-slate-950/30 p-1.5">
                      <div className="text-[9px] font-mono text-slate-500">W{workerIndex + 1}</div>
                      <div className={'text-[10px] font-mono ' + (packet ? 'text-amber-200' : 'text-slate-600')}>{packet ? '#' + packet.id + ' · ' + ioDelayMs + 'ms' : isBusy ? 'I/O…' : (isRu ? 'свободен' : 'idle')}</div>
                    </div>;
                  })}
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 max-h-28 overflow-y-auto">
                  {processingPackets.slice(0, 20).map((packet) => (
                    <div key={packet.id} className={'packet-enter rounded-lg border p-1.5 text-[10px] font-mono ' + (isBrokenEventLoop ? 'border-red-400/50 bg-red-500/15 text-red-200' : 'border-cyan-400/40 bg-cyan-500/15 text-cyan-100')} title={isBrokenEventLoop ? (isRu ? 'Ждёт разблокировки Event Loop' : 'Waiting for event loop to unblock') : (isRu ? 'Корутина ждёт I/O, не блокируя цикл' : 'Coroutine awaiting I/O without blocking the loop')}>#{packet.id} · await</div>
                  ))}
                  {processingPackets.length === 0 && <span className="col-span-full py-2 text-center text-[10px] text-slate-600">{isRu ? 'нет активных задач' : 'no active tasks'}</span>}
                  {processingPackets.length > 20 && <span className="col-span-full text-[10px] text-slate-500">+{processingPackets.length - 20}</span>}
                </div>
              )}
              <div className="mt-2 text-[10px] text-slate-500">{mode === 'sync' ? (isRu ? 'процессы заняты запросами' : 'workers occupied by requests') : (isBrokenEventLoop ? (isRu ? 'блокировка удерживает весь цикл' : 'blocking call stalls the loop') : (isRu ? 'задачи ждут I/O одновременно' : 'tasks await I/O concurrently'))}</div>
            </div>
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/15 p-3 min-w-0">
              <div className="flex justify-between items-center text-[10px] font-mono uppercase text-emerald-200"><span>{isRu ? 'Ответы' : 'Replies'}</span><span>{processedCount}</span></div>
              <div className="mt-2 flex flex-wrap gap-1 min-h-7">
                {activePackets.filter((packet) => packet.status === 'completed').slice(-8).map((packet) => (
                  <span key={packet.id} className="packet-enter rounded border border-emerald-400/30 bg-emerald-500/15 px-1.5 py-1 text-[9px] font-mono text-emerald-200">#{packet.id}</span>
                ))}
                {dropped504Count > 0 && <span className="rounded border border-red-500/40 bg-red-500/15 px-1.5 py-1 text-[9px] font-mono text-red-200">504 ×{dropped504Count}</span>}
              </div>
              <div className="mt-2 text-[10px] text-slate-500">{isRu ? 'выполнено / потеряно' : 'completed / dropped'}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-slate-800 pt-3">
            <div className="rounded-lg bg-slate-950/40 p-2"><div className="text-[9px] uppercase text-slate-500">Throughput</div><div className="font-mono text-sm text-cyan-300">{currentRps} <small className="text-[10px] text-slate-500">req/s</small></div></div>
            <div className="rounded-lg bg-slate-950/40 p-2"><div className="text-[9px] uppercase text-slate-500">{isRu ? 'Задержка' : 'Latency'}</div><div className="font-mono text-sm text-amber-300">{currentLatency} <small className="text-[10px] text-slate-500">ms</small></div></div>
            <div className="rounded-lg bg-slate-950/40 p-2"><div className="text-[9px] uppercase text-slate-500">Event Loop Lag</div><div className={'font-mono text-sm ' + (eventLoopLag > 10 ? 'text-red-300' : 'text-emerald-300')}>{eventLoopLag} <small className="text-[10px] text-slate-500">ms</small></div></div>
            <div className="rounded-lg bg-slate-950/40 p-2"><div className="text-[9px] uppercase text-slate-500">{isRu ? 'Потери' : 'Dropped'}</div><div className={'font-mono text-sm ' + (dropped504Count ? 'text-red-300' : 'text-slate-300')}>{dropped504Count}</div></div>
          </div>

          <div className="border-t border-slate-800 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h4 className="text-[11px] font-semibold text-slate-200">{isRu ? 'Результат реального API-замера' : 'Live API result'}</h4>
              <span className="text-[9px] font-mono uppercase text-emerald-400">HTTP · Prometheus audit</span>
            </div>
            {probeError ? (
              <p role="alert" className="rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-2 text-[10px] text-red-300">{probeError}</p>
            ) : probeResult ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg bg-slate-950/50 p-2"><div className="text-[9px] uppercase text-slate-500">{isRu ? 'Время' : 'Elapsed'}</div><div className="font-mono text-xs text-emerald-300">{probeResult.actual_elapsed_ms ?? '—'} ms</div></div>
                  <div className="rounded-lg bg-slate-950/50 p-2"><div className="text-[9px] uppercase text-slate-500">Throughput</div><div className="font-mono text-xs text-cyan-300">{probeResult.effective_rps ?? '—'} req/s</div></div>
                  <div className="rounded-lg bg-slate-950/50 p-2"><div className="text-[9px] uppercase text-slate-500">Event Loop Lag</div><div className="font-mono text-xs text-amber-300">{probeResult.event_loop_lag_ms ?? '—'} ms</div></div>
                  <div className="rounded-lg bg-slate-950/50 p-2"><div className="text-[9px] uppercase text-slate-500">{isRu ? 'SQL-запросы' : 'DB roundtrips'}</div><div className="font-mono text-xs text-slate-200">{probeResult.queries_executed ?? '—'}</div></div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                  <span>{isRu ? 'Просканировано' : 'Data scanned'}: {typeof probeResult.data_scanned_bytes === 'number' ? (probeResult.data_scanned_bytes / 1048576).toFixed(3) + ' MB' : '—'}</span>
                  <span className={probeResult.event_loop_blocked ? 'text-red-300' : 'text-emerald-300'}>{probeResult.event_loop_blocked ? (isRu ? 'Event Loop заблокирован' : 'Event Loop blocked') : (isRu ? 'Event Loop отвечает' : 'Event Loop responsive')}</span>
                </div>
                {probeResult.insight && <p className="rounded-lg bg-slate-950/40 px-3 py-2 text-[10px] leading-relaxed text-slate-300">{probeResult.insight}</p>}
              </div>
            ) : (
              <p className="text-[10px] text-slate-500">{isRu ? 'Запусти замер слева: здесь появятся измеренные задержка, пропускная способность и число запросов к БД.' : 'Run the probe on the left to see measured latency, throughput, and database roundtrips.'}</p>
            )}
          </div>

          {/* Keep the load chart next to the live result it contextualizes. */}
          <div className="border border-slate-700/80 rounded-2xl p-4 sm:p-5 space-y-3 bg-black" id="metrics-graph">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
                  {isRu ? 'График нагрузки: пропускная способность и задержка' : 'Load timeline: throughput and latency'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono">
                <span className="flex items-center gap-1.5 text-cyan-400">
                  <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" /> {isRu ? "Пропускная способность" : "Throughput"} · 0–250 req/s
                </span>
                <span className="flex items-center gap-1.5 text-amber-400">
                  <span className="w-2.5 h-0.5 bg-amber-400 inline-block" /> {isRu ? "Задержка" : "Latency"} · 0–600 ms
                </span>
                {mode === 'async' && (
                  <span className="flex items-center gap-1.5 text-purple-400">
                    <span className="w-2.5 h-0.5 border-t border-dashed border-purple-400 inline-block" /> Event Loop Lag
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-xl overflow-hidden border border-slate-800 bg-[#090d16]">
              <canvas
                ref={chartCanvasRef}
                width={900}
                height={180}
                role="img"
                aria-label={isRu ? 'График метрик нагрузки за последние секунды' : 'Load metrics over recent seconds'}
                className="w-full h-44 block"
              />
            </div>
          </div>
        </section>
        </SpotlightCard>
      </div>
    </div>
  );
};
