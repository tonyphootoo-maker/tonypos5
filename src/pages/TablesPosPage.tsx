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
  DishVariant,
  OptionGroupDoc,
  IngredientDoc,
  SubRecipeDoc,
  PackagingDoc,
  SettingsDoc,
  Language,
  TableShape,
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
  saveDocument,
  deleteDocument,
  saveOrderToTableAtomic,
  getImageDoc,
} from '../data/db';
import { SaveOrderModal } from '../components/SaveOrderModal';
import { PaymentModal } from '../components/PaymentModal';
import { ReceiptModal } from '../components/ReceiptModal';
import {
  Users,
  Plus,
  Trash2,
  Edit2,
  Utensils,
  Receipt,
  Printer,
  CreditCard,
  ShoppingBag,
  Sparkles,
  AlertCircle,
  X,
  Check,
  ChevronRight,
  Move,
} from 'lucide-react';

interface Props {
  settings: SettingsDoc;
  lang: Language;
}

export const TablesPosPage: React.FC<Props> = ({ settings, lang }) => {
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
  const [activeZoneId, setActiveZoneId] = useState<string>('all');
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

  // Table Management State
  const [isTableEditorOpen, setIsTableEditorOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<Partial<TableDoc> | null>(null);
  const [isAddingZone, setIsAddingZone] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');

  // Dragging table state
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const floorPlanRef = useRef<HTMLDivElement>(null);

  // Maps for dynamic recipe cost calculation
  const ingredientsMap = new Map<string, IngredientDoc>(ingredients.map((i) => [i.id, i]));
  const subRecipesMap = new Map<string, SubRecipeDoc>(subRecipes.map((s) => [s.id, s]));
  const packagingMap = new Map<string, PackagingDoc>(packagings.map((p) => [p.id, p]));
  const optionGroupsMap = new Map<string, OptionGroupDoc>(optionGroups.map((g) => [g.id, g]));

  const loadedDishImageIdsRef = useRef<Map<string, string>>(new Map());

  // Setup Realtime Listeners across ALL POS tables, bills, menus, options & ingredients
  useEffect(() => {
    const unsubs = [
      subscribeTables((tbls) => setTables(tbls)),
      subscribeOpenBills((bills) => setOpenBills(bills)),
      subscribeCollection<ZoneDoc>('zones', (z) =>
        setZones([...z].sort((a, b) => (a.order || 0) - (b.order || 0)))
      ),
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
    };
  }, []);

  // When a table is tapped, if it has an open bill, load it; if not, prepare fresh order for that table
  const handleSelectTable = (table: TableDoc) => {
    if (table.currentBillId) {
      const existing = openBills.find((b) => b.id === table.currentBillId);
      if (existing) {
        setActiveBill(existing);
        setCartItems(existing.items);
        setSelectedChannelId(existing.channelId || 'dine_in');
        setOrderDiscount(existing.discountAmount || 0);
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

  // Confirm Order -> Open Save Order Modal to select or confirm table
  const handleInitiateConfirmOrder = () => {
    if (cartItems.length === 0) return;
    setTargetTableIdForSave(activeBill?.tableId || null);
    setIsSaveOrderModalOpen(true);
  };

  // Save order to selected table atomically
  const handleSaveOrderToTable = async () => {
    if (!targetTableIdForSave) return;
    const targetTable = tables.find((t) => t.id === targetTableIdForSave);

    const workDate = getBusinessWorkDate(new Date(), settings.dailyClosingTime);
    const completeBill: BillDoc = {
      id: activeBill?.id || `bill_${Date.now()}`,
      billNumber: activeBill?.billNumber || '',
      status: 'saved',
      workDate,
      tableId: targetTableIdForSave,
      tableName: targetTable?.name,
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
      version: activeBill?.version || 1,
    };

    try {
      const saved = await saveOrderToTableAtomic(completeBill, targetTableIdForSave);
      setActiveBill(saved);
      setIsSaveOrderModalOpen(false);
    } catch (err) {
      console.error('Save order error:', err);
    }
  };

  // Proceed to payment (BLOCKED if not saved to a table!)
  const handleProceedToPayment = () => {
    if (!activeBill?.tableId || !activeBill?.billNumber) {
      // Must save to table first!
      setIsSaveOrderModalOpen(true);
      return;
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

  // Dragging table support
  const handleMouseDownOnTable = (tableId: string) => {
    setDraggingTableId(tableId);
  };

  const handleMouseMoveOnFloorPlan = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!draggingTableId || !floorPlanRef.current) return;
    const rect = floorPlanRef.current.getBoundingClientRect();
    const x = Math.max(10, Math.min(rect.width - 100, e.clientX - rect.left - 40));
    const y = Math.max(10, Math.min(rect.height - 100, e.clientY - rect.top - 40));

    setTables((prev) =>
      prev.map((t) => (t.id === draggingTableId ? { ...t, x: Math.round(x), y: Math.round(y) } : t))
    );
  };

  const handleMouseUpOnFloorPlan = async () => {
    if (!draggingTableId) return;
    const tbl = tables.find((t) => t.id === draggingTableId);
    setDraggingTableId(null);
    if (tbl) {
      await saveDocument('tables', tbl, false);
    }
  };

  // Save new or edited table
  const handleSaveTableForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTable || !editingTable.name) return;

    const isNew = !editingTable.id;
    const tableToSave: TableDoc = {
      id: editingTable.id || `tbl_${Date.now()}`,
      name: editingTable.name,
      zoneId: editingTable.zoneId || zones[0]?.id || 'zone_main',
      shape: editingTable.shape || 'square',
      chairs: editingTable.chairs || 4,
      x: editingTable.x || 100,
      y: editingTable.y || 100,
      createdAt: editingTable.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: editingTable.version || 1,
    };

    await saveDocument('tables', tableToSave, isNew);
    setIsTableEditorOpen(false);
    setEditingTable(null);
  };

  // Add new zone
  const handleCreateZone = async () => {
    if (!newZoneName.trim()) return;
    const newZone: ZoneDoc = {
      id: `zone_${Date.now()}`,
      name: newZoneName.trim(),
      order: zones.length + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    await saveDocument('zones', newZone, true);
    setZones((prev) => [...prev, newZone]);
    setNewZoneName('');
    setIsAddingZone(false);
  };

  // Filter dishes by active category if any
  const displayedDishes = selectedCategoryId
    ? dishes.filter((d) => d.categoryId === selectedCategoryId)
    : dishes;

  // Tables visible on start page:
  // "All zones": ONLY tables that have a saved order!
  // A specific zone: all tables in that zone with floor plan!
  const tablesWithSavedOrder = tables.filter((t) => !!t.currentBillId);
  const zoneTables = activeZoneId === 'all'
    ? tablesWithSavedOrder
    : tables.filter((t) => t.zoneId === activeZoneId);

  return (
    <div className="flex flex-col h-[calc(100vh-62px)] bg-transparent overflow-hidden select-none">
      {/* Top Zone Chip Bar: Only visible when NOT full screen in a category */}
      {!selectedCategoryId && (
        <div className="px-3 sm:px-4 py-2.5 bg-white/90 backdrop-blur-md border-b border-slate-200 flex items-center justify-between gap-2 shadow-[0_4px_14px_-6px_rgba(15,23,42,0.08)]">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none flex-1 py-0.5">
            <button
              onClick={() => setActiveZoneId('all')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap active:translate-y-[1px] ${
                activeZoneId === 'all'
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-[0_3px_0_#c2410c,0_6px_14px_-4px_rgba(234,88,12,0.3)]'
                  : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 shadow-[0_2px_0_#e2e8f0]'
              }`}
            >
              {t.pos.allZones} ({tablesWithSavedOrder.length})
            </button>

            {zones.map((z) => {
              const countInZone = tables.filter((tbl) => tbl.zoneId === z.id && tbl.currentBillId).length;
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

            {/* Add Zone Trigger */}
            {isAddingZone ? (
              <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-orange-300 shadow-xs">
                <input
                  type="text"
                  placeholder={t.pos.zoneName}
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  className="px-2 py-1 text-xs w-28 bg-slate-50 rounded-lg border border-slate-300 focus:outline-hidden"
                />
                <button
                  onClick={handleCreateZone}
                  className="p-1 bg-orange-500 text-white rounded-lg hover:bg-orange-600 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setIsAddingZone(false)}
                  className="p-1 text-slate-500 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsAddingZone(true)}
                className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-orange-700 hover:bg-orange-50 border border-dashed border-orange-300 whitespace-nowrap cursor-pointer"
              >
                {t.pos.addZone}
              </button>
            )}
          </div>

          {/* Table Management Actions */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setEditingTable({
                  zoneId: activeZoneId !== 'all' ? activeZoneId : zones[0]?.id || 'zone_main',
                  shape: 'square',
                  chairs: 4,
                  x: 100,
                  y: 100,
                });
                setIsTableEditorOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-orange-800 border border-slate-200 hover:bg-orange-50 shadow-[0_2px_0_#e2e8f0] cursor-pointer flex items-center gap-1 active:translate-y-[1px]"
            >
              <Plus className="w-3.5 h-3.5 text-orange-600" />
              <span>{t.pos.addTable}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side: Tables Floor Plan or Dishes Grid */}
        <div className="flex-1 flex flex-col overflow-hidden bg-transparent">
          {selectedCategoryId ? (
            // Full Screen Category Menu View
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-black text-lg text-neutral-800 flex items-center gap-2">
                  <Utensils className="w-5 h-5 text-orange-600" />
                  <span>
                    {categories.find((c) => c.id === selectedCategoryId)?.name || t.pos.allCategories}
                  </span>
                </h3>
                <button
                  onClick={() => setSelectedCategoryId(null)}
                  className="px-3 py-1 bg-white hover:bg-neutral-50 text-neutral-700 rounded-xl text-xs font-bold border border-neutral-300 shadow-2xs cursor-pointer"
                >
                  ← {t.pos.billCard}
                </button>
              </div>

              {/* Dish Cards: Shows ONLY Photo and Name below it (no price) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                {displayedDishes.map((dish) => {
                  const imgDataUrl = dishImages.get(dish.id);
                  return (
                    <div
                      key={dish.id}
                      onClick={() => handleOpenDishOptions(dish)}
                      className="group bg-white rounded-2xl border border-slate-200 hover:border-orange-400 p-2.5 shadow-[inset_0_1px_0_#ffffff,0_3px_0_#e2e8f0,0_10px_20px_-8px_rgba(15,23,42,0.08)] hover:-translate-y-0.5 hover:shadow-[0_4px_0_#fdba74,0_14px_24px_-8px_rgba(234,88,12,0.18)] transition-all duration-150 cursor-pointer flex flex-col items-center text-center select-none active:translate-y-[2px]"
                    >
                      <div className="w-full aspect-square rounded-xl bg-slate-100 overflow-hidden mb-2 relative flex items-center justify-center shadow-[inset_0_1px_3px_rgba(15,23,42,0.06)]">
                        {imgDataUrl ? (
                          <img
                            src={imgDataUrl}
                            alt={dish.name}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        ) : (
                          <Utensils className="w-10 h-10 text-slate-300" />
                        )}
                      </div>
                      <span className="font-extrabold text-sm text-slate-900 group-hover:text-orange-600 transition-colors line-clamp-2">
                        {lang === 'th' && dish.nameTh ? dish.nameTh : dish.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : activeZoneId === 'all' ? (
            // "All zones": ONLY tables that have a saved order!
            <div className="flex-1 overflow-y-auto p-4">
              {tablesWithSavedOrder.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center p-6">
                  <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 shadow-[0_4px_0_#e2e8f0,0_10px_20px_-6px_rgba(15,23,42,0.08)] flex items-center justify-center mb-3">
                    <Receipt className="w-8 h-8 text-slate-300" />
                  </div>
                  <p className="font-bold text-sm text-slate-600">No tables with active orders</p>
                  <p className="text-xs text-slate-400 max-w-xs mt-1">
                    Select a specific zone above to view all free tables and start a new order.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                  {tablesWithSavedOrder.map((tbl) => {
                    const bill = openBills.find((b) => b.id === tbl.currentBillId);
                    const isSelected = activeBill?.tableId === tbl.id;

                    return (
                      <div
                        key={tbl.id}
                        onClick={() => handleSelectTable(tbl)}
                        className={`kin-3d-table p-4 rounded-2xl cursor-pointer flex flex-col justify-between h-36 border-2 border-red-500 bg-white select-none ${
                          isSelected ? 'ring-4 ring-orange-400 bg-orange-50/40' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-black text-xl text-slate-900">{tbl.name}</span>
                          <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-red-600 text-white shadow-2xs">
                            {t.pos.occupiedTable}
                          </span>
                        </div>

                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-slate-600">
                            Bill: {bill?.billNumber || 'Unsaved'}
                          </div>
                          <div className="text-lg font-black text-red-600">
                            ฿{formatMoney(bill?.grandTotal || 0)}
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-slate-500 font-semibold pt-1 border-t border-red-100">
                          <span className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" />
                            {tbl.chairs}
                          </span>
                          <span className="text-orange-600 font-bold flex items-center gap-0.5">
                            Open <ChevronRight className="w-3 h-3" />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            // Specific Zone Floor Plan: Raised 3D Sculpted Tables on Architectural Grid
            <div
              ref={floorPlanRef}
              onMouseMove={handleMouseMoveOnFloorPlan}
              onMouseUp={handleMouseUpOnFloorPlan}
              className="kin-3d-floorplan flex-1 relative w-full h-full overflow-hidden cursor-default"
            >
              {zoneTables.map((tbl) => {
                const isOccupied = !!tbl.currentBillId;
                const isSelected = activeBill?.tableId === tbl.id;

                const shapeClass =
                  tbl.shape === 'round'
                    ? 'rounded-full w-24 h-24'
                    : tbl.shape === 'rectangle'
                    ? 'rounded-2xl w-32 h-20'
                    : 'rounded-2xl w-24 h-24';

                return (
                  <div
                    key={tbl.id}
                    onMouseDown={() => handleMouseDownOnTable(tbl.id)}
                    onClick={() => handleSelectTable(tbl)}
                    style={{ left: `${tbl.x}px`, top: `${tbl.y}px` }}
                    className={`kin-3d-table absolute cursor-move flex flex-col items-center justify-center p-1.5 select-none ${shapeClass} ${
                      isSelected
                        ? 'ring-4 ring-orange-400 bg-orange-50 border-2 border-orange-500 z-20 -translate-y-0.5'
                        : isOccupied
                        ? 'border-2 border-red-500 bg-rose-50/90 text-red-950 shadow-[0_6px_0_#fca5a5,0_14px_24px_-8px_rgba(220,38,38,0.28)]'
                        : 'border-2 border-emerald-600 bg-white text-emerald-950 shadow-[0_6px_0_#cbd5e1,0_12px_20px_-8px_rgba(15,23,42,0.14)]'
                    }`}
                  >
                    <span className="font-black text-base">{tbl.name}</span>
                    <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {tbl.chairs}
                    </span>
                    {isOccupied && (
                      <span className="text-[9px] font-black uppercase text-red-700 bg-red-100 px-1.5 py-0.5 rounded-sm mt-0.5">
                        Occupied
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Side: Active Order Sidebar / Elevated 3D Bill Card */}
        <div className="w-80 sm:w-96 bg-white border-l border-slate-200 flex flex-col shadow-[-8px_0_28px_-12px_rgba(15,23,42,0.12)] z-10">
          {/* Order Header */}
          <div className="p-3.5 bg-slate-50/90 border-b border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-black text-sm text-neutral-900 flex items-center gap-1.5">
                  <Receipt className="w-4 h-4 text-orange-600" />
                  <span>
                    {activeBill?.tableName ? `${activeBill.tableName}` : t.pos.billCard}
                  </span>
                  {activeBill?.billNumber && (
                    <span className="text-xs font-mono font-bold text-neutral-500">
                      ({activeBill.billNumber})
                    </span>
                  )}
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
                  disabled={cartItems.length === 0}
                  onClick={handleInitiateConfirmOrder}
                  className="flex-1 py-2 px-2 bg-orange-100 hover:bg-orange-200 text-orange-900 border border-orange-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40"
                >
                  <Check className="w-3.5 h-3.5 text-orange-600" />
                  <span className="truncate">{t.pos.confirmOrder}</span>
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
      </div>

      {/* Always-Visible Bottom Bar: Permanent "Bill" card + Sculpted 3D Category Cards */}
      <div className="h-[68px] bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 flex items-center gap-2 overflow-x-auto shadow-[0_-6px_20px_-10px_rgba(15,23,42,0.1)] z-30">
        {/* Permanent Bill Card (linked to floor plan) */}
        <button
          onClick={() => setSelectedCategoryId(null)}
          className={`h-12 px-4 rounded-xl flex items-center gap-2 font-black text-xs cursor-pointer transition-all shrink-0 active:translate-y-[1px] ${
            selectedCategoryId === null
              ? 'bg-slate-900 text-white shadow-[0_3px_0_#0f172a,0_8px_16px_-6px_rgba(15,23,42,0.35)] ring-2 ring-orange-500'
              : 'bg-white text-slate-800 hover:bg-slate-50 border border-slate-200 shadow-[0_2px_0_#e2e8f0]'
          }`}
        >
          <Receipt className="w-4 h-4 text-orange-400" />
          <div className="text-left">
            <div className="leading-tight">{t.pos.billCard}</div>
            <div className="text-[10px] text-slate-400 font-semibold">
              {tablesWithSavedOrder.length} Active Orders
            </div>
          </div>
        </button>

        {/* Separator */}
        <div className="h-8 w-px bg-slate-200 shrink-0" />

        {/* Food Category Cards */}
        {categories.map((cat) => {
          const isSelected = selectedCategoryId === cat.id;
          const dishCount = dishes.filter((d) => d.categoryId === cat.id).length;

          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategoryId(cat.id)}
              className={`h-12 px-4 rounded-xl flex items-center gap-2.5 font-bold text-xs cursor-pointer transition-all shrink-0 active:translate-y-[1px] ${
                isSelected
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-[0_3px_0_#c2410c,0_8px_16px_-6px_rgba(234,88,12,0.32)]'
                  : 'bg-white text-slate-800 hover:bg-orange-50/70 border border-slate-200 shadow-[0_2px_0_#e2e8f0]'
              }`}
            >
              <Utensils className={`w-4 h-4 ${isSelected ? 'text-amber-200' : 'text-orange-500'}`} />
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
                        <div className="font-extrabold text-xs text-neutral-900 flex items-center justify-between">
                          <span>{lang === 'th' && v.nameTh ? v.nameTh : v.name}</span>
                          {hasMarkup && (
                            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-200">
                              +{currentChannel.priceMarkupPercent}%
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-black text-orange-600 mt-1">
                          ฿{formatMoney(effectivePrice)}
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

      {/* Table Management / Add Table Modal */}
      {isTableEditorOpen && editingTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <form
            onSubmit={handleSaveTableForm}
            className="bg-white rounded-3xl shadow-2xl max-w-sm w-full border border-orange-200 overflow-hidden"
          >
            <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">
                {editingTable.id ? t.pos.editTable : t.pos.addTable}
              </h3>
              <button
                type="button"
                onClick={() => setIsTableEditorOpen(false)}
                className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.pos.tableName}
                </label>
                <input
                  type="text"
                  required
                  value={editingTable.name || ''}
                  onChange={(e) => setEditingTable({ ...editingTable, name: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder="e.g. T1, Bar 1"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">{t.pos.shape}</label>
                <select
                  value={editingTable.shape || 'square'}
                  onChange={(e) => setEditingTable({ ...editingTable, shape: e.target.value as TableShape })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                >
                  <option value="square">{t.pos.square}</option>
                  <option value="round">{t.pos.round}</option>
                  <option value="rectangle">{t.pos.rectangle}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">{t.pos.chairs}</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={editingTable.chairs || 4}
                  onChange={(e) => setEditingTable({ ...editingTable, chairs: parseInt(e.target.value, 10) || 1 })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">Zone</label>
                <select
                  value={editingTable.zoneId || zones[0]?.id || ''}
                  onChange={(e) => setEditingTable({ ...editingTable, zoneId: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {lang === 'th' && z.nameTh ? z.nameTh : z.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsTableEditorOpen(false)}
                className="px-3 py-1.5 bg-white text-neutral-700 border border-neutral-300 rounded-xl text-xs font-bold cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
              >
                {t.common.save}
              </button>
            </div>
          </form>
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
