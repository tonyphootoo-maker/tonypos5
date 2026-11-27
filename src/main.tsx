import React, { Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext.tsx';
import { resolveAppMode } from './engine/onlineOrdering.ts';
import { lazyWithRetry } from './utils/lazyWithRetry.ts';
import './index.css';

const LazyOwnerApp = lazyWithRetry(() => import('./App.tsx'));
const LazyCustomerOrderPage = lazyWithRetry(() =>
  import('./pages/CustomerOrderPage.tsx').then((m) => ({ default: m.CustomerOrderPage }))
);
const LazyRiderAppPage = lazyWithRetry(() =>
  import('./pages/RiderAppPage.tsx').then((m) => ({ default: m.RiderAppPage }))
);

const entryMode =
  typeof window !== 'undefined'
    ? resolveAppMode(window.location.search, window.location.pathname, window.location.hash)
    : 'owner';

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

// Register PWA Service Worker across Owner POS, Rider, and Customer Ordering modes
// so mobile Chrome / Safari / Edge treat the storefront as an installable standalone app.
if (
  typeof window !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator
) {
  try {
    registerSW({ immediate: true });
  } catch {
    // Ignore SW registration errors on restricted WebViews
  }
}

function BootFallback({ mode }: { mode: 'customer' | 'rider' | 'owner' }) {
  const { lang } = useLanguage();
  const isDark = mode === 'rider';
  const label =
    mode === 'customer'
      ? lang === 'th'
        ? 'กำลังโหลดเมนูออนไลน์...'
        : 'Loading Online Menu...'
      : mode === 'rider'
      ? lang === 'th'
        ? 'กำลังโหลดแอป Rider...'
        : 'Loading Rider App...'
      : lang === 'th'
      ? 'กำลังโหลดระบบ...'
      : 'Loading...';

  return (
    <div
      className={`min-h-screen min-h-[100dvh] w-full flex flex-col items-center justify-center p-6 text-xs font-bold ${
        isDark ? 'bg-slate-950 text-slate-200' : 'bg-[#FAF8F5] text-slate-700'
      }`}
    >
      <div
        className={`w-7 h-7 rounded-full border-2 border-t-transparent animate-spin mb-3 ${
          isDark ? 'border-emerald-400' : 'border-orange-600'
        }`}
      />
      <span>{label}</span>
    </div>
  );
}

function RiderEntryShell() {
  const { lang } = useLanguage();
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  useEffect(() => {
    const handleQuota = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuota);
  }, []);

  return (
    <>
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-[70] shadow-sm">
          <span>
            {lang === 'th'
              ? 'ใช้งานโควตา Google Maps Platform ครบกำหนดแล้ว หากคุณเป็นเจ้าของแอป โปรดดูวิธีอัปเดตบัญชีได้ที่ '
              : 'Google Maps Platform quota reached. If you are the app owner, visit '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              {lang === 'th' ? 'เว็บไซต์นักพัฒนา Maps' : 'maps developer site'}
            </a>
            {lang === 'th' ? '' : ' for instructions to update your account.'}
          </span>
        </div>
      )}
      <LazyRiderAppPage lang={lang} />
    </>
  );
}

function RootEntry() {
  return (
    <Suspense fallback={<BootFallback mode={entryMode} />}>
      {entryMode === 'customer' ? (
        <LazyCustomerOrderPage />
      ) : entryMode === 'rider' ? (
        <RiderEntryShell />
      ) : (
        <LazyOwnerApp />
      )}
    </Suspense>
  );
}

// Remove initial bootstrap message once React mounts
const bootMsg = document.getElementById('boot-msg');
if (bootMsg) {
  bootMsg.remove();
}

createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <ErrorBoundary>
      <RootEntry />
    </ErrorBoundary>
  </LanguageProvider>
);
