import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ShoppingBag,
  Plus,
  Minus,
  Trash2,
  MapPin,
  Store,
  Truck,
  QrCode,
  Banknote,
  Clock,
  CheckCircle2,
  X,
  Search,
  ChevronRight,
  AlertCircle,
  Loader2,
  Phone,
  LocateFixed,
  Receipt,
  Ban,
} from 'lucide-react';
import {
  Language,
  OnlineOrderDoc,
  OnlineOrderItem,
  OnlineOrderItemOption,
  OnlineOrderMode,
  OnlinePaymentMethod,
  PublicDish,
  PublicDishVariant,
  PublicOptionGroup,
  PublicStoreDoc,
} from '../types';
import {
  cancelOnlineOrderByCustomer,
  createOnlineOrder,
  fetchPublicStoreImage,
  loadSavedCustomerInfo,
  loadTrackedCustomerOrderIds,
  resolveCustomerOrRiderSession,
  resolvePublicStoreId,
  saveCustomerInfo,
  subscribeCustomerOrders,
  subscribeGuestOrdersByIds,
  subscribePublicStore,
} from '../data/onlineDb';
import { formatMoney } from '../engine/calculations';
import { toDateSafe } from '../engine/onlineOrdering';
import { getLocalizedText } from '../utils/thaiToEnglish';
import { useLanguage } from '../contexts/LanguageContext';

interface CartEntry {
  key: string;
  dishId: string;
  dishName: string;
  variantId: string;
  variantName: string;
  unitPrice: number;
  quantity: number;
  notes?: string;
  options: OnlineOrderItemOption[];
}

interface Props {
  lang?: Language;
  onToggleLang?: () => void;
}

const STATUS_BADGE: Record<
  OnlineOrderDoc['status'],
  { th: string; en: string; color: string }
> = {
  pending: { th: 'รอร้านยืนยัน', en: 'Pending', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  accepted: { th: 'ร้านรับออเดอร์แล้ว', en: 'Accepted', color: 'bg-sky-100 text-sky-800 border-sky-200' },
  preparing: { th: 'กำลังปรุงอาหาร', en: 'Preparing', color: 'bg-orange-100 text-orange-800 border-orange-200' },
  ready_for_pickup: { th: 'อาหารพร้อมแล้ว', en: 'Ready', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  out_for_delivery: { th: 'ไรเดอร์กำลังไปส่ง', en: 'Out for Delivery', color: 'bg-teal-100 text-teal-800 border-teal-200' },
  completed: { th: 'เสร็จสมบูรณ์', en: 'Completed', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  cancelled: { th: 'ยกเลิกแล้ว', en: 'Cancelled', color: 'bg-rose-100 text-rose-800 border-rose-200' },
};

export const CustomerOrderPage: React.FC<Props> = ({ lang: propLang, onToggleLang }) => {
  const { lang: ctxLang, toggleLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const [storeId, setStoreId] = useState<string | null>(null);
  const [store, setStore] = useState<PublicStoreDoc | null>(null);
  const [customerUid, setCustomerUid] = useState<string | null>(null);
  const [isAuthCustomer, setIsAuthCustomer] = useState(false);
  const [trackedOrderIds, setTrackedOrderIds] = useState<string[]>([]);
  const [authOrders, setAuthOrders] = useState<OnlineOrderDoc[]>([]);
  const [localOrders, setLocalOrders] = useState<OnlineOrderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dishImages, setDishImages] = useState<Record<string, string>>({});
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Dish customization modal
  const [activeDish, setActiveDish] = useState<PublicDish | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<PublicDishVariant | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>({});
  const [itemNote, setItemNote] = useState('');
  const [itemQty, setItemQty] = useState(1);
  const [optionValidationMsg, setOptionValidationMsg] = useState<string | null>(null);

  // Cart & Checkout
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isOrdersOpen, setIsOrdersOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [locatingGps, setLocatingGps] = useState(false);
  const [cancelConfirmOrderId, setCancelConfirmOrderId] = useState<string | null>(null);

  const savedProfile = useMemo(() => loadSavedCustomerInfo(), []);
  const [customerName, setCustomerName] = useState(savedProfile.customerName);
  const [customerPhone, setCustomerPhone] = useState(savedProfile.customerPhone);
  const [deliveryAddress, setDeliveryAddress] = useState(savedProfile.deliveryAddress);
  const [customerNote, setCustomerNote] = useState(savedProfile.customerNote);
  const [orderMode, setOrderMode] = useState<OnlineOrderMode>(savedProfile.orderMode);
  const [paymentMethod, setPaymentMethod] = useState<OnlinePaymentMethod>(savedProfile.paymentMethod);
  const [deliveryLat, setDeliveryLat] = useState<number | null>(savedProfile.deliveryLat ?? null);
  const [deliveryLng, setDeliveryLng] = useState<number | null>(savedProfile.deliveryLng ?? null);

  const loadedImageIdsRef = useRef<Set<string>>(new Set());

  const handleSwitchLang = () => {
    if (onToggleLang) {
      onToggleLang();
    } else {
      toggleLang();
    }
  };

  useEffect(() => {
    let mounted = true;
    let unsubStore: (() => void) | null = null;

    const boot = async () => {
      try {
        const resolvedStoreId = await resolvePublicStoreId(window.location.search);
        if (!mounted) return;
        setStoreId(resolvedStoreId);
        setTrackedOrderIds(loadTrackedCustomerOrderIds(resolvedStoreId));

        if (resolvedStoreId) {
          unsubStore = subscribePublicStore(
            resolvedStoreId,
            (loadedStore) => {
              if (!mounted) return;
              setStore(loadedStore);
              setLoading(false);
              if (loadedStore) {
                if (loadedStore.onlinePickupEnabled === false && loadedStore.onlineDeliveryEnabled) {
                  setOrderMode('delivery');
                } else if (loadedStore.onlineDeliveryEnabled === false && loadedStore.onlinePickupEnabled) {
                  setOrderMode('pickup');
                }
              }
            },
            (err) => {
              if (!mounted) return;
              setAuthError(err.message);
              setLoading(false);
            }
          );
        } else {
          setLoading(false);
        }

        const session = await resolveCustomerOrRiderSession();
        if (!mounted) return;
        setCustomerUid(session.uid);
        setIsAuthCustomer(session.isAuthenticated);
      } catch (err) {
        if (!mounted) return;
        setAuthError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    };

    boot();
    return () => {
      mounted = false;
      unsubStore?.();
    };
  }, []);

  useEffect(() => {
    if (!isAuthCustomer || !customerUid) {
      setAuthOrders([]);
      return;
    }
    return subscribeCustomerOrders(
      customerUid,
      (orders) => {
        setAuthOrders(orders);
      },
      (err) => {
        console.warn('Customer orders warning:', err.message);
      }
    );
  }, [isAuthCustomer, customerUid]);

  useEffect(() => {
    if (trackedOrderIds.length === 0) {
      setLocalOrders([]);
      return;
    }
    return subscribeGuestOrdersByIds(
      trackedOrderIds,
      (orders) => {
        setLocalOrders(orders);
      },
      (err) => {
        console.warn('Guest tracked orders warning:', err.message);
      }
    );
  }, [trackedOrderIds]);

  const customerOrders = useMemo(() => {
    const merged = new Map<string, OnlineOrderDoc>();
    for (const o of localOrders) merged.set(o.id, o);
    for (const o of authOrders) merged.set(o.id, o);
    return Array.from(merged.values()).sort((a, b) => {
      const da = toDateSafe(a.createdAt)?.getTime() ?? 0;
      const dbTime = toDateSafe(b.createdAt)?.getTime() ?? 0;
      return dbTime - da;
    });
  }, [authOrders, localOrders]);

  // Load dish photos + store PromptPay QR photo lazily from publicStores/{storeId}/images
  useEffect(() => {
    if (!storeId || !store) return;
    let cancelled = false;

    if (store.qrImageId && !loadedImageIdsRef.current.has(store.qrImageId)) {
      loadedImageIdsRef.current.add(store.qrImageId);
      fetchPublicStoreImage(storeId, store.qrImageId)
        .then((url) => {
          if (!cancelled && url) setQrDataUrl(url);
        })
        .catch(() => {});
    }

    for (const dish of store.dishes || []) {
      if (dish.imageId && !loadedImageIdsRef.current.has(dish.imageId)) {
        loadedImageIdsRef.current.add(dish.imageId);
        fetchPublicStoreImage(storeId, dish.imageId)
          .then((url) => {
            if (!cancelled && url) {
              setDishImages((prev) => ({ ...prev, [dish.imageId!]: url }));
            }
          })
          .catch(() => {});
      }
    }

    return () => {
      cancelled = true;
    };
  }, [storeId, store]);

  const optionGroupMap = useMemo(() => {
    const map = new Map<string, PublicOptionGroup>();
    for (const g of store?.optionGroups || []) {
      map.set(g.id, g);
    }
    return map;
  }, [store]);

  const sortedCategories = useMemo(() => {
    return [...(store?.categories || [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
    );
  }, [store?.categories]);

  const categoryRankMap = useMemo(() => {
    const map = new Map<string, number>();
    sortedCategories.forEach((cat, idx) => map.set(cat.id, idx));
    return map;
  }, [sortedCategories]);

  const filteredDishes = useMemo(() => {
    const all = store?.dishes || [];
    const q = searchQuery.trim().toLowerCase();
    return all
      .filter((d) => {
        if (selectedCategoryId !== 'all' && d.categoryId !== selectedCategoryId) return false;
        if (q) {
          const matchEn = d.name.toLowerCase().includes(q);
          const matchTh = (d.nameTh || '').toLowerCase().includes(q);
          const matchLoc = getLocalizedText(lang, d.nameTh || d.name, d.name).toLowerCase().includes(q);
          const matchDesc = (d.description || '').toLowerCase().includes(q);
          if (!matchEn && !matchTh && !matchLoc && !matchDesc) return false;
        }
        return d.variants && d.variants.length > 0;
      })
      .sort((a, b) => {
        if (selectedCategoryId === 'all') {
          const rankA = categoryRankMap.get(a.categoryId) ?? 999999;
          const rankB = categoryRankMap.get(b.categoryId) ?? 999999;
          if (rankA !== rankB) return rankA - rankB;
        }
        return (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);
      });
  }, [store, selectedCategoryId, searchQuery, lang, categoryRankMap]);

  const openDishModal = (dish: PublicDish) => {
    const defaultVariant = dish.variants[0] || null;
    const initOpts: Record<string, string[]> = {};
    for (const gId of dish.optionGroupIds || []) {
      const grp = optionGroupMap.get(gId);
      if (grp && grp.minSelect > 0 && grp.choices.length > 0) {
        initOpts[gId] = grp.choices.slice(0, grp.minSelect).map((c) => c.id);
      }
    }
    setActiveDish(dish);
    setSelectedVariant(defaultVariant);
    setSelectedOptions(initOpts);
    setItemNote('');
    setItemQty(1);
    setOptionValidationMsg(null);
  };

  const toggleOptionChoice = (group: PublicOptionGroup, choiceId: string) => {
    setOptionValidationMsg(null);
    setSelectedOptions((prev) => {
      const current = prev[group.id] || [];
      const exists = current.includes(choiceId);
      if (group.maxSelect <= 1) {
        if (exists && group.minSelect === 0) {
          return { ...prev, [group.id]: [] };
        }
        return { ...prev, [group.id]: [choiceId] };
      }
      if (exists) {
        return { ...prev, [group.id]: current.filter((id) => id !== choiceId) };
      }
      if (current.length >= group.maxSelect) {
        return { ...prev, [group.id]: [...current.slice(1), choiceId] };
      }
      return { ...prev, [group.id]: [...current, choiceId] };
    });
  };

  const handleAddToCart = () => {
    if (!activeDish || !selectedVariant) return;

    // Validate minSelect
    for (const gId of activeDish.optionGroupIds || []) {
      const grp = optionGroupMap.get(gId);
      if (!grp) continue;
      const count = (selectedOptions[gId] || []).length;
      if (count < grp.minSelect) {
        const gLabel = getLocalizedText(lang, grp.nameTh || grp.name, grp.name);
        setOptionValidationMsg(
          lang === 'th'
            ? `กรุณาเลือก "${gLabel}" อย่างน้อย ${grp.minSelect} รายการ`
            : `Please select at least ${grp.minSelect} for "${gLabel}"`
        );
        return;
      }
    }

    const flatOptions: OnlineOrderItemOption[] = [];
    let optionsExtra = 0;

    for (const gId of activeDish.optionGroupIds || []) {
      const grp = optionGroupMap.get(gId);
      if (!grp) continue;
      const chosenIds = selectedOptions[gId] || [];
      for (const cId of chosenIds) {
        const choice = grp.choices.find((c) => c.id === cId);
        if (choice) {
          optionsExtra += choice.price;
          flatOptions.push({
            groupId: grp.id,
            groupName: getLocalizedText(lang, grp.nameTh || grp.name, grp.name),
            choiceId: choice.id,
            choiceName: getLocalizedText(lang, choice.nameTh || choice.name, choice.name),
            price: choice.price,
          });
        }
      }
    }

    const unitPrice = Math.max(0, selectedVariant.price + optionsExtra);
    const dishLabel = getLocalizedText(lang, activeDish.nameTh || activeDish.name, activeDish.name);
    const varLabel = getLocalizedText(lang, selectedVariant.nameTh || selectedVariant.name, selectedVariant.name);
    const optionSig = flatOptions.map((o) => o.choiceId).sort().join(',');
    const noteTrim = itemNote.trim();
    const key = `${activeDish.id}::${selectedVariant.id}::${optionSig}::${noteTrim}`;

    setCart((prev) => {
      const idx = prev.findIndex((c) => c.key === key);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + itemQty };
        return copy;
      }
      return [
        ...prev,
        {
          key,
          dishId: activeDish.id,
          dishName: dishLabel,
          variantId: selectedVariant.id,
          variantName: varLabel,
          unitPrice,
          quantity: itemQty,
          ...(noteTrim ? { notes: noteTrim } : {}),
          options: flatOptions,
        },
      ];
    });

    setActiveDish(null);
  };

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [cart]
  );
  const deliveryFee =
    orderMode === 'delivery' ? Math.max(0, Number(store?.onlineDeliveryFee ?? 0) || 0) : 0;
  const grandTotal = subtotal + deliveryFee;
  const totalCartItems = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  const activeOrderCount = useMemo(
    () => customerOrders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled').length,
    [customerOrders]
  );

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation) {
      setSubmitError(lang === 'th' ? 'เบราว์เซอร์ไม่รองรับ GPS' : 'Geolocation not supported');
      return;
    }
    setLocatingGps(true);
    setSubmitError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDeliveryLat(Number(pos.coords.latitude.toFixed(6)));
        setDeliveryLng(Number(pos.coords.longitude.toFixed(6)));
        setLocatingGps(false);
      },
      () => {
        setSubmitError(
          lang === 'th'
            ? 'ไม่สามารถดึงตำแหน่ง GPS ได้ กรุณาระบุที่อยู่จัดส่งให้ชัดเจน'
            : 'Unable to fetch GPS location. Please enter full address.'
        );
        setLocatingGps(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store || !storeId || cart.length === 0) return;

    const trimmedName = customerName.trim();
    const trimmedPhone = customerPhone.trim();
    const trimmedAddr = deliveryAddress.trim();

    if (!trimmedName) {
      setSubmitError(lang === 'th' ? 'กรุณากรอกชื่อผู้สั่ง' : 'Please enter your name');
      return;
    }
    if (trimmedPhone.length < 6) {
      setSubmitError(lang === 'th' ? 'กรุณากรอกเบอร์โทรศัพท์ที่ติดต่อได้' : 'Please enter a valid phone number');
      return;
    }
    if (orderMode === 'delivery' && !trimmedAddr) {
      setSubmitError(lang === 'th' ? 'กรุณากรอกที่อยู่สำหรับจัดส่ง' : 'Please enter delivery address');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      saveCustomerInfo({
        customerName: trimmedName,
        customerPhone: trimmedPhone,
        deliveryAddress: trimmedAddr,
        customerNote: customerNote.trim(),
        orderMode,
        paymentMethod,
        deliveryLat,
        deliveryLng,
      });

      const items: OnlineOrderItem[] = cart.map((c) => ({
        dishId: c.dishId,
        dishName: c.dishName,
        variantId: c.variantId,
        variantName: c.variantName,
        unitPrice: c.unitPrice,
        quantity: c.quantity,
        ...(c.notes ? { notes: c.notes } : {}),
        options: c.options,
      }));

      const createdOrder = await createOnlineOrder({
        storeId,
        customerName: trimmedName,
        customerPhone: trimmedPhone,
        orderMode,
        paymentMethod,
        deliveryAddress: orderMode === 'delivery' ? trimmedAddr : undefined,
        deliveryLat: orderMode === 'delivery' ? deliveryLat : null,
        deliveryLng: orderMode === 'delivery' ? deliveryLng : null,
        customerNote: customerNote.trim() || undefined,
        items,
        subtotal,
        deliveryFee,
        totalAmount: grandTotal,
      });

      setTrackedOrderIds((prev) =>
        prev.includes(createdOrder.id) ? prev : [createdOrder.id, ...prev]
      );
      setCart([]);
      setIsCheckoutOpen(false);
      setIsOrdersOpen(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmCancelOrder = async (orderId: string) => {
    try {
      await cancelOnlineOrderByCustomer(orderId);
      setCancelConfirmOrderId(null);
    } catch (err) {
      console.error('Cancel order failed:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex flex-col items-center justify-center p-6 text-slate-800">
        <Loader2 className="w-8 h-8 animate-spin text-orange-600 mb-3" />
        <p className="text-sm font-bold">{lang === 'th' ? 'กำลังโหลดเมนูอาหาร...' : 'Loading storefront menu...'}</p>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl border border-rose-200 p-6 text-center space-y-3 shadow-sm">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
          <h2 className="text-lg font-extrabold text-slate-900">
            {lang === 'th' ? 'ไม่สามารถเชื่อมต่อระบบสั่งอาหารได้' : 'Storefront Connection Error'}
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">{authError}</p>
        </div>
      </div>
    );
  }

  if (!store || !storeId) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 p-7 text-center space-y-3 shadow-sm">
          <Store className="w-12 h-12 text-orange-500 mx-auto" />
          <h1 className="text-lg font-extrabold text-slate-900">
            {lang === 'th' ? 'ยังไม่พบหน้าร้านออนไลน์' : 'Online Storefront Not Published Yet'}
          </h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            {lang === 'th'
              ? 'กรุณาให้เจ้าของร้านเปิดเมนูและกด "เผยแพร่เมนูขึ้นเว็บลูกค้า" ในหน้า ออเดอร์ออนไลน์ & Rider ก่อนใช้งาน'
              : 'Please ask the restaurant owner to publish the storefront menu in Online Orders & Rider.'}
          </p>
        </div>
      </div>
    );
  }

  const isStoreClosed = store.onlineOrderingEnabled === false;

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-slate-900 pb-24">
      {/* Slim Mobile-First Store Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 text-white font-black text-lg flex items-center justify-center shrink-0">
              {store.shopName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-base sm:text-lg text-slate-900 truncate">
                  {store.shopName}
                </h1>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0 ${
                    isStoreClosed
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {isStoreClosed
                    ? lang === 'th'
                      ? 'ปิดชั่วคราว'
                      : 'Closed'
                    : lang === 'th'
                    ? 'เปิดรับออเดอร์'
                    : 'Open'}
                </span>
              </div>
              <p className="text-xs text-slate-500 flex items-center gap-2 truncate">
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3 text-orange-500" />
                  ~{store.onlineEstimatedPrepMinutes || 20}{' '}
                  {lang === 'th' ? 'นาที' : 'mins'}
                </span>
                {store.shopPhone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-400" />
                    {store.shopPhone}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsOrdersOpen(true)}
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Receipt className="w-4 h-4 text-orange-600" />
              <span className="hidden sm:inline">
                {lang === 'th' ? 'ติดตามออเดอร์' : 'My Orders'}
              </span>
              {activeOrderCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-md bg-orange-600 text-white text-[11px] font-extrabold tabular-nums">
                  {activeOrderCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={handleSwitchLang}
              className="min-h-[40px] px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 cursor-pointer"
            >
              {lang === 'th' ? 'TH' : 'EN'}
            </button>
          </div>
        </div>

        {/* Category Tabs & Search */}
        <div className="max-w-5xl mx-auto px-4 pb-3 space-y-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={lang === 'th' ? 'ค้นหาเมนูที่ต้องการ...' : 'Search menu items...'}
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-orange-500"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button
              type="button"
              onClick={() => setSelectedCategoryId('all')}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
                selectedCategoryId === 'all'
                  ? 'bg-orange-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {lang === 'th' ? 'ทั้งหมด' : 'All'}
            </button>
            {sortedCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategoryId(cat.id)}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
                  selectedCategoryId === cat.id
                    ? 'bg-orange-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {getLocalizedText(lang, cat.nameTh || cat.name, cat.name)}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Store Closed Banner */}
      {isStoreClosed && (
        <div className="max-w-5xl mx-auto px-4 pt-4">
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
            <span>
              {lang === 'th'
                ? 'ขณะนี้ร้านปิดรับออเดอร์ออนไลน์ชั่วคราว คุณสามารถดูเมนูได้ แต่ยังไม่สามารถส่งคำสั่งซื้อได้'
                : 'Online ordering is temporarily paused by the store.'}
            </span>
          </div>
        </div>
      )}

      {/* Main Dish Grid */}
      <main className="max-w-5xl mx-auto px-4 py-4">
        {filteredDishes.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            {lang === 'th' ? 'ไม่พบเมนูในหมวดหมู่นี้' : 'No menu items match your search.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredDishes.map((dish) => {
              const title = getLocalizedText(lang, dish.nameTh || dish.name, dish.name);
              const minPrice = Math.min(...dish.variants.map((v) => v.price));
              const photoUrl = dish.imageId ? dishImages[dish.imageId] : null;
              return (
                <button
                  key={dish.id}
                  type="button"
                  disabled={isStoreClosed}
                  onClick={() => openDishModal(dish)}
                  className="bg-white rounded-2xl border border-slate-200 p-3 flex items-stretch gap-3.5 text-left hover:border-orange-300 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="w-24 h-24 rounded-xl bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center border border-slate-100">
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt={title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ShoppingBag className="w-7 h-7 text-slate-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                    <div>
                      <h2 className="font-bold text-sm text-slate-900 line-clamp-2">{title}</h2>
                      {dish.description && (
                        <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{dish.description}</p>
                      )}
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <span className="font-extrabold text-sm text-orange-600 tabular-nums">
                        ฿{formatMoney(minPrice)}
                        {dish.variants.length > 1 ? '+' : ''}
                      </span>
                      <span className="w-8 h-8 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
                        <Plus className="w-4 h-4" />
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>

      {/* Bottom Sticky Cart Trigger */}
      {totalCartItems > 0 && (
        <div className="fixed bottom-4 inset-x-0 px-4 z-30 pointer-events-none">
          <div className="max-w-xl mx-auto pointer-events-auto">
            <button
              type="button"
              onClick={() => setIsCheckoutOpen(true)}
              className="w-full min-h-[54px] px-5 py-3 rounded-2xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-extrabold text-sm flex items-center justify-between shadow-lg shadow-orange-600/25 cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <span className="px-2.5 py-0.5 rounded-lg bg-white/20 text-xs font-black tabular-nums">
                  {totalCartItems}
                </span>
                <span>{lang === 'th' ? 'ดูตะกร้าและสั่งอาหาร' : 'View Cart & Checkout'}</span>
              </div>
              <div className="flex items-center gap-1.5 tabular-nums">
                <span>฿{formatMoney(subtotal)}</span>
                <ChevronRight className="w-4 h-4" />
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Dish Option Customization Modal (No <label>+sr-only to prevent scroll jump!) */}
      {activeDish && selectedVariant && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="modal-panel bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl">
            <div className="modal-header border-b border-slate-200 flex items-center justify-between gap-3">
              <h3 className="font-extrabold text-base text-slate-900 truncate">
                {getLocalizedText(lang, activeDish.nameTh || activeDish.name, activeDish.name)}
              </h3>
              <button
                type="button"
                onClick={() => setActiveDish(null)}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-5">
              {/* Variants */}
              <div className="space-y-2">
                <div className="text-xs font-extrabold text-slate-700">
                  {lang === 'th' ? 'เลือกขนาด / รูปแบบ' : 'Select Size / Variant'}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {activeDish.variants.map((v) => {
                    const isSel = selectedVariant.id === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVariant(v)}
                        className={`min-h-[44px] px-3.5 py-2.5 rounded-xl border text-left flex items-center justify-between cursor-pointer transition-all ${
                          isSel
                            ? 'bg-orange-50 border-orange-500 text-orange-950 font-bold'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-xs">
                          {getLocalizedText(lang, v.nameTh || v.name, v.name)}
                        </span>
                        <span className="text-xs font-extrabold text-orange-600 tabular-nums">
                          ฿{formatMoney(v.price)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Option Groups */}
              {(activeDish.optionGroupIds || []).map((gId) => {
                const grp = optionGroupMap.get(gId);
                if (!grp || grp.choices.length === 0) return null;
                const selectedIds = selectedOptions[gId] || [];
                const grpTitle = getLocalizedText(lang, grp.nameTh || grp.name, grp.name);

                return (
                  <div key={grp.id} className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-extrabold text-slate-800">{grpTitle}</span>
                      <span className="text-[11px] font-semibold text-slate-500">
                        {grp.minSelect > 0
                          ? lang === 'th'
                            ? `บังคับเลือก ${grp.minSelect} (สูงสุด ${grp.maxSelect})`
                            : `Required ${grp.minSelect} (max ${grp.maxSelect})`
                          : lang === 'th'
                          ? `เลือกได้สูงสุด ${grp.maxSelect}`
                          : `Optional (max ${grp.maxSelect})`}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {grp.choices.map((ch) => {
                        const checked = selectedIds.includes(ch.id);
                        return (
                          <button
                            key={ch.id}
                            type="button"
                            onClick={() => toggleOptionChoice(grp, ch.id)}
                            className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border flex items-center justify-between text-left cursor-pointer transition-colors ${
                              checked
                                ? 'bg-orange-50 border-orange-500 text-orange-950 font-bold'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <span
                                className={`w-4 h-4 rounded-md border flex items-center justify-center text-[10px] ${
                                  checked
                                    ? 'bg-orange-600 border-orange-600 text-white'
                                    : 'border-slate-300 bg-white'
                                }`}
                              >
                                {checked ? '✓' : ''}
                              </span>
                              <span className="text-xs">
                                {getLocalizedText(lang, ch.nameTh || ch.name, ch.name)}
                              </span>
                            </div>
                            <span className="text-xs font-bold text-slate-600 tabular-nums">
                              {ch.price > 0 ? `+฿${formatMoney(ch.price)}` : lang === 'th' ? 'ฟรี' : 'Free'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Item Note */}
              <div className="space-y-1.5">
                <div className="text-xs font-extrabold text-slate-700">
                  {lang === 'th' ? 'หมายเหตุเพิ่มเติมถึงครัว' : 'Special Instructions'}
                </div>
                <input
                  type="text"
                  value={itemNote}
                  onChange={(e) => setItemNote(e.target.value)}
                  placeholder={lang === 'th' ? 'เช่น ไม่ใส่ผัก, เผ็ดน้อย' : 'e.g. Less spicy, no cilantro'}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              {optionValidationMsg && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
                  {optionValidationMsg}
                </div>
              )}
            </div>

            <div className="modal-footer border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => setItemQty((q) => Math.max(1, q - 1))}
                  className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-700 cursor-pointer"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-6 text-center text-sm font-extrabold tabular-nums">{itemQty}</span>
                <button
                  type="button"
                  onClick={() => setItemQty((q) => q + 1)}
                  className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-700 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleAddToCart}
                className="flex-1 min-h-[46px] px-4 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-extrabold text-xs sm:text-sm cursor-pointer"
              >
                {lang === 'th' ? 'เพิ่มลงตะกร้า' : 'Add to Cart'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout & Cart Sheet */}
      {isCheckoutOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4">
          <form
            onSubmit={handleSubmitOrder}
            className="modal-panel bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl"
          >
            <div className="modal-header border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-extrabold text-base text-slate-900">
                {lang === 'th' ? 'สรุปคำสั่งซื้อ & ชำระเงิน' : 'Checkout & Delivery Details'}
              </h3>
              <button
                type="button"
                onClick={() => setIsCheckoutOpen(false)}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-4">
              {/* Cart Items */}
              <div className="space-y-2">
                {cart.map((entry) => (
                  <div
                    key={entry.key}
                    className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-extrabold text-slate-900">
                        {entry.dishName}{' '}
                        {entry.variantName && entry.variantName !== 'Standard' && (
                          <span className="text-slate-500 font-semibold">({entry.variantName})</span>
                        )}
                      </div>
                      {entry.options.length > 0 && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          + {entry.options.map((o) => o.choiceName).join(', ')}
                        </div>
                      )}
                      {entry.notes && (
                        <div className="text-[11px] text-amber-700 mt-0.5">* {entry.notes}</div>
                      )}
                      <div className="text-xs font-bold text-orange-600 mt-1 tabular-nums">
                        ฿{formatMoney(entry.unitPrice * entry.quantity)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setCart((prev) =>
                            prev
                              .map((c) =>
                                c.key === entry.key ? { ...c, quantity: c.quantity - 1 } : c
                              )
                              .filter((c) => c.quantity > 0)
                          )
                        }
                        className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center cursor-pointer"
                      >
                        {entry.quantity <= 1 ? (
                          <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                        ) : (
                          <Minus className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <span className="w-5 text-center text-xs font-extrabold tabular-nums">
                        {entry.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setCart((prev) =>
                            prev.map((c) =>
                              c.key === entry.key ? { ...c, quantity: c.quantity + 1 } : c
                            )
                          )
                        }
                        className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Order Mode Toggle */}
              <div className="space-y-2">
                <div className="text-xs font-extrabold text-slate-700">
                  {lang === 'th' ? 'รูปแบบการรับอาหาร' : 'Order Mode'}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {store.onlinePickupEnabled !== false && (
                    <button
                      type="button"
                      onClick={() => setOrderMode('pickup')}
                      className={`min-h-[46px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer ${
                        orderMode === 'pickup'
                          ? 'bg-orange-50 border-orange-500 text-orange-900'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      <Store className="w-4 h-4" />
                      <span>{lang === 'th' ? 'รับเองที่ร้าน' : 'Self-Pickup'}</span>
                    </button>
                  )}
                  {store.onlineDeliveryEnabled !== false && (
                    <button
                      type="button"
                      onClick={() => setOrderMode('delivery')}
                      className={`min-h-[46px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer ${
                        orderMode === 'delivery'
                          ? 'bg-orange-50 border-orange-500 text-orange-900'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      <Truck className="w-4 h-4" />
                      <span>{lang === 'th' ? 'เดลิเวอรี (ส่งถึงบ้าน)' : 'Store Delivery'}</span>
                    </button>
                  )}
                </div>

                {/* Delivery Fee Notice: Shown ONLY when Delivery is selected */}
                {orderMode === 'delivery' && (
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-900 flex items-center gap-2">
                    <Truck className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      {lang === 'th'
                        ? `มีค่าบริการจัดส่ง ${formatMoney(store.onlineDeliveryFee)} บาท`
                        : `Delivery fee: ฿${formatMoney(store.onlineDeliveryFee)}`}
                    </span>
                  </div>
                )}
              </div>

              {/* Customer Contact & Address */}
              <div className="space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <div className="text-xs font-bold text-slate-700 mb-1">
                      {lang === 'th' ? 'ชื่อผู้สั่ง *' : 'Your Name *'}
                    </div>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder={lang === 'th' ? 'ชื่อเล่น / ชื่อจริง' : 'Full name'}
                      className="w-full px-3 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-700 mb-1">
                      {lang === 'th' ? 'เบอร์โทรศัพท์ *' : 'Phone Number *'}
                    </div>
                    <input
                      type="tel"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="08x-xxx-xxxx"
                      className="w-full px-3 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                    />
                  </div>
                </div>

                {orderMode === 'delivery' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700">
                        {lang === 'th' ? 'ที่อยู่จัดส่ง *' : 'Delivery Address *'}
                      </span>
                      <button
                        type="button"
                        onClick={handleUseCurrentGps}
                        disabled={locatingGps}
                        className="text-[11px] font-bold text-orange-600 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <LocateFixed className="w-3.5 h-3.5" />
                        <span>
                          {locatingGps
                            ? lang === 'th'
                              ? 'กำลังจับพิกัด...'
                              : 'Locating...'
                            : lang === 'th'
                            ? 'ใช้พิกัด GPS ปัจจุบัน'
                            : 'Use Current GPS'}
                        </span>
                      </button>
                    </div>
                    <textarea
                      required
                      rows={2}
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder={
                        lang === 'th'
                          ? 'บ้านเลขที่ ซอย อาคาร จุดสังเกต...'
                          : 'Street, building, floor, landmark...'
                      }
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                    />
                    {deliveryLat != null && deliveryLng != null && (
                      <div className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        <span>
                          GPS: {deliveryLat}, {deliveryLng}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <div className="text-xs font-bold text-slate-700 mb-1">
                    {lang === 'th' ? 'หมายเหตุเพิ่มเติม' : 'Order Note'}
                  </div>
                  <input
                    type="text"
                    value={customerNote}
                    onChange={(e) => setCustomerNote(e.target.value)}
                    placeholder={lang === 'th' ? 'เช่น รับช้อนส้อม, วางไว้หน้าบ้าน' : 'Optional note'}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              {/* Payment Method */}
              <div className="space-y-2">
                <div className="text-xs font-extrabold text-slate-700">
                  {lang === 'th' ? 'วิธีชำระเงิน' : 'Payment Method'}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cash')}
                    className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer ${
                      paymentMethod === 'cash'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    <Banknote className="w-4 h-4" />
                    <span>{lang === 'th' ? 'เงินสดปลายทาง / หน้าร้าน' : 'Cash'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('qr_payment')}
                    className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer ${
                      paymentMethod === 'qr_payment'
                        ? 'bg-sky-50 border-sky-500 text-sky-900'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    <QrCode className="w-4 h-4" />
                    <span>{lang === 'th' ? 'โอนผ่าน QR พร้อมเพย์' : 'PromptPay QR'}</span>
                  </button>
                </div>

                {paymentMethod === 'qr_payment' && qrDataUrl && (
                  <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-center space-y-2">
                    <div className="text-xs font-bold text-slate-700">
                      {lang === 'th'
                        ? 'สแกน QR ร้านค้าเพื่อโอนชำระ (แสดงสลิปตอนรับอาหาร)'
                        : 'Scan store QR code to pay'}
                    </div>
                    <img
                      src={qrDataUrl}
                      alt="Store PromptPay QR"
                      className="w-44 h-44 mx-auto rounded-xl object-contain bg-white border border-slate-200 p-1"
                    />
                  </div>
                )}
              </div>

              {/* Summary Totals */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>{lang === 'th' ? 'ค่าอาหาร' : 'Food Subtotal'}</span>
                  <span className="font-bold tabular-nums">฿{formatMoney(subtotal)}</span>
                </div>
                {orderMode === 'delivery' && (
                  <div className="flex justify-between text-slate-600">
                    <span>{lang === 'th' ? 'ค่าบริการจัดส่ง' : 'Delivery Fee'}</span>
                    <span className="font-bold tabular-nums">฿{formatMoney(deliveryFee)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-black text-slate-900 pt-1.5 border-t border-slate-200">
                  <span>{lang === 'th' ? 'ยอดชำระทั้งหมด' : 'Total'}</span>
                  <span className="text-orange-600 tabular-nums">฿{formatMoney(grandTotal)}</span>
                </div>
              </div>

              {submitError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
                  {submitError}
                </div>
              )}
            </div>

            <div className="modal-footer border-t border-slate-200 bg-white">
              <button
                type="submit"
                disabled={isSubmitting || isStoreClosed || cart.length === 0}
                className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-extrabold text-sm cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>
                  {lang === 'th'
                    ? `ยืนยันสั่งอาหาร • ฿${formatMoney(grandTotal)}`
                    : `Place Order • ฿${formatMoney(grandTotal)}`}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Live Order Tracking Modal */}
      {isOrdersOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-orange-600" />
                <h3 className="font-extrabold text-base text-slate-900">
                  {lang === 'th' ? 'ติดตามสถานะออเดอร์' : 'Live Order Status'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOrdersOpen(false)}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
              {customerOrders.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  {lang === 'th' ? 'ยังไม่มีรายการสั่งอาหารในอุปกรณ์นี้' : 'No orders placed from this device yet.'}
                </div>
              ) : (
                customerOrders.map((ord) => {
                  const badge = STATUS_BADGE[ord.status] || STATUS_BADGE.pending;
                  const created = toDateSafe(ord.createdAt);
                  return (
                    <div
                      key={ord.id}
                      className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-extrabold text-sm text-slate-900">{ord.orderNumber}</div>
                          <div className="text-[11px] text-slate-500">
                            {created
                              ? created.toLocaleString(lang === 'th' ? 'th-TH' : 'en-US', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  day: '2-digit',
                                  month: 'short',
                                })
                              : ''}{' '}
                            • {ord.orderMode === 'delivery' ? (lang === 'th' ? 'เดลิเวอรี' : 'Delivery') : (lang === 'th' ? 'รับที่ร้าน' : 'Pickup')}
                          </div>
                        </div>
                        <span
                          className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ${badge.color}`}
                        >
                          {badge[lang]}
                        </span>
                      </div>

                      <div className="text-xs text-slate-700 space-y-1 border-t border-slate-100 pt-2">
                        {ord.items.map((it, i) => (
                          <div key={i} className="flex justify-between gap-2">
                            <span>
                              {it.quantity}x {it.dishName}
                              {it.variantName && it.variantName !== 'Standard' ? ` (${it.variantName})` : ''}
                            </span>
                            <span className="font-semibold tabular-nums">
                              ฿{formatMoney(it.unitPrice * it.quantity)}
                            </span>
                          </div>
                        ))}
                        {ord.orderMode === 'delivery' && ord.deliveryFee > 0 && (
                          <div className="flex justify-between text-slate-500">
                            <span>{lang === 'th' ? 'ค่าจัดส่ง' : 'Delivery Fee'}</span>
                            <span className="tabular-nums">฿{formatMoney(ord.deliveryFee)}</span>
                          </div>
                        )}
                      </div>

                      {ord.riderName && ord.status === 'out_for_delivery' && (
                        <div className="p-2.5 rounded-xl bg-teal-50 border border-teal-200 text-xs font-bold text-teal-900 flex items-center gap-2">
                          <Truck className="w-4 h-4 text-teal-600" />
                          <span>
                            {lang === 'th'
                              ? `ไรเดอร์ ${ord.riderName} กำลังนำอาหารไปส่ง`
                              : `Rider ${ord.riderName} is on the way`}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                        <div className="text-sm font-black text-orange-600 tabular-nums">
                          {lang === 'th' ? 'รวม ' : 'Total '}฿{formatMoney(ord.totalAmount)}
                        </div>
                        {ord.status === 'pending' && (
                          cancelConfirmOrderId === ord.id ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleConfirmCancelOrder(ord.id)}
                                className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold cursor-pointer"
                              >
                                {lang === 'th' ? 'ยืนยันยกเลิก' : 'Confirm'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setCancelConfirmOrderId(null)}
                                className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-bold cursor-pointer"
                              >
                                {lang === 'th' ? 'ไม่' : 'No'}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setCancelConfirmOrderId(ord.id)}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              <span>{lang === 'th' ? 'ยกเลิกออเดอร์' : 'Cancel'}</span>
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
