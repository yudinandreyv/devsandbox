import React from 'react';
import { AlertCircle } from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import { SeoHead } from '../components/SeoHead';

export const TermsOfServicePage: React.FC = () => {
  const { locale } = useI18n();
  const isRu = locale === 'ru';

  return (
    <>
      <SeoHead
        title={isRu ? 'Условия использования' : 'Terms of Service'}
        description={
          isRu
            ? 'Условия использования интерактивной платформы DevSandbox: правила песочницы, защита от злоупотреблений и лимиты.'
            : 'DevSandbox Terms of Service: acceptable use policy, sandbox boundaries, and rate limiting rules.'
        }
        canonicalPath="/terms-of-service"
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div>
          <span className="text-xs font-mono font-bold uppercase text-brand-600 dark:text-sky-400">
            {isRu ? 'Юридическая база' : 'Legal Documentation'}
          </span>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white mt-1">
            {isRu ? 'Условия использования (Terms of Service)' : 'Terms of Service'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-mono">
            Version 1.0.0 | Applicable to gateaway.cloud
          </p>
        </div>

        <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-3">
          <AlertCircle aria-hidden="true" className="w-5 h-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="leading-relaxed">
            {isRu
              ? 'Правило добросовестного использования песочницы: сервис предназначен исключительно для образовательного тестирования, бенчмаркинга и изучения архитектурных концепций.'
              : 'Fair Use Sandbox Policy: The service is provided strictly for educational profiling, benchmarking, and architectural exploration.'}
          </p>
        </div>

        <section className="space-y-4 text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
            {isRu ? '1. Доступ к интерактивной песочнице' : '1. Sandbox Access and Fair Usage'}
          </h2>
          <p>
            {isRu
              ? 'Доступ к API-пробам и тренажёрам предоставляется бесплатно в рамках гостевой сессии с применением автоматических ограничений скорости (Rate Limits: 30–60 запросов в минуту). Мы оставляем за собой право временно блокировать IP-адреса, генерирующие аномальный автоматизированный трафик.'
              : 'Access to sandbox probes is granted free of charge via guest sessions subject to automated rate limits (30–60 requests/minute). We reserve the right to temporarily throttle or ban clients generating abusive automated traffic.'}
          </p>

          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white pt-4">
            {isRu ? '2. Запрещенная активность' : '2. Prohibited Activities'}
          </h2>
          <p>
            {isRu
              ? 'Категорически запрещается: попытки обхода изоляции Kubernetes неймспейса, инъекции вредоносных SQL-команд в обход read-only парсера, эксплуатация уязвимостей FastAPI/Postgres, а также распределенные DoS-атаки на инфраструктуру.'
              : 'Prohibited actions include: attempting to bypass Kubernetes namespace isolation, injecting destructive SQL commands outside the read-only AST parser, exploiting FastAPI or PostgreSQL vulnerabilities, and initiating distributed denial of service attacks.'}
          </p>

          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white pt-4">
            {isRu ? '3. Ограничение ответственности' : '3. Disclaimer of Warranties'}
          </h2>
          <p>
            {isRu
              ? 'Платформа предоставляется по принципу «как есть» (AS IS). Авторы не несут ответственности за результаты бенчмарков, временные сбои в работе тестового кластера или изменения сетевых задержек.'
              : 'The platform is provided on an "as is" and "as available" basis without warranties of any kind. Authors disclaim liability for benchmark outcome discrepancies or intermittent sandbox maintenance downtime.'}
          </p>
        </section>
      </div>
    </>
  );
};
