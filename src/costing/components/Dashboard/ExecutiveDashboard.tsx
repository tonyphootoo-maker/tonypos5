import React from 'react';
import {
  DollarSign,
  TrendingUp,
  Percent,
  Layers,
  Scale,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  FileSpreadsheet,
  UtensilsCrossed,
  RefreshCw,
} from 'lucide-react';
import {
  Ingredient,
  MenuItem,
  SubRecipe,
  Employee,
  SalesChannel,
  ExpenseRecord,
  DailySalesRecord,
  WasteRecord,
  BusinessSettings,
  WhatShouldIDoAdvice,
} from '../../types/domain';
import { calculateProfitAndLoss, calculateDetailedBreakEven, calculateInventoryCOGS, convertExpenseToMonthly } from '../../engine/calculations';
import {
  StockCountSnapshot,
  PurchaseRecord,
  SaleOrder,
  Ingredient as IndexIngredient,
  MenuItem as IndexMenuItem,
  InventoryItem as IndexInventoryItem,
  WasteRecord as IndexWasteRecord,
  RestaurantSettings,
} from '../../types';
import {
  getPeriodDateBounds,
  resolveStockCountSnapshotsForPeriod,
  filterPeriodPurchases,
  filterPeriodWaste,
  getEmployeeMonthlyCost,
  isExplicitPayrollExpense,
  deriveVariableCostPercent,
  formatPeriodCalculationLabel,
  calculateWeightedFoodCostPercent,
  extractNetPriceFromMenuPrice,
} from '../../../engine/calculations';
import { StorageService } from '../../services/storageService';
import { FirebaseSyncService } from '../../services/firebaseSyncService';
import { calculateVariantCostBreakdown, getEffectiveDeliveryGpPercent } from '../../services/calculationEngine';
import { INITIAL_SETTINGS } from '../../data/initialData';
import { WhatShouldIDoSection } from './WhatShouldIDoSection';
import { useLanguage } from '../../../contexts/LanguageContext';

interface ExecutiveDashboardProps {
  ingredients?: Array<IndexIngredient | Ingredient>;
  menuItems: Array<IndexMenuItem | MenuItem>;
  subRecipes?: SubRecipe[];
  channels: SalesChannel[];
  expenses: ExpenseRecord[];
  employees?: Employee[];
  sales: DailySalesRecord[];
  waste?: WasteRecord[];
  wasteRecords?: WasteRecord[];
  inventory?: Array<IndexInventoryItem | Record<string, unknown>>;
  allWaste?: Array<IndexWasteRecord | WasteRecord>;
  purchases?: PurchaseRecord[];
  stockCounts?: StockCountSnapshot[];
  salesOrders?: SaleOrder[];
  settings?: BusinessSettings;
  currentSettings?: RestaurantSettings;
  advices?: WhatShouldIDoAdvice[];
  activeLanguage?: 'th' | 'en';
  onNavigate?: (view: string) => void;
  onNavigateToTab?: (tabId: string) => void;
  onSalesUpdated?: (sales: DailySalesRecord[]) => void;
}

export const ExecutiveDashboard: React.FC<ExecutiveDashboardProps> = ({
  ingredients = [],
  menuItems = [],
  channels = [],
  expenses = [],
  employees = [],
  sales = [],
  waste = [],
  wasteRecords = [],
  inventory = [],
  allWaste: rawAllWaste = [],
  purchases,
  stockCounts,
  salesOrders,
  settings = INITIAL_SETTINGS,
  currentSettings: rawCurrentSettings,
  advices,
  activeLanguage: propActiveLanguage,
  onNavigate,
  onNavigateToTab,
  onSalesUpdated,
}) => {
  const { lang: ctxLang } = useLanguage();
  const activeLanguage = propActiveLanguage ?? ctxLang;
  const [isSyncingSales, setIsSyncingSales] = React.useState(false);
  const [syncFeedback, setSyncFeedback] = React.useState<string | null>(null);
  const [excludePayrollDuplicates, setExcludePayrollDuplicates] = React.useState(true);

  const handleNavigate = (view: string) => {
    if (onNavigate) {
      onNavigate(view);
    } else if (onNavigateToTab) {
      onNavigateToTab(view);
    }
  };

  const handleSyncLivePOS = async () => {
    setIsSyncingSales(true);
    setSyncFeedback(null);
    try {
      const res = await FirebaseSyncService.pullDailySales();
      if (res.success && res.data) {
        if (onSalesUpdated) {
          onSalesUpdated(res.data);
        }
        setSyncFeedback(
          activeLanguage === 'th'
            ? `ซิงค์สำเร็จ (${res.data.length} วัน)`
            : `Synced successfully (${res.data.length} days)`
        );
      } else {
        setSyncFeedback(
          res.error
            ? activeLanguage === 'th'
              ? `ข้อผิดพลาด: ${res.error}`
              : `Error: ${res.error}`
            : activeLanguage === 'th'
            ? 'ไม่พบข้อมูลใหม่จาก POS'
            : 'No new POS data found'
        );
      }
    } catch (err: any) {
      setSyncFeedback(activeLanguage === 'th' ? 'ซิงค์ล้มเหลว' : 'Sync failed');
    } finally {
      setIsSyncingSales(false);
      setTimeout(() => setSyncFeedback(null), 4000);
    }
  };

  const currentSettings = rawCurrentSettings || settings || INITIAL_SETTINGS;
  const allWaste = (rawAllWaste && rawAllWaste.length > 0)
    ? rawAllWaste
    : (waste && waste.length > 0 ? waste : wasteRecords || []);

  // Safe helper to extract or adapt portions/variants for dine-in menu profitability (pkg = 0, ex-VAT denominator, uncapped profit)
  const getMenuPortions = React.useCallback(
    (menu: any): any[] => {
      if (!menu) return [];
      if (menu.portions && Array.isArray(menu.portions) && menu.portions.length > 0) {
        return menu.portions;
      }
      if (menu.variants && Array.isArray(menu.variants) && menu.variants.length > 0) {
        const ings = (ingredients && ingredients.length > 0) ? ingredients : StorageService.getIngredients();
        const sauces = StorageService.getSauces();
        const ingMap = new Map((ings as any[]).map((i: any) => [i.id, i]));
        const sauceMap = new Map((sauces as any[]).map((s: any) => [s.id, s]));
        const st = currentSettings || StorageService.getSettings();
        const vatPct = (st as any)?.vatRatePercent ?? 7;
        const scIncluded = Boolean((st as any)?.serviceChargeIncludedInPrice);
        const scPct = (st as any)?.serviceChargePercent ?? 0;
        const defaultPricesIncludeVat = Boolean((st as any)?.pricesIncludeVat ?? (st as any)?.salesVatInclusive);

        return menu.variants.map((v: any) => {
          let directFoodCost = 0;
          let sellingPrice = v.sellingPrice || 0;

          try {
            if (v.recipeItems && v.recipeItems.length > 0) {
              const bd = calculateVariantCostBreakdown(v, menu.name || menu.thaiName || '', ingMap as any, sauceMap as any, st as any);
              directFoodCost = bd.totalFoodCost || bd.totalIngredientCost || 0;
              sellingPrice = bd.sellingPrice || sellingPrice;
            } else if (typeof v.totalFoodCost === 'number') {
              directFoodCost = v.totalFoodCost;
            } else if (typeof v.foodCost === 'number') {
              directFoodCost = v.foodCost;
            }
          } catch (e) {
            directFoodCost = v.foodCost || v.totalFoodCost || 0;
          }

          // Dine-in has 0 takeaway box cost; strip VAT & included SC before Food Cost % and profit
          const packagingCost = 0;
          const totalDirectCost = directFoodCost;
          const isVatInc =
            v.taxType === 'INCLUSIVE' ||
            (v.taxType !== 'EXCLUSIVE' && v.taxType !== 'NONE' && defaultPricesIncludeVat);
          const netSellingPrice = extractNetPriceFromMenuPrice(
            sellingPrice,
            isVatInc,
            vatPct,
            scIncluded,
            scPct
          );
          const foodCostPercent = netSellingPrice > 0 ? (directFoodCost / netSellingPrice) * 100 : 0;
          const contributionProfit = netSellingPrice - totalDirectCost;

          return {
            id: v.id,
            name: v.name || v.proteinType || (activeLanguage === 'th' ? 'จานปกติ' : 'Standard'),
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
    },
    [ingredients, currentSettings, activeLanguage]
  );

  // Double-counting guard: explicit isPayroll check with user toggle (no keyword matching)
  const activeEmployees = employees.filter((e) => e.active !== false);
  const payrollFlaggedExpenses = expenses.filter(
    (e) => !e.isExcluded && isExplicitPayrollExpense(e)
  );
  const hasDuplicatePayroll = activeEmployees.length > 0 && payrollFlaggedExpenses.length > 0;
  const effectiveExpenses = expenses.filter(
    (e) =>
      !e.isExcluded &&
      !(hasDuplicatePayroll && excludePayrollDuplicates && isExplicitPayrollExpense(e))
  );

  const operatingDays = currentSettings.operatingDaysPerMonth || 26;
  const laborOptions = {
    socialSecurityEnabled: currentSettings.socialSecurityEnabled ?? false,
    socialSecurityRatePercent: currentSettings.socialSecurityRatePercent ?? 5,
    socialSecurityCapWage: currentSettings.socialSecurityCapWage ?? 15000,
    defaultOperatingDays: operatingDays,
  };

  // Real Labor from ALL active employees (handles hourly * hours + OT + benefits + optional SSO)
  const directKitchenLabor = activeEmployees
    .filter((e) => e.roleCategory === 'direct_kitchen' || e.department === 'kitchen')
    .reduce((sum, e) => sum + getEmployeeMonthlyCost(e, laborOptions), 0);

  const nonKitchenLabor = activeEmployees
    .filter((e) => e.roleCategory !== 'direct_kitchen' && e.department !== 'kitchen')
    .reduce((sum, e) => sum + getEmployeeMonthlyCost(e, laborOptions), 0);

  // Dynamic date logic: use latest sales record date or today's date
  const latestSalesDate = sales.length > 0
    ? [...sales].sort((a, b) => b.date.localeCompare(a.date))[0]?.date
    : null;
  const todayDate = latestSalesDate || new Date().toISOString().split('T')[0];
  const targetMonth = todayDate.slice(0, 7);
  const monthSales = sales.filter((s) => s.date && s.date.startsWith(targetMonth));

  const todaySalesRecords = sales.filter((s) => s.date === todayDate);
  const resolveRecordNet = (s: DailySalesRecord) => {
    if (typeof s.netSales === 'number' && Number.isFinite(s.netSales)) {
      return Math.max(0, s.netSales);
    }
    const nominal = Math.max(0, (s.grossSales || 0) - (s.discounts || 0) - (s.refunds || 0));
    const vatPct = s.vatRatePercent ?? 7;
    return s.isVatInclusive && vatPct > 0 ? nominal / (1 + vatPct / 100) : nominal;
  };
  const todayNetSales = todaySalesRecords.reduce((sum, s) => sum + resolveRecordNet(s), 0);
  const todayOrders = todaySalesRecords.reduce((sum, s) => sum + s.orderCount, 0);

  const monthlyGrossSales = monthSales.reduce((sum, s) => sum + (s.grossSales || 0), 0);
  const monthlyDiscounts = monthSales.reduce((sum, s) => sum + (s.discounts || 0), 0);
  const monthlyRefunds = monthSales.reduce((sum, s) => sum + (s.refunds || 0), 0);
  const monthlyNetSales = monthSales.reduce((sum, s) => sum + resolveRecordNet(s), 0);
  const monthlyChannelFees = monthSales.reduce((sum, s) => sum + Math.max(0, s.platformFees || 0), 0);

  // Operating Expenses (monthly-converted, excluding payroll duplicates when chosen)
  const totalOperatingExpenses = effectiveExpenses.reduce(
    (sum, e) => sum + convertExpenseToMonthly(e, operatingDays),
    0
  );
  const fixedExpensesMonthly = effectiveExpenses
    .filter((e) => e.isFixed !== false)
    .reduce((sum, e) => sum + convertExpenseToMonthly(e, operatingDays), 0);
  const variableExpensesMonthly = effectiveExpenses
    .filter((e) => e.isFixed === false)
    .reduce((sum, e) => sum + convertExpenseToMonthly(e, operatingDays), 0);
  const fixedExpenses = fixedExpensesMonthly + nonKitchenLabor;

  // Check for date-scoped StockCountSnapshot pair & period-filtered purchases (never fabricate beginning stock or subtract waste)
  const purchasesList = React.useMemo(() => purchases ?? StorageService.getPurchases(), [purchases]);
  const stockCountsList = React.useMemo(() => stockCounts ?? StorageService.getStockCounts(), [stockCounts]);
  const salesOrdersList = React.useMemo(() => salesOrders ?? StorageService.getSalesOrders(), [salesOrders]);
  const { periodStart, periodEnd } = getPeriodDateBounds('month', targetMonth);
  const todayIso = new Date().toISOString().slice(0, 10);
  const snapshotPair = resolveStockCountSnapshotsForPeriod(stockCountsList, periodStart, periodEnd, todayIso);
  const periodPurchasesRes = filterPeriodPurchases(purchasesList, periodStart, periodEnd, ingredients);
  const periodWasteRes = filterPeriodWaste(allWaste || [], periodStart, periodEnd);
  const hasActualStock = snapshotPair.hasCompletePair;

  // Sales-weighted Food Cost & Actual/Theoretical COGS (never fabricate 32% or 3.5% packaging)
  const explicitSalesFoodCost = monthSales.reduce(
    (sum, s) => sum + (typeof s.foodCost === 'number' ? Math.max(0, s.foodCost) : 0),
    0
  );
  const explicitSalesPackagingCost = monthSales.reduce(
    (sum, s) => sum + (typeof s.packagingCost === 'number' ? Math.max(0, s.packagingCost) : 0),
    0
  );
  const orderDatesCovered = new Set(monthSales.filter((s) => typeof s.foodCost === 'number').map((s) => s.date));
  const unmatchedOrders = salesOrdersList.filter(
    (o) => o.date >= periodStart && o.date <= periodEnd && o.orderStatus !== 'CANCELLED' && !orderDatesCovered.has(o.date)
  );
  const unmatchedOrderFoodCost = unmatchedOrders.reduce((sum, o) => sum + (o.totalFoodCost || 0), 0);
  const unmatchedOrderPkgCost = unmatchedOrders.reduce((sum, o) => sum + (o.packagingCost || 0), 0);
  const unmatchedOrderNetSales = unmatchedOrders.reduce((sum, o) => {
    if (typeof o.netRevenue === 'number' && Number.isFinite(o.netRevenue) && o.netRevenue >= 0) {
      return sum + o.netRevenue;
    }
    const gross = Math.max(0, o.grossSales || 0);
    const vatPct = (currentSettings as any)?.vatRatePercent ?? 7;
    const isVatInc = Boolean((currentSettings as any)?.pricesIncludeVat ?? (currentSettings as any)?.salesVatInclusive);
    return sum + (isVatInc && vatPct > 0 ? gross / (1 + vatPct / 100) : gross);
  }, 0);
  const theoreticalFoodCostTotal = explicitSalesFoodCost + unmatchedOrderFoodCost;

  let foodCogsToUse = theoreticalFoodCostTotal > 0 ? theoreticalFoodCostTotal : 0;
  let packagingCogsToUse = explicitSalesPackagingCost + unmatchedOrderPkgCost;

  if (hasActualStock && snapshotPair.beginningSnapshot && snapshotPair.endingSnapshot) {
    const actualCogsResult = calculateInventoryCOGS(
      snapshotPair.beginningSnapshot.totalValue,
      periodPurchasesRes.totalFoodPurchases,
      snapshotPair.endingSnapshot.totalValue,
      periodWasteRes.totalWasteCost
    );
    foodCogsToUse = actualCogsResult.cogs;
  }

  const effectiveSalesForFoodCost = monthlyNetSales > 0 ? monthlyNetSales : unmatchedOrderNetSales;
  const weightedFoodCostRes = calculateWeightedFoodCostPercent(
    effectiveSalesForFoodCost > 0
      ? [{ netSales: effectiveSalesForFoodCost, totalFoodCost: foodCogsToUse }]
      : [],
    {
      pricesIncludeVat: Boolean((currentSettings as any)?.pricesIncludeVat ?? (currentSettings as any)?.salesVatInclusive),
      vatPercent: (currentSettings as any)?.vatRatePercent ?? 7,
      serviceChargeIncludedInPrice: Boolean((currentSettings as any)?.serviceChargeIncludedInPrice),
      serviceChargePercent: (currentSettings as any)?.serviceChargePercent ?? 0,
    }
  );
  const avgFoodCostPercent: number | null = weightedFoodCostRes.foodCostPercent;

  const incomeTaxRate = typeof currentSettings.incomeTaxRatePercent === 'number' && Number.isFinite(currentSettings.incomeTaxRatePercent)
    ? currentSettings.incomeTaxRatePercent
    : 20;

  const pnl = calculateProfitAndLoss(
    monthlyGrossSales,
    monthlyDiscounts,
    monthlyRefunds,
    foodCogsToUse,
    packagingCogsToUse,
    totalOperatingExpenses,
    directKitchenLabor,
    incomeTaxRate,
    nonKitchenLabor,
    monthlyChannelFees,
    monthlyNetSales
  );

  const syntheticSummariesForCM = monthSales.map((s, idx) => ({
    id: s.id || `sum_${s.date}_${idx}`,
    date: s.date,
    grossSales: s.grossSales || 0,
    discounts: s.discounts || 0,
    serviceCharge: 0,
    vat: 0,
    netSales: resolveRecordNet(s),
    totalFoodCost: s.foodCost || 0,
    packagingCost: s.packagingCost || 0,
    platformFees: s.platformFees || 0,
    orderCount: s.orderCount || 0,
    paymentTotals: { cash: 0, qr: 0, card: 0, transfer: 0 },
    channelTotals: {},
    dishStats: {},
    createdAt: '',
    updatedAt: '',
    version: 1,
  }));
  const derivedMargin = deriveVariableCostPercent(syntheticSummariesForCM, {
    otherVariableCostAmount: variableExpensesMonthly,
    otherVariablePeriodNetSales: monthlyNetSales > 0 ? monthlyNetSales : undefined,
  });
  const effectiveCMPercent = derivedMargin.hasRealData
    ? derivedMargin.contributionMarginPercent
    : avgFoodCostPercent !== null
    ? Math.max(0, 100 - avgFoodCostPercent)
    : 0;

  const monthlyOrderCount = monthSales.reduce((sum, s) => sum + (s.orderCount || 0), 0);
  const avgTicketSizeForBe =
    monthlyOrderCount > 0 && monthlyNetSales > 0
      ? monthlyNetSales / monthlyOrderCount
      : (currentSettings as any)?.defaultTicketSize ?? 0;

  const breakEven = calculateDetailedBreakEven(
    fixedExpenses + directKitchenLabor,
    effectiveCMPercent,
    avgTicketSizeForBe,
    operatingDays,
    0,
    monthlyNetSales
  );

  // Real average daily net sales calculation from distinct logged days in targetMonth
  const loggedDates = Array.from(new Set(monthSales.map((s) => s.date).filter(Boolean)));
  const loggedDaysCount = loggedDates.length;
  const totalLoggedNetSales = monthlyNetSales;
  const avgDailyNetSales = loggedDaysCount > 0 ? totalLoggedNetSales / loggedDaysCount : 0;

  // Build real dynamic actionable advices if not explicitly provided
  const defaultAdvicesList: WhatShouldIDoAdvice[] = [];

  // 1. Food cost alert from real menu items if available
  const highCostPortion = menuItems
    .flatMap((m) => getMenuPortions(m).map((p) => ({ menu: m, portion: p })))
    .filter((x) => (x.portion.foodCostPercent || 0) > (currentSettings.defaultTargetFoodCostPercent || 40))
    .sort((a, b) => (b.portion.foodCostPercent || 0) - (a.portion.foodCostPercent || 0))[0];

  if (highCostPortion) {
    const p = highCostPortion.portion;
    const m = highCostPortion.menu;
    const menuTitle =
      activeLanguage === 'en'
        ? (m as any).englishName || m.name || m.thaiName || 'Main Dish'
        : m.thaiName || m.name || 'เมนูหลัก';
    defaultAdvicesList.push({
      id: 'adv-1',
      type: 'CRITICAL',
      category: 'Food Cost',
      titleTh: `เมนู "${menuTitle} (${p.name})" มี % Food Cost สูงเกินเป้าหมาย (${p.foodCostPercent.toFixed(1)}% vs เป้า ${currentSettings.defaultTargetFoodCostPercent || 40}%)`,
      titleEn: `Menu "${menuTitle} (${p.name})" Food Cost % is Exceeding Target (${p.foodCostPercent.toFixed(1)}% vs ${currentSettings.defaultTargetFoodCostPercent || 40}% target)`,
      descriptionTh: `ต้นทุนวัตถุดิบและกล่องอยู่ที่ ฿${p.totalDirectCost.toFixed(2)} บนราคาขาย ฿${p.sellingPrice} แนะนำพิจารณาปรับราคาขายหรือลดต้นทุนวัตถุดิบ`,
      descriptionEn: `Direct cost is ฿${p.totalDirectCost.toFixed(2)} on selling price ฿${p.sellingPrice}. Consider adjusting price or standardizing portions.`,
      actionRecommendationTh: 'ปรับราคาขายหรือเจรจาซัพพลายเออร์',
      actionRecommendationEn: 'Reprice or optimize portion recipe',
      metricLabel: 'Food Cost',
      metricValue: `${p.foodCostPercent.toFixed(1)}%`,
      relatedEntityType: 'menu',
      relatedEntityId: m.id,
    });
  }

  // 2. Delivery GP alert based on real delivery channel settings
  const grabChannel = channels.find((c) => c.id === 'grab' || c.code === 'GRAB');
  const effectiveGrabGp = getEffectiveDeliveryGpPercent(
    {
      ...currentSettings,
      ...(grabChannel?.commissionPercent !== undefined
        ? { grabFoodCommissionPercent: grabChannel.commissionPercent }
        : {}),
    } as any,
    'grab'
  );
  const grabHasVat =
    (currentSettings as any)?.commissionVatAsCost ??
    (currentSettings as any)?.grabFoodCommissionHasVat ??
    true;
  const grabVatGp = effectiveGrabGp.toFixed(1);
  defaultAdvicesList.push({
    id: 'adv-2',
    type: 'WARNING',
    category: 'Delivery Loss',
    titleTh: grabHasVat
      ? `ช่องทาง GrabFood โดนหัก GP รวม VAT ${grabVatGp}%`
      : `ช่องทาง GrabFood โดนหัก GP ${grabVatGp}%`,
    titleEn: grabHasVat
      ? `GrabFood Delivery Commission with VAT is ${grabVatGp}%`
      : `GrabFood Delivery Commission is ${grabVatGp}%`,
    descriptionTh: 'หากตั้งราคาขายเดลิเวอรีเท่ากับหน้าร้าน กำไรขั้นต้นจะลดลง แนะนำใช้สูตรคำนวณราคา Delivery Markup เพื่อรักษากำไรสุทธิ',
    descriptionEn: 'Selling at dine-in prices on delivery erodes gross margin. Use the built-in Delivery Markup strategy.',
    actionRecommendationTh: 'ปรับราคาเมนูเดลิเวอรีเพื่อรักษา Net Profit',
    actionRecommendationEn: 'Optimize delivery selling prices',
    metricLabel: grabHasVat ? 'GP + VAT' : 'GP',
    metricValue: `${grabVatGp}%`,
    relatedEntityType: 'channel',
  });

  // 3. Break-even insight card: only include if enough data (loggedDaysCount >= 1 and valid break-even)
  if (loggedDaysCount >= 1 && breakEven.isValid && breakEven.breakEvenDailySales > 0) {
    const diffPercent = ((avgDailyNetSales - breakEven.breakEvenDailySales) / breakEven.breakEvenDailySales) * 100;
    const isAbove = diffPercent >= 0;
    defaultAdvicesList.push({
      id: 'adv-3',
      type: isAbove ? 'OPPORTUNITY' : 'WARNING',
      category: 'Break-Even',
      titleTh: isAbove
        ? `ยอดขายเฉลี่ยผ่านจุดคุ้มทุนรายวัน (Break-Even) เกินเป้าหมาย ${diffPercent.toFixed(1)}%`
        : `ยอดขายเฉลี่ยต่ำกว่าจุดคุ้มทุนรายวัน ${Math.abs(diffPercent).toFixed(1)}%`,
      titleEn: isAbove
        ? `Average Daily Sales Exceed Break-Even Target by ${diffPercent.toFixed(1)}%`
        : `Average Daily Sales Below Break-Even Target by ${Math.abs(diffPercent).toFixed(1)}%`,
      descriptionTh: isAbove
        ? `จุดคุ้มทุนอยู่ที่ ฿${Math.round(breakEven.breakEvenDailySales).toLocaleString()}/วัน (${Math.round(breakEven.breakEvenDailyOrders)} จาน) ยอดขายเฉลี่ยจริงทำได้ ฿${Math.round(avgDailyNetSales).toLocaleString()}/วัน (${loggedDaysCount} วันที่บันทึก)`
        : `จุดคุ้มทุนอยู่ที่ ฿${Math.round(breakEven.breakEvenDailySales).toLocaleString()}/วัน (${Math.round(breakEven.breakEvenDailyOrders)} จาน) ยอดขายเฉลี่ยจริง ฿${Math.round(avgDailyNetSales).toLocaleString()}/วัน ขาดอีก ฿${Math.round(breakEven.breakEvenDailySales - avgDailyNetSales).toLocaleString()}/วัน เพื่อคุ้มทุน`,
      descriptionEn: isAbove
        ? `Daily break-even is ฿${Math.round(breakEven.breakEvenDailySales).toLocaleString()}/day (~${Math.round(breakEven.breakEvenDailyOrders)} orders). Actual average is ฿${Math.round(avgDailyNetSales).toLocaleString()}/day.`
        : `Daily break-even is ฿${Math.round(breakEven.breakEvenDailySales).toLocaleString()}/day. Actual average is ฿${Math.round(avgDailyNetSales).toLocaleString()}/day.`,
      actionRecommendationTh: isAbove ? 'เพิ่มโปรโมชัน Upselling ช่วง Peak Hours' : 'เร่งยอดขายหรือควบคุมค่าใช้จ่ายคงที่',
      actionRecommendationEn: isAbove ? 'Deploy peak-hour upselling combos' : 'Increase sales or control fixed overheads',
      metricLabel: 'BE Margin',
      metricValue: `${isAbove ? '+' : ''}${diffPercent.toFixed(1)}%`,
      relatedEntityType: 'ingredient',
    });
  }

  const generatedAdvices: WhatShouldIDoAdvice[] =
    advices && advices.length > 0 ? advices : defaultAdvicesList;

  const targetFoodCostPct =
    settings.defaultTargetFoodCostPercent || currentSettings.defaultTargetFoodCostPercent || 30;
  const targetPrimeCostPct = currentSettings.primeCostTargetPercent || 55;
  const isFoodCostHigh = avgFoodCostPercent !== null && avgFoodCostPercent > targetFoodCostPct;
  const isPrimeCostHigh = pnl.primeCostPercent > targetPrimeCostPct;

  return (
    <div className="exec-glass-dashboard relative rounded-3xl overflow-hidden border border-white/90 bg-gradient-to-br from-[#EEF2FF]/90 via-[#F8FAFC]/95 to-[#FFF7ED]/90 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.09)] p-4 sm:p-6 lg:p-7">
      {/* Subtle diffused ambient mesh lights for authentic glass refraction */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-sky-300/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-orange-300/20 blur-3xl"
      />

      <div className="relative z-10 space-y-6">
        {/* Band 1: Glass Command Header */}
        <header className="rounded-2xl bg-white/65 backdrop-blur-xl border border-white/85 p-5 sm:p-6 shadow-[0_8px_28px_-6px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.95)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              {activeLanguage === 'th'
                ? 'แดชบอร์ดบริหาร & คำแนะนำเชิงธุรกิจ'
                : 'Executive Cost & Profit Overview'}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {syncFeedback && (
              <span className="text-xs font-medium text-amber-800 bg-amber-50/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-amber-200/80">
                {syncFeedback}
              </span>
            )}
            <button
              type="button"
              onClick={handleSyncLivePOS}
              disabled={isSyncingSales}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/75 hover:bg-white border border-slate-200/90 px-3.5 py-2 text-xs font-semibold text-slate-700 transition-all shadow-xs cursor-pointer disabled:opacity-50"
              title={
                activeLanguage === 'th'
                  ? 'ดึงยอดขายสดล่าสุดจาก Firebase Firestore ที่ POS บันทึกเข้ามา'
                  : 'Fetch the latest live POS sales synced to Firebase Firestore'
              }
            >
              <RefreshCw className={`h-3.5 w-3.5 text-emerald-600 ${isSyncingSales ? 'animate-spin' : ''}`} />
              <span>
                {isSyncingSales
                  ? activeLanguage === 'th'
                    ? 'กำลังซิงค์...'
                    : 'Syncing...'
                  : activeLanguage === 'th'
                  ? 'ซิงค์ยอดขายจาก POS'
                  : 'Sync Live POS'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate('scenario_calculator')}
              className="exec-glass-cta inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 hover:brightness-105 px-4 py-2 text-xs font-semibold text-white transition-all shadow-sm cursor-pointer"
            >
              <TrendingUp className="h-3.5 w-3.5" />
              <span>{activeLanguage === 'th' ? 'จำลองผลกระทบราคา (What-If)' : 'Scenario Simulator'}</span>
            </button>
          </div>
        </header>

        {/* Duplicate Payroll Guard Banner (Explicit Flag + User Toggle) */}
        {hasDuplicatePayroll && (
          <div className="rounded-2xl bg-amber-50/85 backdrop-blur-md border border-amber-200/90 px-4 py-3 text-amber-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>
                {activeLanguage === 'th'
                  ? `พบรายจ่ายเงินเดือน/ค่าแรง (${payrollFlaggedExpenses.length} รายการ) ซ้อนกับข้อมูลพนักงาน (${activeEmployees.length} คน) — ${
                      excludePayrollDuplicates
                        ? 'งดนับซ้ำใน P&L และจุดคุ้มทุน (ใช้ยอดจากหน้าพนักงาน)'
                        : 'กำลังนับรวมทั้งสองแหล่ง'
                    }`
                  : `Found ${payrollFlaggedExpenses.length} payroll expense(s) overlapping with ${activeEmployees.length} staff record(s) — ${
                      excludePayrollDuplicates
                        ? 'Excluded from P&L & Break-Even to avoid double counting (using Labor records)'
                        : 'Including both sources'
                    }`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setExcludePayrollDuplicates(!excludePayrollDuplicates)}
              className="px-3 py-1 rounded-lg border border-amber-400 bg-white hover:bg-amber-100 text-xs font-bold text-amber-900 shrink-0 cursor-pointer"
            >
              {excludePayrollDuplicates
                ? activeLanguage === 'th'
                  ? 'เปลี่ยนเป็นนับรวมด้วย'
                  : 'Include Both'
                : activeLanguage === 'th'
                ? 'งดนับซ้ำกับพนักงาน'
                : 'Avoid Double Counting'}
            </button>
          </div>
        )}

        {/* Band 2: 8 Essential Restaurant KPI Glass Tiles */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Today's Net Sales */}
          <div className="rounded-2xl bg-white/68 backdrop-blur-xl border border-white/85 p-4 sm:p-5 flex flex-col justify-between shadow-[0_8px_24px_-8px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.95)] hover:bg-white/84 transition-all duration-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
                {activeLanguage === 'th' ? 'ยอดขายวันนี้' : "Today's Net Sales"}
              </span>
              <span className="text-[11px] font-semibold text-emerald-700 tabular-nums">
                {todayOrders} {activeLanguage === 'th' ? 'บิล' : 'orders'}
              </span>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              ฿{sales.length > 0 ? todayNetSales.toLocaleString() : '0.00'}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-200/50 text-[11px] text-slate-500">
              {sales.length > 0
                ? `${todayOrders} ${activeLanguage === 'th' ? 'คำสั่งซื้อล่าสุด' : 'recent transactions'}`
                : activeLanguage === 'th'
                ? 'ยังไม่มีข้อมูลยอดขายวันนี้'
                : 'No sales recorded today'}
            </div>
          </div>

          {/* 2. Monthly Net Sales */}
          <div className="rounded-2xl bg-white/68 backdrop-blur-xl border border-white/85 p-4 sm:p-5 flex flex-col justify-between shadow-[0_8px_24px_-8px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.95)] hover:bg-white/84 transition-all duration-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-sky-600" />
                {activeLanguage === 'th' ? 'ยอดขายสุทธิเดือนนี้' : 'Monthly Net Sales'}
              </span>
              <span className="text-[11px] font-semibold text-sky-700">MTD</span>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              ฿{monthlyNetSales.toLocaleString()}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-200/50 text-[11px] text-slate-500">
              {activeLanguage === 'th' ? 'หลังหักส่วนลด & คืนเงิน' : 'Net of discounts & refunds'}
            </div>
          </div>

          {/* 3. Food Cost % */}
          <div className="rounded-2xl bg-white/68 backdrop-blur-xl border border-white/85 p-4 sm:p-5 flex flex-col justify-between shadow-[0_8px_24px_-8px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.95)] hover:bg-white/84 transition-all duration-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                <Percent className="h-3.5 w-3.5 text-amber-600" />
                {activeLanguage === 'th' ? 'ต้นทุนอาหาร (%)' : 'Food Cost %'}
              </span>
              <span
                className={`text-[11px] font-semibold ${
                  avgFoodCostPercent === null
                    ? 'text-slate-500'
                    : isFoodCostHigh
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                }`}
              >
                {avgFoodCostPercent === null
                  ? activeLanguage === 'th'
                    ? 'ยังไม่มีข้อมูลขาย'
                    : 'No sales data'
                  : isFoodCostHigh
                  ? activeLanguage === 'th'
                    ? 'เกินเป้า'
                    : 'Above Target'
                  : activeLanguage === 'th'
                  ? 'ตามเกณฑ์'
                  : 'Healthy'}
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              {avgFoodCostPercent !== null ? (
                <>
                  <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                    {avgFoodCostPercent.toFixed(1)}%
                  </span>
                  <span className="text-[11px] text-slate-400 font-medium tabular-nums">
                    / {targetFoodCostPct}%
                  </span>
                </>
              ) : (
                <span className="text-lg font-bold tracking-tight text-slate-500">
                  {activeLanguage === 'th' ? 'ยังไม่มีข้อมูลขาย' : 'No sales data'}
                </span>
              )}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-200/50 text-[11px] text-slate-500 tabular-nums">
              {avgFoodCostPercent === null
                ? activeLanguage === 'th'
                  ? 'บันทึกยอดขาย POS เพื่อคำนวณถ่วงน้ำหนัก'
                  : 'Record POS sales for weighted %'
                : isFoodCostHigh
                ? activeLanguage === 'th'
                  ? `สูงกว่าเป้า +${(avgFoodCostPercent - targetFoodCostPct).toFixed(1)}%`
                  : `+${(avgFoodCostPercent - targetFoodCostPct).toFixed(1)}% above target`
                : activeLanguage === 'th'
                ? 'อยู่ในเกณฑ์เป้าหมาย'
                : 'Within target benchmark'}
            </div>
          </div>

          {/* 4. Prime Cost % */}
          <div className="rounded-2xl bg-white/68 backdrop-blur-xl border border-white/85 p-4 sm:p-5 flex flex-col justify-between shadow-[0_8px_24px_-8px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.95)] hover:bg-white/84 transition-all duration-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-indigo-600" />
                {activeLanguage === 'th' ? 'Prime Cost (%)' : 'Prime Cost %'}
              </span>
              <span
                className={`text-[11px] font-semibold ${
                  isPrimeCostHigh ? 'text-rose-700' : 'text-emerald-700'
                }`}
              >
                {isPrimeCostHigh
                  ? activeLanguage === 'th'
                    ? 'สูง'
                    : 'High'
                  : activeLanguage === 'th'
                  ? 'เหมาะสม'
                  : 'Healthy'}
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                {pnl.primeCostPercent.toFixed(1)}%
              </span>
              <span className="text-[11px] text-slate-400 font-medium">COGS+LABOR</span>
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-200/50 text-[11px] text-slate-500 tabular-nums">
              {activeLanguage === 'th'
                ? `เป้าหมายไม่เกิน ${targetPrimeCostPct}%`
                : `Target ≤ ${targetPrimeCostPct}%`}
            </div>
          </div>

          {/* 5. Gross Profit */}
          <div className="rounded-2xl bg-white/68 backdrop-blur-xl border border-white/85 p-4 sm:p-5 flex flex-col justify-between shadow-[0_8px_24px_-8px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.95)] hover:bg-white/84 transition-all duration-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                <UtensilsCrossed className="h-3.5 w-3.5 text-emerald-600" />
                {activeLanguage === 'th' ? 'กำไรขั้นต้น (GP)' : 'Gross Profit'}
              </span>
              <span className="text-[11px] font-semibold text-emerald-700 tabular-nums">
                {pnl.grossMarginPercent.toFixed(1)}%
              </span>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight text-emerald-700 tabular-nums">
              ฿{pnl.grossProfit.toLocaleString()}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-200/50 text-[11px] text-slate-500">
              {activeLanguage === 'th' ? 'หลังหักต้นทุนอาหาร & กล่อง' : 'After Food & Packaging COGS'}
            </div>
          </div>

          {/* 6. Operating Profit */}
          <div className="rounded-2xl bg-white/68 backdrop-blur-xl border border-white/85 p-4 sm:p-5 flex flex-col justify-between shadow-[0_8px_24px_-8px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.95)] hover:bg-white/84 transition-all duration-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                <FileSpreadsheet className="h-3.5 w-3.5 text-slate-600" />
                {activeLanguage === 'th' ? 'กำไรจากการดำเนินงาน (Operating Profit)' : 'Operating Profit'}
              </span>
              <span className="text-[11px] font-semibold text-slate-600 tabular-nums">
                {pnl.operatingMarginPercent.toFixed(1)}%
              </span>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              ฿{pnl.operatingProfit.toLocaleString()}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-200/50 text-[11px] text-slate-500">
              {activeLanguage === 'th' ? 'หลังหักค่าใช้จ่ายบริหาร' : 'After OPEX & Store Overheads'}
            </div>
          </div>

          {/* 7. Net Profit */}
          <div className="rounded-2xl bg-white/68 backdrop-blur-xl border border-white/85 p-4 sm:p-5 flex flex-col justify-between shadow-[0_8px_24px_-8px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.95)] hover:bg-white/84 transition-all duration-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                {pnl.netProfit >= 0 ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5 text-rose-600" />
                )}
                {activeLanguage === 'th' ? 'กำไรสุทธิ' : 'Net Profit'}
              </span>
              <span
                className={`text-[11px] font-semibold tabular-nums ${
                  pnl.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {pnl.netMarginPercent.toFixed(1)}%
              </span>
            </div>
            <div
              className={`mt-3 text-2xl font-bold tracking-tight tabular-nums ${
                pnl.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              ฿{pnl.netProfit.toLocaleString()}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-200/50 text-[11px] text-slate-500 tabular-nums">
              {activeLanguage === 'th'
                ? `ประมาณการภาษี ${incomeTaxRate}%`
                : `Estimated tax @ ${incomeTaxRate}%`}
            </div>
          </div>

          {/* 8. Break-Even Target */}
          <div className="rounded-2xl bg-white/68 backdrop-blur-xl border border-white/85 p-4 sm:p-5 flex flex-col justify-between shadow-[0_8px_24px_-8px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.95)] hover:bg-white/84 transition-all duration-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                <Scale className="h-3.5 w-3.5 text-orange-600" />
                {activeLanguage === 'th' ? 'จุดคุ้มทุนต่อเดือน' : 'Break-Even Target'}
              </span>
              {!derivedMargin.hasRealData && avgFoodCostPercent !== null ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                  {activeLanguage === 'th' ? 'ประมาณการ' : 'Estimated'}
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-slate-500">BEP</span>
              )}
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {breakEven.isValid
                ? `฿${Math.round(breakEven.breakEvenSales).toLocaleString()}`
                : activeLanguage === 'th'
                ? 'รอข้อมูลขายจริง'
                : 'Awaiting Sales'}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-200/50 text-[11px] font-medium tabular-nums space-y-0.5">
              {breakEven.isValid ? (
                <div className="text-emerald-700">
                  {activeLanguage === 'th'
                    ? `฿${Math.round(breakEven.breakEvenDailySales).toLocaleString()}/วัน · ${breakEven.breakEvenDailyOrders} จาน/วัน`
                    : `฿${Math.round(breakEven.breakEvenDailySales).toLocaleString()}/day`}
                </div>
              ) : (
                <div className="text-amber-700">
                  {activeLanguage === 'th' ? 'บันทึกยอดขายเพื่อคำนวณ CM%' : 'Record sales to compute CM%'}
                </div>
              )}
              <div className="text-[10px] text-slate-400">
                {formatPeriodCalculationLabel('month', targetMonth, activeLanguage)}
              </div>
            </div>
          </div>
        </section>

        {/* Band 3: Actionable Intelligence Section */}
        <WhatShouldIDoSection
          advices={generatedAdvices}
          activeLanguage={activeLanguage}
          onNavigate={handleNavigate}
        />

        {/* Band 4: Menu Profitability Summary Glass Table */}
        <section className="rounded-2xl bg-white/70 backdrop-blur-xl border border-white/85 p-5 sm:p-6 shadow-[0_8px_28px_-6px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.95)]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h2 className="text-base font-bold tracking-tight text-slate-900">
              {activeLanguage === 'th'
                ? 'วิเคราะห์ต้นทุนและกำไรของเมนูหลัก'
                : 'Menu Cost & Profit Breakdown'}
            </h2>

            <button
              type="button"
              onClick={() => handleNavigate('menu_costing')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 cursor-pointer transition-colors shrink-0"
            >
              <span>{activeLanguage === 'th' ? 'ดูเมนูทั้งหมด' : 'View All Menus'}</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white/40">
            <table className="exec-glass-table w-full text-left text-xs">
              <thead>
                <tr>
                  <th className="py-2.5 px-3.5">{activeLanguage === 'th' ? 'รหัส / ชื่อเมนู' : 'Code / Menu'}</th>
                  <th className="py-2.5 px-3.5">{activeLanguage === 'th' ? 'พอร์ชั่น' : 'Portion'}</th>
                  <th className="py-2.5 px-3.5 text-right">{activeLanguage === 'th' ? 'ต้นทุนอาหาร (฿)' : 'Food Cost (฿)'}</th>
                  <th className="py-2.5 px-3.5 text-right">{activeLanguage === 'th' ? 'กล่อง (฿)' : 'Packaging (฿)'}</th>
                  <th className="py-2.5 px-3.5 text-right">{activeLanguage === 'th' ? 'ต้นทุนรวม (฿)' : 'Total Cost (฿)'}</th>
                  <th className="py-2.5 px-3.5 text-right">{activeLanguage === 'th' ? 'ราคาขาย (฿)' : 'Selling Price (฿)'}</th>
                  <th className="py-2.5 px-3.5 text-right">{activeLanguage === 'th' ? '% Food Cost' : 'Food Cost %'}</th>
                  <th className="py-2.5 px-3.5 text-right">{activeLanguage === 'th' ? 'กำไรต่อจาน (฿)' : 'Profit / Dish (฿)'}</th>
                  <th className="py-2.5 px-3.5 text-center">{activeLanguage === 'th' ? 'สถานะ' : 'Status'}</th>
                </tr>
              </thead>
              <tbody className="text-slate-700 tabular-nums">
                {menuItems.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-xs text-slate-500">
                      {activeLanguage === 'th'
                        ? 'ยังไม่มีข้อมูลเมนูในระบบต้นทุน'
                        : 'No menu costing records available yet.'}
                    </td>
                  </tr>
                ) : (
                  menuItems.map((menu: any) => {
                    const portionsList = getMenuPortions(menu);
                    if (!portionsList || portionsList.length === 0) return null;
                    const targetFoodCost =
                      currentSettings?.defaultTargetFoodCostPercent ||
                      settings?.defaultTargetFoodCostPercent ||
                      35;
                    return portionsList.map((portion: any, pIdx: number) => {
                      const isHighFoodCost = (portion.foodCostPercent || 0) > targetFoodCost;
                      const isLoss = (portion.contributionProfit ?? 0) < 0;
                      const displayMenuName =
                        activeLanguage === 'en'
                          ? menu.englishName || menu.name || menu.thaiName || 'Menu'
                          : menu.thaiName || menu.name || 'เมนู';
                      return (
                        <tr key={`${menu.id}-${portion.id}`} className="transition-colors">
                          <td className="py-3 px-3.5 font-medium text-slate-900">
                            {pIdx === 0 ? (
                              <div>
                                <div className="font-semibold text-slate-900">
                                  {displayMenuName}
                                </div>
                                {menu.code && (
                                  <div className="text-[11px] text-slate-400 font-mono">
                                    {menu.code}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 pl-3">↳</span>
                            )}
                          </td>
                          <td className="py-3 px-3.5 text-slate-600">{portion.name}</td>
                          <td className="py-3 px-3.5 text-right">
                            ฿{(portion.directFoodCost || 0).toFixed(2)}
                          </td>
                          <td className="py-3 px-3.5 text-right text-slate-500">
                            ฿{(portion.packagingCost || 0).toFixed(2)}
                          </td>
                          <td className="py-3 px-3.5 text-right font-semibold text-slate-900">
                            ฿{(portion.totalDirectCost || 0).toFixed(2)}
                          </td>
                          <td className="py-3 px-3.5 text-right font-bold text-slate-900">
                            ฿{portion.sellingPrice || 0}
                          </td>
                          <td
                            className={`py-3 px-3.5 text-right font-semibold ${
                              isHighFoodCost ? 'text-rose-600' : 'text-emerald-700'
                            }`}
                          >
                            {(portion.foodCostPercent || 0).toFixed(1)}%
                          </td>
                          <td
                            className={`py-3 px-3.5 text-right font-bold ${
                              isLoss ? 'text-rose-600' : 'text-emerald-700'
                            }`}
                          >
                            ฿{(portion.contributionProfit ?? 0).toFixed(2)}
                          </td>
                          <td className="py-3 px-3.5 text-center">
                            {isLoss ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                <span>{activeLanguage === 'th' ? 'ขาดทุน' : 'Loss'}</span>
                              </span>
                            ) : isHighFoodCost ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                <span>{activeLanguage === 'th' ? 'ควรปรับราคา' : 'Reprice'}</span>
                              </span>
                            ) : (
                              <span className="text-[11px] font-semibold text-emerald-700">
                                {activeLanguage === 'th' ? 'กำไรดี' : 'Healthy'}
                              </span>
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
    </div>
  );
};

