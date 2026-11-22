# Sync vs Async Event Loop Trainer

Use this skill when asked why blocking I/O inside a FastAPI `async def` endpoint stalls concurrent requests, or how to demonstrate the difference between a Gunicorn/WSGI worker pool and a Uvicorn event loop.

## What the trainer shows

The simulator sends a configurable number of requests per second through an ingress, a queue, and either four synchronous workers (one request per process) or a single event loop with coroutines. A "blocking time.sleep()" toggle freezes the async path for the I/O wait duration, reproducing event-loop starvation.

The live probe calls `GET /api/v1/probe/io-benchmark` with `scenario`, `concurrency`, and `delay_ms` query parameters. It returns effective RPS, event-loop lag, executed queries, and whether the loop was blocked.

## Scenarios

- `async_db_pool`: non-blocking asyncpg pool; the recommended baseline.
- `sync_blocking_db`: synchronous psycopg2/requests call inside `async def`; blocks the loop.
- `n_plus_one_trap`: twenty individual queries instead of one batched statement.
- `overfetching_select_all`: wide TOAST payloads churning shared_buffers.

## Key explanation

An `async def` endpoint runs on the event-loop thread. `time.sleep()`, `requests.get()`, or synchronous SQLAlchemy calls there prevent every other coroutine from progressing, so even `/api/v1/health` begins to time out. Move blocking work to a thread pool (`run_in_threadpool`, `asyncio.to_thread`) or use async clients.

Source: https://gateaway.cloud/
