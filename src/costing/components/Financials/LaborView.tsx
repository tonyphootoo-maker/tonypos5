import React, { useState } from 'react';
import { Plus, Users, Trash2 } from 'lucide-react';
import { Employee } from '../../types/domain';
import { NumericInput } from '../common/NumericInput';
import {
  getEmployeeMonthlyCost,
  formatPeriodCalculationLabel,
  getMonthDateRange,
  roundTo2,
} from '../../../engine/calculations';
import { useLanguage } from '../../../contexts/LanguageContext';

interface LaborViewProps {
  employees: Employee[];
  monthlyNetSales: number;
  onAddEmployee: (emp: Employee) => void;
  onDeleteEmployee: (id: string) => void;
  activeLanguage?: 'th' | 'en';
  period?: 'day' | 'month' | 'year';
  dateParam?: string;
  coveredMonths?: number;
  periodLaborCost?: number;
  periodSalesLabel?: string;
  socialSecurityEnabled?: boolean;
  socialSecurityRatePercent?: number;
  socialSecurityCapWage?: number;
}

export const LaborView: React.FC<LaborViewProps> = ({
  employees,
  monthlyNetSales,
  onAddEmployee,
  onDeleteEmployee,
  activeLanguage: propActiveLanguage,
  period = 'month',
  dateParam,
  coveredMonths,
  periodLaborCost,
  periodSalesLabel,
  socialSecurityEnabled = false,
  socialSecurityRatePercent = 5,
  socialSecurityCapWage = 15000,
}) => {
  const { lang: ctxLang } = useLanguage();
  const activeLanguage = propActiveLanguage ?? ctxLang;
  const isTh = activeLanguage === 'th';
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<{
    name: string;
    role: string;
    department: 'kitchen' | 'front_of_house' | 'management';
    employmentType: 'full_time' | 'part_time' | 'hourly';
    baseSalary: number;
    hourlyRate: number;
    hoursPerMonth: number;
    benefitsMonthly: number;
    overtimeHoursMonthly: number;
  }>({
    name: '',
    role: isTh ? 'ผู้ช่วยครัว (Kitchen Hand)' : 'Kitchen Hand',
    department: 'kitchen',
    employmentType: 'full_time',
    baseSalary: 15000,
    hourlyRate: 65,
    hoursPerMonth: 200,
    benefitsMonthly: 0,
    overtimeHoursMonthly: 0,
  });

  const laborOptions = {
    socialSecurityEnabled,
    socialSecurityRatePercent,
    socialSecurityCapWage,
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    const isHourly = formData.employmentType === 'hourly';
    const baseMonthly = isHourly
      ? formData.hourlyRate * formData.hoursPerMonth
      : formData.baseSalary;

    const newEmp: Employee = {
      id: `emp-${Date.now()}`,
      name: formData.name,
      position: formData.role,
      type: isHourly ? 'hourly' : 'monthly',
      roleCategory:
        formData.department === 'kitchen'
          ? 'direct_kitchen'
          : formData.department === 'front_of_house'
          ? 'direct_service'
          : 'indirect_management',
      wageRate: isHourly ? formData.hourlyRate : formData.baseSalary,
      standardHoursPerMonth: formData.hoursPerMonth,
      overtimeHoursMonthly: formData.overtimeHoursMonthly || 0,
      overtimeRateMultiplier: 1.5,
      benefitsMonthly: formData.benefitsMonthly || 0,
      role: formData.role,
      department: formData.department,
      employmentType: formData.employmentType,
      baseSalary: formData.baseSalary,
      hourlyRate: formData.hourlyRate,
      hoursPerMonth: formData.hoursPerMonth,
      monthlyCost: baseMonthly,
      active: true,
    };

    onAddEmployee(newEmp);
    setIsModalOpen(false);
  };

  const getEmpCost = (e: Employee) => getEmployeeMonthlyCost(e, laborOptions);

  const activeEmployees = employees.filter((e) => e.active !== false);
  const monthlyTotalLaborCost = activeEmployees.reduce((sum, e) => sum + getEmpCost(e), 0);
  const monthlyKitchenLabor = activeEmployees
    .filter((e) => e.department === 'kitchen' || e.roleCategory === 'direct_kitchen')
    .reduce((sum, e) => sum + getEmpCost(e), 0);
  const monthlyFohLabor = activeEmployees
    .filter((e) => e.department !== 'kitchen' && e.roleCategory !== 'direct_kitchen')
    .reduce((sum, e) => sum + getEmpCost(e), 0);

  // Align labor period strictly with revenue period (day / month / year)
  let periodScaleFactor = 1;
  if (typeof coveredMonths === 'number' && Number.isFinite(coveredMonths) && coveredMonths >= 0) {
    periodScaleFactor = coveredMonths;
  } else if (period === 'day') {
    const ym =
      dateParam && dateParam.length >= 7
        ? dateParam.substring(0, 7)
        : new Date().toISOString().substring(0, 7);
    const { daysInMonth } = getMonthDateRange(ym);
    periodScaleFactor = 1 / daysInMonth;
  } else if (period === 'year') {
    const targetYear = dateParam ? parseInt(dateParam.substring(0, 4), 10) : NaN;
    const now = new Date();
    periodScaleFactor =
      Number.isFinite(targetYear) && targetYear === now.getFullYear()
        ? Math.max(1, now.getMonth() + 1)
        : 12;
  }

  const totalLaborCost =
    typeof periodLaborCost === 'number' && Number.isFinite(periodLaborCost)
      ? periodLaborCost
      : roundTo2(monthlyTotalLaborCost * periodScaleFactor);
  const kitchenLabor = roundTo2(monthlyKitchenLabor * periodScaleFactor);
  const fohLabor = roundTo2(monthlyFohLabor * periodScaleFactor);

  const laborCostPercent = monthlyNetSales > 0 ? (totalLaborCost / monthlyNetSales) * 100 : 0;
  const kitchenLaborPercent = monthlyNetSales > 0 ? (kitchenLabor / monthlyNetSales) * 100 : 0;

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
            <span>{activeLanguage === 'th' ? 'การจัดการแรงงาน & ค่าจ้าง (Labor & Payroll)' : 'Labor & Payroll'}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {effectivePeriodLabel}
            {socialSecurityEnabled &&
              (activeLanguage === 'th'
                ? ` · รวมประกันสังคมส่วนนายจ้าง ${socialSecurityRatePercent}% (เพดาน ฿${socialSecurityCapWage.toLocaleString()})`
                : ` · Includes employer SSO ${socialSecurityRatePercent}% (cap ฿${socialSecurityCapWage.toLocaleString()})`)}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-xs cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>{activeLanguage === 'th' ? 'เพิ่มพนักงาน' : 'Add Staff'}</span>
        </button>
      </div>

      {/* Labor KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">
            {period === 'day'
              ? isTh
                ? 'ค่าแรงต่องวด (รายวัน)'
                : 'Period Labor Cost (Daily)'
              : period === 'year'
              ? isTh
                ? 'ค่าแรงต่องวด (รายปี)'
                : 'Period Labor Cost (Annual)'
              : isTh
              ? 'ค่าแรงรวมทั้งร้าน (Total Labor)'
              : 'Total Store Labor (Monthly)'}
          </div>
          <div className="mt-1 text-xl font-bold text-slate-900 font-mono">
            ฿{totalLaborCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {isTh
              ? `${activeEmployees.length} อัตรา · ฐานรายเดือน ฿${Math.round(monthlyTotalLaborCost).toLocaleString()}`
              : `${activeEmployees.length} staff · Monthly base ฿${Math.round(monthlyTotalLaborCost).toLocaleString()}`}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">
            {isTh ? 'ค่าแรงครัว (Direct Labor)' : 'Kitchen Direct Labor'}
          </div>
          <div className="mt-1 text-xl font-bold text-purple-700 font-mono">
            ฿{kitchenLabor.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {isTh ? 'นำไปรวมใน Prime Cost' : 'Included in Prime Cost'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">
            {isTh ? 'ค่าแรงหน้าร้าน & บริหาร' : 'FOH & Management Labor'}
          </div>
          <div className="mt-1 text-xl font-bold text-slate-700 font-mono">
            ฿{fohLabor.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Service & Management</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">
            {isTh ? '% ค่าแรงต่องวดขาย (Labor %)' : 'Labor % of Sales'}
          </div>
          <div className="mt-1 text-xl font-bold font-mono flex items-baseline gap-1 text-slate-900">
            <span>{laborCostPercent.toFixed(1)}%</span>
            <span className="text-xs text-slate-400 font-normal">
              ({isTh ? 'เป้า < 25%' : 'Target < 25%'})
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Kitchen: {kitchenLaborPercent.toFixed(1)}% · {isTh ? 'ยอดขาย' : 'Sales'} ฿
            {Math.round(monthlyNetSales).toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">{effectivePeriodLabel}</div>
        </div>
      </div>

      {/* Staff Table */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs overflow-hidden">
        <h2 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-600" />
          <span>{isTh ? 'รายชื่อพนักงานและค่าตอบแทน' : 'Staff Roster & Compensation'}</span>
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                <th className="py-2.5 px-3">{isTh ? 'ชื่อพนักงาน' : 'Staff Name'}</th>
                <th className="py-2.5 px-3">{isTh ? 'ตำแหน่ง' : 'Role'}</th>
                <th className="py-2.5 px-3">{isTh ? 'แผนก' : 'Department'}</th>
                <th className="py-2.5 px-3">{isTh ? 'ประเภทการจ้าง' : 'Employment Type'}</th>
                <th className="py-2.5 px-3 text-right">
                  {isTh ? 'ค่าตอบแทนต่อเดือน (฿)' : 'Monthly Cost (฿)'}
                </th>
                <th className="py-2.5 px-3 text-center">{isTh ? 'จัดการ' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {employees.map((emp) => {
                const isHourlyEmp =
                  emp.type === 'hourly' || emp.employmentType === 'hourly';
                const hourlyRateDisp = emp.wageRate || emp.hourlyRate || 0;
                const hoursDisp = emp.standardHoursPerMonth || emp.hoursPerMonth || 208;
                return (
                  <tr key={emp.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">{emp.name}</td>
                    <td className="py-2.5 px-3 text-slate-600">{emp.role}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          emp.department === 'kitchen'
                            ? 'bg-purple-50 text-purple-700'
                            : emp.department === 'front_of_house'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {emp.department === 'kitchen'
                          ? isTh
                            ? 'ครัว (Direct)'
                            : 'Kitchen (Direct)'
                          : emp.department === 'front_of_house'
                          ? isTh
                            ? 'หน้าร้าน'
                            : 'Front of House'
                          : isTh
                          ? 'บริหาร'
                          : 'Management'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {isHourlyEmp ? (
                        <span>
                          {isTh
                            ? `รายชั่วโมง (฿${hourlyRateDisp}/ชม. × ${hoursDisp} ชม.)`
                            : `Hourly (฿${hourlyRateDisp}/hr × ${hoursDisp} hrs)`}
                        </span>
                      ) : emp.employmentType === 'part_time' ? (
                        isTh ? 'พาร์ทไทม์' : 'Part-time'
                      ) : (
                        isTh ? 'ประจำ (Full-time)' : 'Full-time'
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                      ฿{roundTo2(getEmpCost(emp)).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => onDeleteEmployee(emp.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                        title={isTh ? 'ลบพนักงาน' : 'Remove Staff'}
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
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h2 className="text-base font-bold text-slate-900">
                {isTh ? 'เพิ่มพนักงาน' : 'Add Staff Member'}
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
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {isTh ? 'ชื่อ-นามสกุล *' : 'Full Name *'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={isTh ? 'เช่น สมชาย มีสุข' : 'e.g. Somchai Meesuk'}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isTh ? 'ตำแหน่ง' : 'Role / Position'}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isTh ? 'แผนก' : 'Department'}
                  </label>
                  <select
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value as any })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs bg-white"
                  >
                    <option value="kitchen">
                      {isTh ? 'ครัว (Kitchen Direct Labor)' : 'Kitchen (Direct Labor)'}
                    </option>
                    <option value="front_of_house">
                      {isTh ? 'หน้าร้าน (Front of House)' : 'Front of House'}
                    </option>
                    <option value="management">
                      {isTh ? 'บริหาร (Management)' : 'Management'}
                    </option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {isTh ? 'ประเภทการจ้าง' : 'Employment Type'}
                </label>
                <select
                  value={formData.employmentType}
                  onChange={(e) => setFormData({ ...formData, employmentType: e.target.value as any })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs bg-white"
                >
                  <option value="full_time">{isTh ? 'ประจำ (Full-time)' : 'Full-time (Monthly)'}</option>
                  <option value="part_time">{isTh ? 'พาร์ทไทม์ (Monthly)' : 'Part-time (Monthly)'}</option>
                  <option value="hourly">{isTh ? 'รายชั่วโมง (Hourly)' : 'Hourly'}</option>
                </select>
              </div>

              {formData.employmentType === 'hourly' ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        {isTh ? 'ค่าจ้างต่อชั่วโมง (฿/ชม.) *' : 'Hourly Wage (฿/hr) *'}
                      </label>
                      <NumericInput
                        type="number"
                        step="any"
                        required
                        min="0"
                        value={formData.hourlyRate}
                        onValueChange={(val) => setFormData({ ...formData, hourlyRate: val })}
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        {isTh ? 'ชั่วโมงทำงานต่อเดือน *' : 'Hours / Month *'}
                      </label>
                      <NumericInput
                        type="number"
                        step="any"
                        required
                        min="1"
                        value={formData.hoursPerMonth}
                        onValueChange={(val) => setFormData({ ...formData, hoursPerMonth: val })}
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono font-bold"
                      />
                    </div>
                  </div>
                  <div className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                    {isTh
                      ? `ค่าจ้างพื้นฐานรายเดือน: ฿${(formData.hourlyRate * formData.hoursPerMonth).toLocaleString()} / เดือน`
                      : `Base Monthly Wage: ฿${(formData.hourlyRate * formData.hoursPerMonth).toLocaleString()} / month`}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isTh ? 'เงินเดือน/ค่าจ้าง (฿)' : 'Monthly Salary / Wage (฿)'}
                  </label>
                  <NumericInput
                    type="number"
                    step="any"
                    required
                    min="0"
                    value={formData.baseSalary}
                    onValueChange={(val) => setFormData({ ...formData, baseSalary: val })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono font-bold"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isTh ? 'สวัสดิการ/เบี้ยขยัน (฿/เดือน)' : 'Benefits / Bonus (฿/mo)'}
                  </label>
                  <NumericInput
                    type="number"
                    step="any"
                    min="0"
                    value={formData.benefitsMonthly}
                    onValueChange={(val) => setFormData({ ...formData, benefitsMonthly: val })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isTh ? 'OT เฉลี่ย (ชม./เดือน)' : 'Avg. Overtime (hrs/mo)'}
                  </label>
                  <NumericInput
                    type="number"
                    step="any"
                    min="0"
                    value={formData.overtimeHoursMonthly}
                    onValueChange={(val) => setFormData({ ...formData, overtimeHoursMonthly: val })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono"
                  />
                </div>
              </div>

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
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-5 py-2 text-xs font-bold text-white shadow-xs cursor-pointer"
                >
                  {isTh ? 'บันทึก' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

