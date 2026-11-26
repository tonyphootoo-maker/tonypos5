import React from 'react';
import { Ban, Phone, Check } from 'lucide-react';
import { Language, OnlineOrderDoc } from '../types';
import { OnlineOrderDisplayIds } from '../engine/onlineOrdering';
import { formatMoney } from '../engine/calculations';

interface Props {
  cancelledOrders: OnlineOrderDoc[];
  orderNumberingMap: Map<string, OnlineOrderDisplayIds>;
  lang: Language;
  onDismissOne: (orderId: string) => void;
  onDismissAll: () => void;
}

export const OnlineOrderCancelledAlert: React.FC<Props> = ({
  cancelledOrders,
  orderNumberingMap,
  lang,
  onDismissOne,
  onDismissAll,
}) => {
  if (cancelledOrders.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed z-[65] bottom-4 right-4 left-4 sm:left-auto sm:w-[400px] space-y-2 pointer-events-none"
    >
      <div className="bg-white rounded-2xl border-2 border-rose-500 shadow-[0_20px_50px_-12px_rgba(225,29,72,0.4)] overflow-hidden pointer-events-auto">
        <div className="px-4 py-2.5 bg-rose-600 text-white flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Ban className="w-4 h-4 shrink-0" />
            <span className="text-xs sm:text-sm font-extrabold truncate">
              {lang === 'th'
                ? `ลูกค้ายกเลิกออเดอร์! (${cancelledOrders.length})`
                : `Customer Cancelled Order! (${cancelledOrders.length})`}
            </span>
          </div>
          {cancelledOrders.length > 1 && (
            <button
              type="button"
              onClick={onDismissAll}
              className="px-2 py-0.5 rounded-md bg-white/20 hover:bg-white/30 text-[11px] font-bold cursor-pointer shrink-0"
            >
              {lang === 'th' ? 'รับทราบทั้งหมด' : 'Dismiss All'}
            </button>
          )}
        </div>

        <div className="max-h-64 overflow-y-auto divide-y divide-rose-100">
          {cancelledOrders.map((order) => {
            const displayIds = orderNumberingMap.get(order.id);
            return (
              <div key={order.id} className="p-3.5 space-y-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-base font-black text-rose-700 tabular-nums">
                        {displayIds?.displayNumber || order.orderNumber}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                        {displayIds?.referenceNumber || order.orderNumber}
                      </span>
                    </div>
                    <div className="font-bold text-slate-900 mt-0.5 truncate">
                      {order.customerName}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-extrabold text-slate-800 tabular-nums">
                      ฿{formatMoney(order.totalAmount)}
                    </div>
                    <a
                      href={`tel:${order.customerPhone}`}
                      className="text-[11px] font-semibold text-rose-600 hover:underline inline-flex items-center gap-1 tabular-nums"
                    >
                      <Phone className="w-3 h-3" />
                      <span>{order.customerPhone}</span>
                    </a>
                  </div>
                </div>

                {order.cancelReason && (
                  <div className="px-2.5 py-1.5 rounded-lg bg-rose-50 border border-rose-100 text-[11px] text-rose-800 font-medium">
                    {order.cancelReason}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => onDismissOne(order.id)}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{lang === 'th' ? 'รับทราบ' : 'Acknowledge'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
