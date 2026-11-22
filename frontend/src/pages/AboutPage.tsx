import React from 'react';
import { ShieldCheck, Layers, Cpu, Database } from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import { SeoHead } from '../components/SeoHead';
import { AdSlot } from '../components/AdSlot';

export const AboutPage: React.FC = () => {
  const { locale } = useI18n();

  const isRu = locale === 'ru';

  return (
    <>
      <SeoHead
        title={isRu ? 'Архитектура и изоляция' : 'Architecture & Isolation'}
        description={
          isRu
            ? 'Архитектурный манифест и защита от сбоев интерактивной песочницы DevSandbox в Kubernetes k3s.'
            : 'Architectural blueprint, blast radius containment, and Kubernetes k3s sandbox isolation.'
        }
        canonicalPath="/about"
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
        <div>
          <span className="text-xs font-mono font-bold uppercase text-brand-600 dark:text-sky-400">
            {isRu ? 'Инженерный манифест' : 'Engineering Manifesto'}
          </span>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white mt-1">
            {isRu ? 'Архитектура и изоляция платформы' : 'Platform Architecture & Isolation'}
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
            {isRu
              ? 'Как мы проектируем интерактивную песочницу, способную выдерживать тяжелые запросы разработчиков и DDoS-ботов без деградации хоста.'
              : 'How we design an interactive sandbox capable of withstanding heavy developer queries and bot scrapers without host degradation.'}
          </p>
        </div>

        {/* 3 Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 space-y-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <ShieldCheck aria-hidden="true" className="w-5 h-5" />
            </div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {isRu ? 'Изоляция Namespace' : 'Namespace Quotas'}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {isRu
                ? 'Sandbox вынесен в отдельный namespace в k3s с ResourceQuota: 2.5 vCPU и 4 GiB RAM максимум. При всплеске песочница не затронет основной кластер.'
                : 'Isolated in dedicated k3s sandbox namespace with strict ResourceQuota (2.5 vCPU, 4 GiB RAM). Cannot starve adjacent workloads.'}
            </p>
          </div>

          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 space-y-2">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-500 flex items-center justify-center">
              <Database aria-hidden="true" className="w-5 h-5" />
            </div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {isRu ? 'Postgres Sandbox Invariants' : 'Database Hardening'}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {isRu
                ? 'Строгий пользователь sandbox_readonly, таймаут SET LOCAL statement_timeout = 1500ms и синтаксический анализ AST через sqlglot до выполнения.'
                : 'Unprivileged sandbox_readonly role, mandatory 1500ms statement timeout, and AST pre-validation via sqlglot.'}
            </p>
          </div>

          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 space-y-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <Cpu aria-hidden="true" className="w-5 h-5" />
            </div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {isRu ? 'Защита от CLS = 0.000' : 'CLS = 0.000 Guarantee'}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {isRu
                ? 'Фиксированные слоты под рекламу и виджеты с min-height исключают скачки верстки при асинхронной загрузке скриптов AdSense/Mediavine.'
                : 'Fixed-height reservation slots prevent Cumulative Layout Shift (CLS) when third-party ad tags hydrate asynchronously.'}
            </p>
          </div>
        </div>

        {/* Technical Architecture Specs */}
        <section className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 font-mono text-xs space-y-4">
          <h2 className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm">
            <Layers aria-hidden="true" className="w-4 h-4 text-brand-500" />
            <span>Kubernetes Sandbox Stack Specification (k8s/sandbox-stack.yaml)</span>
          </h2>

          <div className="space-y-2 text-slate-600 dark:text-slate-400 leading-relaxed">
            <p>• <strong>Ingress & Routing:</strong> NGINX Gateway Fabric HTTPRoute bound to hostname <code>gateaway.cloud</code></p>
            <p>• <strong>Frontend Tier:</strong> 2x Pods Nginx + React 18 SPA (Non-root user UID 101, Port 80)</p>
            <p>• <strong>API Tier:</strong> 2x Pods FastAPI / Uvicorn (Non-root user UID 1000, Port 8000, read-only root filesystem)</p>
            <p>• <strong>Rate Limiter:</strong> SlowAPI IP-based memory sliding window + Redis distributed rate limiting</p>
          </div>
        </section>

        <AdSlot type="leaderboard" variant="github" />
      </div>
    </>
  );
};
