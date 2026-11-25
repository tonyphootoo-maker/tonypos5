import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { LanguageProvider } from './contexts/LanguageContext.tsx';
import { resolveAppMode } from './engine/onlineOrdering.ts';
import './index.css';

// Register Tier 1 Google Maps Platform Demo Key quota & auth failure guard before render
if (typeof window !== 'undefined') {
  (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  };
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    origConsoleError.apply(console, args);
    const msg = args.map((a) => String(a)).join(' ');
    if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
  };
}

// Register Service Worker for Owner POS & Rider offline support (skip in Customer link mode to avoid iOS Safari/WebView SW cache/reload stalls)
if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  const entryMode = resolveAppMode(window.location.search, window.location.pathname);
  if (entryMode !== 'customer') {
    try {
      registerSW({ immediate: true });
    } catch {
      // Ignore SW registration errors on restricted WebViews
    }
  }
}

// Remove initial bootstrap message once React mounts
const bootMsg = document.getElementById('boot-msg');
if (bootMsg) {
  bootMsg.remove();
}

createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </LanguageProvider>
);
