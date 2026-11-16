import React, { useState, useEffect, useRef } from 'react';
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
} from '../types';
import { translations } from '../i18n/translations';
import {
  calculateDishVariantCost,
  calculateOptionChoiceCost,
  calculateBillFinancials,
  calculateEffectiveChannelPrice,
  calculateFoodCostPercent,
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
  saveOrderToTableAtomic,
  saveCategoriesOrder,
  saveBillsOrder,
  saveDocument,
  saveImageDoc,
  getImageDoc,
} from '../data/db';
import { compressImage } from '../utils/imageCompressor';
import { translateThaiToEnglish, computeAutoEnglishName } from '../utils/thaiToEnglish';
import { NumericInput } from '../costing/components/common/NumericInput';
import { SaveOrderModal } from '../components/SaveOrderModal';
import { PaymentModal } from '../components/PaymentModal';
import { ReceiptModal } from '../components/ReceiptModal';
import { TableVisual } from '../components/TableVisual';
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
} from 'lucide-react';

interface Props {
  settings: SettingsDoc;
  lang: Language;
  onOpenFloorPlan?: () => void;
  onEditDish?: (dish: DishDoc, categoryId?: string | null) => void;
}

export const TablesPosPage: React.FC<Props> = ({ settings, lang, onOpenFloorPlan, onEditDish }) => {
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
  const [topViewMode, setTopViewMode] = useState<'bills' | 'floor'>('bills');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null); // null = bills/floor view visible

  // Active Order / Bill being created or edited
  const [activeBill, setActiveBill] = useState<BillDoc | null>(null);
  const [cartItems, setCartItems] = useState<OrderItem[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('dine_in');
  const [orderDiscount, setOrderDiscount] = useState<number>(0);

  // Dish Customization Dialog
  const [selectedDishForOptions, setSelectedDishForOptions] = useState<DishDoc | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [selectedOptionChoices, setSelectedOptionChoices] = useState<Map<string, string[]>>(new Map());
  const [itemNotes, setItemNotes] = useState<string>('');
  const [itemQuantity, setItemQuantity] = useState<number>(1);

  // Inline POS Dish Quick-Edit Modal (opened via double-click/double-tap on dish name in POS)
  const [editingDishInPos, setEditingDishInPos] = useState<DishDoc | null>(null);
  const [posEditPreviewUrl, setPosEditPreviewUrl] = useState<string | null>(null);
  const [posEditImageSizeKb, setPosEditImageSizeKb] = useState<number | null>(null);
  const [isUploadingPosImage, setIsUploadingPosImage] = useState(false);
  const [posImageError, setPosImageError] = useState<string | null>(null);
  const [isSavingPosDish, setIsSavingPosDish] = useState(false);
  const posManualEnKeysRef = useRef<Set<string>>(new Set());
  const lastDishNameTapRef = useRef<{ dishId: string; ts: number } | null>(null);

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
        if (ch.length > 0) {
          setSelectedChannelId((prev) => (ch.some((c) => c.id === prev) ? prev : ch[0].id));
        }
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
    ];

    return () => {
      unsubs.forEach((u) => u());
      if (billTouchTimerRef.current) clearTimeout(billTouchTimerRef.current);
      if (touchDragTimerRef.current) clearTimeout(touchDragTimerRef.current);
      if (variantTouchTimerRef.current) clearTimeout(variantTouchTimerRef.current);
      if (savedNoticeTimerRef.current) clearTimeout(savedNoticeTimerRef.current);
      if (dishNameClickTimerRef.current) clearTimeout(dishNameClickTimerRef.current);
    };
  }, []);

  // When a table is tapped, load existing bill or prepare fresh order and enter food ordering immediately
  const handleSelectTable = (table: TableDoc) => {
    setOrderSavedNotice(null);
    if (table.currentBillId) {
      const existing = openBills.find((b) => b.id === table.currentBillId);
      if (existing) {
        setActiveBill(existing);
        setCartItems(existing.items);
        setSelectedChannelId(existing.channelId || 'dine_in');
        setOrderDiscount(existing.discountAmount || 0);
        setSelectedCategoryId((prev) => prev || categories[0]?.id || 'all');
        return;
      }
    }

    // Fresh bill for this table
    const workDate = getBusinessWorkDate(new Date(), settings.dailyClosingTime);
    const newBill: BillDoc = {
      id: `bill_${Date.now()}`,
      billNumber: '',
      status: 'saved',
      workDate,
      tableId: table.id,
      tableName: table.name,
      channelId: selectedChannelId,
      channelName: channels.find((c) => c.id === selectedChannelId)?.name || 'Dine-In',
      orderType: 'dine_in',
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
    setSelectedCategoryId((prev) => prev || categories[0]?.id || 'all');
  };

  // Dish Selection & Option Customizer
  const handleOpenDishOptions = (dish: DishDoc) => {
    setSelectedDishForOptions(dish);
    setSelectedVariantId(dish.variants[0]?.id || '');
    setSelectedOptionChoices(new Map());
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

    selectedOptionChoices.forEach((choiceIds, groupId) => {
      const group = optionGroupsMap.get(groupId);
      if (group) {
        choiceIds.forEach((cId) => {
          const choice = group.choices.find((c) => c.id === cId);
          if (choice) {
            const optCostCalc = calculateOptionChoiceCost(choice, ingredientsMap);
            optionsPrice += choice.price || 0;
            optionsCost += optCostCalc.cost;

            optionsSnapshot.push({
              groupId: group.id,
              groupName: lang === 'th' && group.nameTh ? group.nameTh : group.name,
              choiceId: choice.id,
              choiceName: lang === 'th' && choice.nameTh ? choice.nameTh : choice.name,
              price: choice.price || 0,
              cost: optCostCalc.cost,
            });
          }
        });
      }
    });

    const currentChannel = channels.find((c) => c.id === selectedChannelId) || channels[0];
    const isDineIn = currentChannel?.type === 'dine_in';
    const effectiveVariantPrice = calculateEffectiveChannelPrice(variant.price || 0, currentChannel);
    const unitPrice = effectiveVariantPrice + optionsPrice;

    // Strictly separate Food COGS from packaging:
    // Packaging from recipe variant applies ONLY for takeaway/delivery channels, never dine-in.
    const foodCostSnapshot = roundTo2(variantCostCalc.foodCost + optionsCost);
    const packagingCostSnapshot = isDineIn ? 0 : roundTo2(variantCostCalc.packagingCost);
    const totalUnitCostSnapshot = roundTo2(foodCostSnapshot + packagingCostSnapshot);

    const newItem: OrderItem = {
      dishId: selectedDishForOptions.id,
      dishName: lang === 'th' && selectedDishForOptions.nameTh ? selectedDishForOptions.nameTh : selectedDishForOptions.name,
      variantId: variant.id,
      variantName: lang === 'th' && variant.nameTh ? variant.nameTh : variant.name,
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
  const currentChannel = channels.find((c) => c.id === selectedChannelId) || channels[0];
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

  // Save order directly to a specific table atomically
  const saveOrderToTable = async (
    tableId: string,
    returnToCurrentBills: boolean = false
  ): Promise<BillDoc | null> => {
    if (!tableId || cartItems.length === 0 || isSavingOrder) return null;
    setIsSavingOrder(true);
    const targetTable = tables.find((t) => t.id === tableId);

    const workDate = getBusinessWorkDate(new Date(), settings.dailyClosingTime);
    const latestServerBill = activeBill?.id ? openBills.find((b) => b.id === activeBill.id) : undefined;
    const resolvedVersion = latestServerBill?.version ?? activeBill?.version ?? 1;
    const resolvedBillNumber = latestServerBill?.billNumber || activeBill?.billNumber || '';

    const completeBill: BillDoc = {
      id: activeBill?.id || `bill_${Date.now()}`,
      billNumber: resolvedBillNumber,
      status: 'saved',
      workDate,
      tableId,
      tableName: targetTable?.name || activeBill?.tableName,
      channelId: selectedChannelId,
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
        setSelectedCategoryId(null);
        setTopViewMode('bills');
      } else {
        setActiveBill(saved);
      }
      if (savedNoticeTimerRef.current) clearTimeout(savedNoticeTimerRef.current);
      const tblLabel = saved.tableName || targetTable?.name || '';
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

  // Confirm Order -> Save directly if table already selected and return to Current Bills; otherwise open Save Order Modal
  const handleInitiateConfirmOrder = async () => {
    if (cartItems.length === 0 || isSavingOrder) return;
    if (activeBill?.tableId) {
      await saveOrderToTable(activeBill.tableId, true);
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

  // Proceed to payment (save automatically if table already selected, otherwise prompt table picker)
  const handleProceedToPayment = async () => {
    if (cartItems.length === 0 || isSavingOrder) return;
    if (!activeBill?.tableId) {
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

  // Inline POS Dish Quick-Edit handlers (triggered via onDoubleClick or double-tap on dish name in POS)
  const handleOpenPosEditDish = (dish: DishDoc) => {
    if (dishNameClickTimerRef.current) {
      clearTimeout(dishNameClickTimerRef.current);
      dishNameClickTimerRef.current = null;
    }
    setSelectedDishForOptions(null);
    posManualEnKeysRef.current.clear();
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
    setEditingDishInPos({
      ...dish,
      variants: (dish.variants || []).map((v) => ({
        ...v,
        ingredients: [...(v.ingredients || [])],
        subRecipes: [...(v.subRecipes || [])],
        packaging: [...(v.packaging || [])],
      })),
      optionGroupIds: [...(dish.optionGroupIds || [])],
    });
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

  const handleSavePosDish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDishInPos || isSavingPosDish) return;

    const finalDishTh = (editingDishInPos.nameTh || '').trim();
    const finalDishEn =
      (editingDishInPos.name || '').trim() ||
      (finalDishTh ? translateThaiToEnglish(finalDishTh) : '');
    if (!finalDishEn && !finalDishTh) return;

    setIsSavingPosDish(true);
    try {
      const normalizedVariants: DishVariant[] = (editingDishInPos.variants || []).map((v) => {
        const vTh = (v.nameTh || '').trim();
        const vEn =
          (v.name || '').trim() ||
          (vTh ? translateThaiToEnglish(vTh) : '') ||
          'Standard';
        return {
          ...v,
          name: vEn,
          ...(vTh ? { nameTh: vTh } : {}),
          price: Number(v.price) || 0,
          ingredients: v.ingredients || [],
          subRecipes: v.subRecipes || [],
          packaging: v.packaging || [],
        };
      });

      const dishToSave: DishDoc = {
        ...editingDishInPos,
        name: finalDishEn || finalDishTh,
        ...(finalDishTh ? { nameTh: finalDishTh } : {}),
        categoryId: editingDishInPos.categoryId || categories[0]?.id || 'cat_main',
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
        updatedAt: new Date().toISOString(),
        version: (editingDishInPos.version || 0) + 1,
      };
      if (!editingDishInPos.imageId) {
        delete dishToSave.imageId;
      }

      await saveDocument('dishes', dishToSave, false);
      setDishes((prev) => prev.map((d) => (d.id === dishToSave.id ? dishToSave : d)));
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
      setEditingDishInPos(null);
      setPosEditPreviewUrl(null);
    } catch (err) {
      console.error('POS save dish error:', err);
    } finally {
      setIsSavingPosDish(false);
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
    setSelectedChannelId(bill.channelId || 'dine_in');
    setOrderDiscount(bill.discountAmount || 0);
    setSelectedCategoryId((prev) => prev || categories[0]?.id || 'all');
  };

  const handleQuickPaySavedBill = (bill: BillDoc) => {
    setOrderSavedNotice(null);
    setActiveBill(bill);
    setCartItems(bill.items || []);
    setSelectedChannelId(bill.channelId || 'dine_in');
    setOrderDiscount(bill.discountAmount || 0);
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
          </div>

          {/* Link to Floor Plan Studio (+Add Zone / +Add Table live there now) */}
          <div className="flex items-center gap-1.5 shrink-0">
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
              <div className="flex items-center justify-between gap-2">
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
                <button
                  onClick={() => {
                    setSelectedCategoryId(null);
                    setTopViewMode('bills');
                  }}
                  className="px-3 py-1 bg-white hover:bg-neutral-50 text-neutral-700 rounded-xl text-xs font-bold border border-neutral-300 shadow-2xs cursor-pointer shrink-0"
                >
                  ← {t.pos.billCard}
                </button>
              </div>

              {/* Dish Cards (~30% smaller): Shows ONLY Photo and Name below it (no price) */}
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 gap-2">
                {displayedDishes.map((dish) => {
                  const imgDataUrl = dishImages.get(dish.id);
                  return (
                    <div
                      key={dish.id}
                      onClick={() => handleOpenDishOptions(dish)}
                      className="group bg-white rounded-xl border border-slate-200 hover:border-orange-400 p-1.5 shadow-[inset_0_1px_0_#ffffff,0_2px_0_#e2e8f0,0_6px_12px_-6px_rgba(15,23,42,0.08)] hover:-translate-y-0.5 hover:shadow-[0_3px_0_#fdba74,0_10px_16px_-6px_rgba(234,88,12,0.18)] transition-all duration-150 cursor-pointer flex flex-col items-center text-center select-none active:translate-y-[1px]"
                    >
                      <div className="w-full aspect-square rounded-lg bg-slate-100 overflow-hidden mb-1 relative flex items-center justify-center shadow-[inset_0_1px_3px_rgba(15,23,42,0.06)]">
                        {imgDataUrl ? (
                          <img
                            src={imgDataUrl}
                            alt={dish.name}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        ) : (
                          <Utensils className="w-7 h-7 text-slate-300" />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
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
                            ? 'ดับเบิลคลิกที่ชื่อเมนูเพื่อเปิดโหมดแก้ไขทันที'
                            : 'Double-click dish name to edit immediately'
                        }
                        className="w-full block text-center font-extrabold text-[11px] sm:text-xs leading-tight text-slate-900 group-hover:text-orange-600 hover:underline decoration-orange-400/70 underline-offset-2 transition-colors line-clamp-2 px-1 py-1 rounded cursor-pointer"
                      >
                        {lang === 'th' && dish.nameTh ? dish.nameTh : dish.name}
                      </button>
                    </div>
                  );
                })}
              </div>
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
                        {/* Table Name */}
                        <div className="flex items-center gap-1 min-w-0">
                          <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                          <div className="font-black text-xs text-slate-900 truncate">
                            {bill.tableName || (lang === 'th' ? 'ไม่ระบุโต๊ะ' : 'Walk-In')}
                          </div>
                        </div>

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
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-black text-sm text-neutral-900 flex items-center gap-1.5">
                  <Receipt className="w-4 h-4 text-orange-600" />
                  <span>
                    {activeBill?.tableName ? `${activeBill.tableName}` : lang === 'th' ? 'บิลปัจจุบัน' : 'Current Bill'}
                  </span>
                </h4>
              </div>

              {/* Channel Selector */}
              <select
                value={selectedChannelId}
                onChange={(e) => setSelectedChannelId(e.target.value)}
                className="px-2 py-1 text-xs font-bold bg-white border border-neutral-300 rounded-lg text-neutral-800 focus:ring-1 focus:ring-orange-500"
              >
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {lang === 'th' && ch.nameTh ? ch.nameTh : ch.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

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
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col border border-orange-200 overflow-hidden">
            {/* Header */}
            <div className="p-4 bg-gradient-to-r from-orange-500 via-red-500 to-amber-500 text-white flex items-center justify-between">
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
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                              {lang === 'th' && v.nameTh ? v.nameTh : v.name}
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
                              Food: ฿{formatMoney(vCost.foodCost)} ({formatPercent(calculateFoodCostPercent(vCost.foodCost, netEffectivePrice))})
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
                const selectedChoices = selectedOptionChoices.get(groupId) || [];

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

                    <div className="grid grid-cols-2 gap-1.5">
                      {group.choices.map((choice) => {
                        const isChosen = selectedChoices.includes(choice.id);
                        return (
                          <button
                            key={choice.id}
                            type="button"
                            onClick={() => {
                              const next = new Map(selectedOptionChoices);
                              let curr = next.get(groupId) || [];
                              if (isChosen) {
                                curr = curr.filter((id) => id !== choice.id);
                              } else {
                                if (group.maxSelect === 1) {
                                  curr = [choice.id];
                                } else if (curr.length < group.maxSelect) {
                                  curr = [...curr, choice.id];
                                }
                              }
                              next.set(groupId, curr);
                              setSelectedOptionChoices(next);
                            }}
                            className={`p-2 rounded-xl border text-left text-xs font-semibold flex justify-between items-center cursor-pointer transition-all ${
                              isChosen
                                ? 'bg-orange-500 text-white border-orange-600 shadow-2xs'
                                : 'bg-white text-neutral-800 border-neutral-300 hover:bg-neutral-100'
                            }`}
                          >
                            <span>{lang === 'th' && choice.nameTh ? choice.nameTh : choice.name}</span>
                            {choice.price > 0 && (
                              <span className="font-bold">+{formatMoney(choice.price)}</span>
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
            <div className="p-2.5 sm:p-3 bg-neutral-100 border-t border-neutral-200 flex items-center justify-between gap-2 shrink-0">
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
        return (
          <PaymentModal
            bill={{
              ...activeBill,
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
              setOpenBills((prev) => prev.filter((b) => b.id !== paidBill.id));
              setReceiptBillToView(paidBill);
              setIsCheckReceipt(false);
              setIsReceiptModalOpen(true);
              setActiveBill(null);
              setCartItems([]);
              setOrderDiscount(0);
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

      {/* Inline Quick Edit Dish Modal directly inside POS */}
      {editingDishInPos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <form
            onSubmit={handleSavePosDish}
            className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col border border-orange-200 overflow-hidden"
          >
            <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Edit2 className="w-4 h-4" />
                <h3 className="font-extrabold text-base">{t.menuCost.editDish}</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingDishInPos(null)}
                className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Names TH / EN */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    ชื่อเมนู (ภาษาไทย) *
                  </label>
                  <input
                    type="text"
                    required={!editingDishInPos.name}
                    value={editingDishInPos.nameTh || ''}
                    onChange={(e) => {
                      const nextTh = e.target.value;
                      const nextEn = computeAutoEnglishName({
                        previousThai: editingDishInPos.nameTh || '',
                        nextThai: nextTh,
                        currentEnglish: editingDishInPos.name || '',
                        isManuallyEdited: posManualEnKeysRef.current.has('dish'),
                      });
                      setEditingDishInPos({ ...editingDishInPos, nameTh: nextTh, name: nextEn });
                    }}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-orange-300 rounded-xl focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-neutral-700">
                      {t.menuCost.dishName} (EN)
                    </label>
                    {editingDishInPos.nameTh && (
                      <button
                        type="button"
                        onClick={() => {
                          posManualEnKeysRef.current.delete('dish');
                          setEditingDishInPos({
                            ...editingDishInPos,
                            name: translateThaiToEnglish(editingDishInPos.nameTh || ''),
                          });
                        }}
                        className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer"
                      >
                        แปลใหม่
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={editingDishInPos.name || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.trim()) posManualEnKeysRef.current.add('dish');
                      else posManualEnKeysRef.current.delete('dish');
                      setEditingDishInPos({ ...editingDishInPos, name: val });
                    }}
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

              {/* Primary Variants & Prices */}
              <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-neutral-800">{t.menuCost.variants}</span>
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
                    className="px-2.5 py-1 bg-white hover:bg-orange-50 border border-neutral-300 text-neutral-700 rounded-lg text-[11px] font-bold cursor-pointer flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3 text-orange-600" />
                    <span>{lang === 'th' ? 'เพิ่มตัวเลือก' : 'Add Option'}</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {editingDishInPos.variants.map((v, vIdx) => (
                    <div
                      key={v.id}
                      className="grid grid-cols-12 gap-2 items-center bg-white p-2 rounded-xl border border-neutral-200"
                    >
                      <div className="col-span-5">
                        <input
                          type="text"
                          required={!v.name}
                          value={v.nameTh || ''}
                          onChange={(e) => {
                            const nextTh = e.target.value;
                            const updated = [...editingDishInPos.variants];
                            const prev = updated[vIdx];
                            const nextEn = computeAutoEnglishName({
                              previousThai: prev.nameTh || '',
                              nextThai: nextTh,
                              currentEnglish: prev.name || '',
                              isManuallyEdited: posManualEnKeysRef.current.has(`var_${v.id}`),
                            });
                            updated[vIdx] = { ...prev, nameTh: nextTh, name: nextEn };
                            setEditingDishInPos({ ...editingDishInPos, variants: updated });
                          }}
                          placeholder="ชื่อตัวเลือก (TH)"
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
                            if (val.trim()) posManualEnKeysRef.current.add(key);
                            else posManualEnKeysRef.current.delete(key);
                            const updated = [...editingDishInPos.variants];
                            updated[vIdx] = { ...updated[vIdx], name: val };
                            setEditingDishInPos({ ...editingDishInPos, variants: updated });
                          }}
                          placeholder="EN"
                          className="w-full px-2 py-1 text-xs bg-neutral-50 border border-neutral-300 rounded-lg"
                        />
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
                  ))}
                </div>
              </div>

              {/* Option Groups Attached */}
              {optionGroups.length > 0 && (
                <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-2">
                  <div className="text-xs font-black text-neutral-800">
                    {t.menuCost.attachedOptionGroups}
                  </div>
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
                </div>
              )}
            </div>

            <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex items-center justify-between gap-2 shrink-0">
              <div>
                {onEditDish && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = editingDishInPos;
                      setEditingDishInPos(null);
                      onEditDish(target, selectedCategoryId);
                    }}
                    className="px-3 py-2 bg-white hover:bg-neutral-50 text-neutral-700 rounded-xl text-xs font-bold border border-neutral-300 cursor-pointer"
                  >
                    {lang === 'th' ? 'จัดการเมนู & ต้นทุนเต็ม' : 'Full Menu Editor'}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingDishInPos(null)}
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
    </div>
  );
};
