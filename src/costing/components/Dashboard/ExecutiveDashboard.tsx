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

  const monthlyGrossSales = sales.reduce((sum, s) => sum + s.grossSales, 0);
  const monthlyDiscounts = sales.reduce((sum, s) => sum + s.discounts, 0);
  const monthlyRefunds = sales.reduce((sum, s) => sum + s.refunds, 0);
  const monthlyNetSales = monthlyGrossSales - monthlyDiscounts - monthlyRefunds;

  // Operating Expenses (same definition as ProfitAndLossView)
  const totalOperatingExpenses = effectiveExpenses.reduce((sum, e) => sum + e.amount, 0) + nonKitchenLabor;
  const fixedExpenses = effectiveExpenses.filter((e) => e.isFixed).reduce((sum, e) => sum + e.amount, 0) + nonKitchenLabor;

  // Check for actual purchases & inventory stock
  const purchasesList = React.useMemo(() => StorageService.getPurchases(), []);
  const inventoryList = React.useMemo(() => StorageService.getInventory(), []);
  const salesOrdersList = React.useMemo(() => StorageService.getSalesOrders(), []);
  const hasActualStock = purchasesList.length > 0 && inventoryList.length > 0;

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
    const estimatedBeginningStockCost = totalEndingStockCost * 1.05;
    const actualCogsResult = calculateInventoryCOGS(
      estimatedBeginningStockCost,
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
    incomeTaxRate
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

  const generatedAdvices: WhatShouldIDoAdvice[] = advices && advices.length > 0 ? advices : defaultAdvicesList;

  return (
    <div className="space-y-6">
      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl bg-[#151518] border border-white/10 p-6 text-white">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[#10B981] animate-pulse"></span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#10B981]">
              {activeLanguage === 'th' ? 'สถานะร้านค้า: ระบบพร้อมใช้งาน' : 'Engine Live & Active'}
            </span>
          </div>
          <h1 className="mt-1 text-xl sm:text-2xl font-light tracking-tight text-white">
            {activeLanguage === 'th' ? 'แดชบอร์ดบริหารต้นทุน & กำไร' : 'Executive Cost & Profit Overview'}
          </h1>
          <p className="mt-1 text-xs text-white/40">
            {activeLanguage === 'th'
              ? 'สรุปตัวเลขทางการเงิน ความสามารถในการทำกำไรต่อจาน และจุดคุ้มทุนแบบ Real-Time'
              : 'Holistic view of restaurant margins, portion costs, platform GP, and break-even status.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {syncFeedback && (
            <span className="text-xs text-amber-300 bg-amber-950/60 px-2.5 py-1.5 rounded-lg border border-amber-500/30">
              {syncFeedback}
            </span>
          )}
          <button
            type="button"
            onClick={handleSyncLivePOS}
            disabled={isSyncingSales}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 px-3.5 py-2 text-xs font-medium text-emerald-400 transition-all cursor-pointer disabled:opacity-50"
            title="ดึงยอดขายสดล่าสุดจาก Firebase Firestore ที่ POS บันทึกเข้ามา"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncingSales ? 'animate-spin' : ''}`} />
            <span>{isSyncingSales ? 'กำลังซิงค์ POS...' : '📡 ซิงค์ยอดขายสดจาก POS'}</span>
          </button>
          <button
            type="button"
            onClick={() => handleNavigate('scenario_calculator')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF6321] hover:bg-[#FF6321]/90 px-4 py-2 text-xs font-semibold text-white transition-all shadow-sm cursor-pointer"
          >
            <TrendingUp className="h-4 w-4" />
            <span>{activeLanguage === 'th' ? 'จำลองผลกระทบราคา (What-If)' : 'Scenario Simulator'}</span>
          </button>
        </div>
      </div>

      {/* Warning banner when duplicate payroll expenses exist */}
      {hasDuplicatePayroll && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-300 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <span>พบรายจ่ายหมวดเงินเดือน ระบบไม่นับซ้ำ เพราะใช้ข้อมูลจากหน้าพนักงาน</span>
        </div>
      )}

      {/* 8 Essential Restaurant KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Today's Net Sales */}
        <div className="bg-[#151518] rounded-xl border border-white/5 p-4 flex flex-col justify-between hover:border-white/15 transition-colors">
          <div className="flex justify-between items-start">
            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">
              {activeLanguage === 'th' ? 'ยอดขายวันนี้' : "Today's Net"}
            </span>
            <span className="text-[#10B981] text-[10px] bg-[#10B981]/10 px-2 py-0.5 rounded-full font-mono font-medium">
              +{todayOrders} {activeLanguage === 'th' ? 'บิล' : 'orders'}
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-light tracking-tight text-white font-mono">
              ฿{sales.length > 0 ? todayNetSales.toLocaleString() : '0.00'}
            </span>
            <span className="text-xs text-white/20 font-mono">NET</span>
          </div>
          <div className="mt-2 text-[10px] text-white/40">
            {sales.length > 0
              ? `${todayOrders} ${activeLanguage === 'th' ? 'รายการคำสั่งซื้อล่าสุด' : 'recent transactions'}`
              : (activeLanguage === 'th' ? 'ยังไม่มีข้อมูลยอดขาย' : 'No sales data yet')}
          </div>
        </div>

        {/* 2. Monthly Net Sales */}
        <div className="bg-[#151518] rounded-xl border border-white/5 p-4 flex flex-col justify-between hover:border-white/15 transition-colors">
          <div className="flex justify-between items-start">
            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">
              {activeLanguage === 'th' ? 'ยอดขายสุทธิเดือนนี้' : 'Monthly Net'}
            </span>
            <span className="text-[#00B1FF] text-[10px] bg-[#00B1FF]/10 px-2 py-0.5 rounded-full font-mono font-medium">
              Active MTD
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-light tracking-tight text-white">฿{monthlyNetSales.toLocaleString()}</span>
            <span className="text-xs text-white/20 font-mono">NET</span>
          </div>
          <div className="mt-2 text-[10px] text-white/40">
            {activeLanguage === 'th' ? 'หักส่วนลด & คืนเงินแล้ว' : 'Net of discounts & refunds'}
          </div>
        </div>

        {/* 3. Food Cost % */}
        <div className="bg-[#151518] rounded-xl border border-white/5 p-4 flex flex-col justify-between hover:border-white/15 transition-colors">
          <div className="flex justify-between items-start">
            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">
              {activeLanguage === 'th' ? '% ต้นทุนอาหาร' : 'Food Cost %'}
            </span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                avgFoodCostPercent > (settings.defaultTargetFoodCostPercent || currentSettings.defaultTargetFoodCostPercent || 30)
                  ? 'text-[#F59E0B] bg-[#F59E0B]/10'
                  : 'text-[#10B981] bg-[#10B981]/10'
              }`}
            >
              {avgFoodCostPercent > (settings.defaultTargetFoodCostPercent || currentSettings.defaultTargetFoodCostPercent || 30) ? 'Above Target' : 'Healthy'}
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-light tracking-tight text-white">{avgFoodCostPercent.toFixed(1)}%</span>
            <span className="text-xs text-white/20 font-mono">TARGET {currentSettings.defaultTargetFoodCostPercent || 30}%</span>
          </div>
          <div className="mt-2 text-[10px] text-white/40">
            {avgFoodCostPercent > (currentSettings.defaultTargetFoodCostPercent || 30)
              ? `⚠️ สูงกว่าเป้า +${(avgFoodCostPercent - (currentSettings.defaultTargetFoodCostPercent || 30)).toFixed(1)}%`
              : '✅ อยู่ในเกณฑ์มาตรฐาน'}
          </div>
        </div>

        {/* 4. Prime Cost % */}
        <div className="bg-[#151518] rounded-xl border border-white/5 p-4 flex flex-col justify-between hover:border-white/15 transition-colors">
          <div className="flex justify-between items-start">
            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">
              {activeLanguage === 'th' ? '% Prime Cost' : 'Prime Cost %'}
            </span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                pnl.primeCostPercent <= (currentSettings.primeCostTargetPercent || 55)
                  ? 'text-[#10B981] bg-[#10B981]/10'
                  : 'text-[#EF4444] bg-[#EF4444]/10'
              }`}
            >
              {pnl.primeCostPercent <= (currentSettings.primeCostTargetPercent || 55) ? 'Healthy' : 'High'}
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-light tracking-tight text-white">{pnl.primeCostPercent.toFixed(1)}%</span>
            <span className="text-xs text-white/20 font-mono">COGS+LABOR</span>
          </div>
          <div className="mt-2 text-[10px] text-white/40">
            {activeLanguage === 'th' ? `เป้าหมายไม่เกิน ${currentSettings.primeCostTargetPercent || 55}%` : `Target ≤ ${currentSettings.primeCostTargetPercent || 55}%`}
          </div>
        </div>

        {/* 5. Gross Profit */}
        <div className="bg-[#151518] rounded-xl border border-white/5 p-4 flex flex-col justify-between hover:border-white/15 transition-colors">
          <div className="flex justify-between items-start">
            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">
              {activeLanguage === 'th' ? 'กำไรขั้นต้น (GP)' : 'Gross Profit'}
            </span>
            <span className="text-[#10B981] text-[10px] bg-[#10B981]/10 px-2 py-0.5 rounded-full font-mono font-medium">
              {pnl.grossMarginPercent.toFixed(1)}%
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-light tracking-tight text-[#10B981]">฿{pnl.grossProfit.toLocaleString()}</span>
            <span className="text-xs text-white/20 font-mono">MARGIN</span>
          </div>
          <div className="mt-2 text-[10px] text-white/40">
            {activeLanguage === 'th' ? 'หลังหัก COGS อาหาร & บรรจุภัณฑ์' : 'After Food & Packaging COGS'}
          </div>
        </div>

        {/* 6. Operating Profit */}
        <div className="bg-[#151518] rounded-xl border border-white/5 p-4 flex flex-col justify-between hover:border-white/15 transition-colors">
          <div className="flex justify-between items-start">
            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">
              {activeLanguage === 'th' ? 'กำไรดำเนินงาน' : 'Operating Profit'}
            </span>
            <span className="text-white/40 text-[10px] font-mono">
              OP {pnl.operatingMarginPercent.toFixed(1)}%
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-light tracking-tight text-white">฿{pnl.operatingProfit.toLocaleString()}</span>
            <span className="text-xs text-white/20 font-mono">EBITDA</span>
          </div>
          <div className="mt-2 text-[10px] text-white/40">
            {activeLanguage === 'th' ? 'หลังหักค่าใช้จ่ายบริหารทั้งหมด' : 'After OPEX & Store Overheads'}
          </div>
        </div>

        {/* 7. Net Profit */}
        <div className="bg-[#151518] rounded-xl border border-white/5 p-4 flex flex-col justify-between hover:border-white/15 transition-colors">
          <div className="flex justify-between items-start">
            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">
              {activeLanguage === 'th' ? 'กำไรสุทธิ' : 'Net Profit'}
            </span>
            <span className="text-[#10B981] text-[10px] bg-[#10B981]/10 px-2 py-0.5 rounded-full font-mono font-medium">
              Net {pnl.netMarginPercent.toFixed(1)}%
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-light tracking-tight text-[#10B981]">฿{pnl.netProfit.toLocaleString()}</span>
            <span className="text-xs text-white/20 font-mono">BOTTOM LINE</span>
          </div>
          <div className="mt-2 text-[10px] text-white/40">
            {activeLanguage === 'th' ? `ประมาณการภาษีเงินได้ ${incomeTaxRate}%` : `Estimated income tax @ ${incomeTaxRate}%`}
          </div>
        </div>

        {/* 8. Break-Even Target */}
        <div className="bg-[#151518] rounded-xl border border-white/5 p-4 flex flex-col justify-between hover:border-white/15 transition-colors">
          <div className="flex justify-between items-start">
            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">
              {activeLanguage === 'th' ? 'จุดคุ้มทุน' : 'Break-Even Gap'}
            </span>
            <span className="text-white/30 text-[10px] font-mono">DAILY EST.</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-light tracking-tight text-white">฿{Math.round(breakEven.breakEvenSales).toLocaleString()}</span>
            <span className="text-xs text-white/20 font-mono">TARGET</span>
          </div>
          <div className="mt-2 text-[10px] text-[#10B981] font-mono">
            {activeLanguage === 'th'
              ? `฿${Math.round(breakEven.breakEvenDailySales).toLocaleString()}/วัน (${breakEven.breakEvenDailyOrders} จาน/วัน)`
              : `฿${Math.round(breakEven.breakEvenDailySales).toLocaleString()}/day`}
          </div>
        </div>
      </div>

      {/* Actionable Intelligence Section (WHAT SHOULD I DO?) */}
      <WhatShouldIDoSection
        advices={generatedAdvices}
        activeLanguage={activeLanguage}
        onNavigate={handleNavigate}
      />

      {/* Menu Profitability Summary Table */}
      <div className="bg-[#151518] rounded-xl border border-white/5 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-white/60">
              {activeLanguage === 'th' ? 'วิเคราะห์ต้นทุนและกำไรของเมนูหลัก' : 'Menu Cost & Profit Breakdown'}
            </h2>
            <p className="text-xs text-white/40 mt-0.5">
              {activeLanguage === 'th'
                ? 'เปรียบเทียบต้นทุนอาหารทางตรง ค่าบรรจุภัณฑ์ ราคาขาย และ % Food Cost'
                : 'Direct food cost, packaging cost, selling price, and profit per portion.'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => handleNavigate('menu_costing')}
            className="text-xs font-semibold text-[#FF6321] hover:text-[#FF6321]/80 inline-flex items-center gap-1 cursor-pointer"
          >
            <span>{activeLanguage === 'th' ? 'ดูเมนูทั้งหมด' : 'View All Menus'}</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-white/30 border-b border-white/5 font-normal uppercase tracking-tighter">
                <th className="py-2.5 px-3">รหัส / ชื่อเมนู</th>
                <th className="py-2.5 px-3">พอร์ชั่น</th>
                <th className="py-2.5 px-3 text-right">ต้นทุนอาหาร (฿)</th>
                <th className="py-2.5 px-3 text-right">กล่อง (฿)</th>
                <th className="py-2.5 px-3 text-right">ต้นทุนรวม (฿)</th>
                <th className="py-2.5 px-3 text-right">ราคาขาย (฿)</th>
                <th className="py-2.5 px-3 text-right">% Food Cost</th>
                <th className="py-2.5 px-3 text-right">กำไรต่อจาน (฿)</th>
                <th className="py-2.5 px-3 text-center">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono text-white/80">
              {menuItems.map((menu: any) => {
                const portionsList = getMenuPortions(menu);
                if (!portionsList || portionsList.length === 0) return null;
                const targetFoodCost = (currentSettings?.defaultTargetFoodCostPercent || settings?.defaultTargetFoodCostPercent || 35);
                return portionsList.map((portion: any, pIdx: number) => {
                  const isHighFoodCost = (portion.foodCostPercent || 0) > targetFoodCost;
                  return (
                    <tr key={`${menu.id}-${portion.id}`} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-3 font-medium text-white">
                        {pIdx === 0 ? (
                          <div>
                            <div className="font-semibold text-white font-sans">{menu.thaiName || menu.name || 'เมนู'}</div>
                            <div className="text-[11px] text-white/30 font-mono">{menu.code || '-'}</div>
                          </div>
                        ) : (
                          <span className="text-white/30 pl-4">↳</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-white/60 font-sans">{portion.name}</td>
                      <td className="py-3 px-3 text-right">฿{(portion.directFoodCost || 0).toFixed(2)}</td>
                      <td className="py-3 px-3 text-right text-white/40">฿{(portion.packagingCost || 0).toFixed(2)}</td>
                      <td className="py-3 px-3 text-right font-semibold text-white">
                        ฿{(portion.totalDirectCost || 0).toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-white">
                        ฿{portion.sellingPrice || 0}
                      </td>
                      <td className="py-3 px-3 text-right font-semibold">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md ${
                            isHighFoodCost
                              ? 'bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20 font-bold'
                              : 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20'
                          }`}
                        >
                          {(portion.foodCostPercent || 0).toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-[#10B981]">
                        ฿{(portion.contributionProfit || 0).toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {isHighFoodCost ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#EF4444] bg-[#EF4444]/10 px-2 py-0.5 rounded border border-[#EF4444]/20">
                            <AlertTriangle className="h-3 w-3" /> ควรปรับราคา
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[10px] font-semibold text-[#10B981] bg-[#10B981]/10 px-2 py-0.5 rounded border border-[#10B981]/20">
                            กำไรดี
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
