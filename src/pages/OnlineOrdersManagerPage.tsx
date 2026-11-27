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
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Bike,
  X,
  Menu,
  Search,
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
  User,
  Store,
  Upload,
  RotateCcw,
  Image as ImageIcon,
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
import { getImageDoc, saveImageDoc, subscribeCollection, updateSettings } from '../data/db';
import { compressImage } from '../utils/imageCompressor';
import {
  deleteOnlineOrderByOwner,
  publishMenuToPublicStore,
  subscribeOwnerOnlineOrders,
  syncCompletedOnlineOrdersToPnl,
  updateOnlineOrderByOwner,
} from '../data/onlineDb';
import { formatMoney } from '../engine/calculations';
import {
  buildOnlineOrderNumberingMap,
  isOnlineOrderInLocalPeriod,
  matchesOnlineManagerStatusFilter,
  matchesOnlineOrderSearch,
  OnlineManagerStatusFilter,
  OnlinePeriodFilter,
  playIncomingOrderChime,
} from '../engine/onlineOrdering';
import {
  ONLINE_STATUS_META,
  OnlineOrderDetailModal,
  OnlineOrderReceiptModal,
} from '../components/OnlineOrderModals';
import { NumericInput } from '../costing/components/common/NumericInput';
import { ConfirmModal } from '../components/ConfirmModal';
import { MenuItem as CostMenuItem } from '../costing/types';
import { COST_COLLECTIONS } from '../costing/services/firebaseSyncService';
import { StorageService } from '../costing/services/storageService';

interface Props {
  user: FirebaseUser;
  settings: SettingsDoc;
  lang: Language;
  externalOrders?: OnlineOrderDoc[];
  soundEnabled?: boolean;
  onToggleSound?: () => void;
  onSettingsUpdated: (newSettings: SettingsDoc) => void;
}

export const OnlineOrdersManagerPage: React.FC<Props> = ({
  user,
  settings,
  lang,
  externalOrders,
  soundEnabled: propSoundEnabled,
  onToggleSound,
  onSettingsUpdated,
}) => {
  const [localOrders, setLocalOrders] = useState<OnlineOrderDoc[]>([]);
  const [dishes, setDishes] = useState<DishDoc[]>([]);
  const [categories, setCategories] = useState<CategoryDoc[]>([]);
  const [optionGroups, setOptionGroups] = useState<OptionGroupDoc[]>([]);
  const [ingredients, setIngredients] = useState<IngredientDoc[]>([]);
  const [subRecipes, setSubRecipes] = useState<SubRecipeDoc[]>([]);
  const [packaging, setPackaging] = useState<PackagingDoc[]>([]);
  const [costMenus, setCostMenus] = useState<CostMenuItem[]>(() => StorageService.getMenus());

  const [periodFilter, setPeriodFilter] = useState<OnlinePeriodFilter>('today');
  const [statusFilter, setStatusFilter] = useState<OnlineManagerStatusFilter>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [localSoundEnabled, setLocalSoundEnabled] = useState(true);
  const soundEnabled = propSoundEnabled ?? localSoundEnabled;
  const orders = externalOrders ?? localOrders;

  const [isLinksMenuOpen, setIsLinksMenuOpen] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const [onlineEnabled, setOnlineEnabled] = useState(settings.onlineOrderingEnabled !== false);
  const [pickupEnabled, setPickupEnabled] = useState(settings.onlinePickupEnabled !== false);
  const [deliveryEnabled, setDeliveryEnabled] = useState(settings.onlineDeliveryEnabled !== false);
  const [deliveryFee, setDeliveryFee] = useState<number>(settings.onlineDeliveryFee ?? 30);
  const [prepMinutes, setPrepMinutes] = useState<number>(settings.onlineEstimatedPrepMinutes ?? 20);
  const [publishDefaultIndex, setPublishDefaultIndex] = useState(
    settings.onlinePublishDefaultIndex !== false
  );
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [isUpdatingLogo, setIsUpdatingLogo] = useState(false);

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [isSyncingPnl, setIsSyncingPnl] = useState(false);
  const [pnlSyncMessage, setPnlSyncMessage] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<'customer' | 'rider' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [printingOrder, setPrintingOrder] = useState<OnlineOrderDoc | null>(null);
  const [printingOrderAutoPrint, setPrintingOrderAutoPrint] = useState(false);
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

    let cancelled = false;
    if (settings.logoImageId) {
      getImageDoc(settings.logoImageId)
        .then((img) => {
          if (!cancelled) setLogoDataUrl(img?.dataUrl || null);
        })
        .catch(() => {});
    } else {
      setLogoDataUrl(null);
    }
    return () => {
      cancelled = true;
    };
  }, [settings]);

  useEffect(() => {
    const unsubs = [
      subscribeCollection<DishDoc>('dishes', setDishes),
      subscribeCollection<CategoryDoc>('categories', setCategories),
      subscribeCollection<OptionGroupDoc>('optionGroups', setOptionGroups),
      subscribeCollection<IngredientDoc>('ingredients', setIngredients),
      subscribeCollection<SubRecipeDoc>('subRecipes', setSubRecipes),
      subscribeCollection<PackagingDoc>('packaging', setPackaging),
      subscribeCollection<CostMenuItem>(COST_COLLECTIONS.MENUS, (cloudMenus) => {
        if (cloudMenus.length > 0) {
          setCostMenus([...cloudMenus].sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99)));
        }
      }),
      ...(externalOrders === undefined
        ? [
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
                setLocalOrders(list);
              },
              (err) => {
                setErrorMsg(err.message);
              }
            ),
          ]
        : []),
    ];

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [user.uid, soundEnabled, externalOrders === undefined]);

  // Close overlays smoothly with Escape
  useEffect(() => {
    if (!isLinksMenuOpen && !selectedOrderId && !printingOrder) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (printingOrder) setPrintingOrder(null);
        else if (selectedOrderId) setSelectedOrderId(null);
        else if (isLinksMenuOpen) setIsLinksMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLinksMenuOpen, selectedOrderId, printingOrder]);

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
  const riderUrl = `${baseUrl}/rider.html?store=${user.uid}`;

  const orderNumberingMap = useMemo(() => buildOnlineOrderNumberingMap(orders), [orders]);

  const selectedOrder = useMemo(
    () => (selectedOrderId ? orders.find((o) => o.id === selectedOrderId) || null : null),
    [orders, selectedOrderId]
  );

  const handleCopyUrl = async (type: 'customer' | 'rider', url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(type);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Fallback ignored
    }
  };

  const handleStoreLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsUpdatingLogo(true);
    setErrorMsg(null);
    setPublishMessage(null);
    try {
      const { dataUrl, sizeBytes } = await compressImage(file);
      const imgId = `logo_${Date.now()}`;
      await saveImageDoc(imgId, dataUrl, sizeBytes);

      const nextVersion = settings.version + 1;
      const nowIso = new Date().toISOString();
      await updateSettings({ logoImageId: imgId }, settings.version);
      setLogoDataUrl(dataUrl);
      onSettingsUpdated({
        ...settings,
        logoImageId: imgId,
        version: nextVersion,
        updatedAt: nowIso,
      });
      setPublishMessage(
        lang === 'th'
          ? 'อัปโหลดและเปลี่ยนโลโก้หน้าร้านเรียบร้อยแล้ว'
          : 'Storefront logo updated successfully.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUpdatingLogo(false);
    }
  };

  const handleResetStoreLogo = async () => {
    setIsUpdatingLogo(true);
    setErrorMsg(null);
    setPublishMessage(null);
    try {
      const nextVersion = settings.version + 1;
      const nowIso = new Date().toISOString();
      await updateSettings({ logoImageId: '' }, settings.version);
      setLogoDataUrl(null);
      onSettingsUpdated({
        ...settings,
        logoImageId: '',
        version: nextVersion,
        updatedAt: nowIso,
      });
      setPublishMessage(
        lang === 'th'
          ? 'เปลี่ยนกลับเป็นโลโก้เริ่มต้นเรียบร้อยแล้ว'
          : 'Reverted to default storefront logo.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUpdatingLogo(false);
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
        costMenus,
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
          ? `เผยแพร่เมนูขึ้นเว็บสำเร็จ (${pubRes.dishCount} เมนู · รูปภาพ ${pubRes.imageCount} รูป · ซ่อนต้นทุน 100%)`
          : `Published storefront (${pubRes.dishCount} dishes · ${pubRes.imageCount} photos · zero cost exposed)`
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
          ? `ซิงค์ยอดออเดอร์ออนไลน์ที่สำเร็จแล้วเข้า P&L เรียบร้อย (${res.syncedRecords} แฟ้มวัน/ช่องทาง)`
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
      await updateOnlineOrderByOwner(
        order.id,
        nextStatus,
        nextStatus === 'cancelled' ? { cancelReason: 'ร้านค้ายกเลิกออเดอร์' } : undefined
      );
      const updatedOrders = orders.map((o) =>
        o.id === order.id
          ? {
              ...o,
              status: nextStatus,
              ...(nextStatus === 'completed' ? { completedAt: new Date().toISOString() } : {}),
            }
          : o
      );
      if (order.status === 'pending' && nextStatus === 'accepted') {
        setPrintingOrderAutoPrint(true);
        setPrintingOrder({ ...order, status: 'accepted' });
      }
      if (
        selectedOrderId === order.id &&
        (nextStatus === 'ready_for_pickup' ||
          nextStatus === 'completed' ||
          nextStatus === 'cancelled')
      ) {
        setSelectedOrderId(null);
      }
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
    if (selectedOrderId === target.id) setSelectedOrderId(null);
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
      if (!matchesOnlineManagerStatusFilter(o, statusFilter)) {
        return false;
      }
      if (searchQuery.trim()) {
        return matchesOnlineOrderSearch(o, orderNumberingMap.get(o.id), searchQuery);
      }
      return true;
    });
  }, [periodOrders, statusFilter, searchQuery, orderNumberingMap]);

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

  const selectedOrderIds = selectedOrder ? orderNumberingMap.get(selectedOrder.id) : undefined;
  const printingOrderIds = printingOrder ? orderNumberingMap.get(printingOrder.id) : undefined;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Clean Modern Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            <ShoppingBag className="w-6 h-6 text-orange-600 shrink-0" />
            <span className="truncate">
              {lang === 'th' ? 'ออเดอร์ออนไลน์ & Rider' : 'Online Orders & Rider'}
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {lang === 'th'
              ? 'จัดการคิวออเดอร์จากเว็บลูกค้า ส่งงานไรเดอร์ และซิงค์ยอดขายเข้า P&L อัตโนมัติ'
              : 'Manage incoming customer web orders, dispatch riders, and sync completed sales to P&L.'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => (onToggleSound ? onToggleSound() : setLocalSoundEnabled((s) => !s))}
            className={`px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              soundEnabled
                ? 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50'
                : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-400" />
            )}
            <span>
              {soundEnabled
                ? lang === 'th'
                  ? 'เสียงแจ้งเตือน'
                  : 'Sound On'
                : lang === 'th'
                ? 'ปิดเสียง'
                : 'Muted'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleManualSyncPnl}
            disabled={isSyncingPnl}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 transition-colors"
          >
            {isSyncingPnl ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>{lang === 'th' ? 'ซิงค์ยอดเข้า P&L' : 'Sync to P&L'}</span>
          </button>

          {/* Hamburger Menu Button for Customer & Rider Links */}
          <button
            type="button"
            onClick={() => setIsLinksMenuOpen(true)}
            aria-label={lang === 'th' ? 'เปิดเมนูลิงก์ลูกค้าและ Rider' : 'Open Storefront & Rider Links Menu'}
            title={lang === 'th' ? 'ลิงก์สั่งอาหารลูกค้า & แอป Rider' : 'Customer & Rider Links'}
            className="w-10 h-10 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800">
          {errorMsg}
        </div>
      )}
      {publishMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{publishMessage}</span>
        </div>
      )}
      {pnlSyncMessage && (
        <div className="p-3.5 rounded-xl bg-sky-50 border border-sky-200 text-xs font-semibold text-sky-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-sky-600 shrink-0" />
          <span>{pnlSyncMessage}</span>
        </div>
      )}

      {/* Compact Storefront Publish & Collapsible Settings Bar */}
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-100 text-orange-600 flex items-center justify-center shrink-0">
              <Store className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>{lang === 'th' ? 'หน้าร้านออนไลน์' : 'Online Storefront'}</span>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span className={onlineEnabled ? 'text-emerald-700 font-semibold text-xs' : 'text-slate-500 font-semibold text-xs'}>
                  {onlineEnabled
                    ? lang === 'th'
                      ? 'เปิดรับออเดอร์'
                      : 'Open'
                    : lang === 'th'
                    ? 'ปิดรับชั่วคราว'
                    : 'Closed'}
                </span>
              </div>
              <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 tabular-nums">
                <span>
                  {dishes.length} {lang === 'th' ? 'เมนู' : 'dishes'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {deliveryEnabled
                    ? `${lang === 'th' ? 'ค่าส่ง' : 'Delivery'} ฿${formatMoney(deliveryFee)}`
                    : lang === 'th'
                    ? 'ปิดเดลิเวอรี'
                    : 'No delivery'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {lang === 'th' ? `ทำอาหาร ~${prepMinutes} นาที` : `Prep ~${prepMinutes}m`}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsConfigOpen((v) => !v)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{lang === 'th' ? 'ตั้งค่าหน้าร้าน' : 'Settings'}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${isConfigOpen ? 'rotate-180' : ''}`}
              />
            </button>

            <button
              type="button"
              onClick={handlePublishMenu}
              disabled={isPublishing}
              className="px-4 py-2 rounded-xl bg-orange-600 bg-gradient-to-r from-orange-500 to-red-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              {isPublishing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UploadCloud className="w-4 h-4" />
              )}
              <span>
                {lang === 'th' ? 'เผยแพร่เมนูขึ้นเว็บ' : 'Publish Menu'}
              </span>
            </button>
          </div>
        </div>

        {isConfigOpen && (
          <div className="px-4 pb-4 pt-3 border-t border-slate-200 bg-slate-50/70 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setOnlineEnabled((v) => !v)}
                className={`px-3.5 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-between cursor-pointer transition-colors ${
                  onlineEnabled
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-white border-slate-200 text-slate-600'
                }`}
              >
                <span>{lang === 'th' ? 'เปิดรับออเดอร์เว็บ' : 'Online Ordering'}</span>
                <span>{onlineEnabled ? 'ON' : 'OFF'}</span>
              </button>
              <button
                type="button"
                onClick={() => setPickupEnabled((v) => !v)}
                className={`px-3.5 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-between cursor-pointer transition-colors ${
                  pickupEnabled
                    ? 'bg-orange-50 border-orange-200 text-orange-900'
                    : 'bg-white border-slate-200 text-slate-600'
                }`}
              >
                <span>{lang === 'th' ? 'รับเองที่ร้าน' : 'Self-Pickup'}</span>
                <span>{pickupEnabled ? 'ON' : 'OFF'}</span>
              </button>
              <button
                type="button"
                onClick={() => setDeliveryEnabled((v) => !v)}
                className={`px-3.5 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-between cursor-pointer transition-colors ${
                  deliveryEnabled
                    ? 'bg-orange-50 border-orange-200 text-orange-900'
                    : 'bg-white border-slate-200 text-slate-600'
                }`}
              >
                <span>{lang === 'th' ? 'ส่งเดลิเวอรี' : 'Delivery'}</span>
                <span>{deliveryEnabled ? 'ON' : 'OFF'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">
                  {lang === 'th' ? 'ค่าบริการจัดส่ง (บาท)' : 'Delivery Fee (THB)'}
                </div>
                <NumericInput
                  value={deliveryFee}
                  onValueChange={(val) => setDeliveryFee(val)}
                  min={0}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">
                  {lang === 'th' ? 'เวลาทำอาหารโดยประมาณ (นาที)' : 'Est. Prep Time (mins)'}
                </div>
                <NumericInput
                  value={prepMinutes}
                  onValueChange={(val) => setPrepMinutes(val)}
                  min={5}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setPublishDefaultIndex((v) => !v)}
                  className={`w-full px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                    publishDefaultIndex
                      ? 'bg-sky-50 border-sky-200 text-sky-900'
                      : 'bg-white border-slate-200 text-slate-600'
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

            {/* Storefront Logo Control */}
            <div className="p-3 bg-white rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-full bg-white border border-orange-200 overflow-hidden flex items-center justify-center shrink-0">
                  <img
                    src={logoDataUrl || './assets/aistudio/Logo-Ex_a8e2a318.png'}
                    alt={lang === 'th' ? 'โลโก้หน้าร้าน' : 'Store Logo'}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                    <span>{lang === 'th' ? 'โลโก้หน้าร้านออนไลน์' : 'Storefront Logo'}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {settings.logoImageId
                      ? lang === 'th'
                        ? 'กำลังใช้โลโก้ที่อัปโหลดเอง'
                        : 'Using custom uploaded logo'
                      : lang === 'th'
                      ? 'กำลังใช้โลโก้เริ่มต้นของร้าน'
                      : 'Using default store logo'}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <label
                  className={`px-3 py-1.5 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-800 text-xs font-bold inline-flex items-center gap-1.5 ${
                    isUpdatingLogo ? 'opacity-60 pointer-events-none' : 'cursor-pointer'
                  }`}
                >
                  {isUpdatingLogo ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {settings.logoImageId
                      ? lang === 'th'
                        ? 'เปลี่ยนโลโก้'
                        : 'Change Logo'
                      : lang === 'th'
                      ? 'อัปโหลดโลโก้'
                      : 'Upload Logo'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={isUpdatingLogo}
                    onChange={handleStoreLogoUpload}
                    className="hidden"
                  />
                </label>

                {settings.logoImageId && (
                  <button
                    type="button"
                    disabled={isUpdatingLogo}
                    onClick={handleResetStoreLogo}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{lang === 'th' ? 'ใช้โลโก้เริ่มต้น' : 'Reset'}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="text-[11px] text-slate-500">
              {settings.onlineLastPublishedAt
                ? `${lang === 'th' ? 'เผยแพร่ล่าสุด:' : 'Last published:'} ${new Date(
                    settings.onlineLastPublishedAt
                  ).toLocaleString('th-TH')}`
                : lang === 'th'
                ? 'ยังไม่ได้เผยแพร่เมนูขึ้นเว็บสาธารณะ'
                : 'Not published yet'}
            </div>
          </div>
        )}
      </section>

      {/* Unified KPI Strip + Search & Filter Bar (Single-Elevation Surface) */}
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          <div className="px-4 py-3.5">
            <div className="text-xs font-medium text-slate-500">
              {lang === 'th' ? 'ออเดอร์รอ / กำลังทำ' : 'Active Queue'}
            </div>
            <div className="text-2xl font-bold text-orange-600 tabular-nums mt-0.5">
              {kpi.activeCount}
            </div>
          </div>
          <div className="px-4 py-3.5">
            <div className="text-xs font-medium text-slate-500">
              {lang === 'th' ? 'ออเดอร์สำเร็จ (เข้า P&L)' : 'Completed (In P&L)'}
            </div>
            <div className="text-2xl font-bold text-emerald-600 tabular-nums mt-0.5">
              {kpi.completedCount}
            </div>
          </div>
          <div className="px-4 py-3.5">
            <div className="text-xs font-medium text-slate-500">
              {lang === 'th' ? 'ยอดขายค่าอาหาร (สำเร็จ)' : 'Completed Food Sales'}
            </div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">
              ฿{formatMoney(kpi.foodSalesTotal)}
            </div>
          </div>
          <div className="px-4 py-3.5">
            <div className="text-xs font-medium text-slate-500">
              {lang === 'th' ? 'ค่าส่งแยกต่างหาก (ไม่ปน GP%)' : 'Delivery Fees (Separated)'}
            </div>
            <div className="text-2xl font-bold text-sky-700 tabular-nums mt-0.5">
              ฿{formatMoney(kpi.deliveryFeeTotal)}
            </div>
          </div>
        </div>

        {/* Search + Segmented Period & Status Filters */}
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/60 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  lang === 'th'
                    ? 'ค้นหา TK-001, เลขอ้างอิง 261126-001, ชื่อ, เบอร์โทร...'
                    : 'Search TK-001, ref 261126-001, customer, phone...'
                }
                className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-orange-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label={lang === 'th' ? 'ล้างคำค้นหา' : 'Clear search'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl">
                {(
                  [
                    { id: 'all', th: 'ทั้งหมด', en: 'All' },
                    { id: 'active', th: 'กำลังทำ', en: 'Active' },
                    { id: 'delivering', th: 'กำลังจัดส่ง', en: 'Delivering' },
                    { id: 'completed', th: 'สำเร็จ', en: 'Done' },
                    { id: 'cancelled', th: 'ยกเลิก', en: 'Cancelled' },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStatusFilter(s.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                      statusFilter === s.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {s[lang]}
                  </button>
                ))}
              </div>

              <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl">
                {(
                  [
                    { id: 'today', th: 'วันนี้', en: 'Today' },
                    { id: 'week', th: 'อาทิตย์นี้', en: 'Week' },
                    { id: 'month', th: 'เดือนนี้', en: 'Month' },
                    { id: 'year', th: 'ปีนี้', en: 'Year' },
                    { id: 'all', th: 'ทั้งหมด', en: 'All' },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPeriodFilter(p.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                      periodFilter === p.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {p[lang]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Streamlined Compact Order Cards (Card #, Ref #, Customer Name, View Items CTA Only) */}
      <section>
        {filteredOrders.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-2">
            <ShoppingBag className="w-8 h-8 text-slate-300 mx-auto" />
            <div className="text-sm font-semibold text-slate-700">
              {searchQuery.trim()
                ? lang === 'th'
                  ? 'ไม่พบออเดอร์ที่ตรงกับคำค้นหา'
                  : 'No orders match your search'
                : lang === 'th'
                ? 'ยังไม่มีออเดอร์ออนไลน์ในช่วงเวลาที่เลือก'
                : 'No online orders found for the selected period'}
            </div>
            <p className="text-xs text-slate-400">
              {lang === 'th'
                ? 'เมื่อลูกค้าสั่งอาหารเข้ามา การ์ดออเดอร์จะแสดงที่นี่แบบเรียลไทม์'
                : 'New customer web orders will appear here in real time.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredOrders.map((order) => {
              const displayIds = orderNumberingMap.get(order.id);
              const statusMeta = ONLINE_STATUS_META[order.status] || ONLINE_STATUS_META.pending;

              return (
                <div
                  key={order.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedOrderId(order.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedOrderId(order.id);
                    }
                  }}
                  className="bg-white rounded-2xl border border-slate-200 hover:border-orange-300 p-3.5 transition-colors cursor-pointer flex items-center justify-between gap-3 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-orange-500"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xl font-black tracking-tight text-slate-900 uppercase tabular-nums leading-none">
                        {displayIds?.displayNumber || order.orderNumber}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border-2 text-xs font-black shadow-2xs ${statusMeta.surfaceCls}`}
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${statusMeta.dotCls}`} />
                        <span>{statusMeta[lang]}</span>
                      </span>
                    </div>
                    <div className="text-[11px] font-mono font-medium text-slate-500 tabular-nums">
                      {lang === 'th' ? 'เลขอ้างอิง:' : 'Ref:'}{' '}
                      <span className="text-slate-700 font-semibold">
                        {displayIds?.referenceNumber || order.orderNumber}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 pt-0.5 min-w-0">
                      <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{order.customerName}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedOrderId(order.id);
                    }}
                    className="px-3 py-2 rounded-xl bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 text-xs font-extrabold whitespace-nowrap shrink-0 inline-flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <span>{lang === 'th' ? 'ดูรายการอาหาร' : 'View Items'}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Hamburger Slide-Over Drawer: Customer & Rider App URLs */}
      {isLinksMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-xs"
          onClick={() => setIsLinksMenuOpen(false)}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md h-full bg-white border-l border-slate-200 shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Bike className="w-5 h-5 text-emerald-600 shrink-0" />
                <h3 className="font-bold text-base text-slate-900 truncate">
                  {lang === 'th' ? 'ลิงก์สั่งอาหารลูกค้า & แอป Rider' : 'Customer & Rider Links'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsLinksMenuOpen(false)}
                aria-label={lang === 'th' ? 'ปิดเมนู' : 'Close menu'}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900">
                    {lang === 'th' ? '1. ลิงก์สำหรับลูกค้าสั่งอาหาร' : '1. Customer Storefront URL'}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopyUrl('customer', customerUrl)}
                      className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
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
                      className="px-2.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-[11px] font-semibold inline-flex items-center gap-1"
                    >
                      <span>{lang === 'th' ? 'เปิด' : 'Open'}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
                <div className="text-[11px] font-mono text-slate-500 break-all select-all">
                  {customerUrl}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2.5 text-slate-100">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-emerald-400">
                    {lang === 'th' ? '2. ลิงก์แอป Rider (ติดตั้ง PWA ได้)' : '2. Rider App URL (PWA Ready)'}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopyUrl('rider', riderUrl)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
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
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-bold inline-flex items-center gap-1"
                    >
                      <span>{lang === 'th' ? 'เปิด' : 'Open'}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
                <div className="text-[11px] font-mono text-slate-400 break-all select-all">
                  {riderUrl}
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Order Detail Modal (Reveals Items List + Print Receipt + Full Controls) */}
      {selectedOrder && (
        <OnlineOrderDetailModal
          order={selectedOrder}
          displayIds={selectedOrderIds}
          lang={lang}
          onClose={() => setSelectedOrderId(null)}
          onStatusChange={handleStatusChange}
          onPrint={(ord) => {
            setPrintingOrderAutoPrint(false);
            setPrintingOrder(ord);
          }}
          onDelete={(ord) => setDeleteTargetOrder(ord)}
        />
      )}

      {/* Thermal Receipt Print Modal using existing #printable-thermal-receipt stylesheet */}
      {printingOrder && (
        <OnlineOrderReceiptModal
          order={printingOrder}
          displayIds={printingOrderIds}
          settings={settings}
          lang={lang}
          autoPrint={printingOrderAutoPrint}
          silentAutoPrint={printingOrderAutoPrint}
          onClose={() => {
            setPrintingOrder(null);
            setPrintingOrderAutoPrint(false);
          }}
        />
      )}

      {deleteTargetOrder && (
        <ConfirmModal
          isOpen={true}
          title={lang === 'th' ? 'ลบออเดอร์ออนไลน์' : 'Delete Online Order'}
          message={
            lang === 'th'
              ? `ยืนยันลบออเดอร์ ${
                  orderNumberingMap.get(deleteTargetOrder.id)?.displayNumber ||
                  deleteTargetOrder.orderNumber
                } (${
                  orderNumberingMap.get(deleteTargetOrder.id)?.referenceNumber ||
                  deleteTargetOrder.orderNumber
                })? หากออเดอร์นี้เคยซิงค์เข้า P&L ระบบจะปรับปรุงยอด P&L ให้อัตโนมัติ`
              : `Delete order ${
                  orderNumberingMap.get(deleteTargetOrder.id)?.displayNumber ||
                  deleteTargetOrder.orderNumber
                }? Completed order totals in P&L will be updated automatically.`
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
