/// <reference types="google.maps" />
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  APILoadingStatus,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  ArrowUpLeft,
  CornerUpLeft,
  CornerUpRight,
  Navigation,
  Phone,
  MapPin,
  LocateFixed,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  PackageCheck,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Loader2,
  Banknote,
  QrCode,
  Clock,
  Route as RouteIcon,
} from 'lucide-react';
import { Language, OnlineOrderDoc, PublicStoreDoc } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { LanguageToggle } from './LanguageToggle';
import { formatMoney } from '../engine/calculations';
import {
  LatLngLiteralSimple,
  buildExternalGoogleMapsUrl,
  extractLatLngLiteral,
  formatNavDistance,
  formatNavDuration,
  haversineMeters,
  stripHtmlInstructions,
} from '../engine/onlineOrdering';

const MAPS_API_KEY: string =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  (typeof process !== 'undefined' ? process.env.GOOGLE_MAPS_API_KEY || '' : '') ||
  '';

const DEFAULT_THAILAND_CENTER: LatLngLiteralSimple = { lat: 13.7563, lng: 100.5018 };
const RECALCULATE_DISTANCE_THRESHOLD_M = 150;

export interface NavStepItem {
  instruction: string;
  distanceMeters: number;
  maneuver: string;
}

export interface RouteSummaryState {
  distanceMeters: number;
  durationMillis: number;
  steps: NavStepItem[];
  destinationCoords: LatLngLiteralSimple | null;
}

interface Props {
  order: OnlineOrderDoc;
  store?: PublicStoreDoc | null;
  lang?: Language;
  busy: boolean;
  onBack: () => void;
  onCompleteDelivery: (order: OnlineOrderDoc) => Promise<void>;
}

function renderManeuverIcon(maneuver: string) {
  const m = (maneuver || '').toUpperCase();
  if (m.includes('SHARP_LEFT') || m.includes('TURN_LEFT') || m.includes('UTURN_LEFT')) {
    return <CornerUpLeft className="w-6 h-6 shrink-0" />;
  }
  if (m.includes('SHARP_RIGHT') || m.includes('TURN_RIGHT') || m.includes('UTURN_RIGHT')) {
    return <CornerUpRight className="w-6 h-6 shrink-0" />;
  }
  if (m.includes('SLIGHT_LEFT') || m.includes('KEEP_LEFT') || m.includes('RAMP_LEFT')) {
    return <ArrowUpLeft className="w-6 h-6 shrink-0" />;
  }
  if (m.includes('SLIGHT_RIGHT') || m.includes('KEEP_RIGHT') || m.includes('RAMP_RIGHT')) {
    return <ArrowUpRight className="w-6 h-6 shrink-0" />;
  }
  return <ArrowUp className="w-6 h-6 shrink-0" />;
}

interface ActiveRouteControllerProps {
  origin: LatLngLiteralSimple | string | null;
  destination: LatLngLiteralSimple | string;
  riderPosition: LatLngLiteralSimple | null;
  followRider: boolean;
  routeTriggerNonce: number;
  lang: Language;
  onRouteLoading: (loading: boolean) => void;
  onRouteSuccess: (summary: RouteSummaryState) => void;
  onRouteError: (message: string | null) => void;
  onFatalMapError: (message: string) => void;
}

const ActiveRouteController: React.FC<ActiveRouteControllerProps> = ({
  origin,
  destination,
  riderPosition,
  followRider,
  routeTriggerNonce,
  lang,
  onRouteLoading,
  onRouteSuccess,
  onRouteError,
  onFatalMapError,
}) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const apiStatus = useApiLoadingStatus();
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const hasFitInitialBoundsRef = useRef(false);

  // Monitor SDK load/auth status
  useEffect(() => {
    if (apiStatus === APILoadingStatus.AUTH_FAILURE) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      onFatalMapError(
        lang === 'th'
          ? 'ไม่สามารถยืนยันสิทธิ์แผนที่ Google Maps ได้ กรุณาเปิดแอป Google Maps ภายนอกชั่วคราว'
          : 'Google Maps authorization failed. Use external Google Maps fallback below.'
      );
    } else if (apiStatus === APILoadingStatus.FAILED) {
      onFatalMapError(
        lang === 'th'
          ? 'โหลด Google Maps SDK ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตหรือเปิดแอป Google Maps ภายนอก'
          : 'Failed to load Google Maps SDK. Check connection or open external Google Maps.'
      );
    }
  }, [apiStatus, lang, onFatalMapError]);

  // Smoothly pan camera when following live Rider GPS at turn-by-turn street zoom
  useEffect(() => {
    if (!map || !followRider || !riderPosition) return;
    map.panTo(riderPosition);
    const currentZoom = map.getZoom() ?? 15;
    if (currentZoom < 17) {
      map.setZoom(17);
    }
  }, [map, followRider, riderPosition]);

  // Compute route and render polyline using official Maps JS Routes API
  useEffect(() => {
    if (!routesLib || !map || !origin || !destination) return;

    let isCancelled = false;

    const clearPolylines = () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };

    clearPolylines();
    onRouteError(null);
    onRouteLoading(true);

    const request = {
      origin,
      destination,
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs'],
      internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
    };

    // Cast Route constructor/static call safely for @types/google.maps compatibility
    const RouteClass = routesLib.Route as unknown as {
      computeRoutes: (req: Record<string, unknown>) => Promise<{ routes?: unknown[] }>;
    };

    RouteClass.computeRoutes(request)
      .then((response) => {
        if (isCancelled) return;
        onRouteLoading(false);

        const routes = response?.routes;
        if (!routes || routes.length === 0) {
          onRouteError(
            lang === 'th'
              ? 'ไม่พบเส้นทางรถยนต์อัตโนมัติบนแผนที่ คุณสามารถกดเปิดในแอป Google Maps ด้านล่างได้'
              : 'No driving route found for this address. You can launch external Google Maps below.'
          );
          return;
        }

        const primaryRoute = routes[0] as {
          distanceMeters?: number;
          durationMillis?: number;
          viewport?: google.maps.LatLngBounds | google.maps.LatLngBoundsLiteral;
          legs?: Array<{
            endLocation?: unknown;
            steps?: Array<{
              instructions?: string;
              distanceMeters?: number;
              navigationInstruction?: { maneuver?: string };
            }>;
          }>;
          createPolylines?: () => google.maps.Polyline[];
        };

        if (typeof primaryRoute.createPolylines === 'function') {
          const newPolylines = primaryRoute.createPolylines();
          newPolylines.forEach((polyline) => {
            polyline.setOptions({
              strokeColor: '#0ea5e9',
              strokeOpacity: 0.95,
              strokeWeight: 7,
            });
            polyline.setMap(map);
          });
          polylinesRef.current = newPolylines;
        }

        if (primaryRoute.viewport && !hasFitInitialBoundsRef.current && !riderPosition) {
          map.fitBounds(primaryRoute.viewport, { top: 130, right: 24, bottom: 90, left: 24 });
          hasFitInitialBoundsRef.current = true;
        } else if (followRider && riderPosition && !hasFitInitialBoundsRef.current) {
          map.panTo(riderPosition);
          if ((map.getZoom() ?? 15) < 17) {
            map.setZoom(17);
          }
          hasFitInitialBoundsRef.current = true;
        }

        const firstLeg = primaryRoute.legs?.[0];
        const steps: NavStepItem[] = (firstLeg?.steps || [])
          .map((s) => ({
            instruction: stripHtmlInstructions(s.instructions || ''),
            distanceMeters: Number(s.distanceMeters) || 0,
            maneuver: s.navigationInstruction?.maneuver || '',
          }))
          .filter((s) => s.instruction.length > 0);

        const resolvedEnd = extractLatLngLiteral(firstLeg?.endLocation);

        onRouteSuccess({
          distanceMeters: Number(primaryRoute.distanceMeters) || 0,
          durationMillis: Number(primaryRoute.durationMillis) || 0,
          steps,
          destinationCoords: resolvedEnd,
        });
      })
      .catch((err: unknown) => {
        if (isCancelled) return;
        onRouteLoading(false);
        const msg = err instanceof Error ? err.message : String(err);

        // Tier 2 Quota Defense: notify quota banner ONLY on real quota errors
        if (
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('429')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }

        if (msg.includes('ZERO_RESULTS')) {
          onRouteError(
            lang === 'th'
              ? 'ไม่พบเส้นทางจากที่อยู่นี้ กดปุ่มเปิด Google Maps ภายนอกเพื่อดูหมุดเพิ่มเติมได้'
              : 'No driving route found for this address. Use external Google Maps if needed.'
          );
        } else {
          onRouteError(
            lang === 'th'
              ? 'ไม่สามารถคำนวณเส้นทางได้ชั่วคราว สามารถกดคำนวณใหม่หรือเปิด Google Maps ภายนอก'
              : 'Unable to compute route right now. Try refreshing or use external Google Maps.'
          );
        }
      });

    return () => {
      isCancelled = true;
      clearPolylines();
    };
  }, [
    routesLib,
    map,
    origin,
    destination,
    routeTriggerNonce,
    lang,
    onRouteLoading,
    onRouteSuccess,
    onRouteError,
  ]);

  return null;
};

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
  const initialDestCoords = useMemo<LatLngLiteralSimple | null>(() => {
    if (
      typeof order.deliveryLat === 'number' &&
      typeof order.deliveryLng === 'number' &&
      Number.isFinite(order.deliveryLat) &&
      Number.isFinite(order.deliveryLng)
    ) {
      return { lat: order.deliveryLat, lng: order.deliveryLng };
    }
    return null;
  }, [order.deliveryLat, order.deliveryLng]);

  const [riderPosition, setRiderPosition] = useState<LatLngLiteralSimple | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'locating' | 'active' | 'denied' | 'unavailable'>(
    typeof navigator !== 'undefined' && 'geolocation' in navigator ? 'locating' : 'unavailable'
  );
  const [fallbackOriginAllowed, setFallbackOriginAllowed] = useState(false);
  const [routedOrigin, setRoutedOrigin] = useState<LatLngLiteralSimple | string | null>(null);
  const [routeTriggerNonce, setRouteTriggerNonce] = useState(0);
  const lastRoutedCoordsRef = useRef<LatLngLiteralSimple | null>(null);

  const [followRider, setFollowRider] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeSummary, setRouteSummary] = useState<RouteSummaryState | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [fatalMapError, setFatalMapError] = useState<string | null>(null);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const externalMapsUrl = useMemo(() => buildExternalGoogleMapsUrl(order), [order]);

  const exitFullscreenSafe = useCallback(() => {
    try {
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    } catch {
      // Ignore fullscreen exit failures
    }
  }, []);

  const handleBackPress = useCallback(() => {
    exitFullscreenSafe();
    onBack();
  }, [exitFullscreenSafe, onBack]);

  // Auto-enter fullscreen on open and lock body scroll cleanly
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {
          // Graceful no-op when iOS Safari or embedded iframe denies native Fullscreen API;
          // CSS fixed inset-0 h-[100dvh] still fills 100% of screen automatically.
        });
      }
    } catch {
      // Ignore fullscreen request errors
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      exitFullscreenSafe();
    };
  }, [exitFullscreenSafe, onBack]);

  // Brief grace timer so GPS can lock before falling back to store/Bangkok origin (conserves Demo Key quota)
  useEffect(() => {
    const timer = setTimeout(() => {
      setFallbackOriginAllowed(true);
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  // Live GPS tracking via navigator.geolocation.watchPosition
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsStatus('unavailable');
      setFallbackOriginAllowed(true);
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const next: LatLngLiteralSimple = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setRiderPosition(next);
        setGpsStatus('active');

        const prevRouted = lastRoutedCoordsRef.current;
        if (!prevRouted) {
          lastRoutedCoordsRef.current = next;
          setRoutedOrigin(next);
        } else if (haversineMeters(prevRouted, next) >= RECALCULATE_DISTANCE_THRESHOLD_M) {
          lastRoutedCoordsRef.current = next;
          setRoutedOrigin(next);
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGpsStatus('denied');
        } else {
          setGpsStatus('unavailable');
        }
        setFallbackOriginAllowed(true);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 3000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // Resolve origin cleanly once GPS locks OR after 1.2s fallback
  const effectiveOrigin = useMemo<LatLngLiteralSimple | string | null>(() => {
    if (routedOrigin) return routedOrigin;
    if (riderPosition) return riderPosition;
    if (!fallbackOriginAllowed) return null;
    if (store?.shopAddress && store.shopAddress.trim().length > 0) {
      return store.shopAddress.trim();
    }
    return initialDestCoords ? DEFAULT_THAILAND_CENTER : DEFAULT_THAILAND_CENTER;
  }, [routedOrigin, riderPosition, fallbackOriginAllowed, store?.shopAddress, initialDestCoords]);

  const effectiveDestination = useMemo<LatLngLiteralSimple | string>(() => {
    if (initialDestCoords) return initialDestCoords;
    return order.deliveryAddress?.trim() || 'Bangkok, Thailand';
  }, [initialDestCoords, order.deliveryAddress]);

  const destinationMarkerPos = initialDestCoords || routeSummary?.destinationCoords || null;
  const defaultMapCenter = riderPosition || destinationMarkerPos || DEFAULT_THAILAND_CENTER;

  const currentStep = routeSummary?.steps?.[0] || null;
  const straightDistanceMeters = useMemo(() => {
    if (!riderPosition || !destinationMarkerPos) return null;
    return haversineMeters(riderPosition, destinationMarkerPos);
  }, [riderPosition, destinationMarkerPos]);

  const handleRecenter = () => {
    setFollowRider(true);
  };

  const handleManualRecalculate = () => {
    if (riderPosition) {
      lastRoutedCoordsRef.current = riderPosition;
      setRoutedOrigin(riderPosition);
    }
    setRouteTriggerNonce((n) => n + 1);
  };

  const handleConfirmComplete = async () => {
    await onCompleteDelivery(order);
    exitFullscreenSafe();
    onBack();
  };

  const isKeyMissing = !MAPS_API_KEY;
  const showFallbackCard = isKeyMissing || Boolean(fatalMapError);

  return (
    <div
      className="fixed inset-0 z-[60] w-screen h-[100dvh] bg-slate-950 text-slate-100 flex flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label={lang === 'th' ? 'ระบบนำทางจัดส่งเต็มหน้าจอ' : 'Full-Screen Delivery Navigation'}
    >
      {/* 1. Top Navigation HUD */}
      <header className="shrink-0 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-3.5 pt-[max(0.65rem,env(safe-area-inset-top))] pb-2.5 space-y-2 z-20">
        {/* Turn-by-Turn Primary Banner */}
        <div className="rounded-2xl bg-emerald-600 text-slate-950 px-3.5 py-2.5 shadow-lg">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-slate-950/15 flex items-center justify-center shrink-0">
                {routeLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-slate-950" />
                ) : currentStep ? (
                  renderManeuverIcon(currentStep.maneuver)
                ) : (
                  <Navigation className="w-5 h-5 text-slate-950" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-black uppercase tracking-wide opacity-80 flex items-center gap-1.5">
                  <span>{lang === 'th' ? 'กำลังนำทางอัตโนมัติ' : 'Auto Navigation Active'}</span>
                  {currentStep && currentStep.distanceMeters > 0 && (
                    <span>• {formatNavDistance(currentStep.distanceMeters, lang)}</span>
                  )}
                </div>
                <p className="text-sm font-black leading-snug line-clamp-2">
                  {routeLoading
                    ? lang === 'th'
                      ? 'กำลังคำนวณเส้นทางที่ดีที่สุด...'
                      : 'Calculating optimal route...'
                    : currentStep
                      ? currentStep.instruction
                      : lang === 'th'
                        ? `มุ่งหน้าไปยัง: ${order.deliveryAddress || order.customerName}`
                        : `Head to: ${order.deliveryAddress || order.customerName}`}
                </p>
              </div>
            </div>

            {/* ETA & Total Distance Pill */}
            {(routeSummary || straightDistanceMeters !== null) && (
              <div className="text-right shrink-0 bg-slate-950/15 rounded-xl px-2.5 py-1.5">
                {routeSummary ? (
                  <>
                    <div className="text-xs font-black tabular-nums">
                      {formatNavDuration(routeSummary.durationMillis, lang)}
                    </div>
                    <div className="text-[11px] font-extrabold opacity-85 tabular-nums">
                      {formatNavDistance(routeSummary.distanceMeters, lang)}
                    </div>
                  </>
                ) : straightDistanceMeters !== null ? (
                  <div className="text-xs font-black tabular-nums">
                    ~{formatNavDistance(straightDistanceMeters, lang)}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Expandable Steps Toggle */}
          {routeSummary && routeSummary.steps.length > 1 && (
            <button
              type="button"
              onClick={() => setStepsExpanded((prev) => !prev)}
              className="mt-2 w-full py-1 px-2.5 rounded-lg bg-slate-950/12 hover:bg-slate-950/20 text-[11px] font-extrabold flex items-center justify-between cursor-pointer"
            >
              <span className="inline-flex items-center gap-1">
                <RouteIcon className="w-3.5 h-3.5" />
                {lang === 'th'
                  ? `ดูขั้นตอนนำทางทั้งหมด (${routeSummary.steps.length} จุด)`
                  : `All turn-by-turn steps (${routeSummary.steps.length})`}
              </span>
              {stepsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>

        {/* Collapsible Turn-by-Turn Steps Drawer */}
        {stepsExpanded && routeSummary && routeSummary.steps.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-xl bg-slate-950/90 border border-slate-800 divide-y divide-slate-800/80">
            {routeSummary.steps.map((step, idx) => (
              <div key={idx} className="px-3 py-2 flex items-start gap-2.5 text-xs">
                <span className="w-5 h-5 rounded-full bg-slate-800 text-emerald-400 font-black text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <span className="flex-1 text-slate-200 leading-snug">{step.instruction}</span>
                {step.distanceMeters > 0 && (
                  <span className="text-[11px] font-bold text-slate-400 tabular-nums shrink-0">
                    {formatNavDistance(step.distanceMeters, lang)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Compact Customer & Address Strip */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 min-w-0 text-slate-300">
            <MapPin className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            <span className="font-bold text-white shrink-0">{order.customerName}</span>
            <span className="text-slate-500 shrink-0">•</span>
            <span className="truncate">{order.deliveryAddress || '-'}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {order.customerPhone && (
              <a
                href={`tel:${order.customerPhone}`}
                className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-bold text-[11px] inline-flex items-center gap-1 shrink-0"
              >
                <Phone className="w-3 h-3" />
                <span>{lang === 'th' ? 'โทร' : 'Call'}</span>
              </a>
            )}
            <LanguageToggle variant="dark" lang={lang} />
          </div>
        </div>
      </header>

      {/* 2. Full-Viewport Map Area (Explicit height parent to prevent 0x0 collapse) */}
      <div className="flex-1 min-h-0 relative w-full bg-slate-900">
        {showFallbackCard ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center">
              <AlertCircle className="w-7 h-7" />
            </div>
            <div className="max-w-sm space-y-1.5">
              <h2 className="text-base font-extrabold text-white">
                {lang === 'th' ? 'ไม่สามารถแสดงแผนที่ในหน้าจอได้' : 'Map Unavailable'}
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                {fatalMapError ||
                  (lang === 'th'
                    ? 'ยังไม่ได้ตั้งค่า Google Maps API Key สำหรับแผนที่ในแอป สามารถเปิดแอป Google Maps ภายนอกเพื่อนำทางได้ทันที'
                    : 'Google Maps API key is not configured. Launch external Google Maps below for directions.')}
              </p>
              <div className="mt-2 p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200">
                <span className="text-slate-400 block text-[11px]">
                  {lang === 'th' ? 'ที่อยู่จัดส่ง:' : 'Delivery Address:'}
                </span>
                <span className="font-bold">{order.deliveryAddress || '-'}</span>
              </div>
            </div>
            <a
              href={externalMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 font-black text-xs inline-flex items-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              <span>{lang === 'th' ? 'เปิดแอป Google Maps ภายนอก' : 'Open External Google Maps'}</span>
            </a>
          </div>
        ) : (
          <div className="w-full h-full">
            <APIProvider
              apiKey={MAPS_API_KEY}
              language={lang}
              region="TH"
              libraries={['routes', 'marker']}
            >
              <GoogleMap
                mapId="DEMO_MAP_ID"
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                defaultCenter={defaultMapCenter}
                defaultZoom={15}
                gestureHandling="greedy"
                disableDefaultUI={false}
                fullscreenControl={false}
                mapTypeControl={false}
                streetViewControl={false}
                className="w-full h-full"
                onDragstart={() => setFollowRider(false)}
              >
                <ActiveRouteController
                  origin={effectiveOrigin}
                  destination={effectiveDestination}
                  riderPosition={riderPosition}
                  followRider={followRider}
                  routeTriggerNonce={routeTriggerNonce}
                  lang={lang}
                  onRouteLoading={setRouteLoading}
                  onRouteSuccess={setRouteSummary}
                  onRouteError={setRouteError}
                  onFatalMapError={setFatalMapError}
                />

                {/* Live Rider GPS Marker */}
                {riderPosition && (
                  <AdvancedMarker
                    position={riderPosition}
                    title={lang === 'th' ? 'ตำแหน่งไรเดอร์ (คุณ)' : 'Your Location (Rider)'}
                  >
                    <div className="relative flex items-center justify-center">
                      <span className="absolute w-9 h-9 rounded-full bg-sky-400/40 animate-ping" />
                      <span className="relative w-5 h-5 rounded-full bg-sky-500 border-2 border-white shadow-lg" />
                    </div>
                  </AdvancedMarker>
                )}

                {/* Customer Destination Pin */}
                {destinationMarkerPos && (
                  <AdvancedMarker
                    position={destinationMarkerPos}
                    title={`${order.customerName} (${order.orderNumber})`}
                  >
                    <Pin
                      background="#f97316"
                      borderColor="#9a3412"
                      glyphColor="#ffffff"
                      scale={1.2}
                    />
                  </AdvancedMarker>
                )}
              </GoogleMap>
            </APIProvider>
          </div>
        )}

        {/* GPS & Route Warnings Toast */}
        {(gpsStatus === 'denied' || routeError) && !showFallbackCard && (
          <div className="absolute top-3 left-3 right-16 z-10 space-y-1.5 pointer-events-none">
            {gpsStatus === 'denied' && (
              <div className="px-3 py-2 rounded-xl bg-slate-900/90 border border-amber-500/40 text-amber-200 text-[11px] font-bold backdrop-blur-md">
                {lang === 'th'
                  ? 'ไม่ได้รับสิทธิ์ GPS — กำลังแสดงเส้นทางจากตำแหน่งร้าน/พื้นที่โดยประมาณ'
                  : 'GPS permission denied — showing approximate route from store area.'}
              </div>
            )}
            {routeError && (
              <div className="px-3 py-2 rounded-xl bg-slate-900/90 border border-rose-500/40 text-rose-200 text-[11px] font-bold backdrop-blur-md">
                {routeError}
              </div>
            )}
          </div>
        )}

        {/* Floating Map Action Controls */}
        <div className="absolute right-3 bottom-3 z-10 flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={handleRecenter}
            title={lang === 'th' ? 'ติดตามตำแหน่ง GPS ของฉัน' : 'Follow My GPS'}
            className={`w-11 h-11 rounded-2xl border shadow-lg flex items-center justify-center cursor-pointer transition-all ${
              followRider
                ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                : 'bg-slate-900/95 border-slate-700 text-white hover:bg-slate-800'
            }`}
          >
            <LocateFixed className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={handleManualRecalculate}
            title={lang === 'th' ? 'คำนวณเส้นทางใหม่' : 'Recalculate Route'}
            className="w-11 h-11 rounded-2xl bg-slate-900/95 hover:bg-slate-800 border border-slate-700 text-white shadow-lg flex items-center justify-center cursor-pointer"
          >
            <RefreshCw className={`w-5 h-5 ${routeLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          <a
            href={externalMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={lang === 'th' ? 'เริ่มนำทางด้วยแอป Google Maps' : 'Start Google Maps Turn-by-Turn'}
            className="min-h-[44px] px-3.5 py-2 rounded-2xl bg-orange-500 hover:bg-orange-400 text-slate-950 font-black text-xs shadow-lg flex items-center gap-1.5"
          >
            <Navigation className="w-4 h-4" />
            <span>{lang === 'th' ? 'นำทาง Google Maps' : 'Start Google Maps'}</span>
          </a>
        </div>
      </div>

      {/* 3. Sticky Bottom Action Bar: Back + Job Done Paired Together */}
      <footer className="shrink-0 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 px-3.5 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2.5 z-20">
        {/* Order & Cash Collection Quick Strip */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-black text-white">{order.orderNumber}</span>
            {order.customerNote && (
              <span className="text-[11px] text-amber-300 truncate">* {order.customerNote}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {routeSummary && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                <Clock className="w-3 h-3" />
                {formatNavDuration(routeSummary.durationMillis, lang)}
              </span>
            )}
            {order.paymentMethod === 'cash' ? (
              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-black inline-flex items-center gap-1">
                <Banknote className="w-3.5 h-3.5" />
                {lang === 'th'
                  ? `เก็บเงินสด ฿${formatMoney(order.totalAmount)}`
                  : `Cash ฿${formatMoney(order.totalAmount)}`}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-300 font-black inline-flex items-center gap-1">
                <QrCode className="w-3.5 h-3.5" />
                {lang === 'th' ? 'โอน QR แล้ว' : 'QR Paid'}
              </span>
            )}
          </div>
        </div>

        {/* Paired Bottom Buttons: ย้อนกลับ (Back) + จบงาน (Job Done) */}
        {confirmComplete ? (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmComplete(false)}
              className="min-h-[50px] px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-extrabold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{lang === 'th' ? 'ยกเลิก' : 'Cancel'}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleConfirmComplete}
              className="min-h-[50px] px-4 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-500/25"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              <span>{lang === 'th' ? 'ยืนยันจบงาน' : 'Confirm Done'}</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={handleBackPress}
              className="min-h-[50px] px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-extrabold text-sm flex items-center justify-center gap-2 cursor-pointer active:scale-98 transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{lang === 'th' ? 'ย้อนกลับ' : 'Back'}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmComplete(true)}
              className="min-h-[50px] px-4 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-500/25 active:scale-98 transition-all"
            >
              <PackageCheck className="w-5 h-5" />
              <span>{lang === 'th' ? 'จบงาน (Job Done)' : 'Job Done'}</span>
            </button>
          </div>
        )}
      </footer>
    </div>
  );
};
