import React, { useState } from 'react';
import { Plus, Receipt, Trash2, Calendar, DollarSign, Filter, EyeOff, Eye, Check, AlertTriangle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { ExpenseRecord, ExpenseCategory, ExpenseFrequency } from '../../types/domain';
import { NumericInput } from '../common/NumericInput';
import { convertExpenseToMonthly, calculateTotalMonthlyExpenses, validateExpenseInput } from '../../engine/calculations';
import { isExplicitPayrollExpense } from '../../../engine/calculations';
import { useLanguage } from '../../../contexts/LanguageContext';

interface ExpensesViewProps {
  expenses: ExpenseRecord[];
  onAddExpense: (expense: ExpenseRecord) => void;
  onDeleteExpense: (id: string) => void;
  onUpdateExpense?: (expense: ExpenseRecord) => void;
  operatingDays?: number;
  activeLanguage?: 'th' | 'en';
  employeesCount?: number;
  excludePayrollDuplicates?: boolean;
  onToggleExcludePayrollDuplicates?: (exclude: boolean) => void;
}

export const ExpensesView: React.FC<ExpensesViewProps> = ({
  expenses,
  onAddExpense,
  onDeleteExpense,
  onUpdateExpense,
  operatingDays = 26,
  activeLanguage: propActiveLanguage,
  employeesCount = 0,
  excludePayrollDuplicates = true,
  onToggleExcludePayrollDuplicates,
}) => {
  const { lang: ctxLang } = useLanguage();
  const activeLanguage = propActiveLanguage ?? ctxLang;
  const isTh = activeLanguage === 'th';
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [isGuidanceOpen, setIsGuidanceOpen] = useState(false);

  const [formData, setFormData] = useState<{
    date: string;
    endDate: string;
    category: ExpenseCategory;
    description: string;
    amount: number;
    frequency: ExpenseFrequency;
    isFixed: boolean;
    isPayroll: boolean;
    isExcluded: boolean;
    paymentMethod: 'Cash' | 'Bank Transfer' | 'Credit Card' | 'PromptPay' | string;
    isAsset: boolean;
    isInstallment: boolean;
    monthlyInstallment: number;
    assetCost: number;
    usefulLifeYears: number;
    notes: string;
  }>({
    date: new Date().toISOString().split('T')[0],
    endDate: '',
    category: 'Electricity',
    description: '',
    amount: 1000,
    frequency: 'monthly',
    isFixed: true,
    isPayroll: false,
    isExcluded: false,
    paymentMethod: 'Bank Transfer',
    isAsset: false,
    isInstallment: false,
    monthlyInstallment: 0,
    assetCost: 0,
    usefulLifeYears: 5,
    notes: '',
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  const categories: ExpenseCategory[] = [
    'Rent',
    'Electricity',
    'Water',
    'Gas (LPG)',
    'Internet & Telephone',
    'Labor (Salary & Wages)',
    'Marketing & Ads',
    'Cleaning & Sanitation',
    'Repair & Maintenance',
    'POS & Software Subscriptions',
    'Licenses & Permits',
    'Insurance',
    'Depreciation',
    'Other Operating Expenses',
  ];

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    if (!formData.description.trim()) return;

    const validation = validateExpenseInput({
      amount: formData.amount,
      assetCost: formData.assetCost,
      usefulLifeYears: formData.usefulLifeYears,
      isAsset: formData.isAsset,
      isInstallment: formData.isInstallment,
    });
    if (!validation.isValid) {
      setValidationError(
        (isTh ? validation.errorMessageTh : validation.errorMessageEn) ||
          (isTh ? 'ข้อมูลไม่ถูกต้อง' : 'Invalid input')
      );
      return;
    }

    let finalAmount = formData.amount;
    if (formData.isAsset) {
      if (formData.isInstallment) {
        finalAmount = formData.monthlyInstallment;
      } else if (formData.assetCost > 0 && formData.usefulLifeYears > 0) {
        finalAmount = formData.assetCost / (formData.usefulLifeYears * 12);
      }
    }

    const newExpense: ExpenseRecord = {
      id: `exp-${Date.now()}`,
      date: formData.date,
      endDate: formData.isFixed && formData.endDate ? formData.endDate : undefined,
      category: formData.category,
      description: formData.description,
      amount: finalAmount,
      frequency: formData.isAsset ? 'monthly' : formData.frequency,
      isFixed: formData.isFixed,
      isPayroll: formData.isPayroll,
      isExcluded: formData.isExcluded,
      paymentMethod: formData.paymentMethod,
      recurring: formData.isFixed,
      isInstallment: formData.isAsset ? formData.isInstallment : undefined,
      monthlyInstallment: formData.isAsset && formData.isInstallment ? formData.monthlyInstallment : undefined,
      assetCost: formData.isAsset && !formData.isInstallment ? formData.assetCost : undefined,
      usefulLifeYears: formData.isAsset && !formData.isInstallment ? formData.usefulLifeYears : undefined,
      operatingDaysPerMonth: operatingDays,
      notes: formData.notes,
    };

    onAddExpense(newExpense);
    setIsModalOpen(false);
  };

  const handleToggleExclude = (exp: ExpenseRecord) => {
    if (onUpdateExpense) {
      onUpdateExpense({ ...exp, isExcluded: !exp.isExcluded });
    }
  };

  const monthlyTotals = calculateTotalMonthlyExpenses(expenses, operatingDays);

  const filteredExpenses = selectedCategory === 'ALL'
    ? expenses
    : expenses.filter((e) => e.category === selectedCategory);

  const payrollFlaggedExpenses = expenses.filter(
    (e) => !e.isExcluded && isExplicitPayrollExpense(e)
  );
  const hasPayrollConflict = employeesCount > 0 && payrollFlaggedExpenses.length > 0;

  const hasOwnerSalary = expenses.some((e) => {
    if (e.isExcluded) return false;
    const desc = (e.description || '').toLowerCase();
    const isOwnerDesc = desc.includes('เจ้าของ') || desc.includes('owner') || desc.includes('ผู้จัดการ/เจ้าของ');
    return isOwnerDesc && Number(e.amount) > 0;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <span>{activeLanguage === 'th' ? 'บันทึกค่าใช้จ่ายดำเนินงาน (Operating Expenses)' : 'Operating Expenses'}</span>
        </h1>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-xs cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>{activeLanguage === 'th' ? 'เพิ่มค่าใช้จ่าย' : 'Add Expense'}</span>
        </button>
      </div>

      {/* Warning: Explicit Payroll Overlap with Employees (No silent keyword removal) */}
      {hasPayrollConflict && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">
                {activeLanguage === 'th'
                  ? `พบรายจ่ายที่ตั้งค่าเป็นเงินเดือน/ค่าแรง (${payrollFlaggedExpenses.length} รายการ) ซ้อนกับข้อมูลพนักงาน (${employeesCount} คน)`
                  : `Detected ${payrollFlaggedExpenses.length} payroll expense(s) alongside Staff payroll (${employeesCount} staff)`}
              </div>
              <p className="text-amber-800 mt-0.5">
                {excludePayrollDuplicates
                  ? activeLanguage === 'th'
                    ? 'สถานะปัจจุบัน: งดนับรายจ่ายกลุ่มนี้ใน P&L และจุดคุ้มทุน เพื่อป้องกันการนับซ้ำ (เลือกเปลี่ยนได้)'
                    : 'Current mode: Excluding these payroll expense lines from P&L/Break-Even to avoid double counting.'
                  : activeLanguage === 'th'
                  ? 'สถานะปัจจุบัน: กำลังนับรวมรายจ่ายกลุ่มนี้เพิ่มจากค่าแรงพนักงาน (อาจเกิดการนับซ้ำ)'
                  : 'Current mode: Including both payroll expense lines and employee salaries.'}
              </p>
            </div>
          </div>
          {onToggleExcludePayrollDuplicates && (
            <button
              type="button"
              onClick={() => onToggleExcludePayrollDuplicates(!excludePayrollDuplicates)}
              className="px-3 py-1.5 rounded-lg border border-amber-400 bg-white hover:bg-amber-100 text-xs font-bold text-amber-900 shrink-0 cursor-pointer"
            >
              {excludePayrollDuplicates
                ? activeLanguage === 'th'
                  ? 'เปลี่ยนเป็นนับรวมด้วย'
                  : 'Include in Calculations'
                : activeLanguage === 'th'
                ? 'งดนับซ้ำกับเงินเดือนพนักงาน'
                : 'Exclude Duplicate Payroll'}
            </button>
          )}
        </div>
      )}

      {/* Warning: Owner Salary Check (O15) */}
      {!hasOwnerSalary && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-xs flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <div className="font-bold text-amber-950 flex items-center gap-1.5">
              <span>
                {isTh
                  ? 'คำเตือน: ยังไม่ได้ใส่อัตราเงินเดือนเจ้าของร้าน (Owner Salary)'
                  : 'Warning: Owner Salary Not Included'}
              </span>
              <span className="text-[10px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-semibold">
                {isTh ? 'แนะนำอย่างยิ่ง' : 'Strongly Recommended'}
              </span>
            </div>
            <p className="text-amber-800 leading-relaxed">
              {isTh ? (
                <>
                  ในหลักการคิดต้นทุนร้านอาหาร SME หากไม่รวมเงินเดือนประจำของเจ้าของร้านลงในต้นทุนคงที่ (Fixed Labor) จะทำให้คำนวณอัตราโสหุ้ย (% Overhead) ต่ำกว่าความเป็นจริง ส่งผลให้ตั้งราคาอาหารต่ำเกินไปและเกิดภาวะขาดทุนแฝง แนะนำให้เพิ่มรายการ เช่น <span className="font-bold underline decoration-amber-400">"เงินเดือนเจ้าของร้าน"</span> ในหมวด "Labor (Salary & Wages)"
                </>
              ) : (
                <>
                  For accurate SME restaurant costing, including a regular owner salary in Fixed Labor prevents understating your Overhead % and underpricing dishes. Consider adding <span className="font-bold underline decoration-amber-400">"Owner Salary"</span> under "Labor (Salary & Wages)".
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Educational Guidance: 10 Items NOT to count as Overhead (E9) */}
      <div className="rounded-xl border border-sky-200 bg-sky-50/70 shadow-xs overflow-hidden">
        <button
          type="button"
          onClick={() => setIsGuidanceOpen(!isGuidanceOpen)}
          className="w-full flex items-center justify-between p-3.5 text-left text-xs font-bold text-sky-950 hover:bg-sky-100/60 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-sky-600 shrink-0" />
            <span>
              {isTh
                ? 'ข้อควรระวัง: 10 รายการที่ไม่ควรนำมาคิดเป็นค่าโสหุ้ย (What NOT to count as Overhead)'
                : 'Guidance: 10 Items NOT to Count as Operating Overhead'}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[11px] font-medium text-sky-700">
            <span>
              {isGuidanceOpen
                ? isTh
                  ? 'ซ่อนคำแนะนำ'
                  : 'Hide Guide'
                : isTh
                ? 'ดูรายการที่ไม่ควรใส่'
                : 'View Checklist'}
            </span>
            {isGuidanceOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </button>

        {isGuidanceOpen && (
          <div className="p-4 pt-1 border-t border-sky-100 text-xs text-sky-900 bg-white/60 space-y-2">
            <p className="text-slate-600 mb-2">
              {isTh ? (
                <>
                  การกรอกค่าใช้จ่ายซ้ำซ้อนจะทำให้ต้นทุนโสหุ้ยสูงเกินจริงจนตั้งราคาอาหารไม่ได้ รายการต่อไปนี้<strong>ห้ามใส่ในตารางโสหุ้ย</strong>:
                </>
              ) : (
                <>
                  Double-counting costs inflates your overhead % and distorts menu pricing. <strong>Do NOT add</strong> the following 10 items here:
                </>
              )}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <div className="p-2.5 bg-white rounded-lg border border-sky-100">
                <div className="font-bold text-slate-800">
                  {isTh ? '1. วัตถุดิบอาหารและเครื่องดื่มหลัก (F&B Direct Cost)' : '1. Direct Food & Beverage Ingredients'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isTh
                    ? 'เป็น Direct COGS ที่คำนวณในสูตรอาหาร (Recipe) แล้ว ห้ามใส่ซ้ำในโสหุ้ย'
                    : 'Already counted as Direct COGS inside menu recipes.'}
                </div>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-sky-100">
                <div className="font-bold text-slate-800">
                  {isTh ? '2. บรรจุภัณฑ์ใส่อาหารต่อจาน (Direct Packaging)' : '2. Per-Order Direct Packaging'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isTh
                    ? 'กล่องข้าว ช้อนส้อม ถุงหิ้ว ให้คิดเป็นต้นทุนตรงต่อจานในเมนูสั่งกลับบ้าน/เดลิเวอรี'
                    : 'Containers, cutlery, and bags should be costed directly per takeaway/delivery dish.'}
                </div>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-sky-100">
                <div className="font-bold text-slate-800">
                  {isTh ? '3. ค่าคอมมิชชั่น GP เดลิเวอรี (Platform Commission)' : '3. Delivery Platform Commissions (GP)'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isTh
                    ? 'เป็นส่วนลดจากยอดขายหน้าแอป (Platform Deduction) ให้คำนวณแยกตามช่องทางขาย'
                    : 'Tracked as channel deductions per delivery platform.'}
                </div>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-sky-100">
                <div className="font-bold text-slate-800">
                  {isTh ? '4. ภาษีมูลค่าเพิ่ม (VAT ซื้อ / VAT ขาย)' : '4. Value Added Tax (Input / Output VAT)'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isTh
                    ? 'ไม่ใช่ต้นทุนของร้าน เป็นเงินหมุนเวียนนำส่งสรรพากร ยอดขายต้องใช้แบบ Ex-VAT'
                    : 'Pass-through tax remitted to authorities, not a store operating cost.'}
                </div>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-sky-100">
                <div className="font-bold text-slate-800">
                  {isTh ? '5. เงินมัดจำ/เงินประกันสัญญาเช่า (Security Deposits)' : '5. Lease Security Deposits'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isTh
                    ? 'เป็นสินทรัพย์ (Asset) ที่ได้คืนเมื่อสิ้นสุดสัญญา ไม่ใช่ค่าใช้จ่ายดำเนินงาน'
                    : 'Refundable balance-sheet asset, not an operating expense.'}
                </div>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-sky-100">
                <div className="font-bold text-slate-800">
                  {isTh ? '6. เงินลงทุนตกแต่งก้อนแรกก่อนเปิดร้าน (CapEx / Initial Fitout)' : '6. Initial Store CapEx / Renovation Fitout'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isTh
                    ? 'ให้ใส่เฉพาะ "ค่าเสื่อมราคา (Depreciation)" ตามอายุใช้งาน ไม่ใช่ใส่เงินก้อนใหญ่ทั้งก้อน'
                    : 'Record only monthly Depreciation over useful life rather than lump-sum CapEx.'}
                </div>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-sky-100">
                <div className="font-bold text-slate-800">
                  {isTh ? '7. เงินต้นที่ชำระคืนเงินกู้ธนาคาร (Loan Principal)' : '7. Bank Loan Principal Repayments'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isTh
                    ? 'การผ่อนเงินต้นเป็นการลดหนี้สิน ไม่ใช่ค่าใช้จ่าย (คิดได้เฉพาะดอกเบี้ยเงินกู้หรือค่างวดเครื่องจักร)'
                    : 'Debt principal reduction is not an expense (only interest or equipment lease applies).'}
                </div>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-sky-100">
                <div className="font-bold text-slate-800">
                  {isTh ? "8. เงินถอนส่วนตัวของเจ้าของ (Owner's Drawings)" : "8. Owner's Personal Drawings"}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isTh
                    ? 'การเบิกถอนเงินสดไปใช้ส่วนตัวไม่ถือเป็นต้นทุนร้าน (ต้องแยกจากเงินเดือนประจำ)'
                    : 'Personal cash withdrawals are equity distributions, distinct from owner salary.'}
                </div>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-sky-100">
                <div className="font-bold text-slate-800">
                  {isTh ? '9. ภาษีเงินได้นิติบุคคลหรือบุคคลธรรมดาสิ้นปี (Income Tax)' : '9. Corporate / Personal Income Tax'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isTh
                    ? 'คิดจากกำไรสุทธิหลังหักค่าใช้จ่ายทั้งหมดแล้ว ไม่ใช่ต้นทุนดำเนินงานของร้าน'
                    : 'Calculated below Operating Profit in P&L, not an operating overhead.'}
                </div>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-sky-100">
                <div className="font-bold text-slate-800">
                  {isTh ? '10. Service Charge ที่แบ่งจ่ายพนักงาน (Distributed Service Charge)' : '10. Staff-Distributed Service Charge'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isTh
                    ? 'เป็นเงินที่เรียกเก็บแทนพนักงานและส่งต่อทั้งหมด ไม่ใช่ค่าใช้จ่ายดำเนินงานของร้าน'
                    : 'Collected on behalf of staff and passed through separately.'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* KPI Cards (Normalized Monthly) */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">
            {isTh ? 'ค่าใช้จ่ายรายเดือนรวม (Monthly)' : 'Total Monthly OPEX'}
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900 font-mono">
            ฿{Math.round(monthlyTotals.totalMonthly).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {expenses.filter(e => !e.isExcluded).length}{' '}
            {isTh ? 'รายการ (นับคำนวณ)' : 'items (included)'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">
            {isTh ? 'ต้นทุนคงที่รายเดือน (Fixed)' : 'Monthly Fixed Costs'}
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-800 font-mono">
            ฿{Math.round(monthlyTotals.fixedMonthly).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {isTh ? 'ค่าเช่า, ซอฟต์แวร์, ค่าเสื่อม' : 'Rent, Software, Depreciation'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">
            {isTh ? 'ต้นทุนผันแปรรายเดือน (Variable)' : 'Monthly Variable Costs'}
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-800 font-mono">
            ฿{Math.round(monthlyTotals.variableMonthly).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {isTh ? 'ค่าน้ำ, ค่าไฟ, แก๊ส' : 'Water, Electricity, Gas'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">
            {isTh ? 'รายการที่ยกเว้น (Excluded)' : 'Excluded Items'}
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-400 font-mono">
            ฿{Math.round(monthlyTotals.excludedMonthly).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {expenses.filter(e => e.isExcluded).length}{' '}
            {isTh ? 'รายการ (ไม่นำมาคิดต้นทุน)' : 'items (excluded)'}
          </div>
        </div>
      </div>

      {/* Filter and Table */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Receipt className="h-4 w-4 text-slate-600" />
            <span>{isTh ? 'รายการค่าใช้จ่ายทั้งหมด' : 'All Operating Expenses'}</span>
          </h2>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs bg-white"
          >
            <option value="ALL">{isTh ? 'ทุกหมวดหมู่' : 'All Categories'}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                <th className="py-2.5 px-3">{isTh ? 'วันที่' : 'Date'}</th>
                <th className="py-2.5 px-3">{isTh ? 'หมวดหมู่' : 'Category'}</th>
                <th className="py-2.5 px-3">{isTh ? 'รายการ' : 'Item'}</th>
                <th className="py-2.5 px-3 text-center">{isTh ? 'ความถี่' : 'Frequency'}</th>
                <th className="py-2.5 px-3 text-center">{isTh ? 'ประเภท' : 'Type'}</th>
                <th className="py-2.5 px-3 text-right">{isTh ? 'จำนวนเดิม (฿)' : 'Original Amount (฿)'}</th>
                <th className="py-2.5 px-3 text-right">{isTh ? 'แปลงรายเดือน (฿/เดือน)' : 'Monthly Equiv. (฿/mo)'}</th>
                <th className="py-2.5 px-3 text-center">{isTh ? 'สถานะ' : 'Status'}</th>
                <th className="py-2.5 px-3 text-center">{isTh ? 'จัดการ' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredExpenses.map((exp) => {
                const monthlyAmt = convertExpenseToMonthly(exp, operatingDays);
                const isExcluded = Boolean(exp.isExcluded);

                return (
                  <tr key={exp.id} className={`hover:bg-slate-50/60 ${isExcluded ? 'opacity-60 bg-slate-50/40' : ''}`}>
                    <td className="py-2.5 px-3 font-mono font-medium">
                      <div>{exp.date}</div>
                      {exp.endDate && (
                        <div className="text-[10px] text-slate-400">→ {exp.endDate}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">{exp.category}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                      <span className={isExcluded ? 'line-through text-slate-400' : ''}>{exp.description}</span>
                      {isExplicitPayrollExpense(exp) && (
                        <span className="ml-1.5 text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded font-semibold">
                          {isTh ? 'เงินเดือน' : 'Payroll'}
                        </span>
                      )}
                      {exp.isInstallment && (
                        <span className="ml-1.5 text-[10px] bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded font-medium">
                          {isTh ? 'ผ่อนชำระ' : 'Installment'}
                        </span>
                      )}
                      {exp.assetCost && !exp.isInstallment && (
                        <span className="ml-1.5 text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded font-medium">
                          {isTh ? `ค่าเสื่อม ${exp.usefulLifeYears}ปี` : `Depr. ${exp.usefulLifeYears}yr`}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="text-[11px] font-mono text-slate-600">
                        {exp.frequency || 'monthly'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                        exp.isFixed ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-800'
                      }`}>
                        {exp.isFixed
                          ? isTh
                            ? 'คงที่ (Fixed)'
                            : 'Fixed Cost'
                          : isTh
                          ? 'ผันแปร (Variable)'
                          : 'Variable Cost'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                      ฿{Number(exp.amount).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                      {isExcluded ? (
                        <span className="text-slate-400 line-through">฿{Math.round(convertExpenseToMonthly({ ...exp, isExcluded: false }, operatingDays)).toLocaleString()}</span>
                      ) : (
                        `฿${Math.round(monthlyAmt).toLocaleString()}`
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {onUpdateExpense ? (
                        <button
                          type="button"
                          onClick={() => handleToggleExclude(exp)}
                          title={
                            isExcluded
                              ? isTh
                                ? 'คลิกเพื่อรวมในต้นทุน'
                                : 'Click to include in costing'
                              : isTh
                              ? 'คลิกเพื่อยกเว้นจากต้นทุน'
                              : 'Click to exclude from costing'
                          }
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer ${
                            isExcluded
                              ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {isExcluded
                            ? isTh
                              ? 'ยกเว้น (Excluded)'
                              : 'Excluded'
                            : isTh
                            ? 'ใช้งาน (Included)'
                            : 'Included'}
                        </button>
                      ) : (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          isExcluded ? 'bg-rose-100 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                        }`}>
                          {isExcluded ? (isTh ? 'ยกเว้น' : 'Excluded') : isTh ? 'ใช้งาน' : 'Included'}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => onDeleteExpense(exp.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                        title={isTh ? 'ลบรายการ' : 'Delete Record'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h2 className="text-base font-bold text-slate-900">
                {isTh ? 'เพิ่มค่าใช้จ่ายดำเนินงาน' : 'Add Operating Expense'}
              </h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5">
              {validationError && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
                  {validationError}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isTh ? 'วันที่' : 'Date'}
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isTh ? 'หมวดหมู่' : 'Category'}
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => {
                      const nextCat = e.target.value as ExpenseCategory;
                      setFormData({
                        ...formData,
                        category: nextCat,
                        isPayroll: nextCat === 'Labor (Salary & Wages)',
                      });
                    }}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs bg-white"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {isTh ? 'ชื่อรายการค่าใช้จ่าย *' : 'Expense Item Name *'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={
                    isTh
                      ? 'เช่น ค่าเช่าพื้นที่ประจำเดือน หรือ เครื่องชงกาแฟ'
                      : 'e.g. Monthly Store Rent or Espresso Machine'
                  }
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                />
              </div>

              {/* Asset Toggle */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isAsset}
                    onChange={(e) => setFormData({ ...formData, isAsset: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-xs font-semibold text-slate-800">
                    {isTh
                      ? 'เป็นสินทรัพย์ถาวร / เครื่องจักร (Asset Depreciation or Installment)'
                      : 'Fixed Asset / Equipment (Depreciation or Installment)'}
                  </span>
                </label>

                {formData.isAsset && (
                  <div className="pt-2 border-t border-slate-200 space-y-3">
                    <div className="flex gap-4 text-xs">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="assetPaymentType"
                          checked={!formData.isInstallment}
                          onChange={() => setFormData({ ...formData, isInstallment: false })}
                        />
                        <span>
                          {isTh ? 'คิดค่าเสื่อมราคาเส้นตรง (Straight-Line)' : 'Straight-Line Depreciation'}
                        </span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="assetPaymentType"
                          checked={formData.isInstallment}
                          onChange={() => setFormData({ ...formData, isInstallment: true })}
                        />
                        <span>
                          {isTh ? 'ผ่อนชำระรายงวด (Monthly Installment)' : 'Monthly Installment'}
                        </span>
                      </label>
                    </div>

                    {formData.isInstallment ? (
                      <div>
                        <label className="block text-xs text-slate-700 mb-1">
                          {isTh ? 'ค่างวดผ่อนต่อเดือน (฿/เดือน)' : 'Monthly Installment (฿/mo)'}
                        </label>
                        <NumericInput
                          type="number"
                          step="any"
                          min="0"
                          value={formData.monthlyInstallment}
                          onChange={(e) => setFormData({ ...formData, monthlyInstallment: parseFloat(e.target.value) || 0 })}
                          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono font-bold"
                        />
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {isTh
                            ? 'ใช้ค่างวดแทนค่าเสื่อมราคา (ไม่คิดซ้ำซ้อน)'
                            : 'Uses installment instead of depreciation (avoids double counting)'}
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-slate-700 mb-1">
                            {isTh ? 'มูลค่าทรัพย์สิน (฿)' : 'Asset Cost (฿)'}
                          </label>
                          <NumericInput
                            type="number"
                            step="any"
                            min="0"
                            value={formData.assetCost}
                            onChange={(e) => setFormData({ ...formData, assetCost: parseFloat(e.target.value) || 0 })}
                            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-700 mb-1">
                            {isTh ? 'อายุการใช้งาน (ปี)' : 'Useful Life (Years)'}
                          </label>
                          <NumericInput
                            type="number"
                            min="1"
                            max="50"
                            value={formData.usefulLifeYears}
                            onValueChange={(val) => setFormData({ ...formData, usefulLifeYears: Math.round(val) })}
                            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono"
                          />
                        </div>
                        {formData.assetCost > 0 && formData.usefulLifeYears > 0 && (
                          <div className="col-span-2 text-xs text-emerald-700 font-medium">
                            {isTh
                              ? `ค่าเสื่อมราคาต่อเดือน: ฿${(formData.assetCost / (formData.usefulLifeYears * 12)).toFixed(2)} / เดือน`
                              : `Monthly Depreciation: ฿${(formData.assetCost / (formData.usefulLifeYears * 12)).toFixed(2)} / month`}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {!formData.isAsset && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {isTh ? 'จำนวนเงิน (฿) *' : 'Amount (฿) *'}
                    </label>
                    <NumericInput
                      type="number"
                      step="any"
                      required
                      min="0"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {isTh ? 'ความถี่ (Frequency)' : 'Frequency'}
                    </label>
                    <select
                      value={formData.frequency}
                      onChange={(e) => setFormData({ ...formData, frequency: e.target.value as ExpenseFrequency })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs bg-white"
                    >
                      <option value="monthly">{isTh ? 'รายเดือน (Monthly)' : 'Monthly'}</option>
                      <option value="weekly">
                        {isTh ? 'รายสัปดาห์ (Weekly: x 52 ÷ 12)' : 'Weekly (× 52 ÷ 12)'}
                      </option>
                      <option value="daily">
                        {isTh ? `รายวัน (Daily: x ${operatingDays} วัน)` : `Daily (× ${operatingDays} days)`}
                      </option>
                      <option value="quarterly">
                        {isTh ? 'รายไตรมาส (Quarterly: ÷ 3)' : 'Quarterly (÷ 3)'}
                      </option>
                      <option value="yearly">
                        {isTh ? 'รายปี (Yearly: ÷ 12)' : 'Yearly (÷ 12)'}
                      </option>
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isTh ? 'ลักษณะต้นทุน' : 'Cost Behavior'}
                  </label>
                  <select
                    value={formData.isFixed ? 'fixed' : 'variable'}
                    onChange={(e) => setFormData({ ...formData, isFixed: e.target.value === 'fixed' })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs bg-white"
                  >
                    <option value="fixed">{isTh ? 'Fixed Cost (คงที่)' : 'Fixed Cost'}</option>
                    <option value="variable">{isTh ? 'Variable Cost (ผันแปร)' : 'Variable Cost'}</option>
                  </select>
                </div>
                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.isExcluded}
                      onChange={(e) => setFormData({ ...formData, isExcluded: e.target.checked })}
                      className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                    />
                    <span className="text-xs text-slate-700 font-medium">
                      {isTh ? 'ยกเว้นไม่นำมาคิดต้นทุน' : 'Exclude from costing'}
                    </span>
                  </label>
                </div>
              </div>

              <div className="p-2.5 bg-indigo-50/70 rounded-xl border border-indigo-200/80">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isPayroll}
                    onChange={(e) => setFormData({ ...formData, isPayroll: e.target.checked })}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-indigo-950 font-semibold">
                    {isTh
                      ? 'เป็นรายการเงินเดือน/ค่าแรงพนักงาน (Payroll) — ไม่รวมค่าแรงช่างซ่อมหรือจ้างเหมาภายนอก'
                      : 'Staff Payroll / Wages item (uncheck for external contractor fees)'}
                  </span>
                </label>
              </div>

              {formData.isFixed && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isTh ? 'วันที่สิ้นสุด (ถ้ามี)' : 'End Date (Optional)'}
                  </label>
                  <input
                    type="date"
                    value={formData.endDate}
                    min={formData.date}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  {isTh ? 'ยกเลิก' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-5 py-2 text-xs font-bold text-white cursor-pointer"
                >
                  {isTh ? 'บันทึกค่าใช้จ่าย' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
