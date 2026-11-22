import React from 'react';
import { Shield } from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import { SeoHead } from '../components/SeoHead';

export const PrivacyPolicyPage: React.FC = () => {
  const { locale, navigate } = useI18n();
  const isRu = locale === 'ru';

  return (
    <>
      <SeoHead
        title={isRu ? 'Политика конфиденциальности' : 'Privacy Policy'}
        description={
          isRu
            ? 'Политика конфиденциальности DevSandbox: анонимные гостевые сессии, локальная телеметрия в браузере и соответствие GDPR.'
            : 'DevSandbox Privacy Policy: anonymous guest sessions, client-side localStorage telemetry, and GDPR compliance.'
        }
        canonicalPath="/privacy-policy"
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div>
          <span className="text-xs font-mono font-bold uppercase text-brand-600 dark:text-sky-400">
            {isRu ? 'Юридическая база' : 'Legal Documentation'}
          </span>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white mt-1">
            {isRu ? 'Политика конфиденциальности' : 'Privacy Policy'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-mono">
            Last Updated: November 2026 | Effective Date: Stage 1 MVP Launch
          </p>
        </div>

        <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-3">
          <Shield aria-hidden="true" className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
          <p className="leading-relaxed">
            {isRu
              ? 'Принцип конфиденциальности по умолчанию: DevSandbox не собирает персональные данные, пароли или email-адреса на этапе гостевой сессии. Вся телеметрия хранится локально в localStorage вашего браузера.'
              : 'Privacy by Default: DevSandbox does not collect personally identifiable information (PII), passwords, or email addresses during guest sessions. Performance telemetry remains strictly local in your browser localStorage.'}
          </p>
        </div>

        <section className="space-y-4 text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
            {isRu ? '1. Собираемые данные и сессии' : '1. Information We Collect and Guest Sessions'}
          </h2>
          <p>
            {isRu
              ? 'На Этапе 1 платформа работает в режиме гостевых сессий. Каждому посетителю генерируется случайный псевдонимный UUID (например, a1b2c3d4-xxxx-xxxx). Этот идентификатор не связывается с реальной личностью пользователя, IP-адресом или геолокацией.'
              : 'During Stage 1, the platform operates under ephemeral Guest Sessions. Visitors receive a randomly generated pseudonymous UUID stored locally in browser storage. This identifier is never linked to personal identities, phone numbers, or residential addresses.'}
          </p>

          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white pt-4">
            {isRu ? '2. Использование локального хранилища (localStorage)' : '2. Use of LocalStorage and Telemetry'}
          </h2>
          <p>
            {isRu
              ? 'Мы используем localStorage браузера исключительно для сохранения ваших настроек (светлая/тёмная тема, выбранный язык en/ru) и технической телеметрии тренажёров (количество запусков проб и имитация прочитанных мегабайт).'
              : 'We utilize browser localStorage strictly to preserve user preferences (light/dark theme toggle, active locale) and sandbox performance counters (probes executed and simulated buffer scan volume).'}
          </p>

          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white pt-4">
            {isRu ? '3. Сторонние сервисы и реклама' : '3. Third-Party Services and Advertising'}
          </h2>
          <p>
            {isRu
              ? 'Для защиты от ботов и ускорения доставки контента используется Cloudflare Edge. В будущем на сайте могут отображаться партнёрские ссылки и рекламные блоки Google AdSense в специально зарезервированных слотах без изменения верстки.'
              : 'Cloudflare Edge CDN is utilized for edge caching, SSL, and anti-bot mitigation. In future iterations, advertising networks (Google AdSense / Mediavine) may serve ads into fixed layout slots without triggering layout shifts.'}
          </p>

          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white pt-4">
            {isRu ? '4. Права пользователя (GDPR / CCPA)' : '4. Your Data Rights (GDPR & CCPA)'}
          </h2>
          <p>
            {isRu
              ? 'Вы имеете право в любой момент очистить всю сохранённую телеметрию нажатием кнопки «Сбросить телеметрию» в верхней панели либо очистив данные сайта в настройках браузера.'
              : 'You have the absolute right to erase all cached session metrics at any time by clicking "Reset Local Telemetry" in the status bar or clearing browser storage.'}
          </p>
        <p className="text-xs sm:text-sm">
          <a
            href="/contact"
            onClick={(event) => { event.preventDefault(); navigate('/contact'); }}
            className="font-semibold text-brand-600 dark:text-sky-400 hover:underline"
          >
            {isRu ? 'Открыть страницу контактов' : 'Open the contact page'}
          </a>
        </p>
        </section>
      </div>
    </>
  );
};
