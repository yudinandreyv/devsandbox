import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Flame, RotateCcw, Activity, Zap, Server, Clock, Layers, ArrowRight } from 'lucide-react';

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

export const SyncAsyncPipelineVisualizer: React.FC<VisualizerProps> = () => {
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

  // Worker occupancy: map worker index -> remaining busy time ms
  const workersBusyRef = useRef<number[]>(new Array(4).fill(0));
  const queueMaxCapacity = workerCount * 4; // Bounded backlog: Gunicorn/Uvicorn backlog
  const nextIdRef = useRef<number>(1);
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Preset scenarios
  const applyPreset = (presetName: string) => {
    switch (presetName) {
      case 'light':
        setMode('sync');
        setConcurrency(8);
        setIoDelayMs(50);
        setIsBrokenEventLoop(false);
        break;
      case 'production':
        setMode('sync');
        setConcurrency(24);
        setIoDelayMs(160);
        setIsBrokenEventLoop(false);
        break;
      case 'async_optimal':
        setMode('async');
        setConcurrency(40);
        setIoDelayMs(160);
        setIsBrokenEventLoop(false);
        break;
      case 'broken_async':
        setMode('async');
        setConcurrency(30);
        setIoDelayMs(200);
        setIsBrokenEventLoop(true);
        break;
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

    // Draw horizontal grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let y = 20; y < height; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (history.length < 2) {
      ctx.fillStyle = '#475569';
      ctx.font = '11px monospace';
      ctx.fillText('⚡ Ожидание запуска симуляции потока...', 15, height / 2);
      return;
    }

    const stepX = width / Math.max(10, history.length - 1);

    // 1. Draw Latency Area (Amber / Red)
    ctx.beginPath();
    ctx.moveTo(0, height);
    history.forEach((pt, i) => {
      const x = i * stepX;
      // Latency scale: 0 - 600ms
      const y = height - Math.min(height - 10, (pt.latencyMs / 600) * (height - 20));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo((history.length - 1) * stepX, height);
    ctx.closePath();
    ctx.fillStyle = isBrokenEventLoop ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.12)';
    ctx.fill();

    // 2. Draw Latency Line
    ctx.beginPath();
    history.forEach((pt, i) => {
      const x = i * stepX;
      const y = height - Math.min(height - 10, (pt.latencyMs / 600) * (height - 20));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = isBrokenEventLoop ? '#ef4444' : '#f59e0b';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 3. Draw Throughput (RPS) Line (Cyan / Emerald)
    ctx.beginPath();
    history.forEach((pt, i) => {
      const x = i * stepX;
      // RPS scale: 0 - 250 RPS
      const y = height - Math.min(height - 10, (pt.rps / 250) * (height - 20));
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
        const x = i * stepX;
        const y = height - Math.min(height - 10, (pt.eventLoopLagMs / 500) * (height - 20));
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
            <span>Анатомия потока: Воркеры, Очередь и Event Loop в реальном времени</span>
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

      {/* SECTION 2: ARCHITECTURE MODE TOGGLE & PRESET STRIP */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Mode Switcher Buttons */}
          <div className="flex items-center gap-2 p-1.5 bg-slate-950 rounded-xl border border-slate-800 w-fit">
            <button
              onClick={() => { setMode('sync'); setIsBrokenEventLoop(false); }}
              className={`px-4 py-2 rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-2 cursor-pointer ${
                mode === 'sync'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Server className="w-4 h-4 text-amber-400" />
              <span>SYNC ARCHITECTURE (Gunicorn, 4 workers)</span>
            </button>

            <button
              onClick={() => setMode('async')}
              className={`px-4 py-2 rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-2 cursor-pointer ${
                mode === 'async'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-4 h-4 text-cyan-400" />
              <span>ASYNC ARCHITECTURE (Uvicorn / Event Loop)</span>
            </button>
          </div>

          {/* Load Profiles */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 font-medium mr-1 hidden sm:inline">Профиль нагрузки:</span>
            {(['steady', 'ramp', 'burst'] as TrafficProfile[]).map((p) => (
              <button
                key={p}
                onClick={() => setTrafficProfile(p)}
                className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors ${
                  trafficProfile === p
                    ? 'bg-slate-800 text-white border border-slate-700'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {p === 'steady' ? 'Ровный' : p === 'ramp' ? 'Разгон' : 'Пики'}
              </button>
            ))}
          </div>
        </div>

        {/* One-Click Production Presets */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80 text-xs">
          <span className="text-slate-500 font-mono text-[11px]">Готовые кейсы:</span>
          <button
            onClick={() => applyPreset('light')}
            className="px-2.5 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-medium transition-colors cursor-pointer"
          >
            1. Легкая нагрузка (8 req)
          </button>
          <button
            onClick={() => applyPreset('production')}
            className="px-2.5 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-medium transition-colors cursor-pointer"
          >
            2. Обычный рабочий день (24 req)
          </button>
          <button
            onClick={() => applyPreset('async_optimal')}
            className="px-2.5 py-1 rounded-md bg-cyan-950/60 border border-cyan-900/80 hover:bg-cyan-900/40 text-cyan-300 font-medium transition-colors cursor-pointer"
          >
            3. Тот же трафик на Async
          </button>
          <button
            onClick={() => applyPreset('broken_async')}
            className="px-2.5 py-1 rounded-md bg-red-950/60 border border-red-900/80 hover:bg-red-900/40 text-red-300 font-medium transition-colors cursor-pointer"
          >
            4. 💥 Async со скрытым time.sleep()
          </button>
        </div>
      </div>

      {/* SECTION 3: ANIMATED PHYSICAL PIPELINE STAGE (DIVIDED SPACE) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* STAGE 1: INGRESS & CONCURRENCY (3 Cols) */}
        <div className="lg:col-span-3 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono font-bold uppercase text-slate-400">1. Входящий поток</span>
              <span className="text-cyan-400 font-mono text-xs font-bold">{concurrency} rps</span>
            </div>
            <div className="text-[11px] text-slate-500 mb-3">
              Одновременные подключения пользователей, бьющие в HTTP endpoint.
            </div>

            {/* Slider */}
            <div className="space-y-1.5">
              <input
                type="range"
                min="4"
                max="60"
                step="2"
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                className="w-full accent-cyan-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono text-slate-500">
                <span>4 conn</span>
                <span>30 conn</span>
                <span>60 conn</span>
              </div>
            </div>
          </div>

          {/* I/O Latency slider */}
          <div className="pt-3 border-t border-slate-800">
            <div className="flex justify-between text-xs font-mono font-bold mb-1">
              <span className="text-slate-400">Задержка I/O / БД:</span>
              <span className="text-amber-400">{ioDelayMs} ms</span>
            </div>
            <input
              type="range"
              min="20"
              max="400"
              step="20"
              value={ioDelayMs}
              onChange={(e) => setIoDelayMs(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
              <span>20ms (In-Memory)</span>
              <span>400ms (Heavy SQL)</span>
            </div>
          </div>

          {/* Live Ingress Indicator */}
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Активных в пайплайне:</span>
            <span className="text-sm font-mono font-bold text-white">{activePackets.length}</span>
          </div>
        </div>

        {/* STAGE 2: BACKLOG BUFFER MATRIX & WORKER POOL (6 Cols) */}
        <div className="lg:col-span-6 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-mono font-bold uppercase text-slate-300">
                  2. Буфер очереди & Воркеры
                </span>
              </div>
              <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
                queuePackets.length >= queueMaxCapacity ? 'bg-red-950 text-red-400 border border-red-800 animate-pulse' : 'bg-slate-800 text-slate-300'
              }`}>
                Очередь: {queuePackets.length} / {queueMaxCapacity} слотов
              </span>
            </div>

            {/* Visual Buffer Slot Matrix (Animated grid) */}
            <div className="mb-4">
              <div className="text-[10px] text-slate-500 font-mono mb-1.5 flex justify-between">
                <span>СЕТКА ОЧЕРЕДИ ОС (BACKLOG BUFFER):</span>
                <span>{queuePackets.length >= queueMaxCapacity ? '⚠ ПЕРЕПОЛНЕНИЕ (504 DROPPED)' : 'Свободно для приема'}</span>
              </div>
              <div className="grid grid-cols-8 sm:grid-cols-12 gap-1 p-2 bg-slate-950 rounded-xl border border-slate-800">
                {Array.from({ length: queueMaxCapacity }).map((_, idx) => {
                  const isOccupied = idx < queuePackets.length;
                  return (
                    <div
                      key={idx}
                      className={`h-5 rounded-md transition-all duration-200 border ${
                        isOccupied
                          ? idx > queueMaxCapacity - 4
                            ? 'bg-red-500/80 border-red-400 shadow-sm shadow-red-500/30 animate-pulse'
                            : 'bg-amber-500/80 border-amber-400'
                          : 'bg-slate-900 border-slate-800/80'
                      }`}
                      title={isOccupied ? `Запрос #${queuePackets[idx]?.id} ждет свободного воркера` : 'Свободный слот очереди'}
                    />
                  );
                })}
              </div>
            </div>

            {/* Worker Process Lanes or Event Loop Engine */}
            <div>
              <div className="text-[10px] text-slate-500 font-mono mb-1.5">
                {mode === 'sync' ? 'СИНХРОННЫЕ ПРОЦЕССЫ (1 ЗАПРОС = 1 ПОТОК):' : 'АСИНХРОННЫЙ EVENT LOOP МУЛЬТИПЛЕКСОР:'}
              </div>

              {mode === 'sync' ? (
                /* Gunicorn Sync Workers */
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Array.from({ length: workerCount }).map((_, wIdx) => {
                    const isBusy = workersBusyRef.current[wIdx] > 0;
                    return (
                      <div
                        key={wIdx}
                        className={`p-2.5 rounded-xl border text-center transition-all ${
                          isBusy
                            ? 'bg-amber-950/40 border-amber-500/60 text-amber-200'
                            : 'bg-slate-950 border-slate-800 text-slate-500'
                        }`}
                      >
                        <div className="font-mono text-xs font-bold mb-1">Worker #{wIdx + 1}</div>
                        <div className="text-[10px] font-mono">
                          {isBusy ? (
                            <span className="text-amber-400 font-bold flex items-center justify-center gap-1">
                              <Clock className="w-3 h-3 animate-spin" />
                              <span>Блокировка I/O</span>
                            </span>
                          ) : (
                            <span className="text-emerald-400">Свободен</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Uvicorn Event Loop */
                <div className={`p-4 rounded-xl border transition-all ${
                  isBrokenEventLoop 
                    ? 'bg-red-950/40 border-red-500 text-red-200' 
                    : 'bg-cyan-950/30 border-cyan-500/40 text-cyan-200'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${isBrokenEventLoop ? 'bg-red-500 animate-ping' : 'bg-cyan-400 animate-pulse'}`} />
                      <span className="font-mono font-bold text-xs">
                        {isBrokenEventLoop ? 'Event Loop ЗАБЛОКИРОВАН (time.sleep)' : 'Event Loop активен (Zero-Lock non-blocking)'}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-bold">
                      {processingPackets.length} корутин на I/O
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 leading-relaxed">
                    {isBrokenEventLoop
                      ? '❌ Синхронный вызов внутри async def заморозил единственный системный поток. Все корутины висят!'
                      : '✓ Поток не блокируется: как только корутина делает await, цикл событий моментально берет следующую.'}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Break Event Loop Toggle Button */}
          <div className="pt-2 flex items-center justify-between">
            <button
              onClick={() => setIsBrokenEventLoop(prev => !prev)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-2 cursor-pointer ${
                isBrokenEventLoop
                  ? 'bg-red-600 text-white shadow-lg shadow-red-600/30 animate-pulse'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Flame className="w-4 h-4 text-amber-400" />
              <span>{isBrokenEventLoop ? '💥 Убрать time.sleep() инъекцию' : '💥 Сломать Event Loop (Inject time.sleep)'}</span>
            </button>
            <span className="text-[11px] font-mono text-slate-500">
              Lag: <strong className={eventLoopLag > 10 ? 'text-red-400' : 'text-emerald-400'}>{eventLoopLag} ms</strong>
            </span>
          </div>
        </div>

        {/* STAGE 3: EGRESS & REAL-TIME TELEMETRY STATS (3 Cols) */}
        <div className="lg:col-span-3 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono font-bold uppercase text-slate-400">3. Итог & Ответы</span>
              <span className="text-emerald-400 font-mono text-xs font-bold">{processedCount} done</span>
            </div>
            
            {/* Realtime KPI cards */}
            <div className="space-y-2">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80">
                <div className="text-[10px] text-slate-500 font-mono">РЕАЛЬНЫЙ THROUGHPUT:</div>
                <div className="text-xl font-bold font-mono text-cyan-400">{currentRps} <span className="text-xs text-slate-500">req/s</span></div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80">
                <div className="text-[10px] text-slate-500 font-mono">СРЕДНЯЯ ЗАДЕРЖКА:</div>
                <div className={`text-xl font-bold font-mono ${currentLatency > 300 ? 'text-red-400' : 'text-amber-400'}`}>
                  {currentLatency} <span className="text-xs text-slate-500">ms</span>
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80">
                <div className="text-[10px] text-slate-500 font-mono">ОТБРОШЕНО 504 TIMEOUT:</div>
                <div className={`text-xl font-bold font-mono ${dropped504Count > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                  {dropped504Count} <span className="text-xs text-slate-500">requests</span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Control Buttons */}
          <div className="space-y-2 pt-3 border-t border-slate-800">
            {!isRunning ? (
              <button
                onClick={() => setIsRunning(true)}
                className="w-full py-2.5 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs font-mono shadow-md shadow-cyan-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>ЗАПУСТИТЬ ПОТОК ТРАФИКА</span>
              </button>
            ) : (
              <button
                onClick={() => setIsRunning(false)}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs font-mono shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>ПАУЗА СИМУЛЯЦИИ</span>
              </button>
            )}

            <button
              onClick={handleReset}
              className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Сбросить счетчики</span>
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 4: REAL-TIME OSCILLOSCOPE GRAPH (LIVE CANVAS) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3" id="metrics-graph">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
              Осциллограф производительности в 60 FPS (Throughput vs Latency Waveform)
            </span>
          </div>

          <div className="flex items-center gap-4 text-[11px] font-mono">
            <span className="flex items-center gap-1.5 text-cyan-400">
              <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" /> Throughput (RPS)
            </span>
            <span className="flex items-center gap-1.5 text-amber-400">
              <span className="w-2.5 h-0.5 bg-amber-400 inline-block" /> Latency (ms)
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
            height={160}
            className="w-full h-40 block"
          />
        </div>
      </div>
    </div>
  );
};
