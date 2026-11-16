import React, { useState, useEffect, useMemo } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import {
  LayoutDashboard,
  PieChart,
  ClipboardList,
  Receipt,
  Users,
  Scale,
  RefreshCw,
  Download,
  Printer,
  ArrowLeft,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Percent,
  Layers,
  Award,
  Flame,
  ArrowUpRight,
  ArrowDownRight,
  UtensilsCrossed,
  CheckCircle2,
  CreditCard,
  Store,
} from 'lucide-react';
import {
  DailySummaryDoc,
  DishDoc,
  IngredientDoc,
  SubRecipeDoc,
  PackagingDoc,
  ExpenseDoc,
  EmployeeDoc,
  SettingsDoc,
  Language,
} from '../types';
import { translations } from '../i18n/translations';
import {
  formatMoney,
  formatPercent,
  getBusinessWorkDate,
  getMonthDateRange,
  calculateDishVariantCost,
  calculateFoodCostPercent,
  extractNetPriceFromMenuPrice,
  calculatePeriodExpensesAndLabor,
  calculateUsaliPnl,
  deriveVariableCostPercent,
  roundTo2,
} from '../engine/calculations';
import {
  subscribeCollection,
  subscribeDailySummariesInRange,
  subscribeSingleDailySummary,
  saveDocument,
  deleteDocument,
} from '../data/db';
import {
  Ingredient,
  Sauce,
  MenuItem,
  RestaurantSettings,
  SaleOrder,
  InventoryItem,
  WasteRecord,
  PurchaseRecord,
} from '../costing/types';
import {
  ExpenseRecord,
  Employee as CostEmployee,
  DailySalesRecord,
  SalesChannel,
  WhatShouldIDoAdvice,
} from '../costing/types/domain';
import { StorageService } from '../costing/services/storageService';
import { FirebaseSyncService, COST_COLLECTIONS } from '../costing/services/firebaseSyncService';
import {
  calculateProfitAndLoss,
  calculateBreakEven,
  calculateInventoryCOGS,
  calculateVariance,
  convertExpenseToMonthly,
  upsertDailySalesRecord,
} from '../costing/engine/calculations';
import { calculateVariantCostBreakdown } from '../costing/services/calculationEngine';
import { WhatShouldIDoSection } from '../costing/components/Dashboard/WhatShouldIDoSection';
import { SalesEntryView } from '../costing/components/Financials/SalesEntryView';
import { ExpensesView } from '../costing/components/Financials/ExpensesView';
import { LaborView } from '../costing/components/Financials/LaborView';
import { BreakEvenView } from '../costing/components/Financials/BreakEvenView';
import { AppPage } from '../components/Navigation';

export type FinanceHubTab =
  | 'overview'
  | 'pnl'
  | 'sales'
  | 'expenses'
  | 'labor'
  | 'breakeven';

type PeriodType = 'day' | 'month' | 'year';

interface Props {
  user: FirebaseUser;
  settings: SettingsDoc;
  lang: Language;
  initialTab?: FinanceHubTab;
  onNavigatePage: (page: AppPage) => void;
}

const DEFAULT_SALES_CHANNELS: SalesChannel[] = [
  { id: 'dine-in', code: 'DINE_IN', name: 'หน้าร้าน (Dine-in)', commissionPercent: 0, paymentFeePercent: 0, fixedFeePerOrder: 0, packagingFeeSurcharge: 0, taxOnCommissionPercent: 7, active: true },
  { id: 'takeaway', code: 'TAKEAWAY', name: 'สั่งกลับบ้าน (Takeaway)', commissionPercent: 0, paymentFeePercent: 0, fixedFeePerOrder: 0, packagingFeeSurcharge: 0, taxOnCommissionPercent: 7, active: true },
  { id: 'grab', code: 'GRAB', name: 'GrabFood', commissionPercent: 30, paymentFeePercent: 0, fixedFeePerOrder: 0, packagingFeeSurcharge: 0, taxOnCommissionPercent: 7, active: true },
  { id: 'lineman', code: 'LINEMAN', name: 'LINE MAN', commissionPercent: 25, paymentFeePercent: 0, fixedFeePerOrder: 0, packagingFeeSurcharge: 0, taxOnCommissionPercent: 7, active: true },
];

const mapCostCategoryToPos = (cat: string): ExpenseDoc['category'] => {
  const c = cat.toLowerCase();
  if (c.includes('rent')) return 'rent';
  if (c.includes('electric')) return 'electricity';
  if (c.includes('water')) return 'water';
  if (c.includes('gas') || c.includes('lpg')) return 'gas';
  if (c.includes('market') || c.includes('ad')) return 'marketing';
  if (c.includes('repair') || c.includes('maint')) return 'repairs';
  if (c.includes('clean') || c.includes('suppl') || c.includes('packag')) return 'supplies';
  return 'other';
};

const mapPosCategoryToCost = (cat: ExpenseDoc['category']): ExpenseRecord['category'] => {
  switch (cat) {
    case 'rent': return 'Rent';
    case 'electricity': return 'Electricity';
    case 'water': return 'Water';
    case 'gas': return 'Gas (LPG)';
    case 'marketing': return 'Marketing & Ads';
    case 'repairs': return 'Repair & Maintenance';
    case 'supplies': return 'Cleaning & Sanitation';
    default: return 'Other Operating Expenses';
  }
};

const isPayrollExpenseRecord = (e: ExpenseRecord): boolean => {
  const text = `${e.category || ''} ${(e as any).title || (e as any).name || (e as any).description || ''} ${e.notes || ''}`.toLowerCase();
  const keywords = ['labor', 'salary', 'wage', 'ค่าแรง', 'เงินเดือน'];
  return e.category === 'Labor (Salary & Wages)' || keywords.some((kw) => text.includes(kw));
};

export const UnifiedFinanceHubPage: React.FC<Props> = ({
  user,
  settings,
  lang,
  initialTab = 'overview',
  onNavigatePage,
}) => {
  const t = translations[lang];
  const [activeTab, setActiveTab] = useState<FinanceHubTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Period filter (drives both Executive Overview period and P&L Statement)
  const todayStr = getBusinessWorkDate(new Date(), settings.dailyClosingTime);
  const [period, setPeriod] = useState<PeriodType>('month');
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedMonth, setSelectedMonth] = useState<string>(todayStr.substring(0, 7));
  const [selectedYear, setSelectedYear] = useState<string>(todayStr.substring(0, 4));
  const [cogsMode, setCogsMode] = useState<'estimated' | 'actual'>('estimated');

  // POS real-time collections
  const [todaySummary, setTodaySummary] = useState<DailySummaryDoc | null>(null);
  const [periodSummaries, setPeriodSummaries] = useState<DailySummaryDoc[]>([]);
  const [last30Summaries, setLast30Summaries] = useState<DailySummaryDoc[]>([]);
  const [dishes, setDishes] = useState<DishDoc[]>([]);
  const [posIngredients, setPosIngredients] = useState<IngredientDoc[]>([]);
  const [subRecipes, setSubRecipes] = useState<SubRecipeDoc[]>([]);
  const [packagings, setPackagings] = useState<PackagingDoc[]>([]);
  const [posExpenses, setPosExpenses] = useState<ExpenseDoc[]>([]);
  const [posEmployees, setPosEmployees] = useState<EmployeeDoc[]>([]);

  // Costing real-time collections
  const [costSettings, setCostSettings] = useState<RestaurantSettings>(() => StorageService.getSettings());
  const [costIngredients, setCostIngredients] = useState<Ingredient[]>(() => StorageService.getIngredients());
  const [costSauces, setCostSauces] = useState<Sauce[]>(() => StorageService.getSauces());
  const [costMenus, setCostMenus] = useState<MenuItem[]>(() => StorageService.getMenus());
  const [costExpenses, setCostExpenses] = useState<ExpenseRecord[]>(
    () => StorageService.getExpenses() as unknown as ExpenseRecord[]
  );
  const [costEmployees, setCostEmployees] = useState<CostEmployee[]>(
    () => StorageService.getEmployees() as unknown as CostEmployee[]
  );
  const [costDailySales, setCostDailySales] = useState<DailySalesRecord[]>(() => StorageService.getDailySales());
  const [inventory, setInventory] = useState<InventoryItem[]>(() => StorageService.getInventory());
  const [purchases, setPurchases] = useState<PurchaseRecord[]>(() => StorageService.getPurchases());
  const [wasteLog, setWasteLog] = useState<WasteRecord[]>(() => StorageService.getWasteLog());
  const [salesOrders, setSalesOrders] = useState<SaleOrder[]>(() => StorageService.getSalesOrders());

  // Sync feedback
  const [isSyncingPos, setIsSyncingPos] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Subscribe POS static & financial collections + Costing collections
  useEffect(() => {
    if (!user?.uid) return;
    let isMounted = true;
    const unsubs: (() => void)[] = [];

    const past30Date = new Date();
    past30Date.setDate(past30Date.getDate() - 30);
    const start30Str = getBusinessWorkDate(past30Date, settings.dailyClosingTime);

    const init = async () => {
      try {
        const hasData = await FirebaseSyncService.hasUserData(user.uid);
        if (!hasData) {
          await FirebaseSyncService.migrateLocalDataToUser(user.uid);
        }
      } catch (err) {
        console.warn('Costing seed check warning:', err);
      }

      if (!isMounted) return;

      unsubs.push(
        subscribeSingleDailySummary(todayStr, (s) => isMounted && setTodaySummary(s)),
        subscribeDailySummariesInRange(start30Str, todayStr, (s30) => isMounted && setLast30Summaries(s30)),
        subscribeCollection<DishDoc>('dishes', (d) => isMounted && setDishes(d)),
        subscribeCollection<IngredientDoc>('ingredients', (i) => isMounted && setPosIngredients(i)),
        subscribeCollection<SubRecipeDoc>('subRecipes', (s) => isMounted && setSubRecipes(s)),
        subscribeCollection<PackagingDoc>('packaging', (p) => isMounted && setPackagings(p)),
        subscribeCollection<ExpenseDoc>('expenses', (e) => isMounted && setPosExpenses(e)),
        subscribeCollection<EmployeeDoc>('employees', (e) => isMounted && setPosEmployees(e)),

        // Auto-sync dailySummaries -> costDailySales
        subscribeCollection<DailySummaryDoc>('dailySummaries', async () => {
          try {
            const res = await FirebaseSyncService.pullDailySales(user.uid);
            if (res.success && isMounted) {
              setCostDailySales(res.data);
            }
          } catch (err) {
            console.warn('POS dailySummaries live bridge warning:', err);
          }
        }),

        FirebaseSyncService.subscribeUserDoc<RestaurantSettings>(
          user.uid,
          COST_COLLECTIONS.SETTINGS,
          'default',
          (s) => {
            if (s && isMounted) {
              setCostSettings(s);
              StorageService.saveSettings(s);
            }
          }
        ),
        FirebaseSyncService.subscribeUserCollection<Ingredient>(
          user.uid,
          COST_COLLECTIONS.INGREDIENTS,
          (items) => {
            if (isMounted) {
              setCostIngredients(items);
              StorageService.saveIngredients(items);
            }
          }
        ),
        FirebaseSyncService.subscribeUserCollection<Sauce>(
          user.uid,
          COST_COLLECTIONS.SAUCES,
          (items) => {
            if (isMounted) {
              setCostSauces(items);
              StorageService.saveSauces(items);
            }
          }
        ),
        FirebaseSyncService.subscribeUserCollection<MenuItem>(
          user.uid,
          COST_COLLECTIONS.MENUS,
          (items) => {
            if (isMounted) {
              setCostMenus(items);
              StorageService.saveMenus(items);
            }
          }
        ),
        FirebaseSyncService.subscribeUserCollection<DailySalesRecord>(
          user.uid,
          COST_COLLECTIONS.DAILY_SALES,
          (items) => {
            if (isMounted) {
              setCostDailySales(items);
              StorageService.saveDailySales(items);
            }
          }
        ),
        FirebaseSyncService.subscribeUserCollection<ExpenseRecord>(
          user.uid,
          COST_COLLECTIONS.EXPENSES,
          (items) => {
            if (isMounted) {
              setCostExpenses(items);
              StorageService.saveExpenses(items as any);
            }
          }
        ),
        FirebaseSyncService.subscribeUserCollection<CostEmployee>(
          user.uid,
          COST_COLLECTIONS.EMPLOYEES,
          (items) => {
            if (isMounted) {
              setCostEmployees(items);
              StorageService.saveEmployees(items as any);
            }
          }
        ),
        FirebaseSyncService.subscribeUserCollection<InventoryItem>(
          user.uid,
          COST_COLLECTIONS.INVENTORY,
          (items) => {
            if (isMounted) {
              setInventory(items);
              StorageService.saveInventory(items);
            }
          }
        ),
        FirebaseSyncService.subscribeUserCollection<PurchaseRecord>(
          user.uid,
          COST_COLLECTIONS.PURCHASES,
          (items) => {
            if (isMounted) {
              setPurchases(items);
              StorageService.savePurchases(items);
            }
          }
        ),
        FirebaseSyncService.subscribeUserCollection<WasteRecord>(
          user.uid,
          COST_COLLECTIONS.WASTE_LOG,
          (items) => {
            if (isMounted) {
              setWasteLog(items);
              StorageService.saveWasteLog(items);
            }
          }
        ),
        FirebaseSyncService.subscribeUserCollection<SaleOrder>(
          user.uid,
          COST_COLLECTIONS.SALES_ORDERS,
          (items) => {
            if (isMounted) {
              setSalesOrders(items);
              StorageService.saveSalesOrders(items);
            }
          }
        )
      );
    };

    init();
    return () => {
      isMounted = false;
      unsubs.forEach((u) => u());
    };
  }, [user?.uid, todayStr, settings.dailyClosingTime]);

  // Period-filtered POS dailySummaries
  useEffect(() => {
    let startDate = selectedDate;
    let endDate = selectedDate;
    if (period === 'month') {
      const range = getMonthDateRange(selectedMonth);
      startDate = range.startDate;
      endDate = range.endDate;
    } else if (period === 'year') {
      startDate = `${selectedYear}-01-01`;
      endDate = `${selectedYear}-12-31`;
    }

    const unsub = subscribeDailySummariesInRange(startDate, endDate, (sums) => {
      setPeriodSummaries(sums);
    });
    return () => unsub();
  }, [period, selectedDate, selectedMonth, selectedYear]);

  // Unified merged Expenses & Employees (preserves any legacy POS expenses/employees cleanly without duplicates)
  const operatingDays = costSettings.operatingDaysPerMonth || settings.operatingDaysPerMonth || 26;

  const unifiedExpenses = useMemo<ExpenseRecord[]>(() => {
    const costById = new Map<string, ExpenseRecord>(
      costExpenses.map((e) => [
        e.id,
        {
          ...e,
          isFixed: e.isFixed ?? true,
          recurring: e.recurring ?? true,
        },
      ])
    );
    for (const posE of posExpenses) {
      if (!costById.has(posE.id)) {
        costById.set(posE.id, {
          id: posE.id,
          date: posE.date,
          category: mapPosCategoryToCost(posE.category),
          description: lang === 'th' && posE.titleTh ? posE.titleTh : posE.title,
          amount: posE.amount,
          isFixed: posE.isFixed ?? true,
          paymentMethod: 'Bank Transfer',
          recurring: posE.isRecurring ?? true,
          frequency: 'monthly',
          isExcluded: false,
          operatingDaysPerMonth: operatingDays,
        });
      }
    }
    return Array.from(costById.values());
  }, [costExpenses, posExpenses, lang, operatingDays]);

  const unifiedEmployees = useMemo<CostEmployee[]>(() => {
    const empById = new Map<string, CostEmployee>(
      costEmployees.map((emp) => [
        emp.id,
        {
          ...emp,
          type: emp.type || 'monthly',
          wageRate: emp.wageRate ?? emp.baseSalary ?? 0,
          standardHoursPerMonth: emp.standardHoursPerMonth ?? operatingDays,
          overtimeHoursMonthly: emp.overtimeHoursMonthly ?? 0,
          overtimeRateMultiplier: emp.overtimeRateMultiplier ?? 1.5,
          benefitsMonthly: emp.benefitsMonthly ?? 0,
          active: emp.active ?? true,
        },
      ])
    );
    for (const posEmp of posEmployees) {
      if (!empById.has(posEmp.id) && posEmp.isActive !== false) {
        const monthlyCost =
          posEmp.wageType === 'hourly'
            ? posEmp.wageAmount * (posEmp.workDaysOrHoursPerMonth || 208)
            : posEmp.wageType === 'daily'
            ? posEmp.wageAmount * (posEmp.workDaysOrHoursPerMonth || 26)
            : posEmp.wageAmount;
        const roleLower = (posEmp.role || '').toLowerCase();
        const isKitchen =
          roleLower.includes('chef') ||
          roleLower.includes('cook') ||
          roleLower.includes('kitchen') ||
          roleLower.includes('ครัว') ||
          roleLower.includes('เชฟ') ||
          roleLower.includes('กุ๊ก');
        empById.set(posEmp.id, {
          id: posEmp.id,
          name: posEmp.name,
          position: posEmp.role,
          role: posEmp.role,
          type: posEmp.wageType,
          roleCategory: isKitchen ? 'direct_kitchen' : 'direct_service',
          department: isKitchen ? 'kitchen' : 'front_of_house',
          employmentType: posEmp.wageType === 'hourly' ? 'hourly' : 'full_time',
          wageRate: posEmp.wageAmount,
          standardHoursPerMonth: posEmp.workDaysOrHoursPerMonth || (posEmp.wageType === 'hourly' ? 208 : 26),
          overtimeHoursMonthly: 0,
          overtimeRateMultiplier: 1.5,
          benefitsMonthly: 0,
          monthlyCost,
          active: posEmp.isActive,
        });
      }
    }
    return Array.from(empById.values());
  }, [costEmployees, posEmployees, operatingDays]);

  // Normalized POS ExpenseDoc[] and EmployeeDoc[] synchronized from unified lists for USALI Period P&L
  const unifiedPosExpenses = useMemo<ExpenseDoc[]>(() => {
    return unifiedExpenses
      .filter((e) => !e.isExcluded && !(unifiedEmployees.length > 0 && isPayrollExpenseRecord(e)))
      .map((e) => ({
        id: e.id,
        title: e.description,
        titleTh: e.description,
        category: mapCostCategoryToPos(e.category),
        amount: roundTo2(convertExpenseToMonthly(e, operatingDays)),
        date: e.date,
        isFixed: Boolean(e.isFixed),
        isRecurring: Boolean(e.recurring ?? e.isFixed),
        createdAt: e.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      }));
  }, [unifiedExpenses, unifiedEmployees.length, operatingDays]);

  const unifiedPosEmployees = useMemo<EmployeeDoc[]>(() => {
    return unifiedEmployees.map((emp) => {
      const rate = emp.wageRate ?? 0;
      const monthly =
        emp.monthlyCost ??
        (emp.type === 'hourly'
          ? rate * (emp.standardHoursPerMonth || 200)
          : rate) + (emp.benefitsMonthly || 0);
      return {
        id: emp.id,
        name: emp.name,
        role: emp.role || emp.position || 'Staff',
        wageType: 'monthly',
        wageAmount: monthly,
        workDaysOrHoursPerMonth: operatingDays,
        isActive: emp.active !== false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };
    });
  }, [unifiedEmployees, operatingDays]);

  //Period-filtered Costing sales
  const periodCostSales = useMemo(() => {
    return costDailySales.filter((s) => {
      if (period === 'day') return s.date === selectedDate;
      if (period === 'month') return s.date.startsWith(selectedMonth);
      return s.date.startsWith(selectedYear);
    });
  }, [costDailySales, period, selectedDate, selectedMonth, selectedYear]);

  // Managerial P&L Metrics (from Costing + synced POS sales)
  const effectiveExpensesForPnl = useMemo(() => {
    const active = unifiedExpenses.filter((e) => !e.isExcluded);
    return unifiedEmployees.length > 0 ? active.filter((e) => !isPayrollExpenseRecord(e)) : active;
  }, [unifiedExpenses, unifiedEmployees.length]);

  const directKitchenLabor = useMemo(
    () =>
      unifiedEmployees
        .filter((e) => e.roleCategory === 'direct_kitchen' || e.department === 'kitchen')
        .reduce((sum, e) => {
          const rate = e.wageRate ?? 0;
          return (
            sum +
            (e.monthlyCost ??
              (e.type === 'hourly' ? rate * (e.standardHoursPerMonth || 200) : rate) +
                (e.benefitsMonthly || 0))
          );
        }, 0),
    [unifiedEmployees]
  );

  const nonKitchenLabor = useMemo(
    () =>
      unifiedEmployees
        .filter((e) => e.roleCategory !== 'direct_kitchen' && e.department !== 'kitchen')
        .reduce((sum, e) => {
          const rate = e.wageRate ?? 0;
          return (
            sum +
            (e.monthlyCost ??
              (e.type === 'hourly' ? rate * (e.standardHoursPerMonth || 200) : rate) +
                (e.benefitsMonthly || 0))
          );
        }, 0),
    [unifiedEmployees]
  );

  // Average Food Cost % across active menu variants
  const getMenuPortions = useMemo(() => {
    const ingMap = new Map(costIngredients.map((i) => [i.id, i]));
    const sauceMap = new Map(costSauces.map((s) => [s.id, s]));
    return (menu: any) => {
      if (!menu) return [];
      if (Array.isArray(menu.portions) && menu.portions.length > 0) return menu.portions;
      if (Array.isArray(menu.variants) && menu.variants.length > 0) {
        return menu.variants.map((v: any) => {
          let directFoodCost = 0;
          let packagingCost = (costSettings as any)?.defaultTakeawayPackagingCost || 3.5;
          let sellingPrice = v.sellingPrice || 50;
          try {
            if (v.recipeItems && v.recipeItems.length > 0) {
              const bd = calculateVariantCostBreakdown(
                v,
                menu.name || menu.thaiName || '',
                ingMap as any,
                sauceMap as any,
                costSettings as any
              );
              directFoodCost = bd.totalFoodCost || bd.totalIngredientCost || 0;
              packagingCost = bd.packagingCost || packagingCost;
              sellingPrice = bd.sellingPrice || sellingPrice;
            } else if (typeof v.totalFoodCost === 'number') {
              directFoodCost = v.totalFoodCost;
            } else if (typeof v.foodCost === 'number') {
              directFoodCost = v.foodCost;
            }
          } catch {
            directFoodCost = v.foodCost || v.totalFoodCost || 0;
          }
          const totalDirectCost = directFoodCost + packagingCost;
          const foodCostPercent = sellingPrice > 0 ? (totalDirectCost / sellingPrice) * 100 : 0;
          const contributionProfit = Math.max(0, sellingPrice - totalDirectCost);
          return {
            id: v.id,
            name: v.name || v.proteinType || 'มาตรฐาน',
            directFoodCost,
            packagingCost,
            totalDirectCost,
            sellingPrice,
            foodCostPercent,
            contributionProfit,
          };
        });
      }
      return [];
    };
  }, [costIngredients, costSauces, costSettings]);

  const allCostPortions = useMemo(() => costMenus.flatMap((m) => getMenuPortions(m)), [costMenus, getMenuPortions]);
  const avgFoodCostPercent =
    allCostPortions.length > 0
      ? allCostPortions.reduce((sum, p) => sum + (p.foodCostPercent || 0), 0) / allCostPortions.length
      : 31.5;

  // USALI Real-Time POS Today & Period P&L
  const dateParam = period === 'day' ? selectedDate : period === 'month' ? selectedMonth : selectedYear;
  const allocatedPosPeriodCosts = useMemo(
    () =>
      calculatePeriodExpensesAndLabor(
        period,
        dateParam,
        unifiedPosExpenses,
        unifiedPosEmployees,
        periodSummaries
      ),
    [period, dateParam, unifiedPosExpenses, unifiedPosEmployees, periodSummaries]
  );

  const usaliPeriodPnl = useMemo(
    () =>
      calculateUsaliPnl(
        periodSummaries,
        allocatedPosPeriodCosts,
        settings.serviceChargeTreatment || 'staff_pool'
      ),
    [periodSummaries, allocatedPosPeriodCosts, settings.serviceChargeTreatment]
  );

  const todaySummariesArr = useMemo(() => (todaySummary ? [todaySummary] : []), [todaySummary]);
  const todayPosCosts = useMemo(
    () => calculatePeriodExpensesAndLabor('day', todayStr, unifiedPosExpenses, unifiedPosEmployees, todaySummariesArr),
    [todayStr, unifiedPosExpenses, unifiedPosEmployees, todaySummariesArr]
  );
  const todayUsaliPnl = useMemo(
    () =>
      calculateUsaliPnl(
        todaySummariesArr,
        todayPosCosts,
        settings.serviceChargeTreatment || 'staff_pool'
      ),
    [todaySummariesArr, todayPosCosts, settings.serviceChargeTreatment]
  );

  // Managerial P&L Calculation (Period-aware & synchronized with Period OPEX allocation)
  const mgrGrossSales = periodCostSales.reduce((sum, s) => sum + s.grossSales, 0);
  const mgrDiscounts = periodCostSales.reduce((sum, s) => sum + s.discounts, 0);
  const mgrRefunds = periodCostSales.reduce((sum, s) => sum + s.refunds, 0);
  const mgrNetSales = Math.max(0, mgrGrossSales - mgrDiscounts - mgrRefunds);

  // Scale OPEX & Direct Labor proportionally to selected period using allocated factor
  const monthlyNormalizedOpex = useMemo(
    () => effectiveExpensesForPnl.reduce((sum, e) => sum + convertExpenseToMonthly(e, operatingDays), 0),
    [effectiveExpensesForPnl, operatingDays]
  );
  const periodMonthFactor = allocatedPosPeriodCosts.coveredMonths || 1;
  const periodDirectKitchenLabor = directKitchenLabor * periodMonthFactor;
  const periodNonKitchenLabor = nonKitchenLabor * periodMonthFactor;
  const periodMgrOpex = monthlyNormalizedOpex * periodMonthFactor + periodNonKitchenLabor;

  const hasActualStockData = purchases.length > 0 && inventory.length > 0;
  const effectiveCogsMode = cogsMode === 'actual' && !hasActualStockData ? 'estimated' : cogsMode;
  const totalPurchasesCost = purchases.reduce((sum, p) => sum + ((p as any).totalPrice || (p as any).price || 0), 0);
  const totalEndingStockCost = inventory.reduce(
    (sum, item) => sum + ((item.currentStock ?? 0) * ((item as any).costPerUnit || 0)),
    0
  );
  const totalWasteCost = wasteLog.reduce((sum, w) => sum + ((w as any).totalCost || (w as any).cost || 0), 0);
  const actualCogsResult = calculateInventoryCOGS(
    totalEndingStockCost * 1.05,
    totalPurchasesCost,
    totalEndingStockCost,
    totalWasteCost
  );
  const theoreticalSalesOrdersCost = salesOrders.reduce((sum, o) => sum + (o.totalFoodCost || 0), 0);
  const varianceResult = calculateVariance(actualCogsResult.cogs, theoreticalSalesOrdersCost);
  const varianceThresholdPercent = (costSettings as any).cogsVarianceThresholdPercent ?? 3.0;
  const variancePointsOfNetSales =
    mgrNetSales > 0 ? (Math.abs(varianceResult.varianceAmount) / mgrNetSales) * 100 : 0;
  const isVarianceExceeded = variancePointsOfNetSales > varianceThresholdPercent;

  // Prefer POS real food/packaging cost when periodSummaries match, else formula estimate
  const estFoodCogs =
    usaliPeriodPnl.totalFoodCost > 0
      ? usaliPeriodPnl.totalFoodCost
      : mgrNetSales * (avgFoodCostPercent / 100);
  const estPackagingCogs =
    usaliPeriodPnl.packagingCost > 0 ? usaliPeriodPnl.packagingCost : mgrNetSales * 0.035;

  const foodCogsToUse = effectiveCogsMode === 'actual' ? actualCogsResult.cogs : estFoodCogs;
  const packagingCogsToUse =
    effectiveCogsMode === 'actual'
      ? salesOrders.reduce((sum, o) => sum + (o.packagingCost || 0), 0) || estPackagingCogs
      : estPackagingCogs;

  const incomeTaxRate =
    typeof (costSettings as any).incomeTaxRatePercent === 'number'
      ? (costSettings as any).incomeTaxRatePercent
      : 20;

  const effectiveNetSalesForMgr = Math.max(mgrNetSales, usaliPeriodPnl.netSales);
  const mgrPnl = calculateProfitAndLoss(
    mgrGrossSales > 0 ? mgrGrossSales : usaliPeriodPnl.grossSales,
    mgrGrossSales > 0 ? mgrDiscounts : usaliPeriodPnl.discounts,
    mgrRefunds,
    foodCogsToUse,
    packagingCogsToUse,
    periodMgrOpex,
    periodDirectKitchenLabor,
    incomeTaxRate
  );

  // Real Break-Even using Monthly Fixed Overhead + 30-Day Real Derived Margin (or Menu Average CM%)
  const monthlyFixedExpensesOnly = useMemo(
    () =>
      effectiveExpensesForPnl
        .filter((e) => e.isFixed)
        .reduce((sum, e) => sum + convertExpenseToMonthly(e, operatingDays), 0),
    [effectiveExpensesForPnl, operatingDays]
  );
  const totalMonthlyStaffPayroll = directKitchenLabor + nonKitchenLabor;
  const derivedMargin30d = useMemo(() => deriveVariableCostPercent(last30Summaries), [last30Summaries]);
  const liveCMPercent = derivedMargin30d.hasRealData
    ? derivedMargin30d.contributionMarginPercent
    : Math.max(15, 100 - avgFoodCostPercent - 3.5);
  const avgTicketForBe =
    usaliPeriodPnl.avgOrderValue > 0 ? usaliPeriodPnl.avgOrderValue : 140;

  const executiveBreakEven = calculateBreakEven(
    monthlyFixedExpensesOnly + totalMonthlyStaffPayroll,
    liveCMPercent,
    avgTicketForBe,
    operatingDays,
    0,
    effectiveNetSalesForMgr
  );

  // Recipe Audit Warnings (from POS Dishes & Ingredients)
  const { dishesWithoutRecipe, dishesAboveTarget, dishesWithMissingCost } = useMemo(() => {
    const ingMap = new Map<string, IngredientDoc>(posIngredients.map((i) => [i.id, i]));
    const subMap = new Map<string, SubRecipeDoc>(subRecipes.map((s) => [s.id, s]));
    const pkgMap = new Map<string, PackagingDoc>(packagings.map((p) => [p.id, p]));

    const noRecipe: DishDoc[] = [];
    const aboveTarget: { dish: DishDoc; costPct: number }[] = [];
    const missingCost: DishDoc[] = [];

    for (const dish of dishes) {
      const primary = dish.variants?.[0];
      if (!primary) {
        noRecipe.push(dish);
        continue;
      }
      const calc = calculateDishVariantCost(primary, ingMap, subMap, pkgMap);
      if (!calc.hasRecipe) {
        noRecipe.push(dish);
      } else {
        if (calc.hasMissing) missingCost.push(dish);
        const netPrice = extractNetPriceFromMenuPrice(
          primary.price,
          settings.pricesIncludeVat,
          settings.vatPercent,
          settings.serviceChargeIncludedInPrice,
          settings.serviceChargePercent
        );
        const pct = calculateFoodCostPercent(calc.foodCost, netPrice);
        if (pct > settings.targetFoodCostPercent) {
          aboveTarget.push({ dish, costPct: pct });
        }
      }
    }
    return { dishesWithoutRecipe: noRecipe, dishesAboveTarget: aboveTarget, dishesWithMissingCost: missingCost };
  }, [dishes, posIngredients, subRecipes, packagings, settings]);

  // Actionable Business Recommendations
  const advices = useMemo<WhatShouldIDoAdvice[]>(() => {
    const list: WhatShouldIDoAdvice[] = [];
    const targetFC = (costSettings as any).defaultTargetFoodCostPercent || settings.targetFoodCostPercent || 35;

    const highCostPortion = costMenus
      .flatMap((m) => getMenuPortions(m).map((p: any) => ({ menu: m, portion: p })))
      .filter((x) => (x.portion.foodCostPercent || 0) > targetFC)
      .sort((a, b) => (b.portion.foodCostPercent || 0) - (a.portion.foodCostPercent || 0))[0];

    if (highCostPortion) {
      const { menu: m, portion: p } = highCostPortion;
      const title = m.thaiName || m.name || 'เมนูหลัก';
      list.push({
        id: 'adv-fc',
        type: 'CRITICAL',
        category: 'Food Cost',
        titleTh: `เมนู "${title} (${p.name})" ต้นทุนอาหาร ${p.foodCostPercent.toFixed(1)}% เกินเป้า (${targetFC}%)`,
        titleEn: `Menu "${title} (${p.name})" FC% is ${p.foodCostPercent.toFixed(1)}% (target ${targetFC}%)`,
        descriptionTh: `ต้นทุนตรง ฿${p.totalDirectCost.toFixed(2)} บนราคาขาย ฿${p.sellingPrice} แนะนำปรับสูตรหรือปรับราคาขาย`,
        descriptionEn: `Direct cost is ฿${p.totalDirectCost.toFixed(2)} on price ฿${p.sellingPrice}. Consider adjusting price or recipe.`,
        actionRecommendationTh: 'ปรับราคาหรือทบทวนวัตถุดิบ',
        actionRecommendationEn: 'Reprice or optimize recipe',
        metricLabel: 'Food Cost',
        metricValue: `${p.foodCostPercent.toFixed(1)}%`,
        relatedEntityType: 'menu',
        relatedEntityId: m.id,
      });
    }

    const grabGp = ((costSettings as any).grabFoodCommissionPercent ?? 30) * 1.07;
      list.push({
        id: 'adv-delivery',
        type: 'WARNING',
        category: 'Delivery Loss',
      titleTh: `ค่า GP เดลิเวอรีรวม VAT อยู่ที่ ${grabGp.toFixed(1)}%`,
      titleEn: `Effective Delivery GP + VAT is ${grabGp.toFixed(1)}%`,
      descriptionTh: 'ควรตั้งราคาขายบนแอป Delivery สูงกว่าหน้าร้านเพื่อชดเชยค่าคอมมิชชั่นและคงกำไรสุทธิ',
      descriptionEn: 'Ensure delivery menu markup covers platform GP + VAT to preserve net margin.',
      actionRecommendationTh: 'ตั้งราคา Delivery Markup',
      actionRecommendationEn: 'Configure delivery markup',
      metricLabel: 'GP + VAT',
      metricValue: `${grabGp.toFixed(1)}%`,
      relatedEntityType: 'channel',
    });

    if (executiveBreakEven.isValid && executiveBreakEven.breakEvenDailySales > 0) {
      const daysWithSales = Math.max(1, periodSummaries.length || new Set(costDailySales.map((s) => s.date)).size);
      const actualDailyAvg = effectiveNetSalesForMgr / daysWithSales;
      const diffPct =
        ((actualDailyAvg - executiveBreakEven.breakEvenDailySales) /
          executiveBreakEven.breakEvenDailySales) *
        100;
      const isAbove = diffPct >= 0;
      list.push({
        id: 'adv-be',
        type: isAbove ? 'OPPORTUNITY' : 'WARNING',
        category: 'Break-Even',
        titleTh: isAbove
          ? `ยอดขายเฉลี่ยต่อวันสูงกว่าจุดคุ้มทุน ${diffPct.toFixed(1)}%`
          : `ยอดขายเฉลี่ยยังต่ำกว่าจุดคุ้มทุน ${Math.abs(diffPct).toFixed(1)}%`,
        titleEn: isAbove
          ? `Daily average sales exceed break-even by ${diffPct.toFixed(1)}%`
          : `Daily average sales are ${Math.abs(diffPct).toFixed(1)}% below break-even`,
        descriptionTh: `จุดคุ้มทุนอยู่ที่ ฿${Math.round(executiveBreakEven.breakEvenDailySales).toLocaleString()}/วัน (ยอดขายจริงเฉลี่ย ฿${Math.round(actualDailyAvg).toLocaleString()}/วัน)`,
        descriptionEn: `Break-even is ฿${Math.round(executiveBreakEven.breakEvenDailySales).toLocaleString()}/day (Actual avg ฿${Math.round(actualDailyAvg).toLocaleString()}/day).`,
        actionRecommendationTh: isAbove ? 'ทำ Upsell เพิ่มกำไรต่อบิล' : 'กระตุ้นยอดขาย / คุมค่าใช้จ่ายคงที่',
        actionRecommendationEn: isAbove ? 'Add high-margin upsells' : 'Boost sales or reduce fixed costs',
        metricLabel: 'BEP Diff',
        metricValue: `${isAbove ? '+' : ''}${diffPct.toFixed(1)}%`,
        relatedEntityType: 'ingredient',
      });
    }

    return list;
  }, [
    costMenus,
    getMenuPortions,
    costSettings,
    settings.targetFoodCostPercent,
    executiveBreakEven,
    periodSummaries.length,
    costDailySales,
    effectiveNetSalesForMgr,
  ]);

  // Payment, Channel, and Dish Aggregates for Period (from real POS bills)
  const { paymentTotals, channelSales, bestSellers, bestMarginDishes, worstMarginDishes } = useMemo(() => {
    const payments: Record<string, number> = { cash: 0, qr: 0, card: 0, transfer: 0 };
    const chSales: Record<string, { orderCount: number; netSales: number }> = {};
    const dishAgg: Record<string, { name: string; quantity: number; revenue: number; cost: number }> = {};

    for (const s of periodSummaries) {
      if (s.paymentTotals) {
        for (const [m, amt] of Object.entries(s.paymentTotals)) {
          payments[m] = (payments[m] || 0) + (amt || 0);
        }
      }
      if (s.channelTotals) {
        for (const [ch, st] of Object.entries(s.channelTotals)) {
          if (!chSales[ch]) chSales[ch] = { orderCount: 0, netSales: 0 };
          chSales[ch].orderCount += st.orderCount || 0;
          chSales[ch].netSales += st.netSales || 0;
        }
      }
      if (s.dishStats) {
        for (const [id, dst] of Object.entries(s.dishStats)) {
          if (!dishAgg[id]) {
            dishAgg[id] = { name: dst.dishName, quantity: 0, revenue: 0, cost: 0 };
          }
          dishAgg[id].quantity += dst.quantity || 0;
          dishAgg[id].revenue += dst.revenue || 0;
          dishAgg[id].cost += dst.cost || 0;
        }
      }
    }

    const allDishesArr = Object.values(dishAgg);
    const topSellers = [...allDishesArr].sort((a, b) => b.quantity - a.quantity).slice(0, 5);
    const withMargin = allDishesArr
      .filter((d) => d.revenue > 0)
      .map((d) => ({ ...d, marginPct: ((d.revenue - d.cost) / d.revenue) * 100 }));

    return {
      paymentTotals: payments,
      channelSales: chSales,
      bestSellers: topSellers,
      bestMarginDishes: [...withMargin].sort((a, b) => b.marginPct - a.marginPct).slice(0, 5),
      worstMarginDishes: [...withMargin].sort((a, b) => a.marginPct - b.marginPct).slice(0, 5),
    };
  }, [periodSummaries]);

  // Unified CRUD Handlers (sync cleanly between Costing Cloud & POS Collections)
  const handleSyncLivePos = async () => {
    setIsSyncingPos(true);
    setSyncMessage(null);
    try {
      const res = await FirebaseSyncService.pullDailySales(user.uid);
      if (res.success) {
        setCostDailySales(res.data);
        if (res.data.length > 0) {
          await FirebaseSyncService.batchSaveUser(user.uid, COST_COLLECTIONS.DAILY_SALES, res.data);
        }
        setSyncMessage(
          lang === 'th'
            ? `ซิงค์ยอดขายจาก POS สำเร็จ (${res.data.length} รายการ)`
            : `Synced POS sales (${res.data.length} records)`
        );
      } else {
        setSyncMessage(res.error || (lang === 'th' ? 'ไม่พบข้อมูลใหม่' : 'No new data'));
      }
    } catch {
      setSyncMessage(lang === 'th' ? 'ซิงค์ไม่สำเร็จ' : 'Sync failed');
    } finally {
      setIsSyncingPos(false);
      setTimeout(() => setSyncMessage(null), 4000);
    }
  };

  const syncExpenseMirrorToPos = async (exp: ExpenseRecord) => {
    try {
      if (exp.isExcluded || isPayrollExpenseRecord(exp)) {
        await deleteDocument('expenses', exp.id).catch(() => {});
        return;
      }
      const posDoc: ExpenseDoc = {
        id: exp.id,
        title: exp.description,
        titleTh: exp.description,
        category: mapCostCategoryToPos(exp.category),
        amount: roundTo2(convertExpenseToMonthly(exp, operatingDays)),
        date: exp.date,
        isFixed: Boolean(exp.isFixed),
        isRecurring: Boolean(exp.recurring ?? exp.isFixed),
        createdAt: exp.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };
      await saveDocument('expenses', posDoc, true);
    } catch (err) {
      console.warn('POS expense mirror warning:', err);
    }
  };

  const handleAddExpense = (expense: ExpenseRecord) => {
    setCostExpenses((prev) => [expense, ...prev]);
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.EXPENSES, expense.id, expense);
    void syncExpenseMirrorToPos(expense);
  };

  const handleUpdateExpense = (updated: ExpenseRecord) => {
    setCostExpenses((prev) => {
      const exists = prev.some((e) => e.id === updated.id);
      return exists ? prev.map((e) => (e.id === updated.id ? updated : e)) : [updated, ...prev];
    });
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.EXPENSES, updated.id, updated);
    void syncExpenseMirrorToPos(updated);
  };

  const handleDeleteExpense = (id: string) => {
    setCostExpenses((prev) => prev.filter((e) => e.id !== id));
    setPosExpenses((prev) => prev.filter((e) => e.id !== id));
    FirebaseSyncService.deleteUserDoc(user.uid, COST_COLLECTIONS.EXPENSES, id);
    void deleteDocument('expenses', id).catch(() => {});
  };

  const syncEmployeeMirrorToPos = async (emp: CostEmployee) => {
    try {
      const posEmp: EmployeeDoc = {
        id: emp.id,
        name: emp.name,
        role: emp.role || emp.position || 'Staff',
        wageType: emp.type === 'hourly' ? 'hourly' : emp.type === 'daily' ? 'daily' : 'monthly',
        wageAmount: emp.wageRate ?? emp.baseSalary ?? 0,
        workDaysOrHoursPerMonth: emp.standardHoursPerMonth || operatingDays,
        isActive: emp.active !== false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };
      await saveDocument('employees', posEmp, true);
    } catch (err) {
      console.warn('POS employee mirror warning:', err);
    }
  };

  const handleAddEmployee = (emp: CostEmployee) => {
    setCostEmployees((prev) => [emp, ...prev]);
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.EMPLOYEES, emp.id, emp);
    void syncEmployeeMirrorToPos(emp);
  };

  const handleDeleteEmployee = (id: string) => {
    setCostEmployees((prev) => prev.filter((e) => e.id !== id));
    setPosEmployees((prev) => prev.filter((e) => e.id !== id));
    FirebaseSyncService.deleteUserDoc(user.uid, COST_COLLECTIONS.EMPLOYEES, id);
    void deleteDocument('employees', id).catch(() => {});
  };

  const handleAddSalesRecord = (rec: DailySalesRecord) => {
    setCostDailySales((prev) => upsertDailySalesRecord(prev, rec));
    FirebaseSyncService.saveUserDoc(user.uid, COST_COLLECTIONS.DAILY_SALES, rec.id, rec);
  };

  const handleDeleteSalesRecord = (id: string) => {
    setCostDailySales((prev) => prev.filter((s) => s.id !== id));
    FirebaseSyncService.deleteUserDoc(user.uid, COST_COLLECTIONS.DAILY_SALES, id);
  };

  const handleExportCsv = () => {
    const rows = [
      ['Metric', 'Amount (THB)'],
      ['Period', `${period}:${dateParam}`],
      ['USALI Net Sales (POS Real-Time)', usaliPeriodPnl.netSales.toFixed(2)],
      ['Managerial Net Sales (Total)', mgrPnl.netSales.toFixed(2)],
      ['Food COGS', foodCogsToUse.toFixed(2)],
      ['Packaging COGS', packagingCogsToUse.toFixed(2)],
      ['Gross Profit', mgrPnl.grossProfit.toFixed(2)],
      ['Gross Margin %', `${mgrPnl.grossMarginPercent.toFixed(1)}%`],
      ['Kitchen Direct Labor', periodDirectKitchenLabor.toFixed(2)],
      ['Prime Cost (COGS + Kitchen Labor)', mgrPnl.primeCost.toFixed(2)],
      ['Prime Cost %', `${mgrPnl.primeCostPercent.toFixed(1)}%`],
      ['Operating Expenses (OPEX + Admin Labor)', periodMgrOpex.toFixed(2)],
      ['Platform Fees (Delivery)', usaliPeriodPnl.platformFees.toFixed(2)],
      ['Operating Profit (EBITDA)', mgrPnl.operatingProfit.toFixed(2)],
      ['Estimated Tax', mgrPnl.taxAmount.toFixed(2)],
      ['Net Profit', mgrPnl.netProfit.toFixed(2)],
      ['Monthly Break-Even Target', executiveBreakEven.breakEvenSales.toFixed(2)],
    ];
    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((r) => r.join(',')).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `KinPOS_Finance_PNL_${period}_${dateParam}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const tabs: { id: FinanceHubTab; labelTh: string; labelEn: string; icon: React.ReactNode }[] = [
    { id: 'overview', labelTh: 'ภาพรวมผู้บริหาร', labelEn: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'pnl', labelTh: 'งบกำไรขาดทุน P&L', labelEn: 'P&L Statement', icon: <PieChart className="w-4 h-4" /> },
    { id: 'sales', labelTh: 'ยอดขายรายวัน', labelEn: 'Daily Sales', icon: <ClipboardList className="w-4 h-4" /> },
    { id: 'expenses', labelTh: 'ค่าใช้จ่าย & โสหุ้ย', labelEn: 'Expenses', icon: <Receipt className="w-4 h-4" /> },
    { id: 'labor', labelTh: 'ค่าแรง & พนักงาน', labelEn: 'Labor', icon: <Users className="w-4 h-4" /> },
    { id: 'breakeven', labelTh: 'จุดคุ้มทุน & เป้าหมาย', labelEn: 'Break-Even', icon: <Scale className="w-4 h-4" /> },
  ];

  const targetFoodCostPct = (costSettings as any).defaultTargetFoodCostPercent || settings.targetFoodCostPercent || 30;
  const targetPrimeCostPct = (costSettings as any).primeCostTargetPercent || 55;
  const effectiveFoodCostPct =
    effectiveNetSalesForMgr > 0 ? (foodCogsToUse / effectiveNetSalesForMgr) * 100 : avgFoodCostPercent;

  return (
    <div className="min-h-full bg-gradient-to-br from-[#F8FAFC] via-[#F4F6FA] to-[#FFF9F4] text-slate-900 select-none">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-5">
        {/* Clean Unified Command Bar */}
        <header className="rounded-2xl bg-white/90 backdrop-blur-md border border-slate-200/90 px-5 py-4 shadow-xs flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => onNavigatePage('pos')}
              className="p-2 rounded-xl bg-slate-50 hover:bg-orange-50 text-slate-700 hover:text-orange-600 border border-slate-200 transition-colors cursor-pointer shrink-0"
              title={lang === 'th' ? 'กลับหน้าขาย POS' : 'Back to POS'}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 truncate">
              {lang === 'th' ? 'การเงิน บริหาร & รายงาน P&L' : 'Finance & Executive P&L'}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {syncMessage && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 px-2.5 py-1.5 whitespace-nowrap">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{syncMessage}</span>
              </span>
            )}

            <button
              type="button"
              onClick={handleSyncLivePos}
              disabled={isSyncingPos}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-emerald-600 ${isSyncingPos ? 'animate-spin' : ''}`} />
              <span>{lang === 'th' ? 'ซิงค์ยอดขาย POS' : 'Sync POS'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-orange-600" />
              <span>CSV</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5 text-slate-600" />
              <span>{lang === 'th' ? 'พิมพ์รายงาน' : 'Print'}</span>
            </button>
          </div>
        </header>

        {/* Unified Segmented Tabs + Period Selector */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <nav
            aria-label="Finance Hub Sections"
            className="flex items-center gap-1.5 overflow-x-auto scrollbar-none bg-white/80 backdrop-blur-md border border-slate-200/90 p-1.5 rounded-2xl"
          >
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                  }`}
                >
                  {tab.icon}
                  <span>{lang === 'th' ? tab.labelTh : tab.labelEn}</span>
                </button>
              );
            })}
          </nav>

          {(activeTab === 'overview' || activeTab === 'pnl') && (
            <div className="flex items-center gap-2 bg-white/85 border border-slate-200/90 px-2.5 py-1.5 rounded-2xl shrink-0">
              <div className="flex items-center gap-1">
                {(['day', 'month', 'year'] as PeriodType[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriod(p)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap transition-colors ${
                      period === p
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {p === 'day' ? t.reports.periodDay : p === 'month' ? t.reports.periodMonth : t.reports.periodYear}
                  </button>
                ))}
              </div>
              <div className="h-4 w-px bg-slate-200" />
              {period === 'day' && (
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold text-slate-800"
                />
              )}
              {period === 'month' && (
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold text-slate-800"
                />
              )}
              {period === 'year' && (
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-bold text-slate-800"
                >
                  {[2024, 2025, 2026, 2027].map((y) => (
                    <option key={y} value={y.toString()}>
                      {y}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        {/* =========================================================
            TAB 1: EXECUTIVE OVERVIEW (POS Today + Costing Executive KPIs + Alerts + Menu Margins)
           ========================================================= */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* 8 Clean Synchronized Financial KPI Cards */}
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* 1. Today Live POS Sales */}
              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{lang === 'th' ? 'ยอดขายวันนี้ (POS สด)' : "Today's Net Sales"}</span>
                  </span>
                  <span className="text-[11px] font-semibold text-emerald-700 tabular-nums">
                    {todayUsaliPnl.orderCount} {lang === 'th' ? 'บิล' : 'orders'}
                  </span>
                </div>
                <div className="mt-2.5 text-2xl font-bold text-slate-900 tabular-nums">
                  ฿{formatMoney(todayUsaliPnl.netSales)}
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 tabular-nums">
                  {lang === 'th'
                    ? `กำไรวันนี้ (USALI): ฿${formatMoney(todayUsaliPnl.netOperatingProfit)}`
                    : `Today Profit: ฿${formatMoney(todayUsaliPnl.netOperatingProfit)}`}
                </div>
              </div>

              {/* 2. Period Total Net Sales */}
              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-sky-600" />
                    <span>{lang === 'th' ? 'ยอดขายสุทธิช่วงที่เลือก' : 'Period Net Sales'}</span>
                  </span>
                  <span className="text-[11px] font-semibold text-sky-700 tabular-nums">{dateParam}</span>
                </div>
                <div className="mt-2.5 text-2xl font-bold text-slate-900 tabular-nums">
                  ฿{formatMoney(mgrPnl.netSales)}
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 tabular-nums">
                  {usaliPeriodPnl.orderCount} orders · {lang === 'th' ? 'เฉลี่ย' : 'Avg'} ฿{formatMoney(usaliPeriodPnl.avgOrderValue)}
                </div>
              </div>

              {/* 3. Food Cost % */}
              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <Percent className="w-3.5 h-3.5 text-amber-600" />
                    <span>Food Cost %</span>
                  </span>
                  <span
                    className={`text-[11px] font-semibold ${
                      effectiveFoodCostPct > targetFoodCostPct ? 'text-rose-700' : 'text-emerald-700'
                    }`}
                  >
                    {effectiveFoodCostPct > targetFoodCostPct
                      ? lang === 'th' ? 'เกินเป้า' : 'Above Target'
                      : lang === 'th' ? 'ตามเกณฑ์' : 'Healthy'}
                  </span>
                </div>
                <div className="mt-2.5 flex items-baseline gap-2 tabular-nums">
                  <span className="text-2xl font-bold text-slate-900">{effectiveFoodCostPct.toFixed(1)}%</span>
                  <span className="text-xs text-slate-400">/ {targetFoodCostPct}%</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 tabular-nums">
                  COGS: ฿{formatMoney(foodCogsToUse)}
                </div>
              </div>

              {/* 4. Prime Cost % */}
              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Prime Cost %</span>
                  </span>
                  <span
                    className={`text-[11px] font-semibold ${
                      mgrPnl.primeCostPercent > targetPrimeCostPct ? 'text-rose-700' : 'text-emerald-700'
                    }`}
                  >
                    {mgrPnl.primeCostPercent > targetPrimeCostPct
                      ? lang === 'th' ? 'ควรควบคุม' : 'High'
                      : lang === 'th' ? 'เหมาะสม' : 'Healthy'}
                  </span>
                </div>
                <div className="mt-2.5 flex items-baseline gap-2 tabular-nums">
                  <span className="text-2xl font-bold text-slate-900">{mgrPnl.primeCostPercent.toFixed(1)}%</span>
                  <span className="text-xs text-slate-400">COGS+Kitchen</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 tabular-nums">
                  {lang === 'th' ? `เป้าหมาย ≤ ${targetPrimeCostPct}%` : `Target ≤ ${targetPrimeCostPct}%`} · ฿{formatMoney(mgrPnl.primeCost)}
                </div>
              </div>

              {/* 5. Gross Profit */}
              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <UtensilsCrossed className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{lang === 'th' ? 'กำไรขั้นต้น (GP)' : 'Gross Profit'}</span>
                  </span>
                  <span className="text-[11px] font-semibold text-emerald-700 tabular-nums">
                    {mgrPnl.grossMarginPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-2.5 text-2xl font-bold text-emerald-700 tabular-nums">
                  ฿{formatMoney(mgrPnl.grossProfit)}
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                  {lang === 'th' ? 'หลังหักต้นทุนอาหาร & กล่อง' : 'After Food & Packaging COGS'}
                </div>
              </div>

              {/* 6. Operating Expenses */}
              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <Receipt className="w-3.5 h-3.5 text-rose-600" />
                    <span>{lang === 'th' ? 'ค่าใช้จ่ายดำเนินงาน + ค่าแรง' : 'OPEX & Labor'}</span>
                  </span>
                  <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                    {unifiedExpenses.filter((e) => !e.isExcluded).length} + {unifiedEmployees.length}
                  </span>
                </div>
                <div className="mt-2.5 text-2xl font-bold text-slate-900 tabular-nums">
                  ฿{formatMoney(periodMgrOpex + periodDirectKitchenLabor)}
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 tabular-nums">
                  {lang === 'th'
                    ? `ค่าแรง ฿${formatMoney(periodDirectKitchenLabor + periodNonKitchenLabor)}`
                    : `Total Labor ฿${formatMoney(periodDirectKitchenLabor + periodNonKitchenLabor)}`}
                </div>
              </div>

              {/* 7. Net Profit */}
              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    {mgrPnl.netProfit >= 0 ? (
                      <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5 text-rose-600" />
                    )}
                    <span>{lang === 'th' ? 'กำไรสุทธิ (หลังภาษี)' : 'Net Profit'}</span>
                  </span>
                  <span
                    className={`text-[11px] font-semibold tabular-nums ${
                      mgrPnl.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {mgrPnl.netMarginPercent.toFixed(1)}%
                  </span>
                </div>
                <div
                  className={`mt-2.5 text-2xl font-bold tabular-nums ${
                    mgrPnl.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  ฿{formatMoney(mgrPnl.netProfit)}
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 tabular-nums">
                  {lang === 'th' ? `ภาษีประมาณ ${incomeTaxRate}%` : `Tax @ ${incomeTaxRate}%`}
                </div>
              </div>

              {/* 8. Break-Even Target */}
              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <Scale className="w-3.5 h-3.5 text-orange-600" />
                    <span>{lang === 'th' ? 'จุดคุ้มทุนต่อเดือน' : 'Monthly Break-Even'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('breakeven')}
                    className="text-[11px] font-semibold text-orange-600 hover:underline cursor-pointer"
                  >
                    {lang === 'th' ? 'จำลอง →' : 'Simulate →'}
                  </button>
                </div>
                <div className="mt-2.5 text-2xl font-bold text-slate-900 tabular-nums">
                  ฿{Math.round(executiveBreakEven.breakEvenSales).toLocaleString()}
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-emerald-700 font-semibold tabular-nums">
                  {lang === 'th'
                    ? `฿${Math.round(executiveBreakEven.breakEvenDailySales).toLocaleString()}/วัน · ${executiveBreakEven.breakEvenDailyOrders} จาน/วัน`
                    : `฿${Math.round(executiveBreakEven.breakEvenDailySales).toLocaleString()}/day`}
                </div>
              </div>
            </section>

            {/* Automated Recommendations */}
            <div className="tonycost-workspace exec-glass-dashboard">
              <WhatShouldIDoSection
                advices={advices}
                activeLanguage={lang}
                onNavigate={(view) => {
                  if (view === 'ingredients') onNavigatePage('cost_ingredients');
                  else if (view === 'menu_costing') onNavigatePage('cost_food_cost');
                  else if (view === 'sales_channels') onNavigatePage('cost_settings');
                  else onNavigatePage('cost_quick_calculator');
                }}
              />
            </div>

            {/* POS Recipe Cost Audit + Today Top Sellers */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <span>{t.dashboard.dishesAboveTarget} ({dishesAboveTarget.length})</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => onNavigatePage('menu_cost')}
                    className="text-xs font-bold text-orange-600 hover:underline cursor-pointer"
                  >
                    {t.dashboard.fixRecipe} →
                  </button>
                </div>
                <div className="space-y-1.5 text-xs max-h-52 overflow-y-auto">
                  {dishesAboveTarget.length === 0 ? (
                    <div className="py-4 text-center text-emerald-700 font-medium">
                      {lang === 'th' ? 'ต้นทุนเมนู POS ทุกรายการอยู่ในเกณฑ์เป้าหมาย' : 'All POS dishes are within target cost'}
                    </div>
                  ) : (
                    dishesAboveTarget.slice(0, 6).map(({ dish, costPct }) => (
                      <div key={dish.id} className="flex items-center justify-between py-2 px-2.5 rounded-xl bg-rose-50/70">
                        <span className="font-semibold text-slate-900 truncate pr-2">
                          {lang === 'th' && dish.nameTh ? dish.nameTh : dish.name}
                        </span>
                        <span className="font-bold text-rose-700 tabular-nums shrink-0">{formatPercent(costPct)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>{t.dashboard.dishesWithoutRecipe} ({dishesWithoutRecipe.length + dishesWithMissingCost.length})</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => onNavigatePage('menu_cost')}
                    className="text-xs font-bold text-orange-600 hover:underline cursor-pointer"
                  >
                    {t.dashboard.fixRecipe} →
                  </button>
                </div>
                <div className="space-y-1.5 text-xs max-h-52 overflow-y-auto">
                  {dishesWithoutRecipe.length === 0 && dishesWithMissingCost.length === 0 ? (
                    <div className="py-4 text-center text-emerald-700 font-medium">
                      {lang === 'th' ? 'เมนู POS ผูกสูตรและราคาวัตถุดิบครบแล้ว' : 'All menus have complete recipes & costs'}
                    </div>
                  ) : (
                    [...dishesWithMissingCost, ...dishesWithoutRecipe].slice(0, 6).map((dish) => (
                      <div key={dish.id} className="flex items-center justify-between py-2 px-2.5 rounded-xl bg-amber-50/70">
                        <span className="font-semibold text-slate-900 truncate pr-2">
                          {lang === 'th' && dish.nameTh ? dish.nameTh : dish.name}
                        </span>
                        <span className="text-[11px] font-bold text-amber-800 shrink-0">
                          {dishesWithMissingCost.some((m) => m.id === dish.id)
                            ? t.menuCost.missingCost
                            : t.pos.noRecipeLinked}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-600" />
                  <span>{t.dashboard.topSellersToday}</span>
                </h3>
                <div className="space-y-1.5 text-xs max-h-52 overflow-y-auto">
                  {!todaySummary?.dishStats || Object.keys(todaySummary.dishStats).length === 0 ? (
                    <div className="py-4 text-center text-slate-400">{t.common.noData}</div>
                  ) : (
                    Object.values(todaySummary.dishStats)
                      .sort((a, b) => b.quantity - a.quantity)
                      .slice(0, 5)
                      .map((dst, idx) => (
                        <div key={dst.dishId || idx} className="flex items-center justify-between py-2 px-2.5 rounded-xl bg-slate-50">
                          <span className="font-semibold text-slate-900 truncate pr-2">
                            #{idx + 1} {dst.dishName}
                          </span>
                          <span className="font-bold text-orange-600 tabular-nums shrink-0">
                            {dst.quantity} · ฿{formatMoney(dst.revenue)}
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </section>

            {/* Menu Cost & Margin Summary Table */}
            <section className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  {lang === 'th' ? 'วิเคราะห์ต้นทุนและกำไรของเมนูหลัก' : 'Menu Cost & Profit Breakdown'}
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigatePage('cost_food_cost')}
                  className="inline-flex items-center gap-1 text-xs font-bold text-orange-600 hover:text-orange-700 cursor-pointer shrink-0"
                >
                  <span>{lang === 'th' ? 'จัดการตารางคำนวณต้นทุน' : 'Open Costing Sheet'}</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <tr>
                      <th className="py-2.5 px-3.5">{lang === 'th' ? 'ชื่อเมนู' : 'Menu'}</th>
                      <th className="py-2.5 px-3.5">{lang === 'th' ? 'ตัวเลือก / พอร์ชั่น' : 'Portion'}</th>
                      <th className="py-2.5 px-3.5 text-right">{lang === 'th' ? 'ต้นทุนอาหาร' : 'Food Cost'}</th>
                      <th className="py-2.5 px-3.5 text-right">{lang === 'th' ? 'กล่อง' : 'Pkg'}</th>
                      <th className="py-2.5 px-3.5 text-right">{lang === 'th' ? 'ต้นทุนรวม' : 'Total Cost'}</th>
                      <th className="py-2.5 px-3.5 text-right">{lang === 'th' ? 'ราคาขาย' : 'Price'}</th>
                      <th className="py-2.5 px-3.5 text-right">% Food Cost</th>
                      <th className="py-2.5 px-3.5 text-right">{lang === 'th' ? 'กำไรต่อจาน' : 'Profit/Dish'}</th>
                      <th className="py-2.5 px-3.5 text-center">{lang === 'th' ? 'สถานะ' : 'Status'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 tabular-nums">
                    {costMenus.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-400">
                          {t.common.noData}
                        </td>
                      </tr>
                    ) : (
                      costMenus.map((menu: any) => {
                        const portionsList = getMenuPortions(menu);
                        if (!portionsList || portionsList.length === 0) return null;
                        return portionsList.map((portion: any, idx: number) => {
                          const isHigh = (portion.foodCostPercent || 0) > targetFoodCostPct;
                          return (
                            <tr key={`${menu.id}-${portion.id}`} className="hover:bg-orange-50/40">
                              <td className="py-2.5 px-3.5 font-semibold text-slate-900">
                                {idx === 0 ? menu.thaiName || menu.name : <span className="text-slate-400 pl-3">↳</span>}
                              </td>
                              <td className="py-2.5 px-3.5 text-slate-600">{portion.name}</td>
                              <td className="py-2.5 px-3.5 text-right">฿{(portion.directFoodCost || 0).toFixed(2)}</td>
                              <td className="py-2.5 px-3.5 text-right text-slate-500">฿{(portion.packagingCost || 0).toFixed(2)}</td>
                              <td className="py-2.5 px-3.5 text-right font-semibold text-slate-900">฿{(portion.totalDirectCost || 0).toFixed(2)}</td>
                              <td className="py-2.5 px-3.5 text-right font-bold text-slate-900">฿{portion.sellingPrice || 0}</td>
                              <td className={`py-2.5 px-3.5 text-right font-semibold ${isHigh ? 'text-rose-600' : 'text-emerald-700'}`}>
                                {(portion.foodCostPercent || 0).toFixed(1)}%
                              </td>
                              <td className="py-2.5 px-3.5 text-right font-bold text-emerald-700">
                                ฿{(portion.contributionProfit || 0).toFixed(2)}
                              </td>
                              <td className="py-2.5 px-3.5 text-center font-semibold">
                                {isHigh ? (
                                  <span className="text-rose-700">{lang === 'th' ? 'ควรปรับราคา' : 'Review'}</span>
                                ) : (
                                  <span className="text-emerald-700">{lang === 'th' ? 'กำไรดี' : 'Good'}</span>
                                )}
                              </td>
                            </tr>
                          );
                        });
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* =========================================================
            TAB 2: UNIFIED PROFIT & LOSS STATEMENT (POS USALI + Managerial P&L)
           ========================================================= */}
        {activeTab === 'pnl' && (
          <div className="space-y-6">
            {/* COGS Basis & Variance Strip */}
            <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Scale className="w-4 h-4 text-orange-600 shrink-0" />
                <span className="text-xs font-bold text-slate-700">
                  {lang === 'th' ? 'เกณฑ์การคำนวณต้นทุน (COGS Mode):' : 'COGS Calculation Mode:'}
                </span>
                <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setCogsMode('estimated')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      effectiveCogsMode === 'estimated'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {lang === 'th' ? 'ตามบิลขายจริง & สูตรมาตรฐาน' : 'Standard Recipe & POS COGS'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCogsMode('actual')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      effectiveCogsMode === 'actual'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {lang === 'th' ? 'ตามสต็อก & บิลจัดซื้อจริง' : 'Actual Purchases COGS'}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums text-slate-600">
                <span>
                  Actual Stock COGS: <strong className="text-slate-900">฿{Math.round(actualCogsResult.cogs).toLocaleString()}</strong>
                </span>
                <span>
                  Theoretical: <strong className="text-slate-900">฿{Math.round(theoreticalSalesOrdersCost).toLocaleString()}</strong>
                </span>
                <span className={isVarianceExceeded ? 'text-rose-700 font-bold' : 'text-emerald-700 font-semibold'}>
                  Variance: {varianceResult.varianceAmount >= 0 ? '+' : '-'}฿{Math.round(Math.abs(varianceResult.varianceAmount)).toLocaleString()}
                </span>
              </div>
            </div>

            {effectiveCogsMode === 'actual' && hasActualStockData && actualCogsResult.isNegative && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>ตัวเลขสต็อกผิดปกติ กรุณาตรวจสอบการตรวจนับสต็อก</span>
              </div>
            )}

            {/* Formal Unified Statement of Comprehensive Income */}
            <section className="rounded-2xl bg-white/95 border border-slate-200/90 p-5 sm:p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <PieChart className="w-5 h-5 text-orange-600" />
                  <span>
                    {lang === 'th'
                      ? 'งบกำไรขาดทุนรวม (Unified P&L Statement)'
                      : 'Unified Profit & Loss Statement'}
                  </span>
                </h2>
                <span className="text-xs font-semibold text-slate-500 tabular-nums">
                  {dateParam} · THB
                </span>
              </div>

              <div className="space-y-4 text-xs tabular-nums">
                {/* 1. Revenue */}
                <div className="space-y-1.5">
                  <div className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 font-bold uppercase tracking-wider">
                    1. {lang === 'th' ? 'รายได้จากการขาย (Revenue)' : 'Revenue'}
                  </div>
                  <div className="flex justify-between px-3 py-1 text-slate-600">
                    <span>{lang === 'th' ? 'ยอดขายรวมก่อนหักส่วนลด (Gross Sales)' : 'Gross Sales'}</span>
                    <span>฿{formatMoney(mgrGrossSales > 0 ? mgrGrossSales : usaliPeriodPnl.grossSales)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-1 text-amber-700">
                    <span>{lang === 'th' ? 'หัก: ส่วนลดโปรโมชั่น & คืนเงิน' : 'Less: Discounts & Refunds'}</span>
                    <span>
                      -฿{formatMoney((mgrGrossSales > 0 ? mgrDiscounts : usaliPeriodPnl.discounts) + mgrRefunds)}
                    </span>
                  </div>
                  {settings.serviceChargeTreatment === 'retained' && usaliPeriodPnl.retainedServiceCharge > 0 && (
                    <div className="flex justify-between px-3 py-1 text-emerald-700">
                      <span>{lang === 'th' ? 'บวก: Service Charge ที่ร้านเก็บเอง' : 'Retained Service Charge'}</span>
                      <span>+฿{formatMoney(usaliPeriodPnl.retainedServiceCharge)}</span>
                    </div>
                  )}
                  <div className="flex justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 font-bold text-sm text-slate-900">
                    <span>{lang === 'th' ? 'ยอดขายสุทธิ (Net Revenue)' : 'Net Sales'}</span>
                    <span>฿{formatMoney(mgrPnl.netSales)}</span>
                  </div>
                </div>

                {/* 2. COGS */}
                <div className="space-y-1.5">
                  <div className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 font-bold uppercase tracking-wider">
                    2. {lang === 'th' ? 'ต้นทุนขาย (Cost of Goods Sold)' : 'Cost of Goods Sold'}
                  </div>
                  <div className="flex justify-between px-3 py-1 text-slate-600">
                    <span>{t.reports.foodCost}</span>
                    <span>
                      {mgrPnl.netSales > 0 ? `${((foodCogsToUse / mgrPnl.netSales) * 100).toFixed(1)}%` : '0.0%'} · -฿{formatMoney(foodCogsToUse)}
                    </span>
                  </div>
                  <div className="flex justify-between px-3 py-1 text-slate-600">
                    <span>{t.reports.packagingCost}</span>
                    <span>
                      {mgrPnl.netSales > 0 ? `${((packagingCogsToUse / mgrPnl.netSales) * 100).toFixed(1)}%` : '0.0%'} · -฿{formatMoney(packagingCogsToUse)}
                    </span>
                  </div>
                  <div className="flex justify-between px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 font-bold text-sm text-emerald-900">
                    <span>
                      = {t.reports.grossProfit} ({mgrPnl.grossMarginPercent.toFixed(1)}%)
                    </span>
                    <span>฿{formatMoney(mgrPnl.grossProfit)}</span>
                  </div>
                </div>

                {/* 3. Direct Labor & Prime Cost */}
                <div className="space-y-1.5">
                  <div className="px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-900 font-bold flex justify-between">
                    <span>3. {lang === 'th' ? 'ค่าแรงครัว & Prime Cost (COGS + Kitchen Labor)' : 'Prime Cost'}</span>
                    <span>{mgrPnl.primeCostPercent.toFixed(1)}% (฿{formatMoney(mgrPnl.primeCost)})</span>
                  </div>
                  <div className="flex justify-between px-3 py-1 text-slate-700">
                    <span>{lang === 'th' ? 'หัก: ค่าแรงฝ่ายครัว (Direct Kitchen Labor)' : 'Direct Kitchen Labor'}</span>
                    <span className="text-indigo-700 font-semibold">-฿{formatMoney(periodDirectKitchenLabor)}</span>
                  </div>
                </div>

                {/* 4. Operating Expenses & Platform Fees */}
                <div className="space-y-1.5">
                  <div className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 font-bold uppercase tracking-wider">
                    4. {lang === 'th' ? 'ค่าใช้จ่ายดำเนินงาน & ค่าธรรมเนียมช่องทาง' : 'OPEX & Channel Commissions'}
                  </div>
                  <div className="flex justify-between px-3 py-1 text-slate-600">
                    <span>{lang === 'th' ? 'ค่าเช่าพื้นที่ สาธารณูปโภค และโสหุ้ยร้าน' : 'Rent, Utilities & Store OPEX'}</span>
                    <span>-฿{formatMoney(monthlyNormalizedOpex * periodMonthFactor)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-1 text-slate-600">
                    <span>{lang === 'th' ? 'ค่าแรงหน้าร้าน & บริหาร (FOH & Admin)' : 'FOH & Management Labor'}</span>
                    <span>-฿{formatMoney(periodNonKitchenLabor)}</span>
                  </div>
                  {usaliPeriodPnl.platformFees > 0 && (
                    <div className="flex justify-between px-3 py-1 text-slate-600">
                      <span>{t.reports.platformFees} (POS Delivery)</span>
                      <span>-฿{formatMoney(usaliPeriodPnl.platformFees)}</span>
                    </div>
                  )}
                </div>

                {/* 5. Operating & Net Profit */}
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <div className="flex justify-between px-3 py-2 rounded-lg bg-slate-50 font-bold text-slate-900">
                    <span>{lang === 'th' ? 'กำไรจากการดำเนินงาน (EBITDA)' : 'Operating Profit'} ({mgrPnl.operatingMarginPercent.toFixed(1)}%)</span>
                    <span>฿{formatMoney(mgrPnl.operatingProfit)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-1 text-amber-700">
                    <span>{lang === 'th' ? `หัก: ประมาณการภาษี (${incomeTaxRate}%)` : `Estimated Tax (${incomeTaxRate}%)`}</span>
                    <span>-฿{formatMoney(mgrPnl.taxAmount)}</span>
                  </div>
                  <div
                    className={`flex justify-between px-4 py-3 rounded-xl font-extrabold text-sm sm:text-base border ${
                      mgrPnl.netProfit >= 0
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}
                  >
                    <span>{lang === 'th' ? 'กำไรสุทธิ (Net Profit)' : 'Net Profit'} ({mgrPnl.netMarginPercent.toFixed(1)}%)</span>
                    <span>฿{formatMoney(mgrPnl.netProfit)}</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Dish Performance & Payment / Channel Breakdown */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-4 space-y-2.5">
                <h3 className="text-xs font-extrabold text-slate-800 uppercase flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-amber-500" />
                  <span>{t.reports.topBestSellers}</span>
                </h3>
                {bestSellers.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-400">{t.common.noData}</div>
                ) : (
                  bestSellers.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center p-2 bg-slate-50 rounded-xl text-xs">
                      <span className="font-semibold text-slate-800 truncate pr-2">#{idx + 1} {item.name}</span>
                      <span className="font-bold text-orange-600 tabular-nums whitespace-nowrap">{item.quantity} orders</span>
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-4 space-y-2.5">
                <h3 className="text-xs font-extrabold text-slate-800 uppercase flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                  <span>{t.reports.bestMarginDishes}</span>
                </h3>
                {bestMarginDishes.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-400">{t.common.noData}</div>
                ) : (
                  bestMarginDishes.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center p-2 bg-emerald-50/60 rounded-xl text-xs">
                      <span className="font-semibold text-slate-800 truncate pr-2">{item.name}</span>
                      <span className="font-bold text-emerald-700 tabular-nums whitespace-nowrap">{formatPercent(item.marginPct)}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-4 space-y-2.5">
                <h3 className="text-xs font-extrabold text-slate-800 uppercase flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <span>{t.reports.worstMarginDishes}</span>
                </h3>
                {worstMarginDishes.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-400">{t.common.noData}</div>
                ) : (
                  worstMarginDishes.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center p-2 bg-rose-50/60 rounded-xl text-xs">
                      <span className="font-semibold text-slate-800 truncate pr-2">{item.name}</span>
                      <span className="font-bold text-rose-700 tabular-nums whitespace-nowrap">{formatPercent(item.marginPct)}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-4 space-y-2 text-xs">
                <h3 className="font-extrabold text-slate-800 uppercase flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-slate-600" />
                  <span>{t.reports.salesByPayment}</span>
                </h3>
                <div className="space-y-1.5 tabular-nums">
                  {Object.entries(paymentTotals).map(([method, amount]) => (
                    <div key={method} className="flex justify-between p-2.5 bg-slate-50 rounded-xl">
                      <span className="capitalize font-semibold text-slate-700">{method}</span>
                      <span className="font-bold text-slate-900">฿{formatMoney(amount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-4 space-y-2 text-xs">
                <h3 className="font-extrabold text-slate-800 uppercase flex items-center gap-1.5">
                  <Store className="w-4 h-4 text-slate-600" />
                  <span>{t.reports.salesByChannel}</span>
                </h3>
                <div className="space-y-1.5 tabular-nums">
                  {Object.keys(channelSales).length === 0 ? (
                    <div className="py-4 text-center text-slate-400">{t.common.noData}</div>
                  ) : (
                    Object.entries(channelSales).map(([ch, st]) => (
                      <div key={ch} className="flex justify-between p-2.5 bg-slate-50 rounded-xl">
                        <span className="capitalize font-semibold text-slate-700">
                          {ch} ({st.orderCount} orders)
                        </span>
                        <span className="font-bold text-slate-900">฿{formatMoney(st.netSales)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          </div>
        )}

        {/* =========================================================
            TAB 3: DAILY SALES LEDGER
           ========================================================= */}
        {activeTab === 'sales' && (
          <div className="tonycost-workspace rounded-2xl bg-white/95 border border-slate-200/90 p-5 sm:p-6">
            <SalesEntryView
              sales={costDailySales}
              channels={DEFAULT_SALES_CHANNELS}
              onAddSalesRecord={handleAddSalesRecord}
              onDeleteSalesRecord={handleDeleteSalesRecord}
              defaultVatRate={settings.vatPercent ?? 7}
              activeLanguage={lang}
            />
          </div>
        )}

        {/* =========================================================
            TAB 4: EXPENSES & OVERHEAD
           ========================================================= */}
        {activeTab === 'expenses' && (
          <div className="tonycost-workspace rounded-2xl bg-white/95 border border-slate-200/90 p-5 sm:p-6">
            <ExpensesView
              expenses={unifiedExpenses}
              onAddExpense={handleAddExpense}
              onDeleteExpense={handleDeleteExpense}
              onUpdateExpense={handleUpdateExpense}
              operatingDays={operatingDays}
              activeLanguage={lang}
            />
          </div>
        )}

        {/* =========================================================
            TAB 5: LABOR & PAYROLL
           ========================================================= */}
        {activeTab === 'labor' && (
          <div className="tonycost-workspace rounded-2xl bg-white/95 border border-slate-200/90 p-5 sm:p-6">
            <LaborView
              employees={unifiedEmployees}
              monthlyNetSales={effectiveNetSalesForMgr}
              onAddEmployee={handleAddEmployee}
              onDeleteEmployee={handleDeleteEmployee}
              activeLanguage={lang}
            />
          </div>
        )}

        {/* =========================================================
            TAB 6: BREAK-EVEN & TARGETS
           ========================================================= */}
        {activeTab === 'breakeven' && (
          <div className="tonycost-workspace rounded-2xl bg-white/95 border border-slate-200/90 p-5 sm:p-6">
            <BreakEvenView
              key={`${unifiedExpenses.length}-${unifiedEmployees.length}-${Math.round(monthlyFixedExpensesOnly + totalMonthlyStaffPayroll)}-${operatingDays}`}
              expenses={unifiedExpenses}
              employees={unifiedEmployees}
              sales={costDailySales}
              settings={costSettings as any}
              activeLanguage={lang}
            />
          </div>
        )}
      </div>
    </div>
  );
};
