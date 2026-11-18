#!/usr/bin/env python3
"""Generate a realistic PostgreSQL X-Ray dataset in bounded asyncpg batches.

Requires SANDBOX_SEED_DATABASE_URL in the environment. This must be a trusted
seed/admin DSN with DDL and INSERT privileges; the application read-only DSN
must never be used for seeding.

Run from the repository root:
    python docker/seed_500k_rows.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import time
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg

TARGET_ROWS = 500_000
BATCH_SIZE = 10_000
TENANT_COUNT = 1_000
ADVISORY_LOCK_KEY = 0x53414E44424F58
DATE_WINDOW = timedelta(days=730)

QUERY_NAMES = (
    "orders.search",
    "users.lookup",
    "catalog.filter",
    "billing.invoice",
    "events.aggregate",
    "inventory.list",
    "sessions.read",
    "audit.lookup",
)
REGIONS = ("eu-central", "eu-west", "us-east", "ap-south", "ap-northeast")
ENVIRONMENTS = ("production", "staging", "development")
METHODS = ("GET", "POST", "PATCH")
ROUTES = (
    "/orders/search",
    "/users/lookup",
    "/catalog/items",
    "/billing/invoices",
    "/events/aggregate",
    "/inventory",
    "/sessions",
    "/audit/events",
)
TAGS = ("cacheable", "priority", "retry", "mobile", "batch", "cold", "sampled")


def _tenant_id(rng: random.Random) -> int:
    """Use a realistic tenant skew while retaining many smaller tenants."""
    if rng.random() < 0.70:
        return rng.randint(1, 25)
    return rng.randint(26, TENANT_COUNT)


def _payload(
    rng: random.Random, query_name: str, tenant_id: int
) -> dict[str, object]:
    """Return one of several nested JSON shapes for JSONB filtering demos."""
    name = query_name
    labels: dict[str, object] = {
        "region": rng.choice(REGIONS),
        "environment": rng.choice(ENVIRONMENTS),
        "priority": rng.choice(("low", "normal", "high")),
    }
    tags = rng.sample(TAGS, k=rng.randint(1, 3))
    trace_id = uuid.UUID(int=rng.getrandbits(128)).hex

    if name in {"orders.search", "catalog.filter", "inventory.list"}:
        return {
            "kind": "request",
            "labels": labels,
            "tags": tags,
            "request": {
                "method": rng.choice(METHODS),
                "path": rng.choice(ROUTES),
                "filters": {
                    "active": rng.choice((True, False)),
                    "limit": rng.choice((10, 25, 50, 100)),
                    "category": rng.choice(("hardware", "books", "office", "home")),
                },
            },
            "trace": {"id": trace_id, "sampled": rng.choice((True, False))},
        }

    if name in {"events.aggregate", "audit.lookup", "sessions.read"}:
        return {
            "kind": "event",
            "labels": labels,
            "tags": tags,
            "metadata": {
                "trace_id": trace_id,
                "attempt": rng.randint(1, 4),
                "duration_ms": rng.randint(1, 4_000),
                "cached": rng.choice((True, False)),
            },
            "actor": {
                "tenant": tenant_id,
                "role": rng.choice(("reader", "operator", "service")),
            },
        }

    return {
        "kind": "lookup",
        "labels": labels,
        "tags": tags,
        "query": {
            "name": name,
            "arguments": {
                "include_archived": rng.choice((True, False)),
                "page": rng.randint(1, 100),
                "sort": rng.choice(("created_at", "updated_at", "name")),
            },
        },
        "context": {
            "trace_id": trace_id,
            "client": rng.choice(("web", "worker", "mobile")),
            "retry_count": rng.randint(0, 3),
        },
    }


def _record(
    rng: random.Random,
    start_at: datetime,
    window_seconds: int,
) -> tuple[int, str, str, int, datetime]:
    query_name = rng.choice(QUERY_NAMES)
    tenant_id = _tenant_id(rng)
    created_at = start_at + timedelta(seconds=rng.randrange(window_seconds))
    return (
        tenant_id,
        query_name,
        json.dumps(
            _payload(rng, query_name, tenant_id),
            separators=(",", ":"),
            ensure_ascii=False,
        ),
        rng.randint(0, 8_192),
        created_at,
    )


async def _ensure_schema(connection: asyncpg.Connection) -> None:
    """Create or safely upgrade the existing Stage 1 table without dropping data."""
    async with connection.transaction():
        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS public.probe_queries (
                id BIGSERIAL PRIMARY KEY,
                tenant_id INTEGER NOT NULL,
                query_name VARCHAR(120) NOT NULL,
                payload JSONB NOT NULL,
                buffer_cost INTEGER NOT NULL,
                created_at TIMESTAMPTZ NOT NULL
            )
            """
        )

        columns = {
            row["column_name"]: row
            for row in await connection.fetch(
                """
                SELECT column_name, data_type, character_maximum_length,
                       column_default, is_identity
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'probe_queries'
                """
            )
        }

        legacy_layout = "tenant_id" not in columns
        id_column = columns.get("id")
        if id_column is None:
            raise RuntimeError("probe_queries exists without the required id column.")
        if not id_column["column_default"] and id_column["is_identity"] != "YES":
            raise RuntimeError(
                "probe_queries.id has no sequence or identity default; refusing to seed."
            )

        if "tenant_id" not in columns:
            await connection.execute(
                "ALTER TABLE public.probe_queries ADD COLUMN tenant_id INTEGER"
            )
        await connection.execute(
            """
            UPDATE public.probe_queries
            SET tenant_id = ((id - 1) % $1) + 1
            WHERE tenant_id IS NULL
            """,
            TENANT_COUNT,
        )
        await connection.execute(
            "ALTER TABLE public.probe_queries ALTER COLUMN tenant_id SET NOT NULL"
        )

        if "query_name" not in columns:
            await connection.execute(
                """
                ALTER TABLE public.probe_queries
                ADD COLUMN query_name VARCHAR(120) NOT NULL DEFAULT 'legacy.unknown'
                """
            )
        else:
            await connection.execute(
                "UPDATE public.probe_queries SET query_name = 'legacy.unknown' "
                "WHERE query_name IS NULL"
            )
            query_name_column = columns["query_name"]
            if (
                query_name_column["data_type"] != "character varying"
                or query_name_column["character_maximum_length"] != 120
            ):
                await connection.execute(
                    """
                    ALTER TABLE public.probe_queries
                    ALTER COLUMN query_name TYPE VARCHAR(120)
                    USING query_name::text
                    """
                )
            await connection.execute(
                "ALTER TABLE public.probe_queries ALTER COLUMN query_name SET NOT NULL"
            )

        payload_column = columns.get("payload")
        if payload_column is None:
            await connection.execute(
                """
                ALTER TABLE public.probe_queries
                ADD COLUMN payload JSONB NOT NULL DEFAULT '{}'::jsonb
                """
            )
        elif payload_column["data_type"] == "text" or payload_column[
            "data_type"
        ] == "character varying":
            await connection.execute(
                """
                ALTER TABLE public.probe_queries
                ALTER COLUMN payload TYPE JSONB
                USING CASE
                    WHEN payload IS NULL THEN '{}'::jsonb
                    ELSE jsonb_build_object('legacy_text', payload::text)
                END
                """
            )
        elif payload_column["data_type"] == "json":
            await connection.execute(
                """
                ALTER TABLE public.probe_queries
                ALTER COLUMN payload TYPE JSONB
                USING COALESCE(payload::jsonb, '{}'::jsonb)
                """
            )
        elif payload_column["data_type"] != "jsonb":
            raise RuntimeError(
                "probe_queries.payload has an unsupported type; refusing to alter it."
            )
        await connection.execute(
            "UPDATE public.probe_queries SET payload = '{}'::jsonb WHERE payload IS NULL"
        )
        await connection.execute(
            "ALTER TABLE public.probe_queries ALTER COLUMN payload SET NOT NULL"
        )

        if "buffer_cost" not in columns:
            await connection.execute(
                """
                ALTER TABLE public.probe_queries
                ADD COLUMN buffer_cost INTEGER NOT NULL DEFAULT 0
                """
            )
        else:
            await connection.execute(
                "UPDATE public.probe_queries SET buffer_cost = 0 "
                "WHERE buffer_cost IS NULL"
            )
            if columns["buffer_cost"]["data_type"] != "integer":
                await connection.execute(
                    """
                    ALTER TABLE public.probe_queries
                    ALTER COLUMN buffer_cost TYPE INTEGER
                    USING buffer_cost::integer
                    """
                )
            await connection.execute(
                "ALTER TABLE public.probe_queries ALTER COLUMN buffer_cost SET NOT NULL"
            )

        created_at_column = columns.get("created_at")
        if created_at_column is None:
            await connection.execute(
                """
                ALTER TABLE public.probe_queries
                ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
                """
            )
        else:
            if created_at_column["data_type"] == "timestamp without time zone":
                await connection.execute(
                    """
                    ALTER TABLE public.probe_queries
                    ALTER COLUMN created_at TYPE TIMESTAMPTZ
                    USING created_at AT TIME ZONE 'UTC'
                    """
                )
            elif created_at_column["data_type"] != "timestamp with time zone":
                raise RuntimeError(
                    "probe_queries.created_at has an unsupported type; refusing to alter it."
                )
            await connection.execute(
                "UPDATE public.probe_queries SET created_at = clock_timestamp() "
                "WHERE created_at IS NULL"
            )
            await connection.execute(
                """
                ALTER TABLE public.probe_queries
                ALTER COLUMN created_at SET DEFAULT clock_timestamp()
                """
            )
            await connection.execute(
                "ALTER TABLE public.probe_queries ALTER COLUMN created_at SET NOT NULL"
            )

        if legacy_layout:
            await connection.execute(
                """
                UPDATE public.probe_queries
                SET created_at = $1::timestamptz - (
                    ((id::bigint * 104729) % $2)::double precision
                    * INTERVAL '1 second'
                )
                """,
                datetime.now(timezone.utc),
                int(DATE_WINDOW.total_seconds()),
            )

        has_id_primary_key = await connection.fetchval(
            """
            SELECT EXISTS (
                SELECT 1
                FROM pg_constraint AS c
                JOIN pg_attribute AS a
                  ON a.attrelid = c.conrelid AND a.attname = 'id'
                WHERE c.conrelid = 'public.probe_queries'::regclass
                  AND c.contype = 'p'
                  AND c.conkey = ARRAY[a.attnum]::smallint[]
            )
            """
        )
        if not has_id_primary_key:
            await connection.execute(
                """
                ALTER TABLE public.probe_queries
                ADD CONSTRAINT probe_queries_id_pk PRIMARY KEY (id)
                """
            )

        readonly_role = await connection.fetchrow(
            """
            SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
                   rolreplication, rolbypassrls
            FROM pg_roles
            WHERE rolname = 'sandbox_readonly'
            """
        )
        if readonly_role is None or not readonly_role["rolcanlogin"]:
            raise RuntimeError(
                "The sandbox_readonly login role is missing; create it first."
            )
        if any(
            readonly_role[field]
            for field in (
                "rolsuper",
                "rolcreatedb",
                "rolcreaterole",
                "rolreplication",
                "rolbypassrls",
            )
        ):
            raise RuntimeError(
                "sandbox_readonly has elevated role attributes; refusing to continue."
            )
        await connection.execute(
            """
            ALTER ROLE sandbox_readonly IN DATABASE sandbox_db
            SET default_transaction_read_only = on
            """
        )
        await connection.execute(
            """
            ALTER ROLE sandbox_readonly IN DATABASE sandbox_db
            SET statement_timeout = '1500ms'
            """
        )
        await connection.execute(
            "GRANT SELECT ON TABLE public.probe_queries TO sandbox_readonly"
        )


async def _ensure_indexes(connection: asyncpg.Connection) -> None:
    """Create comparison indexes after bulk copy; query_name stays unindexed."""
    await connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_probe_queries_tenant_created
        ON public.probe_queries (tenant_id, created_at)
        """
    )
    await connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_probe_queries_payload_gin
        ON public.probe_queries USING GIN (payload jsonb_path_ops)
        """
    )


async def _seed(
    connection: asyncpg.Connection,
    target_rows: int,
    batch_size: int,
    seed: int,
) -> None:
    existing_rows = await connection.fetchval(
        "SELECT COUNT(*) FROM public.probe_queries"
    )
    if existing_rows > target_rows:
        raise RuntimeError(
            f"probe_queries already has {existing_rows:,} rows; "
            f"the target is {target_rows:,}. No rows were removed."
        )

    rows_remaining = target_rows - existing_rows
    if rows_remaining == 0:
        await _ensure_indexes(connection)
        print(f"Dataset already has {target_rows:,} rows; no inserts needed.")
        return

    rng = random.Random(seed)
    now = datetime.now(timezone.utc)
    start_at = now - DATE_WINDOW
    window_seconds = int(DATE_WINDOW.total_seconds())
    inserted_rows = 0
    started_at = time.perf_counter()

    while rows_remaining:
        current_batch_size = min(batch_size, rows_remaining)
        batch: list[tuple[int, str, str, int, datetime]] = [
            _record(rng, start_at, window_seconds)
            for _ in range(current_batch_size)
        ]
        async with connection.transaction():
            await connection.copy_records_to_table(
                "probe_queries",
                schema_name="public",
                records=batch,
                columns=(
                    "tenant_id",
                    "query_name",
                    "payload",
                    "buffer_cost",
                    "created_at",
                ),
            )
        inserted_rows += current_batch_size
        rows_remaining -= current_batch_size
        print(
            f"Inserted {inserted_rows:,} of "
            f"{target_rows - existing_rows:,} missing rows."
        )

    await _ensure_indexes(connection)
    elapsed = time.perf_counter() - started_at
    print(
        f"Dataset ready: {target_rows:,} rows total "
        f"({inserted_rows:,} inserted) in {elapsed:.1f}s."
    )


async def _run(target_rows: int, batch_size: int, seed: int) -> None:
    dsn = os.environ.get("SANDBOX_SEED_DATABASE_URL")
    if not dsn:
        raise SystemExit(
            "Set SANDBOX_SEED_DATABASE_URL to a trusted database seeding DSN."
        )

    async with asyncpg.create_pool(
        dsn=dsn,
        min_size=1,
        max_size=1,
        command_timeout=120,
    ) as pool:
        async with pool.acquire() as connection:
            database_name = await connection.fetchval("SELECT current_database()")
            if database_name != "sandbox_db":
                raise RuntimeError(
                    "Refusing to seed: connected database must be sandbox_db."
                )
            await connection.execute("SELECT pg_advisory_lock($1)", ADVISORY_LOCK_KEY)
            try:
                await _ensure_schema(connection)
                await _seed(connection, target_rows, batch_size, seed)
            finally:
                await connection.execute(
                    "SELECT pg_advisory_unlock($1)", ADVISORY_LOCK_KEY
                )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=int, default=TARGET_ROWS)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--seed", type=int, default=20261118)
    args = parser.parse_args()
    if args.rows < 1:
        parser.error("--rows must be greater than zero")
    if args.batch_size < 1:
        parser.error("--batch-size must be greater than zero")
    return args


def main() -> None:
    args = _parse_args()
    asyncio.run(_run(args.rows, args.batch_size, args.seed))


if __name__ == "__main__":
    main()

