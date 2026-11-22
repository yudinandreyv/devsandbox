import React, { lazy, Suspense } from 'react';
import { useI18n } from './context/I18nContext';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { HomePage } from './pages/HomePage';

const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage').then((m) => ({ default: m.PrivacyPolicyPage })));
const TermsOfServicePage = lazy(() => import('./pages/TermsOfServicePage').then((m) => ({ default: m.TermsOfServicePage })));
const ContactPage = lazy(() => import('./pages/ContactPage').then((m) => ({ default: m.ContactPage })));

const PageFallback: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    aria-busy="true"
    className="min-h-[60vh] flex items-center justify-center text-xs font-mono text-slate-400"
  >
    <span className="sr-only">Loading page</span>
    <span aria-hidden="true">Loading…</span>
  </div>
);

export const App: React.FC = () => {
  const { currentPath } = useI18n();

  const renderCurrentPage = () => {
    switch (currentPath) {
      case '/about':
        return <AboutPage />;
      case '/privacy-policy':
        return <PrivacyPolicyPage />;
      case '/terms-of-service':
        return <TermsOfServicePage />;
      case '/contact':
        return <ContactPage />;
      case '/':
      default:
        return <HomePage />;
    }
  };

  return (
    <div className="app-theme-shell min-h-screen flex flex-col justify-between selection:bg-brand-500 selection:text-white">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg"
      >
        Skip to main content
      </a>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="flex-1 w-full focus:outline-none">
        <Suspense fallback={<PageFallback />}>{renderCurrentPage()}</Suspense>
      </main>
      <Footer />
    </div>
  );
};

export default App;
