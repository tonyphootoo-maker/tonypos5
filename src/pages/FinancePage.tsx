import React, { useState, useEffect } from 'react';
import {
  ExpenseDoc,
  EmployeeDoc,
  WageType,
  SettingsDoc,
  Language,
} from '../types';
import { translations } from '../i18n/translations';
import {
  formatMoney,
  calculateEmployeeMonthlyCost,
  calculateBreakEven,
  roundTo2,
  formatPercent,
} from '../engine/calculations';
import { fetchCollection, saveDocument, deleteDocument } from '../data/db';
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
} from 'lucide-react';

interface Props {
  settings: SettingsDoc;
  lang: Language;
}

type TabType = 'expenses' | 'labor' | 'breakeven';

export const FinancePage: React.FC<Props> = ({ settings, lang }) => {
  const t = translations[lang];
  const [activeTab, setActiveTab] = useState<TabType>('expenses');

  const [expenses, setExpenses] = useState<ExpenseDoc[]>([]);
  const [employees, setEmployees] = useState<EmployeeDoc[]>([]);

  // Modals state
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Partial<ExpenseDoc> | null>(null);

  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Partial<EmployeeDoc> | null>(null);

  // Break-even target margin input
  const [customContributionMargin, setCustomContributionMargin] = useState<number>(65); // 65% default contribution margin

  const loadData = async () => {
    const [exps, emps] = await Promise.all([
      fetchCollection<ExpenseDoc>('expenses'),
      fetchCollection<EmployeeDoc>('employees'),
    ]);
    setExpenses(exps);
    setEmployees(emps);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Compute total monthly fixed expenses
  const totalMonthlyFixedExpenses = roundTo2(
    expenses
      .filter((e) => e.isFixed || e.isRecurring)
      .reduce((sum, e) => sum + e.amount, 0)
  );

  // Compute total monthly labor
  const totalMonthlyLabor = roundTo2(
    employees.reduce((sum, emp) => sum + calculateEmployeeMonthlyCost(emp), 0)
  );

  // Break-even calculation
  const breakEven = calculateBreakEven(
    totalMonthlyFixedExpenses,
    totalMonthlyLabor,
    customContributionMargin
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
      titleTh: editingExpense.titleTh || undefined,
      category: editingExpense.category || 'other',
      amount: editingExpense.amount || 0,
      date: editingExpense.date || new Date().toISOString().split('T')[0],
      isFixed: editingExpense.isFixed ?? true,
      isRecurring: editingExpense.isRecurring ?? true,
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
    const empToSave: EmployeeDoc = {
      id: editingEmployee.id || `emp_${Date.now()}`,
      name: editingEmployee.name,
      role: editingEmployee.role || 'Staff',
      wageType: editingEmployee.wageType || 'monthly',
      wageAmount: editingEmployee.wageAmount || 0,
      workDaysOrHoursPerMonth: editingEmployee.workDaysOrHoursPerMonth || 26,
      phone: editingEmployee.phone || undefined,
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
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight flex items-center gap-2">
            <CircleDollarSign className="w-6 h-6 text-emerald-600" />
            <span>{t.finance.title}</span>
          </h2>
          <p className="text-xs text-neutral-500">
            Track fixed overhead, recurring utilities, staff wages, and calculate restaurant break-even targets.
          </p>
        </div>
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

      {/* TAB: EXPENSES */}
      {activeTab === 'expenses' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="text-xs text-neutral-600">
              Total Monthly Fixed Overhead: <strong className="text-emerald-700 font-extrabold">฿{formatMoney(totalMonthlyFixedExpenses)}</strong>
            </div>
            <button
              onClick={() => {
                setEditingExpense({
                  title: '',
                  category: 'rent',
                  amount: 15000,
                  isFixed: true,
                  isRecurring: true,
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
                  <div className="flex justify-between items-start">
                    <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-700">
                      {exp.category}
                    </span>
                    {exp.isRecurring && (
                      <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                        Monthly
                      </span>
                    )}
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
                      onClick={async () => {
                        if (confirm(`Delete expense ${exp.title}?`)) {
                          await deleteDocument('expenses', exp.id);
                          loadData();
                        }
                      }}
                      className="p-1 text-neutral-400 hover:text-rose-600 cursor-pointer"
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
              Total Monthly Labor Cost: <strong className="text-emerald-700 font-extrabold">฿{formatMoney(totalMonthlyLabor)}</strong>
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
              const monthlyCost = calculateEmployeeMonthlyCost(emp);
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
                        <span>Wage Type:</span>
                        <span className="font-bold capitalize">{emp.wageType}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Wage Rate:</span>
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
                      onClick={async () => {
                        if (confirm(`Delete employee ${emp.name}?`)) {
                          await deleteDocument('employees', emp.id);
                          loadData();
                        }
                      }}
                      className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
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
          <div>
            <h3 className="font-black text-base text-neutral-900 flex items-center gap-2">
              <Calculator className="w-5 h-5 text-orange-600" />
              <span>{t.finance.tabBreakEven}</span>
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5">{t.finance.breakEvenFormulaNote}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 p-3 bg-neutral-50 rounded-2xl text-xs">
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
          </div>

          {/* Contribution margin parameter */}
          <div>
            <div className="flex justify-between items-center text-xs font-bold text-neutral-700 mb-1">
              <span>{t.finance.avgContributionMargin}:</span>
              <span className="text-orange-600 text-sm font-black">{customContributionMargin}%</span>
            </div>
            <input
              type="range"
              min={20}
              max={90}
              value={customContributionMargin}
              onChange={(e) => setCustomContributionMargin(parseInt(e.target.value, 10))}
              className="w-full accent-orange-600 cursor-pointer"
            />
          </div>

          {/* Results Display */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="p-4 bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 rounded-2xl text-center">
              <div className="text-xs font-bold text-orange-800">{t.finance.breakEvenMonthlyRevenue}</div>
              <div className="text-xl font-black text-neutral-900 mt-1">
                ฿{formatMoney(breakEven.monthlyBreakEvenSales)}
              </div>
            </div>

            <div className="p-4 bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl text-center">
              <div className="text-xs font-bold text-emerald-800">{t.finance.breakEvenDailyRevenue}</div>
              <div className="text-xl font-black text-emerald-900 mt-1">
                ฿{formatMoney(breakEven.dailyBreakEvenSales)}
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
            className="bg-white rounded-3xl shadow-2xl max-w-sm w-full border border-orange-200 overflow-hidden"
          >
            <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">{t.finance.addExpense}</h3>
              <button
                type="button"
                onClick={() => setIsExpenseModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
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
                  placeholder="e.g. November Rent"
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
                <input
                  type="number"
                  min={0}
                  step={10}
                  required
                  value={editingExpense.amount || 0}
                  onChange={(e) => setEditingExpense({ ...editingExpense, amount: parseFloat(e.target.value) || 0 })}
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
            </div>

            <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
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
            className="bg-white rounded-3xl shadow-2xl max-w-sm w-full border border-orange-200 overflow-hidden"
          >
            <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">{t.finance.addEmployee}</h3>
              <button
                type="button"
                onClick={() => setIsEmployeeModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
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
                  placeholder="e.g. Somsak"
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
                  placeholder="e.g. Head Chef, Waiter"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.finance.wageType}
                  </label>
                  <select
                    value={editingEmployee.wageType || 'monthly'}
                    onChange={(e) => setEditingEmployee({ ...editingEmployee, wageType: e.target.value as WageType })}
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
                  <input
                    type="number"
                    min={0}
                    step={10}
                    required
                    value={editingEmployee.wageAmount || 0}
                    onChange={(e) =>
                      setEditingEmployee({ ...editingEmployee, wageAmount: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
                  />
                </div>
              </div>
            </div>

            <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
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
    </div>
  );
};
