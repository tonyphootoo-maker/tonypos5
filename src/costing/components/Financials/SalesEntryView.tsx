import React, { useState } from 'react';
import { Plus, Calendar, Trash2, AlertTriangle } from 'lucide-react';
import { DailySalesRecord, SalesChannel } from '../../types/domain';
import { NumericInput } from '../common/NumericInput';
import {
  calculateChannelPlatformFees,
  normalizeUpsertChannelId,
} from '../../engine/calculations';
import { useLanguage } from '../../../contexts/LanguageContext';

interface SalesEntryViewProps {
  sales: DailySalesRecord[];
  channels: SalesChannel[];
  onAddSalesRecord: (record: DailySalesRecord, replacedPosRecordId?: string) => void;
  onDeleteSalesRecord: (id: string) => void;
  onUpdateChannels?: (channels: SalesChannel[]) => void;
  defaultVatRate?: number;
  activeLanguage?: 'th' | 'en';
}

export const SalesEntryView: React.FC<SalesEntryViewProps> = ({
  sales,
  channels,
  onAddSalesRecord,
  onDeleteSalesRecord,
  onUpdateChannels,
  defaultVatRate = 7,
  activeLanguage: propActiveLanguage,
}) => {
  const { lang: ctxLang } = useLanguage();
  const activeLanguage = propActiveLanguage ?? ctxLang;
  const isTh = activeLanguage === 'th';
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [localGpBases, setLocalGpBases] = useState<Record<string, 'gross_incl_vat' | 'net_ex_vat'>>({});
  const [formData, setFormData] = useState<{
    date: string;
    channelId: string;
    grossSales: number;
    discounts: number;
    refunds: number;
    serviceCharge: number;
    isVatInclusive: boolean;
    vatRatePercent: number;
    orderCount: number;
    customerCount: number;
    notes: string;
  }>({
    date: new Date().toISOString().split('T')[0],
    channelId: channels[0]?.id || '',
    grossSales: 15000,
    discounts: 500,
    refunds: 0,
    serviceCharge: 0,
    isVatInclusive: false,
    vatRatePercent: defaultVatRate,
    orderCount: 45,
    customerCount: 60,
    notes: '',
  });

  const targetChannelNormalized = normalizeUpsertChannelId(formData.channelId);
  const existingPosDuplicate = sales.find(
    (s) =>
      s.id?.startsWith('pos_sync_') &&
      s.date === formData.date &&
      normalizeUpsertChannelId(s.channelId) === targetChannelNormalized
  );
  const existingManualDuplicate = sales.find(
    (s) =>
      !s.id?.startsWith('pos_sync_') &&
      s.date === formData.date &&
      normalizeUpsertChannelId(s.channelId) === targetChannelNormalized
  );

  const selectedChannelRaw = channels.find((c) => c.id === formData.channelId);
  const currentGpBase: 'gross_incl_vat' | 'net_ex_vat' =
    localGpBases[formData.channelId] || selectedChannelRaw?.gpBase || 'gross_incl_vat';

  const handleChangeGpBase = (nextBase: 'gross_incl_vat' | 'net_ex_vat') => {
    setLocalGpBases((prev) => ({ ...prev, [formData.channelId]: nextBase }));
    if (onUpdateChannels && selectedChannelRaw) {
      onUpdateChannels(
        channels.map((ch) =>
          ch.id === selectedChannelRaw.id ? { ...ch, gpBase: nextBase } : ch
        )
      );
    }
  };

  const feePreview = calculateChannelPlatformFees({
    grossSales: formData.grossSales,
    discounts: formData.discounts,
    refunds: formData.refunds,
    isVatInclusive: formData.isVatInclusive,
    vatRatePercent: formData.vatRatePercent,
    channel: selectedChannelRaw
      ? { ...selectedChannelRaw, gpBase: currentGpBase }
      : { gpBase: currentGpBase },
  });

  const submitSalesRecord = (options?: {
    replacesPosSync?: boolean;
    replacedPosRecordId?: string;
  }) => {
    const newRecord: DailySalesRecord = {
      id: existingManualDuplicate?.id || `sales-${Date.now()}`,
      date: formData.date,
      channelId: formData.channelId,
      channelName: selectedChannelRaw?.name || (isTh ? 'ทั่วไป' : 'General'),
      grossSales: formData.grossSales,
      discounts: formData.discounts,
      refunds: formData.refunds,
      netSales: feePreview.netSalesExVat,
      serviceCharge: Math.max(0, formData.serviceCharge || 0),
      isVatInclusive: formData.isVatInclusive,
      vatRatePercent: formData.vatRatePercent,
      platformFees: feePreview.platformFees,
      actualPayout: feePreview.actualPayout,
      orderCount: formData.orderCount,
      ...(options?.replacesPosSync ? { replacesPosSync: true } : {}),
    };

    onAddSalesRecord(newRecord, options?.replacedPosRecordId);
    setIsModalOpen(false);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (existingPosDuplicate) {
      // Force explicit conflict choice ("แทนที่ POS" vs "เก็บเฉพาะ POS")
      return;
    }
    submitSalesRecord();
  };

  const totalGross = sales.reduce((sum, s) => sum + s.grossSales, 0);
  const totalDiscounts = sales.reduce((sum, s) => sum + s.discounts, 0);
  const totalNet = sales.reduce((sum, s) => sum + s.netSales, 0);
  const totalOrders = sales.reduce((sum, s) => sum + s.orderCount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <span>{activeLanguage === 'th' ? 'บันทึกยอดขายรายวัน (Daily Sales Entry)' : 'Daily Sales Records'}</span>
        </h1>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-xs cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>{activeLanguage === 'th' ? 'บันทึกยอดขาย' : 'Log Sales'}</span>
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">
            {isTh ? 'ยอดขายรวมก่อนหัก (Gross)' : 'Total Gross Sales'}
          </div>
          <div className="mt-1 text-xl font-bold text-slate-900 font-mono">
            ฿{Math.round(totalGross).toLocaleString()}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">
            {isTh ? 'ส่วนลดที่ร้านออกเอง' : 'Store Discounts'}
          </div>
          <div className="mt-1 text-xl font-bold text-amber-600 font-mono">
            -฿{Math.round(totalDiscounts).toLocaleString()}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">
            {isTh ? 'ยอดขายสุทธิ (Net Sales ex-VAT)' : 'Total Net Sales (ex-VAT)'}
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-700 font-mono">
            ฿{Math.round(totalNet).toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {isTh ? 'ไม่รวมภาษีมูลค่าเพิ่ม VAT' : 'Excluding VAT'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-slate-500 text-xs font-medium">
            {isTh ? 'จำนวนออเดอร์ทั้งหมด' : 'Total Orders'}
          </div>
          <div className="mt-1 text-xl font-bold text-slate-900 font-mono">
            {totalOrders.toLocaleString()} <span className="text-xs text-slate-400 font-sans">{isTh ? 'บิล' : 'orders'}</span>
          </div>
        </div>
      </div>

      {/* Sales Records Table */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs overflow-hidden">
        <h2 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-slate-600" />
          <span>{isTh ? 'ประวัติยอดขายรายวัน' : 'Daily Sales History'}</span>
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                <th className="py-2.5 px-3">{isTh ? 'วันที่' : 'Date'}</th>
                <th className="py-2.5 px-3">{isTh ? 'ช่องทางขาย' : 'Channel'}</th>
                <th className="py-2.5 px-3 text-right">{isTh ? 'ยอดรวม (Gross ฿)' : 'Gross (฿)'}</th>
                <th className="py-2.5 px-3 text-right">{isTh ? 'ส่วนลด (฿)' : 'Discounts (฿)'}</th>
                <th className="py-2.5 px-3 text-center">VAT</th>
                <th className="py-2.5 px-3 text-right">{isTh ? 'ค่า GP (฿)' : 'GP Fees (฿)'}</th>
                <th className="py-2.5 px-3 text-right">{isTh ? 'ยอดสุทธิ (ex-VAT ฿)' : 'Net Sales (ex-VAT ฿)'}</th>
                <th className="py-2.5 px-3 text-right">{isTh ? 'ออเดอร์' : 'Orders'}</th>
                <th className="py-2.5 px-3 text-center">{isTh ? 'จัดการ' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {sales.map((rec) => {
                const channel = channels.find(
                  (c) => normalizeUpsertChannelId(c.id) === normalizeUpsertChannelId(rec.channelId)
                );
                const isPosSync = Boolean(rec.id?.startsWith('pos_sync_'));
                return (
                  <tr key={rec.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-medium">{rec.date}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-900">
                          {channel?.name || rec.channelName || (isTh ? 'ทั่วไป' : 'General')}
                        </span>
                        {isPosSync && (
                          <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 text-[10px] font-bold">
                            POS
                          </span>
                        )}
                        {rec.replacesPosSync && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                            {isTh ? 'แทนที่ POS' : 'POS Override'}
                          </span>
                        )}
                        {rec.estimatedAllocation && (
                          <span
                            className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-semibold"
                            title={
                              isTh
                                ? 'ข้อมูล POS เดิมไม่มี breakdown แยกช่องทาง ระบบจัดสรรส่วนลด/ค่า GP ตามสัดส่วนยอดขาย'
                                : 'Legacy POS summary lacked channel breakdown; discounts & GP were allocated proportionally by revenue'
                            }
                          >
                            {isTh ? 'ประมาณการตามสัดส่วน' : 'Proportional Est.'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">฿{rec.grossSales.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-amber-700">
                      {rec.discounts > 0 ? `-฿${rec.discounts.toLocaleString()}` : '-'}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono text-[11px] text-slate-500">
                      {rec.isVatInclusive
                        ? `${isTh ? 'รวม VAT' : 'Incl. VAT'} ${rec.vatRatePercent || 7}%`
                        : 'ex-VAT'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-rose-700">
                      {rec.platformFees > 0 ? `-฿${rec.platformFees.toLocaleString()}` : '-'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                      ฿{Math.round(rec.netSales).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">{rec.orderCount}</td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => onDeleteSalesRecord(rec.id)}
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
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h2 className="text-base font-bold text-slate-900">
                {isTh ? 'บันทึกยอดขายรายวัน' : 'Log Daily Sales'}
              </h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {isTh ? 'วันที่ขาย' : 'Sales Date'}
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
                  {isTh ? 'ช่องทางขาย' : 'Sales Channel'}
                </label>
                <select
                  value={formData.channelId}
                  onChange={(e) => setFormData({ ...formData, channelId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs bg-white"
                >
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name}
                    </option>
                  ))}
                </select>
              </div>

              {existingPosDuplicate && (
                <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-xs text-rose-900 space-y-1.5">
                  <div className="flex items-start gap-2 font-bold">
                    <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>
                      {isTh
                        ? `พบยอดขายจาก POS สำหรับวันที่ ${formData.date} ช่องทาง ${
                            selectedChannelRaw?.name || existingPosDuplicate.channelName
                          } อยู่แล้ว (฿${Math.round(existingPosDuplicate.netSales).toLocaleString()} · ${
                            existingPosDuplicate.orderCount
                          } ออเดอร์)`
                        : `POS sales already exist for ${formData.date} (${
                            selectedChannelRaw?.name || existingPosDuplicate.channelName
                          }: ฿${Math.round(existingPosDuplicate.netSales).toLocaleString()} · ${
                            existingPosDuplicate.orderCount
                          } orders).`}
                    </span>
                  </div>
                  <p className="text-[11px] text-rose-800 pl-6">
                    {isTh ? (
                      <>
                        เพื่อป้องกันการนับยอดขายซ้ำซ้อน กรุณาเลือกว่าต้องการ <strong>แทนที่ข้อมูล POS ด้วยยอดนี้</strong> หรือ <strong>เก็บเฉพาะข้อมูลจาก POS</strong>
                      </>
                    ) : (
                      <>
                        To prevent double counting, choose whether to <strong>Replace POS Data</strong> with this entry or <strong>Keep POS Only</strong>.
                      </>
                    )}
                  </p>
                </div>
              )}

              {!existingPosDuplicate && existingManualDuplicate && (
                <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>
                    {isTh
                      ? `พบรายการบันทึกมือของวันที่ ${formData.date} ช่องทางนี้แล้ว การบันทึกจะอัปเดตทับรายการเดิม`
                      : `A manual entry already exists for ${formData.date} on this channel. Saving will update the existing record.`}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isTh ? 'ยอดขายรวม (Gross ฿)' : 'Gross Sales (฿)'}
                  </label>
                  <NumericInput
                    type="number"
                    step="any"
                    required
                    min="0"
                    value={formData.grossSales}
                    onChange={(e) => setFormData({ ...formData, grossSales: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isTh ? 'ส่วนลดโปรโมชั่น (฿)' : 'Promotional Discounts (฿)'}
                  </label>
                  <NumericInput
                    type="number"
                    step="any"
                    min="0"
                    value={formData.discounts}
                    onChange={(e) => setFormData({ ...formData, discounts: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isTh ? 'จำนวนออเดอร์' : 'Orders'}
                  </label>
                  <NumericInput
                    type="number"
                    min="0"
                    value={formData.orderCount}
                    onChange={(e) => setFormData({ ...formData, orderCount: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isTh ? 'คืนเงิน (Refund ฿)' : 'Refunds (฿)'}
                  </label>
                  <NumericInput
                    type="number"
                    step="any"
                    min="0"
                    value={formData.refunds}
                    onChange={(e) => setFormData({ ...formData, refunds: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Service Charge (฿)</label>
                  <NumericInput
                    type="number"
                    step="any"
                    min="0"
                    value={formData.serviceCharge}
                    onChange={(e) => setFormData({ ...formData, serviceCharge: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono"
                  />
                </div>
              </div>

              {/* VAT Inclusion Toggle */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isVatInclusive}
                    onChange={(e) => setFormData({ ...formData, isVatInclusive: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-xs font-semibold text-slate-800">
                    {isTh
                      ? 'ยอดขายข้างต้น รวมภาษีมูลค่าเพิ่มแล้ว (VAT-Inclusive)'
                      : 'Sales amounts above are VAT-Inclusive'}
                  </span>
                </label>

                {formData.isVatInclusive && (
                  <div className="flex items-center gap-2 pt-1.5 text-xs text-slate-600">
                    <span>{isTh ? 'อัตรา VAT:' : 'VAT Rate:'}</span>
                    <NumericInput
                      type="number"
                      min="0"
                      max="20"
                      value={formData.vatRatePercent}
                      onValueChange={(val) => setFormData({ ...formData, vatRatePercent: val })}
                      className="w-16 rounded border border-slate-300 px-2 py-0.5 text-xs font-mono"
                    />
                    <span>
                      {isTh
                        ? `% (หาร ${1 + formData.vatRatePercent / 100} เพื่อหายอด ex-VAT)`
                        : `% (divide by ${1 + formData.vatRatePercent / 100} for ex-VAT)`}
                    </span>
                  </div>
                )}
              </div>

              {/* Channel GP Basis Toggle */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">
                    {isTh ? 'ฐานคิดค่า GP' : 'GP Fee Basis'} ({selectedChannelRaw?.commissionPercent || 0}% + VAT{' '}
                    {selectedChannelRaw?.taxOnCommissionPercent || 0}%)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleChangeGpBase('gross_incl_vat')}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors ${
                      currentGpBase === 'gross_incl_vat'
                        ? 'bg-orange-50 border-orange-400 text-orange-800'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {isTh ? 'ยอดรวม VAT (Gross)' : 'VAT-Inclusive (Gross)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChangeGpBase('net_ex_vat')}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors ${
                      currentGpBase === 'net_ex_vat'
                        ? 'bg-orange-50 border-orange-400 text-orange-800'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {isTh ? 'ยอด ex-VAT (Net)' : 'ex-VAT (Net)'}
                  </button>
                </div>
                <div className="flex justify-between text-[11px] text-slate-600 pt-1 border-t border-slate-200/80 font-mono">
                  <span>
                    {isTh ? 'ค่า GP ประมาณการ:' : 'Est. GP Fee:'} <strong>฿{feePreview.platformFees.toFixed(2)}</strong>
                  </span>
                  <span>
                    {isTh ? 'รับโอน:' : 'Net Payout:'} <strong>฿{feePreview.actualPayout.toFixed(2)}</strong>
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-slate-100">
                {existingPosDuplicate ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      {isTh ? 'เก็บเฉพาะ POS' : 'Keep POS Only'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        submitSalesRecord({
                          replacesPosSync: true,
                          replacedPosRecordId: existingPosDuplicate.id,
                        })
                      }
                      className="rounded-xl bg-amber-600 hover:bg-amber-700 px-4 py-2 text-xs font-bold text-white cursor-pointer"
                    >
                      {isTh ? 'แทนที่ POS ด้วยยอดนี้' : 'Replace POS Entry'}
                    </button>
                  </>
                ) : (
                  <>
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
                      {existingManualDuplicate
                        ? isTh
                          ? 'อัปเดตยอดเดิม'
                          : 'Update Entry'
                        : isTh
                        ? 'บันทึกยอดขาย'
                        : 'Save Sales'}
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
