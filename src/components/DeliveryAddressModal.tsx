import React, { useState } from 'react';
import { OrderItem, SettingsDoc, Language } from '../types';
import { translations } from '../i18n/translations';
import { formatMoney } from '../engine/calculations';
import { Printer, X, MapPin } from 'lucide-react';

interface Props {
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  billNumber?: string;
  workDate?: string;
  items?: OrderItem[];
  grandTotal?: number;
  status?: 'saved' | 'paid' | 'voided';
  settings: SettingsDoc;
  lang: Language;
  onClose: () => void;
}

export const DeliveryAddressModal: React.FC<Props> = ({
  customerName,
  customerPhone,
  deliveryAddress,
  billNumber,
  workDate,
  items = [],
  grandTotal,
  status,
  settings,
  lang,
  onClose,
}) => {
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>('80mm');
  const t = translations[lang];

  const totalItemCount = items.reduce((sum, item) => sum + (item.quantity || 1), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
      <div className="modal-panel bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-orange-200">
        {/* Header */}
        <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-amber-200" />
            <h3 className="font-extrabold text-base">
              {lang === 'th' ? 'พิมพ์ใบปะหน้าจัดส่ง (Delivery)' : 'Print Delivery Address Label'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Paper Format Selector & Print Button */}
        <div className="p-3 bg-neutral-100 border-b border-neutral-200 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-neutral-300">
            <button
              type="button"
              onClick={() => setPaperWidth('80mm')}
              className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                paperWidth === '80mm'
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {t.pos.receipt80mm}
            </button>
            <button
              type="button"
              onClick={() => setPaperWidth('58mm')}
              className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                paperWidth === '58mm'
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {t.pos.receipt58mm}
            </button>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-bold text-xs flex items-center gap-2 shadow-md shadow-orange-500/20 active:scale-95 cursor-pointer hover:brightness-105"
          >
            <Printer className="w-4 h-4" />
            <span>{lang === 'th' ? 'พิมพ์ที่อยู่ลูกค้า' : 'Print Address Label'}</span>
          </button>
        </div>

        {/* Printable Label Area */}
        <div className="modal-body bg-neutral-200/70 flex justify-center">
          <div
            id="printable-thermal-receipt"
            className={`bg-white p-4 shadow-md text-neutral-900 font-mono text-xs border border-neutral-300 rounded-lg leading-relaxed ${
              paperWidth === '80mm' ? 'w-[320px]' : 'w-[250px]'
            }`}
          >
            <div className="text-center pb-2.5 border-b-2 border-dashed border-neutral-500">
              <div className="text-xs font-black border-2 border-neutral-900 rounded-md py-1 px-2 mb-1.5 uppercase tracking-wide">
                {lang === 'th' ? 'DELIVERY • สำหรับติดหน้าถุง' : 'DELIVERY • BAG LABEL'}
              </div>
              <div className="font-bold text-xs">{settings.shopName}</div>
              {settings.shopPhone && (
                <div className="text-[10px] text-neutral-600">
                  {lang === 'th' ? 'โทรร้าน:' : 'Shop Tel:'} {settings.shopPhone}
                </div>
              )}
            </div>

            {/* Meta */}
            <div className="py-2 border-b border-dashed border-neutral-400 text-[11px] space-y-0.5">
              {billNumber && (
                <div className="flex justify-between">
                  <span>{lang === 'th' ? 'เลขที่บิล:' : 'Bill #:'}</span>
                  <span className="font-bold">{billNumber}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>{lang === 'th' ? 'วัน/เวลา:' : 'Date/Time:'}</span>
                <span>
                  {workDate || new Date().toISOString().slice(0, 10)}{' '}
                  {new Date().toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>

            {/* High-Contrast Customer Address Block */}
            <div className="py-3 border-b-2 border-dashed border-neutral-500 space-y-2">
              <div>
                <div className="text-[10px] uppercase text-neutral-500 font-bold">
                  {lang === 'th' ? 'ผู้รับ (Customer):' : 'Recipient:'}
                </div>
                <div className="text-sm font-black text-neutral-950">
                  {customerName || (lang === 'th' ? 'ไม่ระบุชื่อ' : 'Unspecified')}
                </div>
              </div>

              {customerPhone && (
                <div>
                  <div className="text-[10px] uppercase text-neutral-500 font-bold">
                    {lang === 'th' ? 'เบอร์โทร (Tel):' : 'Phone:'}
                  </div>
                  <div className="text-sm font-black text-neutral-950 tabular-nums">
                    {customerPhone}
                  </div>
                </div>
              )}

              <div>
                <div className="text-[10px] uppercase text-neutral-500 font-bold">
                  {lang === 'th' ? 'ที่อยู่จัดส่ง (Address):' : 'Delivery Address:'}
                </div>
                <div className="text-sm font-black text-neutral-950 whitespace-pre-wrap break-words leading-snug border border-neutral-400 rounded-md p-2 mt-0.5">
                  {deliveryAddress || (lang === 'th' ? 'ไม่ระบุที่อยู่' : 'No address')}
                </div>
              </div>
            </div>

            {/* Order Items Verification Summary */}
            {items.length > 0 && (
              <div className="py-2.5 border-b border-dashed border-neutral-400 space-y-1 text-[11px]">
                <div className="flex justify-between font-bold">
                  <span>{lang === 'th' ? 'รายการอาหาร:' : 'Order Items:'}</span>
                  <span>
                    {totalItemCount} {lang === 'th' ? 'รายการ' : 'items'}
                  </span>
                </div>
                {items.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-[10px] gap-2">
                    <span className="truncate">
                      {item.quantity}x {item.dishName}
                      {item.variantName && item.variantName !== 'Standard'
                        ? ` (${item.variantName})`
                        : ''}
                    </span>
                    <span className="shrink-0 font-semibold">
                      ฿{formatMoney(item.unitPrice * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Total & Payment Status */}
            {typeof grandTotal === 'number' && (
              <div className="pt-2.5 text-xs space-y-1">
                <div className="flex justify-between font-black text-sm">
                  <span>{lang === 'th' ? 'ยอดรวม:' : 'TOTAL:'}</span>
                  <span>฿{formatMoney(grandTotal)}</span>
                </div>
                <div className="text-center text-[11px] font-bold border border-neutral-400 rounded py-0.5">
                  {status === 'paid'
                    ? lang === 'th'
                      ? 'ชำระเงินเรียบร้อยแล้ว (PAID)'
                      : 'PAID'
                    : lang === 'th'
                    ? 'รอเก็บเงินปลายทาง / ยังไม่ชำระ'
                    : 'COLLECT ON DELIVERY / UNPAID'}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer bg-white border-t border-neutral-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-neutral-200 hover:bg-neutral-300 text-neutral-800 rounded-xl text-xs font-bold cursor-pointer"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
};
