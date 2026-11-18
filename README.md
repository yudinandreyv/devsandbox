# ⚡ DevSandbox: HighLoad Architecture & Database Interactive Sandbox

[![Kubernetes Namespace](https://img.shields.io/badge/k3s-Namespace%20sandbox-blue)](k8s/sandbox-stack.yaml)
[![Core Web Vitals](https://img.shields.io/badge/CLS-0.000%20Zero%20Shift-emerald)](CODEX.md)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.119-green)](backend/)
[![React](https://img.shields.io/badge/React%2018-TypeScript%20%2B%20Tailwind-sky)](frontend/)

**DevSandbox** (`sandbox.gateaway.cloud`) is a production-grade, containerized developer playground engineered to benchmark asynchronous event loops, profile live PostgreSQL query buffers (`EXPLAIN ANALYZE BUFFERS`), trace zero-downtime Blue/Green deployments, and index high-intent technical queries for search engines and AI research engines.

---

## 🏛️ Project Architecture & Engineering Codex

Full architectural invariants, blast radius containment rules, and developer standards are defined in **[CODEX.md](CODEX.md)**.

### 🛡️ Core Guarantees:
1. **Blast Radius Containment**:
   - Scoped inside dedicated k3s namespace `sandbox` with strict `ResourceQuota` (2.5 vCPU, 4 GiB RAM) and container `LimitRange`.
   - PostgreSQL queries are executed via unprivileged `sandbox_readonly` role with `SET LOCAL statement_timeout = '1500ms'` and AST pre-validation (`sqlglot`).
2. **Cumulative Layout Shift (CLS = 0.000)**:
   - Fixed reservation slots (`min-height`) for all presentational and upcoming monetization blocks (AdSense / Mediavine).
   - Zero layout flickering during hydration.
3. **SEO & Internationalization (i18n)**:
   - Full bilingual routing (`/en/...` and `/ru/...`) with `hreflang` and `canonical` dynamic tags.
   - Separate legal pages (`/privacy-policy`, `/terms-of-service`, `/about`, `/contact`).
   - Hardened `robots.txt` forbidding `/api/` crawl budget waste while allowing educational pages.
4. **Session & Privacy**:
   - Ephemeral, anonymous guest sessions with client-side `localStorage` telemetry.
   - Built-in session stopwatch and real-time backend ping latency.

---

## 📂 Repository Structure

```
.
├── CODEX.md                      # Engineering Codex & Architectural Standards
├── README.md                     # Project Overview & Quickstart Guide
├── docker-compose.yml            # Full 4-service local development stack
├── k8s/
│   └── sandbox-stack.yaml        # Production k3s isolation & routing manifest
├── docker/
│   └── init-sandbox-db.sql       # PostgreSQL sandbox user & demo dataset seed
├── backend/
│   ├── Dockerfile                # Multi-stage non-root Python 3.11 container
│   ├── requirements.txt
│   └── app/
│       ├── main.py               # FastAPI application with CORS & Security headers
│       ├── core/                 # Config, slowapi limiter, security, telemetry
│       └── api/v1/               # Health, guest sessions, probe endpoints
│       └── tests/                # Automated pytest suite
└── frontend/
    ├── Dockerfile                # Multi-stage build + Nginx static distribution
    ├── nginx.conf                # Gzip, CSP security headers, static caching
    ├── package.json
    ├── tailwind.config.js
    └── src/
        ├── context/              # Theme (Dark/Light), i18n (EN/RU), Telemetry
        ├── components/           # Navbar, Stopwatch, TelemetryBadge, AdSlot
        ├── pages/                # Home, About, Contact, Privacy, Terms
        └── locales/              # English & Russian localization dictionaries
```

---

## 🚀 Quickstart & Local Development

### Prerequisites:
- Python 3.11+
- Node.js 20+ & npm
- Docker & Docker Compose (optional for full stack)

### 1. Launch via Docker Compose (Full Stack)
Create a local environment file first (it is ignored by Git):
```bash
cp .env.example .env
# Replace the example values in .env with local secrets
docker compose up --build
```
The database initializer reads `SANDBOX_READONLY_PASSWORD` from the environment. For Kubernetes, create the `sandbox-secrets` Secret out of band before applying the stack; never commit credential values.
- **Frontend SPA**: `http://localhost`
- **FastAPI Documentation**: `http://localhost:8000/docs`
- **Health Check**: `http://localhost:8000/api/v1/health`

### 2. Manual Local Development

#### Backend:
```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Run tests:
```bash
pytest app/tests/ -v
```

#### Frontend:
```bash
cd frontend
npm install
npm run dev
```

---

## ☸️ Kubernetes (k3s) Deployment

The manifest in `k8s/sandbox-stack.yaml` provides:
- Dedicated `Namespace` `sandbox` with Baseline pod security enforcement.
- `ResourceQuota` and `LimitRange` preventing resource starvation.
- Non-root `SecurityContext` on both containers.
- `HTTPRoute` for NGINX Gateway Fabric routing `sandbox.gateaway.cloud/` to frontend and `/api/v1` to API.

Deploy to cluster:
```bash
kubectl apply -f k8s/sandbox-stack.yaml
```

Check rollout:
```bash
kubectl get pods -n sandbox
kubectl get resourcequota -n sandbox
```

---

## 📅 Roadmap: Weeks 2–4

- **Week 2**: **Sync vs Async Profiler** (`/api/v1/probe/io-benchmark`) with load sliders, `time.sleep()` GIL injection, and 1,000+ words technical analysis.
- **Week 3**: **PostgreSQL Query X-Ray** with `EXPLAIN (ANALYZE, BUFFERS)` and disk scan counters on 1M rows sandbox.
- **Week 4**: **Blue/Green Network Tracer** & **Voice-to-Action RAG** (`faster-whisper` + `pgvector`).
