import React, { useState } from 'react';
import { Plus, Users, Edit2, Trash2, DollarSign, Clock } from 'lucide-react';
import { Employee } from '../../types/domain';
import { NumericInput } from '../common/NumericInput';

interface LaborViewProps {
  employees: Employee[];
  monthlyNetSales: number;
  onAddEmployee: (emp: Employee) => void;
  onDeleteEmployee: (id: string) => void;
  activeLanguage: 'th' | 'en';
}

export const LaborView: React.FC<LaborViewProps> = ({
  employees,
  monthlyNetSales,
  onAddEmployee,
  onDeleteEmployee,
  activeLanguage,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<{
    name: string;
    role: string;
    department: 'kitchen' | 'front_of_house' | 'management';
    employmentType: 'full_time' | 'part_time' | 'hourly';
    baseSalary: number;
    hourlyRate: number;
    hoursPerMonth: number;
  }>({
    name: '',
    role: 'ผู้ช่วยครัว (Kitchen Hand)',
    department: 'kitchen',
    employmentType: 'full_time',
    baseSalary: 15000,
    hourlyRate: 65,
    hoursPerMonth: 200,
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    const monthlyCost = formData.employmentType === 'hourly'
      ? formData.hourlyRate * formData.hoursPerMonth
      : formData.baseSalary;

    const newEmp: Employee = {
      id: `emp-${Date.now()}`,
      name: formData.name,
      position: formData.role,
      type: formData.employmentType === 'hourly' ? 'hourly' : 'monthly',
      roleCategory: formData.department === 'kitchen' ? 'direct_kitchen' : formData.department === 'front_of_house' ? 'direct_service' : 'indirect_management',
      wageRate: formData.employmentType === 'hourly' ? formData.hourlyRate : formData.baseSalary,
      standardHoursPerMonth: formData.hoursPerMonth,
      overtimeHoursMonthly: 0,
      overtimeRateMultiplier: 1.5,
      benefitsMonthly: 0,
      role: formData.role,
      department: formData.department,
      employmentType: formData.employmentType,
      baseSalary: formData.baseSalary,
      hourlyRate: formData.hourlyRate,
      hoursPerMonth: formData.hoursPerMonth,
      monthlyCost,
      active: true,
    };

    onAddEmployee(newEmp);
    setIsModalOpen(false);
  };

  const getEmpCost = (e: Employee) => e.monthlyCost ?? (e.type === 'hourly' ? e.wageRate * e.standardHoursPerMonth : e.wageRate) + e.benefitsMonthly;

  const totalLaborCost = employees.reduce((sum, e) => sum + getEmpCost(e), 0);
  const kitchenLabor = employees.filter((e) => (e.department === 'kitchen' || e.roleCategory === 'direct_kitchen')).reduce((sum, e) => sum + getEmpCost(e), 0);
  const fohLabor = employees.filter((e) => (e.department === 'front_of_house' || e.roleCategory === 'direct_service' || e.roleCategory === 'indirect_management')).reduce((sum, e) => sum + getEmpCost(e), 0);

  const laborCostPercent = monthlyNetSales > 0 ? (totalLaborCost / monthlyNetSales) * 100 : 0;
  const kitchenLaborPercent = monthlyNetSales > 0 ? (kitchenLabor / monthlyNetSales) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <span>{activeLanguage === 'th' ? 'การจัดการแรงงาน & ค่าจ้าง (Labor & Payroll)' : 'Labor & Payroll'}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {activeLanguage === 'th'
              ? 'คำนวณค่าแรงครัว (Direct Labor) และค่าแรงหน้าร้าน เพื่อควบคุม Prime Cost ไม่ให้เกินมาตรฐาน 55-60%'
              : 'Direct kitchen labor and FOH wages to control overall Prime Cost %.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-xs"
        >
          <Plus className="h-4 w-4" />
          <span>{activeLanguage === 'th' ? 'เพิ่มพนักงาน' : 'Add Staff'}</span>
        </button>
      </div>

      {/* Labor KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">ค่าแรงรวมทั้งร้าน (Total Labor)</div>
          <div className="mt-1 text-xl font-bold text-slate-900 font-mono">
            ฿{totalLaborCost.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">{employees.length} อัตรา</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">ค่าแรงครัว (Direct Labor)</div>
          <div className="mt-1 text-xl font-bold text-purple-700 font-mono">
            ฿{kitchenLabor.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">นำไปรวมใน Prime Cost</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">ค่าแรงหน้าร้าน & บริหาร</div>
          <div className="mt-1 text-xl font-bold text-slate-700 font-mono">
            ฿{fohLabor.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Service & Management</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">% ค่าแรงต่องวดขาย (Labor %)</div>
          <div className="mt-1 text-xl font-bold font-mono flex items-baseline gap-1 text-slate-900">
            <span>{laborCostPercent.toFixed(1)}%</span>
            <span className="text-xs text-slate-400 font-normal">(เป้า &lt; 25%)</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Kitchen: {kitchenLaborPercent.toFixed(1)}%</div>
        </div>
      </div>

      {/* Staff Table */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs overflow-hidden">
        <h2 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-600" />
          <span>รายชื่อพนักงานและค่าตอบแทน</span>
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                <th className="py-2.5 px-3">ชื่อพนักงาน</th>
                <th className="py-2.5 px-3">ตำแหน่ง</th>
                <th className="py-2.5 px-3">แผนก</th>
                <th className="py-2.5 px-3">ประเภทการจ้าง</th>
                <th className="py-2.5 px-3 text-right">ค่าตอบแทนต่อเดือน (฿)</th>
                <th className="py-2.5 px-3 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-3 font-semibold text-slate-900">{emp.name}</td>
                  <td className="py-2.5 px-3 text-slate-600">{emp.role}</td>
                  <td className="py-2.5 px-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                      emp.department === 'kitchen'
                        ? 'bg-purple-50 text-purple-700'
                        : emp.department === 'front_of_house'
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-slate-100 text-slate-700'
                    }`}>
                      {emp.department === 'kitchen' ? 'ครัว (Direct)' : emp.department === 'front_of_house' ? 'หน้าร้าน' : 'บริหาร'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-600">
                    {emp.employmentType === 'full_time' ? 'ประจำ (Full-time)' : emp.employmentType === 'part_time' ? 'พาร์ทไทม์' : 'รายชั่วโมง'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                    ฿{getEmpCost(emp).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <button
                      type="button"
                      onClick={() => onDeleteEmployee(emp.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h2 className="text-base font-bold text-slate-900">เพิ่มพนักงาน</h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ชื่อ-นามสกุล *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น สมชาย มีสุข"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">ตำแหน่ง</label>
                  <input
                    type="text"
                    required
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">แผนก</label>
                  <select
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value as any })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs bg-white"
                  >
                    <option value="kitchen">ครัว (Kitchen Direct Labor)</option>
                    <option value="front_of_house">หน้าร้าน (Front of House)</option>
                    <option value="management">บริหาร (Management)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">ประเภทการจ้าง</label>
                  <select
                    value={formData.employmentType}
                    onChange={(e) => setFormData({ ...formData, employmentType: e.target.value as any })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs bg-white"
                  >
                    <option value="full_time">ประจำ (Full-time)</option>
                    <option value="part_time">พาร์ทไทม์</option>
                    <option value="hourly">รายชั่วโมง (Hourly)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">เงินเดือน/ค่าจ้าง (฿)</label>
                  <NumericInput
                    type="number"
                    step="any"
                    required
                    min="0"
                    value={formData.baseSalary}
                    onChange={(e) => setFormData({ ...formData, baseSalary: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono font-bold"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-5 py-2 text-xs font-bold text-white shadow-xs"
                >
                  บันทึก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
