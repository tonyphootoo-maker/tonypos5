import React, { useState, useEffect, useRef } from 'react';
import {
  TableDoc,
  ZoneDoc,
  DishDoc,
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
  getImageDoc,
} from '../data/db';
import { SaveOrderModal } from '../components/SaveOrderModal';
import { PaymentModal } from '../components/PaymentModal';
import { ReceiptModal } from '../components/ReceiptModal';
import { TableVisual } from '../components/TableVisual';
import {
  FLOOR_CANVAS_MIN_WIDTH,
  FLOOR_CANVAS_MIN_HEIGHT,
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
} from 'lucide-react';

interface Props {
  settings: SettingsDoc;
  lang: Language;
  onOpenFloorPlan?: () => void;
}

export const TablesPosPage: React.FC<Props> = ({ settings, lang, onOpenFloorPlan }) => {
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
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null); // null = floor plan visible

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

  // Maps for dynamic recipe cost calculation
  const ingredientsMap = new Map<string, IngredientDoc>(ingredients.map((i) => [i.id, i]));
  const subRecipesMap = new Map<string, SubRecipeDoc>(subRecipes.map((s) => [s.id, s]));
  const packagingMap = new Map<string, PackagingDoc>(packagings.map((p) => [p.id, p]));
  const optionGroupsMap = new Map<string, OptionGroupDoc>(optionGroups.map((g) => [g.id, g]));

  const loadedDishImageIdsRef = useRef<Map<string, string>>(new Map());
  const floorViewportRef = useRef<HTMLDivElement>(null);
  const [floorScale, setFloorScale] = useState<number>(1);

  // Auto-fit floor plan canvas proportionally to device viewport (Mobile, Tablet, POS, Desktop)
  useEffect(() => {
    const el = floorViewportRef.current;
    if (!el || selectedCategoryId !== null) return;

    const updateScale = () => {
      const availW = Math.max(240, el.clientWidth - 16);
      const availH = Math.max(200, el.clientHeight - 16);
      const scaleW = availW / FLOOR_CANVAS_MIN_WIDTH;
      const scaleH = availH / FLOOR_CANVAS_MIN_HEIGHT;
      const next = Math.min(1, Math.max(0.32, Math.min(scaleW, Math.max(scaleW, scaleH))));
      // Fit width on narrow devices; also fit height when screen is shorter than scaled canvas
      const fitBoth = Math.min(1, Math.max(0.32, Math.min(scaleW, scaleH)));
      setFloorScale(availW < FLOOR_CANVAS_MIN_WIDTH || availH < FLOOR_CANVAS_MIN_HEIGHT ? fitBoth : next);
    };

    updateScale();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateScale);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [selectedCategoryId]);

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
      if (touchDragTimerRef.current) clearTimeout(touchDragTimerRef.current);
      if (savedNoticeTimerRef.current) clearTimeout(savedNoticeTimerRef.current);
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
  const saveOrderToTable = async (tableId: string): Promise<BillDoc | null> => {
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
    };

    try {
      const saved = await saveOrderToTableAtomic(completeBill, tableId);
      setActiveBill(saved);
      setIsSaveOrderModalOpen(false);
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

  // Confirm Order -> Save directly if table already selected; otherwise open Save Order Modal
  const handleInitiateConfirmOrder = async () => {
    if (cartItems.length === 0 || isSavingOrder) return;
    if (activeBill?.tableId) {
      await saveOrderToTable(activeBill.tableId);
      return;
    }
    setTargetTableIdForSave(null);
    setIsSaveOrderModalOpen(true);
  };

  // Save order from modal table picker
  const handleSaveOrderToTable = async () => {
    if (!targetTableIdForSave) return;
    await saveOrderToTable(targetTableIdForSave);
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

  // Filter dishes by active category if any
  const displayedDishes =
    selectedCategoryId && selectedCategoryId !== 'all'
      ? dishes.filter((d) => d.categoryId === selectedCategoryId)
      : dishes;

  // Tables visible on start page (exclude standalone chairs; POS is read-only):
  // Dining tables in the selected zone (exclude standalone chairs)
  const orderTables = tables.filter((t) => t.itemKind !== 'chair');
  const zoneTables = activeZoneId
    ? orderTables.filter((t) => t.zoneId === activeZoneId)
    : orderTables;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-transparent overflow-hidden select-none">
      {/* Top Zone Chip Bar: Only visible when NOT full screen in a category */}
      {!selectedCategoryId && (
        <div className="px-3 sm:px-4 py-2.5 bg-white/90 backdrop-blur-md border-b border-slate-200 flex items-center justify-between gap-2 shadow-[0_4px_14px_-6px_rgba(15,23,42,0.08)]">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none flex-1 py-0.5">

            {zones.map((z) => {
              const countInZone = orderTables.filter((tbl) => tbl.zoneId === z.id && tbl.currentBillId).length;
              return (
                <button
                  key={z.id}
                  onClick={() => setActiveZoneId(z.id)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap active:translate-y-[1px] ${
                    activeZoneId === z.id
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
                  onClick={() => setSelectedCategoryId(null)}
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
                      <span className="font-extrabold text-[11px] sm:text-xs leading-tight text-slate-900 group-hover:text-orange-600 transition-colors line-clamp-2">
                        {lang === 'th' && dish.nameTh ? dish.nameTh : dish.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            // Specific Zone Floor Plan (Strictly Read-Only, auto-fitted to device viewport)
            <div
              ref={floorViewportRef}
              className="flex-1 min-h-0 overflow-auto bg-slate-100/60 p-2 flex items-start sm:items-center justify-center"
            >
              <div
                className="shrink-0"
                style={{
                  width: `${Math.round(FLOOR_CANVAS_MIN_WIDTH * floorScale)}px`,
                  height: `${Math.round(FLOOR_CANVAS_MIN_HEIGHT * floorScale)}px`,
                }}
              >
                <div
                  style={{
                    width: `${FLOOR_CANVAS_MIN_WIDTH}px`,
                    height: `${FLOOR_CANVAS_MIN_HEIGHT}px`,
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
                    {activeBill?.tableName ? `${activeBill.tableName}` : t.pos.billCard}
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

      {/* Always-Visible Bottom Bar: Permanent "Bill" card + Sculpted 3D Category Cards */}
      <div className="min-h-[64px] pb-[env(safe-area-inset-bottom)] bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-2 flex items-center gap-2 overflow-x-auto shadow-[0_-6px_20px_-10px_rgba(15,23,42,0.1)] z-30 shrink-0">
        {/* Permanent Bill Card (reduced ~40% in size, no bill number) */}
        <button
          onClick={() => setSelectedCategoryId(null)}
          className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 font-black text-[11px] cursor-pointer transition-all shrink-0 active:translate-y-[1px] ${
            selectedCategoryId === null
              ? 'bg-slate-900 text-white shadow-[0_2px_0_#0f172a,0_6px_12px_-5px_rgba(15,23,42,0.35)] ring-2 ring-orange-500'
              : 'bg-white text-slate-800 hover:bg-slate-50 border border-slate-200 shadow-[0_2px_0_#e2e8f0]'
          }`}
        >
          <Receipt className="w-3.5 h-3.5 text-orange-400 shrink-0" />
          <span className="leading-none whitespace-nowrap">{t.pos.billCard}</span>
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
              <div>
                <h3 className="font-extrabold text-base">
                  {lang === 'th' && selectedDishForOptions.nameTh ? selectedDishForOptions.nameTh : selectedDishForOptions.name}
                </h3>
                <p className="text-xs text-orange-100">{t.pos.optionsVariants}</p>
              </div>
              <button
                onClick={() => setSelectedDishForOptions(null)}
                className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Variants Selector */}
              <div>
                <label className="block text-xs font-bold text-neutral-800 mb-1.5">
                  {t.pos.pickVariant}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {selectedDishForOptions.variants.map((v) => {
                    const isSelected = selectedVariantId === v.id;
                    const vCost = calculateDishVariantCost(v, ingredientsMap, subRecipesMap, packagingMap);
                    const effectivePrice = calculateEffectiveChannelPrice(v.price, currentChannel);
                    const hasMarkup = (currentChannel?.priceMarkupPercent || 0) > 0;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVariantId(v.id)}
                        className={`p-3 rounded-2xl border text-left cursor-pointer transition-all ${
                          isSelected
                            ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-400'
                            : 'border-neutral-200 bg-white hover:bg-neutral-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-extrabold text-xs text-neutral-900 truncate">
                            {lang === 'th' && v.nameTh ? v.nameTh : v.name}
                          </span>
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
                            <div className="text-[10px] text-neutral-500">
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

              {/* Quantity */}
              <div className="flex items-center justify-between pt-2 border-t border-neutral-200">
                <span className="text-xs font-bold text-neutral-800">Quantity</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setItemQuantity(Math.max(1, itemQuantity - 1))}
                    className="w-8 h-8 rounded-xl bg-neutral-200 hover:bg-neutral-300 text-neutral-800 font-bold flex items-center justify-center cursor-pointer"
                  >
                    -
                  </button>
                  <span className="font-black text-sm w-6 text-center">{itemQuantity}</span>
                  <button
                    type="button"
                    onClick={() => setItemQuantity(itemQuantity + 1)}
                    className="w-8 h-8 rounded-xl bg-neutral-200 hover:bg-neutral-300 text-neutral-800 font-bold flex items-center justify-center cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Footer Add */}
            <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedDishForOptions(null)}
                className="px-4 py-2 bg-white text-neutral-700 rounded-xl text-xs font-bold border border-neutral-300 cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={handleAddToCart}
                className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md shadow-orange-500/20 cursor-pointer hover:brightness-105"
              >
                {t.pos.addToBill}
              </button>
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
      {isPaymentModalOpen && activeBill && (
        <PaymentModal
          bill={{
            ...activeBill,
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
            setReceiptBillToView(paidBill);
            setIsCheckReceipt(false);
            setIsReceiptModalOpen(true);
            setActiveBill(null);
            setCartItems([]);
          }}
        />
      )}

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
    </div>
  );
};
