"""Bounded 50-user load scenario for the Week 2 probe endpoint.

Install the optional load-test dependency and run from the repository root:
    python -m pip install -r tests/load/requirements.txt
    locust -f tests/load/locustfile.py --headless --host http://localhost:8000 --run-time 2m

The shape keeps 50 virtual users active. Each user makes one low-cost request per
61-65 seconds so the test stays below the API's shared 60/minute probe limit.
The 25/25 split exercises both named scenarios. The concurrency query parameter
is intentionally 1 because Locust already supplies the 50 outer virtual users.
"""

from __future__ import annotations

import re
from typing import ClassVar

from locust import HttpUser, LoadTestShape, between, task

METRICS_PATH = "/api/v1/metrics"
PROBE_PATH = "/api/v1/probe/io-benchmark"
COUNTER_SAMPLE = re.compile(
    r'^probe_runs_total\{(?P<labels>[^}]*)\}\s+(?P<value>\d+(?:\.\d+)?)$'
)
LABEL = re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"')


def _counter_value(exposition: str, scenario: str) -> int:
    """Read the successful probe counter for one bounded-label scenario."""
    for line in exposition.splitlines():
        match = COUNTER_SAMPLE.match(line)
        if match is None:
            continue
        labels = dict(LABEL.findall(match.group("labels")))
        if (
            labels.get("trainer") == "sync-vs-async"
            and labels.get("scenario") == scenario
            and labels.get("status") == "success"
        ):
            return int(float(match.group("value")))
    return 0


class FiftyUserShape(LoadTestShape):
    """Maintain exactly fifty Locust users until --run-time stops the test."""

    def tick(self) -> tuple[int, float]:
        return 50, 50.0


class _ProbeUser(HttpUser):
    abstract = True
    wait_time = between(61.0, 65.0)
    scenario: ClassVar[str]

    def _read_counter(self) -> int | None:
        with self.client.get(
            METRICS_PATH,
            name=METRICS_PATH,
            catch_response=True,
        ) as response:
            if response.status_code != 200:
                response.failure(
                    f"Prometheus endpoint returned HTTP {response.status_code}"
                )
                return None
            value = _counter_value(response.text, self.scenario)
            response.success()
            return value

    @task
    def run_probe_and_check_metric(self) -> None:
        before = self._read_counter()
        with self.client.get(
            PROBE_PATH,
            name=f"{PROBE_PATH} [{self.scenario}]",
            params={
                "scenario": self.scenario,
                "concurrency": 1,
                "delay_ms": 5,
            },
            catch_response=True,
        ) as response:
            if response.status_code != 200:
                response.failure(f"Probe returned HTTP {response.status_code}")
                return

            try:
                payload = response.json()
            except ValueError:
                response.failure("Probe response was not valid JSON")
                return

            if not isinstance(payload, dict) or payload.get("scenario") != self.scenario:
                response.failure("Probe returned an unexpected scenario")
                return

            after = self._read_counter()
            if before is None or after is None:
                response.failure("Could not verify the Prometheus counter")
                return
            if after <= before:
                response.failure(
                    "probe_runs_total did not increase after the successful probe"
                )
                return
            response.success()


class AsyncDbPoolUser(_ProbeUser):
    abstract = False
    fixed_count = 25
    scenario = "async_db_pool"


class SyncBlockingDbUser(_ProbeUser):
    abstract = False
    fixed_count = 25
    scenario = "sync_blocking_db"

