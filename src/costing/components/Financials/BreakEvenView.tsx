import React, { useState, useEffect, useMemo } from 'react';
import { Scale, AlertCircle, CheckCircle2, Target, AlertTriangle, RotateCcw } from 'lucide-react';
import { ExpenseRecord, Employee, DailySalesRecord, BusinessSettings } from '../../types/domain';
import { DailySummaryDoc } from '../../../types';
import { calculateBreakEven, convertExpenseToMonthly, calculateOverheadRatePercent } from '../../engine/calculations';
import {
  getEmployeeMonthlyCost,
  isExplicitPayrollExpense,
  deriveVariableCostPercent,
  normalizeToMonthly,
  formatPeriodCalculationLabel,
  roundTo2,
} from '../../../engine/calculations';
import { NumericInput } from '../common/NumericInput';

interface BreakEvenViewProps {
  expenses: ExpenseRecord[];
  employees: Employee[];
  sales: DailySalesRecord[];
  settings: BusinessSettings;
  activeLanguage: 'th' | 'en';
  period?: 'day' | 'month' | 'year';
  dateParam?: string;
  coveredMonths?: number;
  normalizedMonthlyNetSales?: number;
  recentSummaries?: DailySummaryDoc[];
  periodSalesLabel?: string;
  excludePayrollDuplicates?: boolean;
  onToggleExcludePayrollDuplicates?: (exclude: boolean) => void;
  socialSecurityEnabled?: boolean;
  socialSecurityRatePercent?: number;
  socialSecurityCapWage?: number;
}

export const BreakEvenView: React.FC<BreakEvenViewProps> = ({
  expenses,
  employees,
  sales,
  settings,
  activeLanguage,
  period = 'month',
  dateParam,
  coveredMonths,
  normalizedMonthlyNetSales,
  recentSummaries,
  periodSalesLabel,
  excludePayrollDuplicates,
  onToggleExcludePayrollDuplicates,
  socialSecurityEnabled,
  socialSecurityRatePercent,
  socialSecurityCapWage,
}) => {
  const initialOperatingDays = settings.operatingDaysPerMonth || 26;
  const [operatingDays, setOperatingDays] = useState<number>(initialOperatingDays);
  const [localExcludePayroll, setLocalExcludePayroll] = useState<boolean>(true);

  const effectiveExcludePayroll =
    typeof excludePayrollDuplicates === 'boolean' ? excludePayrollDuplicates : localExcludePayroll;
  const handleTogglePayrollOverlap = (nextVal: boolean) => {
    if (onToggleExcludePayrollDuplicates) {
      onToggleExcludePayrollDuplicates(nextVal);
    } else {
      setLocalExcludePayroll(nextVal);
    }
  };

  const laborOptions = useMemo(
    () => ({
      socialSecurityEnabled:
        socialSecurityEnabled ?? settings.socialSecurityEnabled ?? false,
      socialSecurityRatePercent:
        socialSecurityRatePercent ?? settings.socialSecurityRatePercent ?? 5,
      socialSecurityCapWage:
        socialSecurityCapWage ?? settings.socialSecurityCapWage ?? 15000,
      defaultOperatingDays: operatingDays,
    }),
    [
      socialSecurityEnabled,
      socialSecurityRatePercent,
      socialSecurityCapWage,
      settings.socialSecurityEnabled,
      settings.socialSecurityRatePercent,
      settings.socialSecurityCapWage,
      operatingDays,
    ]
  );

  // Active staff payroll via unified calculator (ALL active employees, never filtered by employmentType === 'full_time')
  const activeEmployees = useMemo(
    () => employees.filter((e) => e.active !== false),
    [employees]
  );
  const totalStaffLaborMonthly = useMemo(
    () => activeEmployees.reduce((sum, e) => sum + getEmployeeMonthlyCost(e, laborOptions), 0),
    [activeEmployees, laborOptions]
  );

  // Explicit payroll duplicate detection (no brittle keyword matching)
  const payrollFlaggedExpenses = useMemo(
    () => expenses.filter((e) => !e.isExcluded && isExplicitPayrollExpense(e)),
    [expenses]
  );
  const hasPayrollConflict = activeEmployees.length > 0 && payrollFlaggedExpenses.length > 0;

  const effectiveExpenses = useMemo(
    () =>
      expenses.filter(
        (e) =>
          !e.isExcluded &&
          !(hasPayrollConflict && effectiveExcludePayroll && isExplicitPayrollExpense(e))
      ),
    [expenses, hasPayrollConflict, effectiveExcludePayroll]
  );

  // Fixed expenses (isFixed !== false) + ALL active staff labor
  const fixedExpensesMonthly = useMemo(
    () =>
      effectiveExpenses
        .filter((e) => e.isFixed !== false)
        .reduce((sum, e) => sum + convertExpenseToMonthly(e, operatingDays), 0),
    [effectiveExpenses, operatingDays]
  );

  // Non-fixed variable operating expenses (isFixed === false) -> flows into CM%, NOT Fixed Costs
  const variableExpensesMonthly = useMemo(
    () =>
      effectiveExpenses
        .filter((e) => e.isFixed === false)
        .reduce((sum, e) => sum + convertExpenseToMonthly(e, operatingDays), 0),
    [effectiveExpenses, operatingDays]
  );

  const defaultTotalFixed = roundTo2(fixedExpensesMonthly + totalStaffLaborMonthly);

  // Period-matched & monthly-normalized Net Sales ex-VAT
  const rawPeriodSalesSum = useMemo(
    () =>
      sales.reduce((sum, s) => {
        if (typeof s.netSales === 'number' && Number.isFinite(s.netSales)) {
          return sum + Math.max(0, s.netSales);
        }
        const nominal = Math.max(0, (s.grossSales || 0) - (s.discounts || 0) - (s.refunds || 0));
        const vatPct = s.vatRatePercent ?? 7;
        return sum + (s.isVatInclusive && vatPct > 0 ? nominal / (1 + vatPct / 100) : nominal);
      }, 0),
    [sales]
  );

  const monthlyNormalizedSales = useMemo(() => {
    if (typeof normalizedMonthlyNetSales === 'number' && Number.isFinite(normalizedMonthlyNetSales)) {
      return normalizedMonthlyNetSales;
    }
    return normalizeToMonthly(rawPeriodSalesSum, period, coveredMonths, dateParam);
  }, [normalizedMonthlyNetSales, rawPeriodSalesSum, period, coveredMonths, dateParam]);

  // Build DailySummary-compatible array for 30-day real CM% derivation if caller did not pass recentSummaries
  const syntheticRecentFromSales = useMemo<DailySummaryDoc[]>(() => {
    if (recentSummaries && recentSummaries.length > 0) return recentSummaries;
    return sales
      .filter((s) => (s.netSales || 0) > 0 && (typeof s.foodCost === 'number' || (s.platformFees || 0) > 0 || (s.packagingCost || 0) > 0))
      .map((s) => ({
        date: s.date,
        grossSales: s.grossSales || 0,
        discounts: s.discounts || 0,
        serviceCharge: 0,
        vat: 0,
        netSales: s.netSales || 0,
        totalFoodCost: s.foodCost || 0,
        packagingCost: s.packagingCost || 0,
        platformFees: s.platformFees || 0,
        grossProfit: 0,
        orderCount: s.orderCount || 0,
        paymentTotals: {},
        channelTotals: {},
        dishStats: {},
        updatedAt: '',
        version: 1,
      }));
  }, [recentSummaries, sales]);

  const derivedMargin = useMemo(
    () =>
      deriveVariableCostPercent(syntheticRecentFromSales, {
        otherVariableCostAmount: variableExpensesMonthly,
        otherVariablePeriodNetSales:
          monthlyNormalizedSales > 0 ? monthlyNormalizedSales : undefined,
      }),
    [syntheticRecentFromSales, variableExpensesMonthly, monthlyNormalizedSales]
  );

  // User-editable parameters (resettable to real defaults, never silently defaulting CM% to 65)
  const [fixedCosts, setFixedCosts] = useState<number>(defaultTotalFixed);
  const [isFixedEdited, setIsFixedEdited] = useState<boolean>(false);
  const [contributionMarginPercent, setContributionMarginPercent] = useState<number>(
    derivedMargin.hasRealData ? derivedMargin.contributionMarginPercent : 0
  );
  const [isCmEdited, setIsCmEdited] = useState<boolean>(false);
  const [targetProfitPercent, setTargetProfitPercent] = useState<number>(10);
  const [averageTicket, setAverageTicket] = useState<number>(140);

  useEffect(() => {
    if (!isFixedEdited) {
      setFixedCosts(defaultTotalFixed);
    }
  }, [defaultTotalFixed, isFixedEdited]);

  useEffect(() => {
    if (!isCmEdited) {
      setContributionMarginPercent(
        derivedMargin.hasRealData ? derivedMargin.contributionMarginPercent : 0
      );
    }
  }, [derivedMargin.hasRealData, derivedMargin.contributionMarginPercent, isCmEdited]);

  const isAssumedCM = !derivedMargin.hasRealData || isCmEdited;

  const breakEven = calculateBreakEven(
    fixedCosts,
    contributionMarginPercent,
    averageTicket,
    operatingDays,
    targetProfitPercent,
    monthlyNormalizedSales
  );

  // Variable non-food OpEx % from actual data (no magic -30)
  const actualVariableOpexPercent = derivedMargin.hasRealData
    ? derivedMargin.otherVariableCostPercent
    : monthlyNormalizedSales > 0
    ? (variableExpensesMonthly / monthlyNormalizedSales) * 100
    : 0;

  const calculatedOverheadRate = calculateOverheadRatePercent(
    fixedCosts,
    monthlyNormalizedSales,
    actualVariableOpexPercent
  );

  const isProfitable = breakEven.isValid && breakEven.isProfitable;
  const safetyMarginPercent = breakEven.safetyMarginPercent;

  const hasOwnerSalary =
    expenses.some((e) => {
      if (e.isExcluded) return false;
      const desc = (e.description || '').toLowerCase();
      const isOwnerDesc =
        desc.includes('เจ้าของ') || desc.includes('owner') || desc.includes('ผู้จัดการ/เจ้าของ');
      return isOwnerDesc && Number(e.amount) > 0;
    }) ||
    activeEmployees.some((emp) => {
      const name = (emp.name || '').toLowerCase();
      const role = (emp.roleCategory || '').toLowerCase();
      return (
        (name.includes('เจ้าของ') || name.includes('owner') || role.includes('owner')) &&
        getEmployeeMonthlyCost(emp, laborOptions) > 0
      );
    });

  const effectivePeriodLabel =
    periodSalesLabel ||
    (dateParam
      ? formatPeriodCalculationLabel(period, dateParam, activeLanguage)
      : formatPeriodCalculationLabel(
          period,
          new Date().toISOString().substring(0, period === 'day' ? 10 : period === 'year' ? 4 : 7),
          activeLanguage
        ));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Scale className="h-5 w-5 text-emerald-600" />
            <span>
              {activeLanguage === 'th'
                ? 'การวิเคราะห์จุดคุ้มทุน (Break-Even Analysis)'
                : 'Break-Even Analysis'}
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">{effectivePeriodLabel} (ปรับเทียบฐานรายเดือน)</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
            <span className="text-slate-500">อัตราโสหุ้ยจริง (Overhead %):</span>
            <span className="font-mono font-bold text-slate-900">
              {monthlyNormalizedSales > 0 ? `${calculatedOverheadRate.toFixed(1)}%` : 'รอข้อมูลยอดขาย'}
            </span>
          </div>
          {monthlyNormalizedSales > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800">
              <span className="text-emerald-700 font-medium">ตัวอย่างอาหาร 100 บาท:</span>
              <span className="font-mono font-bold text-emerald-950">
                โสหุ้ย {((100 * calculatedOverheadRate) / 100).toFixed(1)} บาท
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Warning: Explicit Payroll Overlap with Employees */}
      {hasPayrollConflict && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">
                {activeLanguage === 'th'
                  ? `พบรายจ่ายเงินเดือน/ค่าแรง (${payrollFlaggedExpenses.length} รายการ) ซ้อนกับข้อมูลพนักงาน (${activeEmployees.length} คน)`
                  : `Detected ${payrollFlaggedExpenses.length} payroll expense(s) alongside ${activeEmployees.length} employee(s)`}
              </div>
              <p className="text-amber-800 mt-0.5">
                {effectiveExcludePayroll
                  ? 'ระบบงดนับรายจ่ายเงินเดือนในค่าใช้จ่ายเพื่อป้องกันการนับซ้ำกับข้อมูลพนักงาน (กดปุ่มขวาหากต้องการนับรวม)'
                  : 'กำลังนับรวมทั้งเงินเดือนจากรายการค่าใช้จ่ายและค่าแรงพนักงาน'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleTogglePayrollOverlap(!effectiveExcludePayroll)}
            className="px-3 py-1.5 rounded-lg border border-amber-400 bg-white hover:bg-amber-100 text-xs font-bold text-amber-900 shrink-0 cursor-pointer"
          >
            {effectiveExcludePayroll ? 'นับรวมรายจ่ายด้วย' : 'งดนับซ้ำ (ใช้ยอดพนักงาน)'}
          </button>
        </div>
      )}

      {/* Warning: Missing Real 30d Variable Cost Data (Assumed CM% Disclosure) */}
      {!derivedMargin.hasRealData && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-xs flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <div className="font-bold flex items-center gap-2">
              <span>ยังไม่มีข้อมูลยอดขายและต้นทุนผันแปรจริง 30 วันล่าสุด</span>
              <span className="text-[10px] bg-amber-200 text-amber-950 px-1.5 py-0.5 rounded font-bold">
                ค่าสมมติ
              </span>
            </div>
            <p className="text-amber-800 leading-relaxed">
              ระบบจะไม่กำหนด % Contribution Margin เป็นค่าคงที่โดยอัตโนมัติ กรุณากรอกค่า <strong>"ค่าสมมติ CM%"</strong> ด้านล่างเพื่อจำลองจุดคุ้มทุน หรือรอข้อมูลยอดขายจริงจาก POS
            </p>
          </div>
        </div>
      )}

      {/* Warning: Owner Salary Check (O15) */}
      {!hasOwnerSalary && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-xs flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <div className="font-bold text-amber-950 flex items-center gap-1.5">
              <span>คำเตือน: ยังไม่ได้ใส่อัตราเงินเดือนเจ้าของร้าน (Owner Salary)</span>
              <span className="text-[10px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-semibold">แนะนำ</span>
            </div>
            <p className="text-amber-800 leading-relaxed">
              ต้นทุนคงที่ (Fixed Costs) ยังไม่พบรายการเงินเดือนของเจ้าของร้าน หากไม่รวมค่าตอบแทนของตนเอง จุดคุ้มทุนและราคาขายจะต่ำกว่าความเป็นจริง
            </p>
          </div>
        </div>
      )}

      {/* Variable Cost & CM% Derivation Summary */}
      {derivedMargin.hasRealData && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-950 flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">
            ข้อมูลจริง 30 วันล่าสุด: Food {derivedMargin.foodCostPercent.toFixed(2)}% + Pkg {derivedMargin.packagingPercent.toFixed(2)}% + GP {derivedMargin.platformFeePercent.toFixed(2)}%
            {derivedMargin.otherVariableCostPercent > 0 &&
              ` + ผันแปรอื่น ${derivedMargin.otherVariableCostPercent.toFixed(2)}%`}
          </div>
          <div className="font-mono font-bold">
            ต้นทุนผันแปรรวม {derivedMargin.variableCostPercent.toFixed(2)}% → CM {derivedMargin.contributionMarginPercent.toFixed(2)}%
          </div>
        </div>
      )}

      {/* Break-Even Key Metrics Banner */}
      {!breakEven.isValid ? (
        <div className="p-6 rounded-2xl border bg-amber-50/90 border-amber-200 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 text-amber-600 shrink-0" />
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-2">
                <span>
                  {contributionMarginPercent <= 0 && !derivedMargin.hasRealData
                    ? 'กรุณากรอกค่าสมมติ % Contribution Margin ด้านล่าง'
                    : 'สถานะ: ไม่สามารถคำนวณจุดคุ้มทุนได้'}
                </span>
                {isAssumedCM && (
                  <span className="text-[10px] bg-amber-200 text-amber-950 px-1.5 py-0.5 rounded font-bold">
                    ค่าสมมติ
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-amber-800 mt-0.5">
                {contributionMarginPercent <= 0 && !derivedMargin.hasRealData
                  ? `ต้นทุนคงที่รายเดือน ฿${Math.round(fixedCosts).toLocaleString()} (ยอดขายเปรียบเทียบฐานเดือน ฿${Math.round(monthlyNormalizedSales).toLocaleString()})`
                  : breakEven.errorMessageTh || 'ต้นทุนผันแปรรวมเกินหรือเท่ากับ 100% ของราคาขาย'}
              </p>
              <p className="text-[11px] text-amber-700 mt-0.5">{effectivePeriodLabel}</p>
            </div>
          </div>
          <div className="text-xs text-amber-800 bg-white/80 px-3 py-1.5 rounded-lg border border-amber-200">
            กรุณาใส่ % Contribution Margin มากกว่า 0% เพื่อดูยอดคุ้มทุน
          </div>
        </div>
      ) : (
        <div
          className={`p-6 rounded-2xl border ${
            isProfitable ? 'bg-emerald-50/80 border-emerald-200' : 'bg-rose-50/80 border-rose-200'
          } flex flex-col md:flex-row items-center justify-between gap-6`}
        >
          <div className="space-y-1 text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2 flex-wrap">
              {isProfitable ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-rose-600" />
              )}
              <span
                className={`text-xs font-bold uppercase tracking-wider ${
                  isProfitable ? 'text-emerald-800' : 'text-rose-800'
                }`}
              >
                {isProfitable
                  ? 'สถานะปัจจุบัน: เกินจุดคุ้มทุน (กำไรแล้ว)'
                  : 'สถานะปัจจุบัน: ยังไม่ถึงจุดคุ้มทุน'}
              </span>
              {isAssumedCM && (
                <span className="text-[10px] bg-amber-200 text-amber-950 px-1.5 py-0.5 rounded font-bold">
                  ค่าสมมติ (CM {contributionMarginPercent.toFixed(1)}%)
                </span>
              )}
            </div>
            <div className="text-3xl font-extrabold text-slate-900 font-mono">
              ฿{Math.round(breakEven.breakEvenSales).toLocaleString()}{' '}
              <span className="text-sm font-sans font-normal text-slate-500">/ เดือน</span>
            </div>
            <p className="text-xs text-slate-600">
              {activeLanguage === 'th'
                ? `ยอดขายเทียบฐานรายเดือน (ex-VAT) ฿${Math.round(monthlyNormalizedSales).toLocaleString()} (${
                    safetyMarginPercent > 0
                      ? `ส่วนปลอดภัย +${safetyMarginPercent.toFixed(1)}%`
                      : `ขาดอีก ฿${Math.round(Math.max(0, breakEven.breakEvenSales - monthlyNormalizedSales)).toLocaleString()}`
                  })`
                : `Normalized Monthly Sales: ฿${Math.round(monthlyNormalizedSales).toLocaleString()} (${safetyMarginPercent.toFixed(1)}% safety margin)`}
            </p>
            <p className="text-[11px] text-slate-500">{effectivePeriodLabel}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-center font-mono">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[10px] text-slate-400 font-sans">ยอดขายขั้นต่ำต่อวัน</div>
              <div className="text-xl font-bold text-slate-900 mt-1">
                ฿{Math.round(breakEven.breakEvenDailySales).toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-400 font-sans mt-0.5">
                {operatingDays} วันทำการ/เดือน
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[10px] text-slate-400 font-sans">จำนวนออเดอร์ขั้นต่ำต่อวัน</div>
              <div className="text-xl font-bold text-emerald-700 mt-1">
                {breakEven.breakEvenDailyOrders}{' '}
                <span className="text-xs text-slate-400 font-sans">จาน/วัน</span>
              </div>
              <div className="text-[10px] text-slate-400 font-sans mt-0.5">บิลเฉลี่ย ฿{averageTicket}</div>
            </div>
          </div>
        </div>
      )}

      {/* Target Profit Section (MED-01) */}
      {targetProfitPercent > 0 && breakEven.isValid && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/60 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Target className="h-5 w-5 text-amber-600 shrink-0" />
            <div>
              <div className="text-xs font-bold text-amber-900">
                เป้าหมายกำไรสุทธิ (Target Profit: {targetProfitPercent}%)
              </div>
              {breakEven.targetProfitValid ? (
                <div className="text-xl font-bold font-mono text-amber-900 mt-0.5">
                  ยอดขายที่ต้องทำได้: ฿{Math.round(breakEven.targetProfitSales).toLocaleString()}{' '}
                  <span className="text-xs font-normal text-amber-700 font-sans">
                    / เดือน ({Math.round(breakEven.targetProfitDailySales).toLocaleString()} ฿/วัน ·{' '}
                    {breakEven.targetProfitDailyOrders} จาน/วัน)
                  </span>
                </div>
              ) : (
                <div className="text-xs font-semibold text-rose-700 mt-0.5">
                  {breakEven.targetProfitErrorMessageTh || 'เป้าหมายกำไรสูงเกินกว่ามาร์จิ้นที่เป็นไปได้'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Interactive Parameter Inputs */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <h2 className="text-sm font-bold text-slate-900">
            ปรับแต่งตัวแปรเพื่อทดสอบจุดคุ้มทุน (Sensitivity Parameters)
          </h2>
          {(isFixedEdited || isCmEdited) && (
            <button
              type="button"
              onClick={() => {
                setIsFixedEdited(false);
                setIsCmEdited(false);
                setFixedCosts(defaultTotalFixed);
                setContributionMarginPercent(
                  derivedMargin.hasRealData ? derivedMargin.contributionMarginPercent : 0
                );
              }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>รีเซ็ตเป็นค่าจริงจากระบบ</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              1. ต้นทุนคงที่รายเดือน (Fixed ฿)
            </label>
            <NumericInput
              type="number"
              min="0"
              step="1000"
              value={fixedCosts}
              onValueChange={(val) => {
                setIsFixedEdited(true);
                setFixedCosts(val);
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono font-bold"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              คงที่ ฿{Math.round(fixedExpensesMonthly).toLocaleString()} + พนักงาน {activeEmployees.length} คน ฿{Math.round(totalStaffLaborMonthly).toLocaleString()}
            </p>
          </div>

          <div
            className={`p-3.5 rounded-xl border ${
              isAssumedCM ? 'bg-amber-50/70 border-amber-300' : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-1 mb-1">
              <label className="block text-xs font-semibold text-slate-700">
                2. % Contribution Margin (%)
              </label>
              {isAssumedCM && (
                <span className="text-[10px] bg-amber-200 text-amber-950 px-1.5 py-0.5 rounded font-bold">
                  ค่าสมมติ
                </span>
              )}
            </div>
            <NumericInput
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={contributionMarginPercent}
              onValueChange={(val) => {
                setIsCmEdited(true);
                setContributionMarginPercent(val);
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono font-bold"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              {derivedMargin.hasRealData
                ? '100% - (อาหาร + กล่อง + GP + ผันแปรอื่น)'
                : 'ค่าสมมติ (กรอกเพื่อจำลองเมื่อยังไม่มีข้อมูล 30 วัน)'}
            </p>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              3. เป้าหมายกำไรสุทธิ (%)
            </label>
            <NumericInput
              type="number"
              min="0"
              max="50"
              value={targetProfitPercent}
              onValueChange={(val) => setTargetProfitPercent(val)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono font-bold"
            />
            <p className="text-[10px] text-slate-400 mt-1">Target Profit %</p>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              4. ราคาบิลเฉลี่ยต่อจาน (฿)
            </label>
            <NumericInput
              type="number"
              min="1"
              value={averageTicket}
              onValueChange={(val) => setAverageTicket(val)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono font-bold"
            />
            <p className="text-[10px] text-slate-400 mt-1">Average Ticket Size (ex-VAT)</p>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              5. วันเปิดทำการต่อเดือน (วัน)
            </label>
            <NumericInput
              type="number"
              min="1"
              max="31"
              value={operatingDays}
              onValueChange={(val) => setOperatingDays(Math.round(val))}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono font-bold"
            />
            <p className="text-[10px] text-slate-400 mt-1">Operating Days / Month</p>
          </div>
        </div>
      </div>
    </div>
  );
};

