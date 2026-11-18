import pytest
from backend.app.core.sql_security import validate_sandbox_sql

def test_valid_select_queries():
    valid_queries = [
        "SELECT id, query_name FROM probe_queries WHERE id = 42",
        "SELECT count(*), max(buffer_cost) FROM probe_queries GROUP BY query_name HAVING count(*) > 1",
        "SELECT * FROM (SELECT id, query_name FROM probe_queries ORDER BY id DESC LIMIT 50) sub",
        "SELECT id, md5(payload) AS hash FROM probe_queries WHERE buffer_cost BETWEEN 100 AND 500",
    ]
    for q in valid_queries:
        is_valid, error = validate_sandbox_sql(q)
        assert is_valid is True, f"Expected valid query for '{q}', got error: {error}"
        assert error is None

def test_reject_destructive_operations():
    forbidden = [
        ("DROP TABLE probe_queries", "DROP"),
        ("DELETE FROM probe_queries WHERE id = 1", "DELETE"),
        ("UPDATE probe_queries SET buffer_cost = 0", "UPDATE"),
        ("INSERT INTO probe_queries (query_name) VALUES ('hack')", "INSERT"),
        ("ALTER TABLE probe_queries ADD COLUMN evil INT", "ALTERTABLE"),
        ("GRANT ALL ON probe_queries TO public", "GRANT"),
        ("VACUUM FULL probe_queries", "VACUUM"),
    ]
    for q, op in forbidden:
        is_valid, error = validate_sandbox_sql(q)
        assert is_valid is False, f"Query '{q}' should have been rejected"
        assert "forbidden" in error.lower() or op.lower() in error.lower()

def test_reject_multi_statements():
    q = "SELECT id FROM probe_queries; DROP TABLE probe_queries;"
    is_valid, error = validate_sandbox_sql(q)
    assert is_valid is False
    assert "Multi-statement" in error

def test_reject_dangerous_functions():
    dangerous = [
        "SELECT pg_sleep(10), id FROM probe_queries",
        "SELECT pg_catalog.pg_sleep(5)",
        "SELECT pg_read_file('/etc/passwd')",
        "SELECT set_config('statement_timeout', '0', false)",
    ]
    for q in dangerous:
        is_valid, error = validate_sandbox_sql(q)
        assert is_valid is False, f"Expected dangerous function in '{q}' to be rejected"
        assert "prohibited" in error.lower()

def test_reject_prohibited_catalog_tables():
    q = "SELECT * FROM pg_authid"
    is_valid, error = validate_sandbox_sql(q)
    assert is_valid is False
    assert "pg_authid" in error.lower()

def test_syntax_errors():
    q = "SELECT FROM WHERE"
    is_valid, error = validate_sandbox_sql(q)
    assert is_valid is False
    assert "Syntax Error" in error
