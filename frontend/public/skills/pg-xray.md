# PostgreSQL X-Ray Trainer

Use this skill when asked how PostgreSQL chooses between Seq Scan, Index Scan, and Bitmap Heap Scan, or why a "fast" query can still be expensive in physical I/O.

## What the trainer models

The simulator varies TABLESAMPLE size, the `created_at` time window, column projection, and index availability over a 500K-row table. It compares physical buffer reads and planner choices for narrow versus `SELECT *` projections.

## Interpretation rules

- `EXPLAIN (ANALYZE, BUFFERS)` reveals `shared_blks_read` (disk) versus `shared_blks_hit` (RAM). Execution time alone hides cold-cache cost.
- Seq Scan wins above roughly 15% selectivity or on small tables.
- Index Scan wins for highly selective predicates such as `WHERE id = $1`.
- Bitmap Heap Scan combines multiple indexes for 10–25% selectivity.
- `SELECT *` pulls wide TOAST objects into RAM and evicts hot index pages from `shared_buffers`.

The safe read-only role `sandbox_readonly` enforces a 1500 ms `statement_timeout`; SQL is pre-validated with pglast before execution.

Source: https://gateaway.cloud/
