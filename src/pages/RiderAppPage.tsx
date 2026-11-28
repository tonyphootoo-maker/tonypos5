import React, { useEffect, useMemo, useState } from 'react';
import {
  Bike,
  MapPin,
  Navigation as NavigationIcon,
  Phone,
  CheckCircle2,
  Clock,
  Banknote,
  QrCode,
  AlertCircle,
  Loader2,
  UserCheck,
  PackageCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Language, OnlineOrderDoc, PublicStoreDoc } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import {
  fetchPublicStoreOnce,
  loadSavedRiderName,
  resolveCustomerOrRiderSession,
  resolvePublicStoreId,
  saveRiderName,
  subscribePublicStore,
  subscribeRiderDeliveryOrders,
  updateOnlineOrderByRider,
} from '../data/onlineDb';
import { formatMoney } from '../engine/calculations';
import {
  buildExternalGoogleMapsUrl,
  buildOnlineOrderNumberingMap,
  launchExternalGoogleMapsNavigation,
  toDateSafe,
} from '../engine/onlineOrdering';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { OfflineIndicator } from '../components/OfflineIndicator';
import { RiderNavigationOverlay } from '../components/RiderNavigationOverlay';
import { LanguageToggle } from '../components/LanguageToggle';

interface Props {
  lang?: Language;
}

const RIDER_STATUS_LABELS: Record<string, { th: string; en: string; cls: string }> = {
  pending: { th: 'รอร้านยืนยัน', en: 'Pending', cls: 'bg-slate-700 text-slate-200' },
  accepted: { th: 'ร้านรับออเดอร์แล้ว', en: 'Accepted', cls: 'bg-sky-500/20 text-sky-300' },
  preparing: { th: 'กำลังเตรียมอาหาร', en: 'Preparing', cls: 'bg-amber-500/20 text-amber-300' },
  ready_for_pickup: { th: 'พร้อมรับที่ร้าน', en: 'Ready for Pickup', cls: 'bg-orange-500/25 text-orange-300' },
  out_for_delivery: { th: 'กำลังนำไปส่ง', en: 'Out for Delivery', cls: 'bg-emerald-500/25 text-emerald-300' },
  completed: { th: 'จัดส่งสำเร็จ', en: 'Delivered', cls: 'bg-emerald-600/30 text-emerald-200' },
  cancelled: { th: 'ยกเลิกแล้ว', en: 'Cancelled', cls: 'bg-rose-500/20 text-rose-300' },
};

export const RiderAppPage: React.FC<Props> = ({ lang: propLang }) => {
  const { lang: ctxLang, toggleLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const [storeId, setStoreId] = useState<string | null>(null);
  const [store, setStore] = useState<PublicStoreDoc | null>(null);
  const [riderUid, setRiderUid] = useState<string | null>(null);
  const [riderName, setRiderName] = useState<string>(() => loadSavedRiderName() || 'Rider 1');
  const [orders, setOrders] = useState<OnlineOrderDoc[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [confirmDeliverId, setConfirmDeliverId] = useState<string | null>(null);
  const [activeNavOrderId, setActiveNavOrderId] = useState<string | null>(null);
  const [expandedJobIds, setExpandedJobIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    saveRiderName(riderName);
  }, [riderName]);

  // Keep dedicated Rider PWA manifest & iOS touch icon synchronized in document head
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = lang === 'th' ? "Tony's Kit Rider - งานจัดส่ง" : "Tony's Kit Rider - Delivery Dispatch";

    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) appleTitle.setAttribute('content', 'TK Rider');

    const appleStatus = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (appleStatus) {
      appleStatus.setAttribute('content', 'black-translucent');
    } else {
      const asMeta = document.createElement('meta');
      asMeta.name = 'apple-mobile-web-app-status-bar-style';
      asMeta.content = 'black-translucent';
      document.head.appendChild(asMeta);
    }

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', '#0f172a');

    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleIcon && appleIcon.getAttribute('href') !== './rider-apple-touch-icon.png') {
      appleIcon.setAttribute('href', './rider-apple-touch-icon.png');
    }

    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) {
      if (manifestLink.getAttribute('href') !== './manifest-rider.webmanifest') {
        manifestLink.setAttribute('href', './manifest-rider.webmanifest');
      }
    } else {
      const ml = document.createElement('link');
      ml.rel = 'manifest';
      ml.href = './manifest-rider.webmanifest';
      document.head.appendChild(ml);
    }

    const rootStyle = document.documentElement.style;
    rootStyle.width = '100%';
    rootStyle.maxWidth = '100%';
    rootStyle.overflowX = 'hidden';
    rootStyle.backgroundColor = '#020617';
    rootStyle.setProperty('-webkit-text-size-adjust', '100%');
    rootStyle.setProperty('text-size-adjust', '100%');
    document.body.style.width = '100%';
    document.body.style.maxWidth = '100%';
    document.body.style.overflowX = 'hidden';
    document.body.style.background = '#020617';

    const rootContainer = document.getElementById('root');
    if (rootContainer) {
      rootContainer.style.width = '100%';
      rootContainer.style.minHeight = '100dvh';
    }

    if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '')) {
      const vp = document.querySelector('meta[name="viewport"]');
      if (vp) {
        vp.setAttribute(
          'content',
          'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
        );
      }
    }
  }, [lang]);

  useEffect(() => {
    let mounted = true;
    let unsubStore: (() => void) | null = null;
    let unsubOrders: (() => void) | null = null;
    let resolvedInitial = false;

    const bootTimeout = setTimeout(() => {
      if (!mounted || resolvedInitial) return;
      resolvedInitial = true;
      setErrorMsg(
        lang === 'th'
          ? 'การเชื่อมต่อใช้เวลานานเกินไป กรุณาตรวจสอบอินเทอร์เน็ตและรีเฟรชหน้าเว็บ'
          : 'Connection timed out while loading Rider jobs. Please refresh.'
      );
      setLoading(false);
    }, 10000);

    const boot = async () => {
      try {
        const resolvedStoreId = await resolvePublicStoreId(
          window.location.search,
          window.location.hash
        );
        if (!mounted) return;
        setStoreId(resolvedStoreId);

        if (resolvedStoreId) {
          fetchPublicStoreOnce(resolvedStoreId)
            .then((s) => {
              if (mounted && s) setStore(s);
            })
            .catch(() => {});

          unsubStore = subscribePublicStore(resolvedStoreId, (s) => {
            if (mounted) setStore(s);
          });
          unsubOrders = subscribeRiderDeliveryOrders(
            resolvedStoreId,
            (list) => {
              if (!mounted) return;
              resolvedInitial = true;
              clearTimeout(bootTimeout);
              setOrders(list);
              setLoading(false);
            },
            (err) => {
              if (!mounted) return;
              resolvedInitial = true;
              clearTimeout(bootTimeout);
              setErrorMsg(err.message);
              setLoading(false);
            }
          );
        } else {
          resolvedInitial = true;
          clearTimeout(bootTimeout);
          setLoading(false);
        }

        const session = await resolveCustomerOrRiderSession();
        if (!mounted) return;
        setRiderUid(session.uid);
      } catch (err) {
        if (!mounted) return;
        resolvedInitial = true;
        clearTimeout(bootTimeout);
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    };

    boot();
    return () => {
      mounted = false;
      clearTimeout(bootTimeout);
      unsubStore?.();
      unsubOrders?.();
    };
  }, []);

  const orderNumberingMap = useMemo(
    () => buildOnlineOrderNumberingMap(orders),
    [orders]
  );

  const activeJobs = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.status === 'ready_for_pickup' ||
          o.status === 'out_for_delivery'
      ),
    [orders]
  );

  const completedJobs = useMemo(
    () => orders.filter((o) => o.status === 'completed'),
    [orders]
  );

  const visibleJobs = activeTab === 'active' ? activeJobs : completedJobs;
  const activeNavOrder = useMemo(
    () => orders.find((o) => o.id === activeNavOrderId) || null,
    [orders, activeNavOrderId]
  );

  const handleStartDelivery = async (order: OnlineOrderDoc) => {
    setBusyOrderId(order.id);
    setErrorMsg(null);
    try {
      await updateOnlineOrderByRider(
        order.id,
        'out_for_delivery',
        riderName,
        riderUid || undefined
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleCompleteDelivery = async (order: OnlineOrderDoc) => {
    setBusyOrderId(order.id);
    setErrorMsg(null);
    try {
      await updateOnlineOrderByRider(
        order.id,
        'completed',
        riderName,
        riderUid || undefined
      );
      setConfirmDeliverId(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyOrderId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-slate-950 text-white flex flex-col items-center justify-center p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] relative">
        <div className="absolute top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))]">
          <LanguageToggle variant="dark" lang={lang} onToggleLang={toggleLang} />
        </div>
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mb-3" />
        <p className="text-sm font-bold text-slate-300">
          {lang === 'th' ? 'กำลังโหลดงานจัดส่ง Rider...' : 'Loading Rider jobs...'}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-slate-950 text-slate-100 flex flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {/* Rider Header with PWA Install */}
      <header className="sticky top-0 z-30 w-full bg-slate-900/95 backdrop-blur-md border-b border-slate-800 pt-[env(safe-area-inset-top)]">
        <div className="w-full max-w-3xl mx-auto pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:px-4 py-3 space-y-3">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <img
                src="./rider-192x192.png"
                alt="Tony's Kit Rider"
                referrerPolicy="no-referrer"
                className="w-11 h-11 rounded-xl object-cover border border-emerald-400/40 shadow-sm shrink-0 bg-slate-950"
              />
              <div className="min-w-0 flex-1">
                <h1 className="font-extrabold text-base text-white truncate">Tony&apos;s Kit Rider</h1>
                <p className="text-xs text-slate-400 truncate">
                  {store?.shopName || (lang === 'th' ? 'งานจัดส่งอาหาร' : 'Delivery Dispatch')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <PWAInstallButton lang={lang} variant="button" appName="Tony's Kit Rider" theme="emerald" />
              <LanguageToggle variant="dark" lang={lang} onToggleLang={toggleLang} />
            </div>
          </div>

          {/* Rider Profile Bar & Tabs */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 bg-slate-800/90 border border-slate-700 rounded-xl px-3 py-1.5 min-w-0">
              <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs text-slate-400 shrink-0">
                {lang === 'th' ? 'ชื่อไรเดอร์:' : 'Rider:'}
              </span>
              <input
                type="text"
                value={riderName}
                onChange={(e) => setRiderName(e.target.value)}
                className="bg-transparent text-base sm:text-sm font-bold text-white focus:outline-none w-full min-w-0"
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5 bg-slate-800 p-1 rounded-xl border border-slate-700 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('active')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  activeTab === 'active'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {lang === 'th' ? `งานจัดส่ง (${activeJobs.length})` : `Active (${activeJobs.length})`}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('completed')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  activeTab === 'completed'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {lang === 'th' ? `ส่งสำเร็จ (${completedJobs.length})` : `Done (${completedJobs.length})`}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col w-full max-w-3xl mx-auto pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:px-4 py-3.5 sm:py-4 gap-3">

        {errorMsg && (
          <div className="p-3.5 rounded-2xl bg-rose-950/70 border border-rose-700 text-rose-200 text-xs font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="min-w-0 break-words">{errorMsg}</span>
          </div>
        )}

        {!storeId ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 rounded-3xl bg-slate-900 border border-slate-800 text-center space-y-2">
            <AlertCircle className="w-10 h-10 text-amber-400 mx-auto" />
            <p className="text-sm font-bold text-white">
              {lang === 'th' ? 'ยังไม่พบร้านค้าที่ผูกไว้' : 'Store Not Found'}
            </p>
            <p className="text-xs text-slate-400">
              {lang === 'th'
                ? 'เปิดลิงก์ Rider จากหน้า ออเดอร์ออนไลน์ & Rider ของเจ้าของร้าน'
                : 'Open the Rider link generated from the Owner dashboard.'}
            </p>
          </div>
        ) : visibleJobs.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 rounded-3xl bg-slate-900 border border-slate-800 text-center space-y-2">
            <Bike className="w-10 h-10 text-slate-600 mx-auto" />
            <p className="text-sm font-bold text-slate-300">
              {activeTab === 'active'
                ? lang === 'th'
                  ? 'ไม่มีงานจัดส่งค้างอยู่'
                  : 'No active delivery jobs'
                : lang === 'th'
                ? 'ยังไม่มีรายการส่งสำเร็จ'
                : 'No completed deliveries yet'}
            </p>
          </div>
        ) : (
          visibleJobs.map((order) => {
            const st = RIDER_STATUS_LABELS[order.status] || RIDER_STATUS_LABELS.ready_for_pickup;
            const displayIds = orderNumberingMap.get(order.id);
            const created = toDateSafe(order.createdAt);
            const isBusy = busyOrderId === order.id;
            const isExpanded = Boolean(expandedJobIds[order.id]);
            const totalItemCount = (order.items || []).reduce(
              (sum, it) => sum + Math.max(1, Number(it.quantity) || 1),
              0
            );
            const toggleExpanded = () =>
              setExpandedJobIds((prev) => ({ ...prev, [order.id]: !prev[order.id] }));

            return (
              <div
                key={order.id}
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2"
              >
                {/* Compact Header Row */}
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-black text-sm text-white tabular-nums">
                        {displayIds?.displayNumber || order.orderNumber}
                      </span>
                      {displayIds?.referenceNumber && (
                        <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                          {displayIds.referenceNumber}
                        </span>
                      )}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${st.cls}`}>
                        {st[lang]}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>
                        {created
                          ? created.toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-US', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                      <span>• {lang === 'th' ? `${totalItemCount} รายการ` : `${totalItemCount} items`}</span>
                      {order.riderName && isExpanded && <span className="truncate">• {order.riderName}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-black text-emerald-400 tabular-nums">
                        ฿{formatMoney(order.totalAmount)}
                      </div>
                      <div className="text-[10px] font-bold flex items-center justify-end gap-1">
                        {order.paymentMethod === 'cash' ? (
                          <span className="text-amber-300 inline-flex items-center gap-0.5">
                            <Banknote className="w-3 h-3" />
                            {lang === 'th' ? 'เก็บเงินสด' : 'Cash'}
                          </span>
                        ) : (
                          <span className="text-sky-300 inline-flex items-center gap-0.5">
                            <QrCode className="w-3 h-3" />
                            {lang === 'th' ? 'โอน QR' : 'QR'}
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={toggleExpanded}
                      aria-expanded={isExpanded}
                      className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <span>{isExpanded ? (lang === 'th' ? 'ย่อ' : 'Hide') : lang === 'th' ? 'ดู' : 'More'}</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Compact Customer & Address Strip */}
                <div className="px-2.5 py-2 rounded-xl bg-slate-950/75 border border-slate-800/90 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="font-bold text-white min-w-0 truncate">{order.customerName}</span>
                    <a
                      href={`tel:${order.customerPhone}`}
                      className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-bold text-[11px] inline-flex items-center gap-1 shrink-0"
                    >
                      <Phone className="w-3 h-3" />
                      <span>{order.customerPhone}</span>
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={toggleExpanded}
                    className="w-full flex items-start gap-1.5 text-left text-slate-300 text-[11px] leading-snug min-w-0 cursor-pointer"
                  >
                    <MapPin className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />
                    <span className={isExpanded ? 'break-words min-w-0' : 'truncate min-w-0'}>
                      {order.deliveryAddress || '-'}
                    </span>
                  </button>
                  {isExpanded && order.customerNote && (
                    <div className="text-[11px] text-amber-300 break-words pt-0.5">* {order.customerNote}</div>
                  )}
                </div>

                {/* Expandable Order Items Summary */}
                {isExpanded && (
                  <div className="px-2.5 py-2 rounded-xl bg-slate-950/50 border border-slate-800/70 text-xs text-slate-300 space-y-1">
                    {order.items.map((it, idx) => (
                      <div key={idx} className="flex justify-between gap-2 min-w-0">
                        <span className="min-w-0 break-words">
                          {it.quantity}x {it.dishName}
                          {it.variantName && it.variantName !== 'Standard' ? ` (${it.variantName})` : ''}
                        </span>
                        <span className="text-slate-400 tabular-nums shrink-0">
                          ฿{formatMoney(it.unitPrice * it.quantity)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Compact Action Buttons */}
                {order.status !== 'completed' && (
                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    {order.status !== 'out_for_delivery' ? (
                      <a
                        href={buildExternalGoogleMapsUrl(order)}
                        onClick={(e) => {
                          e.preventDefault();
                          if (isBusy) return;
                          setActiveNavOrderId(order.id);
                          void handleStartDelivery(order);
                          launchExternalGoogleMapsNavigation(order);
                        }}
                        aria-disabled={isBusy}
                        className={`min-h-[42px] px-2.5 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 font-extrabold text-[11px] sm:text-xs flex items-center justify-center gap-1.5 text-center cursor-pointer ${
                          isBusy ? 'opacity-60 pointer-events-none' : ''
                        }`}
                      >
                        <NavigationIcon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          {lang === 'th'
                            ? 'รับอาหาร & นำทาง'
                            : 'Start & Navigate'}
                        </span>
                      </a>
                    ) : (
                      <a
                        href={buildExternalGoogleMapsUrl(order)}
                        onClick={(e) => {
                          e.preventDefault();
                          setActiveNavOrderId(order.id);
                          launchExternalGoogleMapsNavigation(order);
                        }}
                        className="min-h-[42px] px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-extrabold text-[11px] sm:text-xs flex items-center justify-center gap-1.5 text-center cursor-pointer"
                      >
                        <NavigationIcon className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                        <span className="truncate">
                          {lang === 'th'
                            ? 'เปิดนำทาง Maps'
                            : 'Navigate Maps'}
                        </span>
                      </a>
                    )}

                    {confirmDeliverId === order.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleCompleteDelivery(order)}
                          className="flex-1 min-h-[42px] px-2 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-[11px] sm:text-xs flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>{lang === 'th' ? 'ยืนยัน' : 'Confirm'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeliverId(null)}
                          className="min-h-[42px] px-2.5 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold text-[11px] cursor-pointer"
                        >
                          {lang === 'th' ? 'ยกเลิก' : 'No'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setConfirmDeliverId(order.id)}
                        className="min-h-[42px] px-2.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-[11px] sm:text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <PackageCheck className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{lang === 'th' ? 'ส่งอาหารสำเร็จ' : 'Delivered'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </main>

      {activeNavOrder && (
        <RiderNavigationOverlay
          order={activeNavOrder}
          store={store}
          lang={lang}
          busy={busyOrderId === activeNavOrder.id}
          onBack={() => setActiveNavOrderId(null)}
          onCompleteDelivery={handleCompleteDelivery}
        />
      )}

      <OfflineIndicator lang={lang} />
    </div>
  );
};
