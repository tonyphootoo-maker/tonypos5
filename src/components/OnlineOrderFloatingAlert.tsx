import React, { useEffect, useState } from 'react';
import {
  BellRing,
  Phone,
  MapPin,
  Truck,
  Store,
  QrCode,
  Banknote,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Check,
  Clock,
} from 'lucide-react';
import { Language, OnlineOrderDoc } from '../types';
import { OnlineOrderDisplayIds, toDateSafe } from '../engine/onlineOrdering';
import { formatMoney } from '../engine/calculations';

interface Props {
  pendingOrders: OnlineOrderDoc[];
  orderNumberingMap: Map<string, OnlineOrderDisplayIds>;
  lang: Language;
  isOnOnlineOrdersPage: boolean;
  acceptingOrderId: string | null;
  errorMsg?: string | null;
  onAcceptOrder: (order: OnlineOrderDoc) => Promise<void>;
  onOpenOnlineOrdersPage?: () => void;
}

export const OnlineOrderFloatingAlert: React.FC<Props> = ({
  pendingOrders,
  orderNumberingMap,
  lang,
  isOnOnlineOrdersPage,
  acceptingOrderId,
  errorMsg,
  onAcceptOrder,
  onOpenOnlineOrdersPage,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (pendingOrders.length === 0) {
      setActiveIndex(0);
      return;
    }
    if (activeIndex >= pendingOrders.length) {
      setActiveIndex(pendingOrders.length - 1);
    }
  }, [pendingOrders.length, activeIndex]);

  if (pendingOrders.length === 0) return null;

  const safeIdx = Math.min(activeIndex, pendingOrders.length - 1);
  const order = pendingOrders[safeIdx];
  if (!order) return null;

  const displayIds = orderNumberingMap.get(order.id);
  const isBusy = acceptingOrderId === order.id;
  const createdDate = toDateSafe(order.createdAt);

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={lang === 'th' ? 'แจ้งเตือนออเดอร์ออนไลน์ใหม่' : 'New online order alert'}
      className={`fixed z-[60] top-16 sm:top-20 w-[calc(100vw-1.5rem)] max-w-md ${
        isOnOnlineOrdersPage
          ? 'left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:right-5'
          : 'left-1/2 -translate-x-1/2'
      }`}
    >
      <div className="bg-white rounded-2xl border-2 border-red-500 shadow-[0_24px_60px_-12px_rgba(220,38,38,0.42)] overflow-hidden flex flex-col max-h-[80dvh]">
        {/* High-Visibility Red Alert Header */}
        <div className="px-4 py-3 bg-red-600 text-white flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <BellRing className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold leading-tight truncate">
                {lang === 'th' ? 'มีออเดอร์ออนไลน์ใหม่เข้ามา!' : 'New Online Order Arrived!'}
              </div>
              <div className="text-[11px] text-red-100 font-medium">
                {lang === 'th'
                  ? 'กรุณากดรับออเดอร์เพื่อส่งเข้าโซน ONLINE'
                  : 'Accept order to add it to ONLINE zone'}
              </div>
            </div>
          </div>

          {pendingOrders.length > 1 && (
            <div className="flex items-center gap-1 bg-white/15 rounded-lg px-1.5 py-1 shrink-0 text-xs font-bold tabular-nums">
              <button
                type="button"
                onClick={() =>
                  setActiveIndex((prev) => (prev - 1 + pendingOrders.length) % pendingOrders.length)
                }
                aria-label={lang === 'th' ? 'ออเดอร์ก่อนหน้า' : 'Previous order'}
                className="p-0.5 hover:bg-white/20 rounded cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-1">
                {safeIdx + 1}/{pendingOrders.length}
              </span>
              <button
                type="button"
                onClick={() => setActiveIndex((prev) => (prev + 1) % pendingOrders.length)}
                aria-label={lang === 'th' ? 'ออเดอร์ถัดไป' : 'Next order'}
                className="p-0.5 hover:bg-white/20 rounded cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Scrollable Order Summary Body */}
        <div className="p-4 space-y-3 overflow-y-auto overscroll-contain">
          {/* Two-part Order ID + Mode & Payment */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-2xl font-black tracking-tight text-slate-900 uppercase tabular-nums leading-none">
                {displayIds?.displayNumber || order.orderNumber}
              </div>
              <div className="text-xs font-mono text-slate-500 tabular-nums mt-1">
                {lang === 'th' ? 'เลขอ้างอิง:' : 'Ref:'}{' '}
                <span className="font-semibold text-slate-700">
                  {displayIds?.referenceNumber || order.orderNumber}
                </span>
              </div>
            </div>

            <div className="text-right space-y-1 shrink-0 text-xs">
              <div className="font-bold text-slate-800 inline-flex items-center gap-1">
                {order.orderMode === 'delivery' ? (
                  <>
                    <Truck className="w-3.5 h-3.5 text-orange-600" />
                    <span>{lang === 'th' ? 'เดลิเวอรี' : 'Delivery'}</span>
                  </>
                ) : (
                  <>
                    <Store className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{lang === 'th' ? 'รับเองที่ร้าน' : 'Pickup'}</span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-end gap-1">
                {order.paymentMethod === 'qr_payment' ? (
                  <>
                    <QrCode className="w-3 h-3 text-sky-600" />
                    <span>QR PromptPay</span>
                  </>
                ) : (
                  <>
                    <Banknote className="w-3 h-3 text-emerald-600" />
                    <span>{lang === 'th' ? 'เงินสด' : 'Cash'}</span>
                  </>
                )}
                {createdDate && (
                  <>
                    <span aria-hidden="true">·</span>
                    <Clock className="w-3 h-3" />
                    <span className="tabular-nums">
                      {createdDate.toLocaleTimeString('th-TH', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Customer Info */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-sm text-slate-900 truncate">{order.customerName}</span>
              <a
                href={`tel:${order.customerPhone}`}
                className="text-orange-600 hover:text-orange-700 font-semibold inline-flex items-center gap-1 shrink-0 tabular-nums"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>{order.customerPhone}</span>
              </a>
            </div>
            {order.deliveryAddress && (
              <div className="flex items-start gap-1.5 text-slate-600">
                <MapPin className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
                <span className="line-clamp-2">{order.deliveryAddress}</span>
              </div>
            )}
            {order.customerNote && (
              <div className="text-amber-700 font-semibold">* {order.customerNote}</div>
            )}
          </div>

          {/* Total Summary (Compact Card without inline food item list) */}
          <div className="flex items-center justify-between px-1 text-sm font-extrabold text-slate-900">
            <span>
              {lang === 'th' ? 'ยอดรวมสุทธิ' : 'Total'}
              <span className="text-[11px] font-semibold text-slate-500 ml-1.5 tabular-nums">
                ({order.items.reduce((sum, item) => sum + (item.quantity || 1), 0)}{' '}
                {lang === 'th' ? 'รายการ' : 'items'}
                {order.deliveryFee > 0
                  ? ` · ${lang === 'th' ? 'รวมค่าส่ง' : 'incl. delivery'} ฿${formatMoney(
                      order.deliveryFee
                    )}`
                  : ''}
                )
              </span>
            </span>
            <span className="text-orange-600 text-base tabular-nums">
              ฿{formatMoney(order.totalAmount)}
            </span>
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Persistent Footer: Accept Order CTA (stays visible until accepted) */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center gap-2 shrink-0">
          {!isOnOnlineOrdersPage && onOpenOnlineOrdersPage && (
            <button
              type="button"
              onClick={onOpenOnlineOrdersPage}
              className="px-3 py-2.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>{lang === 'th' ? 'หน้าออเดอร์' : 'Orders'}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            disabled={isBusy}
            onClick={() => onAcceptOrder(order)}
            className="flex-1 py-2.5 px-4 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 transition-colors"
          >
            {isBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            <span>
              {isBusy
                ? lang === 'th'
                  ? 'กำลังรับออเดอร์...'
                  : 'Accepting...'
                : lang === 'th'
                ? 'รับออเดอร์'
                : 'Accept Order'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
