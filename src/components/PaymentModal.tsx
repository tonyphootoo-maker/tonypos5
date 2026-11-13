import React, { useState, useEffect } from 'react';
import {
  BillDoc,
  SettingsDoc,
  Language,
  PaymentMethod,
  PaymentSplit,
  MemberDoc,
  ChannelDoc,
} from '../types';
import { translations } from '../i18n/translations';
import {
  formatMoney,
  roundTo2,
  calculateChangeDue,
  calculatePointsEarned,
  calculateBillFinancials,
} from '../engine/calculations';
import { getImageDoc, fetchCollection, payBillAtomic } from '../data/db';
import {
  X,
  Banknote,
  QrCode,
  CreditCard,
  ArrowRightLeft,
  CheckCircle2,
  Plus,
  Trash2,
  Star,
  Printer,
  AlertTriangle,
} from 'lucide-react';

interface Props {
  bill: BillDoc;
  settings: SettingsDoc;
  lang: Language;
  onClose: () => void;
  onPaymentSuccess: (finalBill: BillDoc) => void;
}

export const PaymentModal: React.FC<Props> = ({
  bill,
  settings,
  lang,
  onClose,
  onPaymentSuccess,
}) => {
  const t = translations[lang];

  // QR Code Image state
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Split payments state
  const [payments, setPayments] = useState<PaymentSplit[]>([
    { method: 'cash', amount: bill.grandTotal, tendered: bill.grandTotal, change: 0 },
  ]);

  // Active method being configured
  const [activeMethod, setActiveMethod] = useState<PaymentMethod>('cash');
  const [cashTendered, setCashTendered] = useState<number>(bill.grandTotal);

  // Membership state
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [memberPhone, setMemberPhone] = useState('');
  const [matchedMember, setMatchedMember] = useState<MemberDoc | null>(null);
  const [pointsToRedeem, setPointsToRedeem] = useState<number>(0);

  // Channel reference for recalculating points discount if needed
  const [billChannel, setBillChannel] = useState<ChannelDoc | undefined>(undefined);

  // Processing state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load QR Image, Members list, & Channel
  useEffect(() => {
    if (settings.qrImageId) {
      getImageDoc(settings.qrImageId).then((img) => {
        if (img?.dataUrl) setQrDataUrl(img.dataUrl);
      });
    }

    fetchCollection<MemberDoc>('members')
      .then((mems) => setMembers(mems))
      .catch(() => {});

    fetchCollection<ChannelDoc>('channels')
      .then((chs) => {
        const match = chs.find((c) => c.id === bill.channelId);
        setBillChannel(match);
      })
      .catch(() => {});
  }, [settings.qrImageId, bill.channelId]);

  // Member phone search
  useEffect(() => {
    if (!memberPhone.trim()) {
      setMatchedMember(null);
      setPointsToRedeem(0);
      return;
    }
    const found = members.find((m) => m.phone.replace(/\D/g, '') === memberPhone.replace(/\D/g, ''));
    setMatchedMember(found || null);
    if (!found) setPointsToRedeem(0);
  }, [memberPhone, members]);

  // Points discount calculation (recalculate via centralized engine if redeemed)
  const pointsDiscountValue = roundTo2(pointsToRedeem * (settings.pointsRedeemValueThb || 1));
  const recalculatedFinancials =
    pointsDiscountValue > 0
      ? calculateBillFinancials(
          bill.items,
          bill.discountAmount + pointsDiscountValue,
          bill.serviceChargeRate,
          bill.vatRate,
          billChannel || {
            id: bill.channelId,
            name: bill.channelName,
            type: bill.orderType,
            commissionPercent: 0,
            packagingCost: bill.packagingCost,
            createdAt: '',
            updatedAt: '',
            version: 1,
          },
          {
            pricesIncludeVat: settings.pricesIncludeVat,
            serviceChargeIncludedInPrice: settings.serviceChargeIncludedInPrice,
            serviceChargeTreatment: settings.serviceChargeTreatment,
            commissionBase: settings.commissionBase,
            commissionVatAsCost: settings.commissionVatAsCost,
          }
        )
      : null;

  const effectiveGrandTotal = recalculatedFinancials
    ? recalculatedFinancials.grandTotal
    : bill.grandTotal;
  const effectiveNetSales = recalculatedFinancials
    ? recalculatedFinancials.netSales
    : bill.netSales;

  // Update payment amounts when total changes
  useEffect(() => {
    setPayments([{ method: activeMethod, amount: effectiveGrandTotal, tendered: effectiveGrandTotal, change: 0 }]);
    setCashTendered(effectiveGrandTotal);
  }, [effectiveGrandTotal, activeMethod]);

  // Calculate total paid across splits
  const totalAllocated = roundTo2(payments.reduce((sum, p) => sum + p.amount, 0));
  const remainingDue = roundTo2(effectiveGrandTotal - totalAllocated);

  // Cash change calculation for the cash split
  const cashSplit = payments.find((p) => p.method === 'cash');
  const calculatedChange =
    cashSplit && cashTendered >= cashSplit.amount
      ? calculateChangeDue(cashTendered, cashSplit.amount)
      : 0;

  // Points earned
  const estimatedPointsEarned = calculatePointsEarned(effectiveNetSales, settings.pointsEarnUnitThb);

  const handleSelectSingleMethod = (method: PaymentMethod) => {
    setActiveMethod(method);
    setPayments([{ method, amount: effectiveGrandTotal, tendered: effectiveGrandTotal, change: 0 }]);
  };

  const handleAddSplitMethod = (method: PaymentMethod) => {
    if (remainingDue <= 0) return;
    setPayments([...payments, { method, amount: remainingDue, tendered: remainingDue, change: 0 }]);
  };

  const handleRemoveSplit = (index: number) => {
    if (payments.length <= 1) return;
    const next = [...payments];
    next.splice(index, 1);
    setPayments(next);
  };

  const handleUpdateSplitAmount = (index: number, newAmount: number) => {
    const next = [...payments];
    next[index].amount = Math.max(0, newAmount);
    setPayments(next);
  };

  const handleProcessPayment = async () => {
    if (Math.abs(remainingDue) > 0.05) {
      setErrorMsg(`Payment amount does not match grand total. Remaining: ฿${formatMoney(remainingDue)}`);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      // Attach change to cash split
      const finalizedPayments = payments.map((p) => {
        if (p.method === 'cash') {
          return {
            ...p,
            tendered: cashTendered,
            change: calculatedChange,
          };
        }
        return p;
      });

      const updatedBill: BillDoc = {
        ...bill,
        discountAmount: recalculatedFinancials
          ? recalculatedFinancials.discountAmount
          : bill.discountAmount,
        serviceChargeAmount: recalculatedFinancials
          ? recalculatedFinancials.serviceChargeAmount
          : bill.serviceChargeAmount,
        vatAmount: recalculatedFinancials
          ? recalculatedFinancials.vatAmount
          : bill.vatAmount,
        grandTotal: effectiveGrandTotal,
        netSales: effectiveNetSales,
        platformFee: recalculatedFinancials
          ? recalculatedFinancials.platformFee
          : bill.platformFee,
        memberId: matchedMember?.id || null,
        ...(matchedMember?.name ? { memberName: matchedMember.name } : {}),
        pointsEarned: matchedMember ? estimatedPointsEarned : 0,
        pointsRedeemed: pointsToRedeem > 0 ? pointsToRedeem : 0,
        payments: finalizedPayments,
      };

      await payBillAtomic(updatedBill, finalizedPayments);
      onPaymentSuccess(updatedBill);
    } catch (err: unknown) {
      console.error('Payment error:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Failed to finalize payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col border border-orange-200 overflow-hidden">
        {/* Top Header */}
        <div className="p-4 bg-gradient-to-r from-orange-500 via-red-500 to-amber-500 text-white flex items-center justify-between shadow-xs">
          <div>
            <h3 className="font-extrabold text-lg flex items-center gap-2">
              <Banknote className="w-6 h-6 text-yellow-200" />
              <span>{t.pos.payNow}</span>
            </h3>
            <p className="text-xs text-orange-100 font-mono">
              {bill.billNumber} • {bill.tableName || bill.channelName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-800 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Amount Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-2xl shadow-2xs">
              <div className="text-[11px] text-orange-800 font-semibold">{t.pos.subtotal}</div>
              <div className="text-base font-extrabold text-neutral-900">฿{formatMoney(bill.subtotal)}</div>
            </div>
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl shadow-2xs">
              <div className="text-[11px] text-red-800 font-semibold">{t.pos.discount}</div>
              <div className="text-base font-extrabold text-red-600">
                -฿{formatMoney(bill.discountAmount + pointsDiscountValue)}
              </div>
            </div>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl shadow-2xs">
              <div className="text-[11px] text-amber-800 font-semibold">VAT / SC</div>
              <div className="text-base font-extrabold text-neutral-900">
                ฿{formatMoney(bill.vatAmount + bill.serviceChargeAmount)}
              </div>
            </div>
            <div className="p-3 bg-gradient-to-br from-orange-500 to-red-500 text-white rounded-2xl shadow-md shadow-orange-500/20">
              <div className="text-[11px] text-orange-100 font-semibold">{t.pos.grandTotal}</div>
              <div className="text-xl font-black text-white">฿{formatMoney(effectiveGrandTotal)}</div>
            </div>
          </div>

          {/* Member Points Section */}
          <div className="p-3.5 bg-neutral-50 border border-neutral-200 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-neutral-800">
                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                <span>{t.pos.memberPoints}</span>
              </div>
              {matchedMember && (
                <span className="text-xs font-extrabold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">
                  {matchedMember.name} ({matchedMember.points} pts)
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder={t.pos.enterMemberPhone}
                value={memberPhone}
                onChange={(e) => setMemberPhone(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs bg-white border border-neutral-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500"
              />
              {matchedMember && matchedMember.points > 0 && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    max={matchedMember.points}
                    min={0}
                    value={pointsToRedeem}
                    onChange={(e) =>
                      setPointsToRedeem(Math.min(matchedMember.points, Math.max(0, parseInt(e.target.value, 10) || 0)))
                    }
                    className="w-20 px-2 py-1.5 text-xs text-center font-bold bg-white border border-amber-300 rounded-xl focus:ring-2 focus:ring-amber-500"
                    placeholder="Points"
                  />
                  <span className="text-xs text-amber-900 font-bold">
                    =-฿{formatMoney(pointsDiscountValue)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Payment Method Quick Selectors */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-neutral-700">{t.pos.payNow}:</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => handleSelectSingleMethod('cash')}
                className={`p-3 rounded-2xl border font-bold text-xs flex flex-col items-center gap-2 cursor-pointer transition-all shadow-xs ${
                  activeMethod === 'cash'
                    ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white border-emerald-600 shadow-md scale-[1.02]'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                <Banknote className="w-5 h-5" />
                <span>{t.pos.cash}</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectSingleMethod('qr')}
                className={`p-3 rounded-2xl border font-bold text-xs flex flex-col items-center gap-2 cursor-pointer transition-all shadow-xs ${
                  activeMethod === 'qr'
                    ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white border-blue-600 shadow-md scale-[1.02]'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                <QrCode className="w-5 h-5" />
                <span>{t.pos.qrPromptPay}</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectSingleMethod('card')}
                className={`p-3 rounded-2xl border font-bold text-xs flex flex-col items-center gap-2 cursor-pointer transition-all shadow-xs ${
                  activeMethod === 'card'
                    ? 'bg-gradient-to-br from-purple-500 to-violet-600 text-white border-purple-600 shadow-md scale-[1.02]'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                <CreditCard className="w-5 h-5" />
                <span>{t.pos.creditCard}</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectSingleMethod('transfer')}
                className={`p-3 rounded-2xl border font-bold text-xs flex flex-col items-center gap-2 cursor-pointer transition-all shadow-xs ${
                  activeMethod === 'transfer'
                    ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white border-amber-600 shadow-md scale-[1.02]'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                <ArrowRightLeft className="w-5 h-5" />
                <span>{t.pos.bankTransfer}</span>
              </button>
            </div>
          </div>

          {/* Cash Tendered & Change Area */}
          {payments.some((p) => p.method === 'cash') && (
            <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-2xl space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-xs font-bold text-emerald-900">{t.pos.tenderedCash}:</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-emerald-950">฿</span>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={cashTendered || ''}
                    onChange={(e) => setCashTendered(parseFloat(e.target.value) || 0)}
                    className="w-36 px-3 py-1.5 text-right font-black text-lg bg-white border border-emerald-300 rounded-xl focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Quick Cash Presets */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  effectiveGrandTotal,
                  Math.ceil(effectiveGrandTotal / 100) * 100,
                  500,
                  1000,
                ]
                  .filter((val, idx, arr) => val >= effectiveGrandTotal && arr.indexOf(val) === idx)
                  .map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCashTendered(preset)}
                      className="px-2.5 py-1 bg-white hover:bg-emerald-100 border border-emerald-300 text-emerald-900 rounded-lg text-xs font-bold shadow-2xs cursor-pointer active:scale-95"
                    >
                      ฿{formatMoney(preset)}
                    </button>
                  ))}
              </div>

              {/* Change Display */}
              <div className="pt-2 border-t border-emerald-200 flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-900">{t.pos.changeDue}:</span>
                <span className="text-xl font-black text-emerald-700">
                  ฿{formatMoney(calculatedChange)}
                </span>
              </div>
            </div>
          )}

          {/* QR Code Presentation if QR is chosen */}
          {payments.some((p) => p.method === 'qr' || p.method === 'transfer') && (
            <div className="p-4 bg-blue-50/80 border border-blue-200 rounded-2xl flex flex-col items-center text-center space-y-2">
              <div className="text-xs font-bold text-blue-900">{t.pos.scanQrToPay}</div>
              {qrDataUrl ? (
                <div className="p-3 bg-white rounded-2xl shadow-md border border-blue-200">
                  <img
                    src={qrDataUrl}
                    alt="PromptPay QR"
                    className="w-48 h-48 object-contain rounded-lg"
                  />
                </div>
              ) : (
                <div className="p-6 bg-white rounded-xl border border-dashed border-blue-300 text-xs text-neutral-500 max-w-sm">
                  {t.pos.noQrUploaded}
                </div>
              )}
              <div className="text-sm font-black text-blue-950">
                Amount to Transfer: ฿{formatMoney(effectiveGrandTotal)}
              </div>
            </div>
          )}

          {/* Split Payment Manager */}
          <div className="pt-2 border-t border-neutral-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-700">{t.pos.splitPayment}</span>
              {remainingDue > 0 && (
                <span className="text-xs font-bold text-amber-700">
                  Remaining: ฿{formatMoney(remainingDue)}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              {payments.map((p, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 p-2 bg-neutral-100 rounded-xl border border-neutral-300 text-xs"
                >
                  <span className="w-24 font-bold capitalize text-neutral-800">{p.method}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={p.amount}
                    onChange={(e) => handleUpdateSplitAmount(idx, parseFloat(e.target.value) || 0)}
                    className="flex-1 px-2.5 py-1 bg-white border border-neutral-300 rounded-lg font-bold text-right"
                  />
                  {payments.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSplit(idx)}
                      className="p-1 text-rose-600 hover:text-rose-800 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add split button if remaining */}
            {remainingDue > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {(['cash', 'qr', 'card', 'transfer'] as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleAddSplitMethod(m)}
                    className="px-2.5 py-1 bg-white hover:bg-neutral-100 border border-neutral-300 text-neutral-700 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3 text-orange-500" />
                    <span className="capitalize">{m}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal Bottom Final Confirm */}
        <div className="p-4 bg-neutral-100 border-t border-neutral-200 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 bg-white hover:bg-neutral-200 text-neutral-800 rounded-xl text-xs font-bold border border-neutral-300 cursor-pointer transition-colors"
          >
            {t.common.cancel}
          </button>

          <button
            type="button"
            disabled={isSubmitting || Math.abs(remainingDue) > 0.05}
            onClick={handleProcessPayment}
            className="flex-1 py-3 px-6 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 active:scale-98 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-105"
          >
            {isSubmitting ? (
              <span>{t.common.loading}</span>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-200" />
                <span>{t.pos.confirmOrder} (฿{formatMoney(effectiveGrandTotal)})</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
