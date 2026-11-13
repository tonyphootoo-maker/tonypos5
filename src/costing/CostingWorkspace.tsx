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
} from './types';
import {
  DailySalesRecord,
  SalesChannel,
} from './types/domain';
import { StorageService } from './services/storageService';
import { FirebaseSyncService, COST_COLLECTIONS } from './services/firebaseSyncService';
import { calculateIngredientCost } from './services/calculationEngine';
import { upsertDailySalesRecord } from './engine/calculations';
import { syncCostingMenuToPOS } from './services/posBridge';
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
  lang: 'th' | 'en';
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
  lang,
}) => {
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

  const [targetRecipeVariantId, setTargetRecipeVariantId] = useState<string>('');
  const [isIconModalOpen, setIsIconModalOpen] = useState<boolean>(false);
  const [isCloudLoading, setIsCloudLoading] = useState<boolean>(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [isSyncingPosSales, setIsSyncingPosSales] = useState<boolean>(false);
  const [selectedSyncMenuId, setSelectedSyncMenuId] = useState<string>('');
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
              setSettings(cloudSettings);
              StorageService.saveSettings(cloudSettings);
            }
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<Ingredient>(
          user.uid,
          COST_COLLECTIONS.INGREDIENTS,
          (items) => {
            if (items.length > 0) {
              setIngredients(items);
              StorageService.saveIngredients(items);
            }
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<Sauce>(
          user.uid,
          COST_COLLECTIONS.SAUCES,
          (items) => {
            if (items.length > 0) {
              setSauces(items);
              StorageService.saveSauces(items);
            }
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<MenuItem>(
          user.uid,
          COST_COLLECTIONS.MENUS,
          (items) => {
            if (items.length > 0) {
              setMenus(items);
              StorageService.saveMenus(items);
            }
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<DailySalesRecord>(
          user.uid,
          COST_COLLECTIONS.DAILY_SALES,
          (items) => {
            if (items.length > 0) {
              setDailySales(items);
              StorageService.saveDailySales(items);
            }
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<ExpenseRecord>(
          user.uid,
          COST_COLLECTIONS.EXPENSES,
          (items) => {
            if (items.length > 0) {
              setExpenses(items);
              StorageService.saveExpenses(items);
            }
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<CostEmployee>(
          user.uid,
          COST_COLLECTIONS.EMPLOYEES,
          (items) => {
            if (items.length > 0) {
              setEmployees(items);
              StorageService.saveEmployees(items);
            }
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<PurchaseRecord>(
          user.uid,
          COST_COLLECTIONS.PURCHASES,
          (items) => {
            if (items.length > 0) {
              setPurchases(items);
              StorageService.savePurchases(items);
            }
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<InventoryItem>(
          user.uid,
          COST_COLLECTIONS.INVENTORY,
          (items) => {
            if (items.length > 0) {
              setInventory(items);
              StorageService.saveInventory(items);
            }
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<WasteRecord>(
          user.uid,
          COST_COLLECTIONS.WASTE_LOG,
          (items) => {
            if (items.length > 0) {
              setWasteLog(items);
              StorageService.saveWasteLog(items);
            }
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<Supplier>(
          user.uid,
          COST_COLLECTIONS.SUPPLIERS,
          (items) => {
            if (items.length > 0) {
              setSuppliers(items);
              StorageService.saveSuppliers(items);
            }
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<PriceHistoryRecord>(
          user.uid,
          COST_COLLECTIONS.PRICE_HISTORY,
          (items) => {
            if (items.length > 0) {
              setPriceHistory(items);
              StorageService.savePriceHistory(items);
            }
          },
          (err) => setCloudError(err.message)
        ),
        FirebaseSyncService.subscribeUserCollection<SaleOrder>(
          user.uid,
          COST_COLLECTIONS.SALES_ORDERS,
          (items) => {
            if (items.length > 0) {
              setSalesOrders(items);
              StorageService.saveSalesOrders(items);
            }
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
  useEffect(() => { StorageService.saveEmployees(employees as any); }, [employees]);
  useEffect(() => { StorageService.saveDailySales(dailySales); }, [dailySales]);

  // Keep selected menu for POS push default to first menu
  useEffect(() => {
    if (!selectedSyncMenuId && menus.length > 0) {
      setSelectedSyncMenuId(menus[0].id);
    }
  }, [menus, selectedSyncMenuId]);

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
    const updated =
      existingIndex >= 0
        ? ingredients.map((i, idx) => (idx === existingIndex ? ingredient : i))
        : [ingredient, ...ingredients];
    setIngredients(updated);
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.INGREDIENTS, ingredient.id, ingredient);

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
    setIngredients(reordered);
    FirebaseSyncService.batchSaveUser(user.uid, COST_COLLECTIONS.INGREDIENTS, reordered);
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

  const handleSaveMenu = (menu: MenuItem) => {
    setMenus((prev) => {
      const exists = prev.some((m) => m.id === menu.id);
      return exists ? prev.map((m) => (m.id === menu.id ? menu : m)) : [...prev, menu];
    });
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.MENUS, menu.id, menu);
  };

  const handleDeleteMenu = (menuId: string) => {
    setMenus((prev) => prev.filter((m) => m.id !== menuId));
    FirebaseSyncService.deleteUserDoc(user.uid, COST_COLLECTIONS.MENUS, menuId);
  };

  const handleReorderMenus = (reordered: MenuItem[]) => {
    setMenus(reordered);
    FirebaseSyncService.batchSaveUser(user.uid, COST_COLLECTIONS.MENUS, reordered);
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
    setPurchases((prev) => [purchase, ...prev]);
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.PURCHASES, purchase.id, purchase);

    const item = inventory.find((i) => i.ingredientId === purchase.ingredientId);
    if (item) {
      const updatedStock = item.currentStock + purchase.quantity;
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
        ingredientId: purchase.ingredientId,
        ingredientName: purchase.ingredientName,
        type: 'PURCHASE',
        quantity: purchase.quantity,
        unit: purchase.unit,
        date: purchase.date,
        reason: `บิลซื้อเลขที่ ${purchase.invoiceNumber || '-'}`,
        user: user.email || 'Owner',
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

  const handleAddDailySalesRecord = (rec: DailySalesRecord) => {
    setDailySales((prev) => upsertDailySalesRecord(prev, rec));
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.DAILY_SALES, rec.id, rec);
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

  const handleSaveSettings = (newSettings: RestaurantSettings) => {
    setSettings(newSettings);
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.SETTINGS, 'default', newSettings);
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
  };

  const handleNavigateToRecipeBuilder = (variantId: string) => {
    setTargetRecipeVariantId(variantId);
    onSelectCostTab('recipes');
  };

  // Live bridge: pull paid bills from KinPOS dailySummaries
  const handlePullLivePosSales = async () => {
    setIsSyncingPosSales(true);
    setBridgeFeedback(null);
    try {
      const res = await FirebaseSyncService.pullDailySales(user.uid);
      if (res.success) {
        setDailySales(res.data);
        if (res.data.length > 0) {
          await FirebaseSyncService.batchSaveUser(user.uid, COST_COLLECTIONS.DAILY_SALES, res.data);
        }
        setBridgeFeedback({
          type: 'success',
          text:
            lang === 'th'
              ? `ดึงยอดขายจาก POS จริงสำเร็จ (${res.data.length} วัน)`
              : `Synced live POS sales (${res.data.length} days)`,
        });
      } else {
        setBridgeFeedback({
          type: 'error',
          text: res.error || 'Sync failed',
        });
      }
    } catch (err: unknown) {
      setBridgeFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSyncingPosSales(false);
      setTimeout(() => setBridgeFeedback(null), 5000);
    }
  };

  // Live bridge: push selected Costing MenuItem into KinPOS active POS Dishes
  const handlePushMenuToPOS = async (menuOverride?: MenuItem) => {
    const targetMenu = menuOverride || menus.find((m) => m.id === selectedSyncMenuId) || menus[0];
    if (!targetMenu) return;

    setIsPushingToPos(true);
    setBridgeFeedback(null);
    try {
      const result = await syncCostingMenuToPOS(targetMenu, ingredients, sauces);
      setBridgeFeedback({
        type: 'success',
        text:
          lang === 'th'
            ? `${result.createdDish ? 'เพิ่ม' : 'อัปเดต'}เมนู "${result.dishName}" (${result.variantCount} ตัวเลือก) เข้าหน้าขาย POS เรียบร้อย!`
            : `${result.createdDish ? 'Added' : 'Updated'} "${result.dishName}" (${result.variantCount} variants) in POS menu!`,
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

          <button
            type="button"
            onClick={handlePullLivePosSales}
            disabled={isSyncingPosSales}
            className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingPosSales ? 'animate-spin' : ''}`} />
            <span>{lang === 'th' ? 'ดึงยอดขายจาก POS จริง' : 'Sync Live POS Sales'}</span>
          </button>
        </div>

        {/* Push Costing Dish straight to KinPOS POS */}
        {menus.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selectedSyncMenuId}
              onChange={(e) => setSelectedSyncMenuId(e.target.value)}
              className="px-2.5 py-1.5 rounded-xl border border-[#EAE4D9] text-xs font-semibold max-w-[200px]"
            >
              {menus.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.variants.length})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => handlePushMenuToPOS()}
              disabled={isPushingToPos}
              className="px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60 whitespace-nowrap"
            >
              {isPushingToPos ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <UploadCloud className="w-3.5 h-3.5" />
              )}
              <span>{lang === 'th' ? 'ส่งเมนูนี้เข้า POS' : 'Push Menu to POS'}</span>
            </button>
          </div>
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
            initialServingMode="ON_RICE"
            onSaveMenu={handleSaveMenu}
            onDeleteMenu={handleDeleteMenu}
            onReorderMenus={handleReorderMenus}
            onUpdateVariantPrice={handleUpdateVariantPrice}
            onNavigateToRecipeBuilder={handleNavigateToRecipeBuilder}
          />
        )}

        {activeTab === 'food_cost_alacarte' && (
          <FoodCostView
            menus={menus}
            ingredients={ingredients}
            sauces={sauces}
            settings={settings}
            initialServingMode="A_LA_CARTE"
            onSaveMenu={handleSaveMenu}
            onDeleteMenu={handleDeleteMenu}
            onReorderMenus={handleReorderMenus}
            onUpdateVariantPrice={handleUpdateVariantPrice}
            onNavigateToRecipeBuilder={handleNavigateToRecipeBuilder}
          />
        )}

        {activeTab === 'quick_calculator' && (
          <QuickCostCalculatorView
            ingredients={ingredients}
            sauces={sauces}
            settings={settings}
            onSaveNewMenu={(newMenu) => {
              handleSaveMenu(newMenu);
              setSelectedSyncMenuId(newMenu.id);
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
            onSaveIngredient={handleSaveIngredient}
            onDeleteIngredient={handleDeleteIngredient}
            onReorderIngredients={handleReorderIngredients}
            onRecordPriceChange={handleRecordPriceChange}
          />
        )}

        {activeTab === 'overhead_breakeven' && (
          <BreakEvenView
            expenses={expenses as any}
            employees={employees as any}
            sales={dailySales}
            settings={settings as any}
            activeLanguage={lang}
          />
        )}

        {activeTab === 'expenses' && (
          <ExpensesView
            expenses={expenses as any}
            onAddExpense={handleSaveExpense}
            onDeleteExpense={handleDeleteExpense}
            onUpdateExpense={handleUpdateExpense}
            operatingDays={settings.operatingDaysPerMonth || 26}
            activeLanguage={lang}
          />
        )}

        {activeTab === 'sales_entry' && (
          <SalesEntryView
            sales={dailySales}
            channels={DEFAULT_SALES_CHANNELS}
            onAddSalesRecord={handleAddDailySalesRecord}
            onDeleteSalesRecord={handleDeleteDailySalesRecord}
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
            ingredients={ingredients as any}
            sales={dailySales}
            expenses={expenses as any}
            employees={employees as any}
            menuItems={menus as any}
            inventory={inventory as any}
            allWaste={wasteLog as any}
            channels={DEFAULT_SALES_CHANNELS}
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
            expenses={expenses as any}
            employees={employees as any}
            settings={settings as any}
            activeLanguage={lang}
            onSalesUpdated={(updatedSales) => setDailySales(updatedSales)}
          />
        )}

        {activeTab === 'labor' && (
          <LaborView
            employees={employees as any}
            monthlyNetSales={dailySales.reduce((sum, s) => sum + s.netSales, 0)}
            onAddEmployee={handleAddEmployee}
            onDeleteEmployee={handleDeleteEmployee}
            activeLanguage={lang}
          />
        )}

        {activeTab === 'inventory' && (
          <InventoryView
            inventory={inventory}
            ingredients={ingredients}
            transactions={inventoryTransactions}
            wasteLog={wasteLog}
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
            onSaveSettings={handleSaveSettings}
            onOpenIconModal={() => setIsIconModalOpen(true)}
          />
        )}
      </div>

      {/* App Icon Customizer Modal */}
      <AppIconModal isOpen={isIconModalOpen} onClose={() => setIsIconModalOpen(false)} />
    </div>
  );
};
