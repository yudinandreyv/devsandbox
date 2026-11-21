import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types (mirrors backend Pydantic models)
// ---------------------------------------------------------------------------

type PodStatus = "Running" | "Pending" | "CrashLoopBackOff" | "Terminating";

interface PodHealth {
  pod_id: string;
  status: PodStatus;
  ready: boolean;
  cpu_percent: number;
  memory_mb: number;
  p99_latency_ms: number;
  rps: number;
  errors_per_min: number;
}

interface DeploymentSlot {
  color: "blue" | "green";
  version: string;
  weight: number;
  replicas: number;
  healthy_replicas: number;
  pods: PodHealth[];
  avg_latency_ms: number;
  total_rps: number;
  error_rate_percent: number;
}

interface GatewayState {
  algorithm: string;
  sticky_sessions: boolean;
  health_check_interval_s: number;
  total_rps: number;
  p99_latency_ms: number;
  dropped_packets: number;
}

interface TopologySnapshot {
  trainer: string;
  version: string;
  scenario: string;
  timestamp_ms: number;
  blue: DeploymentSlot;
  green: DeploymentSlot;
  gateway: GatewayState;
  shift_in_progress: boolean;
  insight: string;
}

interface ScenarioInfo {
  id: string;
  label_en: string;
  label_ru: string;
  description_en: string;
  description_ru: string;
  initial_blue_weight: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API = "/api/v1/probe/blue-green";

const statusColor: Record<PodStatus, string> = {
  Running: "text-green-500",
  Pending: "text-yellow-500",
  CrashLoopBackOff: "text-red-500",
  Terminating: "text-orange-400",
};

const statusDot: Record<PodStatus, string> = {
  Running: "bg-green-400",
  Pending: "bg-yellow-400",
  CrashLoopBackOff: "bg-red-500 animate-pulse",
  Terminating: "bg-orange-400",
};

function fmt(n: number, dec = 1): string {
  return n.toFixed(dec);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PodCard({ pod }: { pod: PodHealth }) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-xs space-y-1">
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full inline-block ${statusDot[pod.status]}`} />
        <span className="font-mono font-semibold text-gray-700 dark:text-gray-200">
          {pod.pod_id}
        </span>
        <span className={`ml-auto font-semibold ${statusColor[pod.status]}`}>
          {pod.status}
        </span>
      </div>
      {pod.ready && (
        <div className="grid grid-cols-2 gap-x-2 text-gray-500 dark:text-gray-400">
          <span>CPU {fmt(pod.cpu_percent)} %</span>
          <span>Mem {fmt(pod.memory_mb, 0)} MB</span>
          <span>p99 {fmt(pod.p99_latency_ms)} ms</span>
          <span>RPS {fmt(pod.rps, 0)}</span>
          {pod.errors_per_min > 0 && (
            <span className="text-red-400 col-span-2">
              err {fmt(pod.errors_per_min)}/min
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SlotPanel({ slot }: { slot: DeploymentSlot }) {
  const accent =
    slot.color === "blue"
      ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30"
      : "border-green-400 bg-green-50 dark:bg-green-950/30";
  const badge =
    slot.color === "blue"
      ? "bg-blue-500 text-white"
      : "bg-green-500 text-white";

  return (
    <div className={`rounded-xl border-2 ${accent} p-4 flex flex-col gap-3`}>
      {/* header */}
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${badge}`}>
          {slot.color}
        </span>
        <span className="font-mono text-sm text-gray-600 dark:text-gray-300">
          {slot.version}
        </span>
        <span className="ml-auto text-lg font-bold text-gray-800 dark:text-white">
          {slot.weight} %
        </span>
      </div>

      {/* aggregate metrics */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <Metric label="RPS" value={fmt(slot.total_rps, 0)} />
        <Metric label="p99 ms" value={fmt(slot.avg_latency_ms)} />
        <Metric
          label="Errors %"
          value={fmt(slot.error_rate_percent, 3)}
          warn={slot.error_rate_percent > 1}
        />
      </div>

      {/* pods */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {slot.pods.map((p) => (
          <PodCard key={p.pod_id} pod={p} />
        ))}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        {slot.healthy_replicas}/{slot.replicas} pods ready
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg py-1 px-2 shadow-sm">
      <p className="text-xs text-gray-400 dark:text-gray-500">{label}</p>
      <p
        className={`text-base font-bold ${
          warn ? "text-red-500" : "text-gray-800 dark:text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function GatewayPanel({ gw }: { gw: GatewayState }) {
  return (
    <div className="rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 p-4">
      <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
        🌐 Gateway / Load Balancer
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <Metric label="Total RPS" value={fmt(gw.total_rps, 0)} />
        <Metric label="p99 ms" value={fmt(gw.p99_latency_ms)} />
        <Metric label="Dropped pkts" value={String(gw.dropped_packets)} warn={gw.dropped_packets > 0} />
        <Metric label="Algorithm" value={gw.algorithm.replace("_", " ")} />
      </div>
    </div>
  );
}

// Traffic flow SVG diagram
function TrafficDiagram({
  blueWeight,
  greenWeight,
}: {
  blueWeight: number;
  greenWeight: number;
}) {
  const bw = Math.max(blueWeight, 0);
  const gw = Math.max(greenWeight, 0);
  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 py-4 select-none">
      {/* Internet */}
      <div className="flex flex-col items-center">
        <div className="w-14 h-14 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-2xl shadow">
          🌍
        </div>
        <span className="text-xs mt-1 text-gray-500">Users</span>
      </div>

      {/* Arrow to gateway */}
      <div className="flex flex-col items-center">
        <span className="text-gray-400 text-xl">→</span>
      </div>

      {/* Gateway */}
      <div className="flex flex-col items-center">
        <div className="w-16 h-14 rounded-lg bg-purple-100 dark:bg-purple-900/40 border-2 border-purple-400 flex items-center justify-center text-xs font-bold text-purple-700 dark:text-purple-300 shadow text-center leading-tight px-1">
          LB / Gateway
        </div>
      </div>

      {/* Arrows to pools */}
      <div className="flex flex-col items-center gap-6">
        {/* Blue arrow */}
        <div className="flex items-center gap-1">
          <span className="text-blue-400 text-xl">→</span>
          <span className="text-xs font-bold text-blue-500">{bw}%</span>
        </div>
        {/* Green arrow */}
        <div className="flex items-center gap-1">
          <span className="text-green-400 text-xl">→</span>
          <span className="text-xs font-bold text-green-500">{gw}%</span>
        </div>
      </div>

      {/* Pools */}
      <div className="flex flex-col gap-4">
        <div className="w-20 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 border-2 border-blue-400 flex items-center justify-center text-xs font-bold text-blue-700 dark:text-blue-300 shadow">
          BLUE v1.4
        </div>
        <div className="w-20 h-10 rounded-lg bg-green-100 dark:bg-green-900/40 border-2 border-green-400 flex items-center justify-center text-xs font-bold text-green-700 dark:text-green-300 shadow">
          GREEN v1.5
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main trainer component
// ---------------------------------------------------------------------------

export default function BlueGreenTrainer() {
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [scenario, setScenario] = useState("canary_10");
  const [topology, setTopology] = useState<TopologySnapshot | null>(null);
  const [blueWeight, setBlueWeight] = useState(90);
  const [loading, setLoading] = useState(false);
  const [shifting, setShifting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load scenario list once
  useEffect(() => {
    fetch(`${API}/scenarios`)
      .then((r) => r.json())
      .then((data: ScenarioInfo[]) => {
        setScenarios(data);
      })
      .catch(() => {/* ignore — scenarios are static, show defaults */});
  }, []);

  const fetchTopology = useCallback(
    async (sc: string) => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`${API}/topology?scenario=${sc}`, {
          signal: abortRef.current.signal,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: TopologySnapshot = await r.json();
        setTopology(data);
        setBlueWeight(data.blue.weight);
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== "AbortError") {
          setError(String(e));
        }
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Load topology on scenario change
  useEffect(() => {
    fetchTopology(scenario);
  }, [scenario, fetchTopology]);

  async function handleShift() {
    setShifting(true);
    setError(null);
    const t0 = performance.now();
    try {
      const r = await fetch(`${API}/shift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blue_weight: blueWeight, scenario }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setDurationMs(performance.now() - t0);
      // Build a TopologySnapshot from ShiftResult fields
      setTopology({
        trainer: data.trainer,
        version: data.version,
        scenario: data.scenario,
        timestamp_ms: Date.now(),
        blue: data.blue,
        green: data.green,
        gateway: data.gateway,
        shift_in_progress: false,
        insight: data.insight,
      });
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setShifting(false);
    }
  }

  const scenarioInfo = scenarios.find((s) => s.id === scenario);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">
          🚦 Trainer #3 — Blue / Green CI/CD Visualizer
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Simulate traffic weight shifts between stable (blue) and new (green) deployments.
          Watch how the gateway redistributes load — with zero dropped packets on a proper shift.
        </p>
      </div>

      {/* Scenario selector */}
      <div className="flex flex-wrap gap-2">
        {(scenarios.length > 0
          ? scenarios
          : [
              { id: "canary_10", label_en: "Canary 10 %" },
              { id: "50_50", label_en: "50 / 50 Split" },
              { id: "full_cutover", label_en: "Full Cutover" },
              { id: "rollback", label_en: "Manual Rollback" },
              { id: "bad_gateway_502", label_en: "502/504 Bad Gateway" },
              { id: "drain_connections", label_en: "Graceful Drain" },
              { id: "auto_rollback", label_en: "Auto Circuit Rollback" },
            ]
        ).map((s) => (
          <button
            key={s.id}
            onClick={() => setScenario(s.id)}
            className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${
              scenario === s.id
                ? "bg-purple-600 text-white shadow-md ring-2 ring-purple-400/50"
                : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-purple-50 dark:hover:bg-purple-900/40 border border-gray-200 dark:border-gray-700"
            }`}
          >
            {(s as { label_ru?: string; label_en?: string; id: string }).label_ru || (s as { label_en?: string; id: string }).label_en || s.id}
          </button>
        ))}
      </div>

      {scenarioInfo && (
        <p className="text-sm text-gray-600 dark:text-gray-400 italic">
          {scenarioInfo.description_en}
        </p>
      )}

      {/* Traffic diagram */}
      <TrafficDiagram blueWeight={blueWeight} greenWeight={100 - blueWeight} />

      {/* Weight slider */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            Traffic weight
          </label>
          <div className="flex gap-3 text-sm font-mono font-bold">
            <span className="text-blue-500">Blue {blueWeight}%</span>
            <span className="text-gray-400">/</span>
            <span className="text-green-500">Green {100 - blueWeight}%</span>
          </div>
        </div>

        {/* Stacked bar */}
        <div className="w-full h-4 rounded-full overflow-hidden flex">
          <div
            className="bg-blue-500 transition-all duration-300"
            style={{ width: `${blueWeight}%` }}
          />
          <div
            className="bg-green-500 transition-all duration-300"
            style={{ width: `${100 - blueWeight}%` }}
          />
        </div>

        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={blueWeight}
          onChange={(e) => setBlueWeight(Number(e.target.value))}
          className="w-full accent-purple-600"
        />
        <div className="flex justify-between text-xs text-gray-400">
          <span>← 100% Green (new)</span>
          <span>100% Blue (stable) →</span>
        </div>

        <button
          onClick={handleShift}
          disabled={shifting || loading}
          className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold transition-colors"
        >
          {shifting ? "Shifting traffic…" : "Apply shift →"}
        </button>

        {durationMs !== null && !shifting && (
          <p className="text-xs text-center text-gray-500 dark:text-gray-400">
            Shift completed in <span className="font-bold">{durationMs.toFixed(0)} ms</span>
            {" "}(incl. round-trip)
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !topology && (
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-xl" />
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-xl" />
        </div>
      )}

      {/* Topology */}
      {topology && (
        <div className="space-y-4">
          <GatewayPanel gw={topology.gateway} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SlotPanel slot={topology.blue} />
            <SlotPanel slot={topology.green} />
          </div>

          {/* Insight */}
          <div className="rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 p-4">
            <p className="text-sm font-semibold text-purple-700 dark:text-purple-300 mb-1">
              💡 Insight
            </p>
            <p className="text-sm text-purple-800 dark:text-purple-200">{topology.insight}</p>
          </div>
        </div>
      )}

      {/* SEO article */}
      <article className="prose dark:prose-invert max-w-none text-sm text-gray-600 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-6 space-y-4">
        <h3 className="text-base font-bold text-gray-800 dark:text-white">
          How Blue/Green Deployments Work — and Why Zero Dropped Packets Matter
        </h3>
        <p>
          A <strong>blue/green deployment</strong> keeps two identical production environments
          ("blue" = current stable, "green" = new release) running simultaneously behind a shared
          load balancer. Traffic is shifted by updating a single weight value at the gateway — no
          rolling restarts, no mixed-version pods serving the same user in the same request.
        </p>
        <p>
          The key invariant: <code>blue_weight + green_weight = 100</code>. When the gateway
          honours this, <code>dropped_packets</code> stays at zero because the total capacity never
          drops. Each pool handles only its assigned share; health checks run every 5 seconds and
          the gateway stops sending traffic to a pod the moment it fails a readiness probe.
        </p>
        <p>
          <strong>Canary releases</strong> (e.g. 10 % to green) let you validate a new build on
          real traffic without exposing all users to a potential regression. Watch{" "}
          <code>error_rate_percent</code> and <code>p99_latency_ms</code> in the green panel: if
          either rises above baseline, roll back by pushing the slider back to 0 — the rollback
          takes the same time as the original shift.
        </p>
        <p>
          <strong>The rollback scenario</strong> in this trainer injects a CrashLoopBackOff into
          the first green pod. Notice that the gateway's total RPS barely changes: blue absorbs
          the orphaned load within one health-check interval (5 s) because blue still has{" "}
          <code>healthy_replicas = 3</code>. This is the core safety guarantee of blue/green vs a
          plain rolling update, where you might have no stable pods at all mid-deploy.
        </p>
        <p>
          <strong>Progressive delivery</strong> (the 50/50 and full-cutover scenarios) shows how
          the gateway p99 improves as more traffic moves to green (v1.5 has lower base latency
          than v1.4). This is the signal production teams use to decide when it is safe to
          complete the cutover.
        </p>
        <h4 className="font-semibold text-gray-700 dark:text-gray-200">
          Common mistakes in blue/green setups
        </h4>
        <ul>
          <li>
            <strong>Database schema coupling</strong> — if green requires a column that blue
            doesn't know about, a rollback corrupts data. Always deploy backward-compatible
            migrations before shifting traffic.
          </li>
          <li>
            <strong>Sticky sessions with weight shifts</strong> — if the gateway uses IP-hash
            routing, changing weights doesn't redistribute existing sessions. Use round-robin or
            drain sessions before cutting over.
          </li>
          <li>
            <strong>Forgetting to keep blue warm</strong> — scaling blue to 0 replicas to save
            cost means rollback takes a full cold-start. Keep at least 1 replica alive.
          </li>
        </ul>
      </article>
    </div>
  );
}
