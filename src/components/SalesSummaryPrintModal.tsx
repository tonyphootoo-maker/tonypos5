import React, { useState } from 'react';
import { Language, SettingsDoc } from '../types';
import { formatMoney } from '../engine/calculations';
import {
  PaymentMethodStat,
  ReportChannelFilter,
  SalesSummaryMetrics,
} from '../engine/salesReports';
import { Printer, X, FileText } from 'lucide-react';
import { LanguageToggle } from './LanguageToggle';

interface Props {
  summary: SalesSummaryMetrics;
  paymentStats: PaymentMethodStat[];
  dateDisplayLabel: string;
  channelFilter: ReportChannelFilter;
  settings: SettingsDoc;
  lang: Language;
  onClose: () => void;
}

export const SalesSummaryPrintModal: React.FC<Props> = ({
  summary,
  paymentStats,
  dateDisplayLabel,
  channelFilter,
  settings,
  lang,
  onClose,
}) => {
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>('80mm');

  const getChannelLabel = (id: ReportChannelFilter) => {
    if (id === 'all') return lang === 'th' ? 'ทั้งหมด' : 'All';
    if (id === 'dine_in') return lang === 'th' ? 'ทานที่ร้าน' : 'Dine-In';
    if (id === 'takeaway') return lang === 'th' ? 'สั่งกลับบ้าน' : 'Takeaway';
    return 'Delivery';
  };

  const getPaymentLabel = (method: string) => {
    if (method === 'cash') return lang === 'th' ? 'เงินสด' : 'Cash';
    if (method === 'qr') return lang === 'th' ? 'พร้อมเพย์ / QR' : 'QR Payment';
    if (method === 'card') return lang === 'th' ? 'บัตรเครดิต' : 'Credit Card';
    return lang === 'th' ? 'โอนเงิน' : 'Bank Transfer';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
      <div className="modal-panel bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-emerald-200">
        <div className="modal-header bg-emerald-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-200" />
            <h3 className="font-bold text-base">
              {lang === 'th' ? 'พิมพ์ใบสรุปยอดขาย' : 'Print Sales Summary'}
            </h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <LanguageToggle lang={lang} variant="header-accent" />
            <button
              onClick={onClose}
              className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-3 bg-neutral-100 border-b border-neutral-200 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-neutral-300">
            <button
              onClick={() => setPaperWidth('80mm')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                paperWidth === '80mm'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              80 mm
            </button>
            <button
              onClick={() => setPaperWidth('58mm')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                paperWidth === '58mm'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              58 mm
            </button>
          </div>

          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs flex items-center gap-2 shadow-sm cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>{lang === 'th' ? 'พิมพ์ใบสรุปยอด' : 'Print Summary'}</span>
          </button>
        </div>

        <div className="modal-body bg-neutral-200/70 flex justify-center">
          <div
            id="printable-thermal-receipt"
            className={`bg-white p-4 shadow-md text-neutral-900 font-mono text-xs border border-neutral-300 rounded-lg leading-relaxed select-none ${
              paperWidth === '80mm' ? 'w-[320px]' : 'w-[250px]'
            }`}
          >
            <div className="text-center pb-2.5 border-b border-dashed border-neutral-400">
              <div className="text-xs font-bold uppercase tracking-wider mb-1">
                {lang === 'th' ? '*** ใบสรุปยอดขาย ***' : '*** SALES SUMMARY ***'}
              </div>
              <h2 className="text-sm font-bold">{settings.shopName}</h2>
              {settings.shopPhone && (
                <p className="text-[10px] text-neutral-600">Tel: {settings.shopPhone}</p>
              )}
              <p className="text-[10px] text-neutral-700 mt-1">{dateDisplayLabel}</p>
              <p className="text-[10px] text-neutral-700">
                {lang === 'th' ? 'ช่องทาง:' : 'Channel:'} {getChannelLabel(channelFilter)}
              </p>
            </div>

            {/* Channel breakdown */}
            <div className="py-2 border-b border-dashed border-neutral-400 text-[11px] space-y-1">
              <div className="flex justify-between font-bold text-[10px] text-neutral-600">
                <span>{lang === 'th' ? 'ประเภท (บิล)' : 'Type (Bills)'}</span>
                <span>{lang === 'th' ? 'ยอดรวม' : 'Total'}</span>
              </div>
              {summary.channelRows.map((row) => (
                <div
                  key={row.id}
                  className={`flex justify-between ${row.id === 'all' ? 'font-bold' : ''}`}
                >
                  <span>
                    {getChannelLabel(row.id)} ({row.billCount})
                  </span>
                  <span>฿{formatMoney(row.receivedTotal)}</span>
                </div>
              ))}
            </div>

            {/* Details */}
            <div className="py-2 border-b border-dashed border-neutral-400 text-[11px] space-y-1">
              <div className="flex justify-between">
                <span>{lang === 'th' ? 'จำนวนบิลชำระแล้ว' : 'Paid Bills'}</span>
                <span>{summary.billCount}</span>
              </div>
              <div className="flex justify-between">
                <span>{lang === 'th' ? 'ยอดขายเฉลี่ยต่อบิล' : 'Avg per Bill'}</span>
                <span>฿{formatMoney(summary.avgPerBill)}</span>
              </div>
              <div className="flex justify-between">
                <span>{lang === 'th' ? 'ยอดรวมอาหาร' : 'Subtotal'}</span>
                <span>฿{formatMoney(summary.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>{lang === 'th' ? 'ส่วนลด' : 'Discounts'}</span>
                <span>-฿{formatMoney(summary.discountTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>
                  {lang === 'th' ? `เงินคืน / ยกเลิก (${summary.refundCount})` : `Refunds / Void (${summary.refundCount})`}
                </span>
                <span>฿{formatMoney(summary.refundTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>{lang === 'th' ? 'ค่าบริการ' : 'Service Charge'}</span>
                <span>฿{formatMoney(summary.serviceChargeTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>{lang === 'th' ? 'ค่าธรรมเนียม/บรรจุภัณฑ์' : 'Extra Fees/Pkg'}</span>
                <span>฿{formatMoney(summary.extraChargesTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>{lang === 'th' ? 'ภาษี (VAT)' : 'Tax (VAT)'}</span>
                <span>฿{formatMoney(summary.vatTotal)}</span>
              </div>
              <div className="flex justify-between font-bold text-xs pt-1 border-t border-dotted border-neutral-300">
                <span>{lang === 'th' ? 'รวมยอดเงินที่ได้รับ' : 'Total Received'}</span>
                <span>฿{formatMoney(summary.totalReceived)}</span>
              </div>
            </div>

            {/* Payment Methods */}
            <div className="py-2 border-b border-dashed border-neutral-400 text-[11px] space-y-1">
              <div className="font-bold text-[10px] text-neutral-600">
                {lang === 'th' ? 'แยกตามวิธีการชำระเงิน' : 'By Payment Method'}
              </div>
              {paymentStats.map((pm) => (
                <div key={pm.method} className="flex justify-between">
                  <span>
                    {getPaymentLabel(pm.method)} ({pm.billCount})
                  </span>
                  <span>฿{formatMoney(pm.amount)}</span>
                </div>
              ))}
            </div>

            <div className="pt-2 text-center text-[10px] text-neutral-500">
              {lang === 'th' ? 'พิมพ์เมื่อ:' : 'Printed:'}{' '}
              {new Date().toLocaleString(lang === 'th' ? 'th-TH' : 'en-US')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
