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
  ShieldCheck,
  ExternalLink,
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
  OptionGroupDoc,
  OnlineOrderDoc,
  Language,
} from '../types';
import { translations } from '../i18n/translations';
import {
  formatMoney,
  formatPercent,
  getBusinessWorkDate,
  getMonthDateRange,
  calculateDishVariantCost,
  calculateExVatFoodCostPercent,
  extractNetPriceFromMenuPrice,
  buildPeriodPnl,
  calculateEmployeeMonthlyCost,
  getEmployeeMonthlyCost,
  deriveVariableCostPercent,
  normalizeToMonthly,
  formatPeriodCalculationLabel,
  isExplicitPayrollExpense,
  calculateWeightedFoodCostPercent,
  isDateInPeriod,
  buildPnlCsvRows,
} from '../engine/calculations';
import { auditDataHealth, DataHealthCheckId } from '../engine/dataHealth';
import {
  subscribeCollection,
  subscribeDailySummariesInRange,
  subscribeSingleDailySummary,
  saveDocument,
  deleteDocument,
} from '../data/db';
import {
  subscribeOwnerOnlineOrders,
  syncCompletedOnlineOrdersToPnl,
} from '../data/onlineDb';
import {
  Ingredient,
  Sauce,
  MenuItem,
  RestaurantSettings,
  SaleOrder,
  InventoryItem,
  WasteRecord,
  PurchaseRecord,
  StockCountSnapshot,
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
  calculateDetailedBreakEven,
  convertExpenseToMonthly,
  upsertDailySalesRecord,
  normalizeUpsertChannelId,
} from '../costing/engine/calculations';
import { calculateVariantCostBreakdown, getEffectiveDeliveryGpPercent } from '../costing/services/calculationEngine';
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
  | 'breakeven'
  | 'health';

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

const isPayrollExpenseRecord = isExplicitPayrollExpense;

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
  const [excludePayrollDuplicates, setExcludePayrollDuplicates] = useState<boolean>(true);
  const [assumedCmPercent, setAssumedCmPercent] = useState<number>(0);
  const [salesChannels, setSalesChannels] = useState<SalesChannel[]>(DEFAULT_SALES_CHANNELS);

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
  const [optionGroups, setOptionGroups] = useState<OptionGroupDoc[]>([]);
  const [onlineOrders, setOnlineOrders] = useState<OnlineOrderDoc[]>([]);

  // Costing real-time collections
  const [costSettings, setCostSettings] = useState<RestaurantSettings>(() => StorageService.getSettings());
  const [costIngredients, setCostIngredients] = useState<Ingredient[]>(() => StorageService.getIngredients());
  const [costSauces, setCostSauces] = useState<Sauce[]>(() => StorageService.getSauces());
  const [costMenus, setCostMenus] = useState<MenuItem[]>(() => StorageService.getMenus());
  const [costExpenses, setCostExpenses] = useState<ExpenseRecord[]>(
    () => StorageService.getExpenses()
  );
  const [costEmployees, setCostEmployees] = useState<CostEmployee[]>(
    () => StorageService.getEmployees()
  );
  const [costDailySales, setCostDailySales] = useState<DailySalesRecord[]>(() => StorageService.getDailySales());
  const [inventory, setInventory] = useState<InventoryItem[]>(() => StorageService.getInventory());
  const [purchases, setPurchases] = useState<PurchaseRecord[]>(() => StorageService.getPurchases());
  const [wasteLog, setWasteLog] = useState<WasteRecord[]>(() => StorageService.getWasteLog());
  const [salesOrders, setSalesOrders] = useState<SaleOrder[]>(() => StorageService.getSalesOrders());
  const [stockCounts, setStockCounts] = useState<StockCountSnapshot[]>(() => StorageService.getStockCounts());

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
        subscribeCollection<OptionGroupDoc>('optionGroups', (g) => isMounted && setOptionGroups(g)),
        subscribeOwnerOnlineOrders(user.uid, (orders) => isMounted && setOnlineOrders(orders)),

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
              StorageService.saveExpenses(items);
            }
          }
        ),
        FirebaseSyncService.subscribeUserCollection<CostEmployee>(
          user.uid,
          COST_COLLECTIONS.EMPLOYEES,
          (items) => {
            if (isMounted) {
              setCostEmployees(items);
              StorageService.saveEmployees(items);
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
        ),
        FirebaseSyncService.subscribeUserCollection<StockCountSnapshot>(
          user.uid,
          COST_COLLECTIONS.STOCK_COUNTS,
          (items) => {
            if (isMounted) {
              setStockCounts(items);
              StorageService.saveStockCounts(items);
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

  // Auto-sync any Rider/Owner completed online orders not yet reflected in P&L
  useEffect(() => {
    if (!user?.uid || onlineOrders.length === 0) return;
    const hasUnsyncedCompleted = onlineOrders.some(
      (o) => o.status === 'completed' && !o.pnlSyncedAt
    );
    if (!hasUnsyncedCompleted) return;
    syncCompletedOnlineOrdersToPnl({
      uid: user.uid,
      orders: onlineOrders,
      settings,
      dishes,
      optionGroups,
      ingredients: posIngredients,
      subRecipes,
      packaging: packagings,
    }).catch((err) => {
      console.warn('Online orders auto-sync to P&L warning:', err);
    });
  }, [user?.uid, onlineOrders, settings, dishes, optionGroups, posIngredients, subRecipes, packagings]);

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
          ...(posE.isPayroll !== undefined ? { isPayroll: posE.isPayroll } : {}),
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

  const payrollFlaggedExpenses = useMemo(
    () => unifiedExpenses.filter((e) => !e.isExcluded && isExplicitPayrollExpense(e)),
    [unifiedExpenses]
  );
  const hasDuplicatePayroll = unifiedEmployees.length > 0 && payrollFlaggedExpenses.length > 0;

  // Normalized POS ExpenseDoc[] and EmployeeDoc[] synchronized from unified lists
  const unifiedPosExpenses = useMemo<ExpenseDoc[]>(() => {
    return unifiedExpenses
      .filter(
        (e) =>
          !e.isExcluded &&
          !(hasDuplicatePayroll && excludePayrollDuplicates && isExplicitPayrollExpense(e))
      )
      .map((e) => {
        const isRecurring = Boolean(e.recurring ?? e.isFixed);
        const rawAmount = isRecurring
          ? convertExpenseToMonthly(e, operatingDays)
          : Number(e.amount) || 0;
        return {
          id: e.id,
          title: e.description,
          titleTh: e.description,
          category: mapCostCategoryToPos(e.category),
          amount: rawAmount,
          date: e.date,
          endDate: e.endDate,
          isFixed: Boolean(e.isFixed),
          isRecurring,
          ...(e.isPayroll !== undefined ? { isPayroll: e.isPayroll } : {}),
          createdAt: e.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        };
      });
  }, [unifiedExpenses, hasDuplicatePayroll, excludePayrollDuplicates, operatingDays]);

  const unifiedPosEmployees = useMemo<EmployeeDoc[]>(() => {
    return unifiedEmployees.map((emp) => {
      const rawRate = emp.wageRate ?? emp.baseSalary ?? emp.hourlyRate ?? 0;
      const hasBaseRate = rawRate > 0;
      const wageType: EmployeeDoc['wageType'] =
        !hasBaseRate && typeof emp.monthlyCost === 'number' && emp.monthlyCost > 0
          ? 'monthly'
          : emp.type === 'hourly' || emp.employmentType === 'hourly'
          ? 'hourly'
          : emp.type === 'daily'
          ? 'daily'
          : 'monthly';
      const wageAmount = hasBaseRate ? rawRate : emp.monthlyCost || 0;
      return {
        id: emp.id,
        name: emp.name,
        role: emp.role || emp.position || 'Staff',
        department: emp.department,
        roleCategory: emp.roleCategory,
        wageType,
        wageAmount,
        workDaysOrHoursPerMonth:
          emp.standardHoursPerMonth ||
          emp.hoursPerMonth ||
          (wageType === 'hourly' ? 208 : operatingDays),
        benefitsMonthly: emp.benefitsMonthly || 0,
        overtimeHoursMonthly: emp.overtimeHoursMonthly || 0,
        overtimeRateMultiplier: emp.overtimeRateMultiplier || 1.5,
        isActive: emp.active !== false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };
    });
  }, [unifiedEmployees, operatingDays]);

  // Per-portion dine-in menu breakdown (no takeaway packaging box, ex-VAT denominator, uncapped profit)
  const getMenuPortions = useMemo(() => {
    const ingMap = new Map(costIngredients.map((i) => [i.id, i]));
    const sauceMap = new Map(costSauces.map((s) => [s.id, s]));
    type HubPortionSummary = {
      id: string;
      name: string;
      directFoodCost: number;
      packagingCost: number;
      totalDirectCost: number;
      sellingPrice: number;
      netSellingPrice?: number;
      foodCostPercent: number;
      contributionProfit: number;
    };
    type HubMenuLike = MenuItem & { portions?: HubPortionSummary[] };

    return (menu: HubMenuLike): HubPortionSummary[] => {
      if (!menu) return [];
      if (Array.isArray(menu.portions) && menu.portions.length > 0) return menu.portions;
      if (Array.isArray(menu.variants) && menu.variants.length > 0) {
        const vatPct = costSettings.vatRatePercent ?? settings.vatPercent ?? 7;
        const scIncludedDefault = Boolean(
          costSettings.serviceChargeIncludedInPrice ?? settings.serviceChargeIncludedInPrice
        );
        const scPctDefault = costSettings.serviceChargePercent ?? settings.serviceChargePercent ?? 0;
        const defaultPricesIncludeVat = Boolean(
          costSettings.pricesIncludeVat ??
            costSettings.salesVatInclusive ??
            settings.pricesIncludeVat
        );

        return menu.variants.map((v) => {
          let directFoodCost = 0;
          let sellingPrice = v.sellingPrice || 0;
          try {
            if (v.recipeItems && v.recipeItems.length > 0) {
              const bd = calculateVariantCostBreakdown(
                v,
                menu.name || menu.thaiName || '',
                ingMap,
                sauceMap,
                costSettings
              );
              directFoodCost = bd.totalFoodCost || bd.totalIngredientCost || 0;
              sellingPrice = bd.sellingPrice || sellingPrice;
            } else if (typeof v.directFoodCost === 'number') {
              directFoodCost = v.directFoodCost;
            }
          } catch {
            directFoodCost = v.directFoodCost || 0;
          }

          // Dine-in has 0 packaging box cost; extract VAT & included SC before % / profit calculation
          const packagingCost = 0;
          const totalDirectCost = directFoodCost;
          const isVatInc =
            v.taxType === 'INCLUSIVE' ||
            (v.taxType !== 'EXCLUSIVE' && v.taxType !== 'NONE' && defaultPricesIncludeVat);
          const netSellingPrice = extractNetPriceFromMenuPrice(
            sellingPrice,
            isVatInc,
            vatPct,
            scIncludedDefault,
            scPctDefault
          );
          const foodCostPercent = netSellingPrice > 0 ? (directFoodCost / netSellingPrice) * 100 : 0;
          const contributionProfit = netSellingPrice - totalDirectCost;

          return {
            id: v.id,
            name: v.name || v.proteinType || 'มาตรฐาน',
            directFoodCost,
            packagingCost,
            totalDirectCost,
            sellingPrice,
            netSellingPrice,
            foodCostPercent,
            contributionProfit,
          };
        });
      }
      return [];
    };
  }, [costIngredients, costSauces, costSettings, settings.vatPercent, settings.serviceChargeIncludedInPrice, settings.serviceChargePercent, settings.pricesIncludeVat]);

  // Real sales-weighted Food Cost % across POS summaries in the selected period (never unweighted catalog mean)
  const weightedFoodCostResult = useMemo(
    () =>
      calculateWeightedFoodCostPercent(periodSummaries, {
        pricesIncludeVat: Boolean(
          costSettings.pricesIncludeVat ??
            costSettings.salesVatInclusive ??
            settings.pricesIncludeVat
        ),
        vatPercent: costSettings.vatRatePercent ?? settings.vatPercent ?? 7,
        serviceChargeIncludedInPrice: Boolean(
          costSettings.serviceChargeIncludedInPrice ?? settings.serviceChargeIncludedInPrice
        ),
        serviceChargePercent: costSettings.serviceChargePercent ?? settings.serviceChargePercent ?? 0,
      }),
    [periodSummaries, costSettings, settings]
  );
  const avgFoodCostPercent: number | null = weightedFoodCostResult.foodCostPercent;

  const dateParam = period === 'day' ? selectedDate : period === 'month' ? selectedMonth : selectedYear;

  const incomeTaxRate =
    typeof costSettings.incomeTaxRatePercent === 'number' &&
    Number.isFinite(costSettings.incomeTaxRatePercent)
      ? costSettings.incomeTaxRatePercent
      : typeof settings.incomeTaxRatePercent === 'number' && Number.isFinite(settings.incomeTaxRatePercent)
      ? settings.incomeTaxRatePercent
      : 20;

  // Keep inventory prop referenced cleanly
  void inventory;

  const socialSecurityEnabled = Boolean(
    costSettings.socialSecurityEnabled ?? settings.socialSecurityEnabled ?? false
  );
  const socialSecurityRatePercent = Number(
    costSettings.socialSecurityRatePercent ?? settings.socialSecurityRatePercent ?? 5
  );
  const socialSecurityCapWage = Number(
    costSettings.socialSecurityCapWage ?? settings.socialSecurityCapWage ?? 15000
  );

  // Single Source of Truth P&L for Selected Period (uses date-scoped StockCountSnapshot + period-filtered purchases/waste)
  const periodPnl = useMemo(
    () =>
      buildPeriodPnl({
        summaries: periodSummaries,
        manualSales: costDailySales,
        expenses: unifiedPosExpenses,
        employees: unifiedPosEmployees,
        period,
        dateParam,
        settings: {
          ...settings,
          incomeTaxRatePercent: incomeTaxRate,
          cogsVarianceThresholdPercent: costSettings.cogsVarianceThresholdPercent ?? 3.0,
          socialSecurityEnabled,
          socialSecurityRatePercent,
          socialSecurityCapWage,
        },
        cogsMode,
        stockCountSnapshots: stockCounts,
        purchases,
        wasteLog,
        ingredients: costIngredients,
        salesOrders,
        todayDate: todayStr,
        manualFallbackRates: {
          foodCostPercent: avgFoodCostPercent,
        },
      }),
    [
      periodSummaries,
      costDailySales,
      unifiedPosExpenses,
      unifiedPosEmployees,
      period,
      dateParam,
      settings,
      incomeTaxRate,
      costSettings,
      socialSecurityEnabled,
      socialSecurityRatePercent,
      socialSecurityCapWage,
      cogsMode,
      stockCounts,
      purchases,
      wasteLog,
      costIngredients,
      salesOrders,
      todayStr,
      avgFoodCostPercent,
    ]
  );

  // Single Source of Truth P&L for Today Live POS KPI
  const todaySummariesArr = useMemo(() => (todaySummary ? [todaySummary] : []), [todaySummary]);
  const todayPnl = useMemo(
    () =>
      buildPeriodPnl({
        summaries: todaySummariesArr,
        manualSales: costDailySales,
        expenses: unifiedPosExpenses,
        employees: unifiedPosEmployees,
        period: 'day',
        dateParam: todayStr,
        settings: {
          ...settings,
          incomeTaxRatePercent: incomeTaxRate,
          cogsVarianceThresholdPercent: costSettings.cogsVarianceThresholdPercent ?? 3.0,
          socialSecurityEnabled,
          socialSecurityRatePercent,
          socialSecurityCapWage,
        },
        cogsMode: 'estimated',
        todayDate: todayStr,
        manualFallbackRates: {
          foodCostPercent: avgFoodCostPercent,
        },
      }),
    [
      todaySummariesArr,
      costDailySales,
      unifiedPosExpenses,
      unifiedPosEmployees,
      todayStr,
      settings,
      incomeTaxRate,
      costSettings,
      socialSecurityEnabled,
      socialSecurityRatePercent,
      socialSecurityCapWage,
      avgFoodCostPercent,
    ]
  );

  const theoreticalSalesOrdersCost = periodPnl.theoreticalFoodCogs;
  const varianceAmount = periodPnl.varianceAmount;
  const varianceThresholdPercent = costSettings.cogsVarianceThresholdPercent ?? 3.0;
  const isVarianceExceeded = periodPnl.hasCompleteStockSnapshots && periodPnl.varianceStatus !== 'ON_TRACK';

  // Real Break-Even using Monthly Fixed Overhead (honoring endDate) + All Active Staff Payroll
  const currentMonthKey = todayStr.substring(0, 7);
  const monthlyFixedExpensesOnly = useMemo(
    () =>
      unifiedPosExpenses
        .filter(
          (e) =>
            e.isFixed !== false &&
            (!e.isRecurring ||
              ((e.date || '').substring(0, 7) <= currentMonthKey &&
                (!e.endDate || e.endDate.substring(0, 7) >= currentMonthKey)))
        )
        .reduce((sum, e) => sum + e.amount, 0),
    [unifiedPosExpenses, currentMonthKey]
  );
  const monthlyVariableExpensesOnly = useMemo(
    () =>
      unifiedPosExpenses
        .filter(
          (e) =>
            e.isFixed === false &&
            (!e.isRecurring ||
              ((e.date || '').substring(0, 7) <= currentMonthKey &&
                (!e.endDate || e.endDate.substring(0, 7) >= currentMonthKey)))
        )
        .reduce((sum, e) => sum + e.amount, 0),
    [unifiedPosExpenses, currentMonthKey]
  );
  const totalMonthlyStaffPayroll = useMemo(
    () =>
      unifiedPosEmployees.reduce(
        (sum, emp) =>
          sum +
          calculateEmployeeMonthlyCost(emp, {
            socialSecurityEnabled,
            socialSecurityRatePercent,
            socialSecurityCapWage,
            defaultOperatingDays: operatingDays,
          }),
        0
      ),
    [
      unifiedPosEmployees,
      socialSecurityEnabled,
      socialSecurityRatePercent,
      socialSecurityCapWage,
      operatingDays,
    ]
  );
  const derivedMargin30d = useMemo(
    () =>
      deriveVariableCostPercent(last30Summaries, {
        otherVariableCostAmount: monthlyVariableExpensesOnly,
      }),
    [last30Summaries, monthlyVariableExpensesOnly]
  );
  const isExecutiveCmAssumed = !derivedMargin30d.hasRealData;
  const liveCMPercent = derivedMargin30d.hasRealData
    ? derivedMargin30d.contributionMarginPercent
    : avgFoodCostPercent !== null
    ? Math.max(0, 100 - avgFoodCostPercent)
    : assumedCmPercent;
  const avgTicketForBe =
    periodPnl.avgOrderValue > 0
      ? periodPnl.avgOrderValue
      : costSettings.defaultTicketSize ?? settings.defaultTicketSize ?? 0;

  // Normalize selected period net sales to monthly equivalent so Break-Even Safety Margin matches monthly target
  const monthlyNormalizedNetSales = useMemo(
    () => normalizeToMonthly(periodPnl.netSalesExVat, period, periodPnl.coveredMonths, dateParam),
    [periodPnl.netSalesExVat, period, periodPnl.coveredMonths, dateParam]
  );

  const periodSalesLabel = useMemo(
    () => formatPeriodCalculationLabel(period, dateParam, lang),
    [period, dateParam, lang]
  );

  const periodFilteredCostSales = useMemo(() => {
    if (period === 'day') return costDailySales.filter((s) => s.date === selectedDate);
    if (period === 'month') return costDailySales.filter((s) => s.date?.startsWith(selectedMonth));
    return costDailySales.filter((s) => s.date?.startsWith(selectedYear));
  }, [costDailySales, period, selectedDate, selectedMonth, selectedYear]);

  const executiveBreakEven = calculateDetailedBreakEven(
    monthlyFixedExpensesOnly + totalMonthlyStaffPayroll,
    liveCMPercent,
    avgTicketForBe,
    operatingDays,
    0,
    monthlyNormalizedNetSales
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
        const pct = calculateExVatFoodCostPercent(calc.foodCost, netPrice);
        if (pct > settings.targetFoodCostPercent) {
          aboveTarget.push({ dish, costPct: pct });
        }
      }
    }
    return { dishesWithoutRecipe: noRecipe, dishesAboveTarget: aboveTarget, dishesWithMissingCost: missingCost };
  }, [dishes, posIngredients, subRecipes, packagings, settings]);

  // 6-Point Data Health Audit
  const dataHealthReport = useMemo(
    () =>
      auditDataHealth({
        period,
        dateParam,
        todayDate: todayStr,
        costIngredients,
        posIngredients,
        costMenus,
        posDishes: dishes,
        manualSales: costDailySales,
        stockCountSnapshots: stockCounts,
        expenses: unifiedExpenses,
        employees: unifiedEmployees,
        excludePayrollDuplicates,
        costSauces,
        posSubRecipes: subRecipes,
      }),
    [
      period,
      dateParam,
      todayStr,
      costIngredients,
      posIngredients,
      costMenus,
      dishes,
      costDailySales,
      stockCounts,
      unifiedExpenses,
      unifiedEmployees,
      excludePayrollDuplicates,
      costSauces,
      subRecipes,
    ]
  );

  // Actionable Business Recommendations
  const advices = useMemo<WhatShouldIDoAdvice[]>(() => {
    const list: WhatShouldIDoAdvice[] = [];
    const targetFC = costSettings.defaultTargetFoodCostPercent || settings.targetFoodCostPercent || 35;

    const highCostPortion = costMenus
      .flatMap((m) => getMenuPortions(m).map((p) => ({ menu: m, portion: p })))
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

    const grabGp = getEffectiveDeliveryGpPercent(costSettings, 'grab');
    const hasGpVat =
      costSettings.commissionVatAsCost ??
      costSettings.grabFoodCommissionHasVat ??
      true;
    list.push({
      id: 'adv-delivery',
      type: 'WARNING',
      category: 'Delivery Loss',
      titleTh: hasGpVat
        ? `ค่า GP เดลิเวอรีรวม VAT อยู่ที่ ${grabGp.toFixed(1)}%`
        : `ค่า GP เดลิเวอรีอยู่ที่ ${grabGp.toFixed(1)}%`,
      titleEn: hasGpVat
        ? `Effective Delivery GP + VAT is ${grabGp.toFixed(1)}%`
        : `Effective Delivery GP is ${grabGp.toFixed(1)}%`,
      descriptionTh: 'ควรตั้งราคาขายบนแอป Delivery สูงกว่าหน้าร้านเพื่อชดเชยค่าคอมมิชชั่นและคงกำไรสุทธิ',
      descriptionEn: 'Ensure delivery menu markup covers platform GP to preserve net margin.',
      actionRecommendationTh: 'ตั้งราคา Delivery Markup',
      actionRecommendationEn: 'Configure delivery markup',
      metricLabel: hasGpVat ? 'GP + VAT' : 'GP',
      metricValue: `${grabGp.toFixed(1)}%`,
      relatedEntityType: 'channel',
    });

    if (executiveBreakEven.isValid && executiveBreakEven.breakEvenDailySales > 0) {
      const daysWithSales = Math.max(1, periodSummaries.length || new Set(costDailySales.map((s) => s.date)).size);
      const actualDailyAvg = periodPnl.netSalesExVat / daysWithSales;
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
    periodPnl.netSalesExVat,
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
      if (exp.isExcluded || (hasDuplicatePayroll && excludePayrollDuplicates && isPayrollExpenseRecord(exp))) {
        await deleteDocument('expenses', exp.id).catch(() => {});
        return;
      }
      const isRecurring = Boolean(exp.recurring ?? exp.isFixed);
      const posDoc: ExpenseDoc = {
        id: exp.id,
        title: exp.description,
        titleTh: exp.description,
        category: mapCostCategoryToPos(exp.category),
        amount: isRecurring ? convertExpenseToMonthly(exp, operatingDays) : Number(exp.amount) || 0,
        date: exp.date,
        ...(exp.endDate ? { endDate: exp.endDate } : {}),
        isFixed: Boolean(exp.isFixed),
        isRecurring,
        ...(exp.isPayroll !== undefined ? { isPayroll: exp.isPayroll } : {}),
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
        ...(emp.department ? { department: emp.department } : {}),
        ...(emp.roleCategory ? { roleCategory: emp.roleCategory } : {}),
        wageType: emp.type === 'hourly' ? 'hourly' : emp.type === 'daily' ? 'daily' : 'monthly',
        wageAmount: emp.wageRate ?? emp.baseSalary ?? 0,
        workDaysOrHoursPerMonth: emp.standardHoursPerMonth || operatingDays,
        benefitsMonthly: emp.benefitsMonthly || 0,
        overtimeHoursMonthly: emp.overtimeHoursMonthly || 0,
        overtimeRateMultiplier: emp.overtimeRateMultiplier || 1.5,
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

  const handleAddSalesRecord = (rec: DailySalesRecord, replacedPosRecordId?: string) => {
    const cleanedCurrent = replacedPosRecordId
      ? costDailySales.filter((s) => s.id !== replacedPosRecordId)
      : costDailySales;
    const nextCurrent = upsertDailySalesRecord(cleanedCurrent, rec);
    const targetCh = normalizeUpsertChannelId(rec.channelId);
    const savedRecord =
      nextCurrent.find(
        (r) => r.date === rec.date && normalizeUpsertChannelId(r.channelId) === targetCh
      ) || rec;

    setCostDailySales((prev) => {
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

  const handleDeleteSalesRecord = (id: string) => {
    setCostDailySales((prev) => prev.filter((s) => s.id !== id));
    FirebaseSyncService.deleteUserDoc(user.uid, COST_COLLECTIONS.DAILY_SALES, id);
  };

  const handleExportCsv = () => {
    const rows = buildPnlCsvRows(periodPnl, executiveBreakEven.breakEvenSales);
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
    { id: 'health', labelTh: 'ตรวจสุขภาพข้อมูล', labelEn: 'Data Health', icon: <ShieldCheck className="w-4 h-4" /> },
  ];

  const targetFoodCostPct = costSettings.defaultTargetFoodCostPercent || settings.targetFoodCostPercent || 30;
  const targetPrimeCostPct = costSettings.primeCostTargetPercent || 55;
  const effectiveFoodCostPct = periodPnl.foodCostPercent;

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
                  {tab.id === 'health' && dataHealthReport.totalIssueCount > 0 && (
                    <span
                      className={`text-[10px] font-extrabold tabular-nums ${
                        isActive ? 'text-white/95' : 'text-amber-600'
                      }`}
                    >
                      ({dataHealthReport.totalIssueCount})
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {(activeTab === 'overview' || activeTab === 'pnl' || activeTab === 'labor' || activeTab === 'breakeven' || activeTab === 'health') && (
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

        {/* Payroll Overlap Explicit Warning Banner */}
        {hasDuplicatePayroll && ['overview', 'pnl', 'expenses', 'labor', 'breakeven'].includes(activeTab) && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start sm:items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <span className="font-bold">
                  {lang === 'th'
                    ? `ตรวจพบรายการค่าใช้จ่ายที่ระบุเป็น Payroll (${payrollFlaggedExpenses.length} รายการ) ซ้อนกับทะเบียนพนักงาน (${unifiedEmployees.length} คน)`
                    : `Detected ${payrollFlaggedExpenses.length} Payroll-flagged expense(s) alongside ${unifiedEmployees.length} staff records`}
                </span>
                <span className="block text-[11px] text-amber-800">
                  {excludePayrollDuplicates
                    ? lang === 'th'
                      ? 'ระบบตัดรายการค่าใช้จ่าย Payroll ออกชั่วคราวเพื่อป้องกันการนับค่าแรงซ้ำ'
                      : 'Excluded from OPEX by default to avoid double-counting payroll.'
                    : lang === 'th'
                    ? 'คำเตือน: กำลังนับรวมทั้งรายการค่าใช้จ่าย Payroll และทะเบียนพนักงาน'
                    : 'Warning: Currently including both payroll expenses and employee payroll.'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setExcludePayrollDuplicates((prev) => !prev)}
              className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 text-amber-900 font-bold hover:bg-amber-100 cursor-pointer shrink-0 text-[11px]"
            >
              {excludePayrollDuplicates
                ? lang === 'th' ? 'คลิกเพื่อนำกลับมานับรวม' : 'Include Anyway'
                : lang === 'th' ? 'ตัดรายการซ้ำออก (แนะนำ)' : 'Exclude Duplicates'}
            </button>
          </div>
        )}

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
                    {todayPnl.orderCount} {lang === 'th' ? 'บิล' : 'orders'}
                  </span>
                </div>
                <div className="mt-2.5 text-2xl font-bold text-slate-900 tabular-nums">
                  ฿{formatMoney(todayPnl.netSalesExVat)}
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 tabular-nums">
                  {lang === 'th'
                    ? `กำไรจากการดำเนินงานวันนี้: ฿${formatMoney(todayPnl.operatingProfit)}`
                    : `Today Operating Profit: ฿${formatMoney(todayPnl.operatingProfit)}`}
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
                  ฿{formatMoney(periodPnl.netSalesExVat)}
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 tabular-nums">
                  {periodPnl.orderCount} orders · {lang === 'th' ? 'เฉลี่ย' : 'Avg'} ฿{formatMoney(periodPnl.avgOrderValue)}
                </div>
              </div>

              {/* 3. Food Cost % */}
              {(() => {
                const hasAnySales = periodPnl.netSalesExVat > 0 || weightedFoodCostResult.hasSalesData;
                return (
                  <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                        <Percent className="w-3.5 h-3.5 text-amber-600" />
                        <span>Food Cost %</span>
                      </span>
                      <span
                        className={`text-[11px] font-semibold ${
                          !hasAnySales
                            ? 'text-slate-500'
                            : periodPnl.cogsStatus === 'incomplete'
                            ? 'text-amber-700'
                            : effectiveFoodCostPct > targetFoodCostPct
                            ? 'text-rose-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {!hasAnySales
                          ? lang === 'th' ? 'ยังไม่มีข้อมูลขาย' : 'No sales data'
                          : periodPnl.cogsStatus === 'incomplete'
                          ? lang === 'th' ? 'ข้อมูลไม่ครบ' : 'Incomplete'
                          : periodPnl.cogsStatus === 'estimated'
                          ? lang === 'th' ? 'ประมาณการ' : 'Estimated'
                          : effectiveFoodCostPct > targetFoodCostPct
                          ? lang === 'th' ? 'เกินเป้า' : 'Above Target'
                          : lang === 'th' ? 'ตามเกณฑ์' : 'Healthy'}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-baseline gap-2 tabular-nums">
                      {hasAnySales ? (
                        <>
                          <span className="text-2xl font-bold text-slate-900">{effectiveFoodCostPct.toFixed(1)}%</span>
                          <span className="text-xs text-slate-400">/ {targetFoodCostPct}%</span>
                        </>
                      ) : (
                        <span className="text-lg font-bold text-slate-500">
                          {lang === 'th' ? 'ยังไม่มีข้อมูลขาย' : 'No sales data'}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 tabular-nums">
                      COGS: ฿{formatMoney(periodPnl.foodCogs)}
                    </div>
                  </div>
                );
              })()}

              {/* 4. Prime Cost % */}
              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Prime Cost %</span>
                  </span>
                  <span
                    className={`text-[11px] font-semibold ${
                      periodPnl.primeCostPercent > targetPrimeCostPct ? 'text-rose-700' : 'text-emerald-700'
                    }`}
                  >
                    {periodPnl.primeCostPercent > targetPrimeCostPct
                      ? lang === 'th' ? 'ควรควบคุม' : 'High'
                      : lang === 'th' ? 'เหมาะสม' : 'Healthy'}
                  </span>
                </div>
                <div className="mt-2.5 flex items-baseline gap-2 tabular-nums">
                  <span className="text-2xl font-bold text-slate-900">{periodPnl.primeCostPercent.toFixed(1)}%</span>
                  <span className="text-xs text-slate-400">COGS+Labor</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 tabular-nums">
                  {lang === 'th' ? `เป้าหมาย ≤ ${targetPrimeCostPct}%` : `Target ≤ ${targetPrimeCostPct}%`} · ฿{formatMoney(periodPnl.primeCost)}
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
                    {periodPnl.grossMarginPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-2.5 text-2xl font-bold text-emerald-700 tabular-nums">
                  ฿{formatMoney(periodPnl.grossProfit)}
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
                  ฿{formatMoney(periodPnl.opex + periodPnl.totalLabor)}
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 tabular-nums">
                  {lang === 'th'
                    ? `ค่าแรง ฿${formatMoney(periodPnl.totalLabor)} · GP ช่องทาง ฿${formatMoney(periodPnl.channelFees)}`
                    : `Total Labor ฿${formatMoney(periodPnl.totalLabor)} · Channel Fees ฿${formatMoney(periodPnl.channelFees)}`}
                </div>
              </div>

              {/* 7. Net Profit */}
              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    {periodPnl.netProfit >= 0 ? (
                      <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5 text-rose-600" />
                    )}
                    <span>{lang === 'th' ? 'กำไรสุทธิ (หลังภาษี)' : 'Net Profit'}</span>
                  </span>
                  <span
                    className={`text-[11px] font-semibold tabular-nums ${
                      periodPnl.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {periodPnl.netMarginPercent.toFixed(1)}%
                  </span>
                </div>
                <div
                  className={`mt-2.5 text-2xl font-bold tabular-nums ${
                    periodPnl.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  ฿{formatMoney(periodPnl.netProfit)}
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 tabular-nums">
                  {lang === 'th'
                    ? `ภาษีประมาณ ${periodPnl.taxRatePercent}%: ฿${formatMoney(periodPnl.estimatedTax)}`
                    : `Est. Tax (${periodPnl.taxRatePercent}%): ฿${formatMoney(periodPnl.estimatedTax)}`}
                </div>
              </div>

              {/* 8. Break-Even Target */}
              <div className="rounded-2xl bg-white/90 border border-slate-200/90 p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <Scale className="w-3.5 h-3.5 text-orange-600" />
                    <span>{lang === 'th' ? 'จุดคุ้มทุนต่อเดือน' : 'Monthly Break-Even'}</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    {isExecutiveCmAssumed && liveCMPercent > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                        {lang === 'th' ? 'ค่าสมมติ' : 'Assumed'}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveTab('breakeven')}
                      className="text-[11px] font-semibold text-orange-600 hover:underline cursor-pointer"
                    >
                      {lang === 'th' ? 'จำลอง →' : 'Simulate →'}
                    </button>
                  </div>
                </div>
                <div className="mt-2.5 text-2xl font-bold text-slate-900 tabular-nums">
                  {executiveBreakEven.isValid
                    ? `฿${Math.round(executiveBreakEven.breakEvenSales).toLocaleString()}`
                    : lang === 'th'
                    ? 'รอข้อมูลขายจริง'
                    : 'Awaiting Sales'}
                </div>
                {isExecutiveCmAssumed && avgFoodCostPercent === null && (
                  <div className="mt-2 flex items-center gap-2 text-[11px]">
                    <span className="text-amber-700 font-semibold">CM% สมมติ:</span>
                    <input
                      type="number"
                      min={0}
                      max={95}
                      step={1}
                      value={assumedCmPercent || ''}
                      placeholder="0"
                      onChange={(e) => setAssumedCmPercent(Math.max(0, Math.min(95, Number(e.target.value) || 0)))}
                      className="w-16 px-2 py-0.5 text-xs bg-amber-50 border border-amber-300 rounded font-bold text-slate-900"
                    />
                    <span className="text-slate-500">%</span>
                  </div>
                )}
                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] font-semibold tabular-nums space-y-0.5">
                  {executiveBreakEven.isValid ? (
                    <div className={executiveBreakEven.safetyMarginPercent >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                      {lang === 'th'
                        ? `฿${Math.round(executiveBreakEven.breakEvenDailySales).toLocaleString()}/วัน · Margin ${executiveBreakEven.safetyMarginPercent >= 0 ? '+' : ''}${executiveBreakEven.safetyMarginPercent.toFixed(1)}%`
                        : `฿${Math.round(executiveBreakEven.breakEvenDailySales).toLocaleString()}/day · Safety ${executiveBreakEven.safetyMarginPercent >= 0 ? '+' : ''}${executiveBreakEven.safetyMarginPercent.toFixed(1)}%`}
                    </div>
                  ) : (
                    <div className="text-amber-700">
                      {lang === 'th' ? 'บันทึกยอดขายหรือระบุ CM% เพื่อคำนวณ' : 'Record sales or enter assumed CM%'}
                    </div>
                  )}
                  <div className="text-[10px] font-normal text-slate-400">
                    {periodSalesLabel}
                  </div>
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
                          const isLoss = (portion.contributionProfit ?? 0) < 0;
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
                              <td className={`py-2.5 px-3.5 text-right font-bold ${isLoss ? 'text-rose-600' : 'text-emerald-700'}`}>
                                ฿{(portion.contributionProfit ?? 0).toFixed(2)}
                              </td>
                              <td className="py-2.5 px-3.5 text-center font-semibold">
                                {isLoss ? (
                                  <span className="text-rose-700">{lang === 'th' ? 'ขาดทุน' : 'Loss'}</span>
                                ) : isHigh ? (
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
                      cogsMode === 'estimated'
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
                      cogsMode === 'actual'
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
                  {lang === 'th' ? 'สถานะต้นทุน:' : 'COGS Status:'}{' '}
                  <strong
                    className={
                      periodPnl.cogsStatus === 'complete'
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }
                  >
                    {periodPnl.hasCompleteStockSnapshots
                      ? periodPnl.cogsStatus === 'complete'
                        ? lang === 'th' ? 'ข้อมูลครบ' : 'Complete'
                        : lang === 'th' ? 'ประมาณการ' : 'Estimated'
                      : periodPnl.cogsLabel}
                  </strong>
                </span>
                <span>
                  Theoretical: <strong className="text-slate-900">฿{formatMoney(theoreticalSalesOrdersCost)}</strong>
                </span>
                {periodPnl.hasCompleteStockSnapshots ? (
                  <span className={isVarianceExceeded ? 'text-rose-700 font-bold' : 'text-emerald-700 font-semibold'}>
                    Variance: {varianceAmount >= 0 ? '+' : '-'}฿{formatMoney(Math.abs(varianceAmount))} ({periodPnl.variancePercentOfSales.toFixed(1)}% / {varianceThresholdPercent}%)
                  </span>
                ) : (
                  <span className="text-amber-700 font-semibold">
                    Variance: ยังไม่มีผลนับสต็อกปิดงวด
                  </span>
                )}
                {periodPnl.wasteMemo > 0 && (
                  <span className="text-rose-700">
                    Waste Memo: ฿{formatMoney(periodPnl.wasteMemo)}
                  </span>
                )}
              </div>
            </div>

            {!periodPnl.hasCompleteStockSnapshots && (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-sky-600 shrink-0" />
                  <span>
                    <strong>ประมาณการจากสูตร ยังไม่มีการนับสต็อก</strong> — แนะนำให้ไปที่คลังสินค้าแล้วกด{' '}
                    <button
                      type="button"
                      onClick={() => onNavigatePage('cost_inventory')}
                      className="underline font-bold text-sky-700 hover:text-sky-900 cursor-pointer"
                    >
                      นับสต็อกใหม่หนึ่งครั้ง
                    </button>{' '}
                    เพื่อบันทึกสต็อกปิดงวดและเปรียบเทียบ Actual COGS
                  </span>
                </div>
              </div>
            )}

            {periodPnl.uncostedManualSalesWarning && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="font-semibold">{periodPnl.uncostedManualSalesWarning}</span>
              </div>
            )}

            {(periodPnl.hasEstimatedChannelAllocation ||
              costDailySales.some(
                (r) => r.estimatedAllocation && isDateInPeriod(r.date, period, dateParam)
              )) && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  <strong>ข้อมูลช่องทางบางส่วนเป็นการประมาณการตามสัดส่วน</strong> — สรุปยอด POS เดิมไม่มีข้อมูลส่วนลด/ค่า GP/Service Charge แยกต่อช่องทาง แนะนำกด Rebuild Daily Summaries ในหน้าตั้งค่าเมื่อต้องการแยกยอดจริงระดับบิล
                </span>
              </div>
            )}

            {periodPnl.cogsStatus !== 'complete' && periodPnl.statusReasons.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  <strong>
                    {periodPnl.cogsStatus === 'incomplete'
                      ? lang === 'th' ? 'ข้อมูลไม่ครบ: ' : 'Incomplete data: '
                      : lang === 'th' ? 'ประมาณการ: ' : 'Estimated: '}
                  </strong>
                  {periodPnl.statusReasons.join(' · ')}
                </span>
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
                  <div className="flex justify-between px-3 py-1 text-slate-500">
                    <span>{lang === 'th' ? 'ยอดขายอ้างอิงก่อนหักส่วนลด (Gross Sales Reference)' : 'Gross Sales (Reference)'}</span>
                    <span>฿{formatMoney(periodPnl.grossSalesRef)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-1 text-amber-700">
                    <span>{lang === 'th' ? 'ส่วนลดโปรโมชั่น & คืนเงิน (อ้างอิง)' : 'Discounts & Refunds (Reference)'}</span>
                    <span>
                      -฿{formatMoney(periodPnl.discountsRef + periodPnl.refundsRef)}
                    </span>
                  </div>
                  {settings.serviceChargeTreatment === 'retained' && periodPnl.retainedServiceCharge > 0 && (
                    <div className="flex justify-between px-3 py-1 text-emerald-700">
                      <span>{lang === 'th' ? 'บวก: Service Charge ที่ร้านเก็บเอง' : 'Retained Service Charge'}</span>
                      <span>+฿{formatMoney(periodPnl.retainedServiceCharge)}</span>
                    </div>
                  )}
                  <div className="flex justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 font-bold text-sm text-slate-900">
                    <span>{lang === 'th' ? 'ยอดขายสุทธิ ex-VAT (Net Sales)' : 'Net Sales (ex-VAT)'}</span>
                    <span>฿{formatMoney(periodPnl.totalRevenue)}</span>
                  </div>
                </div>

                {/* 2. COGS */}
                <div className="space-y-1.5">
                  <div className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 font-bold uppercase tracking-wider">
                    2. {lang === 'th' ? 'ต้นทุนขาย (Cost of Goods Sold)' : 'Cost of Goods Sold'}
                  </div>
                  <div className="flex justify-between px-3 py-1 text-slate-600">
                    <span>
                      {t.reports.foodCost}{' '}
                      <span className="text-[11px] text-slate-400">({periodPnl.cogsLabel})</span>
                    </span>
                    <span>
                      {periodPnl.totalRevenue > 0 ? `${periodPnl.foodCostPercent.toFixed(1)}%` : '0.0%'} · -฿{formatMoney(periodPnl.foodCogs)}
                    </span>
                  </div>
                  {periodPnl.wasteMemo > 0 && (
                    <div className="flex justify-between px-3 py-0.5 pl-6 text-[11px] text-rose-600">
                      <span>• {lang === 'th' ? 'บันทึกของเสียในงวด (Waste Memo — ไม่หักออกจาก COGS)' : 'Waste Memo (Excluded from COGS)'}</span>
                      <span>฿{formatMoney(periodPnl.wasteMemo)}</span>
                    </div>
                  )}
                  <div className="flex justify-between px-3 py-1 text-slate-600">
                    <span>{t.reports.packagingCost}</span>
                    <span>
                      {periodPnl.totalRevenue > 0 ? `${((periodPnl.packagingCogs / periodPnl.totalRevenue) * 100).toFixed(1)}%` : '0.0%'} · -฿{formatMoney(periodPnl.packagingCogs)}
                    </span>
                  </div>
                  <div className="flex justify-between px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 font-bold text-sm text-emerald-900">
                    <span>
                      = {t.reports.grossProfit} ({periodPnl.grossMarginPercent.toFixed(1)}%)
                    </span>
                    <span>฿{formatMoney(periodPnl.grossProfit)}</span>
                  </div>
                </div>

                {/* 3. Channel Fees & Total Labor & Prime Cost */}
                <div className="space-y-1.5">
                  <div className="px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-900 font-bold flex justify-between">
                    <span>3. {lang === 'th' ? 'ค่าธรรมเนียมแพลตฟอร์ม, ค่าแรง & Prime Cost (COGS + Total Labor)' : 'Channel Fees, Total Labor & Prime Cost'}</span>
                    <span>{periodPnl.primeCostPercent.toFixed(1)}% (฿{formatMoney(periodPnl.primeCost)})</span>
                  </div>
                  <div className="flex justify-between px-3 py-1 text-slate-700">
                    <span>{lang === 'th' ? `หัก: ${t.reports.platformFees} (GP)` : `Less: ${t.reports.platformFees}`}</span>
                    <span className="text-rose-700 font-semibold">-฿{formatMoney(periodPnl.channelFees)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-1 text-slate-700">
                    <span>{lang === 'th' ? 'หัก: ค่าแรงรวมทุกแผนก (Total Labor)' : 'Less: Total Labor (All Departments)'}</span>
                    <span className="text-indigo-700 font-semibold">-฿{formatMoney(periodPnl.totalLabor)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-0.5 pl-6 text-slate-500">
                    <span>• {lang === 'th' ? 'ค่าแรงฝ่ายครัว (Kitchen Labor)' : 'Kitchen Labor'}</span>
                    <span>฿{formatMoney(periodPnl.kitchenLabor)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-0.5 pl-6 text-slate-500">
                    <span>• {lang === 'th' ? 'ค่าแรงหน้าร้าน & บริหาร (FOH & Admin)' : 'FOH & Management Labor'}</span>
                    <span>฿{formatMoney(periodPnl.fohLabor)}</span>
                  </div>
                </div>

                {/* 4. Operating Expenses (OPEX) */}
                <div className="space-y-1.5">
                  <div className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 font-bold uppercase tracking-wider">
                    4. {lang === 'th' ? 'ค่าใช้จ่ายดำเนินงานอื่น (Operating Expenses)' : 'Operating Expenses (OPEX)'}
                  </div>
                  <div className="flex justify-between px-3 py-1 text-slate-600">
                    <span>{lang === 'th' ? 'ค่าเช่าพื้นที่ สาธารณูปโภค และโสหุ้ยร้าน (OPEX)' : 'Store OPEX (Fixed & Variable)'}</span>
                    <span>-฿{formatMoney(periodPnl.opex)}</span>
                  </div>
                </div>

                {/* 5. Operating & Net Profit */}
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <div className="flex justify-between px-3 py-2 rounded-lg bg-slate-50 font-bold text-slate-900">
                    <span>{lang === 'th' ? 'กำไรจากการดำเนินงาน (Operating Profit)' : 'Operating Profit'} ({periodPnl.operatingMarginPercent.toFixed(1)}%)</span>
                    <span>฿{formatMoney(periodPnl.operatingProfit)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-1 text-amber-700">
                    <span>
                      {lang === 'th'
                        ? `หัก: ประมาณการภาษี (${periodPnl.taxRatePercent}%) — ประมาณการ — โปรดยืนยันกับนักบัญชี`
                        : `Less: Estimated Tax (${periodPnl.taxRatePercent}%) — Estimate — please confirm with accountant`}
                    </span>
                    <span>-฿{formatMoney(periodPnl.estimatedTax)}</span>
                  </div>
                  <div
                    className={`flex justify-between px-4 py-3 rounded-xl font-extrabold text-sm sm:text-base border ${
                      periodPnl.netProfit >= 0
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}
                  >
                    <span>{lang === 'th' ? 'กำไรสุทธิ (Net Profit)' : 'Net Profit'} ({periodPnl.netMarginPercent.toFixed(1)}%)</span>
                    <span>฿{formatMoney(periodPnl.netProfit)}</span>
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
              channels={salesChannels}
              onAddSalesRecord={handleAddSalesRecord}
              onDeleteSalesRecord={handleDeleteSalesRecord}
              onUpdateChannels={setSalesChannels}
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
              employeesCount={unifiedEmployees.length}
              excludePayrollDuplicates={excludePayrollDuplicates}
              onToggleExcludePayrollDuplicates={setExcludePayrollDuplicates}
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
              monthlyNetSales={periodPnl.netSalesExVat}
              onAddEmployee={handleAddEmployee}
              onDeleteEmployee={handleDeleteEmployee}
              activeLanguage={lang}
              period={period}
              dateParam={dateParam}
              coveredMonths={periodPnl.coveredMonths}
              periodLaborCost={periodPnl.totalLabor}
              periodSalesLabel={periodSalesLabel}
              socialSecurityEnabled={socialSecurityEnabled}
              socialSecurityRatePercent={socialSecurityRatePercent}
              socialSecurityCapWage={socialSecurityCapWage}
            />
          </div>
        )}

        {/* =========================================================
            TAB 6: BREAK-EVEN & TARGETS
           ========================================================= */}
        {activeTab === 'breakeven' && (
          <div className="tonycost-workspace rounded-2xl bg-white/95 border border-slate-200/90 p-5 sm:p-6">
            <BreakEvenView
              key={`${unifiedExpenses.length}-${unifiedEmployees.length}-${Math.round(monthlyFixedExpensesOnly + totalMonthlyStaffPayroll)}-${operatingDays}-${period}-${dateParam}`}
              expenses={unifiedExpenses}
              employees={unifiedEmployees}
              sales={periodFilteredCostSales}
              settings={costSettings}
              activeLanguage={lang}
              period={period}
              dateParam={dateParam}
              coveredMonths={periodPnl.coveredMonths}
              normalizedMonthlyNetSales={monthlyNormalizedNetSales}
              recentSummaries={last30Summaries}
              periodSalesLabel={periodSalesLabel}
              excludePayrollDuplicates={excludePayrollDuplicates}
              onToggleExcludePayrollDuplicates={setExcludePayrollDuplicates}
              socialSecurityEnabled={socialSecurityEnabled}
              socialSecurityRatePercent={socialSecurityRatePercent}
              socialSecurityCapWage={socialSecurityCapWage}
            />
          </div>
        )}

        {/* =========================================================
            TAB 7: DATA HEALTH DIAGNOSTICS (ตรวจสุขภาพข้อมูล)
           ========================================================= */}
        {activeTab === 'health' && (
          <div className="space-y-5">
            <section
              className={`rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                dataHealthReport.isHealthy
                  ? 'bg-emerald-50/90 border-emerald-200 text-emerald-950'
                  : dataHealthReport.criticalCount > 0
                  ? 'bg-rose-50/90 border-rose-200 text-rose-950'
                  : 'bg-amber-50/90 border-amber-200 text-amber-950'
              }`}
            >
              <div className="flex items-start gap-3">
                {dataHealthReport.isHealthy ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle
                    className={`w-6 h-6 shrink-0 mt-0.5 ${
                      dataHealthReport.criticalCount > 0 ? 'text-rose-600' : 'text-amber-600'
                    }`}
                  />
                )}
                <div>
                  <h2 className="text-base font-extrabold">
                    {dataHealthReport.isHealthy
                      ? lang === 'th'
                        ? 'สุขภาพข้อมูลครบถ้วน พร้อมใช้ออกงบและตั้งราคา'
                        : 'All Data Health Checks Passed'
                      : lang === 'th'
                      ? `พบจุดที่ควรตรวจสอบ ${dataHealthReport.totalIssueCount} รายการ (${dataHealthReport.passedCount}/${dataHealthReport.totalChecks} หมวดผ่านเกณฑ์)`
                      : `Detected ${dataHealthReport.totalIssueCount} issue(s) (${dataHealthReport.passedCount}/${dataHealthReport.totalChecks} checks passed)`}
                  </h2>
                  <p className="text-xs opacity-85 mt-0.5">
                    {lang === 'th'
                      ? `ตรวจสอบความสมบูรณ์ของต้นทุนวัตถุดิบ สูตรอาหาร ซอส สต็อกงวด ${dateParam} และรายจ่ายซ้ำซ้อน`
                      : `Audits ingredient prices, menu recipes, net sauce yields, period ${dateParam} stock counts, manual sales cost, and payroll overlaps.`}
                  </p>
                </div>
              </div>
              <div className="text-right tabular-nums shrink-0">
                <div className="text-xs font-semibold opacity-75">
                  {lang === 'th' ? 'คะแนนความพร้อม' : 'Readiness'}
                </div>
                <div className="text-2xl font-extrabold">
                  {dataHealthReport.passedCount}/{dataHealthReport.totalChecks}
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {dataHealthReport.checks.map((check) => {
                const actionConfig: Record<
                  DataHealthCheckId,
                  { labelTh: string; labelEn: string; onClick: () => void }
                > = {
                  zero_price_ingredients: {
                    labelTh: 'ไปหน้าจัดการวัตถุดิบ',
                    labelEn: 'Open Ingredients',
                    onClick: () => onNavigatePage('cost_ingredients'),
                  },
                  menus_without_recipe: {
                    labelTh: 'ไปผูกสูตรเมนู',
                    labelEn: 'Open Recipes',
                    onClick: () => onNavigatePage('cost_recipes'),
                  },
                  uncosted_manual_sales: {
                    labelTh: 'ไปหน้ายอดขายรายวัน',
                    labelEn: 'Open Daily Sales',
                    onClick: () => setActiveTab('sales'),
                  },
                  missing_stock_counts: {
                    labelTh: 'ไปหน้านับสต็อก',
                    labelEn: 'Open Inventory',
                    onClick: () => onNavigatePage('cost_inventory'),
                  },
                  duplicate_payroll: {
                    labelTh: 'ไปตรวจค่าใช้จ่าย',
                    labelEn: 'Review Expenses',
                    onClick: () => setActiveTab('expenses'),
                  },
                  sauces_without_net_qty: {
                    labelTh: 'ไปแก้สูตรซอส',
                    labelEn: 'Open Sauces',
                    onClick: () => onNavigatePage('cost_sauces'),
                  },
                };
                const action = actionConfig[check.id];
                const borderClass = check.passed
                  ? 'border-emerald-200/90 bg-white/95'
                  : check.severity === 'critical'
                  ? 'border-rose-300 bg-white/95'
                  : 'border-amber-300 bg-white/95';

                return (
                  <div
                    key={check.id}
                    className={`rounded-2xl border p-5 flex flex-col justify-between gap-4 ${borderClass}`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                          {check.passed ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle
                              className={`w-5 h-5 shrink-0 mt-0.5 ${
                                check.severity === 'critical' ? 'text-rose-600' : 'text-amber-600'
                              }`}
                            />
                          )}
                          <div>
                            <h3 className="text-sm font-extrabold text-slate-900">
                              {lang === 'th' ? check.titleTh : check.titleEn}
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {lang === 'th' ? check.descriptionTh : check.descriptionEn}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`text-xs font-bold whitespace-nowrap tabular-nums ${
                            check.passed
                              ? 'text-emerald-700'
                              : check.severity === 'critical'
                              ? 'text-rose-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {check.passed
                            ? lang === 'th'
                              ? 'ผ่านเกณฑ์'
                              : 'OK'
                            : lang === 'th'
                            ? `${check.count} รายการ`
                            : `${check.count} issue(s)`}
                        </span>
                      </div>

                      <div
                        className={`px-3 py-2 rounded-xl text-xs font-semibold ${
                          check.passed
                            ? 'bg-emerald-50 text-emerald-800'
                            : check.severity === 'critical'
                            ? 'bg-rose-50 text-rose-900'
                            : 'bg-amber-50 text-amber-900'
                        }`}
                      >
                        {lang === 'th' ? check.summaryTh : check.summaryEn}
                      </div>

                      {check.items.length > 0 && (
                        <ul className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                          {check.items.slice(0, 8).map((item) => (
                            <li
                              key={item.id}
                              className="flex items-start justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 text-xs"
                            >
                              <span className="font-semibold text-slate-800 truncate">{item.label}</span>
                              <span className="text-[11px] text-slate-500 text-right shrink-0">
                                {lang === 'th' ? item.detailTh : item.detailEn}
                              </span>
                            </li>
                          ))}
                          {check.items.length > 8 && (
                            <li className="text-[11px] text-slate-500 px-3 pt-1 font-medium">
                              {lang === 'th'
                                ? `และอีก ${check.items.length - 8} รายการ...`
                                : `+ ${check.items.length - 8} more item(s)...`}
                            </li>
                          )}
                        </ul>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex justify-end">
                      <button
                        type="button"
                        onClick={action.onClick}
                        className="px-3.5 py-1.5 rounded-xl bg-slate-50 hover:bg-orange-50 text-slate-700 hover:text-orange-700 border border-slate-200 text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <span>{lang === 'th' ? action.labelTh : action.labelEn}</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
