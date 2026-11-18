import time
import json
import logging
import asyncio
from typing import Optional, Dict
from collections import defaultdict

# Structured Logger for Technical Audit (RFC compliant, Zero PII)
audit_logger = logging.getLogger("sandbox.audit")
logging.basicConfig(level=logging.INFO)

class MetricsAggregator:
    """
    In-memory Prometheus-compatible metrics aggregator.
    Prevents high-cardinality by explicitly omitting user_id and session_id labels.
    """
    def __init__(self):
        # probe_runs_total{trainer="...", scenario="...", status="..."}
        self.runs_total = defaultdict(int)
        # probe_errors_total{trainer="...", scenario="...", error_code="..."}
        self.errors_total = defaultdict(int)
        # probe_duration_sum / count
        self.duration_sum_ms = defaultdict(float)
        self.duration_count = defaultdict(int)
        # Event Loop Lag Gauge (in ms)
        self.current_event_loop_lag_ms: float = 0.0

    def record_run(self, trainer: str, scenario: str, status: str, duration_ms: float, error_code: Optional[str] = None):
        key = (trainer, scenario, status)
        self.runs_total[key] += 1
        self.duration_sum_ms[(trainer, scenario)] += duration_ms
        self.duration_count[(trainer, scenario)] += 1

        if error_code:
            self.errors_total[(trainer, scenario, error_code)] += 1

    def set_event_loop_lag(self, lag_ms: float):
        self.current_event_loop_lag_ms = round(lag_ms, 2)

    def to_prometheus_text(self) -> str:
        lines = [
            "# HELP probe_runs_total Total number of trainer benchmark executions.",
            "# TYPE probe_runs_total counter",
        ]
        for (trainer, scenario, status), count in self.runs_total.items():
            lines.append(f'probe_runs_total{{trainer="{trainer}",scenario="{scenario}",status="{status}"}} {count}')

        lines.extend([
            "# HELP probe_duration_ms_sum Total duration of probe runs in milliseconds.",
            "# TYPE probe_duration_ms_sum counter",
            "# HELP probe_duration_ms_count Count of probe runs for duration calculation.",
            "# TYPE probe_duration_ms_count counter",
        ])
        for (trainer, scenario), sum_ms in self.duration_sum_ms.items():
            count = self.duration_count[(trainer, scenario)]
            lines.append(f'probe_duration_ms_sum{{trainer="{trainer}",scenario="{scenario}"}} {sum_ms:.2f}')
            lines.append(f'probe_duration_ms_count{{trainer="{trainer}",scenario="{scenario}"}} {count}')

        lines.extend([
            "# HELP probe_errors_total Total errors categorized by safe sanitized error codes.",
            "# TYPE probe_errors_total counter",
        ])
        for (trainer, scenario, code), count in self.errors_total.items():
            lines.append(f'probe_errors_total{{trainer="{trainer}",scenario="{scenario}",error_code="{code}"}} {count}')

        lines.extend([
            "# HELP event_loop_lag_ms Real-time asyncio event loop latency/lag in milliseconds.",
            "# TYPE event_loop_lag_ms gauge",
            f'event_loop_lag_ms {self.current_event_loop_lag_ms:.2f}'
        ])

        return "\n".join(lines) + "\n"

metrics = MetricsAggregator()

def record_audit_event(
    trainer: str,
    scenario: str,
    trainer_version: str,
    status: str,
    duration_ms: float,
    error_code: Optional[str] = None
):
    """
    Audit log contract:
    - Never log raw user SQL, tokens, audio data or IPs.
    - Only sanitized, structured event metadata.
    """
    event = {
        "event": "probe_execution",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "trainer": trainer,
        "scenario": scenario,
        "version": trainer_version,
        "status": status,
        "duration_ms": round(duration_ms, 2),
        "error_code": error_code,
    }
    audit_logger.info(json.dumps(event))
    metrics.record_run(trainer, scenario, status, duration_ms, error_code)

# Background Task to monitor Event Loop Lag
async def event_loop_lag_monitor():
    """
    Measures event loop delay: schedules a 10ms sleep and calculates the delta.
    If the event loop is blocked by sync time.sleep() or heavy CPU, lag spikes!
    """
    while True:
        start = time.perf_counter()
        await asyncio.sleep(0.010) # 10 ms
        actual_delay_ms = (time.perf_counter() - start) * 1000
        lag_ms = max(0.0, actual_delay_ms - 10.0)
        metrics.set_event_loop_lag(lag_ms)
