-- Initialize DevSandbox Database & Read-Only User

-- 1. Create sandbox database if not exists
CREATE DATABASE sandbox_db;
\c sandbox_db;

-- 2. Create sandbox read-only user from an environment variable
\getenv SANDBOX_READONLY_PASSWORD
SELECT format('CREATE ROLE sandbox_readonly WITH LOGIN PASSWORD %L', :'SANDBOX_READONLY_PASSWORD')
WHERE NOT EXISTS (
    SELECT FROM pg_catalog.pg_roles WHERE rolname = 'sandbox_readonly'
)\gexec

-- 3. Restrict permissions to strictly READ-ONLY
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM sandbox_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO sandbox_readonly;

-- 4. Set hard statement timeout for the sandbox role
ALTER ROLE sandbox_readonly SET statement_timeout = '1500ms';

-- 5. Seed sample sandbox table (10,000 demo rows for Stage 1 / Stage 2 readiness)
CREATE TABLE IF NOT EXISTS probe_queries (
    id SERIAL PRIMARY KEY,
    query_name VARCHAR(100) NOT NULL,
    payload TEXT NOT NULL,
    buffer_cost INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO probe_queries (query_name, payload, buffer_cost)
SELECT 
    'query_bench_' || i,
    md5(random()::text) || ' payload content for explain analyze benchmarking test',
    (random() * 5000)::int
FROM generate_series(1, 10000) AS i;

-- Grant select to sandbox_readonly
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sandbox_readonly;
