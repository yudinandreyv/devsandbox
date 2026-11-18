# PostgreSQL Query X-Ray — Полный план редизайна

## Текущее состояние

**Frontend**: `PgXrayTrainer.tsx` (371 строка) — 2-колоночный layout с textarea для произвольного SQL, 4 шаблона, клиентская валидация, raw plan output, side-by-side diff.

**Backend**:
- `pg_xray.py` — `simulate_xray_plan()` (hardcoded ветки), `run_postgres_xray()` (pglast → EXPLAIN через asyncpg → fallback simulation)
- `probe.py` — `GET /probe/pg-xray/templates`, `POST /probe/pg-xray` (принимает произвольный SQL)
- `sql_security.py` — pglast AST validator

**Проблемы текущей версии**:
1. Пользователь пишет произвольный SQL — неконтролируемая нагрузка, невоспроизводимые результаты
2. Нет сравнения "без индекса vs с индексом" в рамках одного запуска
3. Нет настраиваемых параметров (размер выборки, период, колонки)
4. Plan output — сырой JSON, нет human-friendly разбора
5. Нет обучающего контента (таблица решений, статья)

---

## Новая архитектура

### Принцип: «Интерактивный технический урок»

Путь пользователя: **настроить сценарий → запустить → сравнить два плана (без/с индексом) → понять причину → сопоставить с предыдущим опытом → прочитать разбор**.

---

## Backend: новый API endpoint

### `POST /api/v1/probe/pg-xray` — переработанный

#### Входящий запрос (PgXrayExperimentRequest):
```python
class PgXrayExperimentRequest(BaseModel):
    sample_pct: int = Field(default=50, ge=10, le=100, description="Процент таблицы для TABLESAMPLE")
    months: int = Field(default=6, ge=1, le=24, description="Период данных WHERE created_at >=")
    columns: Literal["star", "narrow"] = Field(default="narrow", description="SELECT * vs SELECT id, query_name, buffer_cost")
    jsonb_filter: bool = Field(default=False, description="Включить JSONB containment filter @>")
```

> [!IMPORTANT]
> Пользователь НЕ пишет SQL. API формирует 2 запроса из шаблонов:
> 1. **Plan A** — Seq Scan (запрос без подходящего индекса, через SET для принудительного `enable_indexscan = off`)
> 2. **Plan B** — Index Scan (тот же запрос с работающим индексом)

#### Как формируются SQL-запросы

```python
# Колонки
cols = "*" if columns == "star" else "id, query_name, buffer_cost, created_at"

# WHERE clause
where_parts = [f"created_at >= NOW() - INTERVAL '{months} months'"]
if jsonb_filter:
    where_parts.append("payload @> '{\"labels\": {\"region\": \"eu-central\"}}'")

where = " AND ".join(where_parts)

# TABLESAMPLE для контроля объёма
sample_clause = f"TABLESAMPLE SYSTEM ({sample_pct})" if sample_pct < 100 else ""

sql = f"SELECT {cols} FROM probe_queries {sample_clause} WHERE {where} LIMIT 5000"
```

#### Два запуска в одном вызове

```python
# Plan A: принудительный Seq Scan
await conn.execute("SET LOCAL enable_indexscan = off")
await conn.execute("SET LOCAL enable_bitmapscan = off")
plan_a = await conn.fetchval(f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql}")

# Reset
await conn.execute("RESET enable_indexscan")
await conn.execute("RESET enable_bitmapscan")

# Plan B: все индексы доступны
plan_b = await conn.fetchval(f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql}")
```

#### Ответ (PgXrayExperimentResponse):
```python
class PlanSummary(BaseModel):
    node_type: str              # "Seq Scan", "Index Scan", "Bitmap Heap Scan"
    relation: str               # "probe_queries"
    index_name: Optional[str]   # "idx_probe_queries_tenant_created" или None
    execution_time_ms: float
    planning_time_ms: float
    actual_rows: int
    shared_hit: int             # блоки из RAM (shared_buffers)
    shared_read: int            # блоки, прочитанные с диска
    shared_hit_kb: int          # shared_hit * 8
    shared_read_kb: int         # shared_read * 8
    total_buffers_kb: int       # (hit + read) * 8
    startup_cost: float
    total_cost: float
    raw_plan: Dict[str, Any]    # полный JSON план для продвинутых

class PgXrayExperimentResponse(BaseModel):
    status: str
    scenario_label: str             # "50% выборки, 6 мес, узкие колонки, без JSONB"
    plan_a: PlanSummary             # Seq Scan (без индекса)
    plan_b: PlanSummary             # Index Scan (с индексом)
    speedup_factor: float           # plan_a.time / plan_b.time
    buffer_savings_pct: float       # % экономии shared_read
    sql_used: str                   # Показываем SQL для прозрачности
    insight: str                    # Почему план изменился
    version: str = "2.0.0"
```

### Безопасность

- SQL **не принимается от пользователя** — формируется из 4 параметров (sample_pct, months, columns, jsonb_filter)
- Все запросы выполняются внутри `readonly=True` транзакции с `statement_timeout = 1500ms`
- pglast валидация всё равно применяется к сгенерированному SQL (defense in depth)
- Prometheus: `probe_runs_total{trainer="pg-xray", scenario="...", status="..."}` — без UUID

### Simulation fallback

Если db_pool не подключен, `simulate_xray_experiment()` возвращает два фейковых плана с реалистичными числами на основе входных параметров:
- Больше sample_pct → больше shared_read
- SELECT * → больше total_buffers
- JSONB filter + GIN index → Bitmap Index Scan в Plan B
- Узкий период → меньше rows

---

## Frontend: полная перестройка PgXrayTrainer.tsx

### Структура компонента (сверху вниз)

#### 1. Заголовок секции
```
[DB icon] ТРЕНАЖЁР №2: POSTGRESQL QUERY X-RAY & АНАЛИЗАТОР SHARED BUFFERS
PostgreSQL Query X-Ray — сравнение планов запросов
Настройте параметры выборки, запустите опыт и увидите разницу
между Seq Scan и Index Scan на одних и тех же данных.
```

#### 2. Настройки опыта (левая панель на десктопе)
4 контрола с визуальной обратной связью:

| Контрол | Тип | Диапазон | По умолчанию |
|---------|-----|----------|-------------|
| Размер выборки | Range slider | 10–100% с шагом 10 | 50% |
| Период данных | Range slider | 1–24 мес с шагом 1 | 6 |
| Колонки | Toggle (2 кнопки) | `SELECT *` / `Только нужные` | Только нужные |
| JSONB фильтр | Toggle switch | Вкл / Выкл | Выкл |

Под контролами — preview SQL (read-only mono font), чтобы пользователь видел, какой запрос будет выполнен.

Кнопка: **▶ Запустить сравнение планов (EXPLAIN ANALYZE BUFFERS)**

#### 3. Результат: Side-by-Side план сравнения (центр)
Два столбца:

```
╔══════════════════════════╗  ╔══════════════════════════╗
║  PLAN A: БЕЗ ИНДЕКСА    ║  ║  PLAN B: С ИНДЕКСОМ      ║
║  ─────────────────────── ║  ║  ─────────────────────── ║
║  Node: Seq Scan          ║  ║  Node: Index Scan         ║
║  Index: —                ║  ║  Index: idx_tenant_created ║
║  Time:  14.85 ms  🔴     ║  ║  Time:  0.42 ms  🟢      ║
║  Rows:  2 400            ║  ║  Rows:  2 400             ║
║  ─── Shared Buffers ──── ║  ║  ─── Shared Buffers ──── ║
║  Hit (RAM): 45 blks      ║  ║  Hit (RAM): 180 blks     ║
║  Read (I/O): 820 blks    ║  ║  Read (I/O): 12 blks     ║
║  = 6.4 MB с диска*       ║  ║  = 96 KB с диска*        ║
║  *данные по buffers,     ║  ║  *данные по buffers,     ║
║   не гарант. физ. I/O    ║  ║   не гарант. физ. I/O    ║
╚══════════════════════════╝  ╚══════════════════════════╝

              ⚡ Index Scan быстрее в 35× раз
              📉 I/O сократился на 98.5%
```

> [!IMPORTANT]
> Подпись "данные по shared buffers" — не "физическое чтение с диска". Кэш влияет на результат.

#### 4. Метрики сессии (правая панель на десктопе)
- Последний запуск: время, тип плана
- Дельта vs предыдущий: `−85% быстрее` / `+340% больше I/O`
- История сохраняется в localStorage через useTelemetry()

#### 5. Insight блок (после планов)
Объяснение *почему* план изменился, привязанное к параметрам:
- «При JSONB фильтре PostgreSQL задействовал GIN индекс, переведя план из Seq Scan в Bitmap Index Scan»
- «SELECT * вынудил TOAST-деcompression, увеличив shared_read в 4× раза»
- «Уменьшение периода с 24 до 3 месяцев сузило выборку достаточно для Index Only Scan»

#### 6. Таблица решений (как в ExpertAnalysisTable для Sync/Async)
| Ситуация | Seq Scan | Index Scan |
|----------|----------|------------|
| Объём чтения (I/O) | Вся таблица | Только нужные страницы |
| Когда быстрее | Маленькие таблицы (<10K строк) | Всегда для точечных запросов |
| Влияние SELECT * | Критично: TOAST + cache eviction | Менее критично, но всё равно дороже |
| Потребление RAM | Высокое (вся таблица в shared_buffers) | Минимальное |

#### 7. SEO-статья (1000+ слов) — уже есть в HomePage, нужно убедиться что PG X-Ray секция видна.

#### 8. Рекламный / партнёрский слот (CLS=0)
`<AdSlot type="card" variant="cloud-postgres" />` — фиксированная высота 260px.

### Мобильная версия
Те же секции, но вертикально:
1. Настройки (collapsed accordion?)
2. Кнопка запуска
3. Планы A и B (стек, не колонки)
4. Insight
5. Таблица
6. Статья

---

## Файлы для изменения

### Backend (3 файла):
1. **`backend/app/api/v1/probe.py`** — Новые модели `PgXrayExperimentRequest`, `PgXrayExperimentResponse`, `PlanSummary`. Переписать `POST /probe/pg-xray`.
2. **`backend/app/core/pg_xray.py`** — Новая функция `run_xray_experiment(params)` → возвращает два плана. Новый `simulate_xray_experiment(params)` для fallback.
3. **`tests/test_pg_xray.py`** — Обновить тесты под новый формат.

### Frontend (1 файл — полная перезапись):
1. **`frontend/src/components/PgXrayTrainer.tsx`** — Полностью новый компонент.

### НЕ трогаем:
- `sql_security.py` — уже рабочий, просто вызываем для defense-in-depth
- `TelemetryContext.tsx` — используем существующий `recordExperiment()`
- `HomePage.tsx` — PgXrayTrainer уже подключен, менять интеграцию не нужно

---

## Порядок реализации

1. **Backend первый**: новый `run_xray_experiment()` + simulation fallback
2. **API endpoint**: переписать `POST /probe/pg-xray` с новыми моделями
3. **Тесты**: 6-8 тестов покрывающих все комбинации параметров
4. **Frontend**: новый PgXrayTrainer.tsx
5. **Проверка**: `npm run build` (0 TS errors) + `pytest` (все зелёные)
6. **Коммит**: `feat(week3): redesign PostgreSQL X-Ray as interactive lesson with side-by-side plan comparison`

---

## Контрольный чек-лист CODEX.md

- [ ] Zero PII: ни UUID сессий, ни IP в audit log / Prometheus
- [ ] SQL формируется сервером, не пользователем
- [ ] pglast валидация даже для server-generated SQL (defense in depth)
- [ ] statement_timeout = 1500ms
- [ ] readonly=True транзакция
- [ ] shared buffers подписаны как "данные по buffers", не "физический диск"
- [ ] CLS=0: все слоты с min-height
- [ ] localStorage для истории, сервер не хранит пользовательские данные
- [ ] Prometheus: только агрегаты trainer/scenario/status
