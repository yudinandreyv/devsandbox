import React from 'react';
import { useI18n } from './context/I18nContext';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { HomePage } from './pages/HomePage';
import { AboutPage } from './pages/AboutPage';
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage';
import { TermsOfServicePage } from './pages/TermsOfServicePage';
import { ContactPage } from './pages/ContactPage';

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
      <Navbar />
      <main className="flex-1 w-full">
        {renderCurrentPage()}
      </main>
      <Footer />
    </div>
  );
};

export default App;
