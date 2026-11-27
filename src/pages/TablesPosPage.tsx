import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  TableDoc,
  ZoneDoc,
  DishDoc,
  DishVariant,
  CategoryDoc,
  ChannelDoc,
  BillDoc,
  OrderItem,
  OrderItemOption,
  OptionGroupDoc,
  IngredientDoc,
  SubRecipeDoc,
  PackagingDoc,
  SettingsDoc,
  Language,
  CustomerDoc,
  OnlineOrderDoc,
  OnlineOrderStatus,
} from '../types';
import { translations } from '../i18n/translations';
import {
  calculateDishVariantCost,
  calculateOptionChoiceCost,
  isOptionChoiceQuantityEnabled,
  calculateOptionChoiceLinePrice,
  formatOptionChoiceDisplayName,
  toggleOptionChoiceMap,
  updateOptionChoiceQuantityMap,
  calculateBillFinancials,
  calculateEffectiveChannelPrice,
  calculateExVatFoodCostPercent,
  extractNetPriceFromMenuPrice,
  getBusinessWorkDate,
  formatMoney,
  formatPercent,
  roundTo2,
} from '../engine/calculations';
import {
  subscribeTables,
  subscribeOpenBills,
  subscribeCollection,
  subscribeDocument,
  saveOrderToTableAtomic,
  saveCategoriesOrder,
  saveBillsOrder,
  saveDishesOrder,
  saveDocument,
  deleteDocument,
  saveImageDoc,
  getImageDoc,
  getCurrentUid,
} from '../data/db';
import {
  syncCompletedOnlineOrdersToPnl,
  updateOnlineOrderByOwner,
} from '../data/onlineDb';
import {
  buildOnlineOrderNumberingMap,
  getActiveOnlineZoneOrders,
  getActiveRiderZoneOrders,
  resolveNextReadyActionStatus,
  toDateSafe,
} from '../engine/onlineOrdering';
import {
  ONLINE_STATUS_META,
  OnlineOrderDetailModal,
  OnlineOrderReceiptModal,
} from '../components/OnlineOrderModals';
import { compressImage } from '../utils/imageCompressor';
import {
  translateThaiToEnglish,
  translateThaiDescriptionToEnglish,
  computeAutoEnglishName,
  computeAutoEnglishDescription,
  getLocalizedText,
  containsThaiCharacters,
  resolveEntityEnglishName,
  resolveBilingualDescriptionFields,
  learnShopTranslation,
} from '../utils/thaiToEnglish';
import {
  useDebouncedTranslationScheduler,
  needsEnglishReview,
} from '../hooks/useDebouncedThaiTranslation';
import { NumericInput } from '../costing/components/common/NumericInput';
import {
  MenuItem as CostMenuItem,
  MenuVariant as CostMenuVariant,
  Ingredient as CostIngredient,
  Sauce as CostSauce,
  RestaurantSettings as CostRestaurantSettings,
} from '../costing/types';
import { COST_COLLECTIONS } from '../costing/services/firebaseSyncService';
import { StorageService } from '../costing/services/storageService';
import {
  importCostingVariantToDishVariant,
  importCostingIngredientAsDishVariant,
} from '../costing/services/posBridge';
import {
  calculateSpreadsheetRowMetrics,
  resolveCostVariantLabel,
  resolveCostVariantDisplayNames,
} from '../costing/services/spreadsheetCostHelper';
import { ConfirmModal } from '../components/ConfirmModal';
import { SaveOrderModal } from '../components/SaveOrderModal';
import { PaymentModal } from '../components/PaymentModal';
import { ReceiptModal } from '../components/ReceiptModal';
import { CustomerManagerModal } from '../components/CustomerManagerModal';
import { DeliveryAddressModal } from '../components/DeliveryAddressModal';
import { TableVisual } from '../components/TableVisual';
import {
  resolvePosOrderChannels,
  getPosChannelOptionLabel,
  normalizePosChannelId,
  searchCustomers,
  extractHouseNumber,
} from '../engine/customers';
import {
  FLOOR_CANVAS_MIN_WIDTH,
  FLOOR_CANVAS_MIN_HEIGHT,
  getDynamicCanvasSize,
} from '../utils/tablePresets';
import {
  Utensils,
  Receipt,
  Printer,
  CreditCard,
  ShoppingBag,
  AlertCircle,
  X,
  Check,
  Layers,
  GripVertical,
  Upload,
  Trash2,
  Plus,
  CheckCircle2,
  Edit2,
  Link2,
  ChefHat,
  Search,
  ArrowLeft,
  ChevronRight,
  Sliders,
  AlertTriangle,
  BookOpen,
  Users,
  UserPlus,
  Phone,
  MapPin,
  Home,
  Bike,
  Clock,
  ExternalLink,
  Store,
  User,
} from 'lucide-react';
import { CENTRAL_RECIPE_BUTTON_LABELS } from '../costing/utils/centralRecipeNav';

interface Props {
  settings: SettingsDoc;
  lang: Language;
  onlineOrders?: OnlineOrderDoc[];
  onOpenFloorPlan?: () => void;
  onOpenOnlineOrdersPage?: () => void;
  onEditDish?: (dish: DishDoc, categoryId?: string | null) => void;
  onOpenCentralRecipe?: (target: { variantId?: string; menuId?: string }) => void;
}

export const TablesPosPage: React.FC<Props> = ({
  settings,
  lang,
  onlineOrders = [],
  onOpenFloorPlan,
  onOpenOnlineOrdersPage,
  onEditDish,
  onOpenCentralRecipe,
}) => {
  const t = translations[lang];

  // Firestore real-time state
  const [tables, setTables] = useState<TableDoc[]>([]);
  const [zones, setZones] = useState<ZoneDoc[]>([]);
  const [openBills, setOpenBills] = useState<BillDoc[]>([]);

  // Menu, costing, channel references
  const [dishes, setDishes] = useState<DishDoc[]>([]);
  const [categories, setCategories] = useState<CategoryDoc[]>([]);
  const [channels, setChannels] = useState<ChannelDoc[]>([]);
  const [optionGroups, setOptionGroups] = useState<OptionGroupDoc[]>([]);
  const [ingredients, setIngredients] = useState<IngredientDoc[]>([]);
  const [subRecipes, setSubRecipes] = useState<SubRecipeDoc[]>([]);
  const [packagings, setPackagings] = useState<PackagingDoc[]>([]);
  const [dishImages, setDishImages] = useState<Map<string, string>>(new Map());

  // POS Navigation & View State
  const [activeZoneId, setActiveZoneId] = useState<string>('');
  const [topViewMode, setTopViewMode] = useState<'bills' | 'floor' | 'online' | 'rider'>('bills');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null); // null = bills/floor/online/rider view visible
  const [selectedOnlineOrderId, setSelectedOnlineOrderId] = useState<string | null>(null);
  const [printingOnlineOrder, setPrintingOnlineOrder] = useState<OnlineOrderDoc | null>(null);
  const [printingOnlineOrderAutoPrint, setPrintingOnlineOrderAutoPrint] = useState(false);
  const [completingOnlineOrderId, setCompletingOnlineOrderId] = useState<string | null>(null);
  const [onlineZoneError, setOnlineZoneError] = useState<string | null>(null);

  // Active Order / Bill being created or edited
  const [activeBill, setActiveBill] = useState<BillDoc | null>(null);
  const [cartItems, setCartItems] = useState<OrderItem[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('dine_in');
  const [orderDiscount, setOrderDiscount] = useState<number>(0);

  // Customers Directory & Delivery Customer Attachment
  const [customers, setCustomers] = useState<CustomerDoc[]>([]);
  const [attachedCustomer, setAttachedCustomer] = useState<{
    customerId?: string | null;
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
  } | null>(null);
  const [customerQuickSearch, setCustomerQuickSearch] = useState<string>('');
  const [isCustomerSearchOpen, setIsCustomerSearchOpen] = useState<boolean>(false);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState<boolean>(false);
  const [customerModalInitialOpenForm, setCustomerModalInitialOpenForm] = useState<boolean>(false);
  const [customerModalInitialQuery, setCustomerModalInitialQuery] = useState<string>('');
  const [customerModalEditTarget, setCustomerModalEditTarget] = useState<CustomerDoc | null>(null);
  const [customerSelectionCallbackMode, setCustomerSelectionCallbackMode] = useState<boolean>(false);
  const [deliveryPrintTarget, setDeliveryPrintTarget] = useState<{
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    billNumber?: string;
    workDate?: string;
    items?: OrderItem[];
    grandTotal?: number;
    status?: 'saved' | 'paid' | 'voided';
  } | null>(null);

  // Dish Customization Dialog
  const [selectedDishForOptions, setSelectedDishForOptions] = useState<DishDoc | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [selectedOptionChoices, setSelectedOptionChoices] = useState<Record<string, Record<string, number>>>({});
  const [itemNotes, setItemNotes] = useState<string>('');
  const [itemQuantity, setItemQuantity] = useState<number>(1);

  // Inline POS Menu Management Modal (Create / Edit / Delete directly inside POS categories)
  const [editingDishInPos, setEditingDishInPos] = useState<DishDoc | null>(null);
  const [isCreatingDishInPos, setIsCreatingDishInPos] = useState(false);
  const [posEditPreviewUrl, setPosEditPreviewUrl] = useState<string | null>(null);
  const [posEditImageSizeKb, setPosEditImageSizeKb] = useState<number | null>(null);
  const [isUploadingPosImage, setIsUploadingPosImage] = useState(false);
  const [posImageError, setPosImageError] = useState<string | null>(null);
  const [isSavingPosDish, setIsSavingPosDish] = useState(false);
  const [pendingDeleteDish, setPendingDeleteDish] = useState<DishDoc | null>(null);
  const [isDeletingPosDish, setIsDeletingPosDish] = useState(false);
  const posManualEnKeysRef = useRef<Set<string>>(new Set());
  const posPrevDishThaiRef = useRef<string>('');
  const posPrevDishDescThaiRef = useRef<string>('');
  const posPrevVarThaiMapRef = useRef<Map<string, string>>(new Map());
  const posTranslationScheduler = useDebouncedTranslationScheduler(600);
  const lastDishNameTapRef = useRef<{ dishId: string; ts: number } | null>(null);
  const posDishFormRef = useRef<HTMLFormElement | null>(null);
  const posDishSnapshotRef = useRef<string>('');
  const [posDishModalError, setPosDishModalError] = useState<string | null>(null);
  const [posPendingRecipeNavTarget, setPosPendingRecipeNavTarget] = useState<{
    variantId?: string;
    menuId?: string;
  } | null>(null);
  const [isPosNavigatingToRecipe, setIsPosNavigatingToRecipe] = useState<boolean>(false);

  // Costing Food-Cost Primary Option Picker & Sub-Option Picker states for POS Menu Management
  const [costMenus, setCostMenus] = useState<CostMenuItem[]>(() => StorageService.getMenus());
  const [costIngredients, setCostIngredients] = useState<CostIngredient[]>(() =>
    StorageService.getIngredients()
  );
  const [costSauces, setCostSauces] = useState<CostSauce[]>(() => StorageService.getSauces());
  const [costSettings, setCostSettings] = useState<CostRestaurantSettings>(() =>
    StorageService.getSettings()
  );
  const [isPosPrimaryOptionPickerOpen, setIsPosPrimaryOptionPickerOpen] = useState(false);
  const [selectedPosCostMenuId, setSelectedPosCostMenuId] = useState<string | null>(null);
  const [posPickerSourceTab, setPosPickerSourceTab] = useState<'menus' | 'ingredients'>('menus');
  const [posPrimaryOptionSearch, setPosPrimaryOptionSearch] = useState('');
  const [isImportingPosCostOption, setIsImportingPosCostOption] = useState(false);
  const [posModalPriceOverrides, setPosModalPriceOverrides] = useState<Record<string, number>>({});
  const [isPosOptionGroupPickerOpen, setIsPosOptionGroupPickerOpen] = useState(false);
  const [posOptionGroupSearch, setPosOptionGroupSearch] = useState('');

  const serializePosDishDraft = (
    dish: DishDoc | null,
    overrides: Record<string, number>
  ) => {
    if (!dish) return '';
    return JSON.stringify({
      id: dish.id || '',
      name: dish.name || '',
      nameTh: dish.nameTh || '',
      categoryId: dish.categoryId || '',
      imageId: dish.imageId || '',
      description: dish.description || '',
      descriptionTh: dish.descriptionTh || '',
      costMenuId: dish.costMenuId || '',
      optionGroupIds: dish.optionGroupIds || [],
      variants: (dish.variants || []).map((v) => ({
        id: v.id,
        name: v.name || '',
        nameTh: v.nameTh || '',
        price: Number(v.price) || 0,
        costMenuId: v.costMenuId || '',
        costVariantId: v.costVariantId || '',
      })),
      overrides,
    });
  };

  const isPosDishModalDirty = useMemo(() => {
    if (!editingDishInPos) return false;
    return (
      serializePosDishDraft(editingDishInPos, posModalPriceOverrides) !==
      posDishSnapshotRef.current
    );
  }, [editingDishInPos, posModalPriceOverrides]);

  const closePosDishModalCleanly = () => {
    posTranslationScheduler.cancelAll();
    setEditingDishInPos(null);
    setIsCreatingDishInPos(false);
    setIsPosPrimaryOptionPickerOpen(false);
    setIsPosOptionGroupPickerOpen(false);
    setPosEditPreviewUrl(null);
    setPosEditImageSizeKb(null);
    setPosImageError(null);
    setPosModalPriceOverrides({});
    setPosDishModalError(null);
    setPosPendingRecipeNavTarget(null);
    setIsPosNavigatingToRecipe(false);
  };

  // Modals state
  const [isSaveOrderModalOpen, setIsSaveOrderModalOpen] = useState(false);
  const [targetTableIdForSave, setTargetTableIdForSave] = useState<string | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [receiptBillToView, setReceiptBillToView] = useState<BillDoc | null>(null);
  const [isCheckReceipt, setIsCheckReceipt] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [orderSavedNotice, setOrderSavedNotice] = useState<string | null>(null);
  const savedNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dishNameClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unpaid Bill Cards Drag-and-Drop Reorder State (Mouse & Touch)
  const [draggingBillId, setDraggingBillId] = useState<string | null>(null);
  const [dragOverBillId, setDragOverBillId] = useState<string | null>(null);
  const billTouchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const billTouchRef = useRef<{
    sourceId: string;
    targetId: string | null;
    active: boolean;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressBillClickRef = useRef<boolean>(false);

  // Dish Cards Drag-and-Drop Reorder State (Mouse & Touch)
  const [draggingDishId, setDraggingDishId] = useState<string | null>(null);
  const [dragOverDishId, setDragOverDishId] = useState<string | null>(null);
  const dishTouchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dishTouchRef = useRef<{
    sourceId: string;
    targetId: string | null;
    active: boolean;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressDishClickRef = useRef<boolean>(false);
  const dishEditHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dishEditHoldOriginRef = useRef<{
    dishId: string;
    startX: number;
    startY: number;
  } | null>(null);

  // Bottom Food Category Drag-and-Drop Reorder State
  const [draggingCatId, setDraggingCatId] = useState<string | null>(null);
  const [dragOverCatId, setDragOverCatId] = useState<string | null>(null);
  const touchDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchDragRef = useRef<{
    sourceId: string;
    targetId: string | null;
    active: boolean;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressCatClickRef = useRef<boolean>(false);

  // Dish Options Modal: Primary Option (Variant) Drag-and-Drop Reorder State
  const [draggingVariantId, setDraggingVariantId] = useState<string | null>(null);
  const [dragOverVariantId, setDragOverVariantId] = useState<string | null>(null);
  const variantTouchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const variantTouchRef = useRef<{
    sourceId: string;
    targetId: string | null;
    active: boolean;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressVariantClickRef = useRef<boolean>(false);

  // Maps for dynamic recipe cost calculation
  const ingredientsMap = new Map<string, IngredientDoc>(ingredients.map((i) => [i.id, i]));
  const subRecipesMap = new Map<string, SubRecipeDoc>(subRecipes.map((s) => [s.id, s]));
  const packagingMap = new Map<string, PackagingDoc>(packagings.map((p) => [p.id, p]));
  const optionGroupsMap = new Map<string, OptionGroupDoc>(optionGroups.map((g) => [g.id, g]));

  const loadedDishImageIdsRef = useRef<Map<string, string>>(new Map());
  const floorViewportRef = useRef<HTMLDivElement>(null);
  const [floorScale, setFloorScale] = useState<number>(1);

  const orderTables = tables.filter((t) => t.itemKind !== 'chair');
  const zoneTables = activeZoneId
    ? orderTables.filter((t) => t.zoneId === activeZoneId)
    : orderTables;
  const posCanvasSize = getDynamicCanvasSize(zoneTables, FLOOR_CANVAS_MIN_WIDTH, FLOOR_CANVAS_MIN_HEIGHT);

  // Connected Online Orders & Rider Zones derived state
  const activeOnlineZoneOrders = useMemo(
    () => getActiveOnlineZoneOrders(onlineOrders),
    [onlineOrders]
  );
  const activeRiderZoneOrders = useMemo(
    () => getActiveRiderZoneOrders(onlineOrders),
    [onlineOrders]
  );
  const onlineOrderNumberingMap = useMemo(
    () => buildOnlineOrderNumberingMap(onlineOrders),
    [onlineOrders]
  );
  const selectedOnlineOrder = useMemo(
    () => (selectedOnlineOrderId ? onlineOrders.find((o) => o.id === selectedOnlineOrderId) || null : null),
    [onlineOrders, selectedOnlineOrderId]
  );

  const handleOnlineZoneStatusChange = async (
    order: OnlineOrderDoc,
    nextStatus: OnlineOrderStatus
  ) => {
    setOnlineZoneError(null);
    if (
      nextStatus === 'completed' ||
      nextStatus === 'ready_for_pickup' ||
      nextStatus === 'out_for_delivery'
    ) {
      setCompletingOnlineOrderId(order.id);
    }
    try {
      await updateOnlineOrderByOwner(
        order.id,
        nextStatus,
        nextStatus === 'cancelled' ? { cancelReason: 'ร้านค้ายกเลิกออเดอร์' } : undefined
      );
      if (order.status === 'pending' && nextStatus === 'accepted') {
        setPrintingOnlineOrderAutoPrint(true);
        setPrintingOnlineOrder({ ...order, status: 'accepted' });
      }
      const updatedOrders = onlineOrders.map((o) =>
        o.id === order.id ? { ...o, status: nextStatus } : o
      );
      if (nextStatus === 'completed') {
        const uid = getCurrentUid();
        if (uid) {
          await syncCompletedOnlineOrdersToPnl({
            uid,
            orders: updatedOrders,
            settings,
            dishes,
            optionGroups,
            ingredients,
            subRecipes,
            packaging: packagings,
          });
        }
        if (selectedOnlineOrderId === order.id) {
          setSelectedOnlineOrderId(null);
        }
      } else if (
        (nextStatus === 'cancelled' || nextStatus === 'ready_for_pickup') &&
        selectedOnlineOrderId === order.id
      ) {
        setSelectedOnlineOrderId(null);
      }
    } catch (err) {
      setOnlineZoneError(
        err instanceof Error
          ? err.message
          : lang === 'th'
          ? 'อัปเดตสถานะออเดอร์ออนไลน์ไม่สำเร็จ'
          : 'Failed to update online order status'
      );
    } finally {
      setCompletingOnlineOrderId((prev) => (prev === order.id ? null : prev));
    }
  };

  // Auto-fit floor plan canvas proportionally to device viewport (Mobile, Tablet, POS, Desktop)
  useEffect(() => {
    const el = floorViewportRef.current;
    if (!el || selectedCategoryId !== null || topViewMode !== 'floor') return;

    const updateScale = () => {
      const availW = Math.max(240, el.clientWidth - 8);
      const availH = Math.max(200, el.clientHeight - 8);
      const scaleW = availW / posCanvasSize.width;
      const scaleH = availH / posCanvasSize.height;
      const fitBoth = Math.min(1.4, Math.max(0.28, Math.min(scaleW, scaleH)));
      setFloorScale(fitBoth);
    };

    updateScale();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateScale);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [selectedCategoryId, topViewMode, posCanvasSize.width, posCanvasSize.height]);

  // Setup Realtime Listeners across ALL POS tables, bills, menus, options & ingredients
  useEffect(() => {
    const unsubs = [
      subscribeTables((tbls) => setTables(tbls)),
      subscribeOpenBills((bills) => setOpenBills(bills)),
      subscribeCollection<ZoneDoc>('zones', (z) => {
        const sorted = [...z].sort((a, b) => (a.order || 0) - (b.order || 0));
        setZones(sorted);
        setActiveZoneId((prev) =>
          sorted.some((zone) => zone.id === prev) ? prev : sorted[0]?.id || ''
        );
      }),
      subscribeCollection<CategoryDoc>('categories', (c) =>
        setCategories([...c].sort((a, b) => (a.order || 0) - (b.order || 0)))
      ),
      subscribeCollection<ChannelDoc>('channels', (ch) => {
        setChannels(ch);
        const resolved = resolvePosOrderChannels(ch);
        setSelectedChannelId((prev) => normalizePosChannelId(prev, resolved));
      }),
      subscribeCollection<CustomerDoc>('customers', (custs) => {
        setCustomers(custs);
      }),
      subscribeCollection<DishDoc>('dishes', (d) => {
        setDishes([...d].sort((a, b) => (a.order || 0) - (b.order || 0)));
        const activeIds = new Set(d.map((item) => item.id));
        loadedDishImageIdsRef.current.forEach((_, dishId) => {
          if (!activeIds.has(dishId)) {
            loadedDishImageIdsRef.current.delete(dishId);
          }
        });
        d.forEach((dish) => {
          if (dish.imageId) {
            if (loadedDishImageIdsRef.current.get(dish.id) !== dish.imageId) {
              loadedDishImageIdsRef.current.set(dish.id, dish.imageId);
              getImageDoc(dish.imageId).then((imgDoc) => {
                if (imgDoc?.dataUrl) {
                  setDishImages((prev) => new Map(prev).set(dish.id, imgDoc.dataUrl));
                }
              });
            }
          } else if (loadedDishImageIdsRef.current.has(dish.id)) {
            loadedDishImageIdsRef.current.delete(dish.id);
            setDishImages((prev) => {
              const next = new Map(prev);
              next.delete(dish.id);
              return next;
            });
          }
        });
      }),
      subscribeCollection<OptionGroupDoc>('optionGroups', (og) =>
        setOptionGroups([...og].sort((a, b) => (a.order || 0) - (b.order || 0)))
      ),
      subscribeCollection<IngredientDoc>('ingredients', (ing) => setIngredients(ing)),
      subscribeCollection<SubRecipeDoc>('subRecipes', (sub) => setSubRecipes(sub)),
      subscribeCollection<PackagingDoc>('packaging', (pkg) => setPackagings(pkg)),
      subscribeCollection<CostMenuItem>(COST_COLLECTIONS.MENUS, (cloudMenus) => {
        if (cloudMenus.length > 0) {
          setCostMenus([...cloudMenus].sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99)));
        }
      }),
      subscribeCollection<CostIngredient>(COST_COLLECTIONS.INGREDIENTS, (cloudIngs) => {
        if (cloudIngs.length > 0) setCostIngredients(cloudIngs);
      }),
      subscribeCollection<CostSauce>(COST_COLLECTIONS.SAUCES, (cloudSauces) => {
        if (cloudSauces.length > 0) setCostSauces(cloudSauces);
      }),
      subscribeDocument<CostRestaurantSettings>(COST_COLLECTIONS.SETTINGS, 'default', (cloudSet) => {
        if (cloudSet) setCostSettings(cloudSet);
      }),
    ];

    return () => {
      unsubs.forEach((u) => u());
      if (billTouchTimerRef.current) clearTimeout(billTouchTimerRef.current);
      if (dishTouchTimerRef.current) clearTimeout(dishTouchTimerRef.current);
      if (dishEditHoldTimerRef.current) clearTimeout(dishEditHoldTimerRef.current);
      if (touchDragTimerRef.current) clearTimeout(touchDragTimerRef.current);
      if (variantTouchTimerRef.current) clearTimeout(variantTouchTimerRef.current);
      if (savedNoticeTimerRef.current) clearTimeout(savedNoticeTimerRef.current);
      if (dishNameClickTimerRef.current) clearTimeout(dishNameClickTimerRef.current);
    };
  }, []);

  // Strictly 3 POS channels for Current Bill selector (Dine-in, Takeaway, Delivery)
  const posChannels = useMemo(() => resolvePosOrderChannels(channels), [channels]);

  const applyCustomerFromBill = (bill?: Partial<BillDoc> | null) => {
    if (bill && (bill.customerName || bill.customerPhone || bill.deliveryAddress)) {
      setAttachedCustomer({
        customerId: bill.customerId || null,
        customerName: bill.customerName || '',
        customerPhone: bill.customerPhone || '',
        deliveryAddress: bill.deliveryAddress || '',
      });
    } else {
      setAttachedCustomer(null);
    }
    setCustomerQuickSearch('');
    setIsCustomerSearchOpen(false);
  };

  // When a table is tapped, load existing bill or prepare fresh order and enter food ordering immediately
  const handleSelectTable = (table: TableDoc) => {
    setOrderSavedNotice(null);
    if (table.currentBillId) {
      const existing = openBills.find((b) => b.id === table.currentBillId);
      if (existing) {
        setActiveBill(existing);
        setCartItems(existing.items);
        setSelectedChannelId(normalizePosChannelId(existing.channelId, posChannels));
        setOrderDiscount(existing.discountAmount || 0);
        applyCustomerFromBill(existing);
        setSelectedCategoryId((prev) => prev || categories[0]?.id || 'all');
        return;
      }
    }

    // Fresh bill for this table
    const workDate = getBusinessWorkDate(new Date(), settings.dailyClosingTime);
    const activeCh = posChannels.find((c) => c.id === selectedChannelId) || posChannels[0];
    const newBill: BillDoc = {
      id: `bill_${Date.now()}`,
      billNumber: '',
      status: 'saved',
      workDate,
      tableId: table.id,
      tableName: table.name,
      channelId: activeCh?.id || 'dine_in',
      channelName: activeCh?.name || 'Dine-In',
      orderType: activeCh?.type || 'dine_in',
      items: [],
      subtotal: 0,
      discountAmount: 0,
      serviceChargeRate: settings.serviceChargePercent,
      serviceChargeAmount: 0,
      vatRate: settings.vatPercent,
      vatAmount: 0,
      grandTotal: 0,
      netSales: 0,
      totalFoodCost: 0,
      packagingCost: 0,
      platformFee: 0,
      payments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    setActiveBill(newBill);
    setCartItems([]);
    setOrderDiscount(0);
    applyCustomerFromBill(null);
    setSelectedCategoryId((prev) => prev || categories[0]?.id || 'all');
  };

  // Dish Selection & Option Customizer
  const handleOpenDishOptions = (dish: DishDoc) => {
    setSelectedDishForOptions(dish);
    setSelectedVariantId(dish.variants[0]?.id || '');
    setSelectedOptionChoices({});
    setItemNotes('');
    setItemQuantity(1);
  };

  // Add customized item to cart with snapshot of price AND cost
  const handleAddToCart = () => {
    if (!selectedDishForOptions) return;

    const variant = selectedDishForOptions.variants.find((v) => v.id === selectedVariantId) || selectedDishForOptions.variants[0];
    if (!variant) return;

    // Calculate live cost snapshot for variant
    const variantCostCalc = calculateDishVariantCost(
      variant,
      ingredientsMap,
      subRecipesMap,
      packagingMap
    );

    // Calculate options price and cost snapshot
    const optionsSnapshot: OrderItemOption[] = [];
    let optionsPrice = 0;
    let optionsCost = 0;

    Object.entries(selectedOptionChoices).forEach(([groupId, chosenMap]) => {
      const group = optionGroupsMap.get(groupId);
      if (group && chosenMap) {
        Object.entries(chosenMap).forEach(([cId, rawQty]) => {
          if (!rawQty || rawQty <= 0) return;
          const choice = group.choices.find((c) => c.id === cId);
          if (choice) {
            const allowQty = isOptionChoiceQuantityEnabled(choice);
            const effQty = allowQty ? Math.max(1, Math.round(rawQty)) : 1;
            const optCostCalc = calculateOptionChoiceCost(choice, ingredientsMap, effQty);
            const linePrice = calculateOptionChoiceLinePrice(choice.price || 0, effQty);
            optionsPrice += linePrice;
            optionsCost += optCostCalc.cost;

            const baseChoiceName = lang === 'th' && choice.nameTh ? choice.nameTh : choice.name;
            optionsSnapshot.push({
              groupId: group.id,
              groupName: lang === 'th' && group.nameTh ? group.nameTh : group.name,
              choiceId: choice.id,
              choiceName: formatOptionChoiceDisplayName(baseChoiceName, effQty),
              price: linePrice,
              cost: optCostCalc.cost,
              ...(allowQty ? { quantity: effQty } : {}),
            });
          }
        });
      }
    });

    const currentChannel = posChannels.find((c) => c.id === selectedChannelId) || posChannels[0];
    const isDineIn = currentChannel?.type === 'dine_in';
    const effectiveVariantPrice = calculateEffectiveChannelPrice(variant.price || 0, currentChannel);
    const unitPrice = effectiveVariantPrice + optionsPrice;

    // Strictly separate Food COGS from packaging:
    // Packaging from recipe variant applies ONLY for takeaway/delivery channels, never dine-in.
    const foodCostSnapshot = roundTo2(variantCostCalc.foodCost + optionsCost);
    const packagingCostSnapshot = isDineIn ? 0 : roundTo2(variantCostCalc.packagingCost);
    const totalUnitCostSnapshot = roundTo2(foodCostSnapshot + packagingCostSnapshot);

    const resolvedVariantNames = resolveCostVariantDisplayNames(
      selectedDishForOptions,
      variant,
      costMenus
    );
    const displayVariantTh = resolvedVariantNames.nameTh || variant.nameTh || variant.name;
    const displayVariantEn = resolvedVariantNames.name || variant.name || displayVariantTh;

    const newItem: OrderItem = {
      dishId: selectedDishForOptions.id,
      dishName: lang === 'th' && selectedDishForOptions.nameTh ? selectedDishForOptions.nameTh : selectedDishForOptions.name,
      variantId: variant.id,
      variantName: lang === 'th' ? displayVariantTh : displayVariantEn,
      unitPrice,
      dishCostSnapshot: foodCostSnapshot,
      optionsCostSnapshot: optionsCost,
      foodCostSnapshot,
      packagingCostSnapshot,
      totalUnitCostSnapshot,
      quantity: itemQuantity,
      ...(itemNotes.trim() ? { notes: itemNotes.trim() } : {}),
      options: optionsSnapshot,
      hasRecipe: variantCostCalc.hasRecipe,
    };

    setCartItems((prev) => [...prev, newItem]);
    setSelectedDishForOptions(null);
  };

  const handleUpdateItemQuantity = (index: number, newQty: number) => {
    if (newQty <= 0) {
      setCartItems((prev) => prev.filter((_, i) => i !== index));
    } else {
      setCartItems((prev) =>
        prev.map((item, i) => (i === index ? { ...item, quantity: newQty } : item))
      );
    }
  };

  // Compute live cart financials with USALI standards
  const currentChannel = posChannels.find((c) => c.id === selectedChannelId) || posChannels[0];
  const isDeliveryChannel = currentChannel?.type === 'delivery';
  const filteredQuickCustomers = useMemo(
    () => searchCustomers(customers, customerQuickSearch).slice(0, 8),
    [customers, customerQuickSearch]
  );

  const financials = calculateBillFinancials(
    cartItems,
    orderDiscount,
    settings.serviceChargePercent,
    settings.vatPercent,
    currentChannel,
    {
      pricesIncludeVat: settings.pricesIncludeVat,
      serviceChargeIncludedInPrice: settings.serviceChargeIncludedInPrice,
      serviceChargeTreatment: settings.serviceChargeTreatment,
      commissionBase: settings.commissionBase,
      commissionVatAsCost: settings.commissionVatAsCost,
    }
  );

  // Save order directly to a specific table (or null for Takeaway/Delivery) atomically
  const saveOrderToTable = async (
    tableId: string | null,
    returnToCurrentBills: boolean = false
  ): Promise<BillDoc | null> => {
    if (cartItems.length === 0 || isSavingOrder) return null;
    if (!tableId && currentChannel?.type === 'dine_in') return null;

    setIsSavingOrder(true);
    const targetTable = tableId ? tables.find((t) => t.id === tableId) : undefined;

    const workDate = getBusinessWorkDate(new Date(), settings.dailyClosingTime);
    const latestServerBill = activeBill?.id ? openBills.find((b) => b.id === activeBill.id) : undefined;
    const resolvedVersion = latestServerBill?.version ?? activeBill?.version ?? 1;
    const resolvedBillNumber = latestServerBill?.billNumber || activeBill?.billNumber || '';

    const hasCustomerSnapshot = Boolean(
      attachedCustomer &&
        (attachedCustomer.customerName.trim() ||
          attachedCustomer.customerPhone.trim() ||
          attachedCustomer.deliveryAddress.trim())
    );

    const completeBill: BillDoc = {
      id: activeBill?.id || `bill_${Date.now()}`,
      billNumber: resolvedBillNumber,
      status: 'saved',
      workDate,
      tableId: tableId || null,
      tableName: tableId ? targetTable?.name || activeBill?.tableName : undefined,
      channelId: currentChannel?.id || selectedChannelId,
      channelName: currentChannel?.name || 'Dine-In',
      orderType: currentChannel?.type || 'dine_in',
      items: cartItems,
      subtotal: financials.subtotal,
      discountAmount: financials.discountAmount,
      serviceChargeRate: settings.serviceChargePercent,
      serviceChargeAmount: financials.serviceChargeAmount,
      vatRate: settings.vatPercent,
      vatAmount: financials.vatAmount,
      grandTotal: financials.grandTotal,
      netSales: financials.netSales,
      totalFoodCost: financials.totalFoodCost,
      packagingCost: financials.packagingCost,
      platformFee: financials.platformFee,
      payments: [],
      ...(hasCustomerSnapshot && attachedCustomer
        ? {
            customerId: attachedCustomer.customerId || null,
            customerName: attachedCustomer.customerName.trim(),
            customerPhone: attachedCustomer.customerPhone.trim(),
            deliveryAddress: attachedCustomer.deliveryAddress.trim(),
          }
        : {}),
      createdAt: activeBill?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: resolvedVersion,
      order: latestServerBill?.order ?? activeBill?.order ?? openBills.length + 1,
    };

    try {
      const saved = await saveOrderToTableAtomic(completeBill, tableId);
      setIsSaveOrderModalOpen(false);
      if (returnToCurrentBills) {
        setActiveBill(null);
        setCartItems([]);
        setOrderDiscount(0);
        setTargetTableIdForSave(null);
        applyCustomerFromBill(null);
        setSelectedChannelId('dine_in');
        setSelectedCategoryId(null);
        setTopViewMode('bills');
      } else {
        setActiveBill(saved);
      }
      if (savedNoticeTimerRef.current) clearTimeout(savedNoticeTimerRef.current);
      const tblLabel =
        saved.tableName ||
        targetTable?.name ||
        (saved.orderType === 'delivery'
          ? saved.customerName
            ? `Delivery (${saved.customerName})`
            : 'Delivery'
          : lang === 'th'
          ? 'สั่งกลับบ้าน'
          : 'Takeaway');
      setOrderSavedNotice(
        lang === 'th'
          ? `บันทึกออเดอร์ ${tblLabel} เรียบร้อยแล้ว`
          : `Saved order to ${tblLabel || 'table'}`
      );
      savedNoticeTimerRef.current = setTimeout(() => {
        setOrderSavedNotice(null);
      }, 3000);
      return saved;
    } catch (err) {
      console.error('Save order error:', err);
      return null;
    } finally {
      setIsSavingOrder(false);
    }
  };

  // Confirm Order -> Save directly if table selected or Takeaway/Delivery; otherwise open Save Order Modal
  const handleInitiateConfirmOrder = async () => {
    if (cartItems.length === 0 || isSavingOrder) return;
    if (activeBill?.tableId) {
      await saveOrderToTable(activeBill.tableId, true);
      return;
    }
    if (currentChannel?.type === 'takeaway' || currentChannel?.type === 'delivery') {
      await saveOrderToTable(null, true);
      return;
    }
    setTargetTableIdForSave(null);
    setIsSaveOrderModalOpen(true);
  };

  // Save order from modal table picker and return to Current Bills
  const handleSaveOrderToTable = async () => {
    if (!targetTableIdForSave) return;
    await saveOrderToTable(targetTableIdForSave, true);
  };

  // Proceed to payment (save automatically if table selected or Takeaway/Delivery, otherwise prompt table picker)
  const handleProceedToPayment = async () => {
    if (cartItems.length === 0 || isSavingOrder) return;
    if (!activeBill?.tableId) {
      if (currentChannel?.type === 'takeaway' || currentChannel?.type === 'delivery') {
        if (!activeBill?.billNumber) {
          const saved = await saveOrderToTable(null, false);
          if (!saved) return;
        }
        setIsPaymentModalOpen(true);
        return;
      }
      setTargetTableIdForSave(null);
      setIsSaveOrderModalOpen(true);
      return;
    }
    if (!activeBill?.billNumber) {
      const saved = await saveOrderToTable(activeBill.tableId);
      if (!saved) return;
    }
    setIsPaymentModalOpen(true);
  };

  // Print Check Receipt before payment
  const handlePrintCheckReceipt = () => {
    if (!activeBill) return;
    const currentSnapshot: BillDoc = {
      ...activeBill,
      channelId: currentChannel?.id || selectedChannelId,
      channelName: currentChannel?.name || activeBill.channelName,
      orderType: currentChannel?.type || activeBill.orderType,
      ...(attachedCustomer &&
      (attachedCustomer.customerName ||
        attachedCustomer.customerPhone ||
        attachedCustomer.deliveryAddress)
        ? {
            customerId: attachedCustomer.customerId || null,
            customerName: attachedCustomer.customerName,
            customerPhone: attachedCustomer.customerPhone,
            deliveryAddress: attachedCustomer.deliveryAddress,
          }
        : {}),
      items: cartItems,
      subtotal: financials.subtotal,
      discountAmount: financials.discountAmount,
      serviceChargeAmount: financials.serviceChargeAmount,
      vatAmount: financials.vatAmount,
      grandTotal: financials.grandTotal,
      netSales: financials.netSales,
      totalFoodCost: financials.totalFoodCost,
    };
    setReceiptBillToView(currentSnapshot);
    setIsCheckReceipt(true);
    setIsReceiptModalOpen(true);
  };

  // Drag-and-drop reorder bottom food category cards & sync to Cloud Firestore
  const reorderCategoriesByIds = async (sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const sourceIdx = categories.findIndex((c) => c.id === sourceId);
    const targetIdx = categories.findIndex((c) => c.id === targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const reordered = [...categories];
    const [moved] = reordered.splice(sourceIdx, 1);
    reordered.splice(targetIdx, 0, moved);

    const updated = reordered.map((cat, idx) => ({
      ...cat,
      order: idx + 1,
    }));

    setCategories(updated);
    try {
      await saveCategoriesOrder(updated);
    } catch (err) {
      console.error('Save category order error:', err);
    }
  };

  const handleCategoryTouchStart = (e: React.TouchEvent<HTMLButtonElement>, catId: string) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    if (touchDragTimerRef.current) clearTimeout(touchDragTimerRef.current);
    touchDragRef.current = {
      sourceId: catId,
      targetId: catId,
      active: false,
      startX: touch.clientX,
      startY: touch.clientY,
    };
    touchDragTimerRef.current = setTimeout(() => {
      if (touchDragRef.current && touchDragRef.current.sourceId === catId) {
        touchDragRef.current.active = true;
        setDraggingCatId(catId);
        setDragOverCatId(catId);
      }
    }, 220);
  };

  const handleCategoryTouchMove = (e: React.TouchEvent<HTMLButtonElement>) => {
    const state = touchDragRef.current;
    if (!state || e.touches.length !== 1) return;
    const touch = e.touches[0];

    if (!state.active) {
      if (Math.hypot(touch.clientX - state.startX, touch.clientY - state.startY) > 10) {
        if (touchDragTimerRef.current) clearTimeout(touchDragTimerRef.current);
        touchDragRef.current = null;
      }
      return;
    }

    e.preventDefault();
    const el = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-cat-id]') as HTMLElement | null;
    const hitId = el?.getAttribute('data-cat-id') || null;
    if (hitId) {
      state.targetId = hitId;
      setDragOverCatId(hitId);
    }
  };

  const handleCategoryTouchEnd = async () => {
    if (touchDragTimerRef.current) clearTimeout(touchDragTimerRef.current);
    const state = touchDragRef.current;
    touchDragRef.current = null;

    if (state?.active) {
      suppressCatClickRef.current = true;
      setTimeout(() => {
        suppressCatClickRef.current = false;
      }, 160);
      setDraggingCatId(null);
      setDragOverCatId(null);
      if (state.targetId && state.targetId !== state.sourceId) {
        await reorderCategoriesByIds(state.sourceId, state.targetId);
      }
    }
  };

  // Drag-and-drop reorder Primary Options (variants) inside Dish Options Modal & save to Cloud
  const reorderVariantsByIds = async (sourceVariantId: string, targetVariantId: string) => {
    if (!selectedDishForOptions || !sourceVariantId || !targetVariantId || sourceVariantId === targetVariantId) {
      return;
    }
    const list = [...selectedDishForOptions.variants];
    const sourceIdx = list.findIndex((v) => v.id === sourceVariantId);
    const targetIdx = list.findIndex((v) => v.id === targetVariantId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const [moved] = list.splice(sourceIdx, 1);
    list.splice(targetIdx, 0, moved);

    const updatedDish: DishDoc = {
      ...selectedDishForOptions,
      variants: list,
      updatedAt: new Date().toISOString(),
    };

    setSelectedDishForOptions(updatedDish);
    setDishes((prev) => prev.map((d) => (d.id === updatedDish.id ? updatedDish : d)));

    try {
      await saveDocument('dishes', updatedDish, false);
    } catch (err) {
      console.error('Save primary options order error:', err);
    }
  };

  const handleVariantTouchStart = (e: React.TouchEvent<HTMLButtonElement>, variantId: string) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    if (variantTouchTimerRef.current) clearTimeout(variantTouchTimerRef.current);
    variantTouchRef.current = {
      sourceId: variantId,
      targetId: variantId,
      active: false,
      startX: touch.clientX,
      startY: touch.clientY,
    };
    variantTouchTimerRef.current = setTimeout(() => {
      if (variantTouchRef.current && variantTouchRef.current.sourceId === variantId) {
        variantTouchRef.current.active = true;
        setDraggingVariantId(variantId);
        setDragOverVariantId(variantId);
      }
    }, 180);
  };

  const handleVariantTouchMove = (e: React.TouchEvent<HTMLButtonElement>) => {
    const state = variantTouchRef.current;
    if (!state || e.touches.length !== 1) return;
    const touch = e.touches[0];

    if (!state.active) {
      if (Math.hypot(touch.clientX - state.startX, touch.clientY - state.startY) > 10) {
        if (variantTouchTimerRef.current) clearTimeout(variantTouchTimerRef.current);
        variantTouchRef.current = null;
      }
      return;
    }

    e.preventDefault();
    const el = document
      .elementFromPoint(touch.clientX, touch.clientY)
      ?.closest('[data-variant-id]') as HTMLElement | null;
    const hitId = el?.getAttribute('data-variant-id') || null;
    if (hitId) {
      state.targetId = hitId;
      setDragOverVariantId(hitId);
    }
  };

  const handleVariantTouchEnd = async () => {
    if (variantTouchTimerRef.current) clearTimeout(variantTouchTimerRef.current);
    const state = variantTouchRef.current;
    variantTouchRef.current = null;

    if (state?.active) {
      suppressVariantClickRef.current = true;
      setTimeout(() => {
        suppressVariantClickRef.current = false;
      }, 160);
      setDraggingVariantId(null);
      setDragOverVariantId(null);
      if (state.targetId && state.targetId !== state.sourceId) {
        await reorderVariantsByIds(state.sourceId, state.targetId);
      }
    }
  };

  // Food Cost linking helpers for full Menu Management inside POS categories
  const costIngMap = useMemo(
    () => new Map<string, CostIngredient>(costIngredients.map((i) => [i.id, i])),
    [costIngredients]
  );

  const getActiveCostVariants = (menu: CostMenuItem): CostMenuVariant[] => {
    return menu.variants || [];
  };

  const getCostVariantLabel = (cv: CostMenuVariant): string => resolveCostVariantLabel(cv);

  const stripDishPrefix = (raw: string): string =>
    raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/^(ข้าวผัด|ผัด|ข้าว|ต้มยำ|ต้ม|แกง|ยำ|ทอด|น้ำ|เมนู)/, '');

  const findMatchingCostMenu = (dish: Partial<DishDoc>): CostMenuItem | null => {
    const activeCostMenus = costMenus.filter((m) => m.active !== false);
    if (activeCostMenus.length === 0) return null;

    if (dish.costMenuId) {
      const byId = activeCostMenus.find((m) => m.id === dish.costMenuId);
      if (byId) return byId;
    }

    const varCostMenuId = dish.variants?.find((v) => v.costMenuId)?.costMenuId;
    if (varCostMenuId) {
      const byVarMenuId = activeCostMenus.find((m) => m.id === varCostMenuId);
      if (byVarMenuId) return byVarMenuId;
    }

    if (dish.id?.startsWith('cost_dish_')) {
      const normalizedCostId = dish.id.replace('cost_dish_', '');
      const byNorm = activeCostMenus.find(
        (m) => m.id.replace(/[^a-zA-Z0-9_-]/g, '_') === normalizedCostId
      );
      if (byNorm) return byNorm;
    }

    const dTh = (dish.nameTh || '').trim().toLowerCase();
    const dEn = (dish.name || '').trim().toLowerCase();
    if (!dTh && !dEn) return null;

    const exact = activeCostMenus.find((m) => {
      const mName = m.name.trim().toLowerCase();
      return (dTh && mName === dTh) || (dEn && mName === dEn);
    });
    if (exact) return exact;

    const dThNorm = stripDishPrefix(dTh);
    if (dThNorm.length >= 2) {
      const normMatch = activeCostMenus.find((m) => {
        const mNorm = stripDishPrefix(m.name);
        return mNorm.length >= 2 && mNorm === dThNorm;
      });
      if (normMatch) return normMatch;
    }

    if (dTh.length >= 2) {
      const containedInDish = activeCostMenus
        .filter((m) => {
          const mName = m.name.trim().toLowerCase();
          return mName.length >= 2 && dTh.includes(mName);
        })
        .sort((a, b) => b.name.trim().length - a.name.trim().length);
      if (containedInDish.length > 0) return containedInDish[0];

      const containingDish = activeCostMenus
        .filter((m) => {
          const mName = m.name.trim().toLowerCase();
          return mName.length >= 2 && mName.includes(dTh);
        })
        .sort((a, b) => a.name.trim().length - b.name.trim().length);
      if (containingDish.length > 0) return containingDish[0];
    }

    if (dEn.length >= 2) {
      const enCandidates = activeCostMenus
        .filter((m) => {
          const mName = m.name.trim().toLowerCase();
          return mName.length >= 2 && (dEn.includes(mName) || mName.includes(dEn));
        })
        .sort((a, b) => a.name.trim().length - b.name.trim().length);
      if (enCandidates.length > 0) return enCandidates[0];
    }

    return null;
  };

  const findExistingPosVariantForCostVariant = (
    cv: CostMenuVariant,
    posVariants: DishVariant[] = []
  ): DishVariant | undefined => {
    const byId = posVariants.find((pv) => pv.costVariantId === cv.id || pv.id === cv.id);
    if (byId) return byId;

    const cLabel = getCostVariantLabel(cv).toLowerCase();
    const cProt = (cv.proteinType || '').trim().toLowerCase();
    const cName = (cv.thaiName || cv.name || '').trim().toLowerCase();
    const cEn = (cv.englishName || '').trim().toLowerCase();

    return posVariants.find((pv) => {
      const pTh = (pv.nameTh || '').trim().toLowerCase();
      const pEn = (pv.name || '').trim().toLowerCase();
      if (!pTh && !pEn) return false;
      if (pTh === 'มาตรฐาน' || pEn === 'standard') return false;
      return (
        (pTh && (pTh === cLabel || pTh === cProt || pTh === cName)) ||
        (pEn && (pEn === cLabel || pEn === cProt || pEn === cName || (cEn && pEn === cEn)))
      );
    });
  };

  const resolveCostVariantSellingPrice = (
    costMenu: CostMenuItem,
    cv: CostMenuVariant,
    existingMatched?: DishVariant,
    sessionOverride?: number
  ): number => {
    if (sessionOverride !== undefined) return sessionOverride;

    const spreadsheetBase = calculateSpreadsheetRowMetrics({
      menu: costMenu,
      variant: cv,
      ingredientsMap: costIngMap,
      servingMode: 'ON_RICE',
    }).baseSellingPrice;

    if (existingMatched && existingMatched.price > 0) {
      const isLegacyRawKaprowSeed =
        (costMenu.name.includes('กะเพรา') ||
          costMenu.id === 'menu_kaprow' ||
          cv.menuId === 'menu_kaprow') &&
        existingMatched.price === (Number(cv.sellingPrice) || 0) &&
        spreadsheetBase !== (Number(cv.sellingPrice) || 0);
      if (!isLegacyRawKaprowSeed) {
        return existingMatched.price;
      }
    }

    return spreadsheetBase;
  };

  const computeCostVariantRealtimeBreakdown = (
    costMenu: CostMenuItem,
    cv: CostMenuVariant,
    sellingPriceOverride?: number
  ) => {
    return calculateSpreadsheetRowMetrics({
      menu: costMenu,
      variant: cv,
      ingredientsMap: costIngMap,
      servingMode: 'ON_RICE',
      sellingPriceOverride,
    });
  };

  const matchedEditingPosCostMenu = useMemo(
    () => (editingDishInPos ? findMatchingCostMenu(editingDishInPos) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingDishInPos, costMenus]
  );

  const handleUpdatePosCostVariantPrice = (
    costMenu: CostMenuItem,
    cv: CostMenuVariant,
    newPrice: number
  ) => {
    if (!editingDishInPos) return;
    setPosModalPriceOverrides((prev) => ({ ...prev, [cv.id]: newPrice }));

    const labelTh = getCostVariantLabel(cv);
    const currentVariants = editingDishInPos.variants || [];
    const existingMatched = findExistingPosVariantForCostVariant(cv, currentVariants);

    const strippedPlaceholder = currentVariants.filter((pv) => {
      if (currentVariants.length > 1) return true;
      const pTh = (pv.nameTh || '').trim().toLowerCase();
      const pEn = (pv.name || '').trim().toLowerCase();
      return !(
        (pTh === 'มาตรฐาน' || pEn === 'standard') &&
        !pv.costVariantId &&
        (pv.ingredients?.length || 0) === 0
      );
    });

    const labelEn = resolveEntityEnglishName(labelTh, cv.englishName) || labelTh;
    let updatedVariants: DishVariant[];
    if (existingMatched) {
      updatedVariants = strippedPlaceholder.map((pv) =>
        pv.id === existingMatched.id
          ? {
              ...pv,
              nameTh: labelTh,
              name: labelEn,
              nameEnManual: Boolean(cv.englishNameManual || pv.nameEnManual),
              price: newPrice,
              costMenuId: costMenu.id,
              costVariantId: cv.id,
            }
          : pv
      );
    } else {
      updatedVariants = [
        ...strippedPlaceholder,
        {
          id: cv.id || `var_${Date.now()}`,
          nameTh: labelTh,
          name: labelEn,
          nameEnManual: Boolean(cv.englishNameManual),
          price: newPrice,
          costMenuId: costMenu.id,
          costVariantId: cv.id,
          ingredients: [],
          subRecipes: [],
          packaging: [],
        },
      ];
    }

    setEditingDishInPos({
      ...editingDishInPos,
      costMenuId: costMenu.id,
      variants: updatedVariants,
    });
  };

  const getPosLinkedFoodCostMetrics = (dish: Partial<DishDoc>, variant?: DishVariant) => {
    const activeCostMenus = costMenus.filter((m) => m.active !== false);

    const findCostMatch = (): { menu: CostMenuItem; variant: CostMenuVariant } | null => {
      if (activeCostMenus.length === 0) return null;

      if (variant?.costVariantId) {
        if (variant.costMenuId || dish.costMenuId) {
          const targetMenu = activeCostMenus.find(
            (m) => m.id === (variant.costMenuId || dish.costMenuId)
          );
          const targetVar = targetMenu?.variants?.find(
            (cv) => cv.id === variant.costVariantId && cv.active !== false
          );
          if (targetMenu && targetVar) return { menu: targetMenu, variant: targetVar };
        }
        for (const cm of activeCostMenus) {
          const cv = (cm.variants || []).find(
            (x) => x.id === variant.costVariantId && x.active !== false
          );
          if (cv) return { menu: cm, variant: cv };
        }
      }

      if (variant?.id) {
        for (const cm of activeCostMenus) {
          const cv = (cm.variants || []).find(
            (x) => x.id === variant.id && x.active !== false
          );
          if (cv) return { menu: cm, variant: cv };
        }
      }

      const matchedMenu = findMatchingCostMenu(dish) || undefined;
      if (matchedMenu && (matchedMenu.variants || []).length > 0) {
        const pool = getActiveCostVariants(matchedMenu);
        if (!variant) return { menu: matchedMenu, variant: pool[0] };

        const vTh = (variant.nameTh || '').trim().toLowerCase();
        const vEn = (variant.name || '').trim().toLowerCase();

        const exactVar = pool.find((cv) => {
          const p = (cv.proteinType || '').trim().toLowerCase();
          const n = (cv.thaiName || cv.name || '').trim().toLowerCase();
          const e = (cv.englishName || '').trim().toLowerCase();
          return (vTh && (p === vTh || n === vTh)) || (vEn && (p === vEn || n === vEn || (e && e === vEn)));
        });
        if (exactVar) return { menu: matchedMenu, variant: exactVar };

        if (vTh === 'มาตรฐาน' || vEn === 'standard') {
          return { menu: matchedMenu, variant: pool[0] };
        }

        const partialVar = pool.find((cv) => {
          const p = (cv.proteinType || '').trim().toLowerCase();
          const n = (cv.thaiName || cv.name || '').trim().toLowerCase();
          return (
            (vTh.length >= 2 && (n.includes(vTh) || p.includes(vTh) || (p && vTh.includes(p)))) ||
            (vEn.length >= 2 && (n.includes(vEn) || p.includes(vEn)))
          );
        });
        if (partialVar) return { menu: matchedMenu, variant: partialVar };
        if (pool.length === 1) return { menu: matchedMenu, variant: pool[0] };
      }

      return null;
    };

    const match = findCostMatch();
    if (match) {
      const posPrice = resolveCostVariantSellingPrice(match.menu, match.variant, variant);
      const breakdown = computeCostVariantRealtimeBreakdown(match.menu, match.variant, posPrice);
      return {
        hasData: true,
        source: 'food_cost' as const,
        matchedMenuId: match.menu.id,
        matchedVariantId: match.variant.id,
        matchedMenuName: match.menu.name,
        matchedVariantName: getCostVariantLabel(match.variant),
        cost: breakdown.totalCost,
        foodCostPercent: breakdown.fcPercent,
        dineInProfit: breakdown.dineInProfit,
        takeawayProfit: breakdown.takeawayProfit,
      };
    }

    if (variant) {
      const posCalc = calculateDishVariantCost(variant, ingredientsMap, subRecipesMap, packagingMap);
      if (posCalc.hasRecipe) {
        const posPrice = variant.price || 0;
        const netDineIn = extractNetPriceFromMenuPrice(
          posPrice,
          settings.pricesIncludeVat,
          settings.vatPercent,
          settings.serviceChargeIncludedInPrice,
          settings.serviceChargePercent
        );
        const takeawayChannel = channels.find((c) => c.type === 'takeaway');
        const takeawayPrice = takeawayChannel?.priceMarkupPercent
          ? posPrice * (1 + takeawayChannel.priceMarkupPercent / 100)
          : posPrice;
        const netTakeaway = extractNetPriceFromMenuPrice(
          takeawayPrice,
          settings.pricesIncludeVat,
          settings.vatPercent,
          settings.serviceChargeIncludedInPrice,
          settings.serviceChargePercent
        );
        const takeawayBoxCost =
          takeawayChannel?.packagingCost ?? costSettings.takeawayPackagingCost ?? 0;

        return {
          hasData: true,
          source: 'pos_recipe' as const,
          matchedMenuId: '',
          matchedVariantId: '',
          matchedMenuName: dish.nameTh || dish.name || '',
          matchedVariantName: variant.nameTh || variant.name,
          cost: posCalc.totalCost,
          foodCostPercent: netDineIn > 0 ? (posCalc.foodCost / netDineIn) * 100 : 0,
          dineInProfit: netDineIn - posCalc.totalCost,
          takeawayProfit: netTakeaway - (posCalc.totalCost + takeawayBoxCost),
        };
      }
    }

    return {
      hasData: false,
      source: 'none' as const,
      matchedMenuId: '',
      matchedVariantId: '',
      matchedMenuName: '',
      matchedVariantName: '',
      cost: 0,
      foodCostPercent: 0,
      dineInProfit: 0,
      takeawayProfit: 0,
    };
  };

  // Inline POS Menu Management handlers (Add / Edit / Delete directly inside POS categories)
  const handleOpenPosAddDish = (categoryIdOverride?: string | null) => {
    if (dishNameClickTimerRef.current) {
      clearTimeout(dishNameClickTimerRef.current);
      dishNameClickTimerRef.current = null;
    }
    setSelectedDishForOptions(null);
    posTranslationScheduler.cancelAll();
    posManualEnKeysRef.current.clear();
    posPrevDishThaiRef.current = '';
    posPrevDishDescThaiRef.current = '';
    posPrevVarThaiMapRef.current = new Map();
    setPosModalPriceOverrides({});
    setPosImageError(null);
    setPosEditImageSizeKb(null);
    setPosEditPreviewUrl(null);
    setIsCreatingDishInPos(true);

    const targetCategoryId =
      categoryIdOverride && categoryIdOverride !== 'all'
        ? categoryIdOverride
        : categories[0]?.id || 'cat_main';
    const nowIso = new Date().toISOString();

    const initialDraftDish: DishDoc = {
      id: `dish_${Date.now()}`,
      name: '',
      nameTh: '',
      description: '',
      descriptionTh: '',
      categoryId: targetCategoryId,
      variants: [
        {
          id: `var_${Date.now()}`,
          name: 'Standard',
          nameTh: 'มาตรฐาน',
          price: 0,
          ingredients: [],
          subRecipes: [],
          packaging: [],
        },
      ],
      optionGroupIds: [],
      order: dishes.length + 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };
    posDishSnapshotRef.current = serializePosDishDraft(initialDraftDish, {});
    setPosDishModalError(null);
    setPosPendingRecipeNavTarget(null);
    setIsPosNavigatingToRecipe(false);
    setEditingDishInPos(initialDraftDish);
  };

  const handleOpenPosEditDish = (dish: DishDoc) => {
    clearDishEditHoldTimer();
    if (dishNameClickTimerRef.current) {
      clearTimeout(dishNameClickTimerRef.current);
      dishNameClickTimerRef.current = null;
    }
    setSelectedDishForOptions(null);
    setIsCreatingDishInPos(false);
    posTranslationScheduler.cancelAll();
    posManualEnKeysRef.current.clear();
    if (dish.nameEnManual && (dish.name || '').trim()) {
      posManualEnKeysRef.current.add('dish');
    }
    const resolvedDesc = resolveBilingualDescriptionFields(dish.description, dish.descriptionTh);
    const hasManualEnDesc =
      Boolean(resolvedDesc.description) &&
      (Boolean(dish.descriptionEnManual) ||
        (!dish.descriptionTh &&
          Boolean(dish.description) &&
          !containsThaiCharacters(dish.description)));
    if (hasManualEnDesc) {
      posManualEnKeysRef.current.add('dishDesc');
    }
    posPrevDishThaiRef.current = dish.nameTh || '';
    posPrevDishDescThaiRef.current = resolvedDesc.descriptionTh;
    posPrevVarThaiMapRef.current = new Map(
      (dish.variants || []).map((v) => [v.id, v.nameTh || ''])
    );
    (dish.variants || []).forEach((v) => {
      if (v.nameEnManual && (v.name || '').trim()) {
        posManualEnKeysRef.current.add(`var_${v.id}`);
      }
    });
    setPosModalPriceOverrides({});
    setPosImageError(null);
    setPosEditImageSizeKb(null);
    setPosEditPreviewUrl(dishImages.get(dish.id) || null);
    if (dish.imageId) {
      getImageDoc(dish.imageId)
        .then((imgDoc) => {
          if (imgDoc?.dataUrl) {
            setPosEditPreviewUrl(imgDoc.dataUrl);
            setDishImages((prev) => new Map(prev).set(dish.id, imgDoc.dataUrl));
            if (imgDoc.sizeBytes) {
              setPosEditImageSizeKb(Math.max(1, Math.round(imgDoc.sizeBytes / 1024)));
            }
          }
        })
        .catch(() => {});
    }
    const draftDish: DishDoc = {
      ...dish,
      description: resolvedDesc.description,
      descriptionTh: resolvedDesc.descriptionTh,
      descriptionEnManual: hasManualEnDesc,
      variants: (dish.variants || []).map((v) => ({
        ...v,
        ingredients: [...(v.ingredients || [])],
        subRecipes: [...(v.subRecipes || [])],
        packaging: [...(v.packaging || [])],
      })),
      optionGroupIds: [...(dish.optionGroupIds || [])],
    };
    posDishSnapshotRef.current = serializePosDishDraft(draftDish, {});
    setPosDishModalError(null);
    setPosPendingRecipeNavTarget(null);
    setIsPosNavigatingToRecipe(false);
    setEditingDishInPos(draftDish);
  };

  const handlePosDishPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file || !editingDishInPos) return;

    setIsUploadingPosImage(true);
    setPosImageError(null);
    try {
      const { dataUrl, sizeBytes } = await compressImage(file);
      const imageId = `img_${Date.now()}`;
      await saveImageDoc(imageId, dataUrl, sizeBytes);

      setEditingDishInPos((prev) => (prev ? { ...prev, imageId } : prev));
      setPosEditPreviewUrl(dataUrl);
      setPosEditImageSizeKb(Math.max(1, Math.round(sizeBytes / 1024)));
      loadedDishImageIdsRef.current.set(editingDishInPos.id, imageId);
      setDishImages((prev) => new Map(prev).set(editingDishInPos.id, dataUrl));
    } catch (err) {
      console.error('POS dish image upload error:', err);
      setPosImageError(
        lang === 'th'
          ? 'อัปโหลดรูปภาพไม่สำเร็จ กรุณาลองไฟล์อื่น'
          : 'Failed to upload image. Please try another file.'
      );
    } finally {
      setIsUploadingPosImage(false);
      input.value = '';
    }
  };

  const savePosDishFromModal = async (): Promise<{ ok: boolean; savedDish?: DishDoc }> => {
    if (!editingDishInPos || isSavingPosDish) return { ok: false };

    posTranslationScheduler.cancelAll();
    const finalDishTh = (editingDishInPos.nameTh || '').trim();
    const isDishManual =
      posManualEnKeysRef.current.has('dish') && Boolean((editingDishInPos.name || '').trim());
    const finalDishEn = (
      isDishManual
        ? (editingDishInPos.name || '').trim()
        : computeAutoEnglishName({
            previousThai: posPrevDishThaiRef.current,
            nextThai: finalDishTh,
            currentEnglish: editingDishInPos.name || '',
            isManuallyEdited: false,
          }) || (finalDishTh ? translateThaiToEnglish(finalDishTh) : '')
    ).trim();
    if (!finalDishEn && !finalDishTh) {
      setPosDishModalError(
        lang === 'th' ? 'กรุณาระบุชื่อเมนูอาหารก่อนบันทึก' : 'Please enter a dish name before saving.'
      );
      posDishFormRef.current?.reportValidity();
      return { ok: false };
    }
    setPosDishModalError(null);

    setIsSavingPosDish(true);
    try {
      const matchedCostMenu = findMatchingCostMenu(editingDishInPos);
      const normalizedVariants: DishVariant[] = matchedCostMenu
        ? getActiveCostVariants(matchedCostMenu).map((cv) => {
            const existingMatched = findExistingPosVariantForCostVariant(
              cv,
              editingDishInPos.variants || []
            );
            const vTh = getCostVariantLabel(cv);
            const vEn =
              resolveEntityEnglishName(vTh, cv.englishName) ||
              (existingMatched?.name &&
              existingMatched.name !== 'Standard' &&
              !containsThaiCharacters(existingMatched.name)
                ? existingMatched.name.trim()
                : '') ||
              vTh;
            const resolvedPrice = resolveCostVariantSellingPrice(
              matchedCostMenu,
              cv,
              existingMatched,
              posModalPriceOverrides[cv.id]
            );
            return {
              id: existingMatched?.id || cv.id || `var_${Date.now()}`,
              name: vEn,
              nameTh: vTh,
              nameEnManual: Boolean(cv.englishNameManual || existingMatched?.nameEnManual),
              price: resolvedPrice,
              costMenuId: matchedCostMenu.id,
              costVariantId: cv.id,
              ingredients: existingMatched?.ingredients || [],
              subRecipes: existingMatched?.subRecipes || [],
              packaging: existingMatched?.packaging || [],
            };
          })
        : (editingDishInPos.variants || []).map((v) => {
            const vTh = (v.nameTh || '').trim();
            const isVarManual =
              posManualEnKeysRef.current.has(`var_${v.id}`) && Boolean((v.name || '').trim());
            const vEn = isVarManual
              ? (v.name || '').trim()
              : computeAutoEnglishName({
                  previousThai: posPrevVarThaiMapRef.current.get(v.id) ?? vTh,
                  nextThai: vTh,
                  currentEnglish: v.name || '',
                  isManuallyEdited: false,
                }) ||
                (vTh ? translateThaiToEnglish(vTh) : '') ||
                'Standard';
            return {
              ...v,
              name: vEn,
              nameEnManual: isVarManual,
              ...(vTh ? { nameTh: vTh } : {}),
              price: Number(v.price) || 0,
              ingredients: v.ingredients || [],
              subRecipes: v.subRecipes || [],
              packaging: v.packaging || [],
            };
          });

      const isNew = isCreatingDishInPos || !dishes.some((d) => d.id === editingDishInPos.id);
      const resolvedCostMenuId = matchedCostMenu?.id || editingDishInPos.costMenuId;
      const finalDescTh = (editingDishInPos.descriptionTh || '').trim();
      const isDescManual =
        posManualEnKeysRef.current.has('dishDesc') && Boolean((editingDishInPos.description || '').trim());
      const computedDescEn = isDescManual
        ? (editingDishInPos.description || '').trim()
        : computeAutoEnglishDescription({
            previousThai: posPrevDishDescThaiRef.current,
            nextThai: finalDescTh,
            currentEnglish: editingDishInPos.description || '',
            isManuallyEdited: false,
          }) || (finalDescTh ? translateThaiDescriptionToEnglish(finalDescTh) : '');
      const finalDescEn = containsThaiCharacters(computedDescEn) ? '' : computedDescEn.trim();

      const dishToSave: DishDoc = {
        ...editingDishInPos,
        id: editingDishInPos.id || `dish_${Date.now()}`,
        name: finalDishEn || finalDishTh,
        nameEnManual: isDishManual,
        ...(finalDishTh ? { nameTh: finalDishTh } : {}),
        categoryId: editingDishInPos.categoryId || categories[0]?.id || 'cat_main',
        ...(resolvedCostMenuId ? { costMenuId: resolvedCostMenuId } : {}),
        variants: normalizedVariants.length
          ? normalizedVariants
          : [
              {
                id: `var_std_${Date.now()}`,
                name: 'Standard',
                nameTh: 'มาตรฐาน',
                price: 100,
                ingredients: [],
                subRecipes: [],
                packaging: [],
              },
            ],
        optionGroupIds: editingDishInPos.optionGroupIds || [],
        order: isNew ? dishes.length + 1 : editingDishInPos.order || dishes.length + 1,
        createdAt: editingDishInPos.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: isNew ? 1 : (editingDishInPos.version || 0) + 1,
      };
      if (finalDescEn) dishToSave.description = finalDescEn;
      else delete dishToSave.description;
      if (finalDescTh) dishToSave.descriptionTh = finalDescTh;
      else delete dishToSave.descriptionTh;
      if (finalDescEn || finalDescTh) dishToSave.descriptionEnManual = isDescManual;
      else delete dishToSave.descriptionEnManual;
      if (!editingDishInPos.imageId) {
        delete dishToSave.imageId;
      }

      await saveDocument('dishes', dishToSave, isNew);
      if (finalDishTh && dishToSave.name) {
        learnShopTranslation(finalDishTh, dishToSave.name, { isManual: isDishManual });
      }
      for (const variant of dishToSave.variants || []) {
        if (variant.nameTh && variant.name) {
          learnShopTranslation(variant.nameTh, variant.name, {
            isManual: Boolean(variant.nameEnManual),
          });
        }
      }
      setDishes((prev) =>
        isNew
          ? [...prev, dishToSave].sort((a, b) => (a.order || 0) - (b.order || 0))
          : prev.map((d) => (d.id === dishToSave.id ? dishToSave : d))
      );
      if (posEditPreviewUrl && dishToSave.imageId) {
        loadedDishImageIdsRef.current.set(dishToSave.id, dishToSave.imageId);
        setDishImages((prev) => new Map(prev).set(dishToSave.id, posEditPreviewUrl));
      } else if (!dishToSave.imageId) {
        loadedDishImageIdsRef.current.delete(dishToSave.id);
        setDishImages((prev) => {
          const next = new Map(prev);
          next.delete(dishToSave.id);
          return next;
        });
      }
      closePosDishModalCleanly();
      return { ok: true, savedDish: dishToSave };
    } catch (err) {
      console.error('POS save dish error:', err);
      setPosDishModalError(
        err instanceof Error
          ? err.message
          : lang === 'th'
          ? 'บันทึกเมนูไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
          : 'Failed to save dish. Please try again.'
      );
      return { ok: false };
    } finally {
      setIsSavingPosDish(false);
    }
  };

  const handleSavePosDish = async (e: React.FormEvent) => {
    e.preventDefault();
    await savePosDishFromModal();
  };

  // Drag-and-drop reorder dish cards inside POS category (Desktop mouse & Touch long-press)
  const reorderDishesByIds = async (sourceDishId: string, targetDishId: string) => {
    if (!sourceDishId || !targetDishId || sourceDishId === targetDishId) return;
    const sourceVisibleIdx = displayedDishes.findIndex((d) => d.id === sourceDishId);
    const targetVisibleIdx = displayedDishes.findIndex((d) => d.id === targetDishId);
    if (sourceVisibleIdx === -1 || targetVisibleIdx === -1) return;

    const reorderedVisible = [...displayedDishes];
    const [moved] = reorderedVisible.splice(sourceVisibleIdx, 1);
    reorderedVisible.splice(targetVisibleIdx, 0, moved);

    const visibleIdSet = new Set(displayedDishes.map((d) => d.id));
    const slotIndices: number[] = [];
    dishes.forEach((d, idx) => {
      if (visibleIdSet.has(d.id)) slotIndices.push(idx);
    });

    const nextDishes = [...dishes];
    slotIndices.forEach((slotIdx, i) => {
      if (reorderedVisible[i]) {
        nextDishes[slotIdx] = reorderedVisible[i];
      }
    });

    const prevOrderById = new Map(dishes.map((d) => [d.id, d.order]));
    const updatedWithOrder = nextDishes.map((d, idx) => ({
      ...d,
      order: idx + 1,
    }));

    setDishes(updatedWithOrder);

    const changedDishes = updatedWithOrder.filter((d) => prevOrderById.get(d.id) !== d.order);
    try {
      await saveDishesOrder(
        changedDishes.map((d) => ({
          id: d.id,
          order: d.order,
          version: d.version,
        }))
      );
    } catch (err) {
      console.error('Save dishes order error:', err);
    }
  };

  const clearDishEditHoldTimer = () => {
    if (dishEditHoldTimerRef.current) {
      clearTimeout(dishEditHoldTimerRef.current);
      dishEditHoldTimerRef.current = null;
    }
    dishEditHoldOriginRef.current = null;
  };

  const startDishEditHoldTimer = (dish: DishDoc, clientX: number, clientY: number) => {
    clearDishEditHoldTimer();
    dishEditHoldOriginRef.current = {
      dishId: dish.id,
      startX: clientX,
      startY: clientY,
    };
    dishEditHoldTimerRef.current = setTimeout(() => {
      dishEditHoldTimerRef.current = null;
      dishEditHoldOriginRef.current = null;
      if (dishTouchTimerRef.current) {
        clearTimeout(dishTouchTimerRef.current);
        dishTouchTimerRef.current = null;
      }
      dishTouchRef.current = null;
      setDraggingDishId(null);
      setDragOverDishId(null);
      suppressDishClickRef.current = true;
      setTimeout(() => {
        suppressDishClickRef.current = false;
      }, 380);
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(25);
      }
      handleOpenPosEditDish(dish);
    }, 500);
  };

  const handleDishTouchStart = (e: React.TouchEvent<HTMLDivElement>, dish: DishDoc) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    startDishEditHoldTimer(dish, touch.clientX, touch.clientY);
    if (dishTouchTimerRef.current) clearTimeout(dishTouchTimerRef.current);
    dishTouchRef.current = {
      sourceId: dish.id,
      targetId: dish.id,
      active: false,
      startX: touch.clientX,
      startY: touch.clientY,
    };
    dishTouchTimerRef.current = setTimeout(() => {
      if (dishTouchRef.current && dishTouchRef.current.sourceId === dish.id) {
        if (dishNameClickTimerRef.current) {
          clearTimeout(dishNameClickTimerRef.current);
          dishNameClickTimerRef.current = null;
        }
        dishTouchRef.current.active = true;
        setDraggingDishId(dish.id);
        setDragOverDishId(dish.id);
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(15);
        }
      }
    }, 180);
  };

  const handleDishTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (touch && dishEditHoldOriginRef.current) {
      const origin = dishEditHoldOriginRef.current;
      if (Math.hypot(touch.clientX - origin.startX, touch.clientY - origin.startY) > 8) {
        clearDishEditHoldTimer();
      }
    }

    const state = dishTouchRef.current;
    if (!state || e.touches.length !== 1) return;

    if (!state.active) {
      if (Math.hypot(touch.clientX - state.startX, touch.clientY - state.startY) > 10) {
        if (dishTouchTimerRef.current) clearTimeout(dishTouchTimerRef.current);
        dishTouchRef.current = null;
      }
      return;
    }

    e.preventDefault();
    const el = document
      .elementFromPoint(touch.clientX, touch.clientY)
      ?.closest('[data-dish-id]') as HTMLElement | null;
    const hitId = el?.getAttribute('data-dish-id') || null;
    if (hitId) {
      state.targetId = hitId;
      setDragOverDishId(hitId);
    }
  };

  const handleDishTouchEnd = async () => {
    clearDishEditHoldTimer();
    if (dishTouchTimerRef.current) clearTimeout(dishTouchTimerRef.current);
    const state = dishTouchRef.current;
    dishTouchRef.current = null;

    if (state?.active) {
      suppressDishClickRef.current = true;
      setTimeout(() => {
        suppressDishClickRef.current = false;
      }, 220);
      setDraggingDishId(null);
      setDragOverDishId(null);
      if (state.targetId && state.targetId !== state.sourceId) {
        await reorderDishesByIds(state.sourceId, state.targetId);
      }
    }
  };

  // Unpaid ordered bills sorted by persisted card order
  const unpaidOrderedBills = [...openBills]
    .filter((b) => b.status === 'saved' && Array.isArray(b.items) && b.items.length > 0)
    .sort((a, b) => {
      const ordA = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
      const ordB = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
      if (ordA !== ordB) return ordA - ordB;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

  // Drag-and-drop reorder unpaid bill cards & sync to Cloud Firestore
  const reorderBillsByIds = async (sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const sourceIdx = unpaidOrderedBills.findIndex((b) => b.id === sourceId);
    const targetIdx = unpaidOrderedBills.findIndex((b) => b.id === targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const reordered = [...unpaidOrderedBills];
    const [moved] = reordered.splice(sourceIdx, 1);
    reordered.splice(targetIdx, 0, moved);

    const updatedSubset = reordered.map((b, idx) => ({
      ...b,
      order: idx + 1,
    }));
    const updatedMap = new Map(updatedSubset.map((b) => [b.id, b.order]));

    setOpenBills((prev) =>
      prev.map((b) => (updatedMap.has(b.id) ? { ...b, order: updatedMap.get(b.id) } : b))
    );

    try {
      await saveBillsOrder(
        updatedSubset.map((b) => ({
          id: b.id,
          order: b.order,
          version: b.version,
        }))
      );
    } catch (err) {
      console.error('Save bills order error:', err);
    }
  };

  const handleBillTouchStart = (e: React.TouchEvent<HTMLDivElement>, billId: string) => {
    if (e.touches.length !== 1) return;
    const targetTag = (e.target as HTMLElement | null)?.closest('button[data-bill-pay-btn]');
    if (targetTag) return;

    const touch = e.touches[0];
    if (billTouchTimerRef.current) clearTimeout(billTouchTimerRef.current);
    billTouchRef.current = {
      sourceId: billId,
      targetId: billId,
      active: false,
      startX: touch.clientX,
      startY: touch.clientY,
    };
    billTouchTimerRef.current = setTimeout(() => {
      if (billTouchRef.current && billTouchRef.current.sourceId === billId) {
        billTouchRef.current.active = true;
        setDraggingBillId(billId);
        setDragOverBillId(billId);
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(15);
        }
      }
    }, 180);
  };

  const handleBillTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const state = billTouchRef.current;
    if (!state || e.touches.length !== 1) return;
    const touch = e.touches[0];

    if (!state.active) {
      if (Math.hypot(touch.clientX - state.startX, touch.clientY - state.startY) > 10) {
        if (billTouchTimerRef.current) clearTimeout(billTouchTimerRef.current);
        billTouchRef.current = null;
      }
      return;
    }

    e.preventDefault();
    const el = document
      .elementFromPoint(touch.clientX, touch.clientY)
      ?.closest('[data-bill-id]') as HTMLElement | null;
    const hitId = el?.getAttribute('data-bill-id') || null;
    if (hitId) {
      state.targetId = hitId;
      setDragOverBillId(hitId);
    }
  };

  const handleBillTouchEnd = async () => {
    if (billTouchTimerRef.current) clearTimeout(billTouchTimerRef.current);
    const state = billTouchRef.current;
    billTouchRef.current = null;

    if (state?.active) {
      suppressBillClickRef.current = true;
      setTimeout(() => {
        suppressBillClickRef.current = false;
      }, 180);
      setDraggingBillId(null);
      setDragOverBillId(null);
      if (state.targetId && state.targetId !== state.sourceId) {
        await reorderBillsByIds(state.sourceId, state.targetId);
      }
    }
  };

  const handleOpenSavedBill = (bill: BillDoc) => {
    setOrderSavedNotice(null);
    setActiveBill(bill);
    setCartItems(bill.items || []);
    setSelectedChannelId(normalizePosChannelId(bill.channelId, posChannels));
    setOrderDiscount(bill.discountAmount || 0);
    applyCustomerFromBill(bill);
    setSelectedCategoryId((prev) => prev || categories[0]?.id || 'all');
  };

  const handleQuickPaySavedBill = (bill: BillDoc) => {
    setOrderSavedNotice(null);
    setActiveBill(bill);
    setCartItems(bill.items || []);
    setSelectedChannelId(normalizePosChannelId(bill.channelId, posChannels));
    setOrderDiscount(bill.discountAmount || 0);
    applyCustomerFromBill(bill);
    setIsPaymentModalOpen(true);
  };

  // Filter dishes by active category if any
  const displayedDishes =
    selectedCategoryId && selectedCategoryId !== 'all'
      ? dishes.filter((d) => d.categoryId === selectedCategoryId)
      : dishes;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-transparent overflow-hidden select-none">
      {/* Top Zone Chip Bar: Table Zones (Only visible when NOT inside a category) */}
      {!selectedCategoryId && (
        <div className="px-3 py-1.5 bg-white/90 backdrop-blur-md border-b border-slate-200 flex items-center justify-between gap-2 shadow-[0_4px_14px_-6px_rgba(15,23,42,0.08)]">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none flex-1 py-0.5">
            {zones.map((z) => {
              const countInZone = orderTables.filter((tbl) => tbl.zoneId === z.id && tbl.currentBillId).length;
              const isZoneActive = topViewMode === 'floor' && activeZoneId === z.id;
              return (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => {
                    setActiveZoneId(z.id);
                    setTopViewMode('floor');
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap active:translate-y-[1px] ${
                    isZoneActive
                      ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-[0_3px_0_#c2410c,0_6px_14px_-4px_rgba(234,88,12,0.3)]'
                      : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 shadow-[0_2px_0_#e2e8f0]'
                  }`}
                >
                  {lang === 'th' && z.nameTh ? z.nameTh : z.name} {countInZone > 0 && `(${countInZone})`}
                </button>
              );
            })}

            {/* ONLINE Zone Chip: RED alert when unfinished orders remain, WHITE only when empty */}
            <button
              type="button"
              onClick={() => {
                setTopViewMode('online');
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap active:translate-y-[1px] flex items-center gap-1.5 ${
                activeOnlineZoneOrders.length > 0
                  ? topViewMode === 'online'
                    ? 'bg-red-600 text-white border border-red-700 shadow-[0_3px_0_#991b1b,0_6px_14px_-4px_rgba(220,38,38,0.4)] ring-2 ring-red-300 ring-offset-1'
                    : 'bg-red-600 hover:bg-red-700 text-white border border-red-700 shadow-[0_3px_0_#991b1b,0_6px_14px_-4px_rgba(220,38,38,0.35)]'
                  : topViewMode === 'online'
                  ? 'bg-white text-slate-900 border border-slate-400 shadow-[0_2px_0_#cbd5e1] ring-2 ring-slate-300'
                  : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 shadow-[0_2px_0_#e2e8f0]'
              }`}
            >
              <ShoppingBag
                className={`w-3.5 h-3.5 shrink-0 ${
                  activeOnlineZoneOrders.length > 0 ? 'text-white' : 'text-slate-500'
                }`}
              />
              <span>ONLINE</span>
              {activeOnlineZoneOrders.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-md bg-white/20 text-white text-[10px] leading-none font-black tabular-nums">
                  {activeOnlineZoneOrders.length}
                </span>
              )}
            </button>

            {/* RIDER Zone Chip: Highlighted RED alert while delivery jobs await/transit, WHITE when empty */}
            <button
              type="button"
              onClick={() => {
                setTopViewMode('rider');
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap active:translate-y-[1px] flex items-center gap-1.5 ${
                activeRiderZoneOrders.length > 0
                  ? topViewMode === 'rider'
                    ? 'bg-red-600 text-white border border-red-700 shadow-[0_3px_0_#991b1b,0_6px_14px_-4px_rgba(220,38,38,0.4)] ring-2 ring-red-300 ring-offset-1'
                    : 'bg-red-600 hover:bg-red-700 text-white border border-red-700 shadow-[0_3px_0_#991b1b,0_6px_14px_-4px_rgba(220,38,38,0.35)]'
                  : topViewMode === 'rider'
                  ? 'bg-white text-slate-900 border border-slate-400 shadow-[0_2px_0_#cbd5e1] ring-2 ring-slate-300'
                  : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 shadow-[0_2px_0_#e2e8f0]'
              }`}
            >
              <Bike
                className={`w-3.5 h-3.5 shrink-0 ${
                  activeRiderZoneOrders.length > 0 ? 'text-white' : 'text-slate-500'
                }`}
              />
              <span>RIDER</span>
              {activeRiderZoneOrders.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-md bg-white/20 text-white text-[10px] leading-none font-black tabular-nums">
                  {activeRiderZoneOrders.length}
                </span>
              )}
            </button>
          </div>

          {/* Customer Directory & Floor Plan Studio quick buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setCustomerModalInitialOpenForm(false);
                setCustomerModalInitialQuery('');
                setCustomerModalEditTarget(null);
                setCustomerSelectionCallbackMode(false);
                setIsCustomerModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl text-xs font-extrabold bg-orange-50 text-orange-800 border border-orange-200 hover:bg-orange-100 shadow-[0_2px_0_#fed7aa] cursor-pointer flex items-center gap-1.5 active:translate-y-[1px]"
            >
              <Users className="w-3.5 h-3.5 text-orange-600" />
              <span>{lang === 'th' ? 'ฐานข้อมูลลูกค้า' : 'Customers'}</span>
              {customers.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-md bg-white text-orange-700 border border-orange-200 text-[10px] leading-none font-black tabular-nums">
                  {customers.length}
                </span>
              )}
            </button>
            {onOpenFloorPlan && (
              <button
                type="button"
                onClick={onOpenFloorPlan}
                className="px-3 py-1.5 rounded-xl text-xs font-extrabold bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100 shadow-[0_2px_0_#fde68a] cursor-pointer flex items-center gap-1.5 active:translate-y-[1px]"
              >
                <Layers className="w-3.5 h-3.5 text-orange-600" />
                <span>{t.nav.floorPlan}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        {/* Left Side: Tables Floor Plan or Dishes Grid */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-transparent">
          {selectedCategoryId ? (
            // Full Screen Category Menu View
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-black text-lg text-neutral-800 flex items-center gap-2 flex-wrap">
                  <Utensils className="w-5 h-5 text-orange-600" />
                  <span>
                    {selectedCategoryId === 'all'
                      ? t.pos.allCategories
                      : (() => {
                          const cat = categories.find((c) => c.id === selectedCategoryId);
                          return (lang === 'th' && cat?.nameTh ? cat.nameTh : cat?.name) || t.pos.allCategories;
                        })()}
                  </span>
                  {activeBill?.tableName && (
                    <span className="px-2.5 py-0.5 rounded-lg bg-orange-100 text-orange-800 border border-orange-200 text-xs font-black">
                      {activeBill.tableName}
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-2 shrink-0 ml-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategoryId(null);
                      setTopViewMode('bills');
                    }}
                    className="px-3 py-1.5 bg-white hover:bg-neutral-50 text-neutral-700 rounded-xl text-xs font-bold border border-neutral-300 shadow-2xs cursor-pointer shrink-0"
                  >
                    ← {t.pos.billCard}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenPosAddDish(selectedCategoryId)}
                    className="px-3.5 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer hover:brightness-105 active:scale-95 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t.menuCost.addDish}</span>
                  </button>
                </div>
              </div>

              {/* Dish Cards (~30% smaller): Photo + Name, Draggable (Mouse & Touch) + Double-click Name to Edit */}
              {displayedDishes.length === 0 ? (
                <div className="p-8 bg-white/90 rounded-2xl border border-dashed border-slate-300 text-center space-y-3">
                  <p className="text-xs font-semibold text-slate-500">
                    {lang === 'th' ? 'ยังไม่มีเมนูอาหารในหมวดหมู่นี้' : 'No menu items in this category'}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleOpenPosAddDish(selectedCategoryId)}
                    className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md shadow-orange-500/20 inline-flex items-center gap-1.5 cursor-pointer hover:brightness-105"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t.menuCost.addDish}</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {displayedDishes.map((dish) => {
                    const imgDataUrl = dishImages.get(dish.id);
                    const isDraggingThis = draggingDishId === dish.id;
                    const isDropTarget = dragOverDishId === dish.id && draggingDishId !== dish.id;
                    return (
                      <div
                        key={dish.id}
                        data-dish-id={dish.id}
                        draggable
                        onMouseDown={(e) => {
                          if (e.button === 0) {
                            startDishEditHoldTimer(dish, e.clientX, e.clientY);
                          }
                        }}
                        onMouseMove={(e) => {
                          const origin = dishEditHoldOriginRef.current;
                          if (
                            origin &&
                            Math.hypot(e.clientX - origin.startX, e.clientY - origin.startY) > 8
                          ) {
                            clearDishEditHoldTimer();
                          }
                        }}
                        onMouseUp={clearDishEditHoldTimer}
                        onMouseLeave={clearDishEditHoldTimer}
                        onDragStart={(e) => {
                          clearDishEditHoldTimer();
                          if (dishNameClickTimerRef.current) {
                            clearTimeout(dishNameClickTimerRef.current);
                            dishNameClickTimerRef.current = null;
                          }
                          setDraggingDishId(dish.id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/kinpos-dish-id', dish.id);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          if (draggingDishId && draggingDishId !== dish.id) {
                            setDragOverDishId(dish.id);
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverDishId === dish.id) setDragOverDishId(null);
                        }}
                        onDrop={async (e) => {
                          e.preventDefault();
                          const srcId = e.dataTransfer.getData('text/kinpos-dish-id') || draggingDishId;
                          setDraggingDishId(null);
                          setDragOverDishId(null);
                          if (srcId && srcId !== dish.id) {
                            suppressDishClickRef.current = true;
                            setTimeout(() => {
                              suppressDishClickRef.current = false;
                            }, 180);
                            await reorderDishesByIds(srcId, dish.id);
                          }
                        }}
                        onDragEnd={() => {
                          clearDishEditHoldTimer();
                          setDraggingDishId(null);
                          setDragOverDishId(null);
                        }}
                        onTouchStart={(e) => handleDishTouchStart(e, dish)}
                        onTouchMove={handleDishTouchMove}
                        onTouchEnd={handleDishTouchEnd}
                        onTouchCancel={handleDishTouchEnd}
                        onClick={() => {
                          if (suppressDishClickRef.current) {
                            suppressDishClickRef.current = false;
                            return;
                          }
                          handleOpenDishOptions(dish);
                        }}
                        style={{ touchAction: draggingDishId ? 'none' : 'pan-y' }}
                        title={
                          lang === 'th'
                            ? 'แตะเพื่อสั่ง • กดค้าง 0.5 วินาที หรือดับเบิลคลิกชื่อเพื่อแก้ไข • ลากวางเพื่อสลับตำแหน่ง'
                            : 'Tap to order • Hold 0.5s or double-click name to edit • Drag & drop to reorder'
                        }
                        className={`group bg-white rounded-2xl border p-2.5 shadow-[inset_0_1px_0_#ffffff,0_2px_0_#e2e8f0,0_6px_12px_-6px_rgba(15,23,42,0.08)] hover:-translate-y-0.5 hover:shadow-[0_3px_0_#fdba74,0_10px_16px_-6px_rgba(234,88,12,0.18)] transition-all duration-150 cursor-grab active:cursor-grabbing flex flex-col items-center text-center select-none ${
                          isDraggingThis ? 'opacity-50 scale-95' : ''
                        } ${
                          isDropTarget
                            ? 'ring-2 ring-orange-500 ring-offset-1 scale-[1.03] border-orange-400'
                            : 'border-slate-200 hover:border-orange-400'
                        }`}
                      >
                        <div className="w-full aspect-square rounded-xl bg-slate-100 overflow-hidden mb-2 relative flex items-center justify-center shadow-[inset_0_1px_3px_rgba(15,23,42,0.06)]">
                          <span className="absolute top-1.5 left-1.5 z-10 p-1 rounded-md bg-white/75 backdrop-blur-xs text-slate-400 opacity-50 group-hover:opacity-100 pointer-events-none">
                            <GripVertical className="w-3.5 h-3.5" />
                          </span>
                          {imgDataUrl ? (
                            <img
                              src={imgDataUrl}
                              alt={dish.name}
                              draggable={false}
                              loading="lazy"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            />
                          ) : (
                            <Utensils className="w-10 h-10 text-slate-300" />
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (suppressDishClickRef.current) {
                              suppressDishClickRef.current = false;
                              return;
                            }
                            const now = Date.now();
                            const prevTap = lastDishNameTapRef.current;
                            if (
                              e.detail >= 2 ||
                              (prevTap && prevTap.dishId === dish.id && now - prevTap.ts < 340)
                            ) {
                              lastDishNameTapRef.current = null;
                              handleOpenPosEditDish(dish);
                              return;
                            }
                            lastDishNameTapRef.current = { dishId: dish.id, ts: now };
                            if (dishNameClickTimerRef.current) clearTimeout(dishNameClickTimerRef.current);
                            dishNameClickTimerRef.current = setTimeout(() => {
                              dishNameClickTimerRef.current = null;
                              handleOpenDishOptions(dish);
                            }, 240);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            lastDishNameTapRef.current = null;
                            handleOpenPosEditDish(dish);
                          }}
                          title={
                            lang === 'th'
                              ? 'กดค้าง 0.5 วินาที หรือดับเบิลคลิกที่ชื่อเมนูเพื่อเปิดโหมดแก้ไขทันที'
                              : 'Hold 0.5s or double-click dish name to edit immediately'
                          }
                          className="w-full block text-center font-extrabold text-xs sm:text-sm leading-tight text-slate-900 group-hover:text-orange-600 hover:underline decoration-orange-400/70 underline-offset-2 transition-colors line-clamp-2 px-1.5 py-1.5 rounded cursor-pointer"
                        >
                          {lang === 'th' && dish.nameTh ? dish.nameTh : dish.name}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : topViewMode === 'bills' ? (
            // Unpaid Ordered Bills View ("บิล"): Displays ONLY ordered bills awaiting payment, draggable on desktop & touch
            <div className="relative flex-1 min-h-0 overflow-y-auto bg-slate-100/60 p-3 sm:p-4">
              {orderSavedNotice && (
                <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-2xl bg-emerald-600 text-white text-xs font-extrabold shadow-lg shadow-emerald-600/25 flex items-center gap-1.5 pointer-events-none">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>{orderSavedNotice}</span>
                </div>
              )}

              {unpaidOrderedBills.length === 0 ? (
                <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center p-6">
                  <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-center mb-3">
                    <Receipt className="w-7 h-7 text-slate-300" />
                  </div>
                  <div className="font-black text-sm text-slate-700">
                    {lang === 'th' ? 'ไม่มีบิลรอชำระเงิน' : 'No unpaid ordered bills'}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                  {unpaidOrderedBills.map((bill) => {
                    const isSelected = activeBill?.id === bill.id;
                    const isDraggingThis = draggingBillId === bill.id;
                    const isDropTarget = dragOverBillId === bill.id && draggingBillId !== bill.id;

                    return (
                      <div
                        key={bill.id}
                        data-bill-id={bill.id}
                        draggable
                        onDragStart={(e) => {
                          setDraggingBillId(bill.id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/kinpos-bill-id', bill.id);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          if (draggingBillId && draggingBillId !== bill.id) {
                            setDragOverBillId(bill.id);
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverBillId === bill.id) setDragOverBillId(null);
                        }}
                        onDrop={async (e) => {
                          e.preventDefault();
                          const srcId = e.dataTransfer.getData('text/kinpos-bill-id') || draggingBillId;
                          setDraggingBillId(null);
                          setDragOverBillId(null);
                          if (srcId && srcId !== bill.id) {
                            await reorderBillsByIds(srcId, bill.id);
                          }
                        }}
                        onDragEnd={() => {
                          setDraggingBillId(null);
                          setDragOverBillId(null);
                        }}
                        onTouchStart={(e) => handleBillTouchStart(e, bill.id)}
                        onTouchMove={handleBillTouchMove}
                        onTouchEnd={handleBillTouchEnd}
                        onTouchCancel={handleBillTouchEnd}
                        onClick={() => {
                          if (suppressBillClickRef.current) {
                            suppressBillClickRef.current = false;
                            return;
                          }
                          handleOpenSavedBill(bill);
                        }}
                        style={{ touchAction: draggingBillId ? 'none' : 'pan-y' }}
                        className={`bg-white rounded-xl border p-2 transition-all select-none flex flex-col justify-between gap-1.5 cursor-grab active:cursor-grabbing shadow-[0_2px_0_#e2e8f0,0_4px_10px_-6px_rgba(15,23,42,0.1)] ${
                          isDraggingThis ? 'opacity-55 scale-95' : ''
                        } ${
                          isDropTarget ? 'ring-2 ring-orange-500 ring-offset-1 scale-[1.02]' : ''
                        } ${
                          isSelected
                            ? 'border-orange-500 ring-2 ring-orange-300'
                            : 'border-slate-200 hover:border-orange-300'
                        }`}
                      >
                        {/* Table / Order Type Name */}
                        <div className="flex items-center justify-between gap-1 min-w-0">
                          <div className="flex items-center gap-1 min-w-0">
                            <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                            <div className="font-black text-xs text-slate-900 truncate">
                              {bill.tableName ||
                                (bill.orderType === 'delivery'
                                  ? bill.customerName
                                    ? `Delivery • ${bill.customerName}`
                                    : 'Delivery'
                                  : bill.orderType === 'takeaway'
                                  ? lang === 'th'
                                    ? 'สั่งกลับบ้าน'
                                    : 'Takeaway'
                                  : lang === 'th'
                                  ? 'ไม่ระบุโต๊ะ'
                                  : 'Walk-In')}
                            </div>
                          </div>
                          {(bill.deliveryAddress || bill.customerName || bill.customerPhone) && (
                            <button
                              type="button"
                              data-bill-pay-btn="true"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeliveryPrintTarget({
                                  customerName: bill.customerName || '',
                                  customerPhone: bill.customerPhone || '',
                                  deliveryAddress: bill.deliveryAddress || '',
                                  billNumber: bill.billNumber,
                                  workDate: bill.workDate,
                                  items: bill.items,
                                  grandTotal: bill.grandTotal,
                                  status: bill.status,
                                });
                              }}
                              title={lang === 'th' ? 'พิมพ์ที่อยู่ลูกค้า' : 'Print Customer Address'}
                              className="p-1 rounded-md bg-orange-50 hover:bg-orange-100 text-orange-600 border border-orange-200 shrink-0 cursor-pointer"
                            >
                              <MapPin className="w-3 h-3" />
                            </button>
                          )}
                        </div>

                        {bill.orderType === 'delivery' && bill.deliveryAddress && (
                          <div className="text-[10px] text-slate-500 truncate pl-4">
                            {bill.deliveryAddress}
                          </div>
                        )}

                        {/* Grand Total + Pay Button */}
                        <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-100">
                          <div className="text-xs sm:text-sm font-black text-orange-600 tabular-nums truncate">
                            ฿{formatMoney(bill.grandTotal)}
                          </div>

                          <button
                            type="button"
                            data-bill-pay-btn="true"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleQuickPaySavedBill(bill);
                            }}
                            className="px-2 py-1 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 hover:brightness-105 text-white text-[11px] font-black flex items-center gap-1 shadow-xs cursor-pointer active:scale-95 shrink-0"
                          >
                            <CreditCard className="w-3 h-3 text-amber-200" />
                            <span>{lang === 'th' ? 'ชำระเงิน' : 'Pay'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : topViewMode === 'online' ? (
            // ONLINE Zone View: Connected Medium Online Order Cards synchronized with ออเดอร์ออนไลน์ & Rider
            <div className="relative flex-1 min-h-0 overflow-y-auto bg-slate-100/60 p-3 sm:p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-xl border border-slate-200 px-3.5 py-2.5 shadow-2xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      activeOnlineZoneOrders.length > 0
                        ? 'bg-red-600 text-white'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <ShoppingBag className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-black text-slate-900">
                        {lang === 'th' ? 'โซน ONLINE' : 'ONLINE Zone'}
                      </h3>
                      <span
                        className={`text-xs font-extrabold tabular-nums ${
                          activeOnlineZoneOrders.length > 0 ? 'text-red-600' : 'text-slate-500'
                        }`}
                      >
                        {lang === 'th'
                          ? `ค้างทำ ${activeOnlineZoneOrders.length} ออเดอร์`
                          : `${activeOnlineZoneOrders.length} active`}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 truncate">
                      {lang === 'th'
                        ? 'เชื่อมต่อข้อมูลเรียลไทม์กับ ออเดอร์ออนไลน์ & Rider — แตะการ์ดเพื่อดูรายละเอียดหรือกดทำเสร็จแล้ว'
                        : 'Live synced with Online Orders & Rider — tap a card for details or mark done'}
                    </p>
                  </div>
                </div>
                {onOpenOnlineOrdersPage && (
                  <button
                    type="button"
                    onClick={onOpenOnlineOrdersPage}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>{lang === 'th' ? 'ไปหน้า ออเดอร์ออนไลน์ & Rider' : 'Open Online Orders'}</span>
                  </button>
                )}
              </div>

              {onlineZoneError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between gap-2">
                  <span>{onlineZoneError}</span>
                  <button
                    type="button"
                    onClick={() => setOnlineZoneError(null)}
                    className="text-rose-500 hover:text-rose-800 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {activeOnlineZoneOrders.length === 0 ? (
                <div className="min-h-[260px] flex flex-col items-center justify-center text-center p-6 bg-white rounded-2xl border border-slate-200">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mb-3">
                    <CheckCircle2 className="w-6 h-6 text-slate-400" />
                  </div>
                  <div className="font-black text-sm text-slate-800">
                    {lang === 'th' ? 'ไม่มีออเดอร์ออนไลน์ค้างทำในโซน ONLINE' : 'No active online orders'}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {lang === 'th'
                      ? 'เมื่อกดรับออเดอร์ออนไลน์ใหม่ การ์ดออเดอร์จะแสดงที่นี่อัตโนมัติ'
                      : 'Accepted online orders will appear here automatically'}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {activeOnlineZoneOrders.map((order) => {
                    const displayIds = onlineOrderNumberingMap.get(order.id);
                    const statusMeta = ONLINE_STATUS_META[order.status] || ONLINE_STATUS_META.accepted;
                    const createdDate = toDateSafe(order.createdAt);
                    const isCompleting = completingOnlineOrderId === order.id;

                    return (
                      <article
                        key={order.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedOnlineOrderId(order.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedOnlineOrderId(order.id);
                          }
                        }}
                        className="bg-white rounded-xl border border-slate-200 hover:border-orange-300 p-3.5 shadow-[0_2px_0_#e2e8f0,0_4px_12px_-6px_rgba(15,23,42,0.08)] flex flex-col justify-between gap-2.5 cursor-pointer transition-colors text-left"
                      >
                        {/* Header: Order No + Status + Time */}
                        <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-lg font-black text-slate-900 tracking-tight uppercase tabular-nums">
                                {displayIds?.displayNumber || order.orderNumber}
                              </span>
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border-2 text-xs font-black shadow-2xs ${statusMeta.surfaceCls}`}
                              >
                                <span className={`w-2 h-2 rounded-full shrink-0 ${statusMeta.dotCls}`} />
                                <span>{statusMeta[lang]}</span>
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
                              {lang === 'th' ? 'เลขอ้างอิง:' : 'Ref:'}{' '}
                              {displayIds?.referenceNumber || order.orderNumber}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-0.5 shrink-0">
                            <span
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-extrabold ${
                                order.orderMode === 'delivery'
                                  ? 'bg-orange-50 text-orange-800 border-orange-200'
                                  : 'bg-sky-50 text-sky-800 border-sky-200'
                              }`}
                            >
                              {order.orderMode === 'delivery' ? (
                                <Bike className="w-3 h-3" />
                              ) : (
                                <Store className="w-3 h-3" />
                              )}
                              <span>
                                {order.orderMode === 'delivery'
                                  ? lang === 'th'
                                    ? 'เดลิเวอรี'
                                    : 'Delivery'
                                  : lang === 'th'
                                  ? 'รับที่ร้าน'
                                  : 'Pickup'}
                              </span>
                            </span>
                            {createdDate && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 tabular-nums">
                                <Clock className="w-2.5 h-2.5" />
                                {createdDate.toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-US', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Customer + Compact Item Preview */}
                        <div className="space-y-1.5 text-xs flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 font-bold text-slate-900 min-w-0">
                              <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="truncate">{order.customerName}</span>
                            </div>
                            <a
                              href={`tel:${order.customerPhone}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:underline tabular-nums shrink-0"
                            >
                              <Phone className="w-3 h-3" />
                              <span>{order.customerPhone}</span>
                            </a>
                          </div>

                          <div className="flex items-start gap-1.5 text-[11px] text-slate-600">
                            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                            <span className="line-clamp-1">
                              {order.orderMode === 'delivery'
                                ? order.deliveryAddress ||
                                  (lang === 'th' ? 'ไม่ระบุที่อยู่' : 'No address provided')
                                : lang === 'th'
                                ? 'รับเองที่ร้าน'
                                : 'Self-Pickup at Store'}
                            </span>
                          </div>
                        </div>

                        {/* Footer: Total + Print/Done Controls */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                          <div>
                            <div className="text-[10px] font-semibold text-slate-500">
                              {order.items.reduce((s, i) => s + i.quantity, 0)}{' '}
                              {lang === 'th' ? 'รายการ' : 'items'}
                            </div>
                            <div className="text-sm font-black text-orange-600 tabular-nums leading-tight">
                              ฿{formatMoney(order.totalAmount)}
                            </div>
                          </div>

                          <div
                            className="flex items-center gap-1.5 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setPrintingOnlineOrderAutoPrint(false);
                                setPrintingOnlineOrder(order);
                              }}
                              title={lang === 'th' ? 'พิมพ์ใบรายการ' : 'Print Receipt'}
                              className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer transition-colors"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={isCompleting}
                              onClick={() =>
                                handleOnlineZoneStatusChange(
                                  order,
                                  resolveNextReadyActionStatus(order.orderMode)
                                )
                              }
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95 disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                {isCompleting
                                  ? lang === 'th'
                                    ? 'กำลังบันทึก...'
                                    : 'Saving...'
                                  : lang === 'th'
                                  ? 'เสร็จแล้ว / พร้อมส่ง'
                                  : 'Done / Ready'}
                              </span>
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          ) : topViewMode === 'rider' ? (
            // RIDER Zone View: Live synchronized with Rider App delivery queue
            <div className="relative flex-1 min-h-0 overflow-y-auto bg-slate-100/60 p-3 sm:p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-xl border border-slate-200 px-3.5 py-2.5 shadow-2xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      activeRiderZoneOrders.length > 0
                        ? 'bg-red-600 text-white'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <Bike className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-black text-slate-900">
                        {lang === 'th' ? 'โซน RIDER (รอจัดส่ง / กำลังส่ง)' : 'RIDER Zone'}
                      </h3>
                      <span
                        className={`text-xs font-extrabold tabular-nums ${
                          activeRiderZoneOrders.length > 0 ? 'text-red-600' : 'text-slate-500'
                        }`}
                      >
                        {lang === 'th'
                          ? `ค้างส่ง ${activeRiderZoneOrders.length} งาน`
                          : `${activeRiderZoneOrders.length} active deliveries`}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 truncate">
                      {lang === 'th'
                        ? 'ซิงค์สถานะแบบเรียลไทม์กับแอป Rider — เมื่อไรเดอร์ส่งสำเร็จหรือกดปิดงาน ยอดจะเข้า P&L อัตโนมัติ'
                        : 'Live synced with Rider App — completed deliveries sync directly into P&L'}
                    </p>
                  </div>
                </div>
                {onOpenOnlineOrdersPage && (
                  <button
                    type="button"
                    onClick={onOpenOnlineOrdersPage}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>{lang === 'th' ? 'ไปหน้า ออเดอร์ออนไลน์ & Rider' : 'Open Online Orders'}</span>
                  </button>
                )}
              </div>

              {onlineZoneError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between gap-2">
                  <span>{onlineZoneError}</span>
                  <button
                    type="button"
                    onClick={() => setOnlineZoneError(null)}
                    className="text-rose-500 hover:text-rose-800 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {activeRiderZoneOrders.length === 0 ? (
                <div className="min-h-[260px] flex flex-col items-center justify-center text-center p-6 bg-white rounded-2xl border border-slate-200">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mb-3">
                    <Bike className="w-6 h-6 text-slate-400" />
                  </div>
                  <div className="font-black text-sm text-slate-800">
                    {lang === 'th' ? 'ไม่มีงานจัดส่งค้างในโซน RIDER' : 'No active Rider deliveries'}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {lang === 'th'
                      ? 'เมื่อกด "เสร็จแล้ว / พร้อมส่ง" กับออเดอร์เดลิเวอรี การ์ดงานส่งจะย้ายมาที่นี่และเข้าแอป Rider ทันที'
                      : 'Delivery orders marked Ready from ONLINE zone will appear here and in the Rider App'}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {activeRiderZoneOrders.map((order) => {
                    const displayIds = onlineOrderNumberingMap.get(order.id);
                    const statusMeta = ONLINE_STATUS_META[order.status] || ONLINE_STATUS_META.ready_for_pickup;
                    const createdDate = toDateSafe(order.createdAt);
                    const isCompleting = completingOnlineOrderId === order.id;

                    return (
                      <article
                        key={order.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedOnlineOrderId(order.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedOnlineOrderId(order.id);
                          }
                        }}
                        className="bg-white rounded-xl border border-slate-200 hover:border-emerald-400 p-3.5 shadow-[0_2px_0_#e2e8f0,0_4px_12px_-6px_rgba(15,23,42,0.08)] flex flex-col justify-between gap-2.5 cursor-pointer transition-colors text-left"
                      >
                        {/* Header: Order No + Rider Status + Time */}
                        <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-lg font-black text-slate-900 tracking-tight uppercase tabular-nums">
                                {displayIds?.displayNumber || order.orderNumber}
                              </span>
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border-2 text-xs font-black shadow-2xs ${statusMeta.surfaceCls}`}
                              >
                                <span className={`w-2 h-2 rounded-full shrink-0 ${statusMeta.dotCls}`} />
                                <span>
                                  {order.riderName
                                    ? `${statusMeta[lang]} • ${order.riderName}`
                                    : statusMeta[lang]}
                                </span>
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
                              {lang === 'th' ? 'เลขอ้างอิง:' : 'Ref:'}{' '}
                              {displayIds?.referenceNumber || order.orderNumber}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-0.5 shrink-0">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-extrabold bg-emerald-50 text-emerald-800 border-emerald-200">
                              <Bike className="w-3 h-3" />
                              <span>{lang === 'th' ? 'RIDER' : 'RIDER'}</span>
                            </span>
                            {createdDate && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 tabular-nums">
                                <Clock className="w-2.5 h-2.5" />
                                {createdDate.toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-US', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Customer + Address + Compact Items */}
                        <div className="space-y-1.5 text-xs flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 font-bold text-slate-900 min-w-0">
                              <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="truncate">{order.customerName}</span>
                            </div>
                            <a
                              href={`tel:${order.customerPhone}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:underline tabular-nums shrink-0"
                            >
                              <Phone className="w-3 h-3" />
                              <span>{order.customerPhone}</span>
                            </a>
                          </div>

                          <div className="flex items-start gap-1.5 text-[11px] text-slate-600">
                            <MapPin className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
                            <span className="line-clamp-2">
                              {order.deliveryAddress ||
                                (lang === 'th' ? 'ไม่ระบุที่อยู่' : 'No address provided')}
                            </span>
                          </div>
                        </div>

                        {/* Footer: Total + Print/Delivery Controls */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                          <div>
                            <div className="text-[10px] font-semibold text-slate-500">
                              {order.items.reduce((s, i) => s + i.quantity, 0)}{' '}
                              {lang === 'th' ? 'รายการ' : 'items'} •{' '}
                              {order.paymentMethod === 'cash'
                                ? lang === 'th'
                                  ? 'เก็บเงินสด'
                                  : 'Cash'
                                : lang === 'th'
                                ? 'โอน QR'
                                : 'QR PromptPay'}
                            </div>
                            <div className="text-sm font-black text-orange-600 tabular-nums leading-tight">
                              ฿{formatMoney(order.totalAmount)}
                            </div>
                          </div>

                          <div
                            className="flex items-center gap-1.5 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setPrintingOnlineOrderAutoPrint(false);
                                setPrintingOnlineOrder(order);
                              }}
                              title={lang === 'th' ? 'พิมพ์ใบรายการ' : 'Print Receipt'}
                              className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer transition-colors"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            {order.status === 'ready_for_pickup' ? (
                              <button
                                type="button"
                                disabled={isCompleting}
                                onClick={() =>
                                  handleOnlineZoneStatusChange(order, 'out_for_delivery')
                                }
                                className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-black flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95 disabled:opacity-50"
                              >
                                <Bike className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  {isCompleting
                                    ? lang === 'th'
                                      ? 'กำลังบันทึก...'
                                      : 'Saving...'
                                    : lang === 'th'
                                    ? 'กำลังไปส่ง'
                                    : 'On The Way'}
                                </span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isCompleting}
                                onClick={() => handleOnlineZoneStatusChange(order, 'completed')}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95 disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  {isCompleting
                                    ? lang === 'th'
                                      ? 'กำลังบันทึก...'
                                      : 'Saving...'
                                    : lang === 'th'
                                    ? 'ส่งสำเร็จ'
                                    : 'Delivered'}
                                </span>
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            // Specific Zone Floor Plan (Strictly Read-Only, dynamically sized & auto-fitted to viewport)
            <div
              ref={floorViewportRef}
              className="relative flex-1 min-h-0 overflow-auto bg-slate-100/60 p-1 flex items-start sm:items-center"
            >
              {orderSavedNotice && (
                <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-2xl bg-emerald-600 text-white text-xs font-extrabold shadow-lg shadow-emerald-600/25 flex items-center gap-1.5 pointer-events-none">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>{orderSavedNotice}</span>
                </div>
              )}
              <div
                className="shrink-0 mx-auto"
                style={{
                  width: `${Math.round(posCanvasSize.width * floorScale)}px`,
                  height: `${Math.round(posCanvasSize.height * floorScale)}px`,
                }}
              >
                <div
                  style={{
                    width: `${posCanvasSize.width}px`,
                    height: `${posCanvasSize.height}px`,
                    transform: `scale(${floorScale})`,
                    transformOrigin: 'top left',
                  }}
                  className="kin-3d-floorplan relative overflow-hidden cursor-default rounded-2xl border border-slate-200/90"
                >
                  {zoneTables.map((tbl) => {
                    const isOccupied = !!tbl.currentBillId;
                    const isSelected = activeBill?.tableId === tbl.id;

                    return (
                      <div
                        key={tbl.id}
                        onClick={() => handleSelectTable(tbl)}
                        style={{ left: `${tbl.x}px`, top: `${tbl.y}px` }}
                        className={`absolute cursor-pointer select-none ${
                          isSelected ? 'z-20' : 'z-10'
                        }`}
                      >
                        <TableVisual
                          table={tbl}
                          isSelected={isSelected}
                          isOccupied={isOccupied}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right/Bottom Side: Active Order Sidebar / Elevated 3D Bill Card */}
        {selectedCategoryId !== null && (
        <div className="w-full md:w-80 lg:w-96 max-h-[42dvh] md:max-h-none bg-white border-t md:border-t-0 md:border-l border-slate-200 flex flex-col shadow-[0_-6px_24px_-10px_rgba(15,23,42,0.12)] md:shadow-[-8px_0_28px_-12px_rgba(15,23,42,0.12)] z-10 shrink-0">
          {/* Order Header */}
          <div className="p-3.5 bg-slate-50/90 border-b border-slate-200 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h4 className="font-black text-sm text-neutral-900 flex items-center gap-1.5 truncate">
                  <Receipt className="w-4 h-4 text-orange-600 shrink-0" />
                  <span className="truncate">
                    {activeBill?.tableName ? `${activeBill.tableName}` : lang === 'th' ? 'บิลปัจจุบัน' : 'Current Bill'}
                  </span>
                </h4>
              </div>

              {/* Strictly 3-Channel Selector */}
              <select
                value={currentChannel?.id || selectedChannelId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedChannelId(nextId);
                  const nextCh = posChannels.find((c) => c.id === nextId);
                  if (activeBill && nextCh) {
                    setActiveBill({
                      ...activeBill,
                      channelId: nextCh.id,
                      channelName: nextCh.name,
                      orderType: nextCh.type,
                    });
                  }
                }}
                className="px-2 py-1 text-xs font-bold bg-white border border-neutral-300 rounded-lg text-neutral-800 focus:ring-1 focus:ring-orange-500 max-w-[195px] shrink-0"
              >
                {posChannels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {getPosChannelOptionLabel(ch, lang)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Delivery Customer Lookup & Address Label Section */}
          {isDeliveryChannel && (
            <div className="px-3 py-2 bg-orange-50/80 border-b border-orange-200 space-y-2 shrink-0">
              {/* Quick Search by House No. / Phone + Customer Directory button */}
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-3.5 h-3.5 text-orange-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={customerQuickSearch}
                    onFocus={() => setIsCustomerSearchOpen(true)}
                    onChange={(e) => {
                      setCustomerQuickSearch(e.target.value);
                      setIsCustomerSearchOpen(true);
                    }}
                    placeholder={
                      lang === 'th'
                        ? 'ค้นหาบ้านเลขที่ / เบอร์โทร...'
                        : 'Search house no. / phone...'
                    }
                    className="w-full pl-8 pr-6 py-1.5 text-xs bg-white border border-orange-300 rounded-lg text-neutral-900 placeholder:text-neutral-400 focus:outline-hidden focus:ring-1 focus:ring-orange-500"
                  />
                  {(customerQuickSearch || isCustomerSearchOpen) && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerQuickSearch('');
                        setIsCustomerSearchOpen(false);
                      }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {/* Quick Match Dropdown */}
                  {isCustomerSearchOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-orange-200 rounded-xl shadow-xl max-h-48 overflow-y-auto divide-y divide-neutral-100">
                      {filteredQuickCustomers.map((cust) => {
                        const houseNo = cust.houseNumber || extractHouseNumber(cust.address);
                        return (
                          <button
                            key={cust.id}
                            type="button"
                            onClick={() => {
                              setAttachedCustomer({
                                customerId: cust.id,
                                customerName: cust.name,
                                customerPhone: cust.phone,
                                deliveryAddress: cust.address,
                              });
                              setCustomerQuickSearch('');
                              setIsCustomerSearchOpen(false);
                            }}
                            className="w-full text-left px-2.5 py-2 hover:bg-orange-50 transition-colors cursor-pointer space-y-0.5"
                          >
                            <div className="flex items-center justify-between gap-1.5 text-xs">
                              <span className="font-bold text-neutral-900 truncate">{cust.name}</span>
                              {houseNo && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-black shrink-0 inline-flex items-center gap-0.5">
                                  <Home className="w-2.5 h-2.5" />
                                  {houseNo}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-neutral-600 flex items-center gap-2 truncate">
                              {cust.phone && <span className="font-semibold">{cust.phone}</span>}
                              {cust.address && <span className="truncate">{cust.address}</span>}
                            </div>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomerSearchOpen(false);
                          setCustomerModalEditTarget(null);
                          setCustomerModalInitialQuery(customerQuickSearch.trim());
                          setCustomerModalInitialOpenForm(true);
                          setCustomerSelectionCallbackMode(true);
                          setIsCustomerModalOpen(true);
                        }}
                        className="w-full px-2.5 py-2 text-left text-xs font-bold text-orange-700 bg-orange-50/70 hover:bg-orange-100 flex items-center gap-1.5 cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          {customerQuickSearch.trim()
                            ? lang === 'th'
                              ? `+ เพิ่มลูกค้าใหม่ "${customerQuickSearch.trim()}"`
                              : `+ Add "${customerQuickSearch.trim()}"`
                            : lang === 'th'
                            ? '+ บันทึกลูกค้าใหม่'
                            : '+ Add New Customer'}
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsCustomerSearchOpen(false);
                    setCustomerModalEditTarget(null);
                    setCustomerModalInitialQuery(customerQuickSearch.trim());
                    setCustomerModalInitialOpenForm(customers.length === 0);
                    setCustomerSelectionCallbackMode(true);
                    setIsCustomerModalOpen(true);
                  }}
                  title={lang === 'th' ? 'เลือก / เพิ่มข้อมูลลูกค้า' : 'Select / Add Customer'}
                  className="px-2 py-1.5 bg-white hover:bg-orange-100 text-orange-800 border border-orange-300 rounded-lg text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5 text-orange-600" />
                  <span>{lang === 'th' ? 'ลูกค้า' : 'Add'}</span>
                </button>
              </div>

              {/* Attached Delivery Customer Summary & Print Address Button */}
              {attachedCustomer &&
              (attachedCustomer.customerName ||
                attachedCustomer.customerPhone ||
                attachedCustomer.deliveryAddress) ? (
                <div className="p-2 bg-white rounded-xl border border-orange-200 space-y-1.5">
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="text-xs font-extrabold text-neutral-900 flex items-center gap-1.5 flex-wrap">
                        <span>{attachedCustomer.customerName}</span>
                        {attachedCustomer.customerPhone && (
                          <span className="text-[11px] font-bold text-orange-700 inline-flex items-center gap-0.5 tabular-nums">
                            <Phone className="w-3 h-3" />
                            {attachedCustomer.customerPhone}
                          </span>
                        )}
                      </div>
                      {attachedCustomer.deliveryAddress && (
                        <div className="text-[11px] text-neutral-600 flex items-start gap-1 leading-snug">
                          <MapPin className="w-3 h-3 text-rose-500 shrink-0 mt-0.5" />
                          <span className="line-clamp-2 break-words">
                            {attachedCustomer.deliveryAddress}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          const existingCust = attachedCustomer.customerId
                            ? customers.find((c) => c.id === attachedCustomer.customerId) || null
                            : null;
                          setCustomerModalEditTarget(
                            existingCust || {
                              id: `cust_${Date.now()}`,
                              name: attachedCustomer.customerName,
                              phone: attachedCustomer.customerPhone,
                              address: attachedCustomer.deliveryAddress,
                              houseNumber: extractHouseNumber(attachedCustomer.deliveryAddress),
                              createdAt: new Date().toISOString(),
                              updatedAt: new Date().toISOString(),
                              version: 1,
                            }
                          );
                          setCustomerModalInitialOpenForm(true);
                          setCustomerModalInitialQuery('');
                          setCustomerSelectionCallbackMode(true);
                          setIsCustomerModalOpen(true);
                        }}
                        title={lang === 'th' ? 'แก้ไขข้อมูลลูกค้า' : 'Edit Customer'}
                        className="p-1 text-neutral-400 hover:text-orange-600 rounded cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setAttachedCustomer(null)}
                        title={lang === 'th' ? 'นำออก' : 'Clear'}
                        className="p-1 text-neutral-400 hover:text-rose-600 rounded cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setDeliveryPrintTarget({
                        customerName: attachedCustomer.customerName,
                        customerPhone: attachedCustomer.customerPhone,
                        deliveryAddress: attachedCustomer.deliveryAddress,
                        billNumber: activeBill?.billNumber || undefined,
                        workDate: activeBill?.workDate,
                        items: cartItems,
                        grandTotal: financials.grandTotal,
                        status: activeBill?.status || 'saved',
                      })
                    }
                    className="w-full py-1.5 px-2.5 bg-orange-100 hover:bg-orange-200 text-orange-900 border border-orange-300 rounded-lg text-[11px] font-black flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Printer className="w-3.5 h-3.5 text-orange-700" />
                    <span>{lang === 'th' ? 'พิมพ์ที่อยู่ลูกค้า' : 'Print Customer Address'}</span>
                  </button>
                </div>
              ) : (
                <div className="text-[10px] text-orange-800/80 font-medium">
                  {lang === 'th'
                    ? 'เลือกหรือเพิ่มข้อมูลลูกค้าเพื่อติดหน้าถุงและพิมพ์ท้ายใบเสร็จ'
                    : 'Select or add a delivery customer for bag label & receipt'}
                </div>
              )}
            </div>
          )}

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {cartItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-neutral-400 text-center p-4">
                <ShoppingBag className="w-10 h-10 mb-2 text-neutral-300" />
                <p className="font-semibold text-xs text-neutral-600">{t.pos.cartEmpty}</p>
              </div>
            ) : (
              cartItems.map((item, idx) => {
                const itemTotal = item.unitPrice * item.quantity;
                return (
                  <div
                    key={idx}
                    className="p-2.5 bg-neutral-50 rounded-xl border border-neutral-200 space-y-1.5"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1 pr-2">
                        <div className="font-bold text-xs text-neutral-900">
                          {item.dishName}
                          {item.variantName && item.variantName !== 'Standard' && (
                            <span className="text-neutral-500"> ({item.variantName})</span>
                          )}
                        </div>

                        {/* Snapshot cost alert */}
                        {!item.hasRecipe && (
                          <div className="text-[10px] font-bold text-amber-600 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            <span>{t.pos.noRecipeLinked}</span>
                          </div>
                        )}

                        {item.options?.length > 0 && (
                          <div className="text-[10px] text-neutral-500">
                            {item.options.map((o) => `+ ${o.choiceName}`).join(', ')}
                          </div>
                        )}
                        {item.notes && (
                          <div className="text-[10px] text-amber-700 italic">
                            * {item.notes}
                          </div>
                        )}
                      </div>

                      <div className="font-black text-xs text-neutral-900">
                        ฿{formatMoney(itemTotal)}
                      </div>
                    </div>

                    {/* Quantity Modifier */}
                    <div className="flex items-center justify-between pt-1 border-t border-neutral-200">
                      <span className="text-[10px] text-neutral-500">
                        @ ฿{formatMoney(item.unitPrice)}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleUpdateItemQuantity(idx, item.quantity - 1)}
                          className="w-5 h-5 rounded-md bg-neutral-200 hover:bg-neutral-300 text-neutral-800 text-xs font-bold flex items-center justify-center cursor-pointer"
                        >
                          -
                        </button>
                        <span className="font-bold text-xs w-4 text-center">{item.quantity}</span>
                        <button
                          onClick={() => handleUpdateItemQuantity(idx, item.quantity + 1)}
                          className="w-5 h-5 rounded-md bg-neutral-200 hover:bg-neutral-300 text-neutral-800 text-xs font-bold flex items-center justify-center cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Cart Financial Summary & Actions */}
          <div className="p-3.5 bg-neutral-50 border-t border-neutral-200 space-y-2">
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-neutral-600">
                <span>{t.pos.subtotal}</span>
                <span className="font-bold">฿{formatMoney(financials.subtotal)}</span>
              </div>
              {financials.serviceChargeAmount > 0 && (
                <div className="flex justify-between text-neutral-600">
                  <span>
                    {t.pos.serviceCharge} ({settings.serviceChargePercent}%)
                    {settings.pricesIncludeVat && settings.serviceChargeIncludedInPrice ? ' (Incl.)' : ''}
                  </span>
                  <span>฿{formatMoney(financials.serviceChargeAmount)}</span>
                </div>
              )}
              {financials.vatAmount > 0 && (
                <div className="flex justify-between text-neutral-600">
                  <span>
                    {t.pos.vat} ({settings.vatPercent}%)
                    {settings.pricesIncludeVat ? ' (Incl.)' : ''}
                  </span>
                  <span>฿{formatMoney(financials.vatAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-black text-neutral-900 pt-1 border-t border-neutral-200">
                <span>{t.pos.grandTotal}</span>
                <span className="text-orange-600">฿{formatMoney(financials.grandTotal)}</span>
              </div>
            </div>

            {/* POS Primary Action Buttons */}
            <div className="space-y-1.5 pt-1">
              {orderSavedNotice && (
                <div className="px-2.5 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-extrabold flex items-center justify-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate">{orderSavedNotice}</span>
                </div>
              )}
              <div className="flex gap-1.5">
                {/* Print Check Receipt for unpaid saved bill */}
                <button
                  type="button"
                  disabled={!activeBill?.billNumber || cartItems.length === 0}
                  onClick={handlePrintCheckReceipt}
                  className="flex-1 py-2 px-2 bg-neutral-200 hover:bg-neutral-300 text-neutral-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40"
                  title="Print receipt for customer to check before paying"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span className="truncate">{t.pos.printCheckReceipt}</span>
                </button>

                {/* Confirm / Save Order to Table */}
                <button
                  type="button"
                  disabled={cartItems.length === 0 || isSavingOrder}
                  onClick={handleInitiateConfirmOrder}
                  className="flex-1 py-2 px-2 bg-orange-100 hover:bg-orange-200 text-orange-900 border border-orange-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40"
                >
                  <Check className="w-3.5 h-3.5 text-orange-600" />
                  <span className="truncate">
                    {isSavingOrder
                      ? lang === 'th'
                        ? 'กำลังบันทึก...'
                        : 'Saving...'
                      : t.pos.confirmOrder}
                  </span>
                </button>
              </div>

              {/* Pay Now Button (Blocked until order saved to table!) */}
              <button
                type="button"
                disabled={cartItems.length === 0}
                onClick={handleProceedToPayment}
                className="w-full py-3 bg-gradient-to-r from-orange-500 to-red-500 hover:brightness-105 text-white rounded-xl text-sm font-black flex items-center justify-center gap-2 shadow-md shadow-orange-500/25 active:scale-98 cursor-pointer disabled:opacity-40"
              >
                <CreditCard className="w-4 h-4 text-amber-200" />
                <span>{t.pos.payNow} (฿{formatMoney(financials.grandTotal)})</span>
              </button>
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Always-Visible Bottom Bar: Permanent "บิล / โซน" card + Sculpted 3D Category Cards */}
      <div className="min-h-[54px] pb-[env(safe-area-inset-bottom)] bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-1.5 flex items-center gap-2 overflow-x-auto shadow-[0_-6px_20px_-10px_rgba(15,23,42,0.1)] z-30 shrink-0">
        {/* Permanent "บิล / โซน" Card (starts on Bills main view) */}
        <button
          onClick={() => {
            setSelectedCategoryId(null);
            setTopViewMode('bills');
          }}
          className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 font-black text-[11px] cursor-pointer transition-all shrink-0 active:translate-y-[1px] ${
            selectedCategoryId === null
              ? 'bg-slate-900 text-white shadow-[0_2px_0_#0f172a,0_6px_12px_-5px_rgba(15,23,42,0.35)] ring-2 ring-orange-500'
              : 'bg-white text-slate-800 hover:bg-slate-50 border border-slate-200 shadow-[0_2px_0_#e2e8f0]'
          }`}
        >
          <Receipt className="w-3.5 h-3.5 text-orange-400 shrink-0" />
          <span className="leading-none whitespace-nowrap">{t.pos.billCard}</span>
          {unpaidOrderedBills.length > 0 && (
            <span
              className={`px-1.5 py-0.5 rounded-md text-[10px] leading-none font-black tabular-nums ${
                selectedCategoryId === null
                  ? 'bg-orange-500 text-white'
                  : 'bg-orange-100 text-orange-700'
              }`}
            >
              {unpaidOrderedBills.length}
            </span>
          )}
        </button>

        {/* Separator */}
        <div className="h-8 w-px bg-slate-200 shrink-0" />

        {/* Draggable Food Category Cards (Drag-and-drop to reorder, saved to Cloud) */}
        {categories.map((cat) => {
          const isSelected = selectedCategoryId === cat.id;
          const isDraggingThis = draggingCatId === cat.id;
          const isDropTarget = dragOverCatId === cat.id && draggingCatId !== cat.id;
          const dishCount = dishes.filter((d) => d.categoryId === cat.id).length;

          return (
            <button
              key={cat.id}
              data-cat-id={cat.id}
              type="button"
              draggable
              onDragStart={(e) => {
                setDraggingCatId(cat.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/kinpos-cat-id', cat.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggingCatId && draggingCatId !== cat.id) {
                  setDragOverCatId(cat.id);
                }
              }}
              onDragLeave={() => {
                if (dragOverCatId === cat.id) setDragOverCatId(null);
              }}
              onDrop={async (e) => {
                e.preventDefault();
                const srcId = e.dataTransfer.getData('text/kinpos-cat-id') || draggingCatId;
                setDraggingCatId(null);
                setDragOverCatId(null);
                if (srcId && srcId !== cat.id) {
                  await reorderCategoriesByIds(srcId, cat.id);
                }
              }}
              onDragEnd={() => {
                setDraggingCatId(null);
                setDragOverCatId(null);
              }}
              onTouchStart={(e) => handleCategoryTouchStart(e, cat.id)}
              onTouchMove={handleCategoryTouchMove}
              onTouchEnd={handleCategoryTouchEnd}
              onTouchCancel={handleCategoryTouchEnd}
              onClick={() => {
                if (suppressCatClickRef.current) {
                  suppressCatClickRef.current = false;
                  return;
                }
                setSelectedCategoryId(cat.id);
              }}
              title={lang === 'th' ? 'ลากวางเพื่อสลับตำแหน่งหมวดหมู่อาหาร' : 'Drag and drop to reorder category'}
              className={`h-12 px-3.5 rounded-xl flex items-center gap-2 font-bold text-xs cursor-grab active:cursor-grabbing transition-all shrink-0 active:translate-y-[1px] ${
                isDraggingThis ? 'opacity-50 scale-95' : ''
              } ${
                isDropTarget ? 'ring-2 ring-orange-500 ring-offset-1 scale-[1.03]' : ''
              } ${
                isSelected
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-[0_3px_0_#c2410c,0_8px_16px_-6px_rgba(234,88,12,0.32)]'
                  : 'bg-white text-slate-800 hover:bg-orange-50/70 border border-slate-200 shadow-[0_2px_0_#e2e8f0]'
              }`}
            >
              <GripVertical className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-orange-100' : 'text-slate-300'}`} />
              <Utensils className={`w-4 h-4 shrink-0 ${isSelected ? 'text-amber-200' : 'text-orange-500'}`} />
              <div className="text-left">
                <div className="leading-tight font-extrabold">
                  {lang === 'th' && cat.nameTh ? cat.nameTh : cat.name}
                </div>
                <div className={`text-[10px] font-semibold ${isSelected ? 'text-orange-100' : 'text-slate-500'}`}>
                  {dishCount} dishes
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Dish Options & Variants Customizer Dialog */}
      {selectedDishForOptions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <div className="modal-panel bg-white rounded-3xl shadow-2xl max-w-lg w-full border border-orange-200">
            {/* Header */}
            <div className="modal-header bg-gradient-to-r from-orange-500 via-red-500 to-amber-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">
                {lang === 'th' && selectedDishForOptions.nameTh ? selectedDishForOptions.nameTh : selectedDishForOptions.name}
              </h3>
              <button
                onClick={() => setSelectedDishForOptions(null)}
                className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="modal-body space-y-4">
              {/* Variants Selector (Drag-and-drop to reorder positions) */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="text-xs font-bold text-neutral-800">
                    {t.pos.pickVariant}
                  </label>
                  {selectedDishForOptions.variants.length > 1 && (
                    <span className="text-[10px] font-semibold text-neutral-400">
                      {lang === 'th' ? 'ลากวางเพื่อสลับตำแหน่ง' : 'Drag & drop to reorder'}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {selectedDishForOptions.variants.map((v) => {
                    const isSelected = selectedVariantId === v.id;
                    const isDraggingThis = draggingVariantId === v.id;
                    const isDropTarget = dragOverVariantId === v.id && draggingVariantId !== v.id;
                    const vCost = calculateDishVariantCost(v, ingredientsMap, subRecipesMap, packagingMap);
                    const effectivePrice = calculateEffectiveChannelPrice(v.price, currentChannel);
                    const hasMarkup = (currentChannel?.priceMarkupPercent || 0) > 0;
                    return (
                      <button
                        key={v.id}
                        data-variant-id={v.id}
                        type="button"
                        draggable={selectedDishForOptions.variants.length > 1}
                        onDragStart={(e) => {
                          setDraggingVariantId(v.id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/kinpos-variant-id', v.id);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          if (draggingVariantId && draggingVariantId !== v.id) {
                            setDragOverVariantId(v.id);
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverVariantId === v.id) setDragOverVariantId(null);
                        }}
                        onDrop={async (e) => {
                          e.preventDefault();
                          const srcId = e.dataTransfer.getData('text/kinpos-variant-id') || draggingVariantId;
                          setDraggingVariantId(null);
                          setDragOverVariantId(null);
                          if (srcId && srcId !== v.id) {
                            await reorderVariantsByIds(srcId, v.id);
                          }
                        }}
                        onDragEnd={() => {
                          setDraggingVariantId(null);
                          setDragOverVariantId(null);
                        }}
                        onTouchStart={(e) => handleVariantTouchStart(e, v.id)}
                        onTouchMove={handleVariantTouchMove}
                        onTouchEnd={handleVariantTouchEnd}
                        onTouchCancel={handleVariantTouchEnd}
                        onClick={() => {
                          if (suppressVariantClickRef.current) {
                            suppressVariantClickRef.current = false;
                            return;
                          }
                          setSelectedVariantId(v.id);
                        }}
                        title={
                          selectedDishForOptions.variants.length > 1
                            ? lang === 'th'
                              ? 'ลากวางเพื่อสลับตำแหน่งตัวเลือกหลัก'
                              : 'Drag and drop to reorder primary option'
                            : undefined
                        }
                        className={`p-3 rounded-2xl border text-left transition-all select-none ${
                          selectedDishForOptions.variants.length > 1
                            ? 'cursor-grab active:cursor-grabbing'
                            : 'cursor-pointer'
                        } ${isDraggingThis ? 'opacity-50 scale-95' : ''} ${
                          isDropTarget ? 'ring-2 ring-orange-500 ring-offset-1 scale-[1.02]' : ''
                        } ${
                          isSelected
                            ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-400'
                            : 'border-neutral-200 bg-white hover:bg-neutral-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1 min-w-0">
                            {selectedDishForOptions.variants.length > 1 && (
                              <GripVertical className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                            )}
                            <span className="font-extrabold text-xs text-neutral-900 truncate">
                              {(() => {
                                const resolved = resolveCostVariantDisplayNames(
                                  selectedDishForOptions,
                                  v,
                                  costMenus
                                );
                                const displayTh = resolved.nameTh || v.nameTh || v.name;
                                const displayEn = resolved.name || v.name || displayTh;
                                return lang === 'th' ? displayTh : displayEn;
                              })()}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {hasMarkup && (
                              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-200">
                                +{currentChannel.priceMarkupPercent}%
                              </span>
                            )}
                            <span className="text-sm font-black text-orange-600">
                              ฿{formatMoney(effectivePrice)}
                            </span>
                          </div>
                        </div>
                        {vCost.hasRecipe && (() => {
                          const netEffectivePrice = extractNetPriceFromMenuPrice(
                            effectivePrice,
                            settings.pricesIncludeVat,
                            settings.vatPercent,
                            settings.serviceChargeIncludedInPrice,
                            settings.serviceChargePercent
                          );
                          return (
                            <div className="text-[10px] text-neutral-500 mt-0.5">
                              Food: ฿{formatMoney(vCost.foodCost)} ({formatPercent(calculateExVatFoodCostPercent(vCost.foodCost, netEffectivePrice))})
                            </div>
                          );
                        })()}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Option Groups Attached */}
              {selectedDishForOptions.optionGroupIds?.map((groupId) => {
                const group = optionGroupsMap.get(groupId);
                if (!group) return null;
                const chosenMap = selectedOptionChoices[groupId] || {};

                return (
                  <div key={groupId} className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-neutral-800">
                        {lang === 'th' && group.nameTh ? group.nameTh : group.name}
                      </span>
                      <span className="text-[10px] text-neutral-500">
                        (Pick {group.minSelect}-{group.maxSelect})
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {group.choices.map((choice) => {
                        const chosenQty = chosenMap[choice.id] || 0;
                        const isChosen = chosenQty > 0;
                        const allowQty = isOptionChoiceQuantityEnabled(choice);
                        const unitPrice = Math.max(0, Number(choice.price) || 0);
                        const linePrice = isChosen
                          ? calculateOptionChoiceLinePrice(unitPrice, chosenQty)
                          : unitPrice;
                        const choiceLabel =
                          lang === 'th' && choice.nameTh ? choice.nameTh : choice.name;

                        if (allowQty) {
                          return (
                            <div
                              key={choice.id}
                              className={`p-2 rounded-xl border text-left text-xs font-semibold flex items-center justify-between gap-2 transition-all ${
                                isChosen
                                  ? 'bg-orange-500 text-white border-orange-600 shadow-2xs'
                                  : 'bg-white text-neutral-800 border-neutral-300 hover:bg-neutral-100'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedOptionChoices((prev) => ({
                                    ...prev,
                                    [groupId]: toggleOptionChoiceMap(
                                      prev[groupId] || {},
                                      choice,
                                      group.maxSelect
                                    ),
                                  }))
                                }
                                className="flex-1 min-w-0 text-left cursor-pointer"
                              >
                                <div className="truncate">{choiceLabel}</div>
                                {linePrice > 0 && (
                                  <div
                                    className={`text-[10px] font-bold tabular-nums ${
                                      isChosen ? 'text-orange-100' : 'text-neutral-500'
                                    }`}
                                  >
                                    +{formatMoney(linePrice)}
                                  </div>
                                )}
                              </button>

                              {isChosen ? (
                                <div className="flex items-center gap-0.5 bg-white text-neutral-900 rounded-lg p-0.5 shrink-0">
                                  <button
                                    type="button"
                                    aria-label="Decrease option quantity"
                                    onClick={() =>
                                      setSelectedOptionChoices((prev) => ({
                                        ...prev,
                                        [groupId]: updateOptionChoiceQuantityMap(
                                          prev[groupId] || {},
                                          choice,
                                          chosenQty - 1,
                                          group.maxSelect
                                        ),
                                      }))
                                    }
                                    className="w-6 h-6 rounded-md hover:bg-neutral-100 font-black flex items-center justify-center cursor-pointer"
                                  >
                                    -
                                  </button>
                                  <NumericInput
                                    min={1}
                                    max={99}
                                    step={1}
                                    inputMode="numeric"
                                    fallbackValue={1}
                                    value={chosenQty}
                                    onValueChange={(val) => {
                                      const next = Math.round(val);
                                      if (next >= 1) {
                                        setSelectedOptionChoices((prev) => ({
                                          ...prev,
                                          [groupId]: updateOptionChoiceQuantityMap(
                                            prev[groupId] || {},
                                            choice,
                                            next,
                                            group.maxSelect
                                          ),
                                        }));
                                      }
                                    }}
                                    className="w-8 text-center text-xs font-extrabold bg-transparent focus:outline-none tabular-nums"
                                  />
                                  <button
                                    type="button"
                                    aria-label="Increase option quantity"
                                    onClick={() =>
                                      setSelectedOptionChoices((prev) => ({
                                        ...prev,
                                        [groupId]: updateOptionChoiceQuantityMap(
                                          prev[groupId] || {},
                                          choice,
                                          chosenQty + 1,
                                          group.maxSelect
                                        ),
                                      }))
                                    }
                                    className="w-6 h-6 rounded-md hover:bg-neutral-100 font-black text-orange-600 flex items-center justify-center cursor-pointer"
                                  >
                                    +
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelectedOptionChoices((prev) => ({
                                      ...prev,
                                      [groupId]: toggleOptionChoiceMap(
                                        prev[groupId] || {},
                                        choice,
                                        group.maxSelect
                                      ),
                                    }))
                                  }
                                  className="px-2 py-1 rounded-lg bg-orange-50 text-orange-700 border border-orange-200 text-[10px] font-bold shrink-0 cursor-pointer"
                                >
                                  + {lang === 'th' ? 'จำนวน' : 'Qty'}
                                </button>
                              )}
                            </div>
                          );
                        }

                        return (
                          <button
                            key={choice.id}
                            type="button"
                            onClick={() =>
                              setSelectedOptionChoices((prev) => ({
                                ...prev,
                                [groupId]: toggleOptionChoiceMap(
                                  prev[groupId] || {},
                                  choice,
                                  group.maxSelect
                                ),
                              }))
                            }
                            className={`p-2 rounded-xl border text-left text-xs font-semibold flex justify-between items-center cursor-pointer transition-all ${
                              isChosen
                                ? 'bg-orange-500 text-white border-orange-600 shadow-2xs'
                                : 'bg-white text-neutral-800 border-neutral-300 hover:bg-neutral-100'
                            }`}
                          >
                            <span>{choiceLabel}</span>
                            {unitPrice > 0 && (
                              <span className="font-bold">+{formatMoney(unitPrice)}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.pos.specialInstructions}
                </label>
                <input
                  type="text"
                  placeholder="e.g. Less spicy, no onion..."
                  value={itemNotes}
                  onChange={(e) => setItemNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-neutral-50 border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500"
                />
              </div>

            </div>

            {/* Pinned Footer: Quantity + Cancel + Add to Bill on one compact row */}
            <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 bg-white border border-neutral-300 rounded-xl px-1.5 py-1 shadow-2xs shrink-0">
                <button
                  type="button"
                  onClick={() => setItemQuantity(Math.max(1, itemQuantity - 1))}
                  aria-label="Decrease quantity"
                  className="w-8 h-8 rounded-lg bg-neutral-100 hover:bg-neutral-200 active:bg-neutral-300 text-neutral-800 font-black flex items-center justify-center cursor-pointer"
                >
                  -
                </button>
                <span className="font-black text-sm w-6 text-center tabular-nums">{itemQuantity}</span>
                <button
                  type="button"
                  onClick={() => setItemQuantity(itemQuantity + 1)}
                  aria-label="Increase quantity"
                  className="w-8 h-8 rounded-lg bg-neutral-100 hover:bg-neutral-200 active:bg-neutral-300 text-neutral-800 font-black flex items-center justify-center cursor-pointer"
                >
                  +
                </button>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedDishForOptions(null)}
                  className="px-3 sm:px-4 py-2.5 bg-white hover:bg-neutral-50 text-neutral-700 rounded-xl text-xs font-bold border border-neutral-300 cursor-pointer"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="button"
                  onClick={handleAddToCart}
                  className="px-4 sm:px-6 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md shadow-orange-500/20 cursor-pointer hover:brightness-105"
                >
                  {t.pos.addToBill}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* Save Order Modal */}
      {isSaveOrderModalOpen && (
        <SaveOrderModal
          tables={tables}
          zones={zones}
          selectedTableId={targetTableIdForSave}
          onSelectTable={(id) => setTargetTableIdForSave(id)}
          onConfirm={handleSaveOrderToTable}
          onClose={() => setIsSaveOrderModalOpen(false)}
          lang={lang}
        />
      )}

      {/* Payment Settlement Modal */}
      {isPaymentModalOpen && activeBill && (() => {
        const latestServerBill = openBills.find((b) => b.id === activeBill.id);
        const customerPayload =
          attachedCustomer &&
          (attachedCustomer.customerName ||
            attachedCustomer.customerPhone ||
            attachedCustomer.deliveryAddress)
            ? {
                customerId: attachedCustomer.customerId || null,
                customerName: attachedCustomer.customerName,
                customerPhone: attachedCustomer.customerPhone,
                deliveryAddress: attachedCustomer.deliveryAddress,
              }
            : {};
        return (
          <PaymentModal
            bill={{
              ...activeBill,
              channelId: currentChannel?.id || selectedChannelId,
              channelName: currentChannel?.name || activeBill.channelName,
              orderType: currentChannel?.type || activeBill.orderType,
              ...customerPayload,
              version: latestServerBill?.version ?? activeBill.version,
              items: cartItems,
              subtotal: financials.subtotal,
              discountAmount: financials.discountAmount,
              serviceChargeAmount: financials.serviceChargeAmount,
              vatAmount: financials.vatAmount,
              grandTotal: financials.grandTotal,
              netSales: financials.netSales,
              totalFoodCost: financials.totalFoodCost,
              packagingCost: financials.packagingCost,
              platformFee: financials.platformFee,
            }}
            settings={settings}
            lang={lang}
            onClose={() => setIsPaymentModalOpen(false)}
            onPaymentSuccess={(paidBill) => {
              setIsPaymentModalOpen(false);
              setIsReceiptModalOpen(false);
              setReceiptBillToView(null);
              setOpenBills((prev) => prev.filter((b) => b.id !== paidBill.id));
              setActiveBill(null);
              setCartItems([]);
              setOrderDiscount(0);
              setTargetTableIdForSave(null);
              applyCustomerFromBill(null);
              setSelectedChannelId('dine_in');
              setSelectedCategoryId(null);
              setTopViewMode('bills');
            }}
          />
        );
      })()}

      {/* Receipt Modal */}
      {isReceiptModalOpen && receiptBillToView && (
        <ReceiptModal
          bill={receiptBillToView}
          settings={settings}
          lang={lang}
          isCheckReceipt={isCheckReceipt}
          onClose={() => {
            setIsReceiptModalOpen(false);
            setReceiptBillToView(null);
          }}
        />
      )}

      {/* Inline Full Menu Management Modal directly inside POS Categories (Create / Edit / Delete) */}
      {editingDishInPos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <form
            ref={posDishFormRef}
            onSubmit={handleSavePosDish}
            className="modal-panel-fixed bg-white rounded-3xl shadow-2xl max-w-3xl w-full border border-orange-200"
          >
            <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isCreatingDishInPos ? <Plus className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                <h3 className="font-extrabold text-base">
                  {isCreatingDishInPos ? t.menuCost.addDish : t.menuCost.editDish}
                </h3>
              </div>
              <button
                type="button"
                onClick={closePosDishModalCleanly}
                className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-4">
              {/* Names TH / EN */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {lang === 'th' ? 'ชื่อเมนู (ภาษาไทย) *' : 'Menu Name (Thai) *'}
                  </label>
                  <input
                    type="text"
                    required={!editingDishInPos.name}
                    value={editingDishInPos.nameTh || ''}
                    onChange={(e) => {
                      const nextTh = e.target.value;
                      setEditingDishInPos({ ...editingDishInPos, nameTh: nextTh });
                      posTranslationScheduler.schedule('dish', () => {
                        setEditingDishInPos((prev) => {
                          if (!prev) return prev;
                          const nextEn = computeAutoEnglishName({
                            previousThai: posPrevDishThaiRef.current,
                            nextThai: nextTh,
                            currentEnglish: prev.name || '',
                            isManuallyEdited: posManualEnKeysRef.current.has('dish'),
                          });
                          posPrevDishThaiRef.current = nextTh;
                          return { ...prev, name: nextEn };
                        });
                      });
                    }}
                    onBlur={() => posTranslationScheduler.flush('dish')}
                    placeholder={
                      lang === 'th'
                        ? 'เช่น กะเพรา, ผัดกะเพรา, ข้าวผัด'
                        : 'e.g. กะเพรา, ผัดกะเพรา, ข้าวผัด'
                    }
                    className="w-full px-3 py-1.5 text-xs bg-white border border-orange-300 rounded-xl focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <label className="block text-xs font-bold text-neutral-700">
                        {t.menuCost.dishName} (EN)
                      </label>
                      {!posTranslationScheduler.hasPending('dish') &&
                        needsEnglishReview(editingDishInPos.nameTh, editingDishInPos.name) && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>{lang === 'th' ? 'รอตรวจสอบ EN' : 'Needs EN'}</span>
                          </span>
                        )}
                    </div>
                    {editingDishInPos.nameTh && (
                      <button
                        type="button"
                        onClick={() => {
                          posTranslationScheduler.cancel('dish');
                          posManualEnKeysRef.current.delete('dish');
                          posPrevDishThaiRef.current = editingDishInPos.nameTh || '';
                          setEditingDishInPos({
                            ...editingDishInPos,
                            name: translateThaiToEnglish(editingDishInPos.nameTh || ''),
                            nameEnManual: false,
                          });
                        }}
                        className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer shrink-0"
                      >
                        {lang === 'th' ? 'แปลใหม่' : 'Re-translate'}
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={editingDishInPos.name || ''}
                    onChange={(e) => {
                      posTranslationScheduler.cancel('dish');
                      const val = e.target.value;
                      if (val.trim()) posManualEnKeysRef.current.add('dish');
                      else posManualEnKeysRef.current.delete('dish');
                      setEditingDishInPos({
                        ...editingDishInPos,
                        name: val,
                        nameEnManual: Boolean(val.trim()),
                      });
                    }}
                    placeholder="e.g. Stir-Fried Holy Basil"
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>

              {/* Category + Photo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.dishCategory}
                  </label>
                  <select
                    value={editingDishInPos.categoryId || categories[0]?.id || ''}
                    onChange={(e) =>
                      setEditingDishInPos({ ...editingDishInPos, categoryId: e.target.value })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {lang === 'th' && c.nameTh ? c.nameTh : c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.dishImage}
                  </label>
                  <div className="p-2 bg-neutral-50 border border-neutral-200 rounded-2xl flex items-center gap-3">
                    <div className="w-16 h-16 rounded-xl bg-white border border-neutral-200 overflow-hidden shrink-0 flex items-center justify-center">
                      {posEditPreviewUrl || dishImages.get(editingDishInPos.id) ? (
                        <img
                          src={posEditPreviewUrl || dishImages.get(editingDishInPos.id) || ''}
                          alt={editingDishInPos.nameTh || editingDishInPos.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Utensils className="w-5 h-5 text-neutral-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <label className="px-2.5 py-1 bg-white hover:bg-orange-50 text-neutral-800 rounded-xl text-xs font-bold border border-neutral-300 cursor-pointer flex items-center gap-1">
                          <Upload className="w-3.5 h-3.5 text-orange-600" />
                          <span>
                            {isUploadingPosImage
                              ? lang === 'th'
                                ? 'กำลังย่อรูป...'
                                : 'Uploading...'
                              : editingDishInPos.imageId || posEditPreviewUrl
                              ? lang === 'th'
                                ? 'เปลี่ยนรูป'
                                : 'Change'
                              : t.menuCost.uploadPhoto}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handlePosDishPhotoUpload}
                            className="hidden"
                          />
                        </label>
                        {(editingDishInPos.imageId || posEditPreviewUrl) && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDishInPos({ ...editingDishInPos, imageId: undefined });
                              setPosEditPreviewUrl(null);
                              setPosEditImageSizeKb(null);
                            }}
                            className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>{t.menuCost.removePhoto}</span>
                          </button>
                        )}
                      </div>
                      {posImageError ? (
                        <div className="text-[11px] font-bold text-rose-600">{posImageError}</div>
                      ) : (editingDishInPos.imageId || posEditPreviewUrl) && posEditImageSizeKb ? (
                        <div className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{posEditImageSizeKb} KB</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bilingual Dish Description for Customer Ordering Page */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {lang === 'th' ? 'คำอธิบายอาหาร (ภาษาไทย)' : 'Dish Description (Thai)'}
                  </label>
                  <textarea
                    rows={2}
                    value={editingDishInPos.descriptionTh || ''}
                    onChange={(e) => {
                      const nextTh = e.target.value;
                      setEditingDishInPos({ ...editingDishInPos, descriptionTh: nextTh });
                      posTranslationScheduler.schedule('dishDesc', () => {
                        setEditingDishInPos((prev) => {
                          if (!prev) return prev;
                          const nextEn = computeAutoEnglishDescription({
                            previousThai: posPrevDishDescThaiRef.current,
                            nextThai: nextTh,
                            currentEnglish: prev.description || '',
                            isManuallyEdited: posManualEnKeysRef.current.has('dishDesc'),
                          });
                          posPrevDishDescThaiRef.current = nextTh;
                          return { ...prev, description: nextEn };
                        });
                      });
                    }}
                    onBlur={() => posTranslationScheduler.flush('dishDesc')}
                    placeholder={
                      lang === 'th'
                        ? 'เช่น ผัดกะเพราสูตรโบราณ รสจัดจ้าน ใช้ใบกะเพราสด (แสดงหน้าสั่งอาหาร)'
                        : 'e.g. คำอธิบายเมนูภาษาไทย (shown to customers)'
                    }
                    className="w-full px-3 py-1.5 text-xs bg-white border border-orange-300 rounded-xl focus:ring-2 focus:ring-orange-500 resize-none"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <label className="block text-xs font-bold text-neutral-700">
                        {lang === 'th' ? 'คำอธิบายอาหาร (EN)' : 'Dish Description (EN)'}
                      </label>
                      {!posTranslationScheduler.hasPending('dishDesc') &&
                        Boolean((editingDishInPos.descriptionTh || '').trim()) &&
                        (!(editingDishInPos.description || '').trim() ||
                          containsThaiCharacters(editingDishInPos.description)) && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>{lang === 'th' ? 'กรุณาใส่คำอธิบาย EN' : 'Add EN text'}</span>
                          </span>
                        )}
                    </div>
                    {editingDishInPos.descriptionTh &&
                      translateThaiDescriptionToEnglish(editingDishInPos.descriptionTh) && (
                        <button
                          type="button"
                          onClick={() => {
                            posTranslationScheduler.cancel('dishDesc');
                            posManualEnKeysRef.current.delete('dishDesc');
                            posPrevDishDescThaiRef.current = editingDishInPos.descriptionTh || '';
                            setEditingDishInPos({
                              ...editingDishInPos,
                              description: translateThaiDescriptionToEnglish(
                                editingDishInPos.descriptionTh || ''
                              ),
                              descriptionEnManual: false,
                            });
                          }}
                          className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer shrink-0"
                        >
                          {lang === 'th' ? 'แปลใหม่' : 'Re-translate'}
                        </button>
                      )}
                  </div>
                  <textarea
                    rows={2}
                    value={editingDishInPos.description || ''}
                    onChange={(e) => {
                      posTranslationScheduler.cancel('dishDesc');
                      const val = e.target.value;
                      if (val.trim()) posManualEnKeysRef.current.add('dishDesc');
                      else posManualEnKeysRef.current.delete('dishDesc');
                      setEditingDishInPos({
                        ...editingDishInPos,
                        description: val,
                        descriptionEnManual: Boolean(val.trim()),
                      });
                    }}
                    placeholder="e.g. Authentic Thai holy basil stir-fry with fresh garlic and chilies"
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500 resize-none"
                  />
                </div>
              </div>

              {/* Primary Options ("ตัวเลือกหลักของเมนู") — Linked Real-Time From Food Cost OR Manual */}
              <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-3">
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-black text-neutral-800">{t.menuCost.variants}</span>
                    {matchedEditingPosCostMenu && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                        <span>
                          {lang === 'th'
                            ? `ดึงข้อมูลจริงจากต้นทุนอาหาร: ${getLocalizedText(lang, matchedEditingPosCostMenu.name, matchedEditingPosCostMenu.englishName)} (${getActiveCostVariants(matchedEditingPosCostMenu).length} รายการ)`
                            : `Synced with Food Cost: ${getLocalizedText(lang, matchedEditingPosCostMenu.name, matchedEditingPosCostMenu.englishName)} (${getActiveCostVariants(matchedEditingPosCostMenu).length} items)`}
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {costMenus.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPosCostMenuId(null);
                          setPosPickerSourceTab('menus');
                          setPosPrimaryOptionSearch('');
                          setIsPosPrimaryOptionPickerOpen(true);
                        }}
                        className="px-2.5 py-1 bg-orange-50 hover:bg-orange-100 border border-orange-300 text-orange-700 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        <span>
                          {matchedEditingPosCostMenu
                            ? lang === 'th'
                              ? 'เปลี่ยนเมนูต้นทุน'
                              : 'Change Cost Menu'
                            : lang === 'th'
                            ? '+ เชื่อมข้อมูลจากต้นทุนอาหาร'
                            : '+ Link Food Cost Menu'}
                        </span>
                      </button>
                    )}
                    {!matchedEditingPosCostMenu && (
                      <button
                        type="button"
                        onClick={() => {
                          const nextVar: DishVariant = {
                            id: `var_${Date.now()}`,
                            nameTh: '',
                            name: '',
                            price: editingDishInPos.variants?.[0]?.price || 100,
                            ingredients: [],
                            subRecipes: [],
                            packaging: [],
                          };
                          setEditingDishInPos({
                            ...editingDishInPos,
                            variants: [...(editingDishInPos.variants || []), nextVar],
                          });
                        }}
                        className="px-2.5 py-1 bg-white hover:bg-orange-50 border border-neutral-300 text-neutral-700 rounded-xl text-[11px] font-bold cursor-pointer flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3 text-orange-600" />
                        <span>{lang === 'th' ? 'เพิ่มตัวเลือก' : 'Add Option'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {matchedEditingPosCostMenu ? (
                  (() => {
                    const costVars = getActiveCostVariants(matchedEditingPosCostMenu);
                    return (
                      <div className="space-y-2">
                        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
                          <table className="w-full min-w-[560px] text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-neutral-100 border-b border-neutral-200 text-[10.5px] font-extrabold text-neutral-700">
                                <th className="py-2 px-2.5">{lang === 'th' ? 'ชื่อรายการ' : 'Item'}</th>
                                <th className="py-2 px-2 text-right w-28">
                                  {lang === 'th' ? 'ราคาตั้งขาย (฿)' : 'Selling Price (฿)'}
                                </th>
                                <th className="py-2 px-2 text-right">{lang === 'th' ? 'ต้นทุนรวม' : 'Total Cost'}</th>
                                <th className="py-2 px-2 text-right">{lang === 'th' ? '%ต้นทุน' : '% Cost'}</th>
                                <th className="py-2 px-2 text-right">{lang === 'th' ? 'กำไรกินที่ร้าน' : 'Dine-in Profit'}</th>
                                <th className="py-2 px-2.5 text-right">{lang === 'th' ? 'กำไรใส่กล่อง' : 'Takeaway Profit'}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100">
                              {costVars.map((cv) => {
                                const labelTh = getCostVariantLabel(cv);
                                const displayLabel = getLocalizedText(lang, labelTh, cv.englishName);
                                const existingMatched = findExistingPosVariantForCostVariant(
                                  cv,
                                  editingDishInPos.variants || []
                                );
                                const currentSellingPrice = resolveCostVariantSellingPrice(
                                  matchedEditingPosCostMenu,
                                  cv,
                                  existingMatched,
                                  posModalPriceOverrides[cv.id]
                                );
                                const bd = computeCostVariantRealtimeBreakdown(
                                  matchedEditingPosCostMenu,
                                  cv,
                                  currentSellingPrice
                                );
                                const fcPct = bd.fcPercent || 0;

                                return (
                                  <tr key={cv.id} className="hover:bg-orange-50/40 transition-colors">
                                    <td className="py-2 px-2.5">
                                      <div className="font-black text-neutral-900 text-xs leading-tight">
                                        {displayLabel}
                                      </div>
                                      {cv.name && cv.name !== labelTh && lang === 'th' && (
                                        <div className="text-[10px] text-neutral-400 truncate max-w-[160px]">
                                          {cv.name}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-1.5 px-2 text-right">
                                      <NumericInput
                                        min={0}
                                        step={1}
                                        value={currentSellingPrice}
                                        onValueChange={(val) =>
                                          handleUpdatePosCostVariantPrice(
                                            matchedEditingPosCostMenu,
                                            cv,
                                            val
                                          )
                                        }
                                        className="w-24 px-2 py-1 text-right text-xs font-black bg-orange-50/70 border border-orange-300 rounded-lg text-orange-700 focus:ring-2 focus:ring-orange-500 focus:bg-white"
                                      />
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono font-bold text-neutral-800">
                                      ฿{formatMoney(bd.totalCost)}
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono font-black">
                                      <span
                                        className={`px-1.5 py-0.5 rounded-md text-[11px] ${
                                          fcPct > 45
                                            ? 'bg-rose-50 text-rose-700'
                                            : fcPct > 35
                                            ? 'bg-amber-50 text-amber-700'
                                            : 'bg-emerald-50 text-emerald-700'
                                        }`}
                                      >
                                        {fcPct}%
                                      </span>
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono font-black">
                                      <span
                                        className={
                                          bd.dineInProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                                        }
                                      >
                                        {bd.dineInProfit > 0 ? '+' : ''}฿{formatMoney(bd.dineInProfit)}
                                      </span>
                                    </td>
                                    <td className="py-2 px-2.5 text-right font-mono font-black">
                                      <span
                                        className={
                                          bd.takeawayProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                                        }
                                      >
                                        {bd.takeawayProfit > 0 ? '+' : ''}฿{formatMoney(bd.takeawayProfit)}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <p className="text-[10.5px] text-neutral-500">
                          {lang === 'th'
                            ? 'ยึดตามตัวเลือกที่สร้างไว้ใน "ต้นทุนอาหาร" • แก้ไขราคาตั้งขายเพื่อคำนวณ %ต้นทุน และกำไรแบบเรียลไทม์ทันที'
                            : 'Synced with variants configured in Food Cost • Edit selling price to recalculate % cost and profit in real time.'}
                        </p>
                      </div>
                    );
                  })()
                ) : (
                  <div className="space-y-2">
                    {editingDishInPos.variants.map((v, vIdx) => {
                      const varMetrics = getPosLinkedFoodCostMetrics(editingDishInPos, v);
                      return (
                        <div key={v.id} className="space-y-1.5 bg-white p-2 rounded-xl border border-neutral-200">
                          <div className="grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-5">
                              <input
                                type="text"
                                required={!v.name}
                                value={v.nameTh || ''}
                                onChange={(e) => {
                                  const nextTh = e.target.value;
                                  const varId = v.id;
                                  const varKey = `var_${varId}`;
                                  const updated = [...editingDishInPos.variants];
                                  updated[vIdx] = { ...updated[vIdx], nameTh: nextTh };
                                  setEditingDishInPos({ ...editingDishInPos, variants: updated });
                                  posTranslationScheduler.schedule(varKey, () => {
                                    setEditingDishInPos((prev) => {
                                      if (!prev) return prev;
                                      const prevTh = posPrevVarThaiMapRef.current.get(varId) || '';
                                      const nextVars = prev.variants.map((item) => {
                                        if (item.id !== varId) return item;
                                        const nextEn = computeAutoEnglishName({
                                          previousThai: prevTh,
                                          nextThai: nextTh,
                                          currentEnglish: item.name || '',
                                          isManuallyEdited: posManualEnKeysRef.current.has(varKey),
                                        });
                                        return { ...item, name: nextEn };
                                      });
                                      posPrevVarThaiMapRef.current.set(varId, nextTh);
                                      return { ...prev, variants: nextVars };
                                    });
                                  });
                                }}
                                onBlur={() => posTranslationScheduler.flush(`var_${v.id}`)}
                                placeholder={lang === 'th' ? 'ชื่อตัวเลือก (TH)' : 'Option Name (TH)'}
                                className="w-full px-2 py-1 text-xs border border-neutral-300 rounded-lg"
                              />
                            </div>
                            <div className="col-span-3">
                              <input
                                type="text"
                                value={v.name || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const key = `var_${v.id}`;
                                  posTranslationScheduler.cancel(key);
                                  if (val.trim()) posManualEnKeysRef.current.add(key);
                                  else posManualEnKeysRef.current.delete(key);
                                  const updated = [...editingDishInPos.variants];
                                  updated[vIdx] = {
                                    ...updated[vIdx],
                                    name: val,
                                    nameEnManual: Boolean(val.trim()),
                                  };
                                  setEditingDishInPos({ ...editingDishInPos, variants: updated });
                                }}
                                placeholder="EN"
                                className="w-full px-2 py-1 text-xs bg-neutral-50 border border-neutral-300 rounded-lg"
                              />
                              {!posTranslationScheduler.hasPending(`var_${v.id}`) &&
                                needsEnglishReview(v.nameTh, v.name) && (
                                  <span className="inline-flex items-center gap-0.5 text-[9.5px] font-bold text-amber-700 mt-0.5">
                                    <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                                    <span>{lang === 'th' ? 'รอตรวจสอบ EN' : 'Needs EN'}</span>
                                  </span>
                                )}
                            </div>
                            <div className="col-span-3">
                              <NumericInput
                                min={0}
                                step={1}
                                value={v.price}
                                onValueChange={(val) => {
                                  const updated = [...editingDishInPos.variants];
                                  updated[vIdx] = { ...updated[vIdx], price: val };
                                  setEditingDishInPos({ ...editingDishInPos, variants: updated });
                                }}
                                className="w-full px-2 py-1 text-xs text-right font-black border border-orange-300 rounded-lg text-orange-700"
                              />
                            </div>
                            <div className="col-span-1 flex justify-end">
                              {editingDishInPos.variants.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = editingDishInPos.variants.filter((_, i) => i !== vIdx);
                                    setEditingDishInPos({ ...editingDishInPos, variants: updated });
                                  }}
                                  className="p-1 text-neutral-400 hover:text-rose-600 cursor-pointer"
                                  title={t.common.delete}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          {(varMetrics.hasData || Boolean(v.costVariantId || v.costMenuId || editingDishInPos.costMenuId)) && (() => {
                            const isAddMode =
                              isCreatingDishInPos ||
                              !dishes.some((d) => d.id === editingDishInPos.id);
                            const canOpenCentralRecipe =
                              varMetrics.source === 'food_cost' &&
                              Boolean(varMetrics.matchedVariantId || varMetrics.matchedMenuId);
                            const buttonLabel = isAddMode
                              ? lang === 'en'
                                ? CENTRAL_RECIPE_BUTTON_LABELS.saveAndOpenEn
                                : CENTRAL_RECIPE_BUTTON_LABELS.saveAndOpenTh
                              : lang === 'en'
                              ? CENTRAL_RECIPE_BUTTON_LABELS.openEn
                              : CENTRAL_RECIPE_BUTTON_LABELS.openTh;
                            return (
                              <div className="px-2.5 py-1.5 rounded-lg bg-emerald-50/80 border border-emerald-200 text-[10.5px] space-y-1.5 text-emerald-900">
                                {varMetrics.hasData && (
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-bold flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                                      <span>
                                        {lang === 'th' ? 'ต้นทุน' : 'Cost'}: ฿{formatMoney(varMetrics.cost)} ({varMetrics.foodCostPercent.toFixed(1)}%)
                                      </span>
                                    </span>
                                    <span className="font-black">
                                      {lang === 'th' ? 'ที่ร้าน' : 'Dine-in'}: {varMetrics.dineInProfit > 0 ? '+' : ''}฿{formatMoney(varMetrics.dineInProfit)} • {lang === 'th' ? 'กล่อง' : 'Box'}: {varMetrics.takeawayProfit > 0 ? '+' : ''}฿{formatMoney(varMetrics.takeawayProfit)}
                                    </span>
                                  </div>
                                )}
                                <div
                                  className={`${
                                    varMetrics.hasData
                                      ? 'pt-1.5 border-t border-emerald-200/70'
                                      : ''
                                  } flex flex-wrap items-center justify-between gap-2`}
                                >
                                  {!canOpenCentralRecipe && (
                                    <span className="text-[10px] font-semibold text-amber-800">
                                      {lang === 'en'
                                        ? CENTRAL_RECIPE_BUTTON_LABELS.unresolvedHintEn
                                        : CENTRAL_RECIPE_BUTTON_LABELS.unresolvedHintTh}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    disabled={
                                      !canOpenCentralRecipe ||
                                      !onOpenCentralRecipe ||
                                      isPosNavigatingToRecipe
                                    }
                                    onClick={async () => {
                                      if (
                                        isPosNavigatingToRecipe ||
                                        !canOpenCentralRecipe ||
                                        !onOpenCentralRecipe
                                      ) {
                                        return;
                                      }
                                      const target = {
                                        variantId: varMetrics.matchedVariantId || undefined,
                                        menuId: varMetrics.matchedMenuId || undefined,
                                      };
                                      if (isAddMode) {
                                        setIsPosNavigatingToRecipe(true);
                                        const res = await savePosDishFromModal();
                                        if (res.ok) {
                                          onOpenCentralRecipe(target);
                                        }
                                        setIsPosNavigatingToRecipe(false);
                                        return;
                                      }
                                      if (isPosDishModalDirty) {
                                        setPosPendingRecipeNavTarget(target);
                                        return;
                                      }
                                      setIsPosNavigatingToRecipe(true);
                                      closePosDishModalCleanly();
                                      onOpenCentralRecipe(target);
                                    }}
                                    title={buttonLabel}
                                    aria-label={buttonLabel}
                                    className="min-h-[36px] px-2.5 py-1 rounded-xl border border-emerald-400/90 bg-white/90 hover:bg-emerald-100/80 text-emerald-900 font-bold text-[11px] inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors ml-auto w-full sm:w-auto"
                                  >
                                    <BookOpen className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                    <span>{buttonLabel}</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Sub-Option Groups Attached + Picker */}
              <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-neutral-800">
                    {t.menuCost.attachedOptionGroups}
                  </span>
                  {optionGroups.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setPosOptionGroupSearch('');
                        setIsPosOptionGroupPickerOpen(true);
                      }}
                      className="px-2.5 py-1 bg-white hover:bg-orange-50 border border-orange-300 text-orange-700 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{lang === 'th' ? 'เพิ่มตัวเลือกย่อย' : 'Add Sub-Options'}</span>
                    </button>
                  )}
                </div>

                {optionGroups.length === 0 ? (
                  <div className="p-2.5 bg-white rounded-xl border border-dashed border-neutral-300 text-[11px] text-neutral-500 text-center">
                    {lang === 'th'
                      ? 'ยังไม่มีกลุ่มตัวเลือกย่อย'
                      : 'No sub-option groups yet'}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {optionGroups.map((grp) => {
                      const active = (editingDishInPos.optionGroupIds || []).includes(grp.id);
                      return (
                        <button
                          key={grp.id}
                          type="button"
                          onClick={() => {
                            const prevIds = editingDishInPos.optionGroupIds || [];
                            const nextIds = active
                              ? prevIds.filter((id) => id !== grp.id)
                              : [...prevIds, grp.id];
                            setEditingDishInPos({ ...editingDishInPos, optionGroupIds: nextIds });
                          }}
                          className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border cursor-pointer transition-all ${
                            active
                              ? 'bg-orange-500 text-white border-orange-600'
                              : 'bg-white text-neutral-700 border-neutral-300 hover:bg-orange-50'
                          }`}
                        >
                          {lang === 'th' && grp.nameTh ? grp.nameTh : grp.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {posDishModalError && (
              <div className="shrink-0 px-4 sm:px-6 py-2 bg-rose-50 border-t border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{posDishModalError}</span>
              </div>
            )}

            {posPendingRecipeNavTarget && (
              <div className="shrink-0 px-4 sm:px-6 py-3 bg-amber-50 border-t border-amber-200 text-xs space-y-2">
                <div className="font-bold text-amber-950 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    {lang === 'en'
                      ? 'You have unsaved changes in this menu. What would you like to do?'
                      : 'คุณมีการแก้ไขเมนูนี้ที่ยังไม่ได้บันทึก ต้องการดำเนินการอย่างไร?'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isPosNavigatingToRecipe}
                    onClick={async () => {
                      if (isPosNavigatingToRecipe || !onOpenCentralRecipe) return;
                      const target = posPendingRecipeNavTarget;
                      setIsPosNavigatingToRecipe(true);
                      const res = await savePosDishFromModal();
                      if (res.ok) {
                        onOpenCentralRecipe(target);
                      } else {
                        setPosPendingRecipeNavTarget(null);
                      }
                      setIsPosNavigatingToRecipe(false);
                    }}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold cursor-pointer disabled:opacity-50"
                  >
                    {lang === 'en'
                      ? CENTRAL_RECIPE_BUTTON_LABELS.saveAndOpenEn
                      : CENTRAL_RECIPE_BUTTON_LABELS.saveAndOpenTh}
                  </button>
                  <button
                    type="button"
                    disabled={isPosNavigatingToRecipe}
                    onClick={() => {
                      if (isPosNavigatingToRecipe || !onOpenCentralRecipe) return;
                      const target = posPendingRecipeNavTarget;
                      setIsPosNavigatingToRecipe(true);
                      closePosDishModalCleanly();
                      onOpenCentralRecipe(target);
                    }}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-300 font-bold cursor-pointer disabled:opacity-50"
                  >
                    {lang === 'en'
                      ? CENTRAL_RECIPE_BUTTON_LABELS.goWithoutSavingEn
                      : CENTRAL_RECIPE_BUTTON_LABELS.goWithoutSavingTh}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPosPendingRecipeNavTarget(null)}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-neutral-200 hover:bg-neutral-300 text-neutral-800 font-bold cursor-pointer"
                  >
                    {lang === 'en'
                      ? CENTRAL_RECIPE_BUTTON_LABELS.stayEn
                      : CENTRAL_RECIPE_BUTTON_LABELS.stayTh}
                  </button>
                </div>
              </div>
            )}

            <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                {!isCreatingDishInPos && (
                  <button
                    type="button"
                    onClick={() => setPendingDeleteDish(editingDishInPos)}
                    className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold border border-rose-200 cursor-pointer flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t.common.delete}</span>
                  </button>
                )}
                {!isCreatingDishInPos && onEditDish && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = editingDishInPos;
                      closePosDishModalCleanly();
                      onEditDish(target, selectedCategoryId);
                    }}
                    className="px-3 py-2 bg-white hover:bg-neutral-50 text-neutral-700 rounded-xl text-xs font-bold border border-neutral-300 cursor-pointer"
                  >
                    {lang === 'th' ? 'จัดการต้นทุนละเอียด' : 'Detailed Costing'}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={closePosDishModalCleanly}
                  className="px-4 py-2 bg-white hover:bg-neutral-50 text-neutral-700 rounded-xl text-xs font-bold border border-neutral-300 cursor-pointer"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isSavingPosDish}
                  className="px-5 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md shadow-orange-500/20 cursor-pointer hover:brightness-105 disabled:opacity-50"
                >
                  {isSavingPosDish ? t.common.loading : t.common.save}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* POS Food Cost Primary Option Picker Modal */}
      {isPosPrimaryOptionPickerOpen && editingDishInPos && (() => {
        const q = posPrimaryOptionSearch.trim().toLowerCase();
        const dishThLower = (editingDishInPos.nameTh || '').trim().toLowerCase();
        const dishEnLower = (editingDishInPos.name || '').trim().toLowerCase();

        const sortedCostMenus = [...costMenus]
          .filter((m) => m.active !== false && (m.variants || []).length > 0)
          .sort((a, b) => {
            const aName = a.name.toLowerCase();
            const bName = b.name.toLowerCase();
            const aMatch =
              (dishThLower && (aName.includes(dishThLower) || dishThLower.includes(aName))) ||
              (dishEnLower && aName.includes(dishEnLower));
            const bMatch =
              (dishThLower && (bName.includes(dishThLower) || dishThLower.includes(bName))) ||
              (dishEnLower && bName.includes(dishEnLower));
            if (aMatch && !bMatch) return -1;
            if (!aMatch && bMatch) return 1;
            return (a.displayOrder || 99) - (b.displayOrder || 99);
          });

        const selectedCostMenu = selectedPosCostMenuId
          ? sortedCostMenus.find((m) => m.id === selectedPosCostMenuId) || null
          : null;

        const filteredMenus = sortedCostMenus.filter((menu) => {
          if (!q) return true;
          return `${menu.name} ${menu.category || ''}`.toLowerCase().includes(q);
        });

        const selectedMenuVariants: Array<{
          variant: CostMenuVariant;
          sellingPrice: number;
          cost: number;
          dineInProfit: number;
          takeawayProfit: number;
        }> = [];

        if (selectedCostMenu) {
          for (const v of selectedCostMenu.variants || []) {
            const hay = `${v.name} ${v.proteinType || ''}`.toLowerCase();
            if (q && !hay.includes(q)) continue;
            const bd = calculateSpreadsheetRowMetrics({
              menu: selectedCostMenu,
              variant: v,
              ingredientsMap: costIngMap,
              servingMode: 'ON_RICE',
            });
            selectedMenuVariants.push({
              variant: v,
              sellingPrice: bd.sellingPrice,
              cost: bd.totalCost || 0,
              dineInProfit: bd.dineInProfit || 0,
              takeawayProfit: bd.takeawayProfit || 0,
            });
          }
        }

        const proteinIngredients = costIngredients.filter((ing) => {
          if (ing.active === false) return false;
          const isMeat = ing.category === 'เนื้อสัตว์และอาหารทะเล';
          return q ? ing.name.toLowerCase().includes(q) : isMeat;
        });

        const appendImportedVariant = (newVariant: DishVariant) => {
          const currentVars = editingDishInPos.variants || [];
          const hasOnlyBlankPlaceholder =
            currentVars.length === 1 &&
            isCreatingDishInPos &&
            (currentVars[0].name === 'Standard' || currentVars[0].nameTh === 'มาตรฐาน') &&
            (currentVars[0].ingredients?.length || 0) === 0;

          const nextVariants = hasOnlyBlankPlaceholder ? [newVariant] : [...currentVars, newVariant];
          setEditingDishInPos({ ...editingDishInPos, variants: nextVariants });
          setIsPosPrimaryOptionPickerOpen(false);
        };

        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 bg-neutral-950/70 backdrop-blur-xs">
            <div className="modal-panel-fixed bg-white rounded-3xl shadow-2xl max-w-2xl w-full border border-orange-200">
              <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ChefHat className="w-5 h-5" />
                  <h3 className="font-extrabold text-base">
                    {selectedCostMenu
                      ? lang === 'th'
                        ? `เลือกตัวเลือกหลักของเมนู "${selectedCostMenu.name}"`
                        : `Select Primary Option for "${getLocalizedText(lang, selectedCostMenu.name, selectedCostMenu.englishName)}"`
                      : lang === 'th'
                      ? 'เลือกตัวเลือกหลักจากต้นทุนอาหาร'
                      : 'Select Primary Option from Food Cost'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPosPrimaryOptionPickerOpen(false)}
                  className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3 border-b border-neutral-200 bg-neutral-50 space-y-2 shrink-0">
                {selectedCostMenu ? (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPosCostMenuId(null);
                        setPosPrimaryOptionSearch('');
                      }}
                      className="px-2.5 py-1 bg-white hover:bg-orange-50 border border-orange-300 text-orange-700 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>{lang === 'th' ? 'เปลี่ยนรายการเมนูอาหาร' : 'Change Menu Item'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingDishInPos({
                          ...editingDishInPos,
                          costMenuId: selectedCostMenu.id,
                        });
                        setIsPosPrimaryOptionPickerOpen(false);
                      }}
                      className="px-3 py-1 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-xs cursor-pointer hover:brightness-105"
                    >
                      {lang === 'th'
                        ? `เชื่อมตัวเลือกทั้งหมด (${selectedMenuVariants.length})`
                        : `Link All Options (${selectedMenuVariants.length})`}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPosPickerSourceTab('menus');
                        setPosPrimaryOptionSearch('');
                      }}
                      className={`px-3 py-1 rounded-xl text-xs font-bold cursor-pointer ${
                        posPickerSourceTab === 'menus'
                          ? 'bg-orange-500 text-white'
                          : 'bg-white border border-neutral-300 text-neutral-700'
                      }`}
                    >
                      {lang === 'th'
                        ? `เลือกจากรายการเมนู (${sortedCostMenus.length})`
                        : `From Food Cost Menus (${sortedCostMenus.length})`}
                    </button>
                    {proteinIngredients.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setPosPickerSourceTab('ingredients');
                          setPosPrimaryOptionSearch('');
                        }}
                        className={`px-3 py-1 rounded-xl text-xs font-bold cursor-pointer ${
                          posPickerSourceTab === 'ingredients'
                            ? 'bg-orange-500 text-white'
                            : 'bg-white border border-neutral-300 text-neutral-700'
                        }`}
                      >
                        {lang === 'th' ? 'เลือกจากวัตถุดิบเนื้อสัตว์เดี่ยว' : 'From Single Protein Ingredients'}
                      </button>
                    )}
                  </div>
                )}

                <div className="relative">
                  <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    autoFocus
                    value={posPrimaryOptionSearch}
                    onChange={(e) => setPosPrimaryOptionSearch(e.target.value)}
                    placeholder={
                      lang === 'th'
                        ? 'ค้นหาเมนูหรือวัตถุดิบ...'
                        : 'Search menus or protein ingredients...'
                    }
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              <div className="modal-body space-y-2.5">
                {posPickerSourceTab === 'menus' && !selectedCostMenu && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {filteredMenus.map((menu) => (
                      <button
                        key={menu.id}
                        type="button"
                        onClick={() => {
                          setSelectedPosCostMenuId(menu.id);
                          setPosPrimaryOptionSearch('');
                        }}
                        className="p-3 rounded-2xl border bg-white border-neutral-200 hover:border-orange-400 text-left cursor-pointer flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-black text-sm text-neutral-900 truncate">
                            {getLocalizedText(lang, menu.name, menu.englishName)}
                          </div>
                          <div className="text-[11px] text-neutral-500">
                            {getLocalizedText(lang, menu.category || 'เมนูอาหาร')} •{' '}
                            {lang === 'th'
                              ? `${(menu.variants || []).length} ตัวเลือกหลัก`
                              : `${(menu.variants || []).length} options`}
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-orange-500 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}

                {posPickerSourceTab === 'menus' && selectedCostMenu && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {selectedMenuVariants.map(({ variant, sellingPrice, cost }) => {
                      const displayOptionLabel = getCostVariantLabel(variant);
                      return (
                        <button
                          key={`${selectedCostMenu.id}_${variant.id}`}
                          type="button"
                          disabled={isImportingPosCostOption}
                          onClick={async () => {
                            setIsImportingPosCostOption(true);
                            try {
                              const converted = await importCostingVariantToDishVariant({
                                variant,
                                costMenuId: selectedCostMenu.id,
                                costIngredients,
                                costSauces,
                                preferredNameTh: displayOptionLabel,
                              });
                              converted.price = sellingPrice;
                              appendImportedVariant(converted);
                            } finally {
                              setIsImportingPosCostOption(false);
                            }
                          }}
                          className="p-3 rounded-2xl border bg-white border-neutral-200 hover:border-orange-400 text-left cursor-pointer flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-black text-sm text-neutral-900 truncate">
                              {getLocalizedText(lang, displayOptionLabel, variant.englishName)}
                            </div>
                            <div className="text-[11px] text-neutral-500">
                              {lang === 'th' ? 'ต้นทุน' : 'Cost'} ฿{formatMoney(cost)}
                            </div>
                          </div>
                          <span className="text-xs font-black text-orange-600 shrink-0">
                            ฿{formatMoney(sellingPrice || 0)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {posPickerSourceTab === 'ingredients' && !selectedCostMenu && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {proteinIngredients.map((ing) => (
                      <button
                        key={ing.id}
                        type="button"
                        disabled={isImportingPosCostOption}
                        onClick={async () => {
                          setIsImportingPosCostOption(true);
                          try {
                            const converted = await importCostingIngredientAsDishVariant(ing, 100);
                            converted.price = editingDishInPos.variants?.[0]?.price || 65;
                            appendImportedVariant(converted);
                          } finally {
                            setIsImportingPosCostOption(false);
                          }
                        }}
                        className="p-2.5 bg-neutral-50 hover:bg-orange-50 rounded-xl border border-neutral-200 hover:border-orange-300 text-left cursor-pointer flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-neutral-900 truncate">
                            {getLocalizedText(lang, ing.name, ing.englishName)}
                          </div>
                          <div className="text-[10px] text-neutral-500">
                            ฿{formatMoney(ing.costPerBaseUnit)} / {ing.baseUnit}
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-orange-600 shrink-0">
                          {lang === 'th' ? '+ เลือกใช้' : '+ Select'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsPosPrimaryOptionPickerOpen(false)}
                  className="px-4 py-1.5 bg-neutral-800 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  {t.common.close}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* POS Sub-Option Group Picker Modal */}
      {isPosOptionGroupPickerOpen && editingDishInPos && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 bg-neutral-950/70 backdrop-blur-xs">
          <div className="modal-panel bg-white rounded-3xl shadow-2xl max-w-lg w-full border border-orange-200">
            <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5" />
                <h3 className="font-extrabold text-base">
                  {lang === 'th' ? 'เลือกตัวเลือกย่อยที่ใช้งาน' : 'Select Active Sub-Option Groups'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsPosOptionGroupPickerOpen(false)}
                className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 border-b border-neutral-200 bg-neutral-50 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  autoFocus
                  value={posOptionGroupSearch}
                  onChange={(e) => setPosOptionGroupSearch(e.target.value)}
                  placeholder={lang === 'th' ? 'ค้นหากลุ่มตัวเลือกย่อย...' : 'Search sub-option groups...'}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-neutral-300 rounded-xl"
                />
              </div>
            </div>

            <div className="modal-body space-y-2">
              {optionGroups
                .filter((grp) => {
                  const q = posOptionGroupSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    grp.name.toLowerCase().includes(q) ||
                    (grp.nameTh && grp.nameTh.toLowerCase().includes(q))
                  );
                })
                .map((grp) => {
                  const isSelected = (editingDishInPos.optionGroupIds || []).includes(grp.id);
                  return (
                    <button
                      key={grp.id}
                      type="button"
                      onClick={() => {
                        const curr = editingDishInPos.optionGroupIds || [];
                        const next = isSelected
                          ? curr.filter((id) => id !== grp.id)
                          : [...curr, grp.id];
                        setEditingDishInPos({ ...editingDishInPos, optionGroupIds: next });
                      }}
                      className={`w-full p-3 rounded-2xl border text-left cursor-pointer transition-colors flex items-start justify-between gap-2 ${
                        isSelected
                          ? 'bg-orange-50 border-orange-500'
                          : 'bg-white border-neutral-200 hover:bg-neutral-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-extrabold text-xs text-neutral-900">
                          {lang === 'th' ? grp.nameTh || grp.name : grp.name || grp.nameTh}
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">
                          {grp.choices
                            .map((c) => (lang === 'th' ? c.nameTh || c.name : c.name || c.nameTh))
                            .join(' • ')}
                        </div>
                      </div>
                      <span
                        className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border ${
                          isSelected
                            ? 'bg-orange-500 border-orange-600 text-white'
                            : 'bg-white border-neutral-300 text-transparent'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </span>
                    </button>
                  );
                })}
            </div>

            <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex justify-end">
              <button
                type="button"
                onClick={() => setIsPosOptionGroupPickerOpen(false)}
                className="px-5 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
              >
                {lang === 'th'
                  ? `ตกลง (${(editingDishInPos.optionGroupIds || []).length})`
                  : `Done (${(editingDishInPos.optionGroupIds || []).length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Dish Modal inside POS */}
      <ConfirmModal
        isOpen={Boolean(pendingDeleteDish)}
        title={lang === 'th' ? 'ยืนยันการลบเมนู' : 'Delete Menu Item'}
        message={
          lang === 'th'
            ? `ต้องการลบ "${pendingDeleteDish?.nameTh || pendingDeleteDish?.name || ''}" ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้`
            : `Are you sure you want to delete "${pendingDeleteDish?.name || ''}"?`
        }
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        isLoading={isDeletingPosDish}
        onCancel={() => {
          if (!isDeletingPosDish) setPendingDeleteDish(null);
        }}
        onConfirm={async () => {
          if (!pendingDeleteDish) return;
          setIsDeletingPosDish(true);
          try {
            const delId = pendingDeleteDish.id;
            await deleteDocument('dishes', delId);
            setDishes((prev) => prev.filter((d) => d.id !== delId));
            if (editingDishInPos?.id === delId) {
              closePosDishModalCleanly();
            }
            setPendingDeleteDish(null);
          } finally {
            setIsDeletingPosDish(false);
          }
        }}
      />

      {/* Customer Directory & Add/Edit Modal */}
      {isCustomerModalOpen && (
        <CustomerManagerModal
          customers={customers}
          lang={lang}
          initialQuery={customerModalInitialQuery}
          initialOpenForm={customerModalInitialOpenForm}
          initialEditCustomer={customerModalEditTarget}
          onSelectCustomer={
            customerSelectionCallbackMode
              ? (cust) => {
                  setAttachedCustomer({
                    customerId: cust.id,
                    customerName: cust.name,
                    customerPhone: cust.phone,
                    deliveryAddress: cust.address,
                  });
                  setCustomerQuickSearch('');
                }
              : undefined
          }
          onClose={() => {
            setIsCustomerModalOpen(false);
            setCustomerModalEditTarget(null);
            setCustomerModalInitialOpenForm(false);
          }}
        />
      )}

      {/* Printable Delivery Customer Address Label Modal */}
      {deliveryPrintTarget && (
        <DeliveryAddressModal
          customerName={deliveryPrintTarget.customerName}
          customerPhone={deliveryPrintTarget.customerPhone}
          deliveryAddress={deliveryPrintTarget.deliveryAddress}
          billNumber={deliveryPrintTarget.billNumber}
          workDate={deliveryPrintTarget.workDate}
          items={deliveryPrintTarget.items}
          grandTotal={deliveryPrintTarget.grandTotal}
          status={deliveryPrintTarget.status}
          settings={settings}
          lang={lang}
          onClose={() => setDeliveryPrintTarget(null)}
        />
      )}

      {/* Synchronized Online Order Detail Modal from ONLINE / RIDER Zone */}
      {selectedOnlineOrder && (
        <OnlineOrderDetailModal
          order={selectedOnlineOrder}
          displayIds={onlineOrderNumberingMap.get(selectedOnlineOrder.id)}
          lang={lang}
          onClose={() => setSelectedOnlineOrderId(null)}
          onStatusChange={handleOnlineZoneStatusChange}
          onPrint={(ord) => {
            setPrintingOnlineOrderAutoPrint(false);
            setPrintingOnlineOrder(ord);
          }}
        />
      )}

      {/* Synchronized Thermal Print Slip Modal from ONLINE Zone */}
      {printingOnlineOrder && (
        <OnlineOrderReceiptModal
          order={printingOnlineOrder}
          displayIds={onlineOrderNumberingMap.get(printingOnlineOrder.id)}
          settings={settings}
          lang={lang}
          autoPrint={printingOnlineOrderAutoPrint}
          silentAutoPrint={printingOnlineOrderAutoPrint}
          onClose={() => {
            setPrintingOnlineOrder(null);
            setPrintingOnlineOrderAutoPrint(false);
          }}
        />
      )}
    </div>
  );
};
