import React, { useState, useMemo } from 'react';
import { DollarSign, Percent, TrendingUp, Layers, Calendar, ArrowDownRight, ArrowUpRight, Scale, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { ExpenseRecord, DailySalesRecord, Employee, BusinessSettings } from '../../types/domain';
import { calculateProfitAndLoss, calculateInventoryCOGS, calculateVariance } from '../../engine/calculations';
import { StorageService } from '../../services/storageService';
import { FirebaseSyncService } from '../../services/firebaseSyncService';

interface ProfitAndLossViewProps {
  sales: DailySalesRecord[];
  expenses: ExpenseRecord[];
  employees: Employee[];
  settings: BusinessSettings;
  activeLanguage: 'th' | 'en';
  onSalesUpdated?: (sales: DailySalesRecord[]) => void;
}

export const ProfitAndLossView: React.FC<ProfitAndLossViewProps> = ({
  sales,
  expenses,
  employees,
  settings,
  activeLanguage,
  onSalesUpdated,
}) => {
  const [isSyncingSales, setIsSyncingSales] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const handleSyncLivePOS = async () => {
    setIsSyncingSales(true);
    setSyncFeedback(null);
    try {
      const res = await FirebaseSyncService.pullDailySales();
      if (res.success && res.data) {
        if (onSalesUpdated) {
          onSalesUpdated(res.data);
        }
        setSyncFeedback(`ซิงค์สำเร็จ (${res.data.length} รายการ)`);
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

  // Aggregate monthly revenues
  const grossSales = sales.reduce((sum, s) => sum + s.grossSales, 0);
  const discounts = sales.reduce((sum, s) => sum + s.discounts, 0);
  const refunds = sales.reduce((sum, s) => sum + s.refunds, 0);
  const netSales = grossSales - discounts - refunds;

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

  // Operating Expenses from general expenses
  const totalExpenses = effectiveExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Direct Kitchen Labor vs FOH / Management Labor
  const directKitchenLabor = employees
    .filter((e) => e.roleCategory === 'direct_kitchen')
    .reduce((sum, e) => sum + (e.wageRate + (e.benefitsMonthly || 0)), 0);
  const nonKitchenLabor = employees
    .filter((e) => e.roleCategory !== 'direct_kitchen')
    .reduce((sum, e) => sum + (e.wageRate + (e.benefitsMonthly || 0)), 0);

  // Load Inventory, Purchases, Sales Orders, and Waste records for actual COGS & theoretical variance
  const purchasesList = useMemo(() => StorageService.getPurchases(), []);
  const inventoryList = useMemo(() => StorageService.getInventory(), []);
  const salesOrdersList = useMemo(() => StorageService.getSalesOrders(), []);
  const wasteList = useMemo(() => StorageService.getWasteLog(), []);

  // Check if purchase and inventory records exist
  const hasActualStockData = purchasesList.length > 0 && inventoryList.length > 0;

  // Selector: "actual" vs "estimated" (Default to estimated % of sales as user doesn't track inventory stock)
  const [cogsMode, setCogsMode] = useState<'actual' | 'estimated'>('estimated');

  // Effective mode falls back to estimated if actual stock data is missing
  const effectiveCogsMode = cogsMode === 'actual' && !hasActualStockData ? 'estimated' : cogsMode;

  // Actual Inventory COGS calculation: Beginning + Purchases - Waste - Ending
  const totalPurchasesCost = purchasesList.reduce((sum, p) => sum + (p.totalPrice || p.price || 0), 0);
  const totalEndingStockCost = inventoryList.reduce((sum, item) => sum + ((item.currentStock ?? 0) * (item.costPerUnit || 0)), 0);
  const totalWasteCost = wasteList.reduce((sum, w) => sum + (w.totalCost || w.cost || 0), 0);
  // Default beginning stock assumption if not explicitly logged (or base starting inventory)
  const estimatedBeginningStockCost = totalEndingStockCost * 1.05; // 5% buffer if single stock point

  const actualCogsResult = calculateInventoryCOGS(
    estimatedBeginningStockCost,
    totalPurchasesCost,
    totalEndingStockCost,
    totalWasteCost
  );

  // Theoretical COGS = sum of frozen cost snapshots (totalFoodCost) of sale orders
  const theoreticalCOGS = salesOrdersList.reduce((sum, order) => sum + (order.totalFoodCost || 0), 0);

  // Variance calculation (actual vs theoretical)
  const varianceResult = calculateVariance(actualCogsResult.cogs, theoreticalCOGS);
  const varianceThresholdPercent = typeof settings.cogsVarianceThresholdPercent === 'number' && Number.isFinite(settings.cogsVarianceThresholdPercent)
    ? settings.cogsVarianceThresholdPercent
    : 3.0; // default 3% of net sales
  const variancePointsOfNetSales = netSales > 0 ? (Math.abs(varianceResult.varianceAmount) / netSales) * 100 : 0;
  const isVarianceExceeded = variancePointsOfNetSales > varianceThresholdPercent;

  // Estimated COGS slider rates
  const [foodCostRate, setFoodCostRate] = useState<number>(31.5);
  const [packagingRate, setPackagingRate] = useState<number>(3.5);

  const estimatedFoodCogs = netSales * (foodCostRate / 100);
  const estimatedPackagingCogs = netSales * (packagingRate / 100);

  // Effective foodCogs and packagingCogs based on chosen mode
  const foodCogs = effectiveCogsMode === 'actual' ? actualCogsResult.cogs : estimatedFoodCogs;
  const packagingCogs = effectiveCogsMode === 'actual'
    ? salesOrdersList.reduce((sum, o) => sum + (o.packagingCost || 0), 0) || estimatedPackagingCogs
    : estimatedPackagingCogs;

  const operatingExpenses = totalExpenses + nonKitchenLabor;
  const foodCostPercent = netSales > 0 ? (foodCogs / netSales) * 100 : 0;
  const packagingCostPercent = netSales > 0 ? (packagingCogs / netSales) * 100 : 0;
  const operatingExpensePercent = netSales > 0 ? (operatingExpenses / netSales) * 100 : 0;

  const incomeTaxRate = typeof settings.incomeTaxRatePercent === 'number' && Number.isFinite(settings.incomeTaxRatePercent)
    ? settings.incomeTaxRatePercent
    : 20;

  const pnl = calculateProfitAndLoss(
    grossSales,
    discounts,
    refunds,
    foodCogs,
    packagingCogs,
    operatingExpenses,
    directKitchenLabor,
    incomeTaxRate
  );


  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl bg-[#151518] border border-white/10 p-6 text-white">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[#10B981] animate-pulse"></span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#10B981]">
              Financial Statements
            </span>
          </div>
          <h1 className="mt-1 text-xl sm:text-2xl font-light tracking-tight text-white flex items-center gap-2">
            <span>{activeLanguage === 'th' ? 'งบกำไรขาดทุนบริหาร (Managerial Profit & Loss P&L)' : 'Monthly Profit & Loss (P&L)'}</span>
          </h1>
          <p className="mt-1 text-xs text-white/40">
            {activeLanguage === 'th'
              ? 'งบการเงินมาตรฐานร้านอาหาร คำนวณยอดขายสุทธิ ต้นทุนอาหาร Prime Cost กำไรดำเนินงาน และกำไรสุทธิ'
              : 'Standard restaurant financial statement showing Net Sales, COGS, Prime Cost, EBITDA, and Net Margin.'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          {syncFeedback && (
            <span className="text-xs text-amber-300 bg-amber-950/60 px-2.5 py-1.5 rounded-lg border border-amber-500/30">
              {syncFeedback}
            </span>
          )}
          <button
            type="button"
            onClick={handleSyncLivePOS}
            disabled={isSyncingSales}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-medium cursor-pointer transition-colors disabled:opacity-50"
            title="ดึงยอดขายสดล่าสุดจาก Firebase Firestore ที่ POS บันทึกเข้ามา"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSales ? 'animate-spin' : ''}`} />
            <span>{isSyncingSales ? 'กำลังซิงค์ POS...' : '📡 ซิงค์ยอดขายสดจาก POS'}</span>
          </button>
        </div>
      </div>

      {/* Warning banner when stock calculation is negative (only if actual stock is tracked and negative) */}
      {effectiveCogsMode === 'actual' && hasActualStockData && actualCogsResult.isNegative && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-300 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <span className="font-semibold">ตัวเลขสต็อกผิดปกติ ตรวจสอบการนับสต็อก (ต้นทุนสต็อกติดลบ ฿{actualCogsResult.cogs.toLocaleString()})</span>
        </div>
      )}

      {/* COGS Calculation Mode Selector Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-[#151518] border border-white/5">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-[#F27D26]" />
          <span className="text-xs font-semibold text-white/80">วิธีคำนวณต้นทุนอาหารขาย (COGS):</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg bg-black/40 p-1 border border-white/10">
            <button
              type="button"
              onClick={() => setCogsMode('estimated')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                effectiveCogsMode === 'estimated'
                  ? 'bg-[#F27D26] text-white shadow-xs'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              ต้นทุนตามสูตร & ยอดขาย (% Food Cost)
            </button>
            <button
              type="button"
              onClick={() => setCogsMode('actual')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                effectiveCogsMode === 'actual'
                  ? 'bg-[#F27D26] text-white shadow-xs'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              ต้นทุนจากการจัดซื้อ (Actual Purchases)
            </button>
          </div>
          {effectiveCogsMode === 'estimated' && (
            <span className="px-2 py-1 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              ตามสูตรมาตรฐาน
            </span>
          )}
          {effectiveCogsMode === 'actual' && (
            <span className="px-2 py-1 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              บิลซื้อจริง
            </span>
          )}
        </div>
      </div>

      {/* Variance Analysis Block (ต้นทุนจริง vs ต้นทุนตามสูตร) */}
      <div className="rounded-xl border border-white/5 bg-[#151518] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-sky-400" />
            <span className="text-sm font-semibold text-white">ส่วนต่างต้นทุน (Variance)</span>
            <span className="text-xs text-white/40 font-mono">(เปรียบเทียบต้นทุนจริง vs ต้นทุนสูตรมาตรฐาน)</span>
          </div>
          <span className="text-xs font-mono text-white/50">
            เกณฑ์การเตือน: {varianceThresholdPercent.toFixed(1)}% ของยอดขายสุทธิ
          </span>
        </div>

        {/* Warning banner when variance exceeds threshold */}
        {isVarianceExceeded && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>
              แจ้งเตือน: ผลต่างต้นทุน {variancePointsOfNetSales.toFixed(1)}% ของยอดขายสุทธิ เกินเกณฑ์ควบคุม {varianceThresholdPercent.toFixed(1)}% กรุณาตรวจสอบการสูญเสีย การตักเกิน หรือของเสีย
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white/5 p-3.5 rounded-xl border border-white/5">
            <div className="text-white/40 text-[10px] uppercase font-bold tracking-wider">ต้นทุนจริงจากการจัดซื้อ (Actual)</div>
            <div className="mt-1.5 text-xl font-light text-white font-mono">
              ฿{Math.round(actualCogsResult.cogs).toLocaleString()}
            </div>
            <div className="text-[10px] text-white/30 font-mono mt-0.5">
              {netSales > 0 ? ((actualCogsResult.cogs / netSales) * 100).toFixed(1) : '0.0'}% of Net Sales
            </div>
          </div>

          <div className="bg-white/5 p-3.5 rounded-xl border border-white/5">
            <div className="text-white/40 text-[10px] uppercase font-bold tracking-wider">ต้นทุนสูตรมาตรฐาน (Theoretical)</div>
            <div className="mt-1.5 text-xl font-light text-white font-mono">
              ฿{Math.round(theoreticalCOGS).toLocaleString()}
            </div>
            <div className="text-[10px] text-white/30 font-mono mt-0.5">
              {netSales > 0 ? ((theoreticalCOGS / netSales) * 100).toFixed(1) : '0.0'}% of Net Sales
            </div>
          </div>

          <div className={`p-3.5 rounded-xl border ${
            isVarianceExceeded ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}>
            <div className="text-[10px] uppercase font-bold tracking-wider">ส่วนต่าง (Variance Amount & %)</div>
            <div className="mt-1.5 text-xl font-light font-mono">
              {varianceResult.varianceAmount > 0 ? `+฿${Math.round(varianceResult.varianceAmount).toLocaleString()}` : `-฿${Math.round(Math.abs(varianceResult.varianceAmount)).toLocaleString()}`}
            </div>
            <div className="text-[10px] font-mono mt-0.5">
              {varianceResult.variancePercent > 0 ? `+${varianceResult.variancePercent.toFixed(1)}%` : `${varianceResult.variancePercent.toFixed(1)}%`} ({variancePointsOfNetSales.toFixed(1)} pp of Sales)
            </div>
          </div>
        </div>
      </div>

      {/* Warning banner when duplicate payroll expenses exist */}
      {hasDuplicatePayroll && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-300 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <span>พบรายจ่ายหมวดเงินเดือน ระบบไม่นับซ้ำ เพราะใช้ข้อมูลจากหน้าพนักงาน</span>
        </div>
      )}

      {/* Top 4 Summary Margin Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#151518] rounded-xl border border-white/5 p-4 flex flex-col justify-between hover:border-white/15 transition-colors">
          <div className="text-white/40 text-[10px] uppercase font-bold tracking-wider">ยอดขายสุทธิ (Net Revenue)</div>
          <div className="mt-3 text-2xl font-light tracking-tight text-white font-mono">
            ฿{pnl.netSales.toLocaleString()}
          </div>
          <div className="text-[10px] text-white/30 font-mono mt-1">100.0% BASE</div>
        </div>

        <div className="bg-[#151518] rounded-xl border border-white/5 p-4 flex flex-col justify-between hover:border-white/15 transition-colors">
          <div className="text-white/40 text-[10px] uppercase font-bold tracking-wider">Prime Cost % (COGS + Kitchen)</div>
          <div className="mt-3 text-2xl font-light font-mono flex items-baseline gap-1.5 text-purple-400">
            <span>{pnl.primeCostPercent.toFixed(1)}%</span>
            <span className="text-xs text-white/30 font-mono font-normal">(เป้า {settings.primeCostTargetPercent}%)</span>
          </div>
          <div className="text-[10px] text-white/40 font-mono mt-1">฿{pnl.primeCost.toLocaleString()}</div>
        </div>

        <div className="bg-[#151518] rounded-xl border border-white/5 p-4 flex flex-col justify-between hover:border-white/15 transition-colors">
          <div className="text-white/40 text-[10px] uppercase font-bold tracking-wider">กำไรขั้นต้น (Gross Profit)</div>
          <div className="mt-3 text-2xl font-light text-[#10B981] font-mono">
            ฿{pnl.grossProfit.toLocaleString()}
          </div>
          <div className="text-[10px] text-white/40 font-mono mt-1">Margin {pnl.grossMarginPercent.toFixed(1)}%</div>
        </div>

        <div className="bg-[#151518] rounded-xl border border-white/5 p-4 flex flex-col justify-between hover:border-white/15 transition-colors">
          <div className="text-white/40 text-[10px] uppercase font-bold tracking-wider">กำไรสุทธิ (Net Profit)</div>
          <div className="mt-3 text-2xl font-light text-[#10B981] font-mono">
            ฿{pnl.netProfit.toLocaleString()}
          </div>
          <div className="text-[10px] text-[#10B981] font-mono mt-1">
            Net Margin {pnl.netMarginPercent.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Full Formal P&L Statement Table */}
      <div className="rounded-xl border border-white/5 bg-[#151518] p-6">
        <h2 className="text-xs font-bold uppercase tracking-widest text-white/60 mb-5 pb-3 border-b border-white/5 flex items-center justify-between">
          <span>ตารางแจกแจงงบกำไรขาดทุนรายเดือน (Statement of Comprehensive Income)</span>
          <span className="text-xs font-mono font-normal text-white/30">สกุลเงิน: บาท (THB)</span>
        </h2>

        <div className="space-y-4 text-xs font-mono">
          {/* 1. REVENUE SECTION */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold font-sans text-white/70 uppercase tracking-wider bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
              1. รายได้จากการขาย (Revenue)
            </div>
            <div className="flex justify-between px-3 py-1 text-white/70">
              <span className="font-sans">ยอดขายรวมก่อนหักส่วนลด (Gross Sales)</span>
              <span>฿{grossSales.toLocaleString()}</span>
            </div>
            <div className="flex justify-between px-3 py-1 text-[#F59E0B]">
              <span className="font-sans">หัก: ส่วนลดและโปรโมชั่นที่ร้านออกเอง (Discounts)</span>
              <span>-฿{discounts.toLocaleString()}</span>
            </div>
            {refunds > 0 && (
              <div className="flex justify-between px-3 py-1 text-[#EF4444]">
                <span className="font-sans">หัก: รายการคืนเงินและยกเลิกบิล (Refunds)</span>
                <span>-฿{refunds.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between px-3 py-2 font-bold text-white bg-white/[0.04] rounded-lg text-sm border border-white/5">
              <span className="font-sans">ยอดขายสุทธิที่แท้จริง (Net Sales)</span>
              <div className="flex items-center gap-4">
                <span className="text-white/40">100.0%</span>
                <span>฿{pnl.netSales.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* 2. COST OF GOODS SOLD (COGS) */}
          <div className="space-y-1.5 pt-2">
            <div className="text-[11px] font-bold font-sans text-white/70 uppercase tracking-wider bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
              2. ต้นทุนขาย (Cost of Goods Sold - COGS)
            </div>
            <div className="flex justify-between px-3 py-1 text-white/70">
              <span className="font-sans">ต้นทุนวัตถุดิบและอาหาร (Food Cost)</span>
              <div className="flex items-center gap-4">
                <span className="text-white/40 font-sans">{foodCostPercent.toFixed(1)}%</span>
                <span>฿{Math.round(foodCogs).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex justify-between px-3 py-1 text-white/70">
              <span className="font-sans">ต้นทุนกล่องและบรรจุภัณฑ์ (Packaging Cost)</span>
              <div className="flex items-center gap-4">
                <span className="text-white/40 font-sans">{packagingCostPercent.toFixed(1)}%</span>
                <span>฿{Math.round(packagingCogs).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex justify-between px-3 py-2 font-bold text-white bg-white/[0.04] rounded-lg border border-white/5">
              <span className="font-sans">รวมต้นทุนขายทั้งสิ้น (Total COGS)</span>
              <div className="flex items-center gap-4">
                <span className="text-white/40">{(foodCostPercent + packagingCostPercent).toFixed(1)}%</span>
                <span>฿{Math.round(pnl.totalCogs).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* 3. GROSS PROFIT */}
          <div className="flex justify-between px-3 py-2.5 font-bold text-[#10B981] bg-[#10B981]/10 rounded-xl text-sm border border-[#10B981]/20">
            <span className="font-sans">กำไรขั้นต้น (Gross Profit)</span>
            <div className="flex items-center gap-4">
              <span>{pnl.grossMarginPercent.toFixed(1)}%</span>
              <span>฿{Math.round(pnl.grossProfit).toLocaleString()}</span>
            </div>
          </div>

          {/* 3.1 DIRECT KITCHEN LABOR DEDUCTION */}
          <div className="flex justify-between px-3 py-2 text-white/80 bg-white/[0.03] rounded-lg border border-white/5">
            <span className="font-sans">หัก: ค่าแรงครัว (Direct Labor)</span>
            <div className="flex items-center gap-4">
              <span className="text-white/40 font-sans">{pnl.netSales > 0 ? ((directKitchenLabor / pnl.netSales) * 100).toFixed(1) : '0.0'}%</span>
              <span className="text-purple-300 font-mono">-฿{Math.round(directKitchenLabor).toLocaleString()}</span>
            </div>
          </div>

          {/* 4. PRIME COST HIGHLIGHT */}
          <div className="space-y-1.5 pt-2">
            <div className="text-[11px] font-bold font-sans text-purple-300 uppercase tracking-wider bg-purple-500/10 px-3 py-1.5 rounded-lg border border-purple-500/20 flex justify-between">
              <span>การวิเคราะห์ PRIME COST (COGS + Direct Kitchen Labor)</span>
              <span className="font-mono font-bold text-purple-300">{pnl.primeCostPercent.toFixed(1)}% of Net Sales</span>
            </div>
            <div className="flex justify-between px-3 py-1 text-white/70">
              <span className="font-sans">ค่าแรงทีมงานครัวทางตรง (Kitchen Direct Labor)</span>
              <div className="flex items-center gap-4">
                <span className="text-white/40 font-sans">{pnl.netSales > 0 ? ((directKitchenLabor / pnl.netSales) * 100).toFixed(1) : '0.0'}%</span>
                <span>฿{directKitchenLabor.toLocaleString()}</span>
              </div>
            </div>
            <div className="flex justify-between px-3 py-1.5 font-bold text-purple-900 bg-purple-500/10 rounded-lg">
              <span className="font-sans">ยอดรวม PRIME COST ทั้งหมด</span>
              <span>฿{Math.round(pnl.primeCost).toLocaleString()}</span>
            </div>
          </div>

          {/* 5. OPERATING EXPENSES */}
          <div className="space-y-1.5 pt-2">
            <div className="text-[11px] font-bold font-sans text-white/70 uppercase tracking-wider bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
              4. ค่าใช้จ่ายดำเนินงานอื่นๆ (Operating Expenses / Overheads)
            </div>
            <div className="flex justify-between px-3 py-1 text-white/70">
              <span className="font-sans">ค่าเช่าพื้นที่ (Rent)</span>
              <span>฿{expenses.filter(e => e.category === 'Rent').reduce((s, e) => s + e.amount, 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between px-3 py-1 text-white/70">
              <span className="font-sans">สาธารณูปโภค (ค่าน้ำ ค่าไฟ ค่าแก๊ส)</span>
              <span>฿{expenses.filter(e => ['Electricity', 'Water', 'Gas (LPG)'].includes(e.category)).reduce((s, e) => s + e.amount, 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between px-3 py-1 text-white/70">
              <span className="font-sans">ค่าแรงหน้าร้านและบริหาร (FOH & Admin Staff)</span>
              <span>฿{nonKitchenLabor.toLocaleString()}</span>
            </div>
            <div className="flex justify-between px-3 py-1 text-white/70">
              <span className="font-sans">ค่าการตลาด ซอฟต์แวร์ และอื่นๆ</span>
              <span>฿{expenses.filter(e => !['Rent', 'Electricity', 'Water', 'Gas (LPG)'].includes(e.category)).reduce((s, e) => s + e.amount, 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between px-3 py-2 font-bold text-white bg-white/[0.04] rounded-lg border border-white/5">
              <span className="font-sans">รวมค่าใช้จ่ายดำเนินงาน (Total OPEX)</span>
              <div className="flex items-center gap-4">
                <span className="text-white/40">{operatingExpensePercent.toFixed(1)}%</span>
                <span>฿{Math.round(operatingExpenses).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* 6. OPERATING PROFIT (EBITDA) */}
          <div className="flex justify-between px-3 py-2.5 font-bold text-white bg-white/5 rounded-xl text-sm border border-white/10">
            <span className="font-sans">กำไรจากการดำเนินงาน (Operating Profit / EBITDA)</span>
            <div className="flex items-center gap-4">
              <span>{pnl.operatingMarginPercent.toFixed(1)}%</span>
              <span>฿{Math.round(pnl.operatingProfit).toLocaleString()}</span>
            </div>
          </div>

          {/* 6.5 ESTIMATED INCOME TAX */}
          <div className="flex justify-between px-3 py-2 text-white/80 bg-white/[0.03] rounded-lg border border-white/5">
            <span className="font-sans">หัก: ประมาณการภาษีเงินได้ ({incomeTaxRate}%)</span>
            <div className="flex items-center gap-4">
              <span className="text-white/40 font-sans">{pnl.netSales > 0 ? ((pnl.taxAmount / pnl.netSales) * 100).toFixed(1) : '0.0'}%</span>
              <span className="text-amber-400 font-mono">-฿{Math.round(pnl.taxAmount).toLocaleString()}</span>
            </div>
          </div>

          {/* 7. NET PROFIT */}
          <div className="flex justify-between px-4 py-3.5 font-bold text-[#10B981] bg-[#10B981]/15 rounded-xl text-base border border-[#10B981]/30">
            <span className="font-sans">กำไรสุทธิหลังหักภาษี (Net Profit)</span>
            <div className="flex items-center gap-6">
              <span className="text-[#10B981] font-normal">{pnl.netMarginPercent.toFixed(1)}%</span>
              <span className="text-xl">฿{Math.round(pnl.netProfit).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
