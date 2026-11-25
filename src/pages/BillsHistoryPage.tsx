import React, { useState, useEffect } from 'react';
import { BillDoc, BillStatus, SettingsDoc, Language } from '../types';
import { translations } from '../i18n/translations';
import { useLanguage } from '../contexts/LanguageContext';
import { formatMoney, getBusinessWorkDate } from '../engine/calculations';
import { subscribeBillsWithFilter, voidBillAtomic } from '../data/db';
import { ReceiptModal } from '../components/ReceiptModal';
import { DeliveryAddressModal } from '../components/DeliveryAddressModal';
import {
  Receipt,
  Printer,
  Ban,
  Eye,
  ChevronLeft,
  ChevronRight,
  X,
  MapPin,
} from 'lucide-react';

interface Props {
  settings: SettingsDoc;
  lang?: Language;
}

type DatePreset = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'custom';

export const BillsHistoryPage: React.FC<Props> = ({ settings, lang: propLang }) => {
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const t = translations[lang];

  // Filters state
  const [statusFilter, setStatusFilter] = useState<BillStatus | 'all'>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customDate, setCustomDate] = useState<string>(
    getBusinessWorkDate(new Date(), settings.dailyClosingTime)
  );

  // Paged bills state
  const [bills, setBills] = useState<BillDoc[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Viewing / Reprinting / Voiding modal state
  const [selectedBillForDetails, setSelectedBillForDetails] = useState<BillDoc | null>(null);
  const [receiptBillToView, setReceiptBillToView] = useState<BillDoc | null>(null);
  const [addressBillToPrint, setAddressBillToPrint] = useState<BillDoc | null>(null);
  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [billToVoid, setBillToVoid] = useState<BillDoc | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isSubmittingVoid, setIsSubmittingVoid] = useState(false);

  // Compute date range
  const getDateRange = (): { startDate: string; endDate: string } => {
    const today = getBusinessWorkDate(new Date(), settings.dailyClosingTime);

    if (datePreset === 'today') {
      return { startDate: today, endDate: today };
    }
    if (datePreset === 'yesterday') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const yest = getBusinessWorkDate(d, settings.dailyClosingTime);
      return { startDate: yest, endDate: yest };
    }
    if (datePreset === 'last7') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      const past7 = getBusinessWorkDate(d, settings.dailyClosingTime);
      return { startDate: past7, endDate: today };
    }
    if (datePreset === 'thisMonth') {
      const d = new Date();
      const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      return { startDate: monthStart, endDate: today };
    }
    // Custom single date
    return { startDate: customDate, endDate: customDate };
  };

  const loadFilteredBills = async () => {
    // Handled continuously in real time by Firestore onSnapshot listener
  };

  useEffect(() => {
    setIsLoading(true);
    const { startDate, endDate } = getDateRange();
    const unsub = subscribeBillsWithFilter(
      {
        status: statusFilter,
        startDate,
        endDate,
        limitCount: 100,
      },
      (data) => {
        setBills(data);
        setPage(1);
        setIsLoading(false);
      },
      (err) => {
        console.error('Error subscribing bills:', err);
        setIsLoading(false);
      }
    );
    return () => unsub();
  }, [statusFilter, datePreset, customDate]);

  const handleConfirmVoid = async () => {
    if (!billToVoid || !voidReason.trim()) return;
    setIsSubmittingVoid(true);
    try {
      await voidBillAtomic(billToVoid.id, voidReason.trim());
      setIsVoidModalOpen(false);
      setBillToVoid(null);
      setVoidReason('');
      loadFilteredBills();
    } catch (err) {
      console.error('Void error:', err);
    } finally {
      setIsSubmittingVoid(false);
    }
  };

  // Pagination slice
  const paginatedBills = bills.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.ceil(bills.length / pageSize) || 1;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4 select-none">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight flex items-center gap-2">
          <Receipt className="w-6 h-6 text-orange-600" />
          <span>{t.bills.title}</span>
        </h2>
      </div>

      {/* Filter Bar */}
      <div className="p-3.5 bg-white rounded-2xl border border-neutral-200 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Status Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <span className="text-xs font-bold text-neutral-500 mr-1">{t.bills.filterStatus}:</span>
            {[
              { id: 'all', label: t.common.all },
              { id: 'saved', label: lang === 'th' ? 'ค้างชำระ / พักบิล' : 'Saved / Unpaid' },
              { id: 'paid', label: t.bills.statusPaid },
              { id: 'voided', label: t.bills.statusVoided },
            ].map((st) => (
              <button
                key={st.id}
                onClick={() => setStatusFilter(st.id as BillStatus | 'all')}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  statusFilter === st.id
                    ? 'bg-orange-500 text-white shadow-2xs'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {/* Date Range Presets */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <span className="text-xs font-bold text-neutral-500 mr-1">{t.bills.filterDate}:</span>
            {[
              { id: 'today', label: t.bills.today },
              { id: 'yesterday', label: t.bills.yesterday },
              { id: 'last7', label: t.bills.last7Days },
              { id: 'thisMonth', label: t.bills.thisMonth },
              { id: 'custom', label: t.bills.customDate },
            ].map((dp) => (
              <button
                key={dp.id}
                onClick={() => setDatePreset(dp.id as DatePreset)}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  datePreset === dp.id
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-2xs'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                {dp.label}
              </button>
            ))}

            {datePreset === 'custom' && (
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="px-2 py-1 text-xs bg-white border border-neutral-300 rounded-lg text-neutral-800"
              />
            )}
          </div>
        </div>
      </div>

      {/* Bills Table */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-bold uppercase text-[10px]">
              <tr>
                <th className="p-3">{t.bills.billNo}</th>
                <th className="p-3">{t.bills.time} / {t.common.date}</th>
                <th className="p-3">{t.bills.table}</th>
                <th className="p-3">{lang === 'th' ? 'ช่องทาง' : 'Channel'}</th>
                <th className="p-3">{t.common.status}</th>
                <th className="p-3 text-right">{t.common.total}</th>
                <th className="p-3 text-right">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 font-medium">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-neutral-500">
                    {t.common.loading}
                  </td>
                </tr>
              ) : paginatedBills.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-neutral-400">
                    {t.common.noData}
                  </td>
                </tr>
              ) : (
                paginatedBills.map((bill) => {
                  const isPaid = bill.status === 'paid';
                  const isVoided = bill.status === 'voided';

                  return (
                    <tr
                      key={bill.id}
                      className={`hover:bg-neutral-50 ${isVoided ? 'bg-rose-50/40 opacity-75' : ''}`}
                    >
                      <td className="p-3 font-mono font-bold text-neutral-900">
                        {bill.billNumber || (lang === 'th' ? 'ยังไม่บันทึก' : 'Unsaved')}
                      </td>
                      <td className="p-3 text-neutral-600 whitespace-nowrap">
                        <div>{bill.workDate}</div>
                        <div className="text-[10px] text-neutral-400">
                          {new Date(bill.createdAt).toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </td>
                      <td className="p-3 font-bold text-neutral-800">
                        <div>
                          {bill.tableName ||
                            bill.tableId ||
                            (bill.orderType === 'delivery' ? 'Delivery' : t.pos.takeaway)}
                        </div>
                        {bill.customerName && (
                          <div className="text-[10px] font-medium text-orange-700 truncate max-w-[160px]">
                            {bill.customerName}
                            {bill.customerPhone ? ` (${bill.customerPhone})` : ''}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-neutral-600">{bill.channelName}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            isPaid
                              ? 'bg-emerald-100 text-emerald-800'
                              : isVoided
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {isPaid
                            ? t.bills.statusPaid
                            : isVoided
                            ? t.bills.statusVoided
                            : t.bills.statusSaved}
                        </span>
                      </td>
                      <td className="p-3 text-right font-black text-sm text-neutral-900 whitespace-nowrap">
                        ฿{formatMoney(bill.grandTotal)}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap space-x-1">
                        <button
                          onClick={() => setSelectedBillForDetails(bill)}
                          className="p-1.5 text-neutral-600 hover:text-neutral-900 rounded-lg hover:bg-neutral-100 cursor-pointer"
                          title={t.common.view}
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setReceiptBillToView(bill);
                          }}
                          className="p-1.5 text-neutral-600 hover:text-orange-600 rounded-lg hover:bg-neutral-100 cursor-pointer"
                          title={t.bills.reprintReceipt}
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        {(bill.deliveryAddress || bill.customerName || bill.customerPhone) && (
                          <button
                            onClick={() => setAddressBillToPrint(bill)}
                            className="p-1.5 text-orange-600 hover:text-orange-700 rounded-lg hover:bg-orange-50 cursor-pointer"
                            title={lang === 'th' ? 'พิมพ์ที่อยู่ลูกค้า' : 'Print Customer Address'}
                          >
                            <MapPin className="w-4 h-4" />
                          </button>
                        )}
                        {!isVoided && (
                          <button
                            onClick={() => {
                              setBillToVoid(bill);
                              setVoidReason('');
                              setIsVoidModalOpen(true);
                            }}
                            className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                            title={t.bills.voidBill}
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paging */}
        <div className="p-3 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between text-xs text-neutral-600">
          <span>
            {lang === 'th'
              ? `หน้า ${page} จาก ${totalPages} (ทั้งหมด ${bills.length} บิล)`
              : `Page ${page} of ${totalPages} (${bills.length} total bills)`}
          </span>
          <div className="flex gap-1.5">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1 rounded-lg bg-white border border-neutral-300 disabled:opacity-40 cursor-pointer hover:bg-neutral-100"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1 rounded-lg bg-white border border-neutral-300 disabled:opacity-40 cursor-pointer hover:bg-neutral-100"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bill Details Slide-over Dialog */}
      {selectedBillForDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <div className="modal-panel bg-white rounded-3xl shadow-2xl max-w-lg w-full border border-orange-200">
            <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base">
                  {t.bills.billDetails} - {selectedBillForDetails.billNumber}
                </h3>
                <p className="text-xs text-orange-100">
                  {selectedBillForDetails.workDate} • {selectedBillForDetails.tableName || t.pos.takeaway}
                </p>
              </div>
              <button
                onClick={() => setSelectedBillForDetails(null)}
                className="p-1 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-3">
              {selectedBillForDetails.status === 'voided' && (
                <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 text-xs font-bold space-y-1">
                  <div>{t.bills.voidedBanner}</div>
                  <div className="text-[11px] font-medium text-rose-700">
                    {lang === 'th' ? 'เหตุผล:' : 'Reason:'}{' '}
                    {selectedBillForDetails.voidReason ||
                      (lang === 'th' ? 'ไม่ได้ระบุเหตุผล' : 'No reason specified')}
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    {t.bills.voidedExcludedNote}
                  </div>
                </div>
              )}

              {(selectedBillForDetails.customerName ||
                selectedBillForDetails.customerPhone ||
                selectedBillForDetails.deliveryAddress) && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-xl text-xs space-y-1">
                  <div className="font-extrabold text-orange-900 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-orange-600" />
                    <span>{lang === 'th' ? 'ข้อมูลจัดส่งลูกค้า (Delivery)' : 'Delivery Customer Info'}</span>
                  </div>
                  {selectedBillForDetails.customerName && (
                    <div className="font-bold text-neutral-900">
                      {selectedBillForDetails.customerName}
                      {selectedBillForDetails.customerPhone
                        ? ` • ${selectedBillForDetails.customerPhone}`
                        : ''}
                    </div>
                  )}
                  {selectedBillForDetails.deliveryAddress && (
                    <div className="text-neutral-700 whitespace-pre-wrap break-words">
                      {selectedBillForDetails.deliveryAddress}
                    </div>
                  )}
                </div>
              )}

              {/* Items */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-neutral-700">
                  {lang === 'th' ? 'รายการอาหารที่สั่ง' : 'Ordered Items'}
                </span>
                {selectedBillForDetails.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-neutral-50 rounded-xl border border-neutral-200 text-xs flex justify-between"
                  >
                    <div>
                      <div className="font-bold text-neutral-900">
                        {item.dishName} ({item.variantName})
                      </div>
                      <div className="text-[10px] text-neutral-500">
                        {lang === 'th' ? 'จำนวน:' : 'Qty:'} {item.quantity} x ฿{formatMoney(item.unitPrice)}
                      </div>
                    </div>
                    <div className="font-black text-neutral-900">
                      ฿{formatMoney(item.unitPrice * item.quantity)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="p-3 bg-neutral-100 rounded-xl space-y-1 text-xs">
                <div className="flex justify-between text-neutral-600">
                  <span>{t.pos.subtotal}:</span>
                  <span>฿{formatMoney(selectedBillForDetails.subtotal)}</span>
                </div>
                {selectedBillForDetails.discountAmount > 0 && (
                  <div className="flex justify-between text-rose-600">
                    <span>{t.pos.discount}:</span>
                    <span>-฿{formatMoney(selectedBillForDetails.discountAmount)}</span>
                  </div>
                )}
                {selectedBillForDetails.serviceChargeAmount > 0 && (
                  <div className="flex justify-between text-neutral-600">
                    <span>{t.pos.serviceCharge}:</span>
                    <span>฿{formatMoney(selectedBillForDetails.serviceChargeAmount)}</span>
                  </div>
                )}
                {selectedBillForDetails.vatAmount > 0 && (
                  <div className="flex justify-between text-neutral-600">
                    <span>{t.pos.vat}:</span>
                    <span>฿{formatMoney(selectedBillForDetails.vatAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-black text-neutral-900 pt-1 border-t border-neutral-300">
                  <span>{t.pos.grandTotal}:</span>
                  <span className="text-orange-600">฿{formatMoney(selectedBillForDetails.grandTotal)}</span>
                </div>
              </div>
            </div>

            <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex flex-wrap justify-end gap-2">
              {(selectedBillForDetails.deliveryAddress ||
                selectedBillForDetails.customerName ||
                selectedBillForDetails.customerPhone) && (
                <button
                  onClick={() => {
                    setAddressBillToPrint(selectedBillForDetails);
                  }}
                  className="px-4 py-2 bg-orange-50 text-orange-800 border border-orange-300 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-orange-100"
                >
                  <MapPin className="w-4 h-4 text-orange-600" />
                  <span>{lang === 'th' ? 'พิมพ์ที่อยู่ลูกค้า' : 'Print Address'}</span>
                </button>
              )}
              <button
                onClick={() => {
                  setReceiptBillToView(selectedBillForDetails);
                }}
                className="px-4 py-2 bg-white text-neutral-800 border border-neutral-300 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>{t.bills.reprintReceipt}</span>
              </button>
              <button
                onClick={() => setSelectedBillForDetails(null)}
                className="px-4 py-2 bg-neutral-800 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                {t.common.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void Confirmation Modal with Reason */}
      {isVoidModalOpen && billToVoid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <div className="modal-panel bg-white rounded-3xl shadow-2xl max-w-sm w-full border border-rose-300">
            <div className="modal-header bg-rose-600 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base flex items-center gap-1.5">
                <Ban className="w-5 h-5 text-rose-200" />
                <span>{t.bills.voidBill}</span>
              </h3>
              <button
                onClick={() => setIsVoidModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-3">
              <div className="text-xs text-neutral-600">
                {lang === 'th' ? (
                  <>
                    คุณแน่ใจหรือไม่ว่าต้องการยกเลิกบิล <strong>{billToVoid.billNumber}</strong> (฿
                    {formatMoney(billToVoid.grandTotal)})?
                  </>
                ) : (
                  <>
                    Are you sure you want to void bill <strong>{billToVoid.billNumber}</strong> (฿
                    {formatMoney(billToVoid.grandTotal)})?
                  </>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.bills.voidReasonPrompt}
                </label>
                <textarea
                  rows={2}
                  required
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  className="w-full p-2.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl focus:ring-2 focus:ring-rose-500"
                  placeholder={
                    lang === 'th'
                      ? 'เช่น ลูกค้ายกเลิกออเดอร์, คีย์รายการผิด'
                      : 'e.g. Customer cancelled order, wrong entry'
                  }
                />
              </div>

              <div className="text-[11px] text-rose-600 font-semibold">
                {t.bills.voidedExcludedNote}
              </div>
            </div>

            <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsVoidModalOpen(false)}
                className="px-3 py-1.5 bg-white text-neutral-700 border border-neutral-300 rounded-xl text-xs font-bold cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                disabled={!voidReason.trim() || isSubmittingVoid}
                onClick={handleConfirmVoid}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black shadow-md disabled:opacity-40 cursor-pointer"
              >
                {isSubmittingVoid ? t.common.loading : t.bills.voidBill}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reprint Receipt Modal */}
      {receiptBillToView && (
        <ReceiptModal
          bill={receiptBillToView}
          settings={settings}
          lang={lang}
          onClose={() => setReceiptBillToView(null)}
        />
      )}

      {/* Print Delivery Customer Address Label Modal */}
      {addressBillToPrint && (
        <DeliveryAddressModal
          customerName={addressBillToPrint.customerName || ''}
          customerPhone={addressBillToPrint.customerPhone || ''}
          deliveryAddress={addressBillToPrint.deliveryAddress || ''}
          billNumber={addressBillToPrint.billNumber}
          workDate={addressBillToPrint.workDate}
          items={addressBillToPrint.items}
          grandTotal={addressBillToPrint.grandTotal}
          status={addressBillToPrint.status}
          settings={settings}
          lang={lang}
          onClose={() => setAddressBillToPrint(null)}
        />
      )}
    </div>
  );
};
