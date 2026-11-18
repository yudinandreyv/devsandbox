import pglast
from pglast.visitors import Visitor
from typing import Tuple, Optional, List

# List of functions that could be abused for DoS, data exfiltration, or state alteration
PROHIBITED_FUNCTIONS = {
    "pg_sleep",
    "pg_sleep_for",
    "pg_sleep_until",
    "pg_terminate_backend",
    "pg_cancel_backend",
    "pg_read_file",
    "pg_read_binary_file",
    "pg_ls_dir",
    "pg_stat_file",
    "set_config",
    "query_to_xml",
    "dblink",
    "dblink_exec",
}

# Restricted catalog tables
PROHIBITED_TABLES = {
    "pg_authid",
    "pg_shadow",
    "pg_user",
}

class PostgresSandboxASTVisitor(Visitor):
    def __init__(self):
        super().__init__()
        self.violations: List[str] = []

    def visit_FuncCall(self, ancestors, node):
        try:
            func_name = ".".join(
                str(f.sval) for f in node.funcname if hasattr(f, "sval")
            ).lower()
            # Check bare function name or schema-qualified (e.g. pg_catalog.pg_sleep)
            bare_name = func_name.split(".")[-1]
            if bare_name in PROHIBITED_FUNCTIONS or func_name in PROHIBITED_FUNCTIONS:
                self.violations.append(f"Function call '{func_name}()' is prohibited in the sandbox.")
        except Exception:
            pass

    def visit_RangeVar(self, ancestors, node):
        try:
            relname = str(node.relname).lower() if hasattr(node, "relname") else ""
            if relname in PROHIBITED_TABLES:
                self.violations.append(f"Access to system catalog table '{relname}' is forbidden.")
        except Exception:
            pass


def validate_sandbox_sql(query: str) -> Tuple[bool, Optional[str]]:
    """
    Validates a SQL query using pglast (PostgreSQL native AST parser).
    Guarantees:
      - Valid PostgreSQL syntax
      - Single statement only
      - Strictly SELECT statement
      - No calls to sleep, filesystem, or administrative functions
    """
    cleaned = query.strip()
    if not cleaned:
        return False, "Query cannot be empty."

    try:
        raw_stmts = pglast.parse_sql(cleaned)
    except pglast.parser.ParseError as err:
        return False, f"PostgreSQL Syntax Error: {str(err)}"
    except Exception as exc:
        return False, f"Failed to parse SQL: {str(exc)}"

    if not raw_stmts or len(raw_stmts) == 0:
        return False, "No valid SQL statement found."

    # Invariant: strictly 1 statement allowed per probe execution
    if len(raw_stmts) > 1:
        return False, "Multi-statement queries (separated by ';') are forbidden in the sandbox."

    root_raw = raw_stmts[0]
    root_stmt = root_raw.stmt

    # Invariant: Root must be SelectStmt
    if root_stmt.__class__.__name__ != "SelectStmt":
        stmt_type = root_stmt.__class__.__name__.replace("Stmt", "").upper()
        return False, f"Operation '{stmt_type}' is forbidden. The sandbox only permits read-only SELECT queries."

    # Deep AST inspection for forbidden functions and tables
    visitor = PostgresSandboxASTVisitor()
    visitor(root_raw)

    if visitor.violations:
        return False, " | ".join(visitor.violations)

    return True, None
