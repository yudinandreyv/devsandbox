import React, { useEffect, useRef, useState } from 'react';
import { Mail, Send, CheckCircle2, Github } from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import { SeoHead } from '../components/SeoHead';

export const ContactPage: React.FC = () => {
  const { locale, t } = useI18n();
  const isRu = locale === 'ru';
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const successRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (submitted) successRef.current?.focus();
  }, [submitted]);
  const [formData, setFormData] = useState({ email: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/v1/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!response.ok) throw new Error('contact request failed');
      setSubmitted(true);
    } catch {
      setError(t.contactPage.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <SeoHead
        title={isRu ? 'Контакты и обратная связь' : 'Contact & Feedback'}
        description={
          isRu
            ? 'Свяжитесь с разработчиками DevSandbox для предложений по тренажёрам, баг-репортам или вопросам интеграции.'
            : 'Contact the DevSandbox engineering team for probe proposals, bug reports, and sponsorship inquiries.'
        }
        canonicalPath="/contact"
      />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div>
          <span className="text-xs font-mono font-bold uppercase text-brand-600 dark:text-sky-400">
            {isRu ? 'Обратная связь' : 'Get in Touch'}
          </span>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white mt-1">
            {isRu ? 'Контакты и сообщество' : 'Contact & Community'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
            {isRu
              ? 'Есть идеи для новых тренажёров HighLoad или нашли баг в изоляции? Напишите нам или откройте Issue на GitHub.'
              : 'Have an idea for a new HighLoad interactive probe or noticed an anomaly? Drop us a note or open an issue on GitHub.'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-500/10 text-brand-500 flex items-center justify-center shrink-0">
              <Mail aria-hidden="true" className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-500 font-mono">{t.contactPage.directEmail}</div>
              <a
                href="mailto:yudin.andrey.v@gmail.com"
                className="text-sm font-semibold text-slate-900 dark:text-white hover:text-brand-600 dark:hover:text-brand-400"
              >
                yudin.andrey.v@gmail.com
              </a>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-900/10 dark:bg-white/10 text-slate-900 dark:text-white flex items-center justify-center shrink-0">
              <Github aria-hidden="true" className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-500 font-mono">{t.contactPage.githubProfile}</div>
              <a
                href="https://github.com/yudinandreyv"
                target="_blank"
                aria-label={`${t.contactPage.githubProfile} — ${t.contactPage.opensNewTab}`}
                rel="noopener noreferrer"
                className="text-sm font-semibold text-slate-900 dark:text-white hover:text-brand-600 dark:hover:text-brand-400"
              >
                github.com/yudinandreyv
              </a>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="p-6 sm:p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 shadow-sm">
          {submitted ? (
            <div className="py-10 text-center space-y-3">
              <CheckCircle2 aria-hidden="true" className="w-12 h-12 text-emerald-500 mx-auto" />
              <h2 ref={successRef} role="status" tabIndex={-1} className="text-lg font-bold text-slate-900 dark:text-white focus:outline-none">
                {isRu ? 'Сообщение успешно отправлено!' : 'Message Sent Successfully!'}
              </h2>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {isRu
                  ? 'Спасибо за обратную связь. Мы ответим на указанный email в течение 24 часов.'
                  : 'Thank you for your feedback. We will get back to you within 24 hours.'}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="contact-email" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {isRu ? 'Ваш Email' : 'Email Address'}
                </label>
                <input
                  id="contact-email"
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="developer@example.com"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-brand-500 focus:outline-none"
                />
              </div>

              {error && <p role="alert" className="text-xs text-red-500">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 px-4 disabled:opacity-60 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs sm:text-sm shadow-md shadow-brand-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Send aria-hidden="true" className="w-4 h-4" />
                <span>{submitting ? t.contactPage.sending : (isRu ? 'Отправить сообщение' : 'Send Message')}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
};
