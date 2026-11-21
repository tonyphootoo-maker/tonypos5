import React, { useState, useEffect } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import {
  RefreshCw,
  AlertTriangle,
  X,
  ArrowLeft,
  UploadCloud,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import {
  Ingredient,
  Sauce,
  MenuItem,
  RestaurantSettings,
  Supplier,
  ExpenseRecord,
  SaleOrder,
  InventoryItem,
  InventoryTransaction,
  WasteRecord,
  PurchaseRecord,
  PriceHistoryRecord,
  RecipeItem,
  Employee as CostEmployee,
  StockCountSnapshot,
} from './types';
import { convertUnitQuantity } from './services/transactionService';
import {
  DailySalesRecord,
  SalesChannel,
} from './types/domain';
import { StorageService, migrateSettings } from './services/storageService';
import { FirebaseSyncService, COST_COLLECTIONS } from './services/firebaseSyncService';
import { subscribeCollection } from '../data/db';
import { DailySummaryDoc } from '../types';
import {
  calculateIngredientCost,
  recalculateMenusWithChannelMultipliers,
} from './services/calculationEngine';
import {
  resolveVariantBaseSellingPrice,
  resolveVariantTakeawayPrice,
} from './services/spreadsheetCostHelper';
import { upsertDailySalesRecord, normalizeUpsertChannelId } from './engine/calculations';
import { formatPeriodCalculationLabel, normalizeToMonthly } from '../engine/calculations';
import { syncAllCostingToPOS } from './services/posBridge';
import { AppIconService } from './services/appIconService';

import { FoodCostView } from './components/FoodCostView';
import { QuickCostCalculatorView } from './components/QuickCostCalculatorView';
import { RecipeBuilderView } from './components/RecipeBuilderView';
import { IngredientsView } from './components/IngredientsView';
import { PurchasesView } from './components/PurchasesView';
import { InventoryView } from './components/InventoryView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { BreakEvenView } from './components/Financials/BreakEvenView';
import { ExpensesView } from './components/Financials/ExpensesView';
import { SalesEntryView } from './components/Financials/SalesEntryView';
import { ProfitAndLossView } from './components/Financials/ProfitAndLossView';
import { LaborView } from './components/Financials/LaborView';
import { ExecutiveDashboard } from './components/Dashboard/ExecutiveDashboard';
import { AppIconModal } from './components/common/AppIconModal';
import { useLanguage } from '../contexts/LanguageContext';

export type CostingTabId =
  | 'executive_dashboard'
  | 'food_cost'
  | 'food_cost_alacarte'
  | 'quick_calculator'
  | 'recipes'
  | 'sauces'
  | 'ingredients'
  | 'purchases'
  | 'inventory'
  | 'pnl'
  | 'overhead_breakeven'
  | 'expenses'
  | 'labor'
  | 'sales_entry'
  | 'reports'
  | 'settings';

interface CostingWorkspaceProps {
  activeTab: CostingTabId;
  onSelectCostTab: (tab: CostingTabId) => void;
  onNavigateToPos: () => void;
  user: FirebaseUser;
  lang?: 'th' | 'en';
}

const DEFAULT_SALES_CHANNELS: SalesChannel[] = [
  { id: 'dine-in', code: 'DINE_IN', name: 'หน้าร้าน (Dine-in)', commissionPercent: 0, paymentFeePercent: 0, fixedFeePerOrder: 0, packagingFeeSurcharge: 0, taxOnCommissionPercent: 7, active: true },
  { id: 'takeaway', code: 'TAKEAWAY', name: 'สั่งกลับบ้าน (Takeaway)', commissionPercent: 0, paymentFeePercent: 0, fixedFeePerOrder: 0, packagingFeeSurcharge: 0, taxOnCommissionPercent: 7, active: true },
  { id: 'grab', code: 'GRAB', name: 'GrabFood', commissionPercent: 30, paymentFeePercent: 0, fixedFeePerOrder: 0, packagingFeeSurcharge: 0, taxOnCommissionPercent: 7, active: true },
  { id: 'lineman', code: 'LINEMAN', name: 'LINE MAN', commissionPercent: 25, paymentFeePercent: 0, fixedFeePerOrder: 0, packagingFeeSurcharge: 0, taxOnCommissionPercent: 7, active: true },
];

export const CostingWorkspace: React.FC<CostingWorkspaceProps> = ({
  activeTab,
  onSelectCostTab,
  onNavigateToPos,
  user,
  lang: propLang,
}) => {
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const [settings, setSettings] = useState<RestaurantSettings>(() => StorageService.getSettings());
  const [ingredients, setIngredients] = useState<Ingredient[]>(() => StorageService.getIngredients());
  const [sauces, setSauces] = useState<Sauce[]>(() => StorageService.getSauces());
  const [menus, setMenus] = useState<MenuItem[]>(() => StorageService.getMenus());
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => StorageService.getSuppliers());
  const [inventory, setInventory] = useState<InventoryItem[]>(() => StorageService.getInventory());
  const [inventoryTransactions, setInventoryTransactions] = useState<InventoryTransaction[]>(() =>
    StorageService.getInventoryTransactions()
  );
  const [purchases, setPurchases] = useState<PurchaseRecord[]>(() => StorageService.getPurchases());
  const [priceHistory, setPriceHistory] = useState<PriceHistoryRecord[]>(() => StorageService.getPriceHistory());
  const [expenses, setExpenses] = useState<ExpenseRecord[]>(() => StorageService.getExpenses());
  const [salesOrders, setSalesOrders] = useState<SaleOrder[]>(() => StorageService.getSalesOrders());
  const [wasteLog, setWasteLog] = useState<WasteRecord[]>(() => StorageService.getWasteLog());
  const [employees, setEmployees] = useState<CostEmployee[]>(() => StorageService.getEmployees());
  const [dailySales, setDailySales] = useState<DailySalesRecord[]>(() => StorageService.getDailySales());
  const [stockCounts, setStockCounts] = useState<StockCountSnapshot[]>(() => StorageService.getStockCounts());
  const [salesChannels, setSalesChannels] = useState<SalesChannel[]>(DEFAULT_SALES_CHANNELS);

  const [targetRecipeVariantId, setTargetRecipeVariantId] = useState<string>('');
  const [isIconModalOpen, setIsIconModalOpen] = useState<boolean>(false);
  const [isCloudLoading, setIsCloudLoading] = useState<boolean>(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [isPushingToPos, setIsPushingToPos] = useState<boolean>(false);
  const [bridgeFeedback, setBridgeFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sync user-scoped costing collections cleanly in Firestore (users/{uid}/cost*)
  useEffect(() => {
    if (!user?.uid) return;
    let isMounted = true;
    const unsubs: (() => void)[] = [];

    const setupSync = async () => {
      setIsCloudLoading(true);
      setCloudError(null);
      try {
        const hasData = await FirebaseSyncService.hasUserData(user.uid);
        if (!hasData) {
          await FirebaseSyncService.migrateLocalDataToUser(user.uid);
        }
      } catch (err: unknown) {
        console.warn('Costing initial cloud seed check warning:', err);
      }

      if (!isMounted) return;

      unsubs.push(
        FirebaseSyncService.subscribeUserDoc<RestaurantSettings>(
          user.uid,
          COST_COLLECTIONS.SETTINGS,
          'default',
          (cloudSettings) => {
            if (cloudSettings) {
              if (
                settingsSaveTimerRef.current !== null ||
                Date.now() < pendingSettingsSyncUntilRef.current
              ) {
                return;
              }
              const migratedCloud = migrateSettings(cloudSettings);
              setSettings(migratedCloud);
              StorageService.saveSettings(migratedCloud);
              if (
                !cloudSettings.gpMultiplierMigrated &&
                (migratedCloud.grabPriceMultiplier !== cloudSettings.grabPriceMultiplier ||
                  migratedCloud.linemanPriceMultiplier !== cloudSettings.linemanPriceMultiplier)
              ) {
                FirebaseSyncService.saveUserDoc(
                  user.uid,
                  COST_COLLECTIONS.SETTINGS,
                  'default',
                  migratedCloud
                );
              }
            }
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<Ingredient>(
          user.uid,
          COST_COLLECTIONS.INGREDIENTS,
          (items) => {
            const sorted = [...items].sort(
              (a, b) => (a.displayOrder ?? Number.MAX_SAFE_INTEGER) - (b.displayOrder ?? Number.MAX_SAFE_INTEGER)
            );
            setIngredients(sorted);
            StorageService.saveIngredients(sorted);
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<Sauce>(
          user.uid,
          COST_COLLECTIONS.SAUCES,
          (items) => {
            setSauces(items);
            StorageService.saveSauces(items);
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<MenuItem>(
          user.uid,
          COST_COLLECTIONS.MENUS,
          (items) => {
            if (
              menuBatchSaveTimerRef.current !== null ||
              menuSingleSaveTimersRef.current.size > 0 ||
              Date.now() < pendingMenuSyncUntilRef.current
            ) {
              return;
            }
            const sorted = [...items].sort(
              (a, b) => (a.displayOrder ?? Number.MAX_SAFE_INTEGER) - (b.displayOrder ?? Number.MAX_SAFE_INTEGER)
            );
            setMenus(sorted);
            StorageService.saveMenus(sorted);
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<DailySalesRecord>(
          user.uid,
          COST_COLLECTIONS.DAILY_SALES,
          (items) => {
            setDailySales(items);
            StorageService.saveDailySales(items);
          },
          (err) => setCloudError(err.message)
        ),
        // Auto-sync live POS sales summaries into Costing P&L & Executive Dashboard in real time
        subscribeCollection<DailySummaryDoc>(
          'dailySummaries',
          async () => {
            try {
              const res = await FirebaseSyncService.pullDailySales(user.uid);
              if (res.success && isMounted) {
                setDailySales(res.data);
              }
            } catch (err) {
              console.warn('Live POS dailySummaries bridge sync warning:', err);
            }
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<ExpenseRecord>(
          user.uid,
          COST_COLLECTIONS.EXPENSES,
          (items) => {
            setExpenses(items);
            StorageService.saveExpenses(items);
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<CostEmployee>(
          user.uid,
          COST_COLLECTIONS.EMPLOYEES,
          (items) => {
            setEmployees(items);
            StorageService.saveEmployees(items);
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<PurchaseRecord>(
          user.uid,
          COST_COLLECTIONS.PURCHASES,
          (items) => {
            setPurchases(items);
            StorageService.savePurchases(items);
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<InventoryItem>(
          user.uid,
          COST_COLLECTIONS.INVENTORY,
          (items) => {
            setInventory(items);
            StorageService.saveInventory(items);
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<WasteRecord>(
          user.uid,
          COST_COLLECTIONS.WASTE_LOG,
          (items) => {
            setWasteLog(items);
            StorageService.saveWasteLog(items);
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<Supplier>(
          user.uid,
          COST_COLLECTIONS.SUPPLIERS,
          (items) => {
            setSuppliers(items);
            StorageService.saveSuppliers(items);
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<PriceHistoryRecord>(
          user.uid,
          COST_COLLECTIONS.PRICE_HISTORY,
          (items) => {
            setPriceHistory(items);
            StorageService.savePriceHistory(items);
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<SaleOrder>(
          user.uid,
          COST_COLLECTIONS.SALES_ORDERS,
          (items) => {
            setSalesOrders(items);
            StorageService.saveSalesOrders(items);
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<StockCountSnapshot>(
          user.uid,
          COST_COLLECTIONS.STOCK_COUNTS,
          (items) => {
            setStockCounts(items);
            StorageService.saveStockCounts(items);
          },
          (err) => setCloudError(err.message)
        )
      );

      setIsCloudLoading(false);
    };

    setupSync();
    return () => {
      isMounted = false;
      unsubs.forEach((u) => u());
    };
  }, [user?.uid]);

  useEffect(() => {
    AppIconService.applyIconToDocument(
      AppIconService.getCurrentIcon(),
      AppIconService.getCurrentThemeColor()
    );
  }, []);

  // Persist local cache changes automatically
  useEffect(() => { StorageService.saveSettings(settings); }, [settings]);
  useEffect(() => { StorageService.saveIngredients(ingredients); }, [ingredients]);
  useEffect(() => { StorageService.saveSauces(sauces); }, [sauces]);
  useEffect(() => { StorageService.saveMenus(menus); }, [menus]);
  useEffect(() => { StorageService.saveSuppliers(suppliers); }, [suppliers]);
  useEffect(() => { StorageService.saveInventory(inventory); }, [inventory]);
  useEffect(() => { StorageService.saveInventoryTransactions(inventoryTransactions); }, [inventoryTransactions]);
  useEffect(() => { StorageService.savePurchases(purchases); }, [purchases]);
  useEffect(() => { StorageService.savePriceHistory(priceHistory); }, [priceHistory]);
  useEffect(() => { StorageService.saveExpenses(expenses); }, [expenses]);
  useEffect(() => { StorageService.saveSalesOrders(salesOrders); }, [salesOrders]);
  useEffect(() => { StorageService.saveWasteLog(wasteLog); }, [wasteLog]);
  useEffect(() => { StorageService.saveEmployees(employees); }, [employees]);
  useEffect(() => { StorageService.saveDailySales(dailySales); }, [dailySales]);
  useEffect(() => { StorageService.saveStockCounts(stockCounts); }, [stockCounts]);

  const menuNamesMap = new Map<string, string>();
  menus.forEach((m) => {
    m.variants.forEach((v) => {
      menuNamesMap.set(v.id, m.name);
    });
  });
  const allVariants = menus.flatMap((m) => m.variants);

  // Handlers
  const handleSaveIngredient = (ingredient: Ingredient) => {
    const existingIndex = ingredients.findIndex((i) => i.id === ingredient.id);
    const minOrder = ingredients.reduce(
      (min, item, idx) => Math.min(min, item.displayOrder ?? idx + 1),
      1
    );
    const normalizedIngredient: Ingredient = {
      ...ingredient,
      displayOrder:
        ingredient.displayOrder ??
        (existingIndex >= 0
          ? ingredients[existingIndex].displayOrder ?? existingIndex + 1
          : minOrder - 1),
    };
    const updated =
      existingIndex >= 0
        ? ingredients.map((i, idx) => (idx === existingIndex ? normalizedIngredient : i))
        : [normalizedIngredient, ...ingredients];
    setIngredients(updated);
    FirebaseSyncService.saveUserDoc(
      user.uid,
      COST_COLLECTIONS.INGREDIENTS,
      normalizedIngredient.id,
      normalizedIngredient
    );

    const invIndex = inventory.findIndex((inv) => inv.ingredientId === ingredient.id);
    if (invIndex === -1) {
      const newInv: InventoryItem = {
        id: `inv_${Date.now()}`,
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        currentStock: ingredient.purchaseQuantity,
        unit: ingredient.usageUnit,
        minStock: Math.round(ingredient.purchaseQuantity * 0.2),
        maxStock: ingredient.purchaseQuantity * 2,
        costPerUnit: ingredient.costPerBaseUnit,
        lastUpdated: new Date().toISOString(),
      };
      const nextInv = [...inventory, newInv];
      setInventory(nextInv);
      FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.INVENTORY, newInv.id || newInv.ingredientId, newInv);
    }
  };

  const handleDeleteIngredient = (ingredientId: string) => {
    setIngredients((prev) => prev.filter((i) => i.id !== ingredientId));
    setInventory((prev) => prev.filter((inv) => inv.ingredientId !== ingredientId));
    FirebaseSyncService.deleteUserDoc(user.uid, COST_COLLECTIONS.INGREDIENTS, ingredientId);
  };

  const handleReorderIngredients = (reordered: Ingredient[]) => {
    const orderedWithIndex = reordered.map((item, idx) => ({
      ...item,
      displayOrder: idx + 1,
    }));
    setIngredients(orderedWithIndex);
    FirebaseSyncService.batchSaveUser(user.uid, COST_COLLECTIONS.INGREDIENTS, orderedWithIndex);
  };

  const handleRecordPriceChange = (record: PriceHistoryRecord) => {
    setPriceHistory((prev) => [record, ...prev]);
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.PRICE_HISTORY, record.id, record);
  };

  const handleSaveSauce = (sauce: Sauce) => {
    setSauces((prev) => {
      const exists = prev.some((s) => s.id === sauce.id);
      return exists ? prev.map((s) => (s.id === sauce.id ? sauce : s)) : [...prev, sauce];
    });
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.SAUCES, sauce.id, sauce);
  };

  const menuBatchSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuSingleSaveTimersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingMenuSyncUntilRef = React.useRef<number>(0);
  const settingsSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettingsSyncUntilRef = React.useRef<number>(0);

  useEffect(() => {
    return () => {
      if (menuBatchSaveTimerRef.current) {
        clearTimeout(menuBatchSaveTimerRef.current);
      }
      menuSingleSaveTimersRef.current.forEach((timer) => clearTimeout(timer));
      menuSingleSaveTimersRef.current.clear();
      if (settingsSaveTimerRef.current) {
        clearTimeout(settingsSaveTimerRef.current);
      }
    };
  }, []);

  const handleSaveMenu = (menu: MenuItem) => {
    pendingMenuSyncUntilRef.current = Date.now() + 1500;
    setMenus((prev) => {
      const exists = prev.some((m) => m.id === menu.id);
      const next = exists ? prev.map((m) => (m.id === menu.id ? menu : m)) : [...prev, menu];
      StorageService.saveMenus(next);
      return next;
    });
    const prevTimer = menuSingleSaveTimersRef.current.get(menu.id);
    if (prevTimer) {
      clearTimeout(prevTimer);
    }
    const timer = setTimeout(() => {
      menuSingleSaveTimersRef.current.delete(menu.id);
      pendingMenuSyncUntilRef.current = Date.now() + 1200;
      FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.MENUS, menu.id, menu);
    }, 250);
    menuSingleSaveTimersRef.current.set(menu.id, timer);
  };

  const handleBatchUpdateMenus = (updatedMenus: MenuItem[]) => {
    pendingMenuSyncUntilRef.current = Date.now() + 1500;
    setMenus(updatedMenus);
    StorageService.saveMenus(updatedMenus);
    if (menuBatchSaveTimerRef.current) {
      clearTimeout(menuBatchSaveTimerRef.current);
    }
    menuBatchSaveTimerRef.current = setTimeout(() => {
      menuBatchSaveTimerRef.current = null;
      pendingMenuSyncUntilRef.current = Date.now() + 1200;
      FirebaseSyncService.batchSaveUser(user.uid, COST_COLLECTIONS.MENUS, updatedMenus);
    }, 300);
  };

  const handleDeleteMenu = (menuId: string) => {
    setMenus((prev) => prev.filter((m) => m.id !== menuId));
    FirebaseSyncService.deleteUserDoc(user.uid, COST_COLLECTIONS.MENUS, menuId);
  };

  const handleReorderMenus = (reordered: MenuItem[]) => {
    const orderedWithIndex = reordered.map((item, idx) => ({
      ...item,
      displayOrder: idx + 1,
    }));
    setMenus(orderedWithIndex);
    FirebaseSyncService.batchSaveUser(user.uid, COST_COLLECTIONS.MENUS, orderedWithIndex);
  };

  const handleUpdateVariantPrice = (
    menuId: string,
    variantId: string,
    prices: { sellingPrice: number; takeawayPrice: number; deliveryPrice: number }
  ) => {
    let targetMenu: MenuItem | undefined;
    setMenus((prev) =>
      prev.map((m) => {
        if (m.id !== menuId) return m;
        const mUpdated = {
          ...m,
          variants: m.variants.map((v) =>
            v.id === variantId
              ? {
                  ...v,
                  sellingPrice: prices.sellingPrice,
                  takeawayPrice: prices.takeawayPrice,
                  deliveryPrice: prices.deliveryPrice,
                }
              : v
          ),
        };
        targetMenu = mUpdated;
        return mUpdated;
      })
    );
    if (targetMenu) {
      FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.MENUS, targetMenu.id, targetMenu);
    }
  };

  const handleSaveVariantRecipe = (menuId: string, variantId: string, recipeItems: RecipeItem[]) => {
    let targetMenu: MenuItem | undefined;
    setMenus((prev) =>
      prev.map((m) => {
        if (m.id !== menuId) return m;
        const mUpdated = {
          ...m,
          variants: m.variants.map((v) => (v.id === variantId ? { ...v, recipeItems } : v)),
        };
        targetMenu = mUpdated;
        return mUpdated;
      })
    );
    if (targetMenu) {
      FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.MENUS, targetMenu.id, targetMenu);
    }
  };

  const handleSavePurchase = (purchase: PurchaseRecord) => {
    const ing = ingredients.find((i) => i.id === purchase.ingredientId);
    const enrichedPurchase: PurchaseRecord = {
      ...purchase,
      category: purchase.category || ing?.category,
      isPackaging:
        purchase.isPackaging ??
        Boolean(ing?.category && (ing.category.toLowerCase().includes('packaging') || ing.category.includes('บรรจุภัณฑ์'))),
    };
    setPurchases((prev) => [enrichedPurchase, ...prev]);
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.PURCHASES, enrichedPurchase.id, enrichedPurchase);

    const item = inventory.find((i) => i.ingredientId === purchase.ingredientId);
    if (item) {
      const convertedQty = convertUnitQuantity(purchase.quantity, purchase.unit, item.unit);
      const updatedStock = item.currentStock + convertedQty;
      const updatedInvItem = { ...item, currentStock: updatedStock, lastUpdated: new Date().toISOString() };
      setInventory((prev) => prev.map((inv) => (inv.id === item.id ? updatedInvItem : inv)));
      FirebaseSyncService.saveUserDoc(
        user.uid,
        COST_COLLECTIONS.INVENTORY,
        updatedInvItem.id || updatedInvItem.ingredientId,
        updatedInvItem
      );

      const txn: InventoryTransaction = {
        id: `txn_${Date.now()}`,
        inventoryItemId: item.id,
        ingredientId: purchase.ingredientId,
        ingredientName: purchase.ingredientName,
        type: 'PURCHASE',
        quantity: convertedQty,
        quantityChange: convertedQty,
        resultingQuantity: updatedStock,
        unit: item.unit,
        date: purchase.date,
        reason: lang === 'th'
          ? `บิลซื้อเลขที่ ${purchase.invoiceNumber || '-'}`
          : `Purchase Invoice #${purchase.invoiceNumber || '-'}`,
        user: user.email || (lang === 'en' ? 'Owner' : 'เจ้าของร้าน'),
        cost: purchase.totalPrice,
      };
      setInventoryTransactions((prev) => [txn, ...prev]);
    }
  };

  const handleSaveExpense = (expense: ExpenseRecord) => {
    setExpenses((prev) => [expense, ...prev]);
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.EXPENSES, expense.id, expense);
  };

  const handleDeleteExpense = (id: string) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    FirebaseSyncService.deleteUserDoc(user.uid, COST_COLLECTIONS.EXPENSES, id);
  };

  const handleUpdateExpense = (updatedExp: ExpenseRecord) => {
    setExpenses((prev) => prev.map((e) => (e.id === updatedExp.id ? updatedExp : e)));
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.EXPENSES, updatedExp.id, updatedExp);
  };

  const handleAddDailySalesRecord = (rec: DailySalesRecord, replacedPosRecordId?: string) => {
    const cleanedCurrent = replacedPosRecordId
      ? dailySales.filter((s) => s.id !== replacedPosRecordId)
      : dailySales;
    const nextCurrent = upsertDailySalesRecord(cleanedCurrent, rec);
    const targetCh = normalizeUpsertChannelId(rec.channelId);
    const savedRecord =
      nextCurrent.find(
        (r) => r.date === rec.date && normalizeUpsertChannelId(r.channelId) === targetCh
      ) || rec;

    setDailySales((prev) => {
      const cleaned = replacedPosRecordId
        ? prev.filter((s) => s.id !== replacedPosRecordId)
        : prev;
      return upsertDailySalesRecord(cleaned, rec);
    });
    if (replacedPosRecordId) {
      FirebaseSyncService.deleteUserDoc(user.uid, COST_COLLECTIONS.DAILY_SALES, replacedPosRecordId);
    }
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.DAILY_SALES, savedRecord.id, savedRecord);
  };

  const handleDeleteDailySalesRecord = (id: string) => {
    setDailySales((prev) => prev.filter((s) => s.id !== id));
    FirebaseSyncService.deleteUserDoc(user.uid, COST_COLLECTIONS.DAILY_SALES, id);
  };

  const handleAddEmployee = (newEmp: CostEmployee) => {
    setEmployees((prev) => [newEmp, ...prev]);
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.EMPLOYEES, newEmp.id, newEmp);
  };

  const handleDeleteEmployee = (id: string) => {
    setEmployees((prev) => prev.filter((e) => e.id !== id));
    FirebaseSyncService.deleteUserDoc(user.uid, COST_COLLECTIONS.EMPLOYEES, id);
  };

  const handleSaveSettings = (newSettings: RestaurantSettings, syncMenuPrices = false) => {
    const normalizedSettings = migrateSettings(newSettings);
    const multipliersChanged =
      normalizedSettings.grabPriceMultiplier !== settings.grabPriceMultiplier ||
      normalizedSettings.linemanPriceMultiplier !== settings.linemanPriceMultiplier ||
      normalizedSettings.robinhoodPriceMultiplier !== settings.robinhoodPriceMultiplier;

    pendingSettingsSyncUntilRef.current = Date.now() + 1500;
    setSettings(normalizedSettings);
    StorageService.saveSettings(normalizedSettings);
    if (settingsSaveTimerRef.current) {
      clearTimeout(settingsSaveTimerRef.current);
    }
    settingsSaveTimerRef.current = setTimeout(() => {
      settingsSaveTimerRef.current = null;
      pendingSettingsSyncUntilRef.current = Date.now() + 1200;
      FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.SETTINGS, 'default', normalizedSettings);
    }, 250);

    if (syncMenuPrices && multipliersChanged && menus.length > 0) {
      const updatedMenus = recalculateMenusWithChannelMultipliers(menus, normalizedSettings, {
        resolveBaseSellingPrice: resolveVariantBaseSellingPrice,
        resolveBaseTakeawayPrice: resolveVariantTakeawayPrice,
      });
      handleBatchUpdateMenus(updatedMenus);
    }
  };

  const handleReloadAllData = () => {
    StorageService.resetToDefaults();
    setSettings(StorageService.getSettings());
    setIngredients(StorageService.getIngredients());
    setSauces(StorageService.getSauces());
    setMenus(StorageService.getMenus());
    setSuppliers(StorageService.getSuppliers());
    setInventory(StorageService.getInventory());
    setInventoryTransactions(StorageService.getInventoryTransactions());
    setPurchases(StorageService.getPurchases());
    setPriceHistory(StorageService.getPriceHistory());
    setExpenses(StorageService.getExpenses());
    setSalesOrders(StorageService.getSalesOrders());
    setWasteLog(StorageService.getWasteLog());
    setEmployees(StorageService.getEmployees());
    setDailySales(StorageService.getDailySales());
    setStockCounts(StorageService.getStockCounts());
  };

  const handleNavigateToRecipeBuilder = (variantId: string) => {
    setTargetRecipeVariantId(variantId);
    onSelectCostTab('recipes');
  };

  // Live bridge: push all edited Food Cost menus, ingredients & sauces into KinPOS active POS
  const handlePushMenuToPOS = async () => {
    if (menus.length === 0 && ingredients.length === 0) return;

    setIsPushingToPos(true);
    setBridgeFeedback(null);
    try {
      const result = await syncAllCostingToPOS(menus, ingredients, sauces);
      setBridgeFeedback({
        type: 'success',
        text:
          lang === 'th'
            ? `อัปเดตข้อมูลเข้า POS เรียบร้อย! (เมนู ${result.syncedMenusCount} รายการ, วัตถุดิบ ${result.updatedIngredientsCount} รายการ)`
            : `Updated all costing data to POS! (${result.syncedMenusCount} menus, ${result.updatedIngredientsCount} ingredients)`,
      });
    } catch (err: unknown) {
      setBridgeFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsPushingToPos(false);
      setTimeout(() => setBridgeFeedback(null), 5000);
    }
  };

  // Keep unused calculateIngredientCost imported cleanly without compiler warning
  void calculateIngredientCost;

  return (
    <div className="tonycost-workspace min-h-full flex flex-col">
      {/* Unified Costing <-> POS Bridge Toolbar */}
      <div className="border-b border-[#EAE4D9] bg-[#FFFDF9] px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onNavigateToPos}
            className="px-3 py-1.5 rounded-xl bg-white hover:bg-orange-50 text-stone-800 border border-[#EAE4D9] text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-orange-600" />
            <span>{lang === 'th' ? 'กลับหน้า POS ขายหน้าร้าน' : 'Back to POS'}</span>
          </button>
        </div>

        {/* Single Push All Updated Costing & Menus straight to KinPOS POS */}
        {(menus.length > 0 || ingredients.length > 0) && (
          <button
            type="button"
            onClick={handlePushMenuToPOS}
            disabled={isPushingToPos}
            className="px-3.5 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60 whitespace-nowrap"
          >
            {isPushingToPos ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <UploadCloud className="w-3.5 h-3.5" />
            )}
            <span>{lang === 'th' ? 'ส่งเมนูนี้เข้า POS' : 'Push Menu to POS'}</span>
          </button>
        )}
      </div>

      {/* Sync / Feedback Banners */}
      {isCloudLoading && (
        <div className="bg-sky-50 border-b border-sky-200 px-4 sm:px-6 py-2 text-sky-800 text-xs flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-sky-600 animate-spin shrink-0" />
          <span>{lang === 'th' ? 'กำลังซิงค์ข้อมูลต้นทุนกับ Firebase Cloud...' : 'Syncing costing data with Cloud Firestore...'}</span>
        </div>
      )}

      {cloudError && (
        <div className="bg-rose-50 border-b border-rose-200 px-4 sm:px-6 py-2 text-rose-800 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{cloudError}</span>
          </div>
          <button onClick={() => setCloudError(null)} className="text-rose-600 hover:text-rose-900 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {bridgeFeedback && (
        <div
          className={`border-b px-4 sm:px-6 py-2 text-xs font-bold flex items-center justify-between gap-2 ${
            bridgeFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {bridgeFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{bridgeFeedback.text}</span>
          </div>
          <button onClick={() => setBridgeFeedback(null)} className="cursor-pointer opacity-70 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Costing View */}
      <div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6 flex-1 min-w-0 overflow-x-hidden">
        {activeTab === 'food_cost' && (
          <FoodCostView
            menus={menus}
            ingredients={ingredients}
            sauces={sauces}
            settings={settings}
            lang={lang}
            initialServingMode="ON_RICE"
            onSaveMenu={handleSaveMenu}
            onBatchUpdateMenus={handleBatchUpdateMenus}
            onDeleteMenu={handleDeleteMenu}
            onReorderMenus={handleReorderMenus}
            onUpdateVariantPrice={handleUpdateVariantPrice}
            onSaveSettings={handleSaveSettings}
            onNavigateToRecipeBuilder={handleNavigateToRecipeBuilder}
          />
        )}

        {activeTab === 'food_cost_alacarte' && (
          <FoodCostView
            menus={menus}
            ingredients={ingredients}
            sauces={sauces}
            settings={settings}
            lang={lang}
            initialServingMode="A_LA_CARTE"
            onSaveMenu={handleSaveMenu}
            onBatchUpdateMenus={handleBatchUpdateMenus}
            onDeleteMenu={handleDeleteMenu}
            onReorderMenus={handleReorderMenus}
            onUpdateVariantPrice={handleUpdateVariantPrice}
            onSaveSettings={handleSaveSettings}
            onNavigateToRecipeBuilder={handleNavigateToRecipeBuilder}
          />
        )}

        {activeTab === 'quick_calculator' && (
          <QuickCostCalculatorView
            ingredients={ingredients}
            sauces={sauces}
            settings={settings}
            lang={lang}
            onSaveSettings={handleSaveSettings}
            onSaveNewMenu={(newMenu) => {
              handleSaveMenu(newMenu);
            }}
            onNavigateToTab={(tabId) => onSelectCostTab(tabId as CostingTabId)}
          />
        )}

        {(activeTab === 'recipes' || activeTab === 'sauces') && (
          <RecipeBuilderView
            menus={menus}
            ingredients={ingredients}
            sauces={sauces}
            settings={settings}
            lang={lang}
            initialVariantId={targetRecipeVariantId}
            initialTab={activeTab === 'sauces' ? 'SAUCE' : 'FOOD'}
            onSaveVariantRecipe={handleSaveVariantRecipe}
            onSaveSauce={handleSaveSauce}
            onSaveMenu={handleSaveMenu}
          />
        )}

        {activeTab === 'ingredients' && (
          <IngredientsView
            ingredients={ingredients}
            sauces={sauces}
            variants={allVariants}
            menuNamesMap={menuNamesMap}
            settings={settings}
            priceHistory={priceHistory}
            lang={lang}
            onSaveIngredient={handleSaveIngredient}
            onDeleteIngredient={handleDeleteIngredient}
            onReorderIngredients={handleReorderIngredients}
            onRecordPriceChange={handleRecordPriceChange}
          />
        )}

        {activeTab === 'overhead_breakeven' && (() => {
          const latestDate = dailySales.length > 0
            ? [...dailySales].sort((a, b) => b.date.localeCompare(a.date))[0]?.date
            : null;
          const targetMonth = (latestDate || new Date().toISOString().slice(0, 10)).slice(0, 7);
          const monthSales = dailySales.filter((s) => s.date && s.date.startsWith(targetMonth));
          const monthNetSales = monthSales.reduce((sum, s) => {
            if (typeof s.netSales === 'number' && Number.isFinite(s.netSales)) {
              return sum + Math.max(0, s.netSales);
            }
            const nominal = Math.max(0, (s.grossSales || 0) - (s.discounts || 0) - (s.refunds || 0));
            const vatPct = s.vatRatePercent ?? 7;
            return sum + (s.isVatInclusive && vatPct > 0 ? nominal / (1 + vatPct / 100) : nominal);
          }, 0);
          return (
            <BreakEvenView
              expenses={expenses}
              employees={employees}
              sales={monthSales}
              settings={settings}
              activeLanguage={lang}
              period="month"
              dateParam={targetMonth}
              normalizedMonthlyNetSales={normalizeToMonthly(monthNetSales, 'month', 1, targetMonth)}
              periodSalesLabel={formatPeriodCalculationLabel('month', targetMonth, lang)}
              socialSecurityEnabled={Boolean(settings.socialSecurityEnabled)}
              socialSecurityRatePercent={settings.socialSecurityRatePercent ?? 5}
              socialSecurityCapWage={settings.socialSecurityCapWage ?? 15000}
            />
          );
        })()}

        {activeTab === 'expenses' && (
          <ExpensesView
            expenses={expenses}
            onAddExpense={handleSaveExpense}
            onDeleteExpense={handleDeleteExpense}
            onUpdateExpense={handleUpdateExpense}
            operatingDays={settings.operatingDaysPerMonth || 26}
            activeLanguage={lang}
            employeesCount={employees.length}
          />
        )}

        {activeTab === 'sales_entry' && (
          <SalesEntryView
            sales={dailySales}
            channels={salesChannels.map((ch) => ({
              ...ch,
              name:
                lang === 'en'
                  ? ch.code === 'DINE_IN'
                    ? 'Dine-in'
                    : ch.code === 'TAKEAWAY'
                    ? 'Takeaway'
                    : ch.name
                  : ch.name,
            }))}
            onAddSalesRecord={handleAddDailySalesRecord}
            onDeleteSalesRecord={handleDeleteDailySalesRecord}
            onUpdateChannels={setSalesChannels}
            defaultVatRate={
              typeof settings.vatRatePercent === 'number' && Number.isFinite(settings.vatRatePercent)
                ? settings.vatRatePercent
                : 7
            }
            activeLanguage={lang}
          />
        )}

        {activeTab === 'executive_dashboard' && (
          <ExecutiveDashboard
            ingredients={ingredients}
            sales={dailySales}
            expenses={expenses}
            employees={employees}
            menuItems={menus}
            inventory={inventory}
            allWaste={wasteLog}
            purchases={purchases}
            stockCounts={stockCounts}
            salesOrders={salesOrders}
            channels={salesChannels.map((ch) => ({
              ...ch,
              name:
                lang === 'en'
                  ? ch.code === 'DINE_IN'
                    ? 'Dine-in'
                    : ch.code === 'TAKEAWAY'
                    ? 'Takeaway'
                    : ch.name
                  : ch.name,
            }))}
            currentSettings={settings}
            activeLanguage={lang}
            onNavigate={(tabId) => {
              const aliasMap: Record<string, CostingTabId> = {
                scenario_calculator: 'quick_calculator',
                menu_costing: 'food_cost',
                sales_channels: 'settings',
              };
              onSelectCostTab(aliasMap[tabId] || (tabId as CostingTabId));
            }}
            onNavigateToTab={(tabId) => {
              const aliasMap: Record<string, CostingTabId> = {
                scenario_calculator: 'quick_calculator',
                menu_costing: 'food_cost',
                sales_channels: 'settings',
              };
              onSelectCostTab(aliasMap[tabId] || (tabId as CostingTabId));
            }}
            onSalesUpdated={(updatedSales) => setDailySales(updatedSales)}
          />
        )}

        {activeTab === 'pnl' && (
          <ProfitAndLossView
            sales={dailySales}
            expenses={expenses}
            employees={employees}
            settings={settings}
            ingredients={ingredients}
            purchases={purchases}
            wasteLog={wasteLog}
            stockCounts={stockCounts}
            salesOrders={salesOrders}
            activeLanguage={lang}
            onSalesUpdated={(updatedSales) => setDailySales(updatedSales)}
          />
        )}

        {activeTab === 'labor' && (() => {
          const latestDate = dailySales.length > 0
            ? [...dailySales].sort((a, b) => b.date.localeCompare(a.date))[0]?.date
            : null;
          const targetMonth = (latestDate || new Date().toISOString().slice(0, 10)).slice(0, 7);
          const monthSales = dailySales.filter((s) => s.date && s.date.startsWith(targetMonth));
          const monthNetSales = monthSales.reduce((sum, s) => {
            if (typeof s.netSales === 'number' && Number.isFinite(s.netSales)) {
              return sum + Math.max(0, s.netSales);
            }
            const nominal = Math.max(0, (s.grossSales || 0) - (s.discounts || 0) - (s.refunds || 0));
            const vatPct = s.vatRatePercent ?? 7;
            return sum + (s.isVatInclusive && vatPct > 0 ? nominal / (1 + vatPct / 100) : nominal);
          }, 0);
          return (
            <LaborView
              employees={employees}
              monthlyNetSales={monthNetSales}
              onAddEmployee={handleAddEmployee}
              onDeleteEmployee={handleDeleteEmployee}
              activeLanguage={lang}
              period="month"
              dateParam={targetMonth}
              periodSalesLabel={formatPeriodCalculationLabel('month', targetMonth, lang)}
              socialSecurityEnabled={Boolean(settings.socialSecurityEnabled)}
              socialSecurityRatePercent={settings.socialSecurityRatePercent ?? 5}
              socialSecurityCapWage={settings.socialSecurityCapWage ?? 15000}
            />
          );
        })()}

        {activeTab === 'inventory' && (
          <InventoryView
            inventory={inventory}
            ingredients={ingredients}
            transactions={inventoryTransactions}
            wasteLog={wasteLog}
            stockCounts={stockCounts}
            lang={lang}
            onSaveStockCount={(snapshot, adjustments) => {
              setStockCounts((prev) => [snapshot, ...prev]);
              FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.STOCK_COUNTS, snapshot.id, snapshot);

              if (snapshot.items && snapshot.items.length > 0) {
                const byIng = new Map(snapshot.items.map((it) => [it.ingredientId, it]));
                const nextInv = inventory.map((item) => {
                  const counted = byIng.get(item.ingredientId);
                  if (!counted) return item;
                  return {
                    ...item,
                    currentStock: counted.countedQty,
                    currentQuantity: counted.countedQty,
                    costPerUnit: counted.costPerUnit > 0 ? counted.costPerUnit : item.costPerUnit,
                    lastUpdated: new Date().toISOString(),
                  };
                });
                setInventory(nextInv);
                FirebaseSyncService.batchSaveUser(user.uid, COST_COLLECTIONS.INVENTORY, nextInv);
              }
              if (adjustments.length > 0) {
                setInventoryTransactions((prev) => [...adjustments, ...prev]);
              }
            }}
            onSaveAdjustment={(txn, waste) => {
              setInventoryTransactions((prev) => [txn, ...prev]);
              const rawQty = txn.quantityChange ?? txn.quantity ?? 0;
              const delta = txn.type === 'WASTE' ? -Math.abs(rawQty) : rawQty;
              const nextInv = inventory.map((item) =>
                (txn.inventoryItemId && item.id === txn.inventoryItemId) || item.ingredientId === txn.ingredientId
                  ? {
                      ...item,
                      currentStock: Math.max(0, item.currentStock + delta),
                      lastUpdated: new Date().toISOString(),
                    }
                  : item
              );
              setInventory(nextInv);
              const changed = nextInv.find(
                (i) => (txn.inventoryItemId && i.id === txn.inventoryItemId) || i.ingredientId === txn.ingredientId
              );
              if (changed) {
                FirebaseSyncService.saveUserDoc(
                  user.uid,
                  COST_COLLECTIONS.INVENTORY,
                  changed.id || changed.ingredientId,
                  changed
                );
              }
              if (waste) {
                setWasteLog((prev) => [waste, ...prev]);
                FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.WASTE_LOG, waste.id, waste);
              }
            }}
          />
        )}

        {activeTab === 'purchases' && (
          <PurchasesView
            ingredients={ingredients}
            suppliers={suppliers}
            purchases={purchases}
            priceHistory={priceHistory}
            settings={settings}
            lang={lang}
            onSavePurchase={handleSavePurchase}
            onUpdateIngredientPrice={(id, price) =>
              setIngredients((prev) => prev.map((i) => (i.id === id ? { ...i, purchasePrice: price } : i)))
            }
            onRecordPriceChange={handleRecordPriceChange}
          />
        )}

        {activeTab === 'reports' && (
          <ReportsView
            ingredients={ingredients}
            sauces={sauces}
            menus={menus}
            expenses={expenses}
            salesOrders={salesOrders}
            settings={settings}
            lang={lang}
            onIngredientsImported={(newIngredients) => {
              setIngredients(newIngredients);
              FirebaseSyncService.batchSaveUser(user.uid, COST_COLLECTIONS.INGREDIENTS, newIngredients);
            }}
            onEditIngredient={(ing) => handleSaveIngredient(ing)}
            onResetDefaults={handleReloadAllData}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            settings={settings}
            lang={lang}
            onSaveSettings={(updated) => handleSaveSettings(updated, true)}
            onOpenIconModal={() => setIsIconModalOpen(true)}
          />
        )}
      </div>

      {/* App Icon Customizer Modal */}
      <AppIconModal isOpen={isIconModalOpen} onClose={() => setIsIconModalOpen(false)} lang={lang} />
    </div>
  );
};
