# Blue/Green CI/CD Trainer

Use this skill when asked how weighted routing, canary releases, and rollbacks keep availability during a deployment.

## What the trainer models

A Kubernetes NGINX Gateway Fabric `HTTPRoute` splits traffic between a stable "blue" deployment and a new "green" deployment. The blue weight slider drives a live shift through the sandbox API; the topology panel reports replica health, error rate, p99 latency, and dropped packets.

## Invariants

- `blue_weight + green_weight = 100` at every moment. Total capacity never drops, so `dropped_packets` stays at zero.
- Readiness probes remove unhealthy green pods before the gateway sends traffic to them.
- A 10% canary validates a release on real traffic before a full cutover.
- Rollback uses the same weight mechanism; it takes one health-check interval (about 5 s) for blue to absorb orphaned load.

## Scenarios

`canary_10`, `50_50`, `full_cutover`, `rollback`, `bad_gateway_502`, `drain_connections`, and `auto_rollback`.

## Common mistakes

Backward-incompatible database schemas make rollback unsafe. IP-hash affinity prevents weight changes from redistributing existing sessions; drain connections before cutting over.

Source: https://gateaway.cloud/
