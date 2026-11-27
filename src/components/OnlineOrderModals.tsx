import React, { useEffect, useState } from 'react';
import {
  Clock,
  Truck,
  Store,
  QrCode,
  Banknote,
  MapPin,
  Phone,
  X,
  Printer,
  Trash2,
  XCircle,
  FileText,
} from 'lucide-react';
import { Language, OnlineOrderDoc, OnlineOrderStatus, SettingsDoc } from '../types';
import { formatMoney } from '../engine/calculations';
import {
  OnlineOrderDisplayIds,
  resolveNextReadyActionStatus,
  toDateSafe,
} from '../engine/onlineOrdering';

export const ONLINE_STATUS_META: Record<
  OnlineOrderStatus,
  { th: string; en: string; textCls: string; dotCls: string; surfaceCls: string }
> = {
  pending: {
    th: 'รอรับออเดอร์',
    en: 'Pending',
    textCls: 'text-amber-800',
    dotCls: 'bg-amber-600',
    surfaceCls: 'bg-amber-100 text-amber-950 border-amber-400',
  },
  accepted: {
    th: 'กำลังทำอาหาร',
    en: 'Cooking',
    textCls: 'text-orange-700',
    dotCls: 'bg-orange-600',
    surfaceCls: 'bg-orange-100 text-orange-950 border-orange-400',
  },
  preparing: {
    th: 'กำลังทำอาหาร',
    en: 'Cooking',
    textCls: 'text-orange-700',
    dotCls: 'bg-orange-600',
    surfaceCls: 'bg-orange-100 text-orange-950 border-orange-400',
  },
  ready_for_pickup: {
    th: 'กำลังไปส่ง',
    en: 'On The Way',
    textCls: 'text-teal-800',
    dotCls: 'bg-teal-600',
    surfaceCls: 'bg-teal-100 text-teal-950 border-teal-500',
  },
  out_for_delivery: {
    th: 'กำลังจัดส่ง',
    en: 'Out for Delivery',
    textCls: 'text-teal-800',
    dotCls: 'bg-teal-600',
    surfaceCls: 'bg-teal-100 text-teal-950 border-teal-500',
  },
  completed: {
    th: 'สำเร็จแล้ว',
    en: 'Completed',
    textCls: 'text-emerald-800',
    dotCls: 'bg-emerald-600',
    surfaceCls: 'bg-emerald-100 text-emerald-950 border-emerald-400',
  },
  cancelled: {
    th: 'ยกเลิกแล้ว',
    en: 'Cancelled',
    textCls: 'text-rose-800',
    dotCls: 'bg-rose-600',
    surfaceCls: 'bg-rose-100 text-rose-950 border-rose-400',
  },
};

interface DetailModalProps {
  order: OnlineOrderDoc;
  displayIds?: OnlineOrderDisplayIds;
  lang: Language;
  completeLabel?: { th: string; en: string };
  onClose: () => void;
  onStatusChange: (order: OnlineOrderDoc, nextStatus: OnlineOrderStatus) => Promise<void> | void;
  onPrint: (order: OnlineOrderDoc) => void;
  onDelete?: (order: OnlineOrderDoc) => void;
}

export const OnlineOrderDetailModal: React.FC<DetailModalProps> = ({
  order,
  displayIds,
  lang,
  completeLabel,
  onClose,
  onStatusChange,
  onPrint,
  onDelete,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const statusMeta = ONLINE_STATUS_META[order.status] || ONLINE_STATUS_META.pending;

  const triggerStatus = async (
    nextStatus: OnlineOrderStatus,
    closeAfter: boolean = false
  ) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onStatusChange(order, nextStatus);
      if (closeAfter) {
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-panel bg-white w-full sm:max-w-xl sm:rounded-2xl rounded-t-2xl border border-slate-200 shadow-2xl"
      >
        <div className="modal-header border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h3 className="text-2xl font-black tracking-tight text-slate-900 uppercase tabular-nums">
                {displayIds?.displayNumber || order.orderNumber}
              </h3>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-black px-2.5 py-1 rounded-lg border-2 shadow-2xs ${statusMeta.surfaceCls}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${statusMeta.dotCls}`} />
                <span>{statusMeta[lang]}</span>
              </span>
            </div>
            <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
              <span className="font-mono font-semibold text-slate-700 tabular-nums">
                {lang === 'th' ? 'เลขอ้างอิง:' : 'Ref:'}{' '}
                {displayIds?.referenceNumber || order.orderNumber}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {(() => {
                  const d = toDateSafe(order.createdAt);
                  return d
                    ? d.toLocaleString('th-TH', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '-';
                })()}
              </span>
              {order.pnlSyncedAt && order.status === 'completed' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-700 font-semibold">✓ In P&amp;L</span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={lang === 'th' ? 'ปิดหน้าต่าง' : 'Close modal'}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          {/* Customer & Delivery Details */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-sm text-slate-900">{order.customerName}</span>
              <a
                href={`tel:${order.customerPhone}`}
                className="text-orange-600 hover:text-orange-700 font-semibold inline-flex items-center gap-1 tabular-nums"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>{order.customerPhone}</span>
              </a>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-600">
              <span className="inline-flex items-center gap-1 font-semibold">
                {order.orderMode === 'delivery' ? (
                  <>
                    <Truck className="w-3.5 h-3.5 text-orange-600" />
                    <span>{lang === 'th' ? 'เดลิเวอรี' : 'Delivery'}</span>
                  </>
                ) : (
                  <>
                    <Store className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{lang === 'th' ? 'รับเองที่ร้าน' : 'Self-Pickup'}</span>
                  </>
                )}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-semibold">
                {order.paymentMethod === 'qr_payment' ? (
                  <>
                    <QrCode className="w-3.5 h-3.5 text-sky-600" />
                    <span>QR PromptPay</span>
                  </>
                ) : (
                  <>
                    <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{lang === 'th' ? 'เงินสด' : 'Cash'}</span>
                  </>
                )}
              </span>
              {order.riderName && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-teal-700 font-bold">Rider: {order.riderName}</span>
                </>
              )}
            </div>

            {order.deliveryAddress && (
              <div className="text-slate-700 flex items-start gap-1.5 pt-0.5">
                <MapPin className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
                <span>{order.deliveryAddress}</span>
              </div>
            )}
            {order.customerNote && (
              <div className="text-amber-700 font-semibold">* {order.customerNote}</div>
            )}
          </div>

          {/* Ordered Dishes Breakdown */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-500">
              {lang === 'th' ? 'รายการอาหารที่สั่ง' : 'Order Items'}
            </div>
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
              {order.items.map((it, idx) => (
                <div key={idx} className="px-3.5 py-2.5 flex justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">
                      <span className="font-bold tabular-nums">{it.quantity}x</span> {it.dishName}
                      {it.variantName && it.variantName !== 'Standard' && (
                        <span className="text-slate-500 font-normal"> ({it.variantName})</span>
                      )}
                    </div>
                    {it.options?.length > 0 && (
                      <div className="text-[11px] text-slate-500 pl-4 mt-0.5">
                        +{' '}
                        {it.options
                          .map((op) =>
                            op.quantity && op.quantity > 1
                              ? `${op.choiceName} x${op.quantity}`
                              : op.choiceName
                          )
                          .join(', ')}
                      </div>
                    )}
                    {it.notes && (
                      <div className="text-[11px] text-amber-700 pl-4 mt-0.5">* {it.notes}</div>
                    )}
                  </div>
                  <div className="font-bold text-slate-900 tabular-nums shrink-0">
                    ฿{formatMoney(it.unitPrice * it.quantity)}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1 text-xs">
              {order.deliveryFee > 0 && (
                <>
                  <div className="flex justify-between text-slate-600 tabular-nums">
                    <span>{lang === 'th' ? 'ยอดรวมค่าอาหาร' : 'Food Subtotal'}</span>
                    <span>฿{formatMoney(order.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 tabular-nums">
                    <span>{lang === 'th' ? 'ค่าบริการจัดส่ง' : 'Delivery Fee'}</span>
                    <span>฿{formatMoney(order.deliveryFee)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between items-center font-extrabold text-sm text-slate-900 pt-1">
                <span>{lang === 'th' ? 'ยอดรวมสุทธิ' : 'Total'}</span>
                <span className="text-orange-600 tabular-nums">
                  ฿{formatMoney(order.totalAmount)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {order.status === 'pending' && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => triggerStatus('accepted')}
                className="px-3.5 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {lang === 'th' ? 'รับออเดอร์' : 'Accept Order'}
              </button>
            )}
            {(order.status === 'accepted' || order.status === 'preparing') && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() =>
                  triggerStatus(resolveNextReadyActionStatus(order.orderMode), true)
                }
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {completeLabel
                  ? completeLabel[lang]
                  : lang === 'th'
                  ? 'เสร็จแล้ว / พร้อมส่ง'
                  : 'Done / Ready'}
              </button>
            )}
            {order.orderMode === 'delivery' && order.status === 'ready_for_pickup' && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => triggerStatus('out_for_delivery')}
                className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {lang === 'th' ? 'กำลังไปส่ง (On The Way)' : 'กำลังไปส่ง (On The Way)'}
              </button>
            )}
            {order.orderMode === 'delivery' && order.status === 'out_for_delivery' && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => triggerStatus('completed', true)}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {lang === 'th' ? 'ส่งสำเร็จ (เข้า P&L)' : 'Delivered (Sync P&L)'}
              </button>
            )}
            {order.status !== 'completed' && order.status !== 'cancelled' && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => triggerStatus('cancelled', true)}
                className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>{lang === 'th' ? 'ยกเลิก' : 'Cancel'}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onPrint(order)}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-900 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-orange-600" />
              <span>{lang === 'th' ? 'พิมพ์ใบรายการ' : 'Print Order Slip'}</span>
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(order)}
                className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 cursor-pointer"
                title={lang === 'th' ? 'ลบออเดอร์' : 'Delete order'}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface ReceiptModalProps {
  order: OnlineOrderDoc;
  displayIds?: OnlineOrderDisplayIds;
  settings: SettingsDoc;
  lang: Language;
  autoPrint?: boolean;
  silentAutoPrint?: boolean;
  onClose: () => void;
}

export const OnlineOrderReceiptModal: React.FC<ReceiptModalProps> = ({
  order,
  displayIds,
  settings,
  lang,
  autoPrint = false,
  silentAutoPrint = false,
  onClose,
}) => {
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>('80mm');

  useEffect(() => {
    if (!autoPrint && !silentAutoPrint) return;

    let cleanedUp = false;
    const handleAfterPrint = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (silentAutoPrint) onClose();
    };

    if (silentAutoPrint) {
      window.addEventListener('afterprint', handleAfterPrint);
    }

    const timer = window.setTimeout(() => {
      try {
        window.print();
      } catch {
        // Ignore print failures in restricted embedded environments
      }
      if (silentAutoPrint) {
        // Fallback cleanup if afterprint event doesn't fire in embedded WebViews
        window.setTimeout(handleAfterPrint, 1200);
      }
    }, 150);

    return () => {
      window.clearTimeout(timer);
      if (silentAutoPrint) {
        window.removeEventListener('afterprint', handleAfterPrint);
      }
    };
  }, [autoPrint, silentAutoPrint, order.id, onClose]);

  const printableReceiptMarkup = (
    <div
      id="printable-thermal-receipt"
      className={`bg-white p-4 text-neutral-900 font-mono text-xs border border-neutral-300 rounded-lg leading-relaxed ${
        paperWidth === '80mm' ? 'w-[320px]' : 'w-[250px]'
      }`}
    >
      <div className="text-center pb-3 border-b border-dashed border-neutral-400">
        <h2 className="text-sm font-bold">{settings.shopName}</h2>
        {settings.shopAddress && <p className="text-[10px]">{settings.shopAddress}</p>}
        {settings.shopPhone && <p className="text-[10px]">Tel: {settings.shopPhone}</p>}
        <p className="text-[10px] font-bold mt-1">
          *** ONLINE {order.orderMode === 'delivery' ? 'DELIVERY' : 'PICKUP'} ***
        </p>
      </div>

      <div className="py-2 border-b border-dashed border-neutral-400 text-[11px] space-y-0.5">
        <div className="flex justify-between">
          <span>Order #:</span>
          <span className="font-bold text-sm">
            {displayIds?.displayNumber || order.orderNumber}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Ref #:</span>
          <span className="font-bold">
            {displayIds?.referenceNumber || order.orderNumber}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Customer:</span>
          <span className="font-bold">{order.customerName}</span>
        </div>
        <div className="flex justify-between">
          <span>Phone:</span>
          <span>{order.customerPhone}</span>
        </div>
        {order.deliveryAddress && (
          <div className="text-[10px] pt-0.5">
            <span>Address: {order.deliveryAddress}</span>
          </div>
        )}
        {order.customerNote && (
          <div className="text-[10px] pt-0.5 font-bold">
            <span>Note: {order.customerNote}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Payment:</span>
          <span>{order.paymentMethod === 'qr_payment' ? 'QR PromptPay' : 'Cash'}</span>
        </div>
      </div>

      <div className="py-2.5 border-b border-dashed border-neutral-400 space-y-1.5 text-[11px]">
        {order.items.map((item, idx) => (
          <div key={idx}>
            <div className="flex justify-between font-medium">
              <span className="pr-2">
                {item.quantity}x {item.dishName}
                {item.variantName && item.variantName !== 'Standard'
                  ? ` (${item.variantName})`
                  : ''}
              </span>
              <span className="font-bold tabular-nums">
                {formatMoney(item.unitPrice * item.quantity)}
              </span>
            </div>
            {item.options?.map((opt, oi) => (
              <div key={oi} className="pl-3 text-[10px] text-neutral-600">
                + {opt.choiceName}
                {opt.quantity && opt.quantity > 1 ? ` x${opt.quantity}` : ''}
              </div>
            ))}
            {item.notes && <div className="pl-3 text-[10px] italic">* {item.notes}</div>}
          </div>
        ))}
      </div>

      <div className="py-2 text-[11px] space-y-1">
        <div className="flex justify-between">
          <span>Subtotal:</span>
          <span>{formatMoney(order.subtotal)}</span>
        </div>
        {order.deliveryFee > 0 && (
          <div className="flex justify-between">
            <span>Delivery Fee:</span>
            <span>{formatMoney(order.deliveryFee)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm font-bold pt-1 border-t border-neutral-400">
          <span>TOTAL:</span>
          <span>฿{formatMoney(order.totalAmount)}</span>
        </div>
      </div>

      <div className="pt-2 text-center text-[10px] text-neutral-500">
        {settings.receiptFooter || 'Thank you!'}
      </div>
    </div>
  );

  if (silentAutoPrint) {
    return (
      <div
        className="fixed -left-[9999px] top-0 pointer-events-none print:static print:left-0 print:top-0"
        aria-hidden="true"
      >
        {printableReceiptMarkup}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-950/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col border border-orange-200 overflow-hidden"
      >
        <div className="p-4 bg-orange-600 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-5 h-5 shrink-0" />
            <h3 className="font-extrabold text-base truncate">
              {lang === 'th' ? 'พิมพ์ใบรายการออเดอร์' : 'Order Slip'} ·{' '}
              {displayIds?.displayNumber || order.orderNumber}
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

        <div className="p-3 bg-slate-100 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-300">
            <button
              type="button"
              onClick={() => setPaperWidth('80mm')}
              className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                paperWidth === '80mm' ? 'bg-orange-500 text-white' : 'text-slate-600'
              }`}
            >
              80mm
            </button>
            <button
              type="button"
              onClick={() => setPaperWidth('58mm')}
              className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                paperWidth === '58mm' ? 'bg-orange-500 text-white' : 'text-slate-600'
              }`}
            >
              58mm
            </button>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 bg-orange-600 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>{lang === 'th' ? 'พิมพ์ใบรายการ' : 'Print'}</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-slate-200/70 flex justify-center">
          {printableReceiptMarkup}
        </div>
      </div>
    </div>
  );
};
