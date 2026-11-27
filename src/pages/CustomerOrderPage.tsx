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
  RefreshCw,
  Heart,
  Pencil,
  RotateCcw,
  ArrowLeft,
  Check,
  Menu,
  User,
  History,
  Info,
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
  PublicOptionChoice,
  PublicOptionGroup,
  PublicStoreDoc,
} from '../types';
import {
  cancelOnlineOrderByCustomer,
  createOnlineOrder,
  deleteSavedCustomerAddress,
  deleteSavedCustomerFavoriteItem,
  fetchPublicStoreImage,
  fetchPublicStoreOnce,
  loadCustomerFavoriteDishIds,
  loadSavedCustomerAddresses,
  loadSavedCustomerFavoriteItems,
  loadSavedCustomerInfo,
  loadTrackedCustomerOrderIds,
  resolveCustomerOrRiderSession,
  resolvePublicStoreId,
  saveCustomerInfo,
  SavedCustomerAddress,
  SavedCustomerFavoriteItem,
  subscribeCustomerOrders,
  subscribeGuestOrdersByIds,
  subscribePublicStore,
  toggleCustomerFavoriteDishId,
  upsertSavedCustomerAddress,
  upsertSavedCustomerFavoriteItem,
} from '../data/onlineDb';
import {
  formatMoney,
  getOptionChoiceEffectiveQuantity,
  isOptionChoiceQuantityEnabled,
  calculateOptionChoiceLinePrice,
  formatOptionChoiceDisplayName,
  toggleOptionChoiceMap,
  updateOptionChoiceQuantityMap,
} from '../engine/calculations';
import {
  canCustomerCancelOrder,
  formatCountdownMMSS,
  toDateSafe,
} from '../engine/onlineOrdering';
import {
  getLocalizedDishDescription,
  getLocalizedText,
  resolveBilingualDescriptionFields,
} from '../utils/thaiToEnglish';
import { useLanguage } from '../contexts/LanguageContext';
import { LanguageToggle } from '../components/LanguageToggle';
import { CustomerAddressMapModal } from '../components/CustomerAddressMapModal';
import { NumericInput } from '../costing/components/common/NumericInput';

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

const STORE_LOGO_SRC = '/assets/aistudio/Logo-Ex_a8e2a318.png';

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
  const [retryNonce, setRetryNonce] = useState(0);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dishImages, setDishImages] = useState<Record<string, string>>({});
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Dish customization modal & Favorite editing
  const [activeDish, setActiveDish] = useState<PublicDish | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<PublicDishVariant | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, Record<string, number>>>({});
  const [itemNote, setItemNote] = useState('');
  const [itemQty, setItemQty] = useState(1);
  const [optionValidationMsg, setOptionValidationMsg] = useState<string | null>(null);
  const [editingFavoriteId, setEditingFavoriteId] = useState<string | null>(null);
  const [favoriteSavedNotice, setFavoriteSavedNotice] = useState<string | null>(null);

  // Cart, Checkout & 2-Minute Order Review Confirmation Window
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isOrderReviewOpen, setIsOrderReviewOpen] = useState(false);
  const [reviewSecondsLeft, setReviewSecondsLeft] = useState(120);
  const [isOrdersOpen, setIsOrdersOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCustomerProfileModalOpen, setIsCustomerProfileModalOpen] = useState(false);
  const [isAboutStoreModalOpen, setIsAboutStoreModalOpen] = useState(false);
  const [profileSavedNotice, setProfileSavedNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [locatingGps, setLocatingGps] = useState(false);
  const [cancelConfirmOrderId, setCancelConfirmOrderId] = useState<string | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [cancelOrderError, setCancelOrderError] = useState<string | null>(null);
  const [cancelTickNowMs, setCancelTickNowMs] = useState<number>(() => Date.now());

  const [favoriteDishIds, setFavoriteDishIds] = useState<string[]>([]);
  const [savedFavoriteItems, setSavedFavoriteItems] = useState<SavedCustomerFavoriteItem[]>([]);
  const [savedAddresses, setSavedAddresses] = useState<SavedCustomerAddress[]>(() =>
    loadSavedCustomerAddresses()
  );
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(() => {
    const initialList = loadSavedCustomerAddresses();
    return (initialList.find((a) => a.isDefault) || initialList[0])?.id ?? null;
  });
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [editingAddressTarget, setEditingAddressTarget] = useState<SavedCustomerAddress | null>(
    null
  );

  const savedProfile = useMemo(() => loadSavedCustomerInfo(), []);
  const initialDefaultAddr = useMemo(() => {
    const list = loadSavedCustomerAddresses();
    return list.find((a) => a.isDefault) || list[0] || null;
  }, []);
  const [customerName, setCustomerName] = useState(
    savedProfile.customerName || initialDefaultAddr?.customerName || ''
  );
  const [customerPhone, setCustomerPhone] = useState(
    savedProfile.customerPhone || initialDefaultAddr?.customerPhone || ''
  );
  const [deliveryAddress, setDeliveryAddress] = useState(
    savedProfile.deliveryAddress || initialDefaultAddr?.address || ''
  );
  const [customerNote, setCustomerNote] = useState(savedProfile.customerNote);
  const [orderMode, setOrderMode] = useState<OnlineOrderMode>(savedProfile.orderMode);
  const [paymentMethod, setPaymentMethod] = useState<OnlinePaymentMethod>(savedProfile.paymentMethod);
  const [deliveryLat, setDeliveryLat] = useState<number | null>(
    savedProfile.deliveryLat ?? initialDefaultAddr?.lat ?? null
  );
  const [deliveryLng, setDeliveryLng] = useState<number | null>(
    savedProfile.deliveryLng ?? initialDefaultAddr?.lng ?? null
  );

  const loadedImageIdsRef = useRef<Set<string>>(new Set());

  const handleSwitchLang = () => {
    if (onToggleLang) {
      onToggleLang();
    } else {
      toggleLang();
    }
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('link[rel="manifest"]').forEach((el) => el.remove());
    const shopTitle = (store?.shopName || '').trim();
    const fallbackTitle = lang === 'th' ? 'สั่งอาหารออนไลน์' : 'Online Order';
    const resolvedTitle = shopTitle || fallbackTitle;
    document.title = shopTitle ? `${shopTitle} | ${fallbackTitle}` : fallbackTitle;
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) {
      appleTitle.setAttribute('content', resolvedTitle.slice(0, 32));
    }
  }, [store?.shopName, lang]);

  useEffect(() => {
    let mounted = true;
    let unsubStore: (() => void) | null = null;
    let resolvedStoreLoaded = false;

    setLoading(true);
    setAuthError(null);

    const applyLoadedStore = (loadedStore: PublicStoreDoc | null) => {
      if (!mounted) return;
      resolvedStoreLoaded = true;
      clearTimeout(bootTimeout);
      setStore(loadedStore);
      setAuthError(null);
      setLoading(false);
      if (loadedStore) {
        if (loadedStore.onlinePickupEnabled === false && loadedStore.onlineDeliveryEnabled) {
          setOrderMode('delivery');
        } else if (loadedStore.onlineDeliveryEnabled === false && loadedStore.onlinePickupEnabled) {
          setOrderMode('pickup');
        }
      }
    };

    const bootTimeout = setTimeout(() => {
      if (!mounted || resolvedStoreLoaded) return;
      setAuthError(
        lang === 'th'
          ? 'การเชื่อมต่อใช้เวลานานเกินไป กรุณาตรวจสอบอินเทอร์เน็ตแล้วกดลองใหม่อีกครั้ง'
          : 'Connection timed out while loading menu. Please check your internet and tap Retry.'
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
        setTrackedOrderIds(loadTrackedCustomerOrderIds(resolvedStoreId));
        setFavoriteDishIds(loadCustomerFavoriteDishIds(resolvedStoreId));
        setSavedFavoriteItems(loadSavedCustomerFavoriteItems(resolvedStoreId));

        if (resolvedStoreId) {
          // Run active one-shot fetch (SDK + REST fallback) concurrently with real-time subscription
          fetchPublicStoreOnce(resolvedStoreId)
            .then((fetchedStore) => {
              if (!mounted || resolvedStoreLoaded) return;
              applyLoadedStore(fetchedStore);
            })
            .catch((err) => {
              console.warn('fetchPublicStoreOnce fallback warning:', err);
            });

          unsubStore = subscribePublicStore(
            resolvedStoreId,
            (loadedStore) => {
              applyLoadedStore(loadedStore);
            },
            (err) => {
              if (!mounted || resolvedStoreLoaded) return;
              clearTimeout(bootTimeout);
              setAuthError(err.message);
              setLoading(false);
            }
          );
        } else {
          resolvedStoreLoaded = true;
          clearTimeout(bootTimeout);
          setLoading(false);
        }

        const session = await resolveCustomerOrRiderSession();
        if (!mounted) return;
        setCustomerUid(session.uid);
        setIsAuthCustomer(session.isAuthenticated);
      } catch (err) {
        if (!mounted || resolvedStoreLoaded) return;
        clearTimeout(bootTimeout);
        setAuthError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    };

    boot();
    return () => {
      mounted = false;
      clearTimeout(bootTimeout);
      unsubStore?.();
    };
  }, [retryNonce]);

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

  useEffect(() => {
    if (!isOrdersOpen) return;
    const now = Date.now();
    setCancelTickNowMs(now);
    const hasCancellable = customerOrders.some((o) => canCustomerCancelOrder(o, now).canCancel);
    if (!hasCancellable) return;
    const timer = setInterval(() => {
      setCancelTickNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [isOrdersOpen, customerOrders]);

  useEffect(() => {
    if (!isOrderReviewOpen || reviewSecondsLeft <= 0) return;
    const timer = window.setInterval(() => {
      setReviewSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isOrderReviewOpen, reviewSecondsLeft]);

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
        if (selectedCategoryId === 'favorites') {
          if (!favoriteDishIds.includes(d.id)) return false;
        } else if (selectedCategoryId !== 'all' && d.categoryId !== selectedCategoryId) {
          return false;
        }
        if (q) {
          const matchEn = d.name.toLowerCase().includes(q);
          const matchTh = (d.nameTh || '').toLowerCase().includes(q);
          const matchLoc = getLocalizedText(lang, d.nameTh || d.name, d.name).toLowerCase().includes(q);
          const resolvedDesc = resolveBilingualDescriptionFields(d.description, d.descriptionTh);
          const matchDesc =
            resolvedDesc.description.toLowerCase().includes(q) ||
            resolvedDesc.descriptionTh.toLowerCase().includes(q);
          if (!matchEn && !matchTh && !matchLoc && !matchDesc) return false;
        }
        return d.variants && d.variants.length > 0;
      })
      .sort((a, b) => {
        if (selectedCategoryId === 'all' || selectedCategoryId === 'favorites') {
          const rankA = categoryRankMap.get(a.categoryId) ?? 999999;
          const rankB = categoryRankMap.get(b.categoryId) ?? 999999;
          if (rankA !== rankB) return rankA - rankB;
        }
        return (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);
      });
  }, [store, selectedCategoryId, searchQuery, lang, categoryRankMap, favoriteDishIds]);

  const resolvedSavedFavorites = useMemo(() => {
    const dishesById = new Map((store?.dishes || []).map((d) => [d.id, d]));
    const q = searchQuery.trim().toLowerCase();
    const list: Array<{
      fav: SavedCustomerFavoriteItem;
      dish: PublicDish;
      variant: PublicDishVariant;
      flatOptions: OnlineOrderItemOption[];
      unitPrice: number;
    }> = [];

    for (const fav of savedFavoriteItems) {
      const dish = dishesById.get(fav.dishId);
      if (!dish || !dish.variants || dish.variants.length === 0) continue;
      if (q) {
        const matchEn = dish.name.toLowerCase().includes(q);
        const matchTh = (dish.nameTh || '').toLowerCase().includes(q);
        const matchLoc = getLocalizedText(lang, dish.nameTh || dish.name, dish.name)
          .toLowerCase()
          .includes(q);
        const matchNote = (fav.notes || '').toLowerCase().includes(q);
        if (!matchEn && !matchTh && !matchLoc && !matchNote) continue;
      }
      const variant = dish.variants.find((v) => v.id === fav.variantId) || dish.variants[0];
      const flatOptions: OnlineOrderItemOption[] = [];
      let extra = 0;

      for (const gId of dish.optionGroupIds || []) {
        const grp = optionGroupMap.get(gId);
        if (!grp) continue;
        const chosenMap = fav.selectedOptions?.[gId] || {};
        for (const [cId, rawQty] of Object.entries(chosenMap)) {
          if (!rawQty || rawQty <= 0) continue;
          const choice = grp.choices.find((c) => c.id === cId);
          if (!choice) continue;
          const allowQty = isOptionChoiceQuantityEnabled(choice);
          const effQty = allowQty ? Math.max(1, Math.round(rawQty)) : 1;
          const baseChoiceName = getLocalizedText(lang, choice.nameTh || choice.name, choice.name);
          const linePrice = calculateOptionChoiceLinePrice(choice.price, effQty);
          extra += linePrice;
          flatOptions.push({
            groupId: grp.id,
            groupName: getLocalizedText(lang, grp.nameTh || grp.name, grp.name),
            choiceId: choice.id,
            choiceName: formatOptionChoiceDisplayName(baseChoiceName, effQty),
            price: linePrice,
            ...(allowQty ? { quantity: effQty } : {}),
          });
        }
      }

      list.push({
        fav,
        dish,
        variant,
        flatOptions,
        unitPrice: Math.max(0, variant.price + extra),
      });
    }

    return list;
  }, [savedFavoriteItems, store?.dishes, optionGroupMap, lang, searchQuery]);

  const savedFavoriteDishIdSet = useMemo(
    () => new Set(savedFavoriteItems.map((f) => f.dishId)),
    [savedFavoriteItems]
  );

  const bareFavoriteDishes = useMemo(() => {
    if (selectedCategoryId !== 'favorites') return filteredDishes;
    return filteredDishes.filter((d) => !savedFavoriteDishIdSet.has(d.id));
  }, [filteredDishes, selectedCategoryId, savedFavoriteDishIdSet]);

  const totalFavoritesCount = useMemo(() => {
    const bareOnlyCount = favoriteDishIds.filter((id) => !savedFavoriteDishIdSet.has(id)).length;
    return savedFavoriteItems.length + bareOnlyCount;
  }, [savedFavoriteItems.length, favoriteDishIds, savedFavoriteDishIdSet]);

  const handleToggleFavoriteDish = (dishId: string) => {
    setFavoriteDishIds(toggleCustomerFavoriteDishId(dishId, storeId));
  };

  const openDishModal = (dish: PublicDish, existingFavorite?: SavedCustomerFavoriteItem) => {
    const defaultVariant =
      (existingFavorite
        ? dish.variants.find((v) => v.id === existingFavorite.variantId)
        : null) ||
      dish.variants[0] ||
      null;

    const initOpts: Record<string, Record<string, number>> = {};
    for (const gId of dish.optionGroupIds || []) {
      const grp = optionGroupMap.get(gId);
      if (!grp) continue;
      if (existingFavorite?.selectedOptions?.[gId]) {
        const favMap: Record<string, number> = {};
        for (const [cId, qty] of Object.entries(existingFavorite.selectedOptions[gId])) {
          const ch = grp.choices.find((c) => c.id === cId);
          if (ch && qty > 0) {
            favMap[cId] = isOptionChoiceQuantityEnabled(ch) ? Math.max(1, Math.round(qty)) : 1;
          }
        }
        if (Object.keys(favMap).length > 0) {
          initOpts[gId] = favMap;
        }
      } else if (grp.minSelect > 0 && grp.choices.length > 0) {
        const grpMap: Record<string, number> = {};
        grp.choices.slice(0, grp.minSelect).forEach((c) => {
          grpMap[c.id] = getOptionChoiceEffectiveQuantity(c);
        });
        initOpts[gId] = grpMap;
      }
    }

    setActiveDish(dish);
    setSelectedVariant(defaultVariant);
    setSelectedOptions(initOpts);
    setItemNote(existingFavorite?.notes || '');
    setItemQty(1);
    setOptionValidationMsg(null);
    setEditingFavoriteId(existingFavorite?.id ?? null);
    setFavoriteSavedNotice(null);
  };

  const handleSaveCurrentDishFavorite = () => {
    if (!activeDish || !selectedVariant) return;
    for (const gId of activeDish.optionGroupIds || []) {
      const grp = optionGroupMap.get(gId);
      if (!grp) continue;
      const count = Object.values(selectedOptions[gId] || {}).filter((q) => q > 0).length;
      if (count < grp.minSelect) {
        const gLabel = getLocalizedText(lang, grp.nameTh || grp.name, grp.name);
        setOptionValidationMsg(
          lang === 'th'
            ? `กรุณาเลือก "${gLabel}" อย่างน้อย ${grp.minSelect} รายการก่อนบันทึกรายการโปรด`
            : `Please select at least ${grp.minSelect} for "${gLabel}" before saving favorite`
        );
        return;
      }
    }

    const updated = upsertSavedCustomerFavoriteItem({
      ...(editingFavoriteId ? { id: editingFavoriteId } : {}),
      storeId,
      dishId: activeDish.id,
      variantId: selectedVariant.id,
      selectedOptions,
      notes: itemNote,
    });
    setSavedFavoriteItems(updated);
    setFavoriteDishIds(loadCustomerFavoriteDishIds(storeId));
    setOptionValidationMsg(null);
    if (!editingFavoriteId && updated[0]) {
      setEditingFavoriteId(updated[0].id);
    }
    setFavoriteSavedNotice(
      editingFavoriteId
        ? lang === 'th'
          ? 'บันทึกการแก้ไขรายการโปรดแล้ว ✓'
          : 'Favorite updated ✓'
        : lang === 'th'
        ? 'บันทึกลงรายการโปรดพร้อมตัวเลือกแล้ว ✓'
        : 'Saved to favorites with options ✓'
    );
  };

  const handleDeleteSavedFavorite = (fav: SavedCustomerFavoriteItem) => {
    const next = deleteSavedCustomerFavoriteItem(fav.id, storeId);
    setSavedFavoriteItems(next);
  };

  const handleAddSavedFavoriteToCart = (item: {
    fav: SavedCustomerFavoriteItem;
    dish: PublicDish;
    variant: PublicDishVariant;
    flatOptions: OnlineOrderItemOption[];
    unitPrice: number;
  }) => {
    if (isStoreClosed) return;
    // Verify required option groups are still satisfied
    for (const gId of item.dish.optionGroupIds || []) {
      const grp = optionGroupMap.get(gId);
      if (!grp) continue;
      const count = Object.values(item.fav.selectedOptions?.[gId] || {}).filter((q) => q > 0).length;
      if (count < grp.minSelect) {
        openDishModal(item.dish, item.fav);
        return;
      }
    }

    const dishLabel = getLocalizedText(lang, item.dish.nameTh || item.dish.name, item.dish.name);
    const varLabel = getLocalizedText(
      lang,
      item.variant.nameTh || item.variant.name,
      item.variant.name
    );
    const optionSig = item.flatOptions
      .map((o) => `${o.choiceId}:${o.quantity ?? 1}`)
      .sort()
      .join(',');
    const noteTrim = (item.fav.notes || '').trim();
    const key = `${item.dish.id}::${item.variant.id}::${optionSig}::${noteTrim}`;

    setCart((prev) => {
      const idx = prev.findIndex((c) => c.key === key);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [
        ...prev,
        {
          key,
          dishId: item.dish.id,
          dishName: dishLabel,
          variantId: item.variant.id,
          variantName: varLabel,
          unitPrice: item.unitPrice,
          quantity: 1,
          ...(noteTrim ? { notes: noteTrim } : {}),
          options: item.flatOptions,
        },
      ];
    });
  };

  const toggleOptionChoice = (group: PublicOptionGroup, choice: PublicOptionChoice) => {
    setOptionValidationMsg(null);
    setSelectedOptions((prev) => ({
      ...prev,
      [group.id]: toggleOptionChoiceMap(prev[group.id] || {}, choice, group.maxSelect),
    }));
  };

  const updateOptionChoiceQty = (
    group: PublicOptionGroup,
    choice: PublicOptionChoice,
    nextQuantity: number
  ) => {
    setOptionValidationMsg(null);
    setSelectedOptions((prev) => ({
      ...prev,
      [group.id]: updateOptionChoiceQuantityMap(
        prev[group.id] || {},
        choice,
        nextQuantity,
        group.maxSelect
      ),
    }));
  };

  const activeDishLiveUnitPrice = useMemo(() => {
    if (!activeDish || !selectedVariant) return 0;
    let extra = 0;
    for (const gId of activeDish.optionGroupIds || []) {
      const grp = optionGroupMap.get(gId);
      if (!grp) continue;
      const chosenMap = selectedOptions[gId] || {};
      for (const [cId, rawQty] of Object.entries(chosenMap)) {
        if (!rawQty || rawQty <= 0) continue;
        const choice = grp.choices.find((c) => c.id === cId);
        if (choice) {
          const effQty = isOptionChoiceQuantityEnabled(choice)
            ? Math.max(1, Math.round(rawQty))
            : 1;
          extra += calculateOptionChoiceLinePrice(choice.price, effQty);
        }
      }
    }
    return Math.max(0, selectedVariant.price + extra);
  }, [activeDish, selectedVariant, selectedOptions, optionGroupMap]);

  const handleAddToCart = () => {
    if (!activeDish || !selectedVariant) return;

    // Validate minSelect
    for (const gId of activeDish.optionGroupIds || []) {
      const grp = optionGroupMap.get(gId);
      if (!grp) continue;
      const count = Object.values(selectedOptions[gId] || {}).filter((q) => q > 0).length;
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
      const chosenMap = selectedOptions[gId] || {};
      for (const [cId, rawQty] of Object.entries(chosenMap)) {
        if (!rawQty || rawQty <= 0) continue;
        const choice = grp.choices.find((c) => c.id === cId);
        if (choice) {
          const allowQty = isOptionChoiceQuantityEnabled(choice);
          const effQty = allowQty ? Math.max(1, Math.round(rawQty)) : 1;
          const baseChoiceName = getLocalizedText(lang, choice.nameTh || choice.name, choice.name);
          const linePrice = calculateOptionChoiceLinePrice(choice.price, effQty);
          optionsExtra += linePrice;
          flatOptions.push({
            groupId: grp.id,
            groupName: getLocalizedText(lang, grp.nameTh || grp.name, grp.name),
            choiceId: choice.id,
            choiceName: formatOptionChoiceDisplayName(baseChoiceName, effQty),
            price: linePrice,
            ...(allowQty ? { quantity: effQty } : {}),
          });
        }
      }
    }

    const unitPrice = Math.max(0, selectedVariant.price + optionsExtra);
    const dishLabel = getLocalizedText(lang, activeDish.nameTh || activeDish.name, activeDish.name);
    const varLabel = getLocalizedText(lang, selectedVariant.nameTh || selectedVariant.name, selectedVariant.name);
    const optionSig = flatOptions
      .map((o) => `${o.choiceId}:${o.quantity ?? 1}`)
      .sort()
      .join(',');
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

  const handleProceedToOrderReview = (e: React.FormEvent) => {
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

    setSubmitError(null);
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

    setReviewSecondsLeft(120);
    setIsOrderReviewOpen(true);
  };

  const handleConfirmAndSendOrder = async () => {
    if (!store || !storeId || cart.length === 0 || reviewSecondsLeft <= 0) return;

    const trimmedName = customerName.trim();
    const trimmedPhone = customerPhone.trim();
    const trimmedAddr = deliveryAddress.trim();

    setIsSubmitting(true);
    setSubmitError(null);

    try {
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
      setIsOrderReviewOpen(false);
      setIsCheckoutOpen(false);
      setIsOrdersOpen(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const applySavedAddress = (addr: SavedCustomerAddress) => {
    setSelectedAddressId(addr.id);
    setDeliveryAddress(addr.address);
    setDeliveryLat(addr.lat ?? null);
    setDeliveryLng(addr.lng ?? null);
    if (addr.customerName.trim()) setCustomerName(addr.customerName);
    if (addr.customerPhone.trim()) setCustomerPhone(addr.customerPhone);
    setSubmitError(null);
  };

  const handleSaveCustomerAddress = (data: {
    id?: string;
    label: string;
    customerName: string;
    customerPhone: string;
    address: string;
    lat: number | null;
    lng: number | null;
    isDefault: boolean;
  }) => {
    const prevIds = new Set(savedAddresses.map((a) => a.id));
    const nextList = upsertSavedCustomerAddress(data);
    setSavedAddresses(nextList);
    const savedEntry =
      (data.id ? nextList.find((a) => a.id === data.id) : null) ||
      nextList.find((a) => !prevIds.has(a.id)) ||
      nextList[0];
    if (savedEntry) {
      applySavedAddress(savedEntry);
      saveCustomerInfo({
        customerName: savedEntry.customerName || customerName,
        customerPhone: savedEntry.customerPhone || customerPhone,
        deliveryAddress: savedEntry.address,
        customerNote,
        orderMode,
        paymentMethod,
        deliveryLat: savedEntry.lat,
        deliveryLng: savedEntry.lng,
      });
    }
    setIsAddressModalOpen(false);
    setEditingAddressTarget(null);
  };

  const handleDeleteSavedAddress = (id: string) => {
    const nextList = deleteSavedCustomerAddress(id);
    setSavedAddresses(nextList);
    if (selectedAddressId === id) {
      const nextDefault = nextList.find((a) => a.isDefault) || nextList[0] || null;
      if (nextDefault) {
        applySavedAddress(nextDefault);
      } else {
        setSelectedAddressId(null);
        setDeliveryAddress('');
        setDeliveryLat(null);
        setDeliveryLng(null);
      }
    }
  };

  const handleConfirmCancelOrder = async (orderId: string) => {
    setCancellingOrderId(orderId);
    setCancelOrderError(null);
    try {
      await cancelOnlineOrderByCustomer(orderId);
      setCancelConfirmOrderId(null);
    } catch (err) {
      setCancelOrderError(err instanceof Error ? err.message : String(err));
    } finally {
      setCancellingOrderId(null);
    }
  };

  const handleReorderOrder = (ord: OnlineOrderDoc) => {
    if (!ord.items || ord.items.length === 0) return;

    const dishesById = new Map((store?.dishes || []).map((d) => [d.id, d]));

    const nextEntries: CartEntry[] = ord.items.map((item) => {
      const liveDish = dishesById.get(item.dishId);
      const liveVariant = liveDish?.variants.find((v) => v.id === item.variantId) || liveDish?.variants[0];

      const resolvedOptions: OnlineOrderItemOption[] = (item.options || []).map((opt) => {
        const liveGroup = optionGroupMap.get(opt.groupId);
        const liveChoice = liveGroup?.choices.find((c) => c.id === opt.choiceId);
        if (liveGroup && liveChoice) {
          const effQty = isOptionChoiceQuantityEnabled(liveChoice)
            ? Math.max(1, Math.round(opt.quantity ?? 1))
            : 1;
          const baseName = getLocalizedText(lang, liveChoice.nameTh || liveChoice.name, liveChoice.name);
          const linePrice = calculateOptionChoiceLinePrice(liveChoice.price, effQty);
          return {
            groupId: liveGroup.id,
            groupName: getLocalizedText(lang, liveGroup.nameTh || liveGroup.name, liveGroup.name),
            choiceId: liveChoice.id,
            choiceName: formatOptionChoiceDisplayName(baseName, effQty),
            price: linePrice,
            ...(isOptionChoiceQuantityEnabled(liveChoice) ? { quantity: effQty } : {}),
          };
        }
        return { ...opt };
      });

      const optsExtra = resolvedOptions.reduce((sum, o) => sum + (Number(o.price) || 0), 0);
      const unitPrice = liveVariant
        ? Math.max(0, liveVariant.price + optsExtra)
        : Math.max(0, Number(item.unitPrice) || 0);
      const dishName = liveDish
        ? getLocalizedText(lang, liveDish.nameTh || liveDish.name, liveDish.name)
        : item.dishName;
      const variantName = liveVariant
        ? getLocalizedText(lang, liveVariant.nameTh || liveVariant.name, liveVariant.name)
        : item.variantName;
      const optionSig = resolvedOptions
        .map((o) => `${o.choiceId}:${o.quantity ?? 1}`)
        .sort()
        .join(',');
      const noteTrim = (item.notes || '').trim();
      const variantId = liveVariant?.id || item.variantId;
      const key = `${item.dishId}::${variantId}::${optionSig}::${noteTrim}`;

      return {
        key,
        dishId: item.dishId,
        dishName,
        variantId,
        variantName,
        unitPrice,
        quantity: Math.max(1, item.quantity || 1),
        ...(noteTrim ? { notes: noteTrim } : {}),
        options: resolvedOptions,
      };
    });

    setCart((prev) => {
      const merged = [...prev];
      for (const entry of nextEntries) {
        const idx = merged.findIndex((c) => c.key === entry.key);
        if (idx >= 0) {
          merged[idx] = { ...merged[idx], quantity: merged[idx].quantity + entry.quantity };
        } else {
          merged.push(entry);
        }
      }
      return merged;
    });

    if (ord.orderMode === 'delivery' && store?.onlineDeliveryEnabled !== false) {
      setOrderMode('delivery');
    } else if (ord.orderMode === 'pickup' && store?.onlinePickupEnabled !== false) {
      setOrderMode('pickup');
    }

    setIsOrdersOpen(false);
    setIsCheckoutOpen(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex flex-col items-center justify-center p-6 text-slate-800 relative">
        <div className="absolute top-4 right-4">
          <LanguageToggle lang={lang} onToggleLang={handleSwitchLang} compact />
        </div>
        <Loader2 className="w-8 h-8 animate-spin text-orange-600 mb-3" />
        <p className="text-sm font-bold">{lang === 'th' ? 'กำลังโหลดเมนูอาหาร...' : 'Loading storefront menu...'}</p>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-6 relative">
        <div className="absolute top-4 right-4">
          <LanguageToggle lang={lang} onToggleLang={handleSwitchLang} compact />
        </div>
        <div className="max-w-md w-full bg-white rounded-3xl border border-rose-200 p-6 text-center space-y-4 shadow-sm">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
          <div className="space-y-1.5">
            <h2 className="text-lg font-extrabold text-slate-900">
              {lang === 'th' ? 'ไม่สามารถเชื่อมต่อระบบสั่งอาหารได้' : 'Storefront Connection Error'}
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">{authError}</p>
          </div>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-orange-600 bg-gradient-to-r from-orange-500 to-red-600 text-white text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{lang === 'th' ? 'ลองโหลดใหม่อีกครั้ง' : 'Retry'}</span>
          </button>
        </div>
      </div>
    );
  }

  if (!store || !storeId) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-6 relative">
        <div className="absolute top-4 right-4">
          <LanguageToggle lang={lang} onToggleLang={handleSwitchLang} compact />
        </div>
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
        <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center justify-between gap-2.5">
          <div className="min-w-0 flex items-center gap-2.5 sm:gap-3">
            <img
              src={STORE_LOGO_SRC}
              alt={lang === 'th' ? 'โลโก้ร้าน' : 'Store Logo'}
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-contain bg-white border border-orange-200 shadow-2xs shrink-0"
            />
            <div className="min-w-0 flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
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
                <span className="inline-flex items-center gap-1 shrink-0">
                  <Clock className="w-3 h-3 text-orange-500" />
                  ~{store.onlineEstimatedPrepMinutes || 20}{' '}
                  {lang === 'th' ? 'นาที' : 'mins'}
                </span>
                {store.shopPhone && (
                  <span className="hidden xs:inline-flex sm:inline-flex items-center gap-1 truncate">
                    <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="truncate">{store.shopPhone}</span>
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsOrdersOpen(true)}
              aria-label={lang === 'th' ? 'ติดตามออเดอร์ / ประวัติการซื้อ' : 'Track orders'}
              className="min-h-[38px] px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
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
            <LanguageToggle lang={lang} onToggleLang={handleSwitchLang} compact />
            <button
              type="button"
              onClick={() => setIsMenuOpen(true)}
              aria-label={lang === 'th' ? 'เปิดเมนูร้านค้า' : 'Open menu'}
              className="min-h-[38px] w-[38px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center justify-center cursor-pointer relative shrink-0"
            >
              <Menu className="w-5 h-5" />
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
            <button
              type="button"
              onClick={() => setSelectedCategoryId('favorites')}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors inline-flex items-center gap-1.5 ${
                selectedCategoryId === 'favorites'
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Heart
                className={`w-3.5 h-3.5 ${
                  selectedCategoryId === 'favorites'
                    ? 'fill-white text-white'
                    : 'fill-rose-500 text-rose-500'
                }`}
              />
              <span>{lang === 'th' ? 'รายการโปรด' : 'Favorites'}</span>
              {totalFavoritesCount > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-extrabold tabular-nums ${
                    selectedCategoryId === 'favorites'
                      ? 'bg-white/25 text-white'
                      : 'bg-white text-rose-600'
                  }`}
                >
                  {totalFavoritesCount}
                </span>
              )}
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

      {/* Main Dish Grid + Customized Saved Favorites Section */}
      <main className="max-w-5xl mx-auto px-4 py-4 space-y-5">
        {selectedCategoryId === 'favorites' && resolvedSavedFavorites.length > 0 && (
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                <Heart className="w-3.5 h-3.5 fill-rose-500 text-rose-500" />
                <span>
                  {lang === 'th'
                    ? 'รายการโปรดที่บันทึกตัวเลือกไว้ (แก้ไขและสั่งซ้ำได้ทันที)'
                    : 'Saved Customized Favorites (Edit or Add Directly)'}
                </span>
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {resolvedSavedFavorites.map((entry) => {
                const { fav, dish, variant, flatOptions, unitPrice } = entry;
                const title = getLocalizedText(lang, dish.nameTh || dish.name, dish.name);
                const variantLabel = getLocalizedText(
                  lang,
                  variant.nameTh || variant.name,
                  variant.name
                );
                const photoUrl = dish.imageId ? dishImages[dish.imageId] : null;
                return (
                  <div
                    key={fav.id}
                    className="bg-white rounded-2xl border border-rose-200 p-3.5 flex flex-col justify-between gap-3 shadow-2xs"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-20 h-20 rounded-xl bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center border border-slate-100">
                        {photoUrl ? (
                          <img src={photoUrl} alt={title} className="w-full h-full object-cover" />
                        ) : (
                          <ShoppingBag className="w-6 h-6 text-slate-300" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="font-bold text-sm text-slate-900 line-clamp-1">
                          {title}
                        </div>
                        {variantLabel && variantLabel !== 'Standard' && (
                          <div className="text-[11px] font-semibold text-orange-700">
                            {variantLabel}
                          </div>
                        )}
                        {flatOptions.length > 0 ? (
                          <div className="text-[11px] text-slate-600 leading-snug">
                            + {flatOptions.map((o) => o.choiceName).join(', ')}
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400">
                            {lang === 'th' ? 'ไม่มีตัวเลือกเพิ่มเติม' : 'Standard options'}
                          </div>
                        )}
                        {fav.notes && (
                          <div className="text-[11px] text-amber-700 font-semibold">
                            * {fav.notes}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-slate-100">
                      <span className="font-black text-sm text-orange-600 tabular-nums">
                        ฿{formatMoney(unitPrice)}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openDishModal(dish, fav)}
                          disabled={isStoreClosed}
                          aria-label={lang === 'th' ? 'แก้ไขตัวเลือกรายการโปรด' : 'Edit favorite options'}
                          className="min-h-[34px] px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>{lang === 'th' ? 'แก้ไข' : 'Edit'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSavedFavorite(fav)}
                          aria-label={lang === 'th' ? 'ลบรายการโปรด' : 'Delete favorite'}
                          className="w-8 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddSavedFavoriteToCart(entry)}
                          disabled={isStoreClosed}
                          className="min-h-[34px] px-3 py-1 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-[11px] font-extrabold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{lang === 'th' ? 'ใส่ตะกร้า' : 'Add'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {(selectedCategoryId === 'favorites' ? bareFavoriteDishes : filteredDishes).length === 0 ? (
          selectedCategoryId === 'favorites' && resolvedSavedFavorites.length > 0 ? null : (
            <div className="py-16 text-center text-slate-500 text-sm">
              {selectedCategoryId === 'favorites'
                ? lang === 'th'
                  ? 'ยังไม่มีเมนูโปรด — เปิดเมนูที่ต้องการแล้วเลือกตัวเลือก จากนั้นกด "บันทึกรายการโปรด" เพื่อบันทึกไว้สั่งครั้งหน้า'
                  : 'No favorites yet — open any dish, pick your options, and tap "Save Favorite" to store it here.'
                : lang === 'th'
                ? 'ไม่พบเมนูในหมวดหมู่นี้'
                : 'No menu items match your search.'}
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {(selectedCategoryId === 'favorites' ? bareFavoriteDishes : filteredDishes).map((dish) => {
              const title = getLocalizedText(lang, dish.nameTh || dish.name, dish.name);
              const dishDescription = getLocalizedDishDescription(
                lang,
                dish.description,
                dish.descriptionTh
              );
              const minPrice = Math.min(...dish.variants.map((v) => v.price));
              const photoUrl = dish.imageId ? dishImages[dish.imageId] : null;
              const isFavorite =
                favoriteDishIds.includes(dish.id) || savedFavoriteDishIdSet.has(dish.id);
              return (
                <div
                  key={dish.id}
                  role="button"
                  tabIndex={isStoreClosed ? -1 : 0}
                  aria-disabled={isStoreClosed}
                  onClick={() => {
                    if (!isStoreClosed) openDishModal(dish);
                  }}
                  onKeyDown={(e) => {
                    if (!isStoreClosed && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      openDishModal(dish);
                    }
                  }}
                  className={`bg-white rounded-2xl border border-slate-200 p-3 flex items-stretch gap-3.5 text-left hover:border-orange-300 transition-all ${
                    isStoreClosed ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                  }`}
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
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h2 className="font-bold text-sm text-slate-900 line-clamp-2">{title}</h2>
                        {dishDescription && (
                          <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{dishDescription}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label={
                          isFavorite
                            ? lang === 'th'
                              ? 'ลบออกจากรายการโปรด'
                              : 'Remove from favorites'
                            : lang === 'th'
                            ? 'เพิ่มในรายการโปรด'
                            : 'Add to favorites'
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFavoriteDish(dish.id);
                        }}
                        className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-rose-50 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                      >
                        <Heart
                          className={`w-4 h-4 transition-colors ${
                            isFavorite ? 'fill-rose-500 text-rose-500' : 'text-slate-400'
                          }`}
                        />
                      </button>
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
                </div>
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
              className="w-full min-h-[54px] px-5 py-3 rounded-2xl bg-orange-600 bg-gradient-to-r from-orange-500 to-red-600 text-white font-extrabold text-sm flex items-center justify-between shadow-lg shadow-orange-600/25 cursor-pointer"
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
              <div className="min-w-0">
                <h3 className="font-extrabold text-base text-slate-900 truncate">
                  {getLocalizedText(lang, activeDish.nameTh || activeDish.name, activeDish.name)}
                </h3>
                {editingFavoriteId && (
                  <div className="text-[11px] font-bold text-rose-600">
                    {lang === 'th' ? 'กำลังแก้ไขรายการโปรด' : 'Editing Saved Favorite'}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleSaveCurrentDishFavorite}
                  className={`min-h-[36px] px-2.5 py-1.5 rounded-xl border text-[11px] font-extrabold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                    editingFavoriteId
                      ? 'bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700'
                  }`}
                >
                  <Heart
                    className={`w-3.5 h-3.5 ${
                      editingFavoriteId || savedFavoriteDishIdSet.has(activeDish.id)
                        ? 'fill-rose-500 text-rose-500'
                        : 'text-rose-500'
                    }`}
                  />
                  <span>
                    {editingFavoriteId
                      ? lang === 'th'
                        ? 'บันทึกการแก้ไขโปรด'
                        : 'Save Favorite'
                      : lang === 'th'
                      ? 'บันทึกรายการโปรด'
                      : 'Save Favorite'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveDish(null);
                    setEditingFavoriteId(null);
                    setFavoriteSavedNotice(null);
                  }}
                  className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="modal-body space-y-5">
              {(() => {
                const activeDesc = getLocalizedDishDescription(
                  lang,
                  activeDish.description,
                  activeDish.descriptionTh
                );
                return activeDesc ? (
                  <p className="text-xs text-slate-600 leading-relaxed">{activeDesc}</p>
                ) : null;
              })()}
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
                const selectedMap = selectedOptions[gId] || {};
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
                        const chosenQty = selectedMap[ch.id] || 0;
                        const checked = chosenQty > 0;
                        const allowQty = isOptionChoiceQuantityEnabled(ch);
                        const unitPrice = Math.max(0, Number(ch.price) || 0);
                        const linePrice = checked
                          ? calculateOptionChoiceLinePrice(unitPrice, chosenQty)
                          : unitPrice;
                        const choiceLabel = getLocalizedText(lang, ch.nameTh || ch.name, ch.name);

                        if (allowQty) {
                          return (
                            <div
                              key={ch.id}
                              className={`w-full min-h-[46px] px-3 py-2 rounded-xl border flex items-center justify-between gap-2 transition-colors ${
                                checked
                                  ? 'bg-orange-50 border-orange-500 text-orange-950'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => toggleOptionChoice(grp, ch)}
                                className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer py-0.5"
                              >
                                <span
                                  className={`w-4 h-4 rounded-md border flex items-center justify-center text-[10px] shrink-0 ${
                                    checked
                                      ? 'bg-orange-600 border-orange-600 text-white'
                                      : 'border-slate-300 bg-white'
                                  }`}
                                >
                                  {checked ? '✓' : ''}
                                </span>
                                <div className="min-w-0">
                                  <div className={`text-xs truncate ${checked ? 'font-bold' : ''}`}>
                                    {choiceLabel}
                                  </div>
                                  {unitPrice > 0 && checked && chosenQty > 1 && (
                                    <div className="text-[10px] text-orange-700/80 font-medium tabular-nums">
                                      +฿{formatMoney(unitPrice)} / {lang === 'th' ? 'หน่วย' : 'ea'}
                                    </div>
                                  )}
                                </div>
                              </button>

                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs font-bold text-slate-600 tabular-nums">
                                  {linePrice > 0
                                    ? `+฿${formatMoney(linePrice)}`
                                    : lang === 'th'
                                    ? 'ฟรี'
                                    : 'Free'}
                                </span>

                                {checked ? (
                                  <div className="flex items-center gap-1 bg-white border border-orange-300 rounded-lg p-0.5">
                                    <button
                                      type="button"
                                      aria-label={
                                        lang === 'th' ? 'ลดจำนวนตัวเลือก' : 'Decrease option quantity'
                                      }
                                      onClick={() => updateOptionChoiceQty(grp, ch, chosenQty - 1)}
                                      className="w-7 h-7 rounded-md hover:bg-orange-50 text-slate-700 flex items-center justify-center cursor-pointer"
                                    >
                                      <Minus className="w-3.5 h-3.5" />
                                    </button>
                                    <NumericInput
                                      min={1}
                                      max={99}
                                      step={1}
                                      inputMode="numeric"
                                      fallbackValue={1}
                                      aria-label={
                                        lang === 'th' ? 'จำนวนตัวเลือก' : 'Option quantity'
                                      }
                                      value={chosenQty}
                                      onValueChange={(val) => {
                                        const next = Math.round(val);
                                        if (next >= 1) {
                                          updateOptionChoiceQty(grp, ch, next);
                                        }
                                      }}
                                      className="w-9 py-0.5 text-center text-xs font-extrabold text-slate-900 bg-transparent focus:outline-none tabular-nums"
                                    />
                                    <button
                                      type="button"
                                      aria-label={
                                        lang === 'th' ? 'เพิ่มจำนวนตัวเลือก' : 'Increase option quantity'
                                      }
                                      onClick={() => updateOptionChoiceQty(grp, ch, chosenQty + 1)}
                                      className="w-7 h-7 rounded-md hover:bg-orange-50 text-orange-700 flex items-center justify-center cursor-pointer"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => toggleOptionChoice(grp, ch)}
                                    className="px-2.5 py-1 rounded-lg bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                                  >
                                    <Plus className="w-3 h-3" />
                                    <span>{lang === 'th' ? 'ใส่จำนวน' : 'Qty'}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        }

                        return (
                          <button
                            key={ch.id}
                            type="button"
                            onClick={() => toggleOptionChoice(grp, ch)}
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
                              <span className="text-xs">{choiceLabel}</span>
                            </div>
                            <span className="text-xs font-bold text-slate-600 tabular-nums">
                              {unitPrice > 0
                                ? `+฿${formatMoney(unitPrice)}`
                                : lang === 'th'
                                ? 'ฟรี'
                                : 'Free'}
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

              {favoriteSavedNotice && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700 flex items-center gap-2">
                  <Heart className="w-4 h-4 fill-rose-500 text-rose-500 shrink-0" />
                  <span>{favoriteSavedNotice}</span>
                </div>
              )}

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
                className="flex-1 min-h-[46px] px-4 py-2.5 rounded-xl bg-orange-600 bg-gradient-to-r from-orange-500 to-red-600 text-white font-extrabold text-xs sm:text-sm cursor-pointer tabular-nums"
              >
                {lang === 'th'
                  ? `เพิ่มลงตะกร้า • ฿${formatMoney(activeDishLiveUnitPrice * itemQty)}`
                  : `Add to Cart • ฿${formatMoney(activeDishLiveUnitPrice * itemQty)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout & Cart Sheet */}
      {isCheckoutOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4">
          <form
            onSubmit={handleProceedToOrderReview}
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
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-700">
                        {lang === 'th' ? 'ที่อยู่จัดส่ง & พิกัด GPS *' : 'Delivery Address & GPS Pin *'}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleUseCurrentGps}
                          disabled={locatingGps}
                          className="text-[11px] font-bold text-emerald-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          <LocateFixed className="w-3.5 h-3.5" />
                          <span>
                            {locatingGps
                              ? lang === 'th'
                                ? 'กำลังจับพิกัด...'
                                : 'Locating...'
                              : lang === 'th'
                              ? 'ใช้ GPS ปัจจุบัน'
                              : 'Current GPS'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingAddressTarget(null);
                            setIsAddressModalOpen(true);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 text-[11px] font-extrabold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{lang === 'th' ? 'เพิ่มที่อยู่ / ปักหมุดแผนที่' : 'Add / Pin Map'}</span>
                        </button>
                      </div>
                    </div>

                    {savedAddresses.length > 0 && (
                      <div className="space-y-1.5">
                        {savedAddresses.map((addr) => {
                          const isSelected = selectedAddressId === addr.id;
                          return (
                            <div
                              key={addr.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => applySavedAddress(addr)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  applySavedAddress(addr);
                                }
                              }}
                              className={`p-2.5 rounded-xl border text-xs transition-colors cursor-pointer flex items-start justify-between gap-2 ${
                                isSelected
                                  ? 'bg-orange-50/70 border-orange-500 text-slate-900'
                                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300'
                              }`}
                            >
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-extrabold text-slate-900">
                                    {addr.label}
                                  </span>
                                  {addr.lat != null && addr.lng != null && (
                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 rounded-md inline-flex items-center gap-0.5">
                                      <MapPin className="w-2.5 h-2.5" />
                                      {lang === 'th' ? 'ปักหมุด GPS แล้ว' : 'GPS Pinned'}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-600 line-clamp-2">
                                  {addr.address}
                                </div>
                              </div>
                              <div
                                className="flex items-center gap-1 shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  aria-label={lang === 'th' ? 'แก้ไขที่อยู่' : 'Edit address'}
                                  onClick={() => {
                                    setEditingAddressTarget(addr);
                                    setIsAddressModalOpen(true);
                                  }}
                                  className="w-7 h-7 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  aria-label={lang === 'th' ? 'ลบที่อยู่' : 'Delete address'}
                                  onClick={() => handleDeleteSavedAddress(addr.id)}
                                  className="w-7 h-7 rounded-lg bg-white hover:bg-rose-50 border border-slate-200 text-rose-500 flex items-center justify-center cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

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

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {deliveryLat != null && deliveryLng != null ? (
                        <div className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1 tabular-nums">
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            GPS: {deliveryLat}, {deliveryLng}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          {lang === 'th'
                            ? 'แนะนำ: ปักหมุดแผนที่ GPS เพื่อให้ไรเดอร์มาส่งตรงจุด'
                            : 'Tip: Pin your spot on Google Maps for accurate delivery'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const currentSelected = savedAddresses.find(
                            (a) => a.id === selectedAddressId
                          );
                          setEditingAddressTarget(
                            currentSelected ||
                              (deliveryAddress.trim() || deliveryLat != null
                                ? {
                                    id: '',
                                    label: lang === 'th' ? 'ที่อยู่จัดส่ง' : 'Delivery Address',
                                    customerName,
                                    customerPhone,
                                    address: deliveryAddress,
                                    lat: deliveryLat,
                                    lng: deliveryLng,
                                    isDefault: true,
                                    updatedAt: new Date().toISOString(),
                                  }
                                : null)
                          );
                          setIsAddressModalOpen(true);
                        }}
                        className="text-[11px] font-bold text-orange-600 hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>
                          {lang === 'th'
                            ? 'เปิดแผนที่ปักหมุด / แก้ไขที่อยู่'
                            : 'Open Map Pin Picker'}
                        </span>
                      </button>
                    </div>
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
                className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-orange-600 bg-gradient-to-r from-orange-500 to-red-600 text-white font-extrabold text-sm cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <span>
                  {lang === 'th'
                    ? `ส่งรายการอาหาร • ฿${formatMoney(grandTotal)}`
                    : `Submit Order Items • ฿${formatMoney(grandTotal)}`}
                </span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Order Review & 2-Minute Countdown Confirmation Modal */}
      {isOrderReviewOpen && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-xs p-0 sm:p-4">
          <div className="modal-panel bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl border border-slate-200 shadow-2xl">
            <div className="modal-header border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-extrabold text-base text-slate-900">
                  {lang === 'th' ? 'ทบทวนรายการสั่งซื้อ' : 'Review Your Order'}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {lang === 'th'
                    ? 'รายการนี้ยังไม่ถูกส่งไปยังร้านค้า กรุณาตรวจสอบก่อนกดยืนยันออเดอร์'
                    : 'Not sent to store yet. Review all items before confirming.'}
                </p>
              </div>
              <div
                className={`px-3 py-1.5 rounded-xl border-2 text-xs font-black tabular-nums inline-flex items-center gap-1.5 shrink-0 ${
                  reviewSecondsLeft > 0
                    ? 'bg-amber-100 border-amber-400 text-amber-950'
                    : 'bg-rose-100 border-rose-400 text-rose-900'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>{formatCountdownMMSS(reviewSecondsLeft)}</span>
              </div>
            </div>

            <div className="modal-body space-y-4">
              {/* 2-Minute Decision Banner */}
              <div
                className={`p-3 rounded-2xl border text-xs font-semibold flex items-center justify-between gap-2 ${
                  reviewSecondsLeft > 0
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                <span>
                  {reviewSecondsLeft > 0
                    ? lang === 'th'
                      ? `กรุณาตรวจสอบรายการและกดปุ่ม "ยืนยันออเดอร์" ภายใน ${formatCountdownMMSS(
                          reviewSecondsLeft
                        )} นาที เพื่อส่งเข้าครัวทันที`
                      : `Review and tap "Confirm Order" within ${formatCountdownMMSS(
                          reviewSecondsLeft
                        )} to send immediately to the kitchen.`
                    : lang === 'th'
                    ? 'หมดเวลา 2 นาทีแล้ว กรุณากด "เริ่มนับใหม่" หรือ "ย้อนกลับ" เพื่อตรวจสอบอีกครั้ง'
                    : 'The 2-minute review window expired. Restart timer or go Back.'}
                </span>
                {reviewSecondsLeft === 0 && (
                  <button
                    type="button"
                    onClick={() => setReviewSecondsLeft(120)}
                    className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-[11px] font-bold shrink-0 cursor-pointer"
                  >
                    {lang === 'th' ? 'เริ่มนับใหม่' : 'Restart'}
                  </button>
                )}
              </div>

              {/* Customer & Delivery Overview */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-extrabold text-slate-900">{customerName.trim()}</span>
                  <span className="font-mono font-semibold text-slate-700 tabular-nums">
                    {customerPhone.trim()}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-slate-600 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    {orderMode === 'delivery' ? (
                      <>
                        <Truck className="w-3.5 h-3.5 text-orange-600" />
                        <span>{lang === 'th' ? 'เดลิเวอรี' : 'Delivery'}</span>
                      </>
                    ) : (
                      <>
                        <Store className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{lang === 'th' ? 'รับเองที่ร้าน' : 'Self-Pickup'}</span>
                      </>
                    )}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {paymentMethod === 'qr_payment'
                      ? 'QR PromptPay'
                      : lang === 'th'
                      ? 'เงินสดปลายทาง / หน้าร้าน'
                      : 'Cash'}
                  </span>
                </div>
                {orderMode === 'delivery' && deliveryAddress.trim() && (
                  <div className="text-[11px] text-slate-600 flex items-start gap-1.5 pt-0.5">
                    <MapPin className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
                    <span>
                      {deliveryAddress.trim()}
                      {deliveryLat != null && deliveryLng != null
                        ? ` (GPS: ${deliveryLat.toFixed(5)}, ${deliveryLng.toFixed(5)})`
                        : ''}
                    </span>
                  </div>
                )}
                {customerNote.trim() && (
                  <div className="text-[11px] text-amber-700 font-semibold">
                    * {customerNote.trim()}
                  </div>
                )}
              </div>

              {/* Ordered Items Review List */}
              <div className="space-y-1.5">
                <div className="text-xs font-extrabold text-slate-700">
                  {lang === 'th'
                    ? `รายการอาหารที่เลือก (${totalCartItems} รายการ)`
                    : `Selected Items (${totalCartItems})`}
                </div>
                <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                  {cart.map((entry) => (
                    <div key={entry.key} className="px-3.5 py-2.5 flex justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900">
                          <span className="tabular-nums">{entry.quantity}x</span> {entry.dishName}
                          {entry.variantName && entry.variantName !== 'Standard' && (
                            <span className="text-slate-500 font-normal"> ({entry.variantName})</span>
                          )}
                        </div>
                        {entry.options.length > 0 && (
                          <div className="text-[11px] text-slate-500 pl-4 mt-0.5">
                            + {entry.options.map((o) => o.choiceName).join(', ')}
                          </div>
                        )}
                        {entry.notes && (
                          <div className="text-[11px] text-amber-700 pl-4 mt-0.5">
                            * {entry.notes}
                          </div>
                        )}
                      </div>
                      <div className="font-extrabold text-slate-900 tabular-nums shrink-0">
                        ฿{formatMoney(entry.unitPrice * entry.quantity)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals Breakdown */}
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
                  <span>{lang === 'th' ? 'ยอดชำระทั้งหมด' : 'Grand Total'}</span>
                  <span className="text-orange-600 tabular-nums">฿{formatMoney(grandTotal)}</span>
                </div>
              </div>

              {submitError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
                  {submitError}
                </div>
              )}
            </div>

            <div className="modal-footer border-t border-slate-200 bg-white flex items-center gap-2.5">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setIsOrderReviewOpen(false)}
                className="min-h-[48px] px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{lang === 'th' ? 'ย้อนกลับ' : 'Back'}</span>
              </button>
              <button
                type="button"
                disabled={isSubmitting || isStoreClosed || cart.length === 0 || reviewSecondsLeft <= 0}
                onClick={handleConfirmAndSendOrder}
                className="flex-1 min-h-[48px] px-4 py-3 rounded-xl bg-orange-600 bg-gradient-to-r from-orange-500 to-red-600 text-white font-extrabold text-xs sm:text-sm cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2 tabular-nums"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>
                  {lang === 'th'
                    ? `ยืนยันออเดอร์ • ฿${formatMoney(grandTotal)}`
                    : `Confirm Order • ฿${formatMoney(grandTotal)}`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Order Tracking & Purchase History Modal */}
      {isOrdersOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-orange-600" />
                <h3 className="font-extrabold text-base text-slate-900">
                  {lang === 'th' ? 'ประวัติการซื้อ & สถานะออเดอร์' : 'Order History & Live Status'}
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
              {cancelOrderError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-start justify-between gap-2">
                  <span>{cancelOrderError}</span>
                  <button
                    type="button"
                    onClick={() => setCancelOrderError(null)}
                    className="text-rose-500 hover:text-rose-800 cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {customerOrders.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  {lang === 'th' ? 'ยังไม่มีรายการสั่งอาหารในอุปกรณ์นี้' : 'No orders placed from this device yet.'}
                </div>
              ) : (
                customerOrders.map((ord) => {
                  const badge = STATUS_BADGE[ord.status] || STATUS_BADGE.pending;
                  const created = toDateSafe(ord.createdAt);
                  const cancelWindow = canCustomerCancelOrder(ord, cancelTickNowMs);
                  const isCancelling = cancellingOrderId === ord.id;
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
                          <div key={i} className="space-y-0.5">
                            <div className="flex justify-between gap-2">
                              <span>
                                {it.quantity}x {it.dishName}
                                {it.variantName && it.variantName !== 'Standard' ? ` (${it.variantName})` : ''}
                              </span>
                              <span className="font-semibold tabular-nums">
                                ฿{formatMoney(it.unitPrice * it.quantity)}
                              </span>
                            </div>
                            {it.options && it.options.length > 0 && (
                              <div className="text-[11px] text-slate-500 pl-3">
                                + {it.options.map((o) => o.choiceName).join(', ')}
                              </div>
                            )}
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

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                        <div className="text-sm font-black text-orange-600 tabular-nums">
                          {lang === 'th' ? 'รวม ' : 'Total '}฿{formatMoney(ord.totalAmount)}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleReorderOrder(ord)}
                            className="px-2.5 py-1.5 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>{lang === 'th' ? 'สั่งซื้ออีกครั้ง' : 'Order Again'}</span>
                          </button>

                          {cancelWindow.canCancel && (
                            cancelConfirmOrderId === ord.id ? (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={isCancelling}
                                  onClick={() => handleConfirmCancelOrder(ord.id)}
                                  className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-[11px] font-bold cursor-pointer disabled:opacity-60"
                                >
                                  {isCancelling
                                    ? lang === 'th'
                                      ? 'กำลังยกเลิก...'
                                      : 'Cancelling...'
                                    : lang === 'th'
                                    ? 'ยืนยันยกเลิก'
                                    : 'Confirm'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isCancelling}
                                  onClick={() => setCancelConfirmOrderId(null)}
                                  className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-bold cursor-pointer"
                                >
                                  {lang === 'th' ? 'ไม่' : 'No'}
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setCancelConfirmOrderId(ord.id)}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer tabular-nums"
                              >
                                <Ban className="w-3.5 h-3.5" />
                                <span>
                                  {lang === 'th'
                                    ? `ยกเลิก (${formatCountdownMMSS(cancelWindow.remainingSeconds)})`
                                    : `Cancel (${formatCountdownMMSS(cancelWindow.remainingSeconds)})`}
                                </span>
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Hamburger Slide-Out Drawer Menu */}
      {isMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/55 backdrop-blur-xs"
          onClick={() => setIsMenuOpen(false)}
        >
          <aside
            aria-label={lang === 'th' ? 'เมนูหลัก' : 'Storefront Navigation Menu'}
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-80 max-w-[85vw] h-full shadow-2xl border-l border-slate-200 flex flex-col justify-between overflow-hidden"
          >
            <div className="flex flex-col min-h-0 flex-1">
              <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={STORE_LOGO_SRC}
                    alt={lang === 'th' ? 'โลโก้ร้าน' : 'Store Logo'}
                    className="w-11 h-11 rounded-full object-contain bg-white border border-orange-200 shrink-0"
                  />
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
                <button
                  type="button"
                  onClick={() => setIsMenuOpen(false)}
                  aria-label={lang === 'th' ? 'ปิดเมนู' : 'Close menu'}
                  className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center cursor-pointer shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <nav className="p-3 space-y-2 overflow-y-auto flex-1">
                <button
                  type="button"
                  onClick={() => {
                    setProfileSavedNotice(null);
                    setIsMenuOpen(false);
                    setIsCustomerProfileModalOpen(true);
                  }}
                  className="w-full p-3.5 rounded-2xl border border-slate-200 hover:border-orange-300 bg-slate-50/70 hover:bg-orange-50/50 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                      <User className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-extrabold text-sm text-slate-900">
                        {lang === 'th' ? 'ข้อมูลลูกค้า' : 'Customer Info'}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {customerName.trim()
                          ? `${customerName.trim()}${
                              customerPhone.trim() ? ` · ${customerPhone.trim()}` : ''
                            }`
                          : lang === 'th'
                          ? 'จัดการชื่อ เบอร์โทร และที่อยู่จัดส่ง'
                          : 'Manage name, phone & saved addresses'}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setIsOrdersOpen(true);
                  }}
                  className="w-full p-3.5 rounded-2xl border border-slate-200 hover:border-orange-300 bg-slate-50/70 hover:bg-orange-50/50 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center shrink-0">
                      <History className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                        <span>{lang === 'th' ? 'ประวัติการซื้อ' : 'Purchase History'}</span>
                        {customerOrders.length > 0 && (
                          <span className="px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-700 text-[10px] font-extrabold tabular-nums">
                            {customerOrders.length}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {activeOrderCount > 0
                          ? lang === 'th'
                            ? `มี ${activeOrderCount} ออเดอร์กำลังดำเนินการ`
                            : `${activeOrderCount} active orders in progress`
                          : lang === 'th'
                          ? 'ดูคำสั่งซื้อที่ผ่านมาและสั่งซ้ำ'
                          : 'View past orders & reorder'}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setIsAboutStoreModalOpen(true);
                  }}
                  className="w-full p-3.5 rounded-2xl border border-slate-200 hover:border-orange-300 bg-slate-50/70 hover:bg-orange-50/50 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                      <Info className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-extrabold text-sm text-slate-900">
                        {lang === 'th' ? 'ข้อมูลเกี่ยวกับร้าน' : 'About Store'}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {lang === 'th'
                          ? 'บริการจัดส่ง ค่าส่ง เบอร์ติดต่อ และที่อยู่ร้าน'
                          : 'Delivery options, phone & store info'}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              </nav>
            </div>

            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-600">
                {lang === 'th' ? 'ภาษา / Language' : 'Language / ภาษา'}
              </span>
              <LanguageToggle lang={lang} onToggleLang={handleSwitchLang} compact />
            </div>
          </aside>
        </div>
      )}

      {/* Customer Profile & Saved Addresses Modal */}
      {isCustomerProfileModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
          onClick={() => setIsCustomerProfileModalOpen(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              saveCustomerInfo({
                customerName: customerName.trim(),
                customerPhone: customerPhone.trim(),
                deliveryAddress: deliveryAddress.trim(),
                customerNote,
                orderMode,
                paymentMethod,
                deliveryLat,
                deliveryLng,
              });
              setProfileSavedNotice(
                lang === 'th' ? 'บันทึกข้อมูลลูกค้าเรียบร้อยแล้ว' : 'Customer profile saved!'
              );
            }}
            className="modal-panel bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl border border-slate-200 shadow-2xl"
          >
            <div className="modal-header border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-orange-600" />
                <h3 className="font-extrabold text-base text-slate-900">
                  {lang === 'th' ? 'ข้อมูลลูกค้า' : 'Customer Information'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCustomerProfileModalOpen(false)}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-4">
              {profileSavedNotice && (
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>{profileSavedNotice}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-bold text-slate-700 mb-1">
                    {lang === 'th' ? 'ชื่อลูกค้า' : 'Customer Name'}
                  </div>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                      setProfileSavedNotice(null);
                    }}
                    placeholder={lang === 'th' ? 'ระบุชื่อของคุณ' : 'Your name'}
                    className="w-full px-3 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-700 mb-1">
                    {lang === 'th' ? 'เบอร์โทรศัพท์' : 'Phone Number'}
                  </div>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => {
                      setCustomerPhone(e.target.value);
                      setProfileSavedNotice(null);
                    }}
                    placeholder="08x-xxx-xxxx"
                    className="w-full px-3 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700">
                    {lang === 'th' ? 'ที่อยู่จัดส่งที่บันทึกไว้' : 'Saved Delivery Addresses'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingAddressTarget(null);
                      setIsAddressModalOpen(true);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 text-[11px] font-extrabold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{lang === 'th' ? 'เพิ่มที่อยู่ / ปักหมุดแผนที่' : 'Add / Pin Map'}</span>
                  </button>
                </div>

                {savedAddresses.length === 0 ? (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500 text-center">
                    {lang === 'th'
                      ? 'ยังไม่มีที่อยู่ที่บันทึกไว้ กด "เพิ่มที่อยู่ / ปักหมุดแผนที่" เพื่อบันทึก'
                      : 'No saved addresses yet. Tap Add / Pin Map to save your delivery spot.'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {savedAddresses.map((addr) => {
                      const isSelected = selectedAddressId === addr.id;
                      return (
                        <div
                          key={addr.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            applySavedAddress(addr);
                            setProfileSavedNotice(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              applySavedAddress(addr);
                              setProfileSavedNotice(null);
                            }
                          }}
                          className={`p-3 rounded-xl border text-xs transition-colors cursor-pointer flex items-start justify-between gap-2 ${
                            isSelected
                              ? 'bg-orange-50/70 border-orange-500 text-slate-900'
                              : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-extrabold text-slate-900">{addr.label}</span>
                              {addr.lat != null && addr.lng != null && (
                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 rounded-md inline-flex items-center gap-0.5">
                                  <MapPin className="w-2.5 h-2.5" />
                                  {lang === 'th' ? 'ปักหมุด GPS แล้ว' : 'GPS Pinned'}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-600">{addr.address}</div>
                            {(addr.customerName || addr.customerPhone) && (
                              <div className="text-[11px] text-slate-500">
                                {[addr.customerName, addr.customerPhone].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                          <div
                            className="flex items-center gap-1 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              aria-label={lang === 'th' ? 'แก้ไขที่อยู่' : 'Edit address'}
                              onClick={() => {
                                setEditingAddressTarget(addr);
                                setIsAddressModalOpen(true);
                              }}
                              className="w-7 h-7 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={lang === 'th' ? 'ลบที่อยู่' : 'Delete address'}
                              onClick={() => handleDeleteSavedAddress(addr.id)}
                              className="w-7 h-7 rounded-lg bg-white hover:bg-rose-50 border border-slate-200 text-rose-500 flex items-center justify-center cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer border-t border-slate-200 bg-white flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsCustomerProfileModalOpen(false)}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer"
              >
                {lang === 'th' ? 'ปิด' : 'Close'}
              </button>
              <button
                type="submit"
                className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-extrabold cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>{lang === 'th' ? 'บันทึกข้อมูลลูกค้า' : 'Save Customer Info'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* About Store Information Modal */}
      {isAboutStoreModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
          onClick={() => setIsAboutStoreModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="modal-panel bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl border border-slate-200 shadow-2xl"
          >
            <div className="modal-header border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-orange-600" />
                <h3 className="font-extrabold text-base text-slate-900">
                  {lang === 'th' ? 'ข้อมูลเกี่ยวกับร้าน' : 'About Store'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAboutStoreModalOpen(false)}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-4">
              <div className="flex flex-col items-center text-center gap-2.5 py-2">
                <img
                  src={STORE_LOGO_SRC}
                  alt={lang === 'th' ? 'โลโก้ร้าน' : 'Store Logo'}
                  className="w-24 h-24 rounded-full object-contain bg-white border-2 border-orange-200 shadow-xs"
                />
                <span
                  className={`text-xs font-bold px-3 py-1 rounded-lg ${
                    isStoreClosed
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {isStoreClosed
                    ? lang === 'th'
                      ? 'ขณะนี้ร้านปิดรับออเดอร์ชั่วคราว'
                      : 'Temporarily Closed'
                    : lang === 'th'
                    ? 'เปิดให้บริการรับออเดอร์ออนไลน์'
                    : 'Open for Online Orders'}
                </span>
              </div>

              <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 bg-slate-50/70 text-xs">
                <div className="px-3.5 py-3 flex items-center justify-between gap-2">
                  <span className="text-slate-500 font-semibold flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-orange-500" />
                    {lang === 'th' ? 'เวลาเตรียมอาหารโดยประมาณ' : 'Est. Preparation Time'}
                  </span>
                  <span className="font-extrabold text-slate-900">
                    ~{store.onlineEstimatedPrepMinutes || 20} {lang === 'th' ? 'นาที' : 'mins'}
                  </span>
                </div>

                <div className="px-3.5 py-3 flex items-center justify-between gap-2">
                  <span className="text-slate-500 font-semibold flex items-center gap-1.5">
                    <Truck className="w-4 h-4 text-orange-500" />
                    {lang === 'th' ? 'รูปแบบบริการ' : 'Service Modes'}
                  </span>
                  <span className="font-extrabold text-slate-900">
                    {[
                      store.onlineDeliveryEnabled !== false
                        ? lang === 'th'
                          ? 'เดลิเวอรี'
                          : 'Delivery'
                        : null,
                      store.onlinePickupEnabled !== false
                        ? lang === 'th'
                          ? 'รับเองที่ร้าน'
                          : 'Self-Pickup'
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>

                {store.onlineDeliveryEnabled !== false && (
                  <div className="px-3.5 py-3 flex items-center justify-between gap-2">
                    <span className="text-slate-500 font-semibold">
                      {lang === 'th' ? 'ค่าบริการจัดส่ง' : 'Delivery Fee'}
                    </span>
                    <span className="font-extrabold text-orange-600 tabular-nums">
                      {(store.onlineDeliveryFee || 0) > 0
                        ? `฿${formatMoney(store.onlineDeliveryFee || 0)}`
                        : lang === 'th'
                        ? 'ส่งฟรี'
                        : 'Free'}
                    </span>
                  </div>
                )}

                <div className="px-3.5 py-3 flex items-center justify-between gap-2">
                  <span className="text-slate-500 font-semibold flex items-center gap-1.5">
                    <Banknote className="w-4 h-4 text-emerald-600" />
                    {lang === 'th' ? 'ช่องทางชำระเงิน' : 'Payment Methods'}
                  </span>
                  <span className="font-extrabold text-slate-900">
                    {qrDataUrl
                      ? lang === 'th'
                        ? 'เงินสด / QR พร้อมเพย์'
                        : 'Cash / PromptPay QR'
                      : lang === 'th'
                      ? 'เงินสดปลายทาง / หน้าร้าน'
                      : 'Cash'}
                  </span>
                </div>

                {store.shopPhone && (
                  <div className="px-3.5 py-3 flex items-center justify-between gap-2">
                    <span className="text-slate-500 font-semibold flex items-center gap-1.5">
                      <Phone className="w-4 h-4 text-orange-500" />
                      {lang === 'th' ? 'เบอร์ติดต่อร้าน' : 'Store Phone'}
                    </span>
                    <a
                      href={`tel:${store.shopPhone}`}
                      className="font-extrabold text-orange-600 hover:underline tabular-nums"
                    >
                      {store.shopPhone}
                    </a>
                  </div>
                )}

                {store.shopAddress && (
                  <div className="px-3.5 py-3 space-y-1">
                    <div className="text-slate-500 font-semibold flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-orange-500" />
                      <span>{lang === 'th' ? 'ที่ตั้งร้าน' : 'Store Address'}</span>
                    </div>
                    <p className="text-slate-800 font-medium leading-relaxed pl-5">
                      {store.shopAddress}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer border-t border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setIsAboutStoreModalOpen(false)}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-extrabold cursor-pointer"
              >
                {lang === 'th' ? 'ปิด' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Saved Address Add / Edit + Interactive Google Map Pin Modal */}
      <CustomerAddressMapModal
        isOpen={isAddressModalOpen}
        lang={lang}
        initialAddress={editingAddressTarget}
        fallbackName={customerName}
        fallbackPhone={customerPhone}
        onClose={() => {
          setIsAddressModalOpen(false);
          setEditingAddressTarget(null);
        }}
        onSave={handleSaveCustomerAddress}
      />
    </div>
  );
};
