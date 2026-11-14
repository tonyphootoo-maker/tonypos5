import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import {
  SettingsDoc,
  Language,
  ShiftDoc,
} from './types';
import { translations } from './i18n/translations';
import {
  subscribeAuth,
  signInWithGoogle,
  subscribeSettings,
  subscribeCollection,
  firebaseInitError,
} from './data/db';
import { Navigation, AppPage } from './components/Navigation';
import { PWAInstallButton } from './components/PWAInstallButton';
import { ShiftModal } from './components/ShiftModal';
import { TablesPosPage } from './pages/TablesPosPage';
import { MenuFoodCostPage } from './pages/MenuFoodCostPage';
import { OptionGroupsPage } from './pages/OptionGroupsPage';
import { BillsHistoryPage } from './pages/BillsHistoryPage';
import { FinancePage } from './pages/FinancePage';
import { ReportsPage } from './pages/ReportsPage';
import { DashboardPage } from './pages/DashboardPage';
import { BackupPage } from './pages/BackupPage';
import { SettingsPage } from './pages/SettingsPage';
import { CostingWorkspace, CostingTabId } from './costing/CostingWorkspace';
import {
  UtensilsCrossed,
  Sparkles,
  Lock,
  Globe,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [lang, setLang] = useState<Language>('th'); // Default to Thai with 1-click toggle to English

  const [settings, setSettings] = useState<SettingsDoc | null>(null);
  const [currentPage, setCurrentPage] = useState<AppPage>('pos');
  const [activeShift, setActiveShift] = useState<ShiftDoc | null>(null);
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const t = translations[lang];

  // Subscribe to Auth state changes and wire real-time Settings & Shifts listeners
  useEffect(() => {
    let isMounted = true;
    let unsubSettings: (() => void) | null = null;
    let unsubShifts: (() => void) | null = null;

    const cleanupDataSubs = () => {
      if (unsubSettings) {
        unsubSettings();
        unsubSettings = null;
      }
      if (unsubShifts) {
        unsubShifts();
        unsubShifts = null;
      }
    };

    // Safety timeout: Never stay stuck on loading screen
    const timer = setTimeout(() => {
      if (isMounted) {
        setAuthLoading(false);
      }
    }, 3500);

    const unsubscribe = subscribeAuth((currentUser) => {
      if (!isMounted) return;
      cleanupDataSubs();
      setUser(currentUser);

      if (currentUser) {
        unsubSettings = subscribeSettings(
          (loadedSettings) => {
            if (!isMounted) return;
            setSettings(loadedSettings);
            clearTimeout(timer);
            setAuthLoading(false);
          },
          (err) => {
            console.error('Error subscribing settings:', err);
            if (isMounted) {
              setSettings((prev) =>
                prev || {
                  id: 'main',
                  shopName: 'KinPOS Restaurant',
                  shopAddress: 'Bangkok, Thailand',
                  shopPhone: '02-123-4567',
                  taxId: '0105558000000',
                  receiptHeader: 'Welcome to KinPOS',
                  receiptFooter: 'Thank you for your visit!',
                  targetFoodCostPercent: 30,
                  vatPercent: 7,
                  serviceChargePercent: 10,
                  dailyClosingTime: '04:00',
                  pointsEarnUnitThb: 100,
                  pointsRedeemValueThb: 1,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  version: 1,
                }
              );
              clearTimeout(timer);
              setAuthLoading(false);
            }
          }
        );

        unsubShifts = subscribeCollection<ShiftDoc>(
          'shifts',
          (shifts) => {
            if (!isMounted) return;
            const openOne = shifts.find((s) => s.status === 'open');
            setActiveShift(openOne || null);
          },
          (err) => {
            console.error('Error subscribing shifts:', err);
          }
        );
      } else {
        setSettings(null);
        setActiveShift(null);
        clearTimeout(timer);
        setAuthLoading(false);
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(timer);
      cleanupDataSubs();
      unsubscribe();
    };
  }, []);

  const handleToggleLanguage = () => {
    setLang((prev) => (prev === 'th' ? 'en' : 'th'));
  };

  const handleGoogleSignIn = async () => {
    setLoginError(null);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      console.error('Google Sign-In Error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('auth/unauthorized-domain')) {
        setLoginError(
          lang === 'th'
            ? 'โดเมนนี้ยังไม่ได้รับอนุญาตใน Firebase Authentication: ไปที่ Firebase Console > Authentication > Settings > Authorized Domains และเพิ่มโดเมน GitHub Pages ของคุณ'
            : 'Domain not authorized: Please add your GitHub Pages domain in Firebase Console > Authentication > Settings > Authorized Domains.'
        );
      } else if (msg.includes('popup-blocked')) {
        setLoginError(
          lang === 'th'
            ? 'เบราว์เซอร์บล็อกป๊อปอัป กรุณาเปิดใช้งานป๊อปอัปสำหรับหน้านี้'
            : 'Popup blocked by browser. Please allow popups to sign in.'
        );
      } else {
        setLoginError(msg);
      }
    }
  };

  // 1. Initial Loading Screen
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#ffffff_0%,_#eef2f7_65%,_#e2e8f0_100%)] flex flex-col items-center justify-center p-4 text-slate-900 select-none">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_5px_0_#c2410c,0_16px_30px_rgba(234,88,12,0.28)] border border-orange-300/60 mb-4">
          <UtensilsCrossed className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">KinPOS</h1>
        <p className="text-xs text-orange-600 font-bold mt-1">
          {t.common.loading}
        </p>
      </div>
    );
  }

  // 2. Login Screen (Shown ONLY when signed out)
  if (!user) {
    return (
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#ffffff_0%,_#eef2f7_60%,_#e2e8f0_100%)] flex flex-col justify-between p-4 sm:p-6 select-none text-slate-900">
        {/* Top Bar with PWA Install & Language Switcher */}
        <div className="flex justify-end items-center gap-2">
          <PWAInstallButton lang={lang} variant="button" />
          <button
            onClick={handleToggleLanguage}
            className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-[0_2px_0_#e2e8f0]"
          >
            <Globe className="w-3.5 h-3.5 text-orange-600" />
            <span>{lang === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}</span>
          </button>
        </div>

        {/* Center Clean 3D Login Card */}
        <div className="max-w-md w-full mx-auto my-auto bg-white p-7 sm:p-8 rounded-3xl border border-slate-200 shadow-[inset_0_1px_0_#ffffff,0_6px_0_0_#dce3ee,0_24px_50px_-12px_rgba(15,23,42,0.16)] space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_5px_0_#c2410c,0_14px_26px_rgba(234,88,12,0.28)] border border-orange-300/60">
              <UtensilsCrossed className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900 pt-2">
              KinPOS
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              {t.tagline}
            </p>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200/90 rounded-2xl text-xs space-y-1.5 shadow-[inset_0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="font-bold text-slate-800 flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-orange-600" />
              <span>{t.auth.title}</span>
            </div>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              {t.auth.subtitle}
            </p>
            <p className="text-slate-400 text-[10px]">
              {t.auth.keepSignedInNote}
            </p>
          </div>

          {firebaseInitError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-semibold space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-rose-800">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Firebase Initialization Error / ข้อผิดพลาดการเชื่อมต่อ</span>
              </div>
              <div className="text-[11px] text-rose-600 break-all">{firebaseInitError}</div>
            </div>
          )}

          {loginError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-semibold">
              {loginError}
            </div>
          )}

          {/* Google Sign-in Tactile 3D Button */}
          <button
            onClick={handleGoogleSignIn}
            className="w-full py-3.5 px-4 bg-white hover:bg-slate-50 text-slate-900 font-extrabold text-sm rounded-2xl border border-slate-300 shadow-[inset_0_1px_0_#ffffff,0_4px_0_#cbd5e1,0_10px_20px_-6px_rgba(15,23,42,0.12)] flex items-center justify-center gap-3 active:translate-y-[2px] transition-all cursor-pointer"
          >
            {/* Google SVG Icon */}
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>{t.auth.googleSignIn}</span>
          </button>
        </div>

        {/* Footer */}
        <div className="text-center text-[11px] text-slate-400">
          KinPOS • Multi-Tab Offline &amp; Real-Time Sync Engine
        </div>
      </div>
    );
  }

  // 3. Authenticated App Layout
  if (!settings) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-transparent text-slate-600 text-xs">
        <Loader2 className="w-5 h-5 animate-spin text-orange-600 mr-2" />
        <span>Initializing store configuration...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Universal Top Navigation & Hamburger Menu */}
      <Navigation
        currentPage={currentPage}
        onSelectPage={(p) => setCurrentPage(p)}
        lang={lang}
        onToggleLang={handleToggleLanguage}
        userEmail={user.email}
        activeShift={activeShift}
        onOpenShiftModal={() => setIsShiftModalOpen(true)}
      />

      {/* Main Active Page Content */}
      <main className="flex-1 overflow-x-hidden">
        {currentPage === 'pos' && (
          <TablesPosPage settings={settings} lang={lang} />
        )}
        {currentPage === 'menu_cost' && (
          <MenuFoodCostPage settings={settings} lang={lang} />
        )}
        {currentPage === 'option_groups' && (
          <OptionGroupsPage settings={settings} lang={lang} />
        )}
        {currentPage === 'bills' && (
          <BillsHistoryPage settings={settings} lang={lang} />
        )}
        {currentPage === 'finance' && (
          <FinancePage settings={settings} lang={lang} />
        )}
        {currentPage === 'reports' && (
          <ReportsPage settings={settings} lang={lang} />
        )}
        {currentPage === 'dashboard' && (
          <DashboardPage settings={settings} lang={lang} onNavigate={(p) => setCurrentPage(p)} />
        )}
        {currentPage === 'backup' && (
          <BackupPage settings={settings} lang={lang} />
        )}
        {currentPage === 'settings' && (
          <SettingsPage
            settings={settings}
            lang={lang}
            onSettingsUpdated={(newSet) => setSettings(newSet)}
          />
        )}
        {currentPage.startsWith('cost_') && (
          <CostingWorkspace
            activeTab={currentPage.replace(/^cost_/, '') as CostingTabId}
            onSelectCostTab={(tab) => setCurrentPage(`cost_${tab}` as AppPage)}
            onNavigateToPos={() => setCurrentPage('pos')}
            user={user}
            lang={lang}
          />
        )}
      </main>

      {/* Cash Shift Modal */}
      {isShiftModalOpen && (
        <ShiftModal
          activeShift={activeShift}
          settings={settings}
          lang={lang}
          onClose={() => setIsShiftModalOpen(false)}
          onShiftUpdated={(shift) => setActiveShift(shift)}
        />
      )}
    </div>
  );
}
