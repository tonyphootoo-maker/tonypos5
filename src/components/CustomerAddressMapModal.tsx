/// <reference types="google.maps" />
import React, { useEffect, useState } from 'react';
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
  AlertCircle,
  Loader2,
  Home,
  Briefcase,
} from 'lucide-react';
import { Language } from '../types';
import { SavedCustomerAddress } from '../data/onlineDb';
import { LatLngLiteralSimple } from '../engine/onlineOrdering';

const MAPS_API_KEY: string =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  (typeof process !== 'undefined' ? process.env.GOOGLE_MAPS_API_KEY || '' : '') ||
  '';

const DEFAULT_BANGKOK_CENTER: LatLngLiteralSimple = { lat: 13.7563, lng: 100.5018 };

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
          ? 'ไม่สามารถโหลดแผนที่ Google Maps ได้ กรุณากรอกที่อยู่หรือกดใช้ตำแหน่ง GPS ปัจจุบันแทน'
          : 'Google Maps authorization failed. You can still type your address or use Current GPS.'
      );
    } else if (status === APILoadingStatus.FAILED) {
      onMapError(
        lang === 'th'
          ? 'โหลดแผนที่ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต'
          : 'Failed to load Google Maps. Check your internet connection.'
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
    setIsDefault(initialAddress?.isDefault ?? true);
    setErrorMsg(null);
    setMapErrorMsg(null);
  }, [isOpen, initialAddress, fallbackName, fallbackPhone, lang]);

  if (!isOpen) return null;

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation) {
      setErrorMsg(
        lang === 'th' ? 'อุปกรณ์นี้ไม่รองรับการจับตำแหน่ง GPS' : 'Geolocation is not supported'
      );
      return;
    }
    setLocating(true);
    setErrorMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        setPinPos(coords);
        setPanTarget(coords);
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        if (err.code === 1) {
          setErrorMsg(
            lang === 'th'
              ? 'กรุณาอนุญาตการเข้าถึงตำแหน่งที่ตั้งในการตั้งค่า Safari/iPhone หรือแตะบนแผนที่เพื่อปักหมุดเอง'
              : 'Location permission denied. Tap anywhere on the map to drop your delivery pin manually.'
          );
        } else {
          setErrorMsg(
            lang === 'th'
              ? 'ไม่สามารถจับตำแหน่ง GPS ปัจจุบันได้ กรุณาแตะปักหมุดบนแผนที่แทน'
              : 'Unable to lock current GPS. Please tap the map to place your delivery pin.'
          );
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
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

          {/* Interactive Google Map Pin Picker + Current GPS CTA */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700">
                {lang === 'th'
                  ? 'ปักหมุดตำแหน่งจัดส่งบนแผนที่'
                  : 'Pin Delivery Location on Map'}
              </span>
              <button
                type="button"
                onClick={handleUseCurrentGps}
                disabled={locating}
                className="min-h-[34px] px-3 py-1 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
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
                    ? 'ใช้ตำแหน่งปัจจุบัน'
                    : 'Use Current GPS'}
                </span>
              </button>
            </div>

            {MAPS_API_KEY && !mapErrorMsg ? (
              <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 relative">
                <div className="w-full h-56 sm:h-64">
                  <APIProvider
                    apiKey={MAPS_API_KEY}
                    libraries={['marker']}
                    language={lang}
                    region="TH"
                  >
                    <GoogleMap
                      defaultCenter={initialCenter}
                      defaultZoom={pinPos ? 16 : 12}
                      mapId="DEMO_MAP_ID"
                      gestureHandling="greedy"
                      disableDefaultUI={false}
                      streetViewControl={false}
                      mapTypeControl={false}
                      fullscreenControl={false}
                      internalUsageAttributionIds={[
                        'gmp_mcp_codeassist_v1_aistudio',
                        'gmp_git_agentskills_v1',
                      ]}
                      onClick={(ev) => {
                        const latLng = ev.detail?.latLng;
                        if (latLng) {
                          setPinPos({
                            lat: Number(latLng.lat.toFixed(6)),
                            lng: Number(latLng.lng.toFixed(6)),
                          });
                        }
                      }}
                      className="w-full h-full"
                    >
                      <PinMapController
                        centerTarget={panTarget}
                        onMapError={setMapErrorMsg}
                        lang={lang}
                      />
                      {pinPos && (
                        <AdvancedMarker
                          position={pinPos}
                          draggable
                          title={lang === 'th' ? 'จุดจัดส่งอาหาร' : 'Delivery Pin'}
                          onDragEnd={(ev) => {
                            const pos = ev.latLng;
                            if (pos) {
                              setPinPos({
                                lat: Number(pos.lat().toFixed(6)),
                                lng: Number(pos.lng().toFixed(6)),
                              });
                            }
                          }}
                        >
                          <Pin
                            background="#ea580c"
                            borderColor="#9a3412"
                            glyphColor="#ffffff"
                            scale={1.2}
                          />
                        </AdvancedMarker>
                      )}
                    </GoogleMap>
                  </APIProvider>
                </div>
                <div className="px-3 py-1.5 bg-white/95 border-t border-slate-200 text-[11px] text-slate-600 flex items-center justify-between gap-2">
                  <span>
                    {lang === 'th'
                      ? 'แตะบนแผนที่หรือลากหมุดสีส้มเพื่อปรับตำแหน่งให้ตรงหน้าบ้าน'
                      : 'Tap map or drag orange pin to match exact drop-off spot'}
                  </span>
                  {pinPos && (
                    <span className="font-mono font-semibold text-emerald-700 shrink-0 tabular-nums">
                      {pinPos.lat.toFixed(5)}, {pinPos.lng.toFixed(5)}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <span>
                    {mapErrorMsg ||
                      (lang === 'th'
                        ? 'สามารถกดปุ่ม "ใช้ตำแหน่งปัจจุบัน" ด้านบนเพื่อแนบพิกัด GPS ให้ไรเดอร์นำทางได้ทันที'
                        : 'Tap "Use Current GPS" above to attach exact GPS coordinates for Rider navigation.')}
                  </span>
                </div>
                {pinPos && (
                  <div className="text-[11px] font-mono font-bold text-emerald-700 pl-6 tabular-nums">
                    GPS: {pinPos.lat}, {pinPos.lng}
                  </div>
                )}
              </div>
            )}
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
