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
import { calculateProfitAndLoss, calculateBreakEven, calculateInventoryCOGS } from '../../engine/calculations';
import { StorageService } from '../../services/storageService';
import { FirebaseSyncService } from '../../services/firebaseSyncService';
import { calculateVariantCostBreakdown } from '../../services/calculationEngine';
import { INITIAL_SETTINGS } from '../../data/initialData';
import { WhatShouldIDoSection } from './WhatShouldIDoSection';

interface ExecutiveDashboardProps {
  ingredients?: any[];
  menuItems: any[];
  subRecipes?: SubRecipe[];
  channels: SalesChannel[];
  expenses: ExpenseRecord[];
  employees?: Employee[];
  sales: DailySalesRecord[];
  waste?: WasteRecord[];
  wasteRecords?: WasteRecord[];
  inventory?: any[];
  allWaste?: any[];
  settings?: BusinessSettings;
  currentSettings?: any;
  advices?: WhatShouldIDoAdvice[];
  activeLanguage: 'th' | 'en';
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
  settings = INITIAL_SETTINGS,
  currentSettings: rawCurrentSettings,
  advices,
  activeLanguage = 'th',
  onNavigate,
  onNavigateToTab,
  onSalesUpdated,
}) => {
  const [isSyncingSales, setIsSyncingSales] = React.useState(false);
  const [syncFeedback, setSyncFeedback] = React.useState<string | null>(null);

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
        setSyncFeedback(`ซิงค์สำเร็จ (${res.data.length} วัน)`);
      } else {
        setSyncFeedback(res.error ? `ข้อผิดพลาด: ${res.error}` : 'ไม่พบข้อมูลใหม่จาก POS');
      }
    } catch (err: any) {
      setSyncFeedback('ซิงค์ล้มเหลว');
    } finally {
      setIsSyncingSales(false);
      setTimeout(() => setSyncFeedback(null), 4000);
    }
  };

  const currentSettings = rawCurrentSettings || settings || INITIAL_SETTINGS;
  const allWaste = (rawAllWaste && rawAllWaste.length > 0)
    ? rawAllWaste
    : (waste && waste.length > 0 ? waste : wasteRecords || []);

  // Safe helper to extract or adapt portions/variants for any menu structure
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

        return menu.variants.map((v: any) => {
          let directFoodCost = 0;
          let packagingCost = (st as any)?.defaultTakeawayPackagingCost || 3.5;
          let sellingPrice = v.sellingPrice || 50;

          try {
            if (v.recipeItems && v.recipeItems.length > 0) {
              const bd = calculateVariantCostBreakdown(v, menu.name || menu.thaiName || '', ingMap as any, sauceMap as any, st as any);
              directFoodCost = bd.totalFoodCost || bd.totalIngredientCost || 0;
              packagingCost = bd.packagingCost || packagingCost;
              sellingPrice = bd.sellingPrice || sellingPrice;
            } else if (typeof v.totalFoodCost === 'number') {
              directFoodCost = v.totalFoodCost;
            } else if (typeof v.foodCost === 'number') {
              directFoodCost = v.foodCost;
            }
          } catch (e) {
            directFoodCost = v.foodCost || v.totalFoodCost || 0;
          }

          const totalDirectCost = directFoodCost + packagingCost;
          const foodCostPercent = sellingPrice > 0 ? (totalDirectCost / sellingPrice) * 100 : 0;
          const contributionProfit = Math.max(0, sellingPrice - totalDirectCost);

          return {
            id: v.id,
            name: v.name || v.proteinType || 'จานปกติ',
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
    },
    [ingredients, currentSettings]
  );

  // Double-counting guard: exclude payroll expenses when employees exist
  const isPayrollExpense = (e: ExpenseRecord) => {
    const text = `${e.category || ''} ${(e as any).title || (e as any).name || (e as any).description || ''} ${e.notes || ''}`.toLowerCase();
    const keywords = ['labor', 'salary', 'wage', 'ค่าแรง', 'เงินเดือน'];
    return (
      e.category === 'Labor (Salary & Wages)' ||
      keywords.some((kw) => text.includes(kw))
    );
  };

  const hasDuplicatePayroll = employees.length > 0 && expenses.some(isPayrollExpense);
  const effectiveExpenses = employees.length > 0
    ? expenses.filter((e) => !isPayrollExpense(e))
    : expenses;

  // Real Labor from employees
  const directKitchenLabor = employees
    .filter((e) => e.roleCategory === 'direct_kitchen')
    .reduce((sum, e) => sum + (e.wageRate + (e.benefitsMonthly || 0)), 0);

  const nonKitchenLabor = employees
    .filter((e) => e.roleCategory !== 'direct_kitchen')
    .reduce((sum, e) => sum + (e.wageRate + (e.benefitsMonthly || 0)), 0);

  // Dynamic date logic: use latest sales record date or today's date
  const latestSalesDate = sales.length > 0
    ? [...sales].sort((a, b) => b.date.localeCompare(a.date))[0]?.date
    : null;
  const todayDate = latestSalesDate || new Date().toISOString().split('T')[0];
  const todaySalesRecords = sales.filter((s) => s.date === todayDate);
  const todayNetSales = todaySalesRecords.reduce((sum, s) => sum + s.netSales, 0);
  const todayOrders = todaySalesRecords.reduce((sum, s) => sum + s.orderCount, 0);

  const monthlyGrossSales = sales.reduce((sum, s) => sum + (s.grossSales || 0), 0);
  const monthlyDiscounts = sales.reduce((sum, s) => sum + (s.discounts || 0), 0);
  const monthlyRefunds = sales.reduce((sum, s) => sum + (s.refunds || 0), 0);
  const monthlyNetSales = sales.reduce((sum, s) => {
    if (typeof s.netSales === 'number' && Number.isFinite(s.netSales)) {
      return sum + Math.max(0, s.netSales);
    }
    const nominal = Math.max(0, (s.grossSales || 0) - (s.discounts || 0) - (s.refunds || 0));
    const vatPct = s.vatRatePercent ?? 7;
    return sum + (s.isVatInclusive && vatPct > 0 ? nominal / (1 + vatPct / 100) : nominal);
  }, 0);
  const monthlyChannelFees = sales.reduce((sum, s) => sum + Math.max(0, s.platformFees || 0), 0);

  // Operating Expenses (excluding labor, since totalLabor is deducted inside calculateProfitAndLoss)
  const totalOperatingExpenses = effectiveExpenses.reduce((sum, e) => sum + e.amount, 0);
  const fixedExpenses = effectiveExpenses.filter((e) => e.isFixed).reduce((sum, e) => sum + e.amount, 0) + nonKitchenLabor;

  // Check for actual purchases & explicit beginning inventory stock (never invent 1.05x buffer)
  const purchasesList = React.useMemo(() => StorageService.getPurchases(), []);
  const inventoryList = React.useMemo(() => StorageService.getInventory(), []);
  const salesOrdersList = React.useMemo(() => StorageService.getSalesOrders(), []);
  const hasExplicitBeginningStock = inventoryList.some(
    (item: any) => typeof item.beginningValue === 'number' && Number.isFinite(item.beginningValue)
  );
  const hasActualStock = purchasesList.length > 0 && inventoryList.length > 0 && hasExplicitBeginningStock;

  // Weighted operational food cost % across all active portions
  const allPortions = menuItems.flatMap((m) => getMenuPortions(m));
  const avgFoodCostPercent = allPortions.length > 0
    ? allPortions.reduce((sum, p) => sum + (p.foodCostPercent || 0), 0) / allPortions.length
    : 32;

  const estimatedFoodCogs = monthlyNetSales * (avgFoodCostPercent / 100);
  const estimatedPackagingCogs = monthlyNetSales * 0.035;

  let foodCogsToUse = estimatedFoodCogs;
  let packagingCogsToUse = estimatedPackagingCogs;

  if (hasActualStock) {
    const totalPurchasesCost = purchasesList.reduce((sum, p) => sum + (p.totalPrice || p.price || 0), 0);
    const totalEndingStockCost = inventoryList.reduce((sum, item) => sum + ((item.currentStock ?? 0) * (item.costPerUnit || 0)), 0);
    const totalWasteCost = (allWaste || []).reduce((sum, w) => sum + (w.totalCost || w.cost || 0), 0);
    const totalBeginningStockCost = inventoryList.reduce((sum, item: any) => sum + (item.beginningValue || 0), 0);
    const actualCogsResult = calculateInventoryCOGS(
      totalBeginningStockCost,
      totalPurchasesCost,
      totalEndingStockCost,
      totalWasteCost
    );
    foodCogsToUse = actualCogsResult.cogs;
    packagingCogsToUse = salesOrdersList.reduce((sum, o) => sum + (o.packagingCost || 0), 0) || estimatedPackagingCogs;
  }

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

  const avgCMPercent = 100 - avgFoodCostPercent - 3.5;
  const breakEven = calculateBreakEven(
    fixedExpenses + directKitchenLabor,
    avgCMPercent,
    110,
    currentSettings.operatingDaysPerMonth || 30
  );

  // Real average daily net sales calculation from distinct logged days
  const loggedDates = Array.from(new Set(sales.map((s) => s.date).filter(Boolean)));
  const loggedDaysCount = loggedDates.length;
  const totalLoggedNetSales = sales.reduce((sum, s) => sum + s.netSales, 0);
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
    const menuTitle = m.thaiName || m.name || 'เมนูหลัก';
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
  const grabChannel = channels.find((c) => c.id === 'grab' || c.code === 'GRAB') || { commissionPercent: currentSettings.grabFoodCommissionPercent ?? 30 };
  const grabVatGp = ((grabChannel.commissionPercent || 30) * 1.07).toFixed(1);
  defaultAdvicesList.push({
    id: 'adv-2',
    type: 'WARNING',
    category: 'Delivery Loss',
    titleTh: `ช่องทาง GrabFood โดนหัก GP รวม VAT ${grabVatGp}%`,
    titleEn: `GrabFood Delivery Commission with VAT is ${grabVatGp}%`,
    descriptionTh: 'หากตั้งราคาขายเดลิเวอรีเท่ากับหน้าร้าน กำไรขั้นต้นจะลดลง แนะนำใช้สูตรคำนวณราคา Delivery Markup เพื่อรักษากำไรสุทธิ',
    descriptionEn: 'Selling at dine-in prices on delivery erodes gross margin. Use the built-in Delivery Markup strategy.',
    actionRecommendationTh: 'ปรับราคาเมนูเดลิเวอรีเพื่อรักษา Net Profit',
    actionRecommendationEn: 'Optimize delivery selling prices',
    metricLabel: 'GP + VAT',
    metricValue: `${grabVatGp}%`,
    relatedEntityType: 'channel',
  });

  // 3. Break-even insight card: only include if enough data (loggedDaysCount >= 1 and breakEvenDailySales > 0)
  if (loggedDaysCount >= 1 && breakEven.breakEvenDailySales > 0) {
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
  const isFoodCostHigh = avgFoodCostPercent > targetFoodCostPct;
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
              title="ดึงยอดขายสดล่าสุดจาก Firebase Firestore ที่ POS บันทึกเข้ามา"
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

        {/* Duplicate Payroll Guard Banner */}
        {hasDuplicatePayroll && (
          <div className="rounded-2xl bg-amber-50/75 backdrop-blur-md border border-amber-200/85 px-4 py-3 text-amber-900 text-xs flex items-center gap-2 shadow-2xs">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>พบรายจ่ายหมวดเงินเดือน ระบบไม่นับซ้ำ เพราะใช้ข้อมูลจากหน้าพนักงานแล้ว</span>
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
                  isFoodCostHigh ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {isFoodCostHigh
                  ? activeLanguage === 'th'
                    ? 'เกินเป้า'
                    : 'Above Target'
                  : activeLanguage === 'th'
                  ? 'ตามเกณฑ์'
                  : 'Healthy'}
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                {avgFoodCostPercent.toFixed(1)}%
              </span>
              <span className="text-[11px] text-slate-400 font-medium tabular-nums">
                / {targetFoodCostPct}%
              </span>
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-200/50 text-[11px] text-slate-500 tabular-nums">
              {isFoodCostHigh
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
                {activeLanguage === 'th' ? 'กำไรดำเนินงาน' : 'Operating Profit'}
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
              <span className="text-[11px] font-semibold text-slate-500">BEP</span>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              ฿{Math.round(breakEven.breakEvenSales).toLocaleString()}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-200/50 text-[11px] text-emerald-700 font-medium tabular-nums">
              {activeLanguage === 'th'
                ? `฿${Math.round(breakEven.breakEvenDailySales).toLocaleString()}/วัน · ${breakEven.breakEvenDailyOrders} จาน/วัน`
                : `฿${Math.round(breakEven.breakEvenDailySales).toLocaleString()}/day`}
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
                  <th className="py-2.5 px-3.5">รหัส / ชื่อเมนู</th>
                  <th className="py-2.5 px-3.5">พอร์ชั่น</th>
                  <th className="py-2.5 px-3.5 text-right">ต้นทุนอาหาร (฿)</th>
                  <th className="py-2.5 px-3.5 text-right">กล่อง (฿)</th>
                  <th className="py-2.5 px-3.5 text-right">ต้นทุนรวม (฿)</th>
                  <th className="py-2.5 px-3.5 text-right">ราคาขาย (฿)</th>
                  <th className="py-2.5 px-3.5 text-right">% Food Cost</th>
                  <th className="py-2.5 px-3.5 text-right">กำไรต่อจาน (฿)</th>
                  <th className="py-2.5 px-3.5 text-center">สถานะ</th>
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
                      return (
                        <tr key={`${menu.id}-${portion.id}`} className="transition-colors">
                          <td className="py-3 px-3.5 font-medium text-slate-900">
                            {pIdx === 0 ? (
                              <div>
                                <div className="font-semibold text-slate-900">
                                  {menu.thaiName || menu.name || 'เมนู'}
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
                          <td className="py-3 px-3.5 text-right font-bold text-emerald-700">
                            ฿{(portion.contributionProfit || 0).toFixed(2)}
                          </td>
                          <td className="py-3 px-3.5 text-center">
                            {isHighFoodCost ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                <span>ควรปรับราคา</span>
                              </span>
                            ) : (
                              <span className="text-[11px] font-semibold text-emerald-700">
                                กำไรดี
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

