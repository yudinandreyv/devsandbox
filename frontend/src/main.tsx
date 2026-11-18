import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { ThemeProvider } from './context/ThemeContext';
import { I18nProvider } from './context/I18nContext';
import { TelemetryProvider } from './context/TelemetryContext';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <TelemetryProvider>
          <App />
        </TelemetryProvider>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>
);
