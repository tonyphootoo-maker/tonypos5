import React, { useState, useEffect } from 'react';
import {
  ExpenseDoc,
  EmployeeDoc,
  DailySummaryDoc,
  WageType,
  SettingsDoc,
  Language,
} from '../types';
import { translations } from '../i18n/translations';
import { useLanguage } from '../contexts/LanguageContext';
import {
  formatMoney,
  calculateEmployeeMonthlyCost,
  calculateSimpleMonthlyBreakEven,
  calculatePeriodExpensesAndLabor,
  deriveVariableCostPercent,
  getBusinessWorkDate,
  roundTo2,
  formatPercent,
  formatPeriodCalculationLabel,
  isExplicitPayrollExpense,
} from '../engine/calculations';
import {
  subscribeCollection,
  subscribeDailySummariesInRange,
  saveDocument,
  deleteDocument,
} from '../data/db';
import {
  CircleDollarSign,
  Users,
  Calculator,
  Plus,
  Trash2,
  Edit2,
  X,
  TrendingUp,
  Building,
  Zap,
  Flame,
  Wrench,
  ShoppingBag,
  AlertTriangle,
} from 'lucide-react';
import { NumericInput } from '../costing/components/common/NumericInput';
import { ConfirmModal } from '../components/ConfirmModal';

interface Props {
  settings: SettingsDoc;
  lang?: Language;
}

type TabType = 'expenses' | 'labor' | 'breakeven';

export const FinancePage: React.FC<Props> = ({ settings, lang: propLang }) => {
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const t = translations[lang];
  const [activeTab, setActiveTab] = useState<TabType>('expenses');

  const [expenses, setExpenses] = useState<ExpenseDoc[]>([]);
  const [employees, setEmployees] = useState<EmployeeDoc[]>([]);
  const [last30Summaries, setLast30Summaries] = useState<DailySummaryDoc[]>([]);

  // Modals state
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Partial<ExpenseDoc> | null>(null);

  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Partial<EmployeeDoc> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    collection: 'expenses' | 'employees';
    id: string;
    label: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Break-even optional custom override (derived automatically from real 30-day data by default)
  const [useCustomOverride, setUseCustomOverride] = useState<boolean>(false);
  const [overrideContributionMargin, setOverrideContributionMargin] = useState<number>(0);
  const [excludePayrollDuplicates, setExcludePayrollDuplicates] = useState<boolean>(true);

  const todayStr = getBusinessWorkDate(new Date(), settings.dailyClosingTime);

  const loadData = async () => {
    // Handled continuously in real time by Firestore onSnapshot listeners
  };

  useEffect(() => {
    const past30Date = new Date();
    past30Date.setDate(past30Date.getDate() - 30);
    const start30Str = getBusinessWorkDate(past30Date, settings.dailyClosingTime);

    const unsubExps = subscribeCollection<ExpenseDoc>('expenses', (exps) => setExpenses(exps));
    const unsubEmps = subscribeCollection<EmployeeDoc>('employees', (emps) => setEmployees(emps));
    const unsubSums = subscribeDailySummariesInRange(start30Str, todayStr, (sums30) =>
      setLast30Summaries(sums30)
    );

    return () => {
      unsubExps();
      unsubEmps();
      unsubSums();
    };
  }, [todayStr, settings.dailyClosingTime]);

  const laborOptions = {
    socialSecurityEnabled: Boolean(settings.socialSecurityEnabled),
    socialSecurityRatePercent: settings.socialSecurityRatePercent ?? 5,
    socialSecurityCapWage: settings.socialSecurityCapWage ?? 15000,
    defaultOperatingDays: settings.operatingDaysPerMonth || 26,
  };

  // Explicit payroll duplicate detection (no brittle keyword matching)
  const payrollFlaggedExpenses = expenses.filter((e) => isExplicitPayrollExpense(e));
  const activeEmployeesCount = employees.filter((e) => e.isActive !== false).length;
  const hasDuplicatePayroll = activeEmployeesCount > 0 && payrollFlaggedExpenses.length > 0;
  const effectiveExpenses =
    hasDuplicatePayroll && excludePayrollDuplicates
      ? expenses.filter((e) => !isExplicitPayrollExpense(e))
      : expenses;

  // Compute current month fixed/variable expenses & labor via centralized engine
  const currentMonth = todayStr.substring(0, 7);
  const periodLabel = formatPeriodCalculationLabel('month', currentMonth, lang);
  const monthlyCosts = calculatePeriodExpensesAndLabor(
    'month',
    currentMonth,
    effectiveExpenses,
    employees,
    undefined,
    laborOptions
  );
  const totalMonthlyFixedExpenses = monthlyCosts.fixedExpenses;
  const totalMonthlyLabor = monthlyCosts.laborCost;

  // Derive Variable Cost % and Contribution Margin % from last 30 days' real data (including variable OpEx)
  const derivedMargin = deriveVariableCostPercent(last30Summaries, {
    otherVariableCostAmount: monthlyCosts.variableExpenses,
  });
  const isUsingAssumedCm = useCustomOverride || !derivedMargin.hasRealData;
  const activeContributionMarginPercent = useCustomOverride
    ? overrideContributionMargin
    : derivedMargin.contributionMarginPercent;

  // Break-even calculation using real derived CM% (or explicit user assumption) and configured operating days
  const operatingDays = settings.operatingDaysPerMonth || 26;
  const breakEven = calculateSimpleMonthlyBreakEven(
    totalMonthlyFixedExpenses,
    totalMonthlyLabor,
    activeContributionMarginPercent,
    operatingDays
  );

  // ==========================================
  // EXPENSE HANDLERS
  // ==========================================
  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingExpense || !editingExpense.title || !editingExpense.amount) return;

    const isNew = !editingExpense.id;
    const expToSave: ExpenseDoc = {
      id: editingExpense.id || `exp_${Date.now()}`,
      title: editingExpense.title,
      ...(editingExpense.titleTh ? { titleTh: editingExpense.titleTh } : {}),
      category: editingExpense.category || 'other',
      amount: editingExpense.amount || 0,
      date: editingExpense.date || new Date().toISOString().split('T')[0],
      isFixed: editingExpense.isFixed ?? true,
      isRecurring: editingExpense.isRecurring ?? true,
      ...(editingExpense.isPayroll !== undefined ? { isPayroll: editingExpense.isPayroll } : {}),
      createdAt: editingExpense.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: editingExpense.version || 1,
    };

    await saveDocument('expenses', expToSave, isNew);
    setIsExpenseModalOpen(false);
    setEditingExpense(null);
    loadData();
  };

  // ==========================================
  // EMPLOYEE HANDLERS
  // ==========================================
  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee || !editingEmployee.name || !editingEmployee.wageAmount) return;

    const isNew = !editingEmployee.id;
    const wType = editingEmployee.wageType || 'monthly';
    const empToSave: EmployeeDoc = {
      id: editingEmployee.id || `emp_${Date.now()}`,
      name: editingEmployee.name,
      role: editingEmployee.role || 'Staff',
      wageType: wType,
      wageAmount: editingEmployee.wageAmount || 0,
      workDaysOrHoursPerMonth:
        editingEmployee.workDaysOrHoursPerMonth || (wType === 'hourly' ? 208 : 26),
      ...(editingEmployee.phone ? { phone: editingEmployee.phone } : {}),
      isActive: editingEmployee.isActive ?? true,
      createdAt: editingEmployee.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: editingEmployee.version || 1,
    };

    await saveDocument('employees', empToSave, isNew);
    setIsEmployeeModalOpen(false);
    setEditingEmployee(null);
    loadData();
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4 select-none">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight flex items-center gap-2">
          <CircleDollarSign className="w-6 h-6 text-emerald-600" />
          <span>{t.finance.title}</span>
        </h2>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 border-b border-orange-200 pb-1">
        <button
          onClick={() => setActiveTab('expenses')}
          className={`px-4 py-2 rounded-xl text-xs font-black cursor-pointer shadow-2xs transition-all ${
            activeTab === 'expenses'
              ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-xs'
              : 'bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200'
          }`}
        >
          {t.finance.tabExpenses} ({expenses.length})
        </button>
        <button
          onClick={() => setActiveTab('labor')}
          className={`px-4 py-2 rounded-xl text-xs font-black cursor-pointer shadow-2xs transition-all ${
            activeTab === 'labor'
              ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-xs'
              : 'bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200'
          }`}
        >
          {t.finance.tabLabor} ({employees.length})
        </button>
        <button
          onClick={() => setActiveTab('breakeven')}
          className={`px-4 py-2 rounded-xl text-xs font-black cursor-pointer shadow-2xs transition-all ${
            activeTab === 'breakeven'
              ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-xs'
              : 'bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200'
          }`}
        >
          {t.finance.tabBreakEven}
        </button>
      </div>

      {/* Explicit Payroll Overlap Warning */}
      {hasDuplicatePayroll && (
        <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-start sm:items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <strong className="font-bold">
                {lang === 'th'
                  ? `พบค่าใช้จ่าย Payroll (${payrollFlaggedExpenses.length} รายการ) ร่วมกับข้อมูลพนักงาน (${activeEmployeesCount} คน)`
                  : `Found ${payrollFlaggedExpenses.length} Payroll expense(s) alongside ${activeEmployeesCount} active staff`}
              </strong>
              <span className="block text-[11px] text-amber-800">
                {excludePayrollDuplicates
                  ? lang === 'th'
                    ? 'ระบบตัดรายการ Payroll ในค่าใช้จ่ายออกเพื่อไม่ให้นับซ้ำ'
                    : 'Excluded from overhead to avoid double counting.'
                  : lang === 'th'
                  ? 'กำลังนับรวมทั้งคู่'
                  : 'Both payroll expenses and staff records are included.'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setExcludePayrollDuplicates((prev) => !prev)}
            className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 text-amber-900 font-bold hover:bg-amber-100 cursor-pointer shrink-0 text-[11px]"
          >
            {excludePayrollDuplicates
              ? lang === 'th' ? 'นำกลับมานับรวม' : 'Include Anyway'
              : lang === 'th' ? 'ตัดรายการซ้ำออก' : 'Exclude Duplicates'}
          </button>
        </div>
      )}

      {/* TAB: EXPENSES */}
      {activeTab === 'expenses' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="text-xs text-neutral-600">
              {t.finance.totalMonthlyFixedExpenses}:{' '}
              <strong className="text-emerald-700 font-extrabold">฿{formatMoney(totalMonthlyFixedExpenses)}</strong>
              <span className="text-[11px] text-neutral-400 ml-2">({periodLabel})</span>
            </div>
            <button
              onClick={() => {
                setEditingExpense({
                  title: '',
                  category: 'rent',
                  amount: 15000,
                  isFixed: true,
                  isRecurring: true,
                  isPayroll: false,
                  date: new Date().toISOString().split('T')[0],
                });
                setIsExpenseModalOpen(true);
              }}
              className="px-3.5 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer hover:brightness-105"
            >
              <Plus className="w-4 h-4" />
              <span>{t.finance.addExpense}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {expenses.map((exp) => (
              <div
                key={exp.id}
                className="p-3.5 bg-white rounded-2xl border border-neutral-200 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start gap-1">
                    <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-700">
                      {exp.category}
                    </span>
                    <div className="flex items-center gap-1">
                      {isExplicitPayrollExpense(exp) && (
                        <span className="text-[9px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                          {lang === 'th' ? 'เงินเดือน' : 'Payroll'}
                        </span>
                      )}
                      {exp.isRecurring && (
                        <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                          {t.finance.monthly}
                        </span>
                      )}
                    </div>
                  </div>

                  <h4 className="font-black text-sm text-neutral-900 mt-2">
                    {lang === 'th' && exp.titleTh ? exp.titleTh : exp.title}
                  </h4>

                  <div className="text-lg font-black text-neutral-900 mt-1">
                    ฿{formatMoney(exp.amount)}
                  </div>
                </div>

                <div className="flex justify-between items-center mt-3 pt-2 border-t border-neutral-100 text-[11px] text-neutral-400">
                  <span>{exp.date}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        setEditingExpense(exp);
                        setIsExpenseModalOpen(true);
                      }}
                      className="p-1 text-neutral-600 hover:text-orange-600 cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingDelete({
                          collection: 'expenses',
                          id: exp.id,
                          label: lang === 'th' && exp.titleTh ? exp.titleTh : exp.title,
                        })
                      }
                      className="p-1 text-neutral-400 hover:text-rose-600 cursor-pointer"
                      title={t.common.delete}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: LABOR & STAFF */}
      {activeTab === 'labor' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="text-xs text-neutral-600">
              {t.finance.totalMonthlyLabor}:{' '}
              <strong className="text-emerald-700 font-extrabold">฿{formatMoney(totalMonthlyLabor)}</strong>
              <span className="text-[11px] text-neutral-400 ml-2">({periodLabel})</span>
            </div>
            <button
              onClick={() => {
                setEditingEmployee({
                  name: '',
                  role: 'Chef',
                  wageType: 'monthly',
                  wageAmount: 18000,
                  workDaysOrHoursPerMonth: 26,
                  isActive: true,
                });
                setIsEmployeeModalOpen(true);
              }}
              className="px-3.5 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer hover:brightness-105"
            >
              <Plus className="w-4 h-4" />
              <span>{t.finance.addEmployee}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {employees.map((emp) => {
              const monthlyCost = calculateEmployeeMonthlyCost(emp, laborOptions);
              return (
                <div
                  key={emp.id}
                  className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs flex flex-col justify-between"
                >
                  <div>
                    <div className="flex justify-between items-start">
                      <h4 className="font-black text-base text-neutral-900">{emp.name}</h4>
                      <span className="text-[10px] font-bold text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-md">
                        {emp.role}
                      </span>
                    </div>

                    <div className="mt-3 space-y-1 text-xs text-neutral-600">
                      <div className="flex justify-between">
                        <span>{t.finance.wageType}:</span>
                        <span className="font-bold">
                          {emp.wageType === 'monthly'
                            ? t.finance.monthly
                            : emp.wageType === 'daily'
                            ? t.finance.daily
                            : t.finance.hourly}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t.finance.wageAmount}:</span>
                        <span className="font-bold">฿{formatMoney(emp.wageAmount)}</span>
                      </div>
                      <div className="flex justify-between pt-1 border-t border-neutral-100 text-neutral-900 font-black">
                        <span>{t.finance.monthlyCostEquivalent}:</span>
                        <span className="text-emerald-700">฿{formatMoney(monthlyCost)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-1 mt-4 pt-2 border-t border-neutral-100">
                    <button
                      onClick={() => {
                        setEditingEmployee(emp);
                        setIsEmployeeModalOpen(true);
                      }}
                      className="p-1.5 text-neutral-600 hover:text-orange-600 rounded-lg hover:bg-neutral-100 cursor-pointer"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingDelete({
                          collection: 'employees',
                          id: emp.id,
                          label: emp.name,
                        })
                      }
                      className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                      title={t.common.delete}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB: BREAK-EVEN CALCULATOR */}
      {activeTab === 'breakeven' && (
        <div className="max-w-2xl bg-white p-5 rounded-3xl border border-neutral-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-black text-base text-neutral-900 flex items-center gap-2">
                <Calculator className="w-5 h-5 text-orange-600" />
                <span>{t.finance.tabBreakEven}</span>
              </h3>
              <p className="text-[11px] text-neutral-500 mt-0.5">{periodLabel}</p>
            </div>
            {isUsingAssumedCm && activeContributionMarginPercent > 0 && (
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                {lang === 'th' ? 'ค่าสมมติ' : 'Assumed'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-neutral-50 rounded-2xl text-xs">
            <div>
              <span className="text-neutral-500">{t.finance.totalMonthlyFixedExpenses}:</span>
              <div className="text-base font-extrabold text-neutral-900">
                ฿{formatMoney(totalMonthlyFixedExpenses)}
              </div>
            </div>
            <div>
              <span className="text-neutral-500">{t.finance.totalMonthlyLabor}:</span>
              <div className="text-base font-extrabold text-neutral-900">
                ฿{formatMoney(totalMonthlyLabor)}
              </div>
            </div>
            <div>
              <span className="text-neutral-500">{t.finance.operatingDaysNote}</span>
              <div className="text-base font-extrabold text-neutral-900">
                {breakEven.operatingDays} {lang === 'th' ? 'วัน' : 'days'}
              </div>
            </div>
          </div>

          {/* 30-Day Real Data Variable Cost % Banner */}
          <div
            className={`p-3.5 rounded-2xl border text-xs space-y-1.5 ${
              derivedMargin.hasRealData
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                : 'bg-amber-50/70 border-amber-200 text-amber-950'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-extrabold">
                {derivedMargin.hasRealData
                  ? t.finance.derivedVariableCostNote
                  : lang === 'th'
                  ? 'ยังไม่มียอดขาย 30 วัน — โปรดกรอก CM% สมมติด้านล่างเพื่อคำนวณ'
                  : 'No 30-day real sales yet — enter an assumed CM% below'}
              </span>
              {derivedMargin.hasRealData && (
                <span className="font-black text-sm">
                  {lang === 'th' ? 'ต้นทุนผันแปร' : 'Var Cost'} {formatPercent(derivedMargin.variableCostPercent)} → CM {formatPercent(derivedMargin.contributionMarginPercent)}
                </span>
              )}
            </div>
            {derivedMargin.hasRealData ? (
              <div className="text-[11px] opacity-80">
                {lang === 'th'
                  ? `ยอดขายสุทธิจริง 30 วัน: ฿${formatMoney(derivedMargin.totalNetSales)} (${last30Summaries.length} วันทำการ)`
                  : `30-Day Real Net Sales: ฿${formatMoney(derivedMargin.totalNetSales)} (${last30Summaries.length} business days)`}
              </div>
            ) : (
              <div className="text-[11px] opacity-80">
                {lang === 'th'
                  ? 'ระบบไม่ใช้ค่า 65% อัตโนมัติแบบเงียบๆ หากต้องการจำลองจุดคุ้มทุน ให้เปิดสวิตช์ระบุค่าสมมติ'
                  : 'No silent default CM% is applied. Enable the override toggle to enter an explicit assumed CM%.'}
              </div>
            )}
          </div>

          {/* Optional Custom CM% Override */}
          <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-2">
            <label className="flex items-center justify-between cursor-pointer text-xs font-bold text-neutral-800">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useCustomOverride}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setUseCustomOverride(checked);
                    if (checked && overrideContributionMargin <= 0 && derivedMargin.hasRealData) {
                      setOverrideContributionMargin(Math.round(derivedMargin.contributionMarginPercent));
                    }
                  }}
                  className="w-4 h-4 accent-orange-600 rounded"
                />
                <span>{t.finance.customOverrideToggle}</span>
              </span>
              <span className="text-orange-600 text-sm font-black">
                {formatPercent(activeContributionMarginPercent)}
              </span>
            </label>

            {useCustomOverride && (
              <div className="flex items-center gap-2 pt-1">
                <NumericInput
                  min={1}
                  max={95}
                  value={overrideContributionMargin}
                  onValueChange={(val) =>
                    setOverrideContributionMargin(Math.max(0, Math.min(95, val)))
                  }
                  className="w-24 px-2.5 py-1 text-xs bg-white border border-amber-300 rounded-lg font-bold"
                />
                <span className="text-xs font-bold text-amber-800">
                  % ({lang === 'th' ? 'ค่าสมมติ' : 'Assumed'})
                </span>
              </div>
            )}
          </div>

          {/* Results Display */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="p-4 bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 rounded-2xl text-center">
              <div className="text-xs font-bold text-orange-800">{t.finance.breakEvenMonthlyRevenue}</div>
              <div className="text-xl font-black text-neutral-900 mt-1">
                {activeContributionMarginPercent > 0
                  ? `฿${formatMoney(breakEven.monthlyBreakEvenSales)}`
                  : lang === 'th'
                  ? 'รอข้อมูล / CM%'
                  : 'N/A'}
              </div>
            </div>

            <div className="p-4 bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl text-center">
              <div className="text-xs font-bold text-emerald-800">{t.finance.breakEvenDailyRevenue}</div>
              <div className="text-xl font-black text-emerald-900 mt-1">
                {activeContributionMarginPercent > 0
                  ? `฿${formatMoney(breakEven.dailyBreakEvenSales)}`
                  : lang === 'th'
                  ? 'รอข้อมูล / CM%'
                  : 'N/A'}
              </div>
              <div className="text-[10px] text-emerald-700 mt-0.5">
                ÷ {breakEven.operatingDays} {lang === 'th' ? 'วันทำการ' : 'operating days'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EXPENSE MODAL */}
      {isExpenseModalOpen && editingExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <form
            onSubmit={handleSaveExpense}
            className="modal-panel bg-white rounded-3xl shadow-2xl max-w-sm w-full border border-orange-200"
          >
            <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">{t.finance.addExpense}</h3>
              <button
                type="button"
                onClick={() => setIsExpenseModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.finance.expenseTitle}
                </label>
                <input
                  type="text"
                  required
                  value={editingExpense.title || ''}
                  onChange={(e) => setEditingExpense({ ...editingExpense, title: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder={lang === 'th' ? 'เช่น ค่าเช่าร้านเดือนนี้' : 'e.g. November Rent'}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.finance.expenseCategory}
                </label>
                <select
                  value={editingExpense.category || 'rent'}
                  onChange={(e) => setEditingExpense({ ...editingExpense, category: e.target.value as any })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                >
                  <option value="rent">{t.finance.catRent}</option>
                  <option value="electricity">{t.finance.catElectricity}</option>
                  <option value="water">{t.finance.catWater}</option>
                  <option value="gas">{t.finance.catGas}</option>
                  <option value="marketing">{t.finance.catMarketing}</option>
                  <option value="repairs">{t.finance.catRepairs}</option>
                  <option value="supplies">{t.finance.catSupplies}</option>
                  <option value="other">{t.finance.catOther}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.finance.expenseAmount}
                </label>
                <NumericInput
                  min={0}
                  step={10}
                  value={editingExpense.amount}
                  onValueChange={(val) => setEditingExpense({ ...editingExpense, amount: val })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="chkRecurring"
                  checked={editingExpense.isRecurring}
                  onChange={(e) => setEditingExpense({ ...editingExpense, isRecurring: e.target.checked })}
                  className="w-4 h-4 text-orange-600 rounded"
                />
                <label htmlFor="chkRecurring" className="text-xs text-neutral-700 font-semibold cursor-pointer">
                  {t.finance.isRecurring}
                </label>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="chkPayroll"
                  checked={Boolean(editingExpense.isPayroll)}
                  onChange={(e) => setEditingExpense({ ...editingExpense, isPayroll: e.target.checked })}
                  className="w-4 h-4 text-orange-600 rounded"
                />
                <label htmlFor="chkPayroll" className="text-xs text-neutral-700 font-semibold cursor-pointer">
                  {lang === 'th' ? 'เป็นรายการเงินเดือน/ค่าแรงพนักงาน (Payroll)' : 'Staff Payroll Expense'}
                </label>
              </div>
            </div>

            <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsExpenseModalOpen(false)}
                className="px-3 py-1.5 bg-white text-neutral-700 border border-neutral-300 rounded-xl text-xs font-bold cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
              >
                {t.common.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* EMPLOYEE MODAL */}
      {isEmployeeModalOpen && editingEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <form
            onSubmit={handleSaveEmployee}
            className="modal-panel bg-white rounded-3xl shadow-2xl max-w-sm w-full border border-orange-200"
          >
            <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">{t.finance.addEmployee}</h3>
              <button
                type="button"
                onClick={() => setIsEmployeeModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.finance.employeeName}
                </label>
                <input
                  type="text"
                  required
                  value={editingEmployee.name || ''}
                  onChange={(e) => setEditingEmployee({ ...editingEmployee, name: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder={lang === 'th' ? 'เช่น สมศักดิ์' : 'e.g. Somsak'}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.finance.role}
                </label>
                <input
                  type="text"
                  required
                  value={editingEmployee.role || ''}
                  onChange={(e) => setEditingEmployee({ ...editingEmployee, role: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder={lang === 'th' ? 'เช่น หัวหน้าเชฟ, พนักงานเสิร์ฟ' : 'e.g. Head Chef, Waiter'}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.finance.wageType}
                  </label>
                  <select
                    value={editingEmployee.wageType || 'monthly'}
                    onChange={(e) => {
                      const nextType = e.target.value as WageType;
                      setEditingEmployee({
                        ...editingEmployee,
                        wageType: nextType,
                        workDaysOrHoursPerMonth: nextType === 'hourly' ? 208 : 26,
                      });
                    }}
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  >
                    <option value="monthly">{t.finance.monthly}</option>
                    <option value="daily">{t.finance.daily}</option>
                    <option value="hourly">{t.finance.hourly}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.finance.wageAmount}
                  </label>
                  <NumericInput
                    min={0}
                    step={10}
                    value={editingEmployee.wageAmount}
                    onValueChange={(val) =>
                      setEditingEmployee({ ...editingEmployee, wageAmount: val })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
                  />
                </div>
              </div>

              {(editingEmployee.wageType === 'hourly' || editingEmployee.wageType === 'daily') && (
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {editingEmployee.wageType === 'hourly'
                      ? lang === 'th' ? 'ชั่วโมงทำงานต่อเดือน' : 'Hours per Month'
                      : lang === 'th' ? 'วันทำงานต่อเดือน' : 'Work Days per Month'}
                  </label>
                  <NumericInput
                    min={1}
                    max={744}
                    value={editingEmployee.workDaysOrHoursPerMonth ?? (editingEmployee.wageType === 'hourly' ? 208 : 26)}
                    onValueChange={(val) =>
                      setEditingEmployee({ ...editingEmployee, workDaysOrHoursPerMonth: Math.max(1, val) })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
                  />
                </div>
              )}
            </div>

            <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEmployeeModalOpen(false)}
                className="px-3 py-1.5 bg-white text-neutral-700 border border-neutral-300 rounded-xl text-xs font-bold cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
              >
                {t.common.save}
              </button>
            </div>
          </form>
        </div>
      )}
      <ConfirmModal
        isOpen={Boolean(pendingDelete)}
        title={
          pendingDelete?.collection === 'expenses'
            ? lang === 'th'
              ? 'ยืนยันการลบรายการค่าใช้จ่าย'
              : 'Delete Expense'
            : lang === 'th'
            ? 'ยืนยันการลบข้อมูลพนักงาน'
            : 'Delete Employee'
        }
        message={
          lang === 'th'
            ? `ต้องการลบ "${pendingDelete?.label || ''}" ใช่หรือไม่?`
            : `Delete "${pendingDelete?.label || ''}"?`
        }
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        isLoading={isDeleting}
        onCancel={() => {
          if (!isDeleting) setPendingDelete(null);
        }}
        onConfirm={async () => {
          if (!pendingDelete) return;
          setIsDeleting(true);
          try {
            await deleteDocument(pendingDelete.collection, pendingDelete.id);
            setPendingDelete(null);
            loadData();
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </div>
  );
};
