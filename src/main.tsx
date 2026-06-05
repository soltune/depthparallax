import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { LanguageProvider } from './i18n/LanguageProvider';
import { start as startDiagnostics } from './utils/diagnostics';

// 診断ロガー (?diag=1 で有効化)。 React レンダー前にブートを記録するため、
// createRoot より先に呼ぶ。
startDiagnostics();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

createRoot(rootElement).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
);
