import React, { useState, useMemo } from 'react';
import { DollarSign, Percent, TrendingUp, Layers, Calendar, ArrowDownRight, ArrowUpRight, Scale, AlertTriangle, CheckCircle2, RefreshCw, Trash2 } from 'lucide-react';
import { ExpenseRecord, DailySalesRecord, Employee, BusinessSettings } from '../../types/domain';
import { StockCountSnapshot, PurchaseRecord, WasteRecord, SaleOrder, Ingredient } from '../../types';
import { calculateProfitAndLoss, calculateInventoryCOGS, calculateVariance, convertExpenseToMonthly } from '../../engine/calculations';
import {
  getPeriodDateBounds,
  resolveStockCountSnapshotsForPeriod,
  filterPeriodPurchases,
  filterPeriodWaste,
  getEmployeeMonthlyCost,
  isExplicitPayrollExpense,
  formatPeriodCalculationLabel,
} from '../../../engine/calculations';
import { StorageService } from '../../services/storageService';
import { FirebaseSyncService } from '../../services/firebaseSyncService';

interface ProfitAndLossViewProps {
  sales: DailySalesRecord[];
  expenses: ExpenseRecord[];
  employees: Employee[];
  settings: BusinessSettings;
  ingredients?: Ingredient[];
  purchases?: PurchaseRecord[];
  wasteLog?: WasteRecord[];
  stockCounts?: StockCountSnapshot[];
  salesOrders?: SaleOrder[];
  activeLanguage: 'th' | 'en';
  onSalesUpdated?: (sales: DailySalesRecord[]) => void;
}

export const ProfitAndLossView: React.FC<ProfitAndLossViewProps> = ({
  sales,
  expenses,
  employees,
  settings,
  ingredients,
  purchases,
  wasteLog,
  stockCounts,
  salesOrders,
  activeLanguage,
  onSalesUpdated,
}) => {
  const [isSyncingSales, setIsSyncingSales] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [excludePayrollDuplicates, setExcludePayrollDuplicates] = useState<boolean>(true);

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

  // Aggregate monthly revenues (always ex-VAT Net Sales + platform fees)
  const grossSales = sales.reduce((sum, s) => sum + (s.grossSales || 0), 0);
  const discounts = sales.reduce((sum, s) => sum + (s.discounts || 0), 0);
  const refunds = sales.reduce((sum, s) => sum + (s.refunds || 0), 0);
  const resolveSaleNet = (s: DailySalesRecord) => {
    if (typeof s.netSales === 'number' && Number.isFinite(s.netSales)) {
      return Math.max(0, s.netSales);
    }
    const nominal = Math.max(0, (s.grossSales || 0) - (s.discounts || 0) - (s.refunds || 0));
    const vatPct = s.vatRatePercent ?? 7;
    return s.isVatInclusive && vatPct > 0 ? nominal / (1 + vatPct / 100) : nominal;
  };
  const netSales = sales.reduce((sum, s) => sum + resolveSaleNet(s), 0);
  const serviceChargeTotal = sales.reduce((sum, s) => sum + Math.max(0, s.serviceCharge || 0), 0);
  const retainedServiceCharge =
    (settings.serviceChargeTreatment || 'staff_pool') === 'retained' ? serviceChargeTotal : 0;
  const effectiveRevenueForPnl = netSales + retainedServiceCharge;
  const hasEstimatedChannelAllocation = sales.some((s) => Boolean(s.estimatedAllocation));
  const channelFees = sales.reduce((sum, s) => sum + Math.max(0, s.platformFees || 0), 0);

  // Double-counting guard using explicit isPayroll flag + user choice (never brittle keyword matching)
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

  const operatingDays = settings.operatingDaysPerMonth || 26;
  const getMonthlyExp = (e: ExpenseRecord) => convertExpenseToMonthly(e, operatingDays);

  // Operating Expenses from general expenses (excluding labor, which is passed separately)
  const totalExpenses = effectiveExpenses.reduce((sum, e) => sum + getMonthlyExp(e), 0);

  const laborOptions = {
    socialSecurityEnabled: settings.socialSecurityEnabled ?? false,
    socialSecurityRatePercent: settings.socialSecurityRatePercent ?? 5,
    socialSecurityCapWage: settings.socialSecurityCapWage ?? 15000,
    defaultOperatingDays: operatingDays,
  };

  // Direct Kitchen Labor vs FOH / Management Labor (ALL active employees via unified calculator)
  const directKitchenLabor = activeEmployees
    .filter((e) => e.roleCategory === 'direct_kitchen' || e.department === 'kitchen')
    .reduce((sum, e) => sum + getEmployeeMonthlyCost(e, laborOptions), 0);
  const nonKitchenLabor = activeEmployees
    .filter((e) => e.roleCategory !== 'direct_kitchen' && e.department !== 'kitchen')
    .reduce((sum, e) => sum + getEmployeeMonthlyCost(e, laborOptions), 0);

  // Load Inventory, Purchases, Sales Orders, Waste, and StockCountSnapshots
  const ingredientsList = useMemo(() => ingredients ?? StorageService.getIngredients(), [ingredients]);
  const purchasesList = useMemo(() => purchases ?? StorageService.getPurchases(), [purchases]);
  const salesOrdersList = useMemo(() => salesOrders ?? StorageService.getSalesOrders(), [salesOrders]);
  const wasteList = useMemo(() => wasteLog ?? StorageService.getWasteLog(), [wasteLog]);
  const stockCountsList = useMemo(() => stockCounts ?? StorageService.getStockCounts(), [stockCounts]);

  const targetMonth = useMemo(() => {
    if (sales.length > 0) {
      const latest = [...sales].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      if (latest?.date && latest.date.length >= 7) return latest.date.slice(0, 7);
    }
    return new Date().toISOString().slice(0, 7);
  }, [sales]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const { periodStart, periodEnd } = useMemo(() => getPeriodDateBounds('month', targetMonth), [targetMonth]);

  const snapshotPair = useMemo(
    () => resolveStockCountSnapshotsForPeriod(stockCountsList, periodStart, periodEnd, todayStr),
    [stockCountsList, periodStart, periodEnd, todayStr]
  );
  const periodPurchasesRes = useMemo(
    () => filterPeriodPurchases(purchasesList, periodStart, periodEnd, ingredientsList),
    [purchasesList, periodStart, periodEnd, ingredientsList]
  );
  const periodWasteRes = useMemo(
    () => filterPeriodWaste(wasteList, periodStart, periodEnd),
    [wasteList, periodStart, periodEnd]
  );

  const hasActualStockData = snapshotPair.hasCompletePair;

  // Selector: "actual" vs "estimated"
  const [cogsMode, setCogsMode] = useState<'actual' | 'estimated'>('estimated');
  const effectiveCogsMode = cogsMode;

  // Actual Inventory COGS calculation: Beginning + Period Food Purchases - Ending (Waste NOT subtracted!)
  const totalBeginningStockCost = snapshotPair.beginningSnapshot?.totalValue ?? 0;
  const totalEndingStockCost = snapshotPair.endingSnapshot?.totalValue ?? 0;
  const totalPurchasesCost = periodPurchasesRes.totalFoodPurchases;
  const totalWasteCost = periodWasteRes.totalWasteCost;

  const actualCogsResult = hasActualStockData
    ? calculateInventoryCOGS(
        totalBeginningStockCost,
        totalPurchasesCost,
        totalEndingStockCost,
        totalWasteCost
      )
    : {
        cogs: 0,
        rawCogs: 0,
        isNegative: false,
        wasteMemo: totalWasteCost,
        valueOf: () => 0,
      };

  // Single-source Theoretical COGS: avoid double counting POS summaries and SaleOrders on the same date
  const explicitSalesFoodCost = sales.reduce(
    (sum, s) => sum + (typeof s.foodCost === 'number' ? Math.max(0, s.foodCost) : 0),
    0
  );
  const explicitSalesPackagingCost = sales.reduce(
    (sum, s) => sum + (typeof s.packagingCost === 'number' ? Math.max(0, s.packagingCost) : 0),
    0
  );
  const uncostedManualSalesTotal = sales
    .filter((s) => !s.id?.startsWith('pos_sync_') && typeof s.foodCost !== 'number' && resolveSaleNet(s) > 0)
    .reduce((sum, s) => sum + resolveSaleNet(s), 0);

  const periodOrders = salesOrdersList.filter(
    (o) =>
      o.date >= periodStart &&
      o.date <= periodEnd &&
      o.orderStatus !== 'CANCELLED' &&
      o.paymentStatus !== 'VOID'
  );
  const orderDatesCoveredByExplicitSales = new Set(
    sales.filter((s) => typeof s.foodCost === 'number').map((s) => s.date)
  );
  const unmatchedOrdersFoodCost = periodOrders
    .filter((o) => !orderDatesCoveredByExplicitSales.has(o.date))
    .reduce((sum, order) => sum + (order.totalFoodCost || 0), 0);
  const unmatchedOrdersPackagingCost = periodOrders
    .filter((o) => !orderDatesCoveredByExplicitSales.has(o.date))
    .reduce((sum, order) => sum + (order.packagingCost || 0), 0);

  const theoreticalCOGS = explicitSalesFoodCost + unmatchedOrdersFoodCost;

  // Variance calculation (actual vs theoretical, evaluated as % of Net Sales against settings threshold)
  const varianceThresholdPercent =
    typeof settings.cogsVarianceThresholdPercent === 'number' &&
    Number.isFinite(settings.cogsVarianceThresholdPercent)
      ? settings.cogsVarianceThresholdPercent
      : 3.0;
  const varianceResult = hasActualStockData
    ? calculateVariance(actualCogsResult.cogs, theoreticalCOGS, netSales, varianceThresholdPercent)
    : {
        varianceAmount: 0,
        variancePercent: 0,
        variancePercentOfSales: 0,
        thresholdPercent: varianceThresholdPercent,
        varianceStatus: 'ON_TRACK' as const,
      };
  const variancePointsOfNetSales = varianceResult.variancePercentOfSales;
  const isVarianceExceeded = hasActualStockData && varianceResult.varianceStatus !== 'ON_TRACK';

  // Estimated COGS slider rates (only applied to uncosted sales if theoretical COGS not already present)
  const [foodCostRate] = useState<number>(31.5);
  const [packagingRate] = useState<number>(3.5);

  const estimatedFoodCogs =
    theoreticalCOGS > 0
      ? theoreticalCOGS + (uncostedManualSalesTotal > 0 ? uncostedManualSalesTotal * (foodCostRate / 100) : 0)
      : netSales * (foodCostRate / 100);
  const estimatedPackagingCogs =
    explicitSalesPackagingCost + unmatchedOrdersPackagingCost > 0
      ? explicitSalesPackagingCost + unmatchedOrdersPackagingCost
      : netSales * (packagingRate / 100);

  // When actual mode is selected without complete stock snapshots -> fall back to Theoretical COGS (never fabricate 0 or 1.05x)
  const foodCogs =
    effectiveCogsMode === 'actual'
      ? hasActualStockData
        ? actualCogsResult.cogs
        : theoreticalCOGS
      : estimatedFoodCogs;
  const packagingCogs =
    effectiveCogsMode === 'actual'
      ? explicitSalesPackagingCost + unmatchedOrdersPackagingCost
      : estimatedPackagingCogs;

  const operatingExpenses = totalExpenses;
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
    incomeTaxRate,
    nonKitchenLabor,
    channelFees,
    effectiveRevenueForPnl
  );


  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl bg-[#151518] border border-white/10 p-6 text-white">
        <div>
          <h1 className="text-xl sm:text-2xl font-light tracking-tight text-white flex items-center gap-2">
            <span>{activeLanguage === 'th' ? 'งบกำไรขาดทุนบริหาร (Managerial Profit & Loss P&L)' : 'Monthly Profit & Loss (P&L)'}</span>
          </h1>
          <p className="text-xs text-white/50 mt-1">{formatPeriodCalculationLabel('month', targetMonth, activeLanguage)}</p>
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

      {/* Warning banner when legacy POS summaries used proportional channel estimates */}
      {hasEstimatedChannelAllocation && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <span>
            ข้อมูล POS บางส่วนจากสรุปยอดเก่าไม่มีรายละเอียดแยกช่องทาง ระบบประมาณการส่วนลด ค่า GP และ Service Charge ตามสัดส่วนยอดขาย (แนะนำซิงค์หรือ Rebuild สรุปยอดจากบิลจริง)
          </span>
        </div>
      )}

      {/* Warning banner when stock calculation is negative (only if actual stock is tracked and negative) */}
      {effectiveCogsMode === 'actual' && hasActualStockData && actualCogsResult.isNegative && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-300 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <span className="font-semibold">ตัวเลขสต็อกผิดปกติ ตรวจสอบการนับสต็อก (ต้นทุนสต็อกติดลบ ฿{actualCogsResult.cogs.toLocaleString()})</span>
        </div>
      )}

      {/* Uncosted manual sales warning */}
      {uncostedManualSalesTotal > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-300 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <span>
            มียอดขาย manual {uncostedManualSalesTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })} บาทที่ไม่มีต้นทุนอาหารคู่ อาจทำให้กำไรสูงเกินจริง
          </span>
        </div>
      )}

      {/* Incomplete stock count fallback banner */}
      {!hasActualStockData && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              <strong>ประมาณการจากสูตร ยังไม่มีการนับสต็อก</strong> — แนะนำให้นับสต็อกใหม่หนึ่งครั้งในหน้าคลังสินค้า (นับสต็อกปิดงวด) เพื่อเทียบ Actual COGS จริง
            </span>
          </div>
          <span className="text-[11px] font-mono text-amber-300/80 shrink-0">งวด {targetMonth}</span>
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
              ต้นทุนจากสต็อกปิดงวด (Actual COGS)
            </button>
          </div>
          {effectiveCogsMode === 'estimated' && (
            <span className="px-2 py-1 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              ตามสูตรมาตรฐาน
            </span>
          )}
          {effectiveCogsMode === 'actual' && (
            <span className={`px-2 py-1 rounded text-[11px] font-bold border ${
              hasActualStockData
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
            }`}>
              {hasActualStockData ? 'นับสต็อกปิดงวดครบ' : 'ประมาณการจากสูตร ยังไม่มีการนับสต็อก'}
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

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="bg-white/5 p-3.5 rounded-xl border border-white/5">
            <div className="text-white/40 text-[10px] uppercase font-bold tracking-wider">ต้นทุนจริงจากการนับสต็อก (Actual)</div>
            <div className="mt-1.5 text-xl font-light text-white font-mono">
              {hasActualStockData ? `฿${Math.round(actualCogsResult.cogs).toLocaleString()}` : 'ยังไม่มีผลนับสต็อก'}
            </div>
            <div className="text-[10px] text-white/30 font-mono mt-0.5">
              {hasActualStockData && netSales > 0 ? `${((actualCogsResult.cogs / netSales) * 100).toFixed(1)}% of Net Sales` : 'ต้องมีสต็อกต้นงวด & ปลายงวด'}
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
            !hasActualStockData
              ? 'bg-white/5 border-white/10 text-white/60'
              : isVarianceExceeded
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}>
            <div className="text-[10px] uppercase font-bold tracking-wider">ส่วนต่าง (Variance)</div>
            <div className="mt-1.5 text-xl font-light font-mono">
              {hasActualStockData
                ? `${varianceResult.varianceAmount > 0 ? '+' : varianceResult.varianceAmount < 0 ? '-' : ''}฿${Math.round(Math.abs(varianceResult.varianceAmount)).toLocaleString()}`
                : '-'}
            </div>
            <div className="text-[10px] font-mono mt-0.5">
              {hasActualStockData
                ? `${varianceResult.variancePercent > 0 ? '+' : ''}${varianceResult.variancePercent.toFixed(2)}% (${variancePointsOfNetSales.toFixed(2)}% of Sales)`
                : 'ประมาณการจากสูตร'}
            </div>
          </div>

          <div className="bg-white/5 p-3.5 rounded-xl border border-white/5">
            <div className="text-white/40 text-[10px] uppercase font-bold tracking-wider flex items-center gap-1">
              <Trash2 className="w-3 h-3 text-rose-400" />
              <span>ของเสียในงวด (Waste Memo)</span>
            </div>
            <div className="mt-1.5 text-xl font-light text-rose-300 font-mono">
              ฿{Math.round(actualCogsResult.wasteMemo).toLocaleString()}
            </div>
            <div className="text-[10px] text-white/30 font-sans mt-0.5">
              แสดงอ้างอิงแยก ไม่นำไปหักออกจาก COGS
            </div>
          </div>
        </div>
      </div>

      {/* Warning banner when explicit payroll expenses overlap with employees */}
      {hasDuplicatePayroll && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              พบรายจ่ายเงินเดือน/ค่าแรง ({payrollFlaggedExpenses.length} รายการ) ซ้อนกับข้อมูลพนักงาน ({activeEmployees.length} คน) —{' '}
              {excludePayrollDuplicates
                ? 'สถานะ: งดนับซ้ำ (ใช้ยอดจากหน้าพนักงาน)'
                : 'สถานะ: นับรวมรายจ่ายเพิ่มจากค่าแรงพนักงาน'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExcludePayrollDuplicates(!excludePayrollDuplicates)}
            className="px-3 py-1.5 rounded-lg border border-amber-400/50 bg-amber-500/20 hover:bg-amber-500/30 text-xs font-bold text-amber-100 shrink-0 cursor-pointer"
          >
            {excludePayrollDuplicates ? 'เปลี่ยนเป็นนับรวมด้วย' : 'งดนับซ้ำกับพนักงาน'}
          </button>
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
          <div className="text-white/40 text-[10px] uppercase font-bold tracking-wider">Prime Cost % (COGS + Total Labor)</div>
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
            {serviceChargeTotal > 0 && (
              <div className="flex justify-between px-3 py-1 text-white/70">
                <span className="font-sans">
                  Service Charge {(settings.serviceChargeTreatment || 'staff_pool') === 'retained' ? '(รวมเป็นรายได้ร้าน)' : '(กองทุนพนักงาน — ไม่นับเป็นรายได้)'}
                </span>
                <span>{retainedServiceCharge > 0 ? `+฿${serviceChargeTotal.toLocaleString()}` : `฿${serviceChargeTotal.toLocaleString()} (อ้างอิง)`}</span>
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

          {/* 3.1 CHANNEL FEES & TOTAL LABOR */}
          <div className="flex justify-between px-3 py-2 text-white/80 bg-white/[0.03] rounded-lg border border-white/5">
            <span className="font-sans">หัก: ค่าธรรมเนียมแพลตฟอร์ม (Channel Fees / GP)</span>
            <div className="flex items-center gap-4">
              <span className="text-white/40 font-sans">{pnl.netSales > 0 ? ((pnl.channelFees / pnl.netSales) * 100).toFixed(1) : '0.0'}%</span>
              <span className="text-rose-300 font-mono">-฿{Math.round(pnl.channelFees).toLocaleString()}</span>
            </div>
          </div>

          <div className="flex justify-between px-3 py-2 text-white/80 bg-white/[0.03] rounded-lg border border-white/5">
            <span className="font-sans">หัก: ค่าแรงรวมทุกแผนก (Total Labor)</span>
            <div className="flex items-center gap-4">
              <span className="text-white/40 font-sans">{pnl.netSales > 0 ? ((pnl.totalLabor / pnl.netSales) * 100).toFixed(1) : '0.0'}%</span>
              <span className="text-purple-300 font-mono">-฿{Math.round(pnl.totalLabor).toLocaleString()}</span>
            </div>
          </div>

          {/* 4. PRIME COST HIGHLIGHT */}
          <div className="space-y-1.5 pt-2">
            <div className="text-[11px] font-bold font-sans text-purple-300 uppercase tracking-wider bg-purple-500/10 px-3 py-1.5 rounded-lg border border-purple-500/20 flex justify-between">
              <span>การวิเคราะห์ PRIME COST (Total COGS + Total Labor)</span>
              <span className="font-mono font-bold text-purple-300">{pnl.primeCostPercent.toFixed(1)}% of Net Sales</span>
            </div>
            <div className="flex justify-between px-3 py-1 text-white/70">
              <span className="font-sans">ค่าแรงทีมงานครัว (Kitchen Direct Labor)</span>
              <div className="flex items-center gap-4">
                <span className="text-white/40 font-sans">{pnl.netSales > 0 ? ((directKitchenLabor / pnl.netSales) * 100).toFixed(1) : '0.0'}%</span>
                <span>฿{directKitchenLabor.toLocaleString()}</span>
              </div>
            </div>
            <div className="flex justify-between px-3 py-1 text-white/70">
              <span className="font-sans">ค่าแรงหน้าร้านและบริหาร (FOH & Admin Staff)</span>
              <div className="flex items-center gap-4">
                <span className="text-white/40 font-sans">{pnl.netSales > 0 ? ((nonKitchenLabor / pnl.netSales) * 100).toFixed(1) : '0.0'}%</span>
                <span>฿{nonKitchenLabor.toLocaleString()}</span>
              </div>
            </div>
            <div className="flex justify-between px-3 py-1.5 font-bold text-purple-200 bg-purple-500/10 rounded-lg">
              <span className="font-sans">ยอดรวม PRIME COST ทั้งหมด (COGS + Total Labor)</span>
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
              <span>฿{Math.round(effectiveExpenses.filter(e => e.category === 'Rent').reduce((s, e) => s + getMonthlyExp(e), 0)).toLocaleString()}</span>
            </div>
            <div className="flex justify-between px-3 py-1 text-white/70">
              <span className="font-sans">สาธารณูปโภค (ค่าน้ำ ค่าไฟ ค่าแก๊ส)</span>
              <span>฿{Math.round(effectiveExpenses.filter(e => ['Electricity', 'Water', 'Gas (LPG)'].includes(e.category)).reduce((s, e) => s + getMonthlyExp(e), 0)).toLocaleString()}</span>
            </div>
            <div className="flex justify-between px-3 py-1 text-white/70">
              <span className="font-sans">ค่าการตลาด ซอฟต์แวร์ และอื่นๆ</span>
              <span>฿{Math.round(effectiveExpenses.filter(e => !['Rent', 'Electricity', 'Water', 'Gas (LPG)'].includes(e.category)).reduce((s, e) => s + getMonthlyExp(e), 0)).toLocaleString()}</span>
            </div>
            <div className="flex justify-between px-3 py-2 font-bold text-white bg-white/[0.04] rounded-lg border border-white/5">
              <span className="font-sans">รวมค่าใช้จ่ายดำเนินงาน (Total OPEX)</span>
              <div className="flex items-center gap-4">
                <span className="text-white/40">{operatingExpensePercent.toFixed(1)}%</span>
                <span>฿{Math.round(operatingExpenses).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* 6. OPERATING PROFIT */}
          <div className="flex justify-between px-3 py-2.5 font-bold text-white bg-white/5 rounded-xl text-sm border border-white/10">
            <span className="font-sans">กำไรจากการดำเนินงาน (Operating Profit)</span>
            <div className="flex items-center gap-4">
              <span>{pnl.operatingMarginPercent.toFixed(1)}%</span>
              <span>฿{Math.round(pnl.operatingProfit).toLocaleString()}</span>
            </div>
          </div>

          {/* 6.5 ESTIMATED INCOME TAX */}
          <div className="flex justify-between px-3 py-2 text-white/80 bg-white/[0.03] rounded-lg border border-white/5">
            <span className="font-sans">หัก: ประมาณการภาษีเงินได้ ({incomeTaxRate}%) — ประมาณการ — โปรดยืนยันกับนักบัญชี</span>
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
