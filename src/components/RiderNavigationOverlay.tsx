import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Navigation,
  Phone,
  MapPin,
  LocateFixed,
  RefreshCw,
  ExternalLink,
  PackageCheck,
  AlertCircle,
  Loader2,
  Banknote,
  QrCode,
  X,
} from 'lucide-react';
import { Language, OnlineOrderDoc, PublicStoreDoc } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { formatMoney } from '../engine/calculations';
import {
  LatLngLiteralSimple,
  buildGoogleMapsDirectionsLink,
  buildGoogleMapsNoKeyEmbedUrl,
  getCurrentPositionWithIosFallback,
  resolveOrderDestinationParam,
  resolveRiderOriginParam,
} from '../engine/onlineOrdering';

interface Props {
  order: OnlineOrderDoc;
  store?: PublicStoreDoc | null;
  lang?: Language;
  busy: boolean;
  onBack: () => void;
  onCompleteDelivery: (order: OnlineOrderDoc) => Promise<boolean | void>;
}

export const RiderNavigationOverlay: React.FC<Props> = ({
  order,
  store,
  lang: propLang,
  busy,
  onBack,
  onCompleteDelivery,
}) => {
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;

  const [riderPosition, setRiderPosition] = useState<LatLngLiteralSimple | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'locating' | 'active' | 'denied' | 'unavailable'>(
    typeof navigator !== 'undefined' && 'geolocation' in navigator ? 'locating' : 'unavailable'
  );
  const [gpsWaitElapsed, setGpsWaitElapsed] = useState(false);

  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeFailed, setIframeFailed] = useState(false);
  const [iframeTimedOut, setIframeTimedOut] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);

  const isSubmitting = busy || isCompleting;

  const destinationParam = useMemo(() => resolveOrderDestinationParam(order), [order]);
  const externalDirectionsUrl = useMemo(() => buildGoogleMapsDirectionsLink(order), [order]);

  const originInfo = useMemo(
    () =>
      resolveRiderOriginParam({
        riderPosition,
        storeAddress: store?.shopAddress,
        fallbackDestination: destinationParam,
      }),
    [riderPosition, store?.shopAddress, destinationParam]
  );

  // Build API-key-free Google Maps directions embed URL once GPS locks or brief initial grace window elapses
  const canBuildEmbed = Boolean(destinationParam) && (gpsStatus === 'active' || gpsWaitElapsed);

  const embedUrl = useMemo(() => {
    if (!canBuildEmbed || !destinationParam) return '';
    return buildGoogleMapsNoKeyEmbedUrl({
      origin: originInfo.value,
      destination: destinationParam,
    });
  }, [canBuildEmbed, originInfo.value, destinationParam]);

  const requestGpsFix = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsStatus('unavailable');
      setGpsWaitElapsed(true);
      return;
    }
    setGpsStatus('locating');
    getCurrentPositionWithIosFallback()
      .then((pos) => {
        setRiderPosition({ lat: pos.lat, lng: pos.lng });
        setGpsStatus('active');
        setGpsWaitElapsed(true);
      })
      .catch((err: { code?: number }) => {
        if (err && err.code === 1) {
          setGpsStatus('denied');
        } else {
          setGpsStatus('unavailable');
        }
        setGpsWaitElapsed(true);
      });
  }, []);

  // Lock body scroll and support Escape key to close without completing delivery
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onBack, isSubmitting]);

  // Brief grace timer (1.2s) so initial GPS fix resolves cleanly before rendering fallback origin
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setGpsWaitElapsed(true);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  // Initial geolocation lock on mount
  useEffect(() => {
    requestGpsFix();
  }, [requestGpsFix]);

  // Reset iframe state when embed URL or manual reload changes
  useEffect(() => {
    if (!embedUrl) return;
    setIframeLoaded(false);
    setIframeFailed(false);
    setIframeTimedOut(false);

    const loadTimer = window.setTimeout(() => {
      setIframeTimedOut(true);
    }, 8000);

    return () => window.clearTimeout(loadTimer);
  }, [embedUrl, reloadNonce]);

  const handleCloseWithoutCompleting = () => {
    if (isSubmitting) return;
    onBack();
  };

  const handleCompleteClick = async () => {
    if (isSubmitting) return;
    setIsCompleting(true);
    try {
      const result = await onCompleteDelivery(order);
      if (result !== false) {
        onBack();
      }
    } finally {
      setIsCompleting(false);
    }
  };

  const showIframeFallbackAlert =
    !destinationParam || iframeFailed || (!iframeLoaded && iframeTimedOut);

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={lang === 'th' ? 'แผนที่นำทางส่งอาหารในแอป' : 'In-App Delivery Route Map'}
    >
      <div className="w-full sm:max-w-2xl h-[92dvh] sm:h-[88dvh] max-h-[100dvh] bg-slate-900 border-t sm:border border-slate-700 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* 1. Compact Header with Order Summary & Close Button */}
        <header className="shrink-0 bg-slate-900 border-b border-slate-800 px-3.5 pt-3 pb-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-400 flex items-center justify-center shrink-0">
                <Navigation className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-black text-sm text-white truncate">
                    {order.orderNumber}
                  </span>
                  <span className="text-xs font-bold text-slate-300 truncate">
                    • {order.customerName}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate">
                  {lang === 'th' ? 'แผนที่นำทางในแอป (Google Maps)' : 'In-App Route Map'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {order.customerPhone && (
                <a
                  href={`tel:${order.customerPhone}`}
                  className="px-2.5 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-bold text-xs inline-flex items-center gap-1"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>{lang === 'th' ? 'โทร' : 'Call'}</span>
                </a>
              )}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleCloseWithoutCompleting}
                aria-label={lang === 'th' ? 'ปิดหน้าต่างแผนที่' : 'Close map'}
                className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center justify-center cursor-pointer disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Destination & Origin Status Strip */}
          <div className="px-2.5 py-1.5 rounded-xl bg-slate-950/75 border border-slate-800 space-y-1 text-[11px]">
            <div className="flex items-start gap-1.5 text-slate-200 min-w-0">
              <MapPin className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />
              <span className="min-w-0 break-words leading-snug">
                {order.deliveryAddress || destinationParam || '-'}
              </span>
            </div>

            {gpsStatus === 'denied' || gpsStatus === 'unavailable' ? (
              <div className="flex items-center justify-between gap-2 pt-0.5 text-amber-300">
                <span className="min-w-0 leading-snug">
                  {gpsStatus === 'denied'
                    ? lang === 'th'
                      ? 'กรุณาเปิดสิทธิ์ตำแหน่ง (GPS) — ใช้ที่อยู่ร้านเป็นต้นทางชั่วคราว'
                      : 'Location permission denied — using store address as origin.'
                    : lang === 'th'
                      ? 'ไม่พบสัญญาณ GPS — ใช้ที่อยู่ร้านเป็นต้นทางชั่วคราว'
                      : 'GPS unavailable — using store address as origin.'}
                </span>
                <button
                  type="button"
                  onClick={requestGpsFix}
                  className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-200 font-bold shrink-0 inline-flex items-center gap-1 cursor-pointer"
                >
                  <LocateFixed className="w-3 h-3" />
                  <span>{lang === 'th' ? 'ลองใหม่' : 'Retry'}</span>
                </button>
              </div>
            ) : gpsStatus === 'active' ? (
              <div className="flex items-center justify-between gap-2 text-emerald-300/90">
                <span className="inline-flex items-center gap-1">
                  <LocateFixed className="w-3 h-3 shrink-0" />
                  {lang === 'th' ? 'ต้นทาง: ตำแหน่ง GPS ปัจจุบันของคุณ' : 'Origin: Your current GPS location'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    requestGpsFix();
                    setReloadNonce((n) => n + 1);
                  }}
                  className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>{lang === 'th' ? 'รีเฟรช' : 'Refresh'}</span>
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {/* 2. Embedded API-Key-Free Google Maps Iframe Area */}
        <div className="flex-1 min-h-0 relative bg-slate-950 flex flex-col">
          {!destinationParam ? (
            <div className="flex-1 flex flex-col items-center justify-center p-5 text-center space-y-2">
              <AlertCircle className="w-9 h-9 text-amber-400" />
              <p className="text-sm font-bold text-white">
                {lang === 'th' ? 'ไม่พบพิกัดหรือที่อยู่ปลายทาง' : 'Missing delivery location'}
              </p>
              <p className="text-xs text-slate-400">
                {lang === 'th'
                  ? 'กรุณาโทรสอบถามลูกค้าหรือใช้ลิงก์เปิดใน Google Maps ด้านล่าง'
                  : 'Call the customer or open Google Maps below.'}
              </p>
            </div>
          ) : !embedUrl ? (
            <div className="flex-1 flex flex-col items-center justify-center p-5 text-center space-y-2">
              <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
              <p className="text-xs font-bold text-slate-300">
                {lang === 'th' ? 'กำลังดึงตำแหน่งปัจจุบันของไรเดอร์...' : 'Getting your current GPS location...'}
              </p>
            </div>
          ) : (
            <>
              <iframe
                key={`${embedUrl}_${reloadNonce}`}
                src={embedUrl}
                title={
                  lang === 'th'
                    ? `เส้นทางส่งอาหาร ${order.orderNumber}`
                    : `Delivery Route ${order.orderNumber}`
                }
                className="w-full flex-1 min-h-[180px] border-0 bg-slate-900"
                loading="eager"
                referrerPolicy="no-referrer-when-downgrade"
                allow="geolocation"
                onLoad={() => {
                  setIframeLoaded(true);
                  setIframeTimedOut(false);
                }}
                onError={() => {
                  setIframeFailed(true);
                }}
              />

              {!iframeLoaded && !iframeFailed && !iframeTimedOut && (
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center bg-slate-950/60 backdrop-blur-[1px] gap-2">
                  <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
                  <span className="text-xs font-bold text-slate-200">
                    {lang === 'th' ? 'กำลังโหลดแผนที่เส้นทาง...' : 'Loading route map...'}
                  </span>
                </div>
              )}

              {showIframeFallbackAlert && (
                <div className="mx-3 my-2 px-3 py-2.5 rounded-xl bg-amber-950/85 border border-amber-500/60 text-amber-100 text-xs flex items-start gap-2 shrink-0">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-bold">
                      {lang === 'th'
                        ? 'แผนที่ฝังโหลดไม่สำเร็จหรือแสดงหน้าว่าง'
                        : 'Embedded map failed to load or appeared blank'}
                    </p>
                    <p className="text-[11px] text-amber-200/90">
                      {lang === 'th'
                        ? 'กรุณากดปุ่ม "เปิดใน Google Maps" ด้านล่างเพื่อเริ่มนำทางได้ทันที'
                        : 'Tap "Open in Google Maps" below to start navigation immediately.'}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 3. Sticky Bottom Footer: Fallback Link + Close + Delivered */}
        <footer className="shrink-0 bg-slate-900 border-t border-slate-800 px-3.5 pt-2.5 pb-[max(0.85rem,env(safe-area-inset-bottom))] space-y-2">
          {/* Payment & Amount Strip */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-bold text-slate-300 truncate">
              {order.customerNote ? `* ${order.customerNote}` : order.customerName}
            </span>
            {order.paymentMethod === 'cash' ? (
              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-black inline-flex items-center gap-1 shrink-0">
                <Banknote className="w-3.5 h-3.5" />
                {lang === 'th'
                  ? `เก็บเงินสด ฿${formatMoney(order.totalAmount)}`
                  : `Cash ฿${formatMoney(order.totalAmount)}`}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-300 font-black inline-flex items-center gap-1 shrink-0">
                <QrCode className="w-3.5 h-3.5" />
                {lang === 'th' ? 'โอน QR แล้ว' : 'QR Paid'}
              </span>
            )}
          </div>

          {/* Fallback External Google Maps Button directly below embedded map */}
          <a
            href={externalDirectionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`w-full min-h-[42px] px-3 py-2 rounded-xl font-extrabold text-xs flex items-center justify-center gap-2 transition-colors ${
              showIframeFallbackAlert
                ? 'bg-orange-500 hover:bg-orange-400 text-slate-950 ring-2 ring-orange-300 shadow-lg shadow-orange-500/25'
                : 'bg-slate-800 hover:bg-slate-700 border border-slate-600 text-orange-300'
            }`}
          >
            <ExternalLink className="w-4 h-4 shrink-0" />
            <span>{lang === 'th' ? 'เปิดใน Google Maps' : 'Open in Google Maps'}</span>
          </a>

          {/* Close Without Completing + Primary Complete Delivery Button */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleCloseWithoutCompleting}
              className="col-span-1 min-h-[48px] px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <X className="w-4 h-4 shrink-0" />
              <span>{lang === 'th' ? 'ปิด' : 'Close'}</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleCompleteClick}
              className="col-span-2 min-h-[48px] px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed text-slate-950 font-black text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-500/25"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>{lang === 'th' ? 'กำลังบันทึก...' : 'Saving...'}</span>
                </>
              ) : (
                <>
                  <PackageCheck className="w-5 h-5 shrink-0" />
                  <span>{lang === 'th' ? 'ส่งอาหารสำเร็จ' : 'Delivered'}</span>
                </>
              )}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
