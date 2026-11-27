import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { User } from 'firebase/auth';
import {
  CategoryDoc,
  DishDoc,
  OnlineOrderDoc,
  OnlineOrderStatus,
  OptionGroupDoc,
  SettingsDoc,
  ShiftDoc,
} from './types';
import { useLanguage } from './contexts/LanguageContext';
import {
  subscribeAuth,
  signInWithGoogle,
  subscribeSettings,
  subscribeCollection,
  subscribeTranslationGlossary,
  saveTranslationGlossaryToCloud,
  firebaseInitError,
} from './data/db';
import {
  getShopTranslationGlossary,
  mergeShopTranslationGlossary,
  subscribeShopTranslationGlossary,
} from './utils/thaiToEnglish';
import {
  publishMenuToPublicStore,
  subscribeOwnerOnlineOrders,
  updateOnlineOrderByOwner,
} from './data/onlineDb';
import {
  buildOnlineOrderNumberingMap,
  getPendingOnlineOrders,
  playIncomingOrderChime,
  resolveAppMode,
} from './engine/onlineOrdering';
import { Navigation, AppPage } from './components/Navigation';
import { OnlineOrderFloatingAlert } from './components/OnlineOrderFloatingAlert';
import { OnlineOrderCancelledAlert } from './components/OnlineOrderCancelledAlert';
import { OnlineOrderReceiptModal } from './components/OnlineOrderModals';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { LanguageToggle } from './components/LanguageToggle';
import { ShiftModal } from './components/ShiftModal';
import { TablesPosPage } from './pages/TablesPosPage';
import { FloorPlanPage } from './pages/FloorPlanPage';
import { MenuFoodCostPage } from './pages/MenuFoodCostPage';
import { OptionGroupsPage } from './pages/OptionGroupsPage';
import { BillsHistoryPage } from './pages/BillsHistoryPage';
import { UnifiedFinanceHubPage, FinanceHubTab } from './pages/UnifiedFinanceHubPage';
import { BackupPage } from './pages/BackupPage';
import { SettingsPage } from './pages/SettingsPage';
import { CostingWorkspace, CostingTabId } from './costing/CostingWorkspace';
import { CentralRecipeTarget } from './costing/utils/centralRecipeNav';
import { MenuItem as CostMenuItem } from './costing/types';
import { COST_COLLECTIONS } from './costing/services/firebaseSyncService';
import { StorageService } from './costing/services/storageService';
import { resolveCostVariantDisplayNames } from './costing/services/spreadsheetCostHelper';
import {
  UtensilsCrossed,
  Lock,
  Loader2,
  AlertCircle,
} from 'lucide-react';

import { CustomerOrderPage } from './pages/CustomerOrderPage';
import { RiderAppPage } from './pages/RiderAppPage';
import { lazyWithRetry } from './utils/lazyWithRetry';

const OnlineOrdersManagerPage = lazyWithRetry(() =>
  import('./pages/OnlineOrdersManagerPage').then((m) => ({ default: m.OnlineOrdersManagerPage }))
);

const FINANCE_HUB_PAGE_TAB_MAP: Partial<Record<AppPage, FinanceHubTab>> = {
  finance_hub: 'overview',
  dashboard: 'overview',
  cost_executive_dashboard: 'overview',
  reports: 'pnl',
  cost_pnl: 'pnl',
  cost_sales_entry: 'sales',
  finance: 'expenses',
  cost_expenses: 'expenses',
  cost_labor: 'labor',
  cost_overhead_breakeven: 'breakeven',
};

const OwnerPublicMenuAutoSync: React.FC<{ user: User; settings: SettingsDoc }> = ({
  user,
  settings,
}) => {
  const [categories, setCategories] = useState<CategoryDoc[]>([]);
  const [dishes, setDishes] = useState<DishDoc[]>([]);
  const [optionGroups, setOptionGroups] = useState<OptionGroupDoc[]>([]);
  const [costMenus, setCostMenus] = useState<CostMenuItem[]>(() => StorageService.getMenus());
  const [readyFlags, setReadyFlags] = useState({ cats: false, dishes: false, opts: false });

  const lastPublishedSigRef = useRef<string>('');
  const syncedImagesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubCats = subscribeCollection<CategoryDoc>(
      'categories',
      (data) => {
        setCategories([...data].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
        setReadyFlags((prev) => (prev.cats ? prev : { ...prev, cats: true }));
      },
      (err) => console.warn('AutoSync categories warning:', err)
    );
    const unsubDishes = subscribeCollection<DishDoc>(
      'dishes',
      (data) => {
        setDishes([...data].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
        setReadyFlags((prev) => (prev.dishes ? prev : { ...prev, dishes: true }));
      },
      (err) => console.warn('AutoSync dishes warning:', err)
    );
    const unsubOpts = subscribeCollection<OptionGroupDoc>(
      'optionGroups',
      (data) => {
        setOptionGroups([...data].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
        setReadyFlags((prev) => (prev.opts ? prev : { ...prev, opts: true }));
      },
      (err) => console.warn('AutoSync optionGroups warning:', err)
    );
    const unsubCostMenus = subscribeCollection<CostMenuItem>(
      COST_COLLECTIONS.MENUS,
      (cloudMenus) => {
        if (cloudMenus.length > 0) {
          setCostMenus([...cloudMenus].sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99)));
        }
      },
      (err) => console.warn('AutoSync costMenus warning:', err)
    );

    return () => {
      unsubCats();
      unsubDishes();
      unsubOpts();
      unsubCostMenus();
    };
  }, [user.uid]);

  useEffect(() => {
    if (!readyFlags.cats || !readyFlags.dishes || !readyFlags.opts) return;

    const signature = JSON.stringify({
      storeId: user.uid,
      shopName: settings.shopName,
      shopAddress: settings.shopAddress || '',
      shopPhone: settings.shopPhone || '',
      qrImageId: settings.qrImageId || '',
      logoImageId: settings.logoImageId || '',
      onlineOrderingEnabled: settings.onlineOrderingEnabled !== false,
      onlineDeliveryFee: settings.onlineDeliveryFee ?? 0,
      onlinePickupEnabled: settings.onlinePickupEnabled !== false,
      onlineDeliveryEnabled: settings.onlineDeliveryEnabled !== false,
      onlineEstimatedPrepMinutes: settings.onlineEstimatedPrepMinutes ?? 20,
      onlinePublishDefaultIndex: settings.onlinePublishDefaultIndex !== false,
      pricesIncludeVat: Boolean(settings.pricesIncludeVat),
      vatPercent: settings.vatPercent ?? 7,
      categories: categories.map((c) => [c.id, c.name, c.nameTh || '', c.order ?? 0]),
      dishes: dishes.map((d) => [
        d.id,
        d.name,
        d.nameTh || '',
        d.categoryId,
        d.imageId || '',
        d.description || '',
        d.descriptionTh || '',
        d.order ?? 0,
        d.optionGroupIds || [],
        (d.variants || []).map((v) => {
          const resolved = resolveCostVariantDisplayNames(d, v, costMenus);
          return [v.id, resolved.name, resolved.nameTh || v.nameTh || '', v.price];
        }),
      ]),
      optionGroups: optionGroups.map((g) => [
        g.id,
        g.name,
        g.nameTh || '',
        g.minSelect,
        g.maxSelect,
        g.order ?? 0,
        (g.choices || []).map((ch) => [
          ch.id,
          ch.name,
          ch.nameTh || '',
          ch.price,
          Boolean(ch.hasQuantity),
          ch.quantity ?? 1,
        ]),
      ]),
    });

    if (signature === lastPublishedSigRef.current) return;

    const timer = setTimeout(async () => {
      try {
        await publishMenuToPublicStore({
          storeId: user.uid,
          settings,
          categories,
          dishes,
          optionGroups,
          costMenus,
          skipImageIds: syncedImagesRef.current,
        });
        lastPublishedSigRef.current = signature;
      } catch (err) {
        console.warn('AutoSync public storefront menu warning:', err);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [user.uid, settings, categories, dishes, optionGroups, costMenus, readyFlags]);

  return null;
};

export default function App() {
  const [appMode] = useState(() =>
    typeof window !== 'undefined'
      ? resolveAppMode(window.location.search, window.location.pathname, window.location.hash)
      : 'owner'
  );
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(appMode === 'owner');
  const { lang, toggleLang: handleToggleLanguage, t } = useLanguage();

  const [settings, setSettings] = useState<SettingsDoc | null>(null);
  const [currentPage, setCurrentPage] = useState<AppPage>('pos');
  const [activeShift, setActiveShift] = useState<ShiftDoc | null>(null);
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [pendingEditDish, setPendingEditDish] = useState<{
    dishId: string;
    categoryId?: string | null;
    nonce: number;
  } | null>(null);
  const [centralRecipeTarget, setCentralRecipeTarget] = useState<CentralRecipeTarget | null>(null);
  const [navResetNonce, setNavResetNonce] = useState<number>(0);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  // Global Owner Real-Time Online Orders + Persistent Floating Alert State
  const [onlineOrders, setOnlineOrders] = useState<OnlineOrderDoc[]>([]);
  const [onlineSoundEnabled, setOnlineSoundEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kinpos_online_sound_enabled') !== 'false';
    } catch {
      return true;
    }
  });
  const [acceptingOnlineOrderId, setAcceptingOnlineOrderId] = useState<string | null>(null);
  const [floatingAlertError, setFloatingAlertError] = useState<string | null>(null);
  const [cancelledOrderAlerts, setCancelledOrderAlerts] = useState<OnlineOrderDoc[]>([]);
  const [autoPrintOnlineOrder, setAutoPrintOnlineOrder] = useState<OnlineOrderDoc | null>(null);
  const onlineSoundEnabledRef = useRef(onlineSoundEnabled);
  onlineSoundEnabledRef.current = onlineSoundEnabled;
  const initialOnlineOrdersLoadedRef = useRef(false);
  const knownOnlineOrderIdsRef = useRef<Set<string>>(new Set());
  const prevOnlineOrderStatusMapRef = useRef<Map<string, OnlineOrderStatus>>(new Map());

  const handleToggleOnlineSound = () => {
    setOnlineSoundEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('kinpos_online_sound_enabled', String(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  useEffect(() => {
    const handleQuota = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuota);
  }, []);

  // Subscribe to Auth state changes for Owner mode ONLY
  useEffect(() => {
    if (appMode !== 'owner') {
      setAuthLoading(false);
      return;
    }

    let isMounted = true;
    let unsubSettings: (() => void) | null = null;
    let unsubShifts: (() => void) | null = null;
    let unsubOnlineOrders: (() => void) | null = null;
    let unsubGlossaryCloud: (() => void) | null = null;
    let unsubGlossaryLocal: (() => void) | null = null;
    let glossarySaveTimer: ReturnType<typeof setTimeout> | null = null;
    let isApplyingCloudGlossary = false;
    let hasMergedInitialCloudGlossary = false;

    const cleanupDataSubs = () => {
      if (glossarySaveTimer) {
        clearTimeout(glossarySaveTimer);
        glossarySaveTimer = null;
      }
      if (unsubGlossaryLocal) {
        unsubGlossaryLocal();
        unsubGlossaryLocal = null;
      }
      if (unsubGlossaryCloud) {
        unsubGlossaryCloud();
        unsubGlossaryCloud = null;
      }
      if (unsubSettings) {
        unsubSettings();
        unsubSettings = null;
      }
      if (unsubShifts) {
        unsubShifts();
        unsubShifts = null;
      }
      if (unsubOnlineOrders) {
        unsubOnlineOrders();
        unsubOnlineOrders = null;
      }
      initialOnlineOrdersLoadedRef.current = false;
      knownOnlineOrderIdsRef.current.clear();
      prevOnlineOrderStatusMapRef.current.clear();
      hasMergedInitialCloudGlossary = false;
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

      // Guard: Anonymous sessions created on Customer/Rider tabs must NOT bypass Owner Google Sign-In
      const ownerUser = currentUser && !currentUser.isAnonymous ? currentUser : null;
      setUser(ownerUser);

      if (ownerUser) {
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
                  shopName: "Tony's Kit Restaurant",
                  shopAddress: 'Bangkok, Thailand',
                  shopPhone: '02-123-4567',
                  taxId: '0105558000000',
                  receiptHeader: "Welcome to Tony's Kit",
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

        unsubOnlineOrders = subscribeOwnerOnlineOrders(
          ownerUser.uid,
          (list) => {
            if (!isMounted) return;
            if (!initialOnlineOrdersLoadedRef.current) {
              initialOnlineOrdersLoadedRef.current = true;
              list.forEach((o) => {
                knownOnlineOrderIdsRef.current.add(o.id);
                prevOnlineOrderStatusMapRef.current.set(o.id, o.status);
              });
            } else {
              let hasNewPending = false;
              const newlyCancelled: OnlineOrderDoc[] = [];
              for (const o of list) {
                if (!knownOnlineOrderIdsRef.current.has(o.id)) {
                  knownOnlineOrderIdsRef.current.add(o.id);
                  if (o.status === 'pending') hasNewPending = true;
                }
                const prevStatus = prevOnlineOrderStatusMapRef.current.get(o.id);
                if (
                  o.status === 'cancelled' &&
                  prevStatus !== 'cancelled' &&
                  o.cancelReason !== 'ร้านค้ายกเลิกออเดอร์'
                ) {
                  newlyCancelled.push(o);
                }
                prevOnlineOrderStatusMapRef.current.set(o.id, o.status);
              }
              if ((hasNewPending || newlyCancelled.length > 0) && onlineSoundEnabledRef.current) {
                playIncomingOrderChime();
              }
              if (newlyCancelled.length > 0) {
                setCancelledOrderAlerts((prev) => {
                  const existingIds = new Set(prev.map((p) => p.id));
                  const added = newlyCancelled.filter((n) => !existingIds.has(n.id));
                  return added.length > 0 ? [...added, ...prev] : prev;
                });
              }
            }
            setOnlineOrders(list);
          },
          (err) => {
            console.warn('Error subscribing owner onlineOrders:', err);
          }
        );

        unsubGlossaryLocal = subscribeShopTranslationGlossary((nextEntries) => {
          if (!isMounted || isApplyingCloudGlossary) return;
          if (glossarySaveTimer) clearTimeout(glossarySaveTimer);
          glossarySaveTimer = setTimeout(() => {
            saveTranslationGlossaryToCloud(nextEntries).catch((err) => {
              console.warn('Failed to sync shop glossary to cloud:', err);
            });
          }, 500);
        });

        unsubGlossaryCloud = subscribeTranslationGlossary(
          (cloudEntries) => {
            if (!isMounted) return;
            isApplyingCloudGlossary = true;
            try {
              const localBefore = getShopTranslationGlossary();
              if (!hasMergedInitialCloudGlossary) {
                hasMergedInitialCloudGlossary = true;
                if (cloudEntries === null) {
                  if (Object.keys(localBefore).length > 0) {
                    saveTranslationGlossaryToCloud(localBefore).catch((err) => {
                      console.warn('Initial shop glossary push warning:', err);
                    });
                  }
                } else {
                  const merged = mergeShopTranslationGlossary(cloudEntries, {
                    replace: false,
                    notify: false,
                  });
                  const cloudJson = JSON.stringify(cloudEntries);
                  const mergedJson = JSON.stringify(merged);
                  if (mergedJson !== cloudJson && Object.keys(merged).length > 0) {
                    saveTranslationGlossaryToCloud(merged).catch((err) => {
                      console.warn('Merged shop glossary push warning:', err);
                    });
                  }
                }
              } else if (cloudEntries !== null) {
                mergeShopTranslationGlossary(cloudEntries, {
                  replace: true,
                  notify: false,
                });
              }
            } finally {
              isApplyingCloudGlossary = false;
            }
          },
          (err) => {
            console.warn('Error subscribing translation glossary:', err);
          }
        );
      } else {
        setSettings(null);
        setActiveShift(null);
        setOnlineOrders([]);
        setCancelledOrderAlerts([]);
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
  }, [appMode]);

  const onlineOrderNumberingMap = useMemo(
    () => buildOnlineOrderNumberingMap(onlineOrders),
    [onlineOrders]
  );
  const pendingOnlineOrders = useMemo(
    () => getPendingOnlineOrders(onlineOrders),
    [onlineOrders]
  );

  const handleAcceptPendingOnlineOrder = async (order: OnlineOrderDoc) => {
    setAcceptingOnlineOrderId(order.id);
    setFloatingAlertError(null);
    try {
      await updateOnlineOrderByOwner(order.id, 'accepted');
      setAutoPrintOnlineOrder({ ...order, status: 'accepted' });
    } catch (err) {
      setFloatingAlertError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcceptingOnlineOrderId(null);
    }
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

  // 0. Role-Based Public Storefront & Rider Entry (No Google Sign-In, No POS Navigation)
  if (appMode === 'customer') {
    return <CustomerOrderPage lang={lang} onToggleLang={handleToggleLanguage} />;
  }

  if (appMode === 'rider') {
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
        <RiderAppPage lang={lang} />
      </>
    );
  }

  // 1. Initial Loading Screen
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#ffffff_0%,_#eef2f7_65%,_#e2e8f0_100%)] flex flex-col items-center justify-center p-4 text-slate-900 select-none relative">
        <div className="absolute top-4 right-4">
          <LanguageToggle lang={lang} onToggleLang={handleToggleLanguage} />
        </div>
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_5px_0_#c2410c,0_16px_30px_rgba(234,88,12,0.28)] border border-orange-300/60 mb-4">
          <UtensilsCrossed className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Tony&apos;s Kit</h1>
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
          <LanguageToggle lang={lang} onToggleLang={handleToggleLanguage} />
        </div>

        {/* Center Clean 3D Login Card */}
        <div className="max-w-md w-full mx-auto my-auto bg-white p-7 sm:p-8 rounded-3xl border border-slate-200 shadow-[inset_0_1px_0_#ffffff,0_6px_0_0_#dce3ee,0_24px_50px_-12px_rgba(15,23,42,0.16)] space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_5px_0_#c2410c,0_14px_26px_rgba(234,88,12,0.28)] border border-orange-300/60">
              <UtensilsCrossed className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900 pt-2">
              Tony&apos;s Kit
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
                <span>{lang === 'th' ? 'ข้อผิดพลาดการเชื่อมต่อ Firebase' : 'Firebase Initialization Error'}</span>
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
          {lang === 'th'
            ? "Tony's Kit • ระบบซิงค์ข้อมูลออฟไลน์และเรียลไทม์หลายหน้าจอ"
            : "Tony's Kit • Multi-Tab Offline & Real-Time Sync Engine"}
        </div>
        <OfflineIndicator lang={lang} />
      </div>
    );
  }

  // 3. Authenticated App Layout
  if (!settings) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-transparent text-slate-600 text-xs relative">
        <div className="absolute top-4 right-4">
          <LanguageToggle lang={lang} onToggleLang={handleToggleLanguage} />
        </div>
        <Loader2 className="w-5 h-5 animate-spin text-orange-600 mr-2" />
        <span>
          {lang === 'th' ? 'กำลังโหลดการตั้งค่าร้านค้า...' : 'Initializing store configuration...'}
        </span>
      </div>
    );
  }

  const isFullViewportPage =
    currentPage === 'pos' || currentPage === 'floor_plan' || currentPage === 'menu_cost';
  const financeHubTab = FINANCE_HUB_PAGE_TAB_MAP[currentPage];

  return (
    <div
      className={`${
        isFullViewportPage ? 'h-[100dvh] overflow-hidden' : 'min-h-[100dvh]'
      } flex flex-col font-sans`}
    >
      {/* Universal Top Navigation & Hamburger Menu */}
      <Navigation
        currentPage={currentPage}
        onSelectPage={(p) => {
          setCentralRecipeTarget(null);
          setNavResetNonce((n) => n + 1);
          setCurrentPage(p);
        }}
        lang={lang}
        onToggleLang={handleToggleLanguage}
        userEmail={user.email}
        activeShift={activeShift}
        onOpenShiftModal={() => setIsShiftModalOpen(true)}
      />

      {/* Main Active Page Content */}
      <main
        className={
          isFullViewportPage
            ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
            : 'flex-1 min-w-0 overflow-x-hidden'
        }
      >
        {currentPage === 'pos' && (
          <TablesPosPage
            settings={settings}
            lang={lang}
            onlineOrders={onlineOrders}
            onOpenOnlineOrdersPage={() => setCurrentPage('online_orders')}
            onOpenFloorPlan={() => setCurrentPage('floor_plan')}
            onEditDish={(dish, categoryId) => {
              setPendingEditDish({
                dishId: dish.id,
                categoryId: categoryId ?? dish.categoryId,
                nonce: Date.now(),
              });
              setCurrentPage('menu_cost');
            }}
            onOpenCentralRecipe={(target) => {
              setCentralRecipeTarget({
                variantId: target.variantId,
                menuId: target.menuId,
                origin: 'pos',
                nonce: Date.now(),
              });
              setCurrentPage('cost_recipes');
            }}
          />
        )}
        {currentPage === 'floor_plan' && (
          <FloorPlanPage
            lang={lang}
            onNavigateToPos={() => setCurrentPage('pos')}
          />
        )}
        {currentPage === 'menu_cost' && (
          <MenuFoodCostPage
            settings={settings}
            lang={lang}
            initialEditDishRequest={pendingEditDish}
            onClearEditDishRequest={() => setPendingEditDish(null)}
            onOpenCentralRecipe={(target) => {
              setCentralRecipeTarget({
                variantId: target.variantId,
                menuId: target.menuId,
                origin: 'menu_cost',
                nonce: Date.now(),
              });
              setCurrentPage('cost_recipes');
            }}
          />
        )}
        {currentPage === 'option_groups' && (
          <OptionGroupsPage settings={settings} lang={lang} />
        )}
        {currentPage === 'bills' && (
          <BillsHistoryPage
            settings={settings}
            lang={lang}
            onBack={() => setCurrentPage('pos')}
          />
        )}
        {currentPage === 'online_orders' && (
          <Suspense
            fallback={
              <div className="p-8 flex items-center justify-center text-slate-600 text-xs font-bold">
                <Loader2 className="w-5 h-5 animate-spin text-emerald-600 mr-2" />
                <span>{lang === 'th' ? 'กำลังโหลดระบบออเดอร์ออนไลน์...' : 'Loading Online Orders...'}</span>
              </div>
            }
          >
            <OnlineOrdersManagerPage
              user={user}
              settings={settings}
              lang={lang}
              externalOrders={onlineOrders}
              soundEnabled={onlineSoundEnabled}
              onToggleSound={handleToggleOnlineSound}
              onSettingsUpdated={(newSet) => setSettings(newSet)}
            />
          </Suspense>
        )}
        {financeHubTab !== undefined && (
          <UnifiedFinanceHubPage
            user={user}
            settings={settings}
            lang={lang}
            initialTab={financeHubTab}
            onNavigatePage={(p) => setCurrentPage(p)}
          />
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
        {currentPage.startsWith('cost_') && financeHubTab === undefined && (
          <CostingWorkspace
            activeTab={currentPage.replace(/^cost_/, '') as CostingTabId}
            onSelectCostTab={(tab) => setCurrentPage(`cost_${tab}` as AppPage)}
            onNavigateToPos={() => setCurrentPage('pos')}
            user={user}
            lang={lang}
            externalRecipeTarget={centralRecipeTarget}
            onClearExternalRecipeTarget={() => setCentralRecipeTarget(null)}
            onReturnFromRecipe={(originPage) => {
              setCentralRecipeTarget(null);
              setCurrentPage(originPage);
            }}
            navResetNonce={navResetNonce}
          />
        )}
      </main>

      {/* Auto-sync POS Categories, Dishes & Sort Order to Customer Online Storefront */}
      <OwnerPublicMenuAutoSync user={user} settings={settings} />

      {/* Persistent Floating Incoming Online Order Alert across POS and all other Owner pages */}
      <OnlineOrderFloatingAlert
        pendingOrders={pendingOnlineOrders}
        orderNumberingMap={onlineOrderNumberingMap}
        lang={lang}
        isOnOnlineOrdersPage={currentPage === 'online_orders'}
        acceptingOrderId={acceptingOnlineOrderId}
        errorMsg={floatingAlertError}
        onAcceptOrder={handleAcceptPendingOnlineOrder}
        onOpenOnlineOrdersPage={() => setCurrentPage('online_orders')}
      />

      {/* Immediate Floating Customer Cancellation Alert across POS and all Owner pages */}
      <OnlineOrderCancelledAlert
        cancelledOrders={cancelledOrderAlerts}
        orderNumberingMap={onlineOrderNumberingMap}
        lang={lang}
        onDismissOne={(orderId) =>
          setCancelledOrderAlerts((prev) => prev.filter((o) => o.id !== orderId))
        }
        onDismissAll={() => setCancelledOrderAlerts([])}
      />

      {/* Immediate Silent Thermal Receipt Print upon Accepting Online Order */}
      {autoPrintOnlineOrder && settings && (
        <OnlineOrderReceiptModal
          order={autoPrintOnlineOrder}
          displayIds={onlineOrderNumberingMap.get(autoPrintOnlineOrder.id)}
          settings={settings}
          lang={lang}
          autoPrint={true}
          silentAutoPrint={true}
          onClose={() => setAutoPrintOnlineOrder(null)}
        />
      )}

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

      <OfflineIndicator lang={lang} />
    </div>
  );
}
