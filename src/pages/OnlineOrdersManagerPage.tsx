import React, { useEffect, useMemo, useRef, useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import {
  ShoppingBag,
  Copy,
  Check,
  ExternalLink,
  Volume2,
  VolumeX,
  UploadCloud,
  RefreshCw,
  Printer,
  Trash2,
  CheckCircle2,
  Clock,
  Truck,
  Store,
  XCircle,
  Loader2,
  ShieldCheck,
  Bike,
  QrCode,
  Banknote,
  MapPin,
  Phone,
  X,
  FileText,
} from 'lucide-react';
import {
  CategoryDoc,
  DishDoc,
  IngredientDoc,
  Language,
  OnlineOrderDoc,
  OnlineOrderStatus,
  OptionGroupDoc,
  PackagingDoc,
  SettingsDoc,
  SubRecipeDoc,
} from '../types';
import { subscribeCollection, updateSettings } from '../data/db';
import {
  deleteOnlineOrderByOwner,
  publishMenuToPublicStore,
  subscribeOwnerOnlineOrders,
  syncCompletedOnlineOrdersToPnl,
  updateOnlineOrderByOwner,
} from '../data/onlineDb';
import { formatMoney } from '../engine/calculations';
import {
  isOnlineOrderInLocalPeriod,
  OnlinePeriodFilter,
  toDateSafe,
} from '../engine/onlineOrdering';
import { NumericInput } from '../costing/components/common/NumericInput';
import { ConfirmModal } from '../components/ConfirmModal';

interface Props {
  user: FirebaseUser;
  settings: SettingsDoc;
  lang: Language;
  onSettingsUpdated: (newSettings: SettingsDoc) => void;
}

const STATUS_META: Record<
  OnlineOrderStatus,
  { th: string; en: string; badgeCls: string }
> = {
  pending: {
    th: 'รอร้านยืนยัน',
    en: 'Pending',
    badgeCls: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  accepted: {
    th: 'รับออเดอร์แล้ว',
    en: 'Accepted',
    badgeCls: 'bg-sky-100 text-sky-800 border-sky-200',
  },
  preparing: {
    th: 'กำลังทำอาหาร',
    en: 'Preparing',
    badgeCls: 'bg-orange-100 text-orange-800 border-orange-200',
  },
  ready_for_pickup: {
    th: 'พร้อมรับ / รอไรเดอร์',
    en: 'Ready',
    badgeCls: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  },
  out_for_delivery: {
    th: 'กำลังจัดส่ง',
    en: 'Out for Delivery',
    badgeCls: 'bg-teal-100 text-teal-800 border-teal-200',
  },
  completed: {
    th: 'สำเร็จแล้ว',
    en: 'Completed',
    badgeCls: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  cancelled: {
    th: 'ยกเลิกแล้ว',
    en: 'Cancelled',
    badgeCls: 'bg-rose-100 text-rose-800 border-rose-200',
  },
};

function playIncomingOrderChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(660, now);
    osc1.frequency.setValueAtTime(880, now + 0.14);
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.46);
  } catch {
    // Audio playback blocked by browser autoplay policy before user gesture
  }
}

export const OnlineOrdersManagerPage: React.FC<Props> = ({
  user,
  settings,
  lang,
  onSettingsUpdated,
}) => {
  const [orders, setOrders] = useState<OnlineOrderDoc[]>([]);
  const [dishes, setDishes] = useState<DishDoc[]>([]);
  const [categories, setCategories] = useState<CategoryDoc[]>([]);
  const [optionGroups, setOptionGroups] = useState<OptionGroupDoc[]>([]);
  const [ingredients, setIngredients] = useState<IngredientDoc[]>([]);
  const [subRecipes, setSubRecipes] = useState<SubRecipeDoc[]>([]);
  const [packaging, setPackaging] = useState<PackagingDoc[]>([]);

  const [periodFilter, setPeriodFilter] = useState<OnlinePeriodFilter>('today');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'cancelled'>('all');
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [onlineEnabled, setOnlineEnabled] = useState(settings.onlineOrderingEnabled !== false);
  const [pickupEnabled, setPickupEnabled] = useState(settings.onlinePickupEnabled !== false);
  const [deliveryEnabled, setDeliveryEnabled] = useState(settings.onlineDeliveryEnabled !== false);
  const [deliveryFee, setDeliveryFee] = useState<number>(settings.onlineDeliveryFee ?? 30);
  const [prepMinutes, setPrepMinutes] = useState<number>(settings.onlineEstimatedPrepMinutes ?? 20);
  const [publishDefaultIndex, setPublishDefaultIndex] = useState(
    settings.onlinePublishDefaultIndex !== false
  );

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [isSyncingPnl, setIsSyncingPnl] = useState(false);
  const [pnlSyncMessage, setPnlSyncMessage] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<'customer' | 'rider' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [printingOrder, setPrintingOrder] = useState<OnlineOrderDoc | null>(null);
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>('80mm');
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<OnlineOrderDoc | null>(null);

  const initialOrdersLoadedRef = useRef(false);
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const lastPnlSigRef = useRef<string>('');

  useEffect(() => {
    setOnlineEnabled(settings.onlineOrderingEnabled !== false);
    setPickupEnabled(settings.onlinePickupEnabled !== false);
    setDeliveryEnabled(settings.onlineDeliveryEnabled !== false);
    setDeliveryFee(settings.onlineDeliveryFee ?? 30);
    setPrepMinutes(settings.onlineEstimatedPrepMinutes ?? 20);
    setPublishDefaultIndex(settings.onlinePublishDefaultIndex !== false);
  }, [settings]);

  useEffect(() => {
    const unsubs = [
      subscribeCollection<DishDoc>('dishes', setDishes),
      subscribeCollection<CategoryDoc>('categories', setCategories),
      subscribeCollection<OptionGroupDoc>('optionGroups', setOptionGroups),
      subscribeCollection<IngredientDoc>('ingredients', setIngredients),
      subscribeCollection<SubRecipeDoc>('subRecipes', setSubRecipes),
      subscribeCollection<PackagingDoc>('packaging', setPackaging),
      subscribeOwnerOnlineOrders(
        user.uid,
        (list) => {
          if (!initialOrdersLoadedRef.current) {
            initialOrdersLoadedRef.current = true;
            list.forEach((o) => knownOrderIdsRef.current.add(o.id));
          } else {
            let hasNewPending = false;
            for (const o of list) {
              if (!knownOrderIdsRef.current.has(o.id)) {
                knownOrderIdsRef.current.add(o.id);
                if (o.status === 'pending') hasNewPending = true;
              }
            }
            if (hasNewPending && soundEnabled) {
              playIncomingOrderChime();
            }
          }
          setOrders(list);
        },
        (err) => {
          setErrorMsg(err.message);
        }
      ),
    ];

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [user.uid, soundEnabled]);

  // Automatic idempotent P&L sync when completed orders exist or change
  useEffect(() => {
    if (orders.length === 0 || dishes.length === 0) return;
    const completedSig = orders
      .filter((o) => o.status === 'completed')
      .map((o) => `${o.id}:${o.subtotal}:${o.deliveryFee}:${o.workDate || ''}:${o.pnlSyncedAt ? 1 : 0}`)
      .sort()
      .join('|');

    if (!completedSig || completedSig === lastPnlSigRef.current) return;
    const needsSync = orders.some((o) => o.status === 'completed' && !o.pnlSyncedAt);
    if (!needsSync && lastPnlSigRef.current !== '') return;

    lastPnlSigRef.current = completedSig;
    syncCompletedOnlineOrdersToPnl({
      uid: user.uid,
      orders,
      settings,
      dishes,
      optionGroups,
      ingredients,
      subRecipes,
      packaging,
    }).catch((err) => {
      console.warn('Auto P&L sync warning:', err);
    });
  }, [orders, dishes, optionGroups, ingredients, subRecipes, packaging, settings, user.uid]);

  const baseUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname.replace(/\/+$/, '') || ''}`;
  }, []);

  const customerUrl = `${baseUrl}/?mode=order&store=${user.uid}`;
  const riderUrl = `${baseUrl}/?mode=rider&store=${user.uid}`;

  const handleCopyUrl = async (type: 'customer' | 'rider', url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(type);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Fallback ignored
    }
  };

  const handlePublishMenu = async () => {
    setIsPublishing(true);
    setPublishMessage(null);
    setErrorMsg(null);
    try {
      const nextSettingsFields: Partial<SettingsDoc> = {
        onlineOrderingEnabled: onlineEnabled,
        onlinePickupEnabled: pickupEnabled,
        onlineDeliveryEnabled: deliveryEnabled,
        onlineDeliveryFee: Math.max(0, Number(deliveryFee) || 0),
        onlineEstimatedPrepMinutes: Math.max(5, Number(prepMinutes) || 20),
        onlinePublishDefaultIndex: publishDefaultIndex,
      };
      const mergedSettings: SettingsDoc = {
        ...settings,
        ...nextSettingsFields,
      };

      const pubRes = await publishMenuToPublicStore({
        storeId: user.uid,
        settings: mergedSettings,
        categories,
        dishes,
        optionGroups,
      });

      await updateSettings(
        {
          ...nextSettingsFields,
          onlineLastPublishedAt: pubRes.publishedAt,
        },
        settings.version
      );

      onSettingsUpdated({
        ...mergedSettings,
        onlineLastPublishedAt: pubRes.publishedAt,
        version: settings.version + 1,
        updatedAt: new Date().toISOString(),
      });

      setPublishMessage(
        lang === 'th'
          ? `เผยแพร่เมนูขึ้นเว็บสำเร็จ (${pubRes.dishCount} เมนู • รูปภาพ ${pubRes.imageCount} รูป • ซ่อนข้อมูลต้นทุนและสูตรอาหาร 100%)`
          : `Published storefront (${pubRes.dishCount} dishes • ${pubRes.imageCount} photos • zero cost/recipe data exposed)`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPublishing(false);
    }
  };

  const handleManualSyncPnl = async () => {
    setIsSyncingPnl(true);
    setPnlSyncMessage(null);
    setErrorMsg(null);
    try {
      const res = await syncCompletedOnlineOrdersToPnl({
        uid: user.uid,
        orders,
        settings,
        dishes,
        optionGroups,
        ingredients,
        subRecipes,
        packaging,
      });
      setPnlSyncMessage(
        lang === 'th'
          ? `ซิงค์ยอดออเดอร์ออนไลน์ที่สำเร็จแล้วเข้า P&L เรียบร้อย (${res.syncedRecords} แฟ้มวัน/ช่องทาง • แยกค่าส่งออกจากค่าอาหาร)`
          : `Synced completed online orders to P&L (${res.syncedRecords} daily channel records)`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSyncingPnl(false);
    }
  };

  const handleStatusChange = async (order: OnlineOrderDoc, nextStatus: OnlineOrderStatus) => {
    setErrorMsg(null);
    try {
      await updateOnlineOrderByOwner(order.id, nextStatus);
      const updatedOrders = orders.map((o) =>
        o.id === order.id
          ? {
              ...o,
              status: nextStatus,
              ...(nextStatus === 'completed' ? { completedAt: new Date().toISOString() } : {}),
            }
          : o
      );
      if (nextStatus === 'completed' || order.status === 'completed') {
        await syncCompletedOnlineOrdersToPnl({
          uid: user.uid,
          orders: updatedOrders,
          settings,
          dishes,
          optionGroups,
          ingredients,
          subRecipes,
          packaging,
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetOrder) return;
    const target = deleteTargetOrder;
    setDeleteTargetOrder(null);
    try {
      await deleteOnlineOrderByOwner(target.id);
      const remaining = orders.filter((o) => o.id !== target.id);
      if (target.status === 'completed') {
        await syncCompletedOnlineOrdersToPnl({
          uid: user.uid,
          orders: remaining,
          settings,
          dishes,
          optionGroups,
          ingredients,
          subRecipes,
          packaging,
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const periodOrders = useMemo(
    () => orders.filter((o) => isOnlineOrderInLocalPeriod(o.createdAt, periodFilter)),
    [orders, periodFilter]
  );

  const filteredOrders = useMemo(() => {
    return periodOrders.filter((o) => {
      if (statusFilter === 'active') {
        return o.status !== 'completed' && o.status !== 'cancelled';
      }
      if (statusFilter === 'completed') return o.status === 'completed';
      if (statusFilter === 'cancelled') return o.status === 'cancelled';
      return true;
    });
  }, [periodOrders, statusFilter]);

  const kpi = useMemo(() => {
    let activeCount = 0;
    let completedCount = 0;
    let foodSalesTotal = 0;
    let deliveryFeeTotal = 0;
    for (const o of periodOrders) {
      if (o.status === 'completed') {
        completedCount += 1;
        foodSalesTotal += o.subtotal || 0;
        deliveryFeeTotal += o.orderMode === 'delivery' ? o.deliveryFee || 0 : 0;
      } else if (o.status !== 'cancelled') {
        activeCount += 1;
      }
    }
    return {
      totalCount: periodOrders.length,
      activeCount,
      completedCount,
      foodSalesTotal,
      deliveryFeeTotal,
    };
  }, [periodOrders]);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2.5">
            <ShoppingBag className="w-6 h-6 text-emerald-600" />
            <span>{lang === 'th' ? 'ออเดอร์ออนไลน์ & Rider' : 'Online Orders & Rider'}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {lang === 'th'
              ? 'รับออเดอร์จากเว็บลูกค้า ส่งงานไรเดอร์ และซิงค์ยอดที่สำเร็จเข้า P&L แยกจากบิลหน้าร้านอัตโนมัติ'
              : 'Manage customer web orders, dispatch riders, and sync completed sales directly to P&L.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSoundEnabled((s) => !s)}
            className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              soundEnabled
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-slate-100 border-slate-200 text-slate-600'
            }`}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span>
              {soundEnabled
                ? lang === 'th'
                  ? 'เปิดเสียงแจ้งเตือน'
                  : 'Alert Sound On'
                : lang === 'th'
                ? 'ปิดเสียง'
                : 'Muted'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleManualSyncPnl}
            disabled={isSyncingPnl}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            {isSyncingPnl ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>{lang === 'th' ? 'ซิงค์ยอดเข้า P&L' : 'Sync to P&L'}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-800">
          {errorMsg}
        </div>
      )}
      {publishMessage && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{publishMessage}</span>
        </div>
      )}
      {pnlSyncMessage && (
        <div className="p-3.5 rounded-2xl bg-sky-50 border border-sky-200 text-xs font-bold text-sky-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-sky-600 shrink-0" />
          <span>{pnlSyncMessage}</span>
        </div>
      )}

      {/* Storefront Config + Links + Publish Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
              <Store className="w-4 h-4 text-orange-600" />
              <span>
                {lang === 'th' ? 'ตั้งค่าหน้าร้านออนไลน์ & เผยแพร่เมนู' : 'Storefront Config & Menu Publish'}
              </span>
            </h3>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
              {dishes.length} {lang === 'th' ? 'เมนูพร้อมขาย' : 'dishes'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => setOnlineEnabled((v) => !v)}
              className={`px-3 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-between cursor-pointer ${
                onlineEnabled
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-slate-50 border-slate-200 text-slate-600'
              }`}
            >
              <span>{lang === 'th' ? 'เปิดรับออเดอร์เว็บ' : 'Online Ordering'}</span>
              <span>{onlineEnabled ? 'ON' : 'OFF'}</span>
            </button>
            <button
              type="button"
              onClick={() => setPickupEnabled((v) => !v)}
              className={`px-3 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-between cursor-pointer ${
                pickupEnabled
                  ? 'bg-orange-50 border-orange-300 text-orange-900'
                  : 'bg-slate-50 border-slate-200 text-slate-600'
              }`}
            >
              <span>{lang === 'th' ? 'รับเองที่ร้าน' : 'Self-Pickup'}</span>
              <span>{pickupEnabled ? 'ON' : 'OFF'}</span>
            </button>
            <button
              type="button"
              onClick={() => setDeliveryEnabled((v) => !v)}
              className={`px-3 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-between cursor-pointer ${
                deliveryEnabled
                  ? 'bg-orange-50 border-orange-300 text-orange-900'
                  : 'bg-slate-50 border-slate-200 text-slate-600'
              }`}
            >
              <span>{lang === 'th' ? 'ส่งเดลิเวอรี' : 'Delivery'}</span>
              <span>{deliveryEnabled ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <div className="text-xs font-bold text-slate-700 mb-1">
                {lang === 'th' ? 'ค่าบริการจัดส่ง (บาท)' : 'Delivery Fee (THB)'}
              </div>
              <NumericInput
                value={deliveryFee}
                onValueChange={(val) => setDeliveryFee(val)}
                min={0}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-700 mb-1">
                {lang === 'th' ? 'เวลาทำอาหารโดยประมาณ (นาที)' : 'Est. Prep Time (mins)'}
              </div>
              <NumericInput
                value={prepMinutes}
                onValueChange={(val) => setPrepMinutes(val)}
                min={5}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setPublishDefaultIndex((v) => !v)}
                className={`w-full px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                  publishDefaultIndex
                    ? 'bg-sky-50 border-sky-300 text-sky-900'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                }`}
              >
                {publishDefaultIndex
                  ? lang === 'th'
                    ? 'ตั้งเป็นร้านหลักอัตโนมัติ ✓'
                    : 'Default Store Link ✓'
                  : lang === 'th'
                  ? 'เฉพาะลิงก์ที่มี ?store='
                  : 'Store ID Link Only'}
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="text-[11px] text-slate-500">
              {settings.onlineLastPublishedAt
                ? `${lang === 'th' ? 'เผยแพร่ล่าสุด:' : 'Last published:'} ${new Date(
                    settings.onlineLastPublishedAt
                  ).toLocaleString('th-TH')}`
                : lang === 'th'
                ? 'ยังไม่ได้เผยแพร่เมนูขึ้นเว็บสาธารณะ'
                : 'Not published yet'}
            </div>

            <button
              type="button"
              onClick={handlePublishMenu}
              disabled={isPublishing}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {isPublishing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UploadCloud className="w-4 h-4" />
              )}
              <span>
                {lang === 'th'
                  ? 'บันทึกตั้งค่า & เผยแพร่เมนูขึ้นเว็บลูกค้า'
                  : 'Save & Publish Storefront Menu'}
              </span>
            </button>
          </div>
        </div>

        {/* Shareable Customer & Rider App URLs */}
        <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200 p-5 space-y-3.5">
          <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
            <Bike className="w-4 h-4 text-emerald-600" />
            <span>{lang === 'th' ? 'ลิงก์สั่งอาหารลูกค้า & แอป Rider' : 'Storefront & Rider Links'}</span>
          </h3>

          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-slate-800">
                {lang === 'th' ? '1. ลิงก์สำหรับลูกค้าสั่งอาหาร' : '1. Customer Storefront URL'}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleCopyUrl('customer', customerUrl)}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'customer' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {copiedKey === 'customer'
                      ? lang === 'th'
                        ? 'คัดลอกแล้ว'
                        : 'Copied'
                      : lang === 'th'
                      ? 'คัดลอก'
                      : 'Copy'}
                  </span>
                </button>
                <a
                  href={customerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 rounded-lg bg-orange-600 text-white text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <span>{lang === 'th' ? 'เปิด' : 'Open'}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
            <div className="text-[11px] font-mono text-slate-500 break-all">{customerUrl}</div>
          </div>

          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 space-y-2 text-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-emerald-400">
                {lang === 'th' ? '2. ลิงก์แอป Rider (ติดตั้ง PWA ได้)' : '2. Rider App URL (PWA Ready)'}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleCopyUrl('rider', riderUrl)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'rider' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {copiedKey === 'rider'
                      ? lang === 'th'
                        ? 'คัดลอกแล้ว'
                        : 'Copied'
                      : lang === 'th'
                      ? 'คัดลอก'
                      : 'Copy'}
                  </span>
                </button>
                <a
                  href={riderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <span>{lang === 'th' ? 'เปิด' : 'Open'}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
            <div className="text-[11px] font-mono text-slate-400 break-all">{riderUrl}</div>
          </div>
        </div>
      </div>

      {/* Period & Status Filters + KPI Strip */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'today', th: 'วันนี้', en: 'Today' },
                { id: 'week', th: 'อาทิตย์นี้', en: 'This Week' },
                { id: 'month', th: 'เดือนนี้', en: 'This Month' },
                { id: 'year', th: 'ปีนี้', en: 'This Year' },
                { id: 'all', th: 'ทั้งหมด', en: 'All Time' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriodFilter(p.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                  periodFilter === p.id
                    ? 'bg-orange-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {p[lang]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', th: 'ทุกสถานะ', en: 'All' },
                { id: 'active', th: 'กำลังดำเนินการ', en: 'Active' },
                { id: 'completed', th: 'สำเร็จ', en: 'Completed' },
                { id: 'cancelled', th: 'ยกเลิก', en: 'Cancelled' },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStatusFilter(s.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                  statusFilter === s.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {s[lang]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="text-[11px] font-bold text-slate-500">
              {lang === 'th' ? 'ออเดอร์รอ/กำลังทำ' : 'Active Queue'}
            </div>
            <div className="text-xl font-black text-orange-600 tabular-nums mt-0.5">
              {kpi.activeCount}
            </div>
          </div>
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="text-[11px] font-bold text-slate-500">
              {lang === 'th' ? 'ออเดอร์สำเร็จ (เข้า P&L)' : 'Completed (In P&L)'}
            </div>
            <div className="text-xl font-black text-emerald-600 tabular-nums mt-0.5">
              {kpi.completedCount}
            </div>
          </div>
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="text-[11px] font-bold text-slate-500">
              {lang === 'th' ? 'ยอดขายค่าอาหาร (สำเร็จ)' : 'Completed Food Sales'}
            </div>
            <div className="text-xl font-black text-slate-900 tabular-nums mt-0.5">
              ฿{formatMoney(kpi.foodSalesTotal)}
            </div>
          </div>
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="text-[11px] font-bold text-slate-500">
              {lang === 'th' ? 'ค่าส่งแยกต่างหาก (ไม่ปน GP%)' : 'Delivery Fees (Separated)'}
            </div>
            <div className="text-xl font-black text-sky-700 tabular-nums mt-0.5">
              ฿{formatMoney(kpi.deliveryFeeTotal)}
            </div>
          </div>
        </div>
      </div>

      {/* Orders List */}
      <div className="space-y-3">
        {filteredOrders.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-sm text-slate-500">
            {lang === 'th'
              ? 'ยังไม่มีออเดอร์ออนไลน์ในช่วงเวลาที่เลือก'
              : 'No online orders found for the selected filter.'}
          </div>
        ) : (
          filteredOrders.map((order) => {
            const meta = STATUS_META[order.status] || STATUS_META.pending;
            const created = toDateSafe(order.createdAt);

            return (
              <div
                key={order.id}
                className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-5 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-base text-slate-900">{order.orderNumber}</span>
                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-lg border ${meta.badgeCls}`}>
                      {meta[lang]}
                    </span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 inline-flex items-center gap-1">
                      {order.orderMode === 'delivery' ? (
                        <>
                          <Truck className="w-3.5 h-3.5 text-orange-600" />
                          <span>{lang === 'th' ? 'เดลิเวอรี' : 'Delivery'}</span>
                        </>
                      ) : (
                        <>
                          <Store className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{lang === 'th' ? 'รับที่ร้าน' : 'Pickup'}</span>
                        </>
                      )}
                    </span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 inline-flex items-center gap-1">
                      {order.paymentMethod === 'qr_payment' ? (
                        <>
                          <QrCode className="w-3.5 h-3.5 text-sky-600" />
                          <span>QR</span>
                        </>
                      ) : (
                        <>
                          <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{lang === 'th' ? 'เงินสด' : 'Cash'}</span>
                        </>
                      )}
                    </span>
                    {order.pnlSyncedAt && order.status === 'completed' && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                        ✓ In P&amp;L
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {created
                        ? created.toLocaleString('th-TH', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : ''}
                    </span>
                  </div>
                </div>

                {/* Customer Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                    <div className="font-extrabold text-slate-900 flex items-center justify-between">
                      <span>{order.customerName}</span>
                      <a
                        href={`tel:${order.customerPhone}`}
                        className="text-orange-600 font-bold inline-flex items-center gap-1"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>{order.customerPhone}</span>
                      </a>
                    </div>
                    {order.deliveryAddress && (
                      <div className="text-slate-600 flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
                        <span>{order.deliveryAddress}</span>
                      </div>
                    )}
                    {order.customerNote && (
                      <div className="text-amber-700 font-semibold">* {order.customerNote}</div>
                    )}
                    {order.riderName && (
                      <div className="text-teal-700 font-bold">
                        Rider: {order.riderName}
                      </div>
                    )}
                  </div>

                  {/* Items Summary */}
                  <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                    {order.items.map((it, idx) => (
                      <div key={idx} className="flex justify-between gap-2 text-slate-800">
                        <div>
                          <span className="font-bold">
                            {it.quantity}x {it.dishName}
                          </span>
                          {it.variantName && it.variantName !== 'Standard' && (
                            <span className="text-slate-500"> ({it.variantName})</span>
                          )}
                          {it.options?.length > 0 && (
                            <div className="text-[11px] text-slate-500 pl-3">
                              + {it.options.map((op) => op.choiceName).join(', ')}
                            </div>
                          )}
                          {it.notes && (
                            <div className="text-[11px] text-amber-700 pl-3">* {it.notes}</div>
                          )}
                        </div>
                        <span className="font-bold tabular-nums">
                          ฿{formatMoney(it.unitPrice * it.quantity)}
                        </span>
                      </div>
                    ))}
                    <div className="pt-1.5 mt-1 border-t border-slate-200 flex items-center justify-between font-black text-slate-900">
                      <span>
                        {order.deliveryFee > 0
                          ? `${lang === 'th' ? 'ค่าอาหาร' : 'Food'} ฿${formatMoney(
                              order.subtotal
                            )} + ${lang === 'th' ? 'ค่าส่ง' : 'Delivery'} ฿${formatMoney(
                              order.deliveryFee
                            )}`
                          : lang === 'th'
                          ? 'รวมทั้งสิ้น'
                          : 'Total'}
                      </span>
                      <span className="text-orange-600 text-sm tabular-nums">
                        ฿{formatMoney(order.totalAmount)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {order.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange(order, 'accepted')}
                        className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold cursor-pointer"
                      >
                        {lang === 'th' ? 'รับออเดอร์' : 'Accept'}
                      </button>
                    )}
                    {(order.status === 'pending' || order.status === 'accepted') && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange(order, 'preparing')}
                        className="px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold cursor-pointer"
                      >
                        {lang === 'th' ? 'กำลังปรุง' : 'Preparing'}
                      </button>
                    )}
                    {(order.status === 'accepted' || order.status === 'preparing') && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange(order, 'ready_for_pickup')}
                        className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                      >
                        {order.orderMode === 'delivery'
                          ? lang === 'th'
                            ? 'พร้อมให้ไรเดอร์รับ'
                            : 'Ready for Rider'
                          : lang === 'th'
                          ? 'พร้อมรับหน้าร้าน'
                          : 'Ready for Pickup'}
                      </button>
                    )}
                    {order.orderMode === 'delivery' &&
                      (order.status === 'preparing' || order.status === 'ready_for_pickup') && (
                        <button
                          type="button"
                          onClick={() => handleStatusChange(order, 'out_for_delivery')}
                          className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold cursor-pointer"
                        >
                          {lang === 'th' ? 'กำลังจัดส่ง' : 'Out for Delivery'}
                        </button>
                      )}
                    {order.status !== 'completed' && order.status !== 'cancelled' && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange(order, 'completed')}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                      >
                        {lang === 'th' ? 'เสร็จสมบูรณ์ (เข้า P&L)' : 'Complete (Sync P&L)'}
                      </button>
                    )}
                    {order.status !== 'completed' && order.status !== 'cancelled' && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange(order, 'cancelled')}
                        className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{lang === 'th' ? 'ยกเลิก' : 'Cancel'}</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPrintingOrder(order)}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>{lang === 'th' ? 'พิมพ์ใบเสร็จ' : 'Print Receipt'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTargetOrder(order)}
                      className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 cursor-pointer"
                      title={lang === 'th' ? 'ลบออเดอร์' : 'Delete order'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Thermal Receipt Print Modal using existing #printable-thermal-receipt stylesheet */}
      {printingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col border border-orange-200 overflow-hidden">
            <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                <h3 className="font-extrabold text-base">
                  {lang === 'th' ? 'ใบเสร็จออเดอร์ออนไลน์' : 'Online Order Receipt'} -{' '}
                  {printingOrder.orderNumber}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPrintingOrder(null)}
                className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-100 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-300">
                <button
                  type="button"
                  onClick={() => setPaperWidth('80mm')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                    paperWidth === '80mm' ? 'bg-orange-500 text-white' : 'text-slate-600'
                  }`}
                >
                  80mm
                </button>
                <button
                  type="button"
                  onClick={() => setPaperWidth('58mm')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                    paperWidth === '58mm' ? 'bg-orange-500 text-white' : 'text-slate-600'
                  }`}
                >
                  58mm
                </button>
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>{lang === 'th' ? 'พิมพ์ใบเสร็จ' : 'Print'}</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-slate-200/70 flex justify-center">
              <div
                id="printable-thermal-receipt"
                className={`bg-white p-4 text-neutral-900 font-mono text-xs border border-neutral-300 rounded-lg leading-relaxed ${
                  paperWidth === '80mm' ? 'w-[320px]' : 'w-[250px]'
                }`}
              >
                <div className="text-center pb-3 border-b border-dashed border-neutral-400">
                  <h2 className="text-sm font-bold">{settings.shopName}</h2>
                  {settings.shopAddress && <p className="text-[10px]">{settings.shopAddress}</p>}
                  {settings.shopPhone && <p className="text-[10px]">Tel: {settings.shopPhone}</p>}
                  <p className="text-[10px] font-bold mt-1">
                    *** ONLINE {printingOrder.orderMode === 'delivery' ? 'DELIVERY' : 'PICKUP'} ***
                  </p>
                </div>

                <div className="py-2 border-b border-dashed border-neutral-400 text-[11px] space-y-0.5">
                  <div className="flex justify-between">
                    <span>Order #:</span>
                    <span className="font-bold">{printingOrder.orderNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Customer:</span>
                    <span className="font-bold">{printingOrder.customerName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Phone:</span>
                    <span>{printingOrder.customerPhone}</span>
                  </div>
                  {printingOrder.deliveryAddress && (
                    <div className="text-[10px] pt-0.5">
                      <span>Address: {printingOrder.deliveryAddress}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Payment:</span>
                    <span>{printingOrder.paymentMethod === 'qr_payment' ? 'QR PromptPay' : 'Cash'}</span>
                  </div>
                </div>

                <div className="py-2.5 border-b border-dashed border-neutral-400 space-y-1.5 text-[11px]">
                  {printingOrder.items.map((item, idx) => (
                    <div key={idx}>
                      <div className="flex justify-between font-medium">
                        <span className="pr-2">
                          {item.quantity}x {item.dishName}
                          {item.variantName && item.variantName !== 'Standard'
                            ? ` (${item.variantName})`
                            : ''}
                        </span>
                        <span className="font-bold tabular-nums">
                          {formatMoney(item.unitPrice * item.quantity)}
                        </span>
                      </div>
                      {item.options?.map((opt, oi) => (
                        <div key={oi} className="pl-3 text-[10px] text-neutral-600">
                          + {opt.choiceName}
                        </div>
                      ))}
                      {item.notes && (
                        <div className="pl-3 text-[10px] italic">* {item.notes}</div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="py-2 text-[11px] space-y-1">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>{formatMoney(printingOrder.subtotal)}</span>
                  </div>
                  {printingOrder.deliveryFee > 0 && (
                    <div className="flex justify-between">
                      <span>Delivery Fee:</span>
                      <span>{formatMoney(printingOrder.deliveryFee)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold pt-1 border-t border-neutral-400">
                    <span>TOTAL:</span>
                    <span>฿{formatMoney(printingOrder.totalAmount)}</span>
                  </div>
                </div>

                <div className="pt-2 text-center text-[10px] text-neutral-500">
                  {settings.receiptFooter || 'Thank you!'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteTargetOrder && (
        <ConfirmModal
          isOpen={true}
          title={lang === 'th' ? 'ลบออเดอร์ออนไลน์' : 'Delete Online Order'}
          message={
            lang === 'th'
              ? `ยืนยันลบออเดอร์ ${deleteTargetOrder.orderNumber}? หากออเดอร์นี้เคยซิงค์เข้า P&L ระบบจะปรับปรุงยอด P&L ให้อัตโนมัติ`
              : `Delete order ${deleteTargetOrder.orderNumber}? Completed order totals in P&L will be updated automatically.`
          }
          confirmLabel={lang === 'th' ? 'ลบถาวร' : 'Delete'}
          cancelLabel={lang === 'th' ? 'ยกเลิก' : 'Cancel'}
          variant="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTargetOrder(null)}
        />
      )}
    </div>
  );
};
