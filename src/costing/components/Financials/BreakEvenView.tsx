import React, { useState } from 'react';
import { Scale, TrendingUp, DollarSign, Calendar, AlertCircle, CheckCircle2, Target, AlertTriangle } from 'lucide-react';
import { ExpenseRecord, Employee, DailySalesRecord, BusinessSettings } from '../../types/domain';
import { calculateBreakEven, convertExpenseToMonthly, calculateOverheadRatePercent } from '../../engine/calculations';
import { NumericInput } from '../common/NumericInput';

interface BreakEvenViewProps {
  expenses: ExpenseRecord[];
  employees: Employee[];
  sales: DailySalesRecord[];
  settings: BusinessSettings;
  activeLanguage: 'th' | 'en';
}

export const BreakEvenView: React.FC<BreakEvenViewProps> = ({
  expenses,
  employees,
  sales,
  settings,
  activeLanguage,
}) => {
  const initialOperatingDays = settings.operatingDaysPerMonth || 26;
  const [operatingDays, setOperatingDays] = useState<number>(initialOperatingDays);

  // Fixed costs from expenses (frequency converted & excluding isExcluded items) & full-time employee salaries
  const fixedExpenses = expenses
    .filter((e) => !e.isExcluded && e.isFixed)
    .reduce((sum, e) => sum + convertExpenseToMonthly(e, operatingDays), 0);
  const fixedSalaries = employees
    .filter((e) => e.employmentType === 'full_time')
    .reduce((sum, e) => sum + (e.monthlyCost || 0), 0);
  const defaultTotalFixed = fixedExpenses + fixedSalaries;

  // Custom adjustable parameters
  const [fixedCosts, setFixedCosts] = useState<number>(defaultTotalFixed);
  const [contributionMarginPercent, setContributionMarginPercent] = useState<number>(65);
  const [targetProfitPercent, setTargetProfitPercent] = useState<number>(10);
  const [averageTicket, setAverageTicket] = useState<number>(140);

  const monthlyNetSales = sales.reduce((sum, s) => sum + (s.netSales || 0), 0);

  const breakEven = calculateBreakEven(
    fixedCosts,
    contributionMarginPercent,
    averageTicket,
    operatingDays,
    targetProfitPercent,
    monthlyNetSales
  );

  const calculatedOverheadRate = calculateOverheadRatePercent(
    fixedCosts,
    monthlyNetSales,
    Math.max(0, 100 - contributionMarginPercent - 30) // estimated variable %
  );

  const isProfitable = breakEven.isValid && breakEven.isProfitable;
  const safetyMarginRevenue = breakEven.safetyMarginRevenue;
  const safetyMarginPercent = breakEven.safetyMarginPercent;

  const hasOwnerSalary = expenses.some((e) => {
    if (e.isExcluded) return false;
    const desc = (e.description || '').toLowerCase();
    const isOwnerDesc = desc.includes('เจ้าของ') || desc.includes('owner') || desc.includes('ผู้จัดการ/เจ้าของ');
    return isOwnerDesc && Number(e.amount) > 0;
  }) || employees.some((emp) => {
    const name = (emp.name || '').toLowerCase();
    const role = (emp.roleCategory || '').toLowerCase();
    return (name.includes('เจ้าของ') || name.includes('owner') || role.includes('owner')) && (emp.monthlyCost || 0) > 0;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Scale className="h-5 w-5 text-emerald-600" />
            <span>{activeLanguage === 'th' ? 'การวิเคราะห์จุดคุ้มทุน (Break-Even Analysis)' : 'Break-Even Analysis'}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {activeLanguage === 'th'
              ? 'คำนวณยอดขายขั้นต่ำและเป้าหมายกำไร เพื่อให้ครอบคลุมค่าใช้จ่ายคงที่และโสหุ้ยทั้งหมดของร้าน'
              : 'Minimum sales and target profit volume required to cover fixed overheads.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
            <span className="text-slate-500">อัตราโสหุ้ยจริง (Overhead %):</span>
            <span className="font-mono font-bold text-slate-900">
              {monthlyNetSales > 0 ? `${calculatedOverheadRate.toFixed(1)}%` : 'รอข้อมูลยอดขาย'}
            </span>
          </div>
          {monthlyNetSales > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800">
              <span className="text-emerald-700 font-medium">ตัวอย่างอาหาร 100 บาท:</span>
              <span className="font-mono font-bold text-emerald-950">
                โสหุ้ย {((100 * calculatedOverheadRate) / 100).toFixed(1)} บาท
              </span>
            </div>
          )}
        </div>
      </div>

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

      {/* Break-Even Key Metrics Banner */}
      {!breakEven.isValid ? (
        <div className="p-6 rounded-2xl border bg-rose-50/90 border-rose-200 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 text-rose-600 shrink-0" />
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-rose-800">
                สถานะ: ไม่สามารถคำนวณจุดคุ้มทุนได้
              </div>
              <p className="text-sm font-semibold text-rose-700 mt-0.5">
                {breakEven.errorMessageTh || 'ต้นทุนผันแปรรวมเกินหรือเท่ากับ 100% ของราคาขาย'}
              </p>
            </div>
          </div>
          <div className="text-xs text-rose-600 bg-white/80 px-3 py-1.5 rounded-lg border border-rose-200">
            กรุณาปรับ % Contribution Margin ให้มากกว่า 0%
          </div>
        </div>
      ) : (
        <div className={`p-6 rounded-2xl border ${
          isProfitable ? 'bg-emerald-50/80 border-emerald-200' : 'bg-rose-50/80 border-rose-200'
        } flex flex-col md:flex-row items-center justify-between gap-6`}>
          <div className="space-y-1 text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2">
              {isProfitable ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-rose-600" />
              )}
              <span className={`text-xs font-bold uppercase tracking-wider ${
                isProfitable ? 'text-emerald-800' : 'text-rose-800'
              }`}>
                {isProfitable ? 'สถานะปัจจุบัน: เกินจุดคุ้มทุน (กำไรแล้ว)' : 'สถานะปัจจุบัน: ยังไม่ถึงจุดคุ้มทุน'}
              </span>
            </div>
            <div className="text-3xl font-extrabold text-slate-900 font-mono">
              ฿{Math.round(breakEven.breakEvenSales).toLocaleString()}{' '}
              <span className="text-sm font-sans font-normal text-slate-500">/ เดือน</span>
            </div>
            <p className="text-xs text-slate-600">
              {activeLanguage === 'th'
                ? `ยอดขายปัจจุบัน (ex-VAT) ฿${Math.round(monthlyNetSales).toLocaleString()} (${safetyMarginPercent > 0 ? `ส่วนปลอดภัย +${safetyMarginPercent.toFixed(1)}%` : `ขาดอีก ฿${Math.round(Math.abs(breakEven.breakEvenSales - monthlyNetSales)).toLocaleString()}`})`
                : `Current Net Sales: ฿${Math.round(monthlyNetSales).toLocaleString()} (${safetyMarginPercent.toFixed(1)}% safety margin)`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-center font-mono">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[10px] text-slate-400 font-sans">ยอดขายขั้นต่ำต่อวัน</div>
              <div className="text-xl font-bold text-slate-900 mt-1">
                ฿{Math.round(breakEven.breakEvenDailySales).toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-400 font-sans mt-0.5">{operatingDays} วันทำการ/เดือน</div>
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
      {targetProfitPercent > 0 && (
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
                    / เดือน ({Math.round(breakEven.targetProfitDailySales).toLocaleString()} ฿/วัน · {breakEven.targetProfitDailyOrders} จาน/วัน)
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

      {/* Interactive Parameter Sliders */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
          ปรับแต่งตัวแปรเพื่อทดสอบจุดคุ้มทุน (Sensitivity Parameters)
        </h2>

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
              onChange={(e) => setFixedCosts(parseFloat(e.target.value) || 0)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono font-bold"
            />
            <p className="text-[10px] text-slate-400 mt-1">ค่าเช่า + เงินเดือนประจำ (แปลงรายเดือนแล้ว)</p>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              2. % Contribution Margin (%)
            </label>
            <NumericInput
              type="number"
              min="0"
              max="100"
              value={contributionMarginPercent}
              onChange={(e) => setContributionMarginPercent(parseFloat(e.target.value) || 0)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono font-bold"
            />
            <p className="text-[10px] text-slate-400 mt-1">100% - Food Cost % - Variable %</p>
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
              onChange={(e) => setTargetProfitPercent(parseFloat(e.target.value) || 0)}
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
              onChange={(e) => setAverageTicket(parseFloat(e.target.value) || 120)}
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
              onChange={(e) => setOperatingDays(parseInt(e.target.value) || 26)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono font-bold"
            />
            <p className="text-[10px] text-slate-400 mt-1">Operating Days / Month</p>
          </div>
        </div>
      </div>
    </div>
  );
};
