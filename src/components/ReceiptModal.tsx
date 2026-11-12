import React, { useState } from 'react';
import { BillDoc, SettingsDoc, Language } from '../types';
import { translations } from '../i18n/translations';
import { formatMoney } from '../engine/calculations';
import { Printer, X, FileText, CheckCircle2 } from 'lucide-react';

interface Props {
  bill: BillDoc;
  settings: SettingsDoc;
  lang: Language;
  onClose: () => void;
  isCheckReceipt?: boolean; // When printing check before paying
}

export const ReceiptModal: React.FC<Props> = ({
  bill,
  settings,
  lang,
  onClose,
  isCheckReceipt = false,
}) => {
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>('80mm');
  const t = translations[lang];

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col border border-orange-200 overflow-hidden">
        {/* Modal Top Bar */}
        <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-200" />
            <h3 className="font-extrabold text-base">
              {isCheckReceipt ? t.pos.printCheckReceipt : t.bills.reprintReceipt} - {bill.billNumber}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Paper Format Selector & Print Action */}
        <div className="p-3 bg-neutral-100 border-b border-neutral-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-neutral-300">
            <button
              onClick={() => setPaperWidth('80mm')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                paperWidth === '80mm'
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {t.pos.receipt80mm}
            </button>
            <button
              onClick={() => setPaperWidth('58mm')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                paperWidth === '58mm'
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {t.pos.receipt58mm}
            </button>
          </div>

          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-bold text-xs flex items-center gap-2 shadow-md shadow-orange-500/20 active:scale-95 cursor-pointer hover:brightness-105"
          >
            <Printer className="w-4 h-4" />
            <span>{t.common.print}</span>
          </button>
        </div>

        {/* Thermal Receipt Preview Area */}
        <div className="flex-1 overflow-y-auto p-4 bg-neutral-200/70 flex justify-center">
          <div
            id="printable-thermal-receipt"
            className={`bg-white p-4 shadow-md text-neutral-900 font-mono text-xs border border-neutral-300 rounded-lg leading-relaxed select-none ${
              paperWidth === '80mm' ? 'w-[320px]' : 'w-[250px]'
            }`}
          >
            {/* Header info */}
            <div className="text-center pb-3 border-b border-dashed border-neutral-400">
              {isCheckReceipt && (
                <div className="text-[11px] font-bold text-orange-600 border border-orange-400 rounded-md py-0.5 mb-1.5 uppercase">
                  *** CHECK RECEIPT / ใบตรวจสอบยอด ***
                </div>
              )}
              {bill.status === 'voided' && (
                <div className="text-[11px] font-bold text-rose-600 border border-rose-400 rounded-md py-0.5 mb-1.5 uppercase">
                  *** VOIDED BILL / บิลนี้ถูกยกเลิก ***
                </div>
              )}
              <h2 className="text-sm font-bold tracking-tight">{settings.shopName}</h2>
              {settings.shopAddress && <p className="text-[10px] text-neutral-600">{settings.shopAddress}</p>}
              {settings.shopPhone && <p className="text-[10px] text-neutral-600">Tel: {settings.shopPhone}</p>}
              {settings.taxId && <p className="text-[10px] text-neutral-600">TAX ID: {settings.taxId}</p>}
              {settings.receiptHeader && (
                <p className="text-[10px] text-neutral-700 italic mt-1">{settings.receiptHeader}</p>
              )}
            </div>

            {/* Bill Meta */}
            <div className="py-2.5 border-b border-dashed border-neutral-400 text-[11px] space-y-0.5">
              <div className="flex justify-between">
                <span>Bill #:</span>
                <span className="font-bold">{bill.billNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Date:</span>
                <span>{bill.workDate} {new Date(bill.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="flex justify-between">
                <span>Table:</span>
                <span className="font-bold">{bill.tableName || bill.tableId || 'Takeaway/Online'}</span>
              </div>
              <div className="flex justify-between">
                <span>Channel:</span>
                <span>{bill.channelName}</span>
              </div>
              {bill.memberName && (
                <div className="flex justify-between text-orange-700 font-semibold">
                  <span>Member:</span>
                  <span>{bill.memberName}</span>
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="py-2.5 border-b border-dashed border-neutral-400 space-y-2">
              {bill.items.map((item, idx) => {
                const itemTotal = item.unitPrice * item.quantity;
                return (
                  <div key={idx} className="text-[11px]">
                    <div className="flex justify-between items-start font-medium">
                      <span className="flex-1 pr-2">
                        {item.dishName}
                        {item.variantName && item.variantName !== 'Standard' && (
                          <span className="text-neutral-500"> ({item.variantName})</span>
                        )}
                      </span>
                      <span className="text-right whitespace-nowrap font-bold">
                        {item.quantity} x {formatMoney(item.unitPrice)} = {formatMoney(itemTotal)}
                      </span>
                    </div>

                    {/* Options */}
                    {item.options && item.options.length > 0 && (
                      <div className="pl-2 text-[10px] text-neutral-600">
                        {item.options.map((opt, oIdx) => (
                          <div key={oIdx} className="flex justify-between">
                            <span>+ {opt.choiceName}</span>
                            {opt.price > 0 && <span>+{formatMoney(opt.price)}</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Notes */}
                    {item.notes && (
                      <div className="pl-2 text-[10px] text-amber-700 italic">
                        * {item.notes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Totals Calculation */}
            <div className="py-2.5 border-b border-dashed border-neutral-400 text-[11px] space-y-1">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatMoney(bill.subtotal)}</span>
              </div>
              {bill.discountAmount > 0 && (
                <div className="flex justify-between text-rose-600">
                  <span>Discount:</span>
                  <span>-{formatMoney(bill.discountAmount)}</span>
                </div>
              )}
              {bill.serviceChargeAmount > 0 && (
                <div className="flex justify-between">
                  <span>Service Charge ({bill.serviceChargeRate}%):</span>
                  <span>{formatMoney(bill.serviceChargeAmount)}</span>
                </div>
              )}
              {bill.vatAmount > 0 && (
                <div className="flex justify-between">
                  <span>VAT ({bill.vatRate}%):</span>
                  <span>{formatMoney(bill.vatAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold pt-1 border-t border-neutral-400">
                <span>TOTAL:</span>
                <span>฿{formatMoney(bill.grandTotal)}</span>
              </div>
            </div>

            {/* Payments breakdown */}
            {bill.payments && bill.payments.length > 0 && (
              <div className="py-2 border-b border-dashed border-neutral-400 text-[10px] space-y-0.5">
                <span className="font-bold">Payment Methods:</span>
                {bill.payments.map((p, idx) => (
                  <div key={idx} className="flex justify-between pl-1">
                    <span className="capitalize">{p.method}:</span>
                    <span>฿{formatMoney(p.amount)}</span>
                  </div>
                ))}
                {bill.payments.some((p) => p.change && p.change > 0) && (
                  <div className="flex justify-between pl-1 font-bold text-neutral-800">
                    <span>Change:</span>
                    <span>฿{formatMoney(bill.payments.find((p) => p.change)?.change)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Points info */}
            {bill.pointsEarned && bill.pointsEarned > 0 && (
              <div className="py-1 border-b border-dashed border-neutral-400 text-[10px] text-center text-orange-700">
                Earned +{bill.pointsEarned} loyalty points!
              </div>
            )}

            {/* Footer info */}
            <div className="pt-3 text-center text-[10px] text-neutral-600 space-y-1">
              {settings.receiptFooter && <p>{settings.receiptFooter}</p>}
              <p className="text-[9px] text-neutral-400">KinPOS Engine - Cloud Verified</p>
            </div>
          </div>
        </div>

        {/* Modal Bottom Close */}
        <div className="p-3 bg-white border-t border-neutral-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-neutral-200 hover:bg-neutral-300 text-neutral-800 rounded-xl text-xs font-bold cursor-pointer transition-colors"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
};
