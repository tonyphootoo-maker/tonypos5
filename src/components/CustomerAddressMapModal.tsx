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
} from '@vis.gl/react-google-maps';
import {
  LocateFixed,
  MapPin,
  X,
  Check,
  Loader2,
  Home,
  Briefcase,
  Crosshair,
  Plus,
  Minus,
  Trash2,
} from 'lucide-react';
import { Language } from '../types';
import { SavedCustomerAddress } from '../data/onlineDb';
import {
  LatLngLiteralSimple,
  extractLatLngLiteral,
  getCurrentPositionWithIosFallback,
  latLngToMercatorPixel,
  mercatorPixelToLatLng,
} from '../engine/onlineOrdering';

const MAPS_API_KEY: string =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  (typeof process !== 'undefined' ? process.env.GOOGLE_MAPS_API_KEY || '' : '') ||
  '';

const DEFAULT_BANGKOK_CENTER: LatLngLiteralSimple = { lat: 13.7563, lng: 100.5018 };
const TILE_SIZE = 256;

interface MapControllerProps {
  centerTarget: LatLngLiteralSimple | null;
  onMapError: (msg: string) => void;
  lang: Language;
}

const PinMapController: React.FC<MapControllerProps> = ({ centerTarget, onMapError, lang }) => {
  const map = useMap();
  const status = useApiLoadingStatus();

  useEffect(() => {
    if (status === APILoadingStatus.AUTH_FAILURE) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      onMapError(
        lang === 'th'
          ? 'สลับใช้แผนที่สำรองอัตโนมัติ (แตะหรือลากหมุดเพื่อเลือกตำแหน่งได้ตามปกติ)'
          : 'Switched to fallback map (tap or drag pin normally).'
      );
    } else if (status === APILoadingStatus.FAILED) {
      onMapError(
        lang === 'th'
          ? 'โหลด Google Maps ไม่สำเร็จ สลับใช้แผนที่สำรองอัตโนมัติ'
          : 'Google Maps failed to load. Switched to interactive fallback map.'
      );
    }
  }, [status, lang, onMapError]);

  useEffect(() => {
    if (!map || !centerTarget) return;
    map.panTo(centerTarget);
    const z = map.getZoom() ?? 15;
    if (z < 16) map.setZoom(16);
  }, [map, centerTarget]);

  return null;
};

interface FallbackSlippyMapProps {
  center: LatLngLiteralSimple;
  zoom: number;
  pinPos: LatLngLiteralSimple | null;
  lang: Language;
  onCenterChange: (nextCenter: LatLngLiteralSimple) => void;
  onZoomChange: (nextZoom: number) => void;
  onPinChange: (nextPin: LatLngLiteralSimple) => void;
}

const FallbackInteractiveMap: React.FC<FallbackSlippyMapProps> = ({
  center,
  zoom,
  pinPos,
  lang,
  onCenterChange,
  onZoomChange,
  onPinChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pinRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 420, height: 256 });
  const dragStateRef = useRef<{
    mode: 'map' | 'pin';
    inputType: 'mouse' | 'touch';
    startX: number;
    startY: number;
    moved: boolean;
    startWorldX: number;
    startWorldY: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    if (typeof ResizeObserver !== 'undefined') {
      const obs = new ResizeObserver(updateSize);
      obs.observe(el);
      return () => obs.disconnect();
    }
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const centerPx = useMemo(
    () => latLngToMercatorPixel(center.lat, center.lng, zoom, TILE_SIZE),
    [center.lat, center.lng, zoom]
  );

  const topLeftPx = useMemo(
    () => ({
      x: centerPx.x - size.width / 2,
      y: centerPx.y - size.height / 2,
    }),
    [centerPx.x, centerPx.y, size.width, size.height]
  );

  const latestRef = useRef({
    center,
    zoom,
    pinPos,
    centerPx,
    topLeftPx,
    onCenterChange,
    onPinChange,
  });
  latestRef.current = {
    center,
    zoom,
    pinPos,
    centerPx,
    topLeftPx,
    onCenterChange,
    onPinChange,
  };

  // Native non-passive touch listeners so iOS Safari does NOT hijack map/pin dragging to scroll modal
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const getClientPoint = (ev: TouchEvent): { x: number; y: number } | null => {
      const t = ev.touches[0] || ev.changedTouches[0];
      return t ? { x: t.clientX, y: t.clientY } : null;
    };

    const isInsideControls = (target: EventTarget | null): boolean => {
      return target instanceof Element && Boolean(target.closest('[data-map-controls="true"]'));
    };

    const isInsidePin = (target: EventTarget | null): boolean => {
      return target instanceof Element && Boolean(target.closest('[data-map-pin="true"]'));
    };

    const onTouchStart = (ev: TouchEvent) => {
      if (isInsideControls(ev.target) || ev.touches.length !== 1) return;
      const pt = getClientPoint(ev);
      if (!pt) return;
      ev.preventDefault();
      const { centerPx: cPx, center: curCenter, pinPos: curPin, zoom: curZoom } = latestRef.current;
      if (isInsidePin(ev.target)) {
        const pinTarget = curPin || curCenter;
        const pPx = latLngToMercatorPixel(pinTarget.lat, pinTarget.lng, curZoom, TILE_SIZE);
        dragStateRef.current = {
          mode: 'pin',
          inputType: 'touch',
          startX: pt.x,
          startY: pt.y,
          moved: false,
          startWorldX: pPx.x,
          startWorldY: pPx.y,
        };
      } else {
        dragStateRef.current = {
          mode: 'map',
          inputType: 'touch',
          startX: pt.x,
          startY: pt.y,
          moved: false,
          startWorldX: cPx.x,
          startWorldY: cPx.y,
        };
      }
    };

    const onTouchMove = (ev: TouchEvent) => {
      const st = dragStateRef.current;
      if (!st || st.inputType !== 'touch' || ev.touches.length !== 1) return;
      const pt = getClientPoint(ev);
      if (!pt) return;
      ev.preventDefault();
      const dx = pt.x - st.startX;
      const dy = pt.y - st.startY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        st.moved = true;
      }
      if (!st.moved) return;

      const { zoom: curZoom, onCenterChange: emitCenter, onPinChange: emitPin } = latestRef.current;
      if (st.mode === 'map') {
        emitCenter(
          mercatorPixelToLatLng(st.startWorldX - dx, st.startWorldY - dy, curZoom, TILE_SIZE)
        );
      } else {
        emitPin(
          mercatorPixelToLatLng(st.startWorldX + dx, st.startWorldY + dy, curZoom, TILE_SIZE)
        );
      }
    };

    const onTouchEnd = (ev: TouchEvent) => {
      const st = dragStateRef.current;
      if (!st || st.inputType !== 'touch') return;
      dragStateRef.current = null;
      if (!st.moved && st.mode === 'map') {
        const pt = getClientPoint(ev);
        if (!pt) return;
        const rect = el.getBoundingClientRect();
        const localX = pt.x - rect.left;
        const localY = pt.y - rect.top;
        const { topLeftPx: tlPx, zoom: curZoom, onPinChange: emitPin } = latestRef.current;
        emitPin(
          mercatorPixelToLatLng(tlPx.x + localX, tlPx.y + localY, curZoom, TILE_SIZE)
        );
      }
    };

    const onTouchCancel = () => {
      dragStateRef.current = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchCancel);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  }, []);

  const tiles = useMemo(() => {
    const maxTileIdx = Math.pow(2, zoom);
    const minTx = Math.floor(topLeftPx.x / TILE_SIZE);
    const maxTx = Math.floor((topLeftPx.x + size.width) / TILE_SIZE);
    const minTy = Math.floor(topLeftPx.y / TILE_SIZE);
    const maxTy = Math.floor((topLeftPx.y + size.height) / TILE_SIZE);

    const list: Array<{
      key: string;
      src: string;
      left: number;
      top: number;
    }> = [];

    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        if (ty < 0 || ty >= maxTileIdx) continue;
        const wrappedTx = ((tx % maxTileIdx) + maxTileIdx) % maxTileIdx;
        list.push({
          key: `${zoom}-${tx}-${ty}`,
          src: `https://tile.openstreetmap.org/${zoom}/${wrappedTx}/${ty}.png`,
          left: tx * TILE_SIZE - topLeftPx.x,
          top: ty * TILE_SIZE - topLeftPx.y,
        });
      }
    }
    return list;
  }, [zoom, topLeftPx.x, topLeftPx.y, size.width, size.height]);

  const pinScreenPos = useMemo(() => {
    if (!pinPos) return null;
    const px = latLngToMercatorPixel(pinPos.lat, pinPos.lng, zoom, TILE_SIZE);
    return {
      x: px.x - topLeftPx.x,
      y: px.y - topLeftPx.y,
    };
  }, [pinPos, zoom, topLeftPx.x, topLeftPx.y]);

  // Desktop mouse drag/click fallback (touch devices handled via native non-passive listeners above)
  const handleMapMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as Element)?.closest('[data-map-controls="true"]')) return;
    dragStateRef.current = {
      mode: 'map',
      inputType: 'mouse',
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      startWorldX: centerPx.x,
      startWorldY: centerPx.y,
    };
  };

  const handlePinMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const curPin = pinPos || center;
    const pinWorld = latLngToMercatorPixel(curPin.lat, curPin.lng, zoom, TILE_SIZE);
    dragStateRef.current = {
      mode: 'pin',
      inputType: 'mouse',
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      startWorldX: pinWorld.x,
      startWorldY: pinWorld.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const st = dragStateRef.current;
    if (!st || st.inputType !== 'mouse') return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      st.moved = true;
    }
    if (!st.moved) return;

    if (st.mode === 'map') {
      onCenterChange(mercatorPixelToLatLng(st.startWorldX - dx, st.startWorldY - dy, zoom, TILE_SIZE));
    } else if (st.mode === 'pin') {
      onPinChange(mercatorPixelToLatLng(st.startWorldX + dx, st.startWorldY + dy, zoom, TILE_SIZE));
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    const st = dragStateRef.current;
    if (!st || st.inputType !== 'mouse') return;
    dragStateRef.current = null;
    if (!st.moved && st.mode === 'map' && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      onPinChange(
        mercatorPixelToLatLng(topLeftPx.x + localX, topLeftPx.y + localY, zoom, TILE_SIZE)
      );
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMapMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        if (dragStateRef.current?.inputType === 'mouse') {
          dragStateRef.current = null;
        }
      }}
      style={{ touchAction: 'none', WebkitUserSelect: 'none' }}
      className="relative w-full h-60 sm:h-64 overflow-hidden select-none touch-none bg-slate-200 cursor-grab active:cursor-grabbing"
    >
      {/* OSM XYZ Map Tiles */}
      <div className="absolute inset-0 pointer-events-none">
        {tiles.map((t) => (
          <img
            key={t.key}
            src={t.src}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              width: `${TILE_SIZE}px`,
              height: `${TILE_SIZE}px`,
              left: `${Math.round(t.left)}px`,
              top: `${Math.round(t.top)}px`,
            }}
            className="max-w-none select-none"
          />
        ))}
      </div>

      {/* Subtle Center Crosshair Target */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
        <div className="relative flex items-center justify-center">
          <div className="w-7 h-7 rounded-full border-2 border-orange-500/70 bg-white/30 backdrop-blur-[1px]" />
          <div className="absolute w-1.5 h-1.5 rounded-full bg-orange-600" />
        </div>
      </div>

      {/* Draggable Delivery Pin */}
      {pinScreenPos && (
        <div
          ref={pinRef}
          data-map-pin="true"
          role="slider"
          aria-label={lang === 'th' ? 'หมุดจัดส่งอาหาร (ลากเพื่อย้ายตำแหน่ง)' : 'Delivery pin (drag to move)'}
          aria-valuenow={Math.round(pinPos!.lat * 1000)}
          tabIndex={0}
          onMouseDown={handlePinMouseDown}
          style={{
            left: `${pinScreenPos.x}px`,
            top: `${pinScreenPos.y}px`,
            touchAction: 'none',
          }}
          className="absolute -translate-x-1/2 -translate-y-full z-20 cursor-move touch-none group"
        >
          <div className="flex flex-col items-center drop-shadow-[0_4px_8px_rgba(0,0,0,0.35)]">
            <div className="px-2 py-0.5 mb-0.5 rounded-full bg-slate-900/90 text-white text-[10px] font-extrabold whitespace-nowrap">
              {lang === 'th' ? 'ลากย้ายหมุดได้' : 'Drag Pin'}
            </div>
            <div className="w-9 h-9 rounded-full bg-orange-600 border-2 border-white text-white flex items-center justify-center shadow-lg group-active:scale-110 transition-transform">
              <MapPin className="w-5 h-5 fill-white/25" />
            </div>
            <div className="w-2.5 h-2.5 bg-orange-600 rotate-45 -mt-1.5 border-r border-b border-white" />
          </div>
        </div>
      )}

      {/* Map Controls: Zoom */}
      <div
        data-map-controls="true"
        className="absolute right-2.5 top-2.5 z-30 flex flex-col gap-1.5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onZoomChange(Math.min(18, zoom + 1))}
          aria-label={lang === 'th' ? 'ซูมเข้า' : 'Zoom in'}
          className="w-8 h-8 rounded-lg bg-white/95 hover:bg-white border border-slate-300 shadow-sm flex items-center justify-center text-slate-800 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onZoomChange(Math.max(10, zoom - 1))}
          aria-label={lang === 'th' ? 'ซูมออก' : 'Zoom out'}
          className="w-8 h-8 rounded-lg bg-white/95 hover:bg-white border border-slate-300 shadow-sm flex items-center justify-center text-slate-800 cursor-pointer"
        >
          <Minus className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom-left Attribution & Quick Hint */}
      <div className="absolute left-2 bottom-2 z-20 pointer-events-none px-2 py-0.5 rounded-md bg-white/85 backdrop-blur-xs text-[10px] text-slate-600 font-medium border border-slate-200/80">
        © OpenStreetMap
      </div>
    </div>
  );
};

interface Props {
  isOpen: boolean;
  lang: Language;
  initialAddress?: SavedCustomerAddress | null;
  fallbackName?: string;
  fallbackPhone?: string;
  onClose: () => void;
  onSave: (data: {
    id?: string;
    label: string;
    customerName: string;
    customerPhone: string;
    address: string;
    lat: number | null;
    lng: number | null;
    isDefault: boolean;
  }) => void;
}

const PRESET_LABELS = [
  { id: 'home', th: 'บ้าน', en: 'Home', icon: Home },
  { id: 'work', th: 'ที่ทำงาน', en: 'Work', icon: Briefcase },
  { id: 'other', th: 'จุดรับอื่นๆ', en: 'Other', icon: MapPin },
] as const;

export const CustomerAddressMapModal: React.FC<Props> = ({
  isOpen,
  lang,
  initialAddress,
  fallbackName = '',
  fallbackPhone = '',
  onClose,
  onSave,
}) => {
  const [label, setLabel] = useState(initialAddress?.label || (lang === 'th' ? 'บ้าน' : 'Home'));
  const [customerName, setCustomerName] = useState(initialAddress?.customerName || fallbackName);
  const [customerPhone, setCustomerPhone] = useState(initialAddress?.customerPhone || fallbackPhone);
  const [address, setAddress] = useState(initialAddress?.address || '');
  const [pinPos, setPinPos] = useState<LatLngLiteralSimple | null>(
    initialAddress?.lat != null && initialAddress?.lng != null
      ? { lat: initialAddress.lat, lng: initialAddress.lng }
      : null
  );
  const [panTarget, setPanTarget] = useState<LatLngLiteralSimple | null>(
    initialAddress?.lat != null && initialAddress?.lng != null
      ? { lat: initialAddress.lat, lng: initialAddress.lng }
      : null
  );
  const [mapCenter, setMapCenter] = useState<LatLngLiteralSimple>(
    initialAddress?.lat != null && initialAddress?.lng != null
      ? { lat: initialAddress.lat, lng: initialAddress.lng }
      : DEFAULT_BANGKOK_CENTER
  );
  const [fallbackZoom, setFallbackZoom] = useState<number>(
    initialAddress?.lat != null && initialAddress?.lng != null ? 16 : 14
  );
  const [isDefault, setIsDefault] = useState(initialAddress?.isDefault ?? true);
  const [locating, setLocating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mapErrorMsg, setMapErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLabel(initialAddress?.label || (lang === 'th' ? 'บ้าน' : 'Home'));
    setCustomerName(initialAddress?.customerName || fallbackName);
    setCustomerPhone(initialAddress?.customerPhone || fallbackPhone);
    setAddress(initialAddress?.address || '');
    const initCoords =
      initialAddress?.lat != null && initialAddress?.lng != null
        ? { lat: initialAddress.lat, lng: initialAddress.lng }
        : null;
    setPinPos(initCoords);
    setPanTarget(initCoords);
    setMapCenter(initCoords || DEFAULT_BANGKOK_CENTER);
    setFallbackZoom(initCoords ? 16 : 14);
    setIsDefault(initialAddress?.isDefault ?? true);
    setErrorMsg(null);
    setMapErrorMsg(null);
  }, [isOpen, initialAddress, fallbackName, fallbackPhone, lang]);

  const handleMapError = useCallback((msg: string) => {
    setMapErrorMsg(msg);
  }, []);

  if (!isOpen) return null;

  const handleUseCurrentGps = async () => {
    setLocating(true);
    setErrorMsg(null);
    try {
      const coords = await getCurrentPositionWithIosFallback();
      const nextPin = { lat: coords.lat, lng: coords.lng };
      setPinPos(nextPin);
      setPanTarget(nextPin);
      setMapCenter(nextPin);
      setFallbackZoom(17);
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code ?? 2;
      if (code === 1) {
        setErrorMsg(
          lang === 'th'
            ? 'กรุณาอนุญาตการเข้าถึงตำแหน่งที่ตั้งในการตั้งค่า iPhone (Safari > ตำแหน่งที่ตั้ง) หรือแตะ/ลากหมุดบนแผนที่ได้ทันที'
            : 'Location permission denied. Enable Safari Location in iOS Settings, or tap/drag the pin directly on the map.'
        );
      } else {
        setErrorMsg(
          lang === 'th'
            ? 'ไม่สามารถจับตำแหน่ง GPS ปัจจุบันได้ กรุณาแตะหรือเลื่อนแผนที่แล้วกด "ปักหมุดตรงกลาง"'
            : 'Unable to lock current GPS. Tap the map or pan and press "Pin Center".'
        );
      }
    } finally {
      setLocating(false);
    }
  };

  const handlePinMapCenter = () => {
    const nextPin = {
      lat: Number(mapCenter.lat.toFixed(6)),
      lng: Number(mapCenter.lng.toFixed(6)),
    };
    setPinPos(nextPin);
    setErrorMsg(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) {
      setErrorMsg(
        lang === 'th'
          ? 'กรุณากรอกรายละเอียดที่อยู่จัดส่ง (บ้านเลขที่ / ซอย / อาคาร)'
          : 'Please enter delivery address details'
      );
      return;
    }
    onSave({
      ...(initialAddress?.id ? { id: initialAddress.id } : {}),
      label: label.trim() || (lang === 'th' ? 'ที่อยู่จัดส่ง' : 'Delivery Address'),
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      address: address.trim(),
      lat: pinPos?.lat ?? null,
      lng: pinPos?.lng ?? null,
      isDefault,
    });
  };

  const initialCenter = pinPos || DEFAULT_BANGKOK_CENTER;
  const usingGoogleMaps = Boolean(MAPS_API_KEY && !mapErrorMsg);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/65 backdrop-blur-xs p-0 sm:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl max-h-[92dvh] flex flex-col overflow-hidden border border-slate-200 shadow-2xl"
      >
        <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <h3 className="font-extrabold text-sm sm:text-base text-slate-900 truncate">
              {initialAddress
                ? lang === 'th'
                  ? 'แก้ไขที่อยู่ & ปักหมุด GPS'
                  : 'Edit Address & GPS Pin'
                : lang === 'th'
                ? 'เพิ่มที่อยู่ใหม่ & ปักหมุด GPS'
                : 'Add Address & GPS Pin'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === 'th' ? 'ปิดหน้าต่าง' : 'Close'}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 overscroll-contain">
          {/* Address Label Quick Chips */}
          <div className="space-y-1.5">
            <div className="text-xs font-bold text-slate-700">
              {lang === 'th' ? 'ชื่อเรียกที่อยู่' : 'Address Label'}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {PRESET_LABELS.map((preset) => {
                const IconComp = preset.icon;
                const text = preset[lang];
                const isSelected = label.trim() === text;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setLabel(text)}
                    className={`min-h-[36px] px-3 py-1.5 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-orange-50 border-orange-500 text-orange-800'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <IconComp className="w-3.5 h-3.5" />
                    <span>{text}</span>
                  </button>
                );
              })}
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={lang === 'th' ? 'หรือระบุเอง เช่น คอนโด A' : 'Custom label'}
                className="flex-1 min-w-[120px] px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          {/* Interactive Map Pin Picker (Select, Tap, Drag, Center Pin, or Use Current GPS) */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700">
                {lang === 'th'
                  ? 'ปักหมุดตำแหน่งจัดส่งบนแผนที่'
                  : 'Pin Delivery Location on Map'}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handlePinMapCenter}
                  className="min-h-[34px] px-2.5 py-1 rounded-xl bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-800 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  <span>{lang === 'th' ? 'ปักหมุดตรงกลาง' : 'Pin Center'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleUseCurrentGps}
                  disabled={locating}
                  className="min-h-[34px] px-2.5 py-1 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {locating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <LocateFixed className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {locating
                      ? lang === 'th'
                        ? 'กำลังค้นหา...'
                        : 'Locating...'
                      : lang === 'th'
                      ? 'GPS ปัจจุบัน'
                      : 'Current GPS'}
                  </span>
                </button>
              </div>
            </div>

            <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 relative">
              {usingGoogleMaps ? (
                <div className="w-full h-60 sm:h-64 relative">
                  <APIProvider
                    apiKey={MAPS_API_KEY}
                    libraries={['marker']}
                    language={lang}
                    region="TH"
                  >
                    <GoogleMap
                      defaultCenter={initialCenter}
                      defaultZoom={pinPos ? 16 : 14}
                      mapId="DEMO_MAP_ID"
                      gestureHandling="greedy"
                      disableDefaultUI={false}
                      streetViewControl={false}
                      mapTypeControl={false}
                      fullscreenControl={false}
                      internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                      onCameraChanged={(ev) => {
                        const c = ev.detail?.center;
                        if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
                          setMapCenter({ lat: c.lat, lng: c.lng });
                        }
                      }}
                      onClick={(ev) => {
                        const latLng = ev.detail?.latLng;
                        if (latLng) {
                          const nextCoords = {
                            lat: Number(latLng.lat.toFixed(6)),
                            lng: Number(latLng.lng.toFixed(6)),
                          };
                          setPinPos(nextCoords);
                          setMapCenter(nextCoords);
                        }
                      }}
                      className="w-full h-full"
                    >
                      <PinMapController
                        centerTarget={panTarget}
                        onMapError={handleMapError}
                        lang={lang}
                      />
                      {pinPos && (
                        <AdvancedMarker
                          position={pinPos}
                          draggable={true}
                          title={lang === 'th' ? 'จุดจัดส่งอาหาร (ลากย้ายได้)' : 'Delivery Pin (Drag to move)'}
                          onDrag={(ev) => {
                            const literal = extractLatLngLiteral(ev.latLng);
                            if (literal) {
                              setPinPos({
                                lat: Number(literal.lat.toFixed(6)),
                                lng: Number(literal.lng.toFixed(6)),
                              });
                            }
                          }}
                          onDragEnd={(ev) => {
                            const literal = extractLatLngLiteral(ev.latLng);
                            if (literal) {
                              const nextCoords = {
                                lat: Number(literal.lat.toFixed(6)),
                                lng: Number(literal.lng.toFixed(6)),
                              };
                              setPinPos(nextCoords);
                              setMapCenter(nextCoords);
                            }
                          }}
                        >
                          <Pin
                            background="#ea580c"
                            borderColor="#9a3412"
                            glyphColor="#ffffff"
                            scale={1.25}
                          />
                        </AdvancedMarker>
                      )}
                    </GoogleMap>
                  </APIProvider>

                  {/* Center Crosshair Guide on Google Map */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
                    <div className="relative flex items-center justify-center">
                      <div className="w-7 h-7 rounded-full border-2 border-orange-500/65 bg-white/25" />
                      <div className="absolute w-1.5 h-1.5 rounded-full bg-orange-600" />
                    </div>
                  </div>
                </div>
              ) : (
                <FallbackInteractiveMap
                  center={mapCenter}
                  zoom={fallbackZoom}
                  pinPos={pinPos}
                  lang={lang}
                  onCenterChange={setMapCenter}
                  onZoomChange={setFallbackZoom}
                  onPinChange={(nextPin) => {
                    setPinPos(nextPin);
                    setErrorMsg(null);
                  }}
                />
              )}

              <div className="px-3 py-2 bg-white border-t border-slate-200 text-[11px] text-slate-600 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {pinPos
                    ? lang === 'th'
                      ? 'แตะแผนที่ ลากหมุดสีส้ม หรือเลื่อนแผนที่แล้วกด "ปักหมุดตรงกลาง" เพื่อย้ายจุดได้ทันที'
                      : 'Tap map, drag the orange pin, or pan & press "Pin Center" to move'
                    : lang === 'th'
                    ? 'แตะลงบนแผนที่หรือกด "ปักหมุดตรงกลาง" เพื่อวางหมุดจัดส่ง'
                    : 'Tap anywhere on the map or press "Pin Center" to place your pin'}
                </span>
                <div className="flex items-center gap-2 shrink-0 ml-auto">
                  {pinPos ? (
                    <>
                      <span className="font-mono font-bold text-emerald-700 tabular-nums">
                        {pinPos.lat.toFixed(5)}, {pinPos.lng.toFixed(5)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPinPos(null)}
                        title={lang === 'th' ? 'ล้างหมุด' : 'Clear pin'}
                        className="p-1 rounded-md bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <span className="text-[11px] font-semibold text-amber-700">
                      {lang === 'th' ? 'ยังไม่ปักหมุด' : 'No pin set'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Address Text & Recipient Contact */}
          <div className="space-y-2.5">
            <div>
              <div className="text-xs font-bold text-slate-700 mb-1">
                {lang === 'th' ? 'ที่อยู่จัดส่งโดยละเอียด *' : 'Full Delivery Address *'}
              </div>
              <textarea
                required
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={
                  lang === 'th'
                    ? 'บ้านเลขที่ ซอย ถนน อาคาร ชั้น จุดสังเกต...'
                    : 'House no., street, building, floor, landmark...'
                }
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-orange-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <div className="text-xs font-bold text-slate-700 mb-1">
                  {lang === 'th' ? 'ชื่อผู้รับอาหาร' : 'Recipient Name'}
                </div>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder={lang === 'th' ? 'ชื่อผู้รับ' : 'Recipient name'}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-700 mb-1">
                  {lang === 'th' ? 'เบอร์โทรติดต่อผู้รับ' : 'Recipient Phone'}
                </div>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="08x-xxx-xxxx"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsDefault((v) => !v)}
              className="w-full min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-xs font-bold text-slate-700 cursor-pointer"
            >
              <span>
                {lang === 'th' ? 'ตั้งเป็นที่อยู่หลักสำหรับครั้งถัดไป' : 'Set as default address'}
              </span>
              <span
                className={`w-5 h-5 rounded-md flex items-center justify-center ${
                  isDefault ? 'bg-orange-600 text-white' : 'bg-white border border-slate-300'
                }`}
              >
                {isDefault ? <Check className="w-3.5 h-3.5" /> : null}
              </span>
            </button>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
          >
            {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
          </button>
          <button
            type="submit"
            className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-orange-600 bg-gradient-to-r from-orange-500 to-red-600 text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>
              {initialAddress
                ? lang === 'th'
                  ? 'บันทึกการแก้ไขที่อยู่'
                  : 'Save Address Changes'
                : lang === 'th'
                ? 'บันทึกที่อยู่นี้'
                : 'Save Address'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
};
