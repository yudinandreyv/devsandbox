# 📜 The DevSandbox Engineering Codex

> **Standard of Engineering Excellence, Architectural Invariants, and Operational Guidelines**  
> *Target Domain*: `sandbox.gateaway.cloud` | *Stack*: React + TypeScript + FastAPI + PostgreSQL (Sandbox) + k3s

---

## 1. Core Principles & Non-Negotiables

### 1.1 Blast Radius Containment
- The Sandbox environment **must never compromise** host stability, production databases, or adjacent Kubernetes namespaces.
- All code executing user-triggered probes runs within strictly bounded resource limits:
  - Memory & CPU quotas enforced at the Kubernetes namespace (`ResourceQuota`) and pod (`LimitRange`) levels.
  - Strict query execution timeout: `SET LOCAL statement_timeout = '1500ms'`.
  - Database access for interactive probes must be granted exclusively to an unprivileged `READ ONLY` user.
  - Queries are parsed and validated through the PostgreSQL native AST parser (`pglast`). Any query containing mutations, multi-statements, or dangerous functions (`pg_sleep`, `set_config`, `pg_read_file`) is rejected prior to database dispatch.

### 1.2 Zero Cumulative Layout Shift (CLS = 0.000)
- Every layout element that might load asynchronously (advertisements, telemetry charts, dynamic cards) **must have fixed reservation slots** with explicit `min-height` and aspect ratio locks.
- No content reflow is permitted upon script or asset hydration. AdSense and partner banner placeholders are visually filled with internal platform widgets or GitHub links until monetization scripts load lazily.

### 1.3 SEO & Internationalization (i18n) by Design
- Every public page must be rendered with full dual-language support (`/en/...` and `/ru/...`).
- Proper `<link rel="alternate" hreflang="..." />` and `<link rel="canonical" href="..." />` tags must be present on every route.
- `robots.txt` strictly permits indexing of all visual educational pages while forbidding `/api/` crawl budgets.
- Pre-rendered, semantically rich technical prose (1000+ words per interactive lab) for maximum search engine citation and AI search indexing (Perplexity, ChatGPT Search).

### 1.4 Defense-in-Depth & Anti-Bot Protection
- Edge protection via Cloudflare (SSL, static asset caching, Bot Fight Mode).
- Strict HTTP Security Headers: Content Security Policy (CSP), Strict-Transport-Security (HSTS), X-Content-Type-Options, X-Frame-Options, Permissions-Policy.
- Layer 7 Rate Limiting powered by `slowapi` on FastAPI endpoints.
- Anonymous Guest Sessions with cryptographic verification and zero tracking of PII.

---

## 2. Architectural Blueprint

```
                     Internet (Cloudflare Edge CDN / Bot Fight Mode)
                                         │
                                         ▼
                 [ public-gateway (NGINX Gateway Fabric) ]
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
                 ▼                                               ▼
     [ frontend-sandbox :80 ]                        [ api-sandbox :8000 ]
      - React 18 + TypeScript                         - FastAPI (Python 3.11+)
      - Tailwind CSS (Dark/Light)                     - SlowAPI Rate Limiting
      - Nginx Static Dist w/ Brotli                   - Pydantic v2 Contracts
      - Telemetry in LocalStorage                     - Guest Session Manager
                 │                                               │
                 └───────────────────────┬───────────────────────┘
                                         ▼
                     [ Data & Sandbox Layer (Isolated) ]
                      - PostgreSQL (READ ONLY sandbox user)
                      - Redis (Rate limiting & plan caching)
```

---

## 3. Kubernetes / k3s Isolation Standard

All sandbox resources are strictly scoped inside the `sandbox` namespace:

| Parameter | Limit | Purpose |
|---|---|---|
| Namespace CPU Quota | `2000m` (2 vCPU) | Prevents host starvation |
| Namespace Memory Quota | `4Gi` | Caps RAM runaway |
| Pod Default Limits | `500m` CPU / `512Mi` RAM | Fair sharing between replicas |
| Pod Security | Non-root (`runAsNonRoot: true`), ReadOnlyRootFilesystem where applicable | Container security |
| Network Isolation | NetworkPolicies restricting egress to unauthorized clusters | Security boundary |

---

## 4. Frontend Engineering Standards

1. **Type Safety**: TypeScript strict mode enabled (`noImplicitAny`, `strictNullChecks`).
2. **Theme Support**: Seamless Dark/Light mode switching powered by CSS variables and Tailwind `dark:` classes, persisted to `localStorage` and synchronized with `prefers-color-scheme`.
3. **Telemetry & State**:
   - User interaction stats (session duration, benchmark runs, simulated megabytes scanned) persist in browser `localStorage`.
   - Real-time stopwatch and latency indicators on the top status bar.
4. **Ad Slots (CLS Guard)**:
   - Standard Leaderboard (`min-h-[90px]`, `728x90` / responsive)
   - Rectangle / Native Card (`min-h-[250px]`, `300x250`)
   - Placeholder fallbacks styled natively with zero layout flickering.
5. **Accessibility**: WCAG 2.1 AA compliance, keyboard navigation, high contrast colors.

---

## 5. Backend Engineering Standards

1. **FastAPI & Async**: All network and database operations use non-blocking `async`/`await`.
2. **API Versioning**: Every API route is prefixed with `/api/v1/`.
3. **Pydantic Validation**: Strict schemas for all request bodies and responses with explicit status codes.
4. **Error Handling**: Standardized RFC 7807 problem details JSON output.
5. **Database Sandbox Invariant**:
   - Queries from the Postgres visualizer are parsed via PostgreSQL native AST analyzer (`pglast` / `libpg_query`) to disallow any mutations (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `GRANT`, `COPY`) or administrative/sleep function calls.
   - Session execution explicitly sets `statement_timeout = '1500ms'`.

---

## 6. Git Hygiene & Conventions

- Conventional Commits:
  - `feat:` New interactive lab or feature
  - `fix:` Bug fixes or performance patches
  - `perf:` Core Web Vitals or backend latency optimization
  - `docs:` Documentation and engineering codex updates
  - `style:` Design, typography, theme adjustments
  - `ci:` Kubernetes manifests, Dockerfiles, and deployment automation
- Branching Model: `main` is always deployable. Feature branches: `feat/<name>`, `fix/<name>`.

---

## 7. Compliance, SEO & Privacy

- Full privacy compliance: GDPR & CCPA disclaimers, cookie-less telemetry by default.
- Dedicated legal documents: `/privacy-policy` and `/terms-of-service`.
- Canonical links generated dynamically based on active route and locale.
